'use strict';
// ============================================================
//  基地守卫 —— 游戏逻辑与绘制
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = COLS * TILE;
canvas.height = ROWS * TILE;

const BLOCK = TILE * 0.6;   // 地面单位相互阻挡的距离
const TECH_BY_ID = Object.fromEntries(TECHS.map(t => [t.id, t]));
const HALL_X = (HALL.c + HALL.w / 2) * TILE;
const HALL_Y = (HALL.r + HALL.h / 2) * TILE;
const AIR_X = (AIR_START[0] + 0.5) * TILE;
const AIR_Y = (AIR_START[1] + 0.5) * TILE;

// ---------- 路径：用“沿路距离 s”表示地面单位的位置 ----------
const PATH = (() => {
  const pts = PATH_WAYPOINTS.map(([c, r]) => ({ x: (c + 0.5) * TILE, y: (r + 0.5) * TILE }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const cells = new Set();
  for (let i = 1; i < PATH_WAYPOINTS.length; i++) {
    const [c0, r0] = PATH_WAYPOINTS[i - 1], [c1, r1] = PATH_WAYPOINTS[i];
    const dc = Math.sign(c1 - c0), dr = Math.sign(r1 - r0);
    for (let c = c0, r = r0; ; c += dc, r += dr) {
      if (c >= 0 && r >= 0 && c < COLS && r < ROWS) cells.add(c + ',' + r);
      if (c === c1 && r === r1) break;
    }
  }
  return { pts, cum, total: cum[cum.length - 1], cells };
})();

function pathPos(s) {
  s = Math.max(0, Math.min(PATH.total, s));
  let i = 1;
  while (i < PATH.cum.length - 1 && PATH.cum[i] < s) i++;
  const a = PATH.pts[i - 1], b = PATH.pts[i], seg = PATH.cum[i] - PATH.cum[i - 1];
  const t = seg ? (s - PATH.cum[i - 1]) / seg : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ---------- 全局状态 ----------
const G = {};
let occ = [];

function newGame() {
  Object.assign(G, {
    gold: START.gold, pop: START.pop, supplies: START.supplies,
    taxRate: START.taxRate, researchBudget: START.researchBudget, defenseLine: START.defenseLine,
    hallHp: HALL.maxHp,
    wave: 0, phase: 'build', timer: FIRST_BUILD_PHASE, spawnQueue: [], spawnTimer: 0, hpScale: 1,
    speed: 1, paused: true, over: null,
    buildings: [], enemies: [], units: [], effects: [],
    techs: new Set(), research: null, bonds: [],
    dayTimer: 0, day: 0,
    placing: null, selected: null, hover: null,
    stats: {}, logs: [],
  });
  occ = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (const key of PATH.cells) { const [c, r] = key.split(',').map(Number); occ[r][c] = 'path'; }
  for (let r = HALL.r; r < HALL.r + HALL.h; r++) for (let c = HALL.c; c < HALL.c + HALL.w; c++) occ[r][c] = 'hall';
  recalcStats();
  log('市长就任！敌军将在 ' + FIRST_BUILD_PHASE + ' 秒后来袭，请抓紧备战。', 'info');
}

function log(text, type = '') {
  G.logs.unshift({ text, type, day: G.day });
  if (G.logs.length > 40) G.logs.pop();
}

const has = id => G.techs.has(id);
const count = key => G.buildings.reduce((n, b) => n + (b.key === key), 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const towerMult = () => 1 + 0.2 * (has('fort1') + has('fort2') + has('fort3'));
const gearMult = () => 1 + 0.2 * (has('gear1') + has('gear2'));

// ---------- 经济统计（每帧重算，开销很小） ----------
function recalcStats() {
  const S = G.stats;
  let demand = 0, maintenance = 0;
  for (const b of G.buildings) { demand += Math.max(0, -b.def.power); maintenance += b.def.upkeep; }
  S.powerSupply = HALL.power + count('plant') * BUILDINGS.plant.power * (has('grid') ? 1.25 : 1);
  S.powerDemand = demand;
  S.powerEff = demand <= 0 ? 1 : Math.min(1, S.powerSupply / demand);

  S.popCap = HALL.popCap + count('house') * 10;
  S.soldiers = G.units.reduce((n, u) => n + u.def.pop, 0);
  S.supplyCap = 100 + count('depot') * 150;
  S.supplyPerDay = count('factory') * 4 * (has('industry') ? 1.5 : 1) * S.powerEff;

  const markets = count('market');
  S.taxIncome = G.pop * TAX_PER_CAPITA * G.taxRate * (1 + 0.1 * markets + (has('tax') ? 0.15 : 0));
  S.marketIncome = markets * 3 * S.powerEff;
  S.income = S.taxIncome + S.marketIncome;

  S.maintenance = maintenance;
  S.wages = G.units.reduce((n, u) => n + u.def.upkeep, 0);
  S.bondPay = G.bonds.reduce((n, b) => n + b.payment, 0);
  S.researchSpend = G.gold >= 0 ? G.researchBudget : 0;
  S.expense = S.maintenance + S.wages + S.bondPay + S.researchSpend;
  S.net = S.income - S.expense;

  S.rpPerDay = HALL.rp + count('lab') * 2 * S.powerEff + S.researchSpend / 10;

  S.happiness = clamp(Math.round(
    70 - (G.taxRate * 100 - 15) * 1.5
    + count('park') * 6
    - (S.powerEff < 1 ? 5 + 25 * (1 - S.powerEff) : 0)
    - (G.gold < 0 ? 20 : 0)
    - (G.hallHp < HALL.maxHp * 0.5 ? 10 : 0)
    - (G.pop + S.soldiers > S.popCap ? 15 : 0)
  ), 0, 100);

  S.room = S.popCap - G.pop - S.soldiers;
  S.growth = 0;
  if (S.room < 0) S.growth = Math.max(S.room, -3);
  else if (S.happiness >= 50 && S.room > 0) S.growth = Math.min(S.room, Math.max(1, Math.round(S.room * 0.06 * (S.happiness - 40) / 60)));
  else if (S.happiness < 30 && G.pop > MIN_CIVILIANS) S.growth = S.happiness < 15 ? -2 : -1;
}

function dayTick() {
  const S = G.stats;
  G.gold += S.net;
  for (const b of G.bonds) b.days--;
  G.bonds = G.bonds.filter(b => b.days > 0);
  G.supplies = Math.min(S.supplyCap, G.supplies + S.supplyPerDay);
  G.pop = Math.max(MIN_CIVILIANS, G.pop + S.growth);

  if (G.research) {
    G.research.progress += S.rpPerDay;
    const t = TECH_BY_ID[G.research.id];
    if (G.research.progress >= t.rp) {
      G.techs.add(t.id);
      G.research = null;
      log('科技部：「' + t.name + '」研发完成！', 'good');
    }
  }
  if (G.gold < 0 && G.day % 5 === 0) log('财政部警告：国库赤字！民心下降，科研拨款冻结。', 'bad');
  G.day++;
}

// ---------- 行动：建造 / 研发 / 征兵 / 财政 ----------
function canAfford(gold, sup = 0) { return G.gold >= gold && G.supplies >= sup; }

function techState(t) {
  if (has(t.id)) return 'done';
  if (G.research && G.research.id === t.id) return 'active';
  if (t.req.some(r => !has(r))) return 'locked';
  return 'ready';
}

function startResearch(id) {
  const t = TECH_BY_ID[id];
  if (!t || techState(t) !== 'ready' || G.research) return;
  G.research = { id, progress: 0 };
  log('科技部：开始研发「' + t.name + '」。');
}

function cancelResearch() {
  if (!G.research) return;
  log('科技部：已中止「' + TECH_BY_ID[G.research.id].name + '」的研发，进度清零。');
  G.research = null;
}

function recruitCheck(key) {
  const d = UNITS[key];
  if (d.tech && !has(d.tech)) return '需要科技部研发「' + TECH_BY_ID[d.tech].name + '」';
  if (G.pop - d.pop < MIN_CIVILIANS) return '可征召人口不足';
  if (G.gold < d.gold) return '资金不足';
  if (G.supplies < d.supplies) return '军需不足';
  return true;
}

function recruit(key) {
  if (recruitCheck(key) !== true) return;
  const d = UNITS[key];
  G.gold -= d.gold; G.supplies -= d.supplies; G.pop -= d.pop;
  const m = gearMult();
  const u = {
    key, def: d, hp: d.hp * m, maxHp: d.hp * m, dmgMult: m, cd: 0, angle: Math.PI,
    s: PATH.total, slot: (Math.random() - 0.5) * TILE * 1.2,
    ox: (Math.random() - 0.5) * 14, oy: (Math.random() - 0.5) * 14,
    x: HALL_X, y: HALL_Y,
  };
  G.units.push(u);
}

function issueBond() {
  if (G.bonds.length >= BOND.maxActive) return;
  G.gold += BOND.amount;
  G.bonds.push({ payment: BOND.payment, days: BOND.days });
  log('财政部：发行战争债券 +' + BOND.amount + '，未来 ' + BOND.days + ' 天每日还款 ' + BOND.payment + '。');
}

function placeCheck(spec) {
  const d = spec.kind === 'tower' ? TOWERS[spec.key] : BUILDINGS[spec.key];
  if (d.tech && !has(d.tech)) return '需要科技部研发「' + TECH_BY_ID[d.tech].name + '」';
  if (G.gold < d.cost) return '资金不足';
  if (d.supplies && G.supplies < d.supplies) return '军需不足';
  return true;
}

function startPlacing(kind, key) {
  if (placeCheck({ kind, key }) !== true) return;
  G.placing = { kind, key };
  G.selected = null;
}

function tryPlace(c, r) {
  const spec = G.placing;
  if (!spec || placeCheck(spec) !== true) { G.placing = null; return false; }
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS || occ[r][c]) return false;
  const d = spec.kind === 'tower' ? TOWERS[spec.key] : BUILDINGS[spec.key];
  G.gold -= d.cost;
  if (d.supplies) G.supplies -= d.supplies;
  const b = { kind: spec.kind, key: spec.key, def: d, c, r, x: (c + 0.5) * TILE, y: (r + 0.5) * TILE, cd: 0, angle: 0, target: null };
  G.buildings.push(b);
  occ[r][c] = b;
  addEffect({ type: 'boom', x: b.x, y: b.y, r: TILE * 0.6, t: 0.3, max: 0.3, color: '#ffffff' });
  return true;
}

function sellSelected() {
  const b = G.selected;
  if (!b || !G.buildings.includes(b)) return;
  const refundGold = Math.floor(b.def.cost / 2), refundSup = Math.floor((b.def.supplies || 0) / 2);
  G.gold += refundGold;
  G.supplies = Math.min(G.stats.supplyCap, G.supplies + refundSup);
  G.buildings.splice(G.buildings.indexOf(b), 1);
  occ[b.r][b.c] = null;
  G.selected = null;
  log('拆除「' + b.def.name + '」，回收资金 ' + refundGold + (refundSup ? '、军需 ' + refundSup : '') + '。');
}

// ---------- 波次 ----------
function makeWave(n) {
  const list = [];
  const add = (type, k) => { for (let i = 0; i < k; i++) list.push(type); };
  add('militia', 6 + n * 2);
  if (n >= 2) add('assault', Math.floor(n * 1.5));
  if (n >= 4) add('apc', n - 3);
  if (n >= 6) add('heli', Math.floor((n - 4) / 2) + (n >= 12 ? 2 : 0));
  if (n >= 7) add('tank', n - 6);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (n % 10 === 0) list.push('boss');
  return list;
}

function startWave() {
  if (G.phase !== 'build' || G.over) return;
  if (G.wave > 0 && G.timer > 1) {
    const bonus = Math.floor(G.timer * 2);
    G.gold += bonus;
    log('提前开战，获得奖励 ' + bonus + ' 金。');
  }
  G.wave++;
  G.phase = 'wave';
  G.spawnQueue = makeWave(G.wave);
  G.spawnTimer = 0;
  G.hpScale = 1 + 0.15 * (G.wave - 1) + 0.03 * (G.wave - 1) ** 2;
  log('第 ' + G.wave + ' 波敌军来袭！共 ' + G.spawnQueue.length + ' 个单位' + (G.wave % 10 === 0 ? '，含重型攻城坦克！' : '。'), 'bad');
}

function endWave() {
  const bonus = 50 + 10 * G.wave;
  G.gold += bonus;
  log('第 ' + G.wave + ' 波已击退，战后拨款 ' + bonus + ' 金。', 'good');
  if (G.wave >= MAX_WAVES) { G.over = 'win'; return; }
  G.phase = 'build';
  G.timer = BUILD_PHASE;
}

function spawnEnemy(type) {
  const d = ENEMIES[type];
  const hp = d.hp * G.hpScale;
  const e = { type, def: d, hp, maxHp: hp, atkCd: 0, s: 0, x: 0, y: 0, progress: 0, rot: 0 };
  if (d.air) { e.x = AIR_X; e.y = AIR_Y + (Math.random() - 0.5) * TILE * 3; e.startDist = Math.hypot(HALL_X - e.x, HALL_Y - e.y); }
  else Object.assign(e, pathPos(0));
  G.enemies.push(e);
}

// ---------- 战斗 ----------
function addEffect(fx) { G.effects.push(fx); }

function hurt(target, raw, pierce = false) {
  const dmg = pierce ? raw : Math.max(raw * 0.2, raw - target.def.armor);
  target.hp -= dmg;
}

function canHit(attacker, e) { return e.def.air ? attacker.hitsAir : attacker.hitsGround; }

function pickTarget(from, rangePx, filter) {
  let best = null;
  for (const e of G.enemies) {
    if (e.hp <= 0 || !filter(e) || dist(from, e) > rangePx) continue;
    if (!best || e.progress > best.progress) best = e;
  }
  return best;
}

function splashAt(x, y, radius, raw) {
  for (const e of G.enemies) {
    if (!e.def.air && e.hp > 0 && Math.hypot(e.x - x, e.y - y) <= radius) hurt(e, raw);
  }
  addEffect({ type: 'boom', x, y, r: radius, t: 0.35, max: 0.35, color: '#ffb040' });
}

function updateTowers(dt) {
  const eff = G.stats.powerEff, mult = towerMult();
  for (const t of G.buildings) {
    if (t.kind !== 'tower') continue;
    const d = t.def, p = d.power < 0 ? eff : 1, range = d.range * TILE;
    const filter = e => (e.def.air ? d.air : d.ground);
    if (d.dps) {
      if (!t.target || t.target.hp <= 0 || dist(t, t.target) > range) t.target = pickTarget(t, range, filter);
      if (t.target) {
        hurt(t.target, d.dps * mult * p * dt, true);
        t.angle = Math.atan2(t.target.y - t.y, t.target.x - t.x);
      }
      continue;
    }
    t.cd -= dt * p;
    if (t.cd > 0) continue;
    const e = pickTarget(t, range, filter);
    if (!e) continue;
    t.cd = d.cd;
    t.angle = Math.atan2(e.y - t.y, e.x - t.x);
    if (d.splash) splashAt(e.x, e.y, d.splash * TILE, d.dmg * mult);
    else hurt(e, d.dmg * mult);
    addEffect({ type: 'line', x1: t.x, y1: t.y, x2: e.x, y2: e.y, color: d.color, t: 0.08, max: 0.08, w: d.splash ? 3 : 1.5 });
  }
}

function unitPost(u) {
  return clamp(PATH.total * (1 - G.defenseLine) + u.slot, 0, PATH.total);
}

function nearestEnemy(from, rangePx, filter) {
  let best = null, bd = rangePx;
  for (const e of G.enemies) {
    if (e.hp <= 0 || !filter(e)) continue;
    const dd = dist(from, e);
    if (dd <= bd) { bd = dd; best = e; }
  }
  return best;
}

function updateUnits(dt) {
  for (const u of G.units) {
    const d = u.def, range = d.range * TILE;
    u.cd -= dt;
    const filter = e => canHit(d, e);
    let target = nearestEnemy(u, range, filter);

    if (d.air) {
      const post = pathPos(unitPost(u));
      const chase = nearestEnemy(post, TILE * 6, filter);
      const goal = chase ? (dist(u, chase) > range * 0.7 ? chase : null) : post;
      if (goal) {
        const dd = dist(u, goal);
        if (dd > 4) {
          const step = Math.min(dd, d.speed * TILE * dt);
          u.angle = Math.atan2(goal.y - u.y, goal.x - u.x);
          u.x += Math.cos(u.angle) * step; u.y += Math.sin(u.angle) * step;
        }
      }
    } else {
      const blocked = G.enemies.some(e => !e.def.air && e.hp > 0 && e.s <= u.s && u.s - e.s < BLOCK);
      if (!target && !blocked) {
        const goal = unitPost(u), diff = goal - u.s;
        if (Math.abs(diff) > 1) u.s += Math.sign(diff) * Math.min(Math.abs(diff), d.speed * TILE * dt);
      }
      const p = pathPos(u.s);
      u.x = p.x + u.ox; u.y = p.y + u.oy;
    }

    if (target && u.cd <= 0) {
      u.cd = d.cd;
      u.angle = Math.atan2(target.y - u.y, target.x - u.x);
      const dmg = d.dmg * u.dmgMult;
      if (d.splash) splashAt(target.x, target.y, d.splash * TILE, dmg);
      else hurt(target, dmg);
      addEffect({ type: 'line', x1: u.x, y1: u.y, x2: target.x, y2: target.y, color: '#9fd0ff', t: 0.06, max: 0.06, w: d.splash ? 3 : 1 });
    }
  }
}

function hitHall(e) {
  G.hallHp -= e.def.dmgHall;
  addEffect({ type: 'boom', x: HALL_X, y: HALL_Y, r: TILE, t: 0.4, max: 0.4, color: '#ff4040' });
  e.hp = 0; e.leaked = true;
  if (G.hallHp <= 0) { G.hallHp = 0; G.over = 'lose'; log('市政厅陷落……', 'bad'); }
}

function updateEnemies(dt) {
  for (const e of G.enemies) {
    if (e.hp <= 0) continue;
    const d = e.def;
    let blocker = null;
    if (d.air) {
      const dd = Math.hypot(HALL_X - e.x, HALL_Y - e.y);
      if (dd < TILE * 1.1) { hitHall(e); continue; }
      const step = d.speed * TILE * dt;
      e.x += (HALL_X - e.x) / dd * step; e.y += (HALL_Y - e.y) / dd * step;
      e.rot += dt * 20;
      e.progress = 1 - dd / e.startDist;
    } else {
      blocker = G.units.find(u => !u.def.air && u.s >= e.s && u.s - e.s < BLOCK) || null;
      if (!blocker) e.s += d.speed * TILE * dt;
      if (e.s >= PATH.total) { hitHall(e); continue; }
      Object.assign(e, pathPos(e.s));
      e.progress = e.s / PATH.total;
    }
    e.atkCd -= dt;
    if (e.atkCd > 0) continue;
    let target = blocker;
    if (!target) {
      let bd = d.atkRange * TILE;
      for (const u of G.units) {
        if (u.def.air && !d.air) continue;   // 地面部队打不到飞机
        const dd = dist(e, u);
        if (dd <= bd) { bd = dd; target = u; }
      }
    }
    if (target) {
      e.atkCd = 1;
      hurt(target, d.atk);
      addEffect({ type: 'line', x1: e.x, y1: e.y, x2: target.x, y2: target.y, color: '#ff6060', t: 0.06, max: 0.06, w: 1 });
    }
  }
}

function cleanup() {
  for (const e of G.enemies) {
    if (e.hp <= 0 && !e.leaked) {
      G.gold += e.def.reward;
      addEffect({ type: 'text', x: e.x, y: e.y - 10, text: '+' + e.def.reward, color: '#ffd84a', t: 0.8, max: 0.8 });
    }
  }
  G.enemies = G.enemies.filter(e => e.hp > 0);
  const before = G.units.length;
  G.units = G.units.filter(u => u.hp > 0);
  const lost = before - G.units.length;
  if (lost > 0) log('国防部：' + lost + ' 支部队阵亡。', 'bad');
  if (G.selected && !G.buildings.includes(G.selected)) G.selected = null;
}

function update(dt) {
  if (G.over) return;
  recalcStats();
  G.dayTimer += dt;
  while (G.dayTimer >= DAY_SECONDS) { G.dayTimer -= DAY_SECONDS; dayTick(); }

  if (G.phase === 'build') {
    G.timer -= dt;
    if (G.timer <= 0) startWave();
  } else {
    G.spawnTimer -= dt;
    if (G.spawnQueue.length && G.spawnTimer <= 0) {
      spawnEnemy(G.spawnQueue.shift());
      G.spawnTimer = Math.max(0.4, 0.9 - G.wave * 0.02);
    }
  }

  updateTowers(dt);
  updateUnits(dt);
  updateEnemies(dt);
  cleanup();

  for (const fx of G.effects) fx.t -= dt;
  G.effects = G.effects.filter(fx => fx.t > 0);

  if (G.phase === 'wave' && !G.spawnQueue.length && !G.enemies.length && !G.over) endWave();
}

// ---------- 绘制 ----------
function render() {
  ctx.fillStyle = '#1b2a1d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * TILE + 0.5, 0); ctx.lineTo(c * TILE + 0.5, canvas.height); ctx.stroke(); }
  for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * TILE + 0.5); ctx.lineTo(canvas.width, r * TILE + 0.5); ctx.stroke(); }

  for (const key of PATH.cells) {
    const [c, r] = key.split(',').map(Number);
    ctx.fillStyle = '#5a4930';
    ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
  }
  ctx.strokeStyle = 'rgba(255,230,180,0.15)';
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  PATH.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);

  drawDefenseLine();
  drawHall();
  for (const b of G.buildings) drawBuilding(b);
  for (const u of G.units) if (!u.def.air) drawUnit(u);
  for (const e of G.enemies) if (!e.def.air) drawEnemy(e);
  for (const u of G.units) if (u.def.air) drawUnit(u);
  for (const e of G.enemies) if (e.def.air) drawEnemy(e);
  drawLasers();
  drawEffects();
  drawGhost();
  drawOverlay();
}

function hpBar(x, y, w, frac, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - w / 2, y, w, 4);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 4);
}

function drawDefenseLine() {
  const p = pathPos(PATH.total * (1 - G.defenseLine));
  ctx.strokeStyle = '#6fa8ff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 22); ctx.stroke();
  ctx.fillStyle = '#6fa8ff';
  ctx.beginPath(); ctx.moveTo(p.x, p.y - 22); ctx.lineTo(p.x + 12, p.y - 17); ctx.lineTo(p.x, p.y - 12); ctx.fill();
}

function drawHall() {
  const x = HALL.c * TILE, y = HALL.r * TILE, w = HALL.w * TILE, h = HALL.h * TILE;
  ctx.fillStyle = '#3d4f6e';
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  ctx.fillStyle = '#5f7aa8';
  ctx.beginPath(); ctx.moveTo(x + 6, y + 26); ctx.lineTo(x + w / 2, y + 6); ctx.lineTo(x + w - 6, y + 26); ctx.fill();
  ctx.fillStyle = '#d8e2f5';
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 14 + i * 15, y + 32, 6, 34);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('市政厅', x + w / 2, y + h + 12);
  hpBar(x + w / 2, y - 8, w - 8, G.hallHp / HALL.maxHp, G.hallHp > 50 ? '#5fd35f' : '#ff5050');
}

function drawBuilding(b) {
  const x = b.c * TILE, y = b.r * TILE, d = b.def;
  if (b.kind === 'tower') {
    ctx.fillStyle = '#2b3138';
    ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e8eef5';
    ctx.lineWidth = b.key === 'cannon' ? 6 : 3;
    ctx.beginPath(); ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x + Math.cos(b.angle) * 16, b.y + Math.sin(b.angle) * 16); ctx.stroke();
  } else {
    ctx.fillStyle = d.color;
    ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + 3, y + TILE - 9, TILE - 6, 6);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.icon, b.x, b.y - 1);
    ctx.textBaseline = 'alphabetic';
  }
  if (d.power < 0 && G.stats.powerEff < 1) {
    ctx.fillStyle = '#ff4040';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('⚡', x + TILE - 8, y + 12);
  }
  if (G.selected === b) {
    ctx.strokeStyle = '#ffe14a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
    if (b.kind === 'tower') rangeCircle(b.x, b.y, d.range * TILE, 'rgba(255,225,74,0.6)');
  }
}

function rangeCircle(x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.08)');
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

function drawUnit(u) {
  const d = u.def;
  ctx.save();
  ctx.translate(u.x, u.y);
  if (u.key === 'fighter') {
    ctx.rotate(u.angle);
    ctx.fillStyle = '#9fd8ff';
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -9); ctx.lineTo(-4, 0); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
  } else if (u.key === 'tank') {
    ctx.fillStyle = '#3d7fd6';
    ctx.fillRect(-10, -8, 20, 16);
    ctx.rotate(u.angle);
    ctx.strokeStyle = '#cfe3ff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, 0); ctx.stroke();
  } else {
    ctx.fillStyle = u.key === 'elite' ? '#2f6fd0' : '#6fa8ff';
    ctx.beginPath(); ctx.arc(0, 0, d.r, 0, Math.PI * 2); ctx.fill();
    if (u.key === 'elite') { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  ctx.restore();
  if (u.hp < u.maxHp) hpBar(u.x, u.y - d.r - 7, 18, u.hp / u.maxHp, '#6fb8ff');
}

function drawEnemy(e) {
  const d = e.def;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.fillStyle = d.color;
  if (e.type === 'apc' || e.type === 'tank' || e.type === 'boss') {
    ctx.fillRect(-d.r, -d.r * 0.75, d.r * 2, d.r * 1.5);
    if (e.type !== 'apc') {
      ctx.fillStyle = '#2a0a0a';
      ctx.beginPath(); ctx.arc(0, 0, d.r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  } else if (d.air) {
    ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
    ctx.rotate(e.rot);
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.moveTo(0, -14); ctx.lineTo(0, 14); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(0, 0, d.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  hpBar(e.x, e.y - d.r - 8, Math.max(16, d.r * 2), e.hp / e.maxHp, '#ff5050');
}

function drawLasers() {
  for (const t of G.buildings) {
    if (t.kind !== 'tower' || !t.def.dps || !t.target || t.target.hp <= 0) continue;
    ctx.strokeStyle = t.def.color;
    ctx.lineWidth = 2 + Math.random() * 2;
    ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.target.x, t.target.y); ctx.stroke();
  }
}

function drawEffects() {
  for (const fx of G.effects) {
    const a = fx.t / fx.max;
    ctx.globalAlpha = a;
    if (fx.type === 'line') {
      ctx.strokeStyle = fx.color; ctx.lineWidth = fx.w;
      ctx.beginPath(); ctx.moveTo(fx.x1, fx.y1); ctx.lineTo(fx.x2, fx.y2); ctx.stroke();
    } else if (fx.type === 'boom') {
      ctx.strokeStyle = fx.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.r * (1.2 - a * 0.6), 0, Math.PI * 2); ctx.stroke();
    } else if (fx.type === 'text') {
      ctx.fillStyle = fx.color; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(fx.text, fx.x, fx.y - (1 - a) * 18);
    }
  }
  ctx.globalAlpha = 1;
}

function drawGhost() {
  if (!G.placing || !G.hover) return;
  const { c, r } = G.hover;
  const ok = c >= 0 && r >= 0 && c < COLS && r < ROWS && !occ[r][c];
  const d = G.placing.kind === 'tower' ? TOWERS[G.placing.key] : BUILDINGS[G.placing.key];
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = ok ? (d.color || '#fff') : '#ff3030';
  ctx.fillRect(c * TILE + 3, r * TILE + 3, TILE - 6, TILE - 6);
  ctx.globalAlpha = 1;
  if (G.placing.kind === 'tower') rangeCircle((c + 0.5) * TILE, (r + 0.5) * TILE, d.range * TILE, ok ? 'rgba(255,255,255,0.5)' : 'rgba(255,60,60,0.5)');
}

function drawOverlay() {
  if (!G.over && !G.paused) return;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 40px sans-serif';
  const title = G.over === 'win' ? '胜利！城市守住了' : G.over === 'lose' ? '市政厅陷落' : '已暂停';
  ctx.fillText(title, canvas.width / 2, canvas.height / 2);
  ctx.font = '16px sans-serif';
  const sub = G.over ? '坚守到第 ' + G.wave + ' 波 · 点击右上角「重新开始」再来一局' : '按空格键或点击「继续」恢复';
  ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 34);
}

// ---------- 输入 ----------
function tileFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * canvas.width / rect.width;
  const y = (ev.clientY - rect.top) * canvas.height / rect.height;
  return { c: Math.floor(x / TILE), r: Math.floor(y / TILE) };
}

canvas.addEventListener('mousemove', ev => { G.hover = tileFromEvent(ev); });
canvas.addEventListener('mouseleave', () => { G.hover = null; });
canvas.addEventListener('contextmenu', ev => { ev.preventDefault(); G.placing = null; G.selected = null; });
canvas.addEventListener('click', ev => {
  if (G.over) return;
  const { c, r } = tileFromEvent(ev);
  if (G.placing) {
    // 按住 Shift 可连续建造
    if (tryPlace(c, r) && !ev.shiftKey) G.placing = null;
    return;
  }
  const cell = occ[r] && occ[r][c];
  G.selected = cell && typeof cell === 'object' ? cell : null;
});

// ---------- 主循环 ----------
let lastTime = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (!G.paused && !G.over) for (let i = 0; i < G.speed; i++) update(dt);
  else recalcStats();
  render();
  if (typeof onFrameUI === 'function') onFrameUI(dt);
  requestAnimationFrame(frame);
}

newGame();
requestAnimationFrame(frame);
