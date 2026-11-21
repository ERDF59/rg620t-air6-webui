import React, { useState } from 'react';
import { Button, Card, Input, Tooltip } from '@douyinfe/semi-ui';
import { IconMoon, IconSun } from '@douyinfe/semi-icons';
import { login } from '@/services/deviceUbus';

const Login: React.FC<{ onOk: () => void }> = ({ onOk }) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = React.useRef(false);
  const [dark, setDark] = useState(() => document.body.getAttribute('theme-mode') === 'dark');

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    if (next) document.body.setAttribute('theme-mode', 'dark');
    else document.body.removeAttribute('theme-mode');
    localStorage.setItem('theme-mode', next ? 'dark' : 'light');
  };

  return (
    <div className="login-shell">
      <div className="login-top-action">
        <Tooltip content={dark ? '切换到浅色模式' : '切换到深色模式'}>
          <Button
            className="app-icon-button"
            theme="borderless"
            icon={dark ? <IconSun /> : <IconMoon />}
            onClick={toggleTheme}
            aria-label="切换主题"
          />
        </Tooltip>
      </div>

      <Card className="login-card" bordered={false}>
        <div className="login-header">
          <div className="login-brand-mark">
            <img src="/rg620/logo.svg" alt="RG620T" />
          </div>
          <div className="login-brand-title">RG620T 控制台</div>
          <div className="login-brand-sub">5G CPE · MT6990 · 本机 ubus 认证</div>
        </div>

        <form className="rg-auth-form" onSubmit={async event=>{
          event.preventDefault();
          if (submitting.current) return;
          // Read the submitted DOM values, including Safari/password-manager autofill.
          const fields = new FormData(event.currentTarget);
          const user=String(fields.get('username') || '').trim();
          const password=String(fields.get('password') || '');
          if (!user || !password) {setMessage('请输入管理账号和密码。');return;}
          submitting.current=true; setBusy(true); setMessage('');
          try { await login(user, password); onOk(); }
          catch (error) { setMessage(error instanceof Error ? error.message : '登录失败'); }
          finally { submitting.current=false; setBusy(false); }
        }}>
          <label htmlFor="rg-user">用户名</label>
          <Input id="rg-user" name="username" defaultValue="root" autoComplete="username" required />
          <label htmlFor="rg-password">管理密码</label>
          <Input id="rg-password" name="password" mode="password" autoComplete="current-password"
            placeholder="请输入路由器管理密码" required aria-describedby={message?'rg-login-error':undefined}/>
          {message ? <p id="rg-login-error" role="alert" className="rg-login-error">{message}</p> : null}
          <Button htmlType="submit" theme="solid" type="primary" size="large" block loading={busy} className="login-submit">
            登录控制台
          </Button>
        </form>

        <div className="login-footer">通过本机 rpcd / ubus 验证，与 LuCI 账号密码一致</div>
      </Card>
    </div>
  );
};

export default Login;
