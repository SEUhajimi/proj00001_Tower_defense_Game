import { describe, expect, it } from 'vitest';
import { AI_LEVELS, AI_SPAWN } from '../src/data/ai';
import { START_ARMY, TRAINING } from '../src/data/army';
import { HALL_STORAGE } from '../src/data/economy';
import { DEFS } from '../src/data/units';
import { Base, newBaseState } from '../src/sim/base/base';
import { step } from '../src/sim/base/economy';
import { REGION_PLOTS, START_PLOT } from '../src/sim/base/terrain';
import { autoDeploy } from '../src/sim/deploy';
import { aiPlots, aiRect, generateAiLayout, isProtected, type AiBase } from '../src/sim/world/ai';
import { canSortie, createAiBattle, DROP_RING, settleSortie } from '../src/sim/world/sortie';

const T0 = 1_700_000_000_000;
const HOUR = 3600_000;

function fresh(seed = 7): Base {
  return new Base(newBaseState(seed, T0));
}

function overlap(a: AiBase, b: { px: number; py: number; s: number }, margin = 0): boolean {
  const s = aiPlots(a);
  return a.px < b.px + b.s + margin && b.px < a.px + s + margin && a.py < b.py + b.s + margin && b.py < a.py + s + margin;
}

describe('世界地图', () => {
  it('AI 基地按设定数量生成，互不重叠，不贴着玩家开局领地', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const ai = fresh(seed).state.ai;
      expect(ai.length).toBe(AI_SPAWN.reduce((n, [, c]) => n + c, 0));
      for (const a of ai) {
        expect(a.px).toBeGreaterThanOrEqual(0);
        expect(a.px + aiPlots(a)).toBeLessThanOrEqual(REGION_PLOTS);
        expect(overlap(a, { px: START_PLOT.x0, py: START_PLOT.y0, s: START_PLOT.size }, 2)).toBe(false);
        for (const b of ai) if (a !== b) expect(overlap(a, { px: b.px, py: b.py, s: aiPlots(b) })).toBe(false);
      }
    }
  });

  it('等级越高离玩家越远', () => {
    const ai = fresh().state.ai;
    const dist = (a: AiBase) => Math.hypot(a.px + aiPlots(a) / 2 - 19.5, a.py + aiPlots(a) / 2 - 19.5);
    const avg = (lv: number) => {
      const xs = ai.filter(a => a.level === lv).map(dist);
      return xs.reduce((s, d) => s + d, 0) / xs.length;
    };
    expect(avg(1)).toBeLessThan(avg(3));
    expect(avg(3)).toBeLessThan(avg(6));
  });

  it('不能买 AI 基地的地', () => {
    const b = fresh();
    const ai = b.state.ai[0];
    expect(b.canBuyPlot(ai.py * REGION_PLOTS + ai.px)).toBe('这是 AI 基地的领地，打下来才能吞并');
  });
});

describe('AI 基地布局', () => {
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
      expect(a.units.length).toBe(lv.garrison);
    }
  });
});

describe('出击', () => {
  function level1(b: Base): AiBase {
    return b.state.ai.find(a => a.level === 1)!;
  }

  it('战场 = AI 基地 + 一圈投送区，敌方建筑和驻军都在', () => {
    const b = fresh(), ai = level1(b);
    const fight = createAiBattle(ai, { rifle: 2 }, 1);
    expect(fight.mapSize).toBe(aiRect(ai).size + DROP_RING * 2);
    const layout = generateAiLayout(ai);
    const enemyBuildings = fight.battle.living('enemy').filter(e => e.def.size > 0).length;
    expect(enemyBuildings).toBe(layout.buildings.length);
    expect(fight.deployment.canPlace('rifle', 0, 0)).toBe(true);
    expect(fight.deployment.canPlace('rifle', DROP_RING + 1, DROP_RING + 1)).toBe('只能部署在敌方基地外圈的投送区');
  });

  it('出击前检查：兵力、免战、粮食', () => {
    const b = fresh(), ai = level1(b);
    expect(canSortie(b, ai, {}, T0)).toBe('没有选择部队');
    expect(canSortie(b, ai, { rifle: 99 }, T0)).toBe('选择的部队超过现有兵力');
    expect(canSortie(b, ai, { rifle: 2 }, T0)).toBe(true);
    b.state.res.food = 0;
    expect(canSortie(b, ai, { rifle: 2 }, T0)).toBe('粮食耗尽，部队无法出击');
    b.state.res.food = 100;
    ai.protectedUntil = T0 + HOUR;
    expect(canSortie(b, ai, { rifle: 2 }, T0)).toMatch(/免战/);
  });

  it('结算：阵亡 + 伤员 + 完好回来 = 派出的；没上场的原样回来', () => {
    const b = fresh(), ai = level1(b);
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

  it('胜利掠夺对方 50%，仓库放不下的作废；对方进入 24 小时免战', () => {
    const b = fresh(), ai = level1(b);
    const before = { ...ai.res };
    b.state.res.wood = HALL_STORAGE.wood - 10;
    const { loot, kept } = b.loot(ai, T0);
    expect(loot.gold).toBe(Math.floor(before.gold * 0.5));
    expect(ai.res.gold).toBe(before.gold - loot.gold);
    expect(kept.wood).toBe(10);
    expect(b.state.res.wood).toBe(HALL_STORAGE.wood);
    expect(isProtected(ai, T0 + 23 * HOUR)).toBe(true);
    expect(isProtected(ai, T0 + 25 * HOUR)).toBe(false);
  });

  it('撤退拿不到掠夺', () => {
    const b = fresh(), ai = level1(b);
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

describe('吞并', () => {
  it('不相邻不能吞并；相邻时花钱吞并，地块和建筑归玩家，市政厅拆掉', () => {
    const b = fresh();
    const ai = b.state.ai.find(a => a.level === 1)!;
    expect(b.canAnnex(ai)).toBe('只能吞并与领地相邻的基地');
    // 直接把 AI 基地旁边的一块地划给玩家，模拟领地扩张到了它旁边
    const nextTo = ai.py * REGION_PLOTS + ai.px - 1;
    b.state.owned.push(nextTo);
    const c = new Base(b.state);
    const ai2 = c.getAi(ai.id)!;
    c.state.res.gold = 10_000_000;
    const cost = c.annexCost(ai2);
    const buildings = c.state.buildings.length;
    const layout = generateAiLayout(ai2);
    expect(c.annex(ai2)).toBe(true);
    expect(c.state.res.gold).toBe(10_000_000 - cost);
    expect(c.getAi(ai.id)).toBeUndefined();
    expect(c.ownsPlot(ai.py * REGION_PLOTS + ai.px)).toBe(true);
    expect(c.state.buildings.length).toBe(buildings + layout.buildings.length - 1);
    expect(c.state.buildings.filter(o => o.defId === 'hall').length).toBe(1);
  });
});

describe('一级 AI 基地能打', () => {
  it('二代坦克 + 爆破兵攻打一级基地能赢', () => {
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      const b = fresh(seed), ai = b.state.ai.find(a => a.level === 1)!;
      const fight = createAiBattle(ai, { tank2: 4, sapper: 6, rifle: 6 }, seed);
      autoDeploy(fight.deployment, fight.hqCenter);
      fight.battle.start();
      for (let i = 0; i < 18000 && !fight.battle.outcome; i++) fight.battle.step();
      if (fight.battle.outcome === 'victory') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(2);
  });
});
