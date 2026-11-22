import React from 'react';
import { Link } from 'react-router-dom';
import { IconChevronRight } from '@douyinfe/semi-icons';
import { Panel } from '@/ui/widgets';
import { toneClass } from '@/ui/tokens';
import { rsrpPercent, scoreTone, sinrTone } from './grade';
import type { ScanReply } from './engineering';

type Reading = NonNullable<ScanReply['cells']>[number];

// The lock form accepts only these three fields. Keep distinct observations under that target.
function groupTargets(cells: Reading[]) {
  const targets = new Map<string, Map<string, Reading>>();
  for (const c of cells) {
    const key = [c.rat, c.arfcn, c.pci].join(':');
    const readings = targets.get(key) ?? new Map<string, Reading>();
    readings.set(JSON.stringify([c.band, c.cell, c.rsrp, c.rsrq, c.sinr]), c);
    targets.set(key, readings);
  }
  return targets;
}
const bandName = (c: Reading) => (c.rat === 'NR' ? 'n' : 'B') + c.band;
const measurement = (v: number | null | undefined, unit: string) => v == null ? '—' : `${v} ${unit}`;

export function ScanResults({ cells, complete }: { cells: Reading[]; complete: boolean }) {
  const targets = groupTargets(cells);
  return <Panel title={complete ? '扫描结果' : '部分结果'} extra={`${targets.size} 个锁定目标 · ${cells.length} 条上报`}>
    <div className="scan-table">
      <div className="scan-columns scan-head" aria-hidden="true">
        <span>频段</span><span>ARFCN / PCI</span><span>RSRP</span><span>SINR</span><span />
      </div>
      <ul className="scan-list">
        {Array.from(targets, ([key, readings]) => {
          const c = readings.values().next().value!;
          return <li key={key} className="scan-target">
            <div className="scan-columns scan-main">
              <span className={`neighbor-rat neighbor-rat--${c.rat.toLowerCase()}`}>{bandName(c)}</span>
              <span className="scan-identity"><b aria-label={`ARFCN ${c.arfcn}`}>{c.arfcn}</b><small>PCI {c.pci} · {c.rat}</small></span>
              <span aria-label={`RSRP ${measurement(c.rsrp, 'dBm')}`} className={`scan-reading ${toneClass(scoreTone(rsrpPercent(c.rsrp)))}`}>
                <small>RSRP</small>{measurement(c.rsrp, 'dBm')}
              </span>
              <span aria-label={`SINR ${measurement(c.sinr, 'dB')}`} className={`scan-reading ${toneClass(sinrTone(c.sinr))}`}>
                <small>SINR</small>{measurement(c.sinr, 'dB')}
              </span>
              <Link className="scan-link" to={`/network/setting?rat=${c.rat}&arfcn=${c.arfcn}&pci=${c.pci}#manual-cell`}>
                带入锁小区<IconChevronRight size="small" />
              </Link>
            </div>
            {readings.size > 1 && <details className="scan-details">
              <summary>查看 {readings.size} 条不同测量</summary>
              {Array.from(readings, ([id, r]) => <p key={id}>{bandName(r)} · 小区 ID {r.cell && r.cell !== '0' ? r.cell : '未上报'}
                {' · RSRP '}{measurement(r.rsrp, 'dBm')}{' · RSRQ '}{measurement(r.rsrq, 'dB')}{' · SINR '}{measurement(r.sinr, 'dB')}</p>)}
            </details>}
          </li>;
        })}
      </ul>
    </div>
  </Panel>;
}
