// Persisted UI preferences: view mode and window layout.
// DOM-free: the storage object is passed in (localStorage, sessionStorage, a stub or null), so Node tests can run it.
// Every storage access is wrapped: private windows, blocked site data and quota errors must never break the page.
const PREF_KEYS = { mode: 'orbsim.mode', wins: 'orbsim.wins.v1', perfTip: 'orbsim.perfTip' };
const VIEW_MODES = ['low', 'normal'];
// placement order: overview's default spot sits under Results, so it comes after it
const WIN_IDS = ['mission', 'bodies', 'results', 'overview', 'transfer', 'gloss', 'model'];
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
// wide: a wide desktop (≥ 1440 px) — the overview (body picker) starts open too.
function defaultWins(opts = {}) {
  const o = {};
  for (const id of WIN_IDS) o[id] = { open: !!WIN_DEFAULT_OPEN[id] || (!!opts.wide && id === 'overview'), collapsed: !!opts.narrow && id === 'results', x: null, y: null };
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

if (typeof module !== 'undefined') module.exports = { PREF_KEYS, VIEW_MODES, WIN_IDS, readPref, writePref, clearPref, startupMode, defaultWins, parseWins, clampWin };
