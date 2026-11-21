const ANON_SESSION = '00000000000000000000000000000000';
const SESSION_KEY = 'rg620_ubus_session';

/** rpcd 拒绝时的 JSON-RPC 错误码：会话失效与 ACL 不足都用它。 */
const RPC_ACCESS_DENIED = -32002;
/** 会话失效时广播，App 监听后切回登录页。 */
export const AUTH_FAILED_EVENT = 'rg620:auth-failed';

export function getSession() {
  return sessionStorage.getItem(SESSION_KEY) || '';
}

export function setSession(id: string) {
  sessionStorage.setItem(SESSION_KEY, id);
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export class UbusError extends Error {
  readonly code: number;

  constructor(message: string, code = -1) {
    super(message);
    this.name = 'UbusError';
    this.code = code;
  }
}

type RpcReply = { result?: [number, any?]; error?: { code: number; message?: string } };

async function request(session: string, object: string, method: string, params: Record<string, unknown>): Promise<RpcReply> {
  const response = await fetch('/ubus', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call',
      params: [session || ANON_SESSION, object, method, params] }),
  });
  if (!response.ok) throw new UbusError(`设备认证服务返回 HTTP ${response.status}`, response.status);
  return response.json();
}

const codeOf = (reply: RpcReply) => reply.error?.code ?? reply.result?.[0] ?? -1;
const refused = (code: number) => code === 6 || code === RPC_ACCESS_DENIED;

function expireIfCurrent(session: string): never {
  if (session !== ANON_SESSION && getSession() === session) {
    clearSession();
    window.dispatchEvent(new Event(AUTH_FAILED_EVENT));
  }
  throw new UbusError('登录已到期，请重新登录', RPC_ACCESS_DENIED);
}

async function call<T>(session: string, object: string, method: string, params: Record<string, unknown> = {}) {
  const reply = await request(session, object, method, params);
  const code = codeOf(reply);
  if (object === 'session' && method === 'login') {
    // No session exists yet. An rpcd login rejection is not an expired login.
    if (code === 6) throw new UbusError('设备未接受这个账号或密码。请使用 LuCI 的管理账号和密码，不是 Wi-Fi 密码。', code);
    if (code === RPC_ACCESS_DENIED) throw new UbusError('设备拒绝了登录请求，请检查认证服务。', code);
  } else if (session && session !== ANON_SESSION) {
    if (code === -32001) expireIfCurrent(session);
    if (refused(code)) {
      if (getSession() !== session) throw new UbusError('会话已更换，请刷新。', code);
      // Read-only check: never repeat the original operation, especially an IVR key or SMS.
      const status = await request(session, 'session', 'access', { scope:'ubus', object:'session', function:'access' });
      const statusCode = codeOf(status);
      if (statusCode === -32001 || statusCode === -32002 || statusCode === 4) expireIfCurrent(session);
      if (statusCode === 0) throw new UbusError('当前账号没有此功能的权限。', code);
      throw new UbusError('暂时无法核对会话状态，请刷新后重试。', statusCode);
    }
  }
  if (code !== 0) throw new UbusError(reply.error?.message || `设备接口返回 ${code}`, code);
  const result = reply.result?.[1] ?? {};
  if (params.confirm === true && result.ok === false) throw new UbusError(String(result.error || '设备拒绝了操作'));
  return result as T;
}

export function ubus<T>(object: string, method: string, params: Record<string, unknown> = {}) {
  return call<T>(getSession(), object, method, params);
}

export async function login(username: string, password: string) {
  const result = await call<{ ubus_rpc_session?: string }>(ANON_SESSION, 'session', 'login', {
    username: username.trim(),
    password,
    timeout: 3600,
  });
  if (!/^[0-9a-f]{32}$/i.test(result.ubus_rpc_session || '') || result.ubus_rpc_session === ANON_SESSION) throw new UbusError('没有拿到会话');
  setSession(result.ubus_rpc_session);
  return result.ubus_rpc_session;
}
