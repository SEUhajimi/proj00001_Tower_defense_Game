import { DAMAGE_MULT, HQ_DOWN_DAMAGE_MULT, type DamageType } from '../data/combat';
import { DEFS, type DefId, type UnitDef, type Weapon } from '../data/units';
import type { Grid, Point } from './grid';
import type { Rng } from './rng';

export type Side = 'player' | 'enemy';
export type Stance = 'hold' | 'assault'; // 驻守：只在驻地附近迎敌；出击：主动寻找敌人
export type Outcome = 'victory' | 'defeat' | 'retreat';

export interface Entity {
  id: number;
  defId: DefId;
  def: UnitDef;
  side: Side;
  x: number;
  y: number;
  px: number; // 上一帧位置，用于渲染插值
  py: number;
  hp: number;
  cooldowns: number[];
  facing: number;
  stance: Stance;
  postX: number;
  postY: number;
  path: Point[];
  pathTargetKey: string;
  repathIn: number;
  tileX: number; // 建筑占地左上角
  tileY: number;
  alive: boolean;
  inside: number | null; // 步兵：驻防在哪座工事里
  garrison: number[]; // 工事：里面驻防的步兵
}

export type BattleEvent =
  | { type: 'shot'; from: number; to: number; dmgType: DamageType }
  | { type: 'boom'; x: number; y: number; r: number }
  | { type: 'death'; id: number };

const ALERT_MARGIN = 3; // 驻守单位的警戒半径 = 最大射程 + 该值
const SEPARATION = 0.35;
const REPATH_SECONDS = 1;

export const isMobile = (e: Entity) => e.def.speed > 0;

// 驻防在工事里的步兵不能被选为目标，也不受溅射
const targetable = (o: Entity) => o.alive && o.hp > 0 && o.inside === null;

// 点 (px, py) 到实体受击区域的距离：建筑按整个占地矩形算，移动单位按半径算
export function distToEntity(px: number, py: number, o: Entity): number {
  if (o.def.size > 0) {
    const dx = Math.max(o.tileX - px, 0, px - (o.tileX + o.def.size));
    const dy = Math.max(o.tileY - py, 0, py - (o.tileY + o.def.size));
    return Math.hypot(dx, dy);
  }
  return Math.max(0, Math.hypot(o.x - px, o.y - py) - o.def.radius);
}

export class Battle {
  static readonly DT = 0.05;

  time = 0;
  started = false;
  outcome: Outcome | null = null;
  readonly entities: Entity[] = [];
  readonly hqDown: Record<Side, boolean> = { player: false, enemy: false };
  private readonly byId = new Map<number, Entity>();
  private events: BattleEvent[] = [];
  private nextId = 1;

  constructor(readonly grid: Grid, private readonly rng: Rng) {}

  // 建筑的 (x, y) 是占地左上角格子；移动单位的 (x, y) 是格子坐标（可带小数）
  spawn(defId: DefId, side: Side, x: number, y: number, stance: Stance = 'hold'): Entity {
    const def = DEFS[defId];
    const building = def.size > 0;
    const cx = building ? x + def.size / 2 : x;
    const cy = building ? y + def.size / 2 : y;
    const e: Entity = {
      id: this.nextId++, defId, def, side,
      x: cx, y: cy, px: cx, py: cy,
      hp: def.hp,
      cooldowns: def.weapons.map(() => 0),
      facing: side === 'player' ? 0 : Math.PI,
      stance, postX: cx, postY: cy,
      path: [], pathTargetKey: '', repathIn: 0,
      tileX: Math.floor(x), tileY: Math.floor(y),
      alive: true,
      inside: null, garrison: [],
    };
    if (building) this.grid.setOccupant(e.tileX, e.tileY, def.size, e.id);
    this.entities.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  // 步兵进驻己方工事
  garrison(u: Entity, fort: Entity): boolean {
    if (u.def.kind !== 'infantry' || u.inside !== null || u.side !== fort.side || !fort.alive) return false;
    if (fort.garrison.length >= (fort.def.capacity ?? 0)) return false;
    fort.garrison.push(u.id);
    u.inside = fort.id;
    u.x = u.px = u.postX = fort.x;
    u.y = u.py = u.postY = fort.y;
    u.path = [];
    return true;
  }

  // 部署阶段撤回单位
  remove(e: Entity): void {
    if (this.started) return;
    const i = this.entities.indexOf(e);
    if (i === -1) return;
    this.entities.splice(i, 1);
    this.byId.delete(e.id);
    if (e.def.size > 0) this.grid.setOccupant(e.tileX, e.tileY, e.def.size, -1);
    if (e.inside !== null) {
      const fort = this.byId.get(e.inside);
      if (fort) fort.garrison = fort.garrison.filter(id => id !== e.id);
    }
  }

  start(): void {
    this.started = true;
  }

  retreat(): void {
    if (this.started && !this.outcome) this.outcome = 'retreat';
  }

  setStance(side: Side, stance: Stance): void {
    for (const e of this.entities) {
      if (e.alive && e.side === side && isMobile(e) && e.inside === null) {
        e.stance = stance;
        // 改为驻守时，就地设为新驻地
        if (stance === 'hold') { e.postX = e.x; e.postY = e.y; }
      }
    }
  }

  drainEvents(): BattleEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  living(side?: Side): Entity[] {
    return this.entities.filter(e => e.alive && (!side || e.side === side));
  }

  step(): void {
    if (!this.started || this.outcome) return;
    this.time += Battle.DT;
    for (const e of this.entities) { e.px = e.x; e.py = e.y; }
    for (const e of this.entities) if (e.alive) this.updateCombat(e);
    for (const e of this.entities) if (e.alive && isMobile(e) && e.inside === null) this.updateMovement(e);
    this.separate();
    this.processDeaths();
    this.checkOutcome();
  }

  // ---------- 战斗 ----------

  private damageFactor(side: Side): number {
    return this.hqDown[side] ? HQ_DOWN_DAMAGE_MULT : 1;
  }

  private edgeDist(a: Entity, b: Entity): number {
    return distToEntity(a.x, a.y, b);
  }

  // 驻防步兵的射程加上工事的加成
  private rangeBonus(e: Entity): number {
    return e.inside === null ? 0 : this.byId.get(e.inside)?.def.rangeBonus ?? 0;
  }

  private updateCombat(e: Entity): void {
    const weapons = e.def.weapons;
    for (let i = 0; i < weapons.length; i++) {
      e.cooldowns[i] = Math.max(0, e.cooldowns[i] - Battle.DT);
      if (e.cooldowns[i] > 0) continue;
      const target = this.pickTarget(e, weapons[i]);
      if (!target) continue;
      e.cooldowns[i] = weapons[i].interval;
      this.fire(e, weapons[i], target);
    }
  }

  // 优先打克制倍率高的目标，同倍率打最近的
  private pickTarget(e: Entity, w: Weapon): Entity | null {
    const range = w.range + this.rangeBonus(e);
    let best: Entity | null = null, bestScore = -Infinity;
    for (const o of this.entities) {
      if (o.side === e.side || !targetable(o)) continue;
      const mult = DAMAGE_MULT[w.type][o.def.armor];
      if (mult <= 0) continue;
      const d = this.edgeDist(e, o);
      if (d > range || (w.minRange && d < w.minRange)) continue;
      const score = mult * 100 - d;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  private fire(e: Entity, w: Weapon, target: Entity): void {
    const factor = this.damageFactor(e.side);
    e.facing = Math.atan2(target.y - e.y, target.x - e.x);
    if (w.splash) {
      for (const o of this.entities) {
        if (o.side === e.side || !targetable(o)) continue;
        if (distToEntity(target.x, target.y, o) > w.splash) continue;
        o.hp -= w.dmg * DAMAGE_MULT[w.type][o.def.armor] * factor;
      }
      this.events.push({ type: 'boom', x: target.x, y: target.y, r: w.splash });
    } else {
      target.hp -= w.dmg * DAMAGE_MULT[w.type][target.def.armor] * factor;
    }
    this.events.push({ type: 'shot', from: e.id, to: target.id, dmgType: w.type });
  }

  // e 对 o 能造成伤害的最远射程；打不动返回 -1
  private rangeVs(e: Entity, o: Entity): number {
    let r = -1;
    for (const w of e.def.weapons) {
      if (DAMAGE_MULT[w.type][o.def.armor] > 0) r = Math.max(r, w.range);
    }
    return r;
  }

  private bestMult(e: Entity, o: Entity): number {
    let m = 0;
    for (const w of e.def.weapons) m = Math.max(m, DAMAGE_MULT[w.type][o.def.armor]);
    return m;
  }

  // ---------- 移动 ----------

  // 选择要接近的敌人：驻守单位只管警戒圈内的，出击单位不限距离
  private engageTarget(e: Entity): Entity | null {
    const maxRange = Math.max(...e.def.weapons.map(w => w.range));
    let best: Entity | null = null, bestScore = Infinity;
    for (const o of this.entities) {
      if (o.side === e.side || !targetable(o)) continue;
      const mult = this.bestMult(e, o);
      if (mult <= 0) continue;
      if (e.stance === 'hold' && distToEntity(e.postX, e.postY, o) > maxRange + ALERT_MARGIN) continue;
      const score = this.edgeDist(e, o) / mult;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  private updateMovement(e: Entity): void {
    const target = this.engageTarget(e);
    let goal: Point | null = null, goalKey = '';
    if (target) {
      if (this.edgeDist(e, target) <= this.rangeVs(e, target) * 0.95) { e.path = []; return; }
      goal = { x: target.x, y: target.y };
      goalKey = 'e' + target.id;
    } else if (e.stance === 'hold' && Math.hypot(e.x - e.postX, e.y - e.postY) > 0.3) {
      goal = { x: e.postX, y: e.postY };
      goalKey = 'post';
    }
    if (!goal) { e.path = []; return; }

    e.repathIn -= Battle.DT;
    if (goalKey !== e.pathTargetKey || e.repathIn <= 0) {
      e.pathTargetKey = goalKey;
      e.repathIn = REPATH_SECONDS + this.rng.next() * 0.3;
      const path = this.grid.findPath(Math.floor(e.x), Math.floor(e.y), Math.floor(goal.x), Math.floor(goal.y));
      e.path = path ?? [];
      // 最后一步走到精确位置
      if (e.path.length) e.path[e.path.length - 1] = { x: goal.x, y: goal.y };
    }
    this.followPath(e);
  }

  private followPath(e: Entity): void {
    let budget = e.def.speed * Battle.DT;
    while (budget > 0 && e.path.length) {
      const wp = e.path[0];
      const dx = wp.x - e.x, dy = wp.y - e.y, d = Math.hypot(dx, dy);
      if (d < 1e-6) { e.path.shift(); continue; }
      e.facing = Math.atan2(dy, dx);
      if (d <= budget) {
        e.x = wp.x; e.y = wp.y;
        e.path.shift();
        budget -= d;
      } else {
        e.x += (dx / d) * budget;
        e.y += (dy / d) * budget;
        budget = 0;
      }
    }
  }

  // 防止同一格里的单位完全叠在一起
  private separate(): void {
    const mobile = this.entities.filter(e => e.alive && isMobile(e) && e.inside === null);
    for (let i = 0; i < mobile.length; i++) {
      for (let j = i + 1; j < mobile.length; j++) {
        const a = mobile[i], b = mobile[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= SEPARATION) continue;
        if (d < 1e-6) { dx = this.rng.next() - 0.5; dy = this.rng.next() - 0.5; d = Math.hypot(dx, dy); }
        const push = (SEPARATION - d) / 2;
        const ux = (dx / d) * push, uy = (dy / d) * push;
        this.nudge(a, -ux, -uy);
        this.nudge(b, ux, uy);
      }
    }
  }

  private nudge(e: Entity, dx: number, dy: number): void {
    const nx = e.x + dx, ny = e.y + dy;
    if (this.grid.isWalkable(Math.floor(nx), Math.floor(ny))) { e.x = nx; e.y = ny; }
  }

  // ---------- 结算 ----------

  private processDeaths(): void {
    for (const e of this.entities) {
      if (!e.alive || e.hp > 0) continue;
      e.alive = false;
      e.hp = 0;
      if (e.def.size > 0) this.grid.setOccupant(e.tileX, e.tileY, e.def.size, -1);
      if (e.def.kind === 'hq') this.hqDown[e.side] = true;
      this.ejectGarrison(e);
      this.events.push({ type: 'death', id: e.id });
    }
  }

  // 工事被摧毁，里面的步兵被弹出来，就地驻守
  private ejectGarrison(fort: Entity): void {
    fort.garrison.forEach((id, k) => {
      const u = this.byId.get(id);
      if (!u || !u.alive) return;
      const a = (k / Math.max(1, fort.garrison.length)) * Math.PI * 2;
      u.inside = null;
      u.x = u.px = u.postX = fort.x + Math.cos(a) * 0.3;
      u.y = u.py = u.postY = fort.y + Math.sin(a) * 0.3;
      u.stance = 'hold';
    });
    fort.garrison = [];
  }

  // 胜利：敌方所有目标被消灭，或敌方指挥部被毁且部队打光（残余塔视为敌方撤退）。
  // 失败：我方部队全灭——营地的塔不能移动，单靠塔攻不下基地。
  private checkOutcome(): void {
    const enemy = this.living('enemy');
    if (enemy.length === 0 || (this.hqDown.enemy && !enemy.some(isMobile))) {
      this.outcome = 'victory';
    } else if (!this.living('player').some(isMobile)) {
      this.outcome = 'defeat';
    }
  }
}
