// Cabin art pipeline (Phase 9): turns the illustration (master.png) and the cat cut-out (cat.png) into the layers
// kabin.html draws, as WebP tiers + layout.json. Not part of the site; needs sharp, installed outside the repo
// (see README.md). Every coordinate below is in master pixels (7136 × 3528) and was measured on these two files.
//
//   node tools/cabin-art/build.js --in <dir with master.png and cat.png> --out img/cabin [--preview <dir>]
//
// Steps: glass → transparent (aquarium and hanging-plant leaves stay in front); cat removed from the sill (shifted wood
// texture with per-row alignment + Poisson correction; its contact shadow kept as a separate layer); clock and laptop
// screens blanked flat; card, poster texts and the painted fish/bubbles erased (harmonic / vertical interpolation);
// poster panel and photo area blanked; cat split into body, tail and ears.
'use strict';
const path = require('path'), fs = require('fs');
const { createRequire } = require('module');
const sharp = createRequire(path.join(process.cwd(), 'x.js'))('sharp');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const IN = arg('in', 'img/cabin/art'), OUT = arg('out', 'img/cabin'), PREV = arg('preview', null);
const TIERS = [1600, 2560, 3840, 7136];

// ---- measured geometry --------------------------------------------------------------------------------------------
// Glass: inner edge of the gasket line. Straight sides + one elliptic corner each (the painting is not symmetric).
const GLASS = { x0: 1797, x1: 5420, y0: 246, y1: 2092, inset: 2.5,
  c: { TL: [2052, 506], TR: [5164.5, 511], BL: [2017, 1869], BR: [5190, 1861] } };
const AQUA = { lid: [2351, 1835, 3048, 1876, 8], tank: [2366, 1870, 3034, 2200, 1] };   // x0 y0 x1 y1 r
const LEAVES = [4990, 1830, 5425, 2095];                  // hanging plant over the glass, bottom right
const CAT_AT = [4018, 1401];                              // cat.png placed at scale 1 (SSD fit, RMS ≈ 1.8 / channel)
const SILL_SHIFT = -765;                                  // wood source offset (puts the panel seam behind the tail)
const CLOCK = { x0: 5030, y0: 2587, x1: 5614, y1: 2789, r: 26, col: [28, 22, 26] };
const LAPTOP = { quad: [[6556, 1999], [7136, 2009], [7136, 2930], [6370, 2862]], col: [25, 24, 30] };
const CARD = [[4110, 2816], [4770, 2772], [4965, 2958], [4235, 3013]];
// painted fish and bubble rings in the aquarium (boxes); erased by vertical interpolation (keeps seaweed stems)
const FISH = [[2498, 1958, 2602, 2014], [2536, 2108, 2614, 2148], [2836, 2060, 2932, 2110],
  [2840, 1920, 2866, 1948], [2880, 2008, 2904, 2034], [2852, 2120, 2882, 2148], [2882, 2110, 2900, 2130]];
const POSTER_L = { panel: [[1013, 475], [1465, 470], [1466, 970], [1015, 971]], text: [[995, 352, 1482, 466], [995, 978, 1482, 1062]] };
const POSTER_R = { photo: [[5790, 543], [6429, 535], [6439, 1184], [5795, 1187]], text: [[5815, 1200, 6430, 1305]] };
// cat.png coordinates: tail cut along the hip ellipse, ears cut along their base lines
const TAIL = { cx: 440, cy: 820, rx: 150, ry: 100, zone: [455, 857], root: 34, pivot: [548, 893] };
const EARS = { l: { p: [300, 200], q: [205, 255], box: [185, 85, 306, 262], root: 14, pivot: [258, 232] },
  r: { p: [395, 197], q: [492, 257], box: [389, 85, 515, 262], root: 14, pivot: [444, 236] } };

// ---- helpers ------------------------------------------------------------------------------------------------------
// JSON with number arrays kept on one line
const compact = o => { let j = JSON.stringify(o, null, 1), k; do { k = j; j = j.replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (m, a) => '[' + a.replace(/\s+/g, ' ') + ']'); } while (j !== k); return j; };
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
async function load(p) { const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: data, w: info.width, h: info.height }; }
const raw = (b, w, h) => sharp(b, { raw: { width: w, height: h, channels: 4 } });
// signed distance to a convex quad (clockwise in image coords), > 0 inside
function quadD(q, x, y) { let d = 1e9; for (let i = 0; i < 4; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4]; d = Math.min(d, ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay)); } return d; }
// rounded rect, > 0 inside
const rrD = (x, y, x0, y0, x1, y1, r) => r - Math.hypot(Math.max(x0 + r - x, 0, x - (x1 - r)), Math.max(y0 + r - y, 0, y - (y1 - r)));
function glassD(x, y) {
  const { x0, x1, y0, y1, c } = GLASS; let d = Math.min(x - x0, x1 - x, y - y0, y1 - y);
  const corner = (cx, cy, sx, sy) => {
    const dx = (x - cx) * sx, dy = (y - cy) * sy; if (dx <= 0 || dy <= 0) return null;
    const rx = sx < 0 ? cx - x0 : x1 - cx, ry = sy < 0 ? cy - y0 : y1 - cy;
    const k = Math.hypot(dx / rx, dy / ry), g = Math.hypot(dx / (rx * rx), dy / (ry * ry)); return (1 - k) * k / g;
  };
  const q = corner(...c.TL, -1, -1) ?? corner(...c.TR, 1, -1) ?? corner(...c.BL, -1, 1) ?? corner(...c.BR, 1, 1);
  return (q ?? d) - GLASS.inset;
}
// Laplace fill of hole pixels (indices into an RGBA buffer of width W) from their non-hole neighbours (SOR)
function harmonic(R, W, idx, hole, iters = 4000) {
  const F = new Float32Array(idx.length * 3), at = new Map(); idx.forEach((p, k) => at.set(p, k));
  const nb = [1, -1, W, -W]; let m = [0, 0, 0], n = 0;
  for (const p of idx) for (const o of nb) if (!hole[p + o]) { n++; for (let c = 0; c < 3; c++) m[c] += R[(p + o) * 4 + c]; }
  for (let k = 0; k < idx.length; k++) for (let c = 0; c < 3; c++) F[k * 3 + c] = n ? m[c] / n : 0;
  const ki = idx.map(p => nb.map(o => hole[p + o] ? at.get(p + o) : -1 - (p + o)));
  for (let it = 0; it < iters; it++) {
    let md = 0;
    for (let k = 0; k < idx.length; k++) for (let c = 0; c < 3; c++) {
      let s = 0; for (const q of ki[k]) s += q >= 0 ? F[q * 3 + c] : R[(-1 - q) * 4 + c];
      const v = F[k * 3 + c] + 1.9 * (s / 4 - F[k * 3 + c]); md = Math.max(md, Math.abs(v - F[k * 3 + c])); F[k * 3 + c] = v;
    }
    if (md < 0.01) break;
  }
  idx.forEach((p, k) => { for (let c = 0; c < 3; c++) R[p * 4 + c] = Math.round(F[k * 3 + c]); });
}
// dark strokes on bright paper inside rect [x0,y0,x1,y1] (and inside quad if given) → hole mask, dilated by `dil`
function inkHole(R, W, rect, quad, thr = 22, dil = 3, rad = 9) {
  const [x0, y0, x1, y1] = rect, w = x1 - x0, h = y1 - y0, lum = new Float32Array(w * h);
  const ok = (x, y) => !quad || quadD(quad, x + .5, y + .5) > 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + y0) * W + x + x0) * 4; lum[y * w + x] = 0.3 * R[i] + 0.55 * R[i + 1] + 0.15 * R[i + 2]; }
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!ok(x + x0, y + y0)) continue; let mx = 0;
    for (let dy = -rad; dy <= rad; dy += 3) for (let dx = -rad; dx <= rad; dx += 3) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) mx = Math.max(mx, lum[yy * w + xx]); }
    if (lum[y * w + x] < mx - thr) ink[y * w + x] = 1;
  }
  const hole = new Uint8Array(W * (y1 + dil + 2)), idx = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[y * w + x])
    for (let dy = -dil; dy <= dil; dy++) for (let dx = -dil; dx <= dil; dx++) {
      const X = x + x0 + dx, Y = y + y0 + dy; if (X < x0 || Y < y0 || X >= x1 || Y >= y1 || !ok(X, Y)) continue;
      const p = Y * W + X; if (!hole[p]) { hole[p] = 1; idx.push(p); }
    }
  return { hole, idx };
}

(async () => {
  const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
  const M = await load(path.join(IN, 'master.png')), C = await load(path.join(IN, 'cat.png'));
  const W = M.w, H = M.h; if (W !== 7136 || H !== 3528) throw new Error('master.png must be 7136×3528');
  const R = Buffer.from(M.d);                         // the room, edited in place
  const A = new Uint8Array(W * H).fill(255);          // room alpha (0 = see-through glass)

  // 1. glass ---------------------------------------------------------------------------------------------------------
  for (let y = 200; y < 2140; y++) for (let x = 1740; x < 5470; x++) { const d = glassD(x + .5, y + .5); if (d > -0.5) A[y * W + x] = Math.round(255 * (1 - Math.min(1, d + 0.5))); }
  for (let y = 1825; y < 2100; y++) for (let x = 2340; x < 3060; x++) {
    const d = Math.max(rrD(x + .5, y + .5, ...AQUA.lid), rrD(x + .5, y + .5, ...AQUA.tank));
    if (d > -0.5) A[y * W + x] = Math.max(A[y * W + x], Math.round(255 * Math.min(1, d + 0.5)));
  }
  { // leaves: olive/yellow against near-black; components ≥ 400 px, holes filled, soft edge from the score
    const [X0, Y0, X1, Y1] = LEAVES, w = X1 - X0, h = Y1 - Y0, S = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + Y0) * W + x + X0) * 4; S[y * w + x] = Math.max(M.d[i], M.d[i + 1]) - 0.6 * M.d[i + 2]; }
    const keep = new Uint8Array(w * h), lab = new Uint8Array(w * h), N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let s = 0; s < w * h; s++) {
      if (S[s] <= 20 || lab[s]) continue; const st = [s], comp = []; lab[s] = 1;
      while (st.length) { const p = st.pop(); comp.push(p); const px = p % w, py = (p / w) | 0; for (const [dx, dy] of N4) { const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; const q = qy * w + qx; if (S[q] > 20 && !lab[q]) { lab[q] = 1; st.push(q); } } }
      if (comp.length >= 400) for (const p of comp) keep[p] = 1;
    }
    const bg = new Uint8Array(w * h), st = [];
    for (let x = 0; x < w; x++) if (!keep[x]) { bg[x] = 1; st.push(x); }
    for (let y = 0; y < h; y++) if (!keep[y * w] && !bg[y * w]) { bg[y * w] = 1; st.push(y * w); }
    while (st.length) { const p = st.pop(); const px = p % w, py = (p / w) | 0; for (const [dx, dy] of N4) { const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; const q = qy * w + qx; if (!keep[q] && !bg[q]) { bg[q] = 1; st.push(q); } } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; let a = 0;
      if (!bg[p]) a = 1;
      else { let near = 0; for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) { const qx = x + dx, qy = y + dy; if (qx >= 0 && qy >= 0 && qx < w && qy < h && !bg[qy * w + qx]) { near = 1; break; } } if (near) a = clamp01((S[p] - 8) / 14); }
      if (a > 0) { const i = (y + Y0) * W + x + X0; A[i] = Math.max(A[i], Math.round(255 * a)); }
    }
  }
  log('glass');

  // 2. cat off the sill -----------------------------------------------------------------------------------------------
  const ca = (x, y) => { x -= CAT_AT[0]; y -= CAT_AT[1]; return x < 0 || y < 0 || x >= C.w || y >= C.h ? 0 : C.d[(y * C.w + x) * 4 + 3]; };
  const shadow = new Uint8Array(W * H);
  {
    const OX = CAT_AT[0], OY = CAT_AT[1], X0 = OX - 40, X1 = OX + C.w + 40, Y0 = OY - 10, Y1 = OY + C.h + 30, GROW = 16, T = 26;
    const dist = new Float32Array(W * H).fill(1e9);
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) if (ca(x, y) > 0) dist[y * W + x] = 0;
    for (let y = Y0 + 1; y < Y1; y++) for (let x = X0 + 1; x < X1 - 1; x++) { const p = y * W + x; dist[p] = Math.min(dist[p], dist[p - 1] + 1, dist[p - W] + 1, dist[p - W - 1] + 1.414, dist[p - W + 1] + 1.414); }
    for (let y = Y1 - 2; y >= Y0; y--) for (let x = X1 - 2; x > X0; x--) { const p = y * W + x; dist[p] = Math.min(dist[p], dist[p + 1] + 1, dist[p + W] + 1, dist[p + W + 1] + 1.414, dist[p + W - 1] + 1.414); }
    const hole = new Uint8Array(W * H);
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const p = y * W + x; if (A[p] === 255 && dist[p] <= 6) hole[p] = 1; }
    const lum = p => 0.3 * M.d[p * 4] + 0.55 * M.d[p * 4 + 1] + 0.15 * M.d[p * 4 + 2];
    const map = new Int32Array(H).map((_, y) => y);
    const spans = y => { const s = []; let x = X0; while (x < X1) { if (!hole[y * W + x]) { x++; continue; } const L = x; while (hole[y * W + x]) x++; s.push([L, x - 1]); } return s; };
    // source row per hole row: DP over offsets ±4 matching values and vertical gradients next to the hole
    const rowmap = () => {
      const N = Y1 - Y0, K = 4, NC = 2 * K + 1, cost = new Float32Array(N * NC);
      for (let k = 0; k < N; k++) {
        const y = Y0 + k, cx = [];
        for (const [L, Rr] of spans(y)) { for (let x = L - 16; x < L - 2; x++) cx.push(x); for (let x = Rr + 3; x < Rr + 17; x++) cx.push(x); }
        const ctx = cx.filter(x => A[y * W + x] === 255 && !hole[y * W + x]);
        for (let j = 0; j < NC; j++) {
          const ys = y + j - K; let e = 0;
          for (const x of ctx) { const p = y * W + x, q = ys * W + x + SILL_SHIFT; let d = 0; for (let c = 0; c < 3; c++) d += Math.abs(M.d[p * 4 + c] - M.d[q * 4 + c]) + 2 * Math.abs((M.d[(p + W) * 4 + c] - M.d[(p - W) * 4 + c]) - (M.d[(q + W) * 4 + c] - M.d[(q - W) * 4 + c])); e += Math.min(d, 400); }
          cost[k * NC + j] = ctx.length ? e / ctx.length : 0;
        }
      }
      const acc = new Float32Array(N * NC), bk = new Int8Array(N * NC);
      for (let j = 0; j < NC; j++) acc[j] = cost[j] + Math.abs(j - K) * 0.5;
      for (let k = 1; k < N; k++) for (let j = 0; j < NC; j++) {
        let best = 1e18, bj = 0; for (const dj of [-1, 0, 1]) { const jj = j + dj; if (jj < 0 || jj >= NC) continue; const v = acc[(k - 1) * NC + jj] + (dj ? 40 : 0); if (v < best) { best = v; bj = jj; } }
        acc[k * NC + j] = best + cost[k * NC + j]; bk[k * NC + j] = bj;
      }
      let j = 0, b = 1e18; for (let jj = 0; jj < NC; jj++) if (acc[(N - 1) * NC + jj] < b) { b = acc[(N - 1) * NC + jj]; j = jj; }
      for (let k = N - 1; k >= 0; k--) { map[Y0 + k] = Y0 + k + j - K; j = bk[k * NC + j]; }
    };
    const S = (p, c) => { const x = p % W, y = (p / W) | 0; return M.d[(map[y] * W + x + SILL_SHIFT) * 4 + c]; };
    const Sl = p => 0.3 * S(p, 0) + 0.55 * S(p, 1) + 0.15 * S(p, 2);
    // grow the hole over contact shadow and fur tips that differ from the wood source
    for (let g = 0; g < 4; g++) {
      rowmap(); const cand = [];
      for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const p = y * W + x; if (hole[p] || A[p] !== 255 || dist[p] > GROW) continue; if (!(hole[p + 1] || hole[p - 1] || hole[p + W] || hole[p - W])) continue; if (Math.abs(lum(p) - Sl(p)) > T) cand.push(p); }
      for (const p of cand) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const q = p + dx + dy * W; if (!hole[q] && A[q] === 255 && dist[q] <= GROW + 2) hole[q] = 1; }
    }
    rowmap();
    const idx = []; for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) if (hole[y * W + x]) idx.push(y * W + x);
    // Poisson: correction D harmonic, D = M − S on opaque boundary, Neumann towards the glass
    const D = new Float32Array(W * H * 3), nb = [1, -1, W, -W];
    for (let it = 0; it < 5000; it++) {
      let md = 0;
      for (const p of idx) for (let c = 0; c < 3; c++) {
        let s = 0, n = 0; for (const o of nb) { const q = p + o; if (hole[q]) { s += D[q * 3 + c]; n++; } else if (A[q] === 255) { s += M.d[q * 4 + c] - S(q, c); n++; } }
        if (n) { const k = p * 3 + c, v = D[k] + 1.94 * (s / n - D[k]); md = Math.max(md, Math.abs(v - D[k])); D[k] = v; }
      }
      if (md < 0.005) break;
    }
    for (const p of idx) for (let c = 0; c < 3; c++) R[p * 4 + c] = Math.max(0, Math.min(255, Math.round(S(p, c) + D[p * 3 + c])));
    for (const p of idx) { if (ca(p % W, (p / W) | 0) > 0) continue; const lf = 0.3 * R[p * 4] + 0.55 * R[p * 4 + 1] + 0.15 * R[p * 4 + 2]; if (lf > 1) shadow[p] = Math.round(255 * (1 - Math.min(1, lum(p) / lf))); }
  }
  log('cat removed');

  // 3. screens, card, posters, aquarium -------------------------------------------------------------------------------
  const paint = (i, cov, col) => { for (let c = 0; c < 3; c++) R[i * 4 + c] = Math.round(R[i * 4 + c] * (1 - cov) + col[c] * cov); };
  for (let y = CLOCK.y0 - 3; y <= CLOCK.y1 + 3; y++) for (let x = CLOCK.x0 - 3; x <= CLOCK.x1 + 3; x++) {
    const cov = clamp01(rrD(x + .5, y + .5, CLOCK.x0, CLOCK.y0, CLOCK.x1, CLOCK.y1, CLOCK.r) / 1.5 + 0.5); if (cov > 0) paint(y * W + x, cov, CLOCK.col);
  }
  for (let y = 1990; y < 2940; y++) for (let x = 6360; x < W; x++) {
    const d = quadD(LAPTOP.quad, x + .5, y + .5) - 3; const cov = x === W - 1 && d > -2 ? 1 : clamp01(d / 1.5 + 0.5); if (cov > 0) paint(y * W + x, cov, LAPTOP.col);
  }
  { const { hole, idx } = inkHole(R, W, [4100, 2765, 4975, 3020], CARD); harmonic(R, W, idx, hole); }
  for (const [x0, y0, x1, y1] of [...POSTER_L.text, ...POSTER_R.text]) {   // plain paper: the whole text box, from its rim
    const hole = new Uint8Array(W * H), idx = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hole[y * W + x] = 1; idx.push(y * W + x); }
    harmonic(R, W, idx, hole, 6000);
  }
  for (const q of [POSTER_L.panel, POSTER_R.photo]) {   // whole panel / photo area, from its rim
    const hole = new Uint8Array(W * H), idx = [], xs = q.map(p => p[0]), ys = q.map(p => p[1]);
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) for (let x = Math.min(...xs); x <= Math.max(...xs); x++) if (quadD(q, x + .5, y + .5) > 3) { hole[y * W + x] = 1; idx.push(y * W + x); }
    harmonic(R, W, idx, hole, 6000);
  }
  for (const [x0, y0, x1, y1] of FISH) {      // mask = off the per-column top→bottom ramp, dilated; then Laplace fill
    const hole = new Uint8Array(W * H), idx = [];
    for (let x = x0; x < x1; x++) {
      const top = [0, 1, 2].map(c => (R[(y0 * W + x) * 4 + c] + R[((y0 + 1) * W + x) * 4 + c]) / 2);
      const bot = [0, 1, 2].map(c => (R[(y1 * W + x) * 4 + c] + R[((y1 - 1) * W + x) * 4 + c]) / 2);
      for (let y = y0 + 2; y < y1 - 1; y++) {
        const t = (y - y0) / (y1 - y0); let d = 0; for (let c = 0; c < 3; c++) d += Math.abs(R[(y * W + x) * 4 + c] - (top[c] * (1 - t) + bot[c] * t));
        if (d > 45) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx, Y = y + dy; if (X <= x0 || Y <= y0 || X >= x1 - 1 || Y >= y1 - 1) continue; const p = Y * W + X; if (!hole[p]) { hole[p] = 1; idx.push(p); } }
      }
    }
    harmonic(R, W, idx, hole);
  }
  log('blanked');
  for (let i = 0; i < W * H; i++) R[i * 4 + 3] = A[i];

  // 4. cat layers (cat.png coordinates) -------------------------------------------------------------------------------
  const CW = C.w, CH = C.h, body = Buffer.from(C.d), tail = Buffer.alloc(CW * CH * 4), earL = Buffer.alloc(CW * CH * 4), earR = Buffer.alloc(CW * CH * 4);
  const ed = (x, y) => { const dx = (x - TAIL.cx) / TAIL.rx, dy = (y - TAIL.cy) / TAIL.ry, k = Math.hypot(dx, dy); return (k - 1) * k / Math.hypot(dx / TAIL.rx, dy / TAIL.ry); };
  for (let y = TAIL.zone[1]; y < CH; y++) for (let x = TAIL.zone[0]; x < CW; x++) {
    const i = (y * CW + x) * 4, a = C.d[i + 3]; if (!a) continue; const d = ed(x + .5, y + .5);
    body[i + 3] = Math.round(a * clamp01(0.5 - d / 1.5));
    if (d > -TAIL.root) { for (let c = 0; c < 3; c++) tail[i + c] = C.d[i + c]; tail[i + 3] = Math.round(a * clamp01((d + TAIL.root) / 4)); }
    if (d < 0 && d > -6 && body[i + 3]) { const f = 1 - 0.12 * (1 + d / 6); for (let c = 0; c < 3; c++) body[i + c] = Math.round(body[i + c] * f); }
  }
  for (const [e, out] of [[EARS.l, earL], [EARS.r, earR]]) {
    const [px, py] = e.p, [qx, qy] = e.q, L = Math.hypot(qx - px, qy - py);
    // distance from the base line, positive on the tip side (tip is above the line)
    const sgn = Math.sign((qx - px) * (100 - py) - (qy - py) * ((px + qx) / 2 - px));
    const bd = (x, y) => sgn * ((qx - px) * (y - py) - (qy - py) * (x - px)) / L;
    const [x0, y0, x1, y1] = e.box;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * CW + x) * 4, a = C.d[i + 3]; if (!a) continue; const d = bd(x + .5, y + .5);
      if (d > -e.root) { for (let c = 0; c < 3; c++) out[i + c] = C.d[i + c]; out[i + 3] = Math.round(a * clamp01((d + e.root) / 4)); }
      body[i + 3] = Math.min(body[i + 3], Math.round(a * clamp01(0.5 - d / 1.5)));
    }
  }
  log('cat split');

  // 5. export -------------------------------------------------------------------------------------------------------
  const bbox = (buf, w, h, thr = 0) => { let x0 = w, x1 = -1, y0 = h, y1 = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (buf[(y * w + x) * 4 + 3] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1 - x0 + 1, y1 - y0 + 1]; };
  const shadowBuf = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) shadowBuf[i * 4 + 3] = shadow[i];
  const layers = {
    shadow: { buf: shadowBuf, w: W, h: H, at: [0, 0], thr: 2 },
    tail: { buf: tail, w: CW, h: CH, at: CAT_AT, pivot: TAIL.pivot },
    earL: { buf: earL, w: CW, h: CH, at: CAT_AT, pivot: EARS.l.pivot },
    earR: { buf: earR, w: CW, h: CH, at: CAT_AT, pivot: EARS.r.pivot },
    body: { buf: body, w: CW, h: CH, at: CAT_AT },
  };
  const layout = { size: [W, H], tiers: TIERS, glass: GLASS, aquarium: AQUA, clock: CLOCK, laptop: LAPTOP, card: CARD, posterL: POSTER_L.panel, posterR: POSTER_R.photo, layers: {} };
  for (const T of TIERS) fs.mkdirSync(path.join(OUT, String(T)), { recursive: true });
  for (const [name, L] of Object.entries(layers)) {
    const [bx, by, bw, bh] = bbox(L.buf, L.w, L.h, L.thr || 0), m = 2;
    const x = Math.max(0, bx - m), y = Math.max(0, by - m), w = Math.min(L.w - x, bw + 2 * m), h = Math.min(L.h - y, bh + 2 * m);
    const crop = await raw(L.buf, L.w, L.h).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
    const e = { x: L.at[0] + x, y: L.at[1] + y, w, h };
    if (L.pivot) e.pivot = [L.at[0] + L.pivot[0], L.at[1] + L.pivot[1]];
    layout.layers[name] = e;
    for (const T of TIERS) { const k = T / W; await sharp(crop).resize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).webp({ quality: 85, alphaQuality: 95, effort: 5 }).toFile(path.join(OUT, String(T), name + '.webp')); }
  }
  const room = raw(R, W, H);
  for (const T of TIERS) await (T === W ? room.clone() : room.clone().resize(T, Math.round(H * T / W))).webp({ quality: 82, alphaQuality: 90, effort: 5 }).toFile(path.join(OUT, String(T), 'room.webp'));
  fs.writeFileSync(path.join(OUT, 'layout.json'), compact(layout) + '\n');
  if (PREV) {
    fs.mkdirSync(PREV, { recursive: true });
    await room.clone().png().toFile(path.join(PREV, 'room.png'));
    for (const [name, L] of Object.entries(layers)) await raw(L.buf, L.w, L.h).png().toFile(path.join(PREV, name + '.png'));
  }
  log('written', OUT);
})();
