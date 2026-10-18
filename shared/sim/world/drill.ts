import { baseDef, type BaseBuildingId } from '../../data/economy';
import { DEFS, type DefId } from '../../data/units';
import { Battle, type Entity } from '../battle';
import type { Base } from '../base/base';
import { troopLayout } from '../base/troops';
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

  // 部队：站在基地里摆好的位置驻守；站在工事上的步兵进驻（满了就站在旁边）；飞机只参与进攻，不守家
  for (const t of troopLayout(base)) {
    if (t.plane) continue;
    const x = t.x + ox, y = t.y + oy;
    const fort = DEFS[t.defId].kind === 'infantry'
      ? forts.find(f => x >= f.tileX && x < f.tileX + f.def.size && y >= f.tileY && y < f.tileY + f.def.size && f.garrison.length < (f.def.capacity ?? 0))
      : undefined;
    const unit = battle.spawn(t.defId, 'player', x, y, 'hold');
    if (fort) battle.garrison(unit, fort);
  }

  const deployment = new Deployment(battle, { roster: { ...attackers } }, { x: DROP_RING, y: DROP_RING, w, h }, 'enemy');
  autoDeploy(deployment, hqCenter, 'assault');
  return { battle, deployment, hqCenter, mapW, mapH };
}
