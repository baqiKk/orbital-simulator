// Persisted UI preferences: view mode and window layout.
// DOM-free: the storage object is passed in (localStorage, sessionStorage, a stub or null), so Node tests can run it.
// Every storage access is wrapped: private windows, blocked site data and quota errors must never break the page.
const PREF_KEYS = { mode: 'orbsim.mode', wins: 'orbsim.wins.v1', perfTip: 'orbsim.perfTip', venusRadar: 'orbsim.venusRadar', clouds: 'orbsim.clouds' };
const VIEW_MODES = ['low', 'normal', '3d'];
// placement order: overview's default spot sits under Results, so it comes after it
const WIN_IDS = ['mission', 'bodies', 'results', 'overview', 'transfer', 'gloss', 'model', 'credits'];
const WIN_DEFAULT_OPEN = { mission: true, results: true };

function readPref(store, key) { try { return store ? store.getItem(key) : null; } catch (e) { return null; } }
function writePref(store, key, v) { try { if (!store) return false; store.setItem(key, v); return true; } catch (e) { return false; } }
function clearPref(store, key) { try { if (store) store.removeItem(key); } catch (e) { /* ignore */ } }

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

if (typeof module !== 'undefined') module.exports = { PREF_KEYS, VIEW_MODES, WIN_IDS, readPref, writePref, clearPref, startupMode, defaultWins, parseWins, clampWin, freeRects, bestRect, TRAIL_REVS, TRAIL_FADE, trailAlpha };
