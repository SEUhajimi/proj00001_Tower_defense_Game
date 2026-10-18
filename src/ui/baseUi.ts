import { AI_ATTACK } from '../../shared/data/ai';
import { FACTORY_UNITS, TRAINING, type FactoryId } from '../../shared/data/army';
import {
  baseDef, BUILD_LIMITS, buildLimit, HALL_STORAGE, MAX_LEVEL, RESOURCE_NAME, RESOURCES, TAX_PER_PERSON, TERRAIN_NAME, upgradable, upgradeCost,
  type Amounts, type BaseBuildingDef, type BaseBuildingId,
} from '../../shared/data/economy';
import { STAGE_NAME, TECH_REQUIRES, TECH_STAGES, techStage } from '../../shared/data/tech';
import { DEFS, getDef, MOBILE_UNITS, type DefId } from '../../shared/data/units';
import { levelOf } from '../../shared/sim/base/base';
import { hourlyRates, listedLevels, marketIndex, powerInfo, privateJobs } from '../../shared/sim/base/economy';
import type { Roster } from '../../shared/sim/world/sortie';
import { currentUser, logout } from '../game/api';
import type { BaseScene } from '../game/BaseScene';
import { resAmount, resIcon } from './resIcon';

// 基地界面，盖在画面上：
//   左上角  资源和产能（常驻）
//   右上角  账号
//   右下角  功能按钮（建造、买地、科技、财政、演习、系统、世界地图），点开在上方弹出面板
//   选中建筑时弹出建筑面板；兵营、战车工厂、机场在面板里研发和生产兵种（机场还能扩建机库）

type Panel = 'build' | 'tech' | 'finance' | 'drill' | 'system' | 'building' | null;

// 建造面板的分类
const BUILD_GROUPS: [string, BaseBuildingId[]][] = [
  ['民生', ['house', 'market', 'farm', 'powerPlant', 'granary', 'lab']],
  ['财政', ['vault', 'bank', 'privateEnterprise', 'stateEnterprise', 'stockExchange']],
  ['资源', ['lumberMill', 'quarry', 'mine', 'oilWell']],
  ['工业', ['arsenal', 'electronicsPlant']],
  ['仓储', ['warehouse', 'oilDepot', 'ammoDepot']],
  ['军工', ['barracks', 'tankFactory', 'airfield']],
  ['防御', ['mgTower', 'cannonTower', 'atTower', 'aaTower', 'mortar', 'mlrs', 'samSite', 'radar']],
  ['工事', ['pillbox', 'bunker', 'landmine', 'barbedWire', 'tankTrap']],
];

const DOCK: [Exclude<Panel, 'building' | null> | 'buyLand' | 'world', string][] = [
  ['build', '建造'], ['buyLand', '买地'], ['tech', '科技'], ['finance', '财政'], ['drill', '演习'], ['system', '系统'], ['world', '世界地图'],
];

export class BaseUi {
  private root: HTMLDivElement;
  private panel: Panel = null;
  private buildGroup = 0;
  private factoryTab: 'produce' | 'research' = 'produce';
  private drill: Roster = { ...AI_ATTACK[1] }; // 演习进攻方的编制
  private lastMsg = '';
  private msgAt = 0; // 提示显示 5 秒后自动收起
  private timer: number;
  private readonly onClick = (ev: Event) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (btn && !btn.disabled) this.act(btn.dataset.act!, btn.dataset.arg);
  };
  private readonly onInput = (ev: Event) => {
    const el = ev.target as HTMLInputElement;
    if (el.dataset.input === 'tax') { this.scene.setTax(Number(el.value) / 100); this.refresh(); }
    if (el.dataset.drill) this.drill[el.dataset.drill as DefId] = Math.max(0, Math.min(99, Math.floor(Number(el.value) || 0)));
  };

  constructor(private scene: BaseScene) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    document.getElementById('game')!.appendChild(this.root);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.timer = window.setInterval(() => this.refresh(), 500);
    window.dispatchEvent(new Event('resize')); // 右侧栏收起了，画布要重新量尺寸
    this.render();
  }

  destroy(): void {
    window.clearInterval(this.timer);
    this.root.remove();
  }

  // 选中的建筑变了：选中就打开它的面板，取消选中就关掉
  onSelect(): void {
    if (this.scene.selected !== null) { this.panel = 'building'; this.factoryTab = 'produce'; }
    else if (this.panel === 'building') this.panel = null;
    this.render();
  }

  private open(p: Panel): void {
    this.panel = this.panel === p ? null : p;
    if (p !== 'building' && this.scene.selected !== null) { this.scene.selected = null; }
    if (this.scene.mode !== 'idle') this.scene.setMode('idle');
    this.render();
  }

  private act(act: string, arg?: string): void {
    const s = this.scene;
    switch (act) {
      case 'panel': this.open(arg as Panel); break;
      case 'close': this.panel = null; if (s.selected !== null) s.selected = null; this.render(); break;
      case 'buyLand': this.panel = null; s.selected = null; s.setMode(s.mode === 'buyLand' ? 'idle' : 'buyLand'); break;
      case 'world': s.scene.start('world'); break;
      case 'group': this.buildGroup = Number(arg); this.render(); break;
      case 'build': this.panel = null; s.selectBuild(arg as BaseBuildingId); break;
      case 'cancelMode': s.troops.clear(); s.setMode('idle'); break;
      case 'rotate': s.rotate(); break;
      case 'move': s.startMove(); break;
      case 'upgrade': s.upgradeSelected(); break;
      case 'demolish': if (confirm('拆除这座建筑？返还一半造价。')) s.demolishSelected(); break;
      case 'ftab': this.factoryTab = arg as typeof this.factoryTab; this.render(); break;
      case 'recruit': { const [id, n] = arg!.split(':'); s.recruit(id as DefId, Number(n)); break; }
      case 'repair': s.repairAll(); break;
      case 'research': s.research(arg as DefId); break;
      case 'drillPreset': this.drill = { ...AI_ATTACK[Number(arg)] }; this.render(); break;
      case 'drillClear': this.drill = {}; this.render(); break;
      case 'drill': s.startDrill(this.drill); break;
      case 'closeOffline': s.offline = null; this.render(); break;
      case 'logout': void logout(); break;
      case 'exportSave': s.exportSave(); break;
      case 'proto': s.enterPrototype(); break;
      case 'ff': s.fastForward(1); break;
      case 'reset': if (confirm('清空存档，重新开局？')) s.resetSave(); break;
    }
  }

  // ---------- 整体 ----------

  render(): void {
    const s = this.scene;
    this.root.innerHTML = `
      ${this.topbarHtml()}
      <div class="account">账号 <b>${esc(currentUser() ?? '')}</b>${btn('logout', '', '登出')}</div>
      <div class="toast" data-v="msg"></div>
      ${this.modeHtml()}
      ${this.panel ? `<section class="panel">${this.panelHtml()}</section>` : ''}
      <nav class="dock">${DOCK.map(([k, label]) => {
        const active = k === 'buyLand' ? s.mode === 'buyLand' : this.panel === k;
        return k === 'buyLand' || k === 'world' ? btn(k, '', label, { active, cls: k === 'world' ? 'world' : '' }) : btn('panel', k, label, { active });
      }).join('')}</nav>
      ${this.offlineHtml()}`;
    this.refresh();
  }

  refresh(): void {
    const s = this.scene, b = s.base, st = b.state;
    const cap = b.storageCap(), rates = hourlyRates(b), power = powerInfo(b);
    // 同一个数可能在左上角和面板里各出现一次
    const set = (key: string, text: string, cls?: string) => {
      this.root.querySelectorAll<HTMLElement>(`[data-v="${key}"]`).forEach(el => {
        if (el.textContent !== text) el.textContent = text;
        if (cls !== undefined && el.className !== cls) el.className = cls;
      });
    };
    for (const r of RESOURCES) {
      set(`res-${r}`, `${Math.floor(st.res[r])}/${cap[r]}`, st.res[r] >= cap[r] ? 'full' : '');
      const v = rates.res[r];
      set(`rate-${r}`, Math.abs(v) < 0.05 ? '' : `${v > 0 ? '+' : ''}${fmt(v)}`, v < 0 ? 'neg' : 'pos');
    }
    set('pop', `${Math.floor(st.pop)}`);
    set('soldiers', `${b.soldierPop()}`);
    set('housing', `${Math.floor(st.pop) + b.soldierPop()}/${b.popCap()}`);
    set('wounded', `${st.wounded.length}`);
    set('power', `${power.supply}/${power.demand}`, power.efficiency < 1 ? 'neg' : '');
    set('research', `${Math.floor(st.research)}（+${fmt(rates.research)}/时）`);
    set('food-use', `${b.armyFood()}/时`, b.hungry() ? 'neg' : '');
    set('tax-val', `${Math.round(st.taxRate * 100)}%`);
    set('tax-income', `${fmt(st.pop * TAX_PER_PERSON * st.taxRate)}/时`);
    if (s.message !== this.lastMsg) { this.lastMsg = s.message; this.msgAt = Date.now(); }
    const msg = this.root.querySelector<HTMLElement>('.toast');
    if (msg) { msg.textContent = s.message; msg.hidden = !s.message || Date.now() - this.msgAt > 5000; }
    // 做不到的按钮置灰，悬停显示原因
    const gate = (sel: string, check: (el: HTMLButtonElement) => true | string) =>
      this.root.querySelectorAll<HTMLButtonElement>(sel).forEach(el => {
        const ok = check(el);
        el.disabled = ok !== true;
        el.title = ok === true ? '' : ok;
      });
    gate('button[data-act="build"]', el => {
      const id = el.dataset.arg as BaseBuildingId;
      return id in DEFS && !b.researched(id as DefId) ? '尚未研发，去科技面板研发' : b.canAfford(baseDef(id).cost);
    });
    gate('button[data-act="recruit"]', el => { const [id, n] = el.dataset.arg!.split(':'); return b.canRecruit(id as DefId, Number(n)); });
    gate('button[data-act="research"]', el => b.canResearch(el.dataset.arg as DefId));
    gate('button[data-act="upgrade"]', () => (s.selected === null ? '没有选中建筑' : b.canUpgrade(s.selected)));
    gate('button[data-act="repair"]', () => (b.state.wounded.length ? b.canAfford(b.repairAllCost()) : '没有伤员'));
  }

  // ---------- 左上角：资源和产能 ----------

  private topbarHtml(): string {
    const res = RESOURCES.map(r => `<div class="res" title="${RESOURCE_NAME[r]}">${resIcon(r)}<b data-v="res-${r}"></b><small data-v="rate-${r}"></small></div>`).join('');
    return `<div class="topbar">
      <div class="resgrid">${res}</div>
      <div class="vitals">
        <span>市民 <b data-v="pop"></b></span><span>士兵 <b data-v="soldiers"></b></span><span>住房 <b data-v="housing"></b></span>
        <span>电力 <b data-v="power"></b></span><span>科研 <b data-v="research"></b></span><span>伤员 <b data-v="wounded"></b></span>
      </div>
      <div class="ratehint">资源后面是每小时产量</div>
    </div>`;
  }

  // 左下角：当前操作模式的提示
  private modeHtml(): string {
    const s = this.scene;
    let text = '';
    if (s.mode === 'build' && s.tool) text = `建造「${baseDef(s.tool).name}」：在领地内左键放置，按住 Shift 连续建造`;
    else if (s.mode === 'move') text = '移动建筑：左键点新位置放下。移动免费，不影响生产';
    else if (s.mode === 'buyLand') text = '买地：点击亮起的地块购买，上面标着价格（红色 = 金币不够）。第 n 块地 = 500 × n^1.5 金币，不分地形';
    else if (s.troops?.selected.size) text = `已选部队：${s.troops.summary()}。右键点空地移动过去，Shift 加选`;
    if (!text) return '<div class="modebar idle">左键选建筑或部队 · 左键拖动框选部队 · 右键拖动或 WASD 移动视角 · 滚轮缩放</div>';
    const rotate = s.canRotate() ? btn('rotate', '', `转向（R）· 现在${s.rot ? '竖放' : '横放'}`) : '';
    return `<div class="modebar">${text}${rotate}${btn('cancelMode', '', '取消（右键 / Esc）')}</div>`;
  }

  private offlineHtml(): string {
    const off = this.scene.offline;
    if (!off) return '';
    const gains = RESOURCES.filter(r => Math.abs(off.gained[r]) >= 1)
      .map(r => resAmount(r, `${off.gained[r] > 0 ? '+' : ''}${Math.floor(off.gained[r])}`)).join(' ');
    return `<div class="modal"><div class="card">
      <h2>欢迎回来</h2>
      <p>离开了 ${fmtHours(off.hours)}，期间基地照常运转：${gains || '没有新增产出（仓库满了或还没有生产建筑）'}。</p>
      ${btn('closeOffline', '', '知道了', { cls: 'primary' })}</div></div>`;
  }

  // ---------- 右下角弹出的面板 ----------

  private panelHtml(): string {
    const body: Record<Exclude<Panel, null>, () => [string, string]> = {
      build: () => ['建造', this.buildHtml()],
      tech: () => ['科技', this.techHtml()],
      finance: () => ['财政', this.financeHtml()],
      drill: () => ['演习', this.drillHtml()],
      system: () => ['系统', this.systemHtml()],
      building: () => this.buildingHtml(),
    };
    const [title, html] = body[this.panel!]();
    return `<header><h2>${title}</h2>${btn('close', '', '×', { cls: 'x' })}</header><div class="body">${html}</div>`;
  }

  private buildHtml(): string {
    const s = this.scene;
    const tabs = BUILD_GROUPS.map(([t], k) => btn('group', String(k), t, { active: k === this.buildGroup })).join('');
    const cards = BUILD_GROUPS[this.buildGroup][1].map(id => {
      const d = baseDef(id);
      return btn('build', id, `<b>${d.name}</b> <span class="count">${s.base.count(id)}/${s.base.limit(id)}</span>
        <small>${d.desc}</small><small class="cost">${costText(d.cost)} · ${sizeText(d)}</small>`, { cls: 'card' });
    }).join('');
    return `<div class="tabs">${tabs}</div><div class="cards">${cards}</div>`;
  }

  // 科技：六个阶段。塔和工事在这里研发；兵种到对应的军工建筑里研发
  private techHtml(): string {
    const b = this.scene.base;
    const stages = TECH_STAGES.map((st, k) => {
      const open = b.stageOpen(k);
      const head = k === 0
        ? `<h3>${STAGE_NAME[k]}　<small>开局自带</small></h3>`
        : `<h3>${STAGE_NAME[k]}　<small>每项 科研 ${st.research} · 金 ${st.gold}${open ? '' : ' · 上一阶段研发过半后开放'}</small></h3>`;
      const rows = st.items.map(id => {
        const done = b.researched(id), unit = id in TRAINING;
        const action = done || k === 0 ? '' : unit ? `<small class="where">在${baseDef(factoryOfUnit(id)).name}研发</small>` : btn('research', id, '研发');
        return `<div class="unitrow${done ? ' done' : ''}"><div><b>${DEFS[id].name}</b> ${done ? '<span class="pos">已研发</span>' : requireNote(b, id)}
          <small class="cost">${unitBrief(id)}</small></div>${action}</div>`;
      }).join('');
      return head + rows;
    }).join('');
    return `<p class="hint">科研点 <b data-v="research"></b>。市政厅和研究所产出科研点。上一阶段研发过半，才开放下一阶段（兵种也算在内）。</p>${stages}`;
  }

  private financeHtml(): string {
    const st = this.scene.base.state;
    return `<label class="slider">税率 <b data-v="tax-val"></b>　税收 <b data-v="tax-income"></b>
        <input type="range" min="0" max="50" step="1" value="${Math.round(st.taxRate * 100)}" data-input="tax"></label>
      <p class="hint">每位市民按税率缴税（100% 时每小时 ${TAX_PER_PERSON} 金）。税率越高，人口增长越慢，超过 66% 停止增长；私营企业也挣得越少。</p>
      <p class="hint">别的财路在建造菜单的「财政」里：国营企业（用钢铁燃油换金币）、私营企业（雇市民）、银行（存款生息）、证券交易所（企业上市，看行情）。</p>
      <p class="hint">部队口粮 <b data-v="food-use"></b>，粮食吃光后部队不能出击。</p>`;
  }

  // 演习：配置进攻方（可以选还没研发的兵种），电脑指挥它进攻自己的基地
  private drillHtml(): string {
    const presets = Object.keys(AI_ATTACK).map(l => btn('drillPreset', l, `${l} 级`)).join('');
    const inputs = MOBILE_UNITS.map(id =>
      `<label class="pick">${DEFS[id].name}<input type="number" min="0" max="99" value="${this.drill[id] ?? 0}" data-drill="${id}"></label>`).join('');
    return `<p class="hint">电脑带着你配置的军队进攻自己的基地，检验布防。任何兵种都能选，包括还没研发的。演习不造成任何损失，也没有奖励。</p>
      <div class="presets"><span>套用 AI 军队</span>${presets}${btn('drillClear', '', '清空')}</div>
      <div class="roster">${inputs}</div>
      ${btn('drill', '', '开始演习', { cls: 'primary' })}`;
  }

  private systemHtml(): string {
    return `${btn('exportSave', '', '导出存档')}
      <p class="hint">存档保存在服务器上，每个操作都自动保存，换台电脑登录同一个账号就能接着玩。导出的文件只作备份。</p>
      ${import.meta.env.DEV ? `<h3>开发调试</h3><div class="row">${btn('ff', '', '快进 1 小时')}${btn('proto', '', '战斗原型')}</div>
        ${btn('reset', '', '重置存档', { cls: 'danger' })}` : ''}`;
  }

  // ---------- 选中的建筑 ----------

  private buildingHtml(): [string, string] {
    const s = this.scene, sel = s.selectedBuilding();
    if (!sel) return ['建筑', ''];
    const d = baseDef(sel.defId);
    const moving = s.mode === 'move';
    const tools = `<div class="row tools">
      ${btn('move', '', moving ? '移动中…' : '移动', { active: moving, disabled: moving })}
      ${btn('demolish', '', '拆除', { cls: 'danger', disabled: !!d.unique })}</div>`;
    const lv = levelOf(sel);
    const title = upgradable(sel.defId) ? `${d.name}　Lv${lv}` : d.name;
    const info = `<p class="hint">${d.desc}　<small>${sizeText(d)} · ${TERRAIN_NAME[s.base.terrainAt(sel.x, sel.y)]}</small></p>`;
    if (d.factory) {
      const up = d.hangars ? this.upgradeHtml(sel.defId, lv).replace('<p class="hint">升级不占新地方', '<p class="hint">升级机场就是扩建机库，不占新地方') : '';
      return [title, info + this.factoryHtml(sel.defId as FactoryId) + up + tools];
    }
    return [title, info + this.financeStatusHtml(sel.defId) + this.upgradeHtml(sel.defId, lv) + tools];
  }

  // 财政建筑的实时情况：私企上岗人数、银行本小时利息、交易所行情
  private financeStatusHtml(id: BaseBuildingId): string {
    const b = this.scene.base, d = baseDef(id), st = b.state;
    let text = '';
    if (d.jobs) {
      const { jobs, employed } = privateJobs(b);
      const per = d.jobs.gold * (1 - st.taxRate);
      text = `全基地私企岗位 ${jobs} 个，上岗 ${employed} 人。税率 ${Math.round(st.taxRate * 100)}%，每人每小时挣 ${fmt(per)} 金`
        + (employed < jobs ? '<br><span class="neg">市民不够，有岗位空着——多建民居</span>' : '');
    } else if (d.interest) {
      const cap = b.storageCap().gold;
      text = `存款 ${Math.floor(st.res.gold)} 金，现在每小时利息 ${fmt(st.res.gold * d.interest)}。`
        + `金币容量 ${cap}，存满后每小时最多 ${fmt(cap * d.interest)}——多建金库、升级银行能存得更多`;
    } else if (d.listing) {
      const t = Date.now(), idx = marketIndex(st.seed, t), next = marketIndex(st.seed, t + 3600_000);
      const n = listedLevels(b);
      const lv = st.buildings.filter(o => o.defId === id).reduce((s, o) => s + levelOf(o), 0);
      text = `上市企业等级合计 ${n}。行情指数 <b>${idx.toFixed(2)}</b>${next > idx ? '<span class="pos">（上涨中）</span>' : '<span class="neg">（下跌中）</span>'}，`
        + `现在每小时约 ${resAmount('gold', fmt(d.listing * lv * n * idx))}`
        + (n === 0 ? '<br><span class="neg">还没有国营或私营企业上市——先建企业</span>' : '');
    }
    return text ? `<p class="hint">${text}</p>` : '';
  }

  // 升级：当前效果、下一级效果和花费
  private upgradeHtml(id: BaseBuildingId, lv: number): string {
    if (!upgradable(id)) return '';
    const d = baseDef(id);
    const now = `<div class="unitrow"><div><b>当前 Lv${lv}</b><small>${effectText(id, d, lv)}</small></div></div>`;
    if (lv >= MAX_LEVEL) return `${now}<p class="hint">已经是最高级（${MAX_LEVEL} 级）。</p>`;
    const more = id === 'hall' ? limitGains(lv) : '';
    return `${now}<div class="unitrow"><div><b>升到 Lv${lv + 1}</b><small>${effectText(id, d, lv + 1)}</small>
        ${more ? `<small class="gain">建筑上限：${more}</small>` : ''}
        <small class="cost">花费 ${costText(upgradeCost(id, lv + 1))}</small></div>${btn('upgrade', '', '升级')}</div>
      <p class="hint">升级不占新地方：几级就是 1 级效果的几倍（耗电也是），最高 ${MAX_LEVEL} 级。省下的地留给防御。</p>`;
  }

  // 军工建筑：生产（已研发的兵种）和研发（还没研发的）
  private factoryHtml(id: FactoryId): string {
    const b = this.scene.base;
    const units = FACTORY_UNITS[id];
    const tabs = `<div class="tabs">${btn('ftab', 'produce', '生产', { active: this.factoryTab === 'produce' })}${btn('ftab', 'research', '研发', { active: this.factoryTab === 'research' })}</div>`;
    if (this.factoryTab === 'research') {
      const rows = units.map(u => {
        const done = b.researched(u), stage = techStage(u);
        const st = TECH_STAGES[stage];
        const cost = stage === 0 ? '开局自带' : `科研 ${st.research} · 金 ${st.gold}`;
        return `<div class="unitrow${done ? ' done' : ''}"><div><b>${DEFS[u].name}</b> ${done ? '<span class="pos">已研发</span>' : requireNote(b, u)}
          <small>${STAGE_NAME[stage]} · ${cost}</small><small class="stats">${unitStats(u)}</small></div>
          ${done ? '' : btn('research', u, '研发')}</div>`;
      }).join('');
      return `${tabs}<p class="hint">科研点 <b data-v="research"></b>　研发后才能生产。</p>${rows}`;
    }
    const ready = units.filter(u => b.researched(u));
    const rows = ready.map(u => {
      const t = TRAINING[u]!;
      return `<div class="unitrow"><div><b>${DEFS[u].name}</b> <span class="count">现有 ${b.state.army[u] ?? 0}</span>
          <small class="cost">${costText(t.cost)} · 人口 ${t.pop} · 粮 ${t.food}/时</small><small class="stats">${unitStats(u)}</small></div>
        ${btn('recruit', `${u}:1`, '+1')}${btn('recruit', `${u}:5`, '+5')}</div>`;
    }).join('');
    const wounded = b.state.wounded.filter(w => units.includes(w.defId)).length;
    const repair = b.state.wounded.length
      ? `<div class="unitrow"><div>伤员 <b>${wounded}</b> 名（全基地共 ${b.state.wounded.length} 名）<small class="cost">全部维修 ${costText(b.repairAllCost())}</small></div>${btn('repair', '', '全部维修')}</div>`
      : '';
    const hangar = id === 'airfield'
      ? `<p class="hangar">机库：已停 <b>${b.hangarUsed()}</b> / ${b.hangarCap()}（战斗机占 1 个，轰炸机占 2 个）</p>` : '';
    return `${tabs}${hangar}${rows || '<p class="hint">还没有研发任何兵种，到“研发”里研发。</p>'}${repair}
      <p class="hint">士兵从市民中征召，和市民共用住房，每小时吃粮。</p>`;
  }
}

// 占地：正方形写边长，长方形写长 × 宽
function sizeText(d: { size: number; rect?: [number, number] }): string {
  return d.rect ? `${d.rect[0]}×${d.rect[1]}` : `${d.size}×${d.size}`;
}

function factoryOfUnit(id: DefId): FactoryId {
  return (Object.keys(FACTORY_UNITS) as FactoryId[]).find(f => FACTORY_UNITS[f].includes(id))!;
}

function requireNote(b: BaseScene['base'], id: DefId): string {
  const req = TECH_REQUIRES[id];
  if (req && !b.researched(req)) return `<small class="neg">需要先研发${DEFS[req].name}</small>`;
  if (!b.stageOpen(techStage(id))) return '<small class="neg">上一阶段研发过半后开放</small>';
  return '';
}

function unitStats(id: DefId): string {
  const d = getDef(id), w = d.weapons[0];
  if (d.kind === 'trap' || d.kind === 'obstacle' || d.kind === 'support') return `血量 ${d.hp}`;
  return `血量 ${d.hp}${w ? ` · 伤害 ${w.dmg}/${w.interval}秒${w.range ? ` · 射程 ${w.range}` : ''}` : ''} · 速度 ${d.speed}`;
}

function btn(act: string, arg: string, label: string,
  o: { active?: boolean; disabled?: boolean; cls?: string } = {}): string {
  const cls = [o.active && 'active', o.cls].filter(Boolean).join(' ');
  return `<button data-act="${act}" data-arg="${arg}" class="${cls}" ${o.disabled ? 'disabled' : ''}>${label}</button>`;
}

function costText(cost: Amounts): string {
  const parts = RESOURCES.filter(r => cost[r]).map(r => resAmount(r, cost[r]!));
  return parts.length ? parts.join(' ') : '免费';
}

function fmt(v: number): string {
  return Math.abs(v) >= 10 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString();
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} 分钟`;
  if (h < 48) return `${Math.round(h * 10) / 10} 小时`;
  return `${Math.round(h / 24 * 10) / 10} 天`;
}

// 科技树里的一行说明：兵种看征召费用，塔看修建费用
function unitBrief(id: DefId): string {
  const t = TRAINING[id];
  if (t) return `征召 ${costText(t.cost)}`;
  const d = getDef(id);
  return d.cost ? `修建 ${costText(d.cost)}` : '';
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// 某个等级的建筑效果，一行写完
function effectText(id: BaseBuildingId, d: BaseBuildingDef, k: number): string {
  const parts: string[] = [];
  const amounts = (a: Amounts | undefined) => RESOURCES.filter(r => a?.[r]).map(r => resAmount(r, a![r]! * k)).join(' ');
  if (d.produces) parts.push(`每小时产 ${amounts(d.produces)}`);
  if (d.consumes) parts.push(`消耗 ${amounts(d.consumes)}`);
  if (d.storage) parts.push(`容量 +${amounts(d.storage)}`);
  if (id === 'hall') parts.push(`基础仓储 ×${k}（金币 ${HALL_STORAGE.gold * k}）`);
  if (d.popCap) parts.push(`住房 ${d.popCap * k} 人`);
  if (d.research) parts.push(`科研 ${d.research * k}/时`);
  if (d.power) parts.push(d.power > 0 ? `发电 ${d.power * k}` : `耗电 ${-d.power * k}`);
  if (d.fuelBoost) parts.push(`有燃油时再 +${d.fuelBoost.power * k} 电（烧 ${d.fuelBoost.fuel * k} 燃油/时）`);
  if (d.hangars) parts.push(`机库 ${d.hangars * k} 个`);
  if (d.jobs) parts.push(`岗位 ${d.jobs.per * k} 个，每人每小时 ${d.jobs.gold} 金 ×（1 − 税率）`);
  if (d.interest) parts.push(`存款利息 ${d.interest * 100}%/时，不设上限`);
  if (d.listing) parts.push(`每小时 ${d.listing * k} 金 × 上市企业等级 × 行情`);
  return parts.join(' · ');
}

// 市政厅从 lv 升到 lv+1，哪些建筑多了几个名额
function limitGains(lv: number): string {
  return (Object.keys(BUILD_LIMITS) as (keyof typeof BUILD_LIMITS)[])
    .map(id => [id, buildLimit(id, lv + 1) - buildLimit(id, lv)] as const)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${baseDef(id).name} +${n}`)
    .join('、');
}
