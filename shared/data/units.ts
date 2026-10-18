import type { ArmorType, DamageType } from './combat';

// 距离单位：战场格子；时间单位：秒。数值来自设计文档初版，后续实测调整。

export interface Weapon {
  dmg: number;
  interval: number;
  range: number;
  minRange?: number;
  type: DamageType;
  splash?: number;
  salvo?: { n: number; spread: number }; // 齐射：一次打出 n 发，散布在目标周围 spread 格内（火箭炮）
  ignoreStealth?: boolean; // 无视隐身（远程防空导弹）
}

// fort = 可驻防的工事；civil = 民用建筑（不开火，只是可以被摧毁的目标）
// fighter / bomber = 飞机：不受地形阻挡，只有防空和重机枪打得到
// trap = 地雷：对方看不见、打不到，有地面部队踩上去就炸，炸完就没了
// obstacle = 障碍（铁丝网、拒马）：不能被直接攻击，只有爆炸能炸掉；不挡建筑，影响部队通行
// support = 辅助建筑（雷达站）：不开火，给周围己方的塔加成
export type UnitKind = 'infantry' | 'tank' | 'fighter' | 'bomber' | 'tower' | 'fort' | 'civil' | 'hq' | 'trap' | 'obstacle' | 'support';

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
  stealth?: boolean; // 隐身：受防空伤害减半
  trigger?: number; // 地雷：敌方地面部队进到这么近（格）就引爆，伤害见 weapons[0]
  slowInfantry?: boolean; // 铁丝网：步兵走过这一格速度减半
  blockTanks?: boolean; // 拒马：坦克过不去（步兵可以）
  aura?: { radius: number; rangeMult: number }; // 雷达：半径内己方塔射程 ×rangeMult，敌方隐身失效（半径不乘 RANGE_SCALE）
}

const coaxMg: Weapon = { dmg: 6, interval: 0.3, range: 4, type: 'bullet' };

// 飞机的武器是航弹：飞到目标正上方才投，interval 就是出击间隔
const bomb = (dmg: number, interval: number, splash: number): Weapon => ({ dmg, interval, range: 0, type: 'bomb', splash });
// 战斗机的第二件武器：空战用的机炮和导弹，只打飞机（伤害类型同防空）
const guns = (dmg: number): Weapon => ({ dmg, interval: 0.6, range: 1, type: 'aa' });

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
    name: '一代坦克 T-55', kind: 'tank', armor: 'armor', hp: 1200, speed: 0.8, radius: 0.45, size: 0,
    weapons: [{ dmg: 100, interval: 3, range: 5, type: 'ap' }, coaxMg],
  },
  tank2: {
    name: '二代坦克 T-72', kind: 'tank', armor: 'armor', hp: 1800, speed: 0.9, radius: 0.45, size: 0,
    weapons: [{ dmg: 140, interval: 2.8, range: 5.5, type: 'ap' }, coaxMg],
  },
  tank3: {
    name: '三代坦克 M1A2', kind: 'tank', armor: 'armor', hp: 2800, speed: 1.0, radius: 0.45, size: 0,
    weapons: [{ dmg: 200, interval: 2.5, range: 6, type: 'ap' }, coaxMg],
  },
  tank4: {
    name: '四代坦克 T-14', kind: 'tank', armor: 'armor', hp: 4000, speed: 1.1, radius: 0.45, size: 0,
    weapons: [{ dmg: 260, interval: 2.2, range: 6.5, type: 'ap' }, coaxMg],
  },
  fighter1: {
    name: '一代战斗机 米格-15', kind: 'fighter', armor: 'air', hp: 300, speed: 5, radius: 0.4, size: 0,
    weapons: [bomb(60, 6, 1), guns(30)],
  },
  fighter2: {
    name: '二代战斗机 米格-21', kind: 'fighter', armor: 'air', hp: 400, speed: 5.5, radius: 0.4, size: 0,
    weapons: [bomb(90, 6, 1), guns(40)],
  },
  fighter3: {
    name: '三代战斗机 F-4', kind: 'fighter', armor: 'air', hp: 550, speed: 6, radius: 0.4, size: 0,
    weapons: [bomb(130, 5, 1.5), guns(55)],
  },
  fighter4: {
    name: '四代战斗机 F-16', kind: 'fighter', armor: 'air', hp: 750, speed: 6.5, radius: 0.4, size: 0,
    weapons: [bomb(180, 5, 1.5), guns(75)],
  },
  fighter5: {
    name: '五代战斗机 F-22', kind: 'fighter', armor: 'air', hp: 900, speed: 7, radius: 0.4, size: 0,
    weapons: [bomb(240, 4, 1.5), guns(100)], stealth: true,
  },
  bomber1: {
    name: '一级轰炸机 轰-6', kind: 'bomber', armor: 'air', hp: 1500, speed: 2.5, radius: 0.6, size: 0,
    weapons: [bomb(800, 30, 2.5)],
  },
  bomber2: {
    name: '二级轰炸机 B-52', kind: 'bomber', armor: 'air', hp: 2200, speed: 2.5, radius: 0.6, size: 0,
    weapons: [bomb(1100, 30, 2.5)],
  },
  bomber3: {
    name: '三级轰炸机 图-160', kind: 'bomber', armor: 'air', hp: 2600, speed: 2.8, radius: 0.6, size: 0,
    weapons: [bomb(1500, 25, 3)],
  },
  bomber4: {
    name: '四级轰炸机 B-2', kind: 'bomber', armor: 'air', hp: 3000, speed: 2.8, radius: 0.6, size: 0,
    weapons: [bomb(2000, 25, 3)], stealth: true,
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
  // 迫击炮：射程远、有近距盲区，曲射砸人堆
  mortar: {
    name: '迫击炮阵地', kind: 'tower', armor: 'building', hp: 1000, speed: 0, radius: 0.5, size: 1,
    weapons: [{ dmg: 60, interval: 4, range: 11, minRange: 3, type: 'he', splash: 2 }],
    cost: { steel: 70, ammo: 50 },
  },
  // 火箭炮：隔很久打一轮 12 发齐射，覆盖一大片
  mlrs: {
    name: '火箭炮', kind: 'tower', armor: 'building', hp: 1200, speed: 0, radius: 0.5, size: 1,
    weapons: [{ dmg: 70, interval: 25, range: 13, minRange: 3, type: 'he', splash: 1.2, salvo: { n: 12, spread: 2.5 } }],
    cost: { steel: 200, ammo: 120, electronics: 20 },
  },
  // 远程防空导弹：射程极远，专打飞机，无视隐身
  samSite: {
    name: '远程防空导弹', kind: 'tower', armor: 'building', hp: 1200, speed: 0, radius: 0.5, size: 1,
    weapons: [{ dmg: 400, interval: 5, range: 16, type: 'aa', ignoreStealth: true }],
    cost: { steel: 180, ammo: 60, electronics: 40 },
  },
  landmine: {
    name: '地雷', kind: 'trap', armor: 'building', hp: 1, speed: 0, radius: 0.3, size: 1,
    weapons: [{ dmg: 400, interval: 1, range: 0, type: 'demo', splash: 1 }], trigger: 0.6,
    cost: { steel: 20, ammo: 30 },
  },
  barbedWire: {
    name: '铁丝网', kind: 'obstacle', armor: 'building', hp: 150, speed: 0, radius: 0.5, size: 1,
    weapons: [], slowInfantry: true,
    cost: { steel: 10 },
  },
  tankTrap: {
    name: '拒马', kind: 'obstacle', armor: 'building', hp: 600, speed: 0, radius: 0.5, size: 1,
    weapons: [], blockTanks: true,
    cost: { steel: 25 },
  },
  radar: {
    name: '雷达站', kind: 'support', armor: 'building', hp: 1500, speed: 0, radius: 1, size: 2,
    weapons: [], aura: { radius: 24, rangeMult: 1.2 },
    cost: { steel: 120, electronics: 30 },
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
  // 敌方基地里的民用建筑（民居、市场、仓库……），战斗中只按大小区分
  civil2: {
    name: '民用建筑', kind: 'civil', armor: 'building', hp: 1000, speed: 0, radius: 1, size: 2,
    weapons: [],
  },
  civil3: {
    name: '民用建筑', kind: 'civil', armor: 'building', hp: 1800, speed: 0, radius: 1.5, size: 3,
    weapons: [],
  },
  // 机场（8×4，占地在生成时给出）：战斗里是一个可以被摧毁的目标，被毁时还没起飞的飞机一起被毁
  airbase: {
    name: '机场', kind: 'civil', armor: 'building', hp: 4000, speed: 0, radius: 2, size: 4,
    weapons: [],
  },
  hq: {
    name: '指挥部', kind: 'hq', armor: 'building', hp: 5000, speed: 0, radius: 1.5, size: 3,
    weapons: [],
  },
} satisfies Record<string, UnitDef>;

export type DefId = keyof typeof DEFS;

// 距离尺度：上面的射程、速度沿用设计文档初版的数（按旧的小格子写的），这里统一乘 RANGE_SCALE，
// 换算成现在的格子。建筑占地、受击半径、溅射范围不变（它们跟单位挤在一起的密度有关）。
export const RANGE_SCALE = 4;
{
  const done = new Set<Weapon>(); // 同轴机枪这类武器对象是几个兵种共用的，只能乘一次
  for (const d of Object.values(DEFS) as UnitDef[]) {
    d.speed *= RANGE_SCALE;
    if (d.rangeBonus) d.rangeBonus *= RANGE_SCALE;
    for (const w of d.weapons) {
      if (done.has(w)) continue;
      done.add(w);
      w.range *= RANGE_SCALE;
      if (w.minRange) w.minRange *= RANGE_SCALE;
    }
  }
}

export function getDef(id: DefId): UnitDef {
  return DEFS[id];
}

export const isAirDef = (d: UnitDef) => d.kind === 'fighter' || d.kind === 'bomber';

// 能出击的兵种（步兵、坦克、飞机），按 DEFS 顺序
export const MOBILE_UNITS = (Object.keys(DEFS) as DefId[]).filter(id => DEFS[id].speed > 0);
