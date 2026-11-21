import React, { useEffect, useState } from 'react';
import { Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { IconActivity, IconClock, IconServer, IconUserGroup, IconWifi } from '@douyinfe/semi-icons';
import { Kv, Metric, PageCard, SectionHeader, TwoCol } from '@/ui/widgets';
import { QualityBar } from '@/ui/charts';
import { ubus } from '@/services/deviceUbus';
import deployInfo from '@/modules/device-build.json';
import { TAG_COLOR, type Tone } from '@/ui/tokens';

type Release = { distribution?: string; version?: string; revision?: string; description?: string };
type Board = { hostname?: string; model?: string; system?: string; kernel?: string; release?: Release };
type Info = { uptime?: number; memory?: { total?: number; free?: number }; load?: number[] };
type Radio = {
  channel?: number;
  freq?: number;
  width?: number;
  power?: string;
  state?: string;
  stations?: number;
  ap_channel?: number;
  link_width?: number;
};
type Cpe = { platform?: string; ra0?: Radio; rai0?: Radio };

async function readRadio(name: 'ra0'|'rai0'):Promise<Radio> {
  const [ap,iw,clients]=await Promise.all([
    ubus<{status?:string;channel?:number;freq?:number}>(`hostapd.${name}`,'get_status').catch(()=>null),
    ubus<{htmode?:string;txpower?:number}>('iwinfo','info',{device:name}).catch(()=>null),
    ubus<{clients?:Record<string,unknown>}>(`hostapd.${name}`,'get_clients').catch(()=>null),
  ]);
  const match=iw?.htmode?.match(/(20|40|80|160|320)$/);
  return {state:ap?.status,channel:ap?.channel,freq:ap?.freq,width:match?Number(match[1]):undefined,
    power:iw?.txpower==null?undefined:String(iw.txpower),stations:clients?.clients?Object.keys(clients.clients).length:undefined};
}

const duration = (seconds?: number) => {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
};

const gb = (bytes?: number) => (bytes ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB` : '—');

const radioLabel = (radio?: Radio) => {
  if (!radio?.freq) return '—';
  const band = (radio.freq || 0) < 3000 ? '2.4G' : '5G';
  return `${band} · CH${radio.channel ?? '—'} · ${radio.width ?? '—'} MHz`;
};

/** 占用率（越高越糟）：>85 危险 / >70 警告 */
const usageTone = (percent: number | null): Tone => {
  if (percent == null) return 'neutral';
  return percent > 85 ? 'danger' : percent > 70 ? 'warning' : 'success';
};

const isRadioUp = (state?: string) => Boolean(state && /up|active|enable|on/i.test(state));

const System: React.FC = () => {
  const [board, setBoard] = useState<Board>({});
  const [info, setInfo] = useState<Info>({});
  const [cpe, setCpe] = useState<Cpe>({});

  useEffect(() => {
    Promise.all([ubus<Board>('system', 'board'), ubus<Info>('system', 'info'), Promise.all([readRadio('ra0'),readRadio('rai0')]).then(([ra0,rai0])=>({ra0,rai0}))])
      .then(([nextBoard, nextInfo, nextCpe]) => {
        setBoard(nextBoard);
        setInfo(nextInfo);
        setCpe(nextCpe);
      })
      .catch((error) => Toast.error(error instanceof Error ? error.message : '读取失败'));
  }, []);

  const mem = info.memory;
  const usedPercent = mem?.total && mem.free != null ? Math.round((1 - mem.free / mem.total) * 100) : null;
  const usedBytes = mem?.total && mem.free != null ? mem.total - mem.free : undefined;
  const load = info.load?.map((n) => (n / 65535).toFixed(2)).join(' / ');
  const stations = cpe.ra0?.stations != null && cpe.rai0?.stations != null ? cpe.ra0.stations + cpe.rai0.stations : '—';

  return (
    <div className="page-stack">
      <div className="kpi-strip">
        <Metric
          tile
          size="md"
          icon={<IconClock size="small" />}
          label="运行时长"
          value={duration(info.uptime)}
          hint={board.hostname ? `主机 ${board.hostname}` : '系统连续在线'}
          className="kpi-card"
        />
        <Metric
          tile
          size="md"
          icon={<IconUserGroup size="small" />}
          label="在线终端"
          value={stations}
          unit="台"
          hint={`2.4G ${cpe.ra0?.stations ?? '—'} 台 · 5G ${cpe.rai0?.stations ?? '—'} 台`}
          className="kpi-card"
        />
        <Metric
          tile
          size="md"
          icon={<IconServer size="small" />}
          label="内存占用"
          value={usedPercent == null ? '—' : usedPercent}
          unit={usedPercent != null ? '%' : undefined}
          tone={usageTone(usedPercent) === 'success' ? undefined : usageTone(usedPercent)}
          hint={`${gb(usedBytes)} / ${gb(mem?.total)}`}
          className="kpi-card"
        />
        <Metric
          tile
          size="md"
          icon={<IconActivity size="small" />}
          label="平均负载"
          value={load || '—'}
          hint="1m / 5m / 15m"
          className="kpi-card"
        />
      </div>

      <TwoCol>
        <PageCard
          title="系统与固件"
          hint="主机硬件、发行版与内存使用率"
          extra={<Tag size="small" color={TAG_COLOR.accent}>{board.release?.distribution || 'ImmortalWrt'}</Tag>}
        >
          <Kv
            layout="rows"
            items={[
              { label: '主机名', value: board.hostname || '—' },
              { label: '设备型号', value: board.model || 'DWR-BE7200G' },
              { label: '发行版', value: board.release?.distribution || 'ImmortalWrt' },
              { label: '固件版本', value: board.release?.description || board.release?.version || '—' },
              { label: '内核版本', value: board.kernel || '—' },
            ]}
          />
          <div className="card-divider" />
          <QualityBar
            label="内存使用率"
            value={usedPercent}
            domain={[0, 100]}
            unit="%"
            higherIsWorse
            tone={usageTone(usedPercent)}
          />
          <Typography.Text type="tertiary" size="small" className="hint-line hint-line--tight">
            已用 {gb(usedBytes)} / 总计 {gb(mem?.total)}
          </Typography.Text>
        </PageCard>

        <PageCard
          title="蜂窝模组"
          hint="安装此版界面时从设备读取"
          extra={<Tag size="small" color={TAG_COLOR.success}>部署时核对</Tag>}
        >
          <Kv
            layout="rows"
            items={[
              { label: '模组型号', value: 'Quectel RG620T' },
              { label: '基带版本', value: deployInfo.firmware },
              { label: '部署时系统槽位', value: deployInfo.systemSlot },
            ]}
          />
          <div className="card-divider" />
          <Typography.Text type="tertiary" size="small">
            基带版本来自 AT+CGMR；后续刷机或切槽后，这份部署记录不会自动变化。
          </Typography.Text>
        </PageCard>
      </TwoCol>

      <section className="page-section">
        <SectionHeader title="无线射频" desc="来自 hostapd 与 iwinfo 的 2.4 GHz / 5 GHz 实时射频状态" icon={<IconWifi />} />
        <TwoCol>
          <PageCard
            title="2.4 GHz 无线"
            hint="广覆盖频段 (ra0)"
            extra={
              <Tag size="small" color={TAG_COLOR[isRadioUp(cpe.ra0?.state) ? 'success' : 'neutral']}>
                {cpe.ra0?.state || '未知'}
              </Tag>
            }
          >
            <Kv
              layout="rows"
              items={[
                { label: '信道与带宽', value: radioLabel(cpe.ra0) },
                { label: '发射功率', value: cpe.ra0?.power ? `${cpe.ra0.power} dBm` : '—' },
                { label: '关联终端', value: `${cpe.ra0?.stations ?? '—'} 台` },
              ]}
            />
          </PageCard>

          <PageCard
            title="5 GHz 无线"
            hint="高速频段 (rai0)"
            extra={
              <Tag size="small" color={TAG_COLOR[isRadioUp(cpe.rai0?.state) ? 'success' : 'neutral']}>
                {cpe.rai0?.state || '未知'}
              </Tag>
            }
          >
            <Kv
              layout="rows"
              items={[
                { label: '信道与带宽', value: radioLabel(cpe.rai0) },
                { label: '发射功率', value: cpe.rai0?.power ? `${cpe.rai0.power} dBm` : '—' },
                { label: '关联终端', value: `${cpe.rai0?.stations ?? '—'} 台` },
              ]}
            />
          </PageCard>
        </TwoCol>
      </section>
    </div>
  );
};

export default System;
