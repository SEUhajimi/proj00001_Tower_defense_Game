import Phaser from 'phaser';
import { MAP_H, MAP_W, strongholdName } from '../../shared/data/ai';
import type { Base } from '../../shared/sim/base/base';
import { advanceTo } from '../../shared/sim/base/economy';
import { Rng } from '../../shared/sim/rng';
import { attackable, defenseLeft, HOME_ID, HOME_POS, type AiBase } from '../../shared/sim/world/ai';
import { canSortie, type Roster } from '../../shared/sim/world/sortie';
import { WorldHud } from '../ui/worldHud';
import { onSync, session, startSortie } from './session';

// 世界地图（战略图）：主基地和据点，据点之间有道路。
// 只能进攻和自己地盘（主基地、已征服的据点）有道路相连的据点；守备打光就征服它。

const S = 2; // 地图单位 → 画面像素
const NODE_R = (level: number) => 20 + level * 3;

const COLOR = {
  ground: 0x2f3a2a, grid: 0x3a4734, patchDark: 0x283224, patchLight: 0x3d4a33,
  road: 0x9c8b66, roadEdge: 0x1c2219, roadMine: 0xd8c48f,
  ai: 0x8e2b25, aiDim: 0x5a2622, mine: 0x2f6fb5, ring: 0xe8e2cf, select: 0xffd23f, attack: 0xffb02e,
};

export class WorldScene extends Phaser.Scene {
  base!: Base;
  selectedAi: number | null = null;
  message = '';

  private roads!: Phaser.GameObjects.Graphics;
  private nodes!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private hovered: number | null = null;
  private dragFrom: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;
  private tickTimer = 0;
  private busy = false;
  private pulse = 0;
  private hud!: WorldHud;

  constructor() {
    super('world');
  }

  create(): void {
    this.base = session().base;
    advanceTo(this.base, Date.now());
    this.selectedAi = null;
    this.hovered = null;
    this.message = '';
    this.busy = false;
    this.labels = [];

    this.drawGround();
    this.roads = this.add.graphics();
    this.nodes = this.add.graphics();
    this.overlay = this.add.graphics();
    this.redraw();
    this.setupCamera();
    this.setupInput();

    this.hud = new WorldHud(this);
    const off = onSync(error => {
      if (error) this.message = error;
      this.redraw();
      this.hud.render();
    });
    this.events.once('shutdown', () => {
      off();
      this.hud.destroy();
    });
  }

  selectedAiBase(): AiBase | undefined {
    return this.selectedAi === null ? undefined : this.base.getAi(this.selectedAi);
  }

  // 出击：本地先查一遍，再向服务器要战场种子，然后进入战斗场景
  startSortie(roster: Roster): void {
    const ai = this.selectedAiBase();
    if (!ai || this.busy) return;
    const ok = canSortie(this.base, ai, roster);
    if (ok !== true) { this.message = ok; this.hud.render(); return; }
    this.busy = true;
    void startSortie(ai.id, roster).then(r => {
      this.busy = false;
      if (typeof r === 'string') { this.message = r; this.hud.render(); return; }
      this.scene.start('battle', { mode: 'sortie', aiId: ai.id, roster, sortieId: r.sortieId, seed: r.seed });
    });
  }

  update(_time: number, deltaMs: number): void {
    this.moveCameraByKeys(deltaMs / 1000);
    this.tickTimer += deltaMs;
    this.pulse += deltaMs / 1000;
    if (this.tickTimer >= 1000) {
      this.tickTimer = 0;
      advanceTo(this.base, Date.now());
    }
    this.drawOverlay();
  }

  // ---------- 绘制 ----------

  // 军用地图底色：深橄榄绿，散一些深浅斑块当地形，再铺坐标网格
  private drawGround(): void {
    const g = this.add.graphics();
    const pad = 200;
    g.fillStyle(COLOR.ground);
    g.fillRect(-pad, -pad, MAP_W * S + pad * 2, MAP_H * S + pad * 2);
    const rng = new Rng(this.base.state.seed ^ 0x2545f491);
    for (let k = 0; k < 70; k++) {
      g.fillStyle(k % 2 ? COLOR.patchDark : COLOR.patchLight, 0.7);
      g.fillEllipse(rng.next() * MAP_W * S, rng.next() * MAP_H * S, 80 + rng.next() * 260, 60 + rng.next() * 180);
    }
    g.lineStyle(1, COLOR.grid, 0.6);
    for (let x = 0; x <= MAP_W; x += 50) g.lineBetween(x * S, 0, x * S, MAP_H * S);
    for (let y = 0; y <= MAP_H; y += 50) g.lineBetween(0, y * S, MAP_W * S, y * S);
    g.lineStyle(3, 0x1c2219, 1);
    g.strokeRect(0, 0, MAP_W * S, MAP_H * S);
  }

  private pos(id: number): { x: number; y: number } {
    const p = id === HOME_ID ? HOME_POS : this.base.getAi(id)!;
    return { x: p.x * S, y: p.y * S };
  }

  private mine(id: number): boolean {
    return id === HOME_ID || this.base.getAi(id)?.owner === 'player';
  }

  redraw(): void {
    const ais = this.base.state.ai;
    // 道路：连着自己地盘的那几条亮一些
    const r = this.roads;
    r.clear();
    const seen = new Set<string>();
    for (const ai of ais) {
      for (const to of ai.links) {
        const key = ai.id < to ? `${ai.id}-${to}` : `${to}-${ai.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const a = this.pos(ai.id), b = this.pos(to);
        const lit = this.mine(ai.id) || this.mine(to);
        r.lineStyle(10, COLOR.roadEdge, 0.8);
        r.lineBetween(a.x, a.y, b.x, b.y);
        r.lineStyle(6, lit ? COLOR.roadMine : COLOR.road, 1);
        r.lineBetween(a.x, a.y, b.x, b.y);
      }
    }

    // 据点图标
    const g = this.nodes;
    g.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    const home = this.pos(HOME_ID);
    this.drawHome(g, home.x, home.y);
    this.label(home.x, home.y + 52, '主基地', '#cfe3ff', 26);
    for (const ai of ais) {
      const p = this.pos(ai.id), rad = NODE_R(ai.level);
      const open = attackable(ai, ais);
      if (ai.owner === 'player') {
        this.drawFort(g, p.x, p.y, rad, COLOR.mine, 1);
        this.drawFlag(g, p.x, p.y - rad - 4, COLOR.mine);
      } else {
        this.drawFort(g, p.x, p.y, rad, open ? COLOR.ai : COLOR.aiDim, open ? 1 : 0.75);
        // 守备值条（打过、还没恢复时才显示）
        const d = defenseLeft(ai);
        if (d < 1) {
          const w = rad * 2;
          g.fillStyle(0x000000, 0.7);
          g.fillRect(p.x - w / 2 - 1, p.y + rad + 6, w + 2, 7);
          g.fillStyle(d > 0.5 ? 0x8bd450 : d > 0.25 ? 0xf2c14e : 0xe0524f);
          g.fillRect(p.x - w / 2, p.y + rad + 7, w * d, 5);
        }
      }
      this.label(p.x, p.y, `${ai.level}`, '#f3ead2', 22 + ai.level * 2).setFontStyle('bold');
      const tag = ai.owner === 'player' ? '（附属）' : '';
      this.label(p.x, p.y + rad + 28, `${strongholdName(ai.id)}${tag}`, ai.owner === 'player' ? '#cfe3ff' : open ? '#f3ead2' : '#a9a28f', 24);
    }
  }

  private label(x: number, y: number, text: string, color: string, size: number): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, {
      fontFamily: 'Microsoft YaHei, sans-serif', fontSize: `${size}px`, color, stroke: '#141a12', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(10);
    this.labels.push(t);
    return t;
  }

  // 据点：八角形要塞，外圈一道浅色环
  private drawFort(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
    const pts: Phaser.Math.Vector2[] = [];
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      pts.push(new Phaser.Math.Vector2(x + Math.cos(a) * r, y + Math.sin(a) * r));
    }
    g.fillStyle(0x000000, 0.35);
    g.fillCircle(x + 3, y + 4, r);
    g.fillStyle(color, alpha);
    g.fillPoints(pts, true);
    g.lineStyle(3, COLOR.ring, 0.9 * alpha);
    g.strokePoints(pts, true);
  }

  // 主基地：更大的蓝色要塞，带一圈内环和三角标
  private drawHome(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    this.drawFort(g, x, y, 34, COLOR.mine, 1);
    g.lineStyle(2, COLOR.ring, 0.8);
    g.strokeCircle(x, y, 22);
    g.fillStyle(COLOR.ring, 1);
    g.fillTriangle(x, y - 13, x - 12, y + 9, x + 12, y + 9);
  }

  private drawFlag(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
    g.lineStyle(2, COLOR.ring, 1);
    g.lineBetween(x, y, x, y - 22);
    g.fillStyle(color, 1);
    g.fillTriangle(x, y - 22, x + 16, y - 17, x, y - 12);
  }

  // 鼠标指着的、选中的据点描边；能进攻的据点外圈一闪一闪
  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    const ais = this.base.state.ai;
    const k = 0.5 + 0.5 * Math.sin(this.pulse * 3);
    for (const ai of ais) {
      const p = this.pos(ai.id), r = NODE_R(ai.level);
      if (attackable(ai, ais)) {
        g.lineStyle(3, COLOR.attack, 0.35 + 0.5 * k);
        g.strokeCircle(p.x, p.y, r + 8 + k * 3);
      }
      if (ai.id === this.selectedAi) {
        g.lineStyle(4, COLOR.select, 1);
        g.strokeCircle(p.x, p.y, r + 14);
      } else if (ai.id === this.hovered) {
        g.lineStyle(2, COLOR.select, 0.7);
        g.strokeCircle(p.x, p.y, r + 12);
      }
    }
  }

  // ---------- 相机与输入 ----------

  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBounds(-200, -200, MAP_W * S + 400, MAP_H * S + 400);
    cam.centerOn(HOME_POS.x * S, HOME_POS.y * S);
    cam.setZoom(Phaser.Math.Clamp(Math.min(cam.width / (MAP_W * S), cam.height / (MAP_H * S)) * 1.05, 0.3, 1.2));
  }

  private nodeAt(wx: number, wy: number): number | null {
    let best: number | null = null, bestD = Infinity;
    for (const ai of this.base.state.ai) {
      const p = this.pos(ai.id), d = Math.hypot(p.x - wx, p.y - wy);
      if (d <= NODE_R(ai.level) + 14 && d < bestD) { bestD = d; best = ai.id; }
    }
    return best;
  }

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as typeof this.keys;
    kb.on('keydown-ESC', () => { this.selectedAi = null; this.hud.render(); });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.hovered = this.nodeAt(p.worldX, p.worldY);
      const home = this.pos(HOME_ID);
      const onHome = Math.hypot(home.x - p.worldX, home.y - p.worldY) < 40;
      this.input.setDefaultCursor(this.hovered !== null || onHome ? 'pointer' : 'default');
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
      // 点主基地回基地，点据点选中它
      const home = this.pos(HOME_ID);
      if (Math.hypot(home.x - p.worldX, home.y - p.worldY) < 40) { this.scene.start('base'); return; }
      this.selectedAi = this.nodeAt(p.worldX, p.worldY);
      this.message = '';
      this.hud.render();
    });

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.button !== 2 || !this.dragFrom) return;
      const moved = Math.hypot(p.x - this.dragFrom.x, p.y - this.dragFrom.y);
      this.dragFrom = null;
      if (moved < 5) { this.selectedAi = null; this.hud.render(); }
    });

    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.3, 2));
    });
    this.events.once('shutdown', () => this.input.setDefaultCursor('default'));
  }

  private moveCameraByKeys(dt: number): void {
    const k = this.keys, cam = this.cameras.main, v = 900 * dt / cam.zoom;
    if (k.A.isDown || k.LEFT.isDown) cam.scrollX -= v;
    if (k.D.isDown || k.RIGHT.isDown) cam.scrollX += v;
    if (k.W.isDown || k.UP.isDown) cam.scrollY -= v;
    if (k.S.isDown || k.DOWN.isDown) cam.scrollY += v;
  }
}
