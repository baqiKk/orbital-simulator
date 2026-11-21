// Free flight (Phase 19b; classic script before app.js: it only defines and binds its own controls; the app calls
// flyFrame from its draw loop, flyTap from its tap and flyRestore at the end of its start). The craft is flown live in the
// map's system (all the real bodies, core.js flyAdvance: in the N-body field below RAILS_W, on rails above), drawn on
// the map view (2D and 3D: the bodies, labels and camera are the map's), with its predicted path (core.js flyPredict,
// patched conics, redone twice a second), its trail (relative to the dominant body, so an orbit reads as an orbit) and a
// marker. A warp bar: pause, the warp steps (core.js FLY_WARPS), "Şimdi" (back to real time), the date, the body,
// altitude and speed, "Çık". Keys: , and . warp down / up, Space pause. The flight is kept in one sessionStorage
// snapshot (prefs.js parseFlySnap, PREF_KEYS.flySnap) and comes back on a reload.
//
// Maneuver nodes (Phase 19c): a click on the predicted path puts a node there (FREE.nodes: { t absolute, d: [prograde,
// radial out, normal] m/s }, in the dominant body's frame at that moment, core.js nodeFrame); a click on a node's mark
// selects it. The selected node has six handles (prograde / retrograde amber, radial out / in cyan, normal / antinormal
// green, projected on screen): dragging one along itself changes that component, faster the further it goes (Shift:
// ten times finer). The node panel (#flyNode) holds the same as number fields, the total Δv, the orbit after it,
// "Sil" and ↶ (undo, U; FREE.undo: the nodes before each change); Delete removes the selected node. The path after the
// first node is drawn in cyan. While a node is dragged, and until the N-body refinement of the edit is back (core.js
// flyRefine in a worker, asked FLY_REF_MS after the last change), the path is the patched-conic prediction drawn dashed
// and faint; the refinement draws it solid. A node the flight passes with "Otomatik ateşle" off is dropped.
//
// The engine (Phase 19d): the craft flies with the mission's engine as it was at that moment (engine-ui.js engNow: its
// spec, its clock τ, so the propellant left; FREE.eng). "Otomatik ateşle" (on by default) fires each node: a burn of
// length T (Tsiolkovsky at full thrust) centred on the node, along the node's Δv fixed in space, cut when that Δv is
// delivered (or the propellant runs out), then the node goes. The time warp never steps over a burn's start and is held
// at core.js flyWarpMax(T) while the engine fires (the warp buttons above it are disabled); "Düğüme hızlandır" warps to
// a little before the burn. By hand: throttle W / S (±10 %), Z full, X cut, the direction locked to prograde, retrograde,
// radial out / in, normal or antinormal (the node panel's buttons). The budget: the Δv left, each node's burn time and
// propellant, a warning when the nodes need more than is left. The engine panel (#engPanel) shows the engine as in a
// mission; the 3D model, "Araca yaklaş" (A, double click on the craft) and the cutaway work in free flight too
// (mode3d.js drawMap3 calls flyCraft3). The first time, a short skippable run of hints (FLY_TIPS); "Nasıl uçulur?" under
// the mode chip brings them back.
// Targets and transfer windows (Phase 19e): a target body (#fnTgt; FREE.target) shows how the path meets it: its sphere
// entered and the pass's altitude, else the closest approach (core.js flyClosest, every FLY_CA_MS), drawn as the target's
// place at that moment, the craft's, a dashed line between and the distance. "Transfer penceresi" (#fnWin) asks the
// worker for core.js flyWindow (the least Δv over the next synodic period: a Lambert arc straight from the orbit to a
// moon of the body below, or between planets the arc about the Sun and the ejection node on the parking orbit, corrected
// on v∞ and the B-plane); "Düğümü koy" lays its node (one undo step), "Düğüme hızlandır" takes it from there. When the
// dominant body changes (a sphere left or entered) the map's camera frames the new one.
const FREE = { on: false, hid: [], st: null, target: -1, tca: null, tcaAt: 0, win: null, winBusy: null, warp: 1, paused: false, pred: null, predAt: 0, trail: null, tb: -1, tn: 0, saveAt: 0, txt: {},
  nodes: [], sel: -1, undo: [], ver: 0, editAt: 0, drag: null, ref: null, refVer: -1, wk: null, wkBusy: false, nst: [], hnd: [], nmk: [], predDirty: false,
  eng: null, burn: null, fire: 0, fdir: null, pl: 0, warpTo: null, cap: Infinity, appr: false, apprPrev: null, aim: null, tip: -1, att: null };
const RAILS_W = 1000, TRAIL_N = 720, FLY_REF_MS = 250, FLY_UNDO = 60, FLY_SS = (() => { try { return window.sessionStorage; } catch (e) { return null; } })();
const flyEl = id => document.getElementById(id);
// the craft's state now, from the mission on screen: its position and velocity about the dominant body (a maneuver's
// body; after the mission the analytic orbit's), laid on that body in the map's system at the same moment
function flyFromMission() {
  if (!C || !simR || S.model !== 'real') return null;
  const tNow = tNowG, ext = S.ext > 0 && C.orbit;
  let key, r, v;
  if (ext) { const q = new Float64Array(6); C.orbit.rel(tNow - C.T, q); key = S.bodies[C.orbit.body].key; r = [q[0], q[1], q[2]]; v = [q[3], q[4], q[5]]; }
  else {
    const craft = posAtTime(tNow, [0, 0, 0]), q = craftRel(tNow, craft);
    states(sys, S.M.t0 * DAY + tNow, SPo, SVo);
    key = S.kind === 'man' ? S.bodies[0].key : S.bodies[domBody(sys, SPo, craft[0], craft[1], craft[2])].key; r = q.r; v = q.v;
  }
  const m = Number.isFinite(massAt(tNow)) ? massAt(tNow) : (engNow(tNow).s ? engNow(tNow).s.m0 : 1000);
  return { t: S.M.t0 * DAY + tNow, key, r, v, m };
}
function flyEnterState(q) {
  const b = MAPK.indexOf(q.key); if (b < 0) return false;
  mapSys.P = mapSys.P || new Float64Array(3 * mapSys.N); mapSys.V = mapSys.V || new Float64Array(3 * mapSys.N);
  states(mapSys, q.t, mapSys.P, mapSys.V);
  FREE.st = { t: q.t, r: [0, 1, 2].map(j => mapSys.P[3 * b + j] + q.r[j]), v: [0, 1, 2].map(j => mapSys.V[3 * b + j] + q.v[j]), m: q.m, h: 10 };
  FREE.att = { n: unit3(q.v) || [1, 0, 0], w: 0, u: null, ok: true, err: 0, want: false, acc: 0, puff: 0, pu: null }; // the nose prograde, at rest
  FREE.on = true; FREE.paused = false; FREE.warp = q.warp || 1; FREE.pred = null; FREE.predAt = 0; FREE.trail = new Float64Array(3 * TRAIL_N); FREE.tn = 0; FREE.tb = -1; FREE.txt = {};
  FREE.nodes = (q.nodes || []).filter(nd => nd.t > q.t).map(nd => ({ t: nd.t, d: [...nd.d] })); FREE.sel = FREE.nodes.length ? 0 : -1; FREE.undo = []; FREE.ver++; FREE.ref = null; FREE.drag = null;
  flyEngInit(q);
  FREE.target = q.target ? MAPK.indexOf(q.target) : -1; FREE.tca = null; FREE.win = null; flyTgtList();
  if (SCENE.on) sceneEnd(false);
  S.playing = false; setPlayIcon();
  setMap(true); MAP.log = false; MAP.moons = true; syncMapUI();
  MAP.follow = b;
  const rr = Math.hypot(...q.r);
  cam.scale = Math.min(W, H) * 0.3 / Math.max(rr, mapSys.R[b] * 1.2); cam.cx = 0; cam.cy = 0; MAP.needFit = false;
  CAM3.map.dist = Math.max(rr, mapSys.R[b]) * 3.2;
  APP.mode = 'fly'; document.documentElement.dataset.fly = '';
  // the mission's windows step aside (as for the scene; they come back on exit)
  for (const id of ['mission', 'results', 'overview']) if (WINS[id].open && !SCENE.hide.has(id)) { SCENE.hide.add(id); winEl(id).classList.add('scene-hide'); FREE.hid.push(id); }
  railSync();
  flyEl('flyNode').hidden = false; flyEl('flyHelp').hidden = false; flyEngMount(true); flyEngList(); engApplyLabel(); flyBarSync(); flyPanel(); INS = null;
  flyFold(matchMedia('(max-width: 560px)').matches); // folded to its one line on phones
  flyTips(readPref(LS, PREF_KEYS.flyTips) ? -1 : 0);
  return true;
}
function flyEnter() { if (REC.busy) return; $('#recPanel').hidden = true; const q = flyFromMission(); if (q) flyEnterState(q); }
// "Kendin uç" (the start screen; Phase 19f): a fresh flight in a 400 km Earth orbit inclined 51.6° to the equator (the
// station's), now, on the Centaur upper stage (RL10, full)
function flyStartLEO() { return flyStartAt('earth'); }
// "Kendin uç" anywhere (2026-11-21, Phase 20A-7): a low circular orbit about body key, now, with engine E (a full Centaur /
// RL10 by default). The altitude by body (FLY_ALT, km; else 12 % of the radius, at least 20 km), the inclination to its
// equator (FLY_INC; 0 elsewhere), the equator from its IAU pole (globe.js bodyAxes; a locked moon: its orbit's plane),
// the orbit starting at the equator's ascending node on the ecliptic. Only bodies whose orbit lies well inside their
// sphere of influence are offered (flyBodies). o: { alt (km), inc (°), E }
const FLY_ALT = { earth: 400, moon: 100, mars: 300, venus: 300, mercury: 200, jupiter: 8000, saturn: 6000, uranus: 4000, neptune: 4000, titan: 1500, io: 150, europa: 100, ganymede: 100, callisto: 100 };
const FLY_INC = { earth: 51.6 }, FLY_FIRST = ['earth', 'moon', 'mars'];
const flyAltOf = key => { const i = MAPK.indexOf(key); return FLY_ALT[key] || Math.max(20, Math.round(0.12 * mapSys.R[i] / 1e3)); };
function flyBodies() {
  const ok = MAPK.filter((k, i) => i !== MSUN && BODIES[k] && (mapSys.R[i] + flyAltOf(k) * 1e3) < (Number.isFinite(mapSys.soi[i]) ? mapSys.soi[i] / 3 : Infinity));
  return [...FLY_FIRST.filter(k => ok.includes(k)), ...ok.filter(k => !FLY_FIRST.includes(k))];
}
function flyStartAt(key, o = {}) {
  if (REC.busy) return false;
  const i = MAPK.indexOf(key); if (i < 0 || i === MSUN) return false;
  const t = utcToDays(Date.now()) * DAY, P = mapSys.P, V = mapSys.V; states(mapSys, t, P, V);
  const R = mapSys.R[i], alt = Number.isFinite(o.alt) && o.alt > 0 ? o.alt : flyAltOf(key), r = R + alt * 1e3;
  if (Number.isFinite(mapSys.soi[i]) && r > mapSys.soi[i] / 2) return false;
  const inc = (Number.isFinite(o.inc) ? Math.max(0, Math.min(180, o.inc)) : FLY_INC[key] || 0) * Math.PI / 180, v = Math.sqrt(mapSys.mu[i] / r);
  const F = bodyAxes(key, t, P, V, i, MPAR[i], new Array(9));
  let z = F && Number.isFinite(F[2]) ? unit3([F[2], F[5], F[8]]) : null; if (!z) z = [0, 0, 1];
  const x = unit3([-z[1], z[0], 0]) || [1, 0, 0], y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]; // the ascending node, then 90° on in the equator
  const E = o.E ? { ...o.E } : engPreset('rl10'), sp = engSpecOf(E); if (!sp || sp.error) return false;
  writePref(FLY_LS, PREF_KEYS.flyBody, key);
  return flyEnterState({ t, key, r: x.map(c => c * r), v: [0, 1, 2].map(k => v * (Math.cos(inc) * y[k] + Math.sin(inc) * z[k])), m: sp.m0, eng: { E, tau: 0, auto: true, lock: 'pro' } });
}
const flyLastBody = () => { const k = readPref(FLY_LS, PREF_KEYS.flyBody); return k && flyBodies().includes(k) ? k : 'earth'; };
// The body picker (the start screen's "Kendin uç", the wizard's): the first bodies as buttons (their default altitude),
// the rest in a list, optional altitude and inclination; a pick starts the flight at once (go(key, o) after the caller's
// own closing). The last body used is marked.
function flyPick(el, go) {
  if (!el.dataset.made) {
    const ks = flyBodies(), first = ks.filter(k => FLY_FIRST.includes(k)), rest = ks.filter(k => !FLY_FIRST.includes(k));
    el.innerHTML = '<div class="fly-pick-b">' + first.map(k => '<button type="button" class="start-card fly-b" data-k="' + k + '" data-last="' + esc(_('start.last')) + '"><b>' + esc(_('body.' + k)) + '</b><span>' + esc(_('fly.at', { h: nf0.format(flyAltOf(k)) })) + '</span></button>').join('') + '</div>'
      + '<label class="field fly-other"><span>' + esc(_('fly.other')) + '</span><select><option value="">' + esc(_('fly.otherPick')) + '</option>' + rest.map(k => '<option value="' + k + '">' + esc(_('body.' + k)) + ' · ' + esc(_('fly.at', { h: nf0.format(flyAltOf(k)) })) + '</option>').join('') + '</select></label>'
      + '<details class="fly-opt"><summary>' + esc(_('fly.opt')) + '</summary><div class="grid2"><label class="field"><span>' + esc(_('fly.alt')) + '</span><input type="text" inputmode="decimal" class="fly-alt" placeholder="' + esc(_('fly.def')) + '"></label><label class="field"><span>' + esc(_('fly.inc')) + '</span><input type="text" inputmode="decimal" class="fly-inc" placeholder="' + esc(_('fly.def')) + '"></label></div><p class="fly-err" role="alert" hidden></p></details>';
    const num = s => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : undefined; };
    const pick = k => {
      const o = { alt: num(el.querySelector('.fly-alt').value), inc: num(el.querySelector('.fly-inc').value) }, err = el.querySelector('.fly-err');
      const i = MAPK.indexOf(k), rr = mapSys.R[i] + (o.alt || flyAltOf(k)) * 1e3;
      if ((o.alt != null && !(o.alt > 0)) || (Number.isFinite(mapSys.soi[i]) && rr > mapSys.soi[i] / 2)) { err.hidden = false; err.textContent = _('fly.badAlt', { body: _('body.' + k) }); el.querySelector('.fly-opt').open = true; return; }
      err.hidden = true; go(k, o);
    };
    el.addEventListener('click', e => { const b = e.target.closest('.fly-b'); if (b) pick(b.dataset.k); });
    el.querySelector('.fly-other select').addEventListener('change', e => { if (e.target.value) pick(e.target.value); });
    el.dataset.made = '1';
  }
  const last = flyLastBody();
  for (const b of el.querySelectorAll('.fly-b')) b.classList.toggle('last', b.dataset.k === last);
  el.querySelector('.fly-other select').value = '';
  (el.querySelector('.fly-b.last') || el.querySelector('.fly-b')).focus();
}
function flyExit() {
  flyAppr(false); flyTips(-1);
  FREE.on = false; delete document.documentElement.dataset.fly; flyEl('flyNode').hidden = true; flyEl('flyHelp').hidden = true; flyEl('flyNote').hidden = true;
  flyEngMount(false); engApplyLabel();
  FREE.burn = null; FREE.fire = 0; FREE.pl = 0; FREE.warpTo = null;
  clearPref(FLY_SS, PREF_KEYS.flySnap);
  if (V3 && is3d()) { for (let k = 0; k < FLY_LINES; k++) V3.dynHide('map', 'flyP' + k); V3.dynHide('map', 'flyTrail'); }
  if (FREE.wk) { FREE.wk.terminate(); FREE.wk = null; FREE.wkBusy = false; }
  FREE.drag = null;
  for (const id of FREE.hid) sceneUnhide(id); FREE.hid = [];
  APP.mode = 'mission'; setMap(false); INS = null;
}
// the session's one snapshot: every two seconds and when the page is hidden; a reload comes back to it
function flySave() {
  if (!FREE.on) return;
  const s = FREE.st, e = FREE.eng;
  writePref(FLY_SS, PREF_KEYS.flySnap, JSON.stringify({ t: s.t, r: s.r, v: s.v, m: s.m, warp: FREE.warp, nodes: FREE.nodes, eng: e && { E: e.E, tau: e.tau, auto: e.auto, lock: e.lock }, target: FREE.target >= 0 ? MAPK[FREE.target] : null, at: Date.now() }));
}
addEventListener('pagehide', flySave);
function flyRestore() {
  const q = parseFlySnap(readPref(FLY_SS, PREF_KEYS.flySnap)); if (!q) return false;
  mapSys.P = mapSys.P || new Float64Array(3 * mapSys.N); mapSys.V = mapSys.V || new Float64Array(3 * mapSys.N);
  states(mapSys, q.t, mapSys.P, mapSys.V);
  const b = domBody(mapSys, mapSys.P, q.r[0], q.r[1], q.r[2]);
  return flyEnterState({ t: q.t, key: MAPK[b], r: [0, 1, 2].map(j => q.r[j] - mapSys.P[3 * b + j]), v: [0, 1, 2].map(j => q.v[j] - mapSys.V[3 * b + j]), m: q.m, warp: q.warp, nodes: q.nodes, eng: q.eng, target: q.target });
}
// one frame: advance (real seconds dt × warp), predict (twice a second, at once after an edit), draw the map at the
// flight's time and the craft over it, the nodes, the bar's and the panel's numbers
const FPR = new Float64Array(3);
function flyFrame(dt, v3, glow, now) {
  const s = FREE.st, P = mapSys.P, V = mapSys.V;
  states(mapSys, s.t, P, V);
  const b = domBody(mapSys, P, s.r[0], s.r[1], s.r[2]);
  if (!FREE.paused) flyStep(Math.min(dt, PLAY_DT_MAX), b); // the wall clock's frame time (a low frame rate keeps real time)
  FREE.pl += ((FREE.fire > 0 ? FREE.fire : 0) - FREE.pl) * (reduceMotion ? 1 : 1 - Math.exp(-dt / 0.15)); // the plume's ignition and cut
  flyPast();
  states(mapSys, s.t, P, V);
  if (b !== FREE.tb) { const was = FREE.tb; FREE.tb = b; FREE.tn = 0; FREE.pred = null; if (was >= 0 && !FREE.appr) flyFrameBody(b); flyTgtList(); }
  if (FREE.tn === 0 || now - FREE.trailAt > 40) { // the trail, relative to the dominant body
    const k = FREE.tn % TRAIL_N; for (let j = 0; j < 3; j++) FREE.trail[3 * k + j] = s.r[j] - P[3 * b + j]; FREE.tn++; FREE.trailAt = now;
  }
  if (!FREE.pred || FREE.predDirty || now - FREE.predAt > 500) {
    // the horizon: 30 days, or past the last node; to a body outside the system it is in, the long way there (400 days)
    const far = FREE.target >= 0 && MPAR[FREE.target] !== b, last = FREE.nodes.length ? FREE.nodes[FREE.nodes.length - 1].t - s.t : 0;
    FREE.pred = flyPredict(mapSys, s.t, s.r, s.v, { revs: 1, T: Math.max(0, last) + (far ? 400 : 30) * DAY, K: 120, nodes: FREE.nodes, maxSeg: 10 }); FREE.predAt = now; FREE.predDirty = false;
    FREE.nst = FREE.nodes.map(nd => flyNodeState(FREE.pred, nd.t));
    FREE.tcaDirty = true;
    states(mapSys, s.t, P, V);
  }
  flyRefineAsk(now);
  if (now - FREE.saveAt > 2000) { FREE.saveAt = now; flySave(); }
  MAP.follow = FREE.appr ? null : b;
  flyTca(now);
  if (v3) { flyLines3(b); drawMap3(s.t, glow, null, 0, 0); flyTcaDraw(true); flyMark(b, true); flyNodes(true); }
  else { if (FREE.appr) { flyFollow2(); apprWatch(0); } drawMap(s.t, glow, null, 0, 0); flyLines2(b); flyTcaDraw(false); flyMark(b, false); flyNodes(false); if (!MAP.log) drawScale(); }
  flyBarTick(b);
  flyPanelTick(); flyTgtTick(); flyCorTick(now);
  if (now - (FREE.helpAt || 0) > 500) { FREE.helpAt = now; flyHelpPlace(); }
}
// map coordinates (heliocentric, as the map draws its bodies) of a point relative to body b, after states(mapSys, …)
const flyMapAt = (b, x, y, z, out) => { out[0] = MP[3 * b] - MP[3 * MSUN] + x; out[1] = MP[3 * b + 1] - MP[3 * MSUN + 1] + y; out[2] = MP[3 * b + 2] - MP[3 * MSUN + 2] + z; return out; };
// the screen point (px) of a point relative to body b (after states(mapSys, FREE.st.t, MP, MV)), or null behind the camera
const FSO = [0, 0, 0];
function flyScr(b, x, y, z, v3) {
  flyMapAt(b, x, y, z, FSO);
  if (v3) { mapXYZ(FSO[0], FSO[1], FSO[2], FSO); FPR[0] = FSO[0]; FPR[1] = FSO[1]; FPR[2] = FSO[2]; proj3(FPR, PJ); return PJ[2] > 0 ? [PJ[0], PJ[1], PJ[2]] : null; }
  mapXY(FSO[0], FSO[1], FSO); return [sx(FSO[0]), sy(FSO[1]), 1];
}
// what the path shows now: the N-body refinement of the current nodes when it is back (solid), else the patched-conic
// prediction (dashed and faint while there are nodes: provisional); from the flight's time on
function flyPath() {
  const nn = FREE.nodes.length;
  if (nn && FREE.ref && FREE.ref.ver === FREE.ver && !FREE.drag) return { segs: FREE.ref.segs, prov: false };
  return { segs: FREE.pred ? FREE.pred.segs : [], prov: nn > 0 };
}
// the first index of a segment's points at or after time t
function flyIdx(g, t) { if (g.ts[g.n - 1] < t) return g.n; let lo = 0, hi = g.n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (g.ts[m] < t) lo = m + 1; else hi = m; } return lo; }
const flyAfter = g => FREE.nodes.length > 0 && g.t0 >= FREE.nodes[0].t - 1e-3; // after the first node: the planned orbit
// A segment of the path from time t on as a curve for app.js adaptStroke2 / adaptLine3 (2026-11-21, Phase 20A-3): a
// patched-conic segment by its conic's anomaly (core.js conicGeom / conicArc: exact, any zoom, through the craft), an
// N-body refined one through its samples' velocities (core.js hermAt); null when nothing is left. map(q, out): a point
// relative to the segment's body into the view's coordinates. { n, pos }
function flySegCurve(g, t, map) {
  const ta = Math.max(t, g.t0); if (!(g.t1 > ta)) return null;
  const q = [0, 0, 0];
  if (g.r0 && g.v0) { // a conic
    const cg = g.cg || (g.cg = conicGeom(mapSys.mu[g.b], g.r0, g.v0)); if (!cg) return null;
    const [u0, u1] = conicArc(cg, g.r0, g.v0, g.t0, ta, g.t1), n = conicPieces(cg, u0, u1);
    return { n, pos: (x, out) => map(conicPos(cg, u0 + (u1 - u0) * x / n, q), out) };
  }
  const k0 = Math.max(0, flyIdx(g, ta) - 1); if (g.n - k0 < 2) return null;
  const f0 = Math.max(0, Math.min(1, (ta - g.ts[k0]) / ((g.ts[k0 + 1] - g.ts[k0]) || 1))), N = g.n - 1 - k0, span = N - f0;
  return { n: N, pos: (x, out) => {
    const s = k0 + f0 + span * x / N, i = Math.min(g.n - 2, Math.floor(s)), f = s - i;
    if (g.vs) hermAt(g.pts, g.vs, g.ts, i, f, q); else for (let j = 0; j < 3; j++) q[j] = g.pts[3 * i + j] + (g.pts[3 * i + 3 + j] - g.pts[3 * i + j]) * f;
    return map(q, out);
  } };
}
// 2D: the path's segments (each about its body, drawn where that body is now; adaptive, Phase 20A-3) and the trail
function flyLines2(b) {
  states(mapSys, FREE.st.t, MP, MV);
  const o = [0, 0, 0], line = (pts, k0, n, bb) => { ctx.beginPath(); for (let k = k0; k < n; k++) { flyMapAt(bb, pts[3 * k], pts[3 * k + 1], pts[3 * k + 2], o); mapXY(o[0], o[1], o); const x = sx(o[0]), y = sy(o[1]); k > k0 ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const pa = flyPath(), t = FREE.st.t;
  ctx.setLineDash(pa.prov ? [6, 5] : []); ctx.lineWidth = 1.4;
  for (const g of pa.segs) {
    const cv = flySegCurve(g, t, (q, out) => { flyMapAt(g.b, q[0], q[1], q[2], out); mapXY(out[0], out[1], out); out[2] = 0; return out; });
    if (!cv) continue;
    ctx.strokeStyle = hexA(flyAfter(g) ? COL.cyan : COL.traj, pa.prov ? 0.45 : 0.8); adaptStroke2(cv.n, cv.pos, false);
  }
  ctx.setLineDash([]);
  const n = Math.min(FREE.tn, TRAIL_N); if (n > 1) {
    const T = new Float64Array(3 * n); for (let i = 0; i < n; i++) { const k = (FREE.tn - n + i) % TRAIL_N; T.set(FREE.trail.subarray(3 * k, 3 * k + 3), 3 * i); }
    ctx.strokeStyle = hexA(COL.ink, 0.35); ctx.lineWidth = 1; line(T, 0, n, b);
  }
}
// 3D: the same as lines in the map's set (before the map renders); the provisional path dashed and faint
const FLY3 = { made: false, buf: null, col: null }, FLY_LINES = 8, FLY_CAP = 1400;
function flyLines3(b) {
  if (!V3) return;
  if (!FLY3.made) { for (let k = 0; k < FLY_LINES; k++) V3.dyn('map', 'flyP' + k, FLY_CAP, { color: '#ffffff', opacity: 0.8, width: 1.5, vertexColors: true }); V3.dyn('map', 'flyTrail', TRAIL_N + 2, { color: COL.ink, opacity: 0.35, width: 1 }); FLY3.made = true; FLY3.buf = new Float64Array(3 * Math.max(FLY_CAP, TRAIL_N + 2)); FLY3.col = new Float32Array(3 * FLY_CAP); }
  states(mapSys, FREE.st.t, MP, MV);
  const o = [0, 0, 0], B = FLY3.buf, put = (pts, k0, n, bb, cap = FLY_CAP) => { // at most cap points, evenly thinned, the last one kept
    const step = Math.max(1, Math.ceil((n - 1 - k0) / (cap - 1))); let m = 0;
    for (let k = k0; ; k += step) { if (k > n - 1) k = n - 1; flyMapAt(bb, pts[3 * k], pts[3 * k + 1], pts[3 * k + 2], o); mapXYZ(o[0], o[1], o[2], o); B[3 * m] = o[0]; B[3 * m + 1] = o[1]; B[3 * m + 2] = o[2]; m++; if (k === n - 1) break; }
    return m;
  };
  // the segments: adaptive on screen (app.js adaptLine3, Phase 20A-3); the provisional path dashed by screen length
  const pa = flyPath(), t = FREE.st.t, segs = pa.segs.filter(g => g.t1 > t);
  for (let k = 0; k < FLY_LINES; k++) {
    const g = segs[k], cv = g && flySegCurve(g, t, (q, out) => { flyMapAt(g.b, q[0], q[1], q[2], out); return mapXYZ(out[0], out[1], out[2], out); });
    if (!cv) { V3.dynHide('map', 'flyP' + k); continue; }
    const ao = curveAdapt(cv.n, cv.pos, SCR3, adaptOpt(), ADP.o3), m = ao.m;
    if (m < 2) { V3.dynHide('map', 'flyP' + k); continue; }
    const c = linRGB(flyAfter(g) ? COL.cyan : COL.traj);
    if (FLY3.col.length < 3 * m) FLY3.col = new Float32Array(6 * m);
    for (let i = 0; i < m; i++) FLY3.col.set(c, 3 * i);
    let cap = FLY_CAP; while (cap < m) cap *= 2;
    V3.dyn('map', 'flyP' + k, cap, { color: '#ffffff', opacity: 0.8, width: 1.5, vertexColors: true }); V3.dynOpacity('map', 'flyP' + k, pa.prov ? 0.45 : 0.85);
    V3.dynSet('map', 'flyP' + k, ao.p, m, FLY3.col, pa.prov ? flyDash(ao) : 0, CB.e);
  }
  const n = Math.min(FREE.tn, TRAIL_N);
  if (n > 1) { const T = new Float64Array(3 * n); for (let i = 0; i < n; i++) { const k = (FREE.tn - n + i) % TRAIL_N; T.set(FREE.trail.subarray(3 * k, 3 * k + 3), 3 * i); } V3.dynSet('map', 'flyTrail', B, put(T, 0, n, b, TRAIL_N + 2), null); }
  else V3.dynHide('map', 'flyTrail');
}
// an adaptive line's dashes by screen length (6 px on, 5 off, as in 2D): per-segment gap flags for view3d.js dynSet
const FLY_DASH = { f: new Uint8Array(1024) };
function flyDash(o) {
  if (FLY_DASH.f.length < o.m) FLY_DASH.f = new Uint8Array(2 * o.m);
  let L = 0; const s = o.s;
  for (let j = 0; j + 1 < o.m; j++) { const d = Math.hypot(s[2 * j + 2] - s[2 * j], s[2 * j + 3] - s[2 * j + 1]); if (!Number.isFinite(d)) { FLY_DASH.f[j] = 0; continue; } FLY_DASH.f[j] = (L + d / 2) % 11 > 6 ? 1 : 0; L += d; }
  return FLY_DASH.f;
}
// the craft's marker (2D: map coordinates; 3D: projected after the map's camera is set)
function flyMark(b, v3) {
  const s = FREE.st, o = [0, 0, 0];
  states(mapSys, s.t, MP, MV);
  flyMapAt(MSUN, s.r[0] - MP[3 * MSUN], s.r[1] - MP[3 * MSUN + 1], s.r[2] - MP[3 * MSUN + 2], o);
  let x, y;
  if (v3) { mapXYZ(o[0], o[1], o[2], o); FPR[0] = o[0]; FPR[1] = o[1]; FPR[2] = o[2]; proj3(FPR, PJ); if (!(PJ[2] > 0)) return; x = PJ[0]; y = PJ[1]; }
  else { mapXY(o[0], o[1], o); x = sx(o[0]); y = sy(o[1]); }
  const lpx = FREE.lpx || 0; // the 3D model's length on screen (flyCraft3): the marker gives way to it
  if (lpx < 14) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = FREE.fire > 0 ? COL.burn : COL.traj; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.stroke();
  }
  FREE.cx = x; FREE.cy = y;
  addHit('c', 0, x, y, Math.max(3.2, lpx / 2));
}

// ----- maneuver nodes (Phase 19c) -----
// a node's state before its burn ({ b, r, v } relative to the body), from the patched-conic segments
const FRV = new Float64Array(6);
function flyNodeState(pred, t) {
  for (const g of pred.segs) if (t >= g.t0 - 1e-6 && t <= g.t1 + 1e-6) { uniStep(mapSys.mu[g.b], g.r0, g.v0, t - g.t0, FRV); return { b: g.b, r: [FRV[0], FRV[1], FRV[2]], v: [FRV[3], FRV[4], FRV[5]] }; }
  return null;
}
// the orbit after node i (the segment starting at its moment): { pe, ap } altitudes, or { vinf } on an escape, or null
function flyAfterOrbit(i) {
  const nd = FREE.nodes[i], g = FREE.pred && FREE.pred.segs.find(q => Math.abs(q.t0 - nd.t) < 1e-3);
  if (!g) return null;
  const R = mapSys.R[g.b], mu = mapSys.mu[g.b], el = g.el;
  if (g.end === 'impact' && el.e < 1 && el.a * (1 - el.e) < R) return { impact: true, b: g.b };
  if (el.e < 1 && el.a > 0) return { b: g.b, pe: el.a * (1 - el.e) - R, ap: el.a * (1 + el.e) - R };
  return { b: g.b, vinf: Math.sqrt(mu / Math.abs(el.a)) };
}
// the handles' colours by component: prograde, radial, normal
const FLY_HC = () => [COL.traj, COL.cyan, COL.good];
const FLY_HL = 46, FLY_HR = 7;
// the node marks, and the selected node's six handles (screen directions of its frame's axes; one that projects to
// almost nothing gets a fixed direction so it can still be grabbed)
function flyNodes(v3) {
  FREE.hnd = []; FREE.nmk = [];
  if (!FREE.nodes.length || !FREE.pred) return;
  states(mapSys, FREE.st.t, MP, MV);
  FREE.nodes.forEach((nd, i) => {
    const q = FREE.nst[i]; if (!q) return;
    const P = flyScr(q.b, q.r[0], q.r[1], q.r[2], v3); if (!P) return;
    const sel = i === FREE.sel, x = P[0], y = P[1];
    FREE.nmk.push({ x, y, i });
    if (sel) {
      const F = nodeFrame(q.r, q.v), dep = v3 ? P[2] : 1, del = v3 ? dep * 0.04 : 30 / cam.scale, axes = [F.pro, F.rad, F.nor], dirs = [];
      for (let k = 0; k < 3; k++) {
        const a = axes[k], Q = flyScr(q.b, q.r[0] + a[0] * del, q.r[1] + a[1] * del, q.r[2] + a[2] * del, v3);
        let ux = Q ? Q[0] - x : 0, uy = Q ? Q[1] - y : 0; const l = Math.hypot(ux, uy);
        dirs.push(l > (v3 ? 4 : 8) ? [ux / l, uy / l] : null);
      }
      // a direction lost in the projection: across the prograde one on screen (normal), or the screen's up
      for (let k = 0; k < 3; k++) if (!dirs[k]) { const p = dirs[0] || [1, 0]; dirs[k] = k === 2 ? [-p[1], p[0]] : k === 1 ? [p[1], -p[0]] : [0, -1]; }
      const C3 = FLY_HC();
      for (let k = 0; k < 3; k++) for (const sg of [1, -1]) {
        const ux = dirs[k][0] * sg, uy = dirs[k][1] * sg, hx = x + ux * FLY_HL, hy = y + uy * FLY_HL;
        ctx.strokeStyle = hexA(C3[k], 0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + ux * 9, y + uy * 9); ctx.lineTo(hx - ux * FLY_HR, hy - uy * FLY_HR); ctx.stroke();
        ctx.beginPath(); ctx.arc(hx, hy, FLY_HR, 0, 6.2832);
        if (sg > 0) { ctx.fillStyle = C3[k]; ctx.fill(); } else { ctx.fillStyle = hexA(COL.void, 0.85); ctx.fill(); ctx.strokeStyle = C3[k]; ctx.lineWidth = 1.6; ctx.stroke(); }
        FREE.hnd.push({ x: hx, y: hy, k, s: sg, ux, uy });
      }
    }
    // the mark: a diamond, filled when selected
    const r = sel ? 6.5 : 5;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    ctx.fillStyle = sel ? COL.cyan : hexA(COL.void, 0.85); ctx.fill(); ctx.strokeStyle = COL.cyan; ctx.lineWidth = 1.5; ctx.stroke();
  });
}
// a change to the nodes: the state before it goes on the undo stack; the prediction is redone at once, the refinement
// asked again after FLY_REF_MS
function flyEdit() { FREE.undo.push(JSON.stringify({ nodes: FREE.nodes, sel: FREE.sel })); if (FREE.undo.length > FLY_UNDO) FREE.undo.shift(); }
function flyChanged() { FREE.ver++; FREE.editAt = performance.now(); FREE.predDirty = true; flyPanel(); }
function flyUndo() {
  const u = FREE.undo.pop(); if (!u) return;
  const o = JSON.parse(u); FREE.nodes = o.nodes.filter(nd => nd.t > FREE.st.t); FREE.sel = Math.min(o.sel, FREE.nodes.length - 1); flyChanged();
}
function flyDel(i = FREE.sel) { if (i < 0 || i >= FREE.nodes.length) return; flyEdit(); FREE.nodes.splice(i, 1); FREE.sel = Math.min(i, FREE.nodes.length - 1); flyChanged(); }
// nodes the flight has passed go (19d fires them with the engine)
function flyPast() {
  const t = FREE.st.t, n = FREE.nodes.length; if (!n || FREE.nodes[0].t > t) return;
  const keep = FREE.burn ? FREE.burn.t : NaN; // the node being fired stays until its burn ends
  if (FREE.nodes.every(nd => nd.t > t || nd.t === keep)) return;
  FREE.nodes = FREE.nodes.filter(nd => nd.t > t || nd.t === keep); FREE.sel = Math.min(FREE.sel, FREE.nodes.length - 1); if (FREE.sel < 0 && FREE.nodes.length) FREE.sel = 0;
  flyChanged();
}
// a time on the path under a screen point (within r px): the patched prediction's points, projected; null when none
function flyPathAt(px, py, r, pred = FREE.pred, lo = -Infinity, hi = Infinity) {
  if (!pred) return null;
  const v3 = is3d(), t = FREE.st.t; let best = null;
  states(mapSys, t, MP, MV);
  for (const g of pred.segs) {
    let q = null;
    const step = Math.max(1, Math.floor(g.n / 600));
    for (let k = 0; k < g.n; k += step) {
      const P = flyScr(g.b, g.pts[3 * k], g.pts[3 * k + 1], g.pts[3 * k + 2], v3);
      if (P && q) {
        const dx = P[0] - q[0], dy = P[1] - q[1], l2 = dx * dx + dy * dy, f = l2 > 0 ? Math.max(0, Math.min(1, ((px - q[0]) * dx + (py - q[1]) * dy) / l2)) : 0, d = Math.hypot(q[0] + f * dx - px, q[1] + f * dy - py);
        const tk = g.ts[q[2]] + f * (g.ts[k] - g.ts[q[2]]);
        if (d < r && tk >= lo && tk <= hi && (!best || d < best.d)) best = { d, t: tk };
      }
      q = P ? [P[0], P[1], k] : null;
    }
  }
  return best && best.t > t + 1 ? best.t : null;
}
// a tap in free flight (app.js tap calls this first): a node's mark selects it, the path takes a new node
function flyTap(x, y, touch) {
  if (!FREE.on) return false;
  if (performance.now() - (FREE.moveEnd || 0) < 120) return true; // the end of a node's slide along the orbit
  const rr = touch ? 16 : 10;
  if (Math.hypot((FREE.cx || -1e9) - x, (FREE.cy || -1e9) - y) < Math.max(rr, (FREE.lpx || 0) / 2)) return false; // the craft: the app's (a double tap comes close)
  if (FREE.appr) return false; // up close the path is not for placing nodes
  for (const m of FREE.nmk) if (Math.hypot(m.x - x, m.y - y) < rr) { FREE.sel = m.i; flyPanel(); return true; }
  if (FREE.nodes.length >= FLY_NODES_MAX) return false;
  const t = flyPathAt(x, y, touch ? 18 : 9); if (t == null) return false;
  flyEdit(); FREE.nodes.push({ t, d: [0, 0, 0] }); FREE.nodes.sort((a, b) => a.t - b.t); FREE.sel = FREE.nodes.findIndex(nd => nd.t === t); flyChanged();
  flyTipDid(1);
  return true;
}
// dragging a handle (on the stage, before the camera's own pointer handling): along itself, faster the further (Shift:
// ten times finer); one undo step per drag
function flyDragAt(e) { const r = flyEl('cv').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
flyEl('stage').addEventListener('pointerdown', e => {
  if (!FREE.on || FREE.sel < 0 || e.button) return;
  const [x, y] = flyDragAt(e), rr = e.pointerType === 'touch' ? 18 : 11, h = FREE.hnd.find(q => Math.hypot(q.x - x, q.y - y) < rr); if (!h) return;
  e.stopImmediatePropagation(); e.preventDefault();
  flyEdit(); FREE.drag = { ...h, x0: x, y0: y, d0: [...FREE.nodes[FREE.sel].d], id: e.pointerId };
  try { flyEl('stage').setPointerCapture(e.pointerId); } catch (err) { /* no capture */ }
}, true);
// Sliding a node along the orbit (2026-11-16): its mark pressed and moved (past TAP_PX) follows the path under the
// pointer: the node's time changes, its Δv components stay; the path is the prediction without this node and the ones
// after it (what the craft flies up to the node), the new time kept between the nodes before and after it; the
// prediction is redone every frame while it moves (dashed, the refinement after the release); one undo step. A press
// that does not move stays a tap (it selects the node).
flyEl('stage').addEventListener('pointerdown', e => {
  if (!FREE.on || e.button || FREE.drag || FREE.appr) return;
  const [x, y] = flyDragAt(e), rr = e.pointerType === 'touch' ? 16 : 10, m = FREE.nmk.find(q => Math.hypot(q.x - x, q.y - y) < rr);
  FREE.mdown = m ? { i: m.i, x0: x, y0: y, id: e.pointerId, touch: e.pointerType !== 'mouse' } : null;
}, true);
function flyMoveStart(D) {
  const i = D.i, nd = FREE.nodes[i]; if (!nd) return false;
  flyEdit(); FREE.sel = i; flyPanel();
  const s = FREE.st, before = FREE.nodes.slice(0, i), last = FREE.nodes.length ? FREE.nodes[FREE.nodes.length - 1].t - s.t : 0;
  const far = FREE.target >= 0 && MPAR[FREE.target] !== FREE.tb;
  FREE.drag = { move: true, i, id: D.id, touch: D.touch, lo: Math.max(s.t + 1, i > 0 ? FREE.nodes[i - 1].t + 1 : -Infinity), hi: i < FREE.nodes.length - 1 ? FREE.nodes[i + 1].t - 1 : Infinity,
    base: flyPredict(mapSys, s.t, s.r, s.v, { revs: 1, T: Math.max(0, last) + (far ? 400 : 30) * DAY, K: 160, nodes: before, maxSeg: 10 }) };
  return true;
}
function flyMoveTo(x, y) {
  const D = FREE.drag, nd = FREE.nodes[D.i]; if (!nd) return;
  // near the node's time first (an orbit seen edge on passes under the pointer twice), else anywhere on the path
  const g0 = D.base.segs.find(q => nd.t >= q.t0 && nd.t <= q.t1) || D.base.segs[0], el = g0 && g0.el;
  const P = el && el.e < 1 && el.a > 0 ? 2 * Math.PI * Math.sqrt(el.a ** 3 / mapSys.mu[g0.b]) : g0 ? g0.t1 - g0.t0 : Infinity, r = D.touch ? 90 : 70;
  let t = flyPathAt(x, y, r, D.base, nd.t - P / 4, nd.t + P / 4); if (t == null) t = flyPathAt(x, y, r, D.base); if (t == null) return;
  const tt = Math.max(D.lo, Math.min(D.hi, t)); if (Math.abs(tt - nd.t) < 1e-3) return;
  nd.t = tt; flyChanged();
}
const flyDv = (p, fine) => (fine ? 0.1 : 1) * p * (1 + Math.abs(p) / 120); // m/s for p px along the handle
addEventListener('pointermove', e => {
  const M = FREE.mdown;
  if (M && !FREE.drag && e.pointerId === M.id) {
    const [x, y] = flyDragAt(e);
    if (Math.hypot(x - M.x0, y - M.y0) < (M.touch ? 10 : 5)) return;
    FREE.mdown = null; if (!flyMoveStart(M)) return;
  }
  const D = FREE.drag; if (!D || e.pointerId !== D.id) return;
  e.stopImmediatePropagation();
  if (D.move) { const [x, y] = flyDragAt(e); flyMoveTo(x, y); return; }
  const [x, y] = flyDragAt(e), p = (x - D.x0) * D.ux + (y - D.y0) * D.uy, nd = FREE.nodes[FREE.sel]; if (!nd) return;
  nd.d[D.k] = Math.round((D.d0[D.k] + D.s * flyDv(p, e.shiftKey)) * 10) / 10;
  flyChanged();
}, true);
const flyDragEnd = e => {
  if (FREE.mdown && e.pointerId === FREE.mdown.id) FREE.mdown = null;
  if (!FREE.drag || e.pointerId !== FREE.drag.id) return;
  const mv = FREE.drag.move; FREE.drag = null; FREE.editAt = performance.now();
  if (mv) { FREE.moveEnd = performance.now(); flyChanged(); return; } // the app's own pointer bookkeeping still runs (its tap is swallowed)
  e.stopImmediatePropagation(); flyTipDid(2);
};
addEventListener('pointerup', flyDragEnd, true); addEventListener('pointercancel', flyDragEnd, true);
// the N-body refinement of the current nodes, in a worker of its own (a newer edit drops a run still going)
function flyRefineAsk(now) {
  if (!FREE.nodes.length || FREE.drag || FREE.refVer === FREE.ver || now - FREE.editAt < FLY_REF_MS || !FREE.pred || !FREE.pred.segs.length) return;
  if (FREE.wkBusy && FREE.wk) { FREE.wk.terminate(); FREE.wk = null; }
  if (!FREE.wk) {
    try { FREE.wk = makeWorker(); } catch (err) { FREE.wk = null; return; }
    FREE.wk.onmessage = e => { FREE.wkBusy = false; const d = e.data; if (d.done && d.ver === FREE.ver) FREE.ref = { ver: d.ver, segs: d.done.segs }; };
    FREE.wk.onerror = () => { FREE.wkBusy = false; if (FREE.wk) FREE.wk.terminate(); FREE.wk = null; };
  }
  const s = FREE.st, segs = FREE.pred.segs;
  FREE.refVer = FREE.ver; FREE.wkBusy = true;
  FREE.wk.postMessage({ list: mapList(), fly: { ver: FREE.ver, t0: s.t, r: [...s.r], v: [...s.v], opt: { nodes: FREE.nodes, until: segs[segs.length - 1].t1, K: 120 } } });
}
// ----- the node panel -----
const FN_IN = ['fnPro', 'fnRad', 'fnNor'];
function flyPanel() {
  const n = FREE.nodes.length, sel = FREE.sel, has = sel >= 0 && sel < n;
  flyEl('fnHint').hidden = has; flyEl('fnBody').hidden = !has;
  flyEl('fnUndo').disabled = !FREE.undo.length; flyEl('fnDel').disabled = !has;
  if (!has) { FREE.txt.fnHint = null; return; }
  const nd = FREE.nodes[sel];
  flyTxt('fnTitle', _('fn.title', { i: sel + 1, n }));
  FN_IN.forEach((id, k) => { const el = flyEl(id); if (document.activeElement !== el) el.value = String(nd.d[k]); });
  flyEl('fnPrev').disabled = sel <= 0; flyEl('fnNext').disabled = sel >= n - 1;
}
const NFdv = new Intl.NumberFormat(DICT['meta.locale'] || 'tr', { maximumFractionDigits: 1 });
// the panel folds to its one line (the selected node, or the target, or its name); a phone starts folded
function flyFold(on) { flyEl('flyNode').classList.toggle('fold', on); flyEl('fnTop').setAttribute('aria-expanded', String(!on)); INS = null; }
flyEl('fnTop').addEventListener('click', () => flyFold(!flyEl('flyNode').classList.contains('fold')));
function flyPanelTick() {
  const n = FREE.nodes.length, sel = FREE.sel, A = FREE.att;
  flyTxt('fnAtt', A && A.want && !A.ok ? _('fn.att', { a: Math.round(A.err * 180 / Math.PI) }) : '');
  flyTxt('fnSum', sel >= 0 && sel < n ? _('fn.sum', { title: _('fn.title', { i: sel + 1, n }), dv: NFdv.format(Math.hypot(...FREE.nodes[sel].d)), t: fmtIn(Math.max(0, FREE.nodes[sel].t - FREE.st.t)) })
    : FREE.target >= 0 ? _('fn.sumTgt', { body: _('body.' + MAPK[FREE.target]) }) : _('fn.sumNone'));
  if (sel < 0 || sel >= n) { flyTxt('fnHint', _(FREE.nodes.length ? 'fn.pick' : 'fn.hint')); return; }
  const nd = FREE.nodes[sel], dv = Math.hypot(...nd.d);
  flyTxt('fnIn', _('fn.in', { t: fmtDur(Math.max(0, nd.t - FREE.st.t), true) }));
  flyTxt('fnTot', _('fn.tot', { dv: NFdv.format(dv) }));
  const o = flyAfterOrbit(sel);
  flyTxt('fnAfter', !o ? '' : o.impact ? _('fn.impact', { body: _('body.' + MAPK[o.b]) }) : o.vinf != null ? _('fn.escape', { body: _('body.' + MAPK[o.b]), v: fmtSpeed(o.vinf) }) : _('fn.orbit', { body: _('body.' + MAPK[o.b]), pe: fmtDist(o.pe), ap: fmtDist(o.ap) }));
  flyTxt('fnProv', flyPath().prov ? _('fn.prov') : '');
  // the budget: this node's burn and propellant; a warning when all the nodes need more than is left
  const e = FREE.eng; if (!e) return;
  const b = flyBurnOf(dv), all = FREE.nodes.reduce((a, q) => a + Math.hypot(...q.d), 0), left = flyDvLeft();
  flyTxt('fnBurn', b ? _('fn.burn', { t: fmtIn(b.T), kg: NFdv.format(b.mp) }) : '');
  const short = all > left + 0.05;
  flyTxt('fnWarn', short ? _('fn.short', { need: NFdv.format(all), left: NFdv.format(left) }) : '');
}
FN_IN.forEach((id, k) => {
  flyEl(id).addEventListener('focus', () => { FREE.fieldUndo = false; });
  flyEl(id).addEventListener('input', e => {
    const nd = FREE.nodes[FREE.sel], v = parseFloat(String(e.target.value).replace(',', '.')); if (!nd || !Number.isFinite(v)) return;
    if (!FREE.fieldUndo) { flyEdit(); FREE.fieldUndo = true; } // one undo step per field visit
    nd.d[k] = Math.max(-1e5, Math.min(1e5, v)); flyChanged();
  });
});
// ----- the engine (Phase 19d) -----
// the engine at the start of the flight: restored from the snapshot, else the mission's at this moment, else the craft's
function flyEngInit(q) {
  let E = null, s = null, tau = 0, auto = true, lock = 'pro';
  if (q.eng && q.eng.E) { E = q.eng.E; s = engSpecOf(E); tau = +q.eng.tau || 0; auto = q.eng.auto !== false; lock = FLY_LOCKS.includes(q.eng.lock) ? q.eng.lock : 'pro'; }
  else if (C && simR) { const en = engNow(tNowG); E = en.E; s = en.s; tau = Math.min(en.tau, s ? s.tb : 0); }
  if (!s || s.error) { E = engCraftE(); s = engSpecOf(E); tau = 0; }
  if (!s || s.error) { E = ENG_DEF; s = engSpecOf(ENG_DEF); tau = 0; }
  if (!q.eng) { const u = engUsed(s, Math.min(tau, s.tb)); FREE.st.m = s.md + Math.max(0, s.mp - u.fuel - u.ox); } // the mass of what is left
  FREE.eng = { E, s, tau: Math.max(0, Math.min(s.tb, tau)), thr: 0, auto, lock };
  FREE.burn = null; FREE.fire = 0; FREE.pl = 0; FREE.warpTo = null; FREE.cap = Infinity;
  flyEl('fnAuto').checked = auto; flyLockSync();
}
const FLY_LOCKS = ['pro', 'retro', 'radOut', 'radIn', 'nor', 'anti'];
const flyDvLeft = () => { const e = FREE.eng; return e ? e.s.ve * Math.log(Math.max(FREE.st.m, e.s.md) / e.s.md) : 0; };
// a burn of Δv dv at full thrust from the mass now: its length T (s) and propellant mp (kg); null when there is no engine
function flyBurnOf(dv) {
  const e = FREE.eng; if (!e) return null;
  const m = FREE.st.m, mp = m * (1 - Math.exp(-dv / e.s.ve)), F = engAt(e.s, Math.min(e.tau, e.s.tb * (1 - 1e-9))).F || e.s.F;
  return { T: mp * e.s.ve / F, mp };
}
// the next node's burn under "Otomatik ateşle": its start, the inertial direction and size of its Δv, its length
function flyNextBurn() {
  const e = FREE.eng; if (!e || !e.auto || !FREE.nodes.length || !FREE.nst[0]) return null;
  const nd = FREE.nodes[0], q = FREE.nst[0], dvI = nodeDv(q.r, q.v, nd.d), dv = Math.hypot(...dvI);
  if (!(dv > 0.01)) return null;
  const b = flyBurnOf(dv), mu = mapSys.mu[q.b], va = q.v.map((x, k) => x + dvI[k]);
  // a mostly prograde (or retrograde) burn is cut on the orbit's energy after the node, not on its Δv: a long burn spread
  // over the orbit loses some of it to gravity (2026-11-15: from a low orbit a 9-minute translunar burn fell short)
  const vh = Math.hypot(...q.v), along = Math.abs(dvI[0] * q.v[0] + dvI[1] * q.v[1] + dvI[2] * q.v[2]) / (vh * dv);
  const E = along > 0.5 ? (va[0] ** 2 + va[1] ** 2 + va[2] ** 2) / 2 - mu / Math.hypot(...q.r) : null;
  return { t: nd.t, start: nd.t - b.T / 2, T: b.T, dir: dvI.map(x => x / dv), dv, b: q.b, E, up: E != null && E > (vh * vh) / 2 - mu / Math.hypot(...q.r) };
}
// ----- the attitude (2026-11-16) -----
// The pace of a turn (2026-11-17): a 180° turn takes flySlewT() s of game time (so 10× warp turns ten times as fast; the
// burn's warp cap is its own): 3 s for a small probe up to 4 s for a heavy stage (by mass, 300 kg … 30 t, in its
// logarithm), 1 s with "Hızlı dönüş" (#fnFast, PREF_KEYS.flyFast; off by default). core.js slewParams makes the profile.
const FLY_LS = (() => { try { return window.localStorage; } catch (e) { return null; } })(); // its own (app.js's LS loads later)
FREE.fast = readPref(FLY_LS, PREF_KEYS.flyFast) === '1';
const flySlewT = () => (FREE.fast ? 1 : 3 + Math.max(0, Math.min(1, Math.log10(Math.max(1, FREE.st ? FREE.st.m : 1000) / 300) / 2)));
const FLY_SLEW = { T: 0, p: null };
function flySlew() { const T = Math.round(flySlewT() * 100) / 100; if (FLY_SLEW.T !== T) { FLY_SLEW.T = T; FLY_SLEW.p = slewParams(T); } return FLY_SLEW.p; }
flyEl('fnFast').checked = FREE.fast;
flyEl('fnFast').addEventListener('change', e => { FREE.fast = e.target.checked; writePref(FLY_LS, PREF_KEYS.flyFast, FREE.fast ? '1' : '0'); });
// The nose turns at a finite rate (core.js slewStep: at most w, speeding up and braking at a, in game time;
// at a high warp it arrives at once) towards: an auto burn's direction while it fires, and ahead of its start by the
// turn's time (core.js slewTime) and FLY_LEAD; else the locked direction (prograde, retrograde, …) about the dominant
// body. The main engine fires only once the nose is within FLY_ALIGN of where it should push ("Yönleniyor… 37°" until
// then; an auto burn waits too). Holding a direction, its own turn rate is fed forward (core.js slewStep: a locked
// prograde turns with the orbit by itself, no RCS inside the 1.5° dead band, a short correction past it). The RCS puffs
// (nose and tail quads, js/view3d.js) follow the turn's angular acceleration: a pair starts the turn, the opposite pair
// stops it; none are shown above FLY_RCS_WARP.
const FLY_ALIGN = 5 * Math.PI / 180, FLY_LEAD = 3, FLY_RCS_WARP = 20;
const flyAng = (p, q) => Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
function flyLockDir(b) {
  const s = FREE.st, P = mapSys.P, V = mapSys.V, e = FREE.eng, lock = e ? e.lock : 'pro';
  const F = nodeFrame([s.r[0] - P[3 * b], s.r[1] - P[3 * b + 1], s.r[2] - P[3 * b + 2]], [s.v[0] - V[3 * b], s.v[1] - V[3 * b + 1], s.v[2] - V[3 * b + 2]]);
  return lock === 'retro' ? F.pro.map(x => -x) : lock === 'radOut' ? F.rad : lock === 'radIn' ? F.rad.map(x => -x) : lock === 'nor' ? F.nor : lock === 'anti' ? F.nor.map(x => -x) : F.pro;
}
// one step of dtg game seconds; nb: the next auto burn (not yet started)
function flyAttStep(dtg, b, nb) {
  const A = FREE.att, e = FREE.eng; if (!A) return;
  let d, want, key; // key: what is held (a change starts its turn rate afresh)
  if (FREE.burn) { d = FREE.burn.dir; want = true; key = 'b' + FREE.burn.t; }
  else if (nb && nb.start - FREE.st.t <= slewTime(flyAng(A.n, nb.dir), flySlew()) + FLY_LEAD) { d = nb.dir; want = true; key = 'n' + nb.t; } // turning ahead of the burn
  else { d = flyLockDir(b); want = !!(e && e.thr > 0); key = 'l' + (e ? e.lock : 'pro') + b; }
  A.acc = slewStep(A, d, dtg, key, FREE.st.t, flySlew());
  A.err = flyAng(A.n, d); A.ok = A.err < FLY_ALIGN; A.want = want;
}
// the RCS puffs this frame (real seconds dt): their strength (pulsed) and the angular acceleration's axis (inertial)
function flyRcs(dt) {
  const A = FREE.att; if (!A) return null;
  const k = Math.abs(A.acc) > 0.15 && FREE.warp <= FLY_RCS_WARP ? Math.min(1, Math.abs(A.acc)) : 0; // none shown at a high warp
  A.puff += (k - A.puff) * (reduceMotion ? 1 : 1 - Math.exp(-dt / 0.06));
  if (k > 0 && A.u) A.pu = A.u.map(x => x * Math.sign(A.acc));
  if (!(A.puff > 0.02) || !A.pu) return null;
  const tt = performance.now() / 1000, pulse = reduceMotion ? 1 : 0.55 + 0.45 * Math.max(0, Math.sin(tt * 2 * Math.PI * 6));
  return { a: A.pu, k: A.puff * pulse };
}
// the craft's orbital energy about body b now (after states(mapSys, FREE.st.t, …))
function flyEnergy(b) { const s = FREE.st, P = mapSys.P, V = mapSys.V, r = Math.hypot(s.r[0] - P[3 * b], s.r[1] - P[3 * b + 1], s.r[2] - P[3 * b + 2]), v = [0, 1, 2].map(j => s.v[j] - V[3 * b + j]); return { E: (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - mapSys.mu[b] / r, v }; }
// one frame of flight (dt real seconds): the warp, an auto burn's start never stepped over and its end exactly, the
// throttle by hand, "Düğüme hızlandır"; then core.js flyAdvance (in the field while the engine fires, else on rails
// above RAILS_W)
function flyStep(dt, b) {
  if (FREE.burn && !FREE.nodes.some(nd => nd.t === FREE.burn.t)) flyBurnEnd(false); // its node deleted (or undone): the burn stops
  const s = FREE.st, e = FREE.eng, nb = !FREE.burn ? flyNextBurn() : null;
  // the warp to a node: as fast as leaves room to slow down, then real time a little before the burn
  if (FREE.warpTo != null) {
    const rem = FREE.warpTo - s.t;
    if (rem <= 0.05) { FREE.warpTo = null; flyWarp(1, true); if (FREE.flow && FREE.flow.placed) FREE.flow.warped = true; }
    else { let w = 1; for (const q of FLY_WARPS) if (q * 0.1 <= rem / 3) w = q; if (w !== FREE.warp) flyWarp(w, true); }
  }
  // an auto burn starts
  if (nb && s.t >= nb.start - 1e-6) { FREE.burn = { t: nb.t, dir: nb.dir, goal: nb.dv, m0: s.m, T: nb.T, b: nb.b, E: nb.E, up: nb.up }; flyChanged(); }
  flyAttStep(dt * FREE.warp, b, FREE.burn ? null : nb);
  const th = flyThrust(b);
  FREE.cap = th || FREE.burn ? (FREE.burn ? flyWarpMax(FREE.burn.T) : 10) : Infinity;
  if (FREE.warp > FREE.cap) flyWarp(FREE.cap, true);
  flyBarCap();
  let adv = dt * FREE.warp;
  if (!th && nb && nb.start > s.t) adv = Math.min(adv, nb.start - s.t); // never over a burn's start
  if (FREE.warpTo != null) adv = Math.min(adv, Math.max(0, FREE.warpTo - s.t));
  if (th && FREE.burn) { // the burn's end: exactly its Δv, or (energy cut) the energy after the node, its rate dE/dt = v·F/m
    const B = FREE.burn;
    if (B.E != null) {
      states(mapSys, s.t, mapSys.P, mapSys.V); const q = flyEnergy(B.b), rate = (q.v[0] * B.dir[0] + q.v[1] * B.dir[1] + q.v[2] * B.dir[2]) * th.F / s.m;
      if (Math.abs(rate) > 1e-9) adv = Math.min(adv, Math.max(1e-3, (B.E - q.E) / rate));
      const lim = 1.5 * B.goal - e.s.ve * Math.log(B.m0 / s.m); adv = Math.min(adv, Math.max(1e-3, s.m * (1 - Math.exp(-Math.max(0, lim) / e.s.ve)) / th.mdot));
    } else {
      const rem = B.goal - e.s.ve * Math.log(B.m0 / s.m), tr = s.m * (1 - Math.exp(-Math.max(0, rem) / e.s.ve)) / th.mdot;
      adv = Math.min(adv, tr);
    }
  }
  if (!(adv > 0)) { FREE.fire = th ? FREE.fire : 0; if (FREE.burn) flyBurnEnd(false); return; }
  const m0 = s.m, r = flyAdvance(mapSys, s, adv, { rails: !th && FREE.warp >= RAILS_W, thrust: th, maxSteps: 4000 });
  FREE.fire = th ? th.k : 0; FREE.fq = th ? th.fq : FREE.fq; FREE.fdir = th ? FREE.fdirNow : null;
  if (th) e.tau = Math.min(e.s.tb, e.tau + (m0 - s.m) / e.s.mdot); // the engine's clock by the propellant it used
  if (FREE.burn) {
    const B = FREE.burn, got = e.s.ve * Math.log(B.m0 / s.m);
    let done = r.out;
    if (B.E != null) { states(mapSys, s.t, mapSys.P, mapSys.V); const q = flyEnergy(B.b); done = done || (B.up ? q.E >= B.E - 1e-3 : q.E <= B.E + 1e-3) || got >= 1.5 * B.goal - 1e-3; }
    else done = done || B.goal - got < 1e-3;
    if (done) flyBurnEnd(r.out);
  }
  else if (th && r.out) { e.thr = 0; flyLockSync(); }
}
function flyBurnEnd(out) {
  const t = FREE.burn.t; FREE.burn = null; FREE.fire = 0;
  if (FREE.flow && FREE.flow.placed && FREE.flow.warped) FREE.flow.fired = true;
  if (FREE.target >= 0) { FREE.corAuto = { at: performance.now() + 1500, after: performance.now(), from: FREE.st.t, mid: false }; FREE.cor = null; FREE.tcaDirty = true; } // a correction suggested once the path settles, and again ~30 % of the way
  const i = FREE.nodes.findIndex(nd => nd.t === t); if (i >= 0) { FREE.nodes.splice(i, 1); FREE.sel = Math.min(FREE.sel, FREE.nodes.length - 1); if (FREE.sel < 0 && FREE.nodes.length) FREE.sel = 0; }
  if (out) FREE.eng.thr = 0;
  flyChanged();
}
// the thrust for this frame ({ F, mdot, dir, mDry, k (throttle) } for flyAdvance) or null: an auto burn along its node's
// Δv, else the throttle by hand along the locked direction about the dominant body b
function flyThrust(b) {
  const e = FREE.eng, s = FREE.st; if (!e || s.m <= e.s.md * (1 + 1e-9) || e.tau >= e.s.tb) return null;
  const k = FREE.burn ? 1 : e.thr; if (!(k > 0)) return null;
  if (FREE.att && !FREE.att.ok) return null; // the main engine waits until the nose is within FLY_ALIGN of its direction
  const q = engAt(e.s, Math.min(e.tau, e.s.tb * (1 - 1e-9))), F = (q.F || e.s.F) * k, mdot = F / e.s.ve;
  let dir;
  if (FREE.burn) { const d = FREE.burn.dir; dir = () => d; FREE.fdirNow = d; }
  else {
    const P = mapSys.P, V = mapSys.V, bp = [P[3 * b], P[3 * b + 1], P[3 * b + 2]], bv = [V[3 * b], V[3 * b + 1], V[3 * b + 2]], lock = e.lock;
    dir = (t, y) => {
      const r = [y[0] - bp[0], y[1] - bp[1], y[2] - bp[2]], v = [y[3] - bv[0], y[4] - bv[1], y[5] - bv[2]], F3 = nodeFrame(r, v);
      const d = lock === 'retro' ? F3.pro.map(x => -x) : lock === 'radOut' ? F3.rad : lock === 'radIn' ? F3.rad.map(x => -x) : lock === 'nor' ? F3.nor : lock === 'anti' ? F3.nor.map(x => -x) : F3.pro;
      FREE.fdirNow = d; return d;
    };
    dir(s.t, [...s.r, ...s.v]);
  }
  return { F, mdot, dir, mDry: e.s.md, k, fq: e.s.curve ? (q.F || e.s.F) / Math.max(...e.s.curve.F) : 1 }; // fq: a curve's thrust now over its peak (the rumble)
}
function flyThr(k) { const e = FREE.eng; if (!e) return; e.thr = Math.max(0, Math.min(1, Math.round(k * 10) / 10)); flyLockSync(); }
function flyLockSync() {
  const e = FREE.eng; if (!e) return;
  for (const bt of flyEl('fnLock').querySelectorAll('button')) bt.setAttribute('aria-pressed', String(bt.dataset.v === e.lock));
  flyTxt('fnThr', _('fn.thr', { p: Math.round(e.thr * 100) })); flyEl('fnThrBar').style.width = Math.round(e.thr * 100) + '%';
}
flyEl('fnThrDn').addEventListener('click', () => flyThr(FREE.eng ? FREE.eng.thr - 0.1 : 0));
flyEl('fnThrUp').addEventListener('click', () => flyThr(FREE.eng ? FREE.eng.thr + 0.1 : 0));
flyEl('fnThrFull').addEventListener('click', () => flyThr(1));
flyEl('fnThrCut').addEventListener('click', () => flyThr(0));
// ----- changing the engine in flight (2026-11-16): the panel's "Motor" picker (presets, saved engines, "Motor tasarla…"
// opens the engine window, whose button then reads "Serbest uçuştaki araca uygula"); the flight goes on from the same
// place and velocity, the craft now the new engine with its propellant full (its mass m₀); a notice says so -----
function flyEngList() {
  const sel = flyEl('fnEng'), e = FREE.eng, cur = e ? e.E.id || '' : '', known = /^[ps]:/.test(cur);
  const html = (known ? '' : '<option value="">' + esc(e ? engName(e.E) : _('eng.custom')) + '</option>')
    + '<optgroup label="' + esc(_('eng.presets')) + '">' + ENGINES.map(p => '<option value="p:' + p.id + '">' + esc(_('eng.' + p.id)) + '</option>').join('') + '</optgroup>'
    + (SAVED_ENG.length ? '<optgroup label="' + esc(_('eng.saved')) + '">' + SAVED_ENG.map((q, j) => '<option value="s:' + j + '">' + esc(q.name) + '</option>').join('') + '</optgroup>' : '')
    + '<option value="w">' + esc(_('fn.engDesign')) + '</option>';
  if (sel.dataset.k !== html) { sel.dataset.k = html; sel.innerHTML = html; }
  sel.value = known ? cur : '';
}
flyEl('fnEng').addEventListener('change', e => {
  const v = e.target.value;
  if (v === 'w') { flyEngList(); if (WINS.engine.open && !WINS.engine.collapsed) engOpenFrom(FREE.eng ? FREE.eng.E : null); else setWin('engine', { open: true, collapsed: false }); return; }
  const E = v.startsWith('p:') ? engPreset(v.slice(2)) : v.startsWith('s:') && SAVED_ENG[+v.slice(2)] ? { ...ENG_DEF, ...SAVED_ENG[+v.slice(2)], id: v } : null;
  if (E) flySetEngine(E); else flyEngList();
});
function flySetEngine(E) {
  if (!FREE.on) return false;
  const s = engSpecOf(E);
  if (!s || s.error) { flyNote(_('fly.engBad', { err: _(s ? s.error : 'err.engType') })); flyEngList(); return false; }
  const e = FREE.eng || {};
  FREE.burn = null; FREE.fire = 0; FREE.cap = Infinity; // a burn going on stops; its node stays (auto fire takes it up with the new engine)
  FREE.eng = { E: { ...E }, s, tau: 0, thr: 0, auto: e.auto !== false, lock: e.lock || 'pro' };
  FREE.st.m = s.m0; FREE.predDirty = true; EP.key = '';
  flyEngList(); flyLockSync(); flyBarSync(); flySave();
  flyNote(_('fly.engSet', { name: engName(E), kg: NFdv.format(Math.round(s.mp)), m: NFdv.format(Math.round(s.m0)) }));
  return true;
}
// the engine panel moves into the flight's panel (and back on exit, folded as it was)
function flyEngMount(on) {
  const p = engEl('engPanel'), slot = flyEl('fnEngSlot');
  if (on) { if (p.parentElement !== slot) { FREE.epFold = EP.fold; slot.appendChild(p); } epFold(false, false); }
  else if (p.parentElement === slot) { flyEl('flyNode').before(p); EP.fold = null; if (FREE.epFold != null) epFold(FREE.epFold, false); p.hidden = true; }
}
// a short notice under "Nasıl uçulur?"
function flyNote(t) {
  const el = flyEl('flyNote'); el.textContent = t; el.hidden = false; clearTimeout(FREE.noteT);
  FREE.noteT = setTimeout(() => { el.hidden = true; }, 5000);
}
flyEl('fnLock').innerHTML = FLY_LOCKS.map(v => `<button type="button" data-v="${v}" data-i18n-title="fn.lock.${v}" data-i18n-aria-label="fn.lock.${v}">${_('fn.lockS.' + v)}</button>`).join('');
flyEl('fnLock').addEventListener('click', e => { const bt = e.target.closest('button'); if (bt && FREE.eng) { FREE.eng.lock = bt.dataset.v; flyLockSync(); } });
flyEl('fnAuto').addEventListener('change', e => { if (FREE.eng) FREE.eng.auto = e.target.checked; if (!e.target.checked && FREE.burn) flyBurnEnd(false); flyTipDid(4); });
// "Düğüme hızlandır": to a little before the selected node's burn (all of the warp until then)
flyEl('fnWarp').addEventListener('click', () => {
  const nd = FREE.nodes[FREE.sel]; if (!nd) return;
  const b = flyBurnOf(Math.hypot(...nd.d)), start = nd.t - (b ? b.T / 2 : 0);
  FREE.warpTo = Math.max(FREE.st.t, start - Math.max(10, b ? 0.5 * b.T : 0) - slewTime(Math.PI, flySlew())); FREE.paused = false; flyBarSync(); flyTipDid(3); // room to turn the nose
});
// the engine panel in free flight (as engine-ui.js engPanelTick for a mission): firing or coasting, the burn's end or
// the next one, the bars, the Δv left, the thrust, the small cutaway
function flyEngPanel() {
  const p = engEl('engPanel'), e = FREE.eng;
  if (!e) { if (!p.hidden) { p.hidden = true; INS = null; } return; }
  if (p.hidden) { p.hidden = false; INS = null; }
  if (EP.fold == null) { const sv = readPref(ENG_LS, PREF_KEYS.engPanel); epFold(sv ? sv === '1' : VW.phone.matches, false); }
  const s = e.s, on = FREE.fire > 0, st = engStOf(s, e.tau, on), t = FREE.st.t, bi = s.mox > 0;
  engEl('epState').classList.toggle('on', on); epSet('epState', _(on ? 'ep.burn' : 'ep.coast'));
  const nb = !FREE.burn ? flyNextBurn() : null;
  epSet('epNext', FREE.burn ? _('ep.left', { t: fmtIn(Math.max(0, FREE.burn.T - (FREE.burn.m0 - FREE.st.m) / s.mdot)) }) : nb && nb.start > t ? _('ep.next', { t: fmtIn(nb.start - t) }) : '');
  const bar = (id, show2, lab, v) => {
    const b = engEl(id); if (b.hidden === show2) b.hidden = !show2; if (!show2) return;
    epSet(id + 'L', lab); const pc = Math.round(v * 100) + '%';
    if (EP.txt[id] !== pc) { EP.txt[id] = pc; b.querySelector('b').textContent = pc; b.querySelector('i').style.width = (v * 100).toFixed(1) + '%'; }
  };
  bar('epOx', bi, _('ep.ox'), st.ox); bar('epFuel', true, _(bi ? 'ep.fuel' : 'ep.prop'), st.fuel);
  epSet('epDv', fmtSpeed(flyDvLeft())); epSet('epF', on ? fmtF(st.F * FREE.fire) : '0 N');
  const key = [s.tb, E2K(e.E), Math.round(e.tau / s.tb * 400), on, EP.fold, engEl('epSch').parentElement.clientWidth].join('|'); // the width too: the panel unfolds
  if (!EP.fold && (on || FREE.pl > 0.004 || key !== EP.key)) { EP.key = key; engSchematic(engEl('epSch'), s, st, e.E, performance.now() / 1000, FREE.pl, { k: 0.55, mini: true }); }
}
// ----- the craft in free flight: the 3D model (from mode3d.js drawMap3, before it renders), "Araca yaklaş" -----
const FLY_OWN = new Set(['flyTrail', ...Array.from({ length: 8 }, (_, k) => 'flyP' + k)]);
// the craft in the map's coordinates (after states(mapSys, FREE.st.t, MP, MV))
function flyCraftPos3(out = [0, 0, 0]) { const s = FREE.st; flyMapAt(MSUN, s.r[0] - MP[3 * MSUN], s.r[1] - MP[3 * MSUN + 1], s.r[2] - MP[3 * MSUN + 2], out); return mapXYZ(out[0], out[1], out[2], out); }
// the nose: along the thrust while it fires (and while the plume dies), else null (prograde)
function flyNose() { return FREE.att ? FREE.att.n : null; }
function flyCraft3(c) {
  if (!FREE.on || !FREE.eng) { V3.craft({ show: false }); return; }
  const s = FREE.st, b = FREE.tb, e = FREE.eng;
  states(mapSys, s.t, MP, MV);
  const p = flyCraftPos3(), r = [s.r[0] - MP[3 * b], s.r[1] - MP[3 * b + 1], s.r[2] - MP[3 * b + 2]], v = [s.v[0] - MV[3 * b], s.v[1] - MV[3 * b + 1], s.v[2] - MV[3 * b + 2]];
  const up = unit3(r) || [0, 0, 1], ax = flyNose() || unit3(v) || [1, 0, 0], sun = unit3(p.map(x => -x)) || [1, 0, 0];
  const L = CRAFT.L = craftLen({ m0: s.m });
  // close to the craft the map's lines fade as in a mission (its own path kept, faint)
  const nk = FREE.appr ? nearFade3(c.dist) : 1; V3.fadeSet('map', nk, FLY_OWN, nk); if (FREE.appr) grid3(c, false);
  // up close the road (mode3d.js road3, Phase 20A-4): the conic through the craft, thin and faint, out near the camera
  if (nk < 1 && !MAP.log) { const g = conicGeom(mapSys.mu[b], r, v), an = flyMapAt(b, 0, 0, 0, [0, 0, 0]); mapXYZ(an[0], an[1], an[2], an); road3('map', g, g ? conicU(g, r) : 0, an, 1 - nk); } else V3.dynHide('map', 'road');
  proj3(p, PJ); const lpx = FREE.lpx = PJ[2] > 0 ? L * CB.f / PJ[2] : 0;
  if (FREE.appr) apprWatch(lpx); // zoomed out by hand: back to the map's view (app.js)
  if (!(lpx > 6)) { V3.craft({ show: false }); return; }
  const st = engStOf(e.s, e.tau, FREE.fire > 0);
  craftDraw('map', p, ax, cutSide(ax, up), L, sun, { E: e.E, s: e.s, st, plume: (PROPS[e.E.prop] || {}).plume || 'amber' }, FREE.pl, c.dist, flyRcs(1 / 60));
}
// 3D, close to the craft (mode3d.js drawMap3, before the camera is set): the camera in the craft's local frame about the
// dominant body (mode3d.js camLocal), on the craft, aimed the first frame (app.js apprAim), then kept in the free area
function flyApprCam(c) {
  const s = FREE.st, b = FREE.tb >= 0 ? FREE.tb : MSUN; states(mapSys, s.t, MP, MV);
  const r = [s.r[0] - MP[3 * b], s.r[1] - MP[3 * b + 1], s.r[2] - MP[3 * b + 2]], v = [s.v[0] - MV[3 * b], s.v[1] - MV[3 * b + 1], s.v[2] - MV[3 * b + 2]];
  camLocal(c, r, v, b);
  c.t = flyCraftPos3();
  if (FREE.aim) {
    const ax = flyNose() || unit3(v) || [1, 0, 0], sun = unit3(c.t.map(x => -x)) || [1, 0, 0];
    CRAFT.L = craftLen({ m0: s.m }); APPR.aim = FREE.aim; FREE.aim = null; apprAim(c, ax, unit3(r) || [0, 0, 1], sun);
  } else apprKeep(c);
}
// 2D, close to the craft: the view's middle on it (the free area's), the map's camera following it
function flyFollow2() {
  const s = FREE.st, o = [0, 0, 0]; states(mapSys, s.t, MP, MV);
  flyMapAt(MSUN, s.r[0] - MP[3 * MSUN], s.r[1] - MP[3 * MSUN + 1], s.r[2] - MP[3 * MSUN + 2], o); mapXY(o[0], o[1], o);
  const q = insets(); cam.cx = o[0] - (q.l - q.r) / 2 / cam.scale; cam.cy = o[1] + (q.t - q.b) / 2 / cam.scale;
}
// "Araca yaklaş" in free flight (app.js apprSet hands over): the map's camera on the craft, the model ≈ 45 % of the free
// area (3D: aimed on the next frame by app.js apprAim; 2D: a view 400 km across); back to the view before
function flyAppr(on) {
  if (!FREE.on || on === FREE.appr) return;
  const a = flyFrom(), v3 = is3d(), c = CAM3.map;
  if (on) {
    FREE.apprPrev = { follow: MAP.follow, cam: { cx: cam.cx, cy: cam.cy, scale: cam.scale }, c: { t: [...c.t], dist: c.dist, yaw: c.yaw, elev: c.elev, roll: c.roll, cx: c.cx, cy: c.cy } };
    FREE.appr = true; APPR.on = true; MAP.follow = null;
    if (v3) { FREE.aim = a; c.t = flyCraftPos3(); }
    else { const q = apprBox(); cam.scale = Math.min(q.w, q.h) / 4e5; flyFollow2(); flyTo(a); }
    flyTipDid(0);
  } else {
    const p = FREE.apprPrev; FREE.apprPrev = null; FREE.appr = false; APPR.on = false; FREE.aim = null; FREE.lpx = 0;
    c.lb = null; c.lbFrom = null; c.yawT = null; // back in the view frame's axes (flyTo re-expresses the start)
    if (p) { Object.assign(cam, p.cam); Object.assign(c, { ...p.c, t: [...p.c.t] }); MAP.follow = FREE.tb >= 0 ? FREE.tb : p.follow; }
    if (V3) { V3.fadeSet('map', 1, FLY_OWN, 1); V3.dynHide('map', 'road'); }
    flyTo(a);
  }
  apprSync();
}
// ----- hints (the first free flight; "Nasıl uçulur?" brings them back) -----
const FLY_TIPS = ['fly.tip.appr', 'fly.tip.node', 'fly.tip.drag', 'fly.tip.warp', 'fly.tip.auto', 'fly.tip.flow'];
function flyTips(i) {
  FREE.tip = i >= 0 && i < FLY_TIPS.length ? i : -1;
  const on = FREE.tip >= 0;
  flyEl('flyTip').hidden = !on;
  if (on) { flyEl('flyTipText').textContent = _('fly.tipN', { i: FREE.tip + 1, n: FLY_TIPS.length, t: _(FLY_TIPS[FREE.tip]) }); flyEl('flyTipNext').textContent = _(FREE.tip === FLY_TIPS.length - 1 ? 'fly.tipDone' : 'fly.tipNext'); }
  else if (FREE.on) writePref(LS, PREF_KEYS.flyTips, '1');
  flyHelpPlace();
}
// the hint being shown is done when its action is (a double click, a node, a drag, a warp, the switch)
function flyTipDid(i) { if (FREE.tip === i) flyTips(i + 1); }
function flyHelpPlace() {
  const g = flyEl('flyHelp'); if (g.hidden) return;
  const st = flyEl('stage').getBoundingClientRect(), r = el => el && el.getClientRects().length ? el.getBoundingClientRect().bottom - st.top : 0;
  g.style.top = Math.round(Math.max(r(flyEl('modeChip')), VW.phone.matches ? r(flyEl('ctrls')) : 0) + 6) + 'px';
}
addEventListener('resize', flyHelpPlace);
flyEl('flyTipNext').addEventListener('click', () => flyTips(FREE.tip + 1));
flyEl('flyTipSkip').addEventListener('click', () => flyTips(-1));
flyEl('flyHow').addEventListener('click', () => flyTips(0));
// ----- targets and transfer windows (Phase 19e) -----
const FLY_CA_MS = 1500;
// the map's camera on body b (a new dominant body): the craft's distance from it in view, as on entering
function flyFrameBody(b) {
  const s = FREE.st, rr = Math.hypot(s.r[0] - mapSys.P[3 * b], s.r[1] - mapSys.P[3 * b + 1], s.r[2] - mapSys.P[3 * b + 2]);
  cam.scale = Math.min(W, H) * 0.3 / Math.max(rr, mapSys.R[b] * 1.2); cam.cx = 0; cam.cy = 0;
  CAM3.map.dist = Math.max(rr, mapSys.R[b]) * 3.2; MAP.follow = b;
}
// the target list: the dominant body's moons, its siblings and its parent's other bodies first, then every other body
function flyTgtList() {
  const sel = flyEl('fnTgt'), b = FREE.tb >= 0 ? FREE.tb : -1, pb = b >= 0 ? MPAR[b] : -1;
  const near = [], far = [];
  MAPK.forEach((k, i) => { if (i === MSUN || i === b) return; (MPAR[i] === b || (pb >= 0 && MPAR[i] === pb) ? near : far).push(i); });
  const opt = i => `<option value="${i}">${esc(_('body.' + MAPK[i]))}</option>`;
  const html = `<option value="-1">${esc(_('fn.tgtNone'))}</option>` + (near.length ? `<optgroup label="${esc(_('fn.tgtNear'))}">${near.map(opt).join('')}</optgroup>` : '') + `<optgroup label="${esc(_('fn.tgtAll'))}">${far.map(opt).join('')}</optgroup>`;
  if (sel.dataset.k !== html) { sel.dataset.k = html; sel.innerHTML = html; }
  sel.value = String(FREE.target);
  flyEl('fnWin').disabled = FREE.target < 0 || !!FREE.winBusy;
}
flyEl('fnTgt').addEventListener('change', e => { FREE.target = +e.target.value; FREE.tca = null; FREE.tcaDirty = true; FREE.win = null; FREE.cor = null; FREE.corAuto = null; FREE.flow = {}; flyWinShow(); flyCorShow(); flyTgtList(); flyTipDid(5); });
// how the path meets the target (after the prediction; at most every FLY_CA_MS): its sphere and pass, else the closest
// approach with the target's and the craft's places then (relative to the segment's body, drawn where it is now)
function flyTca(now) {
  const c = FREE.target; if (c < 0 || !FREE.pred) { FREE.tca = null; return; }
  if (!FREE.tcaDirty || now - FREE.tcaAt < FLY_CA_MS) return;
  FREE.tcaDirty = false; FREE.tcaAt = now;
  const pr = FREE.pred, ev = pr.events.find(e => e.type === 'soiIn' && e.b === c), pe = ev && pr.events.find(e => e.type === 'pe' && e.b === c && e.t >= ev.t);
  const imp = ev && pr.events.find(e => e.type === 'impact' && e.b === c);
  let q = null;
  if (pe || imp) { const e = pe || imp; q = { t: e.t, d: e.r, alt: e.r - mapSys.R[c], soi: true, impact: !pe }; }
  else { const ca = flyClosest(mapSys, pr, c); if (ca) q = { t: ca.t, d: ca.d, alt: ca.d - mapSys.R[c], soi: false }; }
  if (!q) { FREE.tca = null; return; }
  // the places at that moment: the craft on its segment, the target, both relative to the segment's body
  const g = pr.segs.find(x => q.t >= x.t0 - 1e-6 && q.t <= x.t1 + 1e-6);
  if (g) {
    uniStep(mapSys.mu[g.b], g.r0, g.v0, q.t - g.t0, FRV);
    const P = mapSys.P, V = mapSys.V; states(mapSys, q.t, P, V);
    q.b = g.b; q.rc = [FRV[0], FRV[1], FRV[2]]; q.rt = [0, 1, 2].map(j => P[3 * c + j] - P[3 * g.b + j]);
    states(mapSys, FREE.st.t, P, V);
  }
  FREE.tca = q;
}
// drawn over the map (both views): the target's place at the meeting, the craft's, a dashed line and the distance
function flyTcaDraw(v3) {
  const q = FREE.tca; if (!q || q.b == null) return;
  states(mapSys, FREE.st.t, MP, MV);
  const A = flyScr(q.b, q.rc[0], q.rc[1], q.rc[2], v3), B = flyScr(q.b, q.rt[0], q.rt[1], q.rt[2], v3); if (!A || !B) return;
  const col = BODIES[MAPK[FREE.target]].color;
  ctx.setLineDash([3, 4]); ctx.strokeStyle = hexA(col, 0.7); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(B[0], B[1], 6, 0, 6.2832); ctx.stroke();
  ctx.fillStyle = COL.ink; ctx.beginPath(); ctx.arc(A[0], A[1], 2.6, 0, 6.2832); ctx.fill();
  ctx.font = LABEL_FONT; ctx.fillStyle = hexA(col, 0.9);
  ctx.fillText(_(q.soi ? (q.impact ? 'fn.tgtHitS' : 'fn.tgtPassS') : 'fn.tgtCaS', { d: fmtDist(q.soi ? Math.max(0, q.alt) : q.d) }), B[0] + 9, B[1] - 8);
}
// The target's steps (2026-11-16): 1 Transfer penceresi (aranıyor… while the worker runs) → 2 Düğümleri koy → 3 Düğüme
// hızlandır → 4 Otomatik ateşle → 5 Düzeltme öner; each is done by its own action or by what it leads to (FREE.flow:
// placed, warped, fired, corrected; a found window), the first not done is the current one, its button marked (fn-next)
const FLY_FLOW_BTN = ['fnWin', 'fnWinGo', 'fnWarp', 'fnAuto', 'fnCor'];
function flyFlowTick() {
  const el = flyEl('fnFlow'), F = FREE.flow || (FREE.flow = {}), on = FREE.target >= 0;
  if (el.hidden === on) el.hidden = !on;
  const r = FREE.cor, corOk = !!(r && r.node && !r.busy && !r.error && flyEl('fnCorGo').hidden);
  if (FREE.burn && F.placed) F.warped = true;
  const done = [F.placed || !!(FREE.win && FREE.win.node), !!F.placed, !!F.warped, !!F.fired, !!F.corrected || (F.fired && corOk)];
  const cur = on ? done.indexOf(false) : -1, busy = !!FREE.winBusy;
  const key = [on, cur, done.join(), busy, FREE.eng && FREE.eng.auto, flyEl('fnCorGo').hidden, flyEl('fnWinGo').hidden].join('|');
  if (FREE.flowKey === key) return; FREE.flowKey = key;
  [...el.children].forEach((li, i) => { li.className = done[i] ? 'done' : i === cur ? 'cur' : ''; li.textContent = _(i === 0 && busy ? 'fn.flow1Busy' : 'fn.flow' + (i + 1)); });
  FLY_FLOW_BTN.slice(0, 4).forEach((id, i) => { const b = id === 'fnAuto' ? flyEl(id).closest('label') : flyEl(id); b.classList.toggle('fn-next', i === cur && !(i === 3 && FREE.eng && FREE.eng.auto)); }); // step 4 with auto fire on: nothing to press
  flyEl('fnCorGo').classList.toggle('fn-next', cur === 4 && !flyEl('fnCorGo').hidden);
  flyEl('fnCor').classList.toggle('fn-next', cur === 4 && flyEl('fnCorGo').hidden);
}
function flyTgtTick() {
  flyFlowTick();
  const q = FREE.tca, c = FREE.target;
  if (c < 0 || !q) { flyTxt('fnTgtInfo', c >= 0 && FREE.pred ? _('fn.tgtWait') : ''); return; }
  const t = fmtIn(Math.max(0, q.t - FREE.st.t)), body = _('body.' + MAPK[c]);
  flyTxt('fnTgtInfo', q.soi ? _(q.impact ? 'fn.tgtHit' : 'fn.tgtPass', { body, alt: fmtDist(Math.max(0, q.alt)), t }) : _('fn.tgtCa', { body, d: fmtDist(q.d), t }));
}
// the transfer window, in a worker of its own (the refinement's keeps running)
flyEl('fnWin').addEventListener('click', () => {
  if (FREE.target < 0 || FREE.winBusy) return;
  let w = null; try { w = makeWorker(); } catch (err) { w = null; }
  const s = FREE.st, job = { t0: s.t, r: [...s.r], v: [...s.v], c: FREE.target };
  const done = r => { if (FREE.winBusy === w) FREE.winBusy = null; if (w) w.terminate(); FREE.win = r && r.c === FREE.target ? r : r && r.error ? r : null; flyWinShow(); flyTgtList(); };
  if (!w) { done(flyWindow(mapSys, job.t0, job.r, job.v, job.c)); return; }
  FREE.winBusy = w; FREE.win = { busy: true }; flyWinShow(); flyTgtList();
  w.onmessage = e => done(e.data.done || { error: 'err.flyWinNone' });
  w.onerror = () => done({ error: 'err.flyWinNone' });
  w.postMessage({ list: mapList(), flyWin: job });
});
function flyWinShow() {
  const r = FREE.win, info = flyEl('fnWinInfo'), go = flyEl('fnWinGo');
  go.hidden = !(r && r.node);
  if (!r) { info.textContent = ''; return; }
  if (r.busy) { info.textContent = _('fn.winBusy'); return; }
  if (r.error) { info.textContent = _(r.error); return; }
  const dep = fmtDate(daysToUtc(r.node.t / DAY)), body = _('body.' + MAPK[r.c]);
  info.textContent = _(r.kind === 'sibling' ? 'fn.winSib' : 'fn.winIn', { body, dep, in: fmtIn(Math.max(0, r.node.t - FREE.st.t)), dv: NFdv.format(r.kind === 'sibling' ? r.dvEj : r.dv), mid: NFdv.format(r.dvMid || 0), tof: fmtDur(r.tof), cap: NFdv.format(r.dvCap || 0), vinf: fmtSpeed(r.vinfArr || 0) });
}
// ----- the course correction (2026-11-15): core.js flyCorrect in a worker; suggested by itself after a burn and once
// about 30 % of the way to the pass, or on "Düzeltme öner"; "Düzeltmeyi koy" lays its node -----
const FLY_COR_OK = 20e3; // a pass within this of the one wanted needs no correction
function flyCorAsk() {
  if (FREE.target < 0 || FREE.corBusy) return;
  let w = null; try { w = makeWorker(); } catch (err) { w = null; }
  const s = FREE.st, job = { t0: s.t, r: [...s.r], v: [...s.v], c: FREE.target };
  const done = r => { if (FREE.corBusy === w) FREE.corBusy = null; if (w) w.terminate(); FREE.cor = r && (r.error || r.c === FREE.target) ? r : null; flyCorShow(); };
  if (!w) { done(flyCorrect(mapSys, job.t0, job.r, job.v, job.c)); return; }
  FREE.corBusy = w; FREE.cor = { busy: true }; flyCorShow();
  w.onmessage = e => done(e.data.done || { error: 'err.flyCorNone' });
  w.onerror = () => done({ error: 'err.flyCorNone' });
  w.postMessage({ list: mapList(), flyCor: job });
}
function flyCorShow() {
  const r = FREE.cor, row = flyEl('fnCorRow'), q = FREE.tca;
  row.hidden = !(FREE.target >= 0 && q && q.soi);
  if (row.hidden) return;
  const info = flyEl('fnCorInfo'), go = flyEl('fnCorGo');
  go.hidden = !(r && r.node && Math.abs(r.hBefore - flyHArr(mapSys, FREE.target)) > FLY_COR_OK);
  info.textContent = !r ? '' : r.busy ? _('fn.corBusy') : r.error ? _(r.error) : go.hidden ? _('fn.corOk', { from: fmtDist(Math.max(0, r.hBefore)) })
    : _('fn.corIs', { from: fmtDist(Math.max(0, r.hBefore)), dv: NFdv.format(r.dv), to: fmtDist(r.hAfter) });
}
// the suggestions by themselves: after a burn (once the prediction is the new one), and once ~30 % of the way to the pass
function flyCorTick(now) {
  const a = FREE.corAuto, q = FREE.tca; if (!a || FREE.target < 0) return;
  // after the burn: only once the meeting has been worked out on the new path (2026-11-16: at a few frames a second the
  // old one, from before the burn, decided and the suggestion was lost); a path that misses the target's sphere waits
  if (a.at && now >= a.at && FREE.pred && !FREE.predDirty && FREE.tcaAt > a.after && !FREE.tcaDirty) { if (q && q.soi) { a.at = 0; flyCorAsk(); } }
  if (!a.mid && q && q.soi && FREE.st.t >= a.from + 0.3 * (q.t - a.from)) { a.mid = true; flyCorAsk(); }
  flyCorShow();
}
flyEl('fnCor').addEventListener('click', flyCorAsk);
flyEl('fnCorGo').addEventListener('click', () => {
  const r = FREE.cor; if (!r || !r.node || r.node.t <= FREE.st.t) return;
  (FREE.flow || (FREE.flow = {})).corrected = true;
  flyEdit(); FREE.nodes.push({ t: r.node.t, d: r.node.d.map(x => Math.round(x * 100) / 100) }); FREE.nodes.sort((a, b) => a.t - b.t);
  FREE.sel = FREE.nodes.findIndex(nd => nd.t === r.node.t); FREE.cor = null; flyCorShow(); flyChanged();
});
flyEl('fnWinGo').addEventListener('click', () => {
  const r = FREE.win; if (!r || !r.node || r.node.t <= FREE.st.t) return;
  FREE.flow = { placed: true }; // the steps from here (a new window starts them over)
  flyEdit(); for (const nd of r.nodes || [r.node]) FREE.nodes.push({ t: nd.t, d: nd.d.map(x => Math.round(x * 10) / 10) }); // the ejection and (between planets) the course correction
  FREE.nodes.sort((a, b) => a.t - b.t); FREE.nodes = FREE.nodes.slice(0, FLY_NODES_MAX);
  FREE.sel = FREE.nodes.findIndex(nd => nd.t === r.node.t); FREE.win = null; flyWinShow(); flyChanged();
});
flyEl('fnDel').addEventListener('click', () => flyDel());
flyEl('fnUndo').addEventListener('click', flyUndo);
flyEl('fnPrev').addEventListener('click', () => { if (FREE.sel > 0) { FREE.sel--; flyPanel(); } });
flyEl('fnNext').addEventListener('click', () => { if (FREE.sel < FREE.nodes.length - 1) { FREE.sel++; flyPanel(); } });

// ----- the bar -----
function flyBarSync() {
  for (const bt of flyEl('flyWarp').querySelectorAll('button')) bt.setAttribute('aria-pressed', String(+bt.dataset.w === FREE.warp));
  FREE.capShown = null; flyBarCap();
  flyEl('flyPause').setAttribute('aria-pressed', String(FREE.paused)); flyEl('flyPause').setAttribute('aria-label', _(FREE.paused ? 'fly.play' : 'fly.pause'));
  flyEl('flyPause').innerHTML = FREE.paused ? playSvg : pauseSvg;
}
const flyTxt = (id, v) => { if (FREE.txt[id] !== v) { FREE.txt[id] = v; flyEl(id).textContent = v; } };
function flyBarTick(b) {
  const s = FREE.st, P = mapSys.P, V = mapSys.V, r = Math.hypot(s.r[0] - P[3 * b], s.r[1] - P[3 * b + 1], s.r[2] - P[3 * b + 2]);
  const v = Math.hypot(s.v[0] - V[3 * b], s.v[1] - V[3 * b + 1], s.v[2] - V[3 * b + 2]);
  flyTxt('flyDate', fmtDate(daysToUtc(s.t / DAY)));
  flyTxt('flyBody', _('fly.state', { body: _('body.' + MAPK[b]), alt: fmtDist(r - mapSys.R[b]), v: fmtSpeed(v) }));
}
const FLY_KEYS = FLY_WARPS;
// a warp step (auto: by "Düğüme hızlandır" or the burn's cap; a step by hand ends the warp to a node), never above the cap
function flyWarp(w, auto) { if (!auto) FREE.warpTo = null; FREE.warp = Math.min(w, FREE.cap); flyBarSync(); }
// while the engine fires the steps above its cap are disabled
function flyBarCap() {
  if (FREE.capShown === FREE.cap) return; FREE.capShown = FREE.cap;
  for (const bt of flyEl('flyWarp').querySelectorAll('button')) bt.disabled = +bt.dataset.w > FREE.cap;
}
flyEl('flyWarp').innerHTML = FLY_KEYS.map(w => `<button type="button" data-w="${w}">${w >= 1e6 ? (w / 1e6) + 'M' : w >= 1e3 ? (w / 1e3) + 'k' : w}×</button>`).join('');
flyEl('flyWarp').addEventListener('click', e => { const bt = e.target.closest('button'); if (bt) flyWarp(+bt.dataset.w); });
flyEl('flyPause').addEventListener('click', () => { FREE.paused = !FREE.paused; flyBarSync(); });
flyEl('flyNow').addEventListener('click', () => flyWarp(1));
flyEl('flyExit').addEventListener('click', () => flyExit());
addEventListener('keydown', e => {
  if (!FREE.on || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const i = FLY_KEYS.indexOf(FREE.warp);
  if (e.key === '.' || e.key === ',') { e.preventDefault(); flyWarp(FLY_KEYS[Math.max(0, Math.min(FLY_KEYS.length - 1, i + (e.key === '.' ? 1 : -1)))]); }
  else if (e.key === 'w' || e.key === 'W') { e.preventDefault(); flyThr(FREE.eng ? FREE.eng.thr + 0.1 : 0); }
  else if (e.key === 's' || e.key === 'S') { e.preventDefault(); flyThr(FREE.eng ? FREE.eng.thr - 0.1 : 0); }
  else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); flyThr(1); }
  else if (e.key === 'x' || e.key === 'X') { e.preventDefault(); flyThr(0); }
  else if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); FREE.paused = !FREE.paused; flyBarSync(); }
  else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); flyUndo(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && FREE.sel >= 0) { e.preventDefault(); flyDel(); }
}, true);
