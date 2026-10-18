import { describe, expect, it } from 'vitest';
import { TAX_PER_PERSON, type BaseBuildingId } from '../shared/data/economy';
import { Base, newBaseState, type PlacedBuilding } from '../shared/sim/base/base';
import { listedLevels, marketIndex, privateJobs, step } from '../shared/sim/base/economy';

const T0 = 1_700_000_000_000;

// 资源给足，市政厅 3 级（电够用、能建交易所）
function rich(): Base {
  const b = new Base(newBaseState(42, T0));
  for (const r of Object.keys(b.state.res) as (keyof typeof b.state.res)[]) b.state.res[r] = 2000;
  b.state.buildings[0].level = 3;
  return b;
}

// 在市政厅附近找块空地建
function place(b: Base, id: BaseBuildingId, level = 1): PlacedBuilding {
  const hall = b.state.buildings[0];
  for (let r = 3; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (b.fits(id, hall.x + dx, hall.y + dy) !== true) continue;
        b.state.res.gold = Math.max(b.state.res.gold, 2000);
        const built = b.build(id, hall.x + dx, hall.y + dy);
        if (typeof built === 'string') throw new Error(built);
        built.level = level;
        return built;
      }
    }
  }
  throw new Error('没地方');
}

// 人口固定在住房上限（不再增长），方便算账
function fixPop(b: Base, pop: number): void {
  b.state.pop = Math.min(pop, b.popCap() - b.soldierPop());
}

function goldAfter(b: Base, hours: number, at = T0): number {
  const g = b.state.res.gold;
  for (let i = 0; i < hours * 60; i++) step(b, 1 / 60, at + i * 60_000);
  return b.state.res.gold - g;
}

describe('财政', () => {
  it('国营企业每小时用 10 钢铁、5 燃油挣 300 金币，不受税率影响', () => {
    const b = rich();
    place(b, 'stateEnterprise');
    b.state.taxRate = 0;
    fixPop(b, 0);
    const steel = b.state.res.steel, fuel = b.state.res.fuel;
    expect(goldAfter(b, 1)).toBeCloseTo(300, 3);
    expect(steel - b.state.res.steel).toBeCloseTo(10, 3);
    expect(fuel - b.state.res.fuel).toBeCloseTo(5, 3);
  });

  it('私营企业按雇的市民挣钱，税率越高挣得越少', () => {
    for (const tax of [0, 0.5]) {
      const b = rich();
      place(b, 'privateEnterprise');
      b.state.taxRate = tax;
      fixPop(b, Infinity); // 住房住满（人口不再变），市民比岗位多：40 个岗位全满
      const pop = b.state.pop;
      expect(pop).toBeGreaterThan(40);
      expect(privateJobs(b)).toEqual({ jobs: 40, employed: 40 });
      const expected = 40 * 4 * (1 - tax) + pop * TAX_PER_PERSON * tax;
      expect(goldAfter(b, 1)).toBeCloseTo(expected, 0);
    }
  });

  it('银行：存款每小时 2% 利息（按分钟结算，略有复利）', () => {
    const b = rich();
    place(b, 'bank');
    b.state.taxRate = 0;
    fixPop(b, 0);
    b.state.res.gold = 4000;
    expect(goldAfter(b, 1)).toBeCloseTo(4000 * ((1 + 0.02 / 60) ** 60 - 1), 1);
  });

  it('银行利息不设上限，只受金币容量限制；只能建一家', () => {
    const b = rich();
    place(b, 'bank');
    place(b, 'vault', 3); // 金币容量够存 3 万多
    b.state.taxRate = 0;
    fixPop(b, 0);
    b.state.res.gold = 30000;
    expect(goldAfter(b, 1)).toBeGreaterThan(600); // 2% = 606，远超以前的 150 上限
    b.state.res.gold = b.storageCap().gold;
    expect(goldAfter(b, 1)).toBe(0); // 存满了就不再涨
    for (let lv = 1; lv <= 5; lv++) { b.state.buildings[0].level = lv; expect(b.limit('bank')).toBe(1); }
  });

  it('证券交易所：30 金币 × 上市企业等级总和 × 行情指数', () => {
    const b = rich();
    place(b, 'stateEnterprise', 2);
    place(b, 'privateEnterprise');
    expect(listedLevels(b)).toBe(3);
    b.state.taxRate = 0;
    fixPop(b, 0);
    // 同一个时刻、同样的基地，有交易所和没有交易所的差额
    const without = new Base(structuredClone(b.state));
    place(b, 'stockExchange');
    const at = T0 + 5 * 3600_000;
    const diff = goldAfter(b, 1 / 60, at) - goldAfter(without, 1 / 60, at);
    expect(diff).toBeCloseTo((30 * 3 * marketIndex(b.state.seed, at)) / 60, 3);
  });

  it('行情指数在 0.5–1.5 之间，一天一个周期', () => {
    let lo = Infinity, hi = -Infinity;
    for (let h = 0; h < 24; h++) {
      const v = marketIndex(7, T0 + h * 3600_000);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      expect(marketIndex(7, T0 + h * 3600_000 + 24 * 3600_000)).toBeCloseTo(v, 6);
    }
    expect(lo).toBeGreaterThanOrEqual(0.5);
    expect(hi).toBeLessThanOrEqual(1.5);
    expect(hi - lo).toBeGreaterThan(0.8);
  });

  it('交易所要市政厅 3 级才能建', () => {
    const b = rich();
    b.state.buildings[0].level = 2;
    expect(b.limit('stockExchange')).toBe(0);
    b.state.buildings[0].level = 3;
    expect(b.limit('stockExchange')).toBe(1);
  });
});
