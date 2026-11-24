// 手机浏览器（尤其 iOS Safari）只允许在用户手势里开始播放声音。
// 这里维护一个全局共享的 <audio> 和 AudioContext：在任意一次点击/触摸里先"解锁"，
// 之后通话音频（WebRTC 远端音轨）和来电铃声才能在异步回调里正常出声。

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let player: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let primed = false;
let priming = false;
let silentSrc = '';

/** 生成一段很短的静音 WAV，用来在手势里让 <audio> 真正 play 一次 */
function silentWav() {
  if (silentSrc) return silentSrc;
  const samples = 800;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  let binary = '';
  new Uint8Array(buffer).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  silentSrc = `data:audio/wav;base64,${btoa(binary)}`;
  return silentSrc;
}

/** 通话音频统一用这一个播放器，iOS 上解锁过的元素后续才能自动出声 */
export function sharedAudio() {
  if (!player) {
    player = new Audio();
    player.autoplay = true;
    player.setAttribute('playsinline', '');
    player.setAttribute('webkit-playsinline', '');
  }
  return player;
}

export function audioContext() {
  if (!context) {
    const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

/** 必须在用户手势（click / touchend / keydown）的同步调用栈里调用 */
export function unlockAudio() {
  const ctx = audioContext();
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);

  const audio = sharedAudio();
  if (primed || priming || audio.srcObject) return;
  priming = true;
  // Use silent samples, not muted autoplay: keep the element ready for sound.
  audio.src = silentWav();
  void audio.play()
    .then(() => {
      primed = true;
    })
    .catch(() => undefined)
    .finally(() => {
      priming = false;
      // 解锁期间远端音轨可能已经到了，这时不能把它暂停掉
      if (!audio.srcObject) {
        audio.pause();
        audio.removeAttribute('src');
      }
    });
}

/** 页面上第一次交互时自动解锁，返回卸载函数 */
export function installAudioUnlock() {
  const events: Array<keyof WindowEventMap> = ['click', 'touchend', 'keydown'];
  const handler = () => {
    unlockAudio();
    if (primed && audioContext()?.state === 'running') remove();
  };
  const remove = () => events.forEach((name) => window.removeEventListener(name, handler, true));
  events.forEach((name) => window.addEventListener(name, handler, true));
  return remove;
}
