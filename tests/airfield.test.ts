import { describe, expect, it } from 'vitest';
import { footprint } from '../shared/data/economy';
import { parseAction } from '../shared/sim/base/actions';
import { parkPlanes } from '../shared/sim/base/airfield';
import { Base, newBaseState, type PlacedBuilding } from '../shared/sim/base/base';
import { parseSave } from '../shared/sim/base/save';
import { troopLayout } from '../shared/sim/base/troops';
import { Battle } from '../shared/sim/battle';
import { Grid } from '../shared/sim/grid';
import { Rng } from '../shared/sim/rng';
import { createDrill } from '../shared/sim/world/drill';

const T0 = 1_700_000_000_000;

function rich(b: Base): void {
  for (const r of Object.keys(b.state.res) as (keyof typeof b.state.res)[]) b.state.res[r] = 5000;
}

// 市政厅旁边建一座机场
function withAirfield(rot: 0 | 1 = 0): { b: Base; field: PlacedBuilding } {
  const b = new Base(newBaseState(7, T0));
  rich(b);
  const hall = b.state.buildings[0];
  const field = b.build('airfield', hall.x + 4, hall.y, rot);
  if (typeof field === 'string') throw new Error(field);
  return { b, field };
}

// 演习：进攻方只有一辆坦克，躲在角落驻守——战斗不会很快结束，也碰不到机场
function quietDrill(b: Base): Battle {
  const { battle, deployment } = createDrill(b, { tank4: 1 }, 1);
  const auto = deployment.placed()[0];
  deployment.removeAt(Math.floor(auto.x), Math.floor(auto.y));
  deployment.place('tank4', 0, 0, 'hold');
  return battle;
}

function steps(b: Battle, seconds: number): void {
  for (let i = 0; i < seconds / Battle.DT && !b.outcome; i++) b.step();
}

describe('机场占地（8×4，可以转向）', () => {
  it('长边沿 x 占 8×4 格，转 90° 后占 4×8 格', () => {
    expect(footprint('airfield', 0)).toEqual({ w: 8, h: 4 });
    expect(footprint('airfield', 1)).toEqual({ w: 4, h: 8 });
    expect(footprint('house', 1)).toEqual({ w: 2, h: 2 }); // 正方形转了也一样
    for (const rot of [0, 1] as const) {
      const { b, field } = withAirfield(rot);
      const { w, h } = footprint('airfield', rot);
      expect(b.buildingAt(field.x + w - 1, field.y + h - 1)?.uid).toBe(field.uid);
      expect(b.buildingAt(field.x + w, field.y)?.uid).not.toBe(field.uid);
      expect(b.buildingAt(field.x, field.y + h)?.uid).not.toBe(field.uid);
    }
  });

  it('移动时可以换朝向，不给朝向就保持原样；操作里的朝向只能是 0 或 1', () => {
    const { b, field } = withAirfield(0);
    expect(b.move(field.uid, field.x, field.y, 1)).toBe(true);
    expect(field.rot).toBe(1);
    expect(b.buildingAt(field.x, field.y + 7)?.uid).toBe(field.uid);
    expect(b.move(field.uid, field.x, field.y + 1)).toBe(true);
    expect(field.rot).toBe(1);
    expect(parseAction({ type: 'build', defId: 'airfield', x: 1, y: 2, rot: 1 })).toMatchObject({ rot: 1 });
    expect(parseAction({ type: 'build', defId: 'airfield', x: 1, y: 2 })).toMatchObject({ rot: 0 });
    expect(parseAction({ type: 'build', defId: 'airfield', x: 1, y: 2, rot: 2 })).toBeNull();
    expect(parseAction({ type: 'move', uid: 3, x: 1, y: 2 })).toMatchObject({ rot: undefined });
  });
});

describe('机位', () => {
  it('5 级机场停满 20 架战斗机，全都停在机场里；再多的停不下', () => {
    for (const rot of [0, 1] as const) {
      const { field } = withAirfield(rot);
      field.level = 5;
      const { w, h } = footprint('airfield', rot);
      const parked = parkPlanes([field], { fighter1: 22 });
      expect(parked.length).toBe(20);
      const spots = new Set(parked.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`));
      expect(spots.size).toBe(20);
      for (const p of parked) {
        expect(p.x).toBeGreaterThan(field.x);
        expect(p.x).toBeLessThan(field.x + w);
        expect(p.y).toBeGreaterThan(field.y);
        expect(p.y).toBeLessThan(field.y + h);
        // 滑行路线的最后一段是跑道，也在机场里
        const end = p.route[p.route.length - 1];
        expect(end.x).toBeLessThan(field.x + w);
        expect(end.y).toBeLessThan(field.y + h);
      }
    }
  });

  it('轰炸机占一整排（2 个机位）', () => {
    const { field } = withAirfield();
    field.level = 1; // 4 个机位 = 2 排
    expect(parkPlanes([field], { bomber1: 1, fighter1: 3 }).length).toBe(3); // 轰炸机 + 2 架战斗机
    expect(parkPlanes([field], { bomber1: 2 }).length).toBe(2);
  });

  it('基地里的飞机停在机位上，朝着跑道', () => {
    const { b, field } = withAirfield();
    b.state.army.fighter1 = 3;
    const planes = troopLayout(b).filter(t => t.plane);
    expect(planes.length).toBe(3);
    for (const p of planes) {
      expect(p.airfield).toBe(field.uid);
      expect(b.buildingAt(Math.floor(p.x), Math.floor(p.y))?.uid).toBe(field.uid);
      expect(p.facing).toBeCloseTo(Math.PI / 2); // 机头朝 +y，跑道在那一侧
    }
  });
});

describe('紧急升空', () => {
  it('开战后战斗机依次滑行、沿跑道起飞，轰炸机留在机库；停着的时候打不到', () => {
    const { b } = withAirfield();
    b.state.army.fighter1 = 2;
    b.state.army.bomber1 = 1;
    const battle = quietDrill(b);
    const planes = battle.living('player').filter(e => e.def.kind === 'fighter' || e.def.kind === 'bomber');
    expect(planes.length).toBe(3);
    expect(planes.every(p => p.alt === 0 && p.launch)).toBe(true);
    battle.start();
    steps(battle, 1);
    expect(planes.every(p => p.alt === 0)).toBe(true);
    steps(battle, 40);
    const fighters = planes.filter(p => p.def.kind === 'fighter' && p.alive);
    expect(fighters.length).toBe(2);
    expect(fighters.every(p => p.alt === 1 && p.launch === null)).toBe(true);
    const bomber = planes.find(p => p.def.kind === 'bomber')!;
    expect(bomber.alt).toBe(0);
    expect(bomber.launch).not.toBeNull();
  });

  it('起飞要排队：第二架比第一架晚离地', () => {
    const { b } = withAirfield();
    b.state.army.fighter1 = 2;
    const battle = quietDrill(b);
    const [p1, p2] = battle.living('player').filter(e => e.def.kind === 'fighter');
    battle.start();
    const up = new Map<number, number>();
    for (let i = 0; i < 40 / Battle.DT && up.size < 2; i++) {
      battle.step();
      for (const p of [p1, p2]) if (p.alt > 0 && !up.has(p.id)) up.set(p.id, battle.time);
    }
    expect(up.get(p2.id)!).toBeGreaterThan(up.get(p1.id)!);
  });

  it('机场被毁时，还没飞起来的飞机一起被毁', () => {
    const { b } = withAirfield();
    b.state.army.bomber1 = 1;
    const { battle } = createDrill(b, { rifle: 1 }, 1);
    const field = battle.living('player').find(e => e.defId === 'airbase')!;
    const bomber = battle.living('player').find(e => e.def.kind === 'bomber')!;
    battle.start();
    field.hp = 0;
    steps(battle, 0.2);
    expect(field.alive).toBe(false);
    expect(bomber.alive).toBe(false);
  });
});

describe('空战', () => {
  it('战斗机会追着敌方轰炸机打，把它打下来', () => {
    const b = new Battle(new Grid(40, 40), new Rng(1));
    b.spawn('hq', 'enemy', 36, 36);
    b.spawn('hq', 'player', 1, 1);
    const fighter = b.spawn('fighter2', 'player', 5, 20);
    const bomber = b.spawn('bomber1', 'enemy', 25, 20);
    b.start();
    steps(b, 60);
    expect(bomber.alive).toBe(false);
    expect(fighter.alive).toBe(true);
  });

  it('隐身飞机受空战伤害减半', () => {
    const shoot = (target: 'bomber1' | 'bomber4') => {
      const b = new Battle(new Grid(40, 40), new Rng(1));
      b.spawn('hq', 'enemy', 36, 36);
      b.spawn('hq', 'player', 1, 1);
      b.spawn('fighter1', 'player', 18, 20);
      const t = b.spawn(target, 'enemy', 20, 20);
      t.hp = 1e6;
      b.start();
      steps(b, 3);
      return 1e6 - t.hp;
    };
    expect(shoot('bomber4')).toBeCloseTo(shoot('bomber1') / 2, 0);
  });
});

describe('旧存档升级到 v7（燃油、钢铁一步到位）', () => {
  it('铁矿 2:1 换钢铁、原油 3:2 换燃油，炼钢厂、炼油厂拆掉返还造价', () => {
    const st = newBaseState(7, T0) as unknown as Record<string, any>;
    const hall = st.buildings[0];
    const raw = {
      ...st, version: 6,
      res: { ...st.res, iron: 100, oil: 90 },
      buildings: [...st.buildings, { uid: 9, defId: 'steelMill', x: hall.x + 4, y: hall.y, level: 2 }, { uid: 10, defId: 'refinery', x: hall.x + 8, y: hall.y }],
      ai: st.ai.map((a: any) => ({ ...a, res: { ...a.res, iron: 40, oil: 30 } })),
    };
    const state = parseSave(JSON.stringify(raw));
    if (typeof state === 'string') throw new Error(state);
    expect(state.version).toBe(7);
    expect('iron' in state.res || 'oil' in state.res).toBe(false);
    expect(state.res.steel).toBe(st.res.steel + 50 + 80); // 铁矿换来的 + 炼油厂返还的
    expect(state.res.fuel).toBe(st.res.fuel + 60);
    expect(state.res.stone).toBe(st.res.stone + 150 * 3 + 100); // 2 级炼钢厂 = 造价 + 2 倍升级费
    expect(state.buildings.some(o => (o.defId as string) === 'steelMill' || (o.defId as string) === 'refinery')).toBe(false);
    expect(state.ai.every(a => !('iron' in a.res) && !('oil' in a.res))).toBe(true);
  });
});

describe('旧存档升级到 v6', () => {
  function v5(buildings: PlacedBuilding[]) {
    const st = newBaseState(7, T0) as unknown as Record<string, unknown>;
    return JSON.stringify({ ...st, version: 5, buildings: [...(st.buildings as PlacedBuilding[]), ...buildings] });
  }

  it('3×3 的旧机场原地扩成 8×4，等级保留', () => {
    const st = newBaseState(7, T0);
    const hall = st.buildings[0];
    const state = parseSave(v5([{ uid: 9, defId: 'airfield', x: hall.x + 5, y: hall.y + 5, level: 2 }]));
    if (typeof state === 'string') throw new Error(state);
    expect(state.version).toBe(7);
    const field = state.buildings.find(o => o.defId === 'airfield')!;
    expect(field.level).toBe(2);
    const b = new Base(state);
    const { w, h } = footprint('airfield', field.rot ?? 0);
    expect(b.buildingAt(field.x + w - 1, field.y + h - 1)?.uid).toBe(9);
  });

  it('领地里实在放不下就拆掉，返还造价', () => {
    const st = newBaseState(7, T0);
    // 把领地缩到只剩市政厅那一块地，机场肯定放不下
    const hall = st.buildings[0];
    const plot = Math.floor(hall.y / 4) * 40 + Math.floor(hall.x / 4);
    const raw = JSON.parse(v5([{ uid: 9, defId: 'airfield', x: hall.x, y: hall.y + 3 }]));
    raw.owned = [plot];
    const before = raw.res.steel;
    const state = parseSave(JSON.stringify(raw));
    if (typeof state === 'string') throw new Error(state);
    expect(state.buildings.some(o => o.defId === 'airfield')).toBe(false);
    expect(state.res.steel).toBe(before + 400);
  });
});
