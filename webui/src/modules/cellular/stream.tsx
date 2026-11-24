import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getSession } from '@/services/deviceUbus';
import type { Overview } from './telemetry';

type Status = 'connecting' | 'live' | 'offline';
type Feed = { network: Overview | null; networkStatus: Status; smsVersion: number | null; smsLive: boolean };
const empty: Feed = { network: null, networkStatus: 'offline', smsVersion: null, smsLive: false };
const noop = () => {};
const Events = createContext<Feed & { subscribeNetwork: () => () => void }>({ ...empty, subscribeNetwork: () => noop });

function eventParts(block: string) {
  let event = '';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  return { event, data: data.join('\n') };
}

export function CellularEventsProvider({ children }: React.PropsWithChildren) {
  const [visible, setVisible] = useState(() => !document.hidden);
  const [subscribers, setSubscribers] = useState(0);
  const [feed, setFeed] = useState<Feed>(empty);
  const subscribeNetwork = useMemo(() => () => {
    setSubscribers((count) => count + 1);
    return () => setSubscribers((count) => count - 1);
  }, []);
  const network = subscribers > 0;
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    const token = getSession();
    if (!visible || import.meta.env.VITE_CELLULAR_SSE !== 'on' || !/^[0-9a-f]{32}$/.test(token)) {
      setFeed(empty);
      return;
    }
    let stopped = false;
    let request: AbortController | undefined;
    let retry: number | undefined;
    let watch: number | undefined;
    let failures = 0;
    setFeed((last) => ({ ...last, network: null, networkStatus: network ? 'connecting' : 'offline', smsLive: false }));

    async function start() {
      request = new AbortController();
      const arm = () => {
        window.clearTimeout(watch);
        watch = window.setTimeout(() => request?.abort(), 9500);
      };
      arm();
      let clean = false;
      try {
        const response = await fetch('/cgi-bin/rg620-events', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: `${token}:${network ? 'N' : '-'}S`,
          credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: request.signal,
        });
        if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream'))
          throw new Error('SSE unavailable');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let received = false;
        try {
          while (!stopped) {
            const part = await reader.read();
            if (part.done) { clean = received; break; }
            arm();
            buffer += decoder.decode(part.value, { stream: true });
            let end: RegExpMatchArray | null;
            while ((end = buffer.match(/\r?\n\r?\n/)) && end.index !== undefined) {
              const { event, data } = eventParts(buffer.slice(0, end.index));
              buffer = buffer.slice(end.index + end[0].length);
              if (!event || stopped) continue;
              try {
                const value = JSON.parse(data);
                if (network && event === 'network' && value?.ok === true) {
                  setFeed((last) => ({ ...last, network: value, networkStatus: 'live' }));
                  received = true;
                } else if (event === 'sms' && Number.isSafeInteger(value) && value >= 0) {
                  setFeed((last) => ({ ...last, smsVersion: value, smsLive: true }));
                  received = true;
                } else if (event === 'health' && value && typeof value === 'object') {
                  setFeed((last) => ({
                    ...last,
                    networkStatus: value.network === false ? 'offline' : last.networkStatus,
                    smsLive: value.sms === true && last.smsVersion != null,
                  }));
                }
              } catch { /* Ignore a malformed event, not the remainder of the stream. */ }
            }
            if (buffer.length > 256_000) throw new Error('SSE frame exceeded limit');
          }
        } finally {
          await reader.cancel().catch(noop);
          reader.releaseLock();
        }
      } catch { /* Existing ubus reads are the fallback. */ }
      window.clearTimeout(watch);
      if (stopped) return;
      if (!clean) setFeed((last) => ({ ...last, networkStatus: 'offline', smsLive: false }));
      failures = clean ? 0 : failures + 1;
      retry = window.setTimeout(start, clean ? 350 : Math.min(30_000, 2000 * 2 ** failures) + Math.random() * 1000);
    }

    void start();
    return () => {
      stopped = true;
      request?.abort();
      window.clearTimeout(retry);
      window.clearTimeout(watch);
    };
  }, [network, visible]);

  return <Events.Provider value={{ ...feed, subscribeNetwork }}>{children}</Events.Provider>;
}

export function useCellularStream(enabled: boolean) {
  const { subscribeNetwork, network, networkStatus } = useContext(Events);
  useEffect(() => enabled ? subscribeNetwork() : undefined, [enabled, subscribeNetwork]);
  return enabled ? { snapshot: network, status: networkStatus } : { snapshot: null, status: 'offline' as const };
}

/** An existing alert poll found new storage records while the SMS stream was unavailable. */
export const SMS_POLL_CHANGE_EVENT = 'rg620:sms-poll-change';

export function useSmsEvents() {
  const { smsVersion, smsLive } = useContext(Events);
  return { version: smsVersion, live: smsLive };
}
