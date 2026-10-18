import { describe, expect, it } from 'vitest';
import { AI_ATTACK, AI_LEVELS } from '../shared/data/ai';
import { START_TECH, TECH_STAGES } from '../shared/data/tech';
import { DEFS } from '../shared/data/units';
import { Base, newBaseState } from '../shared/sim/base/base';
import { Battle } from '../shared/sim/battle';
import { Grid } from '../shared/sim/grid';
import { Rng } from '../shared/sim/rng';
import { createDrill, DRILL_TIME_LIMIT } from '../shared/sim/world/drill';
import { troopLayout } from '../shared/sim/base/troops';
import { generateAiLayout } from '../shared/sim/world/ai';

const T0 = 1_700_000_000_000;

function arena(size = 24): Battle {
  const b = new Battle(new Grid(size, size), new Rng(1));
  return b;
}

function run(b: Battle, seconds: number): void {
  b.start();
  for (let i = 0; i < seconds / Battle.DT && !b.outcome; i++) b.step();
}

describe('飞机', () => {
  it('步枪打不到飞机，防空炮能打下来', () => {
    const b = arena();
    const plane = b.spawn('fighter1', 'player', 3.5, 3.5);
    b.spawn('rifle', 'enemy', 4.5, 4.5);
    b.spawn('hq', 'enemy', 18, 18);
    b.start();
    for (let i = 0; i < 40; i++) b.step();
    expect(plane.hp).toBe(DEFS.fighter1.hp);

    const c = arena();
    const bomber = c.spawn('bomber1', 'player', 10.5, 10.5);
    c.spawn('aaTower', 'enemy', 10, 12);
    c.spawn('hq', 'enemy', 20, 20);
    run(c, 30);
    expect(bomber.alive).toBe(false);
  });

  it('隐身飞机受防空伤害减半', () => {
    const hits = (id: 'fighter4' | 'fighter5') => {
      const b = arena();
      const p = b.spawn(id, 'player', 12.5, 12.5);
      b.spawn('aaTower', 'enemy', 12, 14);
      b.spawn('hq', 'enemy', 1, 1);
      b.start();
      // 只看第一发：防空炮第一帧就开火
      b.step();
      return DEFS[id].hp - p.hp;
    };
    expect(hits('fighter5')).toBeCloseTo(hits('fighter4') / 2, 5);
  });

  it('轰炸机听命令轰炸塔，一轮炸掉一座机枪塔，然后返航', () => {
    const b = arena();
    const bomber = b.spawn('bomber1', 'player', 2.5, 2.5);
    const tower = b.spawn('mgTower', 'enemy', 14, 14);
    b.spawn('hq', 'enemy', 20, 20);
    b.start();
    b.orderAttack([bomber.id], tower.id);
    for (let i = 0; i < 200 && tower.alive; i++) b.step();
    expect(tower.alive).toBe(false);
    for (let i = 0; i < 200; i++) b.step();
    expect(Math.hypot(bomber.x - 2.5, bomber.y - 2.5)).toBeLessThan(0.1);
  });

  it('玩家的轰炸机没有命令就待在起飞点', () => {
    const b = arena();
    const bomber = b.spawn('bomber1', 'player', 2.5, 2.5);
    const tower = b.spawn('mgTower', 'enemy', 14, 14);
    b.start();
    for (let i = 0; i < 200; i++) b.step();
    expect(tower.hp).toBe(DEFS.mgTower.hp);
    expect(bomber.x).toBeCloseTo(2.5);
  });

  it('战斗机自动来回投弹，能炸毁建筑', () => {
    const b = arena();
    b.spawn('fighter3', 'player', 2.5, 2.5);
    b.spawn('fighter3', 'player', 3.5, 2.5);
    const hq = b.spawn('hq', 'enemy', 12, 12);
    run(b, 120);
    expect(hq.alive).toBe(false);
    expect(b.outcome).toBe('victory');
  });

  it('敌方飞机不挡胜利：地面目标打光就算赢', () => {
    const b = arena();
    b.spawn('tank2', 'player', 2.5, 2.5, 'assault');
    b.spawn('mgTower', 'enemy', 8, 8);
    b.spawn('fighter1', 'enemy', 20.5, 20.5);
    run(b, 120);
    expect(b.outcome).toBe('victory');
  });

  it('AI 基地按等级配飞机', () => {
    const base = new Base(newBaseState(7, T0));
    for (const ai of base.state.ai) {
      const planes = generateAiLayout(ai).units.filter(u => DEFS[u.defId].armor === 'air');
      expect(planes.length).toBe(AI_LEVELS[ai.level].planes.length);
    }
  });
});

describe('科技树', () => {
  function rich(): Base {
    const b = new Base(newBaseState(7, T0));
    b.state.research = 1e6;
    b.state.res.gold = 1e6;
    return b;
  }

  it('开局只有第一阶段；没研发的兵种不能征召，没研发的塔不能建', () => {
    const b = rich();
    expect(b.state.tech).toEqual(START_TECH);
    expect(b.canRecruit('tank1')).toBe('尚未研发');
    expect(b.canRecruit('rifle')).toBe(true);
    const hall = b.state.buildings[0];
    expect(b.canBuild('atTower', hall.x + 4, hall.y)).toBe('尚未研发');
  });

  it('研发扣科研点和金币', () => {
    const b = rich();
    expect(b.research('tank1')).toBe(true);
    expect(b.state.research).toBe(1e6 - TECH_STAGES[1].research);
    expect(b.state.res.gold).toBe(1e6 - TECH_STAGES[1].gold);
    expect(b.canRecruit('tank1')).not.toBe('尚未研发');
    expect(b.research('tank1')).toBe('已研发');
  });

  it('上一阶段研发过半才开放下一阶段；高一代要先有低一代', () => {
    const b = rich();
    expect(b.canResearch('sniper')).toBe('上一阶段研发过半后开放');
    b.research('mg');
    b.research('atTower');
    expect(b.canResearch('sniper')).toBe('上一阶段研发过半后开放');
    b.research('aaTower');
    expect(b.canResearch('sniper')).toBe(true);
    expect(b.canResearch('tank2')).toBe('需要先研发一代坦克 T-55');
  });

  it('科研点不够不能研发', () => {
    const b = new Base(newBaseState(7, T0));
    b.state.res.gold = 1e6;
    expect(b.canResearch('mg')).toBe('科研点不足');
  });
});

describe('演习', () => {
  it('战场是自己的基地，进攻方由电脑部署在外圈；打完存档不变', () => {
    const base = new Base(newBaseState(7, T0));
    const hall = base.state.buildings[0];
    base.state.res.steel = 1000;
    base.state.res.ammo = 1000;
    expect(base.build('mgTower', hall.x + 4, hall.y)).not.toBeTypeOf('string');
    expect(base.build('pillbox', hall.x - 2, hall.y)).not.toBeTypeOf('string');
    // 把三个步枪兵移到碉堡上：两个进驻，第三个满了站在旁边
    const onFort = [0, 1, 2].map(i => ({ defId: 'rifle' as const, i, x: hall.x - 1.5, y: hall.y + 0.5 }));
    expect(base.moveTroops(onFort)).toBe(true);
    const before = JSON.stringify(base.state);

    const drill = createDrill(base, AI_ATTACK[2], 1);
    const { battle, deployment } = drill;
    expect(battle.attacker).toBe('enemy');
    const mine = battle.living('player');
    expect(mine.filter(e => e.def.size > 0).length).toBe(base.state.buildings.length);
    expect(mine.some(e => e.def.kind === 'hq')).toBe(true);
    // 站在碉堡上的步兵进驻了，部队总数不变
    expect(mine.find(e => e.defId === 'pillbox')!.garrison.length).toBe(2);
    const army = Object.values(base.state.army).reduce((n, c) => n + (c ?? 0), 0);
    expect(mine.filter(e => e.def.speed > 0).length).toBe(army);
    const placed = deployment.placed();
    expect(placed.length).toBe(Object.values(AI_ATTACK[2]).reduce((n, c) => n + (c ?? 0), 0));
    expect(placed.every(e => e.side === 'enemy' && deployment.inDropZone(Math.floor(e.x), Math.floor(e.y)))).toBe(true);

    run(battle, DRILL_TIME_LIMIT + 1);
    expect(battle.outcome).toMatch(/victory|defeat/);
    expect(JSON.stringify(base.state)).toBe(before);
  });

  it('什么都没有的新基地挡不住 6 级 AI 的军队', () => {
    const base = new Base(newBaseState(7, T0));
    const { battle } = createDrill(base, AI_ATTACK[6], 1);
    run(battle, DRILL_TIME_LIMIT + 1);
    expect(battle.outcome).toBe('defeat');
  });

  it('超时算防守成功', () => {
    const base = new Base(newBaseState(7, T0));
    // 进攻方只有一个在角落驻守的狙击兵，谁也打不到
    const { battle, deployment } = createDrill(base, { sniper: 1 }, 1);
    const auto = deployment.placed()[0];
    deployment.removeAt(Math.floor(auto.x), Math.floor(auto.y));
    const sniper = deployment.place('sniper', 0, 0, 'hold');
    expect(sniper).not.toBeNull();
    run(battle, DRILL_TIME_LIMIT + 1);
    expect(battle.outcome).toBe('victory');
  });
});

describe('基地里的部队', () => {
  it('没移动过的站在出厂建筑旁边、不压建筑；移动后记住位置；飞机停在飞机工厂上', () => {
    const base = new Base(newBaseState(7, T0));
    const layout = troopLayout(base);
    const army = Object.values(base.state.army).reduce((n, c) => n + (c ?? 0), 0);
    expect(layout.length).toBe(army);
    for (const t of layout) {
      expect(base.ownsTile(Math.floor(t.x), Math.floor(t.y))).toBe(true);
      expect(base.buildingAt(Math.floor(t.x), Math.floor(t.y))).toBeUndefined();
    }
    const hall = base.state.buildings[0];
    expect(base.moveTroops([{ defId: 'rifle', i: 0, x: hall.x + 5.5, y: hall.y + 5.5 }])).toBe(true);
    expect(troopLayout(base).find(t => t.defId === 'rifle' && t.i === 0)).toMatchObject({ x: hall.x + 5.5, y: hall.y + 5.5 });
    expect(base.moveTroops([{ defId: 'rifle', i: 0, x: 0.5, y: 0.5 }])).toBe('只能移动到自己的领地里');
    expect(base.moveTroops([{ defId: 'rifle', i: 99, x: hall.x + 5.5, y: hall.y + 5.5 }])).toBe('没有这支部队');

    base.state.res.stone = 1000; base.state.res.steel = 1000; base.state.res.electronics = 100;
    const field = base.build('airfield', hall.x + 4, hall.y);
    if (typeof field === 'string') throw new Error(field);
    base.state.army.fighter1 = 2;
    const planes = troopLayout(base).filter(t => t.plane);
    expect(planes.length).toBe(2);
    for (const p of planes) expect(base.buildingAt(Math.floor(p.x), Math.floor(p.y))?.defId).toBe('airfield');
    expect(base.moveTroops([{ defId: 'fighter1', i: 0, x: hall.x + 5.5, y: hall.y + 5.5 }])).toBe('飞机停在机场，不能移动');
  });
});
