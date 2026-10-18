import {
  AI_CIVIL_SKINS, AI_LEVELS, AI_STORAGE_HOURS, aiRates, MAP_H, MAP_W, RECOVER_HOURS, STRONGHOLD_COUNT,
} from '../../data/ai';
import { baseDef, RESOURCES, type ResourceId } from '../../data/economy';
import { DEFS, getDef, isAirDef, type DefId } from '../../data/units';
import { PLOT_SIZE } from '../base/terrain';
import { Rng } from '../rng';

// 世界地图上的据点。位置、道路、等级、仓库、战损、归属存在存档里；
// 据点里的建筑布局由种子生成，每次都一样（进攻时的战场就是它）。

export const HOME_ID = 0; // 道路里用 0 表示玩家的主基地
export const HOME_POS = { x: MAP_W / 2, y: MAP_H / 2 };

export interface AiBase {
  id: number; // 1 起
  level: number;
  seed: number;
  x: number; // 在世界地图上的位置
  y: number;
  links: number[]; // 有道路相连的据点（0 = 主基地）
  owner: 'ai' | 'player'; // player = 已征服，成为附属据点
  res: Record<ResourceId, number>;
  lastTick: number;
  lost: string[]; // 战斗中被消灭、还没恢复的守军和防御（见 slotKey）
  lastAttack: number; // 最后一次进攻的时间戳，0 = 没打过
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
  units: { defId: DefId; x: number; y: number }[]; // 驻军和飞机（格子中心坐标）
}

// 布局里每个守军和防御的编号，用来记录哪些被打掉了：
// b<建筑序号>、u<驻军序号>、g<工事序号>_<第几个驻防步兵>
export const slotKey = {
  building: (i: number) => `b${i}`,
  unit: (j: number) => `u${j}`,
  garrison: (i: number, k: number) => `g${i}_${k}`,
};

export function aiCapacity(level: number): Record<ResourceId, number> {
  const rates = aiRates(level);
  const cap = { ...rates };
  for (const r of RESOURCES) cap[r] = rates[r] * AI_STORAGE_HOURS;
  return cap;
}

// AI 据点照常生产，存量不超过一天的产量；太久没被打，战损全部恢复。
// 已征服的据点不再自己囤资源，产出按比例上交主基地（见 economy.ts）
export function advanceAi(ai: AiBase, now: number): void {
  if (ai.owner === 'ai') {
    const hours = Math.max(0, now - ai.lastTick) / 3600_000;
    const rates = aiRates(ai.level), cap = aiCapacity(ai.level);
    for (const r of RESOURCES) ai.res[r] = Math.min(cap[r], ai.res[r] + rates[r] * hours);
    if (ai.lost.length && now - ai.lastAttack >= RECOVER_HOURS * 3600_000) ai.lost = [];
  }
  ai.lastTick = Math.max(ai.lastTick, now);
}

// ---------- 守备值 ----------

// 计入守备值的：塔、工事、指挥部、地面驻军和工事里的驻防步兵（民用建筑和飞机不算）
function defenseSlots(ai: AiBase): { key: string; hp: number }[] {
  const layout = generateAiLayout(ai);
  const out: { key: string; hp: number }[] = [];
  layout.buildings.forEach((b, i) => {
    const d = DEFS[b.defId];
    if (d.kind !== 'civil') out.push({ key: slotKey.building(i), hp: d.hp });
    b.garrison.forEach((u, k) => out.push({ key: slotKey.garrison(i, k), hp: DEFS[u].hp }));
  });
  layout.units.forEach((u, j) => {
    if (!isAirDef(DEFS[u.defId])) out.push({ key: slotKey.unit(j), hp: DEFS[u.defId].hp });
  });
  return out;
}

// 还剩多少守备（0–1，按血量加权）
export function defenseLeft(ai: AiBase): number {
  const slots = defenseSlots(ai), lost = new Set(ai.lost);
  const total = slots.reduce((n, s) => n + s.hp, 0);
  const left = slots.reduce((n, s) => n + (lost.has(s.key) ? 0 : s.hp), 0);
  return total > 0 ? left / total : 0;
}

// ---------- 道路 ----------

// 和玩家已占的地方（主基地或已征服的据点）有道路相连，才能进攻
export function attackable(ai: AiBase, all: AiBase[]): boolean {
  if (ai.owner !== 'ai') return false;
  return ai.links.some(id => id === HOME_ID || all.find(o => o.id === id)?.owner === 'player');
}

// ---------- 生成世界地图 ----------

interface Node { x: number; y: number }

function crosses(a: Node, b: Node, c: Node, d: Node): boolean {
  const o = (p: Node, q: Node, r: Node) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  if (a === c || a === d || b === c || b === d) return false;
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

// 开局生成据点和道路：据点随机散开（彼此不太近），先连一棵最短的树保证全图连通，
// 再补一些不交叉的短路，让每个据点有 2–4 条路、主基地有 3 条；
// 等级按从主基地走过去要经过几段路排开：紧挨主基地的 1 级，最远的 6 级
export function placeStrongholds(seed: number, now: number): AiBase[] {
  const rng = new Rng(seed ^ 0x5bd1e995);
  const nodes: Node[] = [{ ...HOME_POS }];
  const margin = 60;
  for (let minD = 120; nodes.length <= STRONGHOLD_COUNT; minD *= 0.95) {
    for (let attempt = 0; attempt < 400 && nodes.length <= STRONGHOLD_COUNT; attempt++) {
      const p = { x: margin + rng.next() * (MAP_W - margin * 2), y: margin + rng.next() * (MAP_H - margin * 2) };
      if (nodes.every(n => Math.hypot(n.x - p.x, n.y - p.y) >= minD)) nodes.push(p);
    }
  }
  const n = nodes.length;
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j, Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)]);
  pairs.sort((a, b) => a[2] - b[2]);

  const links: Set<number>[] = nodes.map(() => new Set());
  const edges: [number, number][] = [];
  const add = (i: number, j: number) => { links[i].add(j); links[j].add(i); edges.push([i, j]); };
  const ok = (i: number, j: number) => !links[i].has(j) && edges.every(([a, b]) => !crosses(nodes[i], nodes[j], nodes[a], nodes[b]));

  // 最小生成树（不会交叉）
  const root = nodes.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (const [i, j] of pairs) if (find(i) !== find(j)) { root[find(i)] = find(j); add(i, j); }
  // 补路：主基地补到 3 条，其余补到至少 2 条，都不超过 4 条
  const want = (i: number) => (i === 0 ? 3 : 2);
  for (const [i, j] of pairs) {
    if (links[i].size >= 4 || links[j].size >= 4) continue;
    if (links[i].size >= want(i) && links[j].size >= want(j)) continue;
    if (ok(i, j)) add(i, j);
  }

  // 按路数分等级
  const hops = nodes.map(() => Infinity);
  hops[0] = 0;
  for (const queue = [0]; queue.length;) {
    const i = queue.shift()!;
    for (const j of links[i]) if (hops[j] === Infinity) { hops[j] = hops[i] + 1; queue.push(j); }
  }

  const maxHops = Math.max(...hops);
  const levelOf = (h: number) => (maxHops <= 1 ? 1 : Math.min(6, Math.max(1, Math.round(1 + ((h - 1) * 5) / (maxHops - 1)))));
  const out: AiBase[] = [];
  for (let i = 1; i < n; i++) {
    const level = levelOf(hops[i]);
    const cap = aiCapacity(level), res = { ...cap };
    for (const r of RESOURCES) res[r] = Math.floor(cap[r] * 0.6);
    out.push({
      id: i, level, seed: rng.int(1, 1e9), x: Math.round(nodes[i].x), y: Math.round(nodes[i].y),
      links: [...links[i]].sort((a, b) => a - b), owner: 'ai', res, lastTick: now, lost: [], lastAttack: 0,
    });
  }
  return out;
}

// ---------- 据点布局 ----------

// 按等级生成布局：指挥部居中，工事、塔、民用建筑随机摆开（互相隔一格），驻军站在空地上
export function generateAiLayout(ai: Pick<AiBase, 'level' | 'seed'>): AiLayout {
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
  // 驻场飞机停在空地上，开战后起飞
  for (let k = 0, attempt = 0; k < def.planes.length && attempt < 2000; attempt++) {
    const x = rng.int(1, size - 2), y = rng.int(1, size - 2);
    if (occ[y * size + x]) continue;
    occ[y * size + x] = 1;
    units.push({ defId: def.planes[k], x: x + 0.5, y: y + 0.5 });
    k++;
  }
  return { size, buildings, units };
}
