/**
 * TS 侧 token 入口。数值本身只在 styles/tokens.css 定义，这里只暴露「名字」：
 * - 能写 className 的地方用 toneClass（.tone-*），不要写内联 style
 * - 只有第三方组件必须收字符串颜色时（Semi Progress 的 stroke、SVG stroke/fill）才用 toneColor
 */

/** 语义色调：组件的 tone 属性统一用它，禁止直接传 'var(--...)' 或色值 */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'down' | 'up';

const TONE_VAR: Record<Tone, string> = {
  neutral: '--color-text-tertiary',
  accent: '--color-accent-text',
  success: '--color-success',
  warning: '--color-warning',
  danger: '--color-danger',
  down: '--color-series-down',
  up: '--color-series-up',
};

export const toneColor = (tone: Tone) => `var(${TONE_VAR[tone]})`;

export const toneClass = (tone?: Tone) => (tone ? `tone-${tone}` : undefined);

/** Semi Tag 的 color 取值与 Tone 的对应关系，状态标签统一走这里 */
export const TAG_COLOR = {
  neutral: 'grey',
  accent: 'blue',
  success: 'green',
  warning: 'orange',
  danger: 'red',
  down: 'blue',
  up: 'violet',
} as const satisfies Record<Tone, string>;

/** 制式分类标签：NR / LTE 各占一个固定色，与图表里的制式色一致 */
const RAT_TAG_COLOR: Record<string, 'blue' | 'indigo'> = { NR: 'blue', LTE: 'indigo' };

export const ratTagColor = (rat?: string) => (rat && RAT_TAG_COLOR[rat]) || TAG_COLOR.neutral;

/** 图表空值/缺测时的占位色 */
export const EMPTY_STROKE = 'var(--color-border-strong)';

/** 与 CSS 媒体查询保持一致的断点（max-width，含该值）；CSS 里只能用这些数 */
export const BREAKPOINTS = {
  lg: 1180,
  md: 960,
  sm: 767,
  xs: 520,
  xxs: 360,
} as const;

export const maxWidth = (bp: keyof typeof BREAKPOINTS) => `(max-width: ${BREAKPOINTS[bp]}px)`;
