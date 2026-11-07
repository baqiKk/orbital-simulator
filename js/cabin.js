'use strict';
// The cabin (kabin.html, Phase 9): a painted study facing a large window, the simulator's sky behind the glass.
// Layers, back to front: the live sky (#kSpace, fixed to the screen: far away, it does not grow when the camera walks
// to the glass), the lamp's glow on the glass, the room (img/cabin/<tier>/room.webp, see tools/cabin-art), the fish and
// the tea's steam, the cat (shadow, tail, ears, body, whiskers), what code draws onto paper (posters, card), the lamp-off
// shade, and what glows by itself (clock, laptop). Everything lives in art pixels (7136 × 3528, img/cabin/layout.json)
// inside one transformed stage (two elements, #kStage and #kTop, moved together), so every crop keeps the layers
// aligned. While the camera moves, the room's big layers are drawn on screen-sized canvases instead (mvBegin). No
// parallax: the room stands still.
applyI18n();
document.title = _('kabin.title');
const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const RM = matchMedia('(prefers-reduced-motion: reduce)');
// the simulator's saved low-resource mode (or ?q=low): no animation, no textures, a plain sky
const LS = (() => { try { return window.localStorage; } catch (e) { return null; } })();
const LOWQ = startupMode(LS).mode === 'low' || /[?&]q=low\b/.test(location.search);
if (LOWQ) document.documentElement.dataset.q = 'low';
const still = () => LOWQ || RM.matches;
const DEV = { phone: matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600,
  desktop: matchMedia('(hover: hover) and (pointer: fine)').matches, mem: navigator.deviceMemory };
// the GPU, asked once (not in the low-resource mode): WebGL 2 at all (the 3D glass), and the largest texture it takes; no
// art tier and no planet texture above that limit
const GPU = (() => {
  if (LOWQ) return { gl2: false, max: 0 };
  try {
    const c = document.createElement('canvas'), g = c.getContext('webgl2'); if (!g) return { gl2: false, max: 0 };
    const max = g.getParameter(g.MAX_TEXTURE_SIZE), x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext();
    return { gl2: true, max };
  } catch (e) { return { gl2: false, max: 0 }; }
})();
// Temporary debugging (?debug=1): an overlay in the corner with frame times, the art tier and the path drawn during
// camera moves, and A/B switches: move=dom (the old path: the DOM stage scaled, no move canvases), shine=0 (no room
// light), cap=<px> (3D texture cap), wc=1 (will-change: transform on the stage during DOM moves; off by default now),
// warm=<frames> (with wc=1: frames between promoting the stage and moving it). A developer aid with technical labels
// only; it goes when the bug it chases is fixed.
const DBG = (() => {
  const q = new URLSearchParams(location.search); if (q.get('debug') !== '1') return null;
  return { dom: q.get('move') === 'dom', shine: q.get('shine') !== '0', cap: +q.get('cap') || 0, warm: q.has('warm') ? +q.get('warm') : 3, wc: q.get('wc') === '1', frames: [], draws: 0, cost: [], path: '-', hand: {}, el: null };
})();
const TMAX = Math.min(cabTierMax(DEV), GPU.max ? CAB_TIERS.filter(t => t <= GPU.max).pop() || CAB_TIERS[0] : Infinity);
const TEX_CAP = Math.min(DEV.phone ? 2048 : 4096, GPU.max || Infinity, DBG && DBG.cap || Infinity);
const deg = Math.PI / 180;

// ---------- art-space geometry not in layout.json (measured on the illustration, art px) ----------
const AQ_WATER = [2372, 1886, 3028, 2196];            // inside the tank: fish and bubbles
const TEA_RIM = [2355, 2770, 118];                     // tea glass rim: centre x, y, half width
const STEAM_BOX = [2190, 2330, 2520, 2772];
const PHONES_LED = [902, 2948, 11];                    // a small light on the right ear cup: x, y, radius
const WHISKERS = [[4222, 1752, 4135, 1744], [4222, 1773, 4147, 1788], [4235, 1797, 4160, 1834],
  [4514, 1757, 4585, 1744], [4510, 1773, 4587, 1782], [4502, 1794, 4560, 1825]];
// the laptop's screen runs past the picture's right edge: its quad extended to an assumed right side
const LAP_QUAD = [[6556, 1999], [7600, 2017], [7600, 2971], [6370, 2862]];
// planets behind the glass (art px at the desk view; landscape / portrait) and their sun directions
const SCENES = {
  earth: { sun: [-0.85, 0.2, 0.5], bodies: [
    { key: 'moon', at: [[4192, 635], [4950, 560]], r: [75, 60], tilt: [-6, 5, -90] },
    { key: 'earth', at: [[3015, 1142], [3880, 980]], r: [400, 320], tilt: [-23, 18, -120], spin: true }] },
  saturn: { sun: [-0.55, 0.32, 0.77], bodies: [{ key: 'saturn', at: [[3050, 1080], [3950, 950]], r: [330, 220], tilt: [-14, 22, 0] }] },
};
// the free return as the simulator flies it: em_free (simplified model, 185 km parking orbit, 250 km perilune), core.js
// simulate() in the Earth–Moon rotating frame, Earth (0, 0), Moon (1, 0); thousandths, about every 0.02 (≈ 5.8 days)
const TRAJ = [-11,-13,7,-22,27,-23,47,-19,67,-14,87,-7,106,2,125,11,147,21,167,32,185,41,205,52,227,63,245,73,265,83,286,93,309,104,333,115,360,126,378,134,406,144,433,153,458,160,484,167,508,172,532,176,555,179,578,182,600,183,622,183,644,183,665,182,685,179,705,177,725,173,751,167,776,160,801,151,824,142,848,131,870,119,892,106,913,92,933,77,952,62,967,48,983,33,997,17,1005,-1,995,-19,981,-35,965,-50,949,-65,932,-78,914,-92,893,-106,871,-119,848,-131,825,-142,802,-152,777,-160,752,-167,726,-174,706,-177,686,-180,666,-182,645,-184,623,-184,602,-184,579,-183,557,-181,533,-177,509,-173,485,-168,460,-162,434,-154,408,-146,380,-136,361,-128,342,-120,323,-112,296,-99,272,-87,250,-76,230,-66,211,-56,188,-44,168,-33,150,-24,130,-14,109,-4,87,5,67,13,46,19,26,22,5,21,-11,12];
const TRAJ_DAYS = 5.8;
const trajAt = (E, M, i) => { const D = [M[0] - E[0], M[1] - E[1]], u = TRAJ[2 * i] / 1000, v = TRAJ[2 * i + 1] / 1000; return [E[0] + u * D[0] - v * D[1], E[1] + u * D[1] + v * D[0]]; };
function trajPath(E, M) { let d = ''; for (let i = 0; i < TRAJ.length / 2; i++) { const p = trajAt(E, M, i); d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); } return d; }

// ---------- small helpers ----------
const el = (tag, attrs = {}, parent = null, ns = null) => {
  const e = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e); return e;
};
const svgEl = (tag, attrs, parent) => el(tag, attrs, parent, NS);
const box = (e, x, y, w, h) => Object.assign(e.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
// CSS matrix3d taking a w×h box onto the quad q (TL, TR, BR, BL; Heckbert's square-to-quad)
function homography(w, h, q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3, den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, k = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3, d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${k / h},0,0,1,0,${x0},${y0},0,1)`;
}
// SVG affine taking local (0..w, 0..h) onto a quad's TL, TR, BL
const affine = (w, h, q) => `matrix(${(q[1][0] - q[0][0]) / w} ${(q[1][1] - q[0][1]) / w} ${(q[3][0] - q[0][0]) / h} ${(q[3][1] - q[0][1]) / h} ${q[0][0]} ${q[0][1]})`;
// a w×h box mapped onto quad q, in one of the stage's layers
function quadBox(w, h, q, cls, parent) { const d = el('div', { class: 'k-quad ' + cls }, parent); box(d, 0, 0, w, h); d.style.transform = homography(w, h, q); return d; }
// shrink an SVG text to max units wide when the language makes it longer
function fitText(t, max) { try { if (t.getComputedTextLength() > max) { t.setAttribute('textLength', max); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); } } catch (e) { /* not laid out */ } }
// handwriting: [x] in the dictionary string is a subscript
function richText(t, key) {
  const fs = parseFloat(t.getAttribute('font-size')), sh = fs * 0.3; let down = false;
  for (const part of _(key).split(/(\[[^\]]*\])/)) {
    if (!part) continue;
    const sub = part[0] === '[', s = svgEl('tspan', {}, t);
    s.textContent = sub ? part.slice(1, -1) : part;
    if (sub) { s.setAttribute('font-size', (fs * 0.68).toFixed(1)); if (!down) s.setAttribute('dy', sh); down = true; }
    else if (down) { s.setAttribute('dy', -sh); down = false; }
  }
}
// deterministic noise (positions of painted stars and fish starts stay put between visits)
const rnd = (() => { let s = 20261025; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();

const stage = $('#kStage'), STAGES = [stage, $('#kTop')];
const stageWC = v => { for (const s of STAGES) s.style.willChange = v; };
let LY = null, VW = 0, VH = 0, CAM = null, view = 'desk', ANIM = 0, ART_T = 0, DPR = 1;
const LAYERS = ['room', 'shadow', 'tail', 'earL', 'earR', 'body'];
const IMG = {};

// ---------- the art layers and their tiers ----------
function layerImg(name, T) {
  const L = name === 'room' ? { x: 0, y: 0, w: LY.size[0], h: LY.size[1] } : LY.layers[name];
  const im = new Image(); im.alt = ''; im.decoding = 'async'; im.draggable = false;
  im.className = 'k-layer k-' + name; im.src = `img/cabin/${T}/${name}.webp`;
  box(im, L.x, L.y, L.w, L.h);
  if (L.pivot) im.style.transformOrigin = `${L.pivot[0] - L.x}px ${L.pivot[1] - L.y}px`;
  return im;
}
// load tier T when it is sharper than the one shown; the new images replace the old ones once decoded (no flash), and
// never while the camera moves (TIER_SWAP waits for the end of the move: a mid-move swap re-rasterises the whole stage)
// Decoded sets by tier (DEC; layer name -> image) feed the move canvases: the sharpest one up to MV_CAP, so a 7136 room
// is never uploaded a second time as a canvas texture (a 3840 set is fetched for that). Only the shown tier and that
// one are kept.
let TIER_SWAP = null;
const DEC = {}, MV_CAP = 3840;
function wantTier(T) {
  if (T <= ART_T) return; ART_T = T;
  const fresh = LAYERS.map(n => [n, layerImg(n, T)]);
  const swap = () => {
    if (ART_T !== T) return;
    for (const k of Object.keys(DEC)) if (+k !== T && +k !== MV_CAP) delete DEC[k];
    if (T > MV_CAP && !DEC[MV_CAP]) mvPreload();
    for (const [n, im] of fresh) { if (IMG[n]) IMG[n].replaceWith(im); else $(n === 'room' ? '#kRoomSlot' : '#kCat').appendChild(im); IMG[n] = im; }
    $('#kCat').appendChild($('#kWhisk'));
    for (const id of ['#kNight', '#kShine']) $(id).style.setProperty('--room', `url("${new URL(`img/cabin/${T}/room.webp`, location.href)}")`);
    document.body.classList.add('k-ready');
  };
  Promise.all(fresh.map(([, im]) => im.decode().catch(() => {}))).then(() => { DEC[T] = Object.fromEntries(fresh); if (ANIM) TIER_SWAP = swap; else swap(); });
}
let MV_LOADING = false;
function mvPreload() {
  if (MV_LOADING) return; MV_LOADING = true;
  const set = LAYERS.map(n => [n, layerImg(n, MV_CAP)]);
  Promise.all(set.map(([, im]) => im.decode())).then(() => { if (ART_T > MV_CAP) DEC[MV_CAP] = Object.fromEntries(set); }).catch(() => {}).finally(() => { MV_LOADING = false; });
}
const tierSwapNow = () => { const f = TIER_SWAP; TIER_SWAP = null; if (f) f(); };
const needTier = s => cabTier(LY.size[0] * s * DPR, TMAX);

// ---------- what code draws ----------
function buildArt() {
  const art = $('#kArt');
  // left poster: title, subtitle, the free return in the blank panel, facts
  const pL = svgEl('g', { transform: affine(452, 496, LY.posterL), class: 'k-poster' }, art);
  const t1 = svgEl('text', { x: 226, y: -66, 'text-anchor': 'middle', 'font-size': 66, class: 'k-disp k-ink' }, pL); t1.textContent = _('kab.poster.title');
  const t2 = svgEl('text', { x: 226, y: -24, 'text-anchor': 'middle', 'font-size': 23, 'letter-spacing': 6, class: 'k-disp k-ink2' }, pL); t2.textContent = _('kab.poster.sub');
  const t3 = svgEl('text', { x: 226, y: 544, 'text-anchor': 'middle', 'font-size': 21, class: 'k-disp k-ink2' }, pL); t3.textContent = _('kab.poster.facts');
  const st = svgEl('g', { class: 'k-pstars' }, pL);
  for (let i = 0; i < 46; i++) svgEl('circle', { cx: (12 + rnd() * 428).toFixed(1), cy: (12 + rnd() * 472).toFixed(1), r: (0.8 + rnd() * 1.6).toFixed(2) }, st);
  const E = [226, 404], M = [226, 92];
  svgEl('circle', { cx: E[0], cy: E[1], r: 70, class: 'k-pring' }, pL);
  svgEl('path', { d: trajPath(E, M), class: 'k-ptraj' }, pL);
  svgEl('circle', { cx: E[0], cy: E[1], r: 30, class: 'k-pearth' }, pL);
  svgEl('circle', { cx: M[0], cy: M[1], r: 10, class: 'k-pmoon' }, pL);
  // right poster: the photo (the quad is a parallelogram within 5 px: an affine map, so the lamp-off shade blends with it) and its caption
  const pR = svgEl('g', { transform: affine(639, 644, LY.posterR) }, art);
  const pv = svgEl('svg', { width: 639, height: 644, viewBox: '0 0 1280 1280', preserveAspectRatio: 'xMidYMid slice' }, pR);
  svgEl('image', { href: 'img/cabin/earthrise.jpg', width: 1280, height: 1280 }, pv);
  const t4 = svgEl('text', { x: 320, y: 706, 'text-anchor': 'middle', 'font-size': 38, class: 'k-hand k-ink' }, pR); t4.textContent = _('kab.poster.photoCap');
  // the card: two handwritten rocket equations
  const cd = quadBox(660, 200, LY.card, 'k-card', $('#kPaper')), cs = svgEl('svg', { viewBox: '0 0 660 200', width: 660, height: 200 }, cd);
  for (const [k, y] of [['kab.card.l1', 82], ['kab.card.l2', 158]]) richText(svgEl('text', { x: 46, y, 'font-size': 46, class: 'k-hand k-ink' }, cs), k);
  // the cat's whiskers (thin, lit like the fur)
  const wk = $('#kWhisk');
  for (const [x0, y0, x1, y1] of WHISKERS) { const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - 5; svgEl('path', { d: `M${x0} ${y0}Q${mx} ${my} ${x1} ${y1}` }, wk); }
  for (const t of [t1, t3]) fitText(t, 440); fitText(t2, 400); fitText(t4, 580);
  buildClock(); buildLaptop();
}

// the clock's digits (seven segments): the time of day, or the pomodoro's time left while it is on (mm:ss; past 99
// minutes h:mm), lamp amber at work and screen cyan on a break, with a small dot beside the digits; paused or waiting
// for the next session, the digits blink
const SEGS = (() => {
  const h = (x, y, l, t = 5) => `${x},${y} ${x + t / 2},${y - t / 2} ${x + l - t / 2},${y - t / 2} ${x + l},${y} ${x + l - t / 2},${y + t / 2} ${x + t / 2},${y + t / 2}`;
  const v = (x, y, l, t = 5) => `${x},${y} ${x + t / 2},${y + t / 2} ${x + t / 2},${y + l - t / 2} ${x},${y + l} ${x - t / 2},${y + l - t / 2} ${x - t / 2},${y + t / 2}`;
  return { a: h(6, 3, 18), b: v(27, 6, 18), c: v(27, 30, 18), d: h(6, 51, 18), e: v(3, 30, 18), f: v(3, 6, 18), g: h(6, 27, 18) };
})();
const DIGIT = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
const CLOCK = { cells: [], shown: '', g: null };
function buildClock() {
  const c = LY.clock, k = 2.55, w = 164 * k, h = 54 * k;
  const g = CLOCK.g = svgEl('g', { transform: `translate(${c.x0 + (c.x1 - c.x0 - w) / 2 - 4} ${c.y0 + (c.y1 - c.y0 - h) / 2}) scale(${k}) skewX(-6)`, class: 'k-seg7' }, $('#kGlowArt'));
  [0, 38, 96, 134].forEach(x => { const cell = svgEl('g', { transform: `translate(${x} 0)` }, g); for (const [s, p] of Object.entries(SEGS)) svgEl('polygon', { 'data-s': s, points: p }, cell); CLOCK.cells.push(cell); });
  svgEl('circle', { cx: -16, cy: 27, r: 4.5, class: 'k-pdot' }, g);
  const colon = svgEl('g', { class: 'k-colon' }, g);
  svgEl('polygon', { points: '81,14 86,14 85,20 80,20', class: 'on' }, colon); svgEl('polygon', { points: '79,34 84,34 83,40 78,40', class: 'on' }, colon);
}
// four characters (digits or a blank) and the face's classes
function clockSet(t, cls) {
  if (t + '|' + cls === CLOCK.shown) return; CLOCK.shown = t + '|' + cls;
  CLOCK.cells.forEach((c, i) => { const on = t[i] === ' ' ? '' : DIGIT[+t[i]]; for (const p of c.children) p.classList.toggle('on', on.includes(p.dataset.s)); });
  $('#kGlowArt').setAttribute('class', 'k-svg' + cls);
}
function clockTick() {
  const v = PO.v;
  if (!v || v.phase === 'idle') { const d = new Date(); clockSet(String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0'), ''); return; }
  const ms = v.phase === 'wait' ? PO.s.cfg.work * POMO_MIN : v.left, m = Math.ceil(ms / 60000);
  const t = ms > 5999000 ? ' ' + Math.floor(m / 60) + String(m % 60).padStart(2, '0') : pomoClock(ms).replace(':', '');
  clockSet(t, ' po' + (v.phase === 'work' ? '' : v.phase === 'wait' ? ' wait' : ' brk') + (v.paused ? ' held' : ''));
}

// the laptop: the free return on a dark map, a dot flying it in six minutes, its mission time
// While a flight plan flies (Phase 10): the leg's track about its system's root body (ecliptic x, y), the target and
// the craft at the mission's time, the plan's name and its mission time
const LAP = { dot: null, met: null, today: null, title: null, free: null, plan: null, path: null, root: null, tgt: null, cdot: null, key: '', fit: null, E: [118, 440], M: [520, 168] };
function buildLaptop() {
  const d = quadBox(1000, 600, LAP_QUAD, 'k-lap', $('#kEmit')), s = svgEl('svg', { viewBox: '0 0 1000 600', width: 1000, height: 600 }, d);
  svgEl('rect', { width: 1000, height: 600, class: 'k-lapbg' }, s);
  const grid = svgEl('g', { class: 'k-lapgrid' }, s);
  for (let x = 60; x < 1000; x += 80) svgEl('path', { d: `M${x} 90V560` }, grid);
  for (let y = 90; y <= 560; y += 80) svgEl('path', { d: `M30 ${y}H1000` }, grid);
  const t = LAP.title = svgEl('text', { x: 36, y: 58, 'font-size': 26, class: 'k-mono k-lapt' }, s); t.textContent = _('kab.lap.title');
  const fr = LAP.free = svgEl('g', {}, s), pl = LAP.plan = svgEl('g', { display: 'none' }, s);
  svgEl('path', { d: trajPath(LAP.E, LAP.M), class: 'k-laptraj' }, fr);
  svgEl('circle', { cx: LAP.E[0], cy: LAP.E[1], r: 26, class: 'k-lapearth' }, fr);
  svgEl('circle', { cx: LAP.M[0], cy: LAP.M[1], r: 8, class: 'k-lapmoon' }, fr);
  LAP.dot = svgEl('circle', { r: 7, class: 'k-lapdot' }, fr);
  LAP.path = svgEl('path', { class: 'k-laptraj' }, pl);
  LAP.root = svgEl('circle', { class: 'k-lapearth' }, pl);
  LAP.tgt = svgEl('circle', { r: 8, class: 'k-lapmoon' }, pl);
  LAP.cdot = svgEl('circle', { r: 7, class: 'k-lapdot' }, pl);
  LAP.met = svgEl('text', { x: 36, y: 580, 'font-size': 24, class: 'k-mono k-lapt' }, s);
  LAP.today = svgEl('text', { x: 36, y: 96, 'font-size': 22, class: 'k-mono k-lapt k-lapday' }, s); // today's focus (the pomodoro)
  PO.stRaw = undefined;
}
function lapTick() {
  const st = FV.on ? fvState(Date.now()) : null;
  LAP.free.setAttribute('display', st ? 'none' : 'inline'); LAP.plan.setAttribute('display', st ? 'inline' : 'none');
  if (st) { lapPlan(st); return; }
  if (LAP.key) { LAP.key = ''; LAP.title.textContent = _('kab.lap.title'); }
  const n = TRAJ.length / 2, f = (Date.now() / 360000) % 1, i = f * (n - 1), i0 = Math.floor(i), a = trajAt(LAP.E, LAP.M, i0), b = trajAt(LAP.E, LAP.M, Math.min(n - 1, i0 + 1)), u = i - i0;
  LAP.dot.setAttribute('cx', (a[0] + (b[0] - a[0]) * u).toFixed(1)); LAP.dot.setAttribute('cy', (a[1] + (b[1] - a[1]) * u).toFixed(1));
  const hrs = Math.floor(f * TRAJ_DAYS * 24);
  LAP.met.textContent = _('kab.lap.met', { d: Math.floor(hrs / 24), h: String(hrs % 24).padStart(2, '0') });
}
function lapPlan(st) {
  const tr = st.a.tr, sys = fpSys(tr), r0 = 3 * sys.root, P = new Float64Array(3 * sys.N), V = new Float64Array(3 * sys.N), key = PO.s.plan + '/' + st.D.tracks.indexOf(tr);
  const rel = (y, t) => { states(sys, tr.M.t0 * DAY + t, P, V); return [y[0] - P[r0], y[1] - P[r0 + 1]]; };
  if (key !== LAP.key) { // the track (Hermite between its points), fitted with the root body into the screen
    LAP.key = key;
    const pts = [], y = new Array(6);
    for (let i = 0; i < tr.t.length - 1; i++) for (let k = 0; k < 8; k++) { const t = tr.t[i] + (tr.t[i + 1] - tr.t[i]) * k / 8; pts.push(rel(fpTrack(tr, t, y), t)); }
    pts.push(rel(fpTrack(tr, tr.t[tr.t.length - 1], y), tr.t[tr.t.length - 1]));
    let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
    for (const [x, q] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, q); y1 = Math.max(y1, q); }
    const k = Math.min(860 / (x1 - x0 || 1), 400 / (y1 - y0 || 1)), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    LAP.fit = p => [510 + (p[0] - mx) * k, 335 - (p[1] - my) * k];
    LAP.path.setAttribute('d', pts.map((p, i) => (i ? 'L' : 'M') + LAP.fit(p).map(c => c.toFixed(1)).join(' ')).join(''));
    const c = LAP.fit([0, 0]); LAP.root.setAttribute('cx', c[0].toFixed(1)); LAP.root.setAttribute('cy', c[1].toFixed(1)); LAP.root.setAttribute('r', Math.max(10, Math.min(26, sys.R[sys.root] * k)).toFixed(1));
    LAP.title.textContent = _('fp.name.' + PO.s.plan).toLocaleUpperCase(DICT['meta.locale']);
  }
  const a = st.a, cr = LAP.fit(rel(a.y, a.t)), ti = tr.keys.indexOf(a.around || a.look), tg = LAP.fit([P[3 * ti] - P[r0], P[3 * ti + 1] - P[r0 + 1]]);
  LAP.cdot.setAttribute('cx', cr[0].toFixed(1)); LAP.cdot.setAttribute('cy', cr[1].toFixed(1));
  LAP.tgt.setAttribute('cx', tg[0].toFixed(1)); LAP.tgt.setAttribute('cy', tg[1].toFixed(1)); LAP.tgt.setAttribute('display', ti === sys.root ? 'none' : 'inline');
  const hrs = Math.floor(a.t / 3600);
  LAP.met.textContent = _('kab.lap.met', { d: Math.floor(hrs / 24), h: String(hrs % 24).padStart(2, '0') });
}

// ---------- fish, bubbles, steam (small canvases, drawn only while something moves) ----------
const AQ = { cv: $('#kAqua'), fish: [], bub: [] };
const ST = { cv: $('#kSteam'), puffs: [], sprite: null };
function initLife() {
  const [x0, y0, x1, y1] = AQ_WATER, w = x1 - x0, h = y1 - y0;
  box(AQ.cv, x0, y0, w, h); box(ST.cv, STEAM_BOX[0], STEAM_BOX[1], STEAM_BOX[2] - STEAM_BOX[0], STEAM_BOX[3] - STEAM_BOX[1]);
  // three fish like the painted ones (two orange, one white with an orange tail); art px inside the tank
  const looks = [['#f08a3c', '#f6b26b', '#e2672a', 88], ['#ec7a35', '#f3a35c', '#d65a24', 74], ['#f1e6d6', '#fff8ee', '#ef7a3a', 66]];
  AQ.fish = looks.map(([body, belly, fin, len], i) => ({ body, belly, fin, len, x: 90 + rnd() * (w - 180), y: 50 + i * 80 + rnd() * 30, vx: (rnd() < 0.5 ? -1 : 1) * (14 + rnd() * 10), dir: 1, face: 1, tx: 0, ty: 0, ph: rnd() * 6, wait: rnd() * 3 }));
  for (const f of AQ.fish) { f.dir = Math.sign(f.vx); f.face = f.dir; f.tx = f.x; f.ty = f.y; }
  AQ.bub = Array.from({ length: 12 }, () => ({ x: 0, y: -1, r: 0, v: 0, ph: 0 }));
  // steam sprite: a soft warm puff (cached once)
  const sp = document.createElement('canvas'); sp.width = sp.height = 64; const g = sp.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,240,220,.55)'); gr.addColorStop(0.5, 'rgba(255,232,205,.22)'); gr.addColorStop(1, 'rgba(255,225,195,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); ST.sprite = sp;
  ST.puffs = Array.from({ length: 22 }, () => ({ age: 1, life: 0 }));
}
function sizeLife() {
  for (const cv of [AQ.cv, ST.cv]) { const k = CAM.s * DPR; cv.width = Math.max(1, Math.round(parseFloat(cv.style.width) * k)); cv.height = Math.max(1, Math.round(parseFloat(cv.style.height) * k)); }
}
function drawFish(g, f, t) {
  const L = f.len, H = L * 0.46, wag = Math.sin(t * 7 + f.ph) * 0.18;
  g.save(); g.translate(f.x, f.y); g.scale(f.face, 1);
  g.fillStyle = f.fin; g.beginPath(); g.moveTo(-L * 0.42, 0); g.lineTo(-L * 0.78, -H * 0.55 + wag * L * 0.3); g.lineTo(-L * 0.7, wag * L * 0.2); g.lineTo(-L * 0.78, H * 0.55 + wag * L * 0.3); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-L * 0.08, -H * 0.42); g.quadraticCurveTo(L * 0.05, -H * 0.85, L * 0.16, -H * 0.4); g.fill();
  g.fillStyle = f.body; g.beginPath(); g.ellipse(0, 0, L * 0.48, H * 0.5, 0, 0, 6.2832); g.fill();
  g.fillStyle = f.belly; g.globalAlpha = 0.55; g.beginPath(); g.ellipse(L * 0.05, H * 0.16, L * 0.32, H * 0.22, 0, 0, 6.2832); g.fill(); g.globalAlpha = 1;
  g.fillStyle = '#1a1210'; g.beginPath(); g.arc(L * 0.3, -H * 0.08, L * 0.055, 0, 6.2832); g.fill();
  g.restore();
}
function stepAqua(dt, t) {
  const [x0, y0, x1, y1] = AQ_WATER, w = x1 - x0, h = y1 - y0, cv = AQ.cv, g = cv.getContext('2d'), k = cv.width / w;
  for (const f of AQ.fish) {
    if (dt) {
      f.wait -= dt;
      if (f.wait <= 0 && Math.abs(f.tx - f.x) < 6) { f.tx = 70 + rnd() * (w - 140); f.ty = 40 + rnd() * (h - 120); f.wait = 2 + rnd() * 6; }
      const want = Math.sign(f.tx - f.x) || f.dir, sp = Math.min(1, Math.abs(f.tx - f.x) / 60) * (20 + f.len * 0.2);
      f.dir = want; f.face += (f.dir - f.face) * Math.min(1, dt * 3);
      f.x += f.dir * sp * dt; f.y += (f.ty - f.y) * Math.min(1, dt * 0.6) + Math.sin(t * 1.3 + f.ph) * 0.15;
    }
  }
  for (const b of AQ.bub) {
    if (b.y < 0 && dt && rnd() < dt * 0.35) Object.assign(b, { x: 300 + rnd() * 40, y: h - 40, r: 2.5 + rnd() * 4, v: 26 + rnd() * 20, ph: rnd() * 6 });
    if (b.y >= 0) { b.y -= b.v * dt; b.x += Math.sin(t * 3 + b.ph) * 0.4; if (b.y < 14) b.y = -1; }
  }
  g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, w, h);
  g.globalAlpha = 0.9; for (const f of AQ.fish) drawFish(g, f, t); g.globalAlpha = 1;
  g.strokeStyle = 'rgba(225,245,250,.6)'; g.lineWidth = 1.6;
  for (const b of AQ.bub) if (b.y >= 0) { g.beginPath(); g.arc(b.x, b.y, b.r, 0, 6.2832); g.stroke(); }
}
function stepSteam(dt, t) {
  const cv = ST.cv, g = cv.getContext('2d'), w = STEAM_BOX[2] - STEAM_BOX[0], h = STEAM_BOX[3] - STEAM_BOX[1], k = cv.width / w;
  const ox = TEA_RIM[0] - STEAM_BOX[0], oy = TEA_RIM[1] - STEAM_BOX[1];
  for (const p of ST.puffs) {
    if (p.age > p.life && dt && rnd() < dt * 0.4) Object.assign(p, { age: 0, life: 5 + rnd() * 3, x: ox + (rnd() - 0.5) * TEA_RIM[2] * 1.1, y: oy - 4, s: 16 + rnd() * 12, ph: rnd() * 6 });
    if (p.age <= p.life) p.age += dt;
  }
  g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, w, h); g.globalCompositeOperation = 'lighter';
  for (const p of ST.puffs) {
    if (p.age > p.life) continue;
    const u = p.age / p.life, a = Math.sin(Math.PI * Math.sqrt(u)) * (1 - u) * 0.6, y = p.y - u * 380, x = p.x + Math.sin(t * 0.7 + p.ph + u * 4) * 34 * u, s = p.s * (1 + u * 3);
    g.globalAlpha = a; g.drawImage(ST.sprite, x - s, y - s, 2 * s, 2 * s);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
}
// one loop for the canvases: about 30 frames a second, none while hidden, still or zooming
const LOOP = { raf: 0, last: 0, t: 0 };
function loop(now) {
  LOOP.raf = 0;
  if (document.hidden || still()) return;
  const dt = Math.min(0.1, (now - LOOP.last) / 1000 || 0);
  if (dt >= 1 / 31) { LOOP.last = now; LOOP.t += dt; stepAqua(dt, LOOP.t); stepSteam(dt, LOOP.t); }
  LOOP.raf = requestAnimationFrame(loop);
}
function loopStart() { if (!LOOP.raf && !still() && !document.hidden) { LOOP.last = performance.now(); LOOP.raf = requestAnimationFrame(loop); } }
function drawStill() { stepAqua(0, 0); ST.cv.getContext('2d').clearRect(0, 0, ST.cv.width, ST.cv.height); }
// fish and steam drawn again as they are now (no time passes): after sizeLife, whose resize clears both canvases, so
// they never show empty until the loop's next frame
let LIFE_T = -1;
function lifeNow() { if (still()) drawStill(); else { stepAqua(0, LOOP.t); stepSteam(0, LOOP.t); } LIFE_T = performance.now(); }

// ---------- the sky behind the glass ----------
// Drawn at screen resolution once per resize (and every minute for the Earth's turn): the site's Milky Way and star
// catalogue (skyReady) projected as in the 2D simulator, planets by globe.js drawGlobe. Low-resource mode: no download,
// a few hundred plain stars and shaded discs.
const SP = { cv: $('#kSpace'), sky: null, md: null, scene: 'earth', timer: 0, M: 0, F: 1, G: [0, 0], P0: [0, 0] };
const FX = { clouds: true, relief: true, glint: true };
const norm = v => { const l = Math.hypot(...v); return v.map(c => c / l); };
const SKYV = (() => { // look beside Scorpius–Ophiuchus (ecliptic λ 242°, β +9°), rolled so the Milky Way runs diagonally
  const lam = 242 * deg, bet = 9 * deg, rol = 50 * deg;
  const f = [Math.cos(bet) * Math.cos(lam), Math.cos(bet) * Math.sin(lam), Math.sin(bet)];
  let u = [-f[2] * f[0], -f[2] * f[1], 1 - f[2] * f[2]]; const ul = Math.hypot(...u); u = u.map(c => c / ul);
  const r = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]], c = Math.cos(rol), s = Math.sin(rol);
  return { f, r: r.map((v, i) => c * v + s * u[i]), u: u.map((v, i) => c * v - s * r[i]) };
})();
// body -> screen (row-major; x right, y up, z to the viewer): pole tipped `open` degrees towards the viewer, rolled
// `roll` degrees, the body turned `spin` degrees about its pole (spin −90 puts longitude 0 in front)
function rotOf(roll, open, spin) {
  const c = Math.cos, s = Math.sin, a = roll * deg, b = open * deg, p = spin * deg;
  const mul = (A, B) => A.map(r => B[0].map((_, j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  return mul([[c(a), -s(a), 0], [s(a), c(a), 0], [0, 0, 1]], mul([[1, 0, 0], [0, c(b), -s(b)], [0, s(b), c(b)]], mul([[1, 0, 0], [0, 0, 1], [0, -1, 0]], [[c(p), -s(p), 0], [s(p), c(p), 0], [0, 0, 1]]))).flat();
}
function buildSky(sk) {
  const cw = SP.cv.width / DPR, ch = SP.cv.height / DPR, F = SP.F, hs = 0.5, w1 = Math.ceil(cw * hs), h1 = Math.ceil(ch * hs);
  const mi = sk.milky.img, mw = mi.naturalWidth, mh = mi.naturalHeight;
  if (!SP.md || SP.md.img !== mi) {
    const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
    const mg = mc.getContext('2d', { willReadFrequently: true }); mg.drawImage(mi, 0, 0);
    SP.md = { img: mi, d: mg.getImageData(0, 0, mw, mh).data };
  }
  const md = SP.md.d, cx = SP.G[0], cy = SP.G[1];
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }, srgb = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const LUT = new Float32Array(256).map((_, i) => lin(i));
  const c1 = document.createElement('canvas'); c1.width = w1; c1.height = h1;
  const hg = c1.getContext('2d'), im = hg.createImageData(w1, h1), ce = Math.cos(OBLIQ), se = Math.sin(OBLIQ);
  const vd = linC(getComputedStyle(document.documentElement).getPropertyValue('--void').trim()), gain = SKY_GAIN * 0.6, { f, r, u } = SKYV;
  for (let y = 0; y < h1; y++) for (let x = 0; x < w1; x++) {
    const ex = ((x + 0.5) / hs - cx) / F, ey = (cy - (y + 0.5) / hs) / F;
    let e0 = f[0] + ex * r[0] + ey * u[0], e1 = f[1] + ex * r[1] + ey * u[1], e2 = f[2] + ex * r[2] + ey * u[2];
    const l = Math.hypot(e0, e1, e2); e0 /= l; e1 /= l; e2 /= l;
    const q1 = ce * e1 - se * e2, q2 = se * e1 + ce * e2;
    let uu = 0.5 - Math.atan2(q1, e0) / (2 * Math.PI); uu -= Math.floor(uu);
    const v = 0.5 - Math.asin(q2) / Math.PI, px = uu * mw - 0.5, py = Math.min(mh - 1, Math.max(0, v * mh - 0.5)), x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    const a = 4 * (y0 * mw + (x0 + mw) % mw), b = 4 * (y0 * mw + (x0 + 1) % mw), dy = 4 * mw * (Math.min(mh - 1, y0 + 1) - y0), o = 4 * (y * w1 + x);
    for (let c = 0; c < 3; c++) {
      const m = (1 - fy) * ((1 - fx) * LUT[md[a + c]] + fx * LUT[md[b + c]]) + fy * ((1 - fx) * LUT[md[a + dy + c]] + fx * LUT[md[b + dy + c]]);
      im.data[o + c] = srgb(Math.min(1, vd[c] + m * gain)) + Math.random() - 0.5;
    }
    im.data[o + 3] = 255;
  }
  hg.putImageData(im, 0, 0);
  const out = document.createElement('canvas'); out.width = SP.cv.width; out.height = SP.cv.height;
  const g = out.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(c1, 0, 0, w1, h1, 0, 0, out.width, out.height);
  g.setTransform(DPR, 0, 0, DPR, 0, 0); g.globalCompositeOperation = 'lighter';
  const S = sk.stars;
  for (let i = 0; i < S.n; i++) {
    const d0 = S.dir[3 * i], d1 = S.dir[3 * i + 1], d2 = S.dir[3 * i + 2], dz = d0 * f[0] + d1 * f[1] + d2 * f[2]; if (dz < 0.05) continue;
    const x = cx + F * (d0 * r[0] + d1 * r[1] + d2 * r[2]) / dz, y = cy - F * (d0 * u[0] + d1 * u[1] + d2 * u[2]) / dz;
    if (x < -4 || x > cw + 4 || y < -4 || y > ch + 4) continue;
    const p = starPeak(S.mag[i]); if (p < 0.02) continue;
    const al = Math.min(1, p), rr = 0.7 * Math.min(4, Math.max(1, Math.pow(p, 0.35)));
    g.fillStyle = `rgba(${Math.round(srgb(S.col[3 * i]))},${Math.round(srgb(S.col[3 * i + 1]))},${Math.round(srgb(S.col[3 * i + 2]))},${al.toFixed(3)})`;
    g.beginPath(); g.arc(x, y, rr, 0, 6.2832); g.fill();
  }
  return out;
}
// low-resource sky: plain points, the same every time
function plainSky() {
  const out = document.createElement('canvas'); out.width = SP.cv.width; out.height = SP.cv.height;
  const g = out.getContext('2d'); g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--void'); g.fillRect(0, 0, out.width, out.height);
  let s = 7; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = Math.round(out.width * out.height / 9000);
  for (let i = 0; i < n; i++) { const b = r(); g.fillStyle = `rgba(235,240,255,${(0.15 + 0.7 * b * b).toFixed(2)})`; g.fillRect(r() * out.width, r() * out.height, DPR * (b > 0.9 ? 1.6 : 1), DPR * (b > 0.9 ? 1.6 : 1)); }
  return out;
}
function compose() {
  const cv = SP.cv, g = cv.getContext('2d'), cw = cv.width / DPR, ch = cv.height / DPR;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--void'); g.fillRect(0, 0, cv.width, cv.height);
  if (SP.sky) g.drawImage(SP.sky, 0, 0);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const sc = SCENES[SP.scene], k = VW < VH * 1.1 ? 1 : 0, d = cabCrop(VW, VH, ...LY.size), gc = glassC();
  const spin = (Date.now() / 86164090 * 360) % 360, sun = norm(sc.sun), voidC = getComputedStyle(document.documentElement).getPropertyValue('--void');
  for (const b of sc.bodies) {
    const x = SP.G[0] + (b.at[k][0] - gc[0]) * d.s, y = SP.G[1] + (b.at[k][1] - gc[1]) * d.s, r = b.r[k] * d.s;
    const rot = rotOf(b.tilt[0], b.tilt[1], b.tilt[2] + (b.spin ? spin : 0));
    const look = globeLook(b.key, r, !LOWQ, !LOWQ, TEX_CAP, FX, 0);
    if (look && drawGlobe(g, x, y, r, cw, ch, DPR, { rot, sun, color: BODIES[b.key].color, look })) continue;
    // plain disc, lit from the sun's side
    const gr = g.createRadialGradient(x + sun[0] * r * 0.5, y - sun[1] * r * 0.5, r * 0.1, x, y, r * 1.05);
    gr.addColorStop(0, BODIES[b.key].color); gr.addColorStop(1, voidC);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
}
const pending = () => { const now = performance.now(); for (const e of TEXC.values()) if (!e.err && (!e.ok || now - e.t < TEX_FADE + 100)) return true; return false; };
function spaceTick() {
  SP.timer = 0;
  if (FV.on) return; // the flight has the glass
  if (!SP.sky) { if (LOWQ) SP.sky = plainSky(); else { const sk = skyReady(true, false); if (sk) SP.sky = buildSky(sk); } }
  compose();
  SP.timer = setTimeout(spaceTick, !SP.sky || pending() ? 150 : 60000); // the Earth turns a quarter of a degree a minute
}
function spaceSoon() { clearTimeout(SP.timer); SP.timer = setTimeout(spaceTick, 0); }

// ---------- the flight behind the glass (Phase 10) ----------
// While the pomodoro runs a flight plan (js/flightplans.js), the glass shows the view from the craft: at work towards
// the leg's target, which grows as the craft closes in (true sizes); in a break along the orbit, tipped down towards
// the body so the surface turns below; in a cruise break slowly rolling. Drawn by the simulator's 3D renderer
// (js/view3d.js and Three.js, fetched with import() only here and only then): camera at the craft, ecliptic axes, the
// site's sky and planet images through skyReady / globeLook. A frame is drawn when the picture has moved by about half
// a pixel (a slow approach: about once every two seconds; an orbit: up to 20 a second), never while hidden. Low-resource
// mode, no WebGL 2 or reduced motion: no Three.js and no images, the plain sky and shaded discs at their true places and
// sizes on the 2D canvas, every 5 s (1 s in a break); with reduced motion the break view looks at the body. A new phase
// (a jump) fades the glass out and in.
const FV = { on: false, gl: null, fail: false, V3: null, load: null, cv: $('#kSpace3'), keys: '', sky: false, fov: 45, raf: 0, last: 0, drawn: 0, sig: '', cam: null, rpx: -1, fade: 0, plain: null, timer: 0, shV: 0, shO: 0, shT: 0, shTarget: 0, shCol: '', shColSet: '', shTimer: 0 };
const FV_L = 1e9;          // m: the 3D camera's target, this far ahead of the craft (the eye is at the craft)
const FV_TILT = 25 * deg;  // the break view, tipped down from the flight direction
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vang = (a, b) => 2 * Math.asin(Math.min(1, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2)); // unit vectors
function slerp(a, b, t) {
  const th = vang(a, b);
  if (th < 1e-6) return a;
  if (Math.PI - th < 1e-3) { const k = norm(vcross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), ph = Math.PI * t; return a.map((c, i) => Math.cos(ph) * c + Math.sin(ph) * k[i]); }
  const s = Math.sin(th), p = Math.sin((1 - t) * th) / s, q = Math.sin(t * th) / s;
  return norm(a.map((c, i) => p * c + q * b[i]));
}
// the 3D path: not low-resource, no reduced motion, WebGL 2 (checked once), the module loaded fine
function fvGL() {
  if (FV.gl == null) FV.gl = !LOWQ && GPU.gl2;
  return FV.gl && !FV.fail && !RM.matches;
}
// the flight now: plan data, where (fpWhere), the craft (fpAt), the bodies (fpBodies); null without a plan or idle
function fvState(now) {
  const s = PO.s, D = s && FLIGHT_DATA[s.plan]; if (!D) return null;
  const w = fpWhere(D, s, pomoView(s, now), now); if (!w) return null;
  const a = fpAt(D, w);
  return { D, w, a, b: fpBodies(D, a) };
}
// the camera: forward f, right r, up u (unit, ecliptic axes)
function fvCam(st) {
  const { a, b } = st, y = a.y, at = k => b.list.find(q => q.key === k);
  let f, up;
  if (a.around) {
    const q = at(a.around), r = norm(vsub(y, q.p)), v = norm(vsub(y.slice(3), q.v));
    if (RM.matches) { f = r.map(c => -c); up = v; } else { f = norm(v.map((c, i) => Math.cos(FV_TILT) * c - Math.sin(FV_TILT) * r[i])); up = r; }
  } else {
    f = norm(vsub(at(a.look).p, y));
    if (a.mix) f = slerp(f, norm(vsub(at(a.look2).p, y)), a.mix);
    up = [0, 0, 1];
  }
  let r = vcross(f, up); if (Math.hypot(...r) < 1e-6) r = vcross(f, [0, 1, 0]);
  r = norm(r); up = vcross(r, f);
  if (a.roll) { const c = Math.cos(a.roll), s = Math.sin(a.roll), r0 = r; r = r0.map((x, i) => c * x + s * up[i]); up = up.map((x, i) => c * x - s * r0[i]); }
  return { f, r, u: up };
}
// one look at the flight: draw it when the picture moved (or force), fading over a jump
function fvFrame(force) {
  const now = Date.now(), st = fvState(now);
  if (!st) { fvStop(); return; }
  const cam = fvCam(st), t = performance.now(), sig = st.w.leg + st.w.mode + (st.w.mode === 'work' ? '' : st.a.around || st.a.look);
  if (FV.sig && sig !== FV.sig && !still()) { // a jump: fade out, draw the new view, fade in
    FV.sig = sig; FV.fade = t + 450; FV.cam = null; fvCanvas().style.opacity = '0'; return;
  }
  FV.sig = sig;
  if (t < FV.fade) return;
  const lk = st.a.around || st.a.look, q = st.b.list.find(x => x.key === lk), rpx = SP.F * BODIES[lk].radius * 1e3 / Math.hypot(...vsub(q.p, st.a.y));
  const moved = FV.cam ? SP.F * Math.max(vang(cam.f, FV.cam.f), vang(cam.u, FV.cam.u)) + Math.abs(rpx - FV.rpx) : Infinity;
  if (!force && moved < 0.4 && t - FV.drawn < (pending() ? 150 : 2000)) return;
  if (!force && t - FV.drawn < 50) return; // 20 frames a second at most
  FV.cam = cam; FV.rpx = rpx; FV.drawn = t;
  if (FV.V3) fvDraw3(st, cam); else fvDraw2(st, cam);
  if (DBG && ANIM) DBG.draws++;
  if (FV.fade) { FV.fade = 0; fvCanvas().style.opacity = ''; }
}
// The light through the glass: the sunlit surface in view brightens the room a little (#kShine, a plain translucent
// layer over the room's opaque part, no blend mode), tinted by the body that gives most of it (its js/bodies.js colour mixed into the screen cyan); a
// deep-space view gives none. The amount is geometric: each body's solid angle inside the glass's field of view
// (half-angle 50°, as the sky's projection), as a share of that field, times its lit fraction. Screen area plays no
// part, so neither the window size nor the camera's move between desk and glass changes it. A low-pass filter
// (FV_SHINE_TAU) follows it on its own 4 Hz tick; the opacity is written only when it visibly changes, never while the
// camera moves (the filter waits), and without a CSS transition: a compositor-side transition restarted every few
// frames switched the blended, masked layer between rendering paths, and the room flickered. Off in low-resource mode.
const FV_SHINE_TAU = 1.5, FV_FOV = 50 * deg, FV_FOV_SR = 2 * Math.PI * (1 - Math.cos(FV_FOV));
function fvShineTarget(st, cam) {
  let best = null, sum = 0;
  for (const q of st.b.list) {
    if (q.key === 'sun') continue;
    const d = vsub(q.p, st.a.y), dist = Math.hypot(...d), al = Math.asin(Math.min(1, BODIES[q.key].radius * 1e3 / dist));
    const th = Math.acos(Math.max(-1, Math.min(1, vdot(d, cam.f) / dist))), vis = Math.min(1, Math.max(0, (FV_FOV + al - th) / (2 * al || 1)));
    if (!vis) continue; // roughly the share of the disc inside the field
    const s = norm(vsub(st.b.sunP, q.p)), c = (1 - vdot(s, d) / dist) / 2 * Math.min(1, 2 * Math.PI * (1 - Math.cos(al)) * vis / FV_FOV_SR);
    sum += c; if (!best || c > best[1]) best = [q.key, c];
  }
  return [Math.min(0.32, 0.4 * sum), best && best[1] > 0.005 ? best[0] : ''];
}
function fvShineTick() {
  const now = performance.now(), dt = Math.min(10, (now - FV.shT) / 1000); FV.shT = now;
  if (ANIM || document.hidden) return; // held while the camera moves (and unseen)
  if (FV.on) { const st = fvState(Date.now()); if (st) [FV.shTarget, FV.shCol] = fvShineTarget(st, FV.cam || fvCam(st)); } else FV.shTarget = 0;
  FV.shV += (FV.shTarget - FV.shV) * (1 - Math.exp(-dt / FV_SHINE_TAU));
  if (!FV.on && FV.shV < 0.003) { FV.shV = 0; clearInterval(FV.shTimer); FV.shTimer = 0; }
  const e = $('#kShine'), o = Math.round(FV.shV * 200) / 200;
  if (o !== FV.shO) { FV.shO = o; e.style.opacity = o; }
  if (FV.shCol && FV.shCol !== FV.shColSet) { FV.shColSet = FV.shCol; e.style.setProperty('--fv-col', `color-mix(in srgb, var(--cab-screen) 35%, ${BODIES[FV.shCol].color})`); }
}
function fvShineRun() { if (!LOWQ && !FV.shTimer && (!DBG || DBG.shine)) { FV.shT = performance.now(); FV.shTimer = setInterval(fvShineTick, 250); } }
const fvCanvas = () => (FV.V3 ? FV.cv : SP.cv);
function fvDraw3(st, cam) {
  const V3 = FV.V3, { a, b } = st, y = a.y, list = b.list, keys = list.map(q => q.key).join(), T = a.tr.M.t0 * DAY + a.t;
  V3.setActive('sim');
  if (keys !== FV.keys) { V3.bodies('sim', list.map(q => ({ color: q.key === 'sun' ? '#fff3d6' : BODIES[q.key].color, sun: q.key === 'sun' }))); FV.keys = keys; }
  if (!FV.sky) { const sk = skyReady(true, false); if (sk) { V3.skySet(sk); FV.sky = true; } }
  V3.view(y.slice(0, 3).map((c, i) => c + cam.f[i] * FV_L), cam.r, cam.u, cam.f.map(c => -c), FV_L, SP.G[0], SP.G[1], FV.fov);
  const n = list.length, P = new Float64Array(3 * n), V = new Float64Array(3 * n), occ = [];
  list.forEach((q, i) => { P.set(q.p, 3 * i); V.set(q.v, 3 * i); });
  list.forEach((q, i) => {
    const R = BODIES[q.key].radius * 1e3, d = vsub(q.p, y), dist = Math.hypot(...d);
    const rpx = vdot(d, cam.f) > -R ? SP.F * R / Math.sqrt(Math.max(dist * dist - R * R, 1)) : 0;
    const look = q.key === 'sun' ? null : globeLook(q.key, rpx, !LOWQ, !LOWQ, TEX_CAP, FX, T);
    const o = look ? { look, rot: bodyAxes(q.key, T, P, V, i, list.findIndex(x => x.key === BODIES[q.key].parent), new Array(9)), mix: texMix(look.tex && look.tex.base) } : null;
    V3.body('sim', i, q.p, R, q.key === 'sun' ? null : norm(vsub(b.sunP, q.p)), true, o);
    if (q.key !== 'sun') occ.push([d, R, dist]);
  });
  V3.render({ stars: true, sky: null, skyGain: 0.6, glare: fvGlare(st, cam, occ) });
}
// the Sun's glare: on screen (or just off it) and not behind a body
function fvGlare(st, cam, occ) {
  const d = vsub(st.b.sunP, st.a.y), dist = Math.hypot(...d), z = vdot(d, cam.f); if (z <= 0) return null;
  const x = SP.G[0] + SP.F * vdot(d, cam.r) / z, y = SP.G[1] - SP.F * vdot(d, cam.u) / z, L = glareL(SP.F * BODIES.sun.radius * 1e3 / dist);
  const out = Math.max(0, -x, x - FV.cv.width / DPR, -y, y - FV.cv.height / DPR);
  if (out > 4 * L) return null;
  for (const [p, R, pd] of occ) if (pd < dist && Math.acos(Math.min(1, vdot(p, d) / (pd * dist))) < Math.asin(Math.min(1, R / pd))) return null;
  return { x, y, L, i: 1 - out / (4 * L) };
}
// the 2D path: the plain sky, shaded discs (far ones first)
function fvDraw2(st, cam) {
  const g = SP.cv.getContext('2d'), { a, b } = st, y = a.y, cw = SP.cv.width / DPR, ch = SP.cv.height / DPR, voidC = getComputedStyle(document.documentElement).getPropertyValue('--void');
  if (!FV.plain) FV.plain = plainSky();
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(FV.plain, 0, 0);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const vis = b.list.filter(q => q.key !== 'sun').map(q => { const d = vsub(q.p, y); return { q, d, dist: Math.hypot(...d) }; }).sort((p, q) => q.dist - p.dist);
  for (const { q, d, dist } of vis) {
    const z = vdot(d, cam.f); if (z <= 0) continue;
    const R = BODIES[q.key].radius * 1e3, x = SP.G[0] + SP.F * vdot(d, cam.r) / z, yy = SP.G[1] - SP.F * vdot(d, cam.u) / z, r = Math.max(0.8, SP.F * R / Math.sqrt(Math.max(dist * dist - R * R, 1)));
    if (x + r < 0 || x - r > cw || yy + r < 0 || yy - r > ch) continue;
    // lit from the Sun's side, as bright as the lit part we see (a body against the Sun is a dark disc)
    const s = norm(vsub(b.sunP, q.p)), sx = vdot(s, cam.r), sy = vdot(s, cam.u), lit = (1 - vdot(s, d) / dist) / 2;
    const gr = g.createRadialGradient(x + sx * r * 0.5, yy - sy * r * 0.5, r * 0.1, x, yy, r * 1.05);
    gr.addColorStop(0, BODIES[q.key].color); gr.addColorStop(1, voidC);
    g.fillStyle = voidC; g.beginPath(); g.arc(x, yy, r, 0, 6.2832); g.fill();
    g.globalAlpha = 0.12 + 0.88 * lit; g.fillStyle = gr; g.fill(); g.globalAlpha = 1;
  }
}
// the loops: animation frames for 3D (about 30 a second, each one cheap until something moved), a timer for 2D
function fvLoop(tp) {
  FV.raf = 0;
  if (!FV.on || !FV.V3 || document.hidden) return;
  FV.raf = requestAnimationFrame(fvLoop);
  if (tp - FV.last < 33) return; FV.last = tp;
  fvFrame(false);
}
function fvKick() {
  if (!FV.on || document.hidden) return;
  if (FV.V3) { fvFrame(true); if (!FV.raf) FV.raf = requestAnimationFrame(fvLoop); return; }
  clearTimeout(FV.timer);
  const st = fvState(Date.now()); fvFrame(true);
  if (FV.on) FV.timer = setTimeout(fvKick, FV.fade ? 470 : st && st.w.mode !== 'work' && !RM.matches ? 1000 : 5000);
}
function fvSize() {
  Object.assign(FV.cv.style, { left: SP.cv.style.left, top: SP.cv.style.top, width: SP.cv.style.width, height: SP.cv.style.height });
  const cw = SP.cv.width / DPR, ch = SP.cv.height / DPR;
  FV.fov = 2 * Math.atan(ch / 2 / SP.F) / deg; FV.plain = null; FV.cam = null;
  if (FV.V3) FV.V3.size(cw, ch, DPR);
}
function fvStart() {
  fvShineRun();
  FV.on = true; FV.sig = ''; FV.cam = null; clearTimeout(SP.timer); $('#kScene').hidden = true;
  if (!fvGL()) { fvKick(); return; }
  if (!FV.load) {
    FV.load = import(new URL('js/view3d.js', location.href).href).then(m => {
      const css = getComputedStyle(document.documentElement);
      FV.V3 = m.create(FV.cv, { fov: 45, void: css.getPropertyValue('--void').trim(), grid: css.getPropertyValue('--cyan').trim() }); fvSize();
    }).catch(() => { FV.fail = true; });
  }
  FV.load.then(() => {
    if (!FV.on) return;
    if (!FV.V3) { fvKick(); return; }
    FV.cv.hidden = false; SP.cv.style.visibility = 'hidden'; fvKick();
  });
}
function fvStop() {
  FV.on = false; cancelAnimationFrame(FV.raf); FV.raf = 0; clearTimeout(FV.timer);
  FV.cv.hidden = true; FV.cv.style.opacity = ''; SP.cv.style.visibility = ''; SP.cv.style.opacity = ''; FV.fade = 0;
  $('#kScene').hidden = false; spaceSoon();
  fvShineRun(); // the room light fades out with the filter
}
// on or off with the timer (every tick); a change of the 3D conditions restarts it
// (after the room is in: its images come before the planets')
function fvSync() { if (!LY || !document.body.classList.contains('k-ready')) return; const want = !!fvState(Date.now()); if (want && !FV.on) fvStart(); else if (!want && FV.on) fvStop(); }

// ---------- the move canvases ----------
// While the camera moves between desk and glass, the room, the light through the glass, the lamp's glow, the fish and
// the steam are drawn on #kMoveA (under the paper), the lamp-off shade and the cat on #kMoveB (over it), each the size
// of the screen, with drawImage from a decoded art set (the sharpest up to MV_CAP) in the camera's crop; those DOM
// layers are hidden meanwhile (.k-moving). The paper (posters, card) and what glows by itself (clock, laptop) stay in the
// DOM stage, small, and need no GPU layer of their own. At rest the DOM stage is back, at the shown (sharp) tier. The
// same pictures in both: the light and the shade are plain translucent layers masked by the room's alpha (CSS mask at
// rest, source-atop / destination-in here), the glow is the same gradient, the cat takes the same computed filter and
// the current angles of its tail and ears.
const PROBE = el('i', { hidden: '' }, document.body);
// a CSS colour (tokens, color-mix) as sRGB 0–255
function rgbOf(v) {
  PROBE.style.color = ''; PROBE.style.color = v;
  const s = getComputedStyle(PROBE).color, n = (s.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || ['0', '0', '0']).map(Number);
  return s.startsWith('color(') ? n.slice(0, 3).map(x => x * 255) : n.slice(0, 3);
}
const rgba = (c, a) => `rgba(${c.map(x => Math.round(x)).join(',')},${a})`;
// fill the rectangle (x, y, w, h) with an elliptical radial gradient: centre (cx, cy), radii (rx, ry), stops [offset, rgb, alpha]
function ellFill(g, cx, cy, rx, ry, stops, x, y, w, h) {
  g.save(); g.translate(cx, cy); g.scale(rx, ry);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); for (const [o, col, a] of stops) gr.addColorStop(o, rgba(col, a));
  g.fillStyle = gr; g.fillRect((x - cx) / rx, (y - cy) / ry, w / rx, h / ry); g.restore();
}
// The lamp-off shade (#kNight), drawn once at a quarter of the art's size (smooth gradients only): the approved
// multiply tones of Phase 9 (three layers) turned into one translucent overlay that darkens alike without a blend mode.
// Per pixel, for the multiply tone M: alpha a = 1 − mean(M) (the multiply's average darkening) and a dark tint
// P = 0.45 · (M − (1 − a)) (premultiplied; the least-squares line through x · M over mid tones keeps its cool cast).
function buildNight() {
  const [W, H] = LY.size, w = Math.round(W / 4), h = Math.round(H / 4), tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
  const g = tmp.getContext('2d', { willReadFrequently: true }), mix = (p, a, b) => a.map((x, i) => p * x + (1 - p) * b[i]);
  const scr = rgbOf('var(--cab-screen)'), c0 = mix(0.3, scr, rgbOf('var(--cab-wall-lo)')), c1 = mix(0.08, scr, rgbOf('var(--cab-shadow)')), c2 = mix(0.46, scr, rgbOf('var(--cab-wall)'));
  g.scale(w / W, h / H);
  g.fillStyle = rgba(c0, 1); g.fillRect(0, 0, W, H);
  ellFill(g, 3600, 2250, 2600, 900, [[0.2, c2, 1], [0.8, c2, 0]], 0, 0, W, H);
  ellFill(g, 1560, 2300, 1500, 1300, [[0, c1, 1], [1, c1, 0]], 0, 0, W, H);
  const im = g.getImageData(0, 0, w, h), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const m0 = d[i] / 255, m1 = d[i + 1] / 255, m2 = d[i + 2] / 255, a = 1 - (m0 + m1 + m2) / 3, k = a > 0 ? 255 / a : 0;
    d[i] = Math.round(k * Math.min(a, Math.max(0, 0.45 * (m0 - 1 + a))));
    d[i + 1] = Math.round(k * Math.min(a, Math.max(0, 0.45 * (m1 - 1 + a))));
    d[i + 2] = Math.round(k * Math.min(a, Math.max(0, 0.45 * (m2 - 1 + a))));
    d[i + 3] = Math.round(255 * a);
  }
  g.putImageData(im, 0, 0);
  const cv = $('#kNight'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(tmp, 0, 0);
}
const MV = { on: false, drawn: 0, set: null, A: $('#kMoveA'), B: $('#kMoveB'), whisk: null, lamp: null, cream: null, shine: null };
const GLOW = $('#kGlow'), NIGHT = $('#kNight'), CAT = $('#kCat');
const CAT_ID = /^(none|grayscale\(0\) brightness\(1\) sepia\(0\) hue-rotate\(0deg\) saturate\(1\))$/;
// the decoded art set for the canvases: the sharpest up to MV_CAP, else the smallest there is
function mvSet() {
  const ks = Object.keys(DEC).map(Number).sort((a, b) => a - b); if (!ks.length) return null;
  const T = ks.filter(t => t <= MV_CAP).pop() || ks[0]; return { T, img: DEC[T] };
}
function mvBegin() {
  if (DBG && DBG.dom) return false;
  if (MV.on) return true;
  const set = mvSet(); if (!set || !IMG.room) return false;
  if (!MV.whisk) { MV.whisk = [...$('#kWhisk').querySelectorAll('path')].map(p => new Path2D(p.getAttribute('d'))); MV.lamp = rgbOf('var(--cab-lamp)'); MV.cream = rgbOf('var(--cab-cream)'); }
  MV.shine = rgbOf(getComputedStyle($('#kShine')).getPropertyValue('--fv-col').trim() || 'var(--cab-screen)');
  MV.set = set; MV.on = true;
  for (const cv of [MV.A, MV.B]) { cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR); Object.assign(cv.style, { width: VW + 'px', height: VH + 'px' }); cv.hidden = false; }
  drawMove(CAM); $('#kRoot').classList.add('k-moving'); // drawn first, then the DOM layers go, in the same frame
  dbgHand('in', MV.drawn > 0);
  return true;
}
// back to the DOM layers: called only once they are complete at the new scale (sizeLife, lifeNow); they come back
// and the canvases go in the same task, so no frame shows both or neither
function mvEnd() {
  if (!MV.on) return; MV.on = false; MV.set = null; MV.drawn = 0;
  dbgHand('out', performance.now() - LIFE_T < 8);
  $('#kRoot').classList.remove('k-moving');
  for (const cv of [MV.A, MV.B]) { cv.hidden = true; cv.width = cv.height = 1; } // their memory goes too
}
function drawMove(c) {
  const t0 = performance.now(), A = MV.A.getContext('2d'), B = MV.B.getContext('2d'), k = c.s * DPR, [W, H] = LY.size, im = MV.set.img;
  for (const g of [A, B]) {
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    g.clearRect(0, 0, MV.A.width, MV.A.height); g.setTransform(k, 0, 0, k, -c.x * k, -c.y * k); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
  }
  // under the paper: the room, the light through the glass on its opaque part, the lamp's glow behind it (on the
  // glass), the fish and the steam
  A.drawImage(im.room, 0, 0, W, H);
  if (FV.shO > 0 && !LOWQ) { A.globalCompositeOperation = 'source-atop'; A.globalAlpha = FV.shO; ellFill(A, 3600, 1950, 3400, 2000, [[0, MV.shine, 1], [0.72, MV.shine, 0]], 0, 0, W, H); }
  const gl = +getComputedStyle(GLOW).opacity;
  if (gl > 0) {
    const g = LY.glass, x = g.x0, y = g.y0 + (g.y1 - g.y0) * 0.35, w = (g.x1 - g.x0) * 0.42, h = (g.y1 - g.y0) * 0.65;
    A.globalCompositeOperation = 'destination-over'; A.globalAlpha = gl;
    ellFill(A, x, y + 0.92 * h, 0.85 * w, 0.75 * h, [[0, MV.lamp, 0.3], [0.45, MV.lamp, 0.09], [0.78, MV.lamp, 0]], x, y, w, h);
  }
  A.globalCompositeOperation = 'source-over'; A.globalAlpha = 1;
  for (const cv of [AQ.cv, ST.cv]) A.drawImage(cv, parseFloat(cv.style.left), parseFloat(cv.style.top), parseFloat(cv.style.width), parseFloat(cv.style.height));
  // over the paper: the lamp-off shade on the room's opaque part, then the cat (its filter, its tail's and ears' angles)
  const nt = +getComputedStyle(NIGHT).opacity;
  if (nt > 0) {
    B.globalAlpha = nt; B.drawImage(NIGHT, 0, 0, W, H); B.globalAlpha = 1;
    B.globalCompositeOperation = 'destination-in'; B.drawImage(im.room, 0, 0, W, H); B.globalCompositeOperation = 'source-over';
  }
  const f = getComputedStyle(CAT).filter; if (!CAT_ID.test(f)) B.filter = f;
  for (const n of ['shadow', 'tail', 'earL', 'earR', 'body']) {
    const L = LY.layers[n], tf = L.pivot && IMG[n] ? getComputedStyle(IMG[n]).transform : 'none';
    if (tf === 'none') { B.drawImage(im[n], L.x, L.y, L.w, L.h); continue; }
    const m = new DOMMatrix(tf), [ox, oy] = L.pivot;
    B.save(); B.translate(ox, oy); B.transform(m.a, m.b, m.c, m.d, m.e, m.f); B.translate(-ox, -oy); B.drawImage(im[n], L.x, L.y, L.w, L.h); B.restore();
  }
  B.strokeStyle = rgba(MV.cream, 1); B.lineWidth = 2.4; B.lineCap = 'round'; B.globalAlpha = 0.72;
  for (const p of MV.whisk) B.stroke(p);
  B.globalAlpha = 1; B.filter = 'none';
  MV.drawn++;
  if (DBG) { DBG.cost.push(performance.now() - t0); DBG.mvT = MV.set.T; }
}

// ---------- camera ----------
// A camera is the stage's scale s and the art point (x, y) at the screen's top left. The desk view crops the art to
// the screen (cabCrop); "go to the glass" flies to the window view (cabGlassCam): the screen point of the glass's
// centre slides linearly, the scale changes geometrically. The sky canvas follows the glass's centre without growing.
const glassC = () => [(LY.glass.x0 + LY.glass.x1) / 2, (LY.glass.y0 + LY.glass.y1) / 2];
const gScreen = c => { const g = glassC(); return [(g[0] - c.x) * c.s, (g[1] - c.y) * c.s]; };
function apply(c) {
  CAM = c;
  const tf = `translate(${-c.x * c.s}px,${-c.y * c.s}px) scale(${c.s})`; for (const s of STAGES) s.style.transform = tf;
  const p = gScreen(c);
  SP.cv.style.transform = FV.cv.style.transform = `translate(${p[0] - SP.P0[0]}px,${p[1] - SP.P0[1]}px)`;
}
const deskCam = () => cabCrop(VW, VH, ...LY.size), winCam = () => cabGlassCam(VW, VH, LY.glass);
function go(to) {
  if (to === view) return;
  view = to; hideTip();
  $('#kGo').textContent = _(to === 'desk' ? 'kab.toWindow' : 'kab.toDesk');
  for (const b of document.querySelectorAll('.k-hit:not(#hGlass)')) b.inert = to !== 'desk';
  const from = CAM, dest = to === 'desk' ? deskCam() : winCam();
  wantTier(needTier(dest.s));
  cancelAnimationFrame(ANIM); ANIM = 0;
  // after the move: a tier that arrived meanwhile, and the DOM stage back in place of the canvases (rastered sharp at
  // the new scale, in the same frame)
  const done = () => {
    ANIM = 0; tierSwapNow(); sizeLife(); lifeNow(); mvEnd(); FV.cam = null; fvKick(); dbgMove(false);
    requestAnimationFrame(() => { if (!ANIM) stageWC(''); });
  };
  if (still()) { apply(dest); done(); return; }
  // The room, its light and shade and the cat move on the canvases (mvBegin); the rest of the DOM stage is scaled
  // without will-change. Scaling the whole DOM stage (7136 art px, one GPU layer under will-change, blended light and
  // shade on it) ran out of GPU tiles and memory: parts of the room vanished for a moment. ?debug=1&move=dom brings the
  // DOM path back for comparison (with wc=1 its will-change, promoted warm frames before the move).
  const cv = mvBegin(), wc = !cv && DBG && DBG.wc;
  if (wc) stageWC('transform');
  let warm = wc ? DBG.warm : 0, t0 = 0;
  const T = 1200, A0 = gScreen(from), A1 = gScreen(dest), g = glassC();
  dbgMove(true, cv);
  const step = now => {
    if (DBG) DBG.frames.push(now);
    if (warm-- > 0) { ANIM = requestAnimationFrame(step); return; }
    if (!t0) t0 = now;
    const t = Math.min(1, (now - t0) / T), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const s = from.s * Math.pow(dest.s / from.s, e), A = [A0[0] + (A1[0] - A0[0]) * e, A0[1] + (A1[1] - A0[1]) * e];
    apply({ s, x: g[0] - A[0] / s, y: g[1] - A[1] / s }); if (MV.on) drawMove(CAM);
    if (t < 1) ANIM = requestAnimationFrame(step); else { apply(dest); done(); }
  };
  ANIM = requestAnimationFrame(step);
}

// ---------- debugging overlay (?debug=1, temporary) ----------
const texBytes = () => { let b = 0; for (const e of TEXC.values()) if (e.ok && e.img) b += (e.img.naturalWidth || 0) * (e.img.naturalHeight || 0) * 4; return b; };
// a handoff between the DOM layers and the move canvases: was the side taking over complete (in: the canvas drawn;
// out: fish and steam redrawn at the new scale), and how long were the two frames after it
function dbgHand(k, ok) {
  if (!DBG) return;
  const h = DBG.hand[k] = { ok, f: [] }, t0 = performance.now();
  requestAnimationFrame(a => { h.f.push(a - t0); requestAnimationFrame(b => { h.f.push(b - a); }); });
}
function dbgMove(start, cv) { if (!DBG) return; if (start) { DBG.frames = []; DBG.draws = 0; DBG.cost = []; DBG.path = cv ? 'canvas' : 'dom'; } dbgShow(); }
function dbgShow() {
  if (!DBG || !LY || !CAM) return;
  if (!DBG.el) DBG.el = el('pre', { class: 'k-debug', 'aria-hidden': 'true' }, document.body);
  const c = DBG.cost, f = DBG.frames, dt = f.slice(1).map((t, i) => t - f[i]), n = dt.length, avg = n ? dt.reduce((a, b) => a + b, 0) / n : 0;
  const shown = IMG.room ? +(IMG.room.src.match(/cabin\/(\d+)\//) || [0, 0])[1] : 0;
  DBG.el.textContent = [
    `tier drawn ${shown} · wanted ${ART_T}${TIER_SWAP ? ' (swap waits)' : ''} · max ${TMAX} · decoded ${Object.keys(DEC).join('/') || '-'}`,
    `gpu max texture ${GPU.max || '?'} · 3d texture cap ${TEX_CAP} · dpr ${DPR}`,
    `stage ${Math.round(LY.size[0] * CAM.s * DPR)}×${Math.round(LY.size[1] * CAM.s * DPR)} px · will-change ${stage.style.willChange || '-'} · ${ANIM ? (MV.on ? 'moving, canvas' : 'moving, dom') : view}`,
    `move (${DBG.path}${DBG.path === 'canvas' ? ' tier ' + DBG.mvT : ''}): ${n} frames · avg ${avg.toFixed(1)} ms · max ${(n ? Math.max(...dt) : 0).toFixed(1)} ms · >34 ms ${dt.filter(d => d > 34).length}`,
    `handoff ${['in', 'out'].map(k => { const h = DBG.hand[k]; return h ? `${k} ${h.ok ? 'complete' : 'INCOMPLETE'}, next frames ${h.f.map(x => x.toFixed(1)).join('/') || '…'} ms` : k + ' -'; }).join(' · ')}`,
    `canvas draw: ${c.length ? `avg ${(c.reduce((a, b) => a + b, 0) / c.length).toFixed(1)} ms · max ${Math.max(...c).toFixed(1)} ms` : '-'}`,
    `glass ${FV.on ? (FV.V3 ? '3d' : '2d') : 'scene'} · glass frames in move ${DBG.draws} · room light ${FV.shO}`,
    `planet textures ${(texBytes() / 1048576).toFixed(0)} MB decoded`,
    `switches move=${DBG.dom ? 'dom' : 'canvas'} shine=${+DBG.shine} cap=${DBG.cap || '-'} wc=${+DBG.wc} warm=${DBG.warm}`,
  ].join('\n');
}
if (DBG) setInterval(dbgShow, 250);

// ---------- sound (js/cabin-audio.js) ----------
// The radio is on by default and starts on the first gesture anywhere (browser rule); until then the chip at the top
// left asks for a tap. The chip names the track, or says the radio cannot be reached; it and the headphones on the
// desk open the sound panel. A small light on the headphones shows that something is playing.
const AUD = { set: parseCabAudio(readPref(LS, PREF_KEYS.cabAudio)) };
const AUD_K = ['music', 'space', 'hum', 'noise', 'chime'];
const audWants = () => sndAny(AUD.set);
function audChip() {
  const s = SND.state, set = AUD.set, tap = !SND.started && audWants(), lost = SND.started && set.music.on && !set.muted && s.trouble >= RETRY_S.length;
  $('#kRadioT').textContent = tap ? _('kab.audio.tap') : lost ? _('kab.audio.lost') : set.muted ? _('kab.audio.muted')
    : set.music.on && s.track ? (s.track.lic === 'ccby' ? _('kab.audio.nowBy', { title: s.track.title, artist: MUSIC_ARTISTS[s.track.artist], lic: _('cred.cabin.ccby') }) // CC BY: the credit is shown while it plays
      : _('kab.audio.now', { title: s.track.title, artist: MUSIC_ARTISTS[s.track.artist] })) : _('kab.audio.radio');
  $('#kRadio').classList.toggle('tap', tap); $('#kRadio').classList.toggle('warn', lost);
  $('#kSkip').hidden = !(SND.started && set.music.on && !set.muted && s.track && !lost); // next track: only while the radio plays
  $('#kLed').classList.toggle('on', SND.started && !!s.active);
}
function audSync() { // panel controls from the settings
  for (const k of AUD_K) { const r = document.querySelector(`.k-arow[data-k=${k}]`); r.querySelector('[type=checkbox]').checked = AUD.set[k].on; r.querySelector('[type=range]').value = Math.round(AUD.set[k].vol * 100); }
  for (const b of document.querySelectorAll('#kNoise button')) b.setAttribute('aria-pressed', String(b.dataset.n === AUD.set.noise.type));
  $('#kMute').checked = AUD.set.muted;
}
function audSet(patch) {
  patch(AUD.set); writePref(LS, PREF_KEYS.cabAudio, JSON.stringify(AUD.set));
  if (!SND.started) { if (audWants()) sndStart(AUD.set); } else sndApply(AUD.set);
  audSync(); audChip();
}
function audPanel(open) {
  const p = $('#kAudio'); open = open ?? p.hidden; p.hidden = !open; hideTip();
  if (open) poPanel(false);
  $('#kRadio').setAttribute('aria-expanded', String(open));
}
function audGesture() {
  if (SND.started) return;
  removeEventListener('pointerdown', audGesture, true); removeEventListener('keydown', audGesture, true);
  if (audWants()) sndStart(AUD.set);
  audChip();
}
SND.onState = audChip;
addEventListener('pointerdown', audGesture, true); addEventListener('keydown', audGesture, true);
$('#kRadio').addEventListener('click', () => audPanel());
$('#kSkip').addEventListener('click', () => sndNext());
$('#kAudioX').addEventListener('click', () => audPanel(false));
for (const k of AUD_K) {
  const r = document.querySelector(`.k-arow[data-k=${k}]`);
  r.querySelector('[type=checkbox]').addEventListener('change', e => audSet(s => { s[k].on = e.target.checked; if (s[k].on) s.muted = false; }));
  r.querySelector('[type=range]').addEventListener('input', e => audSet(s => { s[k].vol = e.target.value / 100; }));
}
// the bell's level: let it ring once on release
document.querySelector('.k-arow[data-k=chime] [type=range]').addEventListener('change', () => sndChime(AUD.set, 'work'));
for (const b of document.querySelectorAll('#kNoise button')) b.addEventListener('click', () => audSet(s => { s.noise.type = b.dataset.n; s.noise.on = true; }));
$('#kMute').addEventListener('change', e => audSet(s => { s.muted = e.target.checked; }));
document.addEventListener('pointerdown', e => {
  const p = $('#kAudio'); if (!p.hidden && !p.contains(e.target) && !$('#kRadio').contains(e.target) && e.target.id !== 'hPhones') audPanel(false);
  const q = $('#kPomo'); if (!q.hidden && !q.contains(e.target) && e.target.id !== 'hClock') poPanel(false);
});

// ---------- the pomodoro (js/pomodoro.js) ----------
// The timer's state lives in localStorage, the one source for every open tab: each step reads it back before moving it
// on (a session that ends is counted once, by the tab that saw it) and the storage event keeps the other tabs current.
// A tick a second refreshes the clock and the panel; the time itself comes from wall-clock timestamps, so a hidden tab
// (its timers slowed to once a minute), a sleeping computer or a reload changes nothing. An end seen in time rings the
// bell, flashes the clock and, when allowed and the tab is hidden, sends a notification; one seen late is only told in
// the panel. Without storage the timer still runs, for this page only.
const PO = { s: null, raw: null, v: null, late: null, notify: false, stRaw: undefined, stDay: '' };
const PO_PH = { idle: 'kab.pomo.ph.idle', work: 'kab.pomo.ph.work', short: 'kab.pomo.ph.short', long: 'kab.pomo.ph.long', wait: 'kab.pomo.ph.wait' };
function poLoad() { const raw = readPref(LS, PREF_KEYS.pomo); if (raw == null ? !PO.s : raw !== PO.raw) { PO.raw = raw; PO.s = parsePomo(raw); } }
// run a timer step (pomoAdvance: just bring it up to now) and deal with what happened
function poDo(fn) {
  poLoad();
  const now = Date.now(), ev = fn(PO.s, now);
  if (ev.length || fn !== pomoAdvance) { PO.raw = JSON.stringify(PO.s); writePref(LS, PREF_KEYS.pomo, PO.raw); }
  if (ev.some(e => e.type === 'focus')) { const st = parsePomoStats(readPref(LS, PREF_KEYS.pomoStats)); if (pomoStatsAdd(st, ev)) writePref(LS, PREF_KEYS.pomoStats, JSON.stringify(st)); }
  if (fn !== pomoAdvance) PO.late = null;
  for (const e of ev) if (e.type === 'end' && !e.skipped) poEnded(e);
  poShow(now);
}
// a settings change: up to now first, then the change
function poSet(f) { poDo((s, now) => { const ev = pomoAdvance(s, now); f(s); return ev; }); poSyncSet(); }
function poEnded(e) {
  if (e.late >= POMO_LATE) { PO.late = e; return; }
  const brk = e.phase === 'work', g = CLOCK.g;
  sndChime(AUD.set, brk ? 'break' : 'work');
  if (g) { g.classList.remove('ring'); requestAnimationFrame(() => g.classList.add('ring')); setTimeout(() => g.classList.remove('ring'), 3400); }
  poNotify(_(brk ? 'kab.pomo.n.breakT' : 'kab.pomo.n.workT'), brk ? _('kab.pomo.n.breakB', { m: pomoDur(PO.s, e.next) / POMO_MIN }) : _('kab.pomo.n.workB', { m: PO.s.cfg.work }));
}
function poShow(now = Date.now()) {
  const s = PO.s, v = PO.v = pomoView(s, now);
  clockTick(); poStats(now); hudShow(now); fvSync();
  if ($('#kPomo').hidden) return;
  const ph = _(PO_PH[v.phase], { k: v.k, n: v.every });
  $('#kPomoPh').textContent = v.paused ? _('kab.pomo.paused', { ph }) : ph;
  $('#kPomoT').textContent = pomoClock(pomoTimed(v.phase) ? v.left : s.cfg.work * POMO_MIN);
  $('#kPomoGo').textContent = _(v.running ? 'kab.pomo.pause' : v.paused ? 'kab.pomo.resume' : 'kab.pomo.start');
  $('#kPomoSkip').disabled = !pomoTimed(v.phase); $('#kPomoReset').disabled = v.phase === 'idle';
  const L = PO.late; $('#kPomoLate').hidden = !L;
  if (L) $('#kPomoLate').textContent = _(L.phase === 'work' ? 'kab.pomo.late.work' : 'kab.pomo.late.break', { m: Math.max(1, Math.round((now - L.at) / 60000)) });
}
// The flight HUD: the plan's phase ("Ay'a yolculuk · %42", or the timer's phase without a plan) and the time left, the
// cycle's sessions and breaks as a thin bar. Faint, hidden while idle or the panel is open; H or the panel hides it.
function hudShow(now) {
  const h = $('#kFlight'), v = PO.v, s = PO.s, off = v.phase === 'idle' || !PO.hud || !$('#kPomo').hidden;
  h.hidden = off; if (off) return;
  const D = FLIGHT_DATA[s.plan], w = D && fpWhere(D, s, v, now), lb = w && fpLabel(s.plan, D, w);
  let txt = lb ? _(lb.key, { ...lb.p, b: lb.p.b ? _('body.' + lb.p.b) : '' }) : _(PO_PH[v.phase], { k: v.k, n: v.every });
  if (lb && lb.u != null) txt = _('fp.pct', { l: txt, p: Math.floor(lb.u * 100) });
  $('#kFlightL').textContent = txt;
  $('#kFlightT').textContent = v.phase === 'wait' ? _('kab.pomo.hud.wait') : v.paused ? _('kab.pomo.hud.paused', { t: pomoClock(v.left) }) : pomoClock(v.left);
  h.classList.toggle('brk', v.phase !== 'work');
  // the bar: a work and a break part per session of the cycle (the last break long), filled up to now
  const c = s.cfg, bar = $('#kFlightBar'), key = [c.work, c.short, c.long, c.every].join();
  if (bar.dataset.k !== key) {
    bar.dataset.k = key; bar.textContent = '';
    for (let k = 1; k <= c.every; k++) for (const [cls, len] of [['w', c.work], ['b', c.long > 0 && k === c.every ? c.long : c.short]]) { const i = el('i', { class: cls }, bar); i.style.flexGrow = len; el('b', {}, i); }
  }
  const cur = v.phase === 'work' ? 2 * (v.k - 1) : v.phase === 'wait' ? 2 * ((s.n - 1) % c.every) + 2 : 2 * (v.k - 1) + 1;
  [...bar.children].forEach((i, j) => { i.firstChild.style.width = (j < cur ? 100 : j === cur ? v.frac * 100 : 0) + '%'; });
}
// daily statistics (prefs.js PREF_KEYS.pomoStats): today and the last seven days, in the panel and on the laptop
const poDur = ms => { const m = Math.round(ms / 60000); return m >= 60 ? _('kab.pomo.hm', { h: Math.floor(m / 60), m: m % 60 }) : _('kab.pomo.min', { m }); };
function poStats(now) {
  const raw = readPref(LS, PREF_KEYS.pomoStats), day = pomoDay(now);
  if (raw === PO.stRaw && day === PO.stDay) return; PO.stRaw = raw; PO.stDay = day;
  const st = parsePomoStats(raw), from = pomoDay(now - 6 * 86400000), wk = [0, 0], td = st[day] || [0, 0];
  for (const [k, d] of Object.entries(st)) if (k >= from && k <= day) { wk[0] += d[0]; wk[1] += d[1]; }
  $('#kPomoDay').textContent = _('kab.pomo.today', { n: td[0], t: poDur(td[1]) });
  $('#kPomoWeek').textContent = _('kab.pomo.week', { n: wk[0], t: poDur(wk[1]) });
  if (LAP.today) LAP.today.textContent = td[1] ? _('kab.pomo.today', { n: td[0], t: poDur(td[1]) }) : '';
}
// the panel's settings from the state
function poSyncSet() {
  const s = PO.s;
  for (const b of document.querySelectorAll('#kPomoPre button')) b.setAttribute('aria-pressed', String(b.dataset.p === s.preset));
  $('#kPomoCus').hidden = s.preset !== 'custom';
  for (const i of document.querySelectorAll('#kPomoCus input')) if (document.activeElement !== i) i.value = s.cfg[i.dataset.c];
  $('#kPomoSum').textContent = s.cfg.long ? _('kab.pomo.sum', { m: s.cfg.long, n: s.cfg.every }) : _('kab.pomo.sumNone');
  $('#kPomoAuto').checked = s.auto; $('#kPomoNotify').checked = PO.notify; $('#kPomoHud').checked = PO.hud;
  $('#kPomoPlan').value = FLIGHT_DATA[s.plan] ? s.plan : ''; $('#kPomoReplan').hidden = !(FLIGHT_DATA[s.plan] && s.flight > 0);
}
function poPanel(open) {
  const p = $('#kPomo'); open = open ?? p.hidden; p.hidden = !open; hideTip();
  if (open) { audPanel(false); poSyncSet(); }
  poShow(); // the HUD hides behind the panel
}
function poNotify(title, body) {
  if (!PO.notify || !document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, tag: 'kabin-pomo', silent: true }); } catch (err) { /* this browser wants a service worker for it */ }
}
PO.notify = readPref(LS, PREF_KEYS.pomoNotify) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
PO.hud = readPref(LS, PREF_KEYS.pomoHud) !== '0';
poLoad();
// flight plans: none or one of js/flightplans.js; a new plan (or "start over") flies from its first leg
for (const id of ['', ...FP_IDS]) el('option', { value: id }, $('#kPomoPlan')).textContent = _(id ? 'fp.name.' + id : 'fp.name.none');
$('#kPomoPlan').addEventListener('change', e => poSet(s => { s.plan = e.target.value; s.flight = 0; }));
$('#kPomoReplan').addEventListener('click', () => poSet(s => { s.flight = 0; }));
const hudSet = on => { PO.hud = on; writePref(LS, PREF_KEYS.pomoHud, on ? '1' : '0'); $('#kPomoHud').checked = on; poShow(); };
$('#kPomoHud').addEventListener('change', e => hudSet(e.target.checked));
addEventListener('keydown', e => { if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) hudSet(!PO.hud); });
$('#kPomoX').addEventListener('click', () => poPanel(false));
$('#kPomoGo').addEventListener('click', () => poDo(PO.v && PO.v.running ? pomoPause : pomoStart));
$('#kPomoSkip').addEventListener('click', () => poDo(pomoSkip));
$('#kPomoReset').addEventListener('click', () => poDo(pomoReset));
for (const b of document.querySelectorAll('#kPomoPre button')) b.addEventListener('click', () => poSet(s => { s.preset = b.dataset.p; if (POMO_PRESETS[s.preset]) s.cfg = { ...POMO_PRESETS[s.preset] }; }));
for (const i of document.querySelectorAll('#kPomoCus input')) i.addEventListener('change', () => poSet(s => { s.cfg = pomoCfg({ ...s.cfg, [i.dataset.c]: +i.value }); i.value = s.cfg[i.dataset.c]; }));
$('#kPomoAuto').addEventListener('change', e => poSet(s => { s.auto = e.target.checked; }));
// notifications: permission is asked only here, on the viewer's own click
$('#kPomoNotify').addEventListener('change', e => {
  const note = $('#kPomoNote'), put = on => { PO.notify = on; e.target.checked = on; writePref(LS, PREF_KEYS.pomoNotify, on ? '1' : '0'); };
  note.hidden = true;
  if (!e.target.checked) { put(false); return; }
  if (typeof Notification === 'undefined') { note.textContent = _('kab.pomo.notifyNone'); note.hidden = false; put(false); return; }
  Promise.resolve(Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission).then(p => {
    if (p !== 'granted') { note.textContent = _('kab.pomo.notifyDenied'); note.hidden = false; }
    put(p === 'granted');
  });
});
addEventListener('storage', e => { if (e.key === PREF_KEYS.pomo) { poLoad(); poShow(); if (!$('#kPomo').hidden) poSyncSet(); } });

// ---------- the lamp ----------
function setLamp(on, save = true) {
  $('#kRoot').classList.toggle('lamp-off', !on);
  $('#kLamp').setAttribute('aria-pressed', String(!on));
  $('#kLamp').textContent = _(on ? 'kab.lampOff' : 'kab.lampOn');
  if (save) writePref(LS, PREF_KEYS.cabLamp, on ? '1' : '0');
}

// ---------- layout ----------
function layout() {
  VW = innerWidth; VH = innerHeight; DPR = Math.min(devicePixelRatio || 1, 2);
  if (!VW || !VH) return; // a hidden frame: wait for its resize
  const d = deskCam(), w = winCam(), cam = view === 'desk' ? d : w;
  // the sky canvas covers the screen for every camera between the two views
  const pd = gScreen(d), pw = gScreen(w);
  SP.M = Math.ceil(Math.max(Math.abs(pd[0] - VW / 2), Math.abs(pw[0] - VW / 2), Math.abs(pd[1] - VH / 2), Math.abs(pw[1] - VH / 2))) + 40;
  const cw = VW + 2 * SP.M, ch = VH + 2 * SP.M;
  SP.cv.width = Math.round(cw * DPR); SP.cv.height = Math.round(ch * DPR);
  Object.assign(SP.cv.style, { left: -SP.M + 'px', top: -SP.M + 'px', width: cw + 'px', height: ch + 'px' });
  SP.P0 = pd; SP.G = [pd[0] + SP.M, pd[1] + SP.M]; // the glass's centre on screen and in canvas px at the desk view
  SP.F = Math.max(VW, VH) / 2 / Math.tan(50 * deg); SP.sky = null; fvSize();
  cancelAnimationFrame(ANIM); ANIM = 0; mvEnd(); stageWC(''); tierSwapNow();
  apply(cam); wantTier(needTier(cam.s)); sizeLife(); lifeNow();
  spaceSoon(); fvKick();
}

// ---------- interaction ----------
const tip = $('#kTip');
function showTip(b) {
  if (b.inert || ANIM) return;
  tip.textContent = _(b.dataset.tip); tip.hidden = false;
  const r = b.getBoundingClientRect(), w = tip.offsetWidth;
  tip.style.left = Math.min(VW - w / 2 - 8, Math.max(w / 2 + 8, r.left + r.width / 2)) + 'px';
  tip.style.top = Math.max(tip.offsetHeight + 8, r.top + Math.min(r.height * 0.25, 60)) + 'px';
}
function hideTip() { tip.hidden = true; }
// hit areas over the painted objects (art px: x, y, w, h)
const HITS = { hGlass: [1797, 246, 3623, 1846, 'kab.glass'], hLamp: [1290, 1560, 480, 500, 'kab.lamp'], hClock: [4975, 2540, 700, 330, 'kab.clock'],
  hLap: [6300, 1910, 836, 1200, 'kab.tablet'], hBook: [2620, 2870, 1720, 520, 'kab.notebook'], hPhones: [140, 2680, 940, 420, 'kab.phones'],
  hTea: [2120, 2730, 480, 420, 'kab.tea'], hCat: [4120, 1500, 520, 1100, 'kab.cat'] };
function buildHits() {
  const layer = $('#kHits');
  for (const [id, [x, y, w, h, key]] of Object.entries(HITS)) {
    const b = el(id === 'hLap' ? 'a' : 'button', { class: 'k-hit', id, 'data-tip': key, 'aria-label': _(key) }, layer);
    if (id === 'hLap') b.href = 'index.html'; else b.type = 'button';
    box(b, x, y, w, h);
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showTip(b); });
    b.addEventListener('pointerleave', hideTip); b.addEventListener('focus', () => showTip(b)); b.addEventListener('blur', hideTip);
  }
  $('#hGlass').addEventListener('click', () => go(view === 'desk' ? 'window' : 'desk'));
  $('#hLamp').addEventListener('click', () => setLamp($('#kRoot').classList.contains('lamp-off')));
  $('#hCat').addEventListener('click', () => { const c = $('#kCat'); c.classList.remove('k-flick'); void c.offsetWidth; c.classList.add('k-flick'); setTimeout(() => c.classList.remove('k-flick'), 950); });
  for (const id of ['hBook', 'hTea']) $('#' + id).addEventListener('click', e => showTip(e.currentTarget));
  $('#hClock').addEventListener('click', () => poPanel());
  $('#hPhones').addEventListener('click', () => audPanel());
}

// ---------- start ----------
fetch('img/cabin/layout.json').then(r => r.json()).then(ly => {
  LY = ly;
  for (const s of STAGES) box(s, 0, 0, LY.size[0], LY.size[1]);
  for (const id of ['#kArt', '#kWhisk']) { const s = $(id); s.setAttribute('viewBox', `0 0 ${LY.size[0]} ${LY.size[1]}`); box(s, 0, 0, LY.size[0], LY.size[1]); }
  { const c = LY.clock, s = $('#kGlowArt'); s.setAttribute('viewBox', `${c.x0} ${c.y0} ${c.x1 - c.x0} ${c.y1 - c.y0}`); box(s, c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0); }
  box($('#kNight'), 0, 0, LY.size[0], LY.size[1]); box($('#kShine'), 0, 0, LY.size[0], LY.size[1]); buildNight();
  const g = LY.glass; box($('#kGlow'), g.x0, g.y0 + (g.y1 - g.y0) * 0.35, (g.x1 - g.x0) * 0.42, (g.y1 - g.y0) * 0.65);
  buildArt(); buildHits(); initLife();
  box($('#kLed'), PHONES_LED[0] - PHONES_LED[2], PHONES_LED[1] - PHONES_LED[2], 2 * PHONES_LED[2], 2 * PHONES_LED[2]);
  audSync(); audChip();
  // the simulator's view comes along (?manzara=saturn|earth) and becomes the saved choice
  const from = new URLSearchParams(location.search).get('manzara');
  if (SCENES[from]) writePref(LS, PREF_KEYS.cabScene, from);
  const sc = readPref(LS, PREF_KEYS.cabScene); if (SCENES[sc]) SP.scene = sc;
  for (const b of document.querySelectorAll('#kScene button')) b.setAttribute('aria-pressed', String(b.dataset.scene === SP.scene));
  setLamp(readPref(LS, PREF_KEYS.cabLamp) !== '0', false);
  layout();
  poDo(pomoAdvance); setInterval(() => poDo(pomoAdvance), 1000);
  lapTick(); setInterval(() => { if (!document.hidden) lapTick(); }, 2000);
  loopStart();
});
$('#kGo').addEventListener('click', () => go(view === 'desk' ? 'window' : 'desk'));
// back to the simulator: through history when we came from it (the browser may hand the page back exactly as it was),
// else a plain link (the simulator then restores the state it left in sessionStorage)
$('#kBack').addEventListener('click', e => {
  let ref = null; try { ref = new URL(document.referrer); } catch (err) { /* none */ }
  if (ref && ref.origin === location.origin && /\/(index\.html)?$/.test(ref.pathname) && history.length > 1) { e.preventDefault(); history.back(); }
});
$('#kLamp').addEventListener('click', () => setLamp($('#kRoot').classList.contains('lamp-off')));
addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!$('#kAudio').hidden) audPanel(false); else if (!$('#kPomo').hidden) poPanel(false); else go('desk'); });
for (const b of document.querySelectorAll('#kScene button')) b.addEventListener('click', () => {
  SP.scene = b.dataset.scene; writePref(LS, PREF_KEYS.cabScene, SP.scene);
  for (const x of document.querySelectorAll('#kScene button')) x.setAttribute('aria-pressed', String(x === b));
  spaceSoon();
});
let rsz = 0;
addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { if (LY) layout(); }, 150); });
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('paused', document.hidden);
  if (!document.hidden && LY) { loopStart(); lapTick(); poDo(pomoAdvance); spaceSoon(); FV.cam = null; fvKick(); }
});
RM.addEventListener?.('change', () => { if (LY) { if (still()) drawStill(); else loopStart(); if (FV.on) { fvStop(); fvSync(); } } });
