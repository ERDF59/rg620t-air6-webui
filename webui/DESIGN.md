---
name: RG620T 控制台
description: 5G CPE 本机管理界面的设计与前端规范（后续开发一律遵循）
---

# Design System: RG620T 控制台

> **唯一数值来源是 `src/styles/tokens.css`**。本文只规定「用哪个 token、在哪用、为什么」，不重复数值（字号与间距阶梯除外，方便换算）。两者冲突时以 `tokens.css` 为准，并回头修正本文。
> 提交前必须通过：`npm run typecheck && npm run lint:tokens && npm run build`。

## Overview

**Creative North Star: "清晰的仪表盘（The Calm Cockpit）"**

这是运维型界面（Operate 模式）：用户来看「网络好不好、为什么、具体参数是多少」，然后做锁频、重拨、收发短信这类操作。设计服务于扫读与判断，不做装饰性表达。品牌感只体现在克制的蓝色强调、统一的圆角与精确的数字排版上。

每个页面都按三层信息密度组织：
1. **状态层**：顶部 KPI 条（`kpi-strip`，最多 4 张），大号数值回答「现在好不好」。
2. **解释层**：卡片里的图表、仪表、分档条，回答「为什么」。
3. **参数层**：键值网格（`Kv`）与表格，回答「具体是多少」。

**Key Characteristics:**
- 冷灰背景 + 白色卡片，卡片之间靠留白与 1px 边框分层，不靠重阴影。
- 一个强调色（蓝）：只用于主操作、当前选中、链接与焦点。
- 状态色（绿/橙/红）只表达好坏，同一数值在所有页面同色（分档逻辑集中在 `modules/cellular/grade.ts`）。
- 数字一律等宽数字（`font-variant-numeric: tabular-nums`），实时刷新时不跳动。
- 明暗双主题，暗色只覆盖颜色与阴影 token，布局与尺寸不变。

## Colors

全部为**语义 token**，按用途命名；暗色主题在 `body[theme-mode="dark"]` 中覆盖同名 token，组件代码无需感知主题。

### Primary
- **强调蓝**（`--color-accent` / `-hover` / `-active`）：实底主按钮、当前导航项底色来源、焦点相关。实底上的文字用 `--color-text-on-solid`，两种主题对比度均 ≥ 4.5:1。
- **强调文字**（`--color-accent-text`）：浅底上的蓝色文字（选中导航、选中芯片、频段号）。
- **强调浅底**（`--color-accent-tint` / `--color-accent-tint-strong`）：选中态、主小区行、图标底座；`-strong` 用于其 hover。
- **强调描边**（`--color-accent-border` / `--color-accent-border-soft`）：选中芯片边框 / 待提交芯片边框。
- **焦点环**（`--color-focus-ring`）：所有 `:focus-visible` 轮廓。

### Neutral
- **页面底**（`--color-bg`）→ **卡片**（`--color-surface`）→ **卡内浅底**（`--color-surface-subtle`，图表区、状态盒、表头）→ **凹槽/轨道**（`--color-surface-muted`，进度条轨道、分段控件底、计数胶囊）。只允许按这个顺序向内叠，不要反向。
- **边框**（`--color-border`）用于卡片与分隔线；**强边框**（`--color-border-strong`）用于 hover 与虚线空态。
- **文字三级**：`--color-text-primary`（标题、数值）、`--color-text-secondary`（正文、控件文字）、`--color-text-tertiary`（标签、说明、时间）。三级对各自表面均 ≥ 4.5:1，**不要再造更浅的灰**。
- **悬停填充**（`--color-fill-hover`）、**遮罩**（`--color-overlay`）。

### 状态与数据
- **状态**：`--color-success` / `--color-warning` / `--color-danger` / `--color-info`，可直接用作文字色。危险实底按钮专用 `--color-danger-solid`（不随暗色提亮，保证白字可读）。
- **数据序列**：下行 `--color-series-down`（蓝）、上行 `--color-series-up`（紫），图表两条线还必须用实线/虚线区分。
- **制式**：`--color-rat-nr`、`--color-rat-lte`。
- 浅色底徽标统一写法：`color-mix(in srgb, var(--color-success) 9%, var(--color-surface))` 做底、`24%` 混边框色做描边。

### Named Rules
**The One Accent Rule.** 蓝色只给「可操作」与「当前选中」。装饰、分类、数据序列都不许借用 `--color-accent`。

**The Same Value Same Color Rule.** 状态色由分档函数（`scoreTone` / `sinrTone` / `rsrqTone` 等）决定，页面里不许手写阈值或颜色。

## Typography

**字体：** 系统无衬线栈 `--font-family-sans`（PingFang SC / 微软雅黑 / Segoe UI），只在代码与 AT 原文处用 `--font-family-mono`。数字靠 `tabular-nums` 对齐，**不要用等宽字体装饰「技术感」**。

### Hierarchy（字号 token → 用途）
| token | 数值 | 用途 |
|---|---|---|
| `--font-size-2xs` | 11px | 计数胶囊、主小区标记、拨号键字母 |
| `--font-size-xs` | 12px | 标签、提示、表头、时间、卡片副标题 |
| `--font-size-sm` | 13px | 次要正文、控件文字、徽标、表格单元格 |
| `--font-size-md` | 14px | 正文、键值的值、导航项 |
| `--font-size-lg` | 16px | 卡片标题、区块标题 |
| `--font-size-xl` | 18px | 顶栏页面标题、信号结论 |
| `--font-size-2xl` | 20px | 次级数值（窄屏、号码、频段码） |
| `--font-size-3xl` | 24px | 仪表盘中心数值、窄屏 KPI |
| `--font-size-4xl` | 28px | KPI 主数值 |
| `--font-size-5xl` | 32px | 特大数值（`Metric size="lg"`） |

- 字重只用四档：`regular` 正文、`medium` 标签与导航、`semibold` 标题与数值、`bold` 仪表中心数与徽章。
- 行高：`tight` 大数值、`snug` 标题与键值、`normal` 正文（默认）、`relaxed` 说明段落。
- 字距：`--letter-spacing-tight` 大数值、`snug` 标题、`wide` 小号大写/英文徽标、`wider` 拨号键字母。

### Named Rules
**The No Eyebrow Rule.** 标题上方不放小字「眉标」。标题自己承担层级，补充信息放标题下方的 hint。

## Layout

- **框架**：左侧导航 `--layout-sider-w` + 吸顶顶栏 `--layout-header-h` + 内容区（内边距 `--layout-content-pad`）。设备控制台上限用 `--layout-content-wide`，顶栏和内容区对齐；旧控制台仍用 `--layout-content-max`。窄屏（≤767px）侧栏变抽屉，布局 token 自动收紧。
- **间距阶梯**（4px 基准）：`--space-0-5` 2 · `--space-1` 4 · `--space-1-5` 6 · `--space-2` 8 · `--space-2-5` 10 · `--space-3` 12 · `--space-3-5` 14 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-8` 32。
- **节奏**：页面区块之间 20px（`page-stack`）；区块标题与内容 12px（`page-section`）；卡片之间 `--layout-gap`；卡片内边距 `--layout-card-pad`；卡内分组之间用 `card-divider`。组内紧、组间松，标题上方留白大于下方。
- **栅格**：KPI 条 4 列 → ≤960px 2 列 → ≤360px 1 列；主区 `bento-primary`（1.6fr : 1fr）与 `two-col` 在 ≤1180px / ≤960px 变单列。
- **宽屏锁频**：按实际内容区宽度并排显示频段和候选小区，而不是放大文字。窄屏保持从上到下；候选列表保留固定可滚动区域。
- **窄屏短信**：先显示会话列表，进入对话后单独显示消息与回复框，并保留返回入口。消息区自己滚动；回复框用 `--font-size-lg`，桌面继续并排显示列表和对话。
- **断点只允许**：1180 / 960 / 767 / 520 / 360（`max-width`，含该值）。TS 侧用 `maxWidth('sm')`（`src/ui/tokens.ts`），CSS 侧由 lint 校验。

## Elevation & Depth

以**色阶分层 + 1px 边框**为主，阴影极轻。每个元素只声明一种高度：
- `--shadow-card`：卡片、KPI、载波卡（配合 1px 边框，几乎不可见，只是去掉「贴纸感」）。
- `--shadow-control`：分段控件选中块这类小控件抬起。
- `--shadow-raised`：弹窗、浮层、确认条（不再叠加边框阴影）。
- `--shadow-drawer`：移动端抽屉。
- 状态点光晕：`box-shadow: 0 0 0 var(--halo-sm) color-mix(...)`。

### Named Rules
**The Flat Card Rule.** 卡片不加大面积柔光阴影；需要更强层级时换更深的表面 token，而不是加阴影。

## Shapes

- 圆角阶梯：`--radius-xs` 4（小标记）· `--radius-sm` 6（制式胶囊、Tag、图标底座）· `--radius-md` 8（按钮、输入框、导航项、芯片）· `--radius-lg` 10（卡内小面板、图表区、状态盒）· `--radius-xl` 14（卡片、KPI、会话面板）· `--radius-2xl` 16（弹窗、登录卡）· `--radius-full`（胶囊、圆点）。
- 嵌套圆角满足「外圆角 = 内圆角 + 内边距」，例如分段控件 8 = 6 + 2。
- 控件高度：`--control-h-xs` 26（只读芯片、待提交芯片）· `--control-h-sm` 30（工具栏胶囊、状态徽标、频段芯片）· `--control-h-md` 32（与 Semi 默认输入框同高）。

## Components

优先复用 `src/ui/widgets.tsx` 与 `src/ui/charts.tsx`，其次复用 Semi 组件；只有两者都不满足时才写新组件。

### 页面骨架
- **工具栏** `page-toolbar`：左侧放 `live-badge` / `toolbar-pill`（上下文信息），右侧放 `AutoRefresh` 与刷新等操作。
- **KPI 条** `kpi-strip` + `<Metric tile className="kpi-card">`：每页最多 4 张；`label` 一行内放得下（窄屏 2 列时约 6 个汉字 + 徽标）。
- **区块** `<section className="page-section">` + `<SectionHeader title desc icon? extra? />`。
- **双栏** `<TwoCol>`；主次双栏用 `bento-primary`。

### 卡片 `PageCard`
- 白底、1px 边框、`--radius-xl`、`--shadow-card`，标题 `lg` + 副标题 `hint`（xs、三级文字）。
- 底部操作统一放 `footer` 属性（浅底条、右对齐），不要在卡片正文末尾自己拼按钮行。
- 卡内凹面板：图表放 `chart-surface`，状态盒放 `status-box` 一类 `--color-surface-subtle` 面板；**不允许卡片套卡片**。

### 数值 `Metric`
- `tone` 决定数值颜色（`success / warning / danger / down / up / accent / neutral`），不传为主文字色。
- `unit` 单独传，保持小一号、三级文字；`badge` 放状态 Tag；`hint` 放一行补充（会省略号截断，最重要的信息放前面）。

### 键值 `Kv`
- `layout="grid"`（默认，2–4 列）用于短值参数；`layout="rows"` 用于长值（地址、版本号），标签左、值右，行间细分隔线。

### 图表
- `Sparkline`：序列用 `tone`；两条线同图必须 `dashed` 区分；量纲不同（dBm 与 dB）必须 `independentScale`；需要撑满卡片高度时用 `fill`。
- `QualityBar` / `RingGauge`：颜色用 `tone`，由分档函数给出，不让组件按量程比例自行猜。

### 标签 Tag
- 状态：`color={TAG_COLOR[tone]}`；制式：`color={ratTagColor(rat)}`；中性信息：`TAG_COLOR.neutral`。禁止直接写 `'green'` 等色名。

### 表单与选择
- 频段/候选多选用 `band-chip`（30px，选中为强调浅底 + 强调描边）；二选一用 `segmented-control`；字段用 `<Field label hint>`。
- 危险操作（解锁、重拨、删除、挂断）用 `type="danger"`；需要二次确认的用 `Modal.confirm` 或页面内确认条，并写清后果。

### 空态与提示
- 列表空态 `empty-inline`，网格空态 `empty-surface`（虚线框）；文案说明「为什么空 + 下一步做什么」。
- 卡内横幅 `<Banner className="card-banner">`；补充说明行 `className="hint-line"`；页面级说明 `callout-note`。

## Do's and Don'ts

### Do:
- **Do** 所有颜色、字号、字重、行高、字距、间距、圆角、阴影、时长、缓动、层级都写 `var(--token)`。
- **Do** 在 TSX 里用 `tone` 属性 / `toneClass()` 表达颜色；只有第三方组件必须收颜色字符串时（Semi `Progress` 的 `stroke`、SVG 属性）才用 `toneColor()`。
- **Do** 信号/占用等阈值写进分档函数（蜂窝类放 `modules/cellular/grade.ts`），页面只调用。
- **Do** 数字加 `tabular-nums`；单位与数值分开排版。
- **Do** 每个交互元素具备 hover / focus-visible / disabled / loading 状态；动效只表达状态变化，时长用 `--duration-fast`（150ms）为主。
- **Do** 新增 token 时：语义命名 → 颜色类同时写明暗两套 → 检查对比度 → 更新本文对应小节。

### Don't:
- **Don't** 写裸色值（`#xxx`、`rgb()`）、裸 px 字号/间距/圆角、裸毫秒——`npm run lint:tokens` 会拦截。
- **Don't** 在 TSX 用 `style={{}}` 设置颜色、间距、字体、边框、对齐；只允许由数据决定的尺寸（宽高、位置百分比）。
- **Don't** 给圆角盒子加单侧色条（`border-left` 色块、inset 阴影竖条）表示选中/强调；用整体浅底、完整边框或前置图标。
- **Don't** 给卡片同时加 1px 边框和大面积柔光阴影；不要用渐变文字、装饰性毛玻璃。
- **Don't** 在标题上方放眉标小字；不要给区块编号（01/02/03）。
- **Don't** 新增断点或「差不多」的字号/间距；先在现有阶梯里选，确实不够再按上面的流程加 token。

## 工程约定

### 样式文件
| 文件 | 内容 |
|---|---|
| `src/styles/tokens.css` | 只放 token 与 Semi 桥接，唯一出现数值的地方 |
| `src/styles/base.css` | 重置、全局排版、焦点、Semi 组件统一修饰、减弱动效 |
| `src/styles/layout.css` | 应用框架与页面骨架 |
| `src/styles/components.css` | 跨页面复用的组件样式 |
| `src/styles/pages/<页面>.css` | 单页专属样式，类名以页面前缀开头（`voice-*`、`sms-*`） |
| `src/styles/utilities.css` | `.tone-*` 等工具类，最后加载 |
| `src/styles/index.css` | 按上述顺序 `@import`，新页面样式加在 `utilities.css` 之前 |

- 媒体查询写在所属文件末尾，不要再建「响应式大杂烩」。
- 类名：kebab-case，`块-元素`，修饰用 `--`（`kpi-card--up`），状态用 `.is-*`（`is-active`、`is-serving`）。
- 同一样式被第三个页面用到时，从 `pages/*.css` 提到 `components.css`。

### 例外
确需绕过规则的行，在同一行注明原因：CSS 写 `/* token-exempt: 原因 */`，TSX 写 `// token-exempt: 原因`。例外要少且可解释（目前仅「减弱动效」一处）。

### 检查范围
`lint:tokens` 覆盖 `src/styles`、`src/pages/device`、`src/layout/DeviceLayout.tsx`、`src/ui/widgets.tsx`、`src/ui/charts.tsx`、`src/modules`。`src/pages/{network,sms,system,at}`、`src/components` 等是未路由的 MT5700 遗留实现，不在规范范围；`Metric` / `RingGauge` / `Sparkline` 上的 `color` 属性仅为它们保留，新代码不得使用。
