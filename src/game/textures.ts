import Phaser from 'phaser';
import { baseDef, BASE_BUILDINGS, type BaseBuildingId } from '../data/economy';
import { DEFS, type DefId } from '../data/units';
import type { Side } from '../sim/battle';
import { TILE_W } from './iso';

// 占位美术：全部用代码画，正式素材在阶段 5 替换。

export const SIDE_COLOR: Record<Side, number> = { player: 0x3d8bfd, enemy: 0xe0524f };

// 塔顶颜色区分塔种
const TOWER_TOP: Partial<Record<DefId, number>> = {
  mgTower: 0xf2d16b,
  cannonTower: 0xff9a3c,
  atTower: 0xb98cff,
  aaTower: 0x3cffd2,
  pillbox: 0x9aa3ab,
  bunker: 0x8a939b,
  hq: 0xf4f6fa,
};

// 步兵头顶的标记色区分兵种
const INFANTRY_MARK: Partial<Record<DefId, number>> = {
  rifle: 0xffffff,
  smg: 0xffe14a,
  mg: 0xff9a3c,
  sniper: 0x7dff8a,
  sapper: 0xff4d4d,
};

// 建筑立方体高度（像素）
export const CUBE_HEIGHT: Partial<Record<DefId, number>> = {
  mgTower: 26, cannonTower: 22, atTower: 24, aaTower: 26, pillbox: 14, bunker: 16, hq: 52,
};

export function textureKey(defId: DefId, side: Side): string {
  return `${defId}-${side}`;
}

export function shade(color: number, f: number): number {
  const r = Math.min(255, ((color >> 16) & 255) * f);
  const g = Math.min(255, ((color >> 8) & 255) * f);
  const b = Math.min(255, (color & 255) * f);
  return (r << 16) | (g << 8) | b;
}

// 等角立方体：占地宽 w 像素、高 h 像素。原点设在占地菱形的最下角。
export function drawCube(g: Phaser.GameObjects.Graphics, w: number, h: number, top: number, side: number, ox = 0, oy = 0): void {
  const q = w / 4, half = w / 2;
  g.fillStyle(shade(side, 0.8));
  g.fillPoints([
    { x: ox, y: oy + q }, { x: ox + half, y: oy + half }, { x: ox + half, y: oy + half + h }, { x: ox, y: oy + q + h },
  ].map(p => new Phaser.Math.Vector2(p.x, p.y)), true);
  g.fillStyle(shade(side, 0.6));
  g.fillPoints([
    { x: ox + half, y: oy + half }, { x: ox + w, y: oy + q }, { x: ox + w, y: oy + q + h }, { x: ox + half, y: oy + half + h },
  ].map(p => new Phaser.Math.Vector2(p.x, p.y)), true);
  g.fillStyle(top);
  g.fillPoints([
    { x: ox + half, y: oy }, { x: ox + w, y: oy + q }, { x: ox + half, y: oy + half }, { x: ox, y: oy + q },
  ].map(p => new Phaser.Math.Vector2(p.x, p.y)), true);
  g.lineStyle(1, 0x000000, 0.25);
  g.strokePoints([
    { x: ox + half, y: oy }, { x: ox + w, y: oy + q }, { x: ox + w, y: oy + q + h }, { x: ox + half, y: oy + half + h },
    { x: ox, y: oy + q + h }, { x: ox, y: oy + q },
  ].map(p => new Phaser.Math.Vector2(p.x, p.y)), true);
}

export function makeTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);
  const sides: Side[] = ['player', 'enemy'];

  for (const side of sides) {
    const color = SIDE_COLOR[side];
    for (const [id, def] of Object.entries(DEFS) as [DefId, (typeof DEFS)[DefId]][]) {
      const key = textureKey(id, side);
      if (scene.textures.exists(key)) continue;
      g.clear();
      if (def.size > 0) {
        const w = TILE_W * def.size * 0.8, h = CUBE_HEIGHT[id] ?? 24;
        drawCube(g, w, h, TOWER_TOP[id] ?? 0xffffff, color);
        if (def.kind === 'fort') {
          // 射击孔
          g.fillStyle(0x1a1d22);
          g.fillRect(w * 0.12, w / 4 + h * 0.35, w * 0.26, 3);
          g.fillRect(w * 0.62, w / 4 + h * 0.35, w * 0.26, 3);
        }
        if (id === 'hq') {
          // 旗杆
          g.lineStyle(2, 0x222222);
          g.lineBetween(w / 2, w / 4, w / 2, w / 4 - 26);
          g.fillStyle(color);
          g.fillTriangle(w / 2, w / 4 - 26, w / 2 + 16, w / 4 - 21, w / 2, w / 4 - 16);
        }
        g.generateTexture(key, w, w / 2 + h);
      } else if (def.kind === 'tank') {
        const big = id === 'tank3' || id === 'tank4';
        const w = big ? 40 : 34, h = 9;
        drawCube(g, w, h, shade(color, 1.15), color, 0, 10);
        drawCube(g, w * 0.5, 6, shade(color, 1.3), shade(color, 0.9), w * 0.25, 10 + w * 0.125 - 6);
        g.generateTexture(key, w, 10 + w / 2 + h);
      } else {
        // 步兵：身体 + 头 + 兵种标记
        g.fillStyle(0x000000, 0.25);
        g.fillEllipse(8, 21, 12, 5);
        g.fillStyle(shade(color, 0.85));
        g.fillRoundedRect(3, 7, 10, 13, 4);
        g.fillStyle(0xf1d2b0);
        g.fillCircle(8, 6, 4);
        g.fillStyle(INFANTRY_MARK[id] ?? 0xffffff);
        g.fillRect(5, 11, 6, 3);
        g.generateTexture(key, 16, 24);
      }
    }
  }

  if (!scene.textures.exists('rock')) {
    g.clear();
    drawCube(g, TILE_W * 0.7, 12, 0x9a9a9a, 0x7a7a7a);
    g.generateTexture('rock', TILE_W * 0.7, TILE_W * 0.35 + 12);
  }
  g.destroy();
}

// ---------- 基地建筑 ----------

export const BASE_INSET = 0.86; // 建筑比占地略小一圈，看得出格子
export const BASE_CUBE_H: Record<number, number> = { 1: 22, 2: 26, 3: 34 };

// 基地建筑的贴图（基地场景，以及战斗里 AI 基地的民用建筑共用）
export function makeBaseTextures(scene: Phaser.Scene): void {
  const g = scene.make.graphics({}, false);
  for (const id of Object.keys(BASE_BUILDINGS) as BaseBuildingId[]) {
    const key = `bb-${id}`;
    if (scene.textures.exists(key)) continue;
    const d = baseDef(id), w = TILE_W * d.size * BASE_INSET, h = BASE_CUBE_H[d.size] ?? 26;
    g.clear();
    drawCube(g, w, h, d.color, id === 'hall' ? 0x5f7aa8 : shade(d.color, 0.75));
    g.generateTexture(key, w, w / 2 + h);
  }
  g.destroy();
}
