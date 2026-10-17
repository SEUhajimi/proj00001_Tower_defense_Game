import { START_TECH } from '../../data/tech';
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
  if (inner.version === 2) state = { ...inner, version: 3, tech: [...START_TECH] };
  else if (inner.version === 3) state = inner;
  else return '存档版本太旧或无法识别';
  const ok = Array.isArray(state.owned) && Array.isArray(state.buildings) && Array.isArray(state.ai)
    && typeof state.seed === 'number' && !!state.res && typeof state.lastTick === 'number';
  return ok ? state : '存档内容不完整';
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
