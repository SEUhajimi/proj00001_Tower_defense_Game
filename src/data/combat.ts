// 克制关系：实际伤害 = 基础伤害 × DAMAGE_MULT[伤害类型][护甲类型]
// 数值与设计文档「单位与防御塔 · 克制关系」一致；0 表示打不到。

export type DamageType = 'bullet' | 'hmg' | 'he' | 'ap' | 'demo' | 'aa' | 'bomb';
export type ArmorType = 'infantry' | 'armor' | 'building' | 'air';

export const DAMAGE_MULT: Record<DamageType, Record<ArmorType, number>> = {
  bullet: { infantry: 1, armor: 0.1, building: 0.25, air: 0 },
  hmg: { infantry: 1, armor: 0.1, building: 0.25, air: 0.5 },
  he: { infantry: 1.25, armor: 0.5, building: 1, air: 0 },
  ap: { infantry: 0.25, armor: 1.5, building: 0.75, air: 0 },
  demo: { infantry: 0.5, armor: 1, building: 4, air: 0 },
  aa: { infantry: 0, armor: 0, building: 0, air: 1.5 },
  bomb: { infantry: 1, armor: 1, building: 1.5, air: 0 },
};

export const DAMAGE_TYPE_NAME: Record<DamageType, string> = {
  bullet: '枪弹',
  hmg: '重机枪',
  he: '高爆',
  ap: '穿甲',
  demo: '爆破',
  aa: '防空',
  bomb: '航弹',
};

// 指挥部被摧毁后，该方全部单位和塔的伤害倍率
export const HQ_DOWN_DAMAGE_MULT = 0.7;
