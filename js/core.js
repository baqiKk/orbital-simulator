// Orbital mechanics core — shared by the page and the solver Web Worker.
// No DOM access here; keep it pure so it can run in Node tests and in workers.
// ===== Orbital core: hierarchical analytic bodies + DP5(4) spacecraft propagation (3D) =====
// Two body models share one code path:
//  - simplified: a body without `orb` moves on a circular orbit in the z = 0 plane (a, phase);
//  - real: a body with `orb` follows Kepler elements (js/bodies.js), time = seconds since J2000 TDB.
// 2D views project onto a plane; the physics is always 3D (z stays exactly 0 in the simplified model).
const G = 6.6743e-11;
const DAY = 86400;
const AU = 1.495978707e11;            // m
const JCY = 36525 * DAY;              // Julian century, s
const JYR = 365.25 * DAY;             // Julian year, s
const D2R = Math.PI / 180;
const OBLIQUITY = 84381.448 / 3600 * D2R; // J2000 obliquity of the ecliptic (23.4392911°)
const TT_UTC = 69.184;                // s: TT − UTC (32.184 s + 37 leap seconds since 2017), taken constant
const J2000_MS = Date.UTC(2000, 0, 1, 12); // 2000-01-01 12:00 as a calendar reading (TT for the epoch)

// Calendar time (UTC, ms since 1970) <-> days since J2000 TDB (TDB ≈ TT here)
function utcToDays(ms) { return ((ms - J2000_MS) / 1000 + TT_UTC) / DAY; }
function daysToUtc(d) { return J2000_MS + (d * DAY - TT_UTC) * 1000; }

// ----- Kepler elements -----
// Solve Kepler's equation E − e·sin E = M (elliptic, 0 ≤ e < 1) by Newton–Raphson.
// Start: E₀ = M + 0.85·e·sign(sin M) (Danby), robust for any e < 1; stops at |ΔE| < 1e-14 rad.
function keplerE(M, e) {
  let E = M + 0.85 * e * (Math.sin(M) < 0 ? -1 : 1);
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}
const wrapPi = x => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));

// Rotation matrix (row-major) from a local Laplace frame with pole (RA, Dec) in ICRF to the J2000 ecliptic.
// Laplace frame: x toward the plane's ascending node on the ICRF equator (RA + 90°), z along the pole.
function laplaceFrame(ra, dec) {
  const p = (ra + 90) * D2R, q = (90 - dec) * D2R;
  const cp = Math.cos(p), sp = Math.sin(p), cq = Math.cos(q), sq = Math.sin(q);
  const A = [cp, -sp * cq, sp * sq, sp, cp * cq, -cp * sq, 0, sq, cq]; // Rz(RA+90°)·Rx(90°−Dec)
  const ce = Math.cos(OBLIQUITY), se = Math.sin(OBLIQUITY);
  return [A[0], A[1], A[2],
    ce * A[3] + se * A[6], ce * A[4] + se * A[7], ce * A[5] + se * A[8],
    -se * A[3] + ce * A[6], -se * A[4] + ce * A[7], -se * A[5] + ce * A[8]];
}

// Table data (js/bodies.js) -> elements linear in t (s since J2000): x(t) = x0 + x1·t; a in m, angles in rad.
// ω = argument of periapsis, Ω = ascending node, M = mean anomaly. F: element frame -> ecliptic (null = ecliptic).
function orbitElements(o) {
  if (o.jpl) { // Approximate Positions of the Planets, Table 1: [a, e, I, L, ϖ, Ω] and rates per century
    const [[a, e, I, L, w, O], [a1, e1, I1, L1, w1, O1]] = o.jpl, c = 1 / JCY;
    return { a0: a * AU, a1: a1 * AU * c, e0: e, e1: e1 * c, i0: I * D2R, i1: I1 * D2R * c,
      O0: O * D2R, O1: O1 * D2R * c, w0: (w - O) * D2R, w1: (w1 - O1) * D2R * c,
      M0: (L - w) * D2R, M1: (L1 - w1) * D2R * c, F: null };
  }
  // Planetary satellite mean elements: [a km, e, ω, M, i, Ω (deg), P days, Pw yr, Pnode yr].
  // P is the sidereal period (mean-longitude rate); Pw is the period of ω (prograde), Pnode that of Ω
  // (regressing). A zero period means "no precession given" (circular or equatorial orbit).
  const [a, e, w, M, i, O, P, Pw, Pn] = o.sat;
  const w1 = Pw > 0 ? 2 * Math.PI / (Pw * JYR) : 0, O1 = Pn > 0 ? -2 * Math.PI / (Pn * JYR) : 0;
  return { a0: a * 1e3, a1: 0, e0: e, e1: 0, i0: i * D2R, i1: 0, O0: O * D2R, O1, w0: w * D2R, w1,
    M0: M * D2R, M1: 2 * Math.PI / (P * DAY) - w1 - O1, F: o.lp ? laplaceFrame(o.lp[0], o.lp[1]) : null };
}

// Position and velocity (m, m/s) relative to the parent at time t, written to out[k..k+5].
// Velocity is the exact time derivative of the position: motion along the orbit plus the slow drift of
// a and e and the turning of the orbit (ω̇, Ω̇, i̇).
function orbitState(o, t, out, k) {
  const a = o.a0 + o.a1 * t, e = o.e0 + o.e1 * t, inc = o.i0 + o.i1 * t, Om = o.O0 + o.O1 * t, w = o.w0 + o.w1 * t;
  const E = keplerE(wrapPi(o.M0 + o.M1 * t), e);
  const cE = Math.cos(E), sE = Math.sin(E), q = Math.sqrt(1 - e * e), D = 1 - e * cE;
  const Ed = (o.M1 + o.e1 * sE) / D; // dE/dt from M − (E − e·sin E) = 0 with M and e both changing
  const xo = a * (cE - e), yo = a * q * sE;
  const vxo = -a * sE * Ed - a * o.e1 + o.a1 * (cE - e), vyo = a * q * cE * Ed - a * e / q * sE * o.e1 + o.a1 * q * sE;
  // Rz(Ω)·Rx(i)·Rz(ω)
  const cO = Math.cos(Om), sO = Math.sin(Om), ci = Math.cos(inc), si = Math.sin(inc), cw = Math.cos(w), sw = Math.sin(w);
  const r11 = cO * cw - sO * sw * ci, r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci, r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si, r32 = cw * si;
  const x = r11 * xo + r12 * yo, y = r21 * xo + r22 * yo, z = r31 * xo + r32 * yo;
  const hx = sO * si, hy = -cO * si, hz = ci; // orbit normal
  // ω̇ turns the orbit about its normal, Ω̇ about the reference pole, i̇ about the line of nodes
  const vx = r11 * vxo + r12 * vyo + o.w1 * (hy * z - hz * y) - o.O1 * y + o.i1 * sO * z;
  const vy = r21 * vxo + r22 * vyo + o.w1 * (hz * x - hx * z) + o.O1 * x - o.i1 * cO * z;
  const vz = r31 * vxo + r32 * vyo + o.w1 * (hx * y - hy * x) + o.i1 * (cO * y - sO * x);
  const F = o.F;
  if (!F) { out[k] = x; out[k + 1] = y; out[k + 2] = z; out[k + 3] = vx; out[k + 4] = vy; out[k + 5] = vz; return; }
  out[k] = F[0] * x + F[1] * y + F[2] * z; out[k + 1] = F[3] * x + F[4] * y + F[5] * z; out[k + 2] = F[6] * x + F[7] * y + F[8] * z;
  out[k + 3] = F[0] * vx + F[1] * vy + F[2] * vz; out[k + 4] = F[3] * vx + F[4] * vy + F[5] * vz; out[k + 5] = F[6] * vx + F[7] * vy + F[8] * vz;
}

// One revolution of body i's orbit relative to its parent, frozen at time t: n points (x, y, z) in m.
// Real bodies only (simplified orbits are circles the view draws directly).
function orbitPath(s, i, t, n) {
  const o = s.orb[i], out = new Float64Array(3 * n);
  if (!o) return out;
  const a = o.a0 + o.a1 * t, e = o.e0 + o.e1 * t, inc = o.i0 + o.i1 * t, Om = o.O0 + o.O1 * t, w = o.w0 + o.w1 * t;
  const cO = Math.cos(Om), sO = Math.sin(Om), ci = Math.cos(inc), si = Math.sin(inc), cw = Math.cos(w), sw = Math.sin(w);
  const r = [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, sw * si, cw * si];
  const q = Math.sqrt(1 - e * e), F = o.F;
  for (let k = 0; k < n; k++) {
    const E = 2 * Math.PI * k / n, xo = a * (Math.cos(E) - e), yo = a * q * Math.sin(E); // even in E: dense near periapsis
    const x = r[0] * xo + r[1] * yo, y = r[2] * xo + r[3] * yo, z = r[4] * xo + r[5] * yo;
    out[3 * k] = F ? F[0] * x + F[1] * y + F[2] * z : x;
    out[3 * k + 1] = F ? F[3] * x + F[4] * y + F[5] * z : y;
    out[3 * k + 2] = F ? F[6] * x + F[7] * y + F[8] * z : z;
  }
  return out;
}

function buildSystem(list) {
  const N = list.length;
  const s = {
    N, m: new Float64Array(N), mu: new Float64Array(N), R: new Float64Array(N),
    parent: new Int32Array(N), a: new Float64Array(N), n: new Float64Array(N),
    ph: new Float64Array(N), Mf: new Float64Array(N), soi: new Float64Array(N),
    orb: new Array(N).fill(null), real: false,
    children: [], order: [], root: -1,
    P: new Float64Array(3 * N), V: new Float64Array(3 * N),
    rel: new Float64Array(6 * N), // subsystem barycentre relative to the parent body (r, v)
    bc: new Float64Array(6 * N),  // subsystem barycentre (r, v)
  };
  for (let i = 0; i < N; i++) {
    const b = list[i];
    // real bodies carry μ (m³/s²); simplified ones carry the mass
    if (b.mu > 0) { s.mu[i] = b.mu; s.m[i] = b.mu / G; } else { s.m[i] = b.mass; s.mu[i] = G * b.mass; }
    s.R[i] = b.radius; s.parent[i] = b.parent; s.a[i] = b.a; s.ph[i] = (b.phase || 0) * Math.PI / 180;
    s.children.push([]);
    // Errors are i18n keys (see js/i18n.js); the UI turns them into text.
    if (!(s.m[i] > 0)) return { error: 'err.mass', params: { name: b.name } };
    if (!(b.radius > 0)) return { error: 'err.radius', params: { name: b.name } };
    if (b.orb && b.parent >= 0) {
      const o = s.orb[i] = orbitElements(b.orb);
      s.real = true; s.a[i] = o.a0;
      s.ph[i] = o.O0 + o.w0 + o.M0; s.n[i] = o.O1 + o.w1 + o.M1; // mean longitude at J2000 and its rate
    }
  }
  const roots = [];
  for (let i = 0; i < N; i++) {
    const p = s.parent[i];
    if (p < 0) roots.push(i);
    else if (p >= N || p === i) return { error: 'err.parent' };
    else s.children[p].push(i);
  }
  if (roots.length !== 1) return { error: roots.length === 0 ? 'err.noRoot' : 'err.multiRoot' };
  s.root = roots[0];
  const q = [s.root];
  while (q.length) { const x = q.shift(); s.order.push(x); for (const c of s.children[x]) q.push(c); }
  if (s.order.length !== N) return { error: 'err.cycle' };
  for (let k = N - 1; k >= 0; k--) {
    const x = s.order[k]; let M = s.m[x];
    for (const c of s.children[x]) M += s.Mf[c];
    s.Mf[x] = M;
  }
  for (let i = 0; i < N; i++) {
    const p = s.parent[i];
    if (p < 0) { s.soi[i] = Infinity; continue; }
    if (!(s.a[i] > s.R[i] + s.R[p])) return { error: 'err.orbit', params: { name: list[i].name } };
    if (!s.orb[i]) s.n[i] = Math.sqrt(G * (s.m[p] + s.Mf[i]) / Math.pow(s.a[i], 3));
    s.soi[i] = s.a[i] * Math.pow(s.Mf[i] / s.m[p], 0.4);
  }
  return s;
}

// Default orbit radius (m) for a new body of the given radius (m) around list[parent]:
// above 2x the radius sum, inside the parent's SOI (when it has one), and as far
// as possible (in log distance) from the sibling orbits and from both limits.
// list entries: { mass, radius, parent, a } in SI units.
function defaultOrbitRadius(list, parent, radius) {
  const P = list[parent], lo = 2 * (P.radius + radius);
  let hi;
  const sib = [];
  for (let i = 0; i < list.length; i++) if (i !== parent && list[i].parent === parent) sib.push(list[i].a);
  if (P.parent >= 0) {
    let Mf = P.mass;
    for (let i = 0; i < list.length; i++) if (list[i].parent === parent) Mf += list[i].mass;
    hi = P.a * Math.pow(Mf / list[P.parent].mass, 0.4);
  } else hi = sib.length ? 2 * Math.max(...sib) : lo * 1000;
  if (!(hi > lo)) return lo;
  const l0 = Math.log(lo), l1 = Math.log(hi);
  let best = Math.sqrt(lo * hi), bestScore = -1;
  for (let k = 1; k < 200; k++) {
    const l = l0 + (l1 - l0) * k / 200;
    let sc = Math.min(l - l0, l1 - l);
    for (const a of sib) sc = Math.min(sc, Math.abs(l - Math.log(a)));
    if (sc > bestScore) { bestScore = sc; best = Math.exp(l); }
  }
  return best;
}

// Positions & velocities of all bodies at time t (seconds, absolute epoch); P, V hold 3 values per body.
// Each subsystem's barycentre follows its orbit around the parent body; barycentres are preserved.
function states(s, t, P, V) {
  const { N, rel, bc } = s;
  for (let i = 0; i < N; i++) {
    if (s.parent[i] < 0) continue;
    const k = 6 * i;
    if (s.orb[i]) { orbitState(s.orb[i], t, rel, k); continue; }
    const ang = s.ph[i] + s.n[i] * t, c = Math.cos(ang), sn = Math.sin(ang), a = s.a[i], w = a * s.n[i];
    rel[k] = a * c; rel[k + 1] = a * sn; rel[k + 2] = 0; rel[k + 3] = -w * sn; rel[k + 4] = w * c; rel[k + 5] = 0;
  }
  const r0 = 6 * s.root; for (let j = 0; j < 6; j++) bc[r0 + j] = 0;
  for (const x of s.order) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0;
    for (const c of s.children[x]) {
      const M = s.Mf[c], k = 6 * c;
      s0 += M * rel[k]; s1 += M * rel[k + 1]; s2 += M * rel[k + 2]; s3 += M * rel[k + 3]; s4 += M * rel[k + 4]; s5 += M * rel[k + 5];
    }
    const Mx = s.Mf[x], b = 6 * x, p = 3 * x;
    const px = bc[b] - s0 / Mx, py = bc[b + 1] - s1 / Mx, pz = bc[b + 2] - s2 / Mx;
    const vx = bc[b + 3] - s3 / Mx, vy = bc[b + 4] - s4 / Mx, vz = bc[b + 5] - s5 / Mx;
    P[p] = px; P[p + 1] = py; P[p + 2] = pz; V[p] = vx; V[p + 1] = vy; V[p + 2] = vz;
    for (const c of s.children[x]) {
      const k = 6 * c;
      bc[k] = px + rel[k]; bc[k + 1] = py + rel[k + 1]; bc[k + 2] = pz + rel[k + 2];
      bc[k + 3] = vx + rel[k + 3]; bc[k + 4] = vy + rel[k + 4]; bc[k + 5] = vz + rel[k + 5];
    }
  }
}

// ----- Mission plane -----
function ancestors(s, i) { const p = [i]; while (s.parent[p[p.length - 1]] >= 0) p.push(s.parent[p[p.length - 1]]); return p; }

// Unit normal of the orbit plane that links departure A (0) and target B (1) at time t:
// B's orbit about A, A's orbit about B, or B's orbit about their common parent. Planar model: +z.
function missionPlane(s, t) {
  if (!s.real) return [0, 0, 1];
  const pa = ancestors(s, 0), pb = ancestors(s, 1), L = pa.find(x => pb.includes(x));
  const c = L === 0 ? pb[pb.indexOf(0) - 1] : L === 1 ? pa[pa.indexOf(1) - 1] : pb[pb.indexOf(L) - 1];
  states(s, t, s.P, s.V);
  const k = 6 * c, r = s.rel;
  const hx = r[k + 1] * r[k + 5] - r[k + 2] * r[k + 4], hy = r[k + 2] * r[k + 3] - r[k] * r[k + 5], hz = r[k] * r[k + 4] - r[k + 1] * r[k + 3];
  const h = Math.hypot(hx, hy, hz);
  return h > 0 ? [hx / h, hy / h, hz / h] : [0, 0, 1];
}
// In-plane axes for a plane with unit normal n: x = ecliptic x projected onto the plane (so a plane close to
// the ecliptic looks like the ecliptic view), y = n × x. For n = +z this is exactly the ecliptic x/y.
function planeBasis(n) {
  let ex = 1, ey = 0, ez = 0;
  if (Math.abs(n[0]) > 0.9) { ex = 0; ey = 1; }
  const d = ex * n[0] + ey * n[1] + ez * n[2];
  let x = [ex - d * n[0], ey - d * n[1], ez - d * n[2]];
  const l = Math.hypot(x[0], x[1], x[2]); x = [x[0] / l, x[1] / l, x[2] / l];
  return { n, x, y: [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]] };
}
// angle of vector (vx, vy, vz) in the plane of basis b, measured from b.x
const planeAngle = (b, vx, vy, vz) => Math.atan2(vx * b.y[0] + vy * b.y[1] + vz * b.y[2], vx * b.x[0] + vy * b.x[1] + vz * b.x[2]);

// ----- Spacecraft dynamics -----
function deriv(s, t, y, out) {
  states(s, t, s.P, s.V);
  const P = s.P; let ax = 0, ay = 0, az = 0;
  for (let i = 0; i < s.N; i++) {
    const dx = y[0] - P[3 * i], dy = y[1] - P[3 * i + 1], dz = y[2] - P[3 * i + 2];
    const r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2), k = s.mu[i] / (r2 * r);
    ax -= k * dx; ay -= k * dy; az -= k * dz;
  }
  out[0] = y[3]; out[1] = y[4]; out[2] = y[5]; out[3] = ax; out[4] = ay; out[5] = az;
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
const K = Array.from({ length: 7 }, () => new Float64Array(6));
const YT = new Float64Array(6);

// One DP step; K[0] must hold f(t,y). Writes y5 into yOut, returns error vector in errOut.
function dpStep(s, t, y, h, yOut, errOut) {
  for (let st = 1; st < 7; st++) {
    const row = DP.a[st];
    for (let j = 0; j < 6; j++) { let acc = y[j]; for (let q = 0; q < st; q++) acc += h * row[q] * K[q][j]; YT[j] = acc; }
    deriv(s, t + DP.c[st] * h, YT, K[st]);
  }
  for (let j = 0; j < 6; j++) yOut[j] = YT[j]; // stage 7 input == 5th order solution
  if (errOut) for (let j = 0; j < 6; j++) { let e = 0; for (let q = 0; q < 7; q++) e += DP.e[q] * K[q][j]; errOut[j] = h * e; }
}

function radialRate(s, t, y, i) {
  states(s, t, s.P, s.V);
  const P = s.P, V = s.V, k = 3 * i;
  return (y[0] - P[k]) * (y[3] - V[k]) + (y[1] - P[k + 1]) * (y[4] - V[k + 1]) + (y[2] - P[k + 2]) * (y[5] - V[k + 2]);
}
function distTo(s, t, y, i) {
  states(s, t, s.P, s.V);
  const k = 3 * i;
  return Math.hypot(y[0] - s.P[k], y[1] - s.P[k + 1], y[2] - s.P[k + 2]);
}
// sense of motion around body i (angular momentum along the plane normal n): +1 prograde, −1 retrograde
function spin(P, V, y, i, n) {
  const k = 3 * i, rx = y[0] - P[k], ry = y[1] - P[k + 1], rz = y[2] - P[k + 2], vx = y[3] - V[k], vy = y[4] - V[k + 1], vz = y[5] - V[k + 2];
  return (ry * vz - rz * vy) * n[0] + (rz * vx - rx * vz) * n[1] + (rx * vy - ry * vx) * n[2];
}

// Initial spacecraft state from mission: circular parking orbit around A in the mission plane, burn point at
// angle θ from the A→B direction, tangential prograde burn. Real model: the parking orbit is tilted by β
// about the burn point's radius (so the burn leaves the mission plane by β).
function initialState(s, M) {
  const A = 0, B = 1, t0 = M.t0 * DAY;
  const P = new Float64Array(3 * s.N), V = new Float64Array(3 * s.N);
  const pb = planeBasis(missionPlane(s, t0)), n = pb.n, X = pb.x, Y = pb.y;
  states(s, t0, P, V);
  const al = planeAngle(pb, P[3 * B] - P[3 * A], P[3 * B + 1] - P[3 * A + 1], P[3 * B + 2] - P[3 * A + 2]) + M.theta * Math.PI / 180;
  const r = s.R[A] + M.h0 * 1e3, vc = Math.sqrt(s.mu[A] / r), v = vc + M.dv;
  const c = Math.cos(al), sn = Math.sin(al);
  const be = s.real ? (M.beta || 0) * Math.PI / 180 : 0, cb = Math.cos(be), sb = Math.sin(be);
  const y = [0, 0, 0, 0, 0, 0];
  for (let j = 0; j < 3; j++) {
    y[j] = P[3 * A + j] + r * (c * X[j] + sn * Y[j]);
    y[3 + j] = V[3 * A + j] + v * (cb * (c * Y[j] - sn * X[j]) + sb * n[j]);
  }
  return { y, vc, r, n };
}

/**
 * Propagate spacecraft.
 * opts: { tol, record, hmaxFrac, maxSteps, fast } ; fast => optimizer early-stop rules, no capture burn
 */
function simulate(s, M, opts = {}) {
  const tol = opts.tol || 1e-10, record = opts.record !== false, fast = !!opts.fast;
  const T = M.duration * DAY, t0 = M.t0 * DAY;
  const init = initialState(s, M), nrm = init.n;
  let y = Float64Array.from(init.y);
  const y1 = new Float64Array(6), err = new Float64Array(6);
  let t = 0;
  const per0 = 2 * Math.PI * Math.sqrt(Math.pow(init.r, 3) / s.mu[0]);
  let h = per0 / 400;
  const hmax = T / (opts.hmaxDiv || 500);
  const maxSteps = opts.maxSteps || 80000;
  const out = { t: [], x: [], y: [], z: [], vx: [], vy: [], vz: [], events: [], impact: -1, ok: true, normal: nrm };
  const push = (tt, yy) => { out.t.push(tt); out.x.push(yy[0]); out.y.push(yy[1]); out.z.push(yy[2]); out.vx.push(yy[3]); out.vy.push(yy[4]); out.vz.push(yy[5]); };
  if (record) push(0, y);
  out.events.push({ type: 'burn', t: 0, dv: M.dv, body: 0, label: 'ev.depart' });
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
      const k = 3 * i, d = Math.hypot(y[0] - P[k], y[1] - P[k + 1], y[2] - P[k + 2]);
      if (d < dn) { dn = d; vn = Math.hypot(y[3] - V[k], y[4] - V[k + 1], y[5] - V[k + 2]); }
    }
    const yStart = Float64Array.from(y), k0 = Float64Array.from(K[0]);
    dpStep(s, t0 + t, y, h, y1, err);
    const k7 = Float64Array.from(K[6]);
    const sp = tol * dn + 1e-3, sv = tol * vn + 1e-6;
    const en = Math.max(Math.abs(err[0]) / sp, Math.abs(err[1]) / sp, Math.abs(err[2]) / sp, Math.abs(err[3]) / sv, Math.abs(err[4]) / sv, Math.abs(err[5]) / sv);
    if (en > 1 && h > 1e-3) { h *= Math.max(0.2, 0.9 * Math.pow(en, -0.2)); K[0].set(k0); continue; }
    // accept
    const tn = t + h;
    // impact check
    states(s, t0 + tn, P, V);
    let hit = -1;
    for (let i = 0; i < s.N; i++) {
      const k = 3 * i, d = Math.hypot(y1[0] - P[k], y1[1] - P[k + 1], y1[2] - P[k + 2]);
      if (d < dmin[i]) { dmin[i] = d; tmin[i] = tn; if (i === 1) hzMin = Math.sign(spin(P, V, y1, 1, nrm)) || 1; }
      if (d < s.R[i]) hit = i;
    }
    if (bPeri && !aRet) { const dA = Math.hypot(y1[0] - P[0], y1[1] - P[1], y1[2] - P[2]); if (dA < dAafterB) dAafterB = dA; }
    // periapsis events for A and B
    let eventHandled = false;
    for (const i of [1, 0]) {
      const g1 = radialRate(s, t0 + tn, y1, i);
      if (g0[i] < 0 && g1 >= 0 && hit < 0) {
        // refine by bisection on fraction of step
        let lo = 0, hi = 1; const ym = new Float64Array(6);
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
          const hz = spin(P, V, ym, 1, nrm);
          bPeri = { t: te, d: de, dir: hz >= 0 ? 1 : -1, v: Math.hypot(ym[3] - V[3], ym[4] - V[4], ym[5] - V[5]) };
          out.events.push({ type: 'peri', body: 1, t: te, d: de, alt: de - s.R[1], label: 'ev.targetPeri' });
          if (M.mode === 'capture' && !fast && !captured) {
            states(s, t0 + te, P, V);
            const rvx = ym[3] - V[3], rvy = ym[4] - V[4], rvz = ym[5] - V[5], vrel = Math.hypot(rvx, rvy, rvz), vcirc = Math.sqrt(s.mu[1] / de);
            const ny = Float64Array.from(ym);
            ny[3] = V[3] + rvx / vrel * vcirc; ny[4] = V[4] + rvy / vrel * vcirc; ny[5] = V[5] + rvz / vrel * vcirc;
            captured = { t: te, dv: vrel - vcirc, d: de };
            out.events.push({ type: 'burn', body: 1, t: te, dv: vrel - vcirc, label: 'ev.capture' });
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
          out.events.push({ type: 'peri', body: 0, t: te, d: de, alt: de - s.R[0], label: 'ev.returnPeri' });
          if (!fast) { if (record) push(te, ym); y.set(ym); t = te; stopNow = true; break; }
        }
      }
      g0[i] = g1;
    }
    if (stopNow) break;
    if (eventHandled) continue;
    y.set(y1); t = tn;
    if (record) push(t, y);
    if (hit >= 0) {
      out.impact = hit; out.events.push({ type: 'impact', body: hit, t, label: 'ev.impact' });
      // hit the target: keep the two-body periapsis of the approach (below the surface) so the solver's
      // residual stays smooth instead of sticking at the radius
      if (hit === 1) {
        const rx = y[0] - P[3], ry = y[1] - P[4], rz = y[2] - P[5], vx = y[3] - V[3], vy = y[4] - V[4], vz = y[5] - V[5];
        const r = Math.hypot(rx, ry, rz), v2 = vx * vx + vy * vy + vz * vz, mu = s.mu[1];
        const h2 = (ry * vz - rz * vy) ** 2 + (rz * vx - rx * vz) ** 2 + (rx * vy - ry * vx) ** 2;
        const en = v2 / 2 - mu / r, ecc = Math.sqrt(Math.max(0, 1 + 2 * en * h2 / (mu * mu)));
        out.rpB = h2 / mu / (1 + ecc);
      }
      break;
    }
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
// Simplified model: circular coplanar orbits, as before. Real model: same patched-conic idea, but with the
// bodies' actual distances and in-plane angles from the ephemeris, and the departure window searched
// from the mission date onward (a window up to 10% of a synodic period earlier still counts, so
// re-solving a mission keeps its window).
function hohmannGuess(s, M) {
  const A = 0, B = 1;
  const pa = ancestors(s, A), pb = ancestors(s, B);
  const L = pa.find(x => pb.includes(x));
  const rp = s.R[A] + M.h0 * 1e3, muA = s.mu[A];
  const escDv = vinf => Math.sqrt(vinf * vinf + 2 * muA / rp) - Math.sqrt(muA / rp);
  const P = new Float64Array(3 * s.N), V = new Float64Array(3 * s.N);
  const res = { case: '', dv: 0, tof: 0, theta: M.theta, t0: M.t0 };
  const wrap = x => { x = ((x + 180) % 360 + 360) % 360 - 180; return x; };
  const t0s = M.t0 * DAY, real = s.real;
  // vector from body j to body i (absolute positions in P)
  const dvec = (i, j, Q) => [Q[3 * i] - Q[3 * j], Q[3 * i + 1] - Q[3 * j + 1], Q[3 * i + 2] - Q[3 * j + 2]];
  const len = v => Math.hypot(v[0], v[1], v[2]);
  if (L === A) {
    // target orbits (possibly indirectly) the departure body
    const Bp = pb[pb.indexOf(A) - 1];
    const r1 = rp, mu = muA;
    let r2 = s.a[Bp];
    if (real) { states(s, t0s, P, V); r2 = len(dvec(Bp, A, P)); }
    let at = (r1 + r2) / 2;
    res.tof = Math.PI * Math.sqrt(at * at * at / mu);
    if (real) {
      // arrival distance and the angle B travels during the transfer, from the ephemeris (two passes)
      const pbs = planeBasis(missionPlane(s, t0s));
      for (let it = 0; it < 2; it++) {
        states(s, t0s + res.tof, P, V); r2 = len(dvec(Bp, A, P));
        at = (r1 + r2) / 2; res.tof = Math.PI * Math.sqrt(at * at * at / mu);
      }
      states(s, t0s, P, V); const u0 = dvec(Bp, A, P);
      states(s, t0s + res.tof, P, V); const u1 = dvec(Bp, A, P);
      const sweep = ((planeAngle(pbs, ...u1) - planeAngle(pbs, ...u0)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      res.theta = wrap(sweep * 180 / Math.PI - 180);
    } else res.theta = wrap(res.tof * s.n[Bp] * 180 / Math.PI - 180);
    res.dv = Math.sqrt(mu / r1) * (Math.sqrt(2 * r2 / (r1 + r2)) - 1);
    res.case = 'inner';
  } else if (L === B) {
    // returning to the parent (e.g. Moon -> Earth)
    const Ap = pa[pa.indexOf(B) - 1];
    states(s, t0s, P, V);
    const r1 = real ? len(dvec(Ap, B, P)) : s.a[Ap], r2 = s.R[B] + M.hB * 1e3, mu = s.mu[B];
    const at = (r1 + r2) / 2;
    const vApo = Math.sqrt(mu * (2 / r1 - 1 / at)), vOrb = real ? len(dvec(Ap, B, V)) : Math.sqrt(mu / r1);
    const vinf = Math.abs(vOrb - vApo);
    res.dv = escDv(vinf);
    res.tof = Math.PI * Math.sqrt(at * at * at / mu);
    const pbs = planeBasis(missionPlane(s, t0s));
    states(s, t0s, P, V);
    const e = 1 + rp * vinf * vinf / muA, nuInf = Math.acos(-1 / e);
    const asym = planeAngle(pbs, -(V[3 * Ap] - V[3 * B]), -(V[3 * Ap + 1] - V[3 * B + 1]), -(V[3 * Ap + 2] - V[3 * B + 2]));
    const peri = asym - nuInf;
    const ref = planeAngle(pbs, ...dvec(B, A, P));
    res.theta = wrap((peri - ref) * 180 / Math.PI);
    res.case = 'down';
  } else {
    // siblings under L (patched conic)
    const Ap = pa[pa.indexOf(L) - 1], Bp = pb[pb.indexOf(L) - 1];
    const mu = s.mu[L];
    let r1 = s.a[Ap], r2 = s.a[Bp], at = (r1 + r2) / 2;
    res.tof = Math.PI * Math.sqrt(at * at * at / mu);
    const dn = s.n[Bp] - s.n[Ap];
    const mod = (x, m) => ((x % m) + m) % m;
    if (real) {
      // first date ≥ t0 − 10% synodic period where B is 180° ahead of A's departure point at arrival
      const syn = 2 * Math.PI / Math.abs(dn), step = Math.min(DAY, syn / 400);
      const pbs = planeBasis(missionPlane(s, t0s));
      const lam = (i, t) => { states(s, t, P, V); return planeAngle(pbs, ...dvec(i, L, P)); };
      const tofAt = t => {
        states(s, t, P, V); const a1 = len(dvec(Ap, L, P));
        states(s, t + res.tof, P, V); const a2 = len(dvec(Bp, L, P)), am = (a1 + a2) / 2;
        return Math.PI * Math.sqrt(am * am * am / mu);
      };
      const f = t => { const tf = tofAt(t); return wrapPi(lam(Bp, t + tf) - lam(Ap, t) - Math.PI); };
      const start = t0s - 0.1 * syn;
      let ta = start, fa = f(ta), tt = start;
      for (let tb = start + step; tb < start + 1.2 * syn; tb += step) {
        const fb = f(tb);
        if ((fa < 0) !== (fb < 0) && Math.abs(fb - fa) < Math.PI) { // zero crossing, not the ±π wrap
          let lo = ta, hi = tb;
          for (let it = 0; it < 50; it++) { const mid = 0.5 * (lo + hi); if ((f(mid) < 0) === (fa < 0)) lo = mid; else hi = mid; }
          tt = 0.5 * (lo + hi); break;
        }
        ta = tb; fa = fb;
      }
      res.tof = tofAt(tt);
      states(s, tt, P, V); r1 = len(dvec(Ap, L, P));
      states(s, tt + res.tof, P, V); r2 = len(dvec(Bp, L, P)); at = (r1 + r2) / 2;
      res.t0 = tt / DAY;
    } else {
      // phase: B leads Ap by phi*
      const phiStar = Math.PI - s.n[Bp] * res.tof;
      const ph0 = s.ph[Bp] - s.ph[Ap];
      const tt = dn < 0 ? mod(ph0 - phiStar, 2 * Math.PI) / (-dn) : mod(phiStar - ph0, 2 * Math.PI) / dn;
      res.t0 = tt / DAY;
    }
    const vPer = Math.sqrt(mu * (2 / r1 - 1 / at)), vOrb = Math.sqrt(mu / r1);
    const vinf = Math.abs(vPer - vOrb);
    const outward = r2 > r1;
    // nested departure (A orbits Ap)
    let vinfA = vinf;
    if (Ap !== A) {
      const muAp = s.mu[Ap], rA = s.a[A];
      const vEsc = Math.sqrt(vinf * vinf + 2 * muAp / rA);
      vinfA = Math.max(200, vEsc - rA * s.n[A]);
    }
    res.dv = escDv(vinfA);
    const pbs = planeBasis(missionPlane(s, res.t0 * DAY));
    states(s, res.t0 * DAY, P, V);
    const vref = Ap !== A ? A : Ap, vpar = s.parent[vref];
    let dvx = V[3 * vref] - V[3 * vpar], dvy = V[3 * vref + 1] - V[3 * vpar + 1], dvz = V[3 * vref + 2] - V[3 * vpar + 2];
    if (!outward && Ap === A) { dvx = -dvx; dvy = -dvy; dvz = -dvz; }
    const e = 1 + rp * vinfA * vinfA / muA, nuInf = Math.acos(-1 / e);
    const peri = planeAngle(pbs, dvx, dvy, dvz) - nuInf;
    const ref = planeAngle(pbs, ...dvec(B, A, P));
    res.theta = wrap((peri - ref) * 180 / Math.PI);
    res.case = 'sibling'; res.nested = Ap !== A;
  }
  return res;
}

// Simulation length (days) for "automatic duration": a multiple of the Hohmann transfer time.
function autoDuration(g, mode) {
  const k = mode === 'free' ? 2.4 : mode === 'capture' ? 1.3 : 1.5;
  const tof = g && Number.isFinite(g.tof) ? g.tof : 10 * DAY;
  return Math.max(0.2, Math.min(5000, tof * k / DAY));
}

// ===== Optimizer: coarse scan + Levenberg–Marquardt =====
// side: 0 any, 1 prograde, -1 retrograde around target
function residuals(s, M, sim) {
  const rB = s.R[1] + M.hB * 1e3;
  let dB, dir;
  if (sim.bPeri) { dB = sim.bPeri.d; dir = sim.bPeri.dir; } else { dB = sim.rpB != null ? sim.rpB : sim.dmin[1]; dir = sim.hzMin; }
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

// Unknowns u = [θ, Δv, t₀, β] in scaled units. t₀ and β vary for sibling transfers (β only in the real
// model, where the target's orbit plane differs from the departure body's). For a target orbiting the
// departure body (or the other way round) the mission plane is the target's own orbit plane, the
// residuals barely depend on β, and β stays where it is.
async function optimize(s, M, opt = {}) {
  const onProgress = opt.onProgress || (() => { });
  const varyT0 = !!opt.varyT0, varyBeta = !!opt.varyBeta && s.real;
  const scale = [1, 10, opt.t0Scale || 1, 1]; // deg, m/s, day, deg per unit
  const act = [0, 1].concat(varyT0 ? [2] : [], varyBeta ? [3] : []), nv = act.length;
  let evals = 0;
  const toM = u => ({ ...M, theta: u[0] * scale[0], dv: u[1] * scale[1], t0: varyT0 ? u[2] * scale[2] : M.t0, beta: varyBeta ? u[3] * scale[3] : M.beta });
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
  const u0 = [M.theta / scale[0], M.dv / scale[1], M.t0 / scale[2], (M.beta || 0) / scale[3]];
  const cands = [];
  const tShifts = varyT0 ? (opt.t0Grid || [-4, -2, 0, 2, 4]) : [0];
  for (let th = -180; th < 180; th += 5) for (const ts of tShifts) {
    const u = [th, u0[1], u0[2] + ts, u0[3]];
    const r = R(u, M.mode === 'free' ? 'flyby' : M.mode, 1e-9);
    cands.push({ u, f: nrm([r[0]]) + (r.length > 1 && r[r.length - 1] === 3 ? 9 : 0) }); await tick();
  }
  cands.sort((a, b) => a.f - b.f);
  const seeds = [];
  for (const c of cands) { if (seeds.every(q => Math.abs(q.u[0] - c.u[0]) > 8 || Math.abs(q.u[2] - c.u[2]) > 1)) seeds.push(c); if (seeds.length >= (opt.seeds || 5)) break; }
  // Stage 2: LM
  const hstep = [1e-4, 1e-3, 1e-4, 1e-4];
  const maxStep = [15, Math.max(2, M.dv * 0.03 / scale[1]), 8, 3];
  let best = null;
  for (const sd of seeds) {
    let u = sd.u.slice(), r = R(u), f = nrm(r), lam = 1e-2;
    for (let it = 0; it < 45 && f > 1e-9; it++) {
      const J = [];
      for (const k of act) { const up = u.slice(); up[k] += hstep[k]; const rp = R(up); J.push(rp.map((v, i) => (v - r[i]) / hstep[k])); }
      await tick();
      const JtJ = Array.from({ length: nv }, (_, a) => Array.from({ length: nv }, (_, b) => J[a].reduce((acc, v, i) => acc + v * J[b][i], 0)));
      const Jtr = Array.from({ length: nv }, (_, a) => -J[a].reduce((acc, v, i) => acc + v * r[i], 0));
      let accepted = false;
      for (let tries = 0; tries < 8 && !accepted; tries++) {
        const A = JtJ.map((row, a) => row.map((v, b) => v + (a === b ? lam * (v + 1e-6) + 1e-12 : 0)));
        const d = solveLin(A, Jtr); if (!d) { lam *= 10; continue; }
        const un = u.slice(); act.forEach((k, j) => { un[k] = u[k] + Math.max(-maxStep[k], Math.min(maxStep[k], d[j])); });
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
  const res = { theta: ((m.theta % 360) + 540) % 360 - 180, dv: m.dv, t0: m.t0, f: best.f, evals };
  if (varyBeta) res.beta = m.beta;
  return res;
}

if (typeof module !== 'undefined') module.exports = {
  G, DAY, AU, JYR, OBLIQUITY, utcToDays, daysToUtc, keplerE, laplaceFrame, orbitElements, orbitState, orbitPath,
  buildSystem, defaultOrbitRadius, states, missionPlane, planeBasis, simulate, hohmannGuess, autoDuration, optimize, residuals,
};
