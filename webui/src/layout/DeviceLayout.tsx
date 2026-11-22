import React, { useEffect, useState } from 'react';
import { Button, Layout, Tooltip } from '@douyinfe/semi-ui';
import {
  IconComment,
  IconExit,
  IconGlobeStroke,
  IconInfoCircle,
  IconLock,
  IconMenu,
  IconMoon,
  IconPhone,
  IconServer,
  IconSignal,
  IconSun,
  IconSetting,
} from '@douyinfe/semi-icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { clearSession } from '@/services/deviceUbus';
import { maxWidth } from '@/ui/tokens';
import { CellularEventsProvider } from '@/modules/cellular/stream';
import IncomingAlerts from '@/modules/alerts/IncomingAlerts';

const { Header, Sider, Content, Footer } = Layout;

type NavItem = {
  path: string;
  label: string;
  icon: React.ReactNode;
};

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: '蜂窝网络',
    items: [
      { path: '/network/info', label: '网络状态', icon: <IconSignal /> },
      { path: '/network/setting', label: '锁频锁小区', icon: <IconLock /> },
      { path: '/network/dial', label: '拨号与接口', icon: <IconGlobeStroke /> },
      { path: '/network/voice', label: '语音通话', icon: <IconPhone /> },
    ],
  },
  {
    title: '通信与设备',
    items: [
      { path: '/sms/center', label: '短信中心', icon: <IconComment /> },
      { path: '/system/info', label: '设备信息', icon: <IconServer /> },
      { path: '/engineering', label: '工程工具', icon: <IconSetting /> },
      { path: '/at', label: '关于设备', icon: <IconInfoCircle /> },
    ],
  },
];

const PAGE_META: Record<string, { title: string; desc: string }> = {
  '/network/info': { title: '网络状态', desc: '实时信号、载波聚合与吞吐遥测' },
  '/network/setting': { title: '锁频锁小区', desc: '频段控制、单小区锁定与白名单' },
  '/network/dial': { title: '拨号与接口', desc: '蜂窝承载、地址分配与链路状态' },
  '/network/voice': { title: '语音通话', desc: '呼叫控制、拨号键盘与 IMS 状态' },
  '/system/info': { title: '设备信息', desc: '硬件负载、基带版本与无线射频' },
  '/sms/center': { title: '短信中心', desc: '收发短信与 SIM 存储管理' },
  '/engineering': { title: '工程工具', desc: '基带查询、射频设置与在线扫小区' },
  '/at': { title: '关于设备', desc: '接口架构与本机服务说明' },
};

const DeviceLayout: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery(maxWidth('sm'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme-mode');
    const isDark = saved === 'dark' || document.body.getAttribute('theme-mode') === 'dark';
    if (isDark) document.body.setAttribute('theme-mode', 'dark');
    else document.body.removeAttribute('theme-mode');
    return isDark;
  });

  const page = PAGE_META[location.pathname] || { title: '设备管理', desc: 'RG620T 5G CPE' };

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    if (next) document.body.setAttribute('theme-mode', 'dark');
    else document.body.removeAttribute('theme-mode');
    localStorage.setItem('theme-mode', next ? 'dark' : 'light');
  };

  return (
    <CellularEventsProvider>
    <Layout className="app-shell">
      <Sider
        className={[
          'app-sider',
          isMobile ? 'app-sider--mobile' : '',
          isMobile && mobileOpen ? 'app-sider--open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="app-sider-inner">
          <div className="app-brand">
            <div className="app-brand-mark">
              <img src="/rg620/logo.svg" alt="RG620T" />
            </div>
            <div className="app-brand-copy">
              <div className="app-brand-title">RG620T</div>
              <div className="app-brand-sub">5G CPE · MT6990</div>
            </div>
          </div>

          <nav className="app-nav" aria-label="主导航">
            {NAV_GROUPS.map((group) => (
              <div className="app-nav-group" key={group.title}>
                <div className="app-nav-group-label">{group.title}</div>
                <div className="app-nav-list">
                  {group.items.map((item) => {
                    const active = location.pathname === item.path;
                    return (
                      <button
                        type="button"
                        key={item.path}
                        className={`app-nav-item${active ? ' is-active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => {
                          navigate(item.path);
                          setMobileOpen(false);
                        }}
                      >
                        <span className="app-nav-icon" aria-hidden="true">
                          {item.icon}
                        </span>
                        <span className="app-nav-label">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="app-sider-footer">
            <div className="sider-status-card">
              <span className="status-dot ok" aria-hidden="true" />
              <div className="sider-status-copy">
                <div className="sider-status-title">dlink-cellular</div>
                <div className="sider-status-sub">本机 ubus 接口已连接</div>
              </div>
            </div>
          </div>
        </div>
      </Sider>

      {isMobile && mobileOpen ? (
        <div className="app-scrim" aria-hidden="true" onClick={() => setMobileOpen(false)} />
      ) : null}

      <Layout className="app-main">
        <Header className="app-header">
          <div className="app-header-left">
            {isMobile ? (
              <Button
                className="app-icon-button"
                theme="borderless"
                icon={<IconMenu />}
                onClick={() => setMobileOpen((value) => !value)}
                aria-label={mobileOpen ? '关闭导航' : '打开导航'}
              />
            ) : null}
            <div className="app-header-title">
              <h1 className="app-header-name">{page.title}</h1>
              <span className="app-header-desc">{page.desc}</span>
            </div>
          </div>
          <div className="app-header-right">
            <span className="at-status at-status--connected" title="数据来自本机 dlink-cellular" role="status">
              <span className="status-dot ok" aria-hidden="true" />
              <span className="at-status-label at-status-label--full">本机接口</span>
              <span className="at-status-label at-status-label--compact">在线</span>
            </span>
            <Tooltip content={dark ? '切换到浅色模式' : '切换到深色模式'}>
              <Button
                className="app-icon-button"
                theme="borderless"
                icon={dark ? <IconSun /> : <IconMoon />}
                onClick={toggleTheme}
                aria-label="切换主题"
              />
            </Tooltip>
            <Tooltip content="退出登录">
              <Button
                className="app-icon-button"
                theme="borderless"
                icon={<IconExit />}
                onClick={() => {
                  clearSession();
                  onLogout();
                }}
                aria-label="退出登录"
              />
            </Tooltip>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
        <Footer className="app-footer">RG620T · DWR-BE7200G · 蜂窝数据来自本机接口</Footer>
      </Layout>
      <IncomingAlerts />
    </Layout>
    </CellularEventsProvider>
  );
};

export default DeviceLayout;
