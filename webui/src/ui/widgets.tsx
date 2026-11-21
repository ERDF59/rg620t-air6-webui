import React from 'react';
import {
  Banner,
  Button,
  Card,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { type Tone, toneClass } from './tokens';

const joinClassNames = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(' ');

export const PageCard: React.FC<{
  title: React.ReactNode;
  extra?: React.ReactNode;
  hint?: string;
  variant?: 'default' | 'hero' | 'group';
  bodyClassName?: string;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, extra, hint, variant = 'default', bodyClassName, footer, children }) => (
  <Card
    className={joinClassNames('page-card', variant !== 'default' && `page-card--${variant}`)}
    title={
      <div className="page-card-title">
        <span className="page-card-title-text">{title}</span>
        {hint ? <span className="page-card-hint">{hint}</span> : null}
      </div>
    }
    headerExtraContent={extra}
  >
    {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
    {footer ? <div className="page-card-footer">{footer}</div> : null}
  </Card>
);

export const Panel: React.FC<{
  title?: React.ReactNode;
  extra?: React.ReactNode;
  accent?: boolean;
  className?: string;
  children?: React.ReactNode;
}> = ({ title, extra, accent, className, children }) => (
  <div className={joinClassNames('panel', accent && 'panel--accent', className)}>
    {title ? (
      <div className="panel-head">
        <span className="panel-head-title">{title}</span>
        {extra ? <span className="panel-head-extra">{extra}</span> : null}
      </div>
    ) : null}
    {children}
  </div>
);

export const SectionHeader: React.FC<{
  title: React.ReactNode;
  desc?: React.ReactNode;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  id?: string;
}> = ({ title, desc, icon, extra, id }) => (
  <div className="section-header" id={id}>
    <div className="section-header-main">
      {icon ? <span className="section-header-icon">{icon}</span> : null}
      <div className="section-header-copy">
        <h2 className="section-header-title">{title}</h2>
        {desc ? <p className="section-header-desc">{desc}</p> : null}
      </div>
    </div>
    {extra ? <div className="section-header-extra">{extra}</div> : null}
  </div>
);

export const Metric: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  unit?: string;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  /** 数值的语义色调；不传为默认正文色 */
  tone?: Tone;
  /** @deprecated 仅供未迁移的遗留页面；新代码用 tone */
  color?: string;
  size?: 'lg' | 'md' | 'sm';
  align?: 'left' | 'center';
  tile?: boolean;
  className?: string;
}> = ({ label, value, hint, unit, badge, icon, tone, color, size = 'md', align = 'left', tile, className }) => (
  <div
    className={joinClassNames(
      'metric',
      size !== 'md' && `metric--${size}`,
      align === 'center' && 'metric--center',
      tile && 'metric-tile',
      className,
    )}
  >
    <div className="metric-head">
      <span className="metric-label">
        {icon ? <span className="metric-icon">{icon}</span> : null}
        {label}
      </span>
      {badge ? <span className="metric-badge">{badge}</span> : null}
    </div>
    <div className="metric-value-row">
      <span className={joinClassNames('metric-value', toneClass(tone))} style={color ? { color } : undefined}>
        {value ?? '—'}
      </span>
      {unit ? <span className="metric-unit">{unit}</span> : null}
    </div>
    {hint ? <div className="metric-hint">{hint}</div> : null}
  </div>
);

export const Kv: React.FC<{
  items: Array<{ label: string; value: React.ReactNode }>;
  columns?: 1 | 2 | 3 | 4;
  dense?: boolean;
  /** rows：标签左、值右的一行一项，适合长值（地址、版本号） */
  layout?: 'grid' | 'rows';
}> = ({ items, columns = 2, dense, layout = 'grid' }) => (
  <div
    className={joinClassNames(
      layout === 'rows' ? 'kv-rows' : 'kv-grid',
      layout !== 'rows' && columns !== 2 && `kv-grid--${columns}`,
      dense && 'kv-grid--dense',
    )}
  >
    {items.map((item) => (
      <div className="kv-item" key={item.label}>
        <div className="kv-label">{item.label}</div>
        <div className="kv-value">{item.value ?? '—'}</div>
      </div>
    ))}
  </div>
);

export const AutoRefresh: React.FC<{
  enabled: boolean;
  interval: number;
  onChange: (enabled: boolean, interval: number) => void;
}> = ({ enabled, interval, onChange }) => (
  <div className="auto-refresh">
    <Switch size="small" checked={enabled} onChange={(value) => onChange(value, interval)} />
    <span className="auto-refresh-label">自动刷新</span>
    {enabled ? (
      <div className="auto-refresh-input">
        <InputNumber
          size="small"
          min={1}
          max={60}
          value={interval}
          onChange={(value) => onChange(true, Number(value) || 5)}
          style={{ width: 64 }}
        />
        <span className="auto-refresh-unit">秒</span>
      </div>
    ) : null}
  </div>
);

export const RefreshBtn: React.FC<{ onClick: () => void; loading?: boolean; label?: string }> = ({
  onClick,
  loading,
  label = '刷新',
}) => (
  <Button icon={<IconRefresh />} onClick={onClick} loading={loading} size="small">
    {label}
  </Button>
);

export const TwoCol: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => <div className={joinClassNames('two-col', className)}>{children}</div>;

export const Field: React.FC<{
  label: string;
  extra?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ label, extra, hint, className, children }) => (
  <div className={joinClassNames('field', className)}>
    <div className="field-label">
      <span>{label}</span>
      {extra}
    </div>
    {children}
    {hint ? <div className="field-hint">{hint}</div> : null}
  </div>
);

export const ConfigSelect: React.FC<{
  label: string;
  current: React.ReactNode;
  currentColor?: string;
  value?: string | number;
  onChange: (value: any) => void;
  options: Array<{ label: React.ReactNode; value: string | number; disabled?: boolean }>;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  hint?: React.ReactNode;
  warning?: React.ReactNode;
}> = ({
  label,
  current,
  currentColor = 'blue',
  value,
  onChange,
  options,
  placeholder,
  loading,
  disabled,
  hint,
  warning,
}) => (
  <div className="config-select">
    <div className="config-select-current">
      <span className="config-select-current-label">当前状态</span>
      <Tag color={currentColor as any}>{current ?? '未知'}</Tag>
    </div>
    <Field label={label} hint={hint}>
      <Select
        value={value}
        optionList={options as any}
        placeholder={placeholder}
        loading={loading}
        disabled={disabled}
        onChange={onChange}
      />
    </Field>
    {warning ? <Banner type="warning" closeIcon={null} description={warning} /> : null}
  </div>
);
