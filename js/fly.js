// Free flight (Phase 19b; classic script before app.js: it only defines and binds its own controls; the app calls
// flyFrame from its draw loop and flyRestore at the end of its start). The craft is flown live in the map's system (all
// the real bodies, core.js flyAdvance: in the N-body field below RAILS_W, on rails above), drawn on the map view (2D and
// 3D: the bodies, labels and camera are the map's), with its predicted path (core.js flyPredict, patched conics, redone
// twice a second), its trail (relative to the dominant body, so an orbit reads as an orbit) and a marker. A warp bar:
// pause, the warp steps (core.js FLY_WARPS), "Şimdi" (back to real time), the date, the body, altitude and speed, "Çık".
// Keys: , and . warp down / up, Space pause. The flight is kept in one sessionStorage snapshot (prefs.js parseFlySnap,
// PREF_KEYS.flySnap) and comes back on a reload. Maneuver nodes (19c), the engine (19d) and targets (19e) build on it.
const FREE = { on: false, hid: [], st: null, warp: 1, paused: false, pred: null, predAt: 0, trail: null, tb: -1, tn: 0, saveAt: 0, txt: {} };
const RAILS_W = 1000, TRAIL_N = 720, FLY_SS = (() => { try { return window.sessionStorage; } catch (e) { return null; } })();
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
  FREE.on = true; FREE.paused = false; FREE.warp = q.warp || 1; FREE.pred = null; FREE.predAt = 0; FREE.trail = new Float64Array(3 * TRAIL_N); FREE.tn = 0; FREE.tb = -1; FREE.txt = {};
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
  flyEl('flyBar').hidden = false; flyBarSync(); INS = null;
  return true;
}
function flyEnter() { const q = flyFromMission(); if (q) flyEnterState(q); }
function flyExit() {
  FREE.on = false; delete document.documentElement.dataset.fly; flyEl('flyBar').hidden = true;
  clearPref(FLY_SS, PREF_KEYS.flySnap);
  if (V3 && is3d()) for (let k = 0; k < 6; k++) V3.dynHide('map', 'flyP' + k), V3.dynHide('map', 'flyTrail');
  for (const id of FREE.hid) sceneUnhide(id); FREE.hid = [];
  APP.mode = 'mission'; setMap(false); INS = null;
}
// the session's one snapshot: every two seconds and when the page is hidden; a reload comes back to it
function flySave() {
  if (!FREE.on) return;
  const s = FREE.st; writePref(FLY_SS, PREF_KEYS.flySnap, JSON.stringify({ t: s.t, r: s.r, v: s.v, m: s.m, warp: FREE.warp, at: Date.now() }));
}
addEventListener('pagehide', flySave);
function flyRestore() {
  const q = parseFlySnap(readPref(FLY_SS, PREF_KEYS.flySnap)); if (!q) return false;
  mapSys.P = mapSys.P || new Float64Array(3 * mapSys.N); mapSys.V = mapSys.V || new Float64Array(3 * mapSys.N);
  states(mapSys, q.t, mapSys.P, mapSys.V);
  const b = domBody(mapSys, mapSys.P, q.r[0], q.r[1], q.r[2]);
  return flyEnterState({ t: q.t, key: MAPK[b], r: [0, 1, 2].map(j => q.r[j] - mapSys.P[3 * b + j]), v: [0, 1, 2].map(j => q.v[j] - mapSys.V[3 * b + j]), m: q.m, warp: q.warp });
}
// one frame: advance (real seconds dt × warp), predict (twice a second), draw the map at the flight's time and the
// craft over it, the bar's numbers
const FPR = new Float64Array(3);
function flyFrame(dt, v3, glow, now) {
  const s = FREE.st, P = mapSys.P, V = mapSys.V;
  if (!FREE.paused) flyAdvance(mapSys, s, Math.min(dt, 0.1) * FREE.warp, { rails: FREE.warp >= RAILS_W, maxSteps: 4000 });
  states(mapSys, s.t, P, V);
  const b = domBody(mapSys, P, s.r[0], s.r[1], s.r[2]);
  if (b !== FREE.tb) { FREE.tb = b; FREE.tn = 0; FREE.pred = null; }
  if (FREE.tn === 0 || now - FREE.trailAt > 40) { // the trail, relative to the dominant body
    const k = FREE.tn % TRAIL_N; for (let j = 0; j < 3; j++) FREE.trail[3 * k + j] = s.r[j] - P[3 * b + j]; FREE.tn++; FREE.trailAt = now;
  }
  if (!FREE.pred || now - FREE.predAt > 500) {
    FREE.pred = flyPredict(mapSys, s.t, s.r, s.v, { revs: 1, T: 30 * DAY, K: 120 }); FREE.predAt = now;
    states(mapSys, s.t, P, V);
  }
  if (now - FREE.saveAt > 2000) { FREE.saveAt = now; flySave(); }
  MAP.follow = b;
  if (v3) { flyLines3(b); drawMap3(s.t, glow, null, 0, 0); flyMark(b, true); }
  else { drawMap(s.t, glow, null, 0, 0); flyLines2(b); flyMark(b, false); if (!MAP.log) drawScale(); }
  flyBarTick(b);
}
// map coordinates (heliocentric, as the map draws its bodies) of a point relative to body b, after states(mapSys, …)
const flyMapAt = (b, x, y, z, out) => { out[0] = MP[3 * b] - MP[3 * MSUN] + x; out[1] = MP[3 * b + 1] - MP[3 * MSUN + 1] + y; out[2] = MP[3 * b + 2] - MP[3 * MSUN + 2] + z; return out; };
// 2D: the predicted segments (each about its body, drawn where that body is now) and the trail
function flyLines2(b) {
  states(mapSys, FREE.st.t, MP, MV);
  const o = [0, 0, 0], line = (pts, n, bb) => { ctx.beginPath(); for (let k = 0; k < n; k++) { flyMapAt(bb, pts[3 * k], pts[3 * k + 1], pts[3 * k + 2], o); const x = sx(o[0]), y = sy(o[1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = hexA(COL.traj, 0.75); ctx.lineWidth = 1.4;
  for (const g of FREE.pred ? FREE.pred.segs : []) line(g.pts, g.n, g.b);
  const n = Math.min(FREE.tn, TRAIL_N); if (n > 1) {
    const T = new Float64Array(3 * n); for (let i = 0; i < n; i++) { const k = (FREE.tn - n + i) % TRAIL_N; T.set(FREE.trail.subarray(3 * k, 3 * k + 3), 3 * i); }
    ctx.strokeStyle = hexA(COL.ink, 0.35); ctx.lineWidth = 1; line(T, n, b);
  }
}
// 3D: the same as lines in the map's set (before the map renders)
const FLY3 = { made: false, buf: null };
function flyLines3(b) {
  if (!V3) return;
  if (!FLY3.made) { for (let k = 0; k < 6; k++) V3.dyn('map', 'flyP' + k, 260, { color: COL.traj, opacity: 0.8, width: 1.5 }); V3.dyn('map', 'flyTrail', TRAIL_N + 2, { color: COL.ink, opacity: 0.35, width: 1 }); FLY3.made = true; FLY3.buf = new Float64Array(3 * (TRAIL_N + 2)); }
  states(mapSys, FREE.st.t, MP, MV);
  const o = [0, 0, 0], B = FLY3.buf, put = (pts, n, bb) => { const m = Math.min(n, B.length / 3); for (let k = 0; k < m; k++) { flyMapAt(bb, pts[3 * k], pts[3 * k + 1], pts[3 * k + 2], o); mapXYZ(o[0], o[1], o[2], o); B[3 * k] = o[0]; B[3 * k + 1] = o[1]; B[3 * k + 2] = o[2]; } return m; };
  const segs = FREE.pred ? FREE.pred.segs : [];
  for (let k = 0; k < 6; k++) { if (k < segs.length) V3.dynSet('map', 'flyP' + k, B, put(segs[k].pts, segs[k].n, segs[k].b), null); else V3.dynHide('map', 'flyP' + k); }
  const n = Math.min(FREE.tn, TRAIL_N);
  if (n > 1) { const T = new Float64Array(3 * n); for (let i = 0; i < n; i++) { const k = (FREE.tn - n + i) % TRAIL_N; T.set(FREE.trail.subarray(3 * k, 3 * k + 3), 3 * i); } V3.dynSet('map', 'flyTrail', B, put(T, n, b), null); }
  else V3.dynHide('map', 'flyTrail');
}
// the craft's marker (2D: map coordinates; 3D: projected after the map's camera is set)
function flyMark(b, v3) {
  const s = FREE.st, o = [0, 0, 0];
  states(mapSys, s.t, MP, MV);
  flyMapAt(MSUN, s.r[0] - MP[3 * MSUN], s.r[1] - MP[3 * MSUN + 1], s.r[2] - MP[3 * MSUN + 2], o);
  let x, y;
  if (v3) { mapXYZ(o[0], o[1], o[2], o); FPR[0] = o[0]; FPR[1] = o[1]; FPR[2] = o[2]; proj3(FPR, PJ); if (!(PJ[2] > 0)) return; x = PJ[0]; y = PJ[1]; }
  else { mapXY(o[0], o[1], o); x = sx(o[0]); y = sy(o[1]); }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = COL.traj; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.stroke();
  addHit('c', 0, x, y, 3.2);
}
// ----- the bar -----
function flyBarSync() {
  for (const bt of flyEl('flyWarp').querySelectorAll('button')) bt.setAttribute('aria-pressed', String(+bt.dataset.w === FREE.warp));
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
function flyWarp(w) { FREE.warp = w; flyBarSync(); }
flyEl('flyWarp').innerHTML = FLY_KEYS.map(w => `<button type="button" data-w="${w}">${w >= 1e6 ? (w / 1e6) + 'M' : w >= 1e3 ? (w / 1e3) + 'k' : w}×</button>`).join('');
flyEl('flyWarp').addEventListener('click', e => { const bt = e.target.closest('button'); if (bt) flyWarp(+bt.dataset.w); });
flyEl('flyPause').addEventListener('click', () => { FREE.paused = !FREE.paused; flyBarSync(); });
flyEl('flyNow').addEventListener('click', () => flyWarp(1));
flyEl('flyExit').addEventListener('click', () => flyExit());
addEventListener('keydown', e => {
  if (!FREE.on || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const i = FLY_KEYS.indexOf(FREE.warp);
  if (e.key === '.' || e.key === ',') { e.preventDefault(); flyWarp(FLY_KEYS[Math.max(0, Math.min(FLY_KEYS.length - 1, i + (e.key === '.' ? 1 : -1)))]); }
  else if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); FREE.paused = !FREE.paused; flyBarSync(); }
}, true);
