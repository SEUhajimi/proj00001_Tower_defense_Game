import type { Amounts } from './economy';
import type { DefId } from './units';

// 征兵：在基地国防部训练部队。士兵来自人口，占住房；每小时消耗粮食。

export interface TrainingDef {
  cost: Amounts;
  pop: number; // 占用人口
  food: number; // 每小时口粮
}

// 阶段 4 的科技树会控制哪些兵种可以征召，现在先全部开放
export const TRAINING: Partial<Record<DefId, TrainingDef>> = {
  rifle: { cost: { gold: 30, food: 10 }, pop: 1, food: 1 },
  smg: { cost: { gold: 40, food: 10 }, pop: 1, food: 1 },
  mg: { cost: { gold: 60, ammo: 10 }, pop: 1, food: 1 },
  sniper: { cost: { gold: 80, food: 10 }, pop: 1, food: 1 },
  sapper: { cost: { gold: 70, ammo: 20 }, pop: 1, food: 1 },
  tank1: { cost: { steel: 150, fuel: 40 }, pop: 3, food: 2 },
  tank2: { cost: { steel: 220, fuel: 60 }, pop: 3, food: 2 },
};

export const TRAINABLE = Object.keys(TRAINING) as DefId[];

// 维修费 = 训练费 × 损失的血量比例 × 该系数
export const REPAIR_RATE = 0.5;

export const START_ARMY: Partial<Record<DefId, number>> = { rifle: 6, smg: 2, sapper: 2 };
