import { Base, newBaseState, type BaseState } from './base';
import { advanceTo, type ResourceMap } from './economy';

// 本地存档。阶段 5 会做正式存档，联机后改为服务器保存；结算逻辑不变。
const KEY = 'baseguard.base.v1';

export interface Loaded {
  base: Base;
  offline: { hours: number; gained: ResourceMap } | null; // 离线收益，新档为 null
}

export function loadBase(now: number = Date.now()): Loaded {
  let state: BaseState | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BaseState;
      if (parsed.version === 1) state = parsed;
    }
  } catch {
    state = null;
  }
  if (!state) {
    return { base: new Base(newBaseState(Math.floor(Math.random() * 1e9), now)), offline: null };
  }
  const base = new Base(state);
  return { base, offline: advanceTo(base, now) };
}

export function saveBase(base: Base): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(base.state));
  } catch {
    // 隐私模式等情况下存不了，游戏照常进行
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 同上
  }
}
