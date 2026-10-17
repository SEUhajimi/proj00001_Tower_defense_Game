import type { ArmorType, DamageType } from './combat';

// 距离单位：战场格子；时间单位：秒。数值来自设计文档初版，后续实测调整。

export interface Weapon {
  dmg: number;
  interval: number;
  range: number;
  minRange?: number;
  type: DamageType;
  splash?: number;
}

export type UnitKind = 'infantry' | 'tank' | 'tower' | 'fort' | 'hq'; // fort = 可驻防的工事

export interface Cost {
  steel?: number;
  ammo?: number;
  electronics?: number;
}

export interface UnitDef {
  name: string;
  kind: UnitKind;
  armor: ArmorType;
  hp: number;
  speed: number; // 0 = 固定建筑
  radius: number; // 受击半径，射程按到边缘计算
  size: number; // 建筑占地边长（格），移动单位为 0
  weapons: Weapon[];
  cost?: Cost;
  capacity?: number; // 工事可驻防的步兵数
  rangeBonus?: number; // 驻防步兵的射程加成
}

const coaxMg: Weapon = { dmg: 6, interval: 0.3, range: 4, type: 'bullet' };

export const DEFS = {
  rifle: {
    name: '步枪兵', kind: 'infantry', armor: 'infantry', hp: 100, speed: 1.0, radius: 0.25, size: 0,
    weapons: [{ dmg: 12, interval: 1, range: 4, type: 'bullet' }],
  },
  smg: {
    name: '冲锋枪兵', kind: 'infantry', armor: 'infantry', hp: 110, speed: 1.2, radius: 0.25, size: 0,
    weapons: [{ dmg: 6, interval: 0.3, range: 2.5, type: 'bullet' }],
  },
  mg: {
    name: '机枪兵', kind: 'infantry', armor: 'infantry', hp: 120, speed: 0.7, radius: 0.25, size: 0,
    weapons: [{ dmg: 8, interval: 0.25, range: 4.5, type: 'hmg' }],
  },
  sniper: {
    name: '狙击兵', kind: 'infantry', armor: 'infantry', hp: 70, speed: 0.9, radius: 0.25, size: 0,
    weapons: [{ dmg: 110, interval: 3, range: 9, type: 'bullet' }],
  },
  // 靠数量和速度冲到塔下爆破，单个打不过塔
  sapper: {
    name: '爆破兵', kind: 'infantry', armor: 'infantry', hp: 120, speed: 1.5, radius: 0.25, size: 0,
    weapons: [{ dmg: 200, interval: 3, range: 1, type: 'demo' }],
  },
  tank1: {
    name: '一代坦克', kind: 'tank', armor: 'armor', hp: 1200, speed: 0.8, radius: 0.45, size: 0,
    weapons: [{ dmg: 100, interval: 3, range: 5, type: 'ap' }, coaxMg],
  },
  tank2: {
    name: '二代坦克', kind: 'tank', armor: 'armor', hp: 1800, speed: 0.9, radius: 0.45, size: 0,
    weapons: [{ dmg: 140, interval: 2.8, range: 5.5, type: 'ap' }, coaxMg],
  },
  tank3: {
    name: '三代坦克', kind: 'tank', armor: 'armor', hp: 2800, speed: 1.0, radius: 0.45, size: 0,
    weapons: [{ dmg: 200, interval: 2.5, range: 6, type: 'ap' }, coaxMg],
  },
  tank4: {
    name: '四代坦克', kind: 'tank', armor: 'armor', hp: 4000, speed: 1.1, radius: 0.45, size: 0,
    weapons: [{ dmg: 260, interval: 2.2, range: 6.5, type: 'ap' }, coaxMg],
  },
  mgTower: {
    name: '机枪塔', kind: 'tower', armor: 'building', hp: 1200, speed: 0, radius: 0.5, size: 1,
    weapons: [{ dmg: 12, interval: 0.3, range: 5, type: 'hmg' }],
    cost: { steel: 40, ammo: 20 },
  },
  cannonTower: {
    name: '火炮塔', kind: 'tower', armor: 'building', hp: 1500, speed: 0, radius: 0.5, size: 1,
    weapons: [{ dmg: 80, interval: 2.5, range: 7, minRange: 2, type: 'he', splash: 1.5 }],
    cost: { steel: 80, ammo: 40 },
  },
  aaTower: {
    name: '防空炮', kind: 'tower', armor: 'building', hp: 1000, speed: 0, radius: 0.5, size: 1,
    weapons: [{ dmg: 30, interval: 0.5, range: 8, type: 'aa' }],
    cost: { steel: 60, ammo: 30, electronics: 5 },
  },
  atTower: {
    name: '反坦克炮塔', kind: 'tower', armor: 'building', hp: 1800, speed: 0, radius: 0.5, size: 1,
    weapons: [{ dmg: 150, interval: 3, range: 6, type: 'ap' }],
    cost: { steel: 100, ammo: 40 },
  },
  // 工事本身不开火，靠驻防的步兵射击；驻防步兵打不到，工事被毁后弹出
  pillbox: {
    name: '碉堡', kind: 'fort', armor: 'building', hp: 1500, speed: 0, radius: 0.5, size: 1,
    weapons: [], capacity: 2, rangeBonus: 1,
    cost: { steel: 60, ammo: 10 },
  },
  bunker: {
    name: '地堡', kind: 'fort', armor: 'building', hp: 3000, speed: 0, radius: 1, size: 2,
    weapons: [], capacity: 4, rangeBonus: 1,
    cost: { steel: 120, ammo: 20 },
  },
  hq: {
    name: '指挥部', kind: 'hq', armor: 'building', hp: 5000, speed: 0, radius: 1.5, size: 3,
    weapons: [],
  },
} satisfies Record<string, UnitDef>;

export type DefId = keyof typeof DEFS;

export function getDef(id: DefId): UnitDef {
  return DEFS[id];
}
