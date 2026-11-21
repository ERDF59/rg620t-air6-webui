import React, { useState } from 'react';
import { Banner, Button, Modal, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { ubus } from '@/services/deviceUbus';
import { type Cell, cellLabel } from './types';
import { TAG_COLOR, ratTagColor } from '@/ui/tokens';

const ERRORS: Record<string, string> = {
  input: '输入不合法，检查 ARFCN 与 PCI 的范围。',
  cell_read: '基带读不到当前锁定状态。',
  cell_write: '基带拒绝了单小区锁定请求。',
  readback: '写入后回读不一致，锁定未生效。',
  busy: '上一条指令还在执行，稍后再试。',
  ril_init: '蜂窝接口初始化失败。',
};

const pickError = (error: unknown) => {
  const text = error instanceof Error ? error.message : '';
  return ERRORS[text] || text || '操作失败';
};

const LockCellModal: React.FC<{
  cell: Cell | null;
  serving?: boolean;
  onClose: () => void;
  onDone: () => void;
}> = ({ cell, serving, onClose, onDone }) => {
  const [busy, setBusy] = useState('');
  const visible = Boolean(cell);

  const lock = async (mode: 'single') => {
    if (!cell) return;
    setBusy(mode);
    try {
      await ubus('dlink-cellular', 'cell_set', {
        rat: cell.rat,
        arfcn: String(cell.arfcn),
        pci: String(cell.pci),
        confirm: true,
      });
      Toast.success(`已锁定到 ${cellLabel(cell)}`);
      onDone();
    } catch (error) {
      Toast.error(pickError(error));
    } finally {
      setBusy('');
    }
  };

  const clear = async () => {
    setBusy('clear');
    try {
      await ubus('dlink-cellular', 'cell_clear', { confirm: true });
      await ubus('dlink-cellular', 'cell_list_clear', { confirm: true });
      Toast.success('已解除小区锁定');
      onDone();
    } catch (error) {
      Toast.error(pickError(error));
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal
      title="锁定目标小区"
      visible={visible}
      onCancel={onClose}
      width={460}
      closeOnEsc
      footer={
        <div className="lock-modal-footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="danger" loading={busy === 'clear'} onClick={clear}>
            解除锁定
          </Button>
          <Button theme="solid" type="primary" loading={busy === 'single'} onClick={() => lock('single')}>
            确认锁定
          </Button>
        </div>
      }
    >
      {cell ? (
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
              <b>{cell.rsrp} dBm</b>
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

          {serving ? (
            <Banner
              type="info"
              closeIcon={null}
              description="该小区即当前驻留小区，锁定后不会改变连接；如需限制多小区范围，建议在「锁频锁小区」页使用白名单模式。"
            />
          ) : (
            <Banner
              type="warning"
              closeIcon={null}
              description="锁定到非驻留小区会触发小区重选，蜂窝数据连接可能短暂中断。"
            />
          )}

          <Typography.Text type="tertiary" size="small">
            锁定后基带将仅尝试驻留该小区，若信号覆盖消失可能脱网。
          </Typography.Text>
        </div>
      ) : null}
    </Modal>
  );
};

export default LockCellModal;
