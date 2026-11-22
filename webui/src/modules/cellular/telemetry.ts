import { cellKey } from './types';

export type Signal = { rsrp?: number | null; rsrq?: number | null; sinr10?: number | null; rssi?: number | null };
export type CarrierLink = { layers: number; mcs: number | null; modulation: string | null; kbytes_s: number | null; pusch_dbm?: number | null };
export type Carrier = {
  rat: string; primary: boolean; band: number; arfcn: number; pci: number; bw: string; state: number;
  dl?: CarrierLink | null; ul?: CarrierLink | null;
};
export type Overview = {
  ok?: boolean;
  error?: string;
  register?: { state: number; registered?: boolean; rat: string; plmn: string; tac: number; cell: string; reject: number } | null;
  lte?: Signal | null;
  nr?: Signal | null;
  cells?: import('./types').Cell[] | null;
  carriers?: Carrier[] | null;
  cqi?: { nr?: number | null; lte?: number | null } | null;
  ambr?: { net_dl?: number; net_ul?: number; ims_dl?: number; ims_ul?: number } | null;
};

export const hasDataService = (reg?: Overview['register']) =>
  reg?.registered ?? ([2, 6, 9, 10].includes(reg?.state ?? 0));

export function servingCarriers(overview?: Overview | null) {
  const reg = overview?.register;
  if (!hasDataService(reg)) return [];
  return (overview?.carriers || []).filter((item) =>
    item.primary === true && Number.isSafeInteger(item.arfcn) && item.arfcn > 0 &&
    Number.isSafeInteger(item.pci) && item.pci >= 0 &&
    (item.rat === 'NR' ? item.pci <= 1007 && item.arfcn <= 3279165 : item.rat === 'LTE' && item.pci <= 503 && item.arfcn <= 262143) &&
    (reg?.rat === '5G NSA' || (reg?.rat === '5G SA' && item.rat === 'NR') || (reg?.rat === 'LTE' && item.rat === 'LTE')));
}

export type CellIdentity = Pick<Carrier, 'rat' | 'arfcn' | 'pci'>;
export function lockMatch(lock: CellIdentity, serving: CellIdentity[]) {
  if (serving.some((cell) => cellKey(cell) === cellKey(lock))) return 'matched';
  return serving.some((cell) => cell.rat === lock.rat) ? 'different' : 'unknown';
}

export function describeCarriers(carriers: Carrier[]) {
  const active = carriers.filter((c) => c.primary || c.state === 2);
  const groups = ['NR', 'LTE'].map((rat) => ({
    rat, count: active.filter((c) => c.rat === rat).length,
  })).filter((g) => g.count > 0);
  if (!groups.length) return '载波未上报';
  if (groups.length === 2) return groups.map((c) => `${c.rat} ${c.count}CC`).join(' + ') + ' · 双连接';
  return active.length === 1 ? '单载波' : `${groups[0].rat} ${active.length}CC · 载波聚合`;
}
