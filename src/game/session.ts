import { applyAction, type BaseAction } from '../../shared/sim/base/actions';
import { Base, type BaseState } from '../../shared/sim/base/base';
import type { ResourceMap } from '../../shared/sim/base/economy';
import { exportSave, parseSave } from '../../shared/sim/base/save';
import type { BattleLog } from '../../shared/sim/world/replay';
import type { Roster, SortieReport } from '../../shared/sim/world/sortie';
import { api } from './api';

// 当前账号的基地。存档在服务器上：进游戏时读一次，之后每个操作先在本地执行（画面立刻有反应），
// 同时发给服务器，服务器的结果回来后以它为准。基地场景和战斗场景共用这一份。

export interface Session {
  base: Base;
  offline: { hours: number; gained: ResourceMap } | null; // 离线收益，进游戏后显示一次
  notice: string | null; // 要提示玩家的事
}

let current: Session | null = null;

export function session(): Session {
  if (!current) throw new Error('还没有读档');
  return current;
}

// 服务器的结果回来后通知场景刷新；error 是服务器拒绝操作的原因
type Listener = (error: string | null) => void;
const listeners = new Set<Listener>();

export function onSync(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function adopt(state: BaseState, error: string | null): void {
  session().base.adopt(state);
  for (const fn of listeners) fn(error);
}

// 进游戏时读档；这个账号还没有存档时新开局，浏览器里有单机存档的话问一下要不要搬进来
const LOCAL_KEY = 'baseguard.base.v2';

export async function loadSession(): Promise<string | null> {
  const r = await api<{ state: BaseState | null; offline?: Session['offline'] }>('base');
  if (typeof r === 'string') return r;
  if (r.state) {
    current = { base: new Base(r.state), offline: r.offline ?? null, notice: null };
    return null;
  }
  let local: string | null = null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw && typeof parseSave(raw) !== 'string') local = raw;
  } catch {
    // 拿不到本地存储就当没有
  }
  const migrate = local !== null && confirm('这个浏览器里有以前的单机存档。要把它搬进这个账号吗？\n\n确定：搬进来接着玩\n取消：这个账号新开局');
  const c = await api<{ state: BaseState }>('base/claim', migrate ? { local } : {});
  if (typeof c === 'string') return c;
  if (migrate) {
    // 搬过的单机存档改个名留着，不会再被搬进别的账号
    try {
      localStorage.setItem(`${LOCAL_KEY}.migrated`, local!);
      localStorage.removeItem(LOCAL_KEY);
      localStorage.removeItem(`${LOCAL_KEY}.bak`);
    } catch {
      // 同上
    }
  }
  current = { base: new Base(c.state), offline: null, notice: migrate ? '单机存档已搬进这个账号' : null };
  return null;
}

// 基地操作：本地先执行，返回本地的结果；服务器结果回来后以服务器为准。
// 连续几个操作时只采用最后一个回来的状态，免得前面的旧状态盖掉后面的操作
let pending = 0;

export function act(action: BaseAction): true | string {
  const local = applyAction(session().base, action);
  if (local !== true) return local;
  pending++;
  void api<{ state: BaseState; error?: string }>('base/action', { action }).then(r => {
    pending--;
    if (typeof r === 'string') { for (const fn of listeners) fn(`操作没有保存：${r}`); return; }
    if (r.error || pending === 0) adopt(r.state, r.error ?? null);
  });
  return true;
}

// 重新从服务器读档（断线重连后），本地没保存上的操作作废
export async function resync(): Promise<string | null> {
  const r = await api<{ state: BaseState | null }>('base');
  if (typeof r === 'string') return r;
  if (!r.state || r.state.seed !== session().base.state.seed) {
    location.reload(); // 存档换了（比如在别处重新开局），整页重新加载最省事
    return null;
  }
  adopt(r.state, null);
  return null;
}

export async function resetBase(): Promise<string | null> {
  const r = await api<{ state: BaseState }>('base/reset', {});
  if (typeof r === 'string') return r;
  current = { base: new Base(r.state), offline: null, notice: '已重新开局' };
  return null;
}

export async function fastForward(hours: number): Promise<string | null> {
  const r = await api<{ state: BaseState }>('base/fastForward', { hours });
  if (typeof r === 'string') return r;
  adopt(r.state, null);
  return null;
}

// ---------- 出击 ----------

export async function startSortie(aiId: number, roster: Roster): Promise<{ sortieId: string; seed: number } | string> {
  return api('sortie/start', { aiId, roster });
}

export async function finishSortie(sortieId: string, log: BattleLog): Promise<SortieReport | string> {
  const r = await api<{ report: SortieReport; state: BaseState }>('sortie/finish', { sortieId, log });
  if (typeof r === 'string') return r;
  adopt(r.state, null);
  return r.report;
}

// 导出成文件下载（备份用；导入已取消，存档以服务器为准）
export function downloadSave(): void {
  const blob = new Blob([exportSave(session().base)], { type: 'application/json' });
  const d = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  const name = `基地守卫存档-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
