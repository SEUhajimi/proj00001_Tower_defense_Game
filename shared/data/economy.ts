import { DEFS, type DefId, type UnitDef } from './units';

// 基地经营数值。产量单位：每小时（真实时间，关掉游戏也照常生产）。

export const RESOURCES = ['gold', 'food', 'wood', 'stone', 'steel', 'fuel', 'ammo', 'electronics'] as const;
export type ResourceId = (typeof RESOURCES)[number];
export type Amounts = Partial<Record<ResourceId, number>>;

export const RESOURCE_NAME: Record<ResourceId, string> = {
  gold: '金币', food: '粮食', wood: '木材', stone: '石料',
  steel: '钢铁', fuel: '燃油', ammo: '弹药', electronics: '电子元件',
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
  size: number; // 正方形占地的边长；长方形的见 rect
  rect?: [number, number]; // 长方形占地（长、宽），可以转 90° 摆放，见 footprint
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
  hangars?: number; // 机场：每级几个机库（飞机停在机库里，满了就不能再造）
  jobs?: { per: number; gold: number }; // 私营企业：每级雇 per 名市民，每人每小时挣 gold 金币 × (1 − 税率)
  interest?: number; // 银行：存着的金币每小时生这么多利息（息差），不设上限；涨到仓库满为止
  listing?: number; // 证券交易所：每小时 = listing × 上市企业（国营、私营企业）的等级总和 × 行情指数
  unique?: boolean; // 只能有一座，不能建造、移动以外的操作
  upgradeCost?: Amounts; // 升级用的造价基数（没写就用 cost）；塔、工事、兵营、战车工厂不能升级
}

// 市政厅自带的基础容量和供电
export const HALL_STORAGE: Record<ResourceId, number> = {
  gold: 3000, food: 1000, wood: 1000, stone: 1000,
  steel: 500, fuel: 500, ammo: 300, electronics: 200,
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

// 财政部：除了收税，还有四种挣钱的办法，各走一条路子（见设计文档“财政”）
const finance = {
  vault: {
    name: '金库', icon: '金', ministry: 'finance', size: 2, color: 0xf2d16b,
    desc: '金币容量 +10000', cost: { stone: 150, steel: 30 }, storage: { gold: 10000 },
  },
  stateEnterprise: {
    name: '国营企业', icon: '国', ministry: 'finance', size: 3, color: 0xc0392b,
    desc: '每小时用 10 钢铁、5 燃油，挣 300 金币。不受税率影响，稳定', cost: { stone: 300, steel: 200, gold: 500 },
    consumes: { steel: 10, fuel: 5 }, produces: { gold: 300 }, power: -4,
  },
  privateEnterprise: {
    name: '私营企业', icon: '私', ministry: 'finance', size: 2, color: 0x2e86c1,
    desc: '雇 40 名市民，每人每小时挣 4 金币；税率越高挣得越少（税率 50% 时少一半）',
    cost: { wood: 150, stone: 150, gold: 300 }, jobs: { per: 40, gold: 4 }, power: -2,
  },
  bank: {
    name: '银行', icon: '银', ministry: 'finance', size: 2, color: 0xd4ac0d,
    desc: '靠息差挣钱：存着的金币每小时生 2% 利息，不设上限（金币存满仓库就不再涨）。只能建一家，升级加金币容量',
    cost: { stone: 200, steel: 80, gold: 1000 }, storage: { gold: 3000 }, interest: 0.02, power: -1,
  },
  stockExchange: {
    name: '证券交易所', icon: '证', ministry: 'finance', size: 3, color: 0x7d3c98,
    desc: '国营、私营企业上市交易：每小时 30 金币 × 两种企业的等级总和 × 行情指数（0.5–1.5，一天涨跌一轮）',
    cost: { stone: 400, steel: 200, electronics: 30, gold: 2000 }, listing: 30, power: -3,
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
  // 矿井、油井直接产出钢铁、燃油（不再经过铁矿、原油和炼钢厂、炼油厂）
  mine: {
    name: '矿井', icon: '矿', ministry: 'defense', size: 2, color: 0x9c5b45,
    desc: '每小时 +30 钢铁（挖出来就地冶炼）', cost: { wood: 80, stone: 60 }, produces: { steel: 30 }, power: -3,
  },
  oilWell: {
    name: '油井', icon: '油', ministry: 'defense', size: 2, color: 0x3a3a46,
    desc: '每小时 +35 燃油（抽出来就地炼好）', cost: { stone: 40, steel: 60 }, produces: { fuel: 35 }, power: -2,
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
    desc: '木材、石料、钢铁容量 +2000，电子元件 +500', cost: { wood: 100, stone: 60 },
    storage: { wood: 2000, stone: 2000, steel: 2000, electronics: 500 },
  },
  oilDepot: {
    name: '油罐', icon: '罐', ministry: 'defense', size: 2, color: 0x4a4f5c,
    desc: '燃油容量 +2000', cost: { stone: 40, steel: 60 }, storage: { fuel: 2000 },
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
    name: '机场', icon: '机', ministry: 'defense', size: 4, rect: [8, 4], color: 0x5f6f7a,
    desc: '生产并停放战斗机、轰炸机。有一条跑道，每级一座机库，每座停 4 架战斗机（轰炸机占 2 个位置），5 级停满 20 架。基地遭到进攻时战斗机从跑道紧急升空迎敌',
    cost: { stone: 500, steel: 400, electronics: 20 }, upgradeCost: { stone: 200, steel: 150, electronics: 10 },
    power: -8, factory: true, hangars: 4,
  },
} satisfies Record<string, BaseBuildingDef>;

// 布防：塔和工事直接沿用战斗数值，造价也一样
function defenseFromBattle(id: DefId, icon: string, color: number, desc?: string): BaseBuildingDef {
  const d = DEFS[id] as (typeof DEFS)[DefId] & { cost?: Amounts };
  return {
    name: d.name, icon, ministry: 'defense', size: d.size, color, cost: { ...d.cost },
    desc: desc ?? `基地被进攻时参战。血量 ${d.hp}`, battleDef: id,
  };
}

const fortifications = {
  mgTower: defenseFromBattle('mgTower', '机', 0xf2d16b),
  cannonTower: defenseFromBattle('cannonTower', '炮', 0xff9a3c),
  atTower: defenseFromBattle('atTower', '反', 0xb98cff),
  aaTower: defenseFromBattle('aaTower', '空', 0x3cffd2),
  pillbox: defenseFromBattle('pillbox', '碉', 0x9aa3ab),
  bunker: defenseFromBattle('bunker', '堡', 0x8a939b),
  mortar: defenseFromBattle('mortar', '迫', 0xd98c3c, '远程曲射，砸成群的步兵。射程很远，但打不到 12 格以内'),
  mlrs: defenseFromBattle('mlrs', '箭', 0xe0553c, '每 25 秒一轮 12 发火箭齐射，覆盖一大片。打不到 12 格以内'),
  samSite: defenseFromBattle('samSite', '导', 0x3cb4ff, '射程极远的防空导弹，专打飞机，无视隐身'),
  radar: defenseFromBattle('radar', '达', 0x9ad0ff, '不开火。24 格内己方塔射程 +20%，敌方隐身飞机现形（防空伤害不再减半）'),
  landmine: defenseFromBattle('landmine', '雷', 0x7a6a4a, '敌方看不见、打不到。地面部队踩上去就炸（坦克伤得最重），炸完就没了'),
  barbedWire: defenseFromBattle('barbedWire', '网', 0x8a8a8a, '步兵走过减速一半。不能被直接攻击，只有爆炸能炸掉'),
  tankTrap: defenseFromBattle('tankTrap', '拒', 0x6a6a6a, '坦克过不去，只能绕路（步兵照走）。连成一排能把坦克引到你想要的路线上'),
};

export const BASE_BUILDINGS = { ...civil, ...finance, ...tech, ...defense, ...military, ...fortifications };
export type BaseBuildingId = keyof typeof BASE_BUILDINGS;

export function baseDef(id: BaseBuildingId): BaseBuildingDef {
  return BASE_BUILDINGS[id];
}

// 占地的宽（x 方向）和高（y 方向）。长方形建筑 rot = 0 时长边沿 x，rot = 1 时转 90°、长边沿 y
export function footprint(id: BaseBuildingId, rot = 0): { w: number; h: number } {
  const d = baseDef(id);
  if (!d.rect) return { w: d.size, h: d.size };
  const [a, b] = d.rect;
  return rot ? { w: b, h: a } : { w: a, h: b };
}

// 升级：同一块地上效果翻倍，省出地方布防。等级 n 的产量、原料、耗电、发电、容量、住房、科研、机库都是 1 级的 n 倍。
// 升到 n 级花 n 倍的造价基数；塔、工事、兵营、战车工厂不能升级（机场能升，升级就是扩建机库）
export const MAX_LEVEL = 5;

export function upgradable(id: BaseBuildingId): boolean {
  const d = baseDef(id);
  return !d.battleDef && (!d.factory || !!d.hangars);
}

// 每种建筑最多能建几座，按市政厅等级（1–5 级）取。升级市政厅来提高上限
export const BUILD_LIMITS: Record<Exclude<BaseBuildingId, 'hall'>, number[]> = {
  house: [2, 4, 6, 8, 10],
  market: [1, 2, 3, 4, 5],
  farm: [1, 2, 3, 4, 5],
  powerPlant: [1, 2, 3, 4, 5],
  granary: [1, 1, 2, 2, 3],
  vault: [1, 1, 2, 2, 3],
  stateEnterprise: [1, 1, 2, 2, 3],
  privateEnterprise: [1, 2, 3, 4, 5],
  bank: [1, 1, 1, 1, 1],
  stockExchange: [0, 0, 1, 1, 1],
  lab: [1, 1, 2, 3, 4],
  lumberMill: [1, 2, 2, 3, 4],
  quarry: [1, 2, 2, 3, 4],
  mine: [1, 1, 2, 3, 4],
  oilWell: [1, 1, 2, 3, 4],
  arsenal: [1, 1, 2, 2, 3],
  electronicsPlant: [1, 1, 2, 2, 3],
  warehouse: [1, 2, 2, 3, 4],
  oilDepot: [1, 2, 2, 3, 4],
  ammoDepot: [1, 2, 2, 3, 4],
  barracks: [1, 1, 2, 2, 3],
  tankFactory: [1, 1, 2, 2, 3],
  airfield: [1, 1, 1, 2, 2],
  mgTower: [4, 6, 8, 10, 12],
  cannonTower: [2, 3, 4, 6, 8],
  atTower: [2, 3, 4, 6, 8],
  aaTower: [2, 3, 4, 5, 6],
  pillbox: [2, 3, 4, 5, 6],
  bunker: [1, 2, 3, 4, 5],
  mortar: [2, 3, 4, 5, 6],
  mlrs: [1, 1, 2, 2, 3],
  samSite: [1, 1, 2, 3, 4],
  radar: [1, 1, 1, 2, 2],
  landmine: [6, 10, 14, 18, 24],
  barbedWire: [12, 20, 30, 40, 50],
  tankTrap: [8, 12, 18, 24, 30],
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
  gold: 1500, food: 300, wood: 500, stone: 400,
  steel: 150, fuel: 200, ammo: 60, electronics: 0,
};
export const START_POP = 20;
export const START_TAX = 0.1;
