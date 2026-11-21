import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Progress, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
  IconLayers,
  IconLock,
  IconRefresh,
  IconSignal,
} from '@douyinfe/semi-icons';
import { AutoRefresh, Kv, Metric, PageCard, SectionHeader, TwoCol } from '@/ui/widgets';
import { QualityBar, RingGauge, Sparkline } from '@/ui/charts';
import { SIGNAL_RSRP_RANGE } from '@/modem/parse';
import { ubus } from '@/services/deviceUbus';
import { TAG_COLOR, toneClass, toneColor, ratTagColor } from '@/ui/tokens';
import { type Cell, isServingCell } from '@/modules/cellular/types';
import { rsrpPercent, rsrqTone, scoreLabel, scoreTone, sinrTone } from '@/modules/cellular/grade';
import { useCellularStream } from '@/modules/cellular/stream';
import LockCellModal from '@/modules/cellular/LockCellModal';

// 后端 sinr10 已统一为 0.1 dB（NR 的 dB 值在 dlink-cell.c 里已乘 10），此处一律 /10 还原为 dB。
type Signal = { rsrp?: number; rsrq?: number; sinr10?: number; rssi?: number } | null;
type Carrier = { rat: string; primary: boolean; band: number; arfcn: number; pci: number; bw: string; state: number };

type Overview = {
  ok?: boolean;
  register?: { state: number; rat: string; plmn: string; tac: number; cell: string; reject: number };
  lte: Signal;
  nr: Signal;
  cells?: Cell[];
  carriers?: Carrier[];
  ambr?: { net_dl?: number; net_ul?: number; ims_dl?: number; ims_ul?: number } | null;
};

const OPERATORS: Record<string, string> = {
  '46000': '中国移动',
  '46002': '中国移动',
  '46007': '中国移动',
  '46001': '中国联通',
  '46006': '中国联通',
  '46003': '中国电信',
  '46011': '中国电信',
};

const HISTORY_POINTS = 60;

/** 频段名必须按制式区分：LTE 用 B + 数字，NR 用 n + 数字。 */
const bandName = (value: number, rat?: string) => {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return rat === 'NR' ? `n${value}` : `B${value}`;
};

const kbps = (value?: number) => {
  if (!value) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} Mbps` : `${value} kbps`;
};

const bytes = (value?: number) => {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit > 1 ? 2 : 0)} ${units[unit]}`;
};

const Network: React.FC = () => {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState({ enabled: true, interval: 5 });
  const [rsrpHistory, setRsrpHistory] = useState<number[]>([]);
  const [sinrHistory, setSinrHistory] = useState<number[]>([]);
  const [speed, setSpeed] = useState({ down: 0, up: 0 });
  const [speedHistory, setSpeedHistory] = useState<Array<{ down: number; up: number }>>([]);
  const [traffic, setTraffic] = useState<{ rx?: number; tx?: number; iface?: string; speed?: string }>({});
  const [lockTarget, setLockTarget] = useState<Cell | null>(null);
  const timer = useRef<number>();
  const lastSample = useRef<{ rx: number; tx: number; at: number } | null>(null);

  const sampleTraffic = useCallback(async () => {
    const dumped = await ubus<{ interface?: Array<{ interface: string; device?: string; up: boolean }> }>(
      'network.interface',
      'dump',
    );
    const cellular =
      dumped.interface?.find((item) => /ccmni|wwan|usb/i.test(item.device || '')) ||
      dumped.interface?.find((item) => item.interface === 'modem5g');
    const name = cellular?.device || 'ccmni2';
    const status = await ubus<{ statistics?: { rx_bytes?: number; tx_bytes?: number }; speed?: string }>(
      'network.device',
      'status',
      { name },
    );
    const rx = status.statistics?.rx_bytes ?? 0;
    const tx = status.statistics?.tx_bytes ?? 0;
    setTraffic({ rx, tx, iface: name, speed: status.speed });

    const now = Date.now();
    const previous = lastSample.current;
    if (previous && now > previous.at) {
      const seconds = (now - previous.at) / 1000;
      // 计数器是字节，界面单位是 Mbps（十进制兆比特）
      const down = Math.max(0, ((rx - previous.rx) * 8) / seconds / 1e6);
      const up = Math.max(0, ((tx - previous.tx) * 8) / seconds / 1e6);
      setSpeed({ down, up });
      setSpeedHistory((list) => [...list, { down, up }].slice(-HISTORY_POINTS));
    }
    lastSample.current = { rx, tx, at: now };
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const next = await ubus<Overview>('dlink-cellular', 'overview');
        setData(next);
        const rsrp = next.nr?.rsrp ?? next.lte?.rsrp;
        const sinr10 = next.nr?.sinr10 ?? next.lte?.sinr10;
        if (rsrp != null) setRsrpHistory((list) => [...list, rsrp].slice(-HISTORY_POINTS));
        if (sinr10 != null) setSinrHistory((list) => [...list, sinr10 / 10].slice(-HISTORY_POINTS));
        await sampleTraffic().catch(() => undefined);
      } catch (error) {
        if (!silent) Toast.error(error instanceof Error ? error.message : '读取失败');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [sampleTraffic],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    window.clearInterval(timer.current);
    if (!auto.enabled) return undefined;
    timer.current = window.setInterval(() => load(true), auto.interval * 1000);
    return () => window.clearInterval(timer.current);
  }, [auto, load]);

  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onVis = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const { snapshot: live, status: liveStatus } = useCellularStream(auto.enabled && pageVisible);

  const lastTs = useRef(0);
  useEffect(() => {
    if (!live || live.ts === lastTs.current) return;
    lastTs.current = live.ts;
    const rsrp = live.nr?.rsrp ?? live.lte?.rsrp;
    const sinr10 = live.nr?.sinr10 ?? live.lte?.sinr10;
    if (rsrp != null) setRsrpHistory((list) => [...list, rsrp].slice(-HISTORY_POINTS));
    if (sinr10 != null) setSinrHistory((list) => [...list, sinr10 / 10].slice(-HISTORY_POINTS));
  }, [live]);

  const reg = data?.register;
  const signal = live?.nr || live?.lte || data?.nr || data?.lte;
  const sinr = signal?.sinr10 != null ? signal.sinr10 / 10 : null;
  const cells = live?.cells ?? data?.cells;
  const operator = reg?.plmn ? OPERATORS[reg.plmn] || reg.plmn : '未知运营商';
  const score = rsrpPercent(signal?.rsrp);
  const signalTone = scoreTone(score);
  const qualityLabel = scoreLabel(score);

  const peakDown = speedHistory.reduce((max, p) => Math.max(max, p.down), 0);
  const peakUp = speedHistory.reduce((max, p) => Math.max(max, p.up), 0);

  const primaryCarrier = live?.carriers?.[0] || data?.carriers?.[0];
  const primaryBand = primaryCarrier ? bandName(primaryCarrier.band, primaryCarrier.rat) : '—';
  const carrierCount = live?.carriers?.length ?? data?.carriers?.length ?? 0;

  return (
    <div className="page-stack">
      {/* 顶部实时控制栏 */}
      <div className="page-toolbar">
        <div className="page-toolbar-left">
          <span className={`live-badge live-badge--${liveStatus}`} role="status">
            <span className="live-badge-dot" aria-hidden="true" />
            {liveStatus === 'live' ? '实时推送中' : liveStatus === 'connecting' ? '正在连接推送' : '轮询模式'}
          </span>
          {carrierCount > 0 ? (
            <span className="toolbar-pill">
              <IconLayers size="small" />
              {carrierCount} 载波聚合 · 主频段 {primaryBand}
            </span>
          ) : null}
        </div>
        <div className="page-toolbar-right">
          <AutoRefresh
            enabled={auto.enabled}
            interval={auto.interval}
            onChange={(enabled, interval) => setAuto({ enabled, interval })}
          />
          <Button size="small" icon={<IconRefresh />} loading={loading} onClick={() => load()}>
            刷新
          </Button>
        </div>
      </div>

      {/* Tier 1: 核心状态 KPI 概览条 */}
      <div className="kpi-strip">
        <Metric
          tile
          size="md"
          icon={<IconSignal size="small" />}
          label="驻留网络"
          value={reg?.rat || '未驻留'}
          badge={
            <Tag size="small" color={TAG_COLOR[reg?.state === 2 ? 'success' : 'danger']}>
              {reg?.state === 2 ? '已驻留' : '未驻留'}
            </Tag>
          }
          hint={`${operator} · 主频段 ${primaryBand}${reg?.plmn ? ` · ${reg.plmn}` : ''}`}
          className="kpi-card"
        />
        <Metric
          tile
          size="md"
          label="信号强度"
          value={signal?.rsrp ?? '—'}
          unit={signal?.rsrp != null ? 'dBm' : undefined}
          tone={signalTone}
          badge={
            <Tag size="small" color={TAG_COLOR[signalTone]}>
              {qualityLabel}
            </Tag>
          }
          hint={`SINR ${sinr != null ? `${sinr} dB` : '—'} · RSRQ ${signal?.rsrq != null ? `${signal.rsrq} dB` : '—'}`}
          className="kpi-card"
        />
        <Metric
          tile
          size="md"
          icon={<IconArrowDown size="small" />}
          label="实时下行"
          value={speed.down.toFixed(2)}
          unit="Mbps"
          tone="down"
          hint={speedHistory.length ? `峰值 ${peakDown.toFixed(2)} Mbps · 近 ${speedHistory.length} 次采样` : '等待采样'}
          className="kpi-card kpi-card--down"
        />
        <Metric
          tile
          size="md"
          icon={<IconArrowUp size="small" />}
          label="实时上行"
          value={speed.up.toFixed(2)}
          unit="Mbps"
          tone="up"
          hint={speedHistory.length ? `峰值 ${peakUp.toFixed(2)} Mbps · 近 ${speedHistory.length} 次采样` : '等待采样'}
          className="kpi-card kpi-card--up"
        />
      </div>

      {/* Tier 2: 信号驾驶舱 + 实时速率趋势 */}
      <div className="bento-primary">
        <PageCard
          variant="hero"
          title="信号质量与驻留参数"
          hint="当前服务小区射频遥测与签约信息"
          extra={
            <Space spacing={6}>
              {primaryBand !== '—' ? <Tag color={TAG_COLOR.accent}>{primaryBand}</Tag> : null}
              {data?.carriers?.[0]?.pci ? <Tag color={TAG_COLOR.neutral}>PCI {data.carriers[0].pci}</Tag> : null}
            </Space>
          }
        >
          <div className="signal-cockpit">
            <div className="signal-cockpit-gauge">
              <RingGauge percent={score} label="信号评分" size={92} tone={signalTone} />
              <div className="signal-cockpit-meta">
                <div className={`signal-cockpit-status ${toneClass(signalTone)}`}>{qualityLabel}</div>
                <div className="signal-cockpit-sub">
                  RSRP {SIGNAL_RSRP_RANGE[0]} ~ {SIGNAL_RSRP_RANGE[1]} dBm
                </div>
              </div>
            </div>

            <div className="signal-cockpit-bars">
              <QualityBar
                label="RSRP 接收功率"
                value={signal?.rsrp ?? null}
                domain={SIGNAL_RSRP_RANGE}
                unit=" dBm"
                tone={signalTone}
              />
              <QualityBar label="SINR 信噪比" value={sinr} domain={[-5, 25]} unit=" dB" tone={sinrTone(sinr)} />
              <QualityBar
                label="RSRQ 接收质量"
                value={signal?.rsrq ?? null}
                domain={[-20, -3]}
                unit=" dB"
                tone={rsrqTone(signal?.rsrq)}
              />
            </div>
          </div>

          <div className="chart-surface">
            <Sparkline
              height={96}
              minRange={6}
              independentScale
              empty="等待基带信号上报…"
              series={[
                {
                  label: 'RSRP',
                  tone: 'down',
                  values: rsrpHistory,
                  format: (v) => `${Math.round(v)} dBm`,
                },
                {
                  label: 'SINR',
                  tone: 'up',
                  values: sinrHistory,
                  dashed: true,
                  format: (v) => `${v.toFixed(1)} dB`,
                },
              ]}
            />
          </div>

          <div className="card-divider" />

          <Kv
            columns={4}
            dense
            items={[
              { label: '运营商', value: operator },
              { label: 'PLMN', value: reg?.plmn || '—' },
              { label: 'PCI', value: data?.carriers?.[0]?.pci || '—' },
              { label: '频点 ARFCN', value: data?.carriers?.[0]?.arfcn || '—' },
              { label: 'TAC', value: reg?.tac ?? '—' },
              { label: '小区 ID', value: reg?.cell || '—' },
              { label: '签约下行', value: kbps(data?.ambr?.net_dl) },
              { label: '签约上行', value: kbps(data?.ambr?.net_ul) },
              { label: 'RSSI', value: signal?.rssi != null ? `${signal.rssi} dBm` : '—' },
              { label: '拒绝原因', value: reg?.reject ?? '—' },
            ]}
          />
        </PageCard>

        <PageCard
          title="吞吐趋势与流量"
          hint="按接口字节增量实时计算"
          extra={traffic.iface ? <Tag color={TAG_COLOR.neutral}>{traffic.iface}</Tag> : null}
          bodyClassName="throughput-card-body"
        >
          <div className="chart-surface chart-surface--grow">
            <Sparkline
              fill
              height={168}
              minRange={0.5}
              empty="等待速率采样…"
              format={(v) => `${v.toFixed(2)} Mbps`}
              series={[
                { label: '下行', tone: 'down', values: speedHistory.map((p) => p.down) },
                { label: '上行', tone: 'up', values: speedHistory.map((p) => p.up), dashed: true },
              ]}
            />
          </div>

          <div className="card-divider" />

          <Kv
            columns={2}
            dense
            items={[
              { label: '累计接收', value: bytes(traffic.rx) },
              { label: '累计发送', value: bytes(traffic.tx) },
              { label: '承载接口', value: traffic.iface || '—' },
              { label: '链路速率', value: traffic.speed || '—' },
            ]}
          />
        </PageCard>
      </div>

      {/* Tier 3: 载波聚合 */}
      <section className="page-section">
        <SectionHeader
          title="载波聚合"
          desc={
            live?.carriers?.length
              ? `当前激活 ${live.carriers.length} 路载波 · 实时调制与吞吐`
              : `${data?.carriers?.length ?? 0} 路载波 · 主载波 ${primaryBand}`
          }
        />
        <div className="carrier-grid">
          {live?.carriers?.length ? (
            live.carriers.map((item, index) => {
              const isPrimary = item.role === 'PCC';
              return (
                <div
                  className={`carrier-card${isPrimary ? ' carrier-card--primary' : ''}`}
                  key={`${item.rat}-${item.role}-${index}`}
                >
                  <div className="carrier-card-head">
                    <div className="carrier-band-group">
                      <span className="carrier-band-code">{bandName(item.band, item.rat)}</span>
                      <div className="carrier-band-meta">
                        <span className="carrier-role">
                          {isPrimary ? '主载波 PCC' : `辅载波 ${item.role.replace('SCC', '')}`}
                        </span>
                        <span className="carrier-specs">
                          PCI {item.pci}
                          {item.dl_mhz ? ` · ${item.dl_mhz} MHz` : ''}
                          {item.dl_mimo ? ` · ${item.dl_mimo}×${item.ul_mimo ?? '?'} MIMO` : ''}
                        </span>
                      </div>
                    </div>
                    <Space spacing={4}>
                      <Tag size="small" color={ratTagColor(item.rat)}>
                        {item.rat}
                      </Tag>
                      {item.active === false ? (
                        <Tag size="small" color={TAG_COLOR.neutral}>
                          未激活
                        </Tag>
                      ) : null}
                    </Space>
                  </div>

                  {item.dl_tput_kbps != null ? (
                    <div className="carrier-tput-bar">
                      <div>
                        <span className="carrier-tput-label">下行吞吐</span>
                        <b>{(item.dl_tput_kbps / 1000).toFixed(2)} MB/s</b>
                      </div>
                      <div>
                        <span className="carrier-tput-label">上行吞吐</span>
                        <b>{((item.ul_tput_kbps ?? 0) / 1000).toFixed(2)} MB/s</b>
                      </div>
                    </div>
                  ) : null}

                  <Kv
                    dense
                    columns={2}
                    items={[
                      {
                        label: '下行 MCS',
                        value: item.dl_mcs != null ? `${item.dl_mcs} ${item.dl_mod || ''}`.trim() : '—',
                      },
                      {
                        label: '上行 MCS',
                        value: item.ul_mcs != null ? `${item.ul_mcs} ${item.ul_mod || ''}`.trim() : '—',
                      },
                      { label: '下行 RB', value: item.dl_rb != null ? String(item.dl_rb) : '—' },
                      { label: '上行 RB', value: item.ul_rb != null ? String(item.ul_rb) : '—' },
                      {
                        label: '发射功率',
                        value: item.pusch_dbm != null ? `PUSCH ${item.pusch_dbm} dBm` : '—',
                      },
                      { label: '频点', value: item.arfcn != null ? String(item.arfcn) : '—' },
                    ]}
                  />
                </div>
              );
            })
          ) : data?.carriers?.length ? (
            data.carriers.map((item, index) => (
              <div
                className={`carrier-card${index === 0 ? ' carrier-card--primary' : ''}`}
                key={`${item.rat}-${item.arfcn}-${index}`}
              >
                <div className="carrier-card-head">
                  <div className="carrier-band-group">
                    <span className="carrier-band-code">{bandName(item.band, item.rat)}</span>
                    <div className="carrier-band-meta">
                      <span className="carrier-role">{index === 0 ? '主载波 PCC' : `辅载波 ${index}`}</span>
                      <span className="carrier-specs">
                        PCI {item.pci} · {item.bw || '—'} MHz
                      </span>
                    </div>
                  </div>
                  <Tag size="small" color={ratTagColor(item.rat)}>
                    {item.rat}
                  </Tag>
                </div>
                <Kv
                  dense
                  columns={2}
                  items={[
                    { label: '下行频点', value: String(item.arfcn) },
                    { label: 'PCI', value: String(item.pci) },
                    { label: '带宽', value: `${item.bw || '—'} MHz` },
                    {
                      label: '状态',
                      value: (
                        <Tag size="small" color={TAG_COLOR[item.state === 2 ? 'success' : 'neutral']}>
                          {item.state === 2 ? '已激活' : String(item.state)}
                        </Tag>
                      ),
                    },
                  ]}
                />
              </div>
            ))
          ) : (
            <div className="empty-surface">暂无载波聚合信息</div>
          )}
        </div>
      </section>

      {/* Tier 3: 链路质量（仅 SSE 存在时展示） */}
      {live?.meas || live?.radio || live?.cap ? (
        <section className="page-section">
          <SectionHeader title="链路质量与能力" desc="基带实时空口测量与协商能力" />
          <TwoCol>
            <PageCard title="空口测量" hint="波束、秩与路径损耗">
              <Kv
                dense
                columns={3}
                items={[
                  { label: '秩指示 (Rank)', value: live.meas?.rank ? `Rank ${live.meas.rank}` : '—' },
                  { label: '路径损耗', value: live.meas?.path_loss != null ? `${live.meas.path_loss} dB` : '—' },
                  {
                    label: 'SSB 波束',
                    value: live.meas?.beam_id != null && live.meas.beam_id !== 255 ? `#${live.meas.beam_id}` : '—',
                  },
                  {
                    label: '最佳波束 RSRP',
                    value: live.meas?.best_beam_rsrp != null ? `${live.meas.best_beam_rsrp} dBm` : '—',
                  },
                  {
                    label: 'SSB 平均 RSRP',
                    value: live.meas?.ssb_rsrp != null ? `${live.meas.ssb_rsrp} dBm` : '—',
                  },
                  {
                    label: 'SSB 平均 SINR',
                    value: live.meas?.ssb_snr10 != null ? `${live.meas.ssb_snr10 / 10} dB` : '—',
                  },
                ]}
              />
            </PageCard>
            <PageCard title="网络能力" hint="信道质量与服务域">
              <Kv
                dense
                columns={3}
                items={[
                  {
                    label: 'CQI',
                    value:
                      live.radio?.nr_cqi != null
                        ? `${live.radio.nr_cqi} / 15`
                        : live.radio?.lte_cqi != null
                          ? `${live.radio.lte_cqi} / 15`
                          : '—',
                  },
                  {
                    label: '当前频段',
                    value: live.radio?.nr_band
                      ? bandName(live.radio.nr_band, 'NR')
                      : live.radio?.lte_band
                        ? bandName(live.radio.lte_band, 'LTE')
                        : '—',
                  },
                  { label: '载波带宽', value: live.radio?.nr_dl_bw || '—' },
                  {
                    label: '4×4 MIMO',
                    value: (
                      <Tag size="small" color={TAG_COLOR[live.cap?.nr_4x4_mimo ? 'success' : 'neutral']}>
                        {live.cap?.nr_4x4_mimo ? '已启用' : '未启用'}
                      </Tag>
                    ),
                  },
                  {
                    label: '服务域',
                    value:
                      live.cap?.srv_domain === 1
                        ? 'CS & PS'
                        : live.cap?.srv_domain === 0
                          ? 'PS Only'
                          : '—',
                  },
                  { label: '网络时间', value: live.nitz?.time || '—' },
                ]}
              />
            </PageCard>
          </TwoCol>
        </section>
      ) : null}

      {/* Tier 4: 邻区监测列表 */}
      <PageCard
        title="邻区监测"
        hint={`共 ${cells?.length ?? 0} 个测量小区 · 点击任意一行可快速锁定`}
        extra={
          <span className="neighbor-hint-badge">
            <IconLock size="small" />
            点击行锁定小区
          </span>
        }
      >
        <div className="neighbor-head">
          <span>制式</span>
          <span>频点</span>
          <span>PCI</span>
          <span>RSRP</span>
          <span>RSRQ</span>
          <span>SINR</span>
          <span>小区 ID</span>
          <span className="neighbor-head-bar">信号强度</span>
          <span className="neighbor-head-act" />
        </div>
        <div className="neighbor-list">
          {(cells || []).map((item, index) => {
            const pct = rsrpPercent(item.rsrp);
            const tone = scoreTone(pct);
            const serving = isServingCell(item, reg?.cell);
            const cellSinr = item.sinr10 != null ? item.sinr10 / 10 : null;
            return (
              <div
                className={`neighbor-row${serving ? ' is-serving' : ''}`}
                key={`${item.rat}-${item.arfcn}-${item.pci}-${index}`}
                role="button"
                tabIndex={0}
                aria-label={`锁定 ${item.rat} ${item.arfcn} PCI ${item.pci}`}
                onClick={() => setLockTarget(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setLockTarget(item);
                  }
                }}
              >
                <span className={`neighbor-rat neighbor-rat--${item.rat.toLowerCase()}`}>{item.rat}</span>
                <span className="neighbor-freq">{item.arfcn}</span>
                <span className="neighbor-pci">{item.pci}</span>
                <span className={`neighbor-rsrp ${toneClass(tone)}`}>
                  {item.rsrp}
                  <i>dBm</i>
                </span>
                <span className={`neighbor-quality ${toneClass(rsrqTone(item.rsrq))}`}>
                  {item.rsrq != null ? `${item.rsrq} dB` : '—'}
                </span>
                <span className={`neighbor-quality ${toneClass(sinrTone(cellSinr))}`}>
                  {cellSinr != null ? `${cellSinr} dB` : '—'}
                </span>
                <span className="neighbor-cell">
                  {item.cell && item.cell !== '0' ? (
                    <>
                      {serving ? <em className="neighbor-serving-mark">主小区</em> : null}
                      <b>{item.cell}</b>
                    </>
                  ) : (
                    <i className="neighbor-cell-empty">未上报</i>
                  )}
                </span>
                <span className="neighbor-bar">
                  <Progress
                    percent={pct ?? 0}
                    stroke={toneColor(tone)}
                    showInfo={false}
                    aria-label={`PCI ${item.pci} 信号强度`}
                  />
                  <b className={toneClass(tone)}>{pct ?? '—'}%</b>
                </span>
                <span className="neighbor-action" aria-hidden="true">
                  <IconChevronRight size="small" />
                </span>
              </div>
            );
          })}
        </div>
        {!cells?.length ? (
          <div className="empty-inline">
            <Typography.Text type="tertiary">当前没有读取到邻区测量数据</Typography.Text>
          </div>
        ) : null}
      </PageCard>

      <LockCellModal
        cell={lockTarget}
        serving={lockTarget ? isServingCell(lockTarget, reg?.cell) : false}
        onClose={() => setLockTarget(null)}
        onDone={() => {
          setLockTarget(null);
          void load();
        }}
      />
    </div>
  );
};

export default Network;
