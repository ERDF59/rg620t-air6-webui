import { audioContext } from '@/modules/webvoice/audio';

// 来电铃声：用 WebAudio 合成 440 + 480 Hz 双音，配合振动。
// 手机上必须先有一次用户交互解锁 AudioContext（见 webvoice/audio.ts 的 installAudioUnlock），
// 未解锁时只振动（Android 支持，iOS 不支持振动），不会报错。

const RING_PERIOD_MS = 3000;
const BURST_S = 0.4;
const GAP_S = 0.2;
const TONE_GAIN = 0.12;

let timer: number | undefined;
const sounding = new Set<OscillatorNode>();

const burst = (ctx: AudioContext, at: number) => {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(TONE_GAIN, at + 0.02);
  gain.gain.setValueAtTime(TONE_GAIN, at + BURST_S - 0.03);
  gain.gain.linearRampToValueAtTime(0, at + BURST_S);
  gain.connect(ctx.destination);
  const frequencies = [440, 480];
  let remaining = frequencies.length;
  frequencies.forEach((frequency) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    osc.connect(gain);
    sounding.add(osc);
    osc.onended = () => {
      sounding.delete(osc);
      osc.disconnect();
      if (--remaining === 0) gain.disconnect();
    };
    osc.start(at);
    osc.stop(at + BURST_S);
  });
};

const ringOnce = () => {
  navigator.vibrate?.([400, 200, 400]);
  const ctx = audioContext();
  if (!ctx) return;
  if (ctx.state !== 'running') return;
  const now = ctx.currentTime + 0.02;
  burst(ctx, now);
  burst(ctx, now + BURST_S + GAP_S);
};

export const startRingtone = () => {
  if (timer !== undefined) return;
  ringOnce();
  timer = window.setInterval(ringOnce, RING_PERIOD_MS);
};

export const stopRingtone = () => {
  if (timer === undefined) return;
  window.clearInterval(timer);
  timer = undefined;
  sounding.forEach((osc) => osc.stop());
  navigator.vibrate?.(0);
};
