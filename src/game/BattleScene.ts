import Phaser from 'phaser';
import type { DamageType } from '../data/combat';
import { DEFS, type DefId } from '../data/units';
import { Battle, type Entity, type Stance } from '../sim/battle';
import { autoDeploy, type Deployment } from '../sim/deploy';
import { createPrototypeBattle, ENEMY_HQ_CENTER, MAP_H, MAP_W } from '../sim/scenario';
import { Hud } from '../ui/hud';
import { pointsOf, TILE_H, tileDiamond, toScreen, toWorld } from './iso';
import { CUBE_HEIGHT, makeTextures, textureKey } from './textures';

export type Phase = 'landing' | 'deploy' | 'battle' | 'result';

interface Effect {
  kind: 'line' | 'ring';
  x1: number; y1: number; x2: number; y2: number;
  r: number;
  color: number;
  t: number;
  max: number;
}

const SHOT_COLOR: Record<DamageType, number> = {
  bullet: 0xfff0a8, hmg: 0xffd24a, he: 0xff8a3c, ap: 0xff5cf0, demo: 0xff3b3b, aa: 0x3cffd2, bomb: 0xff8a3c,
};

const MAX_STEPS_PER_FRAME = 40;

export class BattleScene extends Phaser.Scene {
  battle!: Battle;
  deployment!: Deployment;
  phase: Phase = 'landing';
  tool: DefId | null = null;
  stance: Stance = 'assault';
  speed = 1;
  paused = false;
  deployedCounts: Partial<Record<DefId, number>> = {};

  private seed = 1;
  private acc = 0;
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private terrain!: Phaser.GameObjects.Graphics;
  private rocks: Phaser.GameObjects.Image[] = [];
  private zone!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private effects: Effect[] = [];
  private hover: { x: number; y: number } | null = null;
  private dragFrom: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;
  private hud!: Hud;

  constructor() {
    super('battle');
  }

  create(): void {
    // 场景可能是从基地切回来的，清掉上一次的残留
    this.sprites = new Map();
    this.rocks = [];
    this.effects = [];
    makeTextures(this);
    this.terrain = this.add.graphics().setDepth(-1000);
    this.zone = this.add.graphics().setDepth(-999);
    this.ghost = this.add.graphics().setDepth(-998);
    this.overlay = this.add.graphics().setDepth(1e6);
    this.setupCamera();
    this.setupInput();
    this.hud = new Hud(this);
    this.events.once('shutdown', () => this.hud.destroy());
    this.newBattle();
  }

  goHome(): void {
    this.scene.start('base');
  }

  // ---------- 流程 ----------

  newBattle(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    for (const r of this.rocks) r.destroy();
    this.rocks = [];
    this.effects = [];
    const { battle, deployment } = createPrototypeBattle(this.seed++);
    this.battle = battle;
    this.deployment = deployment;
    this.tool = null;
    this.paused = false;
    this.speed = 1;
    this.drawTerrain();
    this.setPhase('landing');
  }

  setPhase(phase: Phase): void {
    this.phase = phase;
    if (phase !== 'deploy') this.tool = null;
    this.drawZone();
    this.hud.render();
  }

  relaunch(): void {
    this.setPhase('landing');
  }

  selectTool(defId: DefId | null): void {
    this.tool = this.tool === defId ? null : defId;
    this.hud.render();
  }

  autoDeploy(): void {
    autoDeploy(this.deployment, ENEMY_HQ_CENTER, this.stance);
    this.hud.render();
  }

  startBattle(): void {
    if (!this.deployment.placed().some(e => e.def.speed > 0)) return;
    this.deployedCounts = {};
    for (const e of this.deployment.placed()) {
      this.deployedCounts[e.defId] = (this.deployedCounts[e.defId] ?? 0) + 1;
    }
    this.battle.start();
    this.setPhase('battle');
  }

  setAllStance(stance: Stance): void {
    this.battle.setStance('player', stance);
    this.hud.render();
  }

  retreat(): void {
    this.battle.retreat();
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
        this.setPhase('result');
      }
    }

    const alpha = this.phase === 'battle' && !this.paused ? Math.min(1, this.acc / Battle.DT) : 1;
    this.syncSprites(alpha);
    this.updateEffects(deltaMs / 1000);
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
        this.effects.push({ kind: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y - 6, r: 0, color: SHOT_COLOR[ev.dmgType], t: 0.08, max: 0.08 });
      } else if (ev.type === 'boom') {
        const p = this.screenPos(ev.x, ev.y);
        this.effects.push({ kind: 'ring', x1: p.x, y1: p.y, x2: 0, y2: 0, r: ev.r * TILE_H, color: 0xffa040, t: 0.35, max: 0.35 });
      } else if (ev.type === 'death') {
        const e = byId(ev.id);
        if (!e) continue;
        const p = this.screenPos(e.x, e.y);
        const big = e.def.size > 0 || e.def.kind === 'tank';
        this.effects.push({ kind: 'ring', x1: p.x, y1: p.y, x2: 0, y2: 0, r: big ? 28 : 10, color: big ? 0xff5030 : 0xcccccc, t: 0.5, max: 0.5 });
      }
    }
  }

  // ---------- 绘制 ----------

  private screenPos(x: number, y: number): Phaser.Math.Vector2 {
    const { sx, sy } = toScreen(x, y);
    return new Phaser.Math.Vector2(sx, sy);
  }

  private muzzle(e: Entity): Phaser.Math.Vector2 {
    const p = this.screenPos(e.x, e.y);
    const fort = e.inside !== null ? this.battle.get(e.inside) : undefined;
    const lift = fort ? (CUBE_HEIGHT[fort.defId] ?? 16) : e.def.size > 0 ? (CUBE_HEIGHT[e.defId] ?? 24) : 12;
    p.y -= lift;
    return p;
  }

  private drawTerrain(): void {
    const g = this.terrain;
    g.clear();
    const grass = [0x4f7d36, 0x55843a, 0x4a7633];
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const n = (tx * 7 + ty * 13 + ((tx * ty) % 5)) % 3;
        g.fillStyle(grass[n]);
        g.fillPoints(pointsOf(tileDiamond(tx, ty)), true);
        if (this.battle.grid.rock[this.battle.grid.idx(tx, ty)]) {
          const c = toScreen(tx + 0.5, ty + 0.5);
          const rock = this.add.image(c.sx, c.sy + TILE_H * 0.35, 'rock').setOrigin(0.5, 1).setDepth(tx + ty + 1);
          this.rocks.push(rock);
        }
      }
    }
    g.lineStyle(1, 0x000000, 0.08);
    for (let i = 0; i <= MAP_W; i++) {
      const a = toScreen(i, 0), b = toScreen(i, MAP_H);
      g.lineBetween(a.sx, a.sy, b.sx, b.sy);
    }
    for (let j = 0; j <= MAP_H; j++) {
      const a = toScreen(0, j), b = toScreen(MAP_W, j);
      g.lineBetween(a.sx, a.sy, b.sx, b.sy);
    }
  }

  private drawZone(): void {
    const g = this.zone;
    g.clear();
    if (this.phase === 'landing') {
      // 可投送的格子按被几座敌方塔覆盖着色：绿 0、黄 1、橙 2、红 3+
      const colors = [0x7dff8a, 0xffe14a, 0xff9a3c, 0xff4d4d];
      for (let ty = 0; ty < MAP_H; ty++) {
        for (let tx = 0; tx < MAP_W; tx++) {
          if (!this.deployment.canLand(tx, ty)) continue;
          g.fillStyle(colors[Math.min(3, this.deployment.threatAt(tx, ty))], 0.55);
          g.fillPoints(pointsOf(tileDiamond(tx, ty)), true);
        }
      }
    } else if (this.phase === 'deploy') {
      g.fillStyle(0x3d8bfd, 0.22);
      for (let ty = 0; ty < MAP_H; ty++) {
        for (let tx = 0; tx < MAP_W; tx++) {
          if (this.deployment.inCamp(tx, ty)) g.fillPoints(pointsOf(tileDiamond(tx, ty)), true);
        }
      }
    }
  }

  private drawGhost(): void {
    const g = this.ghost;
    g.clear();
    const h = this.hover;
    if (!h || h.x < 0 || h.y < 0 || h.x >= MAP_W || h.y >= MAP_H) return;
    let ok: boolean | null = null;
    if (this.phase === 'landing') ok = this.deployment.canLand(h.x, h.y);
    else if (this.phase === 'deploy' && this.tool) ok = this.deployment.canPlace(this.tool, h.x, h.y) === true;
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
    if (this.phase === 'landing' && ok) {
      this.isoCircle(g, h.x + 0.5, h.y + 0.5, this.deployment.campRadius, 0x7dff8a, 0.9);
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
      if (!e.alive || e.inside !== null) {
        if (s) { s.destroy(); this.sprites.delete(e.id); }
        continue;
      }
      if (!s) {
        s = this.add.image(0, 0, textureKey(e.defId, e.side));
        if (e.def.size > 0) s.setOrigin(0.5, 1);
        else if (e.def.kind === 'tank') s.setOrigin(0.5, 1);
        else s.setOrigin(0.5, 21 / 24);
        this.sprites.set(e.id, s);
      }
      const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
      const p = toScreen(x, y);
      if (e.def.size > 0) {
        s.setPosition(p.sx, p.sy + 0.8 * e.def.size * (TILE_H / 2));
      } else if (e.def.kind === 'tank') {
        s.setPosition(p.sx, p.sy + s.width / 4);
        // 只区分朝屏幕左还是右
        s.setFlipX(Math.cos(e.facing) - Math.sin(e.facing) < 0);
      } else {
        s.setPosition(p.sx, p.sy);
      }
      s.setDepth(x + y);
    }
    // 部署阶段撤回的单位
    for (const [id, s] of this.sprites) {
      if (!this.battle.entities.some(e => e.id === id)) { s.destroy(); this.sprites.delete(id); }
    }
  }

  private updateEffects(dt: number): void {
    for (const fx of this.effects) fx.t -= dt;
    this.effects = this.effects.filter(fx => fx.t > 0);
  }

  private drawOverlay(alpha: number): void {
    const g = this.overlay;
    g.clear();
    for (const e of this.battle.entities) {
      if (!e.alive) continue;
      const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
      const p = toScreen(x, y);
      // 塔炮管
      if (e.def.kind === 'tower') {
        const top = p.sy - (CUBE_HEIGHT[e.defId] ?? 24) + 6;
        const dir = toScreen(Math.cos(e.facing), Math.sin(e.facing));
        const len = Math.hypot(dir.sx, dir.sy) || 1;
        g.lineStyle(e.defId === 'cannonTower' ? 5 : 3, 0x2a2f36);
        g.lineBetween(p.sx, top, p.sx + (dir.sx / len) * 16, top + (dir.sy / len) * 16);
      }
      if (e.inside !== null) continue;
      // 工事上方：驻防人数
      if (e.def.kind === 'fort') {
        const cap = e.def.capacity ?? 0, y0 = p.sy - (CUBE_HEIGHT[e.defId] ?? 16) - 10;
        for (let k = 0; k < cap; k++) {
          const cx = p.sx + (k - (cap - 1) / 2) * 8;
          g.fillStyle(k < e.garrison.length ? (e.side === 'player' ? 0x5fb0ff : 0xff5a5a) : 0x000000, k < e.garrison.length ? 1 : 0.35);
          g.fillCircle(cx, y0, 3);
        }
      }
      // 血条
      if (e.hp < e.def.hp) {
        const w = e.def.kind === 'hq' ? 80 : e.def.size > 0 || e.def.kind === 'tank' ? 34 : 18;
        const lift = e.def.size > 0 ? (CUBE_HEIGHT[e.defId] ?? 24) + 18 : 26;
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

  // ---------- 相机与输入 ----------

  private setupCamera(): void {
    const cam = this.cameras.main;
    const left = toScreen(0, MAP_H).sx, right = toScreen(MAP_W, 0).sx;
    const bottom = toScreen(MAP_W, MAP_H).sy;
    cam.setBounds(left - 400, -400, right - left + 800, bottom + 800);
    const c = toScreen(MAP_W / 2, MAP_H / 2);
    cam.centerOn(c.sx, c.sy);
    // 开局缩放到整张战场都能看见
    const mapW = (MAP_W + MAP_H) * (TILE_H) + 80, mapH = (MAP_W + MAP_H) * (TILE_H / 2) + 120;
    cam.setZoom(Phaser.Math.Clamp(Math.min(cam.width / mapW, cam.height / mapH), 0.5, 1.5));
  }

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as typeof this.keys;
    kb.on('keydown-ESC', () => this.selectTool(null));
    kb.on('keydown-SPACE', () => { if (this.phase === 'battle') { this.paused = !this.paused; this.hud.render(); } });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const w = toWorld(p.worldX, p.worldY);
      this.hover = { x: Math.floor(w.x), y: Math.floor(w.y) };
      if (this.dragFrom && p.rightButtonDown()) {
        const cam = this.cameras.main;
        cam.scrollX = this.dragFrom.scrollX - (p.x - this.dragFrom.x) / cam.zoom;
        cam.scrollY = this.dragFrom.scrollY - (p.y - this.dragFrom.y) / cam.zoom;
      }
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        const cam = this.cameras.main;
        this.dragFrom = { x: p.x, y: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY };
        return;
      }
      if (!this.hover) return;
      const { x, y } = this.hover;
      if (this.phase === 'landing') {
        if (this.deployment.land(x, y)) this.setPhase('deploy');
      } else if (this.phase === 'deploy' && this.tool) {
        this.deployment.place(this.tool, x, y, this.stance);
        if (DEFS[this.tool].kind !== 'tower' && (this.deployment.roster[this.tool] ?? 0) <= 0) this.tool = null;
        this.hud.render();
      }
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.button !== 2 || !this.dragFrom) return;
      const moved = Math.hypot(p.x - this.dragFrom.x, p.y - this.dragFrom.y);
      this.dragFrom = null;
      // 右键单击（没拖动）：取消工具或撤回单位
      if (moved < 5 && this.phase === 'deploy' && this.hover) {
        if (this.tool) this.selectTool(null);
        else if (this.deployment.removeAt(this.hover.x, this.hover.y)) this.hud.render();
      }
    });

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.4, 2));
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
