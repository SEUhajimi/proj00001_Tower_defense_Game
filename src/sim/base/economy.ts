import {
  baseDef, BASE_BUILDINGS, POP_GROWTH_RATE, RESOURCES, TAX_PER_PERSON,
  type BaseBuildingId, type ResourceId,
} from '../../data/economy';
import { Base } from './base';

const MS_PER_HOUR = 3600_000;
const STEP_MS = 60_000; // 结算步长 1 分钟：仓库满、原料断供都能在一分钟内反映出来
const MAX_OFFLINE_MS = 30 * 24 * MS_PER_HOUR; // 离线超过 30 天只算 30 天

export type ResourceMap = Record<ResourceId, number>;

const zero = (): ResourceMap => Object.fromEntries(RESOURCES.map(r => [r, 0])) as ResourceMap;

// 加工建筑排在采集建筑后面，并按定义顺序（炼钢 → 炼油 → 兵工 → 电子），
// 这样同一步里先挖出来的铁矿就能被炼成钢
const DEF_ORDER = Object.keys(BASE_BUILDINGS) as BaseBuildingId[];
const rank = (id: BaseBuildingId) => (baseDef(id).consumes ? 1000 : 0) + DEF_ORDER.indexOf(id);

export interface PowerInfo {
  supply: number;
  demand: number;
  efficiency: number; // 供不应求时，耗电建筑按这个比例减产
}

// 当前电力（假设仓库里的燃油够发电厂烧）
export function powerInfo(base: Base): PowerInfo {
  let supply = 0, demand = 0;
  for (const b of base.state.buildings) {
    const d = baseDef(b.defId);
    if ((d.power ?? 0) > 0) supply += d.power!;
    if ((d.power ?? 0) < 0) demand -= d.power!;
    if (d.fuelBoost && base.state.res.fuel > 0) supply += d.fuelBoost.power;
  }
  return { supply, demand, efficiency: demand <= 0 ? 1 : Math.min(1, supply / demand) };
}

// 结算一段时间（小时）。调用方保证 hours 不超过一个步长。
export function step(base: Base, hours: number): void {
  const s = base.state, res = s.res, cap = base.storageCap();
  const defs = s.buildings.map(b => baseDef(b.defId));

  // 电力：发电厂有燃油就多发电
  let supply = 0, demand = 0, fuelWant = 0, boost = 0;
  for (const d of defs) {
    if ((d.power ?? 0) > 0) supply += d.power!;
    if ((d.power ?? 0) < 0) demand -= d.power!;
    if (d.fuelBoost) { fuelWant += d.fuelBoost.fuel * hours; boost += d.fuelBoost.power; }
  }
  const fuelFrac = fuelWant > 0 ? Math.min(1, res.fuel / fuelWant) : 0;
  res.fuel -= fuelWant * fuelFrac;
  supply += boost * fuelFrac;
  const eff = demand <= 0 ? 1 : Math.min(1, supply / demand);
  const powered = (power?: number) => ((power ?? 0) < 0 ? eff : 1);

  // 生产：受电力、原料、仓库空间三者中最紧的那个限制
  const producers = [...s.buildings].sort((a, b) => rank(a.defId) - rank(b.defId));
  for (const b of producers) {
    const d = baseDef(b.defId);
    if (!d.produces) continue;
    let f = powered(d.power);
    for (const r of RESOURCES) {
      const need = (d.consumes?.[r] ?? 0) * hours;
      if (need > 0) f = Math.min(f, res[r] / need);
      const out = (d.produces[r] ?? 0) * hours;
      if (out > 0) f = Math.min(f, Math.max(0, cap[r] - res[r]) / out);
    }
    if (f <= 0) continue;
    for (const r of RESOURCES) {
      res[r] -= (d.consumes?.[r] ?? 0) * hours * f;
      res[r] += (d.produces[r] ?? 0) * hours * f;
    }
  }

  // 税收
  res.gold = Math.min(cap.gold, res.gold + s.pop * TAX_PER_PERSON * s.taxRate * hours);

  // 人口：向住房上限靠拢，税率越高增长越慢；拆了民居则立即降到上限
  const popCap = base.popCap();
  if (s.pop > popCap) s.pop = popCap;
  else {
    const g = POP_GROWTH_RATE * Math.max(0, 1 - 1.5 * s.taxRate);
    s.pop += (popCap - s.pop) * (1 - Math.exp(-g * hours));
  }

  // 科研
  for (const d of defs) s.research += (d.research ?? 0) * powered(d.power) * hours;

  // 拆了仓库导致超出容量的部分作废
  for (const r of RESOURCES) res[r] = Math.max(0, Math.min(cap[r], res[r]));
}

// 结算到 now，返回这段时间各资源的变化量。打开游戏时用它补算离线产出。
export function advanceTo(base: Base, now: number): { hours: number; gained: ResourceMap } {
  const s = base.state;
  const elapsed = Math.min(now - s.lastTick, MAX_OFFLINE_MS);
  const before = { ...s.res };
  if (elapsed > 0) {
    for (let left = elapsed; left > 0; left -= STEP_MS) step(base, Math.min(left, STEP_MS) / MS_PER_HOUR);
  }
  s.lastTick = Math.max(s.lastTick, now);
  const gained = zero();
  for (const r of RESOURCES) gained[r] = s.res[r] - before[r];
  return { hours: Math.max(0, elapsed) / MS_PER_HOUR, gained };
}

// 当前每小时的净产量（在副本上试算一分钟）
export function hourlyRates(base: Base): { res: ResourceMap; research: number; pop: number } {
  const copy = new Base(structuredClone(base.state));
  const before = { ...copy.state.res }, research = copy.state.research, pop = copy.state.pop;
  step(copy, STEP_MS / MS_PER_HOUR);
  const k = MS_PER_HOUR / STEP_MS;
  const out = zero();
  for (const r of RESOURCES) out[r] = (copy.state.res[r] - before[r]) * k;
  return { res: out, research: (copy.state.research - research) * k, pop: (copy.state.pop - pop) * k };
}
