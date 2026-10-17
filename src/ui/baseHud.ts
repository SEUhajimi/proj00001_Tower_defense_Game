import {
  baseDef, MINISTRY_NAME, RESOURCE_NAME, RESOURCES, TAX_PER_PERSON, TERRAIN_NAME,
  type Amounts, type BaseBuildingId, type Ministry, type ResourceId,
} from '../data/economy';
import { BUILDABLE } from '../sim/base/base';
import { hourlyRates, powerInfo } from '../sim/base/economy';
import type { BaseScene } from '../game/BaseScene';

// 基地模式右侧面板：资源总览、市政厅四部门、选中建筑、离线收益。

const SHORT: Record<ResourceId, string> = {
  gold: '金', food: '粮', wood: '木', stone: '石', iron: '铁', oil: '油', steel: '钢', fuel: '燃', ammo: '弹', electronics: '电子',
};

// 国防部的建筑太多，分组显示
const DEFENSE_GROUPS: [string, BaseBuildingId[]][] = [
  ['采集', ['lumberMill', 'quarry', 'mine', 'oilWell']],
  ['加工', ['steelMill', 'refinery', 'arsenal', 'electronicsPlant']],
  ['仓储', ['warehouse', 'oilDepot', 'ammoDepot']],
  ['布防（基地被进攻时参战）', ['mgTower', 'cannonTower', 'atTower', 'aaTower', 'pillbox', 'bunker']],
];

export class BaseHud {
  private root = document.getElementById('hud')!;
  private tab: Ministry = 'civil';
  private timer: number;
  private readonly onClick = (ev: Event) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (btn && !btn.disabled) this.act(btn.dataset.act!, btn.dataset.arg);
  };
  private readonly onInput = (ev: Event) => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset.input === 'tax') { this.scene.setTax(Number(el.value) / 100); this.refresh(); }
  };

  constructor(private scene: BaseScene) {
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.timer = window.setInterval(() => this.refresh(), 500);
    this.render();
  }

  destroy(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('input', this.onInput);
    window.clearInterval(this.timer);
    this.root.innerHTML = '';
  }

  private act(act: string, arg?: string): void {
    const s = this.scene;
    switch (act) {
      case 'tab': this.tab = arg as Ministry; this.render(); break;
      case 'build': s.selectBuild(arg as BaseBuildingId); break;
      case 'buyLand': s.setMode(s.mode === 'buyLand' ? 'idle' : 'buyLand'); break;
      case 'move': s.startMove(); break;
      case 'demolish': s.demolishSelected(); break;
      case 'closeOffline': s.offline = null; this.render(); break;
      case 'battle': s.enterBattle(); break;
      case 'ff': s.fastForward(1); break;
      case 'reset': if (confirm('清空存档，重新开局？')) s.resetSave(); break;
    }
  }

  render(): void {
    const s = this.scene;
    this.root.innerHTML = `
      ${this.offlineHtml()}
      <h2>市政厅</h2>
      <div class="resgrid">${RESOURCES.map(r => `
        <div class="res"><span>${RESOURCE_NAME[r]}</span><b data-v="res-${r}"></b><small data-v="rate-${r}"></small></div>`).join('')}
      </div>
      <div class="vitals">
        <div>人口 <b data-v="pop"></b></div>
        <div>电力 <b data-v="power"></b></div>
        <div>科研 <b data-v="research"></b></div>
      </div>
      <div class="row actions">
        ${btn('buyLand', '', s.mode === 'buyLand' ? '结束买地' : '买地扩张', { active: s.mode === 'buyLand' })}
        ${btn('battle', '', '出击（战斗原型）')}
      </div>
      <nav class="tabs">${(['tech', 'finance', 'civil', 'defense'] as Ministry[]).map(m =>
        `<button data-act="tab" data-arg="${m}" class="${this.tab === m ? 'active' : ''}">${MINISTRY_NAME[m]}</button>`).join('')}</nav>
      <div class="tabbody">${this.tabHtml()}</div>
      ${this.selectionHtml()}
      <p class="msg" data-v="msg"></p>
      <p class="hint">左键选择/放置 · Shift+左键连续建造 · 右键取消 · 右键拖动或 WASD 移动视角 · 滚轮缩放</p>
      ${import.meta.env.DEV ? `<div class="row dev">${btn('ff', '', '调试：快进 1 小时')}${btn('reset', '', '重置存档', { danger: true })}</div>` : ''}`;
    this.refresh();
  }

  refresh(): void {
    const s = this.scene, b = s.base, st = b.state;
    const cap = b.storageCap(), rates = hourlyRates(b), power = powerInfo(b);
    const set = (key: string, text: string, cls?: string) => {
      const el = this.root.querySelector<HTMLElement>(`[data-v="${key}"]`);
      if (!el) return;
      if (el.textContent !== text) el.textContent = text;
      if (cls !== undefined && el.className !== cls) el.className = cls;
    };
    for (const r of RESOURCES) {
      set(`res-${r}`, `${Math.floor(st.res[r])} / ${cap[r]}`, st.res[r] >= cap[r] ? 'full' : '');
      const v = rates.res[r];
      set(`rate-${r}`, Math.abs(v) < 0.05 ? '' : `${v > 0 ? '+' : ''}${fmt(v)}/时`, v < 0 ? 'neg' : 'pos');
    }
    set('pop', `${Math.floor(st.pop)} / ${b.popCap()}`);
    set('power', `${power.supply} / ${power.demand}`, power.efficiency < 1 ? 'neg' : '');
    set('research', `${fmt(rates.research)}/时`);
    set('tax-val', `${Math.round(st.taxRate * 100)}%`);
    set('tax-income', `${fmt(st.pop * TAX_PER_PERSON * st.taxRate)}/时`);
    set('msg', s.message);
    // 买不起的建筑按钮置灰
    this.root.querySelectorAll<HTMLButtonElement>('button[data-act="build"]').forEach(el => {
      const ok = b.canAfford(baseDef(el.dataset.arg as BaseBuildingId).cost);
      el.disabled = ok !== true;
      el.title = ok === true ? '' : ok;
    });
  }

  // ---------- 片段 ----------

  private offlineHtml(): string {
    const off = this.scene.offline;
    if (!off) return '';
    const gains = RESOURCES.filter(r => Math.abs(off.gained[r]) >= 1)
      .map(r => `${RESOURCE_NAME[r]} ${off.gained[r] > 0 ? '+' : ''}${Math.floor(off.gained[r])}`).join('，');
    return `<div class="offline">
      <b>欢迎回来</b>　离开了 ${fmtHours(off.hours)}，期间基地照常运转：${gains || '没有新增产出（仓库满了或还没有生产建筑）'}。
      ${btn('closeOffline', '', '知道了')}</div>`;
  }

  private tabHtml(): string {
    const card = (id: BaseBuildingId) => {
      const d = baseDef(id), s = this.scene;
      const terrain = d.terrain ? `　需${TERRAIN_NAME[d.terrain]}` : '';
      return btn('build', id,
        `${d.name} <span class="count">×${s.base.count(id)}</span><small>${d.desc}</small><small class="cost">${costText(d.cost)}${terrain}　${d.size}×${d.size}</small>`,
        { active: s.mode === 'build' && s.tool === id });
    };
    if (this.tab === 'defense') {
      return DEFENSE_GROUPS.map(([title, ids]) => `<h3>${title}</h3>${ids.map(card).join('')}`).join('');
    }
    const list = BUILDABLE.filter(id => baseDef(id).ministry === this.tab).map(card).join('');
    if (this.tab === 'finance') {
      const st = this.scene.base.state;
      return `
        <h3>税收</h3>
        <label class="slider">税率 <b data-v="tax-val"></b>　税收 <b data-v="tax-income"></b>
          <input type="range" min="0" max="50" step="1" value="${Math.round(st.taxRate * 100)}" data-input="tax"></label>
        <p class="hint">每位市民按税率缴税（100% 时每小时 ${TAX_PER_PERSON} 金）。税率越高，人口增长越慢，超过 66% 停止增长。</p>
        <h3>建筑</h3>${list}`;
    }
    if (this.tab === 'tech') {
      return `${list}<p class="hint">科研点用于阶段 4 的科技树，现在先累计着。当前累计 ${Math.floor(this.scene.base.state.research)} 点。</p>`;
    }
    return list;
  }

  private selectionHtml(): string {
    const s = this.scene, sel = s.selectedBuilding();
    if (s.mode === 'build' && s.tool) {
      return `<div class="selection"><b>建造：${baseDef(s.tool).name}</b><p class="hint">在领地内点击放置。右键或 Esc 取消。</p></div>`;
    }
    if (s.mode === 'buyLand') {
      return `<div class="selection"><b>买地扩张</b><p class="hint">黄色地块与领地相邻，上面标着价格（红色 = 金币不够）。点击购买。第 n 块地价格 = 500 × n^1.5 × 地形系数（资源地形更贵）。</p></div>`;
    }
    if (!sel) return '';
    const d = baseDef(sel.defId);
    const moving = s.mode === 'move';
    return `<div class="selection">
      <b>${d.name}</b>　<small>${TERRAIN_NAME[s.base.terrainAt(sel.x, sel.y)]}上</small>
      <p class="hint">${d.desc}</p>
      ${moving ? '<p class="hint">点击新位置放下；右键或 Esc 取消。移动免费，不影响生产。</p>' : ''}
      <div class="row">
        ${btn('move', '', moving ? '移动中…' : '移动', { active: moving, disabled: moving })}
        ${btn('demolish', '', '拆除（返还一半）', { danger: true, disabled: !!d.unique })}
      </div></div>`;
  }
}

function btn(act: string, arg: string, label: string,
  o: { active?: boolean; disabled?: boolean; danger?: boolean } = {}): string {
  const cls = [o.active && 'active', o.danger && 'danger'].filter(Boolean).join(' ');
  return `<button data-act="${act}" data-arg="${arg}" class="${cls}" ${o.disabled ? 'disabled' : ''}>${label}</button>`;
}

function costText(cost: Amounts): string {
  const parts = RESOURCES.filter(r => cost[r]).map(r => `${SHORT[r]} ${cost[r]}`);
  return parts.length ? parts.join(' · ') : '免费';
}

function fmt(v: number): string {
  return Math.abs(v) >= 10 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString();
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} 分钟`;
  if (h < 48) return `${Math.round(h * 10) / 10} 小时`;
  return `${Math.round(h / 24 * 10) / 10} 天`;
}
