import { baseDef, type BaseBuildingId } from '../../data/economy';
import { DEFS, isAirDef, type DefId } from '../../data/units';
import { Battle, type Entity } from '../battle';
import type { Base } from '../base/base';
import { PLOT_SIZE, REGION_PLOTS } from '../base/terrain';
import { autoDeploy, Deployment } from '../deploy';
import { Grid, type Point } from '../grid';
import { Rng } from '../rng';
import { DROP_RING, type Roster } from './sortie';

// 演习：在自己基地里模拟一场被进攻的战斗，检验布防。
// 战场 = 领地外接矩形 + 四周投送区；防守方是玩家的建筑、工事和部队，进攻方由电脑指挥。
// 战斗用的是基地的一份拷贝，打完什么都不会改变。

export const DRILL_TIME_LIMIT = 300; // 秒；进攻方超时算防守成功

export interface DrillBattle {
  battle: Battle;
  deployment: Deployment; // 进攻方（enemy）的部署
  hqCenter: Point;
  mapW: number;
  mapH: number;
}

// 基地建筑在战斗里是什么：塔和工事照原样，市政厅是指挥部，其余是民用建筑
function battleDefOf(id: BaseBuildingId): DefId {
  if (id === 'hall') return 'hq';
  if (id in DEFS) return id as DefId;
  return baseDef(id).size >= 3 ? 'civil3' : 'civil2';
}

export function createDrill(base: Base, attackers: Roster, seed: number): DrillBattle {
  const st = base.state;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of st.owned) {
    const px = p % REGION_PLOTS, py = Math.floor(p / REGION_PLOTS);
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  const w = (x1 - x0 + 1) * PLOT_SIZE, h = (y1 - y0 + 1) * PLOT_SIZE;
  const mapW = w + DROP_RING * 2, mapH = h + DROP_RING * 2;
  // 世界格子坐标 → 战场坐标
  const ox = DROP_RING - x0 * PLOT_SIZE, oy = DROP_RING - y0 * PLOT_SIZE;

  const battle = new Battle(new Grid(mapW, mapH), new Rng(seed));
  battle.attacker = 'enemy';
  battle.timeLimit = DRILL_TIME_LIMIT;

  let hqCenter: Point = { x: mapW / 2, y: mapH / 2 };
  const forts: Entity[] = [];
  for (const b of st.buildings) {
    const defId = battleDefOf(b.defId);
    const skin = DEFS[defId].kind === 'civil' || defId === 'hq' ? b.defId : null;
    const e = battle.spawn(defId, 'player', b.x + ox, b.y + oy, 'hold', skin);
    if (defId === 'hq') hqCenter = { x: e.x, y: e.y };
    if (DEFS[defId].kind === 'fort') forts.push(e);
  }

  // 部队：步兵先进工事，其余在市政厅周围驻守；飞机只参与进攻，不守家
  const troops: DefId[] = [];
  for (const [id, n] of Object.entries(st.army) as [DefId, number][]) {
    if (!isAirDef(DEFS[id])) for (let k = 0; k < n; k++) troops.push(id);
  }
  troops.sort((a, b) => Number(DEFS[a].kind !== 'infantry') - Number(DEFS[b].kind !== 'infantry'));
  const spots = spotsAround(battle, hqCenter);
  for (const id of troops) {
    const fort = DEFS[id].kind === 'infantry'
      ? forts.find(f => f.garrison.length < (f.def.capacity ?? 0))
      : undefined;
    if (fort) {
      battle.garrison(battle.spawn(id, 'player', fort.x, fort.y, 'hold'), fort);
      continue;
    }
    const p = spots.shift();
    if (p) battle.spawn(id, 'player', p.x, p.y, 'hold');
  }

  const deployment = new Deployment(battle, { roster: { ...attackers } }, { x: DROP_RING, y: DROP_RING, w, h }, 'enemy');
  autoDeploy(deployment, hqCenter, 'assault');
  return { battle, deployment, hqCenter, mapW, mapH };
}

// 市政厅周围由近到远的空地（不压建筑），给守家的部队站
function spotsAround(battle: Battle, c: Point): Point[] {
  const g = battle.grid, out: (Point & { d: number })[] = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!g.isWalkable(x, y) || g.occupant[g.idx(x, y)] !== -1) continue;
      if (x < DROP_RING || y < DROP_RING || x >= g.w - DROP_RING || y >= g.h - DROP_RING) continue;
      out.push({ x: x + 0.5, y: y + 0.5, d: Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}
