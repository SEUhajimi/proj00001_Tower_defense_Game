import Phaser from 'phaser';
import { baseDef, BASE_BUILDINGS, type BaseBuildingId } from '../../shared/data/economy';
import { DEFS, type DefId } from '../../shared/data/units';
import type { Side } from '../../shared/sim/battle';
import { TILE_W } from './iso';
import RENDERED from '../../public/assets/rendered/manifest.json';

// 美术有两种来源：
//   1. Blender 渲染图（public/assets/rendered，由 art/render.py 生成）：有的就优先用
//   2. Kenney 的 CC0 素材（public/assets/kenney，见那里的 CREDITS.md）：还没渲染的先用它顶着
// 加载后按每种东西的占地拼好、缩放成独立贴图，贴图名沿用占位美术的命名，
// 场景代码只管按名字取图。贴图按 ART_SCALE 倍分辨率生成，显示时缩小，镜头拉近也清晰。

export const ART_SCALE = 2;
export const PARKED_SCALE = 0.6; // 停在机场上的飞机画小一些（机位挤），起飞爬升时慢慢变回原大
const ROOT = 'assets/kenney/';

// 基地建筑用哪张图：建筑图（b 开头）、地块图（l）或塔防包里的岩石树木（details）
const BUILDING_ART: Record<string, string> = {
  hall: 'buildings/b106', house: 'buildings/b037', market: 'buildings/b113', farm: 'land/l083',
  powerPlant: 'buildings/b101', granary: 'buildings/b021', vault: 'buildings/b099', lab: 'buildings/b116',
  lumberMill: 'buildings/b014', quarry: 'details/rocks_5', mine: 'details/rocks_2', oilWell: 'buildings/b085',
  arsenal: 'buildings/b009', electronicsPlant: 'buildings/b124',
  warehouse: 'buildings/b040', oilDepot: 'buildings/b108', ammoDepot: 'buildings/b010',
  barracks: 'buildings/b122', tankFactory: 'buildings/b125', airfield: 'buildings/b114',
};

// 塔和工事：塔防包的石块从下往上叠
const TOWER_ART: Partial<Record<DefId, string[]>> = {
  mgTower: ['grey12', 'grey28'],
  cannonTower: ['grey12', 'grey47'],
  atTower: ['grey30', 'grey42'],
  aaTower: ['grey12', 'grey12', 'grey15'],
  pillbox: ['grey07'],
  bunker: ['grey09'],
};

const SOLDIER_ART: Partial<Record<DefId, string>> = {
  rifle: 'soldier_gun', smg: 'soldier_silencer', mg: 'soldier_machine', sniper: 'soldier_gun', sapper: 'soldier_hold',
};

// 坦克：车身 + 炮管，按代变大
const TANK_ART: Partial<Record<DefId, { body: Record<Side, string>; barrel: number; len: number }>> = {
  tank1: { body: { player: 'tankBody_blue', enemy: 'tankBody_red' }, barrel: 1, len: 30 },
  tank2: { body: { player: 'tankBody_blue', enemy: 'tankBody_red' }, barrel: 2, len: 33 },
  tank3: { body: { player: 'tankBody_darkLarge', enemy: 'tankBody_darkLarge' }, barrel: 3, len: 37 },
  tank4: { body: { player: 'tankBody_huge', enemy: 'tankBody_huge' }, barrel: 3, len: 42 },
};

export const ENEMY_TINT = 0xff8a80;
const TREES = ['details/trees_1', 'details/trees_2', 'details/trees_3', 'details/trees_7'];
const ROCKS = ['details/rocks_1', 'details/rocks_2', 'details/rocks_5', 'details/rocks_6'];

const FILES = [
  ...new Set(Object.values(BUILDING_ART)), 'buildings/b036', // b036：没配图的建筑用它
  ...Object.values(TOWER_ART).flat().map(n => `towers/${n}`),
  ...new Set(Object.values(SOLDIER_ART).map(n => `soldiers/${n}`)),
  'tanks/tankBody_blue', 'tanks/tankBody_red', 'tanks/tankBody_darkLarge', 'tanks/tankBody_huge',
  ...[1, 2, 3].flatMap(i => [`tanks/tankBlue_barrel${i}`, `tanks/tankRed_barrel${i}`]),
  ...[1, 2, 3, 4, 5].flatMap(i => [`fx/explosion${i}`, `fx/explosionSmoke${i}`]),
  ...TREES, ...ROCKS,
];

const key = (file: string) => `k-${file}`;

// 特效逐帧图：爆炸、烟团、火焰（循环）。有渲染图就用渲染图（rendered 为 true，锚点是地面上的爆炸点），
// 否则用 Kenney 的爆炸图（只有爆炸和烟，没有火焰）
export interface FxFrames { keys: string[]; rendered: boolean }

export function fxFrames(kind: 'explosion' | 'smoke' | 'fire'): FxFrames | null {
  const paths = Object.keys(rendered).filter(p => p.startsWith(`fx/${kind}-`)).sort();
  if (paths.length) {
    for (const p of paths) useRendered(p, rkey(p));
    return { keys: paths.map(rkey), rendered: true };
  }
  if (kind === 'fire') return null;
  return { keys: [1, 2, 3, 4, 5].map(i => key(`fx/${kind === 'explosion' ? 'explosion' : 'explosionSmoke'}${i}`)), rendered: false };
}

// 枪口火光（一张），没渲染的返回 null
export function flashKey(): string | null {
  if (!has('fx/flash.png')) return null;
  useRendered('fx/flash.png', rkey('fx/flash.png'));
  return rkey('fx/flash.png');
}

// 建筑被摧毁后的瓦砾堆：按占地大小（1–3 格）挑一张，n 用来在几张里轮换。没渲染的返回 null
export function ruinKey(size: number, n: number): string | null {
  const s = Math.max(1, Math.min(3, size));
  const paths = Object.keys(rendered).filter(p => p.startsWith(`ruins/s${s}-`)).sort();
  if (!paths.length) return null;
  const path = paths[n % paths.length];
  useRendered(path, rkey(path));
  return rkey(path);
}

// 基地建筑的贴图名。能升级的建筑每级一张：bb-house-l3；机场还分朝向：bb-airfield-r1-l3。
// 没渲染那一级的用 bb-<建筑名>
export function buildingKey(b: { defId: BaseBuildingId; rot?: number; level?: number }): string {
  const k = b.defId === 'airfield' ? `bb-airfield-r${b.rot ?? 0}-l${b.level ?? 1}` : `bb-${b.defId}-l${b.level ?? 1}`;
  return scaleOf.has(k) ? k : `bb-${b.defId}`;
}

// 建筑受损的样子（血量一半以下换这张）：贴图名后面加 -damaged，没有的返回 null
export function damagedKey(texKey: string): string | null {
  return scaleOf.has(`${texKey}-damaged`) ? `${texKey}-damaged` : null;
}

// ---------- Blender 渲染图 ----------

// lift：建筑最高点比占地中心高多少像素（显示像素），放血条、驻防人数用
interface RenderInfo { w: number; h: number; ax: number; ay: number; lift?: number }
const rendered = RENDERED as Record<string, RenderInfo>;
const rkey = (path: string) => `r-${path.replace(/\.png$/, '')}`;
const has = (path: string) => path in rendered;

// 锚点：图里世界原点（建筑占地中心、单位脚下）的位置，按图宽高的比例算
const anchorOf = new Map<string, { x: number; y: number }>();

export function texAnchor(texKey: string): { x: number; y: number } | null {
  return anchorOf.get(texKey) ?? null;
}

function useRendered(path: string, as: string): void {
  const info = rendered[path];
  if (!scaleOf.has(as)) {
    if (as !== rkey(path)) {
      const src = (sceneRef!.textures.get(rkey(path)).getSourceImage()) as HTMLImageElement;
      sceneRef!.textures.addImage(as, src);
    }
    scaleOf.set(as, 1 / ART_SCALE);
    anchorOf.set(as, { x: info.ax / info.w, y: info.ay / info.h });
    if (info.lift !== undefined) liftOf.set(as, info.lift);
  }
}

let sceneRef: Phaser.Scene | null = null;

// 地块地面（一块地 4×4 格一张）。每种地形有 3×3 张，第 (px, py) 块地用第 (px % 3, py % 3) 张，
// 拼起来无缝、花纹每 12 格才重复一次。没渲染的返回 null
const GROUND_REPEAT = 3;

export function groundKey(terrain: string, px: number, py: number): string | null {
  const v = `${((px % GROUND_REPEAT) + GROUND_REPEAT) % GROUND_REPEAT}${((py % GROUND_REPEAT) + GROUND_REPEAT) % GROUND_REPEAT}`;
  const path = `ground/${terrain}-${v}.png`;
  if (!has(path)) return null;
  useRendered(path, rkey(path));
  return rkey(path);
}

export const UNIT_DIRS = 16;

// 单位的 16 个朝向（第 k 张朝向角 k × 22.5°，0 = 游戏 +x），没渲染的返回 null
export function unitFrames(defId: DefId, side: Side): string[] | null {
  if (!has(`units/${defId}-${side}-00.png`)) return null;
  return Array.from({ length: UNIT_DIRS }, (_, k) => {
    const path = `units/${defId}-${side}-${String(k).padStart(2, '0')}.png`;
    useRendered(path, rkey(path));
    return rkey(path);
  });
}

// 森林的树丛、山地和战场的石堆（一张占 2×2 格，锚点是这 2×2 格的中心）。
// rendered 为 false 时是 Kenney 的图：底边中点对位，按宽度缩放
export function propKeys(kind: 'trees' | 'rocks'): { keys: string[]; rendered: boolean } {
  const paths = Object.keys(rendered).filter(p => p.startsWith(`props/${kind}-`)).sort();
  if (paths.length) {
    for (const p of paths) useRendered(p, rkey(p));
    return { keys: paths.map(rkey), rendered: true };
  }
  return { keys: (kind === 'trees' ? TREES : ROCKS).map(key), rendered: false };
}

// 朝向角 → 第几张
export function dirIndex(angle: number): number {
  const k = Math.round(angle / ((2 * Math.PI) / UNIT_DIRS));
  return ((k % UNIT_DIRS) + UNIT_DIRS) % UNIT_DIRS;
}

export function preloadArt(scene: Phaser.Scene): void {
  for (const f of new Set(FILES)) scene.load.image(key(f), `${ROOT}${f}.png`);
  for (const path of Object.keys(rendered)) {
    if (!path.startsWith('debug/')) scene.load.image(rkey(path), `assets/rendered/${path}`);
  }
}

// 每张拼好的贴图的显示缩放（1 / 分辨率倍数），以及从底角到顶面下角的高度（显示像素），
// 后者用来摆血条、炮管、建筑名
const scaleOf = new Map<string, number>();
const liftOf = new Map<string, number>();

export function texScale(texKey: string): number {
  return scaleOf.get(texKey) ?? 1;
}

export function texLift(texKey: string, fallback: number): number {
  return liftOf.get(texKey) ?? fallback;
}

function img(scene: Phaser.Scene, file: string): HTMLImageElement {
  return scene.textures.get(key(file)).getSourceImage() as HTMLImageElement;
}

// 新建一张画布贴图，draw 在里面作画；tint 用正片叠底染色（保留透明度）
function canvasTexture(scene: Phaser.Scene, texKey: string, w: number, h: number,
  draw: (ctx: CanvasRenderingContext2D) => void, tint?: number): void {
  if (scene.textures.exists(texKey)) return;
  const tex = scene.textures.createCanvas(texKey, Math.ceil(w), Math.ceil(h))!;
  const ctx = tex.getContext();
  ctx.imageSmoothingQuality = 'high';
  draw(ctx);
  if (tint !== undefined) {
    // 先留一份原图当遮罩：染色会填满整张画布，再用原图的透明度裁回来
    const mask = document.createElement('canvas');
    mask.width = tex.width;
    mask.height = tex.height;
    mask.getContext('2d')!.drawImage(tex.getSourceImage() as HTMLCanvasElement, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `#${tint.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  tex.refresh();
  scaleOf.set(texKey, 1 / ART_SCALE);
}

// 等角块：图宽 = 占地菱形宽，底角在图的最下方。按目标宽度缩放
function isoBlock(scene: Phaser.Scene, texKey: string, file: string, width: number, tint?: number): void {
  const im = img(scene, file), k = (width * ART_SCALE) / im.width;
  canvasTexture(scene, texKey, im.width * k, im.height * k, ctx => ctx.drawImage(im, 0, 0, im.width * k, im.height * k), tint);
  liftOf.set(texKey, (im.height - im.width / 2) * k / ART_SCALE);
}

// 叠起来的塔：每块的底角对齐下面那块顶面的下角
function stack(scene: Phaser.Scene, texKey: string, files: string[], width: number, tint?: number): void {
  const ims = files.map(f => img(scene, `towers/${f}`));
  const base = Math.max(...ims.map(i => i.width)), k = (width * ART_SCALE) / base;
  const h = ims[ims.length - 1].height + ims.slice(0, -1).reduce((s, i) => s + i.height - i.width / 2, 0);
  canvasTexture(scene, texKey, base * k, h * k, ctx => {
    let y = h;
    for (const im of ims) {
      const top = y - im.height;
      ctx.drawImage(im, ((base - im.width) / 2) * k, top * k, im.width * k, im.height * k);
      y = top + im.width / 2;
    }
  }, tint);
  liftOf.set(texKey, (h - base / 2) * k / ART_SCALE);
}

// 加载完成后生成全部贴图（基地场景、战斗场景共用）
export function buildArt(scene: Phaser.Scene): void {
  sceneRef = scene;
  const BASE_INSET = 0.86;
  // 基地建筑（基地场景，以及战斗里的民用建筑、演习里自己的建筑）；有渲染图的用渲染图
  // 能升级的建筑每级一张，机场每个朝向、等级一张（见 buildingKey）
  for (const path of Object.keys(rendered)) {
    const m = /^buildings\/(\w+)-player-((?:r\d-)?l\d)(-damaged)?\.png$/.exec(path);
    if (m) useRendered(path, `bb-${m[1]}-${m[2]}${m[3] ?? ''}`);
  }
  for (const id of Object.keys(BASE_BUILDINGS) as BaseBuildingId[]) {
    // 只有分级图的建筑：bb-<建筑名> 用 1 级的（建造菜单、敌方据点里的民用建筑默认用它）
    const l1 = `buildings/${id}-player-l1.png`;
    if (has(l1)) {
      useRendered(l1, `bb-${id}`);
      if (has(`buildings/${id}-player-l1-damaged.png`)) useRendered(`buildings/${id}-player-l1-damaged.png`, `bb-${id}-damaged`);
      continue;
    }
    if (has(`buildings/${id}-player.png`)) {
      useRendered(`buildings/${id}-player.png`, `bb-${id}`);
      if (has(`buildings/${id}-player-damaged.png`)) useRendered(`buildings/${id}-player-damaged.png`, `bb-${id}-damaged`);
      continue;
    }
    const w = TILE_W * baseDef(id).size * BASE_INSET;
    const tower = TOWER_ART[id as DefId];
    if (tower) stack(scene, `bb-${id}`, tower, w);
    else isoBlock(scene, `bb-${id}`, BUILDING_ART[id] ?? 'buildings/b036', w);
  }
  const sides: Side[] = ['player', 'enemy'];
  for (const side of sides) {
    const tint = side === 'enemy' ? ENEMY_TINT : undefined;
    // 战场上的塔、工事、指挥部、民用建筑：有分阵营的渲染图就用
    for (const id of Object.keys(DEFS) as DefId[]) {
      const path = `buildings/${id}-${side}.png`;
      if (DEFS[id].size > 0 && has(path)) useRendered(path, `${id}-${side}`);
      const hurt = `buildings/${id}-${side}-damaged.png`;
      if (DEFS[id].size > 0 && has(hurt)) useRendered(hurt, `${id}-${side}-damaged`);
    }
    for (const [id, files] of Object.entries(TOWER_ART) as [DefId, string[]][]) {
      if (!scene.textures.exists(`${id}-${side}`)) stack(scene, `${id}-${side}`, files, TILE_W * DEFS[id].size * 0.8, tint);
    }
    if (!scene.textures.exists(`hq-${side}`)) isoBlock(scene, `hq-${side}`, BUILDING_ART.hall, TILE_W * DEFS.hq.size * 0.8, tint);
    for (const [id, file] of Object.entries(SOLDIER_ART) as [DefId, string][]) {
      if (has(`units/${id}-${side}-00.png`)) continue; // 有渲染图（16 个朝向）就不用拼
      // 士兵图朝右，显示宽约 22 像素
      const im = img(scene, `soldiers/${file}`), k = (22 * ART_SCALE) / im.width;
      canvasTexture(scene, `${id}-${side}`, im.width * k, im.height * k, ctx => ctx.drawImage(im, 0, 0, im.width * k, im.height * k), tint);
    }
    for (const [id, t] of Object.entries(TANK_ART) as [DefId, NonNullable<(typeof TANK_ART)[DefId]>][]) {
      tank(scene, `${id}-${side}`, t.body[side], `tanks/tank${side === 'player' ? 'Blue' : 'Red'}_barrel${t.barrel}`, t.len,
        t.body[side].includes('dark') || t.body[side].includes('huge') ? tint ?? 0xa8c4ff : undefined);
    }
  }
  // 战场上的岩石
  isoBlock(scene, 'rock', ROCKS[0], TILE_W);
}

// 坦克：车身居中，炮管从中心往上伸；贴图朝上，转向时加 90°。
// 显示长度 len 像素（含炮管）；深色大车身用 tint 染成阵营色
function tank(scene: Phaser.Scene, texKey: string, bodyFile: string, barrelFile: string, len: number, tint?: number): void {
  const body = img(scene, `tanks/${bodyFile}`), barrel = img(scene, barrelFile);
  const H = body.height / 2 + barrel.height + 4, W = body.width;
  const k = (len * ART_SCALE) / (H * 2);
  canvasTexture(scene, texKey, W * k, H * 2 * k, ctx => {
    ctx.drawImage(body, 0, (H - body.height / 2) * k, body.width * k, body.height * k);
    ctx.drawImage(barrel, ((W - barrel.width) / 2) * k, (H - barrel.height - 4) * k + 8 * k, barrel.width * k, barrel.height * k);
  }, tint);
}
