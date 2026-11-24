import { getSession } from '@/services/deviceUbus';
import type { VoiceCall } from './useWebVoice';

export type VoiceTarget = { direction: 1; id: number; number: string } | { direction: 0; number: string };

const CALL_SETUP_MS = 90_000;
let pending: { target: VoiceTarget; session: string; expires: number; id: number | undefined } | undefined;
let generation = 0;

export function clearVoiceIntent() {
  pending = undefined;
  generation += 1;
}

/** Prepare in the initiating page; arm only after the device acknowledges this request. */
export function prepareVoiceAudio(target: VoiceTarget) {
  clearVoiceIntent();
  const request = generation;
  const session = getSession();
  return {
    accept: () => {
      if (request === generation && session && session === getSession()) {
        pending = { target, session, expires: Date.now() + CALL_SETUP_MS, id: target.direction === 1 ? target.id : undefined };
      }
    },
    cancel: () => { if (request === generation) clearVoiceIntent(); },
  };
}

const mainlandMobile = /^1[3-9]\d{9}$/;

// Match the dial helper's +86 conversion without treating an explicit +1
// number as a mainland mobile number with the same digits.
const matchesDial = (requested: string, reported: string) => {
  const target = mainlandMobile.test(requested) ? '+86' + requested : requested;
  if (reported === target) return true;
  if (target.startsWith('+86') && mainlandMobile.test(target.slice(3))) {
    return reported === target.slice(3) || reported === target.slice(1);
  }
  return target.startsWith('+') && !mainlandMobile.test(reported) && reported === target.slice(1);
};

export function consumeVoiceIntent(call: VoiceCall | null, callCount: number) {
  if (!pending) return false;
  const { target, session, expires, id } = pending;
  if (session !== getSession() || Date.now() >= expires) {
    clearVoiceIntent();
    return false;
  }
  // A dial ACK has no call ID. Bind it only to the first matching setup
  // snapshot. An idle or already connected snapshot cannot prove identity.
  if (!call || callCount !== 1 || call.direction !== target.direction || (id !== undefined && id !== call.id)
    || (target.direction === 1 ? (call.number || '') !== target.number : !matchesDial(target.number, call.number || ''))
    || (id === undefined && call.state === 0)
    || (call.state !== 0 && (target.direction === 1 ? call.state !== 4 : ![2, 3].includes(call.state)))) {
    clearVoiceIntent();
    return false;
  }
  pending.id = call.id;
  if (call.state !== 0) return false;
  clearVoiceIntent();
  return true;
}
