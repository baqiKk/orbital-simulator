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
  if (o.sb) { // JPL Small-Body Database osculating elements: [epoch JD TDB, a au, e, i, Ω, ω, M (deg), n deg/day]; fixed
    // ellipse (two-body about the Sun), the mean anomaly carried back from the epoch to J2000
    const [ep, a, e, i, O, w, M, n] = o.sb, n1 = n * D2R / DAY;
    return { a0: a * AU, a1: 0, e0: e, e1: 0, i0: i * D2R, i1: 0, O0: O * D2R, O1: 0, w0: w * D2R, w1: 0,
      M0: M * D2R - n1 * (ep - 2451545) * DAY, M1: n1, F: null };
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

// ===== Orbit maneuvers about one central body =====
// Sources: Vallado, Fundamentals of Astrodynamics and Applications (4th ed.), ch. 6 (Hohmann, bi-elliptic, plane
// changes); Curtis, Orbital Mechanics for Engineering Students, ch. 6 and ch. 4 (oblateness).
// Frame: the central body's equator, inertial (z = spin pole; x as the app picks it: Earth's J2000 equinox, else the
// equator's node on the ICRF equator). The craft's initial orbit has its periapsis at the ascending node (ω₀ = 0), so
// its apse line is the line of nodes ℓ = (cos Ω₀, sin Ω₀, 0). Every burn is on ℓ, side 0 (the initial periapsis, the
// ascending node) or side 1 (the opposite point), at an apsis of the orbits before and after it; a plane change turns
// the orbit about ℓ, so Ω stays and every apse line stays on ℓ. Radii in m, angles in rad, speeds in m/s.
const G0 = 9.80665; // standard gravity (m/s²): exhaust speed c = Isp·g₀

const visViva = (mu, r, a) => Math.sqrt(Math.max(0, mu * (2 / r - 1 / a)));
// Δv of an apsis burn from horizontal speed v1 to v2 that also turns the plane by di: the law of cosines
// v1² + v2² − 2·v1·v2·cos di, written as (v1 − v2)² + 4·v1·v2·sin²(di/2) (no cancellation for small di)
const burnDv = (v1, v2, di) => { const s = Math.sin(di / 2); return Math.sqrt((v1 - v2) * (v1 - v2) + 4 * v1 * v2 * s * s); };
// Tsiolkovsky: propellant (kg) for Δv from wet mass m0; Δv available from m0 down to the dry mass
const propMass = (m0, dv, isp) => m0 * (1 - Math.exp(-dv / (isp * G0)));
const dvAvail = (m0, md, isp) => isp * G0 * Math.log(m0 / md);

// Minimum of f on [a, b]: a grid of n cells, then a golden-section search around the best grid point.
function min1d(f, a, b, n = 64) {
  if (!(b > a)) return { x: a, f: f(a) };
  let bi = 0, bf = Infinity;
  for (let k = 0; k <= n; k++) { const v = f(a + (b - a) * k / n); if (v < bf) { bf = v; bi = k; } }
  let lo = a + (b - a) * Math.max(0, bi - 1) / n, hi = a + (b - a) * Math.min(n, bi + 1) / n;
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = f(x1), f2 = f(x2);
  for (let it = 0; it < 100 && hi - lo > 1e-14; it++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = f(x1); }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = f(x2); }
  }
  const x = f1 < f2 ? x1 : x2, fx = Math.min(f1, f2);
  // keep the grid point (an end of the interval, typically) unless the search really improves on it
  return fx < bf - 1e-12 * Math.abs(bf) ? { x, f: fx } : { x: a + (b - a) * bi / n, f: bf };
}

// Combined plane change: split the turn di over the burns (speed pairs [v1, v2]) at the least total Δv. The cost is
// not convex (a pure turn, 2v·sin(x/2), is concave), so each share is found by a grid and a golden-section search,
// nested for the burns after it. Returns { x: shares, dv: total }.
function planeSplit(pairs, di) {
  if (pairs.length === 0) return { x: [], dv: 0 };
  if (pairs.length === 1) return { x: [di], dv: burnDv(pairs[0][0], pairs[0][1], di) };
  const [p, ...rest] = pairs;
  const m = min1d(x => burnDv(p[0], p[1], x) + planeSplit(rest, di - x).dv, 0, di, rest.length > 1 ? 32 : 64);
  return { x: [m.x, ...planeSplit(rest, di - m.x).x], dv: m.f };
}

// Impulsive plan from the initial orbit o0 to the target o1 ({ rp, ra, i }) about a body with μ and radius R.
// opt: { type: 'hohmann' | 'bielliptic', rb (bi-elliptic apoapsis radius), plane: 'comb' | 'sep', k (1–8) }.
// Hohmann, from any ellipse (two apsis burns): the first at an apsis of o0 (radius rA, side s) moves the far side to
// one target apsis (far); the second, there, moves the near side to the other one (near; near + far = rp1 + ra1):
//   Δv₁ = |v(rA; aT) − v(rA; a0)|, Δv₂ = |v(far; a1) − v(far; aT)|, aT = (rA + far)/2, v(r; a) = √(μ(2/r − 1/a)),
//   time of flight π√(aT³/μ). From a circle to a circle this is the textbook Hohmann transfer.
// Bi-elliptic (three): rA → far side rb; at rb the near side to `near`; at `near` the far side to `far`.
// Both apsides of o0 and both ways of placing the target's apsides are tried; the cheapest (plane change included)
// wins. A burn that changes nothing (e.g. o0 already reaches the target's far apsis) drops out.
// Plane change Δi = i1 − i0 about ℓ: 'comb' splits it over the burns (planeSplit); 'sep' turns the plane alone,
// Δv = 2v·sin(Δi/2), at the slowest point on ℓ of the orbits on the way (the apoapsis of o0, of a transfer leg or of
// the final orbit), next to the burn at the same point when there is one.
// k > 1 splits every burn into k equal vector pieces on successive passes (the total Δv is the same): piece j leaves
// the craft with velocity v₁ + (j/k)(v₂ − v₁) at the burn point, still horizontal, so the point stays an apsis.
// Returns { burns, nodes, dv, tof } or { error } (an i18n key). burns: { node, piece, pieces, side, r, dv, di (signed
// turn), iAfter, rOther (the other apsis after the burn), a (after), now (right after the previous burn), sep }.
function maneuverPlan(mu, R, o0, o1, opt) {
  for (const o of [o0, o1]) {
    if (!(o.rp > R)) return { error: 'err.mvSurface' };
    if (!(o.ra >= o.rp)) return { error: 'err.mvApsis' };
  }
  const bi = opt.type === 'bielliptic', k = Math.max(1, Math.min(8, Math.round(opt.k || 1)));
  if (bi && !(opt.rb > Math.max(o0.ra, o1.ra))) return { error: 'err.mvRb' };
  const a0 = (o0.rp + o0.ra) / 2, a1 = (o1.rp + o1.ra) / 2, DI = o1.i - o0.i, adi = Math.abs(DI), sg = DI < 0 ? -1 : 1;
  const speeds = n => [visViva(mu, n.r, n.a1), visViva(mu, n.r, n.a2)];
  let best = null;
  for (const s of o0.ra > o0.rp ? [0, 1] : [0]) {
    const rA = s ? o0.ra : o0.rp;
    for (const [near, far] of o1.ra > o1.rp ? [[o1.rp, o1.ra], [o1.ra, o1.rp]] : [[o1.rp, o1.rp]]) {
      let nodes;
      if (bi) {
        const t1 = (rA + opt.rb) / 2, t2 = (opt.rb + near) / 2;
        nodes = [{ side: s, r: rA, a1: a0, a2: t1 }, { side: 1 - s, r: opt.rb, a1: t1, a2: t2 }, { side: s, r: near, a1: t2, a2: a1 }];
      } else {
        const aT = (rA + far) / 2;
        nodes = [{ side: s, r: rA, a1: a0, a2: aT }, { side: 1 - s, r: far, a1: aT, a2: a1 }];
      }
      for (const n of nodes) n.di = 0;
      let dv;
      if (opt.plane === 'sep' && adi > 0) {
        // the orbits on the way: o0, then the one after each burn; the apoapsis of each lies on ℓ
        let pick = null;
        for (let j = 0; j <= nodes.length; j++) {
          let a, rApo, side;
          if (j === 0) { a = a0; rApo = o0.ra; side = o0.ra > o0.rp ? 1 : nodes[0].side; }
          else {
            const n = nodes[j - 1], other = 2 * n.a2 - n.r;
            a = n.a2; rApo = Math.max(n.r, other); side = other > n.r * (1 + 1e-12) ? 1 - n.side : n.side;
          }
          const v = visViva(mu, rApo, a);
          if (!pick || v < pick.v * (1 - 1e-12)) pick = { v, j, node: { side, r: rApo, a1: a, a2: a, di: adi, sep: true } };
        }
        nodes.splice(pick.j, 0, pick.node);
        dv = nodes.reduce((acc, n) => acc + burnDv(...speeds(n), n.di), 0);
      } else {
        const ps = planeSplit(nodes.map(speeds), adi);
        nodes.forEach((n, j) => { n.di = ps.x[j]; });
        dv = ps.dv;
      }
      if (!best || dv < best.dv - 1e-9) best = { nodes, dv };
    }
  }
  const nodes = best.nodes.filter(n => burnDv(...speeds(n), n.di) > 1e-6);
  const burns = [];
  let inc = o0.i, prevSide = -1, err = null;
  nodes.forEach((n, m) => {
    const [v1, v2] = speeds(n), x = n.di, dvN = burnDv(v1, v2, x);
    n.v1 = v1; n.v2 = v2; n.dv = dvN; n.iBefore = inc;
    const now = n.side === prevSide; // a burn at the point the previous one left: right away (the same orbit there)
    let phiPrev = 0;
    for (let j = 1; j <= k; j++) {
      const f = j / k, ux = v1 + f * (v2 * Math.cos(x) - v1), uy = f * v2 * Math.sin(x);
      const sp = Math.hypot(ux, uy), phi = Math.atan2(uy, ux), a = 1 / (2 / n.r - sp * sp / mu);
      if (!(a > 0)) { err = 'err.mvEscape'; break; }
      const rO = 2 * a - n.r;
      if (Math.min(rO, n.r) < R) { err = 'err.mvLow'; break; }
      burns.push({ node: m, piece: j, pieces: k, side: n.side, r: n.r, dv: dvN / k, di: sg * (phi - phiPrev), iAfter: n.iBefore + sg * phi,
        rOther: rO, a, now: j === 1 && now, sep: !!n.sep });
      phiPrev = phi;
    }
    inc = n.iBefore + sg * x; prevSide = n.side;
  });
  if (err) return { error: err };
  // time from the first burn to the last: half a period to the other side, a full one back to the same side
  let tof = 0;
  for (let j = 1; j < burns.length; j++) {
    const b = burns[j], p = burns[j - 1];
    if (!b.now) tof += (b.side === p.side ? 2 : 1) * Math.PI * Math.sqrt(p.a * p.a * p.a / mu);
  }
  return { burns, nodes, dv: burns.reduce((acc, b) => acc + b.dv, 0), tof, o0, o1 };
}

// The orbits and options of an app maneuver M (altitudes in km above the equatorial radius Re in m, angles in degrees):
// start hp0 × ha0 at i0; target periapsis altitude hp1, eccentricity e1, inclination i1; bi-elliptic rb altitude.
function mvOrbits(M, Re) {
  const rp1 = Re + M.hp1 * 1e3;
  return { o0: { rp: Re + M.hp0 * 1e3, ra: Re + M.ha0 * 1e3, i: M.i0 * D2R }, o1: { rp: rp1, ra: rp1 * (1 + M.e1) / (1 - M.e1), i: M.i1 * D2R },
    opt: { type: M.type, rb: Re + M.rb * 1e3, plane: M.plane, k: M.k } };
}

// Osculating elements of (r, v) about μ: a, e, i, Ω, ω, apsis radii, unit normal.
function rv2el(mu, r, v) {
  const rn = Math.hypot(r[0], r[1], r[2]), v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2], rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], hn = Math.hypot(h[0], h[1], h[2]);
  const a = 1 / (2 / rn - v2 / mu), ev = [0, 1, 2].map(j => ((v2 - mu / rn) * r[j] - rv * v[j]) / mu), e = Math.hypot(ev[0], ev[1], ev[2]);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hn))), nx = -h[1], ny = h[0], nn = Math.hypot(nx, ny);
  const O = nn > 1e-12 * hn ? Math.atan2(ny, nx) : 0;
  let w = 0;
  if (e > 1e-12) {
    const ux = nn > 1e-12 * hn ? nx / nn : 1, uy = nn > 1e-12 * hn ? ny / nn : 0, hu = h.map(q => q / hn);
    const wy = [hu[1] * 0 - hu[2] * uy, hu[2] * ux - hu[0] * 0, hu[0] * uy - hu[1] * ux]; // ĥ × node
    w = Math.atan2(ev[0] * wy[0] + ev[1] * wy[1] + ev[2] * wy[2], ev[0] * ux + ev[1] * uy);
  }
  return { a, e, i, O, w, rp: a * (1 - e), ra: a * (1 + e), p: hn * hn / mu, n: h.map(q => q / hn) };
}

// Osculating conic of a state (r, v about a body of GM mu; any axes, the points come back in the same ones), for drawing:
// r(ν) = p/(1 + e·cos ν) in the orbit's plane, p = h²/μ. An ellipse: K points evenly in the eccentric anomaly (closed);
// a hyperbola or a parabola: its one branch, ν within the asymptotes (a little short of them) and out to rMax, K points
// evenly in ν. out: Float64Array(3K) or larger (reused). Returns { n, closed, e, a, p, vinf } (vinf: hyperbolic excess
// speed, open orbits), or null for a radial state or when the whole branch lies beyond rMax.
function conicPoints(mu, r, v, K, rMax, out) {
  const rn = Math.hypot(r[0], r[1], r[2]), v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2], rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], hn = Math.hypot(h[0], h[1], h[2]);
  if (!(hn > 1e-9 * rn * Math.sqrt(v2))) return null;
  const ev = [0, 1, 2].map(j => ((v2 - mu / rn) * r[j] - rv * v[j]) / mu), e = Math.hypot(ev[0], ev[1], ev[2]), p = hn * hn / mu;
  const P = e > 1e-9 ? ev.map(q => q / e) : r.map(q => q / rn), hu = h.map(q => q / hn);
  const Q = [hu[1] * P[2] - hu[2] * P[1], hu[2] * P[0] - hu[0] * P[2], hu[0] * P[1] - hu[1] * P[0]];
  const put = (k, x, y) => { for (let j = 0; j < 3; j++) out[3 * k + j] = x * P[j] + y * Q[j]; };
  if (e < 1 - 1e-6) {
    const a = p / (1 - e * e), b = a * Math.sqrt(1 - e * e);
    for (let k = 0; k < K; k++) { const E = 2 * Math.PI * k / K; put(k, a * (Math.cos(E) - e), b * Math.sin(E)); }
    return { n: K, closed: true, e, a, p, vinf: 0 };
  }
  let lim = (e > 1 ? Math.acos(-1 / e) : Math.PI) - 0.02;
  const c = (p / rMax - 1) / e;
  if (c >= 1) return null;
  if (c > -1) lim = Math.min(lim, Math.acos(c));
  if (!(lim > 0)) return null;
  for (let k = 0; k < K; k++) { const nu = -lim + 2 * lim * k / (K - 1), rr = p / (1 + e * Math.cos(nu)); put(k, rr * Math.cos(nu), rr * Math.sin(nu)); }
  return { n: K, closed: false, e, a: e > 1 ? -p / (e * e - 1) : Infinity, p, vinf: e > 1 ? Math.sqrt(mu * (e * e - 1) / p) : 0 };
}
// The body whose sphere of influence holds point (x, y, z), states P (3 per body): the innermost one (the smallest
// SOI that contains it); the root's is unbounded (patched conics: the body the craft's conic is drawn about)
function domBody(s, P, x, y, z) {
  let best = s.root, bs = Infinity;
  for (let i = 0; i < s.N; i++) {
    const so = s.soi[i];
    if (so < bs && Math.hypot(x - P[3 * i], y - P[3 * i + 1], z - P[3 * i + 2]) < so) { best = i; bs = so; }
  }
  return best;
}

// Secular J2 rates (rad/s) of Ω, ω and the mean anomaly for a, e, i (Vallado ch. 9; Curtis ch. 4):
// Ω̇ = −(3/2)·n·J2·(Re/p)²·cos i, ω̇ = (3/4)·n·J2·(Re/p)²·(5cos²i − 1), Ṁ − n = (3/4)·n·J2·(Re/p)²·√(1−e²)·(3cos²i − 1).
function j2Rates(mu, J2, Re, a, e, i) {
  const n = Math.sqrt(mu / (a * a * a)), p = a * (1 - e * e), q = n * J2 * (Re / p) * (Re / p), c = Math.cos(i);
  return { dO: -1.5 * q * c, dw: 0.75 * q * (5 * c * c - 1), dM: 0.75 * q * Math.sqrt(1 - e * e) * (3 * c * c - 1) };
}

// Two-body state dt after (r0, v0) on an ellipse (f and g functions, Kepler's equation in ΔE), with an optional
// secular drift rates = { dO, dw, dM }: mean motion n + dM, the result turned about the orbit normal by dw·dt and
// about z by dO·dt. Writes position and velocity to out[0..5].
function keplerStep(mu, r0, v0, dt, rates, out) {
  const rn = Math.hypot(r0[0], r0[1], r0[2]), v2 = v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2];
  const a = 1 / (2 / rn - v2 / mu), sa = Math.sqrt(a), n = Math.sqrt(mu / (a * a * a));
  const s0 = (r0[0] * v0[0] + r0[1] * v0[1] + r0[2] * v0[2]) / Math.sqrt(mu), ec = 1 - rn / a, es = s0 / sa;
  const dM = (n + (rates ? rates.dM : 0)) * dt, M = dM - 2 * Math.PI * Math.floor(dM / (2 * Math.PI));
  let E = M;
  for (let it = 0; it < 50; it++) { // ΔM = ΔE + es(1 − cos ΔE) − ec·sin ΔE
    const d = (E + es * (1 - Math.cos(E)) - ec * Math.sin(E) - M) / (1 - ec * Math.cos(E) + es * Math.sin(E));
    E -= d; if (Math.abs(d) < 1e-14) break;
  }
  const cE = Math.cos(E), sE = Math.sin(E), r = a + (rn - a) * cE + s0 * sa * sE;
  const f = 1 - a / rn * (1 - cE), g = M / n - (E - sE) / n, fd = -Math.sqrt(mu * a) / (r * rn) * sE, gd = 1 - a / r * (1 - cE);
  const p = [0, 1, 2].map(j => f * r0[j] + g * v0[j]), v = [0, 1, 2].map(j => fd * r0[j] + gd * v0[j]);
  if (rates) {
    const h = [r0[1] * v0[2] - r0[2] * v0[1], r0[2] * v0[0] - r0[0] * v0[2], r0[0] * v0[1] - r0[1] * v0[0]], hl = Math.hypot(h[0], h[1], h[2]);
    const k = h.map(q => q / hl), rot = (u, ax, ang) => { // Rodrigues
      const c = Math.cos(ang), s = Math.sin(ang), d = (ax[0] * u[0] + ax[1] * u[1] + ax[2] * u[2]) * (1 - c);
      return [u[0] * c + (ax[1] * u[2] - ax[2] * u[1]) * s + ax[0] * d, u[1] * c + (ax[2] * u[0] - ax[0] * u[2]) * s + ax[1] * d, u[2] * c + (ax[0] * u[1] - ax[1] * u[0]) * s + ax[2] * d];
    };
    const Z = [0, 0, 1], aw = rates.dw * dt, aO = rates.dO * dt;
    const p2 = rot(rot(p, k, aw), Z, aO), v3 = rot(rot(v, k, aw), Z, aO);
    for (let j = 0; j < 3; j++) { out[j] = p2[j]; out[3 + j] = v3[j]; }
    return out;
  }
  for (let j = 0; j < 3; j++) { out[j] = p[j]; out[3 + j] = v[j]; }
  return out;
}

// Equator of a body (IAU pole p = [α0, α1, δ0, δ1, …], periodic terms [cα, cδ, cW, θ0, θ1] at index k) at t: the
// rotation equator -> J2000 ecliptic, x toward the equator's node on the ICRF equator (laplaceFrame).
function equatorFrame(p, t, k) {
  const T = t / JCY;
  let ra = p[0] + p[1] * T, dec = p[2] + p[3] * T;
  for (const q of p[k] || []) { const th = (q[3] + q[4] * T) * D2R; ra += q[0] * Math.sin(th); dec += q[1] * Math.cos(th); }
  return laplaceFrame(ra, dec);
}

// State (equatorial frame) on orbit o = { rp, ra, i } with node Ω and ω = 0, at true anomaly nu.
function orbitPoint(mu, o, O, nu) {
  const a = (o.rp + o.ra) / 2, e = (o.ra - o.rp) / (o.ra + o.rp), p = a * (1 - e * e), r = p / (1 + e * Math.cos(nu)), w = Math.sqrt(mu / p);
  const P = [Math.cos(O), Math.sin(O), 0], Q = [-Math.sin(O) * Math.cos(o.i), Math.cos(O) * Math.cos(o.i), Math.sin(o.i)];
  const xp = r * Math.cos(nu), yp = r * Math.sin(nu), vxp = -w * Math.sin(nu), vyp = w * (e + Math.cos(nu));
  return [0, 1, 2].map(j => xp * P[j] + yp * Q[j]).concat([0, 1, 2].map(j => vxp * P[j] + vyp * Q[j]));
}

// Closed-loop apsis burn b at state y (equator frame): the velocity after it. Horizontal (the point becomes an apsis),
// with the speed that puts the other apsis at b.rOther, turned about the radius to the planned inclination b.iAfter
// (of the two turns that reach it, the one nearer the plan's signed turn).
function mvImpulse(mu, y, b) {
  const r = [y[0], y[1], y[2]], rn = Math.hypot(r[0], r[1], r[2]), u = r.map(q => q / rn);
  const hv = [y[1] * y[5] - y[2] * y[4], y[2] * y[3] - y[0] * y[5], y[0] * y[4] - y[1] * y[3]], hl = Math.hypot(hv[0], hv[1], hv[2]), n = hv.map(q => q / hl);
  const tt = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const vh = Math.sqrt(2 * mu * b.rOther / (rn * (rn + b.rOther)));
  // turn by φ about the radius: normal' = cos φ·n − sin φ·t̂, so cos i' = A cos φ + B sin φ
  const A = n[2], B = -tt[2], rho = Math.hypot(A, B), psi = Math.atan2(B, A), cc = Math.max(-1, Math.min(1, Math.cos(b.iAfter) / (rho || 1)));
  const want = (b.side === 0 ? 1 : -1) * b.di, ac = Math.acos(cc);
  let phi = 0;
  if (rho > 0) { const c1 = wrapPi(psi + ac), c2 = wrapPi(psi - ac); phi = Math.abs(c1 - want) <= Math.abs(c2 - want) ? c1 : c2; }
  return [0, 1, 2].map(j => vh * (Math.cos(phi) * tt[j] + Math.sin(phi) * n[j]));
}

// Dormand–Prince 5(4) step for an autonomous system y' = f(y) of n components; K[0] must hold f(y).
function dpStepN(f, n, y, h, yOut, errOut, K, YT) {
  for (let st = 1; st < 7; st++) {
    const row = DP.a[st];
    for (let j = 0; j < n; j++) { let acc = y[j]; for (let q = 0; q < st; q++) acc += h * row[q] * K[q][j]; YT[j] = acc; }
    f(YT, K[st]);
  }
  for (let j = 0; j < n; j++) yOut[j] = YT[j];
  if (errOut) for (let j = 0; j < n; j++) { let e = 0; for (let q = 0; q < 7; q++) e += DP.e[q] * K[q][j]; errOut[j] = h * e; }
}

// Fly the plan: two-body (+ J2: a = −(3/2)·J2·μ·Re²/r⁵·[x(1 − 5z²/r²), y(1 − 5z²/r²), z(3 − 5z²/r²)]) with DP5(4).
// c: { mu, R, J2, Re, rot (equator -> ecliptic, row-major), O0 (Ω₀) }. The craft starts on o0 a quarter turn before
// the first burn. A burn fires where the craft crosses ℓ on its side: the line of nodes (z = 0, ascending = side 0)
// once the orbit is inclined, else the line ℓ itself; a piece of a split burn waits for the next pass. Each burn is
// closed-loop from the actual state: the velocity becomes horizontal (the point an apsis) with the speed that puts the
// other apsis at the planned radius, turned about the radius to the planned inclination; its Δv is what that took.
// After the last burn the craft coasts opts.tail periods (no burns: opts.tail seconds). Output like simulate(): samples
// (ecliptic axes, centred on the body), events, plus burns (executed), done (osculating elements after the last burn)
// and end (equatorial state at the end).
function maneuverSim(c, plan, opts = {}) {
  const { mu, R } = c, kJ = c.J2 ? 1.5 * c.J2 * mu * c.Re * c.Re : 0, rot = c.rot, O0 = c.O0 || 0, tol = opts.tol || 1e-10;
  const f = (y, out) => {
    const x = y[0], yy = y[1], z = y[2], r2 = x * x + yy * yy + z * z, r = Math.sqrt(r2), k = mu / (r2 * r);
    let ax = -k * x, ay = -k * yy, az = -k * z;
    if (kJ) { const q = kJ / (r2 * r2 * r), w = 5 * z * z / r2; ax -= q * x * (1 - w); ay -= q * yy * (1 - w); az -= q * z * (3 - w); }
    out[0] = y[3]; out[1] = y[4]; out[2] = y[5]; out[3] = ax; out[4] = ay; out[5] = az;
  };
  const Kb = Array.from({ length: 7 }, () => new Float64Array(6)), YT = new Float64Array(6);
  const L = [Math.cos(O0), Math.sin(O0), 0], Mx = [-Math.sin(O0), Math.cos(O0), 0];
  const burns = plan.burns || [];
  const period = y => { const r = Math.hypot(y[0], y[1], y[2]), a = 1 / (2 / r - (y[3] * y[3] + y[4] * y[4] + y[5] * y[5]) / mu); return a > 0 ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity; };
  const normal = y => { const h = [y[1] * y[5] - y[2] * y[4], y[2] * y[3] - y[0] * y[5], y[0] * y[4] - y[1] * y[3]], l = Math.hypot(...h); return h.map(q => q / l); };
  const inclined = y => { const n = normal(y); return Math.hypot(n[0], n[1]) > 1e-9; };
  const gOf = (y, zMode) => zMode ? y[2] : y[0] * Mx[0] + y[1] * Mx[1];
  const side0 = burns.length ? burns[0].side : 0;
  let y = Float64Array.from(orbitPoint(mu, plan.o0, O0, side0 * Math.PI - Math.PI / 2));
  const out = { t: [], x: [], y: [], z: [], vx: [], vy: [], vz: [], events: [], burns: [], impact: -1, ok: true, steps: 0 };
  const push = (tt, q) => {
    out.t.push(tt);
    for (const [key, o] of [['x', 0], ['y', 1], ['z', 2], ['vx', 3], ['vy', 4], ['vz', 5]]) {
      const b = o < 3 ? 0 : 3;
      out[key].push(rot ? rot[3 * (o - b)] * q[b] + rot[3 * (o - b) + 1] * q[b + 1] + rot[3 * (o - b) + 2] * q[b + 2] : q[o]);
    }
  };
  const ecl = u => rot ? [0, 1, 2].map(j => rot[3 * j] * u[0] + rot[3 * j + 1] * u[1] + rot[3 * j + 2] * u[2]) : u.slice();
  out.normal = ecl(normal(y));
  let t = 0, bi = 0, tLast = -Infinity, P = period(y), zMode = inclined(y), g0 = gOf(y, zMode);
  let tEnd = burns.length ? Infinity : (opts.tail || P);
  let h = P / 400;
  const y1 = new Float64Array(6), err = new Float64Array(6), maxSteps = opts.maxSteps || 400000;
  push(0, y); f(y, Kb[0]);
  const fire = () => { // burn bi at the current state
    const b = burns[bi], r = [y[0], y[1], y[2]], nv = mvImpulse(mu, y, b);
    const dv = Math.hypot(nv[0] - y[3], nv[1] - y[4], nv[2] - y[5]);
    const ex = { node: b.node, piece: b.piece, pieces: b.pieces, t, dv, plan: b.dv, sep: b.sep, side: b.side };
    y[3] = nv[0]; y[4] = nv[1]; y[5] = nv[2];
    ex.el = rv2el(mu, r, nv); ex.di = ex.el.i - (out.burns.length ? out.burns[out.burns.length - 1].el.i : plan.o0.i);
    out.burns.push(ex);
    out.events.push({ type: 'burn', t, dv, body: 0, label: 'ev.mvBurn', node: b.node, piece: b.piece, pieces: b.pieces, di: ex.di, sep: b.sep });
    push(t, y);
    bi++; tLast = t; P = period(y); zMode = inclined(y); g0 = gOf(y, zMode); h = P / 400;
    f(y, Kb[0]);
    if (bi === burns.length) { tEnd = t + (opts.tail || 0.5) * P; out.done = ex.el; }
  };
  while (out.steps < maxSteps) {
    if (bi < burns.length && burns[bi].now) { fire(); continue; }
    if (t >= tEnd - 1e-9) break;
    out.steps++;
    h = Math.min(h, P / 40, tEnd - t);
    const yStart = Float64Array.from(y), k0 = Float64Array.from(Kb[0]);
    dpStepN(f, 6, y, h, y1, err, Kb, YT);
    const rn = Math.hypot(y[0], y[1], y[2]), vn = Math.hypot(y[3], y[4], y[5]), sp = tol * rn + 1e-3, sv = tol * vn + 1e-6;
    const en = Math.max(Math.abs(err[0]) / sp, Math.abs(err[1]) / sp, Math.abs(err[2]) / sp, Math.abs(err[3]) / sv, Math.abs(err[4]) / sv, Math.abs(err[5]) / sv);
    if (en > 1 && h > 1e-3) { h *= Math.max(0.2, 0.9 * Math.pow(en, -0.2)); Kb[0].set(k0); continue; }
    const k7 = Float64Array.from(Kb[6]);
    if (Math.hypot(y1[0], y1[1], y1[2]) < R) {
      push(t + h, y1); out.impact = 0; out.events.push({ type: 'impact', body: 0, t: t + h, label: 'ev.impact' }); t += h; break;
    }
    // burn point crossed? (sign change of g on the right side, not the point just burned at)
    const g1 = gOf(y1, zMode);
    if (bi < burns.length && t + h - tLast > 0.1 * P && g0 !== g1 && (g0 < 0) !== (g1 < 0)) {
      const sideAt = q => zMode ? (g1 > g0 ? 0 : 1) : (q[0] * L[0] + q[1] * L[1] > 0 ? 0 : 1);
      if (sideAt(y1) === burns[bi].side) {
        let lo = 0, hi = 1; const ym = new Float64Array(6);
        for (let it = 0; it < 60; it++) {
          const mid = 0.5 * (lo + hi);
          Kb[0].set(k0); dpStepN(f, 6, yStart, h * mid, ym, null, Kb, YT);
          if ((gOf(ym, zMode) < 0) === (g0 < 0)) lo = mid; else hi = mid;
        }
        Kb[0].set(k0); dpStepN(f, 6, yStart, h * hi, ym, null, Kb, YT);
        t += h * hi; y.set(ym); push(t, y);
        fire();
        continue;
      }
    }
    y.set(y1); t += h; g0 = g1; push(t, y);
    Kb[0].set(k7);
    h *= Math.min(4, Math.max(0.2, 0.9 * Math.pow(Math.max(en, 1e-10), -0.2)));
  }
  if (bi < burns.length) out.ok = false;
  out.tEnd = t; out.end = Array.from(y);
  out.tFirst = out.burns.length ? out.burns[0].t : 0; out.tLast = out.burns.length ? out.burns[out.burns.length - 1].t : 0;
  return out;
}

// ----- Finite burns and low-thrust spirals -----
// A flight with an engine: state [r, v, m, ∫F/m dt] (equator frame), DP5(4), two-body + J2 + thrust F/m along the steered
// direction, ṁ = −F/(Isp·g₀) while it burns. Shared integrator: seg(tStop, o) advances (t, y) to tStop or to the first
// event: o.g (a function positive before, ≤ 0 after: the cut-off, the dry mass) or o.cross (the burn line on a side, as
// in maneuverSim); events are refined by bisection on the step. o.rec: record every step (true) or when o.rec(t, y) says.
function flight(c, fin, opts) {
  const { mu, R } = c, kJ = c.J2 ? 1.5 * c.J2 * mu * c.Re * c.Re : 0, rot = c.rot, O0 = c.O0 || 0, tol = opts.tol || 1e-10;
  const ve = fin.isp * G0, mdot = fin.F / ve, maxSteps = opts.maxSteps || 3000000;
  const L = [Math.cos(O0), Math.sin(O0), 0], Mx = [-Math.sin(O0), Math.cos(O0), 0];
  // thrust: off, or a direction from dir(y, out) (unit vector)
  const T = { on: false, dir: null }, U = [0, 0, 0];
  const f = (y, out) => {
    const x = y[0], yy = y[1], z = y[2], r2 = x * x + yy * yy + z * z, r = Math.sqrt(r2), k = mu / (r2 * r);
    let ax = -k * x, ay = -k * yy, az = -k * z;
    if (kJ) { const q = kJ / (r2 * r2 * r), w = 5 * z * z / r2; ax -= q * x * (1 - w); ay -= q * yy * (1 - w); az -= q * z * (3 - w); }
    out[0] = y[3]; out[1] = y[4]; out[2] = y[5];
    if (T.on) { T.dir(y, U); const a = fin.F / y[6]; ax += a * U[0]; ay += a * U[1]; az += a * U[2]; out[6] = -mdot; out[7] = a; }
    else { out[6] = 0; out[7] = 0; }
    out[3] = ax; out[4] = ay; out[5] = az;
  };
  const K = Array.from({ length: 7 }, () => new Float64Array(8)), YT = new Float64Array(8), y1 = new Float64Array(8), err = new Float64Array(8);
  const out = { t: [], x: [], y: [], z: [], vx: [], vy: [], vz: [], m: [], events: [], burns: [], impact: -1, ok: true, steps: 0 };
  const F = { T, f, out, ve, mdot, L, y: new Float64Array(8), t: 0, h: 0, mu };
  F.push = () => {
    const q = F.y; out.t.push(F.t); out.m.push(q[6]);
    for (const [key, o] of [['x', 0], ['y', 1], ['z', 2], ['vx', 3], ['vy', 4], ['vz', 5]]) {
      const b = o < 3 ? 0 : 3, j = o - b;
      out[key].push(rot ? rot[3 * j] * q[b] + rot[3 * j + 1] * q[b + 1] + rot[3 * j + 2] * q[b + 2] : q[o]);
    }
  };
  F.period = q => { const r = Math.hypot(q[0], q[1], q[2]), a = 1 / (2 / r - (q[3] * q[3] + q[4] * q[4] + q[5] * q[5]) / mu); return a > 0 ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : 1e4; };
  F.seg = (tStop, o = {}) => {
    const y = F.y, rec = o.rec;
    const zMode = Math.hypot(y[1] * y[5] - y[2] * y[4], y[2] * y[3] - y[0] * y[5]) > 1e-9 * Math.hypot(y[0], y[1], y[2]) * Math.hypot(y[3], y[4], y[5]);
    const gl = q => zMode ? q[2] : q[0] * Mx[0] + q[1] * Mx[1];
    let c0 = gl(y);
    f(y, K[0]);
    while (F.t < tStop - 1e-9) {
      if (++out.steps > maxSteps) { out.ok = false; return 'steps'; }
      const t = F.t, h = F.h = Math.min(F.h, F.period(y) / 40, tStop - t);
      const yStart = Float64Array.from(y), k0 = Float64Array.from(K[0]);
      dpStepN(f, 8, y, h, y1, err, K, YT);
      const rn = Math.hypot(y[0], y[1], y[2]), vn = Math.hypot(y[3], y[4], y[5]), sp = tol * rn + 1e-3, sv = tol * vn + 1e-6;
      const en = Math.max(Math.abs(err[0]) / sp, Math.abs(err[1]) / sp, Math.abs(err[2]) / sp, Math.abs(err[3]) / sv, Math.abs(err[4]) / sv, Math.abs(err[5]) / sv);
      if (en > 1 && h > 1e-3) { F.h = h * Math.max(0.2, 0.9 * Math.pow(en, -0.2)); K[0].set(k0); continue; }
      const k7 = Float64Array.from(K[6]);
      if (Math.hypot(y1[0], y1[1], y1[2]) < R) {
        y.set(y1); F.t = t + h; F.push(); out.impact = 0; out.ok = false; out.events.push({ type: 'impact', body: 0, t: F.t, label: 'ev.impact' }); return 'impact';
      }
      let ev = null;
      if (o.g && o.g(y1) <= 0) ev = q => o.g(q) > 0;
      else if (o.cross && t + h > o.cross.after) {
        const c1 = gl(y1);
        if (c0 !== c1 && (c0 < 0) !== (c1 < 0)) {
          const side = zMode ? (c1 > c0 ? 0 : 1) : (y1[0] * L[0] + y1[1] * L[1] > 0 ? 0 : 1);
          if (side === o.cross.side) { const s0 = c0 < 0; ev = q => (gl(q) < 0) === s0; }
        }
        c0 = c1;
      }
      if (ev) { // refine: the largest step fraction before the event, then just past it
        let lo = 0, hi = 1; const ym = new Float64Array(8);
        for (let it = 0; it < 60; it++) { const mid = 0.5 * (lo + hi); K[0].set(k0); dpStepN(f, 8, yStart, h * mid, ym, null, K, YT); if (ev(ym)) lo = mid; else hi = mid; }
        K[0].set(k0); dpStepN(f, 8, yStart, h * hi, ym, null, K, YT);
        if (o.onStep) o.onStep(yStart, ym);
        y.set(ym); F.t = t + h * hi;
        if (rec) F.push();
        return o.g && !o.cross ? 'g' : 'cross';
      }
      if (o.onStep) o.onStep(yStart, y1);
      y.set(y1); F.t = t + h;
      if (rec === true || (rec && rec(F.t, y))) F.push();
      K[0].set(k7);
      F.h *= Math.min(4, Math.max(0.2, 0.9 * Math.pow(Math.max(en, 1e-10), -0.2)));
    }
    return 'end';
  };
  return F;
}
const elA = (mu, q) => 1 / (2 / Math.hypot(q[0], q[1], q[2]) - (q[3] * q[3] + q[4] * q[4] + q[5] * q[5]) / mu);
const elI = q => { const hx = q[1] * q[5] - q[2] * q[4], hy = q[2] * q[3] - q[0] * q[5], hz = q[0] * q[4] - q[1] * q[3]; return Math.acos(Math.max(-1, Math.min(1, hz / Math.hypot(hx, hy, hz)))); };
// angle between the radius vectors of two states (summed over steps: the arc swept)
const sweep = (a, b) => { const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0]; return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]); };

// Fly an impulsive plan with a real engine (fin: { F N, isp s, m0, md kg, steer 'local' | 'inertial' }). Each planned
// burn: a coast prediction finds where the impulsive burn would be (its apsis on the burn line) and what it would take
// there (mvImpulse: Δv_ref and its direction). The finite burn is centred on that point by Δv, not by time: it starts
// t½ = (m/ṁ)(1 − e^(−Δv_ref/2c)) earlier (half the Δv delivered at the apsis), or right after the previous burn when it is
// meant to follow it. Steering: 'local' keeps the impulsive Δv's split between the velocity direction and the orbit
// normal (a tangential burn follows the velocity), 'inertial' keeps the impulsive Δv direction fixed in space. Cut-off:
// on the target, not the clock — the osculating semi-major axis reaching the plan's (the plane alone for a pure turn);
// a burn that also turns the plane finds its out-of-plane angle by a secant search so the inclination lands too. The
// dry mass stops the engine. Per burn: duration, Δv = c·ln(m₀/m₁) (and ∫F/m dt), propellant, arc swept, Δv_ref, loss.
// Totals: dvFin, dvImp (Σ Δv_ref), loss = dvFin − dvImp (gravity / steering loss), fuel and fuelImp (Tsiolkovsky).
function maneuverFlight(c, plan, fin, opts = {}) {
  const F = flight(c, fin, opts), { T, out, ve, mdot } = F, mu = c.mu, rot = c.rot, record = opts.record !== false, y = F.y;
  const burns = plan.burns, O0 = c.O0 || 0, md = fin.md;
  // inclination signed about the line of nodes ℓ (normal = cos i·z − sin i·(z × ℓ)): continuous through 0°
  const Mx = [-Math.sin(O0), Math.cos(O0), 0];
  const incS = q => { const hx = q[1] * q[5] - q[2] * q[4], hy = q[2] * q[3] - q[0] * q[5], hz = q[0] * q[4] - q[1] * q[3]; return Math.atan2(-(hx * Mx[0] + hy * Mx[1]), hz); };
  // the impulsive flight of the same plan: the reference the finite one is compared with
  const imp = maneuverSim(c, plan, { tol: opts.tol });
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = a => { const l = Math.hypot(a[0], a[1], a[2]); return a.map(q => q / l); };
  const ecl = u => rot ? [0, 1, 2].map(j => rot[3 * j] * u[0] + rot[3 * j + 1] * u[1] + rot[3 * j + 2] * u[2]) : u.slice();
  // start a quarter turn (or half the first burn's arc and more) before the first burn
  let off = Math.PI / 2;
  if (burns.length) {
    const b = burns[0], a0 = (plan.o0.rp + plan.o0.ra) / 2, v = visViva(mu, b.r, a0), tb = fin.m0 / mdot * (1 - Math.exp(-b.dv / ve));
    off = Math.min(0.95 * Math.PI, Math.max(off, Math.PI / 4 + 0.6 * v / b.r * tb));
  }
  y.set([...orbitPoint(mu, plan.o0, O0, (burns.length ? burns[0].side : 0) * Math.PI - off), fin.m0, 0]);
  F.h = F.period(y) / 400;
  out.normal = ecl(unit(cross(y, y.subarray(3, 6))));
  if (record) F.push();
  let tRef = -Infinity, fuelOut = false, aPlan = (plan.o0.rp + plan.o0.ra) / 2;
  for (const [j, b] of burns.entries()) {
    if (!out.ok) break;
    const inPlane = Math.abs(b.a - aPlan) > 1e-7 * b.a; // what the plan changes here: the orbit, or the plane alone
    aPlan = b.a;
    let yImp, tImp;
    if (b.now) { yImp = Float64Array.from(y); tImp = F.t; }
    else { // where the impulsive burn would be: coast to the burn point, then back
      const save = { t: F.t, y: Float64Array.from(y), h: F.h }, P = F.period(y);
      const r = F.seg(F.t + 4 * P, { cross: { side: b.side, after: tRef + 0.1 * P } });
      if (r !== 'cross') { if (r === 'end') out.ok = false; break; }
      yImp = Float64Array.from(y); tImp = F.t;
      // an orbit-changing burn goes to the apsis next to the line: earlier finite burns turn the apse line a little
      const el = rv2el(mu, [y[0], y[1], y[2]], [y[3], y[4], y[5]]);
      let dt = 0;
      if (inPlane && el.e > 1e-6 && el.a > 0) {
        const rn = Math.hypot(y[0], y[1], y[2]), rv = y[0] * y[3] + y[1] * y[4] + y[2] * y[5], hn = Math.sqrt(mu * el.p);
        const nu = Math.atan2(rv * hn / (rn * mu), el.p / rn - 1), E = 2 * Math.atan2(Math.sqrt(1 - el.e) * Math.sin(nu / 2), Math.sqrt(1 + el.e) * Math.cos(nu / 2));
        const M = E - el.e * Math.sin(E), Mt = Math.abs(wrapPi(M)) < Math.PI / 2 ? 0 : Math.PI;
        dt = wrapPi(Mt - M) / Math.sqrt(mu / el.a ** 3);
      }
      F.t = save.t; y.set(save.y); F.h = save.h;
      if (Math.abs(dt) > 1e-3) {
        tImp = Math.max(save.t, tImp + dt);
        F.seg(tImp);
        yImp = Float64Array.from(y); F.t = save.t; y.set(save.y); F.h = save.h;
      }
    }
    const nv = mvImpulse(mu, yImp, b), dvv = [0, 1, 2].map(j => nv[j] - yImp[3 + j]), dvRef = Math.hypot(...dvv), du = dvv.map(q => q / dvRef);
    const tHalf = y[6] / mdot * (1 - Math.exp(-dvRef / (2 * ve)));
    const tNow = F.t, tStart = b.now ? F.t : Math.max(F.t, tImp - tHalf);
    // steering basis at the impulsive point: along-track (signed) and orbit normal; the thrust leaves the plane by
    // ψ = ψ₀ + ψ₁·(2s/Δv_ref − 1), s the Δv delivered so far (a yaw that turns linearly through the burn)
    const rI = unit([yImp[0], yImp[1], yImp[2]]), nI = unit(cross(yImp, yImp.subarray(3, 6))), tI = cross(nI, rI);
    const along = du[0] * tI[0] + du[1] * tI[1] + du[2] * tI[2], nrm = du[0] * nI[0] + du[1] * nI[1] + du[2] * nI[2], sgP = along >= 0 ? 1 : -1;
    // ψ to start with: fixed in space, the impulsive Δv's own direction; turning with the velocity, the split between
    // the speed change and the turn of the velocity (v̄·Δφ) — a pure turn is a purely normal thrust
    const vI = Math.hypot(yImp[3], yImp[4], yImp[5]), vA = Math.hypot(nv[0], nv[1], nv[2]), turnAng = Math.abs(b.di);
    const psiI = fin.steer === 'inertial' ? Math.atan2(nrm, Math.abs(along)) : Math.atan2(Math.sign(nrm) * (vI + vA) / 2 * turnAng, Math.abs(vA - vI));
    const P0 = tI.map(q => q * sgP), st = { psi: psiI, psi1: 0, s0: 0 };
    const yaw = q => st.psi + st.psi1 * (2 * (q[7] - st.s0) / dvRef - 1);
    T.dir = fin.steer === 'inertial'
      ? (q, o) => { const p = yaw(q), c1 = Math.cos(p), s1 = Math.sin(p); for (let k = 0; k < 3; k++) o[k] = c1 * P0[k] + s1 * nI[k]; }
      : (q, o) => {
        const vl = Math.hypot(q[3], q[4], q[5]), hx = q[1] * q[5] - q[2] * q[4], hy = q[2] * q[3] - q[0] * q[5], hz = q[0] * q[4] - q[1] * q[3], hl = Math.hypot(hx, hy, hz);
        const p = yaw(q), c1 = Math.cos(p) * sgP / vl, s1 = Math.sin(p) / hl;
        o[0] = c1 * q[3] + s1 * hx; o[1] = c1 * q[4] + s1 * hy; o[2] = c1 * q[5] + s1 * hz;
      };
    // the line this burn works on: the node of the orbit at the burn point (ℓ itself for an equatorial orbit), and the
    // inclination signed about it (normal = cos i·z − sin i·(z × line)); the plan's inclination after the burn
    const lb = Math.hypot(nI[0], nI[1]) > 1e-9 ? unit([-nI[1], nI[0], 0]) : [Math.cos(O0), Math.sin(O0), 0], zl = [-lb[1], lb[0], 0];
    const iS = q => { const n = cross(q, q.subarray(3, 6)); return Math.atan2(-(n[0] * zl[0] + n[1] * zl[1]), n[2]); };
    // cut-off on the target: semi-major axis (burns the plan gives an in-plane change), else the inclination; the dry
    // mass always
    const a0 = elA(mu, y), sgA = Math.sign(b.a - a0) || 1, sgI = Math.sign(b.iAfter - iS(y)) || 1;
    const g = q => Math.min(inPlane ? sgA * (b.a - elA(mu, q)) / b.a : sgI * (b.iAfter - iS(q)), (q[6] - md) / fin.m0);
    const tb = y[6] / mdot * (1 - Math.exp(-dvRef / ve)), hb = Math.max(1e-3, Math.min(F.h, tb / 20));
    // the flight from now: coast to the start (shifted by dl), burn with the yaw (ψ₀, ψ₁) until the cut-off
    const now = { t: F.t, y: Float64Array.from(y), h: F.h };
    let arc = 0, t0b = 0, m0 = 0, yb = null;
    const fly = (x, rec) => {
      F.t = now.t; y.set(now.y); F.h = now.h;
      const ts = Math.max(tNow, tStart + x[0]);
      if (ts > F.t && F.seg(ts, { rec }) !== 'end') return 'impact';
      t0b = F.t; m0 = y[6]; yb = Float64Array.from(y);
      F.h = hb; st.psi = x[1]; st.psi1 = x[2]; st.s0 = y[7]; T.on = true; arc = 0;
      const r = F.seg(F.t + 4 * tb + 600, { g, rec, onStep: (a, q) => { arc += sweep(a, q); } });
      T.on = false; return r;
    };
    // Shooting: the finite burn is not symmetric about the apsis (the orbit changes as it burns), which turns the apse
    // line to first order in the burn time; a long plane change also turns the node. Newton (finite differences) on the
    // start shift dl and, with a plane change, ψ₀ and ψ₁: the eccentricity vector stays on the burn line
    // (e·(n × r̂) = 0), the plane keeps the line (n·line = 0) and the inclination lands. The semi-major axis comes from
    // the cut-off; what is left is a second-order error of the far apsis, which the trim Δv below accounts for (forcing
    // it with a pitched thrust in every burn costs far more than fixing it once at the end).
    const turn = Math.abs(b.di) > 1e-9 && inPlane;
    const ctrl = [...(b.now ? [] : [0]), ...(turn ? [1, 2] : [])];
    const cons = inPlane ? [...(b.now ? [] : [0]), ...(turn ? [1, 2] : [])] : (b.now ? [] : [1]);
    let x = [0, psiI, 0];
    if (ctrl.length && ctrl.length === cons.length) {
      const res = q => {
        fly(q, false);
        const rn = Math.hypot(y[0], y[1], y[2]), v2 = y[3] * y[3] + y[4] * y[4] + y[5] * y[5], rv = y[0] * y[3] + y[1] * y[4] + y[2] * y[5];
        const ev = [0, 1, 2].map(k => ((v2 - mu / rn) * y[k] - rv * y[3 + k]) / mu), nn = unit(cross(y, y.subarray(3, 6))), m = cross(nn, rI);
        const all = [ev[0] * m[0] + ev[1] * m[1] + ev[2] * m[2], nn[0] * lb[0] + nn[1] * lb[1] + nn[2] * lb[2], iS(y) - b.iAfter];
        return cons.map(k => all[k]);
      };
      const hs = [Math.max(1e-3, 1e-3 * tb), 1e-5, 1e-5];
      const lim = q => [Math.max(-0.5 * tb, Math.min(0.5 * tb, q[0])), Math.max(psiI - 1.5, Math.min(psiI + 1.5, q[1])), Math.max(-1, Math.min(1, q[2]))];
      const nrm2 = r => Math.hypot(...r);
      let r = res(x);
      for (let it = 0; it < 10 && nrm2(r) > 1e-11; it++) {
        const J = r.map(() => []);
        for (const k of ctrl) { const q = x.slice(); q[k] += hs[k]; const rk = res(q); rk.forEach((v, i) => J[i].push((v - r[i]) / hs[k])); }
        const d = solveLin(J, r.map(v => -v));
        if (!d) break;
        let ok = false;
        for (let s = 1; s > 0.05 && !ok; s /= 2) { // damped step
          const q = x.slice(); ctrl.forEach((k, i) => { q[k] += s * d[i]; });
          const ql = lim(q), rq = res(ql);
          if (nrm2(rq) < nrm2(r)) { x = ql; r = rq; ok = true; }
        }
        if (!ok) break;
      }
    }
    const res = fly(x, record);
    if (res === 'impact' || res === 'steps') break;
    const psi = x[1], m1 = y[6], dv = ve * Math.log(m0 / m1), el = rv2el(mu, [y[0], y[1], y[2]], [y[3], y[4], y[5]]), pre = { t: t0b, y: yb };
    fuelOut = m1 <= md * (1 + 1e-9);
    const dvI = imp.burns[j] ? imp.burns[j].dv : dvRef;
    const ex = { node: b.node, piece: b.piece, pieces: b.pieces, side: b.side, sep: b.sep, t0: pre.t, t1: F.t, m0, m1, dv, dvAcc: y[7] - pre.y[7], dvImp: dvI, loss: dv - dvI,
      arc, el, di: el.i - elI(pre.y), fuelOut, steer: { inertial: fin.steer === 'inertial', psi, psi1: x[2], dvRef, sgP, P: ecl(P0), N: ecl(nI) } };
    out.burns.push(ex);
    out.events.push({ type: 'burn', t: (pre.t + F.t) / 2, t0: pre.t, t1: F.t, dv, body: 0, label: 'ev.mvBurn', node: b.node, piece: b.piece, pieces: b.pieces, di: ex.di, sep: b.sep, finite: true });
    tRef = b.now ? F.t : tImp;
    if (fuelOut) { out.ok = false; out.fuelOut = true; out.events.push({ type: 'impact', body: 0, t: F.t, label: 'ev.fuelOut', fuel: true }); break; }
  }
  if (out.burns.length) out.done = out.burns[out.burns.length - 1].el;
  if (out.impact < 0) F.seg(F.t + (opts.tail || 0.5) * F.period(y), { rec: record });
  out.tEnd = F.t; out.end = Array.from(y.subarray(0, 6)); out.mEnd = y[6];
  out.dvFin = out.burns.reduce((a, q) => a + q.dv, 0); out.dvImp = imp.burns.reduce((a, q) => a + q.dv, 0); out.loss = out.dvFin - out.dvImp;
  // trim: an impulsive Hohmann from the orbit reached to the target (what is left of the far apsis, and any
  // inclination), the cost of finishing the job; lossTot = loss + trim
  out.trim = 0;
  if (out.done && out.ok) { const d = out.done, tp = maneuverPlan(mu, 0, { rp: d.rp, ra: d.ra, i: d.i }, plan.o1, { type: 'hohmann', plane: 'comb', k: 1 }); if (!tp.error) out.trim = tp.dv; }
  out.lossTot = out.loss + out.trim;
  out.fuel = fin.m0 - (out.burns.length ? out.burns[out.burns.length - 1].m1 : fin.m0); out.fuelImp = propMass(fin.m0, out.dvImp, fin.isp);
  out.tFirst = out.burns.length ? out.burns[0].t0 : 0; out.tLast = out.burns.length ? out.burns[out.burns.length - 1].t1 : 0;
  return out;
}

// Low-thrust spiral between circular orbits (Edelbaum; Kéchichian's form of the steering law): with v₀, v₁ the circular
// speeds and Δi the plane change, Δv = √(v₀² − 2v₀v₁·cos(πΔi/2) + v₁²); the thrust keeps a yaw β out of the plane,
// tan β = v₀·sin β₀ / (v₀·cos β₀ − Δv(t)), tan β₀ = sin(πΔi/2) / (v₀/v₁ − cos(πΔi/2)), its sign flipping at the
// antinodes (sign of cos u), the in-plane part along the velocity; Δv(t) = ∫F/m dt, so the shrinking mass is covered.
// Revolutions ≈ ∫ v³/(2πμ) dt with v(s)² = v₀² − 2v₀·s·cos β₀ + s² and dt = m(s)/F·ds, m(s) = m₀·e^(−s/c) (the averaged
// model, the mass loss included); time t = (m₀/ṁ)(1 − e^(−Δv/c)).
function spiralEstimate(mu, o0, o1, fin) {
  const v0 = Math.sqrt(mu / o0.rp), v1 = Math.sqrt(mu / o1.rp), x = Math.PI / 2 * Math.abs(o1.i - o0.i);
  const dv = Math.sqrt(Math.max(0, v0 * v0 - 2 * v0 * v1 * Math.cos(x) + v1 * v1)), b0 = Math.atan2(Math.sin(x), v0 / v1 - Math.cos(x));
  const ve = fin.isp * G0, mdot = fin.F / ve, m1 = fin.m0 * Math.exp(-dv / ve), t = (fin.m0 - m1) / mdot;
  let rev = 0;
  for (let k = 0, n = 64; k <= n; k++) { // Simpson
    const s = dv * k / n, v = Math.sqrt(Math.max(0, v0 * v0 - 2 * v0 * s * Math.cos(b0) + s * s));
    rev += (k === 0 || k === n ? 1 : k % 2 ? 4 : 2) * v * v * v * fin.m0 * Math.exp(-s / ve);
  }
  rev *= dv / 64 / 3 / (2 * Math.PI * mu * fin.F);
  return { dv, t, revs: rev, fuel: fin.m0 - m1, v0, v1, b0 };
}
function spiralFlight(c, o0, o1, fin, opts = {}) {
  if (Math.abs(o0.ra - o0.rp) > 1e-9 * o0.rp || Math.abs(o1.ra - o1.rp) > 1e-9 * o1.rp) return { error: 'err.mvSpiralCirc' };
  const mu = c.mu, est = spiralEstimate(mu, o0, o1, fin);
  if (est.revs > (opts.maxRevs || 20000)) return { error: 'err.mvSpiralRevs', params: { n: Math.round(est.revs) } };
  const F = flight(c, { ...fin }, { tol: opts.tol || 1e-9, maxSteps: opts.maxSteps }), { T, out, ve } = F, y = F.y, rot = c.rot, O0 = c.O0 || 0;
  const di = o1.i - o0.i, sgI = di < 0 ? -1 : 1, sb = est.v0 * Math.sin(est.b0), cb = est.v0 * Math.cos(est.b0), L = F.L;
  T.dir = (q, o) => {
    const be = Math.atan2(sb, cb - q[7]), vl = Math.hypot(q[3], q[4], q[5]);
    const hx = q[1] * q[5] - q[2] * q[4], hy = q[2] * q[3] - q[0] * q[5], hz = q[0] * q[4] - q[1] * q[3], hl = Math.hypot(hx, hy, hz);
    const c1 = Math.cos(be) / vl, s1 = Math.sin(be) * sgI * (q[0] * L[0] + q[1] * L[1] >= 0 ? 1 : -1) / hl;
    o[0] = c1 * q[3] + s1 * hx; o[1] = c1 * q[4] + s1 * hy; o[2] = c1 * q[5] + s1 * hz;
  };
  const coplanar = Math.abs(di) < 1e-9, sgA = Math.sign(o1.rp - o0.rp) || 1;
  // cut-off: the target radius (coplanar) or Edelbaum's Δv (with a plane change: a passes the target before i does)
  const g = q => Math.min(coplanar ? sgA * (o1.rp - elA(mu, q)) / o1.rp : (est.dv - q[7]) / est.dv, (q[6] - fin.md) / fin.m0);
  y.set([...orbitPoint(mu, o0, O0, 0), fin.m0, 0]);
  const P0 = F.period(y), P1 = 2 * Math.PI * Math.sqrt(o1.rp ** 3 / mu);
  F.h = P0 / 400;
  const n0 = [Math.sin(o0.i) * Math.sin(O0), -Math.sin(o0.i) * Math.cos(O0), Math.cos(o0.i)];
  out.normal = rot ? [0, 1, 2].map(j => rot[3 * j] * n0[0] + rot[3 * j + 1] * n0[1] + rot[3 * j + 2] * n0[2]) : n0;
  F.push();
  // samples: K per revolution (the cap over the estimated revolutions), the last ten revolutions dense
  const K = Math.max(8, Math.min(96, Math.round((opts.cap || 60000) / Math.max(1, est.revs)))), tDense = est.t - 10 * P1;
  let ang = 0, angRec = 0, pct = -1;
  const prog = opts.onProgress || null, rec = (t, q) => {
    if (prog) { const p = Math.floor(100 * Math.min(1, coplanar ? (elA(mu, q) - o0.rp) / (o1.rp - o0.rp) : q[7] / est.dv)); if (p > pct) { pct = p; prog(p); } }
    if (ang - angRec >= 2 * Math.PI / (t > tDense ? 96 : K)) { angRec = ang; return true; }
    return false;
  };
  T.on = true;
  const r = F.seg(est.t * 1.5 + 2 * P1, { g, rec, onStep: (a, q) => { ang += sweep(a, q); } });
  T.on = false;
  if (r !== 'impact' && r !== 'steps') {
    if (out.t[out.t.length - 1] !== F.t) F.push();
    const m1 = y[6], el = rv2el(mu, [y[0], y[1], y[2]], [y[3], y[4], y[5]]), fuelOut = m1 <= fin.md * (1 + 1e-9);
    out.burns.push({ t0: 0, t1: F.t, m0: fin.m0, m1, dv: ve * Math.log(fin.m0 / m1), dvAcc: y[7], arc: ang, revs: ang / (2 * Math.PI), el, fuelOut, spiral: true,
      steer: { spiral: true, sb, cb, sgI, L: rot ? [rot[0] * L[0] + rot[1] * L[1], rot[3] * L[0] + rot[4] * L[1], rot[6] * L[0] + rot[7] * L[1]] : L.slice(), ve, m0: fin.m0 } });
    out.events.push({ type: 'burn', t: 0, t0: 0, t1: F.t, dv: ve * Math.log(fin.m0 / m1), body: 0, label: 'ev.mvSpiral0', spiral: true });
    out.events.push({ type: 'peri', t: F.t, body: 0, label: 'ev.mvSpiral1', spiral: true });
    if (fuelOut) { out.ok = false; out.fuelOut = true; }
    out.done = el;
    F.seg(F.t + 0.5 * F.period(y), { rec: true });
  }
  out.tEnd = F.t; out.end = Array.from(y.subarray(0, 6)); out.mEnd = y[6]; out.est = est;
  out.dvFin = out.burns.length ? out.burns[0].dv : 0; out.fuel = fin.m0 - (out.burns.length ? out.burns[0].m1 : fin.m0);
  out.tFirst = 0; out.tLast = out.burns.length ? out.burns[0].t1 : 0;
  return out;
}

// Worker entry for the finite-thrust maneuvers: job { c, o0, o1, opt, fin, cap }. The spiral, or the plan flown with the
// engine; when a burn sweeps more than 60° of its orbit, the same flight with k = 1, 2 and 4 pieces (their losses).
function maneuverRun(job, onProgress) {
  const { c, o0, o1, opt, fin } = job;
  if (opt.type === 'spiral') { const sim = spiralFlight(c, o0, o1, fin, { cap: job.cap, onProgress }); return sim.error ? sim : { sim }; }
  const plan = maneuverPlan(c.mu, c.R, o0, o1, opt);
  if (plan.error) return { error: plan.error };
  const sim = maneuverFlight(c, plan, fin);
  let split = null;
  if (sim.burns.some(b => b.arc > Math.PI / 3)) {
    split = [1, 2, 4].map((k, j) => {
      if (onProgress) onProgress(25 * (j + 1));
      const p = k === opt.k ? plan : maneuverPlan(c.mu, c.R, o0, o1, { ...opt, k });
      if (p.error) return { k, error: p.error };
      const s = k === opt.k ? sim : maneuverFlight(c, p, fin, { record: false });
      return { k, loss: s.loss, trim: s.trim, lossTot: s.lossTot, fuel: s.fuel, ok: s.ok, arc: Math.max(...s.burns.map(b => b.arc), 0) };
    });
  }
  return { sim, split };
}

if (typeof module !== 'undefined') module.exports = {
  G, DAY, AU, JYR, OBLIQUITY, utcToDays, daysToUtc, keplerE, laplaceFrame, bodyFrame, orbitElements, orbitState, orbitPath,
  buildSystem, defaultOrbitRadius, states, missionChain, missionPlane, planeBasis, simulate, hohmannGuess, autoDuration, optimize, residuals,
  lambert, lambertTransfer, lambertSeed, porkchop, arcDv, aeroOn, aeroRaise, depFrame, asymAngles, initialState, propagateTo, refineSeed,
  G0, visViva, burnDv, propMass, dvAvail, planeSplit, maneuverPlan, mvOrbits, rv2el, j2Rates, keplerStep, equatorFrame, orbitPoint, maneuverSim,
  mvImpulse, maneuverFlight, spiralEstimate, spiralFlight, maneuverRun, conicPoints, domBody,
};
