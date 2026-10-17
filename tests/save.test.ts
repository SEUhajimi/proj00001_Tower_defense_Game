import { describe, expect, it } from 'vitest';
import { START_TECH } from '../shared/data/tech';
import { Base, newBaseState } from '../shared/sim/base/base';
import { exportSave, importSave, loadBase, parseSave, saveBase, type SaveStorage } from '../shared/sim/base/save';

const T0 = 1_700_000_000_000;
const KEY = 'baseguard.base.v2';

function memory(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: k => { data.delete(k); },
  };
}

describe('存档', () => {
  it('保存后读回来一样', () => {
    const store = memory();
    const base = new Base(newBaseState(7, T0));
    base.state.res.gold = 1234;
    saveBase(base, store);
    const loaded = loadBase(T0, store);
    expect(loaded.base.state.seed).toBe(7);
    expect(loaded.base.state.res.gold).toBeCloseTo(1234, 0);
    expect(loaded.notice).toBeNull();
  });

  it('v2 存档自动升级，科技从第一阶段开始', () => {
    const { tech: _tech, ...rest } = newBaseState(7, T0);
    const state = parseSave(JSON.stringify({ ...rest, version: 2 }));
    expect(typeof state).not.toBe('string');
    if (typeof state === 'string') return;
    expect(state.version).toBe(3);
    expect(state.tech).toEqual(START_TECH);
  });

  it('主存档坏了就用备份恢复，坏的另外保留', () => {
    const store = memory();
    const base = new Base(newBaseState(7, T0));
    saveBase(base, store);
    saveBase(base, store); // 第二次保存时，第一次的内容进了备份
    store.setItem(KEY, '{坏掉的');
    const loaded = loadBase(T0, store);
    expect(loaded.base.state.seed).toBe(7);
    expect(loaded.notice).toMatch(/备份恢复/);
    expect(store.data.get(`${KEY}.broken`)).toBe('{坏掉的');
    // 恢复的内容写回主存档，下次保存不会把坏档当备份
    saveBase(loaded.base, store);
    expect(typeof parseSave(store.data.get(`${KEY}.bak`)!)).not.toBe('string');
  });

  it('主存档和备份都坏了：重新开局并提示', () => {
    const store = memory();
    store.setItem(KEY, 'nope');
    const loaded = loadBase(T0, store);
    expect(loaded.notice).toMatch(/重新开局/);
    expect(store.data.has(KEY)).toBe(false);
  });

  it('导出再导入，进度一样；乱七八糟的文件导入不了', () => {
    const store = memory();
    const base = new Base(newBaseState(9, T0));
    base.state.res.gold = 777;
    const file = exportSave(base, T0);
    expect(importSave(file, store)).toBe(true);
    expect(loadBase(T0, store).base.state.res.gold).toBeCloseTo(777, 0);
    expect(importSave('hello', store)).toBe('不是有效的存档文件');
    expect(importSave(JSON.stringify({ version: 1 }), store)).toBe('存档版本太旧或无法识别');
    expect(importSave(JSON.stringify({ version: 3 }), store)).toBe('存档内容不完整');
  });
});
