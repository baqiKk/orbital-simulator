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
// and faint; the refinement draws it solid. A node the flight passes is dropped (the engine fires them in 19d).
const FREE = { on: false, hid: [], st: null, warp: 1, paused: false, pred: null, predAt: 0, trail: null, tb: -1, tn: 0, saveAt: 0, txt: {},
  nodes: [], sel: -1, undo: [], ver: 0, editAt: 0, drag: null, ref: null, refVer: -1, wk: null, wkBusy: false, nst: [], hnd: [], nmk: [], predDirty: false };
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
  FREE.on = true; FREE.paused = false; FREE.warp = q.warp || 1; FREE.pred = null; FREE.predAt = 0; FREE.trail = new Float64Array(3 * TRAIL_N); FREE.tn = 0; FREE.tb = -1; FREE.txt = {};
  FREE.nodes = (q.nodes || []).filter(nd => nd.t > q.t).map(nd => ({ t: nd.t, d: [...nd.d] })); FREE.sel = FREE.nodes.length ? 0 : -1; FREE.undo = []; FREE.ver++; FREE.ref = null; FREE.drag = null;
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
  flyEl('flyBar').hidden = false; flyEl('flyNode').hidden = false; flyBarSync(); flyPanel(); INS = null;
  return true;
}
function flyEnter() { const q = flyFromMission(); if (q) flyEnterState(q); }
function flyExit() {
  FREE.on = false; delete document.documentElement.dataset.fly; flyEl('flyBar').hidden = true; flyEl('flyNode').hidden = true;
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
  const s = FREE.st; writePref(FLY_SS, PREF_KEYS.flySnap, JSON.stringify({ t: s.t, r: s.r, v: s.v, m: s.m, warp: FREE.warp, nodes: FREE.nodes, at: Date.now() }));
}
addEventListener('pagehide', flySave);
function flyRestore() {
  const q = parseFlySnap(readPref(FLY_SS, PREF_KEYS.flySnap)); if (!q) return false;
  mapSys.P = mapSys.P || new Float64Array(3 * mapSys.N); mapSys.V = mapSys.V || new Float64Array(3 * mapSys.N);
  states(mapSys, q.t, mapSys.P, mapSys.V);
  const b = domBody(mapSys, mapSys.P, q.r[0], q.r[1], q.r[2]);
  return flyEnterState({ t: q.t, key: MAPK[b], r: [0, 1, 2].map(j => q.r[j] - mapSys.P[3 * b + j]), v: [0, 1, 2].map(j => q.v[j] - mapSys.V[3 * b + j]), m: q.m, warp: q.warp, nodes: q.nodes });
}
// one frame: advance (real seconds dt × warp), predict (twice a second, at once after an edit), draw the map at the
// flight's time and the craft over it, the nodes, the bar's and the panel's numbers
const FPR = new Float64Array(3);
function flyFrame(dt, v3, glow, now) {
  const s = FREE.st, P = mapSys.P, V = mapSys.V;
  if (!FREE.paused) flyAdvance(mapSys, s, Math.min(dt, 0.1) * FREE.warp, { rails: FREE.warp >= RAILS_W, maxSteps: 4000 });
  flyPast();
  states(mapSys, s.t, P, V);
  const b = domBody(mapSys, P, s.r[0], s.r[1], s.r[2]);
  if (b !== FREE.tb) { FREE.tb = b; FREE.tn = 0; FREE.pred = null; }
  if (FREE.tn === 0 || now - FREE.trailAt > 40) { // the trail, relative to the dominant body
    const k = FREE.tn % TRAIL_N; for (let j = 0; j < 3; j++) FREE.trail[3 * k + j] = s.r[j] - P[3 * b + j]; FREE.tn++; FREE.trailAt = now;
  }
  if (!FREE.pred || FREE.predDirty || now - FREE.predAt > 500) {
    FREE.pred = flyPredict(mapSys, s.t, s.r, s.v, { revs: 1, T: 30 * DAY, K: 120, nodes: FREE.nodes }); FREE.predAt = now; FREE.predDirty = false;
    FREE.nst = FREE.nodes.map(nd => flyNodeState(FREE.pred, nd.t));
    states(mapSys, s.t, P, V);
  }
  flyRefineAsk(now);
  if (now - FREE.saveAt > 2000) { FREE.saveAt = now; flySave(); }
  MAP.follow = b;
  if (v3) { flyLines3(b); drawMap3(s.t, glow, null, 0, 0); flyMark(b, true); flyNodes(true); }
  else { drawMap(s.t, glow, null, 0, 0); flyLines2(b); flyMark(b, false); flyNodes(false); if (!MAP.log) drawScale(); }
  flyBarTick(b);
  flyPanelTick();
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
// 2D: the path's segments (each about its body, drawn where that body is now) and the trail
function flyLines2(b) {
  states(mapSys, FREE.st.t, MP, MV);
  const o = [0, 0, 0], line = (pts, k0, n, bb) => { ctx.beginPath(); for (let k = k0; k < n; k++) { flyMapAt(bb, pts[3 * k], pts[3 * k + 1], pts[3 * k + 2], o); mapXY(o[0], o[1], o); const x = sx(o[0]), y = sy(o[1]); k > k0 ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const pa = flyPath(), t = FREE.st.t;
  ctx.setLineDash(pa.prov ? [6, 5] : []); ctx.lineWidth = 1.4;
  for (const g of pa.segs) { const k0 = Math.max(0, flyIdx(g, t) - 1); if (g.n - k0 < 2) continue; ctx.strokeStyle = hexA(flyAfter(g) ? COL.cyan : COL.traj, pa.prov ? 0.45 : 0.8); line(g.pts, k0, g.n, g.b); }
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
  const pa = flyPath(), t = FREE.st.t, segs = pa.segs.filter(g => flyIdx(g, t) < g.n);
  for (let k = 0; k < FLY_LINES; k++) {
    const g = segs[k]; if (!g) { V3.dynHide('map', 'flyP' + k); continue; }
    const m = put(g.pts, Math.max(0, flyIdx(g, t) - 1), g.n, g.b), c = linRGB(flyAfter(g) ? COL.cyan : COL.traj);
    for (let i = 0; i < m; i++) FLY3.col.set(c, 3 * i);
    V3.dynOpacity('map', 'flyP' + k, pa.prov ? 0.45 : 0.85);
    V3.dynSet('map', 'flyP' + k, B, m, FLY3.col, pa.prov ? 3 : 0);
  }
  const n = Math.min(FREE.tn, TRAIL_N);
  if (n > 1) { const T = new Float64Array(3 * n); for (let i = 0; i < n; i++) { const k = (FREE.tn - n + i) % TRAIL_N; T.set(FREE.trail.subarray(3 * k, 3 * k + 3), 3 * i); } V3.dynSet('map', 'flyTrail', B, put(T, 0, n, b, TRAIL_N + 2), null); }
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
  FREE.nodes = FREE.nodes.filter(nd => nd.t > t); FREE.sel = Math.min(FREE.sel, FREE.nodes.length - 1); if (FREE.sel < 0 && FREE.nodes.length) FREE.sel = 0;
  flyChanged();
}
// a time on the path under a screen point (within r px): the patched prediction's points, projected; null when none
function flyPathAt(px, py, r) {
  if (!FREE.pred) return null;
  const v3 = is3d(), t = FREE.st.t; let best = null;
  states(mapSys, t, MP, MV);
  for (const g of FREE.pred.segs) {
    let q = null;
    const step = Math.max(1, Math.floor(g.n / 600));
    for (let k = 0; k < g.n; k += step) {
      const P = flyScr(g.b, g.pts[3 * k], g.pts[3 * k + 1], g.pts[3 * k + 2], v3);
      if (P && q) {
        const dx = P[0] - q[0], dy = P[1] - q[1], l2 = dx * dx + dy * dy, f = l2 > 0 ? Math.max(0, Math.min(1, ((px - q[0]) * dx + (py - q[1]) * dy) / l2)) : 0, d = Math.hypot(q[0] + f * dx - px, q[1] + f * dy - py);
        if (d < r && (!best || d < best.d)) best = { d, t: g.ts[q[2]] + f * (g.ts[k] - g.ts[q[2]]) };
      }
      q = P ? [P[0], P[1], k] : null;
    }
  }
  return best && best.t > t + 1 ? best.t : null;
}
// a tap in free flight (app.js tap calls this first): a node's mark selects it, the path takes a new node
function flyTap(x, y, touch) {
  if (!FREE.on) return false;
  const rr = touch ? 16 : 10;
  for (const m of FREE.nmk) if (Math.hypot(m.x - x, m.y - y) < rr) { FREE.sel = m.i; flyPanel(); return true; }
  if (FREE.nodes.length >= FLY_NODES_MAX) return false;
  const t = flyPathAt(x, y, touch ? 18 : 9); if (t == null) return false;
  flyEdit(); FREE.nodes.push({ t, d: [0, 0, 0] }); FREE.nodes.sort((a, b) => a.t - b.t); FREE.sel = FREE.nodes.findIndex(nd => nd.t === t); flyChanged();
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
const flyDv = (p, fine) => (fine ? 0.1 : 1) * p * (1 + Math.abs(p) / 120); // m/s for p px along the handle
addEventListener('pointermove', e => {
  const D = FREE.drag; if (!D || e.pointerId !== D.id) return;
  e.stopImmediatePropagation();
  const [x, y] = flyDragAt(e), p = (x - D.x0) * D.ux + (y - D.y0) * D.uy, nd = FREE.nodes[FREE.sel]; if (!nd) return;
  nd.d[D.k] = Math.round((D.d0[D.k] + D.s * flyDv(p, e.shiftKey)) * 10) / 10;
  flyChanged();
}, true);
const flyDragEnd = e => { if (FREE.drag && e.pointerId === FREE.drag.id) { FREE.drag = null; FREE.editAt = performance.now(); e.stopImmediatePropagation(); } };
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
function flyPanelTick() {
  const n = FREE.nodes.length, sel = FREE.sel;
  if (sel < 0 || sel >= n) { flyTxt('fnHint', _(FREE.nodes.length ? 'fn.pick' : 'fn.hint')); return; }
  const nd = FREE.nodes[sel], dv = Math.hypot(...nd.d);
  flyTxt('fnIn', _('fn.in', { t: fmtDur(Math.max(0, nd.t - FREE.st.t), true) }));
  flyTxt('fnTot', _('fn.tot', { dv: NFdv.format(dv) }));
  const o = flyAfterOrbit(sel);
  flyTxt('fnAfter', !o ? '' : o.impact ? _('fn.impact', { body: _('body.' + MAPK[o.b]) }) : o.vinf != null ? _('fn.escape', { body: _('body.' + MAPK[o.b]), v: fmtSpeed(o.vinf) }) : _('fn.orbit', { body: _('body.' + MAPK[o.b]), pe: fmtDist(o.pe), ap: fmtDist(o.ap) }));
  flyTxt('fnProv', flyPath().prov ? _('fn.prov') : '');
}
FN_IN.forEach((id, k) => {
  flyEl(id).addEventListener('focus', () => { FREE.fieldUndo = false; });
  flyEl(id).addEventListener('input', e => {
    const nd = FREE.nodes[FREE.sel], v = parseFloat(String(e.target.value).replace(',', '.')); if (!nd || !Number.isFinite(v)) return;
    if (!FREE.fieldUndo) { flyEdit(); FREE.fieldUndo = true; } // one undo step per field visit
    nd.d[k] = Math.max(-1e5, Math.min(1e5, v)); flyChanged();
  });
});
flyEl('fnDel').addEventListener('click', () => flyDel());
flyEl('fnUndo').addEventListener('click', flyUndo);
flyEl('fnPrev').addEventListener('click', () => { if (FREE.sel > 0) { FREE.sel--; flyPanel(); } });
flyEl('fnNext').addEventListener('click', () => { if (FREE.sel < FREE.nodes.length - 1) { FREE.sel++; flyPanel(); } });

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
  if (!FREE.on || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const i = FLY_KEYS.indexOf(FREE.warp);
  if (e.key === '.' || e.key === ',') { e.preventDefault(); flyWarp(FLY_KEYS[Math.max(0, Math.min(FLY_KEYS.length - 1, i + (e.key === '.' ? 1 : -1)))]); }
  else if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); FREE.paused = !FREE.paused; flyBarSync(); }
  else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); flyUndo(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && FREE.sel >= 0) { e.preventDefault(); flyDel(); }
}, true);
