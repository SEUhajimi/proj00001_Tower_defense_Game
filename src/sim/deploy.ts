import { DEFS, type DefId, type UnitDef } from '../data/units';
import { distToEntity, type Battle, type Entity, type Stance } from './battle';
import type { Point } from './grid';

export interface Loadout {
  roster: Partial<Record<DefId, number>>; // 带来的部队：出击只能派步兵、坦克（和阶段 4 的飞机）
}

export interface Rect {
  x: number;
  y: number;
  size: number;
}

// 出击前的部署：敌方基地四周有一圈空地作为投送区，部队只能摆在这圈里。
// 出击不能修建防御塔或工事。
export class Deployment {
  readonly roster: Partial<Record<DefId, number>>;

  constructor(readonly battle: Battle, loadout: Loadout, readonly enemyBase: Rect) {
    this.roster = { ...loadout.roster };
  }

  inDropZone(tx: number, ty: number): boolean {
    const { x, y, size } = this.enemyBase;
    if (!this.battle.grid.inBounds(tx, ty)) return false;
    return tx < x || ty < y || tx >= x + size || ty >= y + size;
  }

  // 有几座敌方塔或有驻军的工事能打到这一格（部署时参考）
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

  placed(): Entity[] {
    return this.battle.entities.filter(e => e.side === 'player');
  }

  entityAt(tx: number, ty: number): Entity | undefined {
    return this.placed().find(e => Math.floor(e.x) === tx && Math.floor(e.y) === ty);
  }

  canPlace(defId: DefId, tx: number, ty: number): true | string {
    const def: UnitDef = DEFS[defId];
    if (def.size > 0) return '出击不能修建防御塔或工事';
    if ((this.roster[defId] ?? 0) <= 0) return '该兵种已全部部署';
    if (!this.inDropZone(tx, ty)) return '只能部署在敌方基地外圈的投送区';
    if (!this.battle.grid.isWalkable(tx, ty) || this.entityAt(tx, ty)) return '这里已被占用';
    return true;
  }

  place(defId: DefId, tx: number, ty: number, stance: Stance): Entity | null {
    if (this.canPlace(defId, tx, ty) !== true) return null;
    this.roster[defId] = (this.roster[defId] ?? 0) - 1;
    return this.battle.spawn(defId, 'player', tx + 0.5, ty + 0.5, stance);
  }

  removeAt(tx: number, ty: number): boolean {
    const e = this.entityAt(tx, ty);
    if (!e) return false;
    this.roster[e.defId] = (this.roster[e.defId] ?? 0) + 1;
    this.battle.remove(e);
    return true;
  }
}

// 一键布置：在投送区里挑离目标近、被塔覆盖少的位置，坦克先上
export function autoDeploy(dep: Deployment, target: Point, stance: Stance = 'assault'): void {
  const grid = dep.battle.grid;
  const tiles: (Point & { score: number })[] = [];
  for (let ty = 0; ty < grid.h; ty++) {
    for (let tx = 0; tx < grid.w; tx++) {
      if (!dep.inDropZone(tx, ty) || !grid.isWalkable(tx, ty)) continue;
      const d = Math.hypot(tx + 0.5 - target.x, ty + 0.5 - target.y);
      tiles.push({ x: tx, y: ty, score: dep.threatAt(tx, ty) * 100 + d });
    }
  }
  // 部队集中在最安全的那一侧：以得分最低的格子为中心，就近摆开
  tiles.sort((a, b) => a.score - b.score);
  const anchor = tiles[0];
  if (!anchor) return;
  tiles.sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y));

  const order = (Object.entries(dep.roster) as [DefId, number][])
    .sort(([a], [b]) => Number(DEFS[b].kind === 'tank') - Number(DEFS[a].kind === 'tank'));
  for (const [defId, n] of order) {
    for (let k = 0; k < n; k++) {
      const spot = tiles.find(t => dep.canPlace(defId, t.x, t.y) === true);
      if (!spot) break;
      dep.place(defId, spot.x, spot.y, stance);
    }
  }
}
