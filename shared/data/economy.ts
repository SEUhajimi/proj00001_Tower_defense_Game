import { DEFS, type DefId, type UnitDef } from './units';

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
  produces?: Amounts;
  consumes?: Amounts;
  power?: number; // 正数发电，负数耗电
  fuelBoost?: { power: number; fuel: number }; // 有燃油时额外发电，同时每小时烧掉的燃油
  storage?: Amounts;
  popCap?: number;
  research?: number; // 科研点 / 小时
  battleDef?: DefId; // 防御建筑：被进攻时对应的战斗单位
  factory?: boolean; // 军工建筑：在里面研发、生产对应的兵种（见 army.ts 的 FACTORY_UNITS）
  unique?: boolean; // 只能有一座，不能建造、移动以外的操作
  upgradeCost?: Amounts; // 升级用的造价基数（没写就用 cost）；塔、工事、军工建筑不能升级
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
    upgradeCost: { gold: 1500, stone: 300, steel: 150 },
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
    name: '农场', icon: '农', ministry: 'civil', size: 3, color: 0x9bc95a,
    desc: '每小时 +100 粮食', cost: { wood: 50 }, produces: { food: 100 },
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
    name: '伐木场', icon: '木', ministry: 'defense', size: 2, color: 0x6b8f3a,
    desc: '每小时 +80 木材', cost: { stone: 30, gold: 50 }, produces: { wood: 80 },
  },
  quarry: {
    name: '采石场', icon: '石', ministry: 'defense', size: 2, color: 0xa39882,
    desc: '每小时 +60 石料', cost: { wood: 60, gold: 50 }, produces: { stone: 60 },
  },
  mine: {
    name: '矿井', icon: '矿', ministry: 'defense', size: 2, color: 0x9c5b45,
    desc: '每小时 +50 铁矿', cost: { wood: 80, stone: 60 }, produces: { iron: 50 }, power: -2,
  },
  oilWell: {
    name: '油井', icon: '油', ministry: 'defense', size: 2, color: 0x3a3a46,
    desc: '每小时 +40 原油', cost: { stone: 40, steel: 60 }, produces: { oil: 40 }, power: -2,
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

// 军工：生产部队的建筑。点进建筑里查看、研发、征召对应的兵种
const military = {
  barracks: {
    name: '兵营', icon: '营', ministry: 'defense', size: 3, color: 0x7a8a5a,
    desc: '训练步兵：步枪兵、冲锋枪兵、机枪兵、狙击兵、爆破兵', cost: { wood: 120, stone: 80 }, power: -2, factory: true,
  },
  tankFactory: {
    name: '战车工厂', icon: '车', ministry: 'defense', size: 3, color: 0x6a6f5a,
    desc: '制造坦克', cost: { stone: 200, steel: 150 }, power: -5, factory: true,
  },
  airfield: {
    name: '飞机工厂', icon: '机', ministry: 'defense', size: 3, color: 0x5f6f7a,
    desc: '制造战斗机和轰炸机', cost: { stone: 300, steel: 250, electronics: 10 }, power: -6, factory: true,
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

export const BASE_BUILDINGS = { ...civil, ...finance, ...tech, ...defense, ...military, ...fortifications };
export type BaseBuildingId = keyof typeof BASE_BUILDINGS;

export function baseDef(id: BaseBuildingId): BaseBuildingDef {
  return BASE_BUILDINGS[id];
}

// 升级：同一块地上效果翻倍，省出地方布防。等级 n 的产量、原料、耗电、发电、容量、住房、科研都是 1 级的 n 倍。
// 升到 n 级花 n 倍的造价基数；塔、工事和军工建筑不能升级
export const MAX_LEVEL = 5;

export function upgradable(id: BaseBuildingId): boolean {
  const d = baseDef(id);
  return !d.battleDef && !d.factory;
}

// 每种建筑最多能建几座，按市政厅等级（1–5 级）取。升级市政厅来提高上限
export const BUILD_LIMITS: Record<Exclude<BaseBuildingId, 'hall'>, number[]> = {
  house: [2, 4, 6, 8, 10],
  market: [1, 2, 3, 4, 5],
  farm: [1, 2, 3, 4, 5],
  powerPlant: [1, 2, 3, 4, 5],
  granary: [1, 1, 2, 2, 3],
  vault: [1, 1, 2, 2, 3],
  lab: [1, 1, 2, 3, 4],
  lumberMill: [1, 2, 2, 3, 4],
  quarry: [1, 2, 2, 3, 4],
  mine: [1, 1, 2, 3, 4],
  oilWell: [1, 1, 2, 3, 4],
  steelMill: [1, 1, 2, 2, 3],
  refinery: [1, 1, 2, 2, 3],
  arsenal: [1, 1, 2, 2, 3],
  electronicsPlant: [1, 1, 2, 2, 3],
  warehouse: [1, 2, 2, 3, 4],
  oilDepot: [1, 2, 2, 3, 4],
  ammoDepot: [1, 2, 2, 3, 4],
  barracks: [1, 1, 2, 2, 3],
  tankFactory: [1, 1, 2, 2, 3],
  airfield: [1, 1, 2, 2, 3],
  mgTower: [4, 6, 8, 10, 12],
  cannonTower: [2, 3, 4, 6, 8],
  atTower: [2, 3, 4, 6, 8],
  aaTower: [2, 3, 4, 5, 6],
  pillbox: [2, 3, 4, 5, 6],
  bunker: [1, 2, 3, 4, 5],
};

export function buildLimit(id: BaseBuildingId, hallLevel: number): number {
  if (id === 'hall') return 1;
  const row = BUILD_LIMITS[id];
  return row[Math.max(0, Math.min(row.length, hallLevel) - 1)];
}

// 防御建筑的攻击范围（格）：塔看武器射程；工事看驻防机枪兵的射程加上工事加成；其他建筑 0
export function defenseRange(id: BaseBuildingId): number {
  const bd = baseDef(id).battleDef;
  if (!bd) return 0;
  const d = DEFS[bd] as UnitDef;
  if (d.kind === 'fort') return Math.max(...DEFS.mg.weapons.map(w => w.range)) + (d.rangeBonus ?? 0);
  return Math.max(0, ...d.weapons.map(w => w.range));
}

export function upgradeCost(id: BaseBuildingId, toLevel: number): Amounts {
  const d = baseDef(id), base = d.upgradeCost ?? d.cost, out: Amounts = {};
  for (const r of RESOURCES) if (base[r]) out[r] = base[r]! * toLevel;
  return out;
}

export const START_RESOURCES: Record<ResourceId, number> = {
  gold: 1500, food: 300, wood: 500, stone: 400, iron: 0,
  oil: 0, steel: 150, fuel: 0, ammo: 60, electronics: 0,
};
export const START_POP = 20;
export const START_TAX = 0.1;
