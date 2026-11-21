import * as PDU from 'node-pdu';

export type InboxMessage = {
  index: number;
  number: string;
  content: string;
  time: string;
  parts?: { ref: number; total: number; seq: number };
};

const pad = (value: number) => String(value).padStart(2, '0');

const stampOf = (date: Date) =>
  `${pad(date.getFullYear() % 100)}/${pad(date.getMonth() + 1)}/${pad(date.getDate())},${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

/** 解码网关下发的 SMS-DELIVER PDU；返回 null 表示这条不是可展示的文本短信 */
export function decodeDeliver(pdu: string): Omit<InboxMessage, 'index'> | null {
  const clean = pdu.replace(/\s+/g, '');
  if (clean.length < 20) return null;
  try {
    const parsed = PDU.parse(clean);
    if (!(parsed instanceof PDU.Deliver)) return null;
    const number = parsed._address?._phone || '';
    const content = parsed._data?.getText() || '';
    if (!content) return null;

    let parts: { ref: number; total: number; seq: number } | undefined;
    const ie = parsed._data?._parts?.[0]?.header?.ies?.[0]?.data;
    if (ie?.maxMsgNum && ie?.msgRef && ie?.msgSeqNo) {
      parts = { ref: ie.msgRef, total: ie.maxMsgNum, seq: ie.msgSeqNo };
    }

    let time = stampOf(new Date());
    if (parsed._serviceCenterTimeStamp?.time) {
      const utc = parsed._serviceCenterTimeStamp.time * 1000;
      const tzOff = parsed._serviceCenterTimeStamp.tzOff || 0;
      time = stampOf(new Date(utc + (tzOff + new Date().getTimezoneOffset()) * 60 * 1000));
    }

    return { number, content, time, parts };
  } catch {
    return null;
  }
}

/** 把同一号码、同一引用号的长短信分片合并成一条，按分片序号拼接 */
export function mergeParts(list: InboxMessage[]): InboxMessage[] {
  const groups = new Map<string, InboxMessage[]>();
  const singles: InboxMessage[] = [];

  list.forEach((message) => {
    if (!message.parts) {
      singles.push(message);
      return;
    }
    const key = `${message.number}#${message.parts.ref}`;
    groups.set(key, [...(groups.get(key) || []), message]);
  });

  const merged: InboxMessage[] = singles;
  groups.forEach((parts) => {
    const sorted = [...parts].sort((a, b) => (a.parts?.seq || 0) - (b.parts?.seq || 0));
    if (sorted.length === 1) {
      merged.push(sorted[0]);
      return;
    }
    merged.push({
      index: sorted[0].index,
      number: sorted[0].number,
      content: sorted.map((item) => item.content).join(''),
      time: sorted[0].time,
    });
  });

  return merged.sort((a, b) => a.index - b.index);
}

export function readableTime(time: string) {
  const match = time.match(/(\d{2})\/(\d{2})\/(\d{2}),(\d{2}):(\d{2})/);
  if (!match) return time;
  return `20${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}
