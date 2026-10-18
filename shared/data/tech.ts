import type { DefId } from './units';

// 科技树（设计文档「解锁顺序」）：分六个阶段，每项单独用科研点和金币研发。
// 上一阶段研发过半后开放下一阶段；高一代的坦克和飞机需要先研发低一代。

export interface TechStage {
  research: number; // 每项花费的科研点
  gold: number; // 每项花费的金币
  items: DefId[];
}

export const TECH_STAGES: TechStage[] = [
  { research: 0, gold: 0, items: ['rifle', 'smg', 'mgTower', 'pillbox'] }, // 开局自带
  { research: 100, gold: 1000, items: ['mg', 'atTower', 'aaTower', 'bunker', 'mortar', 'landmine', 'tank1', 'fighter1'] },
  { research: 300, gold: 3000, items: ['sniper', 'cannonTower', 'radar', 'tank2', 'fighter2', 'bomber1'] },
  { research: 800, gold: 8000, items: ['sapper', 'mlrs', 'tank3', 'fighter3', 'bomber2'] },
  { research: 2000, gold: 20000, items: ['samSite', 'fighter4', 'bomber3'] },
  { research: 5000, gold: 50000, items: ['tank4', 'fighter5', 'bomber4'] },
];

export const STAGE_NAME = ['第一阶段', '第二阶段', '第三阶段', '第四阶段', '第五阶段', '第六阶段'];

export const TECH_REQUIRES: Partial<Record<DefId, DefId>> = {
  tank2: 'tank1', tank3: 'tank2', tank4: 'tank3',
  fighter2: 'fighter1', fighter3: 'fighter2', fighter4: 'fighter3', fighter5: 'fighter4',
  bomber2: 'bomber1', bomber3: 'bomber2', bomber4: 'bomber3',
};

export const START_TECH: DefId[] = [...TECH_STAGES[0].items];

// 该兵种或塔在第几阶段（从 0 数）；不在科技树里的返回 -1（不受限制）
export function techStage(id: DefId): number {
  return TECH_STAGES.findIndex(s => s.items.includes(id));
}
