// 3D view mode (Phase 5): glue between the app state and the Three.js renderer. js/view3d.js (an ES module) and
// Three.js (vendor/three) are fetched with import() the first time the 3D mode is picked; the 2D modes never load
// them. Classic script loaded before app.js: declarations only, everything here runs once app.js is set up.
//
// Camera: orbits a target point (view-frame coordinates, metres) by yaw, elevation and distance; up is the frame's
// third axis Z (ecliptic north in the inertial view, the mission plane normal in the others). Elevation 90° looks
// straight down and matches the 2D view (screen x = frame x). The overlay — labels, event markers, hit targets,
// node marks, scale and caption — stays on the 2D canvas, projected here in float64 with the same camera.

const FOV3 = 45;                         // vertical field of view, degrees (view3d.js gets it at create)
const BIG_K = 200, BIG_PX = 40;          // size exaggeration: factor, and the on-screen radius (px) it stops at
const ROT3 = 0.006;                      // rad per px of drag
const V3S = { grid: true, big: false };  // view options (HUD)
let V3 = null, V3load = null, V3fail = false, V3sys = null, V3caps = null, MAP3 = null;
const CAM3 = { sim: cam3new(1e9), map: cam3new(7.5e11) };
function cam3new(dist) { return { t: [0, 0, 0], yaw: 0, elev: 55 * Math.PI / 180, dist, cx: null, cy: null }; }
const cam3 = () => (MAP.on ? CAM3.map : CAM3.sim);
const is3d = () => MODE === '3d' && !!V3;
// WebGL 2 is required by Three.js r163+
const GL2 = (() => {
  try {
    const g = document.createElement('canvas').getContext('webgl2'); if (!g) return false;
    const x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext();
    return true;
  } catch (e) { return false; }
})();

function load3d() {
  if (!V3load) {
    V3load = import(new URL('js/view3d.js', document.baseURI).href).then(m => {
      V3 = m.create(document.getElementById('gl'), { fov: FOV3, void: COL.void, grid: COL.cyan });
      return V3;
    });
    V3load.catch(() => { V3fail = true; V3load = null; });
  }
  return V3load;
}

// ---------- camera ----------
// right r, up u, target→camera d, eye e, focal length f (px), principal point (cx, cy)
const CB = { r: [1, 0, 0], u: [0, 1, 0], d: [0, 0, 1], e: [0, 0, 0], f: 1, cx: 0, cy: 0 };
function camBasis(c) {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), ce = Math.cos(c.elev), se = Math.sin(c.elev);
  const r = CB.r, u = CB.u, d = CB.d;
  r[0] = cy; r[1] = sy; r[2] = 0;
  d[0] = sy * ce; d[1] = -cy * ce; d[2] = se;
  u[0] = d[1] * r[2] - d[2] * r[1]; u[1] = d[2] * r[0] - d[0] * r[2]; u[2] = d[0] * r[1] - d[1] * r[0];
  for (let k = 0; k < 3; k++) CB.e[k] = c.t[k] + d[k] * c.dist;
  CB.f = (H / 2) / Math.tan(FOV3 * Math.PI / 360);
  CB.cx = c.cx == null ? W / 2 : c.cx; CB.cy = c.cy == null ? H / 2 : c.cy;
  return CB;
}
// screen position of view-frame point p (at offset o of an array): out = [x px, y px, depth m]; depth ≤ 0 is behind
function proj3(p, out, o = 0) {
  const b = CB, x = p[o] - b.e[0], y = p[o + 1] - b.e[1], z = p[o + 2] - b.e[2];
  const dep = -(x * b.d[0] + y * b.d[1] + z * b.d[2]);
  out[2] = dep;
  if (dep <= 0) { out[0] = out[1] = NaN; return out; }
  out[0] = b.cx + b.f * (x * b.r[0] + y * b.r[1] + z * b.r[2]) / dep;
  out[1] = b.cy - b.f * (x * b.u[0] + y * b.u[1] + z * b.u[2]) / dep;
  return out;
}
// drawn radius (m) of a body of radius R at depth dep: at least minPx on screen; exaggerated (optional) up to
// BIG_PX on screen and cap (a quarter of the nearest orbit around or of it)
function dispR(R, dep, minPx, cap) {
  const wpp = Math.max(dep, 1) / CB.f;
  let r = Math.max(R, minPx * wpp);
  if (V3S.big) r = Math.max(r, Math.min(BIG_K * R, BIG_PX * wpp, cap));
  return r;
}
// bodies drawn this frame, for hiding overlay items behind them: [x, y, z, r, id]
const OCC = [];
function behind3(p, o, skip) {
  const e = CB.e, vx = p[o] - e[0], vy = p[o + 1] - e[1], vz = p[o + 2] - e[2], L2 = vx * vx + vy * vy + vz * vz;
  for (const q of OCC) {
    if (q[4] === skip) continue;
    const t = ((q[0] - e[0]) * vx + (q[1] - e[1]) * vy + (q[2] - e[2]) * vz) / L2;
    if (t <= 0 || t >= 1) continue;
    const dx = e[0] + t * vx - q[0], dy = e[1] + t * vy - q[1], dz = e[2] + t * vz - q[2];
    if (dx * dx + dy * dy + dz * dz < q[3] * q[3]) return true;
  }
  return false;
}

// ---------- camera input ----------
function rot3(dx, dy) { const c = cam3(); c.yaw -= dx * ROT3; c.elev = clamp(c.elev + dy * ROT3, -Math.PI / 2, Math.PI / 2); }
function pan3(dx, dy) {
  const c = cam3(), b = camBasis(c), w = c.dist / b.f;
  for (let k = 0; k < 3; k++) c.t[k] += (-dx * b.r[k] + dy * b.u[k]) * w;
}
// nearest the camera may come to the target: outside a followed body
function minDist3() {
  if (MAP.on) return MAP.follow != null ? mapSys.R[MAP.follow] * 1.15 : 1e3;
  const i = S.follow === 'A' ? 0 : S.follow === 'B' ? 1 : S.follow[0] === 'b' ? +S.follow.slice(1) : -1;
  return sys && i >= 0 && i < sys.N ? sys.R[i] * 1.15 : 50;
}
// zoom by k about screen point (px, py): the point under it stays put while nothing is followed
function zoom3(px, py, k) {
  const c = cam3(), b = camBasis(c), nd = clamp(c.dist * k, minDist3(), 1e14), kk = nd / c.dist;
  const free = MAP.on ? MAP.follow == null : S.follow === 'free';
  if (free) {
    const w = c.dist / b.f, ox = (px - b.cx) * w, oy = -(py - b.cy) * w;
    for (let q = 0; q < 3; q++) c.t[q] += (ox * b.r[q] + oy * b.u[q]) * (1 - kk);
  }
  c.dist = nd;
}
// top-down view, as in 2D
function topView3() { const c = cam3(); c.yaw = 0; c.elev = Math.PI / 2; }
function key3(e) {
  if (!is3d() || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const a = 5 / (ROT3 * 180 / Math.PI); // 5° per press
  if (e.key === 'ArrowLeft') rot3(-a, 0); else if (e.key === 'ArrowRight') rot3(a, 0);
  else if (e.key === 'ArrowUp') rot3(0, -a); else if (e.key === 'ArrowDown') rot3(0, a);
  else if (e.key === '+' || e.key === '=') zoom3(W / 2, H / 2, 0.8);
  else if (e.key === '-' || e.key === '_') zoom3(W / 2, H / 2, 1.25);
  else return;
  sceneTouch();
  e.preventDefault();
}

// ---------- fitting ----------
// the free rectangle (or each one) where the target is centred and what fits: dist for a point set seen from the
// current direction; the rectangle showing it largest wins
function fitPoints3(pts, ctr, pad) {
  const c = CAM3.sim, b = camBasis(c);
  let best = null;
  for (const q of freeArea()) {
    const hw = Math.max(40, q.x1 - q.x0 - 20) / 2 * 0.94, hh = Math.max(40, q.y1 - q.y0 - 12) / 2 * 0.94;
    let dist = 0;
    for (const P of pts) {
      const n = P.length / 3, step = Math.max(1, Math.floor(n / 1500));
      for (let i = 0; i < n; i += step) {
        const x = P[3 * i] - ctr[0], y = P[3 * i + 1] - ctr[1], z = P[3 * i + 2] - ctr[2];
        const a = Math.abs(x * b.r[0] + y * b.r[1] + z * b.r[2]) + pad, v = Math.abs(x * b.u[0] + y * b.u[1] + z * b.u[2]) + pad, w = x * b.d[0] + y * b.d[1] + z * b.d[2];
        dist = Math.max(dist, w + b.f * a / hw, w + b.f * v / hh);
      }
    }
    if (!best || dist < best.dist * 0.97) best = { dist, q };
  }
  return best;
}
function fit3() {
  if (!C || W < 50 || H < 50) return;
  frameCache3(); INS = null;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const add = P => { for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { if (P[i + k] < lo[k]) lo[k] = P[i + k]; if (P[i + k] > hi[k]) hi[k] = P[i + k]; } };
  const pts = [C.f3, ...C.trk3.slice(0, 2), ...C.ring3];
  for (const P of pts) add(P);
  const ctr = lo.map((v, k) => (v + hi[k]) / 2), c = CAM3.sim;
  const best = fitPoints3(pts, ctr, Math.max(sys.R[0], sys.N > 1 ? sys.R[1] : 0) * 2);
  if (!best) return;
  const q = best.q;
  c.t = ctr; c.dist = Math.max(best.dist, minDist3()); c.cx = (q.x0 + q.x1) / 2; c.cy = (q.y0 + q.y1) / 2;
  FITQ = rectInsets(q);
  needFit = false;
}
// distance at which a sphere of radius rad fills ~42 % of the free area (target in its middle)
function frameRad3(c, rad, k = 0.42) {
  const { l, r, t, b } = insets(), f = (H / 2) / Math.tan(FOV3 * Math.PI / 360);
  c.dist = f * rad / (k * Math.max(40, Math.min(W - l - r, H - t - b)));
  c.cx = l + (W - l - r) / 2; c.cy = t + (H - t - b) / 2;
}
function followZoom3(k) {
  if (!sys || !(k < sys.N)) return;
  let rad = Math.min(sys.soi[k], 45 * sys.R[k]), moons = 0;
  for (let b = 0; b < sys.N; b++) if (sys.parent[b] === k) moons = Math.max(moons, 1.25 * sys.a[b]);
  frameRad3(CAM3.sim, moons || rad);
}

// ---------- mission view: frame-coordinate caches and their lines ----------
const EL3 = 128; // points per circle (simplified model, parking orbit)
function frameCache3() {
  const key = S.frame + '|' + C.pt.length + '|' + Q.trackK + '|' + Q.ellK;
  if (C.f3key === key) return;
  C.f3key = key;
  const n = C.pt.length, f3 = C.f3 = new Float64Array(3 * n), o = [0, 0, 0], NB = sys.N;
  for (let i = 0; i < n; i++) { frameAt(C.pt[i]); f3.set(tf3(C.px[i], C.py[i], C.pz[i], o), 3 * i); }
  const K = Q.trackK; C.trk3 = [];
  for (let b = 0; b < NB; b++) C.trk3.push(new Float64Array(3 * (K + 1)));
  for (let k = 0; k <= K; k++) { frameAt(C.T * k / K); for (let b = 0; b < NB; b++) C.trk3[b].set(tf3(SP[3 * b], SP[3 * b + 1], SP[3 * b + 2], o), 3 * k); }
  for (const m of C.markers) {
    frameAt(m.t); m.f3 = tf3(m.x, m.y, m.z, [0, 0, 0]);
    const bb = m.body || 0; m.bf3 = tf3(SP[3 * bb], SP[3 * bb + 1], SP[3 * bb + 2], [0, 0, 0]);
  }
  // orbits about their parents in the non-rotating frames (frame axes, parent-centred) and their nodes on the
  // reference plane; the craft path's nodes too (inertial frame: the ecliptic)
  frameAt(0);
  const X = FP.X, Y = FP.Y, Z = FP.Z, K2 = Q.ellK;
  C.ell3 = []; C.nodes3 = [];
  for (let b = 0; b < NB; b++) {
    const p = sys.parent[b];
    if (p < 0 || S.frame === 'rot') { C.ell3.push(null); continue; }
    let e;
    if (sys.real && sys.orb[b]) {
      const q = orbitPath(sys, b, S.M.t0 * DAY, K2); e = new Float64Array(3 * K2);
      for (let k = 0; k < K2; k++) { const x = q[3 * k], y = q[3 * k + 1], z = q[3 * k + 2]; e[3 * k] = x * X[0] + y * X[1] + z * X[2]; e[3 * k + 1] = x * Y[0] + y * Y[1] + z * Y[2]; e[3 * k + 2] = x * Z[0] + y * Z[1] + z * Z[2]; }
      planeNodes(e, K2, true, C.nodes3, b);
    } else { // simplified model: circles in the plane of motion
      const r = sys.a[b]; e = new Float64Array(3 * EL3);
      for (let k = 0; k < EL3; k++) { const a = 2 * Math.PI * k / EL3, x = r * Math.cos(a), y = r * Math.sin(a); e[3 * k] = x * X[0] + y * X[1]; e[3 * k + 1] = x * Y[0] + y * Y[1]; e[3 * k + 2] = x * Z[0] + y * Z[1]; }
    }
    C.ell3.push(e);
  }
  if (S.frame === 'inertial' || S.frame === 'eq') { const nd = []; planeNodes(f3, n, false, nd, -1); if (nd.length <= 12) C.nodes3.push(...nd); }
  // maneuvers: the initial and the target orbit about the body (frame axes; the frames do not turn)
  C.ring3 = C.rings.map(g => {
    const p = g.p, e = new Float64Array(p.length);
    for (let k = 0; k < p.length; k += 3) { const x = p[k], y = p[k + 1], z = p[k + 2]; e[k] = x * X[0] + y * X[1] + z * X[2]; e[k + 1] = x * Y[0] + y * Y[1] + z * Y[2]; e[k + 2] = x * Z[0] + y * Z[1] + z * Z[2]; }
    return e;
  });
  // size-exaggeration caps: a quarter of the nearest orbit around a body or of the body itself
  V3caps = new Float64Array(NB).fill(Infinity);
  for (let b = 0; b < NB; b++) { const p = sys.parent[b]; if (p < 0) continue; V3caps[b] = Math.min(V3caps[b], 0.25 * sys.a[b]); V3caps[p] = Math.min(V3caps[p], 0.25 * sys.a[b]); }
  if (V3) upload3();
}
// where a sampled curve (3 per point, frame axes) crosses the reference plane z = 0: ascending (z rising along
// the curve, the direction of motion) or descending; skipped for curves that stay in the plane
function planeNodes(e, n, closed, out, b) {
  let zmax = 0, ext = 0;
  for (let k = 0; k < n; k++) { zmax = Math.max(zmax, Math.abs(e[3 * k + 2])); ext = Math.max(ext, Math.abs(e[3 * k]), Math.abs(e[3 * k + 1])); }
  if (!(zmax > 1e-3 * ext)) return;
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const j = (k + 1) % n, z0 = e[3 * k + 2], z1 = e[3 * j + 2];
    if ((z0 < 0) === (z1 < 0) || z0 === z1) continue;
    const f = z0 / (z0 - z1);
    out.push({ b, asc: z1 > z0, p: [e[3 * k] + f * (e[3 * j] - e[3 * k]), e[3 * k + 1] + f * (e[3 * j + 1] - e[3 * k + 1]), 0] });
  }
}
function upload3() {
  V3.lineDropAll('sim', '');
  const n = C.pt.length, K = Q.trackK;
  V3.line('sim', 'path', C.f3, n, { color: COL.traj, opacity: 0.26, width: 1.2 });
  V3.line('sim', 'pathB', C.f3, n, { color: COL.traj, width: 1.8, glow: [6, 0.16] });
  for (let b = 0; b < sys.N; b++) {
    V3.line('sim', 'trk' + b, C.trk3[b], K + 1, { color: S.bodies[b].color, opacity: 0.38, width: 1.2 });
    const e = C.ell3[b];
    if (e) V3.line('sim', 'ell' + b, e, e.length / 3, { color: S.bodies[b].color, opacity: 0.22, width: 1, closed: true });
  }
  if (C.orbit && C.orbit.ring) { // the parking orbit around its body, ecliptic axes (turned into the frame each frame)
    V3.line('sim', 'park', C.orbit.ring, C.orbit.ring.length / 3, { color: COL.traj, opacity: 0.3, width: 1.2, closed: true });
  }
  C.ring3.forEach((e, g) => V3.line('sim', 'ring' + g, e, e.length / 3, { color: C.rings[g].col, opacity: C.rings[g].a, width: 1, closed: true }));
  // finite burns: the engine-on arcs, drawn up to the craft
  (C.burnIdx || []).forEach(([i0, i1], g) => { if (i1 > i0) V3.line('sim', 'burn' + g, C.f3.subarray(3 * i0, 3 * (i1 + 1)), i1 - i0 + 1, { color: COL.burn, width: 2.6 }); });
  V3.dyn('sim', 'conn', 2, { color: COL.traj, width: 1.8 });
  V3.dyn('sim', 'trail', TRAIL_REVS * QUALITY.normal.trailK + 4, { color: '#ffffff', vertexColors: true, additive: true, width: 1.6 });
  if (S.model === 'real' && S.frame === 'inertial') V3.line('sim', 'gamma', new Float64Array([0, 0, 0, 50 * AU, 0, 0]), 2, { color: COL.cyan, opacity: 0.3, width: 1 });
}
// sRGB hex → linear RGB (vertex colours)
function linRGB(hex) {
  const n = parseInt(hex.slice(1), 16), f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [f(n >> 16 & 255), f(n >> 8 & 255), f(n & 255)];
}

// grid spacing for the camera distance: two lattices (s, 10 s) cross-fading with the zoom
function grid3(c, on) {
  if (!on) { V3.gridSet(false); return; }
  const L = Math.log10(c.dist * 0.35), s = Math.pow(10, Math.floor(L)), f = L - Math.floor(L), A = 0.13;
  V3.gridSet(true, [c.t[0], c.t[1], 0], s, A * (1 - f), A * f);
}

const BP3 = new Float64Array(12), CR3 = [0, 0, 0], CR3b = [0, 0, 0], PJ = [0, 0, 0], PJ2 = [0, 0, 0], SUN3 = [0, 0, 0];
const ROT9 = new Float64Array(9);
let TRAIL3 = null, TRAIL3C = null;
// sun direction (frame axes, after frameAt) for body b: from the Sun in the mission, else (real model) from the map
// ephemeris, else a fixed upper-left light as in 2D. Used by the 2D globes too.
function sunDir3(b, sunIdx, tNow, out) {
  let x, y, z;
  if (sunIdx >= 0) { x = SP[3 * sunIdx] - SP[3 * b]; y = SP[3 * sunIdx + 1] - SP[3 * b + 1]; z = SP[3 * sunIdx + 2] - SP[3 * b + 2]; }
  else if (S.model === 'real') {
    states(mapSys, mapTime(tNow), MP, MV);
    const i = MAPK.indexOf(S.bodies[sys.root].key); x = -hx(i); y = -hy(i); z = -(MP[3 * i + 2] - MP[3 * MSUN + 2]);
  }
  if (x === undefined) { out[0] = -0.6; out[1] = 0.8; out[2] = 0.3; }
  else { out[0] = x * FP.X[0] + y * FP.X[1] + z * FP.X[2]; out[1] = x * FP.Y[0] + y * FP.Y[1] + z * FP.Y[2]; out[2] = x * FP.Z[0] + y * FP.Z[1] + z * FP.Z[2]; }
  const l = Math.hypot(out[0], out[1], out[2]) || 1; out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}
// how body b of the mission is drawn at rpx px: its look (js/globe.js) and axes in the view frame, or null
const AX = new Array(9);
function bodyLook3(b, rpx, tNow) {
  const look = globeLook(S.bodies[b].key, rpx, Q.tex, !lowQ, texCap(), FXON, S.M.t0 * DAY + tNow);
  if (!look) return null;
  bodyAxes(S.bodies[b].key, S.M.t0 * DAY + tNow, SP, SV, b, sys.parent[b], AX);
  return { look, rot: axesIn(FP.X, FP.Y, FP.Z, AX, new Array(9)), mix: texMix(look.tex && look.tex.base) };
}
// the sky (Milky Way, stars): handed to the renderer once loaded (modes with stars only)
function sky3() { if (Q.stars && !SCENE.wait) V3.skySet(skyReady(true, skyHi((H / 2) / Math.tan(FOV3 * Math.PI / 360) * Math.PI / 180))); }
// the Sun's glare at view-frame point p (or, far away, direction p from the camera when dir), disc radius rs px: how much
// of the disc is in view (9 points on it, against the bodies drawn this frame) and on screen; null when none
function glare3(p, dir, rs, skip) {
  if (!Q.glow || lowQ || !FXON.glare) return null;
  const e = CB.e, q = dir ? [e[0] + p[0] * 1e18, e[1] + p[1] * 1e18, e[2] + p[2] * 1e18] : p;
  proj3(q, PJ); if (!(PJ[2] > 0)) return null;
  const L = glareL(rs), x = PJ[0], y = PJ[1], out = Math.max(0, -x, x - W, -y, y - H);
  if (out > 4 * L) return null;
  // sample points on the disc: in front of every body drawn (the Sun itself excepted)
  const R = rs * PJ[2] / CB.f, pt = [0, 0, 0];
  let vis = 0;
  for (let k = 0; k < 9; k++) {
    const a = k * 0.785398, f = k ? 0.75 : 0;
    for (let c = 0; c < 3; c++) pt[c] = q[c] + R * f * (Math.cos(a) * CB.r[c] + Math.sin(a) * CB.u[c]);
    if (!behind3(pt, 0, skip)) vis++;
  }
  const i = vis / 9 * (1 - out / (4 * L));
  return i > 0 ? { x, y, L, i } : null;
}

function draw3d(tNow, craft, craft2, t2, pathIdx, ext, glow) {
  V3.setActive('sim');
  frameCache3();
  // caption first: its HUD box is an obstacle of the free area the fit uses
  if (V3S.grid) CAPTION.push(S.frame === 'eq' ? _('v3.gridEq', { name: S.bodies[0].name }) : S.frame === 'p0' || S.frame === 'p1' ? _('v3.gridOrbit')
    : _(S.frame !== 'inertial' ? 'v3.gridPlane' : S.model === 'real' ? 'v3.gridEcl' : 'v3.gridRef'));
  if (C.nodes3.length) CAPTION.push(_('v3.nodes'));
  setCaption();
  if (V3sys !== sys) { V3.bodies('sim', S.bodies.map(b => ({ color: b.key === 'sun' ? '#fff3d6' : b.color, sun: b.key === 'sun' }))); V3sys = sys; }
  sky3();
  if (needFit) fit3();
  if (ext) trailUpdate(S.ext);
  frameAt(t2); tf3(craft2[0], craft2[1], craft2[2], CR3b);
  frameAt(tNow); tf3(craft[0], craft[1], craft[2], CR3);
  const N = sys.N, c = CAM3.sim;
  for (let b = 0; b < N; b++) { BP3[3 * b] = 0; tf3(SP[3 * b], SP[3 * b + 1], SP[3 * b + 2], PJ); BP3[3 * b] = PJ[0]; BP3[3 * b + 1] = PJ[1]; BP3[3 * b + 2] = PJ[2]; }
  const fb = S.follow === 'A' ? 0 : S.follow === 'B' ? 1 : S.follow[0] === 'b' ? +S.follow.slice(1) : -1;
  if (S.follow === 'craft') c.t = [...CR3];
  else if (fb >= 0 && fb < N) c.t = [BP3[3 * fb], BP3[3 * fb + 1], BP3[3 * fb + 2]];
  c.dist = Math.max(c.dist, minDist3());
  const B = camBasis(c);
  V3.view(c.t, B.r, B.u, B.d, c.dist, B.cx, B.cy);
  const X = FP.X, Y = FP.Y, Z = FP.Z;
  ROT9[0] = X[0]; ROT9[1] = X[1]; ROT9[2] = X[2]; ROT9[3] = Y[0]; ROT9[4] = Y[1]; ROT9[5] = Y[2]; ROT9[6] = Z[0]; ROT9[7] = Z[1]; ROT9[8] = Z[2];

  // bodies
  const sunIdx = S.bodies.findIndex(b => b.key === 'sun'), rpx = new Float64Array(N), scr = [];
  if (sunIdx < 0) sunDir3(0, -1, tNow, SUN3);
  OCC.length = 0;
  for (let b = 0; b < N; b++) {
    proj3(BP3, PJ, 3 * b);
    const r = dispR(sys.R[b], PJ[2], b < 2 ? 5 : 4, V3caps[b]);
    const sd = sunIdx >= 0 ? sunDir3(b, sunIdx, tNow, [0, 0, 0]) : SUN3;
    rpx[b] = PJ[2] > 0 ? r * CB.f / PJ[2] : 0; scr.push([PJ[0], PJ[1], PJ[2]]);
    V3.body('sim', b, [BP3[3 * b], BP3[3 * b + 1], BP3[3 * b + 2]], r, sd, true, bodyLook3(b, rpx[b], tNow));
    if (b !== sunIdx && PJ[2] > 0) { const e = CB.e, vx = e[0] - BP3[3 * b], vy = e[1] - BP3[3 * b + 1], vz = e[2] - BP3[3 * b + 2], vl = Math.hypot(vx, vy, vz) || 1; skyLit(PJ[0], PJ[1], rpx[b], (sd[0] * vx + sd[1] * vy + sd[2] * vz) / vl, S.bodies[b].key, !!BODIES[S.bodies[b].key].rings); }
    OCC.push([BP3[3 * b], BP3[3 * b + 1], BP3[3 * b + 2], r, b]);
  }
  // lines
  V3.lineSet('sim', 'path', null, true);
  V3.lineSet('sim', 'pathB', null, true); V3.lineUpTo('sim', 'pathB', pathIdx); V3.lineGlow('sim', 'pathB', glow);
  if (!ext) V3.dynSet('sim', 'conn', [C.f3[3 * pathIdx], C.f3[3 * pathIdx + 1], C.f3[3 * pathIdx + 2], CR3[0], CR3[1], CR3[2]], 2, null);
  else V3.dynHide('sim', 'conn');
  for (let b = 0; b < N; b++) {
    V3.lineSet('sim', 'trk' + b, null, S.tracks);
    const p = sys.parent[b];
    if (C.ell3[b]) V3.lineSet('sim', 'ell' + b, [BP3[3 * p], BP3[3 * p + 1], BP3[3 * p + 2]], true);
  }
  if (C.orbit && C.orbit.ring) { const b = 3 * C.orbit.body; V3.lineSet('sim', 'park', [BP3[b], BP3[b + 1], BP3[b + 2]], ext, ROT9); }
  for (let g = 0; g < C.ring3.length; g++) V3.lineSet('sim', 'ring' + g, [BP3[0], BP3[1], BP3[2]], true);
  (C.burnIdx || []).forEach(([i0, i1], g) => { if (i1 > i0) { V3.lineSet('sim', 'burn' + g, null, pathIdx > i0); V3.lineUpTo('sim', 'burn' + g, Math.min(i1, pathIdx) - i0); } });
  V3.lineSet('sim', 'gamma', null, V3S.grid);
  if (ext) trail3(); else V3.dynHide('sim', 'trail');
  grid3(c, V3S.grid);
  // the Sun: in the mission, or (real model) far away along its direction from the first body
  const gl3 = sunIdx >= 0 ? glare3([BP3[3 * sunIdx], BP3[3 * sunIdx + 1], BP3[3 * sunIdx + 2]], false, rpx[sunIdx], sunIdx)
    : S.model === 'real' ? glare3(SUN3, true, CB.f * sunAngOf(S.bodies[0].key), -1) : null;
  if (gl3) skySun(gl3.i, sunIdx >= 0 ? rpx[sunIdx] : CB.f * sunAngOf(S.bodies[0].key));
  V3.render({ stars: Q.stars, sky: ROT9, skyGain: skyGain(), glare: glow ? gl3 : null });

  // ---- overlay ----
  // SOI
  if (S.soi) {
    ctx.setLineDash([1.5, 4]); ctx.strokeStyle = hexA(COL.dim, 0.5); ctx.lineWidth = 1;
    for (let b = 0; b < N; b++) {
      if (!isFinite(sys.soi[b]) || !(scr[b][2] > 0)) continue;
      const r = sys.soi[b] * CB.f / scr[b][2]; if (r < 3 || r > 1e5) continue;
      ctx.beginPath(); ctx.arc(scr[b][0], scr[b][1], r, 0, 6.2832); ctx.stroke();
      if (r > 30) { ctx.fillStyle = hexA(COL.dim, 0.7); ctx.font = '500 10px IBM Plex Mono, monospace'; ctx.fillText(_('canvas.soi'), scr[b][0] + r * 0.707 + 4, scr[b][1] - r * 0.707 - 4); }
    }
    ctx.setLineDash([]);
  }
  // end of the integrated mission, once reached
  if (S.u >= 1) {
    const e = C.pt.length - 1; proj3(C.f3, PJ, 3 * e);
    if (PJ[2] > 0 && !behind3(C.f3, 3 * e, -1)) { ctx.fillStyle = COL.traj; ctx.strokeStyle = 'rgba(4,6,11,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(PJ[0], PJ[1], 3.5, 0, 6.2832); ctx.fill(); ctx.stroke(); }
  }
  // nodes on the reference plane

  for (const nd of C.nodes3) {
    const p = nd.b < 0 ? nd.p : [nd.p[0] + BP3[3 * sys.parent[nd.b]], nd.p[1] + BP3[3 * sys.parent[nd.b] + 1], nd.p[2] + BP3[3 * sys.parent[nd.b] + 2]];
    proj3(p, PJ); if (!(PJ[2] > 0) || behind3(p, 0, -1) || PJ[0] < -10 || PJ[0] > W + 10 || PJ[1] < -10 || PJ[1] > H + 10) continue;
    nodeMark(PJ[0], PJ[1], nd.asc, nd.b < 0 ? COL.traj : S.bodies[nd.b].color);
  }
  // markers
  ctx.font = MARK_FONT;
  const placed = [];
  for (const m of C.markers) {
    proj3(m.f3, PJ); proj3(m.bf3, PJ2);
    if (!(PJ[2] > 0) || behind3(m.f3, 0, -1)) continue; // events lie on or above a surface: only far-side ones hide
    drawMark(m, PJ[0], PJ[1], PJ2[2] > 0 ? PJ2[0] : PJ[0], PJ2[2] > 0 ? PJ2[1] : PJ[1], m.t <= tNow + 1e-6, placed);
  }
  // body labels and hit targets
  ctx.font = LABEL_FONT;
  for (let b = 0; b < N; b++) {
    const [x, y, dep] = scr[b], r = rpx[b];
    if (!(dep > 0) || x + r < -60 || x - r > W + 60 || y + r < -60 || y - r > H + 60) continue;
    if (behind3(BP3, 3 * b, b)) continue;
    addHit('b', b, x, y, r);
    ctx.fillStyle = hexA(COL.ink, 0.82);
    ctx.fillText(S.bodies[b].name.toLocaleUpperCase(DICT['meta.locale']), x + Math.min(r, 400) * 0.72 + 7, y + Math.min(r, 400) * 0.72 + 12);
  }
  // craft
  proj3(CR3, PJ); proj3(CR3b, PJ2);
  if (PJ[2] > 0 && !behind3(CR3, 0, -1)) {
    const x = PJ[0], y = PJ[1];
    addHit('c', 0, x, y, 3.2);
    if (Q.glow) { const g = ctx.createRadialGradient(x, y, 0, x, y, 16); g.addColorStop(0, hexA(COL.traj, 0.6)); g.addColorStop(1, hexA(COL.traj, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.2832); ctx.fill(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.2832); ctx.fill();
    const td = !ext ? thrustNow(tNow, craft) : null;
    if (td) { // the thrust direction while the engine burns: a short step along it, projected
      const k = c.dist * 0.05, X = FP.X, Y = FP.Y, Z = FP.Z;
      const q = [CR3[0] + k * (td[0] * X[0] + td[1] * X[1] + td[2] * X[2]), CR3[1] + k * (td[0] * Y[0] + td[1] * Y[1] + td[2] * Y[2]), CR3[2] + k * (td[0] * Z[0] + td[1] * Z[1] + td[2] * Z[2])];
      proj3(q, PJ); if (PJ[2] > 0) arrow(x, y, PJ[0] - x, PJ[1] - y, COL.burn, 34);
    }
    const vx = PJ2[0] - x, vy = PJ2[1] - y, vl = Math.hypot(vx, vy);
    if (PJ2[2] > 0 && vl > 1e-6) {
      const ux = vx / vl, uy = vy / vl, L = 22;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x + ux * 6, y + uy * 6); ctx.lineTo(x + ux * L, y + uy * L); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + ux * L, y + uy * L); ctx.lineTo(x + ux * (L - 5) - uy * 3.5, y + uy * (L - 5) + ux * 3.5); ctx.lineTo(x + ux * (L - 5) + uy * 3.5, y + uy * (L - 5) - ux * 3.5); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
    }
  }
  if (V3S.grid && S.model === 'real' && S.frame === 'inertial') gammaLabel(c);
  // caption: what the grid shows, the node marks
  drawScale(CB.f / c.dist);
}
// the trail after capture (fading oldest revolutions), up to the craft
function trail3() {
  const tr = C.trail; if (!tr || tr.jHi < tr.jLo) { V3.dynHide('sim', 'trail'); return; }
  const i0 = tr.jLo - tr.base, i1 = tr.jHi - tr.base, n = i1 - i0 + 2, P = C.orbit.P;
  if (!TRAIL3 || TRAIL3.length < 3 * n) { TRAIL3 = new Float64Array(3 * n + 300); TRAIL3C = new Float32Array(3 * n + 300); }
  const col = linRGB(COL.traj);
  for (let j = 0; j < n - 1; j++) {
    const i = i0 + j, al = 0.9 * trailAlpha((S.ext - (tr.base + i) * tr.dts) / P, Q.trailFade);
    TRAIL3[3 * j] = tr.x[i]; TRAIL3[3 * j + 1] = tr.y[i]; TRAIL3[3 * j + 2] = tr.z[i];
    TRAIL3C[3 * j] = col[0] * al; TRAIL3C[3 * j + 1] = col[1] * al; TRAIL3C[3 * j + 2] = col[2] * al;
  }
  const j = n - 1; TRAIL3[3 * j] = CR3[0]; TRAIL3[3 * j + 1] = CR3[1]; TRAIL3[3 * j + 2] = CR3[2];
  TRAIL3C[3 * j] = col[0] * 0.9; TRAIL3C[3 * j + 1] = col[1] * 0.9; TRAIL3C[3 * j + 2] = col[2] * 0.9;
  V3.dynSet('sim', 'trail', TRAIL3, n, TRAIL3C);
}
// ascending (▲) / descending (▼) node mark
function nodeMark(x, y, asc, col) {
  const s = asc ? -1 : 1;
  ctx.fillStyle = hexA(col, 0.85); ctx.strokeStyle = 'rgba(4,6,11,0.9)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y + 4.5 * s); ctx.lineTo(x + 4.2, y - 3 * s); ctx.lineTo(x - 4.2, y - 3 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
}
// γ: the vernal equinox direction (+x of the ecliptic frame), labelled near the view
function gammaLabel(c) {
  const D = Math.min(50 * AU, Math.hypot(c.t[0], c.t[1], c.t[2]) + c.dist * 0.5);
  proj3([D, 0, 0], PJ);
  if (!(PJ[2] > 0) || PJ[0] < 0 || PJ[0] > W || PJ[1] < 0 || PJ[1] > H) return;
  ctx.font = LABEL_FONT; ctx.fillStyle = hexA(COL.cyan, 0.6); ctx.fillText(_('v3.equinox'), PJ[0] + 6, PJ[1] - 6);
}

// ---------- solar system map ----------
const mapXYZ = (x, y, z, out) => {
  if (MAP.log) { const r = Math.hypot(x, y, z), k = r > 0 ? AU * Math.log1p(r / LOG_R0) / r : 0; out[0] = x * k; out[1] = y * k; out[2] = z * k; }
  else { out[0] = x; out[1] = y; out[2] = z; }
  return out;
};
const hz = i => MP[3 * i + 2] - MP[3 * MSUN + 2];
function mapOffset3(t, out) {
  const r = sys.root, rk = MAPK.indexOf(S.bodies[r].key);
  states(sys, S.M.t0 * DAY + t, SPm, SVm);
  out[0] = hx(rk) - SPm[3 * r]; out[1] = hy(rk) - SPm[3 * r + 1]; out[2] = hz(rk) - SPm[3 * r + 2]; return out;
}
// the craft path, heliocentric (real model): as mapTraj, in 3D
function mapTraj3() {
  if (S.model !== 'real' || !C || !sys) { if (MAP3.trajC) { V3.lineDropAll('map', 'traj'); MAP3.trajC = null; } return null; }
  const key = MAP.log + '|' + C.pt.length;
  if (C.map3Key === key && MAP3.trajC === C) return C;
  const n = C.pt.length, K = 400, off = new Float64Array(3 * (K + 1)), o = [0, 0, 0];
  for (let k = 0; k <= K; k++) { const t = C.T * k / K; states(mapSys, S.M.t0 * DAY + t, MP, MV); off.set(mapOffset3(t, o), 3 * k); }
  const m3 = C.m3 = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const f = clamp(C.pt[i] / C.T * K, 0, K), k = Math.min(K - 1, Math.floor(f)), g = f - k;
    const ox = off[3 * k] + (off[3 * k + 3] - off[3 * k]) * g, oy = off[3 * k + 1] + (off[3 * k + 4] - off[3 * k + 1]) * g, oz = off[3 * k + 2] + (off[3 * k + 5] - off[3 * k + 2]) * g;
    m3.set(mapXYZ(C.px[i] + ox, C.py[i] + oy, C.pz[i] + oz, o), 3 * i);
  }
  C.map3Key = key; MAP3.trajC = C;
  V3.line('map', 'traj', m3, n, { color: COL.traj, opacity: 0.3, width: 1.2 });
  V3.line('map', 'trajB', m3, n, { color: COL.traj, width: 1.8 });
  return C;
}
// orbit outlines (cached per ~30 days): planets heliocentric (mapped), moons about their planet
function mapOrbits3(T) {
  const key = Math.round(T / (30 * DAY)) + '|' + MAP.log + '|' + Q.ellK;
  if (MAP3.orbKey === key) return;
  MAP3.orbKey = key;
  V3.lineDropAll('map', 'orb');
  const K = Q.ellK, o = [0, 0, 0], keyA = S.bodies[0] && S.bodies[0].key, keyB = S.bodies[1] && S.bodies[1].key;
  MAP3.nodes = [];
  for (let i = 0; i < mapSys.N; i++) {
    if (!mapSys.orb[i]) continue;
    const p = orbitPath(mapSys, i, T, K), moon = isMoon(i);
    if (!moon) for (let k = 0; k < K; k++) p.set(mapXYZ(p[3 * k], p[3 * k + 1], p[3 * k + 2], o), 3 * k);
    const k = MAPK[i], hi = k === keyA || k === keyB;
    V3.line('map', 'orb' + i, p, K, { color: BODIES[k].color, opacity: hi ? 0.5 : moon ? 0.18 : 0.28, width: 1, closed: true });
    if (!moon) planeNodes(p, K, true, MAP3.nodes, i);
  }
}
function fitMap3() {
  if (W < 50 || H < 50) return;
  states(mapSys, mapTime(tNowG), MP, MV);
  let R = 1.75 * AU;
  if (MAP.log) R = mapXY(31 * AU, 0, [0, 0])[0];
  else for (const b of S.bodies) { const i = MAPK.indexOf(b.key); if (i >= 0) R = Math.max(R, 1.2 * Math.hypot(hx(i), hy(i), hz(i))); }
  const c = CAM3.map; c.t = [0, 0, 0]; frameRad3(c, R, 0.47);
  MAP.follow = null; MAP.needFit = false;
}
function mapCenter3(i) {
  if (i === MSUN) { fitMap3(); return; }
  MAP.needFit = false; MAP.follow = i;
  if (MAP.log) return;
  states(mapSys, mapTime(tNowG), MP, MV);
  const a = q => Math.hypot(MP[3 * q] - MP[3 * MPAR[q]], MP[3 * q + 1] - MP[3 * MPAR[q] + 1], MP[3 * q + 2] - MP[3 * MPAR[q] + 2]);
  frameRad3(CAM3.map, MKIDS[i].length ? 1.4 * Math.max(...MKIDS[i].map(a)) : isMoon(i) ? 2.5 * a(i) : 0.3 * a(i), 0.47);
}
let MPOS3 = null;
function drawMap3(T, glow, craft, tNow, pathIdx) {
  V3.setActive('map');
  if (!MAP3) {
    MAP3 = { orbKey: '', trajC: null, nodes: [], caps: new Float64Array(mapSys.N).fill(Infinity) };
    V3.bodies('map', MAPK.map((k, i) => ({ color: i === MSUN ? '#fff3d6' : BODIES[k].color, sun: i === MSUN })));
    sky3();
    states(mapSys, MAP.today, MP, MV);
    for (let i = 0; i < mapSys.N; i++) { const p = MPAR[i]; if (p < 0) continue; const a = Math.hypot(MP[3 * i] - MP[3 * p], MP[3 * i + 1] - MP[3 * p + 1], MP[3 * i + 2] - MP[3 * p + 2]); MAP3.caps[i] = Math.min(MAP3.caps[i], 0.25 * a); MAP3.caps[p] = Math.min(MAP3.caps[p], 0.25 * a); }
  }
  const tr = mapTraj3(); // before the states below (it reuses MP)
  states(mapSys, T, MP, MV);
  const N = mapSys.N, pos = MPOS3 || (MPOS3 = new Float64Array(3 * N)), o = [0, 0, 0];
  for (let i = 0; i < N; i++) pos.set(mapXYZ(hx(i), hy(i), hz(i), o), 3 * i);
  mapOrbits3(T); // (cached) its node list goes into the caption, set before fitting
  CAPTION.push(...mapNotes(T));
  if (MAP3.nodes.length && !MAP.log && !SCENE.on) CAPTION.push(_('v3.nodes'));
  setCaption();
  if (MAP.needFit) fitMap3();
  const c = CAM3.map;
  if (MAP.follow != null) c.t = [pos[3 * MAP.follow], pos[3 * MAP.follow + 1], pos[3 * MAP.follow + 2]];
  if (SCENE.on) sceneAim3(pos, c);
  c.dist = Math.max(c.dist, minDist3());
  const B = camBasis(c);
  V3.view(c.t, B.r, B.u, B.d, c.dist, B.cx, B.cy);
  mapOrbits3(T);
  const keyA = S.bodies[0] && S.bodies[0].key, keyB = S.bodies[1] && S.bodies[1].key, moonsOn = MAP.moons && !MAP.log;
  // a moon is shown (linear scale only) once its orbit is a few pixels across
  const scr = [], rpx = new Float64Array(N), show = new Uint8Array(N);
  OCC.length = 0;
  for (let i = 0; i < N; i++) {
    proj3(pos, PJ, 3 * i); scr.push([PJ[0], PJ[1], PJ[2]]);
    const moon = isMoon(i), p = MPAR[i];
    const orbPx = moon && PJ[2] > 0 ? Math.hypot(MP[3 * i] - MP[3 * p], MP[3 * i + 1] - MP[3 * p + 1], MP[3 * i + 2] - MP[3 * p + 2]) * CB.f / PJ[2] : 0;
    show[i] = !moon || (moonsOn && orbPx > 5);
    const floor = i === MSUN ? 4.5 : moon ? 1.6 : 2.6;
    const r = MAP.log ? floor * Math.max(PJ[2], 1) / CB.f : dispR(mapSys.R[i] * (SCENE.on && SCENE.free ? 1 : SCENE.k3), PJ[2], floor, MAP3.caps[i]);
    const l = Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]) || 1;
    rpx[i] = PJ[2] > 0 ? r * CB.f / PJ[2] : 0;
    const look = show[i] ? globeLook(MAPK[i], rpx[i], Q.tex, !lowQ, texCap(), FXON, T) : null; // map axes are the ecliptic ones
    const o = look ? { look, rot: bodyAxes(MAPK[i], T, MP, MV, i, MPAR[i], new Array(9)), mix: texMix(look.tex && look.tex.base) } : null;
    V3.body('map', i, [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], r, i === MSUN ? null : [-pos[3 * i] / l, -pos[3 * i + 1] / l, -pos[3 * i + 2] / l], !!show[i], o);
    if (show[i]) OCC.push([pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], r, i]);
    if (show[i] && i !== MSUN && PJ[2] > 0) { const e = CB.e, vx = e[0] - pos[3 * i], vy = e[1] - pos[3 * i + 1], vz = e[2] - pos[3 * i + 2]; skyLit(PJ[0], PJ[1], rpx[i], -(pos[3 * i] * vx + pos[3 * i + 1] * vy + pos[3 * i + 2] * vz) / (l * (Math.hypot(vx, vy, vz) || 1)), MAPK[i], !!BODIES[MAPK[i]].rings); }
    if (mapSys.orb[i]) V3.lineSet('map', 'orb' + i, moon ? [pos[3 * p], pos[3 * p + 1], pos[3 * p + 2]] : null, !!show[i] && (moon || !SCENE.on));
  }
  if (tr && craft) { V3.lineSet('map', 'traj', null, true); V3.lineSet('map', 'trajB', null, true); V3.lineUpTo('map', 'trajB', pathIdx); }
  grid3(c, V3S.grid && !MAP.log && !SCENE.on); // the opening scene stays clean: no grid, no node marks
  sky3();
  const glm = glow ? glare3([pos[3 * MSUN], pos[3 * MSUN + 1], pos[3 * MSUN + 2]], false, rpx[MSUN], MSUN) : null;
  if (glm) skySun(glm.i, rpx[MSUN]);
  V3.render({ stars: Q.stars, sky: null, skyGain: skyGain(), glare: glm });

  // overlay: nodes, craft, labels (Sun and planets first, a label overlapping another is skipped)

  if (!MAP.log && !SCENE.on) for (const nd of MAP3.nodes) {
    proj3(nd.p, PJ); if (!(PJ[2] > 0) || behind3(nd.p, 0, -1) || PJ[0] < -10 || PJ[0] > W + 10 || PJ[1] < -10 || PJ[1] > H + 10) continue;
    nodeMark(PJ[0], PJ[1], nd.asc, BODIES[MAPK[nd.b]].color);
  }
  if (tr && craft) {
    mapOffset3(tNow, o); const p = mapXYZ(craft[0] + o[0], craft[1] + o[1], craft[2] + o[2], [0, 0, 0]); proj3(p, PJ);
    if (PJ[2] > 0) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(PJ[0], PJ[1], 3, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = COL.traj; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(PJ[0], PJ[1], 6, 0, 6.2832); ctx.stroke();
    }
  }
  ctx.font = LABEL_FONT;
  const placed = [], fits = (x, y, w) => !placed.some(q => x < q[0] + q[2] + 4 && x + w + 4 > q[0] && Math.abs(y - q[1]) < 13);
  const order = [...Array(N).keys()].sort((p, q) => isMoon(p) - isMoon(q));
  for (const i of order) {
    if (!show[i]) continue;
    const [x, y, dep] = scr[i], r = rpx[i], k = MAPK[i], moon = isMoon(i);
    if (!(dep > 0) || x < -40 || x > W + 40 || y < -40 || y > H + 40 || behind3(pos, 3 * i, i)) continue;
    addHit('m', i, x, y, r);
    if ((k === keyA || k === keyB) && !SCENE.on) { ctx.strokeStyle = k === keyA ? COL.traj : COL.orbit; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 6.2832); ctx.stroke(); }
    if (moon && (!Q.glow || (dep > 0 && Math.hypot(MP[3 * i] - MP[3 * MPAR[i]], MP[3 * i + 1] - MP[3 * MPAR[i] + 1]) * CB.f / dep < 22))) continue;
    const txt = _('body.' + k).toLocaleUpperCase(DICT['meta.locale']), w = ctx.measureText(txt).width;
    const lx = x + Math.min(r, 400) * 0.72 + 6, ly = y + 4;
    if (!fits(lx, ly, w)) continue;
    placed.push([lx, ly, w]);
    ctx.fillStyle = hexA(COL.ink, moon ? 0.6 : 0.85); ctx.fillText(txt, lx, ly);
  }
  if (!MAP.log) drawScale(CB.f / c.dist);
}

// ---------- HUD ----------
function sync3dUI() {
  const on = MODE === '3d';
  $('#gl').hidden = !on || !V3;
  for (const s of ['#sizeSeg', '#topView', '#tGridWrap']) $(s).hidden = !on;
  setSeg('#sizeSeg', V3S.big ? 'big' : 'real');
  const b = $('#viewMode button[data-v="3d"]');
  b.setAttribute('aria-disabled', String(!GL2 || V3fail));
  b.title = _(!GL2 ? 'mode.noGL' : V3fail ? 'mode.failTip' : 'mode.3dTip');
}
function bind3d() {
  $('#sizeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; V3S.big = b.dataset.v === 'big'; sync3dUI(); });
  $('#topView').addEventListener('click', topView3);
  $('#tGrid').addEventListener('change', e => { V3S.grid = e.target.checked; });
  document.addEventListener('keydown', key3);
  cv.addEventListener('contextmenu', e => { if (is3d()) e.preventDefault(); });
  sync3dUI();
}
