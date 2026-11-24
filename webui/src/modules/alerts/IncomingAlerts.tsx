import React, { useEffect, useRef } from 'react';
import { Button, Notification, Toast } from '@douyinfe/semi-ui';
import { IconComment, IconPhone } from '@douyinfe/semi-icons';
import { useNavigate } from 'react-router-dom';
import { ubus } from '@/services/deviceUbus';
import { SMS_POLL_CHANGE_EVENT, useSmsEvents } from '@/modules/cellular/stream';
import { decodeDeliver, mergeParts, readableTime, type InboxMessage } from '@/modules/sms/decode';

/** 来电响铃 / 呼叫等待。direction 1 是来电，与语音页 AT+CLCC 的取值一致。 */
const INCOMING_STATES = new Set([4, 5]);
const CALL_POLL_MS = 4000;
const SMS_POLL_MS = 12000;

type Call = { id: number; direction: number; state: number; number: string; kind?: number; voice?: boolean };
type VoiceStatus = { ok?: boolean; calls?: Call[]; read_only?: boolean; error?: string };
type Inbox = { ok?: boolean; indexes?: number[] };
type ReadResult = { ok?: boolean; pdu?: string };

const noticeId = (kind: 'call' | 'sms', id: number | string) => `rg620-${kind}-${id}`;

const preview = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 72);

const IncomingAlerts: React.FC = () => {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const { version, live } = useSmsEvents();
  const liveRef = useRef(live);
  liveRef.current = live;
  const pollSmsRef = useRef<() => void>(() => {});
  const lastPush = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    const ringing = new Map<number, string>();
    const smsNotices = new Set<string>();
    const inFlight = new Set<number>();
    let readingCalls = false;
    let knownSms: Set<number> | null = null;
    let readingSms = false;
    let pendingSms = false;
    let lastSmsRead = 0;

    const openSms = (id: string) => {
      smsNotices.delete(id);
      Notification.close(id);
      navigateRef.current('/sms/center');
    };

    const openCall = (id: number) => {
      Notification.close(noticeId('call', id));
      navigateRef.current('/network/voice');
    };

    const controlCall = async (call: Call, method: 'voice_answer' | 'voice_hangup', okText: string) => {
      if (stopped || inFlight.has(call.id)) return;
      inFlight.add(call.id);
      try {
        const result = await ubus<{ ok?: boolean; error?: string }>('dlink-cellular', method, {
          id: String(call.id),
          ringing_only: true, peer: call.number || '',
          confirm: true,
        });
        if (stopped) return;
        if (result?.ok !== true) {
          Toast.error(result?.error === 'call_changed' ? '来电状态已变化，本次未执行。' : result?.error || '操作失败');
          return;
        }
        Toast.success(okText);
        openCall(call.id);
      } catch (error) {
        if (!stopped) Toast.error(error instanceof Error && error.message === 'call_changed' ? '来电状态已变化，本次未执行。' : error instanceof Error ? error.message : '操作失败');
      } finally {
        inFlight.delete(call.id);
      }
    };

    const showCall = (call: Call, actionable: boolean) => {
      const who = call.number || '未知号码';
      Notification.warning({
        id: noticeId('call', call.id),
        title: call.state === 5 ? '有一通呼叫等待' : '来电话了',
        content: (
          <div className="alert-card">
            <div className="alert-number">{who}</div>
            <div className="alert-preview">{call.state === 5 ? '当前线路忙，另一通来电正在等待。' : actionable ? '正在响铃，可直接接听或拒接。' : '请查看当前通话状态。'}</div>
            <div className="alert-actions">
              {actionable && <>
              <Button size="small" theme="solid" type="primary" onClick={() => controlCall(call, 'voice_answer', '已请求接听')}>
                接听
              </Button>
              <Button size="small" type="danger" onClick={() => controlCall(call, 'voice_hangup', '已请求拒接')}>
                拒接
              </Button>
              </>}
              <Button size="small" onClick={() => openCall(call.id)}>
                查看
              </Button>
            </div>
          </div>
        ),
        duration: 0,
        position: 'topRight',
        icon: <IconPhone />,
      });
    };

    const showSms = (messages: InboxMessage[]) => {
      if (!messages.length) return;
      const id = noticeId('sms', messages.map((item) => item.index).join('-'));
      smsNotices.add(id);
      Notification.info({
        onClose: () => { smsNotices.delete(id); },
        id,
        title: messages.length === 1 ? '来短信了' : `来了 ${messages.length} 条短信`,
        content: (
          <div className="alert-card">
            {messages.slice(0, 3).map((message) => (
              <div key={message.index}>
                <div className="alert-number">
                  {message.number || '未知号码'}
                  <span className="alert-time">{readableTime(message.time)}</span>
                </div>
                <div className="alert-preview">{preview(message.content) || '(无内容)'}</div>
              </div>
            ))}
            {messages.length > 3 ? <div className="alert-preview">还有 {messages.length - 3} 条</div> : null}
            <div className="alert-actions">
              <Button size="small" theme="solid" type="primary" onClick={() => openSms(id)}>
                查看
              </Button>
            </div>
          </div>
        ),
        duration: 0,
        position: 'topRight',
        icon: <IconComment />,
      });
    };

    const pollCalls = async () => {
      if (readingCalls || stopped) return;
      readingCalls = true;
      try {
        const status = await ubus<VoiceStatus>('dlink-cellular', 'voice_status');
        if (stopped || !status?.ok) return;
        const incoming = (status.calls || []).filter(
          (call) => call.direction === 1 && INCOMING_STATES.has(call.state),
        );
        const live = new Set(incoming.map((call) => call.id));
        for (const id of ringing.keys()) {
          if (!live.has(id)) {
            ringing.delete(id);
            Notification.close(noticeId('call', id));
          }
        }
        for (const call of incoming) {
          const actionable = status.calls?.length === 1 && !status.read_only && call.state === 4 && (call.kind === 0 || call.voice === true);
          const signature = JSON.stringify([call.state, call.number, actionable]);
          if (ringing.get(call.id) === signature) continue;
          ringing.set(call.id, signature);
          showCall(call, actionable);
        }
      } catch {
        /* 与语音页共用基带锁，忙或短暂失败留给下一轮 */
      } finally {
        readingCalls = false;
      }
    };

    const pollSms = async (fromPush = false) => {
      if (stopped) return;
      if (readingSms) { if (fromPush) pendingSms = true; return; }
      readingSms = true;
      try {
        const summary = await ubus<Inbox>('dlink-cellular', 'sms_list');
        if (stopped || summary?.ok !== true || !Array.isArray(summary.indexes)) return;
        lastSmsRead = Date.now();
        const indexes = summary.indexes || [];
        if (!knownSms) {
          knownSms = new Set(indexes);
          return;
        }
        const current = new Set(indexes);
        for (const i of knownSms) if (!current.has(i)) knownSms.delete(i);
        const fresh = indexes.filter((index) => !knownSms?.has(index));
        if (!fresh.length) return;
        const decoded: InboxMessage[] = [];
        for (const index of fresh.slice(0, 8)) {
          if (stopped) break;
          try {
            const message = await ubus<ReadResult>('dlink-cellular', 'sms_read', { index });
            if (stopped || !message?.ok || !message.pdu) continue;
            knownSms.add(index);
            const parsed = message.pdu ? decodeDeliver(message.pdu) : null;
            if (parsed) decoded.push({ index, ...parsed });
          } catch {
            /* 单条读失败不阻断其余新短信 */
          }
        }
        if (fresh.some((index) => !knownSms?.has(index))) lastSmsRead = 0;
        if (!stopped) {
          if (!fromPush && !liveRef.current) window.dispatchEvent(new Event(SMS_POLL_CHANGE_EVENT));
          showSms(mergeParts(decoded));
        }
      } catch {
        /* 下一轮再读 */
      } finally {
        readingSms = false;
        if (pendingSms) { pendingSms = false; void pollSms(); }
      }
    };

    void pollCalls();
    void pollSms();
    const callTimer = window.setInterval(() => void pollCalls(), CALL_POLL_MS);
    pollSmsRef.current = () => void pollSms(true);
    const smsTimer = window.setInterval(() => {
      if (!liveRef.current || Date.now() - lastSmsRead > 48_000) void pollSms();
    }, SMS_POLL_MS);

    return () => {
      stopped = true;
      pollSmsRef.current = () => {};
      window.clearInterval(callTimer);
      window.clearInterval(smsTimer);
      ringing.forEach((_, id) => Notification.close(noticeId('call', id)));
      smsNotices.forEach((id) => Notification.close(id));
    };
  }, []);

  useEffect(() => {
    if (version == null || version === lastPush.current) return;
    lastPush.current = version;
    pollSmsRef.current();
  }, [version]);

  return null;
};

export default IncomingAlerts;
