import { factoryOf, TRAINABLE } from '../../data/army';
import { baseDef } from '../../data/economy';
import { DEFS, isAirDef, type DefId } from '../../data/units';
import type { Base } from './base';

// 部队在基地里站在哪：玩家移动过的用存档里的位置；没移动过的站在自己出厂的建筑旁边。
// 飞机停在飞机工厂上，不能移动。前端画部队、演习布置守军都用这里算出的位置。

export interface Troop {
  defId: DefId;
  i: number; // 同兵种里的第几个（存位置用）
  x: number; // 格子坐标（可带小数）
  y: number;
  plane: boolean;
}

// 一格最多站几个：步兵 4 个，坦克 1 辆，飞机 1 架
const PER_TILE = (id: DefId) => (DEFS[id].kind === 'infantry' ? 4 : 1);
const QUARTER = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];

export function troopLayout(base: Base): Troop[] {
  const st = base.state, out: Troop[] = [];
  const used = new Map<string, number>(); // 格子 → 已经站了几个（坦克、飞机算 4 个）
  const key = (x: number, y: number) => `${x},${y}`;
  const take = (x: number, y: number, n: number) => used.set(key(x, y), (used.get(key(x, y)) ?? 0) + n);

  // 先放移动过的
  const pending: { defId: DefId; i: number }[] = [];
  for (const id of TRAINABLE) {
    const n = st.army[id] ?? 0;
    const pos = st.troopPos?.[id] ?? [];
    for (let i = 0; i < n; i++) {
      const p = pos[i];
      if (p && !isAirDef(DEFS[id]) && base.ownsTile(Math.floor(p[0]), Math.floor(p[1]))) {
        out.push({ defId: id, i, x: p[0], y: p[1], plane: false });
        take(Math.floor(p[0]), Math.floor(p[1]), 4 / PER_TILE(id));
      } else {
        pending.push({ defId: id, i });
      }
    }
  }

  // 没移动过的：围着出厂建筑一圈圈往外找空地；飞机先停在飞机工厂的占地上
  for (const { defId, i } of pending) {
    const plane = isAirDef(DEFS[defId]);
    const home = st.buildings.find(b => b.defId === factoryOf(defId)) ?? st.buildings.find(b => b.defId === 'hall') ?? st.buildings[0];
    const size = home ? baseDef(home.defId).size : 1;
    const x0 = home?.x ?? 0, y0 = home?.y ?? 0;
    const need = 4 / PER_TILE(defId);
    let spot: [number, number] | null = null;
    for (let ring = plane ? 0 : 1; ring < 40 && !spot; ring++) {
      // 这一圈的格子，靠镜头的一侧（建筑前面）优先，免得站在楼背后看不见
      const tiles: [number, number][] = [];
      for (let y = y0 - ring; y < y0 + size + ring; y++) {
        for (let x = x0 - ring; x < x0 + size + ring; x++) {
          const onRing = plane && ring === 0 ? true : x === x0 - ring || y === y0 - ring || x === x0 + size + ring - 1 || y === y0 + size + ring - 1;
          if (onRing) tiles.push([x, y]);
        }
      }
      tiles.sort((a, b) => b[0] + b[1] - (a[0] + a[1]));
      for (const [x, y] of tiles) {
        if (!base.ownsTile(x, y)) continue;
        if (!(plane && ring === 0) && base.buildingAt(x, y)) continue;
        const n = used.get(key(x, y)) ?? 0;
        if (n + need > 4) continue;
        const q = need === 4 ? [0.5, 0.5] : QUARTER[n];
        spot = [x + q[0], y + q[1]];
        take(x, y, need);
        break;
      }
    }
    if (spot) out.push({ defId, i, x: spot[0], y: spot[1], plane });
  }
  return out;
}

// 部队移动后的位置是否有效：在自己领地里
export function validTroopSpot(base: Base, defId: DefId, i: number, x: number, y: number): true | string {
  if (isAirDef(DEFS[defId])) return '飞机停在机场，不能移动';
  if (!Number.isInteger(i) || i < 0 || i >= (base.state.army[defId] ?? 0)) return '没有这支部队';
  if (!Number.isFinite(x) || !Number.isFinite(y) || !base.ownsTile(Math.floor(x), Math.floor(y))) return '只能移动到自己的领地里';
  return true;
}
