// Orbital mechanics core — shared by the page and the solver Web Worker.
// No DOM access here; keep it pure so it can run in Node tests and in workers.
// ===== Orbital core: hierarchical analytic bodies + DP5(4) spacecraft propagation =====
const G = 6.6743e-11;
const DAY = 86400;

function buildSystem(list) {
  const N = list.length;
  const s = {
    N, m: new Float64Array(N), mu: new Float64Array(N), R: new Float64Array(N),
    parent: new Int32Array(N), a: new Float64Array(N), n: new Float64Array(N),
    ph: new Float64Array(N), Mf: new Float64Array(N), soi: new Float64Array(N),
    children: [], order: [], root: -1,
    P: new Float64Array(2 * N), V: new Float64Array(2 * N),
    rx: new Float64Array(N), ry: new Float64Array(N), rvx: new Float64Array(N), rvy: new Float64Array(N),
    bx: new Float64Array(N), by: new Float64Array(N), bvx: new Float64Array(N), bvy: new Float64Array(N),
  };
  for (let i = 0; i < N; i++) {
    const b = list[i];
    s.m[i] = b.mass; s.mu[i] = G * b.mass; s.R[i] = b.radius;
    s.parent[i] = b.parent; s.a[i] = b.a; s.ph[i] = (b.phase || 0) * Math.PI / 180;
    s.children.push([]);
    if (!(b.mass > 0)) return { error: `${b.name || 'Cisim'}: kütle pozitif olmalı.` };
    if (!(b.radius > 0)) return { error: `${b.name || 'Cisim'}: yarıçap pozitif olmalı.` };
  }
  const roots = [];
  for (let i = 0; i < N; i++) {
    const p = s.parent[i];
    if (p < 0) roots.push(i);
    else if (p >= N || p === i) return { error: 'Geçersiz yörünge ebeveyni.' };
    else s.children[p].push(i);
  }
  if (roots.length !== 1) return { error: roots.length === 0 ? 'Bir cisim merkezde sabit olmalı ("Merkez" seçin).' : 'Yalnızca bir cisim merkezde olabilir; diğerleri bir cismin etrafında dönmeli.' };
  s.root = roots[0];
  const q = [s.root];
  while (q.length) { const x = q.shift(); s.order.push(x); for (const c of s.children[x]) q.push(c); }
  if (s.order.length !== N) return { error: 'Yörünge zinciri döngüsel; ebeveyn seçimlerini kontrol edin.' };
  for (let k = N - 1; k >= 0; k--) {
    const x = s.order[k]; let M = s.m[x];
    for (const c of s.children[x]) M += s.Mf[c];
    s.Mf[x] = M;
  }
  for (let i = 0; i < N; i++) {
    const p = s.parent[i];
    if (p < 0) { s.soi[i] = Infinity; continue; }
    if (!(s.a[i] > s.R[i] + s.R[p])) return { error: `${list[i].name || 'Cisim'}: yörünge yarıçapı iki cismin yarıçap toplamından büyük olmalı.` };
    s.n[i] = Math.sqrt(G * (s.m[p] + s.Mf[i]) / Math.pow(s.a[i], 3));
    s.soi[i] = s.a[i] * Math.pow(s.Mf[i] / s.m[p], 0.4);
  }
  return s;
}

// Positions & velocities of all bodies at time t (seconds, absolute epoch)
function states(s, t, P, V) {
  const { N, rx, ry, rvx, rvy, bx, by, bvx, bvy } = s;
  for (let i = 0; i < N; i++) {
    if (s.parent[i] < 0) continue;
    const ang = s.ph[i] + s.n[i] * t, c = Math.cos(ang), sn = Math.sin(ang), a = s.a[i], w = a * s.n[i];
    rx[i] = a * c; ry[i] = a * sn; rvx[i] = -w * sn; rvy[i] = w * c;
  }
  bx[s.root] = 0; by[s.root] = 0; bvx[s.root] = 0; bvy[s.root] = 0;
  for (const x of s.order) {
    let sx = 0, sy = 0, svx = 0, svy = 0;
    for (const c of s.children[x]) { const M = s.Mf[c]; sx += M * rx[c]; sy += M * ry[c]; svx += M * rvx[c]; svy += M * rvy[c]; }
    const Mx = s.Mf[x];
    const px = bx[x] - sx / Mx, py = by[x] - sy / Mx, vx = bvx[x] - svx / Mx, vy = bvy[x] - svy / Mx;
    P[2 * x] = px; P[2 * x + 1] = py; V[2 * x] = vx; V[2 * x + 1] = vy;
    for (const c of s.children[x]) { bx[c] = px + rx[c]; by[c] = py + ry[c]; bvx[c] = vx + rvx[c]; bvy[c] = vy + rvy[c]; }
  }
}

function deriv(s, t, y, out) {
  states(s, t, s.P, s.V);
  const P = s.P; let ax = 0, ay = 0;
  for (let i = 0; i < s.N; i++) {
    const dx = y[0] - P[2 * i], dy = y[1] - P[2 * i + 1];
    const r2 = dx * dx + dy * dy, r = Math.sqrt(r2), k = s.mu[i] / (r2 * r);
    ax -= k * dx; ay -= k * dy;
  }
  out[0] = y[2]; out[1] = y[3]; out[2] = ax; out[3] = ay;
}

// Dormand–Prince 5(4)
const DP = {
  c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
  a: [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9],
    [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
    [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
    [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]],
  e: [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40],
};
const K = Array.from({ length: 7 }, () => new Float64Array(4));
const YT = new Float64Array(4);

// One DP step; K[0] must hold f(t,y). Writes y5 into yOut, returns error vector in errOut.
function dpStep(s, t, y, h, yOut, errOut) {
  for (let st = 1; st < 7; st++) {
    const row = DP.a[st];
    for (let j = 0; j < 4; j++) { let acc = y[j]; for (let q = 0; q < st; q++) acc += h * row[q] * K[q][j]; YT[j] = acc; }
    deriv(s, t + DP.c[st] * h, YT, K[st]);
  }
  for (let j = 0; j < 4; j++) yOut[j] = YT[j]; // stage 7 input == 5th order solution
  if (errOut) for (let j = 0; j < 4; j++) { let e = 0; for (let q = 0; q < 7; q++) e += DP.e[q] * K[q][j]; errOut[j] = h * e; }
}

function radialRate(s, t, y, i) {
  states(s, t, s.P, s.V);
  return (y[0] - s.P[2 * i]) * (y[2] - s.V[2 * i]) + (y[1] - s.P[2 * i + 1]) * (y[3] - s.V[2 * i + 1]);
}
function distTo(s, t, y, i) {
  states(s, t, s.P, s.V);
  return Math.hypot(y[0] - s.P[2 * i], y[1] - s.P[2 * i + 1]);
}

// Initial spacecraft state from mission
function initialState(s, M) {
  const A = 0, B = 1, t0 = M.t0 * DAY;
  const P = new Float64Array(2 * s.N), V = new Float64Array(2 * s.N);
  states(s, t0, P, V);
  const ux = P[2 * B] - P[2 * A], uy = P[2 * B + 1] - P[2 * A + 1];
  const al = Math.atan2(uy, ux) + M.theta * Math.PI / 180;
  const r = s.R[A] + M.h0 * 1e3, vc = Math.sqrt(s.mu[A] / r), v = vc + M.dv;
  const c = Math.cos(al), sn = Math.sin(al);
  return { y: [P[2 * A] + r * c, P[2 * A + 1] + r * sn, V[2 * A] - v * sn, V[2 * A + 1] + v * c], vc, r };
}

/**
 * Propagate spacecraft.
 * opts: { tol, record, hmaxFrac, maxSteps, fast } ; fast => optimizer early-stop rules, no capture burn
 */
function simulate(s, M, opts = {}) {
  const tol = opts.tol || 1e-10, record = opts.record !== false, fast = !!opts.fast;
  const T = M.duration * DAY, t0 = M.t0 * DAY;
  const init = initialState(s, M);
  let y = Float64Array.from(init.y);
  const y1 = new Float64Array(4), err = new Float64Array(4);
  let t = 0;
  const per0 = 2 * Math.PI * Math.sqrt(Math.pow(init.r, 3) / s.mu[0]);
  let h = per0 / 400;
  const hmax = T / (opts.hmaxDiv || 500);
  const maxSteps = opts.maxSteps || 80000;
  const out = { t: [], x: [], y: [], vx: [], vy: [], events: [], impact: -1, ok: true };
  const push = (tt, yy) => { out.t.push(tt); out.x.push(yy[0]); out.y.push(yy[1]); out.vx.push(yy[2]); out.vy.push(yy[3]); };
  if (record) push(0, y);
  out.events.push({ type: 'burn', t: 0, dv: M.dv, body: 0, label: 'Kalkış yanması' });
  // track closest approaches
  const dmin = new Float64Array(s.N).fill(Infinity), tmin = new Float64Array(s.N);
  let hzMin = 1, stopNow = false;
  let bPeri = null; // first periapsis inside B's SOI
  let aRet = null;  // first periapsis at A after B periapsis
  let dAafterB = Infinity;
  let captured = null;
  let Tend = T;
  let g0 = [radialRate(s, t0, y, 0), radialRate(s, t0, y, 1)];
  deriv(s, t0, y, K[0]);
  let steps = 0;
  const P = s.P, V = s.V;
  while (t < Tend && steps < maxSteps) {
    steps++;
    if (t + h > Tend) h = Tend - t;
    // error scale relative to nearest body
    states(s, t0 + t, P, V);
    let dn = Infinity, vn = 0;
    for (let i = 0; i < s.N; i++) {
      const d = Math.hypot(y[0] - P[2 * i], y[1] - P[2 * i + 1]);
      if (d < dn) { dn = d; vn = Math.hypot(y[2] - V[2 * i], y[3] - V[2 * i + 1]); }
    }
    const yStart = Float64Array.from(y), k0 = Float64Array.from(K[0]);
    dpStep(s, t0 + t, y, h, y1, err);
    const k7 = Float64Array.from(K[6]);
    const sp = tol * dn + 1e-3, sv = tol * vn + 1e-6;
    const en = Math.max(Math.abs(err[0]) / sp, Math.abs(err[1]) / sp, Math.abs(err[2]) / sv, Math.abs(err[3]) / sv);
    if (en > 1 && h > 1e-3) { h *= Math.max(0.2, 0.9 * Math.pow(en, -0.2)); K[0].set(k0); continue; }
    // accept
    const tn = t + h;
    // impact check
    states(s, t0 + tn, P, V);
    let hit = -1;
    for (let i = 0; i < s.N; i++) {
      const d = Math.hypot(y1[0] - P[2 * i], y1[1] - P[2 * i + 1]);
      if (d < dmin[i]) { dmin[i] = d; tmin[i] = tn; if (i === 1) hzMin = Math.sign((y1[0] - P[2]) * (y1[3] - V[3]) - (y1[1] - P[3]) * (y1[2] - V[2])) || 1; }
      if (d < s.R[i]) hit = i;
    }
    if (bPeri && !aRet) { const dA = Math.hypot(y1[0] - P[0], y1[1] - P[1]); if (dA < dAafterB) dAafterB = dA; }
    // periapsis events for A and B
    let eventHandled = false;
    for (const i of [1, 0]) {
      const g1 = radialRate(s, t0 + tn, y1, i);
      if (g0[i] < 0 && g1 >= 0 && hit < 0) {
        // refine by bisection on fraction of step
        let lo = 0, hi = 1; const ym = new Float64Array(4);
        for (let it = 0; it < 40; it++) {
          const mid = 0.5 * (lo + hi);
          K[0].set(k0); dpStep(s, t0 + t, yStart, h * mid, ym, null);
          if (radialRate(s, t0 + t + h * mid, ym, i) < 0) lo = mid; else hi = mid;
        }
        const tau = 0.5 * (lo + hi); K[0].set(k0); dpStep(s, t0 + t, yStart, h * tau, ym, null);
        const te = t + h * tau, de = distTo(s, t0 + te, ym, i);
        if (de < dmin[i]) { dmin[i] = de; tmin[i] = te; }
        const inSoi = de < s.soi[i];
        if (i === 1 && !bPeri && inSoi) {
          states(s, t0 + te, P, V);
          const hz = (ym[0] - P[2]) * (ym[3] - V[3]) - (ym[1] - P[3]) * (ym[2] - V[2]);
          bPeri = { t: te, d: de, dir: hz >= 0 ? 1 : -1, v: Math.hypot(ym[2] - V[2], ym[3] - V[3]) };
          out.events.push({ type: 'peri', body: 1, t: te, d: de, alt: de - s.R[1], label: 'Hedef periapsis' });
          if (M.mode === 'capture' && !fast && !captured) {
            states(s, t0 + te, P, V);
            const rvx = ym[2] - V[2], rvy = ym[3] - V[3], vrel = Math.hypot(rvx, rvy), vcirc = Math.sqrt(s.mu[1] / de);
            const ny = Float64Array.from(ym);
            ny[2] = V[2] + rvx / vrel * vcirc; ny[3] = V[3] + rvy / vrel * vcirc;
            captured = { t: te, dv: vrel - vcirc, d: de };
            out.events.push({ type: 'burn', body: 1, t: te, dv: vrel - vcirc, label: 'Yörüngeye giriş yanması' });
            if (record) { push(te, ym); push(te, ny); }
            y = ny; t = te;
            const Pc = 2 * Math.PI * Math.sqrt(de * de * de / s.mu[1]);
            Tend = Math.min(T, te + 3 * Pc);
            h = Pc / 200;
            deriv(s, t0 + t, y, K[0]);
            g0 = [radialRate(s, t0 + t, y, 0), radialRate(s, t0 + t, y, 1)];
            eventHandled = true; break;
          }
        } else if (i === 0 && bPeri && !aRet && !captured && te > bPeri.t) {
          aRet = { t: te, d: de };
          if (de < dAafterB) dAafterB = de;
          out.events.push({ type: 'peri', body: 0, t: te, d: de, alt: de - s.R[0], label: 'Dönüş perigee' });
          if (!fast) { if (record) push(te, ym); y.set(ym); t = te; stopNow = true; break; }
        }
      }
      g0[i] = g1;
    }
    if (stopNow) break;
    if (eventHandled) continue;
    y.set(y1); t = tn;
    if (record) push(t, y);
    if (hit >= 0) { out.impact = hit; out.events.push({ type: 'impact', body: hit, t, label: 'Çarpma' }); break; }
    if (fast) {
      if (M.mode !== 'free' && bPeri && t > bPeri.t * 1.15) break;
      if (M.mode === 'free' && aRet) break;
    }
    // FSAL: K[6] is f at y1
    K[0].set(k7);
    h *= Math.min(4, Math.max(0.2, 0.9 * Math.pow(Math.max(en, 1e-10), -0.2)));
    if (h > hmax) h = hmax;
  }
  out.steps = steps; out.tEnd = t;
  out.dmin = Array.from(dmin); out.tmin = Array.from(tmin);
  out.bPeri = bPeri; out.aRet = aRet; out.dAafterB = dAafterB; out.captured = captured; out.hzMin = hzMin;
  out.vc = init.vc; out.r0 = init.r;
  return out;
}

// ===== Analytic Hohmann guess =====
function ancestors(s, i) { const p = [i]; while (s.parent[p[p.length - 1]] >= 0) p.push(s.parent[p[p.length - 1]]); return p; }

function hohmannGuess(s, M) {
  const A = 0, B = 1;
  const pa = ancestors(s, A), pb = ancestors(s, B);
  const L = pa.find(x => pb.includes(x));
  const rp = s.R[A] + M.h0 * 1e3, muA = s.mu[A];
  const escDv = vinf => Math.sqrt(vinf * vinf + 2 * muA / rp) - Math.sqrt(muA / rp);
  const P = new Float64Array(2 * s.N), V = new Float64Array(2 * s.N);
  const res = { case: '', dv: 0, tof: 0, theta: M.theta, t0: M.t0 };
  const wrap = x => { x = ((x + 180) % 360 + 360) % 360 - 180; return x; };
  if (L === A) {
    // target orbits (possibly indirectly) the departure body
    const Bp = pb[pb.indexOf(A) - 1];
    const r1 = rp, r2 = s.a[Bp], mu = muA;
    const at = (r1 + r2) / 2;
    res.dv = Math.sqrt(mu / r1) * (Math.sqrt(2 * r2 / (r1 + r2)) - 1);
    res.tof = Math.PI * Math.sqrt(at * at * at / mu);
    res.theta = wrap(res.tof * s.n[Bp] * 180 / Math.PI - 180);
    res.case = 'inner';
  } else if (L === B) {
    // returning to the parent (e.g. Moon -> Earth)
    const Ap = pa[pa.indexOf(B) - 1];
    const r1 = s.a[Ap], r2 = s.R[B] + M.hB * 1e3, mu = s.mu[B];
    const at = (r1 + r2) / 2;
    const vApo = Math.sqrt(mu * (2 / r1 - 1 / at)), vOrb = Math.sqrt(mu / r1);
    const vinf = Math.abs(vOrb - vApo);
    res.dv = escDv(vinf);
    res.tof = Math.PI * Math.sqrt(at * at * at / mu);
    states(s, M.t0 * DAY, P, V);
    const e = 1 + rp * vinf * vinf / muA, nuInf = Math.acos(-1 / e);
    const asym = Math.atan2(-(V[2 * Ap + 1] - V[2 * B + 1]), -(V[2 * Ap] - V[2 * B]));
    const peri = asym - nuInf;
    const ref = Math.atan2(P[2 * B + 1] - P[2 * A + 1], P[2 * B] - P[2 * A]);
    res.theta = wrap((peri - ref) * 180 / Math.PI);
    res.case = 'down';
  } else {
    // siblings under L (patched conic)
    const Ap = pa[pa.indexOf(L) - 1], Bp = pb[pb.indexOf(L) - 1];
    const mu = s.mu[L], r1 = s.a[Ap], r2 = s.a[Bp], at = (r1 + r2) / 2;
    const vPer = Math.sqrt(mu * (2 / r1 - 1 / at)), vOrb = Math.sqrt(mu / r1);
    let vinf = Math.abs(vPer - vOrb);
    const outward = r2 > r1;
    res.tof = Math.PI * Math.sqrt(at * at * at / mu);
    // phase: B leads Ap by phi*
    const phiStar = Math.PI - s.n[Bp] * res.tof;
    const dn = s.n[Bp] - s.n[Ap];
    const ph0 = s.ph[Bp] - s.ph[Ap];
    const mod = (x, m) => ((x % m) + m) % m;
    let tt = dn < 0 ? mod(ph0 - phiStar, 2 * Math.PI) / (-dn) : mod(phiStar - ph0, 2 * Math.PI) / dn;
    res.t0 = tt / DAY;
    // nested departure (A orbits Ap)
    let vinfA = vinf;
    if (Ap !== A) {
      const muAp = s.mu[Ap], rA = s.a[A];
      const vEsc = Math.sqrt(vinf * vinf + 2 * muAp / rA);
      vinfA = Math.max(200, vEsc - rA * s.n[A]);
    }
    res.dv = escDv(vinfA);
    states(s, res.t0 * DAY, P, V);
    const vref = Ap !== A ? A : Ap, vpar = s.parent[vref];
    let dvx = V[2 * vref] - V[2 * vpar], dvy = V[2 * vref + 1] - V[2 * vpar + 1];
    if (!outward && Ap === A) { dvx = -dvx; dvy = -dvy; }
    const e = 1 + rp * vinfA * vinfA / muA, nuInf = Math.acos(-1 / e);
    const peri = Math.atan2(dvy, dvx) - nuInf;
    const ref = Math.atan2(P[2 * B + 1] - P[2 * A + 1], P[2 * B] - P[2 * A]);
    res.theta = wrap((peri - ref) * 180 / Math.PI);
    res.case = 'sibling'; res.nested = Ap !== A;
  }
  return res;
}

// ===== Optimizer: coarse scan + Levenberg–Marquardt =====
// side: 0 any, 1 prograde, -1 retrograde around target
function residuals(s, M, sim) {
  const rB = s.R[1] + M.hB * 1e3;
  let dB, dir;
  if (sim.bPeri) { dB = sim.bPeri.d; dir = sim.bPeri.dir; } else { dB = sim.dmin[1]; dir = sim.hzMin; }
  const r = [];
  if (M.side) r.push(Math.asinh((dir * dB - M.side * rB) / rB));
  else r.push(Math.log(Math.max(dB, 1) / rB));
  if (M.mode === 'free') {
    const rA = s.R[0] + M.hRet * 1e3;
    const dA = sim.aRet ? sim.aRet.d : (isFinite(sim.dAafterB) ? sim.dAafterB : 1e3 * rA);
    r.push(Math.log(Math.max(dA, 1) / rA));
  }
  return r;
}
function solveLin(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return null;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let a = M[r][n]; for (let k = r + 1; k < n; k++) a -= M[r][k] * x[k]; x[r] = a / M[r][r]; }
  return x;
}

async function optimize(s, M, opt = {}) {
  const onProgress = opt.onProgress || (() => { });
  const varyT0 = !!opt.varyT0;
  const scale = [1, 10, opt.t0Scale || 1]; // deg, m/s, day per unit
  const nv = varyT0 ? 3 : 2;
  let evals = 0;
  const toM = u => ({ ...M, theta: u[0] * scale[0], dv: u[1] * scale[1], t0: varyT0 ? u[2] * scale[2] : M.t0 });
  const R = (u, mode, tol) => {
    const m = toM(u); if (mode) m.mode = mode;
    evals++;
    const sim = simulate(s, m, { tol: tol || 1e-10, record: false, fast: true, hmaxDiv: 200, maxSteps: 30000 });
    const r = residuals(s, m, sim);
    if (sim.impact === 0 && !(m.mode === 'free' && sim.bPeri)) r.push(3);
    return r;
  };
  const nrm = r => r.reduce((a, b) => a + b * b, 0);
  const tick = async () => { if (evals % 6 === 0) { if (opt.cancelled && opt.cancelled()) throw 'cancel'; onProgress(evals); await new Promise(r => setTimeout(r, 0)); } };
  // Stage 1: coarse scan of burn angle (flyby distance only)
  const u0 = [M.theta / scale[0], M.dv / scale[1], M.t0 / scale[2]];
  const cands = [];
  const tShifts = varyT0 ? (opt.t0Grid || [-4, -2, 0, 2, 4]) : [0];
  for (let th = -180; th < 180; th += 5) for (const ts of tShifts) {
    const u = [th, u0[1], u0[2] + ts];
    const r = R(u, M.mode === 'free' ? 'flyby' : M.mode, 1e-9);
    cands.push({ u, f: nrm([r[0]]) + (r.length > 1 && r[r.length - 1] === 3 ? 9 : 0) }); await tick();
  }
  cands.sort((a, b) => a.f - b.f);
  const seeds = [];
  for (const c of cands) { if (seeds.every(q => Math.abs(q.u[0] - c.u[0]) > 8 || Math.abs(q.u[2] - c.u[2]) > 1)) seeds.push(c); if (seeds.length >= (opt.seeds || 5)) break; }
  // Stage 2: LM
  const hstep = [1e-4, 1e-3, 1e-4];
  const maxStep = [15, Math.max(2, M.dv * 0.03 / scale[1]), 8];
  let best = null;
  for (const sd of seeds) {
    let u = sd.u.slice(), r = R(u), f = nrm(r), lam = 1e-2;
    for (let it = 0; it < 45 && f > 1e-9; it++) {
      const J = [];
      for (let k = 0; k < nv; k++) { const up = u.slice(); up[k] += hstep[k]; const rp = R(up); J.push(rp.map((v, i) => (v - r[i]) / hstep[k])); }
      await tick();
      const JtJ = Array.from({ length: nv }, (_, a) => Array.from({ length: nv }, (_, b) => J[a].reduce((acc, v, i) => acc + v * J[b][i], 0)));
      const Jtr = Array.from({ length: nv }, (_, a) => -J[a].reduce((acc, v, i) => acc + v * r[i], 0));
      let accepted = false;
      for (let tries = 0; tries < 8 && !accepted; tries++) {
        const A = JtJ.map((row, a) => row.map((v, b) => v + (a === b ? lam * (v + 1e-6) + 1e-12 : 0)));
        const d = solveLin(A, Jtr); if (!d) { lam *= 10; continue; }
        const un = u.map((v, k) => k < nv ? v + Math.max(-maxStep[k], Math.min(maxStep[k], d[k])) : v);
        const rn = R(un), fn = nrm(rn);
        if (fn < f) { u = un; r = rn; f = fn; lam = Math.max(1e-7, lam / 4); accepted = true; }
        else lam *= 6;
      }
      if (!accepted) break;
    }
    if (!best || f < best.f) best = { u, f };
    if (best.f < 1e-8) break;
  }
  onProgress(evals);
  const m = toM(best.u);
  return { theta: ((m.theta % 360) + 540) % 360 - 180, dv: m.dv, t0: m.t0, f: best.f, evals };
}

if (typeof module !== 'undefined') module.exports = { G, DAY, buildSystem, states, simulate, hohmannGuess, optimize, residuals };
