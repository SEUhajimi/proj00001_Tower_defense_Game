import Phaser from 'phaser';

// 2.5D 等角投影：格子坐标 (x, y) ↔ 屏幕像素 (sx, sy)。一格菱形宽 64、高 32。
export const TILE_W = 64;
export const TILE_H = 32;

export function toScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) };
}

export function toWorld(sx: number, sy: number): { x: number; y: number } {
  return { x: sy / TILE_H + sx / TILE_W, y: sy / TILE_H - sx / TILE_W };
}

// 格子 (tx, ty) 菱形的四个顶点：上、右、下、左（平铺数组）
export function tileDiamond(tx: number, ty: number): number[] {
  const top = toScreen(tx, ty), right = toScreen(tx + 1, ty);
  const bottom = toScreen(tx + 1, ty + 1), left = toScreen(tx, ty + 1);
  return [top.sx, top.sy, right.sx, right.sy, bottom.sx, bottom.sy, left.sx, left.sy];
}

// 平铺坐标数组 → Phaser 绘图用的点列表
export function pointsOf(flat: number[]): Phaser.Math.Vector2[] {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push(new Phaser.Math.Vector2(flat[i], flat[i + 1]));
  return pts;
}

// 占地 (tx, ty, size) 整块菱形的四个顶点
// 占地的四个角（菱形），w × h 格；h 不给就是正方形
export function footprintDiamond(tx: number, ty: number, w: number, h = w): number[] {
  const top = toScreen(tx, ty), right = toScreen(tx + w, ty);
  const bottom = toScreen(tx + w, ty + h), left = toScreen(tx, ty + h);
  return [top.sx, top.sy, right.sx, right.sy, bottom.sx, bottom.sy, left.sx, left.sy];
}
