import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

// 账号：用户名 + 密码。密码加盐用 scrypt 加密后保存，不存明文；
// 登录成功发一个随机会话令牌，放在浏览器 cookie 里，30 天有效。

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 3600_000;
const MAX_FAILS = 5; // 同一个用户名连续输错这么多次，暂时锁住
const LOCK_MS = 5 * 60_000;

export interface User {
  id: number;
  username: string;
}

export function checkUsername(name: string): true | string {
  if (!/^[\p{L}\p{N}_]{2,16}$/u.test(name)) return '用户名要 2–16 个字，只能用中文、字母、数字和下划线';
  return true;
}

export function checkPassword(pw: string): true | string {
  if (pw.length < 6 || pw.length > 64) return '密码要 6–64 位';
  return true;
}

function hash(pw: string, salt: string): string {
  return scryptSync(pw, salt, 32).toString('hex');
}

export class Auth {
  // 登录失败计数（只在内存里，重启清零）：用户名 → 次数和第一次失败的时间
  private fails = new Map<string, { n: number; since: number }>();

  constructor(private db: Db, private now: () => number = Date.now) {}

  register(username: string, password: string): { user: User; token: string } | string {
    const u = checkUsername(username);
    if (u !== true) return u;
    const p = checkPassword(password);
    if (p !== true) return p;
    if (this.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return '这个用户名已经有人用了';
    const salt = randomBytes(16).toString('hex');
    const r = this.db.prepare('INSERT INTO users (username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)')
      .run(username, hash(password, salt), salt, this.now());
    const user = { id: Number(r.lastInsertRowid), username };
    return { user, token: this.newSession(user.id) };
  }

  login(username: string, password: string): { user: User; token: string } | string {
    const key = username.toLowerCase();
    const f = this.fails.get(key);
    if (f && f.n >= MAX_FAILS && this.now() - f.since < LOCK_MS) return '输错太多次了，请 5 分钟后再试';
    const row = this.db.prepare('SELECT id, username, pass_hash, salt FROM users WHERE username = ?').get(username) as
      { id: number; username: string; pass_hash: string; salt: string } | undefined;
    const ok = !!row && timingSafeEqual(Buffer.from(hash(password, row.salt), 'hex'), Buffer.from(row.pass_hash, 'hex'));
    if (!ok) {
      const cur = f && this.now() - f.since < LOCK_MS ? f : { n: 0, since: this.now() };
      this.fails.set(key, { n: cur.n + 1, since: cur.since });
      return '用户名或密码不对';
    }
    this.fails.delete(key);
    return { user: { id: row.id, username: row.username }, token: this.newSession(row.id) };
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  // 令牌有效就返回用户，顺便清掉过期的会话
  userBySession(token: string | undefined): User | null {
    if (!token) return null;
    const row = this.db.prepare(
      'SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
    ).get(token) as { id: number; username: string; expires_at: number } | undefined;
    if (!row) return null;
    if (row.expires_at < this.now()) {
      this.logout(token);
      return null;
    }
    return { id: row.id, username: row.username };
  }

  private newSession(userId: number): string {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(this.now());
    this.db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, this.now() + SESSION_MS);
    return token;
  }
}
