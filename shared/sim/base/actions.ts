import { TRAINING } from '../../data/army';
import { BASE_BUILDINGS, type BaseBuildingId } from '../../data/economy';
import { techStage } from '../../data/tech';
import { DEFS, type DefId } from '../../data/units';
import { BUILDABLE, type Base } from './base';

// 玩家对基地的操作。前端先在本地执行（画面立刻有反应），同时发给服务器；
// 服务器用同一个函数执行并保存，结果以服务器为准。
// 服务器收到的是任意 JSON，所以先逐项检查字段，再交给 Base 的方法。

export type BaseAction =
  | { type: 'build'; defId: BaseBuildingId; x: number; y: number }
  | { type: 'move'; uid: number; x: number; y: number }
  | { type: 'demolish'; uid: number }
  | { type: 'upgrade'; uid: number }
  | { type: 'buyPlot'; plot: number }
  | { type: 'recruit'; defId: DefId; n: number }
  | { type: 'repairAll' }
  | { type: 'research'; defId: DefId }
  | { type: 'setTax'; rate: number };

export const MAX_TAX = 0.5;

const int = (v: unknown): v is number => Number.isInteger(v);

// 字段不对返回 null
export function parseAction(raw: unknown): BaseAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'build':
      return typeof a.defId === 'string' && (BUILDABLE as string[]).includes(a.defId) && int(a.x) && int(a.y)
        ? { type: 'build', defId: a.defId as BaseBuildingId, x: a.x, y: a.y } : null;
    case 'move':
      return int(a.uid) && int(a.x) && int(a.y) ? { type: 'move', uid: a.uid, x: a.x, y: a.y } : null;
    case 'demolish':
      return int(a.uid) ? { type: 'demolish', uid: a.uid } : null;
    case 'upgrade':
      return int(a.uid) ? { type: 'upgrade', uid: a.uid } : null;
    case 'buyPlot':
      return int(a.plot) ? { type: 'buyPlot', plot: a.plot } : null;
    case 'recruit':
      return typeof a.defId === 'string' && a.defId in TRAINING && int(a.n) && a.n >= 1 && a.n <= 100
        ? { type: 'recruit', defId: a.defId as DefId, n: a.n } : null;
    case 'repairAll':
      return { type: 'repairAll' };
    case 'research':
      return typeof a.defId === 'string' && a.defId in DEFS && techStage(a.defId as DefId) >= 0
        ? { type: 'research', defId: a.defId as DefId } : null;
    case 'setTax':
      return typeof a.rate === 'number' && a.rate >= 0 && a.rate <= MAX_TAX ? { type: 'setTax', rate: a.rate } : null;
  }
  return null;
}

export function applyAction(base: Base, a: BaseAction): true | string {
  switch (a.type) {
    case 'build': {
      if (!(a.defId in BASE_BUILDINGS)) return '没有这种建筑';
      const r = base.build(a.defId, a.x, a.y);
      return typeof r === 'string' ? r : true;
    }
    case 'move': return base.move(a.uid, a.x, a.y);
    case 'demolish': return base.demolish(a.uid);
    case 'upgrade': return base.upgrade(a.uid);
    case 'buyPlot': return base.buyPlot(a.plot);
    case 'recruit': return base.recruit(a.defId, a.n);
    case 'repairAll': return base.repairAll();
    case 'research': return base.research(a.defId);
    case 'setTax':
      base.state.taxRate = a.rate;
      return true;
  }
}
