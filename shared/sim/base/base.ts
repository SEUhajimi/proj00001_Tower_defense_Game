import { LOOT_SHARE } from '../../data/ai';
import { factoryOf, REPAIR_RATE, START_ARMY, TRAINING } from '../../data/army';
import {
  baseDef, BASE_BUILDINGS, HALL_STORAGE, RESOURCE_NAME, RESOURCES, START_POP, START_RESOURCES, START_TAX,
  MAX_LEVEL, upgradable, upgradeCost, type Amounts, type BaseBuildingId, type ResourceId, type Terrain,
} from '../../data/economy';
import { START_TECH, TECH_REQUIRES, TECH_STAGES, techStage } from '../../data/tech';
import { DEFS, type DefId } from '../../data/units';
import { advanceAi, placeStrongholds, type AiBase } from '../world/ai';
import { generateTerrain, PLOT_SIZE, REGION_PLOTS, REGION_TILES, START_PLOT } from './terrain';

export interface PlacedBuilding {
  uid: number;
  defId: BaseBuildingId;
  x: number; // 占地左上角格子
  y: number;
  level?: number; // 没有就是 1 级
}

export const levelOf = (b: PlacedBuilding) => b.level ?? 1;

// 带伤回来的部队，修好之前不能出击
export interface Wounded {
  defId: DefId;
  hp: number; // 剩余血量比例 0–1
}

// 存档里保存的全部内容（地形和 AI 基地布局由种子重新生成，不存）
export interface BaseState {
  version: 4;
  seed: number;
  lastTick: number; // 上次结算到的时间戳（毫秒）
  owned: number[]; // 已拥有的地块编号
  plotsBought: number; // 开局之后买过（含吞并）几块地，决定下一块的价格
  buildings: PlacedBuilding[];
  nextUid: number;
  res: Record<ResourceId, number>;
  pop: number; // 市民（不含士兵）
  taxRate: number;
  research: number; // 手上的科研点，研发科技时花掉
  tech: DefId[]; // 已研发的兵种和塔
  army: Partial<Record<DefId, number>>; // 可以出击的部队
  wounded: Wounded[];
  ai: AiBase[]; // 世界地图上的据点（含已征服的）
}

export function newBaseState(seed: number, now: number): BaseState {
  const owned: number[] = [];
  for (let y = START_PLOT.y0; y < START_PLOT.y0 + START_PLOT.size; y++) {
    for (let x = START_PLOT.x0; x < START_PLOT.x0 + START_PLOT.size; x++) owned.push(y * REGION_PLOTS + x);
  }
  const mid = (START_PLOT.x0 + 1) * PLOT_SIZE + 1;
  return {
    version: 4, seed, lastTick: now, owned, plotsBought: 0,
    // 开局：市政厅居中，正上方一座兵营
    buildings: [{ uid: 1, defId: 'hall', x: mid, y: mid }, { uid: 2, defId: 'barracks', x: mid, y: mid - 4 }],
    nextUid: 3,
    res: { ...START_RESOURCES },
    pop: START_POP,
    taxRate: START_TAX,
    research: 0,
    tech: [...START_TECH],
    army: { ...START_ARMY },
    wounded: [],
    ai: placeStrongholds(seed, now),
  };
}

export interface LootResult {
  loot: Record<ResourceId, number>; // 抢到的
  kept: Record<ResourceId, number>; // 实际入库的（仓库放不下的作废）
}

// 基地：包着存档状态，提供查询和玩家操作。所有操作失败时返回原因文字。
export class Base {
  readonly terrain: Terrain[];
  private occ = new Int32Array(REGION_TILES * REGION_TILES);
  private ownedSet: Set<number>;

  constructor(readonly state: BaseState) {
    this.terrain = generateTerrain(state.seed);
    this.ownedSet = new Set(state.owned);
    this.rebuildOccupancy();
  }

  // 换成服务器发来的状态（同一个存档，地形不变），原地更新，场景里拿着的引用继续有效
  adopt(state: BaseState): void {
    if (state.seed !== this.state.seed) throw new Error('不是同一个存档');
    Object.assign(this.state, state);
    this.ownedSet = new Set(this.state.owned);
    this.rebuildOccupancy();
  }

  // ---------- 地块与格子 ----------

  plotIndex(tx: number, ty: number): number {
    return Math.floor(ty / PLOT_SIZE) * REGION_PLOTS + Math.floor(tx / PLOT_SIZE);
  }

  terrainAt(tx: number, ty: number): Terrain {
    return this.terrain[this.plotIndex(tx, ty)];
  }

  inRegion(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < REGION_TILES && ty < REGION_TILES;
  }

  ownsTile(tx: number, ty: number): boolean {
    return this.inRegion(tx, ty) && this.ownedSet.has(this.plotIndex(tx, ty));
  }

  ownsPlot(plot: number): boolean {
    return this.ownedSet.has(plot);
  }

  buildingAt(tx: number, ty: number): PlacedBuilding | undefined {
    if (!this.inRegion(tx, ty)) return undefined;
    const uid = this.occ[ty * REGION_TILES + tx];
    return uid === -1 ? undefined : this.state.buildings.find(b => b.uid === uid);
  }

  private rebuildOccupancy(): void {
    this.occ.fill(-1);
    for (const b of this.state.buildings) this.stamp(b, b.uid);
  }

  private stamp(b: PlacedBuilding, value: number): void {
    const size = baseDef(b.defId).size;
    for (let y = b.y; y < b.y + size; y++) {
      for (let x = b.x; x < b.x + size; x++) this.occ[y * REGION_TILES + x] = value;
    }
  }

  count(defId: BaseBuildingId): number {
    return this.state.buildings.reduce((n, b) => n + (b.defId === defId ? 1 : 0), 0);
  }

  // ---------- 据点 ----------

  getAi(id: number): AiBase | undefined {
    return this.state.ai.find(a => a.id === id);
  }

  // 已征服的附属据点
  vassals(): AiBase[] {
    return this.state.ai.filter(a => a.owner === 'player');
  }

  // 抢走据点仓库存量的 50%，仓库放不下的作废
  loot(ai: AiBase, now: number): LootResult {
    advanceAi(ai, now);
    const cap = this.storageCap();
    const loot = {} as Record<ResourceId, number>, kept = {} as Record<ResourceId, number>;
    for (const r of RESOURCES) {
      loot[r] = Math.floor(ai.res[r] * LOOT_SHARE);
      ai.res[r] -= loot[r];
      kept[r] = Math.max(0, Math.min(loot[r], Math.floor(cap[r] - this.state.res[r])));
      this.state.res[r] += kept[r];
    }
    return { loot, kept };
  }

  // 守备打光：据点归玩家，成为附属据点，之后每小时上交
  conquer(ai: AiBase): void {
    ai.owner = 'player';
    ai.lost = [];
    for (const r of RESOURCES) ai.res[r] = 0;
  }

  // ---------- 容量与人口 ----------

  // 仓库容量：市政厅自带的基础容量（随市政厅等级翻倍）+ 各仓储建筑
  storageCap(): Record<ResourceId, number> {
    const hall = this.state.buildings.find(b => b.defId === 'hall');
    const k = hall ? levelOf(hall) : 1;
    const cap = { ...HALL_STORAGE };
    for (const r of RESOURCES) cap[r] *= k;
    for (const b of this.state.buildings) {
      const s = baseDef(b.defId).storage;
      if (s) for (const r of RESOURCES) cap[r] += (s[r] ?? 0) * levelOf(b);
    }
    return cap;
  }

  // 住房上限（市民和士兵共用）
  popCap(): number {
    return this.state.buildings.reduce((n, b) => n + (baseDef(b.defId).popCap ?? 0) * levelOf(b), 0);
  }

  // 士兵占用的人口（含伤员）
  soldierPop(): number {
    let n = 0;
    for (const [id, c] of Object.entries(this.state.army) as [DefId, number][]) n += (TRAINING[id]?.pop ?? 1) * c;
    for (const w of this.state.wounded) n += TRAINING[w.defId]?.pop ?? 1;
    return n;
  }

  // 部队每小时吃掉的粮食
  armyFood(): number {
    let n = 0;
    for (const [id, c] of Object.entries(this.state.army) as [DefId, number][]) n += (TRAINING[id]?.food ?? 1) * c;
    for (const w of this.state.wounded) n += TRAINING[w.defId]?.food ?? 1;
    return n;
  }

  // 粮食吃光了：部队饿着肚子不能出击
  hungry(): boolean {
    return this.armyFood() > 0 && this.state.res.food <= 0;
  }

  armySize(): number {
    return Object.values(this.state.army).reduce((n, c) => n + (c ?? 0), 0);
  }

  // ---------- 资源 ----------

  canAfford(cost: Amounts): true | string {
    for (const r of RESOURCES) {
      if ((cost[r] ?? 0) > this.state.res[r]) return `${RESOURCE_NAME[r]}不足`;
    }
    return true;
  }

  private pay(cost: Amounts, sign = 1): void {
    const cap = this.storageCap();
    for (const r of RESOURCES) {
      this.state.res[r] = Math.min(cap[r], this.state.res[r] - sign * (cost[r] ?? 0));
    }
  }

  // ---------- 科技 ----------

  researched(id: DefId): boolean {
    return techStage(id) < 0 || this.state.tech.includes(id);
  }

  // 第一阶段开局就开放；之后每个阶段要上一阶段研发过半才开放
  stageOpen(stage: number): boolean {
    if (stage <= 0) return true;
    const prev = TECH_STAGES[stage - 1].items;
    const done = prev.filter(id => this.state.tech.includes(id)).length;
    return this.stageOpen(stage - 1) && done >= Math.ceil(prev.length / 2);
  }

  canResearch(id: DefId): true | string {
    const stage = techStage(id);
    if (stage < 0 || this.researched(id)) return '已研发';
    if (!this.stageOpen(stage)) return '上一阶段研发过半后开放';
    const req = TECH_REQUIRES[id];
    if (req && !this.researched(req)) return `需要先研发${DEFS[req].name}`;
    const { research, gold } = TECH_STAGES[stage];
    if (this.state.research < research) return '科研点不足';
    return this.state.res.gold >= gold ? true : '金币不足';
  }

  research(id: DefId): true | string {
    const ok = this.canResearch(id);
    if (ok !== true) return ok;
    const { research, gold } = TECH_STAGES[techStage(id)];
    this.state.research -= research;
    this.state.res.gold -= gold;
    this.state.tech.push(id);
    return true;
  }

  // ---------- 征兵与维修 ----------

  canRecruit(defId: DefId, n = 1): true | string {
    const t = TRAINING[defId];
    if (!t) return '不能征召';
    if (!this.researched(defId)) return '尚未研发';
    const factory = factoryOf(defId);
    if (!this.count(factory)) return `需要先建造${baseDef(factory).name}`;
    const cost: Amounts = {};
    for (const r of RESOURCES) if (t.cost[r]) cost[r] = t.cost[r]! * n;
    const money = this.canAfford(cost);
    if (money !== true) return money;
    return this.state.pop >= t.pop * n ? true : '可征召的市民不足';
  }

  recruit(defId: DefId, n = 1): true | string {
    const ok = this.canRecruit(defId, n);
    if (ok !== true) return ok;
    const t = TRAINING[defId]!;
    for (let k = 0; k < n; k++) this.pay(t.cost);
    this.state.pop -= t.pop * n;
    this.state.army[defId] = (this.state.army[defId] ?? 0) + n;
    return true;
  }

  repairCost(w: Wounded): Amounts {
    const t = TRAINING[w.defId], cost: Amounts = {};
    if (!t) return cost;
    for (const r of RESOURCES) if (t.cost[r]) cost[r] = Math.ceil(t.cost[r]! * (1 - w.hp) * REPAIR_RATE);
    return cost;
  }

  repairAllCost(): Amounts {
    const total: Amounts = {};
    for (const w of this.state.wounded) {
      const c = this.repairCost(w);
      for (const r of RESOURCES) if (c[r]) total[r] = (total[r] ?? 0) + c[r]!;
    }
    return total;
  }

  repairAll(): true | string {
    if (!this.state.wounded.length) return '没有需要维修的部队';
    const cost = this.repairAllCost();
    const ok = this.canAfford(cost);
    if (ok !== true) return ok;
    this.pay(cost);
    for (const w of this.state.wounded) this.state.army[w.defId] = (this.state.army[w.defId] ?? 0) + 1;
    this.state.wounded = [];
    return true;
  }

  // ---------- 建造 ----------

  // 占地是否可用：都在自己领地上、没有别的建筑（exceptUid 用于移动时忽略自己）
  fits(defId: BaseBuildingId, tx: number, ty: number, exceptUid = -1): true | string {
    const def = baseDef(defId);
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) {
        if (!this.ownsTile(x, y)) return '只能建在自己的领地上';
        const uid = this.occ[y * REGION_TILES + x];
        if (uid !== -1 && uid !== exceptUid) return '这里已有建筑';
      }
    }
    return true;
  }

  canBuild(defId: BaseBuildingId, tx: number, ty: number): true | string {
    const def = baseDef(defId);
    if (def.unique) return '不能再建';
    if (defId in DEFS && !this.researched(defId as DefId)) return '尚未研发';
    const fit = this.fits(defId, tx, ty);
    if (fit !== true) return fit;
    return this.canAfford(def.cost);
  }

  build(defId: BaseBuildingId, tx: number, ty: number): PlacedBuilding | string {
    const ok = this.canBuild(defId, tx, ty);
    if (ok !== true) return ok;
    this.pay(baseDef(defId).cost);
    const b: PlacedBuilding = { uid: this.state.nextUid++, defId, x: tx, y: ty };
    this.state.buildings.push(b);
    this.stamp(b, b.uid);
    return b;
  }

  // 基地管理：免费、即时移动，地形限制照旧
  move(uid: number, tx: number, ty: number): true | string {
    const b = this.state.buildings.find(o => o.uid === uid);
    if (!b) return '没有这座建筑';
    const fit = this.fits(b.defId, tx, ty, uid);
    if (fit !== true) return fit;
    this.stamp(b, -1);
    b.x = tx;
    b.y = ty;
    this.stamp(b, uid);
    return true;
  }

  // 升级到下一级
  canUpgrade(uid: number): true | string {
    const b = this.state.buildings.find(o => o.uid === uid);
    if (!b) return '没有这座建筑';
    if (!upgradable(b.defId)) return '这种建筑不能升级';
    if (levelOf(b) >= MAX_LEVEL) return '已经是最高级';
    return this.canAfford(upgradeCost(b.defId, levelOf(b) + 1));
  }

  upgrade(uid: number): true | string {
    const ok = this.canUpgrade(uid);
    if (ok !== true) return ok;
    const b = this.state.buildings.find(o => o.uid === uid)!;
    this.pay(upgradeCost(b.defId, levelOf(b) + 1));
    b.level = levelOf(b) + 1;
    return true;
  }

  // 拆除返还累计投入（建造 + 各次升级）的一半
  demolish(uid: number): true | string {
    const b = this.state.buildings.find(o => o.uid === uid);
    if (!b) return '没有这座建筑';
    const def = baseDef(b.defId);
    if (def.unique) return '市政厅不能拆除';
    this.stamp(b, -1);
    this.state.buildings.splice(this.state.buildings.indexOf(b), 1);
    const refund: Amounts = {};
    for (const r of RESOURCES) {
      let spent = def.cost[r] ?? 0;
      for (let k = 2; k <= levelOf(b); k++) spent += upgradeCost(b.defId, k)[r] ?? 0;
      refund[r] = Math.floor(spent / 2);
    }
    this.pay(refund, -1);
    return true;
  }

  // ---------- 买地 ----------

  // 第 n 块地的价格，不分地形
  plotPrice(_plot: number): number {
    return Math.round(500 * Math.pow(this.state.plotsBought + 1, 1.5));
  }

  canBuyPlot(plot: number): true | string {
    if (plot < 0 || plot >= REGION_PLOTS * REGION_PLOTS) return '超出区域';
    if (this.ownedSet.has(plot)) return '已经是你的领地';
    const px = plot % REGION_PLOTS, py = Math.floor(plot / REGION_PLOTS);
    const adjacent = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const nx = px + dx, ny = py + dy;
      return nx >= 0 && ny >= 0 && nx < REGION_PLOTS && ny < REGION_PLOTS && this.ownedSet.has(ny * REGION_PLOTS + nx);
    });
    if (!adjacent) return '只能买与领地相邻的地块';
    return this.state.res.gold >= this.plotPrice(plot) ? true : '金币不足';
  }

  buyPlot(plot: number): true | string {
    const ok = this.canBuyPlot(plot);
    if (ok !== true) return ok;
    this.state.res.gold -= this.plotPrice(plot);
    this.state.plotsBought++;
    this.state.owned.push(plot);
    this.ownedSet.add(plot);
    return true;
  }
}

export const BUILDABLE = (Object.keys(BASE_BUILDINGS) as BaseBuildingId[]).filter(id => !baseDef(id).unique);
