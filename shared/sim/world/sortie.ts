import type { DefId } from '../../data/units';
import { Battle, type Outcome } from '../battle';
import type { Base, LootResult } from '../base/base';
import { Deployment } from '../deploy';
import { Grid, type Point } from '../grid';
import { Rng } from '../rng';
import { generateAiLayout, isProtected, type AiBase } from './ai';

// 出击：战场 = AI 基地的真实布局 + 四周 4 格宽的投送区。

export const DROP_RING = 4;

export type Roster = Partial<Record<DefId, number>>;

export interface AiBattle {
  battle: Battle;
  deployment: Deployment;
  hqCenter: Point;
  mapSize: number;
}

export function createAiBattle(ai: AiBase, roster: Roster, seed: number): AiBattle {
  const layout = generateAiLayout(ai);
  const o = DROP_RING, mapSize = layout.size + o * 2;
  const grid = new Grid(mapSize, mapSize);
  const battle = new Battle(grid, new Rng(seed));
  let hqCenter: Point = { x: mapSize / 2, y: mapSize / 2 };
  for (const b of layout.buildings) {
    const e = battle.spawn(b.defId, 'enemy', b.x + o, b.y + o, 'hold', b.skin);
    if (b.defId === 'hq') hqCenter = { x: e.x, y: e.y };
    for (const u of b.garrison) battle.garrison(battle.spawn(u, 'enemy', e.x, e.y, 'hold'), e);
  }
  for (const u of layout.units) battle.spawn(u.defId, 'enemy', u.x + o, u.y + o, 'hold');
  const deployment = new Deployment(battle, { roster: { ...roster } }, { x: o, y: o, w: layout.size, h: layout.size });
  return { battle, deployment, hqCenter, mapSize };
}

export function canSortie(base: Base, ai: AiBase, roster: Roster, now: number): true | string {
  if (isProtected(ai, now)) {
    const h = Math.ceil((ai.protectedUntil - now) / 3600_000);
    return `对方处于免战保护，还剩约 ${h} 小时`;
  }
  if (base.hungry()) return '粮食耗尽，部队无法出击';
  let total = 0;
  for (const [id, n] of Object.entries(roster) as [DefId, number][]) {
    if (n > (base.state.army[id] ?? 0)) return '选择的部队超过现有兵力';
    total += n;
  }
  return total > 0 ? true : '没有选择部队';
}

export interface SortieReport {
  outcome: Outcome;
  loot: LootResult | null;
  lost: Roster; // 阵亡
  wounded: number; // 带伤回来、需要维修的
  returned: number; // 完好回来的（含没上场的）
}

// 结算：没上场的原样回来；上场的阵亡就没了，带伤的进维修名单；胜利则掠夺
export function settleSortie(base: Base, ai: AiBase, fight: AiBattle, sent: Roster, now: number): SortieReport {
  const { battle, deployment } = fight;
  const army = base.state.army;
  for (const [id, n] of Object.entries(sent) as [DefId, number][]) army[id] = Math.max(0, (army[id] ?? 0) - n);

  let returned = 0, wounded = 0;
  const lost: Roster = {};
  for (const [id, n] of Object.entries(deployment.roster) as [DefId, number][]) {
    if (n > 0) { army[id] = (army[id] ?? 0) + n; returned += n; }
  }
  for (const e of deployment.placed()) {
    if (!e.alive) {
      lost[e.defId] = (lost[e.defId] ?? 0) + 1;
    } else if (e.hp < e.def.hp) {
      base.state.wounded.push({ defId: e.defId, hp: e.hp / e.def.hp });
      wounded++;
    } else {
      army[e.defId] = (army[e.defId] ?? 0) + 1;
      returned++;
    }
  }
  const outcome = battle.outcome ?? 'retreat';
  const loot = outcome === 'victory' ? base.loot(ai, now) : null;
  return { outcome, loot, lost, wounded, returned };
}
