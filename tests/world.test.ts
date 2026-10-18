import { describe, expect, it } from 'vitest';
import { AI_LEVELS, aiRates, MAP_H, MAP_W, RECOVER_HOURS, STRONGHOLD_COUNT, TRIBUTE_SHARE } from '../shared/data/ai';
import { START_ARMY, TRAINING } from '../shared/data/army';
import { HALL_STORAGE } from '../shared/data/economy';
import { DEFS } from '../shared/data/units';
import { Base, newBaseState } from '../shared/sim/base/base';
import { advanceTo, step } from '../shared/sim/base/economy';
import { autoDeploy } from '../shared/sim/deploy';
import {
  advanceAi, attackable, defenseLeft, generateAiLayout, HOME_ID, slotKey, type AiBase,
} from '../shared/sim/world/ai';
import { canSortie, createAiBattle, DROP_RING, settleSortie } from '../shared/sim/world/sortie';

const T0 = 1_700_000_000_000;
const HOUR = 3600_000;

function fresh(seed = 7): Base {
  return new Base(newBaseState(seed, T0));
}

// 和主基地直接相连的一个据点
function nearby(b: Base): AiBase {
  return b.state.ai.find(a => a.links.includes(HOME_ID))!;
}

describe('世界地图', () => {
  it('据点数量对、都在地图里、彼此不太近', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const ai = fresh(seed).state.ai;
      expect(ai.length).toBe(STRONGHOLD_COUNT);
      for (const a of ai) {
        expect(a.x).toBeGreaterThan(0);
        expect(a.x).toBeLessThan(MAP_W);
        expect(a.y).toBeGreaterThan(0);
        expect(a.y).toBeLessThan(MAP_H);
        for (const o of ai) if (o !== a) expect(Math.hypot(a.x - o.x, a.y - o.y)).toBeGreaterThan(40);
      }
    }
  });

  it('道路双向、全图连通、每个据点 1–4 条路；主基地至少 2 条', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const ai = fresh(seed).state.ai;
      const home = ai.filter(a => a.links.includes(HOME_ID)).length;
      expect(home).toBeGreaterThanOrEqual(2);
      for (const a of ai) {
        expect(a.links.length).toBeGreaterThanOrEqual(1);
        expect(a.links.length).toBeLessThanOrEqual(4);
        for (const to of a.links) if (to !== HOME_ID) expect(ai.find(o => o.id === to)!.links).toContain(a.id);
      }
      const reached = new Set([HOME_ID]);
      for (let changed = true; changed;) {
        changed = false;
        for (const a of ai) if (!reached.has(a.id) && a.links.some(l => reached.has(l))) { reached.add(a.id); changed = true; }
      }
      expect(reached.size).toBe(ai.length + 1);
    }
  });

  it('等级按离主基地几段路排开（1–6 级都有）；开局只能打和主基地相连的', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const levels = new Set(fresh(seed).state.ai.map(a => a.level));
      expect(levels.has(1) && levels.has(6)).toBe(true);
    }
    const b = fresh();
    for (const a of b.state.ai) {
      if (a.links.includes(HOME_ID)) {
        expect(a.level).toBe(1);
        expect(attackable(a, b.state.ai)).toBe(true);
      } else {
        expect(a.level).toBeGreaterThan(1);
        expect(attackable(a, b.state.ai)).toBe(false);
      }
    }
  });

  it('同一个种子生成同一张地图', () => {
    expect(fresh(9).state.ai).toEqual(fresh(9).state.ai);
  });
});

describe('据点布局', () => {
  it('同一个种子每次生成一样；有指挥部，建筑不重叠，数量与等级相符', () => {
    for (const ai of fresh().state.ai) {
      const a = generateAiLayout(ai), b = generateAiLayout(ai);
      expect(a).toEqual(b);
      const lv = AI_LEVELS[ai.level];
      expect(a.buildings.filter(o => o.defId === 'hq').length).toBe(1);
      const towers = a.buildings.filter(o => DEFS[o.defId].kind === 'tower').length;
      expect(towers).toBeGreaterThanOrEqual(lv.towers - 2); // 地方太挤时允许少摆一两座
      const occ = new Set<string>();
      for (const o of a.buildings) {
        const s = DEFS[o.defId].size;
        for (let y = o.y; y < o.y + s; y++) for (let x = o.x; x < o.x + s; x++) {
          expect(occ.has(`${x},${y}`)).toBe(false);
          occ.add(`${x},${y}`);
        }
      }
      expect(a.units.length).toBe(lv.garrison + lv.planes.length);
    }
  });
});

describe('出击', () => {
  it('战场 = 据点布局 + 一圈投送区，敌方建筑和驻军都在', () => {
    const b = fresh(), ai = nearby(b);
    const fight = createAiBattle(ai, { rifle: 2 }, 1);
    const layout = generateAiLayout(ai);
    expect(fight.mapSize).toBe(layout.size + DROP_RING * 2);
    const enemyBuildings = fight.battle.living('enemy').filter(e => e.def.size > 0).length;
    expect(enemyBuildings).toBe(layout.buildings.length);
    expect(fight.deployment.canPlace('rifle', 0, 0)).toBe(true);
    expect(fight.deployment.canPlace('rifle', DROP_RING + 1, DROP_RING + 1)).toBe('只能部署在敌方基地外圈的投送区');
  });

  it('出击前检查：道路、兵力、粮食', () => {
    const b = fresh(), ai = nearby(b);
    const far = b.state.ai.find(a => !attackable(a, b.state.ai))!;
    expect(canSortie(b, far, { rifle: 2 })).toBe('没有道路通到这里，先拿下和它相连的据点');
    expect(canSortie(b, ai, {})).toBe('没有选择部队');
    expect(canSortie(b, ai, { rifle: 99 })).toBe('选择的部队超过现有兵力');
    expect(canSortie(b, ai, { rifle: 2 })).toBe(true);
    b.state.res.food = 0;
    expect(canSortie(b, ai, { rifle: 2 })).toBe('粮食耗尽，部队无法出击');
  });

  it('结算：阵亡 + 伤员 + 完好回来 = 派出的；没上场的原样回来', () => {
    const b = fresh(), ai = nearby(b);
    b.state.army = { tank2: 6, rifle: 6, sapper: 4 };
    const sent = { tank2: 6, rifle: 6, sapper: 4 };
    const fight = createAiBattle(ai, sent, 3);
    autoDeploy(fight.deployment, fight.hqCenter);
    const benched = fight.deployment.placed()[0]; // 撤回一支，让它不上场
    fight.deployment.removeAt(Math.floor(benched.x), Math.floor(benched.y));
    fight.battle.start();
    for (let i = 0; i < 18000 && !fight.battle.outcome; i++) fight.battle.step();
    const report = settleSortie(b, ai, fight, sent, T0);
    const lost = Object.values(report.lost).reduce((n, c) => n + (c ?? 0), 0);
    expect(lost + report.wounded + report.returned).toBe(16);
    expect(Object.values(b.state.army).reduce((n, c) => n + (c ?? 0), 0)).toBe(report.returned);
    expect(b.state.wounded.length).toBe(report.wounded);
    expect(report.outcome).toMatch(/victory|defeat/);
  });

  it('胜利掠夺对方 50%，仓库放不下的作废', () => {
    const b = fresh(), ai = nearby(b);
    const before = { ...ai.res };
    b.state.res.wood = HALL_STORAGE.wood - 10;
    const { loot, kept } = b.loot(ai, T0);
    expect(loot.gold).toBe(Math.floor(before.gold * 0.5));
    expect(ai.res.gold).toBe(before.gold - loot.gold);
    expect(kept.wood).toBe(10);
    expect(b.state.res.wood).toBe(HALL_STORAGE.wood);
  });

  it('撤退拿不到掠夺', () => {
    const b = fresh(), ai = nearby(b);
    const fight = createAiBattle(ai, { rifle: 2 }, 1);
    fight.deployment.place('rifle', 0, 0, 'hold');
    fight.battle.start();
    fight.battle.retreat();
    const gold = b.state.res.gold;
    const report = settleSortie(b, ai, fight, { rifle: 2 }, T0);
    expect(report.outcome).toBe('retreat');
    expect(report.loot).toBeNull();
    expect(b.state.res.gold).toBe(gold);
    expect(b.state.army.rifle).toBe(START_ARMY.rifle);
  });
});

describe('征服', () => {
  it('打掉的守军和防御记下来，下次战场上就没有了；守备值跟着降', () => {
    const b = fresh(), ai = nearby(b);
    expect(defenseLeft(ai)).toBe(1);
    const fight = createAiBattle(ai, { rifle: 1 }, 1);
    fight.deployment.place('rifle', 0, 0, 'hold');
    fight.battle.start();
    // 直接把一座塔和一个驻军打死，模拟战斗中的损失
    const tower = fight.battle.living('enemy').find(e => e.def.kind === 'tower')!;
    const unit = fight.battle.living('enemy').find(e => e.def.kind === 'infantry' && e.inside === null)!;
    tower.hp = 0;
    unit.hp = 0;
    fight.battle.step();
    fight.battle.retreat();
    const towersBefore = fight.battle.entities.filter(e => e.side === 'enemy' && e.def.kind === 'tower').length;
    const r = settleSortie(b, ai, fight, { rifle: 1 }, T0);
    expect(ai.lost).toContain(fight.slots.get(tower.id));
    expect(ai.lost).toContain(fight.slots.get(unit.id));
    expect(r.defenseAfter).toBeLessThan(r.defenseBefore);
    const again = createAiBattle(ai, { rifle: 1 }, 2);
    expect(again.battle.entities.filter(e => e.side === 'enemy' && e.def.kind === 'tower').length).toBe(towersBefore - 1);
    expect(ai.owner).toBe('ai');
  });

  it('24 小时没再打，全部恢复', () => {
    const b = fresh(), ai = nearby(b);
    ai.lost = [slotKey.building(0)];
    ai.lastAttack = T0;
    advanceAi(ai, T0 + (RECOVER_HOURS - 1) * HOUR);
    expect(ai.lost.length).toBe(1);
    advanceAi(ai, T0 + (RECOVER_HOURS + 1) * HOUR);
    expect(ai.lost.length).toBe(0);
    expect(defenseLeft(ai)).toBe(1);
  });

  it('守备打光就征服，相连的据点随之可以进攻', () => {
    const b = fresh(), ai = nearby(b);
    b.state.army = { tank2: 8, sapper: 10, rifle: 8 };
    const sent = { tank2: 8, sapper: 10, rifle: 8 };
    const fight = createAiBattle(ai, sent, 5);
    autoDeploy(fight.deployment, fight.hqCenter);
    fight.battle.start();
    // 把敌方守军和防御全部清掉（民用建筑、飞机不计入守备）
    for (const e of fight.battle.entities) if (e.side === 'enemy' && e.def.kind !== 'civil' && e.def.armor !== 'air') e.hp = 0;
    fight.battle.step();
    const r = settleSortie(b, ai, fight, sent, T0);
    expect(r.conquered).toBe(true);
    expect(ai.owner).toBe('player');
    const next = b.state.ai.find(a => a.links.includes(ai.id) && a.owner === 'ai');
    if (next) expect(attackable(next, b.state.ai)).toBe(true);
    expect(canSortie(b, ai, { rifle: 1 })).toBe('这个据点已经是你的了');
  });

  it('附属据点每小时上交产量的一半和市民，离线也照算', () => {
    const b = fresh(), ai = nearby(b);
    b.conquer(ai);
    b.state.res.stone = 0;
    b.state.pop = 0;
    for (let i = 0; i < 60; i++) step(b, 1 / 60);
    expect(b.state.res.stone).toBeCloseTo(aiRates(ai.level).stone * TRIBUTE_SHARE, 5);
    expect(b.state.pop).toBeGreaterThan(ai.level * 2 - 0.01);
    const c = fresh(), v = nearby(c);
    c.conquer(v);
    c.state.res.stone = 0;
    advanceTo(c, T0 + 2 * HOUR);
    expect(c.state.res.stone).toBeCloseTo(aiRates(v.level).stone * TRIBUTE_SHARE * 2, 3);
  });
});

describe('征兵、维修、口粮', () => {
  it('征兵扣资源、扣市民，兵力增加', () => {
    const b = fresh();
    const gold = b.state.res.gold, pop = b.state.pop;
    expect(b.recruit('rifle', 3)).toBe(true);
    expect(b.state.res.gold).toBe(gold - 90);
    expect(b.state.pop).toBe(pop - 3);
    expect(b.state.army.rifle).toBe((START_ARMY.rifle ?? 0) + 3);
    b.state.pop = 2;
    expect(b.canRecruit('tank1')).not.toBe(true);
  });

  it('士兵和市民共用住房', () => {
    const b = fresh();
    for (let i = 0; i < 600; i++) step(b, 1 / 60);
    expect(b.state.pop + b.soldierPop()).toBeLessThanOrEqual(b.popCap() + 1e-6);
  });

  it('部队每小时吃粮', () => {
    const b = fresh();
    b.state.pop = b.popCap() - b.soldierPop();
    const food = b.state.res.food;
    for (let i = 0; i < 60; i++) step(b, 1 / 60);
    expect(food - b.state.res.food).toBeCloseTo(b.armyFood(), 5);
  });

  it('维修花钱，修好的伤员回到可出击兵力', () => {
    const b = fresh();
    b.state.wounded = [{ defId: 'rifle', hp: 0.5 }];
    const gold = b.state.res.gold, rifles = b.state.army.rifle ?? 0;
    expect(b.repairAll()).toBe(true);
    expect(b.state.res.gold).toBe(gold - Math.ceil(TRAINING.rifle!.cost.gold! * 0.5 * 0.5));
    expect(b.state.army.rifle).toBe(rifles + 1);
    expect(b.state.wounded.length).toBe(0);
  });
});

describe('一级据点能打', () => {
  it('二代坦克 + 爆破兵攻打一级据点能赢', () => {
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      const b = fresh(seed), ai = nearby(b);
      const fight = createAiBattle(ai, { tank2: 4, sapper: 6, rifle: 6 }, seed);
      autoDeploy(fight.deployment, fight.hqCenter);
      fight.battle.start();
      for (let i = 0; i < 18000 && !fight.battle.outcome; i++) fight.battle.step();
      if (fight.battle.outcome === 'victory') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(2);
  });
});

describe('军工建筑', () => {
  it('征兵要有对应的建筑：步兵要兵营，坦克要战车工厂，飞机要机场', () => {
    const b = fresh();
    b.state.res.steel = 5000; b.state.res.fuel = 5000; b.state.res.stone = 5000; b.state.res.electronics = 500;
    b.state.tech.push('tank1', 'fighter1');
    expect(b.canRecruit('rifle')).toBe(true);
    expect(b.canRecruit('tank1')).toBe('需要先建造战车工厂');
    expect(b.canRecruit('fighter1')).toBe('需要先建造机场');
    const barracks = b.state.buildings.find(o => o.defId === 'barracks')!;
    expect(b.demolish(barracks.uid)).toBe(true);
    expect(b.canRecruit('rifle')).toBe('需要先建造兵营');
    const hall = b.state.buildings[0];
    expect(b.build('tankFactory', hall.x + 4, hall.y)).not.toBeTypeOf('string');
    expect(b.canRecruit('tank1')).toBe(true);
  });
});

describe('机场和机库', () => {
  it('飞机要停在机库里：每级一座机库 4 个机位，战斗机占 1 个、轰炸机占 2 个，满了要扩建（升级机场）', () => {
    const b = fresh();
    // 资源会被仓库上限截住，每步前补满
    const rich = () => { for (const r of Object.keys(b.state.res) as (keyof typeof b.state.res)[]) b.state.res[r] = 5000; };
    rich();
    b.state.pop = 100;
    b.state.tech.push('fighter1', 'bomber1');
    const hall = b.state.buildings[0];
    const field = b.build('airfield', hall.x + 4, hall.y);
    if (typeof field === 'string') throw new Error(field);
    expect(b.hangarCap()).toBe(4);
    expect(b.recruit('fighter1', 3)).toBe(true);
    expect(b.canRecruit('bomber1')).toBe('机库不够，到机场扩建机库（升级机场）');
    expect(b.recruit('fighter1', 1)).toBe(true);
    expect(b.hangarUsed()).toBe(4);
    rich();
    expect(b.upgrade(field.uid)).toBe(true);
    rich();
    expect(b.hangarCap()).toBe(8);
    expect(b.recruit('bomber1', 1)).toBe(true);
    expect(b.hangarUsed()).toBe(6);
    // 在修的伤员飞机也占机库
    b.state.army.fighter1 = 3;
    b.state.wounded.push({ defId: 'fighter1', hp: 0.5 });
    expect(b.hangarUsed()).toBe(6);
    // 兵营、战车工厂还是不能升级
    const barracks = b.state.buildings.find(o => o.defId === 'barracks')!;
    expect(b.canUpgrade(barracks.uid)).toBe('这种建筑不能升级');
  });
});
