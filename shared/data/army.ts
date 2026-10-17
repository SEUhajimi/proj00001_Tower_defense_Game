import type { Amounts } from './economy';
import type { DefId } from './units';

// 征兵：在基地国防部训练部队。士兵来自人口，占住房；每小时消耗粮食。

export interface TrainingDef {
  cost: Amounts;
  pop: number; // 占用人口
  food: number; // 每小时口粮
}

// 哪些兵种能征召由科技树决定（data/tech.ts）
export const TRAINING: Partial<Record<DefId, TrainingDef>> = {
  rifle: { cost: { gold: 30, food: 10 }, pop: 1, food: 1 },
  smg: { cost: { gold: 40, food: 10 }, pop: 1, food: 1 },
  mg: { cost: { gold: 60, ammo: 10 }, pop: 1, food: 1 },
  sniper: { cost: { gold: 80, food: 10 }, pop: 1, food: 1 },
  sapper: { cost: { gold: 70, ammo: 20 }, pop: 1, food: 1 },
  tank1: { cost: { steel: 150, fuel: 40 }, pop: 3, food: 2 },
  tank2: { cost: { steel: 220, fuel: 60 }, pop: 3, food: 2 },
  tank3: { cost: { steel: 320, fuel: 80, electronics: 10 }, pop: 3, food: 2 },
  tank4: { cost: { steel: 450, fuel: 100, electronics: 30 }, pop: 3, food: 2 },
  fighter1: { cost: { steel: 100, fuel: 60 }, pop: 1, food: 1 },
  fighter2: { cost: { steel: 140, fuel: 80, electronics: 5 }, pop: 1, food: 1 },
  fighter3: { cost: { steel: 200, fuel: 100, electronics: 10 }, pop: 1, food: 1 },
  fighter4: { cost: { steel: 280, fuel: 130, electronics: 25 }, pop: 1, food: 1 },
  fighter5: { cost: { steel: 400, fuel: 160, electronics: 50 }, pop: 1, food: 1 },
  bomber1: { cost: { steel: 400, fuel: 200, electronics: 10 }, pop: 4, food: 3 },
  bomber2: { cost: { steel: 600, fuel: 300, electronics: 20 }, pop: 4, food: 3 },
  bomber3: { cost: { steel: 900, fuel: 400, electronics: 40 }, pop: 4, food: 3 },
  bomber4: { cost: { steel: 1400, fuel: 500, electronics: 80 }, pop: 4, food: 3 },
};

export const TRAINABLE = Object.keys(TRAINING) as DefId[];

// 维修费 = 训练费 × 损失的血量比例 × 该系数
export const REPAIR_RATE = 0.5;

export const START_ARMY: Partial<Record<DefId, number>> = { rifle: 6, smg: 2, sapper: 2 };
