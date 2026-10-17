import { DEFS, type DefId } from './units';

// 基地经营数值。产量单位：每小时（真实时间，关掉游戏也照常生产）。

export const RESOURCES = ['gold', 'food', 'wood', 'stone', 'iron', 'oil', 'steel', 'fuel', 'ammo', 'electronics'] as const;
export type ResourceId = (typeof RESOURCES)[number];
export type Amounts = Partial<Record<ResourceId, number>>;

export const RESOURCE_NAME: Record<ResourceId, string> = {
  gold: '金币', food: '粮食', wood: '木材', stone: '石料', iron: '铁矿',
  oil: '原油', steel: '钢铁', fuel: '燃油', ammo: '弹药', electronics: '电子元件',
};

export type Terrain = 'plain' | 'forest' | 'mountain' | 'iron' | 'oil';

export const TERRAIN_NAME: Record<Terrain, string> = {
  plain: '平原', forest: '森林', mountain: '山地', iron: '铁矿脉', oil: '油田',
};

// 买地价格的地形系数（设计文档「买地价格」）
export const TERRAIN_PRICE: Record<Terrain, number> = {
  plain: 1, forest: 1.3, mountain: 1.3, iron: 2, oil: 2,
};

export type Ministry = 'tech' | 'finance' | 'civil' | 'defense';

export const MINISTRY_NAME: Record<Ministry, string> = {
  tech: '科技部', finance: '财政部', civil: '民政部', defense: '国防部',
};

export interface BaseBuildingDef {
  name: string;
  icon: string; // 屋顶上的字
  ministry: Ministry;
  size: number;
  color: number;
  desc: string;
  cost: Amounts;
  terrain?: Terrain; // 采集建筑必须整块建在这种地形上
  produces?: Amounts;
  consumes?: Amounts;
  power?: number; // 正数发电，负数耗电
  fuelBoost?: { power: number; fuel: number }; // 有燃油时额外发电，同时每小时烧掉的燃油
  storage?: Amounts;
  popCap?: number;
  research?: number; // 科研点 / 小时
  battleDef?: DefId; // 防御建筑：被进攻时对应的战斗单位
  unique?: boolean; // 只能有一座，不能建造、移动以外的操作
}

// 市政厅自带的基础容量和供电
export const HALL_STORAGE: Record<ResourceId, number> = {
  gold: 3000, food: 1000, wood: 1000, stone: 1000, iron: 500,
  oil: 500, steel: 500, fuel: 500, ammo: 300, electronics: 200,
};

export const TAX_PER_PERSON = 20; // 税率 100% 时每人每小时缴纳的金币
export const POP_GROWTH_RATE = 0.5; // 每小时补足住房空位的比例（税率为 0 时）

const civil = {
  hall: {
    name: '市政厅', icon: '厅', ministry: 'finance', size: 3, color: 0xf4f6fa, unique: true,
    desc: '基地核心。自带基础仓储、10 点电力、30 人住房、每小时 5 科研点', cost: {},
    power: 10, popCap: 30, research: 5,
  },
  house: {
    name: '民居', icon: '民', ministry: 'civil', size: 2, color: 0xc9a36b,
    desc: '住房 +20 人。人口越多，税收越多', cost: { wood: 60, stone: 40 }, popCap: 20, power: -1,
  },
  market: {
    name: '市场', icon: '市', ministry: 'civil', size: 2, color: 0xd9b33a,
    desc: '每小时 +60 金币', cost: { wood: 80, stone: 80, gold: 200 }, produces: { gold: 60 }, power: -1,
  },
  farm: {
    name: '农场', icon: '农', ministry: 'civil', size: 3, color: 0x9bc95a, terrain: 'plain',
    desc: '建在平原上，每小时 +100 粮食', cost: { wood: 50 }, produces: { food: 100 },
  },
  powerPlant: {
    name: '发电厂', icon: '电', ministry: 'civil', size: 2, color: 0x4f9fd6,
    desc: '电力 +15；有燃油时每小时烧 10 燃油，再 +15', cost: { stone: 120, steel: 40 },
    power: 15, fuelBoost: { power: 15, fuel: 10 },
  },
  granary: {
    name: '粮仓', icon: '粮', ministry: 'civil', size: 2, color: 0xe0c27a,
    desc: '粮食容量 +3000', cost: { wood: 80, stone: 40 }, storage: { food: 3000 },
  },
} satisfies Record<string, BaseBuildingDef>;

const finance = {
  vault: {
    name: '金库', icon: '金', ministry: 'finance', size: 2, color: 0xf2d16b,
    desc: '金币容量 +10000', cost: { stone: 150, steel: 30 }, storage: { gold: 10000 },
  },
} satisfies Record<string, BaseBuildingDef>;

const tech = {
  lab: {
    name: '研究所', icon: '研', ministry: 'tech', size: 2, color: 0x9a72e0,
    desc: '每小时 +10 科研点', cost: { wood: 100, stone: 100, steel: 50 }, research: 10, power: -3,
  },
} satisfies Record<string, BaseBuildingDef>;

const defense = {
  lumberMill: {
    name: '伐木场', icon: '木', ministry: 'defense', size: 2, color: 0x6b8f3a, terrain: 'forest',
    desc: '建在森林上，每小时 +80 木材', cost: { stone: 30, gold: 50 }, produces: { wood: 80 },
  },
  quarry: {
    name: '采石场', icon: '石', ministry: 'defense', size: 2, color: 0xa39882, terrain: 'mountain',
    desc: '建在山地上，每小时 +60 石料', cost: { wood: 60, gold: 50 }, produces: { stone: 60 },
  },
  mine: {
    name: '矿井', icon: '矿', ministry: 'defense', size: 2, color: 0x9c5b45, terrain: 'iron',
    desc: '建在铁矿脉上，每小时 +50 铁矿', cost: { wood: 80, stone: 60 }, produces: { iron: 50 }, power: -2,
  },
  oilWell: {
    name: '油井', icon: '油', ministry: 'defense', size: 2, color: 0x3a3a46, terrain: 'oil',
    desc: '建在油田上，每小时 +40 原油', cost: { stone: 40, steel: 60 }, produces: { oil: 40 }, power: -2,
  },
  steelMill: {
    name: '炼钢厂', icon: '钢', ministry: 'defense', size: 3, color: 0x7d8792,
    desc: '每小时 40 铁矿 → 20 钢铁', cost: { wood: 80, stone: 150 },
    consumes: { iron: 40 }, produces: { steel: 20 }, power: -4,
  },
  refinery: {
    name: '炼油厂', icon: '炼', ministry: 'defense', size: 3, color: 0x5a6070,
    desc: '每小时 30 原油 → 20 燃油', cost: { stone: 100, steel: 80 },
    consumes: { oil: 30 }, produces: { fuel: 20 }, power: -4,
  },
  arsenal: {
    name: '兵工厂', icon: '兵', ministry: 'defense', size: 3, color: 0x8b6b4a,
    desc: '每小时 10 钢铁 + 10 燃油 → 20 弹药', cost: { stone: 100, steel: 100 },
    consumes: { steel: 10, fuel: 10 }, produces: { ammo: 20 }, power: -4,
  },
  electronicsPlant: {
    name: '电子厂', icon: '芯', ministry: 'defense', size: 3, color: 0x3fa7a0,
    desc: '每小时 10 钢铁 → 5 电子元件', cost: { stone: 80, steel: 150 },
    consumes: { steel: 10 }, produces: { electronics: 5 }, power: -6,
  },
  warehouse: {
    name: '物资仓库', icon: '仓', ministry: 'defense', size: 2, color: 0x8a6a4a,
    desc: '木材、石料、铁矿、钢铁容量 +2000，电子元件 +500', cost: { wood: 100, stone: 60 },
    storage: { wood: 2000, stone: 2000, iron: 2000, steel: 2000, electronics: 500 },
  },
  oilDepot: {
    name: '油罐', icon: '罐', ministry: 'defense', size: 2, color: 0x4a4f5c,
    desc: '原油、燃油容量各 +1500', cost: { stone: 40, steel: 60 }, storage: { oil: 1500, fuel: 1500 },
  },
  ammoDepot: {
    name: '弹药库', icon: '弹', ministry: 'defense', size: 2, color: 0x6e5a3a,
    desc: '弹药容量 +1500', cost: { stone: 120, steel: 40 }, storage: { ammo: 1500 },
  },
} satisfies Record<string, BaseBuildingDef>;

// 布防：塔和工事直接沿用战斗数值，造价也一样
function defenseFromBattle(id: DefId, icon: string, color: number): BaseBuildingDef {
  const d = DEFS[id] as (typeof DEFS)[DefId] & { cost?: Amounts };
  return {
    name: d.name, icon, ministry: 'defense', size: d.size, color, cost: { ...d.cost },
    desc: `基地被进攻时参战。血量 ${d.hp}`, battleDef: id,
  };
}

const fortifications = {
  mgTower: defenseFromBattle('mgTower', '机', 0xf2d16b),
  cannonTower: defenseFromBattle('cannonTower', '炮', 0xff9a3c),
  atTower: defenseFromBattle('atTower', '反', 0xb98cff),
  aaTower: defenseFromBattle('aaTower', '空', 0x3cffd2),
  pillbox: defenseFromBattle('pillbox', '碉', 0x9aa3ab),
  bunker: defenseFromBattle('bunker', '堡', 0x8a939b),
};

export const BASE_BUILDINGS = { ...civil, ...finance, ...tech, ...defense, ...fortifications };
export type BaseBuildingId = keyof typeof BASE_BUILDINGS;

export function baseDef(id: BaseBuildingId): BaseBuildingDef {
  return BASE_BUILDINGS[id];
}

export const START_RESOURCES: Record<ResourceId, number> = {
  gold: 1500, food: 300, wood: 500, stone: 400, iron: 0,
  oil: 0, steel: 150, fuel: 0, ammo: 60, electronics: 0,
};
export const START_POP = 20;
export const START_TAX = 0.1;
