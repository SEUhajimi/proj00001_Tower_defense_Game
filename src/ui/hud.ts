import { DAMAGE_TYPE_NAME } from '../../shared/data/combat';
import { RESOURCE_NAME, RESOURCES } from '../../shared/data/economy';
import { DEFS, type DefId, type UnitDef } from '../../shared/data/units';
import { isAir, isMobile, type Side, type Stance } from '../../shared/sim/battle';
import type { BattleScene } from '../game/BattleScene';

// 战斗界面右侧面板。阶段切换时 render() 重建结构，refresh() 定时刷新数字。

const OUTCOME_TEXT = { victory: '胜利', defeat: '失败', retreat: '已撤退' } as const;
const DRILL_OUTCOME_TEXT = { victory: '防守成功', defeat: '防线被突破', retreat: '演习已结束' } as const;

export class Hud {
  private root = document.getElementById('hud')!;
  private timer: number;
  private readonly onClick = (ev: Event) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (btn && !btn.disabled) this.act(btn.dataset.act!, btn.dataset.arg);
  };

  constructor(private scene: BattleScene) {
    this.root.addEventListener('click', this.onClick);
    this.timer = window.setInterval(() => this.refresh(), 200);
  }

  destroy(): void {
    this.root.removeEventListener('click', this.onClick);
    window.clearInterval(this.timer);
    this.root.innerHTML = '';
  }

  private act(act: string, arg?: string): void {
    const s = this.scene;
    switch (act) {
      case 'tool': s.selectTool(arg as DefId); break;
      case 'stance': s.stance = arg as Stance; this.render(); break;
      case 'auto': s.autoDeploy(); break;
      case 'start': s.startBattle(); break;
      case 'all': s.setAllStance(arg as Stance); break;
      case 'selectAll': s.selectAll(); break;
      case 'selType': s.selectType(arg as DefId); break;
      case 'clearSel': s.clearSelection(); break;
      case 'pause': s.paused = !s.paused; this.render(); break;
      case 'speed': s.speed = s.speed >= 4 ? 1 : s.speed * 2; this.render(); break;
      case 'retreat': s.retreat(); break;
      case 'again': s.newBattle(); break;
      case 'home': s.goHome(); break;
      case 'annex': s.annex(); break;
      case 'settle': s.settle(); break;
    }
  }

  render(): void {
    const s = this.scene;
    if (!s.deployment) return;
    const html: Record<typeof s.phase, () => string> = {
      deploy: () => this.deployHtml(),
      battle: () => this.battleHtml(),
      result: () => this.resultHtml(),
    };
    this.root.innerHTML = html[s.phase]();
    this.refresh();
  }

  refresh(): void {
    const s = this.scene;
    if (!s.battle) return;
    const set = (id: string, text: string) => {
      const el = this.root.querySelector<HTMLElement>(`[data-v="${id}"]`);
      if (el && el.textContent !== text) el.textContent = text;
    };
    const b = s.battle;
    set('time', formatTime(b.time));
    const towers = (side: Side) => b.living(side).filter(e => e.def.kind === 'tower' || e.def.kind === 'fort').length;
    set('p-units', String(b.living('player').filter(isMobile).length));
    set('e-units', String(b.living('enemy').filter(isMobile).length));
    set('p-towers', String(towers('player')));
    set('e-towers', String(towers('enemy')));
    const def: Side = b.attacker === 'player' ? 'enemy' : 'player';
    set('hq', b.hqDown[def] ? `已摧毁（${def === 'enemy' ? '敌方' : '守军'}伤害 -30%）` : '完好');
    set('sel', String(s.selected.size));
  }

  // ---------- 各阶段 ----------

  private deployHtml(): string {
    const s = this.scene, d = s.deployment;
    if (s.mode === 'drill') return this.drillDeployHtml();
    const unitBtns = (Object.entries(d.roster) as [DefId, number][]).map(([id, n]) => {
      const def: UnitDef = DEFS[id];
      return btn('tool', id, `${def.name}<small>剩 ${n}</small>`, { active: s.tool === id, disabled: n <= 0, title: unitTip(def) });
    }).join('');
    const anyUnit = d.placed().some(e => e.def.speed > 0);
    return `
      <h2>${s.ai ? `进攻 AI 基地 · Lv${s.ai.level}` : '部署部队（战斗原型）'}</h2>
      ${btn('home', '', '← 返回基地')}
      <p>敌方基地四周的一圈空地是投送区，部队只能摆在这里。出击不能修建防御塔或工事。</p>
      <p class="legend">投送区被几座敌方塔的射程覆盖：
        <span style="color:#7dff8a">■ 0</span>
        <span style="color:#ffe14a">■ 1</span>
        <span style="color:#ff9a3c">■ 2</span>
        <span style="color:#ff4d4d">■ 3+</span></p>
      <h3>部队</h3>
      <div class="grid">${unitBtns}</div>
      <h3>新部署部队的姿态</h3>
      <div class="row">
        ${btn('stance', 'assault', '出击', { active: s.stance === 'assault', title: '主动寻找敌人' })}
        ${btn('stance', 'hold', '驻守', { active: s.stance === 'hold', title: '只迎击驻地附近的敌人' })}
      </div>
      <div class="row actions">${btn('auto', '', '一键布置')}</div>
      ${btn('start', '', '开战', { primary: true, disabled: !anyUnit, title: anyUnit ? '' : '至少部署一支部队' })}
      <p class="hint">左键放置 · 右键单击撤回</p>
      <p class="hint">克制：机枪克步兵，穿甲克坦克，爆破克建筑和工事，火炮克密集部队</p>
      ${this.helpHtml()}`;
  }

  // 演习：进攻方已由电脑布置好，玩家只看一眼就开始
  private drillDeployHtml(): string {
    const s = this.scene;
    const rows = (Object.entries(countBy(s.deployment.placed().map(e => e.defId))) as [DefId, number][])
      .map(([id, n]) => `<tr><td>${DEFS[id].name}</td><td>${n}</td></tr>`).join('');
    return `
      <h2>演习 · 防守自己的基地</h2>
      ${btn('home', '', '← 返回基地')}
      <p>电脑带着下面这支军队从外圈进攻你的基地。你的塔、工事和部队都会参战；你可以在交战中框选自己的部队指挥。</p>
      <p>演习结束后一切恢复原状，不消耗任何东西，也没有奖励。</p>
      <p class="legend">外圈被你几座塔的射程覆盖：
        <span style="color:#7dff8a">■ 0</span>
        <span style="color:#ffe14a">■ 1</span>
        <span style="color:#ff9a3c">■ 2</span>
        <span style="color:#ff4d4d">■ 3+</span></p>
      <h3>进攻方</h3>
      <table class="stats"><tr><th>兵种</th><th>数量</th></tr>${rows}</table>
      ${btn('start', '', '开始演习', { primary: true })}
      ${this.helpHtml()}`;
  }

  private battleHtml(): string {
    const s = this.scene, drill = s.mode === 'drill';
    const myPlanes = [...new Set(s.battle.living('player').filter(e => isAir(e) && e.def.kind === 'bomber').map(e => e.defId))];
    const planeBtns = myPlanes.length
      ? `<div class="row" style="margin-top:6px">${myPlanes.map(id => btn('selType', id, `选中全部${DEFS[id].name}`)).join('')}</div>
        <p class="hint">轰炸机要你指定目标：选中后右键点敌兵或敌塔，炸完自动返航挂弹再去。战斗机自动来回投弹，不用管。</p>`
      : '';
    return `
      <h2>${drill ? '演习中' : '交战中'} <span class="time" data-v="time"></span></h2>
      <table class="stats">
        <tr><th></th><th>部队</th><th>塔与工事</th></tr>
        <tr><td class="me">${drill ? '守军（我方）' : '我方'}</td><td data-v="p-units"></td><td data-v="p-towers"></td></tr>
        <tr><td class="foe">${drill ? '进攻方' : '敌方'}</td><td data-v="e-units"></td><td data-v="e-towers"></td></tr>
      </table>
      <p>${drill ? '我方市政厅' : '敌方指挥部'}：<b data-v="hq"></b></p>
      <h3>部队指挥　<span class="sel">已选 <b data-v="sel"></b> 支</span></h3>
      <div class="row">
        ${btn('selectAll', '', '全选')}
        ${btn('clearSel', '', '取消选择', { disabled: !s.selected.size })}
      </div>
      ${planeBtns}
      <div class="row" style="margin-top:6px">
        ${btn('all', 'assault', s.selected.size ? '选中的出击' : '全军出击')}
        ${btn('all', 'hold', s.selected.size ? '选中的驻守' : '全军驻守')}
      </div>
      <p class="hint">左键拖动框选（Shift 追加）· 右键点敌人集火 · 右键点空地移动，到达后驻守</p>
      <h3>战斗控制</h3>
      <div class="row">
        ${btn('pause', '', s.paused ? '继续' : '暂停')}
        ${btn('speed', '', `速度 ${s.speed}x`)}
      </div>
      ${drill ? btn('retreat', '', '结束演习', { danger: true }) : btn('retreat', '', '撤退（拿不到掠夺）', { danger: true })}
      ${this.helpHtml()}`;
  }

  private resultHtml(): string {
    const s = this.scene, b = s.battle;
    if (s.mode === 'drill') return this.drillResultHtml();
    const outcome = b.outcome ?? 'retreat';
    const alive: Partial<Record<DefId, number>> = {};
    for (const e of b.living('player')) alive[e.defId] = (alive[e.defId] ?? 0) + 1;
    const rows = (Object.entries(s.deployedCounts) as [DefId, number][]).map(([id, n]) =>
      `<tr><td>${DEFS[id].name}</td><td>${n}</td><td>${n - (alive[id] ?? 0)}</td></tr>`).join('');
    const note = outcome === 'victory'
      ? '敌方基地已被攻破。'
      : outcome === 'defeat' ? '我方可移动部队全军覆没。' : '部队已撤回，拿不到掠夺。';
    return `
      <h2 class="outcome ${outcome}">${OUTCOME_TEXT[outcome]}</h2>
      <p>用时 ${formatTime(b.time)}。${note}</p>
      <table class="stats">
        <tr><th>我方单位</th><th>投入</th><th>损失</th></tr>
        ${rows}
      </table>
      ${this.sortieHtml()}
      ${s.mode === 'prototype' ? btn('again', '', '再来一局（新地图）', { primary: true }) : ''}
      ${btn('home', '', '← 返回基地', { primary: s.mode === 'sortie' })}`;
  }

  // 演习结果：进攻方损失、我方被毁的塔和建筑
  private drillResultHtml(): string {
    const s = this.scene, b = s.battle;
    const outcome = b.outcome ?? 'retreat';
    const alive = countBy(b.living('enemy').map(e => e.defId));
    const rows = (Object.entries(s.deployedCounts) as [DefId, number][]).map(([id, n]) =>
      `<tr><td>${DEFS[id].name}</td><td>${n}</td><td>${n - (alive[id] ?? 0)}</td></tr>`).join('');
    const mine = b.entities.filter(e => e.side === 'player');
    const lost = (pred: (k: string) => boolean) => {
      const all = mine.filter(e => pred(e.def.kind));
      return `${all.filter(e => !e.alive).length} / ${all.length}`;
    };
    const note = outcome === 'victory'
      ? (b.time >= b.timeLimit ? '进攻方超时没能攻下基地。' : '进攻方被全部消灭。')
      : outcome === 'defeat' ? '进攻方攻下了你的基地，布防还需要加强。' : '你提前结束了演习。';
    return `
      <h2 class="outcome ${outcome}">${DRILL_OUTCOME_TEXT[outcome]}</h2>
      <p>用时 ${formatTime(b.time)}。${note}</p>
      <table class="stats">
        <tr><th>进攻方</th><th>投入</th><th>被消灭</th></tr>
        ${rows}
      </table>
      <table class="stats">
        <tr><th>我方被毁</th><th>数量</th></tr>
        <tr><td>塔与工事</td><td>${lost(k => k === 'tower' || k === 'fort')}</td></tr>
        <tr><td>其他建筑</td><td>${lost(k => k === 'civil' || k === 'hq')}</td></tr>
        <tr><td>部队</td><td>${lost(k => k === 'infantry' || k === 'tank')}</td></tr>
      </table>
      <p class="hint">演习不造成任何实际损失，基地和部队都是原样。</p>
      ${btn('again', '', '再演一次', { primary: true })}
      ${btn('home', '', '← 返回基地')}`;
  }

  // 出击结算：伤员、掠夺所得、吞并
  private sortieHtml(): string {
    const s = this.scene, r = s.report;
    if (s.settling) return '<p class="hint">正在向服务器结算……</p>';
    if (s.settleError) {
      return `<p class="neg">结算失败：${s.settleError}</p>${btn('settle', '', '重新结算', { primary: true })}
        <p class="hint">战斗记录还在，连上服务器后点“重新结算”。直接返回基地的话，这场出击不计入存档。</p>`;
    }
    if (!r) return '';
    const parts: string[] = [];
    if (r.outcome !== (s.battle.outcome ?? 'retreat')) {
      parts.push(`<p class="neg">服务器重算的结果是「${OUTCOME_TEXT[r.outcome]}」，以服务器为准。</p>`);
    }
    if (r.wounded) parts.push(`<p>${r.wounded} 支部队带伤回到基地，在国防部花资源维修后才能再出击。</p>`);
    if (r.loot) {
      const rows = RESOURCES.filter(k => r.loot!.loot[k] > 0).map(k => {
        const lost = r.loot!.loot[k] - r.loot!.kept[k];
        return `<tr><td>${RESOURCE_NAME[k]}</td><td class="pos">+${r.loot!.kept[k]}</td><td>${lost > 0 ? `<span class="neg">${lost} 放不下作废</span>` : ''}</td></tr>`;
      }).join('');
      parts.push(`<h3>掠夺（对方仓库的 50%，对方进入 24 小时免战）</h3><table class="stats">${rows}</table>`);
    }
    const annex = s.annexInfo();
    if (annex) {
      parts.push(`<h3>吞并</h3><p>这个基地与你的领地相邻。花 ${annex.cost} 金币吞并：领地和建筑归你，市政厅拆掉。</p>
        ${btn('annex', '', `吞并（${annex.cost} 金币）`, { disabled: annex.ok !== true, title: annex.ok === true ? '' : annex.ok })}`);
    }
    if (s.annexed) parts.push('<p class="pos">已吞并，回到基地就能看到新领地。</p>');
    return parts.join('');
  }

  private helpHtml(): string {
    return '<p class="hint">右键拖动或 WASD 移动视角 · 滚轮缩放 · 空格暂停 · Esc 取消选择</p>';
  }
}

function btn(act: string, arg: string, label: string,
  o: { active?: boolean; disabled?: boolean; primary?: boolean; danger?: boolean; title?: string } = {}): string {
  const cls = [o.active && 'active', o.primary && 'primary', o.danger && 'danger'].filter(Boolean).join(' ');
  return `<button data-act="${act}" data-arg="${arg}" class="${cls}" ${o.disabled ? 'disabled' : ''} title="${o.title ?? ''}">${label}</button>`;
}

function unitTip(def: UnitDef): string {
  if (def.kind === 'fort') return `血量 ${def.hp} · 可驻防 ${def.capacity} 名步兵，射程 +${def.rangeBonus}
驻防步兵打不到，工事被毁后弹出`;
  const w = def.weapons.map(w => `${DAMAGE_TYPE_NAME[w.type]} ${w.dmg}/${w.interval}秒 射程${w.range}`).join('；');
  return `血量 ${def.hp}${def.speed ? ` · 移速 ${def.speed}` : ''}\n${w}`;
}

function formatTime(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function countBy(ids: DefId[]): Partial<Record<DefId, number>> {
  const out: Partial<Record<DefId, number>> = {};
  for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}
