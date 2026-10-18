import { DAMAGE_MULT, HQ_DOWN_DAMAGE_MULT, type DamageType } from '../data/combat';
import { DEFS, isAirDef, RANGE_SCALE, type DefId, type UnitDef, type Weapon } from '../data/units';
import type { Grid, Point } from './grid';
import type { Rng } from './rng';

export type Side = 'player' | 'enemy';
export type Stance = 'hold' | 'assault'; // 驻守：只在驻地附近迎敌；出击：主动寻找敌人
export type Outcome = 'victory' | 'defeat' | 'retreat';

// 玩家下达的命令：移动到某点，或集火某个目标。完成后清空，恢复按姿态自动行动。
export type Order =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attack'; targetId: number };

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
  fw: number; // 建筑占地的宽（x）和高（y），一般就是 def.size；机场是长方形
  fh: number;
  alive: boolean;
  skin: string | null; // 显示成哪种基地建筑（民用建筑用），只影响画面
  inside: number | null; // 步兵：驻防在哪座工事里
  garrison: number[]; // 工事：里面驻防的步兵
  order: Order | null;
  strikeId: number | null; // 战斗机：这一趟要轰炸的目标
  pass: Point | null; // 战斗机：投弹后飞过头的位置，到了再掉头
  alt: number; // 飞机离地高度：0 停在地上，1 正常飞行高度。地面单位和建筑是 0
  launch: Launch | null; // 停在机场、还没飞起来的飞机
}

// 停在机场的飞机：到时间后沿 route 滑行到跑道头，再沿跑道加速起飞、爬升
export interface Launch {
  airfield: number; // 机场的实体编号：机场被毁时还没飞起来的飞机一起被毁
  at: number | null; // 开战后第几秒开始滑行；null = 不起飞（轰炸机守家时留在机库）
  route: Point[]; // 滑行路线，最后两个点是跑道起点和尽头
  leg: number; // 正在走第几段
  speed: number; // 当前地速
}

export type BattleEvent =
  | { type: 'shot'; from: number; to: number; dmgType: DamageType }
  | { type: 'boom'; x: number; y: number; r: number }
  | { type: 'death'; id: number };

const ALERT_MARGIN = 3 * RANGE_SCALE; // 驻守单位的警戒半径 = 最大射程 + 该值
const SEPARATION = 0.35;
const REPATH_SECONDS = 1;
const FLY_PAST = 3 * RANGE_SCALE; // 战斗机投弹后再往前飞几格才掉头
const STEALTH_AA_MULT = 0.5;
const TAXI_SPEED = 1.5; // 滑行速度（格/秒）
const TAKEOFF_ACCEL = 2.5; // 跑道上加速（格/秒²）
const LIFTOFF = 0.55; // 跑道走到这个比例时离地
const CLIMB = 6; // 离地后再飞多少格爬到正常高度
const AIR_DETECT = 6 * RANGE_SCALE; // 战斗机多远能发现敌机
const AIR_OVERSHOOT = 2 * RANGE_SCALE; // 战斗机冲过敌机后再飞多远掉头
export const SCRAMBLE_GAP = 1; // 同一座机场相邻两架战斗机起飞间隔（秒），只有一条跑道

export const isMobile = (e: Entity) => e.def.speed > 0;
export const isAir = (e: Entity) => isAirDef(e.def);

// 驻防在工事里的步兵、还在机场地面上的飞机、地雷和障碍不能被选为目标，也不受溅射（障碍例外，见 blast）
const targetable = (o: Entity) => o.alive && o.hp > 0 && o.inside === null && !(o.launch && o.alt < 0.5)
  && o.def.kind !== 'trap' && o.def.kind !== 'obstacle';
// 不算“守备”的东西：地雷、障碍（打不到，不能要求进攻方把它们清光才算赢）
const isHidden = (o: Entity) => o.def.kind === 'trap' || o.def.kind === 'obstacle';

// 点 (px, py) 到实体受击区域的距离：建筑按整个占地矩形算，移动单位按半径算
export function distToEntity(px: number, py: number, o: Entity): number {
  if (o.def.size > 0) {
    const dx = Math.max(o.tileX - px, 0, px - (o.tileX + o.fw));
    const dy = Math.max(o.tileY - py, 0, py - (o.tileY + o.fh));
    return Math.hypot(dx, dy);
  }
  return Math.max(0, Math.hypot(o.x - px, o.y - py) - o.def.radius);
}

export class Battle {
  static readonly DT = 0.05;

  time = 0;
  ticks = 0; // 开战后走了几步；指挥记录按它对齐，服务器重放时在同一步下达
  started = false;
  attacker: Side = 'player'; // 进攻方；演习时玩家是防守方
  timeLimit = Infinity; // 超时算防守方赢（演习用）
  outcome: Outcome | null = null;
  readonly entities: Entity[] = [];
  readonly hqDown: Record<Side, boolean> = { player: false, enemy: false };
  private readonly byId = new Map<number, Entity>();
  private events: BattleEvent[] = [];
  private nextId = 1;

  constructor(readonly grid: Grid, private readonly rng: Rng) {}

  // 建筑的 (x, y) 是占地左上角格子；移动单位的 (x, y) 是格子坐标（可带小数）。
  // foot：长方形建筑的占地（宽、高），不给就是 def.size 见方
  spawn(defId: DefId, side: Side, x: number, y: number, stance: Stance = 'hold', skin: string | null = null,
    foot?: { w: number; h: number }): Entity {
    const def = DEFS[defId];
    const building = def.size > 0;
    const fw = building ? foot?.w ?? def.size : 0, fh = building ? foot?.h ?? def.size : 0;
    const cx = building ? x + fw / 2 : x;
    const cy = building ? y + fh / 2 : y;
    const e: Entity = {
      id: this.nextId++, defId, def, side,
      x: cx, y: cy, px: cx, py: cy,
      hp: def.hp,
      cooldowns: def.weapons.map(() => 0),
      facing: side === 'player' ? 0 : Math.PI,
      stance, postX: cx, postY: cy,
      path: [], pathTargetKey: '', repathIn: 0,
      tileX: Math.floor(x), tileY: Math.floor(y), fw, fh,
      alive: true,
      skin, inside: null, garrison: [], order: null, strikeId: null, pass: null,
      alt: isAirDef(def) ? 1 : 0, launch: null,
    };
    if (building) this.occupy(e, 1);
    this.entities.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  get(id: number): Entity | undefined {
    return this.byId.get(id);
  }

  // 建筑占地：地雷、障碍不占格（部队照走，只在网格上记拒马、铁丝网）；add = 1 放下，-1 拿掉
  private occupy(e: Entity, add: 1 | -1): void {
    const g = this.grid, i = g.idx(e.tileX, e.tileY);
    if (e.def.blockTanks) g.tankBlock[i] = Math.max(0, g.tankBlock[i] + add);
    else if (e.def.slowInfantry) g.slow[i] = Math.max(0, g.slow[i] + add);
    else if (e.def.kind !== 'trap') g.setOccupant(e.tileX, e.tileY, e.fw, e.fh, add > 0 ? e.id : -1);
  }

  // 飞机停在机场上：开战后第 at 秒沿 route 滑行、起飞（at 为 null 就一直停着）
  park(plane: Entity, airfield: Entity, route: Point[], at: number | null): void {
    plane.alt = 0;
    plane.launch = { airfield: airfield.id, at, route, leg: 0, speed: 0 };
    plane.postX = airfield.x;
    plane.postY = airfield.y;
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
    if (e.def.size > 0) this.occupy(e, -1);
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

  // 改姿态：给了 ids 就只改这些单位；同时取消它们正在执行的命令
  setStance(side: Side, stance: Stance, ids?: number[]): void {
    const only = ids ? new Set(ids) : null;
    for (const e of this.entities) {
      if (e.alive && e.side === side && isMobile(e) && !isAir(e) && e.inside === null && (!only || only.has(e.id))) {
        e.stance = stance;
        e.order = null;
        // 改为驻守时，就地设为新驻地
        if (stance === 'hold') { e.postX = e.x; e.postY = e.y; }
      }
    }
  }

  // 移动命令：多支部队在目的地附近排开，到达后就地驻守。飞机不接受移动命令
  orderMove(ids: number[], x: number, y: number): void {
    const units = ids.map(id => this.byId.get(id)).filter((u): u is Entity => !!u && this.commandable(u) && !isAir(u));
    const spots = formation(units.length);
    units.forEach((u, k) => {
      const tx = x + spots[k].x, ty = y + spots[k].y;
      const ok = this.grid.isWalkable(Math.floor(tx), Math.floor(ty));
      u.order = { kind: 'move', x: ok ? tx : x, y: ok ? ty : y };
      u.repathIn = 0;
    });
  }

  // 集火命令：所有能伤到目标的武器优先打它；轰炸机飞去轰炸它；战斗机去轰炸地面目标，或者追着敌机打
  orderAttack(ids: number[], targetId: number): void {
    const target = this.byId.get(targetId);
    if (!target || !targetable(target)) return;
    for (const id of ids) {
      const u = this.byId.get(id);
      if (!u || !this.commandable(u) || u.launch) continue;
      if (u.side === target.side || this.bestMult(u, target) <= 0) continue;
      u.order = { kind: 'attack', targetId };
      u.repathIn = 0;
    }
  }

  private commandable(u: Entity): boolean {
    return u.alive && isMobile(u) && u.inside === null;
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
    this.ticks++;
    this.time += Battle.DT;
    for (const e of this.entities) { e.px = e.x; e.py = e.y; }
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (isAir(e)) this.updatePlane(e);
      else if (e.def.kind === 'trap') this.updateTrap(e);
      else this.updateCombat(e);
    }
    for (const e of this.entities) if (e.alive && isMobile(e) && !isAir(e) && e.inside === null) this.updateMovement(e);
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

  // 地雷：敌方地面部队踩上来（进到 trigger 格以内）就炸，炸完就没了
  private updateTrap(e: Entity): void {
    const r = e.def.trigger ?? 0.5;
    for (const o of this.entities) {
      if (o.side === e.side || !o.alive || !isMobile(o) || isAir(o) || o.inside !== null) continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) > r) continue;
      this.blast(e, e.def.weapons[0], e.x, e.y);
      e.hp = 0;
      return;
    }
  }

  // 雷达：side 一方活着的雷达里，有没有罩住 (x, y) 的
  private radarCovers(side: Side, x: number, y: number): boolean {
    for (const o of this.entities) {
      if (o.side !== side || !o.alive || !o.def.aura) continue;
      if (Math.hypot(o.x - x, o.y - y) <= o.def.aura.radius) return true;
    }
    return false;
  }

  // 塔在己方雷达覆盖下射程加成
  private rangeMult(e: Entity): number {
    if (e.def.kind !== 'tower') return 1;
    let m = 1;
    for (const o of this.entities) {
      if (o.side !== e.side || !o.alive || !o.def.aura) continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) <= o.def.aura.radius) m = Math.max(m, o.def.aura.rangeMult);
    }
    return m;
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
    const range = (w.range + this.rangeBonus(e)) * this.rangeMult(e);
    const forced = this.orderTarget(e);
    if (forced && DAMAGE_MULT[w.type][forced.def.armor] > 0) {
      const d = this.edgeDist(e, forced);
      if (d <= range && !(w.minRange && d < w.minRange)) return forced;
    }
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
    e.facing = Math.atan2(target.y - e.y, target.x - e.x);
    if (w.salvo) {
      // 齐射：n 发散布在目标周围的圆里
      for (let k = 0; k < w.salvo.n; k++) {
        const a = this.rng.next() * 2 * Math.PI, d = Math.sqrt(this.rng.next()) * w.salvo.spread;
        this.blast(e, w, target.x + Math.cos(a) * d, target.y + Math.sin(a) * d);
      }
    } else if (w.splash) {
      this.blast(e, w, target.x, target.y);
    } else {
      this.hurt(target, w, this.damageFactor(e.side), e.side);
    }
    this.events.push({ type: 'shot', from: e.id, to: target.id, dmgType: w.type });
  }

  // side：开火的一方（看它的雷达有没有罩住目标，罩住了隐身就失效）
  private hurt(o: Entity, w: Weapon, factor: number, side: Side): void {
    const hidden = o.def.stealth && w.type === 'aa' && !w.ignoreStealth && !this.radarCovers(side, o.x, o.y);
    const stealth = hidden ? STEALTH_AA_MULT : 1;
    o.hp -= w.dmg * DAMAGE_MULT[w.type][o.def.armor] * factor * stealth;
  }

  // 溅射：以 (x, y) 为中心，范围内的敌方都受伤
  private blast(e: Entity, w: Weapon, x: number, y: number): void {
    const factor = this.damageFactor(e.side);
    for (const o of this.entities) {
      // 爆炸也能炸掉铁丝网、拒马（它们不能被直接攻击）
      if (o.side === e.side || !(targetable(o) || (o.def.kind === 'obstacle' && o.alive && o.hp > 0))) continue;
      if (distToEntity(x, y, o) > (w.splash ?? 0)) continue;
      this.hurt(o, w, factor, e.side);
    }
    this.events.push({ type: 'boom', x, y, r: w.splash ?? 0 });
  }

  // ---------- 飞机 ----------

  private updatePlane(e: Entity): void {
    for (let i = 0; i < e.cooldowns.length; i++) e.cooldowns[i] = Math.max(0, e.cooldowns[i] - Battle.DT);
    if (e.launch) { this.updateLaunch(e, e.launch); return; }
    if (e.def.kind === 'fighter') this.updateFighter(e);
    else this.updateBomber(e);
  }

  // 机场上的飞机：等到起飞时间，滑行到跑道头，沿跑道加速，过了一半离地，飞出跑道后继续爬升到正常高度。
  // 机场被毁时还没离地的飞机一起被毁
  private updateLaunch(e: Entity, l: Launch): void {
    const field = this.byId.get(l.airfield);
    if (e.alt < 0.5 && (!field || !field.alive)) { e.hp = 0; return; }
    if (l.at === null || this.time < l.at) return;
    const n = l.route.length, start = l.route[n - 2], end = l.route[n - 1];
    if (l.leg < n - 1) {
      // 滑行到跑道头
      const p = l.route[l.leg];
      l.speed = TAXI_SPEED;
      if (this.moveTo(e, p.x, p.y, TAXI_SPEED * Battle.DT)) l.leg++;
      return;
    }
    // 跑道上加速，冲出跑道后沿同一方向爬升
    l.speed = Math.min(e.def.speed, l.speed + TAKEOFF_ACCEL * Battle.DT);
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    const ux = (end.x - start.x) / len, uy = (end.y - start.y) / len;
    e.facing = Math.atan2(uy, ux);
    e.x += ux * l.speed * Battle.DT;
    e.y += uy * l.speed * Battle.DT;
    const along = (e.x - start.x) * ux + (e.y - start.y) * uy;
    e.alt = Math.min(1, Math.max(0, (along - len * LIFTOFF) / (len * (1 - LIFTOFF) + CLIMB)));
    const g = this.grid;
    if (e.alt >= 1 || e.x < 0.5 || e.y < 0.5 || e.x > g.w - 0.5 || e.y > g.h - 0.5) {
      e.alt = 1;
      e.launch = null;
    }
  }

  // 朝 (x, y) 走 step 这么远（不受地形阻挡），到了返回 true
  private moveTo(e: Entity, x: number, y: number, step: number): boolean {
    const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy);
    if (d > 1e-6) e.facing = Math.atan2(dy, dx);
    if (d <= step) { e.x = x; e.y = y; return true; }
    e.x += (dx / d) * step;
    e.y += (dy / d) * step;
    return false;
  }

  // 战斗机：附近有敌机就先空战；没有就自己挑一个地面目标俯冲过去，弹药好了就投弹，飞过头几格再掉头找下一个，来回穿梭
  private updateFighter(e: Entity): void {
    if (e.pass) {
      if (this.flyTo(e, e.pass.x, e.pass.y)) e.pass = null;
      return;
    }
    // 玩家指定的目标优先：敌机就去空战，地面目标就去轰炸
    const ordered = this.orderTarget(e);
    if (ordered && isAir(ordered)) { this.dogfight(e, ordered); return; }
    const enemy = ordered ? null : this.pickAir(e);
    if (enemy) { this.dogfight(e, enemy); return; }
    let t = ordered ?? (e.strikeId === null ? undefined : this.byId.get(e.strikeId));
    if (!t || !targetable(t)) {
      t = this.pickStrike(e);
      e.strikeId = t?.id ?? null;
    }
    if (!t) { this.flyTo(e, e.postX, e.postY); return; }
    if (!this.flyTo(e, t.x, t.y)) return;
    if (e.cooldowns[0] <= 0) {
      const w = e.def.weapons[0];
      this.blast(e, w, t.x, t.y);
      e.cooldowns[0] = w.interval;
    }
    e.strikeId = null;
    const g = this.grid;
    e.pass = {
      x: Math.min(g.w - 0.5, Math.max(0.5, e.x + Math.cos(e.facing) * FLY_PAST)),
      y: Math.min(g.h - 0.5, Math.max(0.5, e.y + Math.sin(e.facing) * FLY_PAST)),
    };
  }

  // 最近的敌机（已经飞起来的）
  private pickAir(e: Entity): Entity | null {
    if (e.def.weapons.length < 2) return null;
    let best: Entity | null = null, bestD = AIR_DETECT;
    for (const o of this.entities) {
      if (o.side === e.side || !isAir(o) || !targetable(o)) continue;
      const d = Math.hypot(o.x - e.x, o.y - e.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  // 空战：追着敌机飞，进了射程就开火；贴得太近就冲过去，飞远一点再掉头咬上
  private dogfight(e: Entity, t: Entity): void {
    const w = e.def.weapons[1], d = Math.hypot(t.x - e.x, t.y - e.y);
    if (d <= w.range && e.cooldowns[1] <= 0) {
      this.fire(e, w, t);
      e.cooldowns[1] = w.interval;
    }
    if (d < 1.5) {
      const g = this.grid;
      e.pass = {
        x: Math.min(g.w - 0.5, Math.max(0.5, e.x + Math.cos(e.facing) * AIR_OVERSHOOT)),
        y: Math.min(g.h - 0.5, Math.max(0.5, e.y + Math.sin(e.facing) * AIR_OVERSHOOT)),
      };
      return;
    }
    this.flyTo(e, t.x, t.y);
  }

  // 离得最近的几个地面目标里随机挑一个，免得所有战斗机扎堆
  private pickStrike(e: Entity): Entity | undefined {
    const near = this.entities
      .filter(o => o.side !== e.side && targetable(o) && !isAir(o))
      .map(o => ({ o, d: Math.hypot(o.x - e.x, o.y - e.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    return near.length ? near[Math.floor(this.rng.next() * near.length)].o : undefined;
  }

  // 轰炸机：飞到目标上空投弹，然后返航（回到起飞点）重新挂弹，挂好了再去。
  // 没有指定目标时自己挑：先炸防空炮，再炸别的塔和工事、指挥部，最后是其他建筑和部队
  private updateBomber(e: Entity): void {
    let t = this.orderTarget(e);
    if (!t) t = this.autoBomberTarget(e);
    if (t && e.cooldowns[0] <= 0) {
      if (this.flyTo(e, t.x, t.y)) {
        const w = e.def.weapons[0];
        this.blast(e, w, t.x, t.y);
        e.cooldowns[0] = w.interval;
      }
      return;
    }
    this.flyTo(e, e.postX, e.postY);
  }

  private autoBomberTarget(e: Entity): Entity | null {
    let best: Entity | null = null, bestScore = Infinity;
    for (const o of this.entities) {
      if (o.side === e.side || !targetable(o) || isAir(o)) continue;
      const kind = o.def.kind;
      const tier = o.defId === 'aaTower' ? 0 : kind === 'tower' || kind === 'fort' ? 1 : kind === 'hq' ? 2 : 3;
      const score = tier * 1000 + Math.hypot(o.x - e.x, o.y - e.y);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (best) e.order = { kind: 'attack', targetId: best.id };
    return best;
  }

  // 直线飞向 (x, y)，不受地形阻挡；到达返回 true
  private flyTo(e: Entity, x: number, y: number): boolean {
    const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy);
    const step = e.def.speed * Battle.DT;
    if (d > 1e-6) e.facing = Math.atan2(dy, dx);
    if (d <= step) { e.x = x; e.y = y; return true; }
    e.x += (dx / d) * step;
    e.y += (dy / d) * step;
    return false;
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
  // 飞机太快，地面部队不追，只在射程内开火
  private engageTarget(e: Entity): Entity | null {
    const maxRange = Math.max(...e.def.weapons.map(w => w.range));
    let best: Entity | null = null, bestScore = Infinity;
    for (const o of this.entities) {
      if (o.side === e.side || !targetable(o) || isAir(o)) continue;
      const mult = this.bestMult(e, o);
      if (mult <= 0) continue;
      if (e.stance === 'hold' && distToEntity(e.postX, e.postY, o) > maxRange + ALERT_MARGIN) continue;
      const score = this.edgeDist(e, o) / mult;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  // 集火目标；目标已倒下则清掉命令
  private orderTarget(e: Entity): Entity | null {
    if (e.order?.kind !== 'attack') return null;
    const t = this.byId.get(e.order.targetId);
    if (t && targetable(t)) return t;
    e.order = null;
    if (e.stance === 'hold' && !isAir(e)) { e.postX = e.x; e.postY = e.y; }
    return null;
  }

  private updateMovement(e: Entity): void {
    const order = e.order;
    if (order?.kind === 'move') {
      if (Math.hypot(e.x - order.x, e.y - order.y) < 0.15) {
        e.order = null;
        e.stance = 'hold';
        e.postX = e.x; e.postY = e.y;
        e.path = [];
        return;
      }
      this.goTo(e, { x: order.x, y: order.y }, `m${order.x},${order.y}`);
      return;
    }
    const target = this.orderTarget(e) ?? this.engageTarget(e);
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
    this.goTo(e, goal, goalKey);
  }

  private goTo(e: Entity, goal: Point, goalKey: string): void {
    e.repathIn -= Battle.DT;
    if (goalKey !== e.pathTargetKey || e.repathIn <= 0) {
      e.pathTargetKey = goalKey;
      e.repathIn = REPATH_SECONDS + this.rng.next() * 0.3;
      const path = this.grid.findPath(Math.floor(e.x), Math.floor(e.y), Math.floor(goal.x), Math.floor(goal.y), e.def.kind === 'tank');
      e.path = path ?? [];
      // 最后一步走到精确位置（目的地就在当前格时，路径为空，直接走过去）
      if (e.path.length) e.path[e.path.length - 1] = { x: goal.x, y: goal.y };
      else if (path) e.path = [{ x: goal.x, y: goal.y }];
    }
    this.followPath(e);
  }

  private followPath(e: Entity): void {
    // 步兵走在铁丝网上速度减半
    const g = this.grid, tx = Math.floor(e.x), ty = Math.floor(e.y);
    const slowed = e.def.kind === 'infantry' && g.inBounds(tx, ty) && g.slow[g.idx(tx, ty)] > 0;
    let budget = e.def.speed * Battle.DT * (slowed ? 0.5 : 1);
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
    const mobile = this.entities.filter(e => e.alive && isMobile(e) && !isAir(e) && e.inside === null);
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
    if (this.grid.passable(Math.floor(nx), Math.floor(ny), e.def.kind === 'tank')) { e.x = nx; e.y = ny; }
  }

  // ---------- 结算 ----------

  private processDeaths(): void {
    for (const e of this.entities) {
      if (!e.alive || e.hp > 0) continue;
      e.alive = false;
      e.hp = 0;
      if (e.def.size > 0) this.occupy(e, -1);
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

  // 进攻方赢：防守方所有地面目标被消灭，或指挥部被毁且地面部队打光（残余塔视为撤退）。
  // 防守方的飞机不算，地面打光后自行撤离。
  // 防守方赢：进攻方能移动的部队全灭（塔不能移动，单靠塔攻不下基地），或超时。
  // outcome 按玩家的角度记：玩家一方赢了就是 victory。
  private checkOutcome(): void {
    const att = this.attacker, def: Side = att === 'player' ? 'enemy' : 'player';
    const defenders = this.living(def).filter(e => !isAir(e) && !isHidden(e));
    let winner: Side | null = null;
    if (defenders.length === 0 || (this.hqDown[def] && !defenders.some(isMobile))) winner = att;
    else if (!this.living(att).some(isMobile) || this.time >= this.timeLimit) winner = def;
    if (winner) this.outcome = winner === 'player' ? 'victory' : 'defeat';
  }
}

// 移动命令的队形：以目的地为中心，按 0.6 格间距螺旋排开
function formation(n: number): Point[] {
  const spots: Point[] = [{ x: 0, y: 0 }];
  for (let ring = 1; spots.length < n; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) spots.push({ x: dx * 0.6, y: dy * 0.6 });
      }
    }
  }
  return spots.slice(0, n);
}
