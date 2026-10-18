import { randomBytes, randomInt } from 'node:crypto';
import { applyAction, parseAction } from '../shared/sim/base/actions';
import { Base, newBaseState, type BaseState } from '../shared/sim/base/base';
import { advanceTo } from '../shared/sim/base/economy';
import { parseSave } from '../shared/sim/base/save';
import type { DefId } from '../shared/data/units';
import { parseLog, replaySortie } from '../shared/sim/world/replay';
import { canSortie, settleSortie, type Roster } from '../shared/sim/world/sortie';
import type { Db } from './db';

// 游戏逻辑的服务器一侧：每个账号一份基地存档，所有会改存档的操作都在这里执行。
// 出击：开始时发种子；结束时前端交上部署和指挥记录，这里重打一遍再结算。

export class Game {
  constructor(private db: Db, private now: () => number = Date.now, readonly dev = false) {}

  // ---------- 存档 ----------

  private load(userId: number): Base | null {
    const row = this.db.prepare('SELECT state FROM bases WHERE user_id = ?').get(userId) as { state: string } | undefined;
    if (!row) return null;
    const state = parseSave(row.state);
    if (typeof state === 'string') throw new Error(`存档损坏：${state}`);
    return new Base(state);
  }

  private store(userId: number, base: Base): void {
    this.db.prepare(`INSERT INTO bases (user_id, state, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`)
      .run(userId, JSON.stringify(base.state), this.now());
  }

  // 读存档并结算到现在（离线生产）；还没有存档返回 null
  getBase(userId: number): { state: BaseState; offline: ReturnType<typeof advanceTo> } | null {
    const base = this.load(userId);
    if (!base) return null;
    const offline = advanceTo(base, this.now());
    this.store(userId, base);
    return { state: base.state, offline };
  }

  // 第一次进游戏：新开局，或者把浏览器里的单机存档搬进来（只能做一次）
  claim(userId: number, local: unknown): { state: BaseState } | string {
    if (this.load(userId)) return '这个账号已经有存档了';
    let state: BaseState;
    if (typeof local === 'string' && local) {
      const parsed = parseSave(local);
      if (typeof parsed === 'string') return parsed;
      state = parsed;
    } else {
      state = newBaseState(randomInt(1, 1e9), this.now());
    }
    const base = new Base(state);
    advanceTo(base, this.now());
    this.store(userId, base);
    return { state: base.state };
  }

  reset(userId: number): { state: BaseState } {
    const base = new Base(newBaseState(randomInt(1, 1e9), this.now()));
    this.store(userId, base);
    this.db.prepare('DELETE FROM sorties WHERE user_id = ?').run(userId);
    return { state: base.state };
  }

  // ---------- 基地操作 ----------

  act(userId: number, raw: unknown): { state: BaseState; error?: string } | string {
    const base = this.load(userId);
    if (!base) return '还没有存档';
    const action = parseAction(raw);
    if (!action) return '操作格式不对';
    advanceTo(base, this.now());
    const r = applyAction(base, action);
    this.store(userId, base);
    // 失败也把最新状态发回去，前端据此纠正
    return r === true ? { state: base.state } : { state: base.state, error: r };
  }

  // 开发调试：快进 n 小时（只在开发模式下开放）
  fastForward(userId: number, hours: unknown): { state: BaseState } | string {
    if (!this.dev) return '只有开发模式可以快进';
    const base = this.load(userId);
    if (!base || typeof hours !== 'number' || hours <= 0 || hours > 48) return '参数不对';
    base.state.lastTick -= hours * 3600_000;
    for (const ai of base.state.ai) ai.lastTick -= hours * 3600_000;
    advanceTo(base, this.now());
    this.store(userId, base);
    return { state: base.state };
  }

  // ---------- 出击 ----------

  startSortie(userId: number, aiId: unknown, rawRoster: unknown): { sortieId: string; seed: number } | string {
    const base = this.load(userId);
    if (!base) return '还没有存档';
    const ai = Number.isInteger(aiId) ? base.getAi(aiId as number) : undefined;
    if (!ai) return '没有这个据点';
    const roster = parseRoster(rawRoster);
    if (!roster) return '部队格式不对';
    advanceTo(base, this.now());
    const ok = canSortie(base, ai, roster);
    if (ok !== true) return ok;
    const sortieId = randomBytes(12).toString('hex'), seed = randomInt(1, 1e9);
    // 每个账号同时只有一场出击，新的覆盖旧的（关掉页面没打完的就作废）
    this.db.prepare(`INSERT INTO sorties (user_id, id, ai_id, roster, seed, started_at, status, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', NULL)
      ON CONFLICT(user_id) DO UPDATE SET id = excluded.id, ai_id = excluded.ai_id, roster = excluded.roster,
        seed = excluded.seed, started_at = excluded.started_at, status = 'open', finished_at = NULL`)
      .run(userId, sortieId, ai.id, JSON.stringify(roster), seed, this.now());
    return { sortieId, seed };
  }

  finishSortie(userId: number, sortieId: unknown, rawLog: unknown) {
    const row = this.db.prepare('SELECT id, ai_id, roster, seed, status FROM sorties WHERE user_id = ?').get(userId) as
      { id: string; ai_id: number; roster: string; seed: number; status: string } | undefined;
    if (!row || row.id !== sortieId || row.status !== 'open') return '这场出击已经结算过或不存在';
    const log = parseLog(rawLog);
    if (!log) return '战斗记录格式不对';
    const base = this.load(userId);
    const ai = base?.getAi(row.ai_id);
    if (!base || !ai) return '这个据点已经不在了';
    const roster = JSON.parse(row.roster) as Roster;
    advanceTo(base, this.now());
    // 开战前再查一次兵力：开始出击后又去拆兵、修兵就不行了
    const ok = canSortie(base, ai, roster);
    if (ok !== true) return ok;
    const fight = replaySortie(ai, roster, row.seed, log);
    if (typeof fight === 'string') return fight;
    const report = settleSortie(base, ai, fight, roster, this.now());
    this.store(userId, base);
    this.db.prepare(`UPDATE sorties SET status = ?, finished_at = ? WHERE user_id = ?`)
      .run(report.outcome === 'victory' ? 'won' : 'done', this.now(), userId);
    return { report, state: base.state };
  }
}

function parseRoster(raw: unknown): Roster | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Roster = {};
  for (const [id, n] of Object.entries(raw)) {
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > 1000) return null;
    if ((n as number) > 0) out[id as DefId] = n as number;
  }
  return out;
}
