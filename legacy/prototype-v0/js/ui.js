'use strict';
// ============================================================
//  基地守卫 —— 市政厅界面（四个部门）
//  面板 HTML 只在切换标签时生成一次；之后由 refreshUI() 按
//  data-bind / data-act 属性定时刷新文字和按钮可用状态。
// ============================================================

const $ = id => document.getElementById(id);
const fmt = n => Math.floor(n).toLocaleString('zh-CN');
const f1 = n => (Math.round(n * 10) / 10).toString();
const signed = n => (n >= 0 ? '+' : '') + f1(n);

const UI = { tab: 'civil', timer: 0, logKey: '' };

function costText(d) {
  const parts = [];
  if (d.cost) parts.push('💰' + d.cost);
  if (d.gold) parts.push('💰' + d.gold);
  if (d.supplies) parts.push('📦' + d.supplies);
  if (d.pop) parts.push('👥' + d.pop);
  if (d.power > 0) parts.push('⚡+' + d.power);
  if (d.power < 0) parts.push('⚡' + d.power);
  if (d.upkeep) parts.push('维护 ' + d.upkeep + '/日');
  return parts.join('　');
}

function card({ act, arg, title, desc, cost, btn, bind }) {
  return `<div class="card">
    <div class="card-main">
      <div class="card-title">${title}${bind ? ` <span class="count" data-bind="${bind}" data-arg="${arg}"></span>` : ''}</div>
      <div class="card-desc">${desc}</div>
      <div class="card-cost">${cost}</div>
    </div>
    <button data-act="${act}" data-arg="${arg}">${btn}</button>
  </div>`;
}

const stat = (label, bind, arg = '') => `<div class="stat"><span>${label}</span><b data-bind="${bind}" data-arg="${arg}"></b></div>`;

function buildingCards(ministry) {
  return Object.entries(BUILDINGS).filter(([, d]) => d.ministry === ministry)
    .map(([k, d]) => card({ act: 'build', arg: k, title: d.name, desc: d.desc, cost: costText(d), btn: '建造', bind: 'count' })).join('');
}

// ---------- 四个部门 ----------
const TABS = {
  tech: () => {
    const groups = [...new Set(TECHS.map(t => t.group))];
    return `
      <h3>研发进度</h3>
      <div class="box" data-bind="researchNow"></div>
      <div class="stats">${stat('科研产出', 'rp')}</div>
      <p class="hint">科研来源：市政厅 1/日 + 研究所 2/日 + 财政部科研拨款（每 10 金 = 1 点）。</p>
      <h3>科研设施</h3>
      ${buildingCards('tech')}
      ${groups.map(g => `<h3>${g}</h3>` + TECHS.filter(t => t.group === g).map(t => `
        <div class="tech">
          <div class="card-main">
            <div class="card-title">${t.name} <small>🔬${t.rp}</small></div>
            <div class="card-desc">${t.desc}${t.req.length ? '　<i>前置：' + t.req.map(r => TECH_BY_ID[r].name).join('、') + '</i>' : ''}</div>
          </div>
          <div data-bind="techStatus" data-arg="${t.id}"></div>
        </div>`).join('')).join('')}`;
  },

  finance: () => `
    <h3>税收政策</h3>
    <label class="slider">税率 <b data-bind="taxVal"></b>
      <input type="range" min="0" max="50" step="1" value="${Math.round(G.taxRate * 100)}" data-slider="tax"></label>
    <p class="hint">税率越高收入越多，但幸福度下降；幸福度低于 50 人口停止增长，低于 30 开始外流。</p>
    <h3>科研拨款</h3>
    <label class="slider">每日拨款 <b data-bind="budgetVal"></b>
      <input type="range" min="0" max="100" step="5" value="${G.researchBudget}" data-slider="budget"></label>
    <h3>每日收支</h3>
    <div class="stats">
      ${stat('人头税', 'fin', 'taxIncome')}
      ${stat('市场营业额', 'fin', 'marketIncome')}
      ${stat('<b>收入合计</b>', 'fin', 'income')}
      ${stat('建筑维护', 'fin', 'maintenance')}
      ${stat('军饷', 'fin', 'wages')}
      ${stat('科研拨款', 'fin', 'researchSpend')}
      ${stat('债券还款', 'fin', 'bondPay')}
      ${stat('<b>支出合计</b>', 'fin', 'expense')}
      ${stat('<b>每日净收入</b>', 'net')}
    </div>
    <h3>战争债券</h3>
    ${card({ act: 'bond', arg: '', title: '发行战争债券', desc: `立即获得 ${BOND.amount} 金，之后 ${BOND.days} 天每日还款 ${BOND.payment}（共 ${BOND.payment * BOND.days}）。最多同时 ${BOND.maxActive} 笔。`, cost: '', btn: '发行' })}
    <div class="stats">${stat('未偿债券', 'bonds')}</div>`,

  civil: () => `
    <h3>民情</h3>
    <div class="stats">
      ${stat('市民 / 住房上限', 'popLine')}
      ${stat('其中服役军人', 'soldiers')}
      ${stat('幸福度', 'happy')}
      ${stat('人口变化', 'growth')}
      ${stat('电力 供 / 需', 'power')}
    </div>
    <p class="hint">电力不足时，耗电建筑效率按比例下降，幸福度也会降低。</p>
    <h3>民用设施</h3>
    ${buildingCards('civil')}`,

  defense: () => `
    <h3>战略物资</h3>
    <div class="stats">
      ${stat('军需储备', 'sup')}
      ${stat('军需产量', 'supRate')}
    </div>
    ${buildingCards('defense')}
    <h3>防御塔</h3>
    ${Object.entries(TOWERS).map(([k, d]) => card({
      act: 'tower', arg: k, title: d.name, bind: 'count',
      desc: d.desc + (d.tech ? `<i data-bind="lock" data-arg="${d.tech}"></i>` : ''),
      cost: costText(d), btn: '建造',
    })).join('')}
    <h3>征兵</h3>
    <div class="stats">${stat('现役兵力', 'army')}${stat('可征召市民', 'draftable')}</div>
    ${Object.entries(UNITS).map(([k, d]) => card({
      act: 'recruit', arg: k, title: d.name, bind: 'unitCount',
      desc: d.desc + `（生命 ${d.hp} · 射程 ${d.range}）` + (d.tech ? `<i data-bind="lock" data-arg="${d.tech}"></i>` : ''),
      cost: costText(d), btn: '征召',
    })).join('')}
    <h3>部署</h3>
    <label class="slider">防线位置 <b data-bind="lineVal"></b>
      <input type="range" min="0" max="90" step="5" value="${Math.round(G.defenseLine * 100)}" data-slider="line"></label>
    <p class="hint">0% 表示在市政厅门口布防，数值越大部队越向前推进（地图上蓝色小旗）。</p>`,
};

// ---------- 动态数据绑定 ----------
const BIND = {
  count: k => '×' + count(k),
  unitCount: k => '×' + G.units.filter(u => u.key === k).length,
  lock: id => has(id) ? '' : `　<span class="locked">🔒需研发「${TECH_BY_ID[id].name}」</span>`,
  rp: () => f1(G.stats.rpPerDay) + ' / 日',
  researchNow: () => {
    if (!G.research) return '<span class="muted">暂无研发项目，请从下方选择。</span>';
    const t = TECH_BY_ID[G.research.id], p = G.research.progress / t.rp;
    const eta = Math.ceil((t.rp - G.research.progress) / Math.max(0.1, G.stats.rpPerDay));
    return `<div class="row"><b>${t.name}</b><span>${f1(G.research.progress)} / ${t.rp}　约 ${eta} 天</span></div>
      <div class="bar"><div style="width:${(p * 100).toFixed(1)}%"></div></div>
      <button data-act="cancelResearch" class="small danger">中止</button>`;
  },
  techStatus: id => {
    const s = techState(TECH_BY_ID[id]);
    if (s === 'done') return '<span class="tag done">已完成</span>';
    if (s === 'active') return '<span class="tag active">研发中</span>';
    if (s === 'locked') return '<span class="tag">未满足前置</span>';
    return `<button data-act="research" data-arg="${id}">研发</button>`;
  },
  taxVal: () => Math.round(G.taxRate * 100) + '%',
  budgetVal: () => G.researchBudget + ' 金 / 日',
  lineVal: () => Math.round(G.defenseLine * 100) + '%',
  fin: k => {
    const v = G.stats[k];
    const isIncome = ['taxIncome', 'marketIncome', 'income'].includes(k);
    return `<span class="${isIncome ? 'pos' : 'neg'}">${isIncome ? '+' : '-'}${f1(v)}</span>`;
  },
  net: () => `<span class="${G.stats.net >= 0 ? 'pos' : 'neg'}">${signed(G.stats.net)}</span>`,
  bonds: () => G.bonds.length ? G.bonds.map(b => `剩 ${b.days} 天`).join('，') : '无',
  popLine: () => fmt(G.pop) + ' / ' + fmt(G.stats.popCap - G.stats.soldiers),
  soldiers: () => fmt(G.stats.soldiers),
  happy: () => { const h = G.stats.happiness; return `<span class="${h >= 50 ? 'pos' : h >= 30 ? 'warn' : 'neg'}">${h}</span>`; },
  growth: () => { const g = G.stats.growth; return `<span class="${g > 0 ? 'pos' : g < 0 ? 'neg' : ''}">${signed(g)} / 日</span>`; },
  power: () => `<span class="${G.stats.powerEff < 1 ? 'neg' : 'pos'}">${f1(G.stats.powerSupply)} / ${G.stats.powerDemand}</span>`,
  sup: () => fmt(G.supplies) + ' / ' + G.stats.supplyCap,
  supRate: () => '+' + f1(G.stats.supplyPerDay) + ' / 日',
  army: () => G.units.length + ' 支（占用人口 ' + G.stats.soldiers + '）',
  draftable: () => fmt(Math.max(0, G.pop - MIN_CIVILIANS)),
};

function canDo(act, arg) {
  switch (act) {
    case 'build': return placeCheck({ kind: 'building', key: arg });
    case 'tower': return placeCheck({ kind: 'tower', key: arg });
    case 'recruit': return recruitCheck(arg);
    case 'research': return G.research ? '已有项目在研发中' : true;
    case 'bond': return G.bonds.length < BOND.maxActive ? true : '债券额度已满';
    default: return true;
  }
}

function doAction(act, arg) {
  switch (act) {
    case 'build': startPlacing('building', arg); break;
    case 'tower': startPlacing('tower', arg); break;
    case 'recruit': recruit(arg); break;
    case 'research': startResearch(arg); break;
    case 'cancelResearch': cancelResearch(); break;
    case 'bond': issueBond(); break;
    case 'sell': sellSelected(); break;
  }
  refreshUI();
}

function switchTab(tab) {
  UI.tab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('panel-body').innerHTML = TABS[tab]();
  refreshUI();
}

function refreshScope(root) {
  root.querySelectorAll('[data-bind]').forEach(el => {
    const v = BIND[el.dataset.bind](el.dataset.arg);
    if (el._v !== v) { el.innerHTML = v; el._v = v; }
  });
  root.querySelectorAll('button[data-act]').forEach(b => {
    const r = canDo(b.dataset.act, b.dataset.arg);
    b.disabled = r !== true;
    b.title = r === true ? '' : r;
  });
}

function refreshSelection() {
  const b = G.selected, box = $('selection');
  let html = '';
  if (b) {
    const d = b.def;
    const extra = b.kind === 'tower'
      ? `射程 ${d.range}　${d.dps ? '每秒伤害 ' + d.dps : '伤害 ' + d.dmg}　${d.air && d.ground ? '对空/对地' : d.air ? '仅对空' : '仅对地'}`
      : d.desc;
    html = `<div class="row"><b>${d.name}</b><button data-act="sell" class="small danger">拆除（返还 50%）</button></div>
      <div class="card-desc">${extra}</div><div class="card-cost">${costText(d)}</div>`;
  } else if (G.placing) {
    const d = G.placing.kind === 'tower' ? TOWERS[G.placing.key] : BUILDINGS[G.placing.key];
    html = `<div class="row"><b>放置：${d.name}</b></div><div class="card-desc">左键选择空地放置，按住 Shift 连续建造，右键 / Esc 取消。</div>`;
  } else {
    html = '<div class="muted">点击地图上的建筑查看详情。</div>';
  }
  if (box._v !== html) { box.innerHTML = html; box._v = html; }
}

function refreshTopbar() {
  const S = G.stats;
  $('r-gold').textContent = fmt(G.gold);
  $('r-gold').className = G.gold < 0 ? 'neg' : '';
  $('r-net').textContent = '(' + signed(S.net) + '/日)';
  $('r-pop').textContent = fmt(G.pop) + ' / ' + fmt(S.popCap);
  $('r-happy').textContent = S.happiness;
  $('r-power').textContent = f1(S.powerSupply) + ' / ' + S.powerDemand;
  $('r-power').className = S.powerEff < 1 ? 'neg' : '';
  $('r-sup').textContent = fmt(G.supplies) + ' / ' + S.supplyCap;
  $('r-rp').textContent = f1(S.rpPerDay) + '/日';
  $('r-army').textContent = G.units.length;
  $('r-hall').textContent = Math.ceil(G.hallHp) + ' / ' + HALL.maxHp;
  $('r-wave').textContent = G.phase === 'build'
    ? `第 ${G.wave + 1} / ${MAX_WAVES} 波 · ${Math.ceil(G.timer)} 秒后来袭`
    : `第 ${G.wave} / ${MAX_WAVES} 波 · 剩余敌军 ${G.enemies.length + G.spawnQueue.length}`;
  $('btn-next').disabled = G.phase !== 'build' || !!G.over;
  $('btn-pause').textContent = G.paused ? '继续' : '暂停';
  $('btn-speed').textContent = G.speed + 'x';
}

function refreshLog() {
  const key = G.logs.length + '|' + (G.logs[0] && G.logs[0].text);
  if (key === UI.logKey) return;
  UI.logKey = key;
  $('log').innerHTML = G.logs.slice(0, 8).map(l => `<div class="${l.type}">[第${l.day}天] ${l.text}</div>`).join('');
}

function refreshUI() {
  refreshTopbar();
  refreshScope($('panel-body'));
  refreshSelection();
  refreshScope($('selection'));
  refreshLog();
}

// 由 game.js 的主循环每帧调用
function onFrameUI(dt) {
  UI.timer += dt;
  if (UI.timer < 0.2) return;
  UI.timer = 0;
  refreshUI();
}

// ---------- 事件绑定 ----------
document.querySelectorAll('.tab').forEach(b => { b.onclick = () => switchTab(b.dataset.tab); });

$('hall').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-act]');
  if (b && !b.disabled) doAction(b.dataset.act, b.dataset.arg);
});

$('panel-body').addEventListener('input', ev => {
  const s = ev.target.dataset.slider, v = Number(ev.target.value);
  if (s === 'tax') G.taxRate = v / 100;
  if (s === 'budget') G.researchBudget = v;
  if (s === 'line') G.defenseLine = v / 100;
  recalcStats();
  refreshUI();
});

$('btn-next').onclick = () => startWave();
$('btn-pause').onclick = () => { G.paused = !G.paused; };
$('btn-speed').onclick = () => { G.speed = G.speed >= 3 ? 1 : G.speed + 1; };
$('btn-restart').onclick = () => {
  if (!G.over && !confirm('确定放弃当前进度，重新开始？')) return;
  newGame();
  G.paused = false;
  switchTab(UI.tab);
};
$('btn-start').onclick = () => { $('modal').hidden = true; G.paused = false; };

document.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT' && ev.target.type !== 'range') return;
  if (ev.key === 'Escape') { G.placing = null; G.selected = null; }
  else if (ev.key === ' ') { ev.preventDefault(); if ($('modal').hidden) G.paused = !G.paused; }
  else if (['1', '2', '3', '4'].includes(ev.key)) switchTab(['tech', 'finance', 'civil', 'defense'][ev.key - 1]);
});

switchTab('civil');
