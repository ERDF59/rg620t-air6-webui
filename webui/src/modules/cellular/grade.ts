/** 蜂窝信号分档：数值 → 语义色调 / 文案。所有页面共用，保证同一数值处处同色。 */
import { SIGNAL_RSRP_RANGE } from '@/modem/parse';
import type { Tone } from '@/ui/tokens';

/** RSRP 按量程线性映射为 0-100 分 */
export const rsrpPercent = (rsrp?: number | null) => {
  if (rsrp == null) return null;
  const [lo, hi] = SIGNAL_RSRP_RANGE;
  return Math.round(Math.max(0, Math.min(1, (rsrp - lo) / (hi - lo))) * 100);
};

/** 信号评分分档：≥60 好 / ≥35 中 / 其余差 */
export const scoreTone = (percent: number | null): Tone => {
  if (percent == null) return 'neutral';
  return percent >= 60 ? 'success' : percent >= 35 ? 'warning' : 'danger';
};

export const scoreLabel = (percent: number | null) => {
  if (percent == null) return '暂无测量';
  if (percent >= 75) return '信号优秀';
  if (percent >= 60) return '信号良好';
  if (percent >= 35) return '信号一般';
  return '信号较差';
};

/** RSRQ（dB，越接近 0 越好）：≥-10 优 / ≥-15 良 / 其余差 */
export const rsrqTone = (rsrq?: number | null): Tone => {
  if (rsrq == null) return 'neutral';
  return rsrq >= -10 ? 'success' : rsrq >= -15 ? 'warning' : 'danger';
};

/** SINR（dB）：≥13 优 / ≥0 良 / 其余差 */
export const sinrTone = (sinr?: number | null): Tone => {
  if (sinr == null) return 'neutral';
  return sinr >= 13 ? 'success' : sinr >= 0 ? 'warning' : 'danger';
};