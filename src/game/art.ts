import Phaser from 'phaser';
import { baseDef, BASE_BUILDINGS, type BaseBuildingId } from '../../shared/data/economy';
import { DEFS, type DefId } from '../../shared/data/units';
import type { Side } from '../../shared/sim/battle';
import { TILE_W } from './iso';

// 正式美术：Kenney 的 CC0 素材（public/assets/kenney，见那里的 CREDITS.md）。
// 加载后按每种东西的占地拼好、缩放成独立贴图，贴图名沿用占位美术的命名，
// 场景代码只管按名字取图。贴图按 ART_SCALE 倍分辨率生成，显示时缩小，镜头拉近也清晰。

export const ART_SCALE = 2;
const ROOT = 'assets/kenney/';

// 基地建筑用哪张图：建筑图（b 开头）、地块图（l）或塔防包里的岩石树木（details）
const BUILDING_ART: Record<string, string> = {
  hall: 'buildings/b106', house: 'buildings/b037', market: 'buildings/b113', farm: 'land/l083',
  powerPlant: 'buildings/b101', granary: 'buildings/b021', vault: 'buildings/b099', lab: 'buildings/b116',
  lumberMill: 'buildings/b014', quarry: 'details/rocks_5', mine: 'details/rocks_2', oilWell: 'buildings/b085',
  steelMill: 'buildings/b046', refinery: 'buildings/b093', arsenal: 'buildings/b009', electronicsPlant: 'buildings/b124',
  warehouse: 'buildings/b040', oilDepot: 'buildings/b108', ammoDepot: 'buildings/b010',
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

// 直接拿原图用的：爆炸逐帧动画，森林和山地上的树、石头
export const FX_EXPLOSION = [1, 2, 3, 4, 5].map(i => key(`fx/explosion${i}`));
export const FX_SMOKE = [1, 2, 3, 4, 5].map(i => key(`fx/explosionSmoke${i}`));
export const TREE_KEYS = TREES.map(key);
export const ROCK_KEYS = ROCKS.map(key);

export function preloadArt(scene: Phaser.Scene): void {
  for (const f of new Set(FILES)) scene.load.image(key(f), `${ROOT}${f}.png`);
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
  const BASE_INSET = 0.86;
  // 基地建筑（基地场景，以及战斗里的民用建筑、演习里自己的建筑）
  for (const id of Object.keys(BASE_BUILDINGS) as BaseBuildingId[]) {
    const w = TILE_W * baseDef(id).size * BASE_INSET;
    const tower = TOWER_ART[id as DefId];
    if (tower) stack(scene, `bb-${id}`, tower, w);
    else isoBlock(scene, `bb-${id}`, BUILDING_ART[id] ?? 'buildings/b036', w);
  }
  const sides: Side[] = ['player', 'enemy'];
  for (const side of sides) {
    const tint = side === 'enemy' ? ENEMY_TINT : undefined;
    for (const [id, files] of Object.entries(TOWER_ART) as [DefId, string[]][]) {
      stack(scene, `${id}-${side}`, files, TILE_W * DEFS[id].size * 0.8, tint);
    }
    isoBlock(scene, `hq-${side}`, BUILDING_ART.hall, TILE_W * DEFS.hq.size * 0.8, tint);
    for (const [id, file] of Object.entries(SOLDIER_ART) as [DefId, string][]) {
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
