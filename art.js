'use strict';
/* =============================================================================================
   SNAPSHOT art system. RENDERING ONLY: reads gameplay state, never writes it.
   Hard rule: everything that belongs to an obstacle is drawn INSIDE its collision band
   (ring radius +-3.5px, gate +-4px), so the artwork can never disagree with the collision.
   Silhouette variety comes from ornaments placed beside the ring, away from the ball's path.
   Layers: base gradient > far silhouettes > mid silhouettes > light shafts > dust > [obstacles, ball, fx] > foreground > vignette
   ============================================================================================= */
const Art = (() => {
  const PI = Math.PI, TAU = PI * 2, W = 360, H = 640, TILE = 720;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };      // deterministic 0..1, so generated artwork is designed, not random
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgba = (a, al) => 'rgba(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ',' + al + ')';
  const css = a => 'rgb(' + (a[0] | 0) + ',' + (a[1] | 0) + ',' + (a[2] | 0) + ')';
  const pal = (bg, far, mid, hi, acc, dust, shaft, ed) => ({ bg: bg.map(rgb), far: rgb(far), mid: rgb(mid), hi: rgb(hi), acc: rgb(acc), dust: rgb(dust), shaft: rgb(shaft), ed: rgb(ed) });
  const FONT = '"Syncopate","Michroma","Eurostile","Avenir Next","Segoe UI",system-ui,sans-serif';

  /* ---- environments: one palette each (bg x3, far, mid, highlight, accent, dust, shaft, edge-light). Blended continuously. ---- */
  const ENV = [
    { name: 'THE VOID', p: pal(['#050914', '#0a1530', '#02040a'], '#1b2c4d', '#27405f', '#d6e6ff', '#7fb4ff', '#9fb8e0', '#6f9ae0', '#cfe2ff') },
    { name: 'THE FRACTURE', p: pal(['#09051f', '#1c0e3c', '#04020f'], '#3b2070', '#5b2d8f', '#e0f6ff', '#b08aff', '#b8a4ff', '#8f6bff', '#36e0ff') },
    { name: 'THE COLLAPSE', p: pal(['#0b0605', '#1f0e08', '#030101'], '#3d1b10', '#52250f', '#ffe6c8', '#ff8a2a', '#ffb274', '#ff6a1e', '#ff7a2a') }
  ];
  const KEYS = ['far', 'mid', 'hi', 'acc', 'dust', 'shaft', 'ed'];
  const cur = { bg: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], far: [0, 0, 0], mid: [0, 0, 0], hi: [0, 0, 0], acc: [0, 0, 0], dust: [0, 0, 0], shaft: [0, 0, 0], ed: [0, 0, 0] };
  const S = { e: 0, inten: 0, Q: 1, k: 1, clock: 0, lastY: 0, shown: [false, false], toast: null, ema: 0.016, slow: 0, fast: 0, cssT: 0, vig: null, vw: 0, vh: 0 };
  const meta = new WeakMap(), grads = {}, tiles = {};
  let dbg = '';

  /* ---- visual progression: a pure function of distance travelled, so it only ever advances. Void -> Fracture -> Collapse ---- */
  const envPos = y => { const t = y / CFG.ballSpeed; return clamp((t - 15) / 55, 0, 1) + clamp((t - 70) / 60, 0, 1); };
  function setEnv(e) {
    const i = Math.min(1, Math.floor(e)), t = e - i, A = ENV[i].p, B = ENV[i + 1].p;
    for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) cur.bg[j][c] = lerp(A.bg[j][c], B.bg[j][c], t);
    for (const k of KEYS) for (let c = 0; c < 3; c++) cur[k][c] = lerp(A[k][c], B[k][c], t);
  }
  function frame(a) {                              // once per rendered frame: progression, palette, toast, adaptive quality
    const y = a.menu ? 0 : a.ballY;
    if (y < S.lastY - 1) { S.shown = [false, false]; S.toast = null; }      // a new run began: reset presentation state only
    S.lastY = y; S.clock = a.clock; S.k = a.k || 1;
    S.e = envPos(y); S.inten = clamp(y / CFG.ballSpeed / 150, 0, 1); setEnv(S.e);
    for (let i = 0; i < 2; i++) if (!S.shown[i] && S.e >= 0.5 + i) { S.shown[i] = true; S.toast = { text: ENV[i + 1].name, t: 2.8 }; }
    if (S.toast) { S.toast.t -= a.dt; if (S.toast.t <= 0) S.toast = null; }
    S.ema = lerp(S.ema, a.dt, 0.05);                                         // adaptive quality: drop shadows / dust on slow devices, restore when fast again
    if (S.ema > 0.024) { S.slow++; S.fast = 0; } else if (S.ema < 0.0185) { S.fast++; S.slow = 0; } else { S.slow = S.fast = 0; }
    if (S.slow > 120) S.Q = 0; else if (S.fast > 600) S.Q = 1;
    S.cssT -= a.dt;
    if (S.cssT <= 0 && typeof document !== 'undefined' && document.documentElement) { S.cssT = 0.5; const st = document.documentElement.style; st.setProperty('--acc', rgba(cur.acc, 1)); st.setProperty('--hi', rgba(cur.hi, 1)); }
  }

  /* ---- background layers ---- */
  function paintTile(g, kind, e) {                 // cached 360x720 silhouettes, one per environment and depth; wrap-seamless
    const P = ENV[e].p, far = kind === 'far', n = far ? 9 : 6, base = far ? P.far : P.mid, al = far ? 0.55 : 0.8;
    for (let i = 0; i < n; i++) {
      const r0 = hash(i * 7.3 + e * 19 + (far ? 0 : 91)), r1 = hash(i * 3.1 + e * 5 + 1.7), r2 = hash(i * 9.7 + e * 2 + 4.2);
      const x = r0 * W, y = (i + r1) / n * TILE, s = (far ? 40 : 55) + r2 * (far ? 80 : 95), rot = r1 * TAU;
      for (const dy of [-TILE, 0, TILE]) {
        g.save(); g.translate(x, y + dy); g.rotate(rot); g.globalAlpha = al;
        const gr = g.createLinearGradient(-s, -s, s, s); gr.addColorStop(0, rgba(base, 0.9)); gr.addColorStop(1, rgba(base, 0.05));
        if (e === 0) {                              // the void: monoliths and floating rings
          if (i % 3 === 0) { g.strokeStyle = rgba(P.hi, 0.35); g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, s * 0.8, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, s * 0.5, 0.4, TAU - 0.4); g.stroke(); }
          else { g.fillStyle = gr; g.fillRect(-s * 0.18, -s, s * 0.36, s * 2); g.strokeStyle = rgba(P.hi, 0.3); g.lineWidth = 1; g.strokeRect(-s * 0.18, -s, s * 0.36, s * 2); }
        } else if (e === 1) {                       // the fracture: prismatic shards
          g.fillStyle = gr; g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.55, -s * 0.1); g.lineTo(s * 0.2, s); g.lineTo(-s * 0.5, s * 0.25); g.closePath(); g.fill();
          g.strokeStyle = rgba(i % 2 ? P.ed : P.acc, 0.45); g.lineWidth = 1; g.stroke(); g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.2, s); g.stroke();
        } else {                                    // the collapse: jagged slabs with a thin molten edge
          g.fillStyle = 'rgba(8,5,4,.92)'; g.beginPath(); g.moveTo(-s * 0.4, s); g.lineTo(-s * 0.3, -s * 0.2); g.lineTo(-s * 0.05, -s); g.lineTo(s * 0.2, -s * 0.3); g.lineTo(s * 0.45, s); g.closePath(); g.fill();
          g.strokeStyle = rgba(P.ed, 0.5); g.lineWidth = 1; g.beginPath(); g.moveTo(-s * 0.3, -s * 0.2); g.lineTo(-s * 0.05, -s); g.lineTo(s * 0.2, -s * 0.3); g.stroke();
        }
        g.restore();
      }
    }
  }
  function tile(kind, e) {
    const key = kind + e; if (tiles[key]) return tiles[key];
    const c = document.createElement('canvas'); c.width = W; c.height = TILE; paintTile(c.getContext('2d'), kind, e); return (tiles[key] = c);
  }
  const dustP = Array.from({ length: 70 }, (_, i) => ({ x: hash(i * 1.7) * W, y: hash(i * 2.9) * H, z: 0.25 + hash(i * 4.3) * 0.75, ph: hash(i * 5.1) * TAU, r: 0.7 + hash(i * 6.7) * 1.3 }));
  function base(ctx, vw, vh) {
    const g = ctx.createLinearGradient(0, 0, 0, vh); g.addColorStop(0, css(cur.bg[0])); g.addColorStop(0.55, css(cur.bg[1])); g.addColorStop(1, css(cur.bg[2]));
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
    const r = ctx.createRadialGradient(vw / 2, vh * 0.42, 0, vw / 2, vh * 0.42, vh * 0.65); r.addColorStop(0, rgba(cur.acc, 0.10 + 0.05 * S.inten)); r.addColorStop(1, rgba(cur.acc, 0));
    ctx.fillStyle = r; ctx.fillRect(0, 0, vw, vh);
  }
  function layers(ctx, camY, clock) {              // logical coordinates; parallax: far 0.10, mid 0.26, dust 0.25-1.0 x camera
    const e0 = Math.min(1, Math.floor(S.e)), t = S.e - e0;
    for (const [kind, par, al] of [['far', 0.10, 0.9], ['mid', 0.26, 0.85]]) {
      const off = (((-camY * par) % TILE) + TILE) % TILE - TILE;
      for (let q = 0; q < 2; q++) {
        const alpha = (q ? t : 1 - t) * al; if (alpha < 0.01) continue;           // cross-fade between neighbouring environments
        const img = tile(kind, e0 + q); ctx.globalAlpha = alpha; ctx.drawImage(img, 0, off); ctx.drawImage(img, 0, off + TILE);
      }
    }
    ctx.globalAlpha = 1;
    if (S.Q) {                                      // light shafts: three slow slanted beams, one gradient
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, rgba(cur.shaft, 0.08 + 0.05 * S.inten)); g.addColorStop(1, rgba(cur.shaft, 0)); ctx.fillStyle = g;
      for (let i = 0; i < 3; i++) { const x = 40 + i * 130 + Math.sin(clock * 0.07 + i * 2) * 25, w = 26 + i * 14; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.lineTo(x + w - 120, H); ctx.lineTo(x - 120, H); ctx.closePath(); ctx.fill(); }
    }
    const n = S.Q ? Math.floor(22 + S.inten * 46) : 12, rise = clamp(S.e - 1, 0, 1);   // dust density grows with progress; in the collapse it rises like embers
    ctx.fillStyle = rgba(cur.dust, 1);
    for (let i = 0; i < n; i++) {
      const p = dustP[i], x = p.x + Math.sin(clock * 0.2 * p.z + p.ph) * 10, y = (((p.y - camY * 0.25 * p.z - clock * 14 * p.z * rise) % H) + H) % H;
      ctx.globalAlpha = (0.12 + 0.3 * p.z) * (0.65 + 0.35 * Math.sin(clock * 0.5 + p.ph)); ctx.fillRect(x, y, p.r * p.z * 1.6, p.r * p.z * 1.6);
    }
    ctx.globalAlpha = 1;
  }
  function foreground(ctx, camY) {                 // sparse dark edge shards that slide faster than the world; never near the playfield centre
    ctx.fillStyle = 'rgba(2,3,8,' + (0.16 + 0.22 * S.inten) + ')';
    for (let i = 0; i < 2; i++) {
      const sx = i ? -1 : 1, x0 = i ? W : 0, y = (((i * 330 - camY * 1.3) % 760) + 760) % 760 - 60, w = 18 + hash(i * 9.1) * 16, h = 120 + hash(i * 4.4) * 110;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + sx * w, y + h * 0.45); ctx.lineTo(x0 + sx * w * 0.4, y + h); ctx.lineTo(x0, y + h); ctx.closePath(); ctx.fill();
    }
  }
  function vignette(ctx, vw, vh) {
    if (!S.vig || S.vw !== vw || S.vh !== vh) {
      S.vw = vw; S.vh = vh; S.vig = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.42, vw / 2, vh / 2, Math.hypot(vw, vh) * 0.62);
      S.vig.addColorStop(0, 'rgba(0,0,0,0)'); S.vig.addColorStop(1, 'rgba(0,0,0,.6)');
    }
    ctx.fillStyle = S.vig; ctx.fillRect(0, 0, vw, vh);
  }

  /* ---- ball (the visual focus: brightest, cleanest object on screen) ---- */
  function ball(ctx, x, y, R, hex) {
    const c = rgb(hex), lite = [lerp(c[0], 255, 0.55), lerp(c[1], 255, 0.55), lerp(c[2], 255, 0.55)];
    const h = ctx.createRadialGradient(x, y, R * 0.6, x, y, R * 3.6); h.addColorStop(0, rgba(c, 0.30)); h.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = h; ctx.beginPath(); ctx.arc(x, y, R * 3.6, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(x - R * 0.38, y - R * 0.42, R * 0.08, x, y, R * 1.05);
    g.addColorStop(0, '#fff'); g.addColorStop(0.22, rgba(lite, 1)); g.addColorStop(0.65, rgba(c, 1)); g.addColorStop(1, rgba([c[0] * 0.28, c[1] * 0.28, c[2] * 0.34], 1));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(cur.hi, 0.55); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(x, y, R - 0.45, PI * 0.1, PI * 0.75); ctx.stroke();       // rim light
  }

  /* ---- sculptural obstacles ---- */
  const conic = (ctx, st, stops) => { const g = ctx.createConicGradient ? ctx.createConicGradient(st, 0, 0) : ctx.createLinearGradient(-90, -90, 90, 90); stops.forEach(s => g.addColorStop(s[0], s[1])); return g; };
  function prep(ctx) {                             // shared gradients, built once per frame at the origin and reused by every obstacle (they follow the CTM)
    const hi = rgba(cur.hi, 1);
    grads.chrome = conic(ctx, -2.3, [[0, hi], [0.1, '#8fa2c2'], [0.24, '#0a111e'], [0.4, '#56698a'], [0.5, hi], [0.62, '#222d44'], [0.78, '#04070d'], [0.9, '#a6b7d4'], [1, hi]]);
    grads.rim = conic(ctx, -2.3, [[0, hi], [0.18, rgba(cur.hi, 0.15)], [0.5, rgba(cur.hi, 0.9)], [0.7, rgba(cur.hi, 0.1)], [1, hi]]);
    grads.glass = conic(ctx, S.clock * 0.12, [[0, 'rgba(60,230,255,.5)'], [0.22, 'rgba(150,110,255,.46)'], [0.45, 'rgba(255,90,210,.42)'], [0.7, 'rgba(120,150,255,.46)'], [1, 'rgba(60,230,255,.5)']]);
    grads.rare = conic(ctx, S.clock * 0.5, [[0, 'rgba(60,230,255,.55)'], [0.25, 'rgba(255,90,210,.5)'], [0.5, 'rgba(255,214,90,.5)'], [0.75, 'rgba(150,110,255,.55)'], [1, 'rgba(60,230,255,.55)']]);
  }
  function metaOf(r) {
    let m = meta.get(r); if (m) return m;
    const e = envPos(r.cy || 0), h = hash((r.n || 0) * 3.7 + 1.3);
    const w = [lerp(1.6, 0.5, clamp(e / 1.5, 0, 1)), e > 0.35 ? 1 + Math.min(1, e - 0.35) : 0, e > 1.15 ? 1 + Math.min(1.5, (e - 1.15) * 1.5) : 0, e > 0.7 ? 0.9 : 0];   // families unlock with the world and never disappear
    let x = h * (w[0] + w[1] + w[2] + w[3]), i = 0; while (i < 3 && (x -= w[i]) > 0) i++;
    m = { fam: r.fam || ['chrome', 'glass', 'obsidian', 'geo'][i], seed: Math.floor(hash((r.n || 0) * 9.1) * 1000), ph: hash((r.n || 0) * 2.3) * TAU, rare: e > 1 && hash((r.n || 0) * 5.1 + 2.2) < 0.1, fx: undefined };
    meta.set(r, m); return m;
  }
  const arcPath = (ctx, R, a0, a1) => { ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); };
  const noShadow = ctx => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
  const dropShadow = (ctx, a) => { if (!S.Q) return; ctx.shadowColor = 'rgba(0,0,0,' + a + ')'; ctx.shadowBlur = 9 * S.k; ctx.shadowOffsetX = 2 * S.k; ctx.shadowOffsetY = 5 * S.k; };   // light comes from the upper left
  function glint(ctx, R, a0, a1, ph, al) {         // a short specular streak travelling around the ring; only visible where there is surface
    const g0 = a0 + ((((ph - a0) % TAU) + TAU) % TAU); if (g0 >= a1) return;
    ctx.strokeStyle = rgba(cur.hi, al); ctx.lineWidth = 1.4; arcPath(ctx, R + 0.3, g0, Math.min(a1, g0 + 0.22)); ctx.stroke();
  }
  const paint = {
    chrome(ctx, R, a0, a1, m, c) {                 // liquid chrome: dark core, conic reflections, bright bevel, travelling glint
      dropShadow(ctx, 0.65); ctx.strokeStyle = '#070b14'; ctx.lineWidth = 7; arcPath(ctx, R, a0, a1); ctx.stroke(); noShadow(ctx);
      ctx.strokeStyle = grads.chrome; ctx.lineWidth = 5.4; arcPath(ctx, R, a0, a1); ctx.stroke();
      ctx.strokeStyle = grads.rim; ctx.lineWidth = 1.1; arcPath(ctx, R + 2.55, a0, a1); ctx.stroke();
      ctx.strokeStyle = 'rgba(2,5,12,.8)'; ctx.lineWidth = 1; arcPath(ctx, R - 2.95, a0, a1); ctx.stroke();
      glint(ctx, R, a0, a1, c.t * 0.7 + m.ph, 0.9 * c.spec);
    },
    glass(ctx, R, a0, a1, m, c) {                  // prismatic glass: iridescent translucent body, dark core, bright edges, crystalline facets
      ctx.strokeStyle = grads.glass; ctx.lineWidth = 7; arcPath(ctx, R, a0, a1); ctx.stroke();
      ctx.strokeStyle = 'rgba(8,4,34,.5)'; ctx.lineWidth = 2.2; arcPath(ctx, R, a0, a1); ctx.stroke();
      ctx.strokeStyle = rgba(cur.hi, 0.95); ctx.lineWidth = 1; arcPath(ctx, R + 3, a0, a1); ctx.stroke();
      ctx.strokeStyle = rgba(cur.hi, 0.45); arcPath(ctx, R - 3, a0, a1); ctx.stroke();
      const n = Math.max(2, ((a1 - a0) / 0.15) | 0), st = (a1 - a0) / n; ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = 0.8; ctx.beginPath();
      for (let i = 0; i < n; i++) { const t = a0 + (i + 0.5) * st; ctx.moveTo((R - 2.7) * Math.cos(t), (R - 2.7) * Math.sin(t)); ctx.lineTo((R + 2.7) * Math.cos(t + 0.09), (R + 2.7) * Math.sin(t + 0.09)); }
      ctx.stroke(); glint(ctx, R, a0, a1, c.t * 0.5 + m.ph, 0.7 * c.spec);
    },
    obsidian(ctx, R, a0, a1, m, c) {               // fractured obsidian: faceted black, thin controlled molten fractures
      dropShadow(ctx, 0.7); ctx.strokeStyle = '#04050a'; ctx.lineWidth = 7; arcPath(ctx, R, a0, a1); ctx.stroke(); noShadow(ctx);
      const n = Math.max(3, Math.round((a1 - a0) / 0.12)), st = (a1 - a0) / n, sd = m.seed, pulse = 0.55 + 0.4 * Math.sin(c.t * 1.2 + m.ph);
      for (let i = 0; i < n; i++) {
        const t0 = a0 + i * st, t1 = t0 + st, h = hash(i * 3.17 + sd * 7.7), v = (7 + h * 24) | 0, ri = R - 3.5 + hash(i * 1.3 + sd) * 0.9, ro = R + 3.5 - hash(i * 2.1 + sd + 5) * 0.9;
        ctx.fillStyle = 'rgb(' + v + ',' + (v + 2) + ',' + (v + 9) + ')'; ctx.beginPath();
        ctx.moveTo(ri * Math.cos(t0), ri * Math.sin(t0)); ctx.lineTo(ro * Math.cos(t0 + st * 0.3 * h), ro * Math.sin(t0 + st * 0.3 * h)); ctx.lineTo(ro * Math.cos(t1), ro * Math.sin(t1)); ctx.lineTo(ri * Math.cos(t1 - st * 0.25 * h), ri * Math.sin(t1 - st * 0.25 * h)); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 0.8; ctx.beginPath();
      for (let i = 0; i < n; i++) if (hash(i * 3.17 + sd * 7.7) > 0.5) { const t0 = a0 + i * st; ctx.moveTo((R + 3.2) * Math.cos(t0), (R + 3.2) * Math.sin(t0)); ctx.lineTo((R + 0.4) * Math.cos(t0 + st), (R + 0.4) * Math.sin(t0 + st)); }
      ctx.stroke();
      if (S.Q) { ctx.shadowColor = rgba(cur.ed, 0.8); ctx.shadowBlur = 5 * S.k; }
      ctx.strokeStyle = rgba(cur.ed, (0.5 + 0.4 * pulse) * Math.min(1, c.spec)); ctx.lineWidth = 0.9; ctx.beginPath();
      for (let i = 0; i < n; i++) if (hash(i * 3.17 + sd * 7.7) > 0.74) { const t0 = a0 + i * st; ctx.moveTo((R - 3.2) * Math.cos(t0 + 0.2 * st), (R - 3.2) * Math.sin(t0 + 0.2 * st)); ctx.lineTo((R + 3.2) * Math.cos(t0 + 0.9 * st), (R + 3.2) * Math.sin(t0 + 0.9 * st)); }
      ctx.stroke(); noShadow(ctx);
      ctx.strokeStyle = rgba(cur.hi, 0.22); ctx.lineWidth = 0.8; arcPath(ctx, R + 3.1, a0, a1); ctx.stroke();
    },
    geo(ctx, R, a0, a1, m, c) {                    // abstract geometry: layered lines, ticks, nodes and one asymmetric inlay per arc
      dropShadow(ctx, 0.5); ctx.strokeStyle = 'rgba(6,9,18,.97)'; ctx.lineWidth = 7; arcPath(ctx, R, a0, a1); ctx.stroke(); noShadow(ctx);
      const sp = a1 - a0, s0 = a0 + sp * (0.15 + 0.55 * hash(m.seed * 2.3 + c.k)), s1 = Math.min(a1, s0 + 0.55);
      ctx.strokeStyle = rgba(cur.acc, 0.9); ctx.lineWidth = 3.2; arcPath(ctx, R, s0, s1); ctx.stroke();
      ctx.strokeStyle = rgba(cur.hi, 0.85); ctx.lineWidth = 1.3; arcPath(ctx, R + 2.3, a0, a1); ctx.stroke(); arcPath(ctx, R - 2.3, a0, a1); ctx.stroke();
      const n = Math.max(2, (sp / 0.08) | 0), st = sp / n; ctx.strokeStyle = rgba(cur.hi, 0.35); ctx.lineWidth = 0.8; ctx.beginPath();
      for (let i = 0; i < n; i++) { const t = a0 + (i + 0.5) * st; ctx.moveTo((R - 1.1) * Math.cos(t), (R - 1.1) * Math.sin(t)); ctx.lineTo((R + 1.1) * Math.cos(t), (R + 1.1) * Math.sin(t)); }
      ctx.stroke();
      for (let t = a0 + 0.15, i = 0; t < a1 - 0.1; t += 0.31, i++) { ctx.fillStyle = i % 2 ? rgba(cur.hi, 0.9) : rgba(cur.acc, 0.95); ctx.beginPath(); ctx.arc(R * Math.cos(t), R * Math.sin(t), 1.15, 0, TAU); ctx.fill(); }
    }
  };
  function caps(ctx, R, a0, a1, c) {               // crisp radial faces at the ends of every arc: the opening's boundary is always unmistakable
    const i = 0.6 / R; ctx.strokeStyle = c.fr ? 'rgba(238,252,255,.98)' : rgba(cur.hi, 0.8); ctx.lineWidth = 1.2; ctx.beginPath();
    for (const t of [a0 + i, a1 - i]) { const cs = Math.cos(t), sn = Math.sin(t); ctx.moveTo(cs * (R - 3.5), sn * (R - 3.5)); ctx.lineTo(cs * (R + 3.5), sn * (R + 3.5)); }
    ctx.stroke();
  }
  function frost(ctx, R, a0, a1) {                 // frozen state: icy glow over the material, brilliant edges, crystalline ticks
    ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(120,215,255,.30)'; ctx.lineWidth = 6; arcPath(ctx, R, a0, a1); ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
    if (S.Q) { ctx.shadowColor = 'rgba(140,225,255,.9)'; ctx.shadowBlur = 8 * S.k; }
    ctx.strokeStyle = 'rgba(238,252,255,.95)'; ctx.lineWidth = 1; arcPath(ctx, R + 3, a0, a1); ctx.stroke(); arcPath(ctx, R - 3, a0, a1); ctx.stroke(); noShadow(ctx);
    const n = Math.max(2, ((a1 - a0) / 0.2) | 0), st = (a1 - a0) / n; ctx.strokeStyle = 'rgba(235,250,255,.55)'; ctx.lineWidth = 0.7; ctx.beginPath();
    for (let i = 0; i < n; i++) { const t = a0 + (i + 0.5) * st; ctx.moveTo((R - 2.6) * Math.cos(t), (R - 2.6) * Math.sin(t)); ctx.lineTo((R + 2.6) * Math.cos(t + 0.05), (R + 2.6) * Math.sin(t + 0.05)); }
    ctx.stroke();
  }
  function arcs(ctx, L, cy, idx, m, c) {
    const a = L.ang, h = L.g / 2, R = L.R;
    ctx.save(); ctx.translate(W / 2, cy); dbg = 'arcs';
    for (let k = 0; k < 2; k++) {
      const a0 = a + h + k * PI, a1 = a + PI - h + k * PI; c.k = idx * 2 + k;
      paint[m.fam](ctx, R, a0, a1, m, c);
      if (m.rare || c.gold) { ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = c.gold ? 'rgba(255,214,90,.6)' : grads.rare; ctx.lineWidth = 4.5; arcPath(ctx, R, a0, a1); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; }
      if (c.fr) frost(ctx, R, a0, a1);
      caps(ctx, R, a0, a1, c);
    }
    dbg = ''; ctx.restore();
  }
  const led = (ctx, acc, c) => { ctx.fillStyle = rgba(acc, 0.95); if (S.Q) { ctx.shadowColor = rgba(acc, 0.9); ctx.shadowBlur = 6 * S.k; } ctx.beginPath(); ctx.arc(2, 0, 2, 0, TAU); ctx.fill(); noShadow(ctx); };
  const mount = {                                  // static ornaments BESIDE the ring (|x| >= radius+4): they give each family its own silhouette without touching the ball's path
    chrome(ctx) {
      ctx.strokeStyle = 'rgba(150,170,200,.45)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(2, 0); ctx.stroke();
      const g = ctx.createRadialGradient(4, -2.5, 0.5, 6, 0, 8); g.addColorStop(0, '#fff'); g.addColorStop(0.35, '#8ea2c4'); g.addColorStop(0.75, '#0a111e'); g.addColorStop(1, '#2c3a56');
      dropShadow(ctx, 0.5); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(7, 0, 6, 0, TAU); ctx.fill(); noShadow(ctx);
    },
    glass(ctx) {
      const g = ctx.createLinearGradient(0, -16, 9, 16); g.addColorStop(0, 'rgba(60,230,255,.55)'); g.addColorStop(0.5, 'rgba(150,110,255,.35)'); g.addColorStop(1, 'rgba(255,90,210,.45)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(1, -17); ctx.lineTo(10, 0); ctx.lineTo(1, 17); ctx.lineTo(-3, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(cur.hi, 0.85); ctx.lineWidth = 0.9; ctx.stroke(); ctx.beginPath(); ctx.moveTo(1, -17); ctx.lineTo(1, 17); ctx.moveTo(-3, 0); ctx.lineTo(10, 0); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.stroke();
    },
    obsidian(ctx, m, c) {
      ctx.fillStyle = '#06070b'; ctx.beginPath(); ctx.moveTo(-2, -15); ctx.lineTo(10, -5); ctx.lineTo(7, 16); ctx.lineTo(-3, 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(cur.ed, 0.35 + 0.3 * Math.sin(c.t * 1.3 + m.ph)); ctx.lineWidth = 0.9; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, -15); ctx.lineTo(4, 3); ctx.lineTo(7, 16); ctx.strokeStyle = rgba(cur.ed, 0.55); ctx.stroke();
    },
    geo(ctx) {
      ctx.strokeStyle = rgba(cur.hi, 0.85); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(8, 0, 8, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(cur.acc, 0.9); ctx.beginPath(); ctx.arc(8, 0, 4.4, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(cur.hi, 0.5); ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(0, 0); ctx.moveTo(8, -8); ctx.lineTo(8, 8); ctx.stroke();
    }
  };
  function mounts(ctx, r, sy, m, c) {
    dbg = 'mounts'; const d = (r.layers[0].R0 || 70) + 15, acc = (typeof TC !== 'undefined' && TC[r.type]) ? rgb(TC[r.type]) : (c.gold ? [255, 214, 90] : null);
    ctx.save(); ctx.translate(W / 2, sy);
    for (const s of [-1, 1]) { ctx.save(); ctx.translate(s * d, 0); ctx.scale(s, 1); mount[m.fam](ctx, m, c); if (acc) led(ctx, acc, c); ctx.restore(); }
    ctx.restore(); dbg = '';
  }
  function bars(ctx, r, sy, m, c) {                // moving gate: the barrier is exactly the collision band (+-4px), sculpted with the same four material languages
    dbg = 'bars'; const g = r.gate, gx = W / 2 + g.A * Math.sin(g.th), f = m.fam;
    for (const [xa, xb, cap] of [[-24, gx - g.gh, 1], [gx + g.gh, W + 24, -1]]) {
      const w = xb - xa; if (w <= 0) continue;
      dropShadow(ctx, 0.6); ctx.fillStyle = f === 'glass' ? 'rgba(80,60,160,.35)' : f === 'obsidian' ? '#04050a' : f === 'geo' ? 'rgba(6,9,18,.97)' : '#070b14'; ctx.fillRect(xa, sy - 4, w, 8); noShadow(ctx);
      const gr = ctx.createLinearGradient(0, sy - 4, 0, sy + 4);
      if (f === 'chrome') { gr.addColorStop(0, rgba(cur.hi, 1)); gr.addColorStop(0.35, '#6b7f9f'); gr.addColorStop(0.6, '#0a111e'); gr.addColorStop(1, '#4a5d7e'); }
      else if (f === 'glass') { gr.addColorStop(0, 'rgba(60,230,255,.55)'); gr.addColorStop(0.5, 'rgba(150,110,255,.4)'); gr.addColorStop(1, 'rgba(255,90,210,.5)'); }
      else if (f === 'obsidian') { gr.addColorStop(0, '#1d2230'); gr.addColorStop(0.5, '#07080d'); gr.addColorStop(1, '#10131c'); }
      else { gr.addColorStop(0, 'rgba(20,28,48,1)'); gr.addColorStop(1, 'rgba(6,9,18,1)'); }
      ctx.fillStyle = gr; ctx.fillRect(xa, sy - 3.2, w, 6.4);
      ctx.fillStyle = rgba(cur.hi, f === 'obsidian' ? 0.25 : 0.85); ctx.fillRect(xa, sy - 4, w, 1);
      if (f === 'geo') { ctx.fillStyle = rgba(cur.acc, 0.9); for (let x = xa + 6; x < xb; x += 14) ctx.fillRect(x, sy - 1, 2, 2); }
      if (f === 'obsidian') { ctx.fillStyle = rgba(cur.ed, 0.7); for (let x = xa + 12; x < xb; x += 46) ctx.fillRect(x, sy - 0.5, 9, 1); }
      if (f === 'glass') { ctx.fillStyle = 'rgba(255,255,255,.3)'; for (let x = xa + 8; x < xb; x += 18) ctx.fillRect(x, sy - 3, 1, 6); }
      if (c.fr) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(120,215,255,.3)'; ctx.fillRect(xa, sy - 3.5, w, 7); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(238,252,255,.95)'; ctx.fillRect(xa, sy - 4, w, 1); ctx.fillRect(xa, sy + 3, w, 1); }
      ctx.fillStyle = c.fr ? 'rgba(238,252,255,.98)' : rgba(cur.hi, 0.85); ctx.fillRect(cap > 0 ? xb - 1.2 : xa, sy - 4, 1.2, 8);
    }
    dbg = '';
  }
  function pulse(ctx, r, sy, age) {                // freeze confirmation: thin light pulse, faint environment ripple, a few flying light fragments (all low-alpha, all brief)
    if (age > 0.4) return; dbg = 'fx';
    const R = r.layers[0] ? r.layers[0].R0 : 40, p = age / 0.4, cx = W / 2;
    ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(cur.hi, (1 - p) * 0.55); ctx.beginPath(); ctx.arc(cx, sy, R + 4 + p * 44, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(cur.acc, (1 - p) * 0.22); ctx.beginPath(); ctx.arc(cx, sy, R + 10 + p * 150, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(cur.hi, (1 - p) * 0.8); ctx.lineWidth = 1.1; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const t = i * TAU / 8 + hash(i * 1.9) * 0.3, r0 = R + 6 + p * 38; ctx.moveTo(cx + r0 * Math.cos(t), sy + r0 * Math.sin(t)); ctx.lineTo(cx + (r0 + 5) * Math.cos(t), sy + (r0 + 5) * Math.sin(t)); }
    ctx.stroke(); dbg = '';
  }
  function ring(ctx, r, sy, clock) {
    const m = metaOf(r), fr = r.frz > 0;
    if (fr && (m.fx === undefined || clock - m.fx > 0.45)) m.fx = clock; else if (!fr && m.fx !== undefined && clock - m.fx > 0.5) m.fx = undefined;
    const c = { t: clock, fr, k: 0, spec: fr ? 1.6 : 1, gold: !!r.gold };
    if (r.gate) bars(ctx, r, sy, m, c);
    else if (r.layers.length) { mounts(ctx, r, sy, m, c); for (let i = 0; i < r.layers.length; i++) arcs(ctx, r.layers[i], sy + (r.layers[i].dy || 0), i, m, c); }
    if (m.fx !== undefined) pulse(ctx, r, sy, clock - m.fx);
  }
  return { ENV, frame, base, layers, foreground, vignette, prep, ring, ball, metaOf, envPos, state: S, cur, dbgPhase: () => dbg,
           col: (k, a) => rgba(cur[k], a), font: (w, s) => w + ' ' + s + 'px ' + FONT };
})();
