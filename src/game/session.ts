import { clearSave, loadBase, saveBase, type Loaded } from '../sim/base/save';

// 两个场景共用的基地存档：基地场景和出击的战斗场景读写同一份数据。
let current: Loaded | null = null;

export function session(): Loaded {
  if (!current) current = loadBase();
  return current;
}

export function save(): void {
  if (current) saveBase(current.base);
}

export function resetSession(): void {
  clearSave();
  current = null;
}
