import React, { useId } from 'react';
import { EMPTY_STROKE, type Tone, toneClass, toneColor } from './tokens';

// 轻量 SVG 图表，零依赖，专为路由器端实时遥测优化。
// 支持双线型区分（实线/虚线）、平滑 Catmull-Rom 贝塞尔曲线与语义渐变。

export interface Series {
  label: string;
  values: number[];
  tone?: Tone;
  /** @deprecated 仅供未迁移的遗留页面；新代码用 tone */
  color?: string;
  /** 虚线序列：多条线并存时用线型区分，色弱用户也能分辨 */
  dashed?: boolean;
  /** 可选单独格式化（用于 RSRP dBm 与 SINR dB 同图展示） */
  format?: (value: number) => string;
}

interface SparklineProps {
  series: Series[];
  height?: number;
  /** Y 轴最小跨度，避免数值几乎不动时把噪声放大成剧烈波动 */
  minRange?: number;
  /** 固定 Y 轴范围，信号这类有物理量程的指标用得上 */
  domain?: [number, number];
  format?: (value: number) => string;
  empty?: string;
  /** 图上方已有大号数值时可关掉图例，避免同一数据出现两遍 */
  showLegend?: boolean;
  /** 不同量纲的序列（如 dBm 与 dB）各自按自身范围缩放，否则会被同一纵轴压平 */
  independentScale?: boolean;
  /** 撑满父容器高度，height 作为最小高度 */
  fill?: boolean;
  className?: string;
}

const VIEW_W = 100;
const VIEW_H = 48;

type Scale = { min: number; span: number };

function scaleOf(values: number[], minRange: number, domain?: [number, number]): Scale {
  let min = domain ? domain[0] : Math.min(...values);
  let max = domain ? domain[1] : Math.max(...values);
  if (max - min < minRange) {
    const mid = (max + min) / 2;
    min = mid - minRange / 2;
    max = mid + minRange / 2;
  }
  if (!domain) {
    const pad = (max - min) * 0.16;
    // 速率这类非负序列不让下界跌破 0；RSRP 这类负值序列不能硬夹到 0，否则量程翻转
    const nonNegative = Math.min(...values) >= 0;
    min = nonNegative ? Math.max(0, min - pad) : min - pad;
    max += pad;
  }
  return { min, span: max - min || 1 };
}

const yOf = (value: number, scale: Scale) => {
  const clamped = Math.max(scale.min, Math.min(scale.min + scale.span, value));
  return VIEW_H - ((clamped - scale.min) / scale.span) * (VIEW_H - 6) - 3;
};

const seriesColor = (s: Series) => (s.tone ? toneColor(s.tone) : s.color ?? toneColor('accent'));

/** 序列色通过 CSS 变量交给样式表，HTML 元素（图例、末点）不写内联颜色 */
const seriesVar = (s: Series) => ({ '--series-color': seriesColor(s) }) as React.CSSProperties;

function buildSmoothPath(points: Array<{ x: number; y: number }>, viewH: number, tension = 0.2): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;
  }

  let d = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp1y = Math.max(2, Math.min(viewH - 2, p1.y + (p2.y - p0.y) * tension));
    const cp2y = Math.max(2, Math.min(viewH - 2, p2.y - (p3.y - p1.y) * tension));

    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

export const Sparkline: React.FC<SparklineProps> = ({
  series,
  height = 100,
  minRange = 1,
  domain,
  format = (v) => v.toFixed(1),
  empty = '暂无数据',
  showLegend = true,
  independentScale = false,
  fill = false,
  className,
}) => {
  const gradientId = useId();
  const allValues = series.flatMap((s) => s.values);

  if (allValues.length === 0) {
    return (
      <div
        className={`chart-empty ${fill ? 'chart-empty--fill' : ''} ${className || ''}`}
        style={{ minHeight: height }}
      >
        <span>{empty}</span>
      </div>
    );
  }

  const shared = scaleOf(allValues, minRange, domain);
  const scales = series.map((s) =>
    independentScale && s.values.length ? scaleOf(s.values, minRange, domain) : shared,
  );

  const pointsOf = (values: number[], scale: Scale) =>
    values.map((v, idx) => ({
      x: values.length > 1 ? idx * (VIEW_W / (values.length - 1)) : VIEW_W,
      y: yOf(v, scale),
    }));

  const formatSeries = (s: Series, v: number) => (s.format ? s.format(v) : format(v));

  return (
    <div className={`sparkline ${fill ? 'sparkline--fill' : ''} ${className || ''}`}>
      {showLegend ? (
        <div className="sparkline-legend">
          {series.map((s) => (
            <span className="sparkline-legend-item" key={s.label}>
              <i
                className={
                  s.dashed
                    ? 'sparkline-legend-swatch sparkline-legend-swatch--dashed'
                    : 'sparkline-legend-swatch'
                }
                style={seriesVar(s)}
              />
              <span className="sparkline-legend-name">{s.label}</span>
              <b>{s.values.length ? formatSeries(s, s.values[s.values.length - 1]) : '—'}</b>
            </span>
          ))}
        </div>
      ) : null}

      <div className="sparkline-canvas" style={fill ? { minHeight: height } : { height }}>
        <svg
          className="sparkline-svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          style={fill ? undefined : { height }}
          role="img"
          aria-label={series
            .map((s) => `${s.label} ${s.values.length ? formatSeries(s, s.values[s.values.length - 1]) : ''}`)
            .join('，')}
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.label} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(s)} stopOpacity="0.16" />
                <stop offset="100%" stopColor={seriesColor(s)} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {[0.25, 0.5, 0.75].map((r) => (
            <line
              key={r}
              className="chart-grid-line"
              x1="0"
              x2={VIEW_W}
              y1={VIEW_H * r}
              y2={VIEW_H * r}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {series.map((s, i) => {
            if (s.values.length === 0) return null;
            const points = pointsOf(s.values, scales[i]);
            const curve = buildSmoothPath(points, VIEW_H);
            if (!curve) return null;
            return (
              <g key={s.label}>
                <path d={`${curve} L ${VIEW_W},${VIEW_H} L 0,${VIEW_H} Z`} fill={`url(#${gradientId}-${i})`} />
                <path
                  d={curve}
                  fill="none"
                  stroke={seriesColor(s)}
                  strokeWidth="1.9"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? '4 4' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>

        {series.map((s, i) => {
          if (s.values.length === 0) return null;
          const yPct = (yOf(s.values[s.values.length - 1], scales[i]) / VIEW_H) * 100;
          return (
            <span
              key={`dot-${s.label}`}
              className="sparkline-dot"
              style={{ ...seriesVar(s), top: `${yPct}%` }}
              aria-hidden="true"
            />
          );
        })}
      </div>
    </div>
  );
};

interface QualityBarProps {
  value: number | null;
  domain: [number, number];
  label: string;
  unit?: string;
  higherIsWorse?: boolean;
  /** 指标有业务分档时（如 SINR ≥13 dB 为优）传入，避免按量程比例算出与表格不一致的颜色 */
  tone?: Tone;
}

export const QualityBar: React.FC<QualityBarProps> = ({
  value,
  domain,
  label,
  unit = '',
  higherIsWorse = false,
  tone,
}) => {
  const [lo, hi] = domain;
  const ratio = value === null ? 0 : Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1)));
  const goodness = higherIsWorse ? 1 - ratio : ratio;
  const resolved: Tone =
    value === null ? 'neutral' : tone ?? (goodness >= 0.6 ? 'success' : goodness >= 0.35 ? 'warning' : 'danger');

  return (
    <div className="quality-bar">
      <div className="quality-bar-head">
        <span>{label}</span>
        <b>{value === null ? '—' : `${value}${unit}`}</b>
      </div>
      <div
        className="quality-bar-track"
        role="meter"
        aria-label={label}
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={value ?? undefined}
      >
        <div
          className={`quality-bar-fill ${toneClass(resolved)}`}
          style={{ width: value === null ? '0%' : `${Math.max(4, ratio * 100)}%` }}
        />
      </div>
    </div>
  );
};

interface RingGaugeProps {
  percent: number | null;
  label: string;
  size?: number;
  tone?: Tone;
  /** @deprecated 仅供未迁移的遗留页面；新代码用 tone */
  color?: string;
}

export const RingGauge: React.FC<RingGaugeProps> = ({ percent, label, size = 84, tone = 'success', color }) => {
  const strokeWidth = 6.5;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const p = percent === null ? 0 : Math.max(0, Math.min(100, percent));

  return (
    <div className="ring-gauge">
      <div className="ring-gauge-dial" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <circle className="ring-gauge-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={strokeWidth} />
          <circle
            className="ring-gauge-arc"
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={percent === null ? EMPTY_STROKE : color ?? toneColor(tone)}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${(circumference * p) / 100} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="ring-gauge-center">
          <b className="ring-gauge-value">{percent === null ? '—' : `${p}`}</b>
          {percent !== null ? <span className="ring-gauge-unit">%</span> : null}
        </div>
      </div>
      {label ? <span className="ring-gauge-label">{label}</span> : null}
    </div>
  );
};
