'use strict';
// ============================================================
//  基地守卫 —— 全部数值配置（平衡性调整只需改这里）
// ============================================================

const TILE = 40, COLS = 24, ROWS = 15;
const DAY_SECONDS = 2;          // 游戏内“一天”的实际秒数，经济结算周期
const MAX_WAVES = 20;           // 坚持到第 20 波即胜利
const FIRST_BUILD_PHASE = 45;   // 开局备战时间（秒）
const BUILD_PHASE = 25;         // 每波之间的备战时间（秒）
const TAX_PER_CAPITA = 2;     // 每位市民每天的应税收入
const MIN_CIVILIANS = 5;        // 征兵后至少保留的市民数

// 敌军地面路线（格子坐标），从左侧进入，终点为市政厅门口
const PATH_WAYPOINTS = [[-1, 2], [5, 2], [5, 11], [11, 11], [11, 3], [16, 3], [16, 11], [19, 11], [19, 7], [20, 7]];
const AIR_START = [-1, 7];      // 空军出发点，直线飞向市政厅

const HALL = { c: 21, r: 6, w: 2, h: 2, maxHp: 100, popCap: 40, power: 5, rp: 1 };

const START = { gold: 500, pop: 30, supplies: 60, taxRate: 0.2, researchBudget: 0, defenseLine: 0.3 };

// 部门：tech 科技部 / finance 财政部 / civil 民政部 / defense 国防部
const BUILDINGS = {
  house:   { name: '民居',     icon: '民', ministry: 'civil',   cost: 100, upkeep: 1, power: -1, color: '#c9a36b', desc: '人口上限 +10' },
  market:  { name: '市场',     icon: '市', ministry: 'civil',   cost: 150, upkeep: 1, power: -1, color: '#d9b33a', desc: '税收 +10%，每日营业额 +3' },
  plant:   { name: '发电厂',   icon: '电', ministry: 'civil',   cost: 200, upkeep: 2, power: 8,  color: '#4f9fd6', desc: '电力 +8' },
  park:    { name: '公园',     icon: '园', ministry: 'civil',   cost: 120, upkeep: 1, power: 0,  color: '#4fae55', desc: '幸福度 +6' },
  lab:     { name: '研究所',   icon: '研', ministry: 'tech',    cost: 180, upkeep: 3, power: -2, color: '#9a72e0', desc: '科研 +2/日' },
  factory: { name: '军工厂',   icon: '工', ministry: 'defense', cost: 220, upkeep: 3, power: -2, color: '#8b8f96', desc: '军需 +4/日' },
  depot:   { name: '军需仓库', icon: '仓', ministry: 'defense', cost: 120, upkeep: 1, power: 0,  color: '#8a6a4a', desc: '军需上限 +150' },
};

// 防御塔：由科技部研发解锁（tech），国防部负责建造
const TOWERS = {
  mg:     { name: '机枪塔',     cost: 80,  supplies: 10, upkeep: 1, power: 0,  range: 3,   dmg: 7,  cd: 0.25, air: true,  ground: true,  color: '#4aa3ff', tech: null,     desc: '射速快，可对空' },
  cannon: { name: '加农炮塔',   cost: 180, supplies: 30, upkeep: 2, power: 0,  range: 3.5, dmg: 55, cd: 1.6,  splash: 0.9, air: false, ground: true, color: '#ff9a3c', tech: 'cannon', desc: '范围伤害，克制步兵群' },
  sam:    { name: '防空导弹塔', cost: 200, supplies: 40, upkeep: 2, power: -1, range: 5.5, dmg: 90, cd: 1.3,  air: true,  ground: false, color: '#3cffd2', tech: 'sam',    desc: '远程，仅对空' },
  laser:  { name: '激光塔',     cost: 400, supplies: 60, upkeep: 4, power: -4, range: 4,   dps: 110,          air: true,  ground: true,  color: '#ff4cf0', tech: 'laser',  desc: '持续照射，无视护甲，耗电大' },
};

// 兵种：由科技部研发解锁，国防部征兵（消耗人口 + 资金 + 军需）
const UNITS = {
  infantry: { name: '步兵',     gold: 30,  supplies: 5,  pop: 1, upkeep: 1, hp: 80,  armor: 0, dmg: 9,  cd: 0.8, range: 1.6, speed: 1.3, air: false, hitsAir: false, hitsGround: true, r: 5,  tech: null,      desc: '廉价的阻挡单位' },
  elite:    { name: '高级步兵', gold: 60,  supplies: 10, pop: 1, upkeep: 2, hp: 160, armor: 1, dmg: 16, cd: 0.6, range: 2.6, speed: 1.3, air: false, hitsAir: true,  hitsGround: true, r: 6,  tech: 'elite',   desc: '配备火箭筒，可对空' },
  tank:     { name: '坦克',     gold: 200, supplies: 40, pop: 3, upkeep: 5, hp: 800, armor: 6, dmg: 70, cd: 1.8, range: 3,   speed: 0.9, air: false, hitsAir: false, hitsGround: true, r: 10, tech: 'tank', splash: 0.8, desc: '高护甲，炮击溅射' },
  fighter:  { name: '战斗机',   gold: 250, supplies: 50, pop: 2, upkeep: 6, hp: 300, armor: 2, dmg: 35, cd: 0.7, range: 3,   speed: 3,   air: true,  hitsAir: true,  hitsGround: true, r: 9,  tech: 'fighter', desc: '自由巡航拦截，不阻挡地面' },
};

// 敌军。atk：每次攻击伤害（每秒一次）；dmgHall：冲进市政厅造成的损伤
const ENEMIES = {
  militia: { name: '民兵',         hp: 45,   armor: 0,  speed: 1.1,  atk: 6,  atkRange: 0.8, reward: 6,   dmgHall: 2,  r: 6,  color: '#e05a5a' },
  assault: { name: '突击兵',       hp: 100,  armor: 1,  speed: 1.0,  atk: 10, atkRange: 1.8, reward: 10,  dmgHall: 3,  r: 7,  color: '#ff7a3c' },
  apc:     { name: '装甲车',       hp: 260,  armor: 4,  speed: 1.5,  atk: 14, atkRange: 2,   reward: 20,  dmgHall: 5,  r: 9,  color: '#c0503a' },
  tank:    { name: '敌方坦克',     hp: 650,  armor: 8,  speed: 0.7,  atk: 35, atkRange: 2.5, reward: 40,  dmgHall: 10, r: 11, color: '#a03030' },
  heli:    { name: '武装直升机',   hp: 220,  armor: 2,  speed: 1.6,  atk: 18, atkRange: 2.2, reward: 30,  dmgHall: 6,  r: 9,  color: '#e0a040', air: true },
  boss:    { name: '重型攻城坦克', hp: 5000, armor: 12, speed: 0.45, atk: 80, atkRange: 3,   reward: 300, dmgHall: 40, r: 16, color: '#6a1010' },
};

// 科技树。group 仅用于界面分组
const TECHS = [
  { id: 'elite',    group: '兵种',   name: '高级步兵',   rp: 30,  req: [],               desc: '解锁高级步兵（可对空）' },
  { id: 'tank',     group: '兵种',   name: '主战坦克',   rp: 60,  req: ['elite'],        desc: '解锁坦克' },
  { id: 'fighter',  group: '兵种',   name: '战斗机',     rp: 90,  req: ['tank', 'sam'],  desc: '解锁战斗机' },
  { id: 'cannon',   group: '防御塔', name: '加农炮塔',   rp: 25,  req: [],               desc: '解锁加农炮塔' },
  { id: 'sam',      group: '防御塔', name: '防空导弹塔', rp: 40,  req: [],               desc: '解锁防空导弹塔' },
  { id: 'laser',    group: '防御塔', name: '激光塔',     rp: 120, req: ['cannon', 'sam'], desc: '解锁激光塔' },
  { id: 'fort1',    group: '军事强化', name: '强化工事 I',  rp: 40,  req: [],        desc: '防御塔伤害 +20%' },
  { id: 'fort2',    group: '军事强化', name: '强化工事 II', rp: 80,  req: ['fort1'], desc: '防御塔伤害再 +20%' },
  { id: 'fort3',    group: '军事强化', name: '强化工事 III', rp: 140, req: ['fort2'], desc: '防御塔伤害再 +20%' },
  { id: 'gear1',    group: '军事强化', name: '精良装备 I',  rp: 50,  req: [],        desc: '新征部队生命、伤害 +20%' },
  { id: 'gear2',    group: '军事强化', name: '精良装备 II', rp: 110, req: ['gear1'], desc: '新征部队生命、伤害再 +20%' },
  { id: 'tax',      group: '民生',   name: '现代税制',   rp: 35,  req: [],               desc: '税收 +15%' },
  { id: 'grid',     group: '民生',   name: '智能电网',   rp: 45,  req: [],               desc: '发电量 +25%' },
  { id: 'industry', group: '民生',   name: '流水线生产', rp: 55,  req: [],               desc: '军需产量 +50%' },
];

const BOND = { amount: 400, payment: 12, days: 50, maxActive: 3 };
