import type { Terrain } from '../../data/economy';
import { Rng } from '../rng';

// 世界地图：40×40 地块，每块 4×4 格，每块一种地形。玩家基地在正中间，AI 基地分布在四周。
export const PLOT_SIZE = 4;
export const REGION_PLOTS = 40;
export const REGION_TILES = REGION_PLOTS * PLOT_SIZE;

// 开局领地：正中间 3×3 地块
export const START_PLOT = { x0: 18, y0: 18, size: 3 };
export const START_CENTER = { x: START_PLOT.x0 + START_PLOT.size / 2, y: START_PLOT.y0 + START_PLOT.size / 2 };

export function generateTerrain(seed: number): Terrain[] {
  const rng = new Rng(seed);
  const t: Terrain[] = new Array(REGION_PLOTS * REGION_PLOTS).fill('plain');
  const at = (x: number, y: number) => y * REGION_PLOTS + x;
  const blob = (kind: Terrain, count: number, minLen: number, maxLen: number) => {
    for (let c = 0; c < count; c++) {
      let x = rng.int(0, REGION_PLOTS - 1), y = rng.int(0, REGION_PLOTS - 1);
      const len = rng.int(minLen, maxLen);
      for (let k = 0; k < len; k++) {
        t[at(x, y)] = kind;
        x = Math.max(0, Math.min(REGION_PLOTS - 1, x + rng.int(-1, 1)));
        y = Math.max(0, Math.min(REGION_PLOTS - 1, y + rng.int(-1, 1)));
      }
    }
  };
  blob('forest', 44, 3, 7);
  blob('mountain', 31, 2, 5);
  blob('iron', 25, 1, 3);
  blob('oil', 19, 1, 3);

  // 开局领地保证有平原、森林、山地；铁矿就在隔壁，油田要再往外买一块
  const { x0, y0, size } = START_PLOT;
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      if (t[at(x, y)] === 'iron' || t[at(x, y)] === 'oil') t[at(x, y)] = 'plain';
    }
  }
  t[at(x0 + 1, y0 + 1)] = 'plain';
  t[at(x0, y0 + 1)] = 'plain';
  t[at(x0, y0)] = 'forest';
  t[at(x0 + 2, y0 + 2)] = 'mountain';
  t[at(x0 + 3, y0 + 1)] = 'iron';
  t[at(x0 - 2, y0 + 2)] = 'oil';
  return t;
}
