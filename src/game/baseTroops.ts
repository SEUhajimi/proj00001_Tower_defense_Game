import Phaser from 'phaser';
import { factoryOf } from '../../shared/data/army';
import { baseDef } from '../../shared/data/economy';
import { DEFS, type DefId } from '../../shared/data/units';
import type { Base } from '../../shared/sim/base/base';
import { troopLayout } from '../../shared/sim/base/troops';
import { dirIndex, PARKED_SCALE, texAnchor, texScale, unitFrames } from './art';
import { toScreen } from './iso';
import { act } from './session';
import { makeTextures, textureKey } from './textures';

// 基地里的部队：按 troopLayout 画出来，新兵从出厂建筑门口跑到自己的位置。
// 可以点选、框选，右键空地移动（飞机停在机场的机位上，机头朝跑道，不能选）。位置发给服务器保存。

interface Unit {
  img: Phaser.GameObjects.Image;
  defId: DefId;
  i: number;
  plane: boolean;
  x: number; // 当前位置（格）
  y: number;
  tx: number; // 要走到的位置
  ty: number;
  facing: number;
}

const keyOf = (defId: DefId, i: number) => `${defId}#${i}`;
const UNIT_SCALE = 1.3; // 基地镜头比战场远，部队画大一点

export class BaseTroops {
  readonly selected = new Set<string>();
  private units = new Map<string, Unit>();
  private ring: Phaser.GameObjects.Graphics;
  private box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private first = true;

  constructor(private scene: Phaser.Scene, private base: Base) {
    makeTextures(scene);
    this.ring = scene.add.graphics().setDepth(5e4); // 选中圈和框选框画在最上层，不被树木岩石挡住
  }

  // 按存档对齐：多出来的新兵从出厂建筑门口出来；位置变了的走过去；没了的去掉
  sync(): void {
    const alive = new Set<string>();
    for (const t of troopLayout(this.base)) {
      const k = keyOf(t.defId, t.i);
      alive.add(k);
      let u = this.units.get(k);
      if (!u) {
        const start = this.first || t.plane ? { x: t.x, y: t.y } : this.door(t.defId);
        const frames = unitFrames(t.defId, 'player');
        const tex = frames ? frames[0] : textureKey(t.defId, 'player');
        const a = texAnchor(tex);
        const scale = frames ? (t.plane ? PARKED_SCALE : 1) : UNIT_SCALE;
        const img = this.scene.add.image(0, 0, tex).setScale(texScale(tex) * scale).setOrigin(a?.x ?? 0.5, a?.y ?? 0.5);
        u = { img, defId: t.defId, i: t.i, plane: t.plane, x: start.x, y: start.y, tx: t.x, ty: t.y, facing: Math.PI / 4 };
        this.units.set(k, u);
      }
      u.tx = t.x;
      u.ty = t.y;
      // 飞机直接停到机位上（机位会随机场移动、扩建变化）
      if (t.plane) { u.x = t.x; u.y = t.y; u.facing = t.facing ?? u.facing; }
    }
    for (const [k, u] of this.units) {
      if (!alive.has(k)) { u.img.destroy(); this.units.delete(k); this.selected.delete(k); }
    }
    this.first = false;
  }

  // 出厂建筑的门口：占地最靠近镜头的那个角
  private door(defId: DefId): { x: number; y: number } {
    const st = this.base.state;
    const b = st.buildings.find(o => o.defId === factoryOf(defId)) ?? st.buildings[0];
    const s = baseDef(b.defId).size;
    return { x: b.x + s - 0.3, y: b.y + s - 0.3 };
  }

  // 每帧：往目标位置跑，更新画面位置和朝向，画选中圈和框选框
  update(dt: number): void {
    for (const u of this.units.values()) {
      const dx = u.tx - u.x, dy = u.ty - u.y, d = Math.hypot(dx, dy);
      const speed = Math.max(2, DEFS[u.defId].speed);
      if (d > 1e-3) {
        u.facing = Math.atan2(dy, dx);
        const step = Math.min(d, speed * dt);
        u.x += (dx / d) * step;
        u.y += (dy / d) * step;
      }
      const p = toScreen(u.x, u.y), dir = toScreen(Math.cos(u.facing), Math.sin(u.facing));
      const a = Math.atan2(dir.sy, dir.sx);
      const tank = DEFS[u.defId].kind === 'tank';
      const frames = unitFrames(u.defId, 'player');
      // 层级比同一格的树木岩石高（站在树林里也看得见），又低于身后建筑的前沿
      if (frames) u.img.setTexture(frames[dirIndex(u.facing)]).setPosition(p.sx, p.sy).setDepth(u.x + u.y + 2.5);
      else u.img.setPosition(p.sx, p.sy - (tank ? 4 : 6)).setRotation(tank ? a + Math.PI / 2 : a).setDepth(u.x + u.y + 2.5);
    }
    const g = this.ring;
    g.clear();
    for (const k of this.selected) {
      const u = this.units.get(k);
      if (!u) continue;
      const p = toScreen(u.x, u.y), r = DEFS[u.defId].kind === 'tank' ? 18 : 10;
      g.lineStyle(2, 0x7dff8a, 0.95);
      g.strokeEllipse(p.sx, p.sy, r * 2, r);
    }
    if (this.box) {
      const { x0, y0, x1, y1 } = this.box;
      g.fillStyle(0x7dff8a, 0.08);
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.lineStyle(1, 0x7dff8a, 0.9);
      g.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
  }

  // 鼠标下的部队（世界像素坐标），飞机不算
  pick(wx: number, wy: number): string | null {
    let best: string | null = null, bestD = 16;
    for (const [k, u] of this.units) {
      if (u.plane) continue;
      const p = toScreen(u.x, u.y), d = Math.hypot(p.sx - wx, p.sy - 6 - wy);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  setBox(box: { x0: number; y0: number; x1: number; y1: number } | null): void {
    this.box = box;
  }

  selectBox(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    if (!add) this.selected.clear();
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    for (const [k, u] of this.units) {
      if (u.plane) continue;
      const p = toScreen(u.x, u.y);
      if (p.sx >= lx && p.sx <= hx && p.sy - 6 >= ly && p.sy - 6 <= hy) this.selected.add(k);
    }
  }

  selectOne(k: string, add: boolean): void {
    if (!add) this.selected.clear();
    if (add && this.selected.has(k)) this.selected.delete(k);
    else this.selected.add(k);
  }

  clear(): void {
    this.selected.clear();
  }

  // 选中的部队各兵种几支
  summary(): string {
    const n = new Map<DefId, number>();
    for (const k of this.selected) {
      const u = this.units.get(k);
      if (u) n.set(u.defId, (n.get(u.defId) ?? 0) + 1);
    }
    return [...n].map(([id, c]) => `${DEFS[id].name} ${c}`).join('、');
  }

  // 右键移动：在目标点附近排成方阵（间距 0.6 格），只能站在自己领地里
  moveSelected(x: number, y: number): true | string {
    const units = [...this.selected].map(k => this.units.get(k)!).filter(Boolean);
    if (!units.length) return true;
    if (!this.base.ownsTile(Math.floor(x), Math.floor(y))) return '只能移动到自己的领地里';
    const side = Math.ceil(Math.sqrt(units.length));
    const moves = units.map((u, k) => {
      const ox = (k % side - (side - 1) / 2) * 0.6, oy = (Math.floor(k / side) - (side - 1) / 2) * 0.6;
      let px = x + ox, py = y + oy;
      if (!this.base.ownsTile(Math.floor(px), Math.floor(py))) { px = x; py = y; }
      return { defId: u.defId, i: u.i, x: px, y: py };
    });
    const r = act({ type: 'moveTroops', moves });
    if (r === true) this.sync();
    return r;
  }
}
