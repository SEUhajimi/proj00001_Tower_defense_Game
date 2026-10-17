import { DEFS, type DefId } from '../../data/units';
import { Battle, type Stance } from '../battle';
import type { AiBase } from './ai';
import { createAiBattle, type AiBattle, type Roster } from './sortie';

// 出击的战斗记录：前端打完把它交给服务器，服务器用同一个种子和同一套模拟重打一遍，
// 结算以服务器的结果为准。战斗是确定性的（固定步长 + 种子随机数），同样的输入一定得到同样的结果。

export interface Placement {
  id: number; // 前端那边的单位编号，指挥记录里用它
  defId: DefId;
  x: number; // 格子坐标
  y: number;
  stance: Stance;
}

// step = 下达命令时战斗已经走了几步（Battle.ticks）
export type Command =
  | { step: number; kind: 'stance'; stance: Stance; ids?: number[] }
  | { step: number; kind: 'move'; ids: number[]; x: number; y: number }
  | { step: number; kind: 'attack'; ids: number[]; targetId: number }
  | { step: number; kind: 'retreat' };

export interface BattleLog {
  placements: Placement[];
  commands: Command[];
}

export const MAX_BATTLE_STEPS = Math.round((20 * 60) / Battle.DT); // 20 分钟还没打完，按撤退算
const MAX_COMMANDS = 5000;

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const ids = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 500 && v.every(Number.isInteger);
const stance = (v: unknown): v is Stance => v === 'hold' || v === 'assault';

// 检查服务器收到的记录格式，不对返回 null
export function parseLog(raw: unknown): BattleLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const { placements, commands } = raw as Record<string, unknown>;
  if (!Array.isArray(placements) || !Array.isArray(commands) || placements.length > 500 || commands.length > MAX_COMMANDS) return null;
  for (const p of placements) {
    if (!p || !Number.isInteger(p.id) || typeof p.defId !== 'string' || !(p.defId in DEFS) || !num(p.x) || !num(p.y) || !stance(p.stance)) return null;
  }
  for (const c of commands) {
    if (!c || !Number.isInteger(c.step) || c.step < 0 || c.step > MAX_BATTLE_STEPS) return null;
    const ok = c.kind === 'retreat'
      || (c.kind === 'stance' && stance(c.stance) && (c.ids === undefined || ids(c.ids)))
      || (c.kind === 'move' && ids(c.ids) && num(c.x) && num(c.y))
      || (c.kind === 'attack' && ids(c.ids) && Number.isInteger(c.targetId));
    if (!ok) return null;
  }
  return { placements, commands } as BattleLog;
}

// 按记录重打一遍。部署不合法（不在投送区、超出带来的兵力）返回原因
export function replaySortie(ai: AiBase, roster: Roster, seed: number, log: BattleLog): AiBattle | string {
  const fight = createAiBattle(ai, roster, seed);
  const { battle, deployment } = fight;
  // 前端编号 → 这边的编号。敌方单位在部署前就生成好了，两边编号一样，不用换
  const idMap = new Map<number, number>();
  for (const p of log.placements) {
    const e = deployment.place(p.defId, Math.floor(p.x), Math.floor(p.y), p.stance);
    if (!e) return '部署不合法';
    idMap.set(p.id, e.id);
  }
  if (!deployment.placed().length) return '没有部署部队';
  const mine = (list: number[]) => list.map(id => idMap.get(id)).filter((id): id is number => id !== undefined);

  const commands = [...log.commands].sort((a, b) => a.step - b.step);
  let k = 0;
  battle.start();
  while (!battle.outcome && battle.ticks < MAX_BATTLE_STEPS) {
    for (; k < commands.length && commands[k].step <= battle.ticks; k++) {
      const c = commands[k];
      if (c.kind === 'stance') battle.setStance('player', c.stance, c.ids && mine(c.ids));
      else if (c.kind === 'move') battle.orderMove(mine(c.ids), c.x, c.y);
      else if (c.kind === 'attack') battle.orderAttack(mine(c.ids), c.targetId);
      else battle.retreat();
    }
    if (battle.outcome) break;
    battle.step();
  }
  if (!battle.outcome) battle.retreat();
  return fight;
}
