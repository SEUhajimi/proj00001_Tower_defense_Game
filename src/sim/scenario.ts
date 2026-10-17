import type { DefId } from '../data/units';
import { Battle } from './battle';
import { Deployment, type Loadout } from './deploy';
import { Grid, type Point } from './grid';
import { Rng } from './rng';

// 阶段 1 的固定战斗。战场就是被攻击方的基地：24×24 格（6×6 地块），
// 建筑集中在中间，外圈是基地里还没建东西的空地，进攻方在空地上投送兵力。
// 部队可以直接穿过建筑，只有岩石挡路。敌方驻军只守基地，不会反扑。
// 阶段 3 会改为读取 AI 基地的真实布局。

export const MAP_W = 24;
export const MAP_H = 24;

// 建筑区，岩石不会生成在这里
const BUILT_AREA = { x0: 5, y0: 4, x1: 20, y1: 18 };

export const ENEMY_BUILDINGS: [DefId, number, number][] = [
  ['hq', 11, 10],
  ['mgTower', 8, 8], ['mgTower', 16, 8], ['mgTower', 8, 14], ['mgTower', 16, 14], ['mgTower', 12, 6], ['mgTower', 12, 16],
  ['atTower', 9, 11], ['atTower', 15, 11],
  ['cannonTower', 13, 8], ['cannonTower', 11, 14],
  ['pillbox', 6, 11], ['bunker', 18, 10],
];

// 工事里的驻军：[工事左上角 x, y, 驻防的步兵]
const ENEMY_FORT_GARRISON: [number, number, DefId[]][] = [
  [6, 11, ['rifle', 'rifle']],
  [18, 10, ['mg', 'rifle', 'rifle', 'smg']],
];

const ENEMY_GARRISON: [DefId, number, number][] = [
  ['rifle', 10.5, 9.5], ['rifle', 14.5, 9.5], ['rifle', 10.5, 13.5], ['rifle', 14.5, 13.5],
  ['rifle', 12.5, 8.5], ['rifle', 12.5, 14.5],
  ['mg', 9.5, 9.5], ['mg', 15.5, 13.5],
  ['sniper', 12.5, 7.5],
  ['smg', 8.5, 12.5], ['smg', 16.5, 10.5],
  ['tank1', 10.5, 15.5], ['tank1', 14.5, 7.5],
];

export const PROTOTYPE_LOADOUT: Loadout = {
  roster: { rifle: 8, smg: 4, mg: 3, sniper: 2, sapper: 8, tank1: 2, tank2: 5 },
  budget: { steel: 300, ammo: 150 },
  buildings: ['mgTower', 'cannonTower', 'atTower', 'pillbox', 'bunker'],
};

export const ENEMY_HQ_CENTER: Point = { x: 12.5, y: 11.5 };

export interface Scenario {
  battle: Battle;
  deployment: Deployment;
}

export function createPrototypeBattle(seed: number, loadout: Loadout = PROTOTYPE_LOADOUT): Scenario {
  const rng = new Rng(seed);
  const grid = new Grid(MAP_W, MAP_H);
  scatterRocks(grid, rng);

  const battle = new Battle(grid, rng);
  for (const [id, x, y] of ENEMY_BUILDINGS) battle.spawn(id, 'enemy', x, y);
  for (const [id, x, y] of ENEMY_GARRISON) battle.spawn(id, 'enemy', x, y, 'hold');
  for (const [fx, fy, units] of ENEMY_FORT_GARRISON) {
    const fort = battle.get(grid.occupant[grid.idx(fx, fy)])!;
    for (const id of units) battle.garrison(battle.spawn(id, 'enemy', fort.x, fort.y, 'hold'), fort);
  }

  return { battle, deployment: new Deployment(battle, loadout) };
}

function scatterRocks(grid: Grid, rng: Rng): void {
  const inBuilt = (x: number, y: number) =>
    x >= BUILT_AREA.x0 && x <= BUILT_AREA.x1 && y >= BUILT_AREA.y0 && y <= BUILT_AREA.y1;
  for (let c = 0; c < 6; c++) {
    let x = rng.int(1, MAP_W - 2), y = rng.int(1, MAP_H - 2);
    const len = rng.int(2, 4);
    for (let k = 0; k < len; k++) {
      if (!inBuilt(x, y)) grid.setRock(x, y);
      x += rng.int(-1, 1);
      y += rng.int(-1, 1);
    }
  }
}
