import React, { useEffect, useRef, useState } from 'react';
import { Banner, Button, Modal, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { ubus } from '@/services/deviceUbus';
import { type Cell, cellKey, cellLabel } from './types';
import { TAG_COLOR, ratTagColor } from '@/ui/tokens';

const ERRORS: Record<string, string> = {
  input: '输入不合法，检查 ARFCN 与 PCI 的范围。',
  cell_read: '基带读不到当前锁定状态。',
  cell_write: '基带拒绝了单小区锁定请求。',
  readback: '写入后配置回读不一致，请刷新确认当前配置。',
  busy: '上一条指令还在执行，稍后再试。',
  ril_init: '蜂窝接口初始化失败。',
};

const pickError = (error: unknown) => {
  const text = error instanceof Error ? error.message : '';
  return ERRORS[text] || text || '操作失败';
};

type Config = { opt: number; rat: string; arfcn: number; pci: number; mode: number };
type Props = { cell: Cell; serving?: boolean; onClose: () => void; onDone: () => void };
async function readConfig(): Promise<Config> {
  const r = await ubus<{ok?: boolean; cell?: Config | null; error?: string}>('dlink-cellular', 'locks');
  const c = r.cell;
  if (!r.ok || !c || ![0,1,2].includes(c.opt) ||
    (c.opt !== 0 && (!c.rat || !Number.isInteger(c.arfcn) || c.arfcn <= 0 ||
      (c.opt === 1 && (!Number.isInteger(c.pci) || c.pci < 0))))) throw Error(r.error || 'cell_read');
  return c;
}
const sameConfig = (a: Config, b: Config) => a.opt === b.opt &&
  (!a.opt || (a.mode === b.mode && a.rat === b.rat && a.arfcn === b.arfcn && (a.opt === 2 || a.pci === b.pci)));

const TargetDialog: React.FC<Props> = ({ cell, serving, onClose, onDone }) => {
  const [config,setConfig] = useState<Config | null>(null);
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const [attempt,retry] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    readConfig().then(c => { if(active)setConfig(c); }, e => { if(active)setNote(pickError(e)); });
    return () => {active=false;};
  }, [attempt]);

  const unlock = config?.opt === 1 && cellKey(config) === cellKey(cell);
  const replace = !!config?.opt && !unlock;
  const action = unlock ? '解除锁定' : replace ? '改锁到此小区' : '确认锁定';
  const submit = async () => {
    if (!config || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    let fresh: Config | null = null;
    try {
      fresh = await readConfig();
      if (!sameConfig(config, fresh)) {
        setConfig(fresh); setNote('锁定配置已改变，请核对后再操作。'); return;
      }
      if (unlock) await ubus('dlink-cellular','cell_clear',{confirm:true});
      else await ubus('dlink-cellular','cell_set',{
        rat:cell.rat, arfcn:String(cell.arfcn), pci:String(cell.pci), confirm:true,
      });
      Toast.success(unlock ? '已解除该小区的单小区锁' : `配置已回读：${cellLabel(cell)}；请看实际驻留`);
      onDone();
    } catch (e) {
      setConfig(null); setNote(pickError(e));
    } finally { submitting.current=false; setBusy(false); }
  };
  const target = config?.opt === 2 ? `${config.rat} 频点 ${config.arfcn}` : config && cellLabel(config);
  return (
    <Modal
      title={unlock ? '解除此小区锁定' : replace ? '更换锁定目标' : '锁定目标小区'}
      visible
      onCancel={() => {if (!submitting.current) onClose();}}
      width="min(460px, calc(100vw - 32px))"
      footer={
        <div className="lock-modal-footer">
          <Button aria-label="取消" disabled={busy} onClick={onClose}>取消</Button>
          {config ? <Button theme="solid" type={unlock ? 'danger' : 'primary'} loading={busy} onClick={submit}>
            {action}
          </Button> : note ? <Button onClick={()=>{setNote('');retry(n=>n+1);}}>重新读取</Button> : null}
        </div>
      }
    >
        <div className="lock-modal">
          <div className="lock-modal-target">
            <Tag color={ratTagColor(cell.rat)}>{cell.rat}</Tag>
            <b>{cell.arfcn}</b>
            <span className="lock-modal-sep">/</span>
            <b>PCI {cell.pci}</b>
            {serving ? <Tag color={TAG_COLOR.success}>当前驻留</Tag> : null}
          </div>

          <div className="lock-modal-metrics">
            <div>
              <span>RSRP</span>
              <b>{cell.rsrp != null ? `${cell.rsrp} dBm` : '—'}</b>
            </div>
            <div>
              <span>RSRQ</span>
              <b>{cell.rsrq != null ? `${cell.rsrq} dB` : '—'}</b>
            </div>
            <div>
              <span>SINR</span>
              <b>{cell.sinr10 != null ? `${cell.sinr10 / 10} dB` : '—'}</b>
            </div>
          </div>

          {note && <Banner type="warning" closeIcon={null} description={note} />}
          {config ? <>
            {unlock ? <Banner type="info" closeIcon={null} description="此小区是当前的单小区锁定目标。解除后，基带可重新选择小区。" />
            : <Banner type={replace || !serving ? 'warning' : 'info'} closeIcon={null}
                description={replace ? `现有锁定：${target}。改锁将替换这项配置，蜂窝连接可能短暂中断。`
                  : serving ? '这是当前驻留的小区，尚未设为单小区锁定目标。' : '锁定此小区可能触发重选，蜂窝连接可能短暂中断。'} />}
            {!unlock && <Typography.Text type="tertiary" size="small">锁定后，若该小区失去覆盖，设备可能脱网。</Typography.Text>}
          </> : !note && <Typography.Text type="tertiary" size="small">正在读取锁定配置…</Typography.Text>}
        </div>
    </Modal>
  );
};

const LockCellModal = ({cell,...props}: Omit<Props,'cell'> & {cell:Cell|null}) =>
  cell ? <TargetDialog key={cellKey(cell)} cell={cell} {...props}/> : null;

export default LockCellModal;
