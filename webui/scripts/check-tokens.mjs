#!/usr/bin/env node
// 设计 token 规范检查：业务样式与 RG620T 页面代码不得绕过 src/styles/tokens.css。
// 用法：npm run lint:tokens（有违规时退出码 1）。规则说明见 DESIGN.md「Do's and Don'ts」。
// 确需例外的行，在同一行写 /* token-exempt: 原因 */（CSS）或 // token-exempt: 原因（TSX）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (file) => path.relative(root, file);

// 只检查 RG620T 现行代码；src/pages/{network,sms,system,at}、src/components 等是未路由的 MT5700 遗留实现
const CSS_DIRS = ['src/styles'];
const CSS_SKIP = new Set(['src/styles/tokens.css']);
const TSX_TARGETS = ['src/pages/device', 'src/layout/DeviceLayout.tsx', 'src/ui/widgets.tsx', 'src/ui/charts.tsx', 'src/modules'];
const TSX_SKIP = new Set(['src/ui/tokens.ts']);

const BREAKPOINTS = new Set([1180, 960, 767, 520, 360]);

const walk = (target, exts) => {
  const abs = path.join(root, target);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [abs];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(abs, entry.name);
    if (entry.isDirectory()) return walk(path.relative(root, next), exts);
    return exts.some((ext) => entry.name.endsWith(ext)) ? [next] : [];
  });
};

const problems = [];
const report = (file, line, rule, text) => problems.push(`${rel(file)}:${line}  [${rule}]  ${text.trim()}`);

// ---------- CSS ----------
const PX_OUTSIDE_VAR = /(?<![\w-])-?\d*\.?\d+px\b/;
const CSS_RULES = [
  { rule: 'color-literal', test: (prop, value) => /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i.test(value) },
  { rule: 'font-size', test: (prop, value) => prop === 'font-size' && !/^var\(--font-size-/.test(value) && value !== 'inherit' },
  { rule: 'font-weight', test: (prop, value) => prop === 'font-weight' && /\d/.test(value) },
  { rule: 'line-height', test: (prop, value) => prop === 'line-height' && /\d/.test(value) && value !== '1' && !value.startsWith('var(') },
  { rule: 'letter-spacing', test: (prop, value) => prop === 'letter-spacing' && /\d/.test(value) && value !== '0' && !value.startsWith('var(') },
  {
    rule: 'spacing',
    test: (prop, value) =>
      /^(padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left)(-|$)/.test(prop) &&
      PX_OUTSIDE_VAR.test(value.replace(/\b1px\b/g, '')),
  },
  { rule: 'radius', test: (prop, value) => prop.startsWith('border-') && prop.endsWith('radius') && PX_OUTSIDE_VAR.test(value) },
  { rule: 'shadow', test: (prop, value) => prop === 'box-shadow' && PX_OUTSIDE_VAR.test(value) },
  { rule: 'duration', test: (prop, value) => /^(transition|animation)/.test(prop) && /(?<![\w-])\d*\.?\d+m?s\b/.test(value) },
  {
    rule: 'easing',
    test: (prop, value) =>
      /^(transition|animation)/.test(prop) && /cubic-bezier\(|(?<![\w-])(ease|ease-in|ease-out|ease-in-out|linear)(?![\w-])/.test(value),
  },
  { rule: 'z-index', test: (prop, value) => prop === 'z-index' && /^-?\d+$/.test(value) },
];

for (const file of CSS_DIRS.flatMap((dir) => walk(dir, ['.css']))) {
  if (CSS_SKIP.has(rel(file))) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inComment = false;
  lines.forEach((raw, index) => {
    let line = raw;
    if (inComment) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    if (/token-exempt:/.test(raw)) return;
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open !== -1) {
      inComment = true;
      line = line.slice(0, open);
    }

    const media = line.match(/@media[^{]*/);
    if (media) {
      for (const [, width] of media[0].matchAll(/(?:max|min)-width:\s*(\d+)px/g)) {
        if (!BREAKPOINTS.has(Number(width))) report(file, index + 1, 'breakpoint', raw);
      }
      return;
    }

    // 同一行可能是「选择器 { 声明; 声明; }」，按 { 和 ; 切开逐条检查
    for (const part of line.slice(line.lastIndexOf('{') + 1).split(';')) {
      const decl = part.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*}?\s*$/);
      if (!decl || decl[1].startsWith('--')) continue;
      const [, prop, value] = decl;
      for (const { rule, test } of CSS_RULES) {
        if (test(prop, value.replace(/!important/, '').trim())) report(file, index + 1, rule, raw);
      }
    }
  });
}

// ---------- TSX ----------
const TSX_RULES = [
  { rule: 'color-literal', re: /['"`]#[0-9a-fA-F]{3,8}['"`]|\b(rgba?|hsla?)\(/ },
  { rule: 'raw-css-var', re: /['"`]var\(--/ },
  {
    rule: 'inline-style',
    re: /style=\{\{[^}]*\b(margin\w*|padding\w*|color|background\w*|font\w*|gap|border\w*|textAlign|display)\s*:/,
  },
  // 状态标签走 TAG_COLOR[tone]，制式标签走 ratTagColor()，避免同一状态在不同页面换色
  { rule: 'tag-color', re: /<Tag\b[^>]*\bcolor="|color=\{[^}]*'(green|grey|red|orange|blue|indigo|violet|amber|yellow|cyan|teal|purple|pink|lime)'/ },
];

for (const file of TSX_TARGETS.flatMap((target) => walk(target, ['.ts', '.tsx']))) {
  if (TSX_SKIP.has(rel(file))) continue;
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (/token-exempt:/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      for (const { rule, re } of TSX_RULES) if (re.test(line)) report(file, index + 1, rule, line);
    });
}

// ---------- DESIGN.md 引用的 token 必须真实存在（防止改名后规范文档失效） ----------
const defined = new Set(
  [...fs.readFileSync(path.join(root, 'src/styles/tokens.css'), 'utf8').matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
);
const designFile = path.join(root, 'DESIGN.md');
fs.readFileSync(designFile, 'utf8')
  .split('\n')
  .forEach((line, index) => {
    const pattern = /`(--(?:color|font|line|letter|space|radius|shadow|duration|ease|z|control|layout|halo)-[a-z0-9-]+)`/g;
    for (const [, token] of line.matchAll(pattern)) {
      if (!defined.has(token)) report(designFile, index + 1, 'doc-token', `${token} 未在 tokens.css 定义`);
    }
  });

if (problems.length) {
  console.error(`设计 token 检查失败，共 ${problems.length} 处：\n`);
  console.error(problems.join('\n'));
  console.error('\n请改用 src/styles/tokens.css 中的 token（TSX 用 src/ui/tokens.ts 的 Tone / toneClass），规则见 DESIGN.md。');
  process.exit(1);
}
console.log('设计 token 检查通过');
