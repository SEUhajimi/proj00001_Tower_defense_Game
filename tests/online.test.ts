import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Base, newBaseState, type BaseState } from '../shared/sim/base/base';
import { exportSave } from '../shared/sim/base/save';
import { autoDeploy } from '../shared/sim/deploy';
import { replaySortie, type BattleLog } from '../shared/sim/world/replay';
import { createAiBattle, type Roster } from '../shared/sim/world/sortie';
import type { AiBase } from '../shared/sim/world/ai';
import { createApp } from '../server/app';
import { openDb } from '../server/db';

// 模拟前端打一场：自动部署、开战，中途下几条命令，把记录攒下来
function playLocally(ai: AiBase, roster: Roster, seed: number, retreatAt?: number) {
  const fight = createAiBattle(ai, roster, seed);
  autoDeploy(fight.deployment, fight.hqCenter, 'assault');
  const log: BattleLog = {
    placements: fight.deployment.placed().map(e => ({ id: e.id, defId: e.defId, x: e.x, y: e.y, stance: e.stance })),
    commands: [],
  };
  const { battle } = fight;
  battle.start();
  const mine = () => battle.living('player').filter(e => e.def.speed > 0).map(e => e.id);
  while (!battle.outcome && battle.ticks < 24000) {
    if (battle.ticks === 40) {
      const ids = mine().slice(0, 3);
      battle.setStance('player', 'hold', ids);
      log.commands.push({ step: battle.ticks, kind: 'stance', stance: 'hold', ids });
    }
    if (battle.ticks === 120) {
      const t = battle.living('enemy').find(e => e.def.kind === 'tower');
      if (t) {
        const ids = mine();
        battle.orderAttack(ids, t.id);
        log.commands.push({ step: battle.ticks, kind: 'attack', ids, targetId: t.id });
      }
    }
    if (battle.ticks === retreatAt) {
      log.commands.push({ step: battle.ticks, kind: 'retreat' });
      battle.retreat();
      break;
    }
    battle.step();
  }
  return { fight, log };
}

describe('战斗重放', () => {
  it('同样的种子和记录，重打一遍结果完全一样', () => {
    const base = new Base(newBaseState(7, 1_700_000_000_000));
    const ai = base.state.ai.find(a => a.level === 2)!;
    const roster = { tank2: 4, sapper: 6, rifle: 6, mg: 2, bomber1: 1, fighter2: 1 };
    const { fight, log } = playLocally(ai, roster, 42);
    const again = replaySortie(ai, roster, 42, log);
    if (typeof again === 'string') throw new Error(again);
    expect(again.battle.outcome).toBe(fight.battle.outcome);
    expect(again.battle.ticks).toBe(fight.battle.ticks);
    expect(again.battle.entities.map(e => Math.round(e.hp * 1000))).toEqual(fight.battle.entities.map(e => Math.round(e.hp * 1000)));
  });

  it('中途撤退也一样重放', () => {
    const base = new Base(newBaseState(7, 1_700_000_000_000));
    const ai = base.state.ai.find(a => a.level === 1)!;
    const { log } = playLocally(ai, { rifle: 6 }, 3, 200);
    const again = replaySortie(ai, { rifle: 6 }, 3, log);
    if (typeof again === 'string') throw new Error(again);
    expect(again.battle.outcome).toBe('retreat');
    expect(again.battle.ticks).toBe(200);
  });

  it('部署在敌方基地里、或超出带来的兵力，不认', () => {
    const base = new Base(newBaseState(7, 1_700_000_000_000));
    const ai = base.state.ai.find(a => a.level === 1)!;
    const inside: BattleLog = { placements: [{ id: 99, defId: 'rifle', x: 10.5, y: 10.5, stance: 'assault' }], commands: [] };
    expect(replaySortie(ai, { rifle: 1 }, 1, inside)).toBe('部署不合法');
    const tooMany: BattleLog = {
      placements: [0, 1].map(k => ({ id: k, defId: 'rifle' as const, x: k + 0.5, y: 0.5, stance: 'assault' as const })),
      commands: [],
    };
    expect(replaySortie(ai, { rifle: 1 }, 1, tooMany)).toBe('部署不合法');
  });
});

// ---------- 接口 ----------

let server: Server;
let url = '';

beforeAll(async () => {
  server = createServer(createApp(openDb(':memory:'), { dev: true }));
  await new Promise<void>(r => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}/api/`;
});

afterAll(() => new Promise<void>(r => server.close(() => r())));

async function player(name: string) {
  let cookie = '';
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() as Record<string, any> };
  };
  await call('register', { username: name, password: 'secret1' });
  return call;
}

describe('存档在服务器', () => {
  it('没登录不能读档', async () => {
    expect((await fetch(url + 'base')).status).toBe(401);
  });

  it('第一次进游戏新开局，只能领一次', async () => {
    const call = await player('p1');
    expect((await call('base')).data.state).toBeNull();
    const c = await call('base/claim', {});
    expect(c.data.state.version).toBe(3);
    expect((await call('base/claim', {})).data.error).toBe('这个账号已经有存档了');
    expect((await call('base')).data.state.seed).toBe(c.data.state.seed);
  });

  it('可以搬入浏览器里的单机存档', async () => {
    const call = await player('p2');
    const local = new Base(newBaseState(4242, Date.now()));
    local.state.res.gold = 2468;
    const c = await call('base/claim', { local: exportSave(local) });
    expect(c.data.state.seed).toBe(4242);
    expect(Math.floor(c.data.state.res.gold)).toBeGreaterThanOrEqual(2468);
  });

  it('基地操作在服务器执行并保存；做不到的返回原因和最新状态', async () => {
    const call = await player('p3');
    const { data } = await call('base/claim', {});
    const hall = (data.state as BaseState).buildings[0];
    const r = await call('base/action', { action: { type: 'build', defId: 'house', x: hall.x + 4, y: hall.y } });
    expect(r.data.error).toBeUndefined();
    expect(r.data.state.buildings.length).toBe(2);
    // 刷新后还在
    expect((await call('base')).data.state.buildings.length).toBe(2);
    const bad = await call('base/action', { action: { type: 'build', defId: 'house', x: hall.x + 4, y: hall.y } });
    expect(bad.data.error).toBe('这里已有建筑');
    expect(bad.data.state.buildings.length).toBe(2);
    expect((await call('base/action', { action: { type: 'build', defId: 'hall', x: 0, y: 0 } })).data.error).toBe('操作格式不对');
    expect((await call('base/action', { action: { type: 'setTax', rate: 5 } })).data.error).toBe('操作格式不对');
    expect((await call('base/action', { action: { type: 'research', defId: 'tank1' } })).data.error).toBe('科研点不足');
  });

  it('没打赢不能吞并', async () => {
    const call = await player('p4');
    const { data } = await call('base/claim', {});
    const aiId = (data.state as BaseState).ai[0].id;
    expect((await call('base/action', { action: { type: 'annex', aiId } })).data.error).toBe('必须先打赢这个基地，在胜利结算时吞并');
  });
});

describe('出击由服务器结算', () => {
  it('交上记录，服务器重打一遍结算；同一场不能结算两次', async () => {
    const call = await player('p5');
    const { data } = await call('base/claim', {});
    const state = data.state as BaseState;
    const ai = state.ai.find(a => a.level === 1)!;
    const roster = { rifle: 6, smg: 2, sapper: 2 };
    const start = await call('sortie/start', { aiId: ai.id, roster });
    expect(start.status).toBe(200);
    const { fight, log } = playLocally(ai, roster, start.data.seed);
    const fin = await call('sortie/finish', { sortieId: start.data.sortieId, log });
    expect(fin.status).toBe(200);
    expect(fin.data.report.outcome).toBe(fight.battle.outcome);
    const army = Object.values(fin.data.state.army as Record<string, number>).reduce((n, c) => n + c, 0);
    expect(army + fin.data.state.wounded.length + Object.values(fin.data.report.lost as Record<string, number>).reduce((n, c) => n + c, 0)).toBe(10);
    expect((await call('sortie/finish', { sortieId: start.data.sortieId, log })).data.error).toBe('这场出击已经结算过或不存在');
  });

  it('乱发的出击请求不认：兵力不够、没有的基地、不存在的出击', async () => {
    const call = await player('p6');
    const { data } = await call('base/claim', {});
    const ai = (data.state as BaseState).ai[0];
    expect((await call('sortie/start', { aiId: ai.id, roster: { tank4: 5 } })).data.error).toBe('选择的部队超过现有兵力');
    expect((await call('sortie/start', { aiId: 9999, roster: { rifle: 1 } })).data.error).toBe('没有这个 AI 基地');
    expect((await call('sortie/finish', { sortieId: 'nope', log: { placements: [], commands: [] } })).status).toBe(400);
  });

  it('开发模式可以快进', async () => {
    const call = await player('p7');
    const { data } = await call('base/claim', {});
    const r = await call('base/fastForward', { hours: 2 });
    expect(r.data.state.res.gold).toBeGreaterThan(data.state.res.gold);
  });
});
