'use strict';
/* ================= CONFIG (all balance lives here) ================= */
const CFG = {
  W: 360, H: 640,            // logical resolution (portrait)
  ballR: 7, ballSpeed: 235,  // px/s, constant fall speed
  ballScreenY: 440,          // where the ball sits on screen
  ringR: 70, ringW: 7,
  freezeDur: 0.13, cooldown: 0.40,   // test values (was 0.18 / 0.35)
  gateFreezeMult: 1.6,       // gates hold longer: crossing a barrier takes ~0.09s, a 0.13s hold would leave a ~0.04s tap window
  step: 1 / 120,             // fixed physics step
  firstRing: 520,
  rampRings: 30, maxLevel: 6,  // level = obstacles passed / rampRings, capped at maxLevel: level 1 ~ 35s, 2 ~ 65s, 3 ~ 100s of play. Pure function of progress => can only grow
  typeAdj: { tandem: { om: 0.65, op: 1.3 }, double: { om: 0.8, op: 1.18 }, gate: { om: 0.7, op: 1.2 }, pulse: { om: 0.88, op: 1.08 }, bob: { om: 0.88, op: 1.08 }, rev: { om: 0.95, op: 1.04 } },   // per-type fairness calibration: opening / speed multipliers so the type's target is actually solvable (no silent easing)
  intensity: 0.25,           // a hot phrase plays at baseline+0.25 levels, a recovery phrase at baseline-0.25: waves ON TOP of a rising baseline, never a reset
  prog: {                    // THE difficulty curves: values at level [0..6], linear between. Every parameter is monotone; one that flattens has reached its fair limit (the validator proves what is solvable)
    openDeg: [90, 70, 66, 64, 63, 63, 63],          // opening width per gap (deg) - tracks the fair frontier: narrower openings cannot be paired with faster rotation
    omega: [1.0, 1.15, 1.18, 1.2, 1.2, 1.2, 1.2],   // base rotation speed (rad/s)
    edgeGap: [150, 80, 62, 50, 45, 41, 38],         // CLEAR distance between consecutive obstacles (px) - density rises as this falls
    fastShare: [0, 0.2, 0.3, 0.4, 0.45, 0.5, 0.5],  // share of fast rings
    slowMult: [0.8, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85], fastMult: [1.1, 1.15, 1.15, 1.15, 1.15, 1.15, 1.15],
    tapMin: [0.30, 0.13, 0.10, 0.08, 0.07, 0.06, 0.05]   // smallest tap window (s) a ring may offer
  },
  omegaMin: 0.6, omegaMax: 3.0,                       // hard limits on rotation speed (rad/s)
  classOpen: [0.95, 1, 1.16],                         // opening multiplier per speed class: slow = narrow PRECISION ring, fast = wide REACTION ring, so every class is equally hard
  slowShare: 0.2, minEdgeGap: 36,                    // share of slow rings; hard floor for the clear distance between obstacles (px)
  noFreeBelow: 0.2,          // above this difficulty a ring must need a tap (cannot be passed by doing nothing)
  attempts: 30,              // generate-and-validate tries per obstacle
  safety: 0.08, nearMiss: 4, // safety margin (rad) / near-miss clearance (px)
  mult: [[0, 1], [5, 2], [10, 3], [20, 4], [35, 5]],  // [streak, multiplier]
  milestones: [5, 10, 20, 35],
  perfectQ: 0.4, perfectBonus: 2, goldBonus: 5,   // goldBonus: extra for a PERFECT pass of a rare GOLD ring
  nearBonus: 1,   // near miss (survived with < nearMiss px): flat +1, combo resets
    // precision pass = clearance >= 40% of the opening's best-case clearance; +2 bonus
  colors: ['#3df0ff', '#7c9bff', '#ff5fd2', '#b6ff5c', '#ffd24d', '#ffffff'],
  unlock: [0, 10, 25, 45, 70, 100]          // best score needed per ball colour
};
const { W, H } = CFG, PI = Math.PI, TAU = PI * 2, STEP = CFG.step;
const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RC = ['#3df0ff', '#9a7bff', '#ff5fd2'];
const $ = id => document.getElementById(id);
/* ---- stages: which obstacle types exist, opening width (deg) and rotation (rad/s) ranges, theme ---- */
const UNLOCK = ['std', 'rev', 'breathe', 'gate', 'swing', 'pulse', 'double', 'bob', 'surge', 'tandem'];   // one new behaviour per phase, in this order; the pool only ever grows
const PNAMES = ['FLOW', 'SHIFT', 'BREATHE', 'SLIDE', 'SWING', 'PULSE', 'ECHO', 'BOB', 'SURGE', 'CROSS'];
const THEMES = [
  { col: ['#3df0ff', '#5aa7ff', '#3df0ff'], bg: '#0b1030' }, { col: ['#8f7bff', '#b07cff', '#8f7bff'], bg: '#120b30' },
  { col: ['#3df0c8', '#3df0ff', '#5aa7ff'], bg: '#08201f' }, { col: ['#ff9a5f', '#ffd24d', '#ff7ab0'], bg: '#2a1208' }, { col: ['#ff5fd2', '#ff4d6d', '#b46bff'], bg: '#2a0820' }
];
const STAGES = Array.from({ length: 70 }, (_, i) => Object.assign({ name: i < PNAMES.length ? PNAMES[i] : 'OVERDRIVE ' + (i - PNAMES.length + 1), len: i < 10 ? 6 : 8,
  types: UNLOCK.slice(0, Math.min(UNLOCK.length, i + 1)) }, THEMES[i % THEMES.length]));   // phases = theme + unlocks; difficulty numbers live in CFG.prog
const TC = { swing: '#5cc8ff', surge: '#c6ff5c', bob: '#ff8a5c', tandem: '#ffe066', rev: '#ffb347', breathe: '#7dffb0', pulse: '#c08bff', double: '#ff7ad9', gate: '#ff5f8a' };   // type colour coding
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
let rnd = Math.random;
const DEBUG = typeof location !== 'undefined' && (/[?&]debug/.test(location.search) || (() => { try { return localStorage.getItem('snapshot.debug') === '1'; } catch (e) { return false; } })());  // dev overlay: add ?debug to the URL                                   // replaced by a seeded generator every run
function dailySeed() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

/* ================= PERSISTENCE ================= */
const Store = {
  d: { best: 0, bestStreak: 0, mute: false, color: 0, daily: { date: 0, best: 0 } },
  load() { try { Object.assign(this.d, JSON.parse(localStorage.getItem('snapshot.v1') || '{}')); } catch (e) {} },
  save() { try { localStorage.setItem('snapshot.v1', JSON.stringify(this.d)); } catch (e) {} }
};

/* ================= AUDIO (procedural) ================= */
const Snd = {
  ctx: null,
  init() {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    if (!this.ctx) try { this.ctx = new A(); } catch (e) { return; }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, f2, d, type, v, delay) {
    const c = this.ctx; if (!c || Store.d.mute) return;
    const t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v || 0.06, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.02);
  },
  freeze() { this.tone(480, 820, 0.09, 'sine', 0.05); },
  pass(s) { this.tone(520 + Math.min(s, 12) * 40, 0, 0.1, 'triangle', 0.07); },
  milestone() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0, 0.18, 'triangle', 0.07, i * 0.06)); },
  near() { this.tone(900, 1200, 0.05, 'sine', 0.03); },
  hit() { this.tone(240, 50, 0.4, 'sawtooth', 0.09); this.tone(90, 40, 0.3, 'square', 0.05); }
};

/* ================= PARTICLES (fixed pool, no allocation at runtime) ================= */
const P = []; for (let i = 0; i < 220; i++) P.push({ a: 0, x: 0, y: 0, vx: 0, vy: 0, l: 0, m: 1, s: 2, c: '#fff' });
let pIdx = 0;
function emit(x, y, vx, vy, l, s, c) {
  const p = P[pIdx]; pIdx = (pIdx + 1) % P.length;
  p.a = 1; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.l = p.m = l; p.s = s; p.c = c;
}
function burst(x, y, n, sp, l, c) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = sp * (0.4 + Math.random() * 0.6);
    emit(x, y, Math.cos(a) * v, Math.sin(a) * v, l * (0.6 + Math.random() * 0.4), 1.5 + Math.random() * 2, c);
  }
}

/* ================= GAME STATE ================= */
const G = {
  state: 'MENU', ball: { y: 0 }, rings: [], lastCy: 0, n: 0, prevDir: 1,
  score: 0, streak: 0, bestStreak: 0, mult: 1,
  sync: true, job: null, clock: 0, shake: 0, flash: 0, pulse: 1, banner: null, dieT: 0, overAt: 0, tapped: false
};
const activeRing = () => { for (const r of G.rings) if (!r.done) return r; return null; };
const multFor = s => { let m = 1; for (const [k, v] of CFG.mult) if (s >= k) m = v; return m; };

/* ---- obstacle generation: every type is built to be beatable (<=1 freeze; gates need one well-timed freeze) ---- */
const LABEL = { swing: 'SWINGS', surge: 'SPEED SHIFTS', bob: 'BOBS', tandem: 'TANDEM: ONE FREEZE, TWO GAPS', rev: 'REVERSES', breathe: 'GAP BREATHES', pulse: 'RING PULSES', double: 'DOUBLE RING', gate: 'MOVING GATE' };
const hardT = t => t === 'double' || t === 'gate' || t === 'tandem' || t === 'bob';
function stageOf(n) { let k = n; for (let i = 0; i < STAGES.length; i++) { if (k < STAGES[i].len) return [i, k]; k -= STAGES[i].len; } return [STAGES.length - 1, k]; }
function mkLayer(R, g, sf, w, x1, T1, rv) {   // x1 = gap-axis error (rad, in rotation direction) when the ball reaches the top rim
  const w0 = rv ? -sf * w : sf * w, tf = rv ? T1 - 0.9 : T1;           // reversing rings flip 0.9s before the ball arrives
  return { R0: R, R, g, gmin: g, gamp: 0, gph: 0, gk: 0, ramp: 0, rph: 0, rk: 0, w: w0, ang: PI / 2 + sf * x1 - (w0 * tf - w0 * (T1 - tf)) };
}
/* ---- difficulty curve: smoothstep ramp, with a recovery dip every 6th ring ---- */
const lvl = n => Math.min(CFG.maxLevel, n / CFG.rampRings);        // persistent progression level (0..3): a pure function of obstacles passed
const diff = n => Math.min(1, lvl(n));
const PR = (k, L) => { const a = CFG.prog[k], i = Math.min(a.length - 2, Math.floor(L)); return lerp(a[i], a[i + 1], Math.min(1, L - i)); };   // piecewise-linear knots
function modf(L, by) { return L.mo === 1 ? Math.cos(L.mph + by * 0.025) : 1 + 0.6 * Math.sin(L.mph + by * 0.025); }       // swing (alternating) / surge (speeding up and slowing) rotation
function anchor(L, target, T1) {                 // choose the start angle so the gap axis is where we want it when the ball reaches the ring
  let a = 0, by = genBy; const V = CFG.ballSpeed, end = genBy + T1 * V;
  while (by < end) { const st = Math.min(0.02, (end - by) / V); by += V * st; a += L.w * modf(L, by) * st; }
  L.ang = target - a;
}
const TIERS = ['EARLY', 'MID', 'ADVANCED', 'EXPERT', 'MASTER', 'LEGEND'], tierOf = L => TIERS[L < 0.5 ? 0 : L < 1 ? 1 : L < 2 ? 2 : L < 3 ? 3 : L < 4 ? 4 : 5];

/* ---- fairness validator: replays a candidate obstacle through the real motion + collision code for every possible tap time ---- */
const SIM_DT = 1 / 40, SIM_MARGIN = 7.5, TAU_STEP = 1 / 16;
function cloneRing(r) { return Object.assign({}, r, { layers: r.layers.map(L => Object.assign({}, L)), gate: r.gate && Object.assign({}, r.gate) }); }
function passes(base, by0, tau, dt = SIM_DT, margin = SIM_MARGIN) {              // survive if the freeze is pressed tau seconds from now (Infinity = never)?
  const r = cloneRing(base), V = CFG.ballSpeed, end = r.cy + r.reach + 2; let t = 0, by = by0, tapped = false;
  while (by < end) {
    if (!tapped && t >= tau && r.cd <= 0) { tapped = true; r.frz = r.fd; r.cd = CFG.cooldown; }
    by += V * dt; t += dt; stepRing(r, dt, by);
    if (Math.abs(by - r.cy) < r.reach + 6 && measure(r, by) < margin) return false;   // margin 7.5px at 5.9px sample spacing => a true clearance of >= ~4px (a clean pass)
  }
  return true;
}
function validate(r, ta) {                      // ta = when this ring becomes the active (freezable) one; returns tap-window width (s) + whether doing nothing passes
  const V = CFG.ballSpeed, dt = SIM_DT, tc = (r.cy - genBy) / V, lo = Math.max(ta, tc - 0.9), s = cloneRing(r), hi = tc + (r.tail || 0.05) - lo; let by = genBy, n = 0, any = false;
  const timeVarying = s.layers.some(L => L.mo);   // swing / surge integrate a changing speed: fast-forward them at the real step size or the error exceeds the opening
  for (let t = 0; t < lo;) { const st = (timeVarying || (s.revY && Math.abs(by - s.revY) < 60)) ? STEP : 0.1; by += V * st; stepRing(s, st, by); t += st; }   // coarse fast-forward, exact near a scheduled reversal
  const free = passes(s, by, Infinity);
  for (let tau = 0; tau < hi && !any; tau += 3 * TAU_STEP) any = passes(s, by, tau);   // coarse early-out: most rejected candidates have no winning tap at all
  if (!any && !free) return { win: 0, free };
  const stp = r.gate ? TAU_STEP / 2 : TAU_STEP;   // gates have a ~0.12s window, so they are scanned at twice the resolution
  for (let tau = 0; tau < hi; tau += stp) if (passes(s, by, tau)) n++;
  return { win: n * stp, free };
}
function build(o) {                             // one candidate obstacle
  const V = CFG.ballSpeed, R0 = CFG.ringR, bR = CFG.ballR;
  const r = { n: o.n, cy: o.cy, type: o.type, stage: o.si, stageStart: o.k === 0, done: false, frz: 0, cd: 0, minClear: 99, q: 9, layers: [], gate: null,
              revY: 0, fd: CFG.freezeDur, label: o.intro ? LABEL[o.type] : '', reach: R0 + CFG.ringW / 2 + bR };
  if (o.type === 'gate') {                      // sliding gap in a horizontal barrier, caught by one freeze as it crosses the ball's line
    const A = 84, gh = lerp(40, 27, o.d) * 0.85 * ((CFG.typeAdj.gate || {}).op || 1) + o.rx, om = clamp(lerp(1.0, 1.6, o.d) * (o.intro ? 0.75 : 1) * o.sp * ((CFG.typeAdj.gate || {}).om || 1), 0.6, CFG.omegaMax);
    const zt = Math.asin(Math.min(0.9, (gh - bR - 9) / A)) / om, dl = zt + 0.01 + 0.03 * rnd(), sg = rnd() < 0.5 ? 1 : -1, Tc = (o.cy - genBy) / V;
    r.fd = CFG.freezeDur * CFG.gateFreezeMult; r.gate = { A, gh, w: sg * om, th: -sg * om * (Tc - dl) }; r.reach = 4 + bR;
    return r;
  }
  if (o.type === 'tandem') {                   // two touching rings, opposite directions, ONE shared freeze: the ball crosses both gaps almost at once
    const Rt = 58, off = Rt + 5, g = o.g + 0.12, mk = (dy, dir, w, b) => { const L = mkLayer(Rt, g, dir, w, b * (g / 2 - 0.12), (o.cy + dy - Rt - genBy) / V, false); L.dy = dy; return L; };
    r.layers.push(mk(-off, o.dir, o.w, 0.25 + 0.6 * rnd()),                       // upper ring: gap already past vertical -> needs the freeze
                  mk(off, -o.dir, clamp(o.w * (0.6 + 0.8 * rnd()), CFG.omegaMin, CFG.omegaMax), -(0.2 + 0.6 * rnd())));   // lower ring: gap still arriving -> an early freeze hurts it
    r.reach = off + Rt + CFG.ringW / 2 + bR; r.top = off + Rt; r.tail = 0.5;
    return r;
  }
  const ramp = o.type === 'pulse' ? 0.10 : 0, T1 = (o.cy - R0 - genBy) / V, rv = o.type === 'rev', g = o.g;
  const x1 = (rnd() * 1.6 - 0.6) * (g / 2 - 0.12), L = mkLayer(R0, g, o.dir, o.w, x1, T1, rv); r.layers.push(L);
  if (rv) r.revY = genBy + V * (T1 - 0.9);
  if (o.type === 'breathe') { L.gamp = 0.5; L.gph = rnd() * TAU; L.gk = 0.025; }
  if (ramp) { L.ramp = ramp; L.rph = rnd() * TAU; L.rk = 0.03; r.reach = R0 * (1 + ramp) + CFG.ringW / 2 + bR; }
  if (o.type === 'swing' || o.type === 'surge') { L.mo = o.type === 'swing' ? 1 : 2; L.mph = rnd() * TAU; if (o.type === 'swing') L.w *= 1.3; anchor(L, PI / 2 + o.dir * x1, T1); }
  if (o.type === 'bob') { L.bob = { a: 22, k: 0.022, ph: rnd() * TAU }; r.reach += 22; }       // the whole ring drifts up and down while it rotates
  if (o.type === 'double') {
    const Ri = R0 * 0.58, wi = clamp(o.w * (0.7 + 0.6 * rnd()), CFG.omegaMin, CFG.omegaMax);
    r.layers.push(mkLayer(Ri, g, -o.dir, wi, (rnd() * 2 - 1) * (g / 2 - 0.2), T1 + (R0 - Ri) / V, false));
  }
  return r;
}
/* ---- run structure: seeded phrases (named multi-ring patterns), per-run profile, temporary modifiers ---- */
const PHRASES = [   // hand-made patterns. types = obstacles in order; cls = speed class per ring (0 slow,1 mid,2 fast); sp = spacing multiplier (<=1); rare = set piece; relief = recovery
  { id: 'STRAIGHT', types: ['std', 'std'], w: 1.5, min: 0 },
  { id: 'BREATHER', types: ['std'], cls: [0], relief: true, w: 1.5, min: 0 },
  { id: 'FLIP', types: ['std', 'rev'], w: 2.5, min: 6 },
  { id: 'SWITCHBACK', types: ['std', 'rev', 'std'], w: 2, min: 6 },
  { id: 'STAIRCASE', types: ['std', 'rev', 'std'], cls: [0, 1, 2], w: 1.5, min: 8 },
  { id: 'DESCENT', types: ['rev', 'std', 'std'], cls: [2, 1, 0], w: 1.5, min: 8 },
  { id: 'SQUEEZE', types: ['rev', 'std', 'rev'], cls: [1, 1, 1], sp: 0.8, w: 1.5, min: 10 },
  { id: 'TWIST', types: ['rev', 'breathe'], w: 2, min: 12 },
  { id: 'OPEN UP', types: ['breathe', 'std'], w: 2, min: 12 },
  { id: 'GATE RUN', types: ['std', 'gate', 'rev'], w: 1.5, min: 18 },
  { id: 'SWAY', types: ['swing', 'std'], w: 2, min: 24 },
  { id: 'PENDULUM', types: ['swing', 'rev', 'swing'], w: 1.5, min: 24 },
  { id: 'RELAY', types: ['swing', 'gate', 'breathe'], w: 1.2, min: 24 },
  { id: 'PULSER', types: ['pulse', 'rev'], w: 1.5, min: 30 },
  { id: 'RIPPLE', types: ['pulse', 'breathe'], w: 1.5, min: 30 },
  { id: 'ECHO', types: ['double', 'std'], w: 1.5, min: 36 },
  { id: 'HEAVE', types: ['bob', 'swing'], w: 2, min: 42 },
  { id: 'BOB & WEAVE', types: ['bob', 'std', 'bob'], w: 1.5, min: 42 },
  { id: 'SURGE PAIR', types: ['surge', 'rev'], w: 2, min: 48 },
  { id: 'THROTTLE', types: ['surge', 'breathe', 'surge'], w: 1.5, min: 48 },
  { id: 'CROSSING', types: ['tandem', 'rev'], cls: [1, 0], w: 1.5, min: 54 },
  { id: 'GRAND CROSSING', types: ['tandem', 'swing'], cls: [1, 0], w: 1.2, min: 54 },
  { id: 'GOLDEN', types: ['std'], cls: [0], gm: 0.82, gold: true, rare: true, w: 0.8, min: 10 },   // narrow + slow: a perfect pass pays big
  { id: 'TWIN GATES', types: ['gate', 'rev', 'gate'], rare: true, w: 0.6, min: 24 },
  { id: 'GAUNTLET', types: ['std', 'rev', 'std', 'rev'], cls: [2, 0, 2, 0], sp: 0.85, rare: true, w: 0.6, min: 28 }
];
const MODS = [      // temporary modifiers only ever ADD difficulty (and pay for it); none can widen openings, slow rings or spread obstacles
  { id: 'NARROW', gm: 0.88, om: 1, sp: 1, sm: 2, len: 4 },       // precision: tighter openings
  { id: 'RUSH', gm: 1, om: 1, sp: 0.85, sm: 1.5, len: 5 },       // reaction: closer obstacles
  { id: 'SURGE', gm: 1, om: 1.15, sp: 1, sm: 1.5, len: 4 }       // anticipation: faster rings
];
const PROFILES = [  // picked per run from the seed: which obstacles dominate (never how hard)
  { name: 'STEADY', wt: {}, sp: 1, om: 1 },
  { name: 'TWISTY', wt: { rev: 2.5, breathe: 2.5, pulse: 2.5, swing: 2.5, surge: 2.5 }, sp: 1, om: 1 },
  { name: 'TECHNICAL', wt: { gate: 2.5, double: 2.5, tandem: 2.5, bob: 2.5 }, sp: 1, om: 1 },
  { name: 'SPRINT', wt: {}, sp: 1, om: 1 }
];
const cxOf = p => p.types.length + p.types.filter(hardT).length + (p.rare ? 1 : 0);      // phrase complexity
const heavy = p => p.rare || p.types.length >= 3 || p.types.some(hardT);
const simil = (a, b) => { const m = Math.min(a.types.length, b.types.length); let s = 0; for (let i = 0; i < m; i++) if (a.types[i] === b.types[i]) s += (a.cls && b.cls && a.cls[i] !== b.cls[i]) ? 0.5 : 1; return s / Math.max(a.types.length, b.types.length); };   // 0..1 positional similarity of two patterns
function compose(st, n, L, need, full) {        // procedural pattern: random length, types drawn from the whole unlocked pool (least-recently-used favoured), speed template, tempo
  const pool = st.types, maxHard = full ? 0 : 1 + Math.floor(L / 1.2), types = [];
  const len = full ? 2 : 2 + (rnd() < Math.min(0.75, 0.25 + 0.25 * L) ? 1 : 0) + (L > 1.5 && rnd() < 0.4 ? 1 : 0) + (L > 3 && rnd() < 0.4 ? 1 : 0) + (L > 4.5 && rnd() < 0.4 ? 1 : 0); let hards = 0;
  for (let i = 0; i < len; i++) {
    const prev = types[i - 1];
    let ws = pool.map(t => (t === prev && pool.length > 1 ? 0 : (1 + 0.3 * Math.min(12, n - (G.lastUse[t] === undefined ? -12 : G.lastUse[t]))) * (G.prof.wt[t] || 1) * (t === 'std' ? 0.5 / (1 + 0.3 * Math.max(0, L - 2)) : 1) * (hardT(t) ? 1 + 0.2 * Math.max(0, L - 2) : 1)) * (hardT(t) && hards >= maxHard ? 0 : 1));
    if (!ws.some(w => w > 0)) ws = pool.map(t => t === 'std' ? 1 : 0);
    let x = rnd() * ws.reduce((a, b) => a + b, 0), j = 0; while (j < pool.length - 1 && (x -= ws[j]) > 0) j++;
    const t = (i === 0 && need) ? need : pool[j]; types.push(t); if (hardT(t)) hards++;
  }
  const tpl = (rnd() * 5) | 0, c = types.map((_, i) => tpl === 0 ? Math.min(2, i) : tpl === 1 ? Math.max(0, 2 - i) : tpl === 2 ? (i % 2 ? 2 : 0) : tpl === 3 ? 1 : (rnd() * 3) | 0);
  return { id: 'MIX ' + types.map(t => t.slice(0, 2).toUpperCase()).join('-'), types, cls: L < 0.3 ? c.map(v => Math.min(v, 1)) : c, sp: (!full && rnd() < Math.min(0.6, 0.1 + 0.15 * L)) ? (L > 3.5 ? 0.8 : 0.85) : 1, w: 1, min: 0 };
}
function nextSlot(st, k, n, Lraw) {
  const L = Math.min(Lraw, 6);                   // composer, chain length and modifier rates keep growing after the numeric curves saturate (level 3), up to level 6
  if (G.force) return { type: G.force, sp: 1, gm: 1, om: 1, int: 0 };
  if (st.types.length > G.nKnown) { G.nKnown = st.types.length; G.newType = st.types[st.types.length - 1]; }       // a phase unlocked a behaviour: introduce it within the next phrase or two
  if (!G.phr || G.phr.i >= G.phr.p.types.length) {
    const maxChain = 1 + Math.floor(Math.min(L, 2.5)), full = G.chain >= maxChain;   // at most 3 heavy phrases in a row, then a short recovery                  // intense stretches get longer as the level rises; recovery stays short
    const need = (G.newType && G.newType !== 'std' && !G.seen[G.newType]) ? G.newType : null;
    const maxSim = p => G.hist.reduce((m, h) => Math.max(m, simil(p, h)), 0);
    let p = null;
    if (n === 0) p = PHRASES[0];
    else {
      let pool = PHRASES.filter(q => n >= q.min && q.types.every(t => st.types.includes(t)) && !(full && heavy(q)) && (!need || q.types.includes(need)));
      const novel = pool.filter(q => maxSim(q) < 0.67); if (novel.length) pool = novel;     // never replay a pattern (or a near copy) from the last 6
      if (!pool.length || rnd() < Math.min(0.75, 0.3 + 0.25 * L)) {
        let bs = 9; for (let a = 0; a < 6; a++) { const c = compose(st, n, L, need, full), sv = maxSim(c); if (sv < bs) { bs = sv; p = c; } if (sv < 0.5) break; }
      } else {
        const tgt = lerp(2, 5, Math.min(1, L / 5));
        const wts = pool.map(q => { let w = q.w; for (const t of new Set(q.types)) w *= G.prof.wt[t] || 1; if (full && q.relief) w *= 4; if (q.types.some(hardT)) w *= 1 + 0.2 * Math.max(0, L - 2); if (q.rare) w *= lerp(0.5, 1.5, Math.min(1, L / 2)) * (1 + 0.15 * Math.max(0, L - 2)); return w * Math.exp(-Math.pow(cxOf(q) - tgt, 2) / 1.5); });
        let x = rnd() * wts.reduce((a, b) => a + b, 0), pi = 0; while (pi < pool.length - 1 && (x -= wts[pi]) > 0) pi++;
        p = pool[pi];
      }
    }
    G.phrases++; if (maxSim(p) >= 0.67) G.dupes++;
    G.hist.push(p); if (G.hist.length > 6) G.hist.shift();
    G.phr = { p, i: 0, int: heavy(p) ? 1 : (p.relief || full) ? -1 : 0 };
    G.chain = heavy(p) ? G.chain + 1 : 0;
    if (G.mod && G.mod.left <= 0) G.mod = null;
    if (!G.mod && n >= 12 && G.sinceMod >= Math.max(3, 10 - 2 * L) && !heavy(p) && rnd() < Math.min(0.6, 0.1 + 0.12 * L)) { G.mod = Object.assign({}, MODS[(rnd() * MODS.length) | 0]); G.mod.left = G.mod.len; G.mod.fresh = true; G.sinceMod = 0; }
  }
  const p = G.phr.p, i = G.phr.i++, m = (G.mod && G.mod.left > 0) ? G.mod : null;
  const sl = { type: p.types[i], cls: p.cls ? p.cls[i] : null, sp: (p.sp || 1) * G.prof.sp * (m ? m.sp : 1), gm: (p.gm || 1) * (m ? m.gm : 1), om: G.prof.om * (m ? m.om : 1), gold: p.gold, pid: p.id, cx: cxOf(p), hv: heavy(p), int: G.phr.int };
  if (m) { m.left--; sl.mod = m.id; sl.sm = m.sm; if (m.fresh) { sl.modStart = true; m.fresh = false; } }
  G.sinceMod++;
  return sl;
}
function diag() {                               // development diagnostics (also printed per phase when ?debug is on)
  const r = G.rings.find(x => !x.done) || G.rings[0], L = r ? r.diag.L : 0, st = STAGES[r ? r.stage : 0], live = G.rings.filter(x => !x.done), sp = [];
  for (let i = 1; i < live.length; i++) sp.push(live[i].cy - live[i - 1].cy);
  return { phase: (r ? r.stage : 0) + 1, name: st.name, level: +L.toFixed(2), tier: tierOf(L), unlockedTypes: st.types.length, newThisPhase: st.types[st.types.length - 1], handmadePatterns: PHRASES.filter(q => q.types.every(t => st.types.includes(t))).length,
           mixCombinations: [2, 3, 4].reduce((a, k) => a + Math.pow(st.types.length, k), 0) * 5, repeats: G.dupes + '/' + G.phrases, clearGap: r ? Math.round(r.diag.edge) : 0, density: sp.length ? +(1000 / (sp.reduce((a, b) => a + b, 0) / sp.length)).toFixed(2) : 0 };
}
let genBy = 0;                                  // ball y this obstacle is generated against (deterministic: the step at which it is first needed)
function* ringJob() {                           // one yield per attempt so a phone can spread the work over several frames
  const V = CFG.ballSpeed, ps = V * STEP, n = G.n++, [si, k] = stageOf(n), st = STAGES[si], L = lvl(n), d = diff(n);
  genBy = G.lastCy > 1500 ? (Math.floor((G.lastCy - 1500) / ps) + 1) * ps : 0;
  const slot = nextSlot(st, k, n, n / CFG.rampRings), prevT = G.lastType, type = slot.type, intro = type !== 'std' && !G.seen[type];
  G.seen[type] = 1; G.rep = (type === G.lastType && type !== 'std') ? G.rep + 1 : 0; G.lastType = type;
  const Lr = clamp(L + (slot.int || 0) * CFG.intensity, 0, CFG.maxLevel); G.lastUse[type] = n;     // phrase intensity rides on the baseline: hot = +0.25 level, recovery = -0.25
  const dir = (n % 7 === 6) ? G.prevDir : -G.prevDir; G.prevDir = dir;
  const ext = t => t === 'bob' ? 95.5 : t === 'gate' ? 4 : t === 'tandem' ? 124.5 : t === 'pulse' ? 80.5 : 73.5;       // half-height of each obstacle: spacing is the CLEAR distance, so tall obstacles never spread the run
  const edge = Math.max(CFG.minEdgeGap, PR('edgeGap', Lr) * (slot.sp || 1));
  const cy = G.lastCy === 0 ? CFG.firstRing : G.lastCy + ext(prevT) + edge + ext(type); G.lastCy = cy;
  const u = rnd(), fastShare = PR('fastShare', Lr); let cls = slot.cls != null ? slot.cls : intro ? 1 : u < CFG.slowShare ? 0 : u > 1 - fastShare ? 2 : 1;   // slow / mid / fast
  if (slot.cls == null) { if (cls === G.lastCls && !intro) cls = (cls + 1 + ((rnd() * 2) | 0)) % 3; if (cls === 2 && fastShare === 0) cls = 1; }
  G.lastCls = cls;
  const sm = cls === 0 ? PR('slowMult', Lr) : cls === 2 ? PR('fastMult', Lr) : 1;
  const g0 = (PR('openDeg', Lr) * CFG.classOpen[cls] * (slot.gm || 1) * ((CFG.typeAdj[type] || {}).op || 1) + (intro ? 5 : 0)) * PI / 180;
  const w0 = PR('omega', Lr) * sm * (intro ? 0.85 : 1) * (slot.om || 1) * ((CFG.typeAdj[type] || {}).om || 1);
  const prev = G.rings[G.rings.length - 1], ta = prev ? (prev.cy + prev.reach + 2 - genBy) / V : 0;
  const wmin = PR('tapMin', Lr), isG = type === 'gate', isT = type === 'tandem';
  let best = null, used = 0;
  for (let a = 0; a < CFG.attempts + 20; a++) {   // the target (opening, speed) is HELD for CFG.attempts tries (only the phase is re-rolled); only then is it eased, speed first
    const rel = Math.max(0, a - CFG.attempts), sp = Math.pow(0.92, Math.min(rel, 12)), gx = Math.max(0, rel - 6) * 0.04;
    const r = build({ type, n, si, k, dir, cy, intro, d: Math.min(1, Lr), g: g0 + gx, rx: gx * 100, sp, w: clamp(w0 * sp, CFG.omegaMin, CFG.omegaMax) });
    const v = validate(r, ta); used = a;
    if (!best || v.win > best.v.win) best = { r, v };
    if (v.win >= (isT ? 0.10 : isG ? Math.min(wmin, 0.07) : wmin) && (!v.free || Math.min(1, Lr) < CFG.noFreeBelow)) { best = { r, v }; break; }
    yield;
  }
  for (let x = 1; x <= 20 && best.v.win < 0.06 && !best.v.free; x++) {     // last resort: widen until solvable (never emit an unsolvable ring)
    const r = build({ type, n, si, k, dir, cy, intro, d: Math.min(1, Lr), g: g0 + 0.4 + x * 0.1, rx: 32 + x * 6, sp: 0.35, w: CFG.omegaMin }), v = validate(r, ta);
    if (v.win > best.v.win) best = { r, v };
    yield;
  }
  const r = best.r; Object.assign(r, { gold: !!slot.gold, mod: slot.mod, sm: slot.sm, modStart: slot.modStart, pid: slot.pid, hv: slot.hv });
  r.diag = { d, L, tier: tierOf(L), Lr, w: r.layers[0] ? Math.abs(r.layers[0].w) : Math.abs(r.gate.w), win: best.v.win, free: best.v.free, cls, relaxed: used >= CFG.attempts, edge, cx: slot.cx || 1 };
  for (let by = genBy; by + ps / 2 < G.ball.y; ) { by += ps; stepRing(r, STEP, by); }   // catch up if slicing delayed the hand-over
  G.rings.push(r);
}
function addRing() { for (const _ of ringJob()); }                       // synchronous (reset / tests)
const drainJob = () => { while (G.job) if (G.job.next().done) G.job = null; };
function pumpJob(ms) { const t0 = performance.now(); while (G.job && performance.now() - t0 < ms) if (G.job.next().done) G.job = null; }

function reset() {
  if (G.daily && Store.d.daily.date !== dailySeed()) Store.d.daily = { date: dailySeed(), best: 0 };
  G.seed = G.daily ? dailySeed() : (Math.random() * 4294967296) >>> 0; rnd = mulberry(G.seed);
  G.phr = null; G.recent = []; G.lastUse = {}; G.hist = []; G.chain = 0; G.nKnown = 0; G.newType = null; G.dupes = 0; G.phrases = 0; G.mod = null; G.sinceMod = 99; G.prof = PROFILES[(rnd() * PROFILES.length) | 0];
  G.ball.y = 0; G.rings.length = 0; G.lastCy = 0; G.n = G.nStart || 0; G.prevDir = 1; G.seen = {}; G.lastType = ''; G.rep = 0; G.lastCls = -1;
  G.score = 0; G.streak = 0; G.bestStreak = 0; G.mult = 1; G.banner = null; G.pop = null; G.tapped = false;
  for (const p of P) p.a = 0;
  G.job = null; while (G.lastCy < G.ball.y + 1500) addRing();
}

/* ---- collision: exact distance from ball centre to the solid parts (arc sectors / barrier segments) ---- */
function secDist(px, py, cx, cy, a0, a1, r0, r1) {
  const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy), b = Math.atan2(dy, dx), span = a1 - a0;
  const rel = ((b - a0) % TAU + TAU) % TAU;
  if (rel <= span) return Math.max(r0 - d, d - r1, 0);
  const e = (TAU - rel < rel - span) ? a0 : a1, df = b - e;
  return Math.hypot(clamp(d * Math.cos(df), r0, r1) - d * Math.cos(df), d * Math.sin(df));
}
/* returns clearance in px (<0 = hit) and records r.q = worst clearance as a fraction of the best possible (precision) */
function measure(r, by) {
  const cx = W / 2, bR = CFG.ballR;
  if (r.gate) {
    const g = r.gate, gx = cx + g.A * Math.sin(g.th), dy = Math.max(r.cy - 4 - by, 0, by - r.cy - 4);
    const c = Math.min(Math.hypot(Math.max(cx - (gx - g.gh), 0), dy), Math.hypot(Math.max(gx + g.gh - cx, 0), dy)) - bR;
    r.q = Math.min(r.q, c / (g.gh - bR)); return c;
  }
  let m = 1e9;
  for (const L of r.layers) {
    const a = L.ang, h = L.g / 2, r0 = L.R - CFG.ringW / 2, r1 = L.R + CFG.ringW / 2;
    const cyL = r.cy + (L.dy || 0), c = Math.min(secDist(cx, by, cx, cyL, a + h, a + PI - h, r0, r1), secDist(cx, by, cx, cyL, a + PI + h, a + TAU - h, r0, r1)) - bR;
    r.q = Math.min(r.q, c / (L.R * Math.sin(h) - bR)); m = Math.min(m, c);
  }
  return m;
}

/* ---- input: freeze affects the next ring ahead (see notes) ---- */
function tap() {
  if (G.state !== 'PLAYING') return;
  const r = activeRing(); if (!r || r.cd > 0) return;
  r.frz = r.fd; r.cd = CFG.cooldown; G.flash = 1; G.pulse = 0; G.tapped = true;
  Snd.freeze();
  burst(W / 2, G.ball.y, 6, 60, 0.5, '#3df0ff');
}

/* ---- per-ring motion: rotation (freezable), scheduled reversal, breathing gap, pulsing radius ---- */
function stepRing(r, dt, by) {
  if (r.cd > 0) r.cd -= dt;
  if (r.frz > 0) r.frz -= dt; else { for (const L of r.layers) L.ang += L.w * (L.mo ? modf(L, by) : 1) * dt; if (r.gate) r.gate.th += r.gate.w * dt; }
  if (r.revY && by >= r.revY) { r.revY = 0; for (const L of r.layers) L.w = -L.w; }
  for (const L of r.layers) {
    if (L.gamp) L.g = L.gmin + L.gamp * (0.5 + 0.5 * Math.cos(L.gph + by * L.gk));
    if (L.ramp) L.R = L.R0 * (1 + L.ramp * Math.sin(L.rph + by * L.rk));
    if (L.bob) L.dy = L.bob.a * Math.sin(L.bob.ph + by * L.bob.k);
  }
}
const pop = (text, col) => { G.pop = { t: 1, text, col }; };
/* ---- scoring: called exactly once per obstacle (r.done latches) ---- */
function award(r) {
  const c = r.minClear, perfect = c >= CFG.nearMiss && r.q >= CFG.perfectQ, bx = W / 2;
  let lab = 'CLEAN', col = '#9fb4c8';
  if (c < CFG.nearMiss) { G.streak = 0; lab = 'CLOSE'; col = '#ffb347'; Snd.near(); }
  else if (perfect) {
    G.streak++; lab = 'PERFECT'; col = '#3df0ff';
    if (CFG.milestones.includes(G.streak)) { G.banner = { t: 1.4, text: G.streak + ' STREAK  \u00d7' + multFor(G.streak) }; Snd.milestone(); burst(bx, G.ball.y, 36, 220, 0.9, '#ffffff'); G.shake = 2.5; }
    else Snd.pass(G.streak);
  }
  G.mult = multFor(G.streak);
  const pts = Math.round(((1 + (perfect ? CFG.perfectBonus : 0)) * G.mult + (r.gold && perfect ? CFG.goldBonus * G.mult : 0)) * (r.sm || 1)) + (c < CFG.nearMiss ? CFG.nearBonus : 0); G.score += pts; G.bestStreak = Math.max(G.bestStreak, G.streak);
  pop((r.gold && perfect ? 'GOLD' : lab) + ' +' + pts, r.gold && perfect ? '#ffd24d' : col);
  const nx = G.rings[G.rings.indexOf(r) + 1];
  if (nx && nx.stageStart) { G.banner = { t: 1.8, text: 'PHASE ' + (nx.stage + 1) + ' \u2014 ' + STAGES[nx.stage].name }; burst(bx, G.ball.y, 14, 120, 0.7, STAGES[nx.stage].col[0]); }
  if (DEBUG && nx && nx.stageStart) console.log('[SNAPSHOT] phase', JSON.stringify(diag()));
  if (nx && nx.modStart && !G.banner) G.banner = { t: 1.6, text: nx.mod + '  \u00d7' + nx.sm + ' POINTS' };
  burst(bx, r.cy + CFG.ringR, 10, 90, 0.5, TC[r.type] || STAGES[r.stage].col[0]);
}
/* ---- simulation step (ball physics unchanged from 1.0) ---- */
function update(dt) {
  const b = G.ball; b.y += CFG.ballSpeed * dt;
  for (const r of G.rings) stepRing(r, dt, b.y);
  emit(W / 2 + (Math.random() - 0.5) * 3, b.y - 4, (Math.random() - 0.5) * 14, -20, 0.38, 2.2, CFG.colors[Store.d.color]);
  for (const r of G.rings) {
    if (r.done) continue;
    if (Math.abs(b.y - r.cy) < r.reach + 6) {
      const c = measure(r, b.y);
      if (c < 0) { die(); return; }
      if (c < r.minClear) r.minClear = c;
    }
    if (b.y > r.cy + r.reach + 2) { r.done = true; award(r); }
  }
  while (G.rings.length && G.rings[0].cy < b.y - 700) G.rings.shift();
  while (!G.job && G.lastCy < b.y + 1500) { G.job = ringJob(); if (G.sync) drainJob(); else break; }
}

function die() {
  G.state = 'DYING'; G.dieT = 0; G.shake = 4; Snd.hit();
  burst(W / 2, G.ball.y, 30, 200, 0.8, CFG.colors[Store.d.color]); burst(W / 2, G.ball.y, 12, 140, 0.7, '#ff4d6d');
  const d = Store.d, cur = G.daily ? d.daily.best : d.best, isNew = G.score > cur;
  if (isNew) { if (G.daily) d.daily.best = G.score; else d.best = G.score; } d.bestStreak = Math.max(d.bestStreak, G.bestStreak); Store.save(); G.isNew = isNew;
}
function showOver() {
  G.state = 'GAME_OVER'; G.overAt = performance.now();
  $('oScore').textContent = G.score; $('oBest').textContent = G.daily ? Store.d.daily.best : Store.d.best; $('oStreak').textContent = Store.d.bestStreak;
  $('oNew').classList.toggle('hid', !G.isNew); show('over');
}

/* ================= STATE / UI ================= */
const show = id => $(id).classList.remove('hid'), hide = id => $(id).classList.add('hid');
function start(d) {
  if (typeof d === 'boolean') G.daily = d;
  Snd.init(); reset(); G.state = 'PLAYING'; acc = 0; hide('menu'); hide('over'); hide('pause');
}
function toMenu() { G.state = 'MENU'; G.daily = false; hide('over'); hide('pause'); buildMenu(); show('menu'); }
function pause() { if (G.state === 'PLAYING') { G.state = 'PAUSED'; show('pause'); } }
function resume() { if (G.state === 'PAUSED') { G.state = 'PLAYING'; acc = 0; last = performance.now(); hide('pause'); } }
function retry() { if (G.state === 'GAME_OVER' && performance.now() - G.overAt > 250) start(); }
function buildMenu() {
  $('mBest').textContent = Store.d.best; $('daily').textContent = 'DAILY CHALLENGE \u00b7 ' + (Store.d.daily.date === dailySeed() ? Store.d.daily.best : 0);
  const row = $('sw'); row.innerHTML = '';
  CFG.colors.forEach((c, i) => {
    const b = document.createElement('button'), ok = Store.d.best >= CFG.unlock[i];
    b.className = 'sw' + (Store.d.color === i ? ' on' : ''); b.style.background = c; b.style.color = c; b.disabled = !ok;
    b.setAttribute('aria-label', ok ? 'Ball colour ' + (i + 1) : 'Unlocks at score ' + CFG.unlock[i]);
    b.onclick = () => { Store.d.color = i; Store.save(); buildMenu(); }; row.appendChild(b);
  });
}
function syncMute() { const m = Store.d.mute; $('snd').textContent = m ? 'SOUND OFF' : 'SOUND ON'; $('snd').setAttribute('aria-pressed', m); }

/* ================= RENDERING ================= */
let cv, ctx, DPR = 1, sc = 1, ox = 0, oy = 0;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  const iw = window.innerWidth, ih = window.innerHeight;
  cv.width = Math.round(iw * DPR); cv.height = Math.round(ih * DPR);
  sc = Math.min(iw / W, ih / H); ox = (iw - W * sc) / 2; oy = (ih - H * sc) / 2;
}

function drawRing(r, sy, active) {
  Art.ring(ctx, r, sy, G.clock);                 // artwork (art.js). Below: the gameplay cues, kept exactly as before
  const cx = W / 2, L0 = r.layers[0], acc = (TC[r.type] || '#d6e6ff');
  if (L0 && r.revY) { ctx.save(); ctx.globalAlpha = 0.4; ctx.lineWidth = 1.2; ctx.setLineDash([3, 7]); ctx.strokeStyle = acc; ctx.beginPath(); ctx.arc(cx, sy, L0.R + 12, 0, TAU); ctx.stroke(); ctx.restore(); }   // reversal pending
  if (r.label && sy > 40) text(r.label, cx, sy - (r.top || CFG.ringR) - 22, 10, acc, 0.8, 600);                                                          // first appearance of a type is labelled
  if (L0 && active && r.cd > 0 && !r.top) { ctx.globalAlpha = 0.5; ctx.lineWidth = 1.6; ctx.strokeStyle = Art.col('acc', 1); ctx.beginPath(); ctx.arc(cx, sy, L0.R0 + 14, -PI / 2, -PI / 2 + TAU * r.cd / CFG.cooldown); ctx.stroke(); ctx.globalAlpha = 1; }   // freeze cooldown
}
function drawBall(x, y) { Art.ball(ctx, x, y, CFG.ballR, CFG.colors[Store.d.color]); }
function text(s, x, y, size, col, alpha, wt) {
  ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.fillStyle = col; ctx.font = Art.font(wt || 600, size); ctx.textAlign = 'center';
  try { ctx.letterSpacing = (size * 0.14).toFixed(1) + 'px'; } catch (e) {}
  ctx.fillText(s, x, y); ctx.globalAlpha = 1;
}
function draw(dt) {
  const menu = G.state === 'MENU', camY = G.ball.y - CFG.ballScreenY;
  Art.frame({ ballY: G.ball.y, clock: G.clock, dt, menu, k: DPR * sc });      // visual progression / palette / quality: reads gameplay state, writes none
  ctx.setTransform(1, 0, 0, 1, 0, 0); Art.base(ctx, cv.width, cv.height);
  const sh = G.shake > 0.1 ? G.shake : 0;
  ctx.setTransform(DPR * sc, 0, 0, DPR * sc, DPR * ox + (sh ? (Math.random() - 0.5) * sh * DPR : 0), DPR * oy + (sh ? (Math.random() - 0.5) * sh * DPR : 0));
  G.shake *= Math.pow(0.001, dt);
  Art.layers(ctx, camY, G.clock); Art.prep(ctx);                              // far / mid silhouettes, light shafts, dust (parallax), shared material gradients
  if (menu) {                                                           // animated title scene
    const cy = 320, t = G.clock;
    drawRing({ type: 'std', stage: 0, n: 0, cy: 0, fam: 'chrome', frz: 0, cd: 0, revY: 0, layers: [{ R: 70, R0: 70, g: 110 * PI / 180, ang: t }] }, cy, false);
    drawBall(W / 2, cy - 150 + ((t * 150) % 300));
  } else {
    G.rings.forEach((r, i) => { const sy = r.cy - camY; if (sy > -170 && sy < H + 170) drawRing(r, sy, r === activeRing()); });
    ctx.globalAlpha = 1;
    for (const p of P) if (p.a) { ctx.globalAlpha = Math.max(0, p.l / p.m) * 0.9; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y - camY, p.s, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (G.state !== 'DYING' && G.state !== 'GAME_OVER') drawBall(W / 2, CFG.ballScreenY);
    if (G.pulse < 1) { G.pulse += dt * 4; ctx.globalAlpha = Math.max(0, 1 - G.pulse) * 0.6; ctx.strokeStyle = Art.col('hi', 1); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(W / 2, CFG.ballScreenY, 12 + G.pulse * 46, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
    if (G.flash > 0) { ctx.fillStyle = Art.col('acc', G.flash * 0.05); ctx.fillRect(-ox / sc, -oy / sc, cv.width / (DPR * sc), cv.height / (DPR * sc)); G.flash = Math.max(0, G.flash - dt * 5); }
    if (G.state === 'PLAYING' || G.state === 'PAUSED' || G.state === 'DYING') {
      text(String(G.score), W / 2, 86, 50, Art.col('hi', 1), 1, 300);
      const ar = activeRing(); if (ar) text('PHASE ' + (ar.stage + 1) + ' \u00b7 ' + STAGES[ar.stage].name, W / 2, 134, 9, Art.col('hi', 1), 0.38);
      if (DEBUG && ar) { const L = ar.layers[0], dg = ar.diag || {};
        ['TIER ' + dg.tier + '  d=' + (dg.d || 0).toFixed(2), 'OPENING ' + (L ? (L.g * 180 / PI).toFixed(0) + '\u00b0' : (2 * ar.gate.gh).toFixed(0) + 'px') + '  OMEGA ' + (dg.w || 0).toFixed(2),
         'TAP WINDOW ' + (dg.win || 0).toFixed(2) + 's' + (dg.free ? ' +free' : ''), 'FREEZE CD ' + Math.max(0, ar.cd).toFixed(2), 'PHASE ' + (ar.stage + 1) + ' ' + STAGES[ar.stage].name + '  L ' + (dg.L || 0).toFixed(2) + '  GAP ' + ((dg.edge || 0) | 0) + 'px  REPEATS ' + G.dupes + '/' + G.phrases, 'RUN ' + (G.prof ? G.prof.name : '') + '  PHRASE ' + (ar.pid || '-') + (ar.mod ? '  MOD ' + ar.mod : '')].forEach((t, i) => text(t, W / 2, 152 + i * 13, 10, '#ffd24d', 0.85)); }
      if (ar && ar.mod) text(ar.mod + ' \u00d7' + ar.sm, W / 2, 148, 10, '#ffd24d', 0.85);
      if (G.pop) { G.pop.t -= dt * 1.6; if (G.pop.t > 0) text(G.pop.text, W / 2, CFG.ballScreenY - 52 - (1 - G.pop.t) * 14, 12, G.pop.col, Math.min(1, G.pop.t * 1.5)); else G.pop = null; }
      if (G.streak >= 2) text(G.streak + ' PERFECT  \u00d7' + G.mult, W / 2, 112, 11, Art.col('acc', 1), 0.95);
      if (G.score < 2 && G.state === 'PLAYING') text('TAP TO FREEZE THE RING', W / 2, H - 70, 10, Art.col('hi', 1), 0.3 + 0.2 * Math.sin(G.clock * 3));
      const tz = Art.state.toast; if (tz) text(tz.text, W / 2, 168, 12, Art.col('acc', 1), Math.min(1, tz.t * 2, (2.8 - tz.t) * 2), 600);   // environment name when the world changes
    }
    if (G.banner) { G.banner.t -= dt; if (G.banner.t > 0) text(G.banner.text, W / 2, 196, 17, Art.col('hi', 1), Math.min(1, G.banner.t), 400); else G.banner = null; }
  }
  Art.foreground(ctx, camY);                                                  // sparse foreground shards
  ctx.setTransform(1, 0, 0, 1, 0, 0); Art.vignette(ctx, cv.width, cv.height);
}

/* ================= MAIN LOOP ================= */
let last = 0, acc = 0;
function frame(ts) {
  requestAnimationFrame(frame); G.sync = false;
  const dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts; G.clock += dt;
  if (G.state === 'PLAYING') {
    acc += dt; let k = 0;
    while (acc >= STEP && k++ < 8) { update(STEP); acc -= STEP; if (G.state !== 'PLAYING') break; }
    if (k >= 8) acc = 0;
  } else if (G.state === 'DYING') { G.dieT += dt; if (G.dieT > 0.55) showOver(); }
  if (G.job && G.state !== 'PAUSED') pumpJob(3);   // <= ~3ms of ring generation per frame
  if (G.state !== 'PAUSED') {
    const a = activeRing(), pf = (a && a.frz > 0 && G.state === 'PLAYING') ? 0.12 : 1;  // particles hang while frozen
    for (const p of P) if (p.a) { p.l -= dt * pf; if (p.l <= 0) { p.a = 0; continue; } p.x += p.vx * dt * pf; p.y += p.vy * dt * pf; p.vx *= 0.985; p.vy *= 0.985; }
  }
  draw(dt);
}

/* ================= BOOT ================= */
function boot() {
  cv = $('c'); ctx = cv.getContext('2d'); Store.load(); resize(); buildMenu(); syncMute();
  window.addEventListener('resize', resize); window.addEventListener('orientationchange', resize);
  cv.addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  $('play').onclick = () => start(false); $('daily').onclick = () => start(true); $('retry').onclick = retry; $('toMenu').onclick = toMenu; $('resume').onclick = resume;
  $('over').addEventListener('pointerdown', e => { if (e.target === $('over')) retry(); });
  $('snd').onclick = () => { Store.d.mute = !Store.d.mute; Store.save(); syncMute(); Snd.init(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (e.repeat) return;
      ({ MENU: start, PLAYING: tap, GAME_OVER: retry, PAUSED: resume })[G.state]?.(); }
    if (e.code === 'Escape') pause();
  });
  window.SNAPSHOT = { G, CFG, update, reset, tap, start, STEP, measure, STAGES, stageOf, secDist, diff, lvl, PR, validate, passes, tierOf, PHRASES, heavy, diag, compose, simil, UNLOCK };   // debug / test hook
  requestAnimationFrame(frame);
}
boot();
