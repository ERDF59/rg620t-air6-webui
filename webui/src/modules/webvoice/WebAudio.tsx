import React, { useEffect } from 'react';
import { Button, Tag } from '@douyinfe/semi-ui';
import { IconLink, IconMicrophone, IconMicrophoneOff, IconVolume2 } from '@douyinfe/semi-icons';
import { TAG_COLOR, type Tone } from '@/ui/tokens';
import { unlockAudio } from './audio';
import { consumeVoiceIntent } from './intent';
import { useWebVoice, webVoiceSupport, type VoiceCall, type WebVoicePhase } from './useWebVoice';

const PHASE: Record<WebVoicePhase, { label: string; tone: Tone }> = {
  off: { label: '未连接', tone: 'neutral' },
  permission: { label: '等待麦克风授权', tone: 'warning' },
  linking: { label: '正在连接路由器', tone: 'warning' },
  media: { label: '等待双向音频', tone: 'warning' },
  live: { label: '音频已连接', tone: 'success' },
};

const httpsUrl = () => `https://${window.location.hostname}${window.location.pathname}#/network/voice`;

/** 通话控制卡里的"网页通话音频"区块：本机麦克风 → 对方，对方声音 → 本机扬声器 */
const WebAudio: React.FC<{ status: { calls?: Array<VoiceCall & { kind: number; voice?: boolean }> } }> = ({ status }) => {
  const calls = status.calls ?? [];
  const callCount = calls.length;
  const only = callCount === 1 ? calls[0] : null;
  const call = only && (only.kind === 0 || only.voice === true) ? only : null;
  const voice = useWebVoice(call);
  const support = webVoiceSupport();
  const insecureHttp = !support.secure && window.location.protocol === 'http:';
  const { phase, active, possible, start } = voice;

  // Each CLCC snapshot matters, including a second idle response after a
  // dial ACK. Depending on call identity alone would miss that readback.
  useEffect(() => {
    if (consumeVoiceIntent(call, callCount) && support.ok) void start();
  }, [status, call, callCount, support.ok, start]);

  let detail = voice.note;
  if (!detail) {
    if (insecureHttp) {
      detail = '拨号和接听仍可使用。网页音频需要受浏览器信任的 HTTPS 和麦克风权限。';
    } else if (!support.media) {
      detail = '此浏览器不支持网页通话（缺少麦克风或 WebRTC 接口）。';
    } else if (voice.blocked) {
      detail = '浏览器拦截了自动播放，点「播放通话声音」打开听筒。';
    } else if (phase === 'live') {
      detail = voice.muted ? '麦克风已静音，对方听不到你。断开音频不会挂断电话。' : '对方的声音从本机播放。断开音频不会挂断电话。';
    } else if (active) {
      detail = '连接只用于当前这通电话。';
    } else if (!possible) {
      detail = '电话接通后可以用本机的麦克风和扬声器通话；在本页或来电通知里接听会自动连接。';
    } else {
      detail = '启用后，麦克风的声音会发送给通话对方。';
    }
  }

  const meta = PHASE[phase];
  const label = phase === 'live' && voice.muted ? '音频已连接 · 静音' : meta.label;

  return (
    <section className={`voice-audio is-${phase}`} data-phase={phase} aria-label="网页通话音频">
      <div className="voice-audio-head">
        <span className="voice-audio-title">
          <IconVolume2 size="small" aria-hidden />
          网页通话音频
        </span>
        <Tag size="small" color={TAG_COLOR[meta.tone]}>
          {label}
        </Tag>
      </div>
      <p className="voice-audio-note" role="status">
        {detail}
      </p>
      <div className="action-row voice-audio-actions">
        {insecureHttp ? (
          <Button icon={<IconLink />} onClick={() => window.location.assign(httpsUrl())}>
            打开 HTTPS 电话页
          </Button>
        ) : null}
        {support.ok && !active ? (
          <Button theme="solid" type="primary" icon={<IconMicrophone />} disabled={!possible}
            onClick={() => { unlockAudio(); void start(); }}>
            启用麦克风和扬声器
          </Button>
        ) : null}
        {active && voice.blocked ? (
          <Button theme="solid" type="warning" icon={<IconVolume2 />} onClick={() => void voice.resume()}>
            播放通话声音
          </Button>
        ) : null}
        {active && voice.hasMic ? (
          <Button
            icon={voice.muted ? <IconMicrophoneOff /> : <IconMicrophone />}
            aria-pressed={voice.muted}
            onClick={voice.toggleMute}
          >
            {voice.muted ? '取消静音' : '静音麦克风'}
          </Button>
        ) : null}
        {active ? (
          <Button type="danger" theme="light" onClick={() => voice.stop('已断开网页音频，电话仍由 SIM 保持。')}>
            断开音频
          </Button>
        ) : null}
      </div>
    </section>
  );
};

export default WebAudio;
