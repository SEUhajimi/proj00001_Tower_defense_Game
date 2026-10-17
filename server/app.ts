import type { IncomingMessage, ServerResponse } from 'node:http';
import { Auth, SESSION_DAYS, type User } from './auth';
import type { Db } from './db';
import { Game } from './game';

// HTTP 接口。全部在 /api 下，收发 JSON；登录状态靠 cookie 里的会话令牌。
//   POST /api/register  { username, password }  注册并登录
//   POST /api/login     { username, password }  登录
//   POST /api/logout                             登出
//   GET  /api/me                                 当前登录的用户
// 以下要先登录：
//   GET  /api/base                               自己的基地（结算离线生产）；还没有存档时 state 为 null
//   POST /api/base/claim    { local? }           第一次进游戏：新开局，或搬入浏览器里的单机存档
//   POST /api/base/action   { action }           基地操作（建造、征兵、研发……），返回最新状态
//   POST /api/base/reset                         重新开局
//   POST /api/base/fastForward { hours }         快进（只在开发模式）
//   POST /api/sortie/start  { aiId, roster }     开始出击，拿到种子
//   POST /api/sortie/finish { sortieId, log }    交上战斗记录，服务器重打一遍并结算
// 出错时返回 { error: '给玩家看的原因' }。

const COOKIE = 'bg_session';
const MAX_BODY = 2 * 1024 * 1024; // 搬入单机存档、战斗记录可能比较大

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  body: Record<string, unknown>;
  token: string | undefined;
  user: User | null;
}

export function createApp(db: Db, opts: { dev?: boolean; now?: () => number } = {}): Handler {
  const auth = new Auth(db, opts.now);
  const game = new Game(db, opts.now, opts.dev ?? false);
  // 要登录的接口：没登录返回 401；处理函数返回字符串就是出错原因
  const authed = (fn: (userId: number, body: Record<string, unknown>) => unknown | string) => (c: Ctx) => {
    if (!c.user) return send(c.res, 401, { error: '没有登录' });
    const r = fn(c.user.id, c.body);
    if (typeof r === 'string') send(c.res, 400, { error: r });
    else send(c.res, 200, r);
  };

  const routes: Record<string, (c: Ctx) => void> = {
    'POST /api/register': c => {
      const r = auth.register(str(c.body.username), str(c.body.password));
      if (typeof r === 'string') return send(c.res, 400, { error: r });
      setSession(c.res, r.token);
      send(c.res, 200, { username: r.user.username });
    },
    'POST /api/login': c => {
      const r = auth.login(str(c.body.username), str(c.body.password));
      if (typeof r === 'string') return send(c.res, r.includes('太多次') ? 429 : 401, { error: r });
      setSession(c.res, r.token);
      send(c.res, 200, { username: r.user.username });
    },
    'POST /api/logout': c => {
      if (c.token) auth.logout(c.token);
      c.res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      send(c.res, 200, { ok: true });
    },
    'GET /api/me': c => {
      if (!c.user) return send(c.res, 401, { error: '没有登录' });
      send(c.res, 200, { username: c.user.username });
    },
    'GET /api/base': authed(id => game.getBase(id) ?? { state: null }),
    'POST /api/base/claim': authed((id, b) => game.claim(id, b.local)),
    'POST /api/base/action': authed((id, b) => game.act(id, b.action)),
    'POST /api/base/reset': authed(id => game.reset(id)),
    'POST /api/base/fastForward': authed((id, b) => game.fastForward(id, b.hours)),
    'POST /api/sortie/start': authed((id, b) => game.startSortie(id, b.aiId, b.roster)),
    'POST /api/sortie/finish': authed((id, b) => game.finishSortie(id, b.sortieId, b.log)),
  };

  return (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const route = routes[`${req.method} ${path}`];
    if (!route) return send(res, 404, { error: '没有这个接口' });
    readBody(req).then(body => {
      if (body === null) return send(res, 400, { error: '请求格式不对' });
      const token = cookies(req)[COOKIE];
      route({ req, res, body, token, user: auth.userBySession(token) });
    }).catch(err => {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: '服务器出错了' });
    });
  };
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function setSession(res: ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// 读 JSON 请求体；GET 没有请求体时给空对象；格式不对或太大返回 null
function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}
