import { RESOURCES, type ResourceId } from './economy';
import type { DefId } from './units';

// AI 敌方基地（设计文档「AI 敌方基地」）。1–6 级对应科技六个阶段，离玩家越远等级越高。

export interface AiLevelDef {
  plots: number; // 领地边长（地块）；距离放大 4 倍后边长翻倍
  towers: number;
  forts: number;
  civil: number; // 民用建筑数量
  garrison: number; // 驻军（不含工事里的）
  towerTypes: DefId[];
  fortTypes: DefId[];
  unitTypes: DefId[];
  planes: DefId[]; // 驻场飞机（每项一架），会起飞轰炸来犯的部队
}

export const AI_LEVELS: Record<number, AiLevelDef> = {
  1: { plots: 6, towers: 4, forts: 0, civil: 3, garrison: 6, towerTypes: ['mgTower'], fortTypes: [], unitTypes: ['rifle', 'smg'], planes: [] },
  2: { plots: 8, towers: 7, forts: 1, civil: 5, garrison: 10, towerTypes: ['mgTower', 'atTower', 'aaTower'], fortTypes: ['pillbox'], unitTypes: ['rifle', 'smg', 'mg', 'tank1'], planes: ['fighter1'] },
  3: { plots: 10, towers: 11, forts: 2, civil: 7, garrison: 14, towerTypes: ['mgTower', 'atTower', 'cannonTower', 'aaTower'], fortTypes: ['pillbox', 'bunker'], unitTypes: ['rifle', 'smg', 'mg', 'sniper', 'tank1', 'tank2'], planes: ['fighter2', 'bomber1'] },
  4: { plots: 12, towers: 15, forts: 3, civil: 9, garrison: 18, towerTypes: ['mgTower', 'atTower', 'cannonTower', 'aaTower'], fortTypes: ['pillbox', 'bunker'], unitTypes: ['rifle', 'mg', 'sniper', 'sapper', 'tank2', 'tank3'], planes: ['fighter3', 'fighter2', 'bomber1'] },
  5: { plots: 14, towers: 20, forts: 4, civil: 11, garrison: 22, towerTypes: ['mgTower', 'atTower', 'cannonTower', 'aaTower'], fortTypes: ['bunker'], unitTypes: ['rifle', 'mg', 'sniper', 'sapper', 'tank3', 'tank4'], planes: ['fighter4', 'fighter3', 'bomber3'] },
  6: { plots: 16, towers: 25, forts: 5, civil: 13, garrison: 26, towerTypes: ['mgTower', 'atTower', 'cannonTower', 'aaTower'], fortTypes: ['bunker'], unitTypes: ['rifle', 'mg', 'sniper', 'sapper', 'tank3', 'tank4'], planes: ['fighter5', 'fighter4', 'bomber4', 'bomber3'] },
};

// 演习时“选用某个等级 AI 的预设军队”：进攻方的兵种和数量
export const AI_ATTACK: Record<number, Partial<Record<DefId, number>>> = {
  1: { rifle: 8, smg: 4 },
  2: { rifle: 8, smg: 4, mg: 4, tank1: 2, fighter1: 1 },
  3: { rifle: 6, mg: 4, sniper: 2, tank1: 2, tank2: 2, fighter2: 2, bomber1: 1 },
  4: { rifle: 6, mg: 4, sniper: 2, sapper: 6, tank2: 2, tank3: 2, fighter3: 2, bomber2: 1 },
  5: { mg: 6, sniper: 3, sapper: 8, tank3: 3, tank4: 2, fighter4: 3, bomber3: 1 },
  6: { mg: 6, sniper: 4, sapper: 10, tank3: 3, tank4: 4, fighter5: 3, bomber4: 2 },
};

// 世界地图（战略图）：据点数量、地图大小（地图单位，只用来摆位置和画图）
export const STRONGHOLD_COUNT = 20;
export const MAP_W = 1000;
export const MAP_H = 700;

// 据点代号，按编号取
export const STRONGHOLD_NAMES = [
  '鹰巢', '铁砧', '黑石', '狼穴', '赤峰', '雷霆', '断桥', '沙丘', '寒林', '钢铁谷',
  '风暴角', '灰烬', '北岭', '堡垒湾', '雪线', '红河', '石门', '烈焰', '孤峰', '暗礁',
];

export function strongholdName(id: number): string {
  return STRONGHOLD_NAMES[(id - 1) % STRONGHOLD_NAMES.length];
}

// 民用建筑的外观（对应基地建筑）
export const AI_CIVIL_SKINS = ['house', 'market', 'warehouse', 'granary', 'vault', 'oilDepot', 'arsenal', 'powerPlant'] as const;

// 每小时产量；仓库容量 = 产量 × 24（一天的量）
export function aiRates(level: number): Record<ResourceId, number> {
  const r = Object.fromEntries(RESOURCES.map(k => [k, 0])) as Record<ResourceId, number>;
  r.gold = 80 * level;
  r.food = 60 * level;
  r.wood = 50 * level;
  r.stone = 40 * level;
  r.steel = 12 * level;
  if (level >= 2) r.ammo = 8 * level;
  if (level >= 3) r.fuel = 15 * level;
  if (level >= 4) r.electronics = 3 * level;
  return r;
}

export const AI_STORAGE_HOURS = 24;
export const LOOT_SHARE = 0.5;
export const RECOVER_HOURS = 24; // 最后一次进攻后这么久没再被打，守军和塔全部恢复
export const TRIBUTE_SHARE = 0.5; // 附属据点每小时上交自己产量的这个比例
export const TRIBUTE_POP_PER_LEVEL = 2; // 附属据点每小时送来 等级 × 这么多 名市民
