import React, { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LocaleProvider } from '@douyinfe/semi-ui';
import zh_CN from '@douyinfe/semi-ui/lib/es/locale/source/zh_CN';
import DeviceLayout from '@/layout/DeviceLayout';
import { AUTH_FAILED_EVENT, getSession } from '@/services/deviceUbus';
import Login from '@/pages/device/Login';
import Network from '@/pages/device/Network';
import Settings from '@/pages/device/Settings';
import Dial from '@/pages/device/Dial';
import Voice from '@/pages/device/Voice';
import System from '@/pages/device/System';
import Sms from '@/pages/device/Sms';
import About from '@/pages/device/About';

const Engineering = React.lazy(() => import('@/pages/device/Engineering'));

const App: React.FC = () => {
  const [authed, setAuthed] = useState(() => Boolean(getSession()));

  // 会话失效（rpcd 返回 -32002）时统一退回登录页，避免卡在 Access denied。
  useEffect(() => {
    const onAuthFailed = () => setAuthed(false);
    window.addEventListener(AUTH_FAILED_EVENT, onAuthFailed);
    return () => window.removeEventListener(AUTH_FAILED_EVENT, onAuthFailed);
  }, []);

  return (
    <LocaleProvider locale={zh_CN}>
      <HashRouter>
        {authed ? (
          <Routes>
            <Route element={<DeviceLayout onLogout={() => setAuthed(false)} />}>
              <Route path="/" element={<Navigate to="/network/info" replace />} />
              <Route path="/network/info" element={<Network />} />
              <Route path="/network/setting" element={<Settings />} />
              <Route path="/network/dial" element={<Dial />} />
              <Route path="/network/voice" element={<Voice />} />
              <Route path="/system/info" element={<System />} />
              <Route path="/sms/center" element={<Sms />} />
              <Route path="/engineering" element={<React.Suspense fallback={<p className="empty-surface">正在打开工程工具…</p>}><Engineering /></React.Suspense>} />
              <Route path="/at" element={<About />} />
              <Route path="*" element={<Navigate to="/network/info" replace />} />
            </Route>
          </Routes>
        ) : (
          <Login onOk={() => setAuthed(true)} />
        )}
      </HashRouter>
    </LocaleProvider>
  );
};

export default App;
