import { describe, expect, it } from 'vitest';
import { DAMAGE_MULT } from '../shared/data/combat';
import { RANGE_SCALE, DEFS, type DefId } from '../shared/data/units';
import { Battle } from '../shared/sim/battle';
import { autoDeploy } from '../shared/sim/deploy';
import { Grid } from '../shared/sim/grid';
import { Rng } from '../shared/sim/rng';
import { createPrototypeBattle, DROP_RING, ENEMY_HQ_CENTER, MAP_W, ENEMY_BASE_RECT } from '../shared/sim/scenario';

function runToEnd(battle: Battle, maxSeconds = 900): void {
  battle.start();
  const steps = maxSeconds / Battle.DT;
  for (let i = 0; i < steps && !battle.outcome; i++) battle.step();
}

// 小规模对战：a 方若干个在左，b 方一个在右，相距 4 格，打到一方倒光（不看胜负规则，塔也能参加）
// 两边相隔 4 个旧格子（按距离尺度换算）
function skirmish(a: DefId, count: number, b: DefId): DefId | null {
  const battle = new Battle(new Grid(80, 80), new Rng(1));
  const dx = 4 * RANGE_SCALE;
  const left = Array.from({ length: count }, (_, k) =>
    DEFS[a].size ? battle.spawn(a, 'player', 40 - dx, 38 + k * 2) : battle.spawn(a, 'player', 40.5 - dx, 40.5 + (k - (count - 1) / 2) * 0.6));
  const right = DEFS[b].size ? battle.spawn(b, 'enemy', 40, 40) : battle.spawn(b, 'enemy', 40.5, 40.5);
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
  it('只能部署在敌方基地外圈的投送区', () => {
    const { deployment } = createPrototypeBattle(1);
    expect(deployment.canPlace('rifle', 1, 1)).toBe(true);
    expect(deployment.canPlace('rifle', MAP_W - 1, 15)).toBe(true);
    expect(deployment.canPlace('rifle', DROP_RING, DROP_RING)).toBe('只能部署在敌方基地外圈的投送区');
  });

  it('出击不能修建防御塔或工事', () => {
    const { deployment } = createPrototypeBattle(1);
    expect(deployment.canPlace('mgTower', 1, 1)).toBe('出击不能修建防御塔或工事');
    expect(deployment.canPlace('bunker', 1, 1)).toBe('出击不能修建防御塔或工事');
  });

  it('一格只放一支部队，撤回后名额返还', () => {
    const { deployment } = createPrototypeBattle(1);
    const before = deployment.roster.tank2!;
    deployment.place('tank2', 1, 1, 'assault');
    expect(deployment.canPlace('rifle', 1, 1)).toBe('这里已被占用');
    deployment.removeAt(1, 1);
    expect(deployment.roster.tank2).toBe(before);
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
});

describe('命令', () => {
  it('移动：到达后就地驻守，多支部队排开不挤在一点', () => {
    const battle = new Battle(new Grid(100, 100), new Rng(1));
    const units = [0, 1, 2].map(k => battle.spawn('rifle', 'player', 2.5, 2.5 + k, 'assault'));
    battle.spawn('rifle', 'enemy', 98.5, 98.5, 'hold'); // 远处的敌人，保证战斗不结束
    battle.start();
    battle.orderMove(units.map(u => u.id), 10.5, 10.5);
    for (let i = 0; i < 600; i++) battle.step();
    for (const u of units) {
      expect(u.order).toBeNull();
      expect(u.stance).toBe('hold');
      expect(Math.hypot(u.x - 10.5, u.y - 10.5)).toBeLessThan(1.5);
    }
    const [a, b] = units;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.3);
  });

  it('集火：放着近处的步兵不打，专打指定的塔', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const me = battle.spawn('rifle', 'player', 5.5, 10.5, 'hold');
    const near = battle.spawn('rifle', 'enemy', 7.5, 10.5, 'hold');
    const tower = battle.spawn('atTower', 'enemy', 8, 12);
    near.def = { ...near.def, weapons: [] };
    tower.def = { ...tower.def, weapons: [] };
    battle.start();
    battle.orderAttack([me.id], tower.id);
    for (let i = 0; i < 100; i++) battle.step();
    expect(tower.hp).toBeLessThan(DEFS.atTower.hp);
    expect(near.hp).toBe(100);
  });

  it('集火目标在射程外就走过去打', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const me = battle.spawn('rifle', 'player', 2.5, 10.5, 'hold');
    const far = battle.spawn('rifle', 'enemy', 15.5, 10.5, 'hold');
    far.def = { ...far.def, weapons: [] };
    battle.start();
    battle.orderAttack([me.id], far.id);
    for (let i = 0; i < 400 && far.alive; i++) battle.step();
    expect(far.alive).toBe(false);
  });

  it('目标倒下后命令清空，恢复自动行动', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const me = battle.spawn('tank2', 'player', 5.5, 10.5, 'hold');
    const target = battle.spawn('rifle', 'enemy', 8.5, 10.5, 'hold');
    battle.spawn('rifle', 'enemy', 18.5, 18.5, 'hold');
    battle.start();
    battle.orderAttack([me.id], target.id);
    for (let i = 0; i < 200 && target.alive; i++) battle.step();
    battle.step();
    expect(target.alive).toBe(false);
    expect(me.order).toBeNull();
  });

  it('打不动的目标不接受集火命令（只能对空的武器打不了坦克）', () => {
    const battle = new Battle(new Grid(20, 20), new Rng(1));
    const aa = battle.spawn('rifle', 'player', 5.5, 5.5);
    aa.def = { ...aa.def, weapons: [{ dmg: 30, interval: 0.5, range: 8, type: 'aa' }] };
    const tank = battle.spawn('tank1', 'enemy', 8.5, 5.5);
    battle.orderAttack([aa.id], tank.id);
    expect(aa.order).toBeNull();
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
    autoDeploy(deployment, ENEMY_HQ_CENTER);
    expect(deployment.placed().length).toBeGreaterThan(0);
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
    battle.spawn('rifle', 'player', 1.5, MAP_W - 1.5, 'hold'); // 投送区角落里的我方单位
    battle.start();
    for (let i = 0; i < 600 && !battle.outcome; i++) {
      battle.step();
      // 驻守的敌人会去迎击，但不会追出自己的基地
      for (const e of battle.living('enemy')) {
        const { x, y, w, h } = ENEMY_BASE_RECT;
        expect(e.x > x - 1 && e.x < x + w + 1 && e.y > y - 1 && e.y < y + h + 1).toBe(true);
      }
    }
  });

  it('同一种子结果一致', () => {
    const a = play(7), b = play(7);
    expect(a.outcome).toBe(b.outcome);
    expect(a.time).toBe(b.time);
  });
});
