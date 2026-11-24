import { useCallback, useEffect, useRef, useState } from 'react';
import { ubus, UbusError } from '@/services/deviceUbus';
import { sharedAudio, unlockAudio } from './audio';

// 对接设备上的 dlink-webvoice 网关（Go / pion WebRTC，PCMU 8kHz）：
//   open  { id, direction, number, offer, confirm:true } → { ok, answer, token }
//   pulse { token }  → { ok, ready }   网关 12 秒收不到心跳就会断开会话
//   close { token }
// 音频本身走局域网 WebRTC，不经过 ubus。

export type VoiceCall = { id: number; state: number; direction: number; number: string };
export type WebVoicePhase = 'off' | 'permission' | 'linking' | 'media' | 'live';

type OpenResult = { ok?: boolean; error?: string; answer?: string; token?: string };
type PulseResult = { ok?: boolean; error?: string; ready?: boolean };

type Session = {
  key: string;
  pc?: RTCPeerConnection;
  mic?: MediaStream;
  token?: string;
  timer?: number;
  deadline?: number;
  connected: boolean;
  live: boolean;
  checking: boolean;
};

const GATEWAY_ERRORS: Record<string, string> = {
  busy: '音频正被另一个页面或诊断占用。',
  call_changed: '通话状态已变化，请稍后再连接。',
  offline: '路由器的网页通话服务未就绪。',
  lan: '没有可用的局域网音频地址，请确认手机连的是这台路由器的 Wi-Fi。',
  ice: '音频地址协商超时，请确认手机连的是这台路由器的局域网。',
  rtc: '未能建立加密音频连接。',
  invalid_offer: '浏览器没有提供兼容的语音格式。',
  session_closed: '通话已结束，或音频连接已关闭。',
  confirm: '需要确认后才能连接。',
  input: '请求参数不完整。',
};

const MIC_ERRORS: Record<string, string> = {
  NotAllowedError: '浏览器未允许使用麦克风，请在地址栏的站点权限里开启后重试。',
  NotFoundError: '没有找到麦克风。',
  NotReadableError: '麦克风不可用，可能被其他应用占用。',
  SecurityError: '当前页面不是安全连接，浏览器拒绝了麦克风。',
};

const PULSE_MS = 2000;
const LIVE_DEADLINE_MS = 16000;

/** 只有已接通（state 0）的通话才能挂网页音频；号码/方向/id 任一变化都视为另一通电话 */
export const callKey = (call?: VoiceCall | null) =>
  call && call.state === 0 ? `${call.id}:${call.direction}:${call.number || ''}` : '';

export function webVoiceSupport() {
  const secure = window.isSecureContext === true;
  const media = Boolean(navigator.mediaDevices?.getUserMedia) && typeof RTCPeerConnection === 'function';
  return { secure, media, ok: secure && media };
}

const describe = (error: unknown) => {
  if (error instanceof UbusError) {
    if (error.code === 4 || error.code === 5) return '设备没有安装网页通话服务（dlink-webvoice）。';
    if (error.code === 6 || error.code === -32002) return '当前账号没有网页通话权限。';
    return GATEWAY_ERRORS[error.message] || error.message;
  }
  if (error && typeof error === 'object' && 'name' in error && MIC_ERRORS[String(error.name)]) {
    return MIC_ERRORS[String(error.name)];
  }
  return error instanceof Error && error.message ? error.message : '音频连接失败。';
};

export function useWebVoice(call: VoiceCall | null) {
  const [phase, setPhase] = useState<WebVoicePhase>('off');
  const [note, setNote] = useState('');
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [hasMic, setHasMic] = useState(false);

  const session = useRef<Session | null>(null);
  const key = callKey(call);
  const keyRef = useRef(key);
  const callRef = useRef(call);
  keyRef.current = key;
  callRef.current = call;

  const stop = useCallback((message = '') => {
    const old = session.current;
    session.current = null;
    setPhase('off');
    setNote(message);
    setMuted(false);
    setBlocked(false);
    setHasMic(false);
    if (old) {
      window.clearInterval(old.timer);
      window.clearTimeout(old.deadline);
      if (old.pc) {
        old.pc.onconnectionstatechange = null;
        old.pc.ontrack = null;
        old.pc.close();
      }
      old.mic?.getTracks().forEach((track) => track.stop());
      if (old.token) void ubus('dlink-webvoice', 'close', { token: old.token }).catch(() => undefined);
    }
    const audio = sharedAudio();
    audio.pause();
    audio.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    const target = callRef.current;
    const current = keyRef.current;
    if (session.current || !target || !current || !webVoiceSupport().ok) return;

    const cur: Session = { key: current, connected: false, live: false, checking: false };
    session.current = cur;
    setPhase('permission');
    setNote('');
    setBlocked(false);
    const valid = () => session.current === cur && keyRef.current === cur.key;

    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!valid()) {
        mic.getTracks().forEach((track) => track.stop());
        if (session.current === cur) stop('通话已变化。');
        return;
      }
      cur.mic = mic;
      setHasMic(true);
      cur.deadline = window.setTimeout(() => {
        if (valid() && !cur.live) {
          stop(cur.token
            ? '没有收到双向音频，请确认手机连的是这台路由器的局域网。'
            : '路由器未及时建立网页音频，已释放麦克风。');
        }
      }, LIVE_DEADLINE_MS);

      const pc = new RTCPeerConnection({ iceServers: [] });
      cur.pc = pc;
      setPhase('linking');

      const track = mic.getAudioTracks()[0];
      track.onended = () => {
        if (valid()) stop('麦克风已断开。');
      };
      pc.addTrack(track, mic);

      pc.ontrack = (event) => {
        if (!valid()) return;
        const audio = sharedAudio();
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        audio.muted = false;
        audio.play().catch(() => {
          if (valid()) setBlocked(true);
        });
      };
      pc.onconnectionstatechange = () => {
        if (!valid()) return;
        if (pc.connectionState === 'connected') {
          cur.connected = true;
          setPhase('media');
        }
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
          stop('音频连接已断开，可以重新启用。');
        }
      };

      await pc.setLocalDescription(await pc.createOffer());
      if (!valid()) return;

      const result = await ubus<OpenResult>('dlink-webvoice', 'open', {
        id: String(target.id),
        direction: target.direction,
        number: target.number || '',
        offer: pc.localDescription?.sdp || '',
        confirm: true,
      });
      if (!valid()) {
        if (result?.token) void ubus('dlink-webvoice', 'close', { token: result.token }).catch(() => undefined);
        return;
      }
      cur.token = result?.token;
      if (!result?.ok || !result.answer || !cur.token) {
        throw new Error(GATEWAY_ERRORS[result?.error || ''] || '网页通话服务没有接受连接。');
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: result.answer });
      if (!valid()) return;

      const beat = async () => {
        if (cur.checking || !valid() || !cur.token) return;
        cur.checking = true;
        try {
          const pulse = await ubus<PulseResult>('dlink-webvoice', 'pulse', { token: cur.token });
          if (!valid()) return;
          if (!pulse?.ok) {
            stop(GATEWAY_ERRORS[pulse?.error || ''] || '网页通话服务已停止。');
            return;
          }
          if (cur.connected && pulse.ready && !cur.live) {
            const stats = await pc.getStats();
            if (!valid()) return;
            let flowing = false;
            stats.forEach((item) => {
              if (item.type === 'inbound-rtp' && (item.kind === 'audio' || item.mediaType === 'audio') && item.packetsReceived > 0) {
                flowing = true;
              }
            });
            if (flowing) {
              cur.live = true;
              window.clearTimeout(cur.deadline);
              setPhase('live');
            }
          }
        } catch {
          if (valid()) stop('无法联系路由器，已释放麦克风。');
        } finally {
          cur.checking = false;
        }
      };

      cur.timer = window.setInterval(() => void beat(), PULSE_MS);
      void beat();
    } catch (error) {
      if (session.current !== cur) return;
      stop(describe(error));
    }
  }, [stop]);

  const toggleMute = useCallback(() => {
    const mic = session.current?.mic;
    if (!mic) return;
    setMuted((prev) => {
      const next = !prev;
      mic.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      return next;
    });
  }, []);

  const resume = useCallback(async () => {
    unlockAudio();
    try {
      await sharedAudio().play();
      setBlocked(false);
    } catch {
      setNote('仍然无法播放，请检查浏览器的声音权限、静音开关和输出设备。');
    }
  }, []);

  // 挂断、换了一通电话都要立刻释放麦克风和会话
  useEffect(() => {
    if (session.current && session.current.key !== key) {
      stop(key ? '通话已变化，网页音频已关闭。' : '通话已结束，网页音频已关闭。');
    }
  }, [key, stop]);

  useEffect(() => {
    const onHide = () => {
      if (session.current) stop();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      if (session.current) stop();
    };
  }, [stop]);

  return {
    phase,
    note,
    muted,
    blocked,
    hasMic,
    active: phase !== 'off',
    possible: Boolean(key),
    start,
    stop,
    toggleMute,
    resume,
  };
}
