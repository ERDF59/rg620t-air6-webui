/** 订阅设备端 cellular-sse 推送。
 *
 * 设备侧常驻服务每 2 秒采样一次厂商 API，只在数据变化时推送，
 * 因此前端不再需要自己轮询基带。
 *
 * 数据契约（与 dlink-cell.c 保持一致）：
 * - sinr10 一律 0.1 dB（NR 已在服务端乘 10），/10 才是 dB
 * - rsrq 为 dB，负数越大越好
 */
import { useEffect, useRef, useState } from 'react';

export type SseSignal = {
  rsrp?: number;
  rsrq?: number;
  sinr10?: number;
  rssi?: number;
};

export type SseCell = {
  pci: number;
  arfcn: number;
  rsrp: number;
  rsrq: number;
  sinr10: number;
  cell: string;
};

export type SseCarrier = {
  rat: string;
  role: string;
  band: number;
  pci: number;
  arfcn?: number;
  dl_mhz?: number;
  ul_mhz?: number;
  dl_mimo?: number;
  ul_mimo?: number;
  dl_mcs?: number;
  ul_mcs?: number;
  dl_mod?: string;
  ul_mod?: string;
  dl_rb?: number;
  ul_rb?: number;
  dl_tput_kbps?: number;
  ul_tput_kbps?: number;
  pusch_dbm?: number;
  pucch_dbm?: number;
  active?: boolean;
};

export type SseMeas = {
  rank?: number;
  path_loss?: number;
  beam_id?: number;
  best_beam_rsrp?: number;
  ssb_snr10?: number;
  ssb_rsrp?: number;
};

export type SseRadio = {
  nr_band?: number;
  nr_cqi?: number;
  nr_dl_bw?: string;
  lte_band?: number;
  lte_cqi?: number;
};

export type SseSnapshot = {
  ts: number;
  reg?: { state: number; tech: number; plmn: string; tac: number; cid: string };
  nr?: SseSignal;
  lte?: SseSignal;
  level?: number;
  cells?: SseCell[];
  carriers?: SseCarrier[];
  meas?: SseMeas;
  radio?: SseRadio;
  nitz?: { time: string; leap: number };
  rach?: { nr_attempt: number; nr_failure: number };
  cap?: { nr_4x4_mimo?: number; srv_domain?: number };
};

/** 状态：connecting 建立中 / live 已收到数据 / offline 连不上或已断开 */
export type SseStatus = 'connecting' | 'live' | 'offline';

const SSE_URL = `http://${window.location.hostname}:8099/stream`;

/**
 * 订阅蜂窝实时数据。
 * @param enabled 为 false 时断开连接（页面隐藏或用户关闭自动刷新）
 */
export function useCellularStream(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<SseSnapshot | null>(null);
  const [status, setStatus] = useState<SseStatus>('connecting');
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || import.meta.env.VITE_CELLULAR_SSE === 'off') {
      source.current?.close();
      source.current = null;
      setStatus('offline');
      return undefined;
    }

    // EventSource 自带重连（服务端还发了 retry: 3000），
    // 这里只需在 open/error 时同步状态，不必手写重连逻辑。
    const es = new EventSource(SSE_URL);
    source.current = es;

    es.onopen = () => setStatus((prev) => (prev === 'live' ? prev : 'connecting'));

    es.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as SseSnapshot;
        if (typeof next?.ts !== 'number') return;
        setSnapshot(next);
        setStatus('live');
      } catch {
        // 单条坏数据不该打断整个流，忽略即可
      }
    };

    es.onerror = () => {
      // 浏览器会按 retry 自动重连，这里只标记状态给 UI 用
      setStatus('offline');
    };

    return () => {
      es.close();
      if (source.current === es) source.current = null;
    };
  }, [enabled]);

  return { snapshot, status };
}
