// 和后端说话：所有接口都在 /api 下，收发 JSON，登录状态靠 cookie（浏览器自动带上）。
// 成功返回数据，失败返回给玩家看的原因（字符串）。
// 连不上服务器时进入“断线”状态，每隔几秒试一次，连上后通知页面重新同步。

export const OFFLINE_TEXT = '连不上服务器，请确认服务器已启动（npm start）';
export const EXPIRED_TEXT = '登录已过期，请重新登录';

export type Connection = 'online' | 'offline' | 'expired';
type Listener = (state: Connection) => void;
const listeners = new Set<Listener>();
let state: Connection = 'online';
let retryTimer = 0;

export function onConnection(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function connection(): Connection {
  return state;
}

function setState(next: Connection): void {
  if (next === state) return;
  state = next;
  for (const fn of listeners) fn(next);
  window.clearTimeout(retryTimer);
  if (next === 'offline') retryTimer = window.setTimeout(probe, 3000);
}

// 断线时定时探测，连上了就恢复
async function probe(): Promise<void> {
  const r = await api('me');
  if (state === 'offline') retryTimer = window.setTimeout(probe, 3000);
  void r;
}

export async function api<T>(path: string, body?: unknown): Promise<T | string> {
  let res: Response;
  try {
    res = await fetch(`api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    if (username) setState('offline');
    return OFFLINE_TEXT;
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 不是 JSON：多半是服务器没启动，开发服务器返回了网页或代理错误
  }
  if (!data || typeof data !== 'object') {
    if (username) setState('offline');
    return OFFLINE_TEXT;
  }
  // 进了游戏以后收到 401：会话过期或在别处登出了
  if (res.status === 401 && username && path !== 'login' && path !== 'register') {
    setState('expired');
    return EXPIRED_TEXT;
  }
  if (username && state === 'offline') setState('online');
  if (!res.ok) return (data as { error?: string }).error ?? `服务器出错了（${res.status}）`;
  return data as T;
}

// 当前登录的账号
let username: string | null = null;

export function currentUser(): string | null {
  return username;
}

export function setCurrentUser(name: string | null): void {
  username = name;
}

export async function logout(): Promise<void> {
  await api('logout', {});
  location.reload();
}
