import Phaser from 'phaser';
import { baseDef, type BaseBuildingId } from '../../shared/data/economy';
import { DEFS, type DefId } from '../../shared/data/units';
import { Base, levelOf, type PlacedBuilding } from '../../shared/sim/base/base';
import { advanceTo } from '../../shared/sim/base/economy';
import { PLOT_SIZE, REGION_PLOTS } from '../../shared/sim/base/terrain';
import type { Roster } from '../../shared/sim/world/sortie';
import { BaseUi } from '../ui/baseUi';
import { footprintDiamond, pointsOf, TILE_H, toScreen, toWorld, tileDiamond } from './iso';
import { act, downloadSave, fastForward, onSync, resetBase, session } from './session';
import { makeBaseTextures } from './textures';
import {
  buildingSprite, drawPlots, hideCoveredProps, placeSprite, plotXY, strokeTerritory,
  type Prop, type Sprite,
} from './worldDraw';

export type BaseMode = 'idle' | 'build' | 'move' | 'buyLand';

// 基地场景：只显示自己的领地（外加紧挨着的一圈地块，买地用），方便细致规划。
// 看 AI 基地、出击要点右下角的“世界地图”。
export class BaseScene extends Phaser.Scene {
  base!: Base;
  mode: BaseMode = 'idle';
  tool: BaseBuildingId | null = null;
  selected: number | null = null; // 选中的自家建筑 uid
  offline: { hours: number; gained: Record<string, number> } | null = null;
  message = '';

  private sprites = new Map<number, Sprite>();
  private props: Prop[] = [];
  private ground!: Phaser.GameObjects.Graphics;
  private fog!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Graphics;
  private priceTags: Phaser.GameObjects.Text[] = [];
  private viewKey = ''; // 领地变了（买地、吞并）就要重画地面
  private hover: { x: number; y: number } | null = null;
  private dragFrom: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;
  private tickTimer = 0;
  private taxTimer = 0; // 拖动税率滑块时，停手后再发给服务器
  private busy = false; // 正在等服务器（重新开局），别重复点
  private hud!: BaseUi;

  constructor() {
    super('base');
  }

  create(): void {
    this.busy = false;
    const s = session();
    this.base = s.base;
    advanceTo(this.base, Date.now());
    // 离线收益只在打开游戏后第一次进入基地时显示
    this.offline = s.offline && s.offline.hours > 1 / 60 ? s.offline : null;
    s.offline = null;
    this.message = s.notice ?? '';
    s.notice = null;
    this.sprites = new Map();
    this.props = [];
    this.priceTags = [];
    this.viewKey = '';
    this.mode = 'idle';
    this.tool = null;
    this.selected = null;

    makeBaseTextures(this);
    this.ground = this.add.graphics().setDepth(-1000);
    this.fog = this.add.graphics().setDepth(-900);
    this.ghost = this.add.graphics().setDepth(1e6);
    this.drawView();
    this.syncBuildings();
    this.setupCamera(true);
    this.setupInput();
    this.hud = new BaseUi(this);
    // 服务器结果回来：以它为准重画；被拒绝的操作显示原因
    const off = onSync(error => {
      if (this.selected !== null && !this.base.state.buildings.some(b => b.uid === this.selected)) this.selected = null;
      if (error) this.message = error;
      this.drawView();
      this.syncBuildings();
      this.hud.render();
    });
    this.events.once('shutdown', () => {
      off();
      window.clearTimeout(this.taxTimer);
      this.hud.destroy();
    });
  }

  // ---------- 玩家操作（由 HUD 和鼠标调用） ----------

  setMode(mode: BaseMode, tool: BaseBuildingId | null = null): void {
    this.mode = mode;
    this.tool = tool;
    if (mode !== 'move') this.message = '';
    this.drawFog();
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
    const r = act({ type: 'demolish', uid: this.selected });
    this.message = r === true ? '' : r;
    if (r === true) { this.selected = null; this.syncBuildings(); }
    this.hud.onSelect();
  }

  upgradeSelected(): void {
    if (this.selected === null) return;
    const r = act({ type: 'upgrade', uid: this.selected });
    this.message = r === true ? '' : r;
    this.syncBuildings();
    this.hud.render();
  }

  // 本地马上生效；停手半秒后再发给服务器
  setTax(rate: number): void {
    this.base.state.taxRate = rate;
    window.clearTimeout(this.taxTimer);
    this.taxTimer = window.setTimeout(() => act({ type: 'setTax', rate }), 500);
  }

  recruit(defId: DefId, n: number): void {
    const r = act({ type: 'recruit', defId, n });
    this.message = r === true ? '' : r;
    this.hud.render();
  }

  repairAll(): void {
    const r = act({ type: 'repairAll' });
    this.message = r === true ? '' : r;
    this.hud.render();
  }

  research(defId: DefId): void {
    const r = act({ type: 'research', defId });
    this.message = r === true ? `${DEFS[defId].name}研发完成` : r;
    this.hud.render();
  }

  // 演习：电脑带着这支军队进攻自己的基地，打完一切照旧
  startDrill(attackers: Roster): void {
    if (!Object.values(attackers).some(n => (n ?? 0) > 0)) { this.message = '进攻方没有部队'; this.hud.render(); return; }
    this.scene.start('battle', { mode: 'drill', roster: attackers });
  }

  fastForward(hours: number): void {
    void fastForward(hours).then(err => { if (err) { this.message = err; this.hud.render(); } });
  }

  exportSave(): void {
    downloadSave();
    this.message = '存档已导出';
    this.hud.render();
  }

  resetSave(): void {
    if (this.busy) return;
    this.busy = true;
    void resetBase().then(err => {
      this.busy = false;
      if (err) { this.message = err; this.hud.render(); return; }
      this.scene.restart();
    });
  }

  enterPrototype(): void {
    this.scene.start('battle', { mode: 'prototype' });
  }

  selectedBuilding(): PlacedBuilding | undefined {
    return this.base.state.buildings.find(b => b.uid === this.selected);
  }

  // ---------- 每帧 ----------

  update(_time: number, deltaMs: number): void {
    this.moveCameraByKeys(deltaMs / 1000);
    this.tickTimer += deltaMs;
    // 本地按时间推进生产，只为了显示；存档以服务器为准
    if (this.tickTimer >= 1000) {
      this.tickTimer = 0;
      advanceTo(this.base, Date.now());
    }
    this.drawGhost();
  }

  // ---------- 绘制 ----------

  // 显示范围：自己的地块，加上四周紧挨着的一圈
  private viewPlots(): number[] {
    const set = new Set<number>();
    for (const p of this.base.state.owned) {
      const { px, py } = plotXY(p);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx >= 0 && ny >= 0 && nx < REGION_PLOTS && ny < REGION_PLOTS) set.add(ny * REGION_PLOTS + nx);
        }
      }
    }
    return [...set];
  }

  // 领地变了才重画地面和树木
  private drawView(): void {
    const key = [...this.base.state.owned].sort((a, b) => a - b).join(',');
    if (key !== this.viewKey) {
      this.viewKey = key;
      this.ground.clear();
      for (const p of this.props) p.img.destroy();
      this.props = drawPlots(this, this.ground, this.base, this.viewPlots());
      this.setupCamera(false);
    }
    this.drawFog();
  }

  // 领地内画格子线、外圈压暗，买地模式下高亮可买的地块并标价
  private drawFog(): void {
    const g = this.fog;
    g.clear();
    for (const t of this.priceTags) t.destroy();
    this.priceTags = [];
    for (const p of this.viewPlots()) {
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
      const buyable = this.mode === 'buyLand' && this.base.canBuyPlot(p) !== '只能买与领地相邻的地块';
      g.fillStyle(buyable ? 0xffe14a : 0x0b0f14, buyable ? 0.22 : 0.45);
      g.fillPoints(diamond, true);
      if (buyable) {
        const c = toScreen((px + 0.5) * PLOT_SIZE, (py + 0.5) * PLOT_SIZE);
        const tag = this.add.text(c.sx, c.sy, `${this.base.plotPrice(p)}`, {
          fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '15px', fontStyle: 'bold',
          color: this.base.canBuyPlot(p) === true ? '#ffe14a' : '#ff8080', stroke: '#000', strokeThickness: 3,
        }).setOrigin(0.5).setDepth(1e5);
        this.priceTags.push(tag);
      }
    }
    strokeTerritory(g, this.base);
  }

  syncBuildings(): void {
    const alive = new Set<number>();
    for (const b of this.base.state.buildings) {
      alive.add(b.uid);
      let s = this.sprites.get(b.uid);
      if (!s) { s = buildingSprite(this, b.defId, b.x, b.y); this.sprites.set(b.uid, s); }
      placeSprite(s, baseDef(b.defId).size, b.x, b.y);
      // 屋顶上的字后面标等级
      const label = baseDef(b.defId).icon + (levelOf(b) > 1 ? levelOf(b) : '');
      if (s.label.text !== label) s.label.setText(label);
      s.img.setAlpha(this.mode === 'move' && b.uid === this.selected ? 0.35 : 1);
    }
    for (const [uid, s] of this.sprites) {
      if (!alive.has(uid)) { s.img.destroy(); s.label.destroy(); this.sprites.delete(uid); }
    }
    hideCoveredProps(this.base, this.props);
  }

  // 建造/移动时的占地预览，以及选中建筑的描边
  private drawGhost(): void {
    const g = this.ghost;
    g.clear();
    const sel = this.selectedBuilding();
    if (sel) {
      g.lineStyle(2, 0xffe14a, 1);
      g.strokePoints(pointsOf(footprintDiamond(sel.x, sel.y, baseDef(sel.defId).size)), true);
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

  // 镜头框住领地；fit 时对准领地中心并缩放到整块领地刚好看得见
  private setupCamera(fit: boolean): void {
    const cam = this.cameras.main;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.base.state.owned) {
      const { px, py } = plotXY(p);
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px + 1); y1 = Math.max(y1, py + 1);
    }
    const [tx0, ty0, tx1, ty1] = [x0 * PLOT_SIZE, y0 * PLOT_SIZE, x1 * PLOT_SIZE, y1 * PLOT_SIZE];
    const left = toScreen(tx0, ty1).sx, right = toScreen(tx1, ty0).sx;
    const top = toScreen(tx0, ty0).sy, bottom = toScreen(tx1, ty1).sy;
    const pad = PLOT_SIZE * TILE_H * 2; // 外圈一块地的宽度再多留一点
    cam.setBounds(left - pad, top - pad, right - left + pad * 2, bottom - top + pad * 2);
    if (!fit) return;
    cam.centerOn((left + right) / 2, (top + bottom) / 2);
    const zoom = Math.min(cam.width / (right - left + 160), cam.height / (bottom - top + 200));
    cam.setZoom(Phaser.Math.Clamp(zoom, 0.5, 1.4));
  }

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as typeof this.keys;
    kb.on('keydown-ESC', () => { this.selected = null; this.setMode('idle'); this.hud.onSelect(); });

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
      if (moved < 5) { this.selected = null; this.setMode('idle'); this.syncBuildings(); this.hud.onSelect(); }
    });

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.4, 2.5));
    });
  }

  private click(tx: number, ty: number, shift: boolean): void {
    if (this.mode === 'build' && this.tool) {
      const spot = this.ghostSpot()!;
      const r = act({ type: 'build', defId: this.tool, x: spot.x, y: spot.y });
      this.message = typeof r === 'string' ? r : '';
      if (typeof r !== 'string') {
        this.syncBuildings();
        if (!shift) this.setMode('idle');
      }
      this.hud.render();
    } else if (this.mode === 'move' && this.selected !== null) {
      const spot = this.ghostSpot()!;
      const r = act({ type: 'move', uid: this.selected, x: spot.x, y: spot.y });
      this.message = r === true ? '' : r;
      if (r === true) this.setMode('idle');
      this.syncBuildings();
      this.hud.render();
    } else if (this.mode === 'buyLand') {
      const plot = Math.floor(ty / PLOT_SIZE) * REGION_PLOTS + Math.floor(tx / PLOT_SIZE);
      const r = act({ type: 'buyPlot', plot });
      this.message = r === true ? '' : r;
      this.drawView();
      this.hud.render();
    } else {
      this.selected = this.base.buildingAt(tx, ty)?.uid ?? null;
      this.message = '';
      this.hud.onSelect();
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
