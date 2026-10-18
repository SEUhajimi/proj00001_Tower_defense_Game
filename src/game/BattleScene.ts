import Phaser from 'phaser';
import type { DamageType } from '../../shared/data/combat';
import { DEFS, type DefId } from '../../shared/data/units';
import { Battle, isAir, isMobile, type Entity, type Stance } from '../../shared/sim/battle';
import { autoDeploy, type Deployment } from '../../shared/sim/deploy';
import type { Point } from '../../shared/sim/grid';
import { createPrototypeBattle, ENEMY_HQ_CENTER, MAP_W as PROTO_MAP } from '../../shared/sim/scenario';
import type { BattleLog } from '../../shared/sim/world/replay';
import { createAiBattle, type Roster, type SortieReport } from '../../shared/sim/world/sortie';
import type { AiBase } from '../../shared/sim/world/ai';
import { createDrill } from '../../shared/sim/world/drill';
import { finishSortie, session } from './session';
import { Hud } from '../ui/hud';
import { footprintDiamond, pointsOf, TILE_H, TILE_W, tileDiamond, toScreen, toWorld } from './iso';
import {
  damagedKey, dirIndex, flashKey, fxFrames, groundKey, PARKED_SCALE, propKeys, ruinKey, texAnchor, texLift, texScale, unitFrames,
  type FxFrames,
} from './art';
import { BASE_INSET, makeBaseTextures, makeTextures, PLANE_ALT, SIDE_COLOR, textureKey } from './textures';

export type Phase = 'deploy' | 'battle' | 'result';

// 出击（打 AI 基地，结果写回存档）、演习（电脑进攻自己的基地，什么都不改变）
// 或战斗原型（开发调试用的固定战场）
export interface BattleInit {
  mode: 'sortie' | 'drill' | 'prototype';
  aiId?: number;
  roster?: Roster; // 出击带的部队；演习时是进攻方的部队
  sortieId?: string; // 出击：服务器发的编号和战场种子
  seed?: number;
}

const AI_TINT = 0xff9a9a;

interface Effect {
  kind: 'line' | 'ring' | 'anim';
  x1: number; y1: number; x2: number; y2: number;
  r: number;
  color: number;
  t: number;
  max: number;
  img?: Phaser.GameObjects.Image; // anim：逐帧播放的爆炸
  frames?: string[];
}

// 枪口火光的显示大小（像素），按伤害类型；炸弹、炸药包没有火光
const FLASH_SIZE: Record<DamageType, number> = { bullet: 10, hmg: 14, he: 24, ap: 22, demo: 0, aa: 16, bomb: 0 };
const FIRE_FPS = 12;

const SHOT_COLOR: Record<DamageType, number> = {
  bullet: 0xfff0a8, hmg: 0xffd24a, he: 0xff8a3c, ap: 0xff5cf0, demo: 0xff3b3b, aa: 0x3cffd2, bomb: 0xff8a3c,
};

const MAX_STEPS_PER_FRAME = 40;
// 播放速度（只影响画面快慢，不影响结算）：默认 0.5 倍，看得清；换过就记住，下一场沿用
const SPEEDS = [0.5, 1, 2, 4];
let lastSpeed = 0.5;
const PICK_RADIUS = 18; // 点选单位的容差（世界像素）
const DRAG_THRESHOLD = 6; // 鼠标移动超过这么多像素才算拖动

export class BattleScene extends Phaser.Scene {
  battle!: Battle;
  deployment!: Deployment;
  phase: Phase = 'deploy';
  tool: DefId | null = null;
  stance: Stance = 'assault';
  speed = lastSpeed;
  paused = false;
  deployedCounts: Partial<Record<DefId, number>> = {};
  selected = new Set<number>(); // 交战时框选中的我方部队

  mode: BattleInit['mode'] = 'prototype';
  ai: AiBase | null = null;
  report: SortieReport | null = null; // 出击结算结果（服务器算的）
  settling = false; // 正在等服务器结算
  settleError: string | null = null;
  private roster: Roster = {};
  private sortieId = '';
  private sortieSeed = 1;
  // 出击的战斗记录：开战时的部署 + 交战中的每条命令，结束后交给服务器重打
  private log: BattleLog = { placements: [], commands: [] };
  private mapW = PROTO_MAP;
  private mapH = PROTO_MAP;
  private hqCenter: Point = ENEMY_HQ_CENTER;
  private seed = 1;
  private acc = 0;
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private terrain!: Phaser.GameObjects.Graphics;
  private rocks: Phaser.GameObjects.Image[] = [];
  private zone!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private marks!: Phaser.GameObjects.Graphics; // 地面上的阵营圈和飞机影子
  private effects: Effect[] = [];
  // 受损建筑上烧着的火：每座建筑几簇，循环播放
  private fires = new Map<number, { img: Phaser.GameObjects.Image; phase: number }[]>();
  private fireTime = 0;
  private hover: { x: number; y: number } | null = null;
  private dragFrom: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  // 框选：世界坐标矩形 + 起点屏幕坐标（用来判断是拖动还是单击）
  private box: { x0: number; y0: number; x1: number; y1: number; sx: number; sy: number } | null = null;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;
  private hoverTarget: Entity | null = null; // 选中部队时鼠标指着的敌人（右键就集火它）
  private lastClick = { t: 0, defId: '' }; // 双击同一种兵：选中屏幕上全部同类
  private groups = new Map<number, number[]>(); // 编组：数字键 → 部队编号
  private lastGroupKey = { k: -1, t: 0 }; // 连按两下同一个数字：镜头跳过去
  private hud!: Hud;

  constructor() {
    super('battle');
  }

  init(data: BattleInit): void {
    this.mode = data?.mode ?? 'prototype';
    this.roster = { ...(data?.roster ?? {}) };
    this.sortieId = data?.sortieId ?? '';
    this.sortieSeed = data?.seed ?? 1;
    this.ai = this.mode === 'sortie' && data.aiId !== undefined ? session().base.getAi(data.aiId) ?? null : null;
    if (this.mode === 'sortie' && (!this.ai || !this.sortieId)) this.mode = 'prototype';
  }

  create(): void {
    // 场景可能是从基地切回来的，清掉上一次的残留
    this.sprites = new Map();
    this.rocks = [];
    this.effects = [];
    this.selected = new Set();
    makeTextures(this);
    makeBaseTextures(this);
    this.terrain = this.add.graphics().setDepth(-1000);
    this.zone = this.add.graphics().setDepth(-999);
    this.ghost = this.add.graphics().setDepth(-998);
    this.marks = this.add.graphics().setDepth(-500);
    this.overlay = this.add.graphics().setDepth(1e6);
    this.setupInput();
    this.hud = new Hud(this);
    this.events.once('shutdown', () => this.hud.destroy());
    this.newBattle();
  }

  goHome(): void {
    this.scene.start(this.mode === 'sortie' ? 'world' : 'base');
  }

  // ---------- 流程 ----------

  newBattle(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    for (const r of this.rocks) r.destroy();
    this.rocks = [];
    for (const fx of this.effects) fx.img?.destroy();
    this.effects = [];
    for (const list of this.fires.values()) for (const f of list) f.img.destroy();
    this.fires.clear();
    this.report = null;
    this.settling = false;
    this.settleError = null;
    this.log = { placements: [], commands: [] };
    if (this.mode === 'sortie' && this.ai) {
      const fight = createAiBattle(this.ai, this.roster, this.sortieSeed);
      this.battle = fight.battle;
      this.deployment = fight.deployment;
      this.mapW = this.mapH = fight.mapSize;
      this.hqCenter = fight.hqCenter;
    } else if (this.mode === 'drill') {
      const drill = createDrill(session().base, this.roster, Date.now() % 1e9);
      this.battle = drill.battle;
      this.deployment = drill.deployment;
      this.mapW = drill.mapW;
      this.mapH = drill.mapH;
      this.hqCenter = drill.hqCenter;
    } else {
      const { battle, deployment } = createPrototypeBattle(this.seed++);
      this.battle = battle;
      this.deployment = deployment;
      this.mapW = this.mapH = PROTO_MAP;
      this.hqCenter = ENEMY_HQ_CENTER;
    }
    this.setupCamera();
    this.tool = null;
    this.paused = false;
    this.speed = lastSpeed;
    this.drawTerrain();
    this.setPhase('deploy');
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
    if (phase !== 'deploy') this.tool = null;
    this.drawZone();
    this.hud.render();
  }

  selectTool(defId: DefId | null): void {
    this.tool = this.tool === defId ? null : defId;
    this.hud.render();
  }

  autoDeploy(): void {
    autoDeploy(this.deployment, this.hqCenter, this.stance);
    this.hud.render();
  }

  startBattle(): void {
    if (!this.deployment.placed().some(e => e.def.speed > 0)) return;
    this.deployedCounts = {};
    for (const e of this.deployment.placed()) {
      this.deployedCounts[e.defId] = (this.deployedCounts[e.defId] ?? 0) + 1;
    }
    this.log.placements = this.deployment.placed().map(e => ({ id: e.id, defId: e.defId, x: e.x, y: e.y, stance: e.stance }));
    this.battle.start();
    this.setPhase('battle');
  }

  // 播放速度：0.5 → 1 → 2 → 4 → 0.5 循环
  cycleSpeed(): void {
    this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
    lastSpeed = this.speed;
    this.hud.render();
  }

  // 有选中的部队就只改它们，否则改全军
  setAllStance(stance: Stance): void {
    const ids = this.selected.size ? [...this.selected] : undefined;
    this.battle.setStance('player', stance, ids);
    this.log.commands.push({ step: this.battle.ticks, kind: 'stance', stance, ids });
    this.hud.render();
  }

  selectAll(): void {
    this.selected = new Set(this.commandable().map(e => e.id));
    this.hud.render();
  }

  // 一键选中同型号的全部飞机（轰炸机靠这个指定目标）
  selectType(defId: DefId): void {
    this.selected = new Set(this.commandable().filter(e => e.defId === defId).map(e => e.id));
    this.hud.render();
  }

  clearSelection(): void {
    if (!this.selected.size) return;
    this.selected.clear();
    this.hud.render();
  }

  retreat(): void {
    if (this.battle.started && !this.battle.outcome) this.log.commands.push({ step: this.battle.ticks, kind: 'retreat' });
    this.battle.retreat();
  }

  // 出击结束：把战斗记录交给服务器，服务器重打一遍、结算伤亡和掠夺，以它的结果为准。
  // 断线导致失败时可以再试
  settle(): void {
    if (this.mode !== 'sortie' || !this.ai || this.settling || this.report) return;
    this.settling = true;
    this.settleError = null;
    if (this.phase === 'result') this.hud.render();
    void finishSortie(this.sortieId, this.log).then(r => {
      this.settling = false;
      if (typeof r === 'string') this.settleError = r;
      else this.report = r;
      if (this.phase === 'result') this.hud.render();
    });
  }

  // ---------- 每帧 ----------

  update(_time: number, deltaMs: number): void {
    this.moveCameraByKeys(deltaMs / 1000);

    if (this.phase === 'battle' && !this.paused) {
      this.acc += Math.min(deltaMs / 1000, 0.25) * this.speed;
      let steps = 0;
      while (this.acc >= Battle.DT && steps < MAX_STEPS_PER_FRAME && !this.battle.outcome) {
        this.battle.step();
        this.acc -= Battle.DT;
        steps++;
        this.consumeEvents();
      }
      if (this.battle.outcome) {
        this.acc = 0;
        this.settle();
        this.setPhase('result');
      }
    }

    const alpha = this.phase === 'battle' && !this.paused ? Math.min(1, this.acc / Battle.DT) : 1;
    this.syncSprites(alpha);
    this.drawMarks(alpha);
    this.updateEffects(deltaMs / 1000);
    this.updateHover();
    this.drawOverlay(alpha);
    this.drawGhost();
  }

  private consumeEvents(): void {
    const byId = (id: number) => this.battle.get(id);
    for (const ev of this.battle.drainEvents()) {
      if (ev.type === 'shot') {
        const a = byId(ev.from), b = byId(ev.to);
        if (!a || !b) continue;
        const p = this.muzzle(a), q = this.screenPos(b.x, b.y);
        const lift = isAir(b) ? PLANE_ALT * b.alt : 6;
        this.effects.push({ kind: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y - lift, r: 0, color: SHOT_COLOR[ev.dmgType], t: 0.08, max: 0.08 });
        const flash = flashKey(), fs = FLASH_SIZE[ev.dmgType];
        if (flash && fs) this.anim({ keys: [flash], rendered: true }, p.x, p.y, fs, 0.06);
      } else if (ev.type === 'boom') {
        const p = this.screenPos(ev.x, ev.y), fr = fxFrames('explosion');
        if (fr) this.anim(fr, p.x, p.y, Math.max(28, ev.r * TILE_W * 0.9), 0.5);
      } else if (ev.type === 'death') {
        const e = byId(ev.id);
        if (!e) continue;
        const p = this.screenPos(e.x, e.y);
        const big = e.def.size > 0 || e.def.kind === 'tank' || isAir(e);
        const smoke = fxFrames('smoke');
        if (big && smoke) this.anim(smoke, p.x, p.y - (isAir(e) ? PLANE_ALT * e.alt : 0), e.def.size > 0 ? e.def.size * 40 : 40, 0.9);
        else this.effects.push({ kind: 'ring', x1: p.x, y1: p.y, x2: 0, y2: 0, r: 10, color: 0xcccccc, t: 0.5, max: 0.5 });
        if (e.def.size > 0) this.addRuin(e);
      }
    }
  }

  // 爆炸、烟雾、枪口火光：逐帧换图，播完删除。size 是显示宽度（像素）。
  // 渲染图按锚点对准 (x, y)，团块只占图宽的六成左右，所以放大一些；Kenney 的图画在点的上方
  private anim(fr: FxFrames, x: number, y: number, size: number, dur: number): void {
    const img = this.add.image(x, y, fr.keys[0]).setDepth(1e5);
    const a = fr.rendered ? texAnchor(fr.keys[0]) : null;
    if (a) img.setOrigin(a.x, a.y).setScale(size / (img.width * 0.6));
    else img.setPosition(x, y - size * 0.3).setScale(size / img.width);
    this.effects.push({ kind: 'anim', x1: x, y1: y, x2: 0, y2: 0, r: 0, color: 0, t: dur, max: dur, img, frames: fr.keys });
  }

  // 建筑被摧毁：原地留一堆瓦砾（盖在地面上，比单位低）。机场的跑道炸不掉，留下受损的机场
  private addRuin(e: Entity): void {
    if (e.defId === 'airbase') {
      const k = damagedKey(this.texKeyOf(e)) ?? this.texKeyOf(e), a = texAnchor(k);
      const p = this.screenPos(e.x, e.y), img = this.add.image(p.x, p.y, k).setScale(texScale(k)).setDepth(e.tileX + e.tileY + 1);
      if (a) img.setOrigin(a.x, a.y);
      img.setTint(0x9a9a9a);
      this.rocks.push(img);
      return;
    }
    const key = ruinKey(e.def.size, e.id);
    if (!key) return;
    const p = this.screenPos(e.x, e.y), a = texAnchor(key)!;
    this.rocks.push(this.add.image(p.x, p.y, key).setOrigin(a.x, a.y).setScale(texScale(key)).setDepth(e.x + e.y - e.def.size / 2));
  }

  // 受损建筑（血量一半以下）上的火：按占地大小摆 1–3 簇，建筑没了就熄灭
  private syncFires(e: Entity, s?: Phaser.GameObjects.Image): void {
    const burning = e.alive && e.hp <= e.def.hp / 2;
    let list = this.fires.get(e.id);
    if (!burning) {
      if (list) { for (const f of list) f.img.destroy(); this.fires.delete(e.id); }
      return;
    }
    const fr = fxFrames('fire');
    if (!fr || list || !s) return;
    list = [];
    const lift = this.liftOf(e);
    for (let k = 0; k < e.def.size; k++) {
      // 用编号定位置，同一座建筑每次都烧在同样的地方
      const h = (e.id * 7919 + k * 104729) % 1000 / 1000;
      const x = s.x + (h - 0.5) * e.def.size * 28, y = s.y - lift * (0.45 + 0.4 * ((h * 7) % 1));
      const img = this.add.image(x, y, fr.keys[0]).setDepth(s.depth + 0.1);
      const a = texAnchor(fr.keys[0])!;
      img.setOrigin(a.x, a.y).setScale(texScale(fr.keys[0]) * (0.45 + 0.15 * e.def.size));
      list.push({ img, phase: Math.floor(h * fr.keys.length) });
    }
    this.fires.set(e.id, list);
  }

  // ---------- 绘制 ----------

  private texKeyOf(e: Entity): string {
    if (!e.skin) return textureKey(e.defId, e.side);
    // skin 里带着等级（house-l3）和机场朝向（airfield-r1-l3）；那一级没渲染就用不分级的
    if (this.textures.exists(`bb-${e.skin}`)) return `bb-${e.skin}`;
    return `bb-${e.skin.replace(/-(r\d-)?l\d$/, '')}`;
  }

  // 建筑顶面离地面多高（显示像素）：放炮管、血条、驻防人数用
  private liftOf(e: Entity, fallback = 24): number {
    return texLift(this.texKeyOf(e), fallback);
  }

  private screenPos(x: number, y: number): Phaser.Math.Vector2 {
    const { sx, sy } = toScreen(x, y);
    return new Phaser.Math.Vector2(sx, sy);
  }

  private muzzle(e: Entity): Phaser.Math.Vector2 {
    const p = this.screenPos(e.x, e.y);
    const fort = e.inside !== null ? this.battle.get(e.inside) : undefined;
    const lift = fort ? this.liftOf(fort, 16) : e.def.size > 0 ? this.liftOf(e) : isAir(e) ? PLANE_ALT * e.alt : 8;
    p.y -= lift;
    return p;
  }

  private drawTerrain(): void {
    const g = this.terrain;
    g.clear();
    const grass = [0x8ab549, 0x85b045, 0x8fba4d];
    const rockKeys = propKeys('rocks');
    // 有渲染的草地贴图就一块地（4×4 格）铺一张
    if (groundKey('plain', 0, 0)) {
      for (let by = 0; by < this.mapH; by += 4) {
        for (let bx = 0; bx < this.mapW; bx += 4) {
          const tile = groundKey('plain', bx / 4, by / 4)!, a = texAnchor(tile)!;
          const c = toScreen(bx + 2, by + 2);
          this.rocks.push(this.add.image(c.sx, c.sy, tile).setOrigin(a.x, a.y).setScale(texScale(tile)).setDepth(-999.5));
        }
      }
    }
    for (let ty = 0; ty < this.mapH; ty++) {
      for (let tx = 0; tx < this.mapW; tx++) {
        const n = (tx * 7 + ty * 13 + ((tx * ty) % 5)) % 3;
        g.fillStyle(grass[n]);
        g.fillPoints(pointsOf(tileDiamond(tx, ty)), true);
        if (this.battle.grid.rock[this.battle.grid.idx(tx, ty)]) {
          const c = toScreen(tx + 0.5, ty + 0.5), key = rockKeys.keys[(tx + ty) % rockKeys.keys.length];
          const rock = this.add.image(c.sx, c.sy, key).setDepth(tx + ty + 1);
          if (rockKeys.rendered) {
            // 石堆图按 2×2 格画的，战场上的岩石只占 1 格，缩小一半
            const a = texAnchor(key)!;
            rock.setOrigin(a.x, a.y).setScale(texScale(key) / 2);
          } else {
            rock.setPosition(c.sx, c.sy + TILE_H / 2).setOrigin(0.5, 1).setScale(TILE_W / rock.width);
          }
          this.rocks.push(rock);
        }
      }
    }
    g.lineStyle(1, 0x000000, 0.08);
    for (let i = 0; i <= this.mapW; i++) {
      const a = toScreen(i, 0), b = toScreen(i, this.mapH);
      g.lineBetween(a.sx, a.sy, b.sx, b.sy);
    }
    for (let j = 0; j <= this.mapH; j++) {
      const a = toScreen(0, j), b = toScreen(this.mapW, j);
      g.lineBetween(a.sx, a.sy, b.sx, b.sy);
    }
  }

  private drawZone(): void {
    const g = this.zone;
    g.clear();
    if (this.phase !== 'deploy') return;
    // 投送区按被几座敌方塔覆盖着色：绿 0、黄 1、橙 2、红 3+
    const colors = [0x7dff8a, 0xffe14a, 0xff9a3c, 0xff4d4d];
    for (let ty = 0; ty < this.mapH; ty++) {
      for (let tx = 0; tx < this.mapW; tx++) {
        if (!this.deployment.inDropZone(tx, ty)) continue;
        g.fillStyle(colors[Math.min(3, this.deployment.threatAt(tx, ty))], 0.4);
        g.fillPoints(pointsOf(tileDiamond(tx, ty)), true);
      }
    }
  }

  private drawGhost(): void {
    const g = this.ghost;
    g.clear();
    const h = this.hover;
    if (!h || h.x < 0 || h.y < 0 || h.x >= this.mapW || h.y >= this.mapH) return;
    let ok: boolean | null = null;
    if (this.phase === 'deploy' && this.tool) ok = this.deployment.canPlace(this.tool, h.x, h.y) === true;
    if (ok === null) {
      g.lineStyle(2, 0xffffff, 0.5);
      g.strokePoints(pointsOf(tileDiamond(h.x, h.y)), true);
      return;
    }
    g.fillStyle(ok ? 0x7dff8a : 0xff4040, 0.45);
    g.fillPoints(pointsOf(tileDiamond(h.x, h.y)), true);
    if (this.phase === 'deploy' && this.tool && ok) {
      const range = Math.max(0, ...DEFS[this.tool].weapons.map(w => w.range));
      this.isoCircle(g, h.x + 0.5, h.y + 0.5, range, 0xffffff, 0.6);
    }
  }

  private isoCircle(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
    const c = toScreen(x, y);
    g.lineStyle(1.5, color, alpha);
    g.strokeEllipse(c.sx, c.sy, r * 2 * 32 * Math.SQRT2, r * 2 * 16 * Math.SQRT2);
  }

  private syncSprites(alpha: number): void {
    for (const e of this.battle.entities) {
      let s = this.sprites.get(e.id);
      // 敌方的地雷看不见
      if (!e.alive || e.inside !== null || (e.def.kind === 'trap' && e.side !== 'player')) {
        if (s) { s.destroy(); this.sprites.delete(e.id); }
        if (this.fires.has(e.id)) this.syncFires(e);
        continue;
      }
      if (!s) {
        const frames = unitFrames(e.defId, e.side);
        const key = frames ? frames[0] : this.texKeyOf(e);
        s = this.add.image(0, 0, key).setScale(texScale(key));
        if (e.skin && e.side === 'enemy') s.setTint(AI_TINT);
        if (e.def.kind === 'trap') s.setAlpha(0.6); // 自己的地雷半透明，表示埋在地下
        const a = texAnchor(key);
        if (a) s.setOrigin(a.x, a.y);
        else s.setOrigin(0.5, e.def.size > 0 ? 1 : 0.5);
        this.sprites.set(e.id, s);
      }
      const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
      const p = toScreen(x, y);
      const frames = e.def.size > 0 ? null : unitFrames(e.defId, e.side);
      if (e.def.size > 0 && texAnchor(s.texture.key)) {
        // 渲染图的锚点就是占地中心；血量一半以下换成受损的图，冒火
        const base = this.texKeyOf(e), hurt = e.hp <= e.def.hp / 2 ? damagedKey(base) : null;
        if (s.texture.key !== (hurt ?? base)) s.setTexture(hurt ?? base);
        // 长方形的机场几乎是平的：层级按后排机库算，停在上面的飞机、跑道上的部队画在它上面
        s.setPosition(p.sx, p.sy).setDepth(e.fw !== e.fh ? e.tileX + e.tileY + 1 : x + y);
        this.syncFires(e, s);
      } else if (e.def.size > 0) {
        s.setPosition(p.sx, p.sy + (e.skin ? BASE_INSET : 0.8) * e.def.size * (TILE_H / 2));
      } else if (frames) {
        // 渲染的单位：按朝向换图，不转图片；锚点是脚下（飞机是机身中心，画在空中）
        s.setTexture(frames[dirIndex(e.facing)]);
        if (isAir(e)) {
          // 停在机场上的飞机画小一些，起飞爬升时慢慢升高、变回原大；离地后画在所有地面物体之上
          s.setScale(texScale(s.texture.key) * (PARKED_SCALE + (1 - PARKED_SCALE) * e.alt));
          s.setPosition(p.sx, p.sy - PLANE_ALT * e.alt).setDepth(e.alt > 0.2 ? 5000 + x + y : x + y + 0.5);
          continue;
        }
        s.setPosition(p.sx, p.sy);
      } else if (isAir(e)) {
        // 飞机在高处，朝向按屏幕上的方向旋转；画在所有地面物体之上
        const d = toScreen(Math.cos(e.facing), Math.sin(e.facing));
        s.setPosition(p.sx, p.sy - PLANE_ALT * e.alt);
        s.setRotation(Math.atan2(d.sy, d.sx));
        s.setDepth(5000 + x + y);
        continue;
      } else {
        // 坦克、士兵是俯视图，按屏幕上的朝向旋转；坦克贴图朝上，士兵贴图朝右
        const d = toScreen(Math.cos(e.facing), Math.sin(e.facing));
        const a = Math.atan2(d.sy, d.sx);
        s.setPosition(p.sx, p.sy - (e.def.kind === 'tank' ? 4 : 6));
        s.setRotation(e.def.kind === 'tank' ? a + Math.PI / 2 : a);
      }
      s.setDepth(x + y);
    }
    // 部署阶段撤回的单位
    for (const [id, s] of this.sprites) {
      if (!this.battle.entities.some(e => e.id === id)) { s.destroy(); this.sprites.delete(id); }
    }
  }

  private updateEffects(dt: number): void {
    this.fireTime += dt;
    const fire = this.fires.size ? fxFrames('fire') : null;
    if (fire) {
      const f0 = Math.floor(this.fireTime * FIRE_FPS);
      for (const list of this.fires.values()) for (const f of list) f.img.setTexture(fire.keys[(f0 + f.phase) % fire.keys.length]);
    }
    for (const fx of this.effects) {
      fx.t -= dt;
      if (fx.img && fx.frames) {
        if (fx.t <= 0) { fx.img.destroy(); continue; }
        const k = Math.min(fx.frames.length - 1, Math.floor((1 - fx.t / fx.max) * fx.frames.length));
        fx.img.setTexture(fx.frames[k]);
      }
    }
    this.effects = this.effects.filter(fx => fx.t > 0);
  }

  // 地面层：每个单位脚下的阵营色圈、飞机的影子
  private drawMarks(alpha: number): void {
    const g = this.marks;
    g.clear();
    for (const e of this.battle.entities) {
      if (!e.alive || e.inside !== null || e.def.size > 0) continue;
      const p = toScreen(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha);
      if (isAir(e)) {
        g.fillStyle(0x000000, 0.22);
        const k = PARKED_SCALE + (1 - PARKED_SCALE) * e.alt;
        g.fillEllipse(p.sx, p.sy, (e.def.kind === 'bomber' ? 30 : 18) * k, (e.def.kind === 'bomber' ? 12 : 7) * k);
        continue;
      }
      const r = e.def.kind === 'tank' ? 18 : 9;
      g.fillStyle(SIDE_COLOR[e.side], 0.45);
      g.fillEllipse(p.sx, p.sy, r * 2, r);
    }
  }

  private drawOverlay(alpha: number): void {
    const g = this.overlay;
    g.clear();
    this.drawSelection(g, alpha);
    for (const e of this.battle.entities) {
      if (!e.alive) continue;
      const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
      const p = toScreen(x, y);
      // 塔炮管
      if (e.def.kind === 'tower') {
        const top = p.sy - this.liftOf(e) + 4;
        const dir = toScreen(Math.cos(e.facing), Math.sin(e.facing));
        const len = Math.hypot(dir.sx, dir.sy) || 1;
        g.lineStyle(e.defId === 'cannonTower' ? 5 : 3, 0x2a2f36);
        g.lineBetween(p.sx, top, p.sx + (dir.sx / len) * 16, top + (dir.sy / len) * 16);
      }
      if (e.inside !== null) continue;
      // 工事上方：驻防人数
      if (e.def.kind === 'fort') {
        const cap = e.def.capacity ?? 0, y0 = p.sy - this.liftOf(e, 16) - 14;
        for (let k = 0; k < cap; k++) {
          const cx = p.sx + (k - (cap - 1) / 2) * 8;
          g.fillStyle(k < e.garrison.length ? (e.side === 'player' ? 0x5fb0ff : 0xff5a5a) : 0x000000, k < e.garrison.length ? 1 : 0.35);
          g.fillCircle(cx, y0, 3);
        }
      }
      // 血条（选中的部队一直显示；地雷没有）
      if ((e.hp < e.def.hp || this.selected.has(e.id)) && e.def.kind !== 'trap') {
        const w = e.def.kind === 'hq' ? 80 : e.def.size > 0 || e.def.kind === 'tank' ? 34 : 18;
        const lift = e.def.size > 0 ? this.liftOf(e) + 22 : isAir(e) ? PLANE_ALT * e.alt + 18 : 22;
        const bx = p.sx - w / 2, by = p.sy - lift;
        g.fillStyle(0x000000, 0.6);
        g.fillRect(bx - 1, by - 1, w + 2, 5);
        g.fillStyle(e.side === 'player' ? 0x5fb0ff : 0xff5a5a);
        g.fillRect(bx, by, w * Math.max(0, e.hp / e.def.hp), 3);
      }
    }
    for (const fx of this.effects) {
      const a = fx.t / fx.max;
      if (fx.kind === 'line') {
        g.lineStyle(2, fx.color, a);
        g.lineBetween(fx.x1, fx.y1, fx.x2, fx.y2);
      } else {
        g.lineStyle(2, fx.color, a);
        const k = 1.3 - a * 0.6;
        g.strokeEllipse(fx.x1, fx.y1, fx.r * 2 * k * Math.SQRT2, fx.r * k * Math.SQRT2);
      }
    }
  }

  // 选中部队脚下的绿圈、它们集火目标上的红框、框选矩形
  private drawSelection(g: Phaser.GameObjects.Graphics, alpha: number): void {
    const targets = new Set<number>();
    for (const id of this.selected) {
      const e = this.battle.get(id);
      if (!e || !e.alive) { this.selected.delete(id); continue; }
      const p = toScreen(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha);
      const r = e.def.kind === 'tank' || e.def.kind === 'bomber' ? 20 : 11;
      g.lineStyle(2, 0x7dff8a, 0.95);
      g.strokeEllipse(p.sx, p.sy - (isAir(e) ? PLANE_ALT * e.alt : 0), r * 2, r);
      if (e.order?.kind === 'attack') targets.add(e.order.targetId);
      if (e.order?.kind === 'move') {
        const m = toScreen(e.order.x, e.order.y);
        g.lineStyle(1, 0x7dff8a, 0.35);
        g.lineBetween(p.sx, p.sy, m.sx, m.sy);
      }
    }
    for (const id of targets) {
      const t = this.battle.get(id);
      if (t && t.alive) this.outlineTarget(g, t, 0.95);
    }
    // 鼠标指着的敌人：右键就会集火它
    if (this.hoverTarget && !targets.has(this.hoverTarget.id)) this.outlineTarget(g, this.hoverTarget, 0.6);
    if (this.box) {
      const { x0, y0, x1, y1 } = this.box;
      const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      g.fillStyle(0x7dff8a, 0.08);
      g.fillRect(x, y, w, h);
      g.lineStyle(1, 0x7dff8a, 0.9);
      g.strokeRect(x, y, w, h);
    }
  }

  // ---------- 选择与命令 ----------

  private commandable(): Entity[] {
    return this.battle.living('player').filter(e => isMobile(e) && e.inside === null && !e.launch);
  }

  private outlineTarget(g: Phaser.GameObjects.Graphics, t: Entity, alpha: number): void {
    g.lineStyle(2, 0xff4040, alpha);
    if (t.def.size > 0) g.strokePoints(pointsOf(footprintDiamond(t.tileX, t.tileY, t.fw, t.fh)), true);
    else { const p = toScreen(t.x, t.y); g.strokeEllipse(p.sx, p.sy - (isAir(t) ? PLANE_ALT * t.alt : 0), 26, 13); }
  }

  // 点选的容差：镜头拉远时单位变小，容差按屏幕像素算，不会越来越难点中
  private pickRadius(): number {
    return PICK_RADIUS / Math.min(1, this.cameras.main.zoom);
  }

  // 鼠标下的敌人：先看移动单位（飞机按画面上的高度），再看建筑的图——点在楼身上也算，不只是地面的占地
  private enemyAt(wx: number, wy: number): Entity | null {
    const units = this.battle.living('enemy').filter(e => isMobile(e) && e.inside === null && !(e.launch && e.alt < 0.5));
    const unit = this.pickUnit(units, wx, wy);
    if (unit) return unit;
    let best: Entity | null = null, bestDepth = -Infinity;
    for (const e of this.battle.living('enemy')) {
      // 地雷看不见，障碍打不了，右键不选它们
      if (e.def.size <= 0 || e.def.kind === 'trap' || e.def.kind === 'obstacle') continue;
      const s = this.sprites.get(e.id);
      if (!s || s.depth <= bestDepth || !s.getBounds().contains(wx, wy)) continue;
      // 图里透明的地方（还有淡淡的影子）不算点中
      const lx = (wx - s.x) / s.scaleX + s.displayOriginX, ly = (wy - s.y) / s.scaleY + s.displayOriginY;
      if (this.textures.getPixelAlpha(Math.floor(lx), Math.floor(ly), s.texture.key) < 170) continue;
      best = e;
      bestDepth = s.depth;
    }
    if (best) return best;
    const w = toWorld(wx, wy), grid = this.battle.grid, tx = Math.floor(w.x), ty = Math.floor(w.y);
    const occ = grid.inBounds(tx, ty) ? grid.occupant[grid.idx(tx, ty)] : -1;
    const b = occ === -1 ? undefined : this.battle.get(occ);
    return b && b.side === 'enemy' && b.alive ? b : null;
  }

  // 每帧：选中了部队时，看鼠标指着的是不是敌人，换鼠标样式（准星 = 右键集火）
  private updateHover(): void {
    // activePointer 的 worldX 只在鼠标事件里换算过，镜头移动后会过时，这里按屏幕坐标重新算
    const p = this.input.activePointer, w = this.cameras.main.getWorldPoint(p.x, p.y);
    const target = this.phase === 'battle' && this.selected.size && !this.box ? this.enemyAt(w.x, w.y) : null;
    if (target !== this.hoverTarget) {
      this.hoverTarget = target;
      this.input.setDefaultCursor(target ? 'crosshair' : 'default');
    }
  }

  // 编组：Shift + 数字键把选中的部队编成一组，按数字键选中这一组，连按两下镜头跳过去
  private groupKey(k: number, assign: boolean): void {
    if (this.phase !== 'battle') return;
    if (assign) {
      if (this.selected.size) this.groups.set(k, [...this.selected]);
      this.hud.render();
      return;
    }
    const alive = (this.groups.get(k) ?? []).filter(id => this.battle.get(id)?.alive);
    if (!alive.length) return;
    this.selected = new Set(alive);
    const now = this.time.now;
    if (this.lastGroupKey.k === k && now - this.lastGroupKey.t < 400) {
      const units = alive.map(id => this.battle.get(id)!);
      const c = toScreen(units.reduce((s, u) => s + u.x, 0) / units.length, units.reduce((s, u) => s + u.y, 0) / units.length);
      this.cameras.main.pan(c.sx, c.sy, 250, 'Sine.easeOut');
    }
    this.lastGroupKey = { k, t: now };
    this.hud.render();
  }

  // 选中屏幕上看得见的全部同类部队
  private selectSameOnScreen(defId: string, add: boolean): void {
    if (!add) this.selected.clear();
    const view = this.cameras.main.worldView;
    for (const e of this.commandable()) {
      if (e.defId !== defId) continue;
      const p = toScreen(e.x, e.y);
      if (view.contains(p.sx, p.sy - pickLift(e))) this.selected.add(e.id);
    }
  }

  // 框选（世界像素矩形内的我方部队）或点选（离鼠标最近的一个）；add = 按住 Shift 追加
  private selectAt(x0: number, y0: number, x1: number, y1: number, isBox: boolean, add: boolean, same = false): void {
    if (!isBox) {
      const hit = this.pickUnit(this.commandable(), x1, y1), now = this.time.now;
      const double = !!hit && this.lastClick.defId === hit.defId && now - this.lastClick.t < 350;
      this.lastClick = { t: now, defId: hit?.defId ?? '' };
      if (hit && (same || double)) {
        this.selectSameOnScreen(hit.defId, add);
        this.hud.render();
        return;
      }
    }
    if (!add) this.selected.clear();
    if (isBox) {
      const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
      for (const e of this.commandable()) {
        const p = toScreen(e.x, e.y), sy = p.sy - pickLift(e);
        if (p.sx >= lx && p.sx <= hx && sy >= ly && sy <= hy) this.selected.add(e.id);
      }
    } else {
      const hit = this.pickUnit(this.commandable(), x1, y1);
      if (hit) {
        if (add && this.selected.has(hit.id)) this.selected.delete(hit.id);
        else this.selected.add(hit.id);
      }
    }
    this.hud.render();
  }

  private pickUnit(units: Entity[], wx: number, wy: number): Entity | null {
    let best: Entity | null = null, bestD = this.pickRadius();
    for (const e of units) {
      const p = toScreen(e.x, e.y);
      const d = Math.hypot(p.sx - wx, p.sy - pickLift(e) - wy);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // 右键：点到敌人（兵或建筑占地）就集火，否则移动到该点
  private command(wx: number, wy: number): void {
    const ids = [...this.selected];
    if (!ids.length) return;
    const target = this.enemyAt(wx, wy);
    const w = toWorld(wx, wy), tx = Math.floor(w.x), ty = Math.floor(w.y);
    if (target) {
      this.battle.orderAttack(ids, target.id);
      this.log.commands.push({ step: this.battle.ticks, kind: 'attack', ids, targetId: target.id });
      const p = toScreen(target.x, target.y);
      this.effects.push({ kind: 'ring', x1: p.sx, y1: p.sy, x2: 0, y2: 0, r: 14, color: 0xff4040, t: 0.4, max: 0.4 });
      return;
    }
    if (!this.battle.grid.isWalkable(tx, ty)) return;
    this.battle.orderMove(ids, w.x, w.y);
    this.log.commands.push({ step: this.battle.ticks, kind: 'move', ids, x: w.x, y: w.y });
    this.effects.push({ kind: 'ring', x1: wx, y1: wy, x2: 0, y2: 0, r: 10, color: 0x7dff8a, t: 0.4, max: 0.4 });
  }

  // ---------- 相机与输入 ----------

  private setupCamera(): void {
    const cam = this.cameras.main;
    const left = toScreen(0, this.mapH).sx, right = toScreen(this.mapW, 0).sx;
    const bottom = toScreen(this.mapW, this.mapH).sy;
    cam.setBounds(left - 400, -400, right - left + 800, bottom + 800);
    const c = toScreen(this.mapW / 2, this.mapH / 2);
    cam.centerOn(c.sx, c.sy);
    // 开局缩放到整张战场都能看见
    const viewW = (this.mapW + this.mapH) * TILE_H + 80, viewH = (this.mapW + this.mapH) * (TILE_H / 2) + 120;
    cam.setZoom(Phaser.Math.Clamp(Math.min(cam.width / viewW, cam.height / viewH), 0.15, 1.5));
  }

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as typeof this.keys;
    kb.on('keydown-ESC', () => { this.selectTool(null); this.clearSelection(); });
    kb.on('keydown-SPACE', () => { if (this.phase === 'battle') { this.paused = !this.paused; this.hud.render(); } });
    kb.on('keydown-A', (ev: KeyboardEvent) => { if (ev.ctrlKey && this.phase === 'battle') { ev.preventDefault(); this.selectAll(); } });
    kb.on('keydown', (ev: KeyboardEvent) => {
      const m = /^Digit([1-9])$/.exec(ev.code);
      if (m && !ev.ctrlKey && !ev.altKey) this.groupKey(Number(m[1]), ev.shiftKey);
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const w = toWorld(p.worldX, p.worldY);
      this.hover = { x: Math.floor(w.x), y: Math.floor(w.y) };
      if (this.dragFrom && p.rightButtonDown()) {
        const cam = this.cameras.main;
        cam.scrollX = this.dragFrom.scrollX - (p.x - this.dragFrom.x) / cam.zoom;
        cam.scrollY = this.dragFrom.scrollY - (p.y - this.dragFrom.y) / cam.zoom;
      }
      if (this.box && p.leftButtonDown()) { this.box.x1 = p.worldX; this.box.y1 = p.worldY; }
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        const cam = this.cameras.main;
        this.dragFrom = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
        return;
      }
      if (this.phase === 'battle') {
        this.box = { x0: p.worldX, y0: p.worldY, x1: p.worldX, y1: p.worldY, sx: p.x, sy: p.y };
        return;
      }
      if (!this.hover) return;
      const { x, y } = this.hover;
      if (this.phase === 'deploy' && this.tool) {
        this.deployment.place(this.tool, x, y, this.stance);
        if ((this.deployment.roster[this.tool] ?? 0) <= 0) this.tool = null;
        this.hud.render();
      }
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      // 左键松开：完成框选或点选
      if (p.button === 0 && this.box) {
        const b = this.box;
        this.box = null;
        if (this.phase === 'battle') {
          const isBox = Math.hypot(p.x - b.sx, p.y - b.sy) >= DRAG_THRESHOLD;
          const ev = p.event as MouseEvent;
          this.selectAt(b.x0, b.y0, p.worldX, p.worldY, isBox, ev.shiftKey, ev.ctrlKey);
        }
        return;
      }
      if (p.button !== 2 || !this.dragFrom) return;
      const moved = Math.hypot(p.x - this.dragFrom.x, p.y - this.dragFrom.y);
      this.dragFrom = null;
      if (moved >= DRAG_THRESHOLD) return; // 那是在拖动视角
      // 右键单击：部署时取消工具或撤回单位；交战时下命令
      if (this.phase === 'deploy' && this.hover) {
        if (this.mode === 'drill') return; // 演习的进攻方由电脑布置
        if (this.tool) this.selectTool(null);
        else if (this.deployment.removeAt(this.hover.x, this.hover.y)) this.hud.render();
      } else if (this.phase === 'battle') {
        this.command(p.worldX, p.worldY);
      }
    });

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.15, 2));
    });
  }

  private moveCameraByKeys(dt: number): void {
    const k = this.keys, cam = this.cameras.main, v = 700 * dt / cam.zoom;
    if (k.A.isDown || k.LEFT.isDown) cam.scrollX -= v;
    if (k.D.isDown || k.RIGHT.isDown) cam.scrollX += v;
    if (k.W.isDown || k.UP.isDown) cam.scrollY -= v;
    if (k.S.isDown || k.DOWN.isDown) cam.scrollY += v;
  }
}

// 点选时以单位画面上的身体位置为准：飞机在高处
function pickLift(e: Entity): number {
  return isAir(e) ? PLANE_ALT * e.alt : 8;
}
