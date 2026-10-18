import { aiRates, LOOT_SHARE, RECOVER_HOURS, strongholdName, TRIBUTE_POP_PER_LEVEL, TRIBUTE_SHARE } from '../../shared/data/ai';
import { RESOURCE_NAME, RESOURCES, type ResourceId } from '../../shared/data/economy';
import { DEFS, type DefId } from '../../shared/data/units';
import { aiCapacity, attackable, defenseLeft, type AiBase } from '../../shared/sim/world/ai';
import type { Roster } from '../../shared/sim/world/sortie';
import type { WorldScene } from '../game/WorldScene';

// 世界地图界面，盖在画面上（和基地界面同样的布局）：
//   左上角  征服进度、附属据点每小时上交多少、可出击的部队
//   右下角  返回基地；选中据点时在上方弹出它的守备、仓库、编组出击（附属据点则显示上交多少）

export class WorldHud {
  private root: HTMLDivElement;
  private timer: number;
  private readonly onClick = (ev: Event) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!btn || btn.disabled) return;
    if (btn.dataset.act === 'sortie') this.scene.startSortie(this.readRoster());
    if (btn.dataset.act === 'home') this.scene.scene.start('base');
    if (btn.dataset.act === 'close') { this.scene.selectedAi = null; this.render(); }
  };

  constructor(private scene: WorldScene) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    document.getElementById('game')!.appendChild(this.root);
    this.root.addEventListener('click', this.onClick);
    this.timer = window.setInterval(() => this.refresh(), 500);
    this.render();
  }

  destroy(): void {
    window.clearInterval(this.timer);
    this.root.remove();
  }

  render(): void {
    const b = this.scene.base, all = b.state.ai;
    const vassals = b.vassals();
    const army = (Object.entries(b.state.army) as [DefId, number][]).filter(([, n]) => n > 0);
    const armyText = army.length ? army.map(([id, n]) => `${DEFS[id].name} ${n}`).join('、') : '没有部队';
    const ai = this.scene.selectedAiBase();
    const panel = ai ? `<section class="panel"><header><h2>${strongholdName(ai.id)} · ${ai.level} 级据点</h2>${btn('close', '', '×', 'x')}</header>
      <div class="body">${ai.owner === 'player' ? this.vassalHtml(ai) : this.enemyHtml(ai, attackable(ai, all))}</div></section>` : '';
    this.root.innerHTML = `
      <div class="topbar summary">
        <div class="title">世界地图　<span>已征服 <b>${vassals.length} / ${all.length}</b></span></div>
        ${vassals.length ? `<div>每小时上交：${tributeText(vassals)}</div>` : ''}
        <div>可出击：${armyText}${b.state.wounded.length ? `<small>（另有 ${b.state.wounded.length} 名伤员待维修）</small>` : ''}</div>
      </div>
      <div class="toast" data-v="msg"></div>
      <div class="modebar idle">闪烁的据点可以进攻 · 守备打光就征服 · 点主基地回基地 · 右键拖动或 WASD 移动 · 滚轮缩放</div>
      ${panel}
      <nav class="dock">${btn('home', '', '返回基地', 'world')}</nav>`;
    this.refresh();
  }

  refresh(): void {
    const set = (key: string, text: string) => {
      const el = this.root.querySelector<HTMLElement>(`[data-v="${key}"]`);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set('msg', this.scene.message);
    const toast = this.root.querySelector<HTMLElement>('.toast');
    if (toast) toast.hidden = !this.scene.message;
    const ai = this.scene.selectedAiBase();
    if (!ai || ai.owner !== 'ai') return;
    const cap = aiCapacity(ai.level);
    for (const r of RESOURCES) {
      if (!cap[r]) continue;
      set(`ai-${r}`, `${Math.floor(ai.res[r])}`);
      set(`ai-loot-${r}`, `+${Math.floor(ai.res[r] * LOOT_SHARE)}`);
    }
  }

  // 敌方据点：守备、仓库、编组出击
  private enemyHtml(ai: AiBase, open: boolean): string {
    const b = this.scene.base;
    const d = defenseLeft(ai), pct = Math.round(d * 100);
    const cap = aiCapacity(ai.level);
    const resRows = RESOURCES.filter(r => cap[r] > 0).map(r =>
      `<tr><td>${RESOURCE_NAME[r]}</td><td data-v="ai-${r}"></td><td class="pos" data-v="ai-loot-${r}"></td></tr>`).join('');
    let recover = '';
    if (ai.lost.length && ai.lastAttack) {
      const h = Math.max(0, RECOVER_HOURS - (Date.now() - ai.lastAttack) / 3600_000);
      recover = `<p class="hint">如果 ${h < 1 ? `${Math.ceil(h * 60)} 分钟` : `${Math.ceil(h)} 小时`}内不再进攻，守军和防御会全部恢复。</p>`;
    }
    const army = (Object.entries(b.state.army) as [DefId, number][]).filter(([, n]) => n > 0);
    const roster = army.length
      ? army.map(([id, n]) => `<label class="pick">${DEFS[id].name}<input type="number" min="0" max="${n}" value="${n}" data-roster="${id}"> / ${n}</label>`).join('')
      : '<p class="hint">没有可出击的部队，先回基地在国防部征兵。</p>';
    return `<div>
      <span class="${open ? 'pos' : 'neg'}">${open ? '可以进攻' : '没有道路相连'}</span>
      <div class="defense"><span>守备</span><div class="bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>
      ${recover}
      <table class="stats"><tr><th>仓库</th><th>存量</th><th>打赢可抢</th></tr>${resRows}</table>
      ${open ? `<h3>编组出击</h3><div class="roster">${roster}</div>${btn('sortie', '', '出击', 'primary', !army.length)}`
        : '<p class="hint">先征服和它有道路相连的据点，才能打到这里。</p>'}
    </div>`;
  }

  // 附属据点：每小时上交多少
  private vassalHtml(ai: AiBase): string {
    return `<div>
      <span class="pos">附属据点</span>
      <p>每小时上交：${tributeText([ai])}</p>
      <p class="hint">资源进主基地仓库（放不下的作废），市民受主基地住房上限限制。</p>
    </div>`;
  }

  // 编组面板里填的各兵种数量
  private readRoster(): Roster {
    const roster: Roster = {};
    this.root.querySelectorAll<HTMLInputElement>('input[data-roster]').forEach(el => {
      const n = Math.max(0, Math.min(Number(el.max), Math.floor(Number(el.value) || 0)));
      if (n > 0) roster[el.dataset.roster as DefId] = n;
    });
    return roster;
  }
}

// 一批附属据点每小时上交的资源和市民
function tributeText(vassals: AiBase[]): string {
  const sum = Object.fromEntries(RESOURCES.map(r => [r, 0])) as Record<ResourceId, number>;
  let pop = 0;
  for (const v of vassals) {
    const rates = aiRates(v.level);
    for (const r of RESOURCES) sum[r] += rates[r] * TRIBUTE_SHARE;
    pop += v.level * TRIBUTE_POP_PER_LEVEL;
  }
  const parts = RESOURCES.filter(r => sum[r] > 0).map(r => `${RESOURCE_NAME[r]} ${Math.round(sum[r])}`);
  return [...parts, `市民 ${pop}`].join('、');
}

function btn(act: string, arg: string, label: string, cls = '', disabled = false): string {
  return `<button data-act="${act}" data-arg="${arg}" class="${cls}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}
