import { hangarNeed } from '../../data/army';
import { DEFS, isAirDef, type DefId } from '../../data/units';
import type { Point } from '../grid';
import type { PlacedBuilding } from './base';

// 机场（8×4）里的布局：后排一排敞口机库（ly 0.1–1.0），库门前是停机坪，再往前是滑行道，最前面一条跑道。
// 每级一座机库，每座 4 个机位（库门口 2 个、停机坪 2 个），轰炸机占一排的 2 个机位。
// 下面的坐标是机场自己的坐标（lx 沿长边 0–8，ly 沿短边 0–4，ly 越大越靠镜头），
// 摆放时按朝向换成世界格子坐标。Blender 里的机场模型（art/buildings.py 的 airfield）按同一套尺寸搭。

export const HANGAR_W = 1.6; // 每座机库占的长度
export const SLOTS_PER_HANGAR = 4;
const ROW_Y = [1.3, 2.0]; // 库门口、停机坪两排机位
const COL_DX = 0.38; // 一排两个机位离机库中线多远
export const TAXI_Y = 2.6; // 滑行道中线
export const RUNWAY_Y = 3.3; // 跑道中线（跑道宽约 0.9 格）
export const RUNWAY_X: [number, number] = [0.5, 7.6]; // 跑道起飞的起点和尽头

export const hangarX = (k: number) => HANGAR_W / 2 + HANGAR_W * k;

// 机场坐标 → 世界格子坐标。rot = 1 时长边沿 y：lx 对应 y，ly 对应 x（跑道仍在靠镜头的一侧）
export function toWorld(b: PlacedBuilding, lx: number, ly: number): Point {
  return b.rot ? { x: b.x + ly, y: b.y + lx } : { x: b.x + lx, y: b.y + ly };
}

// 机场坐标里的方向角 → 世界里的方向角
export function worldAngle(b: PlacedBuilding, a: number): number {
  return b.rot ? Math.atan2(Math.cos(a), Math.sin(a)) : a;
}

export interface Parked {
  defId: DefId;
  i: number; // 同兵种里的第几架
  airfield: number; // 停在哪座机场（建筑 uid）
  x: number;
  y: number;
  facing: number; // 机头朝向（世界角度），停着时朝着跑道
  route: Point[]; // 起飞时滑行的路线（世界坐标），最后两个点是跑道起点和尽头
}

// 机位的机场坐标：第 hangar 座机库第 row 排，col 为 -1/1 是左右两个机位，0 是整排（轰炸机）
function slotLocal(hangar: number, row: number, col: number): [number, number] {
  return [hangarX(hangar) + col * COL_DX, ROW_Y[row]];
}

// 从机位滑到跑道：先出库到滑行道，沿滑行道开到跑道头，拐上跑道，再沿跑道加速起飞
function routeFrom(b: PlacedBuilding, lx: number): Point[] {
  return [
    toWorld(b, lx, TAXI_Y),
    toWorld(b, RUNWAY_X[0] - 0.2, TAXI_Y),
    toWorld(b, RUNWAY_X[0], RUNWAY_Y),
    toWorld(b, RUNWAY_X[1], RUNWAY_Y),
  ];
}

// 把基地里的飞机分到各机场的机位上：按机场 uid、机库、排依次排；轰炸机先占整排，战斗机两架一排。
// 停不下的（机位不够）不在结果里，调用方另找地方放
export function parkPlanes(airfields: PlacedBuilding[], army: Partial<Record<DefId, number>>): Parked[] {
  const rows: { b: PlacedBuilding; hangar: number; row: number }[] = [];
  for (const b of [...airfields].sort((p, q) => p.uid - q.uid)) {
    for (let h = 0; h < (b.level ?? 1); h++) for (let r = 0; r < ROW_Y.length; r++) rows.push({ b, hangar: h, row: r });
  }
  const out: Parked[] = [];
  const planes = (Object.keys(army) as DefId[]).filter(id => isAirDef(DEFS[id]));
  // 轰炸机排在后面的排里，战斗机从前面的排开始停，紧急起飞时滑行的路短
  const bombers = planes.filter(id => hangarNeed(id) === 2), fighters = planes.filter(id => hangarNeed(id) === 1);
  let back = rows.length - 1;
  for (const id of bombers) {
    for (let i = 0; i < (army[id] ?? 0) && back >= 0; i++, back--) {
      const { b, hangar, row } = rows[back];
      const [lx, ly] = slotLocal(hangar, row, 0);
      out.push({ defId: id, i, airfield: b.uid, ...toWorld(b, lx, ly), facing: worldAngle(b, Math.PI / 2), route: routeFrom(b, lx) });
    }
  }
  let front = 0, col = 0;
  for (const id of fighters) {
    for (let i = 0; i < (army[id] ?? 0) && front <= back; i++) {
      const { b, hangar, row } = rows[front];
      const [lx, ly] = slotLocal(hangar, row, col ? 1 : -1);
      out.push({ defId: id, i, airfield: b.uid, ...toWorld(b, lx, ly), facing: worldAngle(b, Math.PI / 2), route: routeFrom(b, lx) });
      if (col) { col = 0; front++; } else col = 1;
    }
  }
  return out;
}
