import { clearSave, exportSave, importSave, loadBase, saveBase, type Loaded } from '../sim/base/save';

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

// 导出成文件下载
export function downloadSave(): void {
  const s = session();
  saveBase(s.base);
  const blob = new Blob([exportSave(s.base)], { type: 'application/json' });
  const d = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  const name = `基地守卫存档-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 从文件导入：成功后丢掉内存里的进度，下次进入基地时从新存档读
export function loadSaveText(raw: string): true | string {
  const ok = importSave(raw);
  if (ok === true) current = null;
  return ok;
}
