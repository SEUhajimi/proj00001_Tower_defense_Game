import { describe, expect, it } from 'vitest';
import { DEFS } from '../shared/data/units';
import { Battle } from '../shared/sim/battle';
import { Grid } from '../shared/sim/grid';
import { Rng } from '../shared/sim/rng';

function arena(size = 40): Battle {
  return new Battle(new Grid(size, size), new Rng(1));
}

function steps(b: Battle, seconds: number): void {
  for (let i = 0; i < seconds / Battle.DT && !b.outcome; i++) b.step();
}

describe('新防御塔', () => {
  it('地雷：敌方部队踩上去就炸，炸完就没了；打不到，也不算守备', () => {
    const b = arena();
    b.spawn('hq', 'enemy', 36, 36);
    const mine = b.spawn('landmine', 'enemy', 10, 10);
    const tank = b.spawn('tank1', 'player', 5.5, 10.5, 'assault');
    b.start();
    b.orderMove([tank.id], 15.5, 10.5);
    steps(b, 10);
    expect(mine.alive).toBe(false);
    expect(tank.hp).toBeLessThan(DEFS.tank1.hp);
    // 地雷不算守备：只剩一颗地雷时进攻方已经赢了
    const c = arena();
    c.spawn('landmine', 'enemy', 30, 30);
    c.spawn('rifle', 'player', 2.5, 2.5);
    c.start();
    steps(c, 0.2);
    expect(c.outcome).toBe('victory');
  });

  it('拒马挡坦克（绕路），步兵照走', () => {
    const b = arena(20);
    b.spawn('hq', 'enemy', 16, 16);
    for (let y = 0; y < 20; y++) if (y !== 18) b.spawn('tankTrap', 'enemy', 10, y);
    const tank = b.spawn('tank1', 'player', 5.5, 5.5, 'hold');
    const rifle = b.spawn('rifle', 'player', 5.5, 6.5, 'hold');
    b.start();
    b.orderMove([tank.id], 14.5, 5.5);
    b.orderMove([rifle.id], 14.5, 6.5);
    steps(b, 40);
    expect(rifle.x).toBeGreaterThan(14);
    // 坦克要从 y = 18 的缺口绕过去，路线上一定经过那一格
    expect(tank.x).toBeGreaterThan(14);
  });

  it('铁丝网：步兵走上去速度减半', () => {
    const run = (wire: boolean) => {
      const b = arena(30);
      b.spawn('hq', 'enemy', 26, 26);
      if (wire) for (let x = 6; x < 20; x++) b.spawn('barbedWire', 'enemy', x, 5);
      const r = b.spawn('rifle', 'player', 5.5, 5.5, 'hold');
      b.start();
      b.orderMove([r.id], 19.5, 5.5);
      steps(b, 3);
      return r.x - 5.5;
    };
    expect(run(true)).toBeCloseTo(run(false) / 2, 0);
  });

  it('火箭炮一次齐射 12 发', () => {
    const b = arena(60);
    b.spawn('hq', 'player', 1, 1);
    b.spawn('mlrs', 'enemy', 20, 20);
    b.spawn('tank4', 'player', 20.5, 40.5, 'hold'); // 20 格外：在最小射程（12 格）之外
    b.start();
    let booms = 0;
    for (let i = 0; i < 10 / Battle.DT; i++) {
      b.step();
      booms += b.drainEvents().filter(e => e.type === 'boom').length;
    }
    expect(booms).toBe(12);
  });

  it('迫击炮打得远，但打不到近处', () => {
    const near = arena();
    near.spawn('mortar', 'enemy', 20, 20);
    const a = near.spawn('rifle', 'player', 21.5, 20.5, 'hold');
    near.spawn('hq', 'player', 1, 1);
    near.start();
    steps(near, 10);
    expect(a.hp).toBe(DEFS.rifle.hp);
    const far = arena(60);
    far.spawn('mortar', 'enemy', 20, 20);
    const t = far.spawn('rifle', 'player', 20.5, 40.5, 'hold'); // 20 格外（射程 44、盲区 12）
    far.spawn('hq', 'player', 1, 1);
    far.start();
    steps(far, 10);
    expect(t.hp).toBeLessThan(DEFS.rifle.hp);
  });

  it('远程防空导弹无视隐身；雷达罩住的隐身飞机也失效', () => {
    const dmgTo = (tower: 'samSite' | 'aaTower', radar: boolean) => {
      const b = arena();
      b.spawn('hq', 'player', 1, 1);
      b.spawn(tower, 'enemy', 20, 20);
      if (radar) b.spawn('radar', 'enemy', 24, 24);
      const p = b.spawn('bomber4', 'player', 20.5, 23.5);
      p.hp = 1e6;
      p.postX = p.x; p.postY = p.y;
      p.cooldowns[0] = 1e9; // 不去轰炸，原地盘旋
      b.start();
      steps(b, 6);
      return 1e6 - p.hp;
    };
    // 防空炮打隐身减半，有雷达罩着就不减
    expect(dmgTo('aaTower', true)).toBeCloseTo(dmgTo('aaTower', false) * 2, -1);
    // 导弹本来就无视隐身：一发 400 × 1.5
    expect(dmgTo('samSite', false)).toBeGreaterThanOrEqual(600);
  });

  it('雷达让周围的塔射程 +20%', () => {
    const hit = (radar: boolean) => {
      const b = arena(60);
      b.spawn('hq', 'player', 1, 1);
      b.spawn('mgTower', 'enemy', 20, 20);
      if (radar) b.spawn('radar', 'enemy', 16, 16);
      // 机枪塔射程 5×4 = 20 格；目标是一座不会动的建筑，边缘在 21.5 格外
      const t = b.spawn('civil2', 'player', 20, 42);
      b.start();
      steps(b, 3);
      return t.hp < DEFS.civil2.hp;
    };
    expect(hit(false)).toBe(false);
    expect(hit(true)).toBe(true);
  });
});
