// Persisted UI preferences: view mode and window layout.
// DOM-free: the storage object is passed in (localStorage, sessionStorage, a stub or null), so Node tests can run it.
// Every storage access is wrapped: private windows, blocked site data and quota errors must never break the page.
const PREF_KEYS = { mode: 'orbsim.mode', wins: 'orbsim.wins.v1', perfTip: 'orbsim.perfTip', venusRadar: 'orbsim.venusRadar', clouds: 'orbsim.clouds', sky: 'orbsim.sky', osc: 'orbsim.osc', slow: 'orbsim.slow', vehicles: 'orbsim.vehicles.v1', cabLamp: 'orbsim.cab.lamp', cabScene: 'orbsim.cab.scene', cabAudio: 'orbsim.cab.audio.v1', simSnap: 'orbsim.simSnap.v1', pomo: 'orbsim.cab.pomo.v1', pomoStats: 'orbsim.cab.pomoStats.v1', pomoHud: 'orbsim.cab.pomoHud', pomoNotify: 'orbsim.cab.pomoNotify', cabSaver: 'orbsim.cab.saver.v1', cabPanHint: 'orbsim.cab.panHint', cabBoot: 'orbsim.cab.boot', cabBox: 'orbsim.cab.box.v1', cabQ: 'orbsim.cab.q', simBoot: 'orbsim.boot', uiExpert: 'orbsim.ui.expert', start: 'orbsim.start', tour: 'orbsim.tour.v1', evStop: 'orbsim.evStop', liveTip: 'orbsim.liveTip', startSeen: 'orbsim.startSeen' };
const VIEW_MODES = ['low', 'normal', '3d'];
// placement order: overview's default spot sits under Results, so it comes after it
const WIN_IDS = ['mission', 'bodies', 'results', 'overview', 'transfer', 'gloss', 'model', 'credits'];
const WIN_DEFAULT_OPEN = { mission: true, results: true };

// keys of settings whose features are gone (the cabin's ceiling strip): cleared once read, so nothing old lingers
const PREF_OLD = ['orbsim.cab.strip'];
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
  return VIEW_MODES.includes(m) ? { mode: m, auto: false } : { mode: 'normal', auto: true };
}
// The main page's start (what the viewer chose on the start screen; the cabin is not remembered): 'scene', 'design' or
// 'mission:<scenario id>' (one of ids); anything else null (the start screen then)
// The start screen comes on every new visit (tab or session: sessionStorage PREF_KEYS.startSeen), over the opening
// tour; not when coming back from the cabin (snap), from a link with a query or hash (?manzara=, #kaynakca: deep) or on
// a reload in the same session (seen). Then the remembered choice applies as before.
function startShow(o) { return !o.seen && !o.snap && !o.deep; }
// ?manzara=tour|saturn|earth (a shared link): the scene to open on, or null
function sceneParam(search) {
  const m = /[?&]manzara=([a-z]+)/.exec(search || '');
  return m && ['tour', 'saturn', 'earth'].includes(m[1]) ? m[1] : null;
}
function parseStart(raw, ids) {
  if (raw === 'scene' || raw === 'design') return raw;
  if (typeof raw === 'string' && raw.startsWith('mission:') && ids.includes(raw.slice(8))) return raw;
  return null;
}
// Nothing saved: the mode chosen for the device, never asked. Light ('low') when the last start died (crashed), data
// saving is on, or the device says it is small (memory ≤ 2 GB or ≤ 2 cores; iOS Safari does not tell either reliably:
// there only the frame times count, autoModeFrames). dev: { crashed, saveData, ios, mem, cores }
function autoMode(dev) {
  if (dev.crashed || dev.saveData) return 'low';
  if (!dev.ios && ((dev.mem != null && dev.mem <= 2) || (dev.cores != null && dev.cores <= 2))) return 'low';
  return 'normal';
}
// the first seconds' frame times (s): light when their median is over 40 ms (about 25 fps); too few frames: no verdict
function autoModeFrames(dts) {
  if (dts.length < 20) return null;
  const s = [...dts].sort((a, b) => a - b);
  return s[s.length >> 1] > 0.04 ? 'low' : 'normal';
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
function cabTierMax(dev) { return dev.phone || dev.ios ? 2560 : dev.desktop && (dev.mem == null || dev.mem >= 8) ? 7136 : 3840; }
// the cabin's canvas resolution: the screen's pixel ratio, at most 2 (1.5 on phones: an iPhone's 3 would make every
// canvas four times the memory)
function cabDpr(dev, dpr) { return Math.min(dpr || 1, dev.phone ? 1.5 : 2); }
// The cabin's decoded memory at its worst (MB, w × h × 4 bytes per pixel), as the page sizes things: the art layers at
// tier (the room three times: its image and the CSS masks of the shine and the night layers), the night canvas (a
// quarter of the art), the move canvases (two, the screen's size, during a camera move or a pan), the 3D glass (the
// sky box at dpr: colour and depth, × 4 with MSAA, plus the resolved frame), the cross-fade canvas, and the planet
// textures (texLayers images at texCap wide, 2:1, decoded once and on the GPU with mipmaps, × 7/3) and the Milky Way
// (sky px wide, the same). o: { vw, vh, dpr, tier, layout, box: { w, h } (CSS px), msaa, texCap, texLayers, sky }
function cabMemEstimate(o) {
  const MB = 1 / 1048576, [W] = o.layout.size, k = o.tier / W, d2 = o.dpr * o.dpr;
  let art = 3 * Math.round(W * k) * Math.round(o.layout.size[1] * k) * 4; // the room
  for (const L of Object.values(o.layout.layers)) art += Math.round(L.w * k) * Math.round(L.h * k) * 4; // the cat's layers
  const night = Math.round(W / 4) * Math.round(o.layout.size[1] / 4) * 4, move = 2 * o.vw * o.vh * d2 * 4;
  const px = o.box.w * o.box.h * d2, gl = px * 8 * (o.msaa ? 4 : 1) + px * 4, xf = px * 4;
  const tex = o.texLayers * o.texCap * o.texCap / 2 * 4 * 7 / 3 + o.sky * o.sky / 2 * 4 * 7 / 3;
  const parts = { art: art * MB, night: night * MB, move: move * MB, gl: gl * MB, xf: xf * MB, tex: tex * MB };
  return { parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
}
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
// Window view: close to the glass, not into it. The window's frame and the sill with the cat stay in the picture
// (CAB_WIN, art px: the frame's outer edges, from just above it down to the sill's top just under the cat's paws at the
// screen's bottom; the sill's front face and below stay out, the tail's hanging tip with them):
// that box fits the screen, and a narrow screen comes closer, the glass at least 66 % of the height (CAB_WIN_GLASS),
// sliding sideways so the cat's right edge (CAB_CAT_X) stays in; never wider than the art. The glass fills most of the view.
// Portrait: the glass's full height from just above it down to the same line under the paws (CAB_PAWS_Y), all of it over
// the bottom bar (bot: screen px the bar takes at the bottom), so the cat is not under the buttons.
const CAB_WIN = [1740, 170, 5490, 2335], CAB_WIN_GLASS = 0.66, CAB_CAT_X = 4740, CAB_PAWS_Y = 2335;
function cabGlassCam(vw, vh, g, W = 7136, H = 3528, bot = 0) {
  if (vw < vh) {
    const [x0, y0, x1] = CAB_WIN, s = Math.max((vh - bot) / (CAB_PAWS_Y - y0), vw / W), w = vw / s, h = vh / s, cx = Math.max((x0 + x1) / 2, CAB_CAT_X - w / 2);
    return { s, x: Math.min(W - w, Math.max(0, cx - w / 2)), y: Math.min(H - h, Math.max(0, CAB_PAWS_Y - (vh - bot) / s)) };
  }
  const [x0, y0, x1, y1] = CAB_WIN, s = Math.max(Math.min(vw / (x1 - x0), vh / (y1 - y0)), CAB_WIN_GLASS * vh / (g.y1 - g.y0), vw / W, vh / H), w = vw / s, h = vh / s;
  const cx = w < x1 - x0 ? Math.max((x0 + x1) / 2, CAB_CAT_X - w / 2) : (x0 + x1) / 2;
  return { s, x: Math.min(W - w, Math.max(0, cx - w / 2)), y: Math.min(H - h, Math.max(0, y1 - h)) };
}
// The room's geometry for the light through the glass (art px; x right, y down, z from the wall towards the viewer).
// The wall is the picture plane (z = 0 lands on the art 1:1); the eye looks straight at it from z = D, level with the
// art point (px, yh). Measured on the illustration: the horizon yh and the distance D from the vanishing points of the
// card on the desk (back-projected with them, its corners form a 618 × 358 rectangle with 90.6° corners); px is the
// window's centre. Brightness steps down the columns x 3300 / 4000 / 5000 of the 3840 tier: the sill's top meets the
// wall at y 2172 and its front edge shows at y 2295 (so it is 410 deep), the desk meets the wall at y 2625 and its front
// edge shows at y 3390 (1294 deep).
const CAB_ROOM = { px: 3608, yh: 1170, D: 3752, sill: { y: 2172, z: 410 }, desk: { y: 2625, z: 1294 } };
// art point of a room point
function cabProject(p, R = CAB_ROOM) { const k = R.D / (R.D - p[2]); return [R.px + (p[0] - R.px) * k, R.yh + (p[1] - R.yh) * k]; }
// the room point at height y (a level plane) seen at art point a
function cabUnproject(a, y, R = CAB_ROOM) { const k = (y - R.yh) / (a[1] - R.yh); return [R.px + (a[0] - R.px) * k, y, R.D * (1 - k)]; }
// the glass's outline on the wall (clockwise on screen): layout.json's box with its rounded corners (g.c: the corners'
// centres; each radius from the box)
function cabGlassOutline(g, n = 8) {
  const out = [], C = [['TL', g.x0, g.y0, 180], ['TR', g.x1, g.y0, 270], ['BR', g.x1, g.y1, 0], ['BL', g.x0, g.y1, 90]];
  for (const [k, ex, ey, a0] of C) {
    const [cx, cy] = g.c[k], r = (Math.abs(cx - ex) + Math.abs(cy - ey)) / 2;
    for (let i = 0; i <= n; i++) { const a = (a0 + 90 * i / n) * Math.PI / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  }
  return out;
}
// the part of a polygon on one side of the line y = yc (below: y >= yc)
function cabClipY(poly, yc, below) {
  const out = [], ins = p => (below ? p[1] >= yc : p[1] <= yc);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ia = ins(a), ib = ins(b);
    if (ia) out.push(a);
    if (ia !== ib) { const t = (yc - a[1]) / (b[1] - a[1]); out.push([a[0] + t * (b[0] - a[0]), yc]); }
  }
  return out;
}
// Where light travelling along L (unit, room axes) through the glass (outline, art px on the wall) lands: on the sill's
// top, else on the desk up to its front edge. Window rows split along horizontal lines (each plane is level), every
// point is carried along L to its plane and drawn in perspective. Art-px polygons (possibly empty); null when the light
// does not go down into the room.
function cabLightPatch(L, outline, R = CAB_ROOM) {
  if (!(L[1] > 1e-3 && L[2] > 1e-3)) return null;
  const q = L[2] / L[1], ySill = R.sill.y - R.sill.z / q, yFront = R.desk.y - R.desk.z / q;
  const land = (w, y) => { const t = (y - w[1]) / L[1]; return cabProject([w[0] + t * L[0], y, t * L[2]], R); };
  return { sill: cabClipY(outline, ySill, true).map(w => land(w, R.sill.y)), desk: cabClipY(cabClipY(outline, ySill, false), yFront, true).map(w => land(w, R.desk.y)) };
}
// eclipses for the light from outside: the share of a disc of angular radius r1 covered by one of r2 whose centre is d away (flat geometry)
function cabDiscCover(r1, r2, d) {
  if (d >= r1 + r2) return 0; if (d <= r2 - r1) return 1; if (d <= r1 - r2) return r2 * r2 / (r1 * r1);
  const a = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)), b = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return (r1 * r1 * (a - Math.sin(2 * a) / 2) + r2 * r2 * (b - Math.sin(2 * b) / 2)) / (Math.PI * r1 * r1);
}
// Cabin sound settings: the radio (on by default) and three layers (off), each with a volume 0–1; noise colour white /
// pink / brown; the pomodoro's bell (on); the cat's purr while it is petted (on); one mute for all. Anything missing or broken falls back per field.
const CAB_NOISE = ['white', 'pink', 'brown'];
const CAB_AUDIO = { muted: false, music: { on: true, vol: 0.6 }, space: { on: false, vol: 0.5 }, hum: { on: false, vol: 0.4 }, noise: { on: false, vol: 0.3, type: 'pink' }, chime: { on: true, vol: 0.6 }, purr: { on: true, vol: 0.5 } };
function parseCabAudio(raw) {
  let o = null; try { o = JSON.parse(raw); } catch (e) { /* default */ }
  if (!o || typeof o !== 'object') o = {};
  const vol = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  const out = { muted: o.muted === true };
  for (const k of ['music', 'space', 'hum', 'noise', 'chime', 'purr']) {
    const s = o[k] && typeof o[k] === 'object' ? o[k] : {}, d = CAB_AUDIO[k];
    out[k] = { on: typeof s.on === 'boolean' ? s.on : d.on, vol: vol(s.vol, d.vol) };
  }
  out.noise.type = CAB_NOISE.includes(o.noise && o.noise.type) ? o.noise.type : CAB_AUDIO.noise.type;
  return out;
}
// Cabin screen saver (Phase 14): start after this many minutes without input (0: never, the default)
const CAB_SAVER_AUTO = [0, 5, 10, 20];
function parseCabSaver(raw) {
  let o = null; try { o = JSON.parse(raw); } catch (e) { /* default */ }
  return { auto: o && CAB_SAVER_AUTO.includes(o.auto) ? o.auto : 0 };
}
// Panning the room with a finger at the desk view: rubber (screen px) the most the room stretches past its edge, tap
// (px) the move that turns a touch into a drag, tau (ms) the fling's decay, idle (ms) untouched before the view goes
// back to its focus, back (ms) that move's length
const CAB_PAN = { rubber: 56, tap: 8, tau: 325, idle: 9000, back: 900 };
// the offsets (art px, from the desk crop's x) the room can be panned to: its left edge to its right edge on screen
function cabPanRange(crop, vw, W) { return [-crop.x, W - vw / crop.s - crop.x]; }
// x past [lo, hi] shown stretched: never more than r beyond the edge, as a rubber band; inside, as it is
function cabRubber(x, lo, hi, r) {
  if (x > hi) return hi + r * (1 - 1 / (1 + (x - hi) / r));
  if (x < lo) return lo - r * (1 - 1 / (1 + (lo - x) / r));
  return x;
}
// The sky canvas's box (CSS px, screen at the desk view; it then moves with the glass): it covers the screen at the
// desk and the window view (and every camera between) and the whole glass at the desk scale, so a panned room never
// shows the glass's edge without sky. pd, pw: the glass's centre on screen at the two views; gw, gh: the glass's size
// at the desk scale. g: the glass's centre inside the box. pan (phones): [lo, hi] the room's pan range at the desk view
// in CSS px (with the rubber stretch), gwin: the glass's size at the window view [w, h]: then the box spans only the
// glass the screen shows (over that range at the desk view, and at the window view), each side capped at the glass's
// half-size at the window view: the glass is largest there, and its centre slides linearly between the two views, so no
// camera between them shows glass outside the box; around the glass the room is opaque. Less canvas memory.
function cabSkyBox(vw, vh, pd, pw, gw, gh, pad = 40, pan = null, gwin = null) {
  const ex = pan ? [Math.min(gw / 2, pd[0] - pan[0]), Math.min(gw / 2, vw - pd[0] + pan[1])] : [gw / 2, gw / 2], ey = pan ? 0 : gh / 2;
  const cx = pan && gwin ? gwin[0] / 2 : Infinity, cy = pan && gwin ? gwin[1] / 2 : Infinity;
  const L = Math.ceil(Math.min(cx, Math.max(pd[0], pw[0], ex[0]))) + pad, R = Math.ceil(Math.min(cx, Math.max(vw - pd[0], vw - pw[0], ex[1]))) + pad;
  const T = Math.ceil(Math.min(cy, Math.max(pd[1], pw[1], ey))) + pad, B = Math.ceil(Math.min(cy, Math.max(vh - pd[1], vh - pw[1], ey))) + pad;
  return { l: pd[0] - L, t: pd[1] - T, w: L + R, h: T + B, g: [L, T] };
}
// The simulator's state left for the way back from the cabin (sessionStorage, read once): null unless it is a fresh
// (12 h), well-formed snapshot. scene: the opening scene's view when it was on ('' otherwise).
const SNAP_MAX_MS = 12 * 3600 * 1000;
function parseSimSnap(raw, now) {
  let o = null; try { o = JSON.parse(raw); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || !(now - o.at >= 0 && now - o.at < SNAP_MAX_MS)) return null;
  if (!['', 'saturn', 'earth', 'tour'].includes(o.scene) || !o.S || typeof o.S !== 'object' || !['transfer', 'man'].includes(o.S.kind) || !Array.isArray(o.S.bodies) || !o.S.M || typeof o.S.M !== 'object') return null;
  return o;
}

// ----- The opening tour (Phase 16b) -----
// Saturn → Jupiter → Mars → the Earth and the Moon → the Sun (≈ 52 s), built from the day's positions. Each stop: the
// body, the width of the view there (w, m: Saturn out past Rhea, Jupiter past Callisto, Mars past Deimos, the Earth past
// the Moon, the Sun past Mars), how long it takes to get there (move, s) and how long the camera stays (hold, s); phase:
// the angle between the Sun and the camera seen from the body (part of the lit side in view), elev: the camera's height
// over the ecliptic. Between two stops the camera takes van Wijk & Nuij's smooth zoom and pan ("Smooth and efficient
// zooming and panning", 2003): the view widens on the way just enough that the motion on screen stays even, whether the
// stops are 13 AU or 0.4 AU apart; eased in and out.
const OPEN_TOUR = [
  { k: 'saturn', w: 1.4e9, hold: 8, phase: 50, elev: 18 },
  { k: 'jupiter', w: 4.5e9, move: 12, hold: 5, phase: 50, elev: 15 },
  { k: 'mars', w: 6e7, move: 9, hold: 2, phase: 60, elev: 15 },
  { k: 'earth', w: 1e9, move: 7, hold: 2, phase: 90, elev: 15 },
  { k: 'sun', w: 6e11, move: 7, elev: 35 },
];
const OPEN_TOUR_S = OPEN_TOUR.reduce((a, k) => a + (k.move || 0) + (k.hold || 0), 0);
const OPEN_TOUR_RHO = Math.SQRT2;
const v3n = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// the view direction (camera → body, unit) at each stop, from the positions P (key → [x, y, z], one frame for all, z up
// from the ecliptic). over: a stop's own direction (the app gives Saturn's from its ring plane). A body is seen from its
// sunward side turned by phase, to the side nearer the previous stop's direction; the Sun from above, along the last one.
function tourDirs(P, over) {
  const D = [];
  for (let i = 0; i < OPEN_TOUR.length; i++) {
    const k = OPEN_TOUR[i], e = (k.elev || 0) * Math.PI / 180, prev = D[i - 1];
    if (over && over[k.k]) { D.push(v3n(over[k.k])); continue; }
    if (k.k === 'sun') { const h = v3n([prev[0], prev[1], 0]); D.push([Math.cos(e) * h[0], Math.cos(e) * h[1], -Math.sin(e)]); continue; }
    const s = v3n([P.sun[0] - P[k.k][0], P.sun[1] - P[k.k][1], 0]), a = (k.phase || 0) * Math.PI / 180;
    const cand = [1, -1].map(g => { const c = Math.cos(g * a), n = Math.sin(g * a), h = [s[0] * c - s[1] * n, s[0] * n + s[1] * c]; return [-Math.cos(e) * h[0], -Math.cos(e) * h[1], -Math.sin(e)]; });
    D.push(!prev || cand[0][0] * prev[0] + cand[0][1] * prev[1] + cand[0][2] * prev[2] >= cand[1][0] * prev[0] + cand[1][1] * prev[1] + cand[1][2] * prev[2] ? cand[0] : cand[1]);
  }
  return D;
}
// the smooth zoom and pan from width w0 to w1 over a distance u1: its length S and the place u / width w at s in [0, S]
function zoomPan(w0, w1, u1) {
  const r = OPEN_TOUR_RHO, r2 = r * r;
  if (u1 < 1e-9 * Math.max(w0, w1)) { const g = Math.log(w1 / w0) >= 0 ? 1 : -1, S = Math.abs(Math.log(w1 / w0)) / r; return { S, at: s => [0, w0 * Math.exp(g * r * s)] }; }
  const b0 = (w1 * w1 - w0 * w0 + r2 * r2 * u1 * u1) / (2 * w0 * r2 * u1), b1 = (w1 * w1 - w0 * w0 - r2 * r2 * u1 * u1) / (2 * w1 * r2 * u1);
  const r0 = -Math.asinh(b0), rr1 = -Math.asinh(b1), S = (rr1 - r0) / r, c0 = Math.cosh(r0), s0 = Math.sinh(r0);
  return { S, at: s => [w0 / r2 * (c0 * Math.tanh(r * s + r0) - s0), w0 * c0 / Math.cosh(r * s + r0)] };
}
const smooth01 = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// the camera at tour time T (s): { t: the point looked at, w: the view's width there (m), d: the view direction, stop:
// the stop held or arrived at (or -1 on the way), done: at the last stop }. P and D as above (D from tourDirs).
function tourAt(T, P, D) {
  let t = Math.max(0, T);
  for (let i = 0; i < OPEN_TOUR.length; i++) {
    const k = OPEN_TOUR[i], last = i === OPEN_TOUR.length - 1;
    if (i > 0) {
      if (t < k.move) {
        const a = OPEN_TOUR[i - 1], A = P[a.k], B = P[k.k], dx = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], u1 = Math.hypot(...dx);
        const zp = zoomPan(a.w, k.w, u1), f = smooth01(t / k.move), [u, w] = zp.at(zp.S * f), g = u1 > 0 ? u / u1 : 0;
        const d0 = D[i - 1], d1 = D[i], d = v3n([0, 1, 2].map(j => d0[j] + (d1[j] - d0[j]) * f));
        return { t: [A[0] + dx[0] * g, A[1] + dx[1] * g, A[2] + dx[2] * g], w, d, stop: -1, done: false };
      }
      t -= k.move;
    }
    if (last || t < k.hold) return { t: P[k.k].slice(0, 3), w: k.w, d: D[i], stop: i, done: last };
    t -= k.hold;
  }
}

if (typeof module !== 'undefined') module.exports = { startShow, sceneParam, OPEN_TOUR, OPEN_TOUR_S, tourDirs, tourAt, zoomPan, PREF_OLD, autoMode, autoModeFrames, parseStart, SNAP_MAX_MS, parseSimSnap, CAB_NOISE, CAB_AUDIO, parseCabAudio, CAB_SAVER_AUTO, parseCabSaver, CAB_PAN, cabPanRange, cabRubber, cabSkyBox, cabDpr, cabMemEstimate, CAB_TIERS, cabTierMax, cabTier, cabCrop, cabGlassCam, CAB_WIN, CAB_CAT_X, CAB_PAWS_Y, CAB_ROOM, cabProject, cabUnproject, cabGlassOutline, cabClipY, cabLightPatch, cabDiscCover, PREF_KEYS, VIEW_MODES, WIN_IDS, readPref, writePref, clearPref, startupMode, skyGainOf, parseVehicles, defaultWins, parseWins, clampWin, freeRects, bestRect, TRAIL_REVS, TRAIL_FADE, trailAlpha };
