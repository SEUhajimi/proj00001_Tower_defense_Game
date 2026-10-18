import { baseDef, footprint, type BaseBuildingId } from '../../data/economy';
import { DEFS, type DefId } from '../../data/units';
import { Battle, SCRAMBLE_GAP, type Entity } from '../battle';
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

// 基地建筑在战斗里是什么：塔和工事照原样，市政厅是指挥部，机场是机场，其余是民用建筑
function battleDefOf(id: BaseBuildingId): DefId {
  if (id === 'hall') return 'hq';
  if (id === 'airfield') return 'airbase';
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
  const fields = new Map<number, Entity>(); // 机场 uid → 战斗里的机场
  for (const b of st.buildings) {
    const defId = battleDefOf(b.defId);
    // 建筑的画面按等级不同（机场还分朝向），记在 skin 里，只影响画面
    const skin = b.defId === 'airfield' ? `airfield-r${b.rot ?? 0}-l${b.level ?? 1}`
      : DEFS[defId].kind === 'civil' || defId === 'hq' ? `${b.defId}-l${b.level ?? 1}` : null;
    const e = battle.spawn(defId, 'player', b.x + ox, b.y + oy, 'hold', skin, footprint(b.defId, b.rot ?? 0));
    if (defId === 'hq') hqCenter = { x: e.x, y: e.y };
    if (DEFS[defId].kind === 'fort') forts.push(e);
    if (b.defId === 'airfield') fields.set(b.uid, e);
  }

  // 部队：站在基地里摆好的位置驻守；站在工事上的步兵进驻（满了就站在旁边）。
  // 飞机停在机场机位上：开战后战斗机按顺序滑行、从跑道紧急升空迎敌，轰炸机留在机库
  const queued = new Map<number, number>(); // 机场 uid → 已经排了几架起飞
  for (const t of troopLayout(base)) {
    if (t.plane) {
      const field = t.airfield === undefined ? undefined : fields.get(t.airfield);
      if (!field || !t.route) continue;
      const plane = battle.spawn(t.defId, 'player', t.x + ox, t.y + oy, 'hold');
      plane.facing = t.facing ?? 0;
      const route = t.route.map(p => ({ x: p.x + ox, y: p.y + oy }));
      let at: number | null = null;
      if (DEFS[t.defId].kind === 'fighter') {
        const k = queued.get(t.airfield!) ?? 0;
        queued.set(t.airfield!, k + 1);
        at = 1 + k * SCRAMBLE_GAP;
      }
      battle.park(plane, field, route, at);
      continue;
    }
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
