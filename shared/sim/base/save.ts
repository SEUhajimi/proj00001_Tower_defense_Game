import { baseDef, footprint, RESOURCES, upgradeCost } from '../../data/economy';
import { START_TECH } from '../../data/tech';
import { placeStrongholds } from '../world/ai';
import { PLOT_SIZE, REGION_PLOTS, REGION_TILES, START_PLOT } from './terrain';
import { Base, newBaseState, type BaseState } from './base';
import { advanceTo, type ResourceMap } from './economy';

// 本地存档：浏览器里自动保存（基地每 10 秒、切场景、关页面时），另有一份备份；
// 也可以导出成文件、从文件导入。联机后改为服务器保存，结算逻辑不变。
// 键名沿用 v2（v2 加入了世界地图、AI 基地和部队，更早的存档作废）；v3 加入科技树，v2 存档自动升级。
const KEY = 'baseguard.base.v2';
const BACKUP_KEY = `${KEY}.bak`; // 上一次成功保存的内容，主存档坏了就用它
const BROKEN_KEY = `${KEY}.broken`; // 读不出来的存档原样留在这里，不覆盖掉

// 只用到 localStorage 的这几个方法，测试里可以换成内存实现
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): SaveStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // 隐私模式等情况下拿不到，游戏照常进行，只是不存档
  }
}

export interface Loaded {
  base: Base;
  offline: { hours: number; gained: ResourceMap } | null; // 离线收益，新档为 null
  notice: string | null; // 读档时出的状况（用了备份、存档损坏），给玩家看
}

type V2State = Omit<BaseState, 'version' | 'tech'> & { version: 2 };

// 把存档文本解析成当前版本的状态；格式不对返回原因
export function parseSave(raw: string): BaseState | string {
  let parsed: BaseState | V2State;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return '不是有效的存档文件';
  }
  if (!parsed || typeof parsed !== 'object') return '不是有效的存档文件';
  // 导出的文件外面包了一层说明
  const inner = (parsed as unknown as { game?: string; state?: unknown }).game === 'baseguard'
    ? (parsed as unknown as { state: BaseState | V2State }).state
    : parsed;
  if (!inner || typeof inner !== 'object') return '不是有效的存档文件';
  let state: BaseState;
  const old = inner as unknown as Omit<BaseState, 'version'> & { version: number };
  // v2 → v3 加科技树；v3 → v4 世界地图改为据点和道路，AI 基地按存档种子重新生成（以前吞并的地和建筑保留）
  if (old.version === 2) old.tech = [...START_TECH];
  if (old.version === 2 || old.version === 3) {
    state = { ...old, version: 4 as unknown as 7, ai: placeStrongholds(old.seed, typeof old.lastTick === 'number' ? old.lastTick : Date.now()) };
  } else if (old.version >= 4 && old.version <= 7) state = old as unknown as BaseState;
  else return '存档版本太旧或无法识别';
  // v4 → v5 距离放大 4 倍：开局领地从 3×3 地块扩到 8×8，旧存档把这一圈补上
  if ((state.version as number) < 5) {
    const own = new Set(state.owned);
    const { x0, y0, size } = START_PLOT;
    for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) own.add(y * REGION_PLOTS + x);
    state = { ...state, version: 5 as unknown as 7, owned: [...own] };
  }
  // v5 → v6 机场从 3×3 扩成 8×4（带跑道）：原地往外扩，放不下就在附近找空地，实在没地方就拆掉、全额返还
  if ((state.version as number) < 6 && Array.isArray(state.buildings)) state = { ...state, ...enlargeAirfields(state), version: 6 as unknown as 7 };
  // v6 → v7 燃油、钢铁一步到位：去掉铁矿、原油两种资源和炼钢厂、炼油厂
  if ((state.version as number) < 7 && Array.isArray(state.buildings)) state = dropRawResources(state);
  const ok = Array.isArray(state.owned) && Array.isArray(state.buildings) && Array.isArray(state.ai)
    && typeof state.seed === 'number' && !!state.res && typeof state.lastTick === 'number';
  return ok ? state : '存档内容不完整';
}

// 存着的铁矿按 2:1 换成钢铁、原油按 3:2 换成燃油（就是以前加工厂的比例）；
// 炼钢厂、炼油厂拆掉，返还造价和各级升级花费（以前的造价，写死在这里）
const RAW_CONVERT: Record<string, [string, number]> = { iron: ['steel', 0.5], oil: ['fuel', 2 / 3] };
const REMOVED_BUILDINGS: Record<string, Record<string, number>> = {
  steelMill: { wood: 80, stone: 150 },
  refinery: { stone: 100, steel: 80 },
};

function convertRes(res: Record<string, number>): Record<string, number> {
  const out = { ...res };
  for (const [raw, [to, k]] of Object.entries(RAW_CONVERT)) {
    if (out[raw]) out[to] = (out[to] ?? 0) + Math.floor(out[raw] * k);
    delete out[raw];
  }
  return out;
}

function dropRawResources(state: BaseState): BaseState {
  const res = convertRes(state.res as unknown as Record<string, number>);
  const kept = [];
  for (const b of state.buildings) {
    const cost = REMOVED_BUILDINGS[b.defId as string];
    if (!cost) { kept.push(b); continue; }
    const lv = b.level ?? 1, times = (lv * (lv + 1)) / 2; // 造价 + 升到 2…lv 级各花 k 倍
    for (const [r, n] of Object.entries(cost)) res[r] = (res[r] ?? 0) + n * times;
  }
  const ai = state.ai.map(a => ({ ...a, res: convertRes(a.res as unknown as Record<string, number>) as unknown as typeof a.res }));
  return { ...state, version: 7, buildings: kept, res: res as unknown as BaseState['res'], ai };
}

function enlargeAirfields(state: BaseState): Pick<BaseState, 'buildings' | 'res'> {
  const owned = new Set(state.owned);
  const occ = new Int32Array(REGION_TILES * REGION_TILES).fill(-1);
  const others = state.buildings.filter(b => b.defId !== 'airfield');
  const stamp = (x0: number, y0: number, w: number, h: number, uid: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) occ[y * REGION_TILES + x] = uid;
  };
  for (const b of others) { const f = footprint(b.defId, b.rot ?? 0); stamp(b.x, b.y, f.w, f.h, b.uid); }
  const free = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || y < 0 || x >= REGION_TILES || y >= REGION_TILES) return false;
        if (!owned.has(Math.floor(y / PLOT_SIZE) * REGION_PLOTS + Math.floor(x / PLOT_SIZE)) || occ[y * REGION_TILES + x] !== -1) return false;
      }
    }
    return true;
  };
  const res = { ...state.res }, kept = [...others];
  for (const b of state.buildings.filter(o => o.defId === 'airfield')) {
    // 从原来的位置开始一圈圈往外找，两个朝向都试
    let spot: { x: number; y: number; rot: 0 | 1 } | null = null;
    for (let ring = 0; ring < 30 && !spot; ring++) {
      for (let dy = -ring; dy <= ring && !spot; dy++) {
        for (let dx = -ring; dx <= ring && !spot; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          for (const rot of [0, 1] as const) {
            const f = footprint('airfield', rot);
            if (free(b.x + dx, b.y + dy, f.w, f.h)) { spot = { x: b.x + dx, y: b.y + dy, rot }; break; }
          }
        }
      }
    }
    if (spot) {
      const f = footprint('airfield', spot.rot);
      stamp(spot.x, spot.y, f.w, f.h, b.uid);
      kept.push({ ...b, x: spot.x, y: spot.y, ...(spot.rot ? { rot: 1 as const } : {}) });
    } else {
      // 返还造价和各级升级花费
      const lv = b.level ?? 1;
      for (const r of RESOURCES) {
        let n = baseDef('airfield').cost[r] ?? 0;
        for (let k = 2; k <= lv; k++) n += upgradeCost('airfield', k)[r] ?? 0;
        if (n) res[r] = (res[r] ?? 0) + n;
      }
    }
  }
  return { buildings: kept, res };
}

export function loadBase(now: number = Date.now(), store: SaveStorage | null = storage()): Loaded {
  const main = store?.getItem(KEY) ?? null;
  let state = main ? parseSave(main) : null;
  let notice: string | null = null;
  if (typeof state === 'string') {
    // 主存档坏了：原样留一份，再试备份
    store?.setItem(BROKEN_KEY, main!);
    const bak = store?.getItem(BACKUP_KEY) ?? null;
    const fromBak = bak ? parseSave(bak) : null;
    // 坏的主存档不能留在原处，否则下次保存会把它当成备份
    if (fromBak && typeof fromBak !== 'string') {
      state = fromBak;
      store?.setItem(KEY, bak!);
      notice = '存档读取失败，已从备份恢复（可能丢失最近几秒的进度）。';
    } else {
      state = null;
      store?.removeItem(KEY);
      notice = '存档读取失败，也没有可用的备份，已重新开局。损坏的存档已另外保留。';
    }
  }
  if (!state) {
    return { base: new Base(newBaseState(Math.floor(Math.random() * 1e9), now)), offline: null, notice };
  }
  const base = new Base(state);
  return { base, offline: advanceTo(base, now), notice };
}

export function saveBase(base: Base, store: SaveStorage | null = storage()): void {
  try {
    const prev = store?.getItem(KEY);
    if (prev) store?.setItem(BACKUP_KEY, prev);
    store?.setItem(KEY, JSON.stringify(base.state));
  } catch {
    // 存储空间满等情况，游戏照常进行
  }
}

export function clearSave(store: SaveStorage | null = storage()): void {
  try {
    store?.removeItem(KEY);
    store?.removeItem(BACKUP_KEY);
  } catch {
    // 同上
  }
}

// 导出：带上游戏名和导出时间，方便认出来
export function exportSave(base: Base, now: number = Date.now()): string {
  return JSON.stringify({ game: 'baseguard', exportedAt: new Date(now).toISOString(), state: base.state }, null, 1);
}

// 导入：校验通过就写进本地存档（覆盖当前进度），返回 true；否则返回原因
export function importSave(raw: string, store: SaveStorage | null = storage()): true | string {
  const state = parseSave(raw);
  if (typeof state === 'string') return state;
  try {
    const prev = store?.getItem(KEY);
    if (prev) store?.setItem(BACKUP_KEY, prev);
    store?.setItem(KEY, JSON.stringify(state));
  } catch {
    return '浏览器存储不可用，无法导入';
  }
  return true;
}
