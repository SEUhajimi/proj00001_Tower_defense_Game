import {
  baseDef, BASE_BUILDINGS, HALL_STORAGE, RESOURCE_NAME, RESOURCES, START_POP, START_RESOURCES, START_TAX,
  TERRAIN_NAME, TERRAIN_PRICE, type Amounts, type BaseBuildingId, type ResourceId, type Terrain,
} from '../../data/economy';
import { generateTerrain, PLOT_SIZE, REGION_PLOTS, REGION_TILES, START_PLOT } from './terrain';

export interface PlacedBuilding {
  uid: number;
  defId: BaseBuildingId;
  x: number; // 占地左上角格子
  y: number;
}

// 存档里保存的全部内容（地形由种子重新生成，不存）
export interface BaseState {
  version: 1;
  seed: number;
  lastTick: number; // 上次结算到的时间戳（毫秒）
  owned: number[]; // 已拥有的地块编号
  plotsBought: number; // 开局之后买过几块地，决定下一块的价格
  buildings: PlacedBuilding[];
  nextUid: number;
  res: Record<ResourceId, number>;
  pop: number;
  taxRate: number;
  research: number; // 累计科研点（阶段 4 的科技树使用）
}

export function newBaseState(seed: number, now: number): BaseState {
  const owned: number[] = [];
  for (let y = START_PLOT.y0; y < START_PLOT.y0 + START_PLOT.size; y++) {
    for (let x = START_PLOT.x0; x < START_PLOT.x0 + START_PLOT.size; x++) owned.push(y * REGION_PLOTS + x);
  }
  const mid = (START_PLOT.x0 + 1) * PLOT_SIZE + 1;
  return {
    version: 1, seed, lastTick: now, owned, plotsBought: 0,
    buildings: [{ uid: 1, defId: 'hall', x: mid, y: mid }],
    nextUid: 2,
    res: { ...START_RESOURCES },
    pop: START_POP,
    taxRate: START_TAX,
    research: 0,
  };
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

  // ---------- 容量 ----------

  storageCap(): Record<ResourceId, number> {
    const cap = { ...HALL_STORAGE };
    for (const b of this.state.buildings) {
      const s = baseDef(b.defId).storage;
      if (s) for (const r of RESOURCES) cap[r] += s[r] ?? 0;
    }
    return cap;
  }

  popCap(): number {
    return this.state.buildings.reduce((n, b) => n + (baseDef(b.defId).popCap ?? 0), 0);
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

  // ---------- 建造 ----------

  // 占地是否可用：都在自己领地上、没有别的建筑（exceptUid 用于移动时忽略自己）、地形符合
  fits(defId: BaseBuildingId, tx: number, ty: number, exceptUid = -1): true | string {
    const def = baseDef(defId);
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) {
        if (!this.ownsTile(x, y)) return '只能建在自己的领地上';
        const uid = this.occ[y * REGION_TILES + x];
        if (uid !== -1 && uid !== exceptUid) return '这里已有建筑';
        if (def.terrain && this.terrainAt(x, y) !== def.terrain) return `必须整块建在${TERRAIN_NAME[def.terrain]}上`;
      }
    }
    return true;
  }

  canBuild(defId: BaseBuildingId, tx: number, ty: number): true | string {
    const def = baseDef(defId);
    if (def.unique) return '不能再建';
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

  // 拆除返还一半造价
  demolish(uid: number): true | string {
    const b = this.state.buildings.find(o => o.uid === uid);
    if (!b) return '没有这座建筑';
    const def = baseDef(b.defId);
    if (def.unique) return '市政厅不能拆除';
    this.stamp(b, -1);
    this.state.buildings.splice(this.state.buildings.indexOf(b), 1);
    const refund: Amounts = {};
    for (const r of RESOURCES) refund[r] = Math.floor((def.cost[r] ?? 0) / 2);
    this.pay(refund, -1);
    return true;
  }

  // ---------- 买地 ----------

  plotPrice(plot: number): number {
    const n = this.state.plotsBought + 1;
    return Math.round(500 * Math.pow(n, 1.5) * TERRAIN_PRICE[this.terrain[plot]]);
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
