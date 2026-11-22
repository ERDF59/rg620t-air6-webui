/** 邻区/服务小区共用的蜂窝数据类型。
 *
 * 后端 dlink-cell.c 的 cell() 统一输出这些字段：
 * - sinr10 一律为 0.1 dB（NR 的 dB 值已由后端乘 10），/10 即为 dB
 * - rsrq 为 dB，负数越大越好
 * - ta（timing advance）是主小区的原始定时提前量，单位未标定；未上报时省略
 */
export type Rat = 'NR' | 'LTE';

export type Cell = {
  rat: string;
  arfcn: number;
  pci: number;
  cell: string;
  tac: number;
  rsrp: number | null;
  rsrq?: number | null;
  sinr10?: number | null;
  rssi?: number | null;
  ta?: number;
};

/** 小区锁定候选：邻区、锁频、弹窗三处共用 */
export type LockCandidate = { rat: Rat; arfcn: number; pci: number; rsrp?: number | null; cell?: string };

export const cellKey = (item: { rat: string; arfcn: number; pci: number }) =>
  `${item.rat}:${item.arfcn}:${item.pci}`;

export const cellLabel = (item: { rat: string; arfcn: number; pci: number }) =>
  `${item.rat} ${item.arfcn} / PCI ${item.pci}`;

/** 把 cell 转成锁定接口需要的形态 */
export const toCandidate = (item: Cell): LockCandidate => ({
  rat: item.rat as Rat,
  arfcn: item.arfcn,
  pci: item.pci,
  rsrp: item.rsrp,
  cell: item.cell,
});
