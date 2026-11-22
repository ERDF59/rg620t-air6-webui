import * as PDU from 'node-pdu';

export type SmsRecord = { index: number; pdu: string };
type SmsPart = { ref: number; total: number; seq: number; center: string; identifier: number };
// An 8-bit reference can be reused. Do not combine deliveries far apart in this inbox.
const PART_DELIVERY_WINDOW_MS = 5 * 60 * 1000;

export type InboxMessage = {
  index: number;
  number: string;
  content: string;
  time: string;
  records?: SmsRecord[];
  receivedAt?: number;
  parts?: SmsPart;
  fragments?: { available: number; total: number };
};

const pad = (value: number) => String(value).padStart(2, '0');

const stampOf = (date: Date) =>
  `${pad(date.getFullYear() % 100)}/${pad(date.getMonth() + 1)}/${pad(date.getDate())},${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

/** 解码网关下发的 SMS-DELIVER PDU；返回 null 表示这条不是可展示的文本短信 */
export function decodeDeliver(pdu: string): Omit<InboxMessage, 'index' | 'records'> | null {
  const clean = pdu.replace(/\s+/g, '');
  if (clean.length < 20) return null;
  try {
    const parsed = PDU.parse(clean);
    if (!(parsed instanceof PDU.Deliver)) return null;
    const number = parsed._address?._phone || '';
    const content = parsed._data?.getText() || '';
    if (!content) return null;

    let parts: SmsPart | undefined;
    const concat = parsed._data?._parts?.[0]?.header?.ies?.find((item) => item.type === 0 || item.type === 8);
    const ie = concat?.data;
    if (concat && ie?.maxMsgNum && ie.maxMsgNum >= 2 && typeof ie.msgRef === 'number'
        && ie.msgSeqNo && ie.msgSeqNo <= ie.maxMsgNum) {
      parts = { ref: ie.msgRef, total: ie.maxMsgNum, seq: ie.msgSeqNo,
        center: parsed.serviceCenterAddress.toString(), identifier: concat.type };
    }

    const timestamp = parsed._serviceCenterTimeStamp?.time;
    const receivedAt = timestamp ? timestamp * 1000 : undefined;
    const tzOff = parsed._serviceCenterTimeStamp?.tzOff || 0;
    const time = receivedAt
      ? stampOf(new Date(receivedAt + (tzOff + new Date().getTimezoneOffset()) * 60 * 1000))
      : stampOf(new Date());

    return { number, content, time, receivedAt, parts };
  } catch {
    return null;
  }
}

/** 收件箱保留未齐的长短信；通知仍沿用原来的归并方式。 */
export function mergeParts(list: InboxMessage[], inbox = false): InboxMessage[] {
  const groups = new Map<string, InboxMessage[]>();
  const merged: InboxMessage[] = [];

  for (const message of list) {
    const part = message.parts;
    if (!part || (inbox && !message.receivedAt)) {
      merged.push(message);
      continue;
    }
    const key = JSON.stringify(inbox
      ? [message.number, part.identifier, part.ref, part.total]
      : [message.number, part.ref]);
    const group = groups.get(key);
    if (group) group.push(message);
    else groups.set(key, [message]);
  }

  const combine = (group: InboxMessage[]) => {
    const sorted = [...group].sort((a, b) => a.parts!.seq - b.parts!.seq);
    // Duplicate positions make the association ambiguous; show the actual slots separately.
    if ((!inbox && sorted.length === 1) ||
        (inbox && new Set(sorted.map((item) => item.parts!.seq)).size !== sorted.length)) {
      merged.push(...sorted);
      return;
    }
    const first = sorted[0];
    const content = sorted.map((item, i) =>
      (inbox && i > 0 && item.parts!.seq !== sorted[i - 1].parts!.seq + 1 ? '\n…\n' : '') + item.content,
    ).join('');
    merged.push({
      index: first.index,
      number: first.number,
      content,
      time: first.time,
      records: inbox && sorted.some((item) => !item.records?.length)
        ? undefined : sorted.flatMap((item) => item.records || []),
      fragments: inbox ? { available: sorted.length, total: first.parts!.total } : undefined,
    });
  };

  for (const group of groups.values()) {
    if (!inbox) {
      combine(group);
      continue;
    }
    // Rendering needs one copy per part; deletion needs the original slot and PDU of every copy.
    const copies = new Map<string, InboxMessage>();
    const unique: InboxMessage[] = [];
    for (const part of group) {
      const record = part.records?.length === 1 ? part.records[0] : null;
      if (!record) { unique.push(part); continue; }
      const key = JSON.stringify([part.receivedAt, part.parts!.center, part.parts!.seq, record.pdu.toUpperCase()]);
      const existing = copies.get(key);
      if (existing) {
        if (!existing.records!.some(r => r.index === record.index)) existing.records!.push(record);
      } else {
        const first = { ...part, records: [record] };
        copies.set(key, first);
        unique.push(first);
      }
    }

    // A multipart delivery can be routed through more than one SMSC. Join across
    // centers only for a complete, unambiguous set with an identical SMS timestamp.
    const ordered = unique.sort((a,b) => a.receivedAt! - b.receivedAt!);
    const byCenter = new Map<string, InboxMessage[]>();
    for (let start = 0; start < ordered.length;) {
      let end = start + 1;
      while (end < ordered.length && ordered[end].receivedAt === ordered[start].receivedAt) end++;
      const batch = ordered.slice(start, end);
      const total = batch[0].parts!.total;
      const isolated = (start === 0 || ordered[start].receivedAt! - ordered[start-1].receivedAt! > PART_DELIVERY_WINDOW_MS)
        && (end === ordered.length || ordered[end].receivedAt! - ordered[start].receivedAt! > PART_DELIVERY_WINDOW_MS);
      if (isolated && batch.length === total && new Set(batch.map(b => b.parts!.seq)).size === total
          && new Set(batch.map(b => b.parts!.center)).size > 1) {
        combine(batch);
      } else {
        for (const part of batch) {
          const center = part.parts!.center;
          const bucket = byCenter.get(center);
          if (bucket) bucket.push(part); else byCenter.set(center,[part]);
        }
      }
      start = end;
    }
    for (const local of byCenter.values()) {
      let start = 0;
      for (let i = 1; i <= local.length; i++) {
        if (i === local.length || local[i].receivedAt! - local[start].receivedAt! > PART_DELIVERY_WINDOW_MS) {
          combine(local.slice(start,i)); start = i;
        }
      }
    }
  }

  return merged.sort((a, b) => a.index - b.index);
}

export function readableTime(time: string) {
  const match = time.match(/(\d{2})\/(\d{2})\/(\d{2}),(\d{2}):(\d{2})/);
  if (!match) return time;
  return `20${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}
