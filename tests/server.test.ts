import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { Auth } from '../server/auth';
import { openDb } from '../server/db';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer(createApp(openDb(':memory:')));
  await new Promise<void>(r => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api/`;
});

afterAll(() => new Promise<void>(r => server.close(() => r())));

// 一个“浏览器”：记住服务器发的 cookie
function client() {
  let cookie = '';
  return async (path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
}

describe('账号接口', () => {
  it('注册后就是登录状态，登出后不是', async () => {
    const c = client();
    expect((await c('me')).status).toBe(401);
    const r = await c('register', { username: '小明', password: 'secret1' });
    expect(r).toEqual({ status: 200, data: { username: '小明' } });
    expect((await c('me')).data).toEqual({ username: '小明' });
    await c('logout', {});
    expect((await c('me')).status).toBe(401);
  });

  it('登录：密码对了才行；用户名不分大小写', async () => {
    const c = client();
    await c('register', { username: 'Alice', password: 'secret1' });
    expect((await c('login', { username: 'alice', password: 'wrong!!' })).data.error).toBe('用户名或密码不对');
    expect((await c('login', { username: 'nobody', password: 'secret1' })).status).toBe(401);
    const ok = await c('login', { username: 'alice', password: 'secret1' });
    expect(ok).toEqual({ status: 200, data: { username: 'Alice' } });
  });

  it('用户名不能重复、要合规，密码太短不行', async () => {
    const c = client();
    await c('register', { username: 'bob', password: 'secret1' });
    expect((await c('register', { username: 'BOB', password: 'secret1' })).data.error).toBe('这个用户名已经有人用了');
    expect((await c('register', { username: 'a', password: 'secret1' })).status).toBe(400);
    expect((await c('register', { username: 'bad name!', password: 'secret1' })).status).toBe(400);
    expect((await c('register', { username: 'carol', password: '123' })).data.error).toBe('密码要 6–64 位');
  });

  it('乱发的请求不会让服务器出错', async () => {
    const res = await fetch(base + 'login', { method: 'POST', body: '{not json' });
    expect(res.status).toBe(400);
    expect((await fetch(base + 'nothing')).status).toBe(404);
    const fake = await fetch(base + 'me', { headers: { cookie: 'bg_session=deadbeef' } });
    expect(fake.status).toBe(401);
  });
});

describe('账号安全', () => {
  it('密码不存明文；连续输错 5 次锁 5 分钟', () => {
    const db = openDb(':memory:');
    let now = 1_000_000;
    const auth = new Auth(db, () => now);
    auth.register('dave', 'secret1');
    const row = db.prepare('SELECT pass_hash FROM users').get() as { pass_hash: string };
    expect(row.pass_hash).not.toContain('secret1');
    for (let i = 0; i < 5; i++) expect(auth.login('dave', 'nope')).toBe('用户名或密码不对');
    expect(auth.login('dave', 'secret1')).toBe('输错太多次了，请 5 分钟后再试');
    now += 5 * 60_000 + 1;
    expect(typeof auth.login('dave', 'secret1')).toBe('object');
  });

  it('会话 30 天后过期', () => {
    const db = openDb(':memory:');
    let now = 1_000_000;
    const auth = new Auth(db, () => now);
    const r = auth.register('erin', 'secret1');
    if (typeof r === 'string') throw new Error(r);
    expect(auth.userBySession(r.token)?.username).toBe('erin');
    now += 31 * 24 * 3600_000;
    expect(auth.userBySession(r.token)).toBeNull();
  });
});
