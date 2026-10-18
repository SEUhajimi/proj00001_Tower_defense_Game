import type { DefId } from '../../data/units';
import { Battle, type Outcome } from '../battle';
import type { Base, LootResult } from '../base/base';
import { Deployment } from '../deploy';
import { Grid, type Point } from '../grid';
import { Rng } from '../rng';
import { attackable, defenseLeft, generateAiLayout, slotKey, type AiBase } from './ai';

// 出击：战场 = 据点的真实布局（扣掉之前被打掉、还没恢复的）+ 四周 4 格宽的投送区。

export const DROP_RING = 4;

export type Roster = Partial<Record<DefId, number>>;

export interface AiBattle {
  battle: Battle;
  deployment: Deployment;
  hqCenter: Point;
  mapSize: number;
  slots: Map<number, string>; // 敌方单位编号 → 布局里的编号（结算时记下哪些被打掉了）
}

export function createAiBattle(ai: AiBase, roster: Roster, seed: number): AiBattle {
  const layout = generateAiLayout(ai);
  const lost = new Set(ai.lost);
  const o = DROP_RING, mapSize = layout.size + o * 2;
  const grid = new Grid(mapSize, mapSize);
  const battle = new Battle(grid, new Rng(seed));
  const slots = new Map<number, string>();
  let hqCenter: Point = { x: mapSize / 2, y: mapSize / 2 };
  layout.buildings.forEach((b, i) => {
    const fortAlive = !lost.has(slotKey.building(i));
    const e = fortAlive ? battle.spawn(b.defId, 'enemy', b.x + o, b.y + o, 'hold', b.skin) : null;
    if (e) slots.set(e.id, slotKey.building(i));
    if (b.defId === 'hq') hqCenter = { x: b.x + o + 1.5, y: b.y + o + 1.5 };
    b.garrison.forEach((u, k) => {
      if (lost.has(slotKey.garrison(i, k))) return;
      // 工事已经被炸掉的话，驻防步兵就站在废墟上
      const cx = b.x + o + 0.5 + (e ? 0 : k * 0.4), cy = b.y + o + 0.5;
      const unit = battle.spawn(u, 'enemy', cx, cy, 'hold');
      if (e) battle.garrison(unit, e);
      slots.set(unit.id, slotKey.garrison(i, k));
    });
  });
  layout.units.forEach((u, j) => {
    if (lost.has(slotKey.unit(j))) return;
    const e = battle.spawn(u.defId, 'enemy', u.x + o, u.y + o, 'hold');
    slots.set(e.id, slotKey.unit(j));
  });
  const deployment = new Deployment(battle, { roster: { ...roster } }, { x: o, y: o, w: layout.size, h: layout.size });
  return { battle, deployment, hqCenter, mapSize, slots };
}

export function canSortie(base: Base, ai: AiBase, roster: Roster): true | string {
  if (ai.owner !== 'ai') return '这个据点已经是你的了';
  if (!attackable(ai, base.state.ai)) return '没有道路通到这里，先拿下和它相连的据点';
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
  lost: Roster; // 我方阵亡
  wounded: number; // 带伤回来、需要维修的
  returned: number; // 完好回来的（含没上场的）
  defenseBefore: number; // 据点守备值（0–1），打之前和打之后
  defenseAfter: number;
  conquered: boolean; // 这一仗把守备打到 0，据点归玩家
}

// 结算：没上场的原样回来；上场的阵亡就没了，带伤的进维修名单；
// 据点被打掉的守军和防御记下来（不论胜负）；胜利则掠夺；守备打到 0 就征服
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

  const defenseBefore = defenseLeft(ai);
  const killed = new Set(ai.lost);
  for (const e of battle.entities) {
    const key = fight.slots.get(e.id);
    if (key && !e.alive) killed.add(key);
  }
  ai.lost = [...killed];
  ai.lastAttack = now;
  const outcome = battle.outcome ?? 'retreat';
  const loot = outcome === 'victory' ? base.loot(ai, now) : null;
  const defenseAfter = defenseLeft(ai);
  const conquered = defenseAfter <= 0;
  if (conquered) base.conquer(ai);
  return { outcome, loot, lost, wounded, returned, defenseBefore, defenseAfter, conquered };
}
