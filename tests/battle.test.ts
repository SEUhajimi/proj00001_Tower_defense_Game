import { describe, expect, it } from 'vitest';
import { DAMAGE_MULT } from '../src/data/combat';
import { DEFS, type DefId } from '../src/data/units';
import { Battle } from '../src/sim/battle';
import { autoDeploy, Deployment } from '../src/sim/deploy';
import { Grid } from '../src/sim/grid';
import { Rng } from '../src/sim/rng';
import { createPrototypeBattle, ENEMY_HQ_CENTER, PROTOTYPE_LOADOUT } from '../src/sim/scenario';

function runToEnd(battle: Battle, maxSeconds = 900): void {
  battle.start();
  const steps = maxSeconds / Battle.DT;
  for (let i = 0; i < steps && !battle.outcome; i++) battle.step();
}

// 小规模对战：a 方若干个在左，b 方一个在右，相距 4 格，打到一方倒光（不看胜负规则，塔也能参加）
function skirmish(a: DefId, count: number, b: DefId): DefId | null {
  const battle = new Battle(new Grid(20, 20), new Rng(1));
  const left = Array.from({ length: count }, (_, k) =>
    DEFS[a].size ? battle.spawn(a, 'player', 5, 8 + k * 2) : battle.spawn(a, 'player', 5.5, 10.5 + (k - (count - 1) / 2) * 0.6));
  const right = DEFS[b].size ? battle.spawn(b, 'enemy', 9, 10) : battle.spawn(b, 'enemy', 9.5, 10.5);
  battle.start();
  const anyLeft = () => left.some(e => e.alive);
  for (let i = 0; i < 300 / Battle.DT && anyLeft() && right.alive; i++) {
    battle.outcome = null;
    battle.step();
  }
  return anyLeft() && !right.alive ? a : right.alive && !anyLeft() ? b : null;
}

describe('克制关系', () => {
  it('步枪打坦克只有 10% 伤害', () => {
    expect(DAMAGE_MULT.bullet.armor).toBe(0.1);
  });

  it('反坦克炮塔赢一代坦克', () => {
    expect(skirmish('atTower', 1, 'tank1')).toBe('atTower');
  });

  it('机枪塔赢步枪兵', () => {
    expect(skirmish('mgTower', 1, 'rifle')).toBe('mgTower');
  });

  it('一代坦克压过机枪塔', () => {
    expect(skirmish('tank1', 1, 'mgTower')).toBe('tank1');
  });

  it('爆破兵单挑能拆反坦克炮塔', () => {
    expect(skirmish('sapper', 1, 'atTower')).toBe('sapper');
  });

  it('单个爆破兵冲不过机枪塔，一群可以', () => {
    expect(skirmish('sapper', 1, 'mgTower')).toBe('mgTower');
    expect(skirmish('sapper', 3, 'mgTower')).toBe('sapper');
  });
});

describe('受击判定', () => {
  it('射程量到建筑占地的边缘，而不是中心', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const hq = battle.spawn('hq', 'enemy', 10, 8); // 占地 x 10–13
    battle.spawn('rifle', 'player', 6.2, 9.5, 'hold'); // 离边缘 3.8 格，离中心 5.3 格；步枪射程 4
    battle.start();
    for (let i = 0; i < 40; i++) battle.step();
    expect(hq.hp).toBeLessThan(DEFS.hq.hp);
  });
});

describe('部署', () => {
  it('营地里的建筑可以紧挨着摆，但不能叠在一起', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const dep = new Deployment(battle, PROTOTYPE_LOADOUT);
    expect(dep.land(10, 10)).toBe(true);
    expect(dep.place('mgTower', 10, 10, 'hold')).not.toBeNull();
    expect(dep.canPlace('mgTower', 11, 10)).toBe(true);
    expect(dep.canPlace('mgTower', 10, 10)).toBe('这里已被占用');
  });

  it('营地不能落在建筑上', () => {
    const { deployment } = createPrototypeBattle(1);
    expect(deployment.canLand(12, 11)).toBe(false);
  });
});

describe('碉堡与地堡', () => {
  it('驻防的步兵打不到，工事被毁后弹出来', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const fort = battle.spawn('pillbox', 'enemy', 10, 10);
    const inside = battle.spawn('rifle', 'enemy', 10.5, 10.5);
    expect(battle.garrison(inside, fort)).toBe(true);
    // 坦克打工事；它的同轴机枪本来能打步兵，但打不到驻防的
    battle.spawn('tank1', 'player', 7.5, 10.5, 'hold');
    battle.start();
    while (fort.alive && battle.time < 120) { battle.outcome = null; battle.step(); }
    expect(fort.alive).toBe(false);
    expect(inside.inside).toBeNull();
    expect(inside.alive).toBe(true);
  });

  it('驻防步兵射程 +1', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const fort = battle.spawn('pillbox', 'player', 5, 10);
    const rifle = battle.spawn('rifle', 'player', 5.5, 10.5);
    battle.garrison(rifle, fort);
    const far = battle.spawn('rifle', 'enemy', 10.3, 10.5, 'hold'); // 距离 4.8 + 半径 → 超出 4，未超出 5
    far.def = { ...far.def, weapons: [] }; // 让它不还手
    battle.start();
    for (let i = 0; i < 10; i++) battle.step();
    expect(far.hp).toBeLessThan(100);
  });

  it('容量满了不能再进驻', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const fort = battle.spawn('pillbox', 'player', 5, 5);
    const units = [0, 1, 2].map(() => battle.spawn('rifle', 'player', 5.5, 5.5));
    expect(units.map(u => battle.garrison(u, fort))).toEqual([true, true, false]);
  });

  it('坦克不能进驻', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const fort = battle.spawn('bunker', 'player', 5, 5);
    expect(battle.garrison(battle.spawn('tank1', 'player', 6, 6), fort)).toBe(false);
  });

  it('部署时把步兵放到己方工事上就是进驻，撤回工事连人一起撤回', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const dep = new Deployment(battle, PROTOTYPE_LOADOUT);
    dep.land(10, 10);
    const fort = dep.place('bunker', 10, 10, 'hold')!;
    const before = dep.roster.rifle!;
    dep.place('rifle', 11, 11, 'hold');
    dep.place('rifle', 10, 10, 'hold');
    expect(fort.garrison.length).toBe(2);
    expect(dep.canPlace('tank1', 10, 10)).toBe('这里已被占用');
    dep.removeAt(10, 10);
    expect(dep.roster.rifle).toBe(before);
    expect(battle.entities.length).toBe(0);
  });
});

describe('寻路', () => {
  it('部队可以直接穿过建筑', () => {
    const grid = new Grid(10, 10);
    const battle = new Battle(grid, new Rng(1));
    for (let y = 0; y < 10; y += 2) battle.spawn('mgTower', 'enemy', 5, y);
    const path = grid.findPath(1, 5, 8, 5)!;
    expect(path.length).toBe(7); // 一路直走
  });

  it('绕开岩石', () => {
    const grid = new Grid(10, 10);
    for (let y = 0; y < 9; y++) grid.setRock(5, y);
    const path = grid.findPath(1, 1, 8, 1)!;
    expect(path).not.toBeNull();
    expect(path.some(p => Math.floor(p.y) === 9)).toBe(true);
    expect(path.every(p => !grid.isBlocked(Math.floor(p.x), Math.floor(p.y)))).toBe(true);
  });
});

describe('原型战斗', () => {
  function play(seed: number) {
    const { battle, deployment } = createPrototypeBattle(seed);
    // 选被塔覆盖最少的投送点
    let best: [number, number, number] | null = null;
    for (let y = 0; y < battle.grid.h; y++) {
      for (let x = 0; x < battle.grid.w; x++) {
        if (!deployment.canLand(x, y)) continue;
        const t = deployment.threatAt(x, y);
        if (!best || t < best[2]) best = [x, y, t];
      }
    }
    expect(best && deployment.land(best[0], best[1])).toBe(true);
    autoDeploy(deployment, ENEMY_HQ_CENTER);
    runToEnd(battle);
    return battle;
  }

  it('能分出胜负', () => {
    const results = [1, 2, 3, 4, 5].map(seed => {
      const b = play(seed);
      const left = (side: 'player' | 'enemy') => b.living(side).length;
      return `seed ${seed}: ${b.outcome} ${Math.round(b.time)}s 我方剩 ${left('player')} 敌方剩 ${left('enemy')}`;
    });
    console.log(results.join('\n'));
    for (const r of results) expect(r).toMatch(/victory|defeat/);
  });

  it('敌方驻军不会反扑出基地', () => {
    const { battle } = createPrototypeBattle(1);
    battle.spawn('rifle', 'player', 1.5, 22.5, 'hold'); // 远处角落里的我方单位，保证战斗持续
    battle.start();
    for (let i = 0; i < 600; i++) battle.step();
    expect(battle.outcome).toBeNull();
    for (const e of battle.living('enemy')) {
      expect(Math.hypot(e.x - e.postX, e.y - e.postY)).toBeLessThan(0.5);
    }
  });

  it('同一种子结果一致', () => {
    const a = play(7), b = play(7);
    expect(a.outcome).toBe(b.outcome);
    expect(a.time).toBe(b.time);
  });
});
