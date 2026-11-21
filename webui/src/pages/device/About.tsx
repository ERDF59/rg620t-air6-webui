import React from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import { Kv, PageCard, TwoCol } from '@/ui/widgets';
import { TAG_COLOR } from '@/ui/tokens';

const About: React.FC = () => (
  <div className="page-stack">
    <TwoCol>
      <PageCard
        title="控制台说明"
        hint="面向移远 RG620T 模组的本机管理界面"
        extra={<Tag size="small" color={TAG_COLOR.accent}>RG620T</Tag>}
      >
        <Typography.Paragraph>
          本界面基于 React 与 Semi Design 构建，针对移远 RG620T（MT6990 / DWR-BE7200G）适配本机 ubus 接口。
        </Typography.Paragraph>
        <Typography.Paragraph type="tertiary">
          所有蜂窝遥测、锁频锁小区、拨号控制与短信收发均直接调用设备本机接口，与 LuCI 蜂窝管理同源且支持并发排队。
        </Typography.Paragraph>
      </PageCard>

      <PageCard
        title="功能边界"
        hint="当前版本未纳入的模块"
        extra={<Tag size="small" color={TAG_COLOR.neutral}>只读说明</Tag>}
      >
        <Typography.Paragraph type="tertiary">
          设备 AT 串口由系统常驻进程 atcid 独占维护，本界面不额外占用 AT 终端连接；全网扫频、定时锁频与模组 FOTA 升级暂未迁入此面板。
        </Typography.Paragraph>
      </PageCard>
    </TwoCol>

    <PageCard title="本机数据接口映射" hint="前端各页面对应的 ubus 服务">
      <Kv
        layout="rows"
        items={[
          { label: '实时信号与载波', value: 'ubus dlink-cellular overview（轮询）' },
          { label: '频段与小区锁定', value: 'ubus dlink-cellular locks / band_set / cell_set / cell_list_set' },
          { label: '短信收发与存储', value: 'ubus dlink-cellular sms_list / sms_read / sms_send' },
          { label: '语音呼叫控制', value: 'ubus dlink-cellular voice_status / voice_dial / voice_answer / voice_hangup' },
          { label: '网页通话音频', value: 'dlink-webvoice · 局域网 WebRTC' },
          { label: '接口与重拨', value: 'ubus network.interface dump · network.device status · wan_redial' },
          { label: '系统与无线射频', value: 'ubus system board / info · hostapd / iwinfo' },
        ]}
      />
    </PageCard>
  </div>
);

export default About;
