import {
  AI_CIVIL_SKINS, AI_LEVELS, AI_SPAWN, AI_STORAGE_HOURS, aiRates,
} from '../../data/ai';
import { baseDef, RESOURCES, type ResourceId } from '../../data/economy';
import { DEFS, getDef, type DefId } from '../../data/units';
import { PLOT_SIZE, REGION_PLOTS, START_CENTER, START_PLOT } from '../base/terrain';
import { Rng } from '../rng';

// AI 敌方基地：位置、等级、仓库存量、免战状态存在存档里；
// 建筑布局由种子生成，每次生成都一样（世界地图和战场用同一份布局）。

export interface AiBase {
  id: number;
  level: number;
  px: number; // 领地左上角地块
  py: number;
  seed: number;
  res: Record<ResourceId, number>;
  lastTick: number;
  protectedUntil: number; // 免战结束的时间戳
}

export interface LayoutBuilding {
  defId: DefId; // 战斗单位类型
  skin: string | null; // 民用建筑显示成哪种基地建筑
  x: number; // 基地内坐标（格）
  y: number;
  garrison: DefId[]; // 工事里的驻军
}

export interface AiLayout {
  size: number; // 边长（格）
  buildings: LayoutBuilding[];
  units: { defId: DefId; x: number; y: number }[]; // 驻军（格子中心坐标）
}

export function aiPlots(ai: AiBase): number {
  return AI_LEVELS[ai.level].plots;
}

// 领地在世界上的范围（格）
export function aiRect(ai: AiBase): { x: number; y: number; size: number } {
  return { x: ai.px * PLOT_SIZE, y: ai.py * PLOT_SIZE, size: aiPlots(ai) * PLOT_SIZE };
}

export function aiCapacity(level: number): Record<ResourceId, number> {
  const rates = aiRates(level);
  const cap = { ...rates };
  for (const r of RESOURCES) cap[r] = rates[r] * AI_STORAGE_HOURS;
  return cap;
}

// AI 基地照常生产，存量不超过一天的产量
export function advanceAi(ai: AiBase, now: number): void {
  const hours = Math.max(0, now - ai.lastTick) / 3600_000;
  const rates = aiRates(ai.level), cap = aiCapacity(ai.level);
  for (const r of RESOURCES) ai.res[r] = Math.min(cap[r], ai.res[r] + rates[r] * hours);
  ai.lastTick = Math.max(ai.lastTick, now);
}

export function isProtected(ai: AiBase, now: number): boolean {
  return now < ai.protectedUntil;
}

// 开局时在世界上摆放 AI 基地：按距离分圈，互不重叠，也不贴着玩家开局领地
export function placeAiBases(seed: number, now: number): AiBase[] {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const placed: AiBase[] = [];
  const overlaps = (x: number, y: number, s: number, ox: number, oy: number, os: number, margin: number) =>
    x < ox + os + margin && ox < x + s + margin && y < oy + os + margin && oy < y + s + margin;
  // 大基地先放，小基地再见缝插针
  for (const [level, count, minD, maxD] of [...AI_SPAWN].reverse()) {
    const s = AI_LEVELS[level].plots;
    for (let n = 0; n < count; n++) {
      // 找不到位置时逐步放宽距离范围，保证每个基地都能放下
      for (let attempt = 0; attempt < 5000; attempt++) {
        const x = rng.int(1, REGION_PLOTS - s - 1), y = rng.int(1, REGION_PLOTS - s - 1);
        const d = Math.hypot(x + s / 2 - START_CENTER.x, y + s / 2 - START_CENTER.y);
        const slack = Math.floor(attempt / 500);
        if (d < minD - slack || d > maxD + slack) continue;
        if (overlaps(x, y, s, START_PLOT.x0, START_PLOT.y0, START_PLOT.size, 2)) continue;
        if (placed.some(o => overlaps(x, y, s, o.px, o.py, aiPlots(o), 1))) continue;
        const cap = aiCapacity(level);
        const res = { ...cap };
        for (const r of RESOURCES) res[r] = Math.floor(cap[r] * 0.6);
        placed.push({ id: placed.length + 1, level, px: x, py: y, seed: rng.int(1, 1e9), res, lastTick: now, protectedUntil: 0 });
        break;
      }
    }
  }
  return placed;
}

// 按等级生成基地布局：指挥部居中，工事、塔、民用建筑随机摆开（互相隔一格），驻军站在空地上
export function generateAiLayout(ai: AiBase): AiLayout {
  const def = AI_LEVELS[ai.level];
  const rng = new Rng(ai.seed);
  const size = def.plots * PLOT_SIZE;
  const occ = new Uint8Array(size * size);
  const buildings: LayoutBuilding[] = [];

  const free = (x: number, y: number, s: number, margin: number) => {
    if (x < 1 || y < 1 || x + s > size - 1 || y + s > size - 1) return false;
    for (let j = y - margin; j < y + s + margin; j++) {
      for (let i = x - margin; i < x + s + margin; i++) {
        if (i >= 0 && j >= 0 && i < size && j < size && occ[j * size + i]) return false;
      }
    }
    return true;
  };
  const put = (b: LayoutBuilding, s: number) => {
    for (let j = b.y; j < b.y + s; j++) for (let i = b.x; i < b.x + s; i++) occ[j * size + i] = 1;
    buildings.push(b);
  };
  const place = (defId: DefId, skin: string | null, garrison: DefId[] = []) => {
    const s = DEFS[defId].size;
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = rng.int(1, size - s - 1), y = rng.int(1, size - s - 1);
      if (free(x, y, s, 1)) { put({ defId, skin, x, y, garrison }, s); return; }
    }
  };

  const mid = Math.floor((size - 3) / 2);
  put({ defId: 'hq', skin: null, x: mid, y: mid, garrison: [] }, 3);

  const infantry = def.unitTypes.filter(u => DEFS[u].kind === 'infantry');
  for (let k = 0; k < def.forts; k++) {
    const fort = def.fortTypes[rng.int(0, def.fortTypes.length - 1)];
    const cap = getDef(fort).capacity ?? 0;
    place(fort, null, Array.from({ length: cap }, () => infantry[rng.int(0, infantry.length - 1)]));
  }
  for (let k = 0; k < def.towers; k++) place(def.towerTypes[rng.int(0, def.towerTypes.length - 1)], null);
  for (let k = 0; k < def.civil; k++) {
    const skin = AI_CIVIL_SKINS[rng.int(0, AI_CIVIL_SKINS.length - 1)];
    place(baseDef(skin).size >= 3 ? 'civil3' : 'civil2', skin);
  }

  const units: AiLayout['units'] = [];
  for (let k = 0, attempt = 0; k < def.garrison && attempt < 2000; attempt++) {
    const x = rng.int(1, size - 2), y = rng.int(1, size - 2);
    if (occ[y * size + x]) continue;
    occ[y * size + x] = 1;
    units.push({ defId: def.unitTypes[rng.int(0, def.unitTypes.length - 1)], x: x + 0.5, y: y + 0.5 });
    k++;
  }
  return { size, buildings, units };
}
