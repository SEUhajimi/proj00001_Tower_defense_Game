import Phaser from 'phaser';
import { baseDef, type BaseBuildingId, type Terrain } from '../data/economy';
import type { DefId } from '../data/units';
import { Base, type PlacedBuilding } from '../sim/base/base';
import { advanceTo } from '../sim/base/economy';
import { PLOT_SIZE, REGION_PLOTS, REGION_TILES } from '../sim/base/terrain';
import { aiRect, generateAiLayout, isProtected, type AiBase } from '../sim/world/ai';
import { canSortie, type Roster } from '../sim/world/sortie';
import { BaseHud } from '../ui/baseHud';
import { footprintDiamond, pointsOf, TILE_H, TILE_W, tileDiamond, toScreen, toWorld } from './iso';
import { resetSession, save, session } from './session';
import { BASE_CUBE_H, BASE_INSET, makeBaseTextures } from './textures';

export type BaseMode = 'idle' | 'build' | 'move' | 'buyLand';

const TERRAIN_COLOR: Record<Terrain, [number, number]> = {
  plain: [0x5b8a3a, 0x568436],
  forest: [0x2f6b2f, 0x2b632b],
  mountain: [0x8a8273, 0x837b6c],
  iron: [0x8f5a43, 0x895540],
  oil: [0x3c3f4a, 0x383b46],
};

const AI_TINT = 0xff8a80; // AI 基地的建筑偏红

interface Sprite {
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

// 基地场景 = 世界地图：自己的基地在中间，四周是 AI 基地。
export class BaseScene extends Phaser.Scene {
  base!: Base;
  mode: BaseMode = 'idle';
  tool: BaseBuildingId | null = null;
  selected: number | null = null; // 选中的自家建筑 uid
  selectedAi: number | null = null; // 选中的 AI 基地 id
  offline: { hours: number; gained: Record<string, number> } | null = null;
  message = '';

  private sprites = new Map<number, Sprite>();
  private aiSprites: Phaser.GameObjects.GameObject[] = [];
  private fog!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Graphics;
  private priceTags: Phaser.GameObjects.Text[] = [];
  private hover: { x: number; y: number } | null = null;
  private dragFrom: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;
  private tickTimer = 0;
  private saveTimer = 0;
  private hud!: BaseHud;
  private discardSave = false; // 重置存档时，退出场景不再写回
  private readonly saveOnUnload = () => save();

  constructor() {
    super('base');
  }

  create(): void {
    this.discardSave = false;
    const s = session();
    this.base = s.base;
    advanceTo(this.base, Date.now());
    // 离线收益只在打开游戏后第一次进入基地时显示
    this.offline = s.offline && s.offline.hours > 1 / 60 ? s.offline : null;
    s.offline = null;
    this.sprites = new Map();
    this.aiSprites = [];
    this.priceTags = [];
    this.mode = 'idle';
    this.tool = null;
    this.selected = null;
    this.selectedAi = null;

    makeBaseTextures(this);
    this.drawTerrain();
    this.fog = this.add.graphics().setDepth(-900);
    this.ghost = this.add.graphics().setDepth(1e6);
    this.drawTerritory();
    this.syncBuildings();
    this.drawAiBases();
    this.setupCamera();
    this.setupInput();

    this.hud = new BaseHud(this);
    window.addEventListener('beforeunload', this.saveOnUnload);
    this.events.once('shutdown', () => {
      if (!this.discardSave) save();
      window.removeEventListener('beforeunload', this.saveOnUnload);
      this.hud.destroy();
    });
  }

  // ---------- 玩家操作（由 HUD 和鼠标调用） ----------

  setMode(mode: BaseMode, tool: BaseBuildingId | null = null): void {
    this.mode = mode;
    this.tool = tool;
    if (mode !== 'move') this.message = '';
    if (mode !== 'idle') this.selectedAi = null;
    this.drawTerritory();
    this.hud.render();
  }

  selectBuild(id: BaseBuildingId): void {
    if (this.mode === 'build' && this.tool === id) this.setMode('idle');
    else { this.selected = null; this.setMode('build', id); }
  }

  startMove(): void {
    if (this.selected !== null) this.setMode('move');
  }

  demolishSelected(): void {
    if (this.selected === null) return;
    const r = this.base.demolish(this.selected);
    this.message = r === true ? '' : r;
    if (r === true) { this.selected = null; this.syncBuildings(); }
    this.hud.render();
  }

  setTax(rate: number): void {
    this.base.state.taxRate = rate;
  }

  recruit(defId: DefId, n: number): void {
    const r = this.base.recruit(defId, n);
    this.message = r === true ? '' : r;
    this.hud.render();
  }

  repairAll(): void {
    const r = this.base.repairAll();
    this.message = r === true ? '' : r;
    this.hud.render();
  }

  fastForward(hours: number): void {
    this.base.state.lastTick -= hours * 3600_000;
    for (const ai of this.base.state.ai) ai.lastTick -= hours * 3600_000;
    advanceTo(this.base, Date.now());
    this.hud.refresh();
  }

  resetSave(): void {
    this.discardSave = true;
    resetSession();
    this.scene.restart();
  }

  // 出击：检查后进入战斗场景
  startSortie(roster: Roster): void {
    const ai = this.selectedAiBase();
    if (!ai) return;
    const ok = canSortie(this.base, ai, roster, Date.now());
    if (ok !== true) { this.message = ok; this.hud.render(); return; }
    this.scene.start('battle', { mode: 'sortie', aiId: ai.id, roster });
  }

  enterPrototype(): void {
    this.scene.start('battle', { mode: 'prototype' });
  }

  selectedBuilding(): PlacedBuilding | undefined {
    return this.base.state.buildings.find(b => b.uid === this.selected);
  }

  selectedAiBase(): AiBase | undefined {
    return this.selectedAi === null ? undefined : this.base.getAi(this.selectedAi);
  }

  // ---------- 每帧 ----------

  update(_time: number, deltaMs: number): void {
    this.moveCameraByKeys(deltaMs / 1000);
    this.tickTimer += deltaMs;
    this.saveTimer += deltaMs;
    if (this.tickTimer >= 1000) {
      this.tickTimer = 0;
      advanceTo(this.base, Date.now());
    }
    if (this.saveTimer >= 10_000) {
      this.saveTimer = 0;
      save();
    }
    this.drawGhost();
  }

  // ---------- 绘制 ----------

  // 世界有 160×160 格，逐格画太重：按地块整块上色，再撒少量装饰
  private drawTerrain(): void {
    const g = this.add.graphics().setDepth(-1000);
    for (let py = 0; py < REGION_PLOTS; py++) {
      for (let px = 0; px < REGION_PLOTS; px++) {
        const t = this.base.terrain[py * REGION_PLOTS + px];
        const x0 = px * PLOT_SIZE, y0 = py * PLOT_SIZE;
        g.fillStyle(TERRAIN_COLOR[t][(px + py) & 1]);
        g.fillPoints(pointsOf(footprintDiamond(x0, y0, PLOT_SIZE)), true);
        for (const [dx, dy] of [[0.9, 1.1], [2.6, 0.8], [1.4, 2.7], [3.1, 2.9]]) {
          const c = toScreen(x0 + dx, y0 + dy);
          if (t === 'forest') {
            g.fillStyle(0x1d4a1d);
            g.fillTriangle(c.sx, c.sy - 14, c.sx - 7, c.sy + 2, c.sx + 7, c.sy + 2);
          } else if (t === 'mountain' && dx > 1) {
            g.fillStyle(0x6c6558);
            g.fillTriangle(c.sx, c.sy - 12, c.sx - 12, c.sy + 4, c.sx + 12, c.sy + 4);
          } else if (t === 'iron' || t === 'oil') {
            g.fillStyle(t === 'iron' ? 0xc07a52 : 0x15161a);
            g.fillEllipse(c.sx, c.sy, 12, 6);
          }
        }
      }
    }
    g.lineStyle(1, 0x000000, 0.18);
    for (let i = 0; i <= REGION_PLOTS; i++) {
      const a = toScreen(i * PLOT_SIZE, 0), b = toScreen(i * PLOT_SIZE, REGION_TILES);
      g.lineBetween(a.sx, a.sy, b.sx, b.sy);
      const c = toScreen(0, i * PLOT_SIZE), d = toScreen(REGION_TILES, i * PLOT_SIZE);
      g.lineBetween(c.sx, c.sy, d.sx, d.sy);
    }
  }

  // 自家领地画格子线并描边，领地外压暗，AI 领地染红；买地模式下高亮可买的地块并标价
  drawTerritory(): void {
    const g = this.fog;
    g.clear();
    for (const t of this.priceTags) t.destroy();
    this.priceTags = [];
    const plotXY = (p: number) => ({ px: p % REGION_PLOTS, py: Math.floor(p / REGION_PLOTS) });
    for (let p = 0; p < REGION_PLOTS * REGION_PLOTS; p++) {
      const { px, py } = plotXY(p);
      const x0 = px * PLOT_SIZE, y0 = py * PLOT_SIZE;
      const diamond = pointsOf(footprintDiamond(x0, y0, PLOT_SIZE));
      if (this.base.ownsPlot(p)) {
        g.lineStyle(1, 0x000000, 0.12);
        for (let k = 1; k < PLOT_SIZE; k++) {
          const a = toScreen(x0 + k, y0), b = toScreen(x0 + k, y0 + PLOT_SIZE);
          g.lineBetween(a.sx, a.sy, b.sx, b.sy);
          const c = toScreen(x0, y0 + k), d = toScreen(x0 + PLOT_SIZE, y0 + k);
          g.lineBetween(c.sx, c.sy, d.sx, d.sy);
        }
        continue;
      }
      if (this.base.aiAtPlot(p)) {
        g.fillStyle(0xff3030, 0.12);
        g.fillPoints(diamond, true);
        continue;
      }
      const buyable = this.mode === 'buyLand' && this.base.canBuyPlot(p) !== '只能买与领地相邻的地块';
      g.fillStyle(buyable ? 0xffe14a : 0x000000, buyable ? 0.22 : 0.3);
      g.fillPoints(diamond, true);
      if (buyable) {
        const c = toScreen((px + 0.5) * PLOT_SIZE, (py + 0.5) * PLOT_SIZE);
        const tag = this.add.text(c.sx, c.sy, `${this.base.plotPrice(p)}`, {
          fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '14px', fontStyle: 'bold',
          color: this.base.canBuyPlot(p) === true ? '#ffe14a' : '#ff8080', stroke: '#000', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(1e5);
        this.priceTags.push(tag);
      }
    }
    // 领地边界线
    g.lineStyle(2, 0xffffff, 0.7);
    for (let p = 0; p < REGION_PLOTS * REGION_PLOTS; p++) {
      if (!this.base.ownsPlot(p)) continue;
      const { px, py } = plotXY(p);
      const x0 = px * PLOT_SIZE, y0 = py * PLOT_SIZE, x1 = x0 + PLOT_SIZE, y1 = y0 + PLOT_SIZE;
      const edge = (nx: number, ny: number, ax: number, ay: number, bx: number, by: number) => {
        const inside = nx >= 0 && ny >= 0 && nx < REGION_PLOTS && ny < REGION_PLOTS && this.base.ownsPlot(ny * REGION_PLOTS + nx);
        if (inside) return;
        const a = toScreen(ax, ay), b = toScreen(bx, by);
        g.lineBetween(a.sx, a.sy, b.sx, b.sy);
      };
      edge(px, py - 1, x0, y0, x1, y0);
      edge(px, py + 1, x0, y1, x1, y1);
      edge(px - 1, py, x0, y0, x0, y1);
      edge(px + 1, py, x1, y0, x1, y1);
    }
  }

  private buildingSprite(defId: BaseBuildingId, x: number, y: number, tint?: number): Sprite {
    const d = baseDef(defId);
    const img = this.add.image(0, 0, `bb-${defId}`).setOrigin(0.5, 1);
    const label = this.add.text(0, 0, d.icon, {
      fontFamily: 'Microsoft YaHei, sans-serif', fontSize: d.size >= 2 ? '20px' : '15px', fontStyle: 'bold', color: '#1d2229',
    }).setOrigin(0.5);
    if (tint !== undefined) img.setTint(tint);
    this.placeSprite({ img, label }, d.size, x, y);
    return { img, label };
  }

  private placeSprite(s: Sprite, size: number, x: number, y: number): void {
    const c = toScreen(x + size / 2, y + size / 2);
    const bottom = c.sy + BASE_INSET * size * (TILE_H / 2);
    const w = TILE_W * size * BASE_INSET, h = BASE_CUBE_H[size] ?? 26;
    s.img.setPosition(c.sx, bottom).setDepth(x + y + size);
    s.label.setPosition(c.sx, bottom - h - w / 4).setDepth(x + y + size + 0.5);
  }

  syncBuildings(): void {
    const alive = new Set<number>();
    for (const b of this.base.state.buildings) {
      alive.add(b.uid);
      let s = this.sprites.get(b.uid);
      if (!s) { s = this.buildingSprite(b.defId, b.x, b.y); this.sprites.set(b.uid, s); }
      this.placeSprite(s, baseDef(b.defId).size, b.x, b.y);
      s.img.setAlpha(this.mode === 'move' && b.uid === this.selected ? 0.35 : 1);
    }
    for (const [uid, s] of this.sprites) {
      if (!alive.has(uid)) { s.img.destroy(); s.label.destroy(); this.sprites.delete(uid); }
    }
  }

  // AI 基地：按布局画出全部建筑（偏红），头顶标等级和免战状态
  private drawAiBases(): void {
    for (const o of this.aiSprites) o.destroy();
    this.aiSprites = [];
    const now = Date.now();
    for (const ai of this.base.state.ai) {
      const r = aiRect(ai), layout = generateAiLayout(ai);
      for (const b of layout.buildings) {
        const id = (b.skin ?? (b.defId === 'hq' ? 'hall' : b.defId)) as BaseBuildingId;
        const s = this.buildingSprite(id, r.x + b.x, r.y + b.y, AI_TINT);
        this.aiSprites.push(s.img, s.label);
      }
      const top = toScreen(r.x, r.y);
      const tag = this.add.text(top.sx, top.sy - 30, `AI 基地 Lv${ai.level}${isProtected(ai, now) ? ' · 免战' : ''}`, {
        fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '16px', fontStyle: 'bold',
        color: isProtected(ai, now) ? '#9ad0ff' : '#ff8080', stroke: '#000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(1e5);
      this.aiSprites.push(tag);
    }
  }

  // 建造/移动时的占地预览，以及选中的建筑或 AI 基地的描边
  private drawGhost(): void {
    const g = this.ghost;
    g.clear();
    const sel = this.selectedBuilding();
    if (sel) {
      g.lineStyle(2, 0xffe14a, 1);
      g.strokePoints(pointsOf(footprintDiamond(sel.x, sel.y, baseDef(sel.defId).size)), true);
    }
    const ai = this.selectedAiBase();
    if (ai) {
      const r = aiRect(ai);
      g.lineStyle(3, 0xffe14a, 1);
      g.strokePoints(pointsOf(footprintDiamond(r.x, r.y, r.size)), true);
    }
    const h = this.hover;
    if (!h) return;
    if (this.mode === 'build' || this.mode === 'move') {
      const spot = this.ghostSpot();
      if (!spot) return;
      g.fillStyle(spot.ok === true ? 0x7dff8a : 0xff4040, 0.45);
      g.fillPoints(pointsOf(footprintDiamond(spot.x, spot.y, spot.size)), true);
    } else if (this.mode === 'buyLand') {
      const px = Math.floor(h.x / PLOT_SIZE), py = Math.floor(h.y / PLOT_SIZE);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokePoints(pointsOf(footprintDiamond(px * PLOT_SIZE, py * PLOT_SIZE, PLOT_SIZE)), true);
    } else if (this.base.ownsTile(h.x, h.y)) {
      g.lineStyle(1.5, 0xffffff, 0.5);
      g.strokePoints(pointsOf(tileDiamond(h.x, h.y)), true);
    }
  }

  // 预览的占地：鼠标在占地中间
  private ghostSpot(): { x: number; y: number; size: number; ok: true | string } | null {
    const h = this.hover;
    if (!h) return null;
    if (this.mode === 'build' && this.tool) {
      const size = baseDef(this.tool).size, x = h.x - Math.floor((size - 1) / 2), y = h.y - Math.floor((size - 1) / 2);
      return { x, y, size, ok: this.base.canBuild(this.tool, x, y) };
    }
    const sel = this.selectedBuilding();
    if (this.mode === 'move' && sel) {
      const size = baseDef(sel.defId).size, x = h.x - Math.floor((size - 1) / 2), y = h.y - Math.floor((size - 1) / 2);
      return { x, y, size, ok: this.base.fits(sel.defId, x, y, sel.uid) };
    }
    return null;
  }

  // ---------- 相机与输入 ----------

  private setupCamera(): void {
    const cam = this.cameras.main;
    const left = toScreen(0, REGION_TILES).sx, right = toScreen(REGION_TILES, 0).sx;
    cam.setBounds(left - 300, -300, right - left + 600, toScreen(REGION_TILES, REGION_TILES).sy + 600);
    const hall = this.base.state.buildings.find(b => b.defId === 'hall')!;
    const c = toScreen(hall.x + 1.5, hall.y + 1.5);
    cam.centerOn(c.sx, c.sy);
    cam.setZoom(0.6);
  }

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as typeof this.keys;
    kb.on('keydown-ESC', () => { this.selectedAi = null; this.setMode('idle'); });

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
      if (this.hover) this.click(this.hover.x, this.hover.y, p.event.shiftKey);
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.button !== 2 || !this.dragFrom) return;
      const moved = Math.hypot(p.x - this.dragFrom.x, p.y - this.dragFrom.y);
      this.dragFrom = null;
      if (moved < 5) { this.selected = null; this.selectedAi = null; this.setMode('idle'); this.syncBuildings(); }
    });

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.2, 2));
    });
  }

  private click(tx: number, ty: number, shift: boolean): void {
    if (this.mode === 'build' && this.tool) {
      const spot = this.ghostSpot()!;
      const r = this.base.build(this.tool, spot.x, spot.y);
      this.message = typeof r === 'string' ? r : '';
      if (typeof r !== 'string') {
        this.syncBuildings();
        if (!shift) this.setMode('idle');
      }
      this.hud.render();
    } else if (this.mode === 'move' && this.selected !== null) {
      const spot = this.ghostSpot()!;
      const r = this.base.move(this.selected, spot.x, spot.y);
      this.message = r === true ? '' : r;
      if (r === true) this.setMode('idle');
      this.syncBuildings();
      this.hud.render();
    } else if (this.mode === 'buyLand') {
      const plot = Math.floor(ty / PLOT_SIZE) * REGION_PLOTS + Math.floor(tx / PLOT_SIZE);
      const r = this.base.buyPlot(plot);
      this.message = r === true ? '' : r;
      this.drawTerritory();
      this.hud.render();
    } else {
      this.selected = this.base.buildingAt(tx, ty)?.uid ?? null;
      this.selectedAi = this.selected === null ? this.base.aiAt(tx, ty)?.id ?? null : null;
      this.message = '';
      this.hud.render();
    }
  }

  private moveCameraByKeys(dt: number): void {
    const k = this.keys, cam = this.cameras.main, v = 900 * dt / cam.zoom;
    if (k.A.isDown || k.LEFT.isDown) cam.scrollX -= v;
    if (k.D.isDown || k.RIGHT.isDown) cam.scrollX += v;
    if (k.W.isDown || k.UP.isDown) cam.scrollY -= v;
    if (k.S.isDown || k.DOWN.isDown) cam.scrollY += v;
  }
}
