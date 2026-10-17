import { describe, expect, it } from 'vitest';
import { HALL_STORAGE, START_RESOURCES, TERRAIN_PRICE } from '../src/data/economy';
import { Base, newBaseState } from '../src/sim/base/base';
import { advanceTo, hourlyRates, powerInfo, step } from '../src/sim/base/economy';
import { PLOT_SIZE, REGION_PLOTS, START_PLOT } from '../src/sim/base/terrain';

const HOUR = 3600_000;
const T0 = 1_700_000_000_000;

// 开局领地里固定的地形（见 terrain.ts）：左上森林、中左平原、右下山地，铁矿在右边隔壁
const { x0, y0 } = START_PLOT;
const tile = (px: number, py: number) => ({ x: px * PLOT_SIZE, y: py * PLOT_SIZE });
const FOREST = tile(x0, y0), PLAIN = tile(x0, y0 + 1), MOUNTAIN = tile(x0 + 2, y0 + 2);
const IRON_PLOT = (y0 + 1) * REGION_PLOTS + x0 + 3;
const IRON = tile(x0 + 3, y0 + 1);

function fresh(): Base {
  return new Base(newBaseState(42, T0));
}

function rich(): Base {
  const b = fresh();
  for (const r of Object.keys(b.state.res) as (keyof typeof b.state.res)[]) b.state.res[r] = 400;
  b.state.res.gold = 3000;
  return b;
}

function hours(b: Base, h: number): void {
  for (let i = 0; i < h * 60; i++) step(b, 1 / 60);
}

describe('开局', () => {
  it('有市政厅、3×3 地块，开局领地里有森林、平原、山地', () => {
    const b = fresh();
    expect(b.state.buildings.map(o => o.defId)).toEqual(['hall']);
    expect(b.state.owned.length).toBe(9);
    expect(b.terrainAt(FOREST.x, FOREST.y)).toBe('forest');
    expect(b.terrainAt(PLAIN.x, PLAIN.y)).toBe('plain');
    expect(b.terrainAt(MOUNTAIN.x, MOUNTAIN.y)).toBe('mountain');
    expect(b.terrain[IRON_PLOT]).toBe('iron');
    expect(b.ownsPlot(IRON_PLOT)).toBe(false);
  });
});

describe('建造', () => {
  it('采集建筑要建在对应地形上', () => {
    const b = rich();
    expect(b.canBuild('lumberMill', PLAIN.x, PLAIN.y)).toBe('必须整块建在森林上');
    expect(typeof b.build('lumberMill', FOREST.x, FOREST.y)).toBe('object');
    expect(typeof b.build('farm', PLAIN.x, PLAIN.y)).toBe('object');
  });

  it('扣除造价；不能建在领地外或叠在别的建筑上', () => {
    const b = rich();
    b.build('house', PLAIN.x, PLAIN.y);
    expect(b.state.res.wood).toBe(400 - 60);
    expect(b.canBuild('house', PLAIN.x + 1, PLAIN.y)).toBe('这里已有建筑');
    expect(b.canBuild('house', 0, 0)).toBe('只能建在自己的领地上');
  });

  it('移动免费，地形限制照旧；拆除返还一半', () => {
    const b = rich();
    const mill = b.build('lumberMill', FOREST.x, FOREST.y);
    if (typeof mill === 'string') throw new Error(mill);
    const before = { ...b.state.res };
    expect(b.move(mill.uid, FOREST.x + 2, FOREST.y + 2)).toBe(true);
    expect(b.state.res).toEqual(before);
    expect(b.move(mill.uid, PLAIN.x, PLAIN.y)).toBe('必须整块建在森林上');
    expect(b.demolish(mill.uid)).toBe(true);
    expect(b.state.res.stone).toBe(before.stone + 15);
    expect(b.demolish(b.state.buildings[0].uid)).toBe('市政厅不能拆除');
  });
});

describe('买地', () => {
  it('第一块平原 500，铁矿脉加倍；只能买相邻的，越买越贵', () => {
    const b = rich();
    expect(b.plotPrice(IRON_PLOT)).toBe(1000);
    expect(b.canBuyPlot(0)).toBe('只能买与领地相邻的地块');
    expect(b.buyPlot(IRON_PLOT)).toBe(true);
    expect(b.state.res.gold).toBe(2000);
    expect(b.ownsTile(IRON.x, IRON.y)).toBe(true);
    // 第 2 块：500 × 2^1.5 ≈ 1414（平原）
    const next = (y0 - 1) * REGION_PLOTS + x0 + 1;
    expect(b.plotPrice(next)).toBe(Math.round(500 * Math.pow(2, 1.5) * TERRAIN_PRICE[b.terrain[next]]));
  });
});

describe('生产', () => {
  it('伐木场每小时 +80 木材', () => {
    const b = rich();
    b.build('lumberMill', FOREST.x, FOREST.y);
    const wood = b.state.res.wood;
    hours(b, 1);
    expect(b.state.res.wood - wood).toBeCloseTo(80, 3);
  });

  it('仓库满了就停产', () => {
    const b = rich();
    b.build('lumberMill', FOREST.x, FOREST.y);
    b.state.res.wood = HALL_STORAGE.wood - 10;
    hours(b, 1);
    expect(b.state.res.wood).toBe(HALL_STORAGE.wood);
  });

  it('两层生产链：矿井 50 铁/时 → 炼钢厂吃 40 铁出 20 钢', () => {
    const b = rich();
    b.buyPlot(IRON_PLOT);
    expect(typeof b.build('mine', IRON.x, IRON.y)).toBe('object');
    expect(typeof b.build('steelMill', PLAIN.x, PLAIN.y)).toBe('object');
    const steel = b.state.res.steel, iron = b.state.res.iron;
    hours(b, 1);
    expect(b.state.res.steel - steel).toBeCloseTo(20, 3);
    expect(b.state.res.iron - iron).toBeCloseTo(10, 3);
  });

  it('没有原料，加工厂不产出', () => {
    const b = rich();
    b.state.res.iron = 0;
    b.build('steelMill', PLAIN.x, PLAIN.y);
    const steel = b.state.res.steel;
    hours(b, 1);
    expect(b.state.res.steel).toBe(steel);
  });

  it('电力不足时耗电建筑按比例减产', () => {
    const b = rich();
    b.state.res.steel = 2000; b.state.res.wood = 2000; b.state.res.stone = 2000;
    // 市政厅供 10 电，4 座研究所要 12 电 → 效率 10/12
    for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2]]) b.build('lab', PLAIN.x + dx, PLAIN.y + dy);
    expect(powerInfo(b).efficiency).toBeCloseTo(10 / 12, 5);
    expect(hourlyRates(b).research).toBeCloseTo(5 + 40 * 10 / 12, 3);
  });

  it('收税：人口 × 20 × 税率', () => {
    const b = fresh();
    b.state.pop = b.popCap(); // 人口满了就不再增长，方便验算
    const gold = b.state.res.gold;
    hours(b, 1);
    expect(b.state.res.gold - gold).toBeCloseTo(30 * 20 * 0.1, 3);
  });

  it('人口向住房上限增长', () => {
    const b = rich();
    b.build('house', PLAIN.x, PLAIN.y);
    hours(b, 4);
    expect(b.state.pop).toBeGreaterThan(40);
    expect(b.state.pop).toBeLessThanOrEqual(50);
  });
});

describe('离线生产', () => {
  it('一次结算 3 小时 = 分 3 次结算', () => {
    const a = rich(), c = rich();
    for (const b of [a, c]) { b.build('lumberMill', FOREST.x, FOREST.y); b.build('quarry', MOUNTAIN.x, MOUNTAIN.y); }
    advanceTo(a, T0 + 3 * HOUR);
    advanceTo(c, T0 + HOUR); advanceTo(c, T0 + 2 * HOUR); advanceTo(c, T0 + 3 * HOUR);
    for (const r of Object.keys(a.state.res) as (keyof typeof a.state.res)[]) {
      expect(a.state.res[r]).toBeCloseTo(c.state.res[r], 6);
    }
  });

  it('离线再久也受仓库容量限制', () => {
    const b = rich();
    b.build('lumberMill', FOREST.x, FOREST.y);
    const { gained } = advanceTo(b, T0 + 10 * 24 * HOUR);
    expect(b.state.res.wood).toBe(HALL_STORAGE.wood);
    expect(gained.wood).toBe(HALL_STORAGE.wood - 400 + 0); // 400 起步，造伐木场不花木材
  });

  it('存档可以原样恢复', () => {
    const b = rich();
    b.build('farm', PLAIN.x, PLAIN.y);
    const restored = new Base(JSON.parse(JSON.stringify(b.state)));
    expect(restored.buildingAt(PLAIN.x + 1, PLAIN.y + 1)?.defId).toBe('farm');
    expect(restored.state.res).toEqual(b.state.res);
  });

  it('开局资源与设定一致', () => {
    expect(fresh().state.res).toEqual(START_RESOURCES);
  });
});
