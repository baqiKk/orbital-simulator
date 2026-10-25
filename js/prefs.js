// Persisted UI preferences: view mode and window layout.
// DOM-free: the storage object is passed in (localStorage, sessionStorage, a stub or null), so Node tests can run it.
// Every storage access is wrapped: private windows, blocked site data and quota errors must never break the page.
const PREF_KEYS = { mode: 'orbsim.mode', wins: 'orbsim.wins.v1', perfTip: 'orbsim.perfTip', venusRadar: 'orbsim.venusRadar', clouds: 'orbsim.clouds', sky: 'orbsim.sky', osc: 'orbsim.osc', slow: 'orbsim.slow', vehicles: 'orbsim.vehicles.v1', cabLamp: 'orbsim.cab.lamp', cabScene: 'orbsim.cab.scene', cabAudio: 'orbsim.cab.audio.v1' };
const VIEW_MODES = ['low', 'normal', '3d'];
// placement order: overview's default spot sits under Results, so it comes after it
const WIN_IDS = ['mission', 'bodies', 'results', 'overview', 'transfer', 'gloss', 'model', 'credits'];
const WIN_DEFAULT_OPEN = { mission: true, results: true };

function readPref(store, key) { try { return store ? store.getItem(key) : null; } catch (e) { return null; } }
function writePref(store, key, v) { try { if (!store) return false; store.setItem(key, v); return true; } catch (e) { return false; } }
function clearPref(store, key) { try { if (store) store.removeItem(key); } catch (e) { /* ignore */ } }

// Saved vehicles (orbit maneuvers): a JSON list of { name, F, isp, m0, md, tMax, nMax, wait }. Entries that are not
// usable are dropped (thrust, Isp and masses positive, dry below wet, limits ≥ 0, a name of 1–40 characters), 50 at most;
// anything unreadable gives the empty list (the ready-made vehicles remain).
function parseVehicles(raw) {
  let d;
  try { d = JSON.parse(raw); } catch (e) { return []; }
  if (!Array.isArray(d)) return [];
  const num = (v, min) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : NaN);
  const out = [];
  for (const q of d) {
    if (!q || typeof q !== 'object' || typeof q.name !== 'string') continue;
    const name = q.name.trim().slice(0, 40), F = num(q.F, 0), isp = num(q.isp, 0), m0 = num(q.m0, 0), md = num(q.md, 0);
    if (!name || !(F > 0 && isp > 0 && m0 > 0 && md > 0 && md < m0)) continue;
    const lim = v => (num(v, 0) >= 0 ? v : 0);
    out.push({ name, F, isp, m0, md, tMax: lim(q.tMax), nMax: Number.isInteger(q.nMax) && q.nMax >= 0 ? q.nMax : 0, wait: lim(q.wait) });
    if (out.length >= 50) break;
  }
  return out;
}

// the viewer's sky brightness (the slider, 0–2× the default): a saved number in range, else 1
function skyGainOf(v) { const x = v == null || v === '' ? NaN : +v; return Number.isFinite(x) ? Math.min(2, Math.max(0, x)) : 1; }

// Saved mode wins; with nothing valid saved, start in normal mode and ask once.
function startupMode(store) {
  const m = readPref(store, PREF_KEYS.mode);
  return VIEW_MODES.includes(m) ? { mode: m, ask: false } : { mode: 'normal', ask: true };
}

// narrow: a narrow desktop (floating windows, little room) — Results starts collapsed so the plot stays clear.
// wide: a wide desktop (≥ 1440 px) — the overview (body picker) starts open too, collapsed to its title bar
// unless full (≥ 1920 px), so it does not cover the plot.
function defaultWins(opts = {}) {
  const o = {};
  for (const id of WIN_IDS) o[id] = { open: !!WIN_DEFAULT_OPEN[id] || (!!opts.wide && id === 'overview'), collapsed: (!!opts.narrow && id === 'results') || (!!opts.wide && !opts.full && id === 'overview'), x: null, y: null };
  return o;
}
// Tolerates missing, corrupt or partial data; x/y null means "use the default position".
// Saved entries always win over the defaults. A saved layout (even one from before a window existed)
// is left as it is: the wide-screen overview default only applies on a first visit.
function parseWins(raw, opts) {
  const out = defaultWins(opts);
  if (!raw) return out;
  let d;
  try { d = JSON.parse(raw); } catch (e) { return out; }
  if (!d || typeof d !== 'object') return out;
  out.overview.open = false;
  for (const id of WIN_IDS) {
    const w = d[id];
    if (!w || typeof w !== 'object') continue;
    out[id].open = !!w.open;
    out[id].collapsed = !!w.collapsed;
    out[id].x = Number.isFinite(w.x) ? w.x : null;
    out[id].y = Number.isFinite(w.y) ? w.y : null;
  }
  return out;
}

// Pull a w×h window at (x, y) fully inside a cw×ch container (top-left wins if it cannot fit).
function clampWin(x, y, w, h, cw, ch) {
  const cl = (v, hi) => Math.max(0, Math.floor(Math.min(hi, v)));
  return [cl(x, cw - w), cl(y, ch - h)];
}

// Maximal empty rectangles of a w×h area around obstacle boxes {x0, x1, y0, y1} (each grown by gap).
// For every pair of candidate left/right edges the free vertical runs are maximal; dominated ones are dropped.
function freeRects(w, h, boxes, gap = 0) {
  const ob = boxes.map(o => ({ x0: o.x0 - gap, x1: o.x1 + gap, y0: o.y0 - gap, y1: o.y1 + gap }))
    .filter(o => o.x1 > 0 && o.x0 < w && o.y1 > 0 && o.y0 < h && o.x1 > o.x0 && o.y1 > o.y0);
  const xs = [...new Set([0, w, ...ob.flatMap(o => [o.x0, o.x1]).filter(x => x > 0 && x < w)])].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    const a = xs[i], b = xs[j];
    const ys = ob.filter(o => o.x0 < b && o.x1 > a).map(o => [Math.max(0, o.y0), Math.min(h, o.y1)]).sort((p, q) => p[0] - q[0]);
    let y = 0;
    for (const [y0, y1] of [...ys, [h, h]]) { if (y0 > y) out.push({ x0: a, x1: b, y0: y, y1: y0 }); y = Math.max(y, y1); }
  }
  const inside = (p, q) => p !== q && p.x0 >= q.x0 && p.x1 <= q.x1 && p.y0 >= q.y0 && p.y1 <= q.y1;
  return out.filter(p => !out.some(q => inside(p, q) && (p.x0 !== q.x0 || p.x1 !== q.x1 || p.y0 !== q.y0 || p.y1 !== q.y1)));
}
// The largest of the rectangles by area (null for none).
function bestRect(rects) {
  const area = q => (q.x1 - q.x0) * (q.y1 - q.y0);
  let best = null;
  for (const q of rects) if (!best || area(q) > area(best)) best = q;
  return best;
}

// Opacity of the orbit trail by age in revolutions: the last keep revolutions are drawn; with fade the
// oldest fade revolutions of them thin out towards zero, without it older ones are simply cut.
const TRAIL_REVS = 10, TRAIL_FADE = 3;
function trailAlpha(age, fade, keep = TRAIL_REVS, span = TRAIL_FADE) {
  if (!(age <= keep)) return 0;
  return fade && age > keep - span ? (keep - age) / span : 1;
}

// ---- cabin (kabin.html) ----
// The art's width tiers (img/cabin/<px>/). The largest one this device may load: 7136 only on a desktop with at least
// 8 GB (navigator.deviceMemory; unknown counts as enough on a desktop), phones at most 2560, anything else 3840.
const CAB_TIERS = [1600, 2560, 3840, 7136];
function cabTierMax(dev) { return dev.phone ? 2560 : dev.desktop && (dev.mem == null || dev.mem >= 8) ? 7136 : 3840; }
// smallest tier with about one texel per device pixel (need: device px across the whole art), within the limit
function cabTier(need, max) { const ok = CAB_TIERS.filter(t => t <= max); return ok.find(t => t >= need * 0.9) || ok[ok.length - 1]; }
// Desk view: the art covers the screen (no bars). Sideways it centres the window on wide screens and slides towards
// the cat as the screen narrows (portrait shows the cat and the right part of the glass); vertically 15 % of the cut
// comes off the top, the rest off the desk's front. Returns the scale and the art point at the screen's top left.
const CAB_FOCUS = [3608, 4250]; // art x: window centre, cat
function cabCrop(vw, vh, W = 7136, H = 3528) {
  const s = Math.max(vw / W, vh / H), w = vw / s, h = vh / s, t = Math.min(1, Math.max(0, (1.5 - vw / vh) / 0.7));
  const fx = CAB_FOCUS[0] + t * (CAB_FOCUS[1] - CAB_FOCUS[0]);
  return { s, x: Math.min(W - w, Math.max(0, fx - w / 2)), y: 0.15 * (H - h) };
}
// Window view: the glass (x0, y0, x1, y1) covers the screen, centred as close to the desk view's focus as it allows.
function cabGlassCam(vw, vh, g) {
  const gw = g.x1 - g.x0, gh = g.y1 - g.y0, s = Math.max(vw / gw, vh / gh), w = vw / s, h = vh / s, t = Math.min(1, Math.max(0, (1.5 - vw / vh) / 0.7));
  const fx = CAB_FOCUS[0] + t * (CAB_FOCUS[1] - CAB_FOCUS[0]);
  return { s, x: Math.min(g.x1 - w, Math.max(g.x0, fx - w / 2)), y: g.y0 + (gh - h) / 2 };
}
// Cabin sound settings: the radio (on by default) and three layers (off), each with a volume 0–1; noise colour white /
// pink / brown; one mute for all. Anything missing or broken falls back per field.
const CAB_NOISE = ['white', 'pink', 'brown'];
const CAB_AUDIO = { muted: false, music: { on: true, vol: 0.6 }, space: { on: false, vol: 0.5 }, hum: { on: false, vol: 0.4 }, noise: { on: false, vol: 0.3, type: 'pink' } };
function parseCabAudio(raw) {
  let o = null; try { o = JSON.parse(raw); } catch (e) { /* default */ }
  if (!o || typeof o !== 'object') o = {};
  const vol = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  const out = { muted: o.muted === true };
  for (const k of ['music', 'space', 'hum', 'noise']) {
    const s = o[k] && typeof o[k] === 'object' ? o[k] : {}, d = CAB_AUDIO[k];
    out[k] = { on: typeof s.on === 'boolean' ? s.on : d.on, vol: vol(s.vol, d.vol) };
  }
  out.noise.type = CAB_NOISE.includes(o.noise && o.noise.type) ? o.noise.type : CAB_AUDIO.noise.type;
  return out;
}

if (typeof module !== 'undefined') module.exports = { CAB_NOISE, CAB_AUDIO, parseCabAudio, CAB_TIERS, cabTierMax, cabTier, cabCrop, cabGlassCam, PREF_KEYS, VIEW_MODES, WIN_IDS, readPref, writePref, clearPref, startupMode, skyGainOf, parseVehicles, defaultWins, parseWins, clampWin, freeRects, bestRect, TRAIL_REVS, TRAIL_FADE, trailAlpha };
