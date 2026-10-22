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

// Body-fixed frame from IAU rotation elements (js/bodies.js pole = [α0, α1, δ0, δ1, W0, W1, terms] deg; α, δ per
// Julian century, W per day, from J2000 TDB; optional periodic terms [cα, cδ, cW, θ0, θ1]) at t (s since J2000) -> J2000 ecliptic, row-major: the columns are the body's
// x (prime meridian on the equator), y and z (north pole) axes. x is W east of the equator's node on the ICRF equator.
// Display only (the physics never turns bodies).
function bodyFrame(pole, t, out = new Array(9)) {
  const T = t / JCY;
  let ra = pole[0] + pole[1] * T, dec = pole[2] + pole[3] * T, w = pole[4] + pole[5] * t / DAY;
  for (const q of pole[6] || []) { const th = (q[3] + q[4] * T) * D2R; ra += q[0] * Math.sin(th); dec += q[1] * Math.cos(th); w += q[2] * Math.sin(th); }
  const L = laplaceFrame(ra, dec), W = w * D2R, c = Math.cos(W), s = Math.sin(W);
  for (let r = 0; r < 3; r++) { const a = L[3 * r], b = L[3 * r + 1]; out[3 * r] = a * c + b * s; out[3 * r + 1] = b * c - a * s; out[3 * r + 2] = L[3 * r + 2]; }
  return out;
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

// ----- Body selection -----
// Smallest body list for a mission from departure a to target b (body keys): a, b, then the ancestors
// each needs up to their lowest common ancestor (the root), a's chain first. parentOf(k) gives the
// parent key or null. Returns { keys, parent } (parent: index in keys, -1 for the root) or an error key.
function missionChain(a, b, parentOf, max = 4) {
  if (a === b) return { error: 'err.chainSame' };
  const up = k => { const c = [k]; for (let p = parentOf(k); p; p = parentOf(p)) c.push(p); return c; };
  const ca = up(a), cb = up(b), lca = ca.find(k => cb.includes(k));
  if (!lca) return { error: 'err.chainNone' };
  const keys = [a, b];
  for (const k of [...ca.slice(0, ca.indexOf(lca) + 1), ...cb.slice(0, cb.indexOf(lca) + 1)]) if (!keys.includes(k)) keys.push(k);
  if (keys.length > max) return { error: 'err.chainLen', params: { n: keys.length, max } };
  return { keys, parent: keys.map(k => (k === lca ? -1 : keys.indexOf(parentOf(k)))) };
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
// Departure type 'asym' (missions set up from a Lambert transfer): θ and β are the departure asymptote's
// longitude λ∞ and latitude δ∞ in A's departure frame (depFrame; β stays 0 in the simplified model). The
// hyperbola lies in the plane through the asymptote closest to A's orbit plane (inclined to it by |δ∞|);
// the burn is at its periapsis, the true anomaly ν∞ = arccos(−1/e) behind the asymptote.
function initialState(s, M) {
  const A = 0, B = 1, t0 = M.t0 * DAY;
  const P = new Float64Array(3 * s.N), V = new Float64Array(3 * s.N);
  const pb = planeBasis(missionPlane(s, t0)), n = pb.n, X = pb.x, Y = pb.y;
  states(s, t0, P, V);
  const r = s.R[A] + M.h0 * 1e3, vc = Math.sqrt(s.mu[A] / r), v = vc + M.dv;
  const f = M.dep === 'asym' ? depFrame(s, P, V) : null;
  if (f) {
    const la = M.theta * D2R, de = s.real ? (M.beta || 0) * D2R : 0, cd = Math.cos(de), sd = Math.sin(de);
    const sh = [0, 1, 2].map(j => cd * (Math.cos(la) * f.x[j] + Math.sin(la) * f.y[j]) + sd * f.z[j]);
    let hh = [0, 1, 2].map(j => f.z[j] - sd * sh[j]), hl = Math.hypot(...hh);
    if (hl < 1e-9) { hh = f.y; hl = 1; } // asymptote along the pole: any plane through it
    hh = hh.map(q => q / hl);
    const e = r * v * v / s.mu[A] - 1, cn = e > 1 ? -1 / e : -1, sn = Math.sqrt(1 - cn * cn);
    const w = [hh[1] * sh[2] - hh[2] * sh[1], hh[2] * sh[0] - hh[0] * sh[2], hh[0] * sh[1] - hh[1] * sh[0]];
    const p = [0, 1, 2].map(j => cn * sh[j] - sn * w[j]);
    const q = [hh[1] * p[2] - hh[2] * p[1], hh[2] * p[0] - hh[0] * p[2], hh[0] * p[1] - hh[1] * p[0]];
    const y = [0, 1, 2, 3, 4, 5].map(j => j < 3 ? P[3 * A + j] + r * p[j] : V[3 * A + j - 3] + v * q[j - 3]);
    return { y, vc, r, n };
  }
  const al = planeAngle(pb, P[3 * B] - P[3 * A], P[3 * B + 1] - P[3 * A + 1], P[3 * B + 2] - P[3 * A + 2]) + M.theta * Math.PI / 180;
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
  let aero = null; // aerocapture pass at B's periapsis (capture mode with aerocapture)
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
    // periapsis events for A and B (and B's apoapsis after an aerocapture pass)
    let eventHandled = false;
    // refine a sign change of the radial rate to body i inside the step by bisection on the step fraction
    // (sg = 1: − to + at periapsis, sg = −1: + to − at apoapsis)
    const refine = (i, sg) => {
      let lo = 0, hi = 1; const ym = new Float64Array(6);
      for (let it = 0; it < 40; it++) {
        const mid = 0.5 * (lo + hi);
        K[0].set(k0); dpStep(s, t0 + t, yStart, h * mid, ym, null);
        if (sg * radialRate(s, t0 + t + h * mid, ym, i) < 0) lo = mid; else hi = mid;
      }
      const tau = 0.5 * (lo + hi); K[0].set(k0); dpStep(s, t0 + t, yStart, h * tau, ym, null);
      const te = t + h * tau;
      return { ym, te, de: distTo(s, t0 + te, ym, i) };
    };
    // replace the velocity relative to B by speed vn along it; continue from there for at most tMax
    const setSpeed = (ym, te, vn, tMax, hNew) => {
      states(s, t0 + te, P, V);
      const rvx = ym[3] - V[3], rvy = ym[4] - V[4], rvz = ym[5] - V[5], vrel = Math.hypot(rvx, rvy, rvz);
      const ny = Float64Array.from(ym);
      ny[3] = V[3] + rvx / vrel * vn; ny[4] = V[4] + rvy / vrel * vn; ny[5] = V[5] + rvz / vrel * vn;
      if (record) { push(te, ym); push(te, ny); }
      y = ny; t = te;
      Tend = Math.min(T, te + tMax);
      h = hNew;
      deriv(s, t0 + t, y, K[0]);
      g0 = [radialRate(s, t0 + t, y, 0), radialRate(s, t0 + t, y, 1)];
      return vrel;
    };
    for (const i of [1, 0]) {
      const g1 = radialRate(s, t0 + tn, y1, i);
      if (i === 1 && aero && !captured && g0[1] > 0 && g1 <= 0 && hit < 0) {
        // apoapsis after the aerocapture pass: raise the periapsis out of the atmosphere (circular orbit)
        const { ym, te, de } = refine(1, -1), vcirc = Math.sqrt(s.mu[1] / de), Pc = 2 * Math.PI * Math.sqrt(de * de * de / s.mu[1]);
        const vrel = setSpeed(ym, te, vcirc, 3 * Pc, Pc / 200);
        captured = { t: te, dv: vcirc - vrel, d: de, aero };
        out.events.push({ type: 'burn', body: 1, t: te, dv: vcirc - vrel, label: 'ev.raise' });
        eventHandled = true; break;
      }
      if (g0[i] < 0 && g1 >= 0 && hit < 0) {
        const { ym, te, de } = refine(i, 1);
        if (de < dmin[i]) { dmin[i] = de; tmin[i] = te; }
        const inSoi = de < s.soi[i];
        if (i === 1 && !bPeri && inSoi) {
          states(s, t0 + te, P, V);
          const hz = spin(P, V, ym, 1, nrm);
          bPeri = { t: te, d: de, dir: hz >= 0 ? 1 : -1, v: Math.hypot(ym[3] - V[3], ym[4] - V[4], ym[5] - V[5]) };
          out.events.push({ type: 'peri', body: 1, t: te, d: de, alt: de - s.R[1], label: 'ev.targetPeri' });
          const ra = s.R[1] + M.hB * 1e3;
          if (M.mode === 'capture' && !fast && !captured && aeroOn(M) && ra > de) {
            // aerocapture: the atmosphere takes the excess speed at periapsis (no fuel), leaving an ellipse
            // with its apoapsis on the final orbit
            const vpe = Math.sqrt(s.mu[1] * (2 / de - 2 / (de + ra))), Pe = 2 * Math.PI * Math.sqrt(Math.pow((de + ra) / 2, 3) / s.mu[1]);
            const vrel = setSpeed(ym, te, vpe, Pe, Pe / 400);
            aero = { t: te, dv: vrel - vpe, d: de };
            out.events.push({ type: 'aero', body: 1, t: te, dv: vrel - vpe, label: 'ev.aero' });
            eventHandled = true; break;
          }
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
        } else if (i === 0 && bPeri && !aRet && !captured && !aero && te > bPeri.t) {
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
  out.bPeri = bPeri; out.aRet = aRet; out.dAafterB = dAafterB; out.captured = captured; out.aero = aero; out.hzMin = hzMin;
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

// ===== Lambert's problem =====
// D. Izzo, "Revisiting Lambert's problem", Celest. Mech. Dyn. Astr. 121 (2015) 1–15: non-dimensional λ from
// the chord geometry and T from the time of flight, initial guess for x (with the later correction of the
// T₁ < T < T₀ branch), Householder iterations on T(x) = T, Battin's hypergeometric series near x = 1.
const hyp2f1b = z => { // ₂F₁(3, 1; 5/2; z), |z| < 1
  let res = 1, term = 1;
  for (let k = 0; k < 300; k++) { term *= (3 + k) * (1 + k) / (2.5 + k) * z / (k + 1); const nr = res + term; if (nr === res) break; res = nr; }
  return res;
};
// non-dimensional time of flight at x (y = √(1 − λ²(1 − x²))), M full revolutions
function lambertT(x, y, ll, M) {
  if (M === 0 && x > 0.7745966692414834 && x < 1.1832159566199232) { // √0.6 < x < √1.4: series
    const eta = y - ll * x;
    return (eta * eta * eta * 4 / 3 * hyp2f1b((1 - ll - x * eta) / 2) + 4 * ll * eta) / 2;
  }
  const q = 1 - x * x;
  const psi = x < 1 ? Math.acos(Math.max(-1, Math.min(1, x * y + ll * q))) : Math.asinh((y - x * ll) * Math.sqrt(-q));
  return ((psi + M * Math.PI) / Math.sqrt(Math.abs(q)) - x + ll * y) / q;
}
const LD = new Float64Array(3);
function lambertD(x, y, T, ll) { // dT/dx, d²T/dx², d³T/dx³ into LD
  const q = 1 - x * x, l2 = ll * ll, l3 = l2 * ll, y3 = y * y * y;
  LD[0] = (3 * T * x - 2 + 2 * l3 * x / y) / q;
  LD[1] = (3 * T + 5 * x * LD[0] + 2 * (1 - l2) * l3 / y3) / q;
  LD[2] = (7 * x * LD[1] + 8 * LD[0] - 6 * (1 - l2) * l3 * l2 * x / (y3 * y * y)) / q;
}
const lambertY = (x, ll) => Math.sqrt(1 - ll * ll * (1 - x * x));
// x solving T(x) = T; NaN when M revolutions do not fit into T or the iteration fails
function lambertX(ll, T, M, right) {
  const T00 = Math.acos(ll) + ll * Math.sqrt(1 - ll * ll);
  let x;
  if (M === 0) {
    const T1 = 2 * (1 - ll * ll * ll) / 3;
    x = T >= T00 ? Math.pow(T00 / T, 2 / 3) - 1
      : T < T1 ? 2.5 * T1 / T * (T1 - T) / (1 - Math.pow(ll, 5)) + 1
        : Math.pow(T / T00, Math.LN2 / Math.log(T1 / T00)) - 1;
  } else {
    // T(0) = T00 + Mπ; below it T may be shorter than the least time with M revolutions (dT/dx = 0, Halley)
    if (T < T00 + M * Math.PI) {
      let xm = 0.1, ok = false;
      for (let k = 0; k < 40; k++) {
        const y = lambertY(xm, ll); lambertD(xm, y, lambertT(xm, y, ll, M), ll);
        const st = 2 * LD[0] * LD[1] / (2 * LD[1] * LD[1] - LD[0] * LD[2]);
        xm -= st;
        if (Math.abs(st) < 1e-13) { ok = true; break; }
      }
      if (!ok || !(T >= lambertT(xm, lambertY(xm, ll), ll, M))) return NaN;
    }
    const a = Math.pow((M + 1) * Math.PI / (8 * T), 2 / 3), b = Math.pow(8 * T / (M * Math.PI), 2 / 3);
    x = right ? (b - 1) / (b + 1) : (a - 1) / (a + 1);
  }
  let st = Infinity;
  for (let k = 0; k < 40; k++) {
    if (Math.abs(1 - x * x) < 1e-14) x -= 1e-9; // the derivatives divide by 1 − x² (parabola)
    const y = lambertY(x, ll), Tx = lambertT(x, y, ll, M), f = Tx - T;
    lambertD(x, y, Tx, ll);
    const d1 = LD[0], d2 = LD[1], d3 = LD[2];
    st = f * (d1 * d1 - f * d2 / 2) / (d1 * (d1 * d1 - f * d2) + d3 * f * f / 6);
    x -= st;
    if (Math.abs(st) < 1e-13 * Math.max(1, Math.abs(x))) return x;
  }
  return Math.abs(st) < 1e-7 ? x : NaN;
}

// Arc from r1 to r2 (m) in time tof (s) around a body with μ (m³/s²); returns { v1, v2 (m/s), type, h } or null.
// Prograde about the reference normal n: the arc's angular momentum h points to n's side, so the transfer
// angle is below 180° (short way, type 1) when (r1 × r2)·n ≥ 0 and above it (long way, type 2) otherwise.
// M ≥ 1 full revolutions have two arcs: right = the larger x. Near 180° r1 × r2 vanishes and the arc's
// plane is undefined; there its normal is n made perpendicular to r1 (a coplanar problem keeps its plane).
function lambert(mu, r1, r2, tof, n, M = 0, right = false) {
  const R1 = Math.hypot(r1[0], r1[1], r1[2]), R2 = Math.hypot(r2[0], r2[1], r2[2]);
  const c = Math.hypot(r2[0] - r1[0], r2[1] - r1[1], r2[2] - r1[2]), s = (R1 + R2 + c) / 2;
  if (!(c > 1e-12 * s) || !(tof > 0)) return null;
  const u1x = r1[0] / R1, u1y = r1[1] / R1, u1z = r1[2] / R1, u2x = r2[0] / R2, u2y = r2[1] / R2, u2z = r2[2] / R2;
  let hx = u1y * u2z - u1z * u2y, hy = u1z * u2x - u1x * u2z, hz = u1x * u2y - u1y * u2x;
  let hl = Math.hypot(hx, hy, hz), ll = Math.sqrt(Math.max(0, 1 - c / s));
  if (hl < 1e-10) {
    const d = n[0] * u1x + n[1] * u1y + n[2] * u1z;
    hx = n[0] - d * u1x; hy = n[1] - d * u1y; hz = n[2] - d * u1z; hl = Math.hypot(hx, hy, hz);
    if (!(hl > 0)) return null;
  } else if (hx * n[0] + hy * n[1] + hz * n[2] < 0) { hx = -hx; hy = -hy; hz = -hz; ll = -ll; }
  hx /= hl; hy /= hl; hz /= hl;
  const x = lambertX(ll, Math.sqrt(2 * mu / (s * s * s)) * tof, M, right);
  if (!Number.isFinite(x)) return null;
  const y = lambertY(x, ll), g = Math.sqrt(mu * s / 2), rho = (R1 - R2) / c, sig = Math.sqrt(Math.max(0, 1 - rho * rho));
  const vr1 = g * ((ll * y - x) - rho * (ll * y + x)) / R1, vr2 = -g * ((ll * y - x) + rho * (ll * y + x)) / R2;
  const vt = g * sig * (y + ll * x), vt1 = vt / R1, vt2 = vt / R2;
  // tangential directions h × u
  return {
    v1: [vr1 * u1x + vt1 * (hy * u1z - hz * u1y), vr1 * u1y + vt1 * (hz * u1x - hx * u1z), vr1 * u1z + vt1 * (hx * u1y - hy * u1x)],
    v2: [vr2 * u2x + vt2 * (hy * u2z - hz * u2y), vr2 * u2y + vt2 * (hz * u2x - hx * u2z), vr2 * u2z + vt2 * (hx * u2y - hy * u2x)],
    type: ll < 0 ? 2 : 1, h: [hx, hy, hz],
  };
}

// ----- Patched-conic transfers between sibling bodies (departure 0 and target 1 orbit the same parent) -----
// Aerocapture is active in capture mode when the pass altitude lies below the final orbit (hAtm < hB, km).
const aeroOn = M => M.mode === 'capture' && !!M.aero && M.hAtm < M.hB;
// apoapsis raise after an aerocapture pass: ellipse rp × ra -> circle at ra (m/s)
const aeroRaise = (mu, rp, ra) => Math.sqrt(mu / ra) - Math.sqrt(2 * mu * rp / (ra * (ra + rp)));
// Δv for the arc's end velocities v1, v2 and the bodies' velocities vA, vB (all relative to the parent):
// escape from a circular parking orbit at h0 into the departure v∞; arrival into a circular orbit at hB
// (capture), the raise burn after an aerocapture pass at hAtm, or nothing (flyby, free return).
function arcDv(s, M, v1, v2, vA, vB) {
  const vd = Math.hypot(v1[0] - vA[0], v1[1] - vA[1], v1[2] - vA[2]), va = Math.hypot(v2[0] - vB[0], v2[1] - vB[1], v2[2] - vB[2]);
  const muA = s.mu[0], rp = s.R[0] + M.h0 * 1e3;
  const dvD = Math.sqrt(vd * vd + 2 * muA / rp) - Math.sqrt(muA / rp);
  let dvA = 0;
  if (M.mode === 'capture') {
    const muB = s.mu[1], rB = s.R[1] + M.hB * 1e3;
    dvA = aeroOn(M) ? aeroRaise(muB, s.R[1] + M.hAtm * 1e3, rB) : Math.sqrt(va * va + 2 * muB / rB) - Math.sqrt(muB / rB);
  }
  return { vd, va, dvD, dvA };
}
const isSibling = s => s.parent[0] >= 0 && s.parent[0] === s.parent[1];
// body i relative to body j after states(): r and v written to out[0..5]
function relState(P, V, i, j, out) {
  for (let k = 0; k < 3; k++) { out[k] = P[3 * i + k] - P[3 * j + k]; out[3 + k] = V[3 * i + k] - V[3 * j + k]; }
  return out;
}
// Departure frame of body 0 (after states()): x along its velocity relative to its parent, z along its orbit
// normal there, y = z × x. The departure asymptote's longitude λ∞ and latitude δ∞ are measured in it.
function depFrame(s, P, V) {
  const p = s.parent[0];
  if (p < 0) return null;
  const st = relState(P, V, 0, p, new Float64Array(6));
  const n = [st[1] * st[5] - st[2] * st[4], st[2] * st[3] - st[0] * st[5], st[0] * st[4] - st[1] * st[3]];
  const nl = Math.hypot(n[0], n[1], n[2]), vl = Math.hypot(st[3], st[4], st[5]);
  if (!(nl > 0)) return null;
  const z = [n[0] / nl, n[1] / nl, n[2] / nl], x = [st[3] / vl, st[4] / vl, st[5] / vl];
  return { x, y: [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]], z };
}
// λ∞, δ∞ (deg) of a departure v∞ vector in the departure frame f
function asymAngles(f, v) {
  const a = v[0] * f.x[0] + v[1] * f.x[1] + v[2] * f.x[2], b = v[0] * f.y[0] + v[1] * f.y[1] + v[2] * f.y[2], c = v[0] * f.z[0] + v[1] * f.z[1] + v[2] * f.z[2];
  return { lam: Math.atan2(b, a) / D2R, dec: Math.asin(Math.max(-1, Math.min(1, c / Math.hypot(a, b, c)))) / D2R };
}

// Lambert transfer leaving body 0 at t1 and reaching body 1 after tof (s), between the bodies' centres around
// their common parent. Returns null for non-siblings or when no arc exists. Angles in degrees: lam/dec =
// departure asymptote in the departure frame; incl = transfer plane against the departure body's orbit
// plane; oop = out-of-plane part of the departure v∞ (m/s, already inside the Δv). c3 in m²/s².
function lambertTransfer(s, t1, tof, M) {
  if (!isSibling(s)) return null;
  const L = s.parent[0], P = s.P, V = s.V, a = new Float64Array(6), b = new Float64Array(6);
  states(s, t1, P, V); relState(P, V, 0, L, a);
  const f = depFrame(s, P, V);
  states(s, t1 + tof, P, V); relState(P, V, 1, L, b);
  const sol = lambert(s.mu[L], [a[0], a[1], a[2]], [b[0], b[1], b[2]], tof, f.z);
  if (!sol) return null;
  const vA = [a[3], a[4], a[5]], vB = [b[3], b[4], b[5]], d = arcDv(s, M, sol.v1, sol.v2, vA, vB);
  const vinfD = [sol.v1[0] - vA[0], sol.v1[1] - vA[1], sol.v1[2] - vA[2]], vinfA = [sol.v2[0] - vB[0], sol.v2[1] - vB[1], sol.v2[2] - vB[2]];
  const ang = asymAngles(f, vinfD), h = sol.h, z = f.z;
  const res = {
    ...d, dv: d.dvD + d.dvA, c3: d.vd * d.vd, vinfD, vinfA, v1: sol.v1, v2: sol.v2, type: sol.type, lam: ang.lam, dec: ang.dec,
    incl: Math.acos(Math.max(-1, Math.min(1, h[0] * z[0] + h[1] * z[1] + h[2] * z[2]))) / D2R,
    oop: Math.abs(vinfD[0] * z[0] + vinfD[1] * z[1] + vinfD[2] * z[2]),
  };
  if (aeroOn(M)) res.vEntry = Math.sqrt(d.va * d.va + 2 * s.mu[1] / (s.R[1] + M.hAtm * 1e3));
  return res;
}
// Mission seed from a Lambert transfer: departure asymptote (dep 'asym': θ = λ∞, β = δ∞), escape Δv, t₀ (days).
function lambertSeed(s, t1, tof, M) {
  const tr = lambertTransfer(s, t1, tof, M);
  if (!tr) return null;
  return { dep: 'asym', theta: tr.lam, beta: s.real ? tr.dec : 0, dv: tr.dvD, t0: t1 / DAY, tof: tof / DAY, tr };
}

// ----- Porkchop -----
// Grid of Lambert transfers from body 0 to body 1 around their common parent: departure t₁ from g.t1a to g.t1b
// (days), time of flight from g.fa to g.fb (days), g.nd × g.nt cells, stored row by row (k = j·nd + i,
// j = time of flight). Per cell: total Δv (m/s, as arcDv), departure C3 (km²/s²) and arrival v∞ (m/s);
// NaN where no arc exists or a date falls outside [g.tMin, g.tMax] (days). min = index of the lowest Δv.
// g.onRow(j) reports progress.
function porkchop(s, M, g) {
  const nd = g.nd, nt = g.nt, n = nd * nt;
  const dv = new Float32Array(n).fill(NaN), c3 = new Float32Array(n).fill(NaN), va = new Float32Array(n).fill(NaN);
  const out = { nd, nt, dv, c3, va, min: -1 };
  if (!isSibling(s)) return out;
  const L = s.parent[0], mu = s.mu[L], P = s.P, V = s.V, tMin = g.tMin != null ? g.tMin : -Infinity, tMax = g.tMax != null ? g.tMax : Infinity;
  const t1 = i => g.t1a + (g.t1b - g.t1a) * i / Math.max(1, nd - 1), tf = j => g.fa + (g.fb - g.fa) * j / Math.max(1, nt - 1);
  const A = [], st = new Float64Array(6);
  for (let i = 0; i < nd; i++) {
    states(s, t1(i) * DAY, P, V); relState(P, V, 0, L, st);
    A.push({ r: [st[0], st[1], st[2]], v: [st[3], st[4], st[5]], z: depFrame(s, P, V).z });
  }
  let best = Infinity;
  const rB = [0, 0, 0], vB = [0, 0, 0];
  for (let j = 0; j < nt; j++) {
    const tof = tf(j);
    for (let i = 0; i < nd; i++) {
      const ta = t1(i), tb = ta + tof;
      if (ta < tMin || tb > tMax) continue;
      states(s, tb * DAY, P, V); relState(P, V, 1, L, st);
      rB[0] = st[0]; rB[1] = st[1]; rB[2] = st[2]; vB[0] = st[3]; vB[1] = st[4]; vB[2] = st[5];
      const a = A[i], sol = lambert(mu, a.r, rB, tof * DAY, a.z);
      if (!sol) continue;
      const d = arcDv(s, M, sol.v1, sol.v2, a.v, vB), k = j * nd + i, tot = d.dvD + d.dvA;
      dv[k] = tot; c3[k] = d.vd * d.vd / 1e6; va[k] = d.va;
      if (tot < best) { best = tot; out.min = k; }
    }
    if (g.onRow) g.onRow(j);
  }
  return out;
}

// ===== Optimizer: coarse scan + Levenberg–Marquardt =====
// side: 0 any, 1 prograde, -1 retrograde around target
function residuals(s, M, sim) {
  // aerocapture aims the approach at the atmosphere pass altitude instead of the final orbit
  const rB = s.R[1] + (aeroOn(M) ? M.hAtm : M.hB) * 1e3;
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
// opt.seeded: start Levenberg–Marquardt from M itself (a Lambert seed) without the angle scan.
// opt.tof (s): also aim the arrival (target periapsis) at this time after departure, in units of 2% of it.
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
    if (opt.tof) r.push(((sim.bPeri ? sim.bPeri.t : sim.tmin[1]) - opt.tof) / (0.02 * opt.tof));
    if (sim.impact === 0 && !(m.mode === 'free' && sim.bPeri)) r.push(3);
    return r;
  };
  const nrm = r => r.reduce((a, b) => a + b * b, 0);
  const tick = async () => { if (evals % 6 === 0) { if (opt.cancelled && opt.cancelled()) throw 'cancel'; onProgress(evals); await new Promise(r => setTimeout(r, 0)); } };
  // Stage 1: coarse scan of burn angle (flyby distance only)
  const u0 = [M.theta / scale[0], M.dv / scale[1], M.t0 / scale[2], (M.beta || 0) / scale[3]];
  const seeds = [];
  if (opt.seeded) seeds.push({ u: u0 });
  else {
    const cands = [];
    const tShifts = varyT0 ? (opt.t0Grid || [-4, -2, 0, 2, 4]) : [0];
    for (let th = -180; th < 180; th += 5) for (const ts of tShifts) {
      const u = [th, u0[1], u0[2] + ts, u0[3]];
      const r = R(u, M.mode === 'free' ? 'flyby' : M.mode, 1e-9);
      cands.push({ u, f: nrm([r[0]]) + (r.length > 1 && r[r.length - 1] === 3 ? 9 : 0) }); await tick();
    }
    cands.sort((a, b) => a.f - b.f);
    for (const c of cands) { if (seeds.every(q => Math.abs(q.u[0] - c.u[0]) > 8 || Math.abs(q.u[2] - c.u[2]) > 1)) seeds.push(c); if (seeds.length >= (opt.seeds || 5)) break; }
  }
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

// Spacecraft state (absolute r, v) at time T (s) after departure: the simulate() integrator without events.
function propagateTo(s, M, T, tol = 1e-10) {
  const t0 = M.t0 * DAY, init = initialState(s, M), y = Float64Array.from(init.y), y1 = new Float64Array(6), err = new Float64Array(6);
  const P = s.P, V = s.V, hmax = T / 200;
  let t = 0, h = 2 * Math.PI * Math.sqrt(Math.pow(init.r, 3) / s.mu[0]) / 400;
  deriv(s, t0, y, K[0]);
  for (let n = 0; n < 50000 && t < T; n++) {
    if (t + h > T) h = T - t;
    states(s, t0 + t, P, V);
    let dn = Infinity, vn = 0;
    for (let i = 0; i < s.N; i++) {
      const k = 3 * i, d = Math.hypot(y[0] - P[k], y[1] - P[k + 1], y[2] - P[k + 2]);
      if (d < dn) { dn = d; vn = Math.hypot(y[3] - V[k], y[4] - V[k + 1], y[5] - V[k + 2]); }
    }
    const k0 = Float64Array.from(K[0]);
    dpStep(s, t0 + t, y, h, y1, err);
    const sp = tol * dn + 1e-3, sv = tol * vn + 1e-6;
    const en = Math.max(Math.abs(err[0]) / sp, Math.abs(err[1]) / sp, Math.abs(err[2]) / sp, Math.abs(err[3]) / sv, Math.abs(err[4]) / sv, Math.abs(err[5]) / sv);
    if (en > 1 && h > 1e-3) { h *= Math.max(0.2, 0.9 * Math.pow(en, -0.2)); K[0].set(k0); continue; }
    y.set(y1); t += h; K[0].set(K[6]);
    h = Math.min(hmax, h * Math.min(4, Math.max(0.2, 0.9 * Math.pow(Math.max(en, 1e-10), -0.2))));
  }
  return y;
}

// N-body refinement of a Lambert seed (M.dep 'asym', M.tof in days): λ∞ (θ), Δv and in the real model δ∞ (β)
// vary, t₀ stays. B-plane targeting with differential correction: with the target made massless, aim the
// craft at the point b·ê from the target's centre at time T after departure (Gauss–Newton on the position
// offset in units of the target's SOI, finite-difference Jacobian). ê ⟂ v∞ picks the side (retrograde for
// side −1, else prograde about the mission plane normal); b starts as the impact parameter
// b = rp·√(1 + 2μ_B/(rp·v∞²)) of the arrival hyperbola with periapsis rp, T as tof. The real target's gravity
// then moves the periapsis and its time a little: rescale b by the same relation and shift T by the time
// error, and aim again (a few rounds). Finally optimize() polishes the periapsis and arrival time.
async function refineSeed(s, M, opt = {}) {
  const onProgress = opt.onProgress || (() => { });
  const tof = M.tof * DAY, real = s.real, act = real ? [0, 1, 2] : [0, 1];
  const tr = lambertTransfer(s, M.t0 * DAY, tof, M);
  let evals = 0;
  const tick = async () => { if (opt.cancelled && opt.cancelled()) throw 'cancel'; onProgress(evals); await new Promise(r => setTimeout(r, 0)); };
  const withU = q => ({ ...M, theta: q[0], dv: q[1], beta: q[2] });
  let u = [M.theta, M.dv, real ? M.beta || 0 : 0];
  if (tr) {
    const s0 = { ...s, mu: Float64Array.from(s.mu) }; s0.mu[1] = 0;
    const rp = s.R[1] + (aeroOn(M) ? M.hAtm : M.hB) * 1e3, va = Math.hypot(...tr.vinfA);
    const imp = r => r * Math.sqrt(1 + 2 * s.mu[1] / (r * va * va));
    const n = missionPlane(s, M.t0 * DAY), w = tr.vinfA.map(q => q / va);
    let e = [w[1] * n[2] - w[2] * n[1], w[2] * n[0] - w[0] * n[2], w[0] * n[1] - w[1] * n[0]];
    const el = Math.hypot(...e); e = e.map(q => q / el * (M.side === -1 ? -1 : 1));
    const sc = s.soi[1], nrm = r => r.reduce((a, c) => a + c * c, 0), hs = [1e-4, 1e-3, 1e-4], cap = [10, 100, 10];
    let b = imp(rp), T = tof;
    for (let round = 0; round < 6; round++) {
      states(s, M.t0 * DAY + T, s.P, s.V);
      const aim = [0, 1, 2].map(j => s.P[3 + j] + b * e[j]);
      const F = q => { evals++; const y = propagateTo(s0, withU(q), T); return [0, 1, 2].map(j => (y[j] - aim[j]) / sc); };
      let r = F(u), f = nrm(r);
      for (let it = 0; it < 25 && f > 1e-14; it++) {
        const J = act.map(k => { const q = u.slice(); q[k] += hs[k]; return F(q).map((v, i) => (v - r[i]) / hs[k]); });
        await tick();
        const A = act.map((_, a) => act.map((__, c) => J[a].reduce((acc, v, i) => acc + v * J[c][i], 0) + (a === c ? 1e-12 : 0)));
        const d = solveLin(A, act.map((_, a) => -J[a].reduce((acc, v, i) => acc + v * r[i], 0)));
        if (!d) break;
        let k = 1, ok = false;
        for (let tries = 0; tries < 8 && !ok; tries++, k /= 3) { // backtracking line search
          const q = u.slice(); act.forEach((m, j) => { q[m] += Math.max(-cap[m], Math.min(cap[m], d[j] * k)); });
          const rq = F(q), fq = nrm(rq);
          if (fq < f) { u = q; r = rq; f = fq; ok = true; }
        }
        if (!ok) break;
      }
      evals++;
      const sim = simulate(s, { ...withU(u), mode: 'flyby' }, { tol: 1e-10, record: false, fast: true, hmaxDiv: 200, maxSteps: 30000 });
      if (!sim.bPeri || sim.impact >= 0) break;
      const dt = sim.bPeri.t - tof;
      if (Math.abs(sim.bPeri.d - rp) < 1e-5 * rp && Math.abs(dt) < 1e-6 * tof) break;
      b *= imp(rp) / imp(sim.bPeri.d); T -= dt;
    }
  }
  const r2 = await optimize(s, withU(u), { ...opt, seeded: true, varyT0: false, varyBeta: real, tof });
  r2.evals += evals;
  return r2;
}

if (typeof module !== 'undefined') module.exports = {
  G, DAY, AU, JYR, OBLIQUITY, utcToDays, daysToUtc, keplerE, laplaceFrame, bodyFrame, orbitElements, orbitState, orbitPath,
  buildSystem, defaultOrbitRadius, states, missionChain, missionPlane, planeBasis, simulate, hohmannGuess, autoDuration, optimize, residuals,
  lambert, lambertTransfer, lambertSeed, porkchop, arcDv, aeroOn, aeroRaise, depFrame, asymAngles, initialState, propagateTo, refineSeed,
};
