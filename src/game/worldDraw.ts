import Phaser from 'phaser';
import { baseDef, footprint, type Terrain } from '../../shared/data/economy';
import type { Base, PlacedBuilding } from '../../shared/sim/base/base';
import { PLOT_SIZE, REGION_PLOTS } from '../../shared/sim/base/terrain';
import { buildingKey, groundKey, propKeys, texAnchor, texLift, texScale } from './art';
import { footprintDiamond, pointsOf, TILE_H, TILE_W, toScreen } from './iso';
import { BASE_INSET } from './textures';

// 基地场景的绘制：地块、树木岩石、建筑、领地边界。

// 地面颜色取自 Kenney 素材的配色
export const TERRAIN_COLOR: Record<Terrain, [number, number]> = {
  plain: [0x8ab549, 0x85b045],
  forest: [0x6f9a3c, 0x6a953a],
  mountain: [0xb3ab95, 0xaba38c],
  iron: [0xba8c5d, 0xb48759],
  oil: [0x5a5d66, 0x55585f],
};

// 森林和山地上的树、石头：占 2×2 格，盖了建筑的地方隐藏
export interface Prop {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
}

export interface Sprite {
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

export const plotXY = (p: number) => ({ px: p % REGION_PLOTS, py: Math.floor(p / REGION_PLOTS) });

// 画一批地块：有渲染的地面贴图就铺贴图（tiles 返回给调用方，重画时销毁），
// 否则画底色和矿点；森林、山地上再摆树木岩石
export function drawPlots(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, base: Base, plots: Iterable<number>,
  tiles: Phaser.GameObjects.Image[] = []): Prop[] {
  const props: Prop[] = [];
  for (const p of plots) {
    const { px, py } = plotXY(p);
    const t = base.terrain[p];
    const x0 = px * PLOT_SIZE, y0 = py * PLOT_SIZE;
    const diamond = pointsOf(footprintDiamond(x0, y0, PLOT_SIZE));
    if (t === 'forest' || t === 'mountain') props.push(...addProps(scene, t, px, py));
    const tex = groundKey(t, px, py);
    if (tex) {
      const c = toScreen(x0 + PLOT_SIZE / 2, y0 + PLOT_SIZE / 2), a = texAnchor(tex)!;
      tiles.push(scene.add.image(c.sx, c.sy, tex).setOrigin(a.x, a.y).setScale(texScale(tex)).setDepth(-950));
      continue;
    }
    g.fillStyle(TERRAIN_COLOR[t][(px + py) & 1]);
    g.fillPoints(diamond, true);
    g.lineStyle(1, 0x000000, 0.18);
    g.strokePoints(diamond, true);
    if (t === 'iron' || t === 'oil') {
      for (const [dx, dy] of [[0.9, 1.1], [2.6, 0.8], [1.4, 2.7], [3.1, 2.9]]) {
        const c = toScreen(x0 + dx, y0 + dy);
        g.fillStyle(t === 'iron' ? 0xc07a52 : 0x15161a);
        g.fillEllipse(c.sx, c.sy, 12, 6);
      }
    }
  }
  return props;
}

function addProps(scene: Phaser.Scene, t: Terrain, px: number, py: number): Prop[] {
  const spots = t === 'forest' ? [[0, 0], [2, 0], [0, 2], [2, 2]] : (px + py) % 2 ? [[0, 0], [2, 2]] : [[2, 0], [0, 2]];
  const { keys, rendered } = propKeys(t === 'forest' ? 'trees' : 'rocks');
  return spots.map(([dx, dy], k) => {
    const x = px * PLOT_SIZE + dx, y = py * PLOT_SIZE + dy;
    const c = toScreen(x + 1, y + 1), key = keys[(px * 7 + py * 3 + k) % keys.length];
    const img = scene.add.image(c.sx, c.sy, key).setDepth(x + y + 2);
    if (rendered) {
      const a = texAnchor(key)!;
      img.setOrigin(a.x, a.y).setScale(texScale(key));
    } else {
      img.setPosition(c.sx, c.sy + TILE_H).setOrigin(0.5, 1).setScale((TILE_W * 2) / img.width);
    }
    return { img, x, y };
  });
}

// 盖了建筑的地方不显示树木岩石
export function hideCoveredProps(base: Base, props: Prop[]): void {
  for (const p of props) {
    const covered = [[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dy]) => base.buildingAt(p.x + dx, p.y + dy));
    p.img.setVisible(!covered);
  }
}

export function buildingSprite(scene: Phaser.Scene, b: PlacedBuilding, tint?: number): Sprite {
  const d = baseDef(b.defId), key = buildingKey(b);
  const img = scene.add.image(0, 0, key).setOrigin(0.5, 1).setScale(texScale(key));
  const label = scene.add.text(0, 0, d.icon, {
    fontFamily: 'Microsoft YaHei, sans-serif', fontSize: d.size >= 2 ? '20px' : '15px', fontStyle: 'bold', color: '#1d2229',
  }).setOrigin(0.5);
  if (tint !== undefined) img.setTint(tint);
  placeSprite({ img, label }, b);
  return { img, label };
}

// 按建筑现在的位置、朝向、等级摆好贴图。长方形的机场几乎是平的，层级按后排机库算，
// 停在上面的飞机、走在跑道上的部队都画在它上面
export function placeSprite(s: Sprite, b: PlacedBuilding): void {
  const { x, y } = b, { w, h } = footprint(b.defId, b.rot ?? 0), size = Math.min(w, h);
  const key = buildingKey(b);
  if (s.img.texture.key !== key) s.img.setTexture(key);
  const c = toScreen(x + w / 2, y + h / 2);
  const anchor = texAnchor(key);
  if (anchor) {
    s.img.setOrigin(anchor.x, anchor.y).setPosition(c.sx, c.sy).setDepth(x + y + (w === h ? size : 1));
    s.label.setVisible(false);
    return;
  }
  const bottom = c.sy + BASE_INSET * size * (TILE_H / 2);
  const width = TILE_W * size * BASE_INSET, lift = texLift(s.img.texture.key, 26);
  s.img.setPosition(c.sx, bottom).setDepth(x + y + size);
  s.label.setPosition(c.sx, bottom - lift - width / 4).setDepth(x + y + size + 0.5);
}

// 领地边界线（白色描边）
export function strokeTerritory(g: Phaser.GameObjects.Graphics, base: Base, width = 2): void {
  g.lineStyle(width, 0xffffff, 0.8);
  for (const p of base.state.owned) {
    const { px, py } = plotXY(p);
    const x0 = px * PLOT_SIZE, y0 = py * PLOT_SIZE, x1 = x0 + PLOT_SIZE, y1 = y0 + PLOT_SIZE;
    const edge = (nx: number, ny: number, ax: number, ay: number, bx: number, by: number) => {
      const inside = nx >= 0 && ny >= 0 && nx < REGION_PLOTS && ny < REGION_PLOTS && base.ownsPlot(ny * REGION_PLOTS + nx);
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
