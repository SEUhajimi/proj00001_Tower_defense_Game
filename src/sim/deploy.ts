import { DEFS, type DefId, type UnitDef } from '../data/units';
import { distToEntity, type Battle, type Entity, type Stance } from './battle';
import type { Point } from './grid';

export interface Budget {
  steel: number;
  ammo: number;
}

export interface Loadout {
  roster: Partial<Record<DefId, number>>; // 带来的部队
  budget: Budget; // 带来的物资，用来在营地造塔和工事
  buildings: DefId[]; // 可建造的塔和工事
}

// 出击前的部署：战场就是敌方基地，在基地里选一块没有建筑的空地投送兵力，
// 在营地范围内摆塔、修工事、布兵。营地的建筑只负责守营地。
export class Deployment {
  readonly campRadius = 3.5;
  camp: Point | null = null;
  readonly roster: Partial<Record<DefId, number>>;
  readonly budget: Budget;
  readonly buildings: DefId[];

  constructor(readonly battle: Battle, loadout: Loadout) {
    this.roster = { ...loadout.roster };
    this.budget = { ...loadout.budget };
    this.buildings = [...loadout.buildings];
  }

  inCamp(tx: number, ty: number): boolean {
    if (!this.camp) return false;
    return Math.hypot(tx + 0.5 - this.camp.x, ty + 0.5 - this.camp.y) <= this.campRadius;
  }

  // 营地范围必须整块落在地图内，且没有任何建筑
  canLand(tx: number, ty: number): boolean {
    const grid = this.battle.grid;
    const r = Math.ceil(this.campRadius);
    if (grid.isBlocked(tx, ty)) return false;
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.hypot(x - tx, y - ty) > this.campRadius) continue;
        if (!grid.inBounds(x, y) || grid.occupant[grid.idx(x, y)] !== -1) return false;
      }
    }
    return true;
  }

  // 有几座敌方塔或有驻军的工事能打到这一格（选投送点时参考）
  threatAt(tx: number, ty: number): number {
    let n = 0;
    for (const e of this.battle.entities) {
      if (!e.alive || e.side !== 'enemy') continue;
      let range = -1;
      if (e.def.kind === 'tower') {
        range = Math.max(...e.def.weapons.map(w => w.range));
      } else if (e.def.kind === 'fort') {
        for (const id of e.garrison) {
          const u = this.battle.get(id);
          if (u) range = Math.max(range, ...u.def.weapons.map(w => w.range + (e.def.rangeBonus ?? 0)));
        }
      }
      if (range >= 0 && distToEntity(tx + 0.5, ty + 0.5, e) <= range) n++;
    }
    return n;
  }

  // 重新选投送点会撤回已部署的一切
  land(tx: number, ty: number): boolean {
    if (!this.canLand(tx, ty)) return false;
    for (const e of this.placed()) if (e.inside === null) this.refund(e);
    this.camp = { x: tx + 0.5, y: ty + 0.5 };
    return true;
  }

  placed(): Entity[] {
    return this.battle.entities.filter(e => e.side === 'player');
  }

  // 这一格上的建筑或（没有进驻的）部队
  entityAt(tx: number, ty: number): Entity | undefined {
    return this.placed().find(e => e.def.size > 0
      ? tx >= e.tileX && ty >= e.tileY && tx < e.tileX + e.def.size && ty < e.tileY + e.def.size
      : e.inside === null && Math.floor(e.x) === tx && Math.floor(e.y) === ty);
  }

  // 物资够不够造这座建筑
  affordable(defId: DefId): true | string {
    const def: UnitDef = DEFS[defId];
    if ((def.cost?.steel ?? 0) > this.budget.steel) return '钢铁不足';
    if ((def.cost?.ammo ?? 0) > this.budget.ammo) return '弹药不足';
    return true;
  }

  canPlace(defId: DefId, tx: number, ty: number): true | string {
    const def: UnitDef = DEFS[defId];
    if (!this.camp) return '请先选择投送地点';
    if (!this.inCamp(tx, ty)) return '只能部署在营地范围内';
    if (def.size === 0 && (this.roster[defId] ?? 0) <= 0) return '该兵种已全部部署';
    const here = this.entityAt(tx, ty);
    // 步兵放到己方工事上 = 进驻
    if (here?.def.kind === 'fort' && def.kind === 'infantry') {
      return here.garrison.length < (here.def.capacity ?? 0) ? true : `${here.def.name}已满`;
    }
    if (this.battle.grid.isBlocked(tx, ty) || here) return '这里已被占用';
    if (def.size > 0) {
      if (!this.buildings.includes(defId)) return '这次出击不能建造它';
      for (let y = ty; y < ty + def.size; y++) {
        for (let x = tx; x < tx + def.size; x++) {
          if (!this.inCamp(x, y) || this.battle.grid.isBlocked(x, y) || this.entityAt(x, y)) return '这里放不下';
        }
      }
      const money = this.affordable(defId);
      if (money !== true) return money;
    }
    return true;
  }

  place(defId: DefId, tx: number, ty: number, stance: Stance): Entity | null {
    if (this.canPlace(defId, tx, ty) !== true) return null;
    const def: UnitDef = DEFS[defId];
    if (def.size > 0) {
      this.budget.steel -= def.cost?.steel ?? 0;
      this.budget.ammo -= def.cost?.ammo ?? 0;
      return this.battle.spawn(defId, 'player', tx, ty);
    }
    this.roster[defId] = (this.roster[defId] ?? 0) - 1;
    const u = this.battle.spawn(defId, 'player', tx + 0.5, ty + 0.5, stance);
    const fort = this.entityAt(tx, ty);
    if (fort?.def.kind === 'fort') this.battle.garrison(u, fort);
    return u;
  }

  // 撤回这一格上的东西；撤回工事会连同里面的驻军一起撤回
  removeAt(tx: number, ty: number): boolean {
    const e = this.entityAt(tx, ty);
    if (!e) return false;
    this.refund(e);
    return true;
  }

  private refund(e: Entity): void {
    const def = e.def;
    if (def.size > 0) {
      for (const id of [...e.garrison]) {
        const u = this.battle.get(id);
        if (u) this.refund(u);
      }
      this.budget.steel += def.cost?.steel ?? 0;
      this.budget.ammo += def.cost?.ammo ?? 0;
    } else {
      this.roster[e.defId] = (this.roster[e.defId] ?? 0) + 1;
    }
    this.battle.remove(e);
  }
}

// 一键布置：塔放在营地朝向敌人的一侧，部队铺在后面（不进驻工事，全部用来进攻）
export function autoDeploy(dep: Deployment, target: Point, stance: Stance = 'assault'): void {
  const camp = dep.camp;
  if (!camp) return;
  const tiles: Point[] = [];
  const r = Math.ceil(dep.campRadius);
  for (let ty = Math.floor(camp.y) - r; ty <= Math.floor(camp.y) + r; ty++) {
    for (let tx = Math.floor(camp.x) - r; tx <= Math.floor(camp.x) + r; tx++) {
      if (dep.inCamp(tx, ty)) tiles.push({ x: tx, y: ty });
    }
  }
  const toTarget = (p: Point) => Math.hypot(p.x + 0.5 - target.x, p.y + 0.5 - target.y);
  tiles.sort((a, b) => toTarget(a) - toTarget(b));

  const towerPlan: DefId[] = ['atTower', 'mgTower', 'mgTower', 'atTower', 'mgTower', 'cannonTower'];
  let next = 0;
  for (const defId of towerPlan) {
    const i = tiles.findIndex((t, k) => k >= next && dep.canPlace(defId, t.x, t.y) === true);
    if (i === -1) continue;
    dep.place(defId, tiles[i].x, tiles[i].y, stance);
    next = i + 1;
  }

  // 坦克先上，营地放满时不至于把主力落下
  const order = (Object.entries(dep.roster) as [DefId, number][])
    .sort(([a], [b]) => Number(DEFS[b].kind === 'tank') - Number(DEFS[a].kind === 'tank'));
  for (const [defId, n] of order) {
    for (let k = 0; k < n; k++) {
      const spot = tiles.find(t => !dep.entityAt(t.x, t.y) && dep.canPlace(defId, t.x, t.y) === true);
      if (!spot) break;
      dep.place(defId, spot.x, spot.y, stance);
    }
  }
}
