import React, { useCallback, useEffect, useState } from 'react';
import { Button, Space, Table, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { IconClock, IconGlobeStroke, IconLink, IconRefresh } from '@douyinfe/semi-icons';
import { Kv, Metric, PageCard, TwoCol } from '@/ui/widgets';
import { ubus } from '@/services/deviceUbus';
import { TAG_COLOR } from '@/ui/tokens';

type Address4 = { address: string; mask?: number };
type Address6 = { address: string; mask?: number };

type Iface = {
  interface: string;
  up: boolean;
  pending?: boolean;
  proto?: string;
  device?: string;
  uptime?: number;
  l3_device?: string;
  'ipv4-address'?: Address4[];
  'ipv6-address'?: Address6[];
  'dns-server'?: string[];
  route?: Array<{ target: string; mask?: number; gateway?: string; nexthop?: string }>;
};

const duration = (seconds?: number) => {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
};

const INTERESTING = ['wan', 'modem', 'ccmni', 'lan', 'wwan'];

const Dial: React.FC = () => {
  const [rows, setRows] = useState<Iface[]>([]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ubus<{ interface?: Iface[] }>('network.interface', 'dump');
      setRows(data.interface || []);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '读取接口失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cellular =
    rows.find((row) => /ccmni|wwan|usb|modem/i.test(`${row.interface} ${row.device || ''}`)) ||
    rows.find((row) => row.proto === 'ql_datacall') ||
    rows.find((row) => row.interface === 'wan');
  const lan = rows.find((row) => row.interface === 'lan');
  const shown = rows.filter(
    (row) =>
      row.interface === 'loopback' ||
      INTERESTING.some((key) => `${row.interface} ${row.device || ''}`.toLowerCase().includes(key)),
  );

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <span className="toolbar-pill">
            <IconGlobeStroke size="small" />
            蜂窝承载 · {cellular?.proto || 'ql_datacall'}
          </span>
        </div>
        <div className="page-toolbar-right">
          <Button size="small" icon={<IconRefresh />} loading={loading} onClick={() => load()}>
            刷新
          </Button>
          <Button
            size="small"
            type="danger"
            theme="solid"
            loading={busy === 'redial'}
            onClick={async () => {
              setBusy('redial');
              try {
                await ubus('dlink-cellular', 'wan_redial', { confirm: true });
                Toast.success('已触发重新拨号');
                await new Promise((resolve) => setTimeout(resolve, 3000));
                await load();
              } catch (error) {
                Toast.error(error instanceof Error ? error.message : '拨号失败');
              } finally {
                setBusy('');
              }
            }}
          >
            重新拨号
          </Button>
        </div>
      </div>

      <div className="kpi-strip">
        <Metric
          tile
          size="md"
          icon={<IconLink size="small" />}
          label="蜂窝承载"
          value={cellular?.up ? '已连接' : '已断开'}
          tone={cellular?.up ? 'success' : 'danger'}
          badge={
            <Tag size="small" color={TAG_COLOR[cellular?.up ? 'success' : 'danger']}>
              {cellular?.up ? 'UP' : 'DOWN'}
            </Tag>
          }
          hint={cellular?.interface ? `逻辑接口 ${cellular.interface}` : '未检测到蜂窝接口'}
          className="kpi-card"
        />
        <Metric
          tile
          size="md"
          icon={<IconClock size="small" />}
          label="在线时长"
          value={duration(cellular?.uptime)}
          hint="自本次拨号建立起"
          className="kpi-card"
        />
        <Metric
          tile
          size="md"
          label="物理设备"
          value={cellular?.device || cellular?.l3_device || '—'}
          hint="底层数据通道设备"
          className="kpi-card"
        />
        <Metric
          tile
          size="md"
          label="拨号协议"
          value={cellular?.proto || '—'}
          hint="重拨不影响局域网连接"
          className="kpi-card"
        />
      </div>

      <TwoCol>
        <PageCard
          title="蜂窝地址 (WAN)"
          hint="运营商分配的公网 / 内网地址与路由"
          extra={
            cellular ? (
              <Tag size="small" color={TAG_COLOR[cellular.up ? 'success' : 'danger']}>
                {cellular.interface}
              </Tag>
            ) : null
          }
        >
          {cellular ? (
            <Kv
              layout="rows"
              items={[
                { label: '逻辑接口', value: cellular.interface },
                { label: 'IPv4 地址', value: cellular['ipv4-address']?.map((i) => i.address).join(', ') || '—' },
                { label: 'IPv6 地址', value: cellular['ipv6-address']?.map((i) => i.address).join(', ') || '—' },
                { label: 'DNS 服务器', value: cellular['dns-server']?.join(', ') || '—' },
                { label: '默认网关', value: cellular.route?.find((r) => r.target === '0.0.0.0')?.nexthop || '—' },
              ]}
            />
          ) : (
            <div className="empty-inline">
              <Typography.Text type="tertiary">没有读到蜂窝接口</Typography.Text>
            </div>
          )}
        </PageCard>

        <PageCard
          title="局域网 (LAN)"
          hint="本地桥接接口与管理网段"
          extra={
            lan ? (
              <Tag size="small" color={TAG_COLOR.accent}>
                {lan.interface}
              </Tag>
            ) : null
          }
        >
          {lan ? (
            <Kv
              layout="rows"
              items={[
                { label: '逻辑接口', value: lan.interface },
                { label: 'IPv4 地址', value: lan['ipv4-address']?.map((i) => i.address).join(', ') || '—' },
                { label: '网桥设备', value: lan.device || '—' },
                { label: 'DNS 服务器', value: lan['dns-server']?.join(', ') || '—' },
              ]}
            />
          ) : (
            <div className="empty-inline">
              <Typography.Text type="tertiary">没有读到 LAN 接口</Typography.Text>
            </div>
          )}
        </PageCard>
      </TwoCol>

      <PageCard
        title="全部网络接口"
        hint="来自 ubus network.interface 实时状态"
        extra={<Space spacing={6}><Tag color={TAG_COLOR.neutral}>{shown.length} 个接口</Tag></Space>}
        bodyClassName="table-flush"
      >
        <Table
          pagination={false}
          size="small"
          rowKey="interface"
          dataSource={shown}
          columns={[
            {
              title: '接口',
              dataIndex: 'interface',
              render: (value: string) => <span className="mono table-primary-cell">{value}</span>,
            },
            {
              title: '状态',
              dataIndex: 'up',
              width: 96,
              render: (value: boolean) => (
                <Tag size="small" color={TAG_COLOR[value ? 'success' : 'danger']}>
                  {value ? '已连接' : '已断开'}
                </Tag>
              ),
            },
            { title: '协议', dataIndex: 'proto', width: 120 },
            {
              title: '设备',
              dataIndex: 'device',
              width: 120,
              render: (value?: string) => <span className="mono">{value || '—'}</span>,
            },
            {
              title: 'IPv4',
              render: (_: unknown, row: Iface) => (
                <span className="mono">{row['ipv4-address']?.map((i) => i.address).join(', ') || '—'}</span>
              ),
            },
            {
              title: '在线时长',
              dataIndex: 'uptime',
              width: 140,
              render: (value?: number) => duration(value),
            },
          ]}
        />
      </PageCard>

      <div className="callout-note">
        重拨会断开当前蜂窝承载并重新激活 PDP，过程中局域网不会中断。若连续失败，请检查 APN 配置与基站信号质量。
      </div>
    </div>
  );
};

export default Dial;
