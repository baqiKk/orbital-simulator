// Physics regression tests. Run: node tests/core.test.js
const assert = require('assert');
const C = require('../js/core.js');
const earth = { name: 'Dünya', mass: 5.9722e24, radius: 6371e3, parent: -1, a: 0, phase: 0 };
const moon = { name: 'Ay', mass: 7.342e22, radius: 1737.4e3, parent: 0, a: 384400e3, phase: 0 };
const s = C.buildSystem([earth, moon]);

// 1) Known free-return solution must still reach ~250 km perilune and ~60 km return perigee
const M = { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: 0, theta: -132.26090326368262, dv: 3162.1420118609917, duration: 12 };
const r = C.simulate(s, M);
assert.ok(r.bPeri && r.aRet, 'free return should have both perilune and return perigee');
assert.ok(Math.abs((r.bPeri.d - s.R[1]) / 1e3 - 250) < 5, 'perilune ≈ 250 km');
assert.ok(Math.abs((r.aRet.d - s.R[0]) / 1e3 - 60) < 5, 'return perigee ≈ 60 km');
assert.strictEqual(r.bPeri.dir, -1, 'lunar pass should be retrograde (figure-8)');

// 2) Hohmann guess for Earth->Moon should be ~3.1 km/s
const g = C.hohmannGuess(s, M);
assert.ok(g.dv > 3000 && g.dv < 3200, 'TLI Δv ≈ 3.1 km/s');

// 4) A new body added around any parent gets an orbit that buildSystem accepts
{
  const km = 1e3;
  const sun = { name: 'Güneş', mass: 1.98847e30, radius: 695700 * km, parent: -1, a: 0, phase: 0 };
  const ear = { name: 'Dünya', mass: 5.9722e24, radius: 6371 * km, parent: 0, a: 149598000 * km, phase: 0 };
  const mar = { name: 'Mars', mass: 6.4171e23, radius: 3389.5 * km, parent: 0, a: 227939000 * km, phase: 0 };
  const moo = { name: 'Ay', mass: 7.342e22, radius: 1737.4 * km, parent: 1, a: 384400 * km, phase: 0 };
  const cases = [
    [[sun, ear, mar], 0, 'Sun, with Earth and Mars'],
    [[sun, ear, mar], 1, 'Earth (SOI inside the Sun system)'],
    [[sun, ear, moo], 1, 'Earth, with the Moon'],
    [[sun, ear], 0, 'Sun, with Earth'],
    [[sun], 0, 'Sun alone'],
  ];
  for (const [base, parent, label] of cases) {
    const rad = 2000 * km;
    const a = C.defaultOrbitRadius(base, parent, rad);
    const sys2 = C.buildSystem([...base, { name: 'X', mass: 1e23, radius: rad, parent, a, phase: 0 }]);
    assert.ok(!sys2.error, `default orbit around ${label} must be valid: ${sys2.error}`);
    assert.ok(a > 2 * (base[parent].radius + rad) - 1, `orbit around ${label} clears the parent radius`);
    for (const b of base) if (b.parent === parent) assert.ok(Math.abs(Math.log(a / b.a)) > 0.3, `orbit around ${label} avoids sibling orbits`);
    if (base[parent].parent >= 0) assert.ok(a < sys2.soi[parent], `orbit around ${label} is inside the parent SOI`);
  }
}

// 5) Simplified model is unchanged by the 3D core: the app's scenarios reproduce the Phase 1 results
//    (recorded before the refactor). Scenarios are read from js/app.js, body numbers from js/bodies.js.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { BODIES } = require('../js/bodies.js');
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const scStart = appSrc.indexOf('const SCENARIOS = [') + 'const SCENARIOS = '.length;
const SCENARIOS = vm.runInNewContext('(' + appSrc.slice(scStart, appSrc.indexOf('\n];', scStart) + 2) + ')');
const PHASE1 = {
  em_free: { steps: 565, bPeri: 1987765.8279005964, aRet: 6431309.241626039 },
  em_cap: { steps: 785, bPeri: 1837400.2659585986, cap: 826.5701260897483 },
  em_sun: { steps: 565, bPeri: 1989067.7842456424, aRet: 6432527.398931592 },
  e_mars: { steps: 1015, bPeri: 3689503.006910126, cap: 2115.0473959529004 },
  moon_mars: { steps: 972, bPeri: 3689492.8354666843, cap: 2148.10557463457 },
  e_venus: { steps: 926, bPeri: 6551895.181666631 },
};
for (const sc of SCENARIOS.filter(q => q.model === 'simple')) {
  const want = PHASE1[sc.id]; assert.ok(want, `Phase 1 reference for ${sc.id}`);
  const list = sc.bodies.map(b => { const p = BODIES[b.k].simple; return { name: b.k, mass: p.mass, radius: p.radius * 1e3, parent: b.parent, a: (b.a != null ? b.a : p.a) * 1e3, phase: b.phase || 0 }; });
  const sy = C.buildSystem(list), Ms = { ...sc.M };
  Ms.duration = C.autoDuration(C.hohmannGuess(sy, Ms), Ms.mode);
  const r2 = C.simulate(sy, Ms, { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 });
  assert.strictEqual(r2.steps, want.steps, `${sc.id}: same integration steps as Phase 1`);
  assert.ok(Math.abs(r2.bPeri.d - want.bPeri) < 1, `${sc.id}: target periapsis within 1 m of Phase 1`);
  if (want.aRet) assert.ok(Math.abs(r2.aRet.d - want.aRet) < 1, `${sc.id}: return periapsis within 1 m of Phase 1`);
  if (want.cap) assert.ok(Math.abs(r2.captured.dv - want.cap) < 1e-3, `${sc.id}: capture Δv as in Phase 1`);
  assert.ok(r2.z.every(z => z === 0), `${sc.id}: simplified model stays in the z = 0 plane`);
}

// ===== Real model (JPL elements from js/bodies.js) =====
const DAY = C.DAY, DEG = 180 / Math.PI;
const realSys = keys => C.buildSystem(keys.map(k => {
  const b = BODIES[k], p = keys.indexOf(b.parent);
  return { name: k, mu: b.gm * 1e9, radius: b.radius * 1e3, parent: p, a: 0, orb: b.orb };
}));
const relState = (sy, i, t) => { // body i relative to its parent at t
  const P = new Float64Array(3 * sy.N), V = new Float64Array(3 * sy.N), p = sy.parent[i];
  C.states(sy, t, P, V);
  return [0, 1, 2].map(j => P[3 * i + j] - P[3 * p + j]).concat([0, 1, 2].map(j => V[3 * i + j] - V[3 * p + j]));
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => Math.hypot(v[0], v[1], v[2]);
const inclination = st => { const h = cross(st.slice(0, 3), st.slice(3)); return Math.acos(h[2] / norm(h)) * DEG; };

// 15) Body picker: smallest body list for departure → target, ancestors up to the common one
{
  const par = k => BODIES[k].parent || null, ch = (a, b) => C.missionChain(a, b, par);
  assert.deepStrictEqual(ch('earth', 'mars'), { keys: ['earth', 'mars', 'sun'], parent: [2, 2, -1] });
  assert.deepStrictEqual(ch('earth', 'moon'), { keys: ['earth', 'moon'], parent: [-1, 0] });
  assert.deepStrictEqual(ch('moon', 'earth'), { keys: ['moon', 'earth'], parent: [1, -1] });
  assert.deepStrictEqual(ch('moon', 'mars'), { keys: ['moon', 'mars', 'earth', 'sun'], parent: [2, 3, 3, -1] }, 'same order as the moon_mars scenario');
  assert.deepStrictEqual(ch('io', 'europa'), { keys: ['io', 'europa', 'jupiter'], parent: [2, 2, -1] });
  assert.deepStrictEqual(ch('earth', 'phobos'), { keys: ['earth', 'phobos', 'sun', 'mars'], parent: [2, 3, -1, 2] });
  assert.deepStrictEqual(ch('sun', 'venus'), { keys: ['sun', 'venus'], parent: [-1, 0] });
  assert.strictEqual(ch('phobos', 'ganymede').error, 'err.chainLen');
  assert.strictEqual(ch('moon', 'titan').params.n, 5);
  assert.strictEqual(ch('mars', 'mars').error, 'err.chainSame');
  // every pair the picker can produce builds a valid real system (and the chain respects the natural parents)
  const keys = Object.keys(BODIES).filter(k => BODIES[k].gm);
  for (const a of keys) for (const b of keys) {
    const r = ch(a, b); if (r.error) continue;
    r.keys.forEach((k, i) => assert.strictEqual(r.parent[i] < 0 ? null : r.keys[r.parent[i]], i === r.parent.indexOf(-1) ? null : par(k)));
    assert.ok(!realSys(r.keys).error, `${a} → ${b} builds`);
  }
}

// 16) Solar system map: the whole body table builds as one system; states are finite, planets in order
{
  const keys = Object.keys(BODIES).filter(k => BODIES[k].gm), sy = realSys(keys);
  assert.ok(!sy.error, 'full system builds');
  const P = new Float64Array(3 * sy.N), V = new Float64Array(3 * sy.N);
  C.states(sy, C.utcToDays(Date.UTC(2026, 9, 22)) * DAY, P, V);
  assert.ok([...P, ...V].every(Number.isFinite), 'full system states are finite');
  const sun = keys.indexOf('sun'), helio = k => { const i = keys.indexOf(k); return Math.hypot(P[3 * i] - P[3 * sun], P[3 * i + 1] - P[3 * sun + 1], P[3 * i + 2] - P[3 * sun + 2]) / C.AU; };
  const planets = keys.filter(k => BODIES[k].parent === 'sun'), d = planets.map(helio);
  assert.deepStrictEqual(planets, ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1], `${planets[i]} beyond ${planets[i - 1]}`);
  assert.ok(Math.abs(helio('earth') - 1) < 0.02 && Math.abs(helio('neptune') - 30) < 0.5, 'Earth ≈ 1 AU, Neptune ≈ 30 AU');
  for (const k of keys.filter(q => BODIES[q].parent && BODIES[q].parent !== 'sun')) {
    const i = keys.indexOf(k), p = sy.parent[i], r = Math.hypot(P[3 * i] - P[3 * p], P[3 * i + 1] - P[3 * p + 1], P[3 * i + 2] - P[3 * p + 2]);
    assert.ok(r < sy.soi[p], `${k} inside the SOI of ${keys[p]}`);
  }
}

// 6) Kepler's equation: residual below 1e-12 rad over the whole circle, for low and high eccentricity
for (const e of [0, 0.0167, 0.2056, 0.5, 0.9]) for (let k = -36; k <= 36; k++) {
  const Mk = k * Math.PI / 36, E = C.keplerE(Mk, e);
  assert.ok(Math.abs(E - e * Math.sin(E) - Mk) < 1e-12, `Kepler residual e=${e} M=${Mk}`);
}

// 7) Calendar: J2000 = 2000-01-01 12:00 TT = 11:58:55.816 UTC (TT − UTC = 64.184 s then; the model keeps
//    the present 69.184 s, so the epoch lands 5 s off), and the conversion round-trips
assert.ok(Math.abs(C.utcToDays(Date.UTC(2000, 0, 1, 11, 58, 55, 816)) * DAY - 5) < 1e-3, 'J2000 epoch (constant TT − UTC)');
{ const ms = Date.UTC(2026, 10, 15); assert.ok(Math.abs(C.daysToUtc(C.utcToDays(ms)) - ms) < 1e-3, 'date round trip'); }

// 8) Planets (Table 1): perihelion and aphelion distances sampled from the ephemeris match a(1 ∓ e);
//    sidereal periods measured from the motion: Mars 686.98 ± 0.1 d, Earth–Moon barycentre 365.256 ± 0.01 d;
//    inclinations to the J2000 ecliptic.
{
  const sy = realSys(['sun', 'earth', 'mars']);
  for (const [i, k, Pref, tol, iRef] of [[1, 'earth', 365.256, 0.01, 0], [2, 'mars', 686.98, 0.1, 1.85]]) {
    const o = sy.orb[i];
    let lo = Infinity, hi = 0;
    for (let j = 0; j < 20000; j++) { const d = norm(relState(sy, i, j * 1.01 * Pref * DAY / 20000)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    assert.ok(Math.abs(lo / (o.a0 * (1 - o.e0)) - 1) < 1e-5, `${k}: perihelion = a(1 − e)`);
    assert.ok(Math.abs(hi / (o.a0 * (1 + o.e0)) - 1) < 1e-5, `${k}: aphelion = a(1 + e)`);
    // time for the ecliptic longitude to come back to its J2000 value (unwrapped angle, bisection)
    const lon = t => { const st = relState(sy, i, t); return Math.atan2(st[1], st[0]); };
    const l0 = lon(0), swept = t => { let a = lon(t) - l0; while (a < 0) a += 2 * Math.PI; return a; };
    let a = 0.95 * Pref * DAY, b = 1.05 * Pref * DAY; // swept() runs from ~2π−ε to ~ε across the return
    for (let it = 0; it < 60; it++) { const m = (a + b) / 2; if (swept(m) > Math.PI) a = m; else b = m; }
    const Pd = (a + b) / 2 / DAY;
    assert.ok(Math.abs(Pd - Pref) < tol, `${k}: orbital period ${Pd.toFixed(4)} d ≈ ${Pref} d`);
    assert.ok(Math.abs(inclination(relState(sy, i, 0)) - iRef) < 0.01, `${k}: inclination ≈ ${iRef}°`);
  }
}

// 9) Moon (mean elements, ecliptic): distance stays within 356–407 thousand km; inclination ≈ 5.1°;
//    precession: ω turns forward (360°/Papsis), Ω backward (360°/Pnode), so ϖ = ω + Ω turns in 8.85 yr.
//    P is the sidereal period, so the mean anomaly runs at 360°/P − ϖ̇: anomalistic month 27.5546 d,
//    draconic month (argument of latitude ω + M) 27.2122 d.
{
  const sy = realSys(['earth', 'moon']), o = sy.orb[1];
  let lo = Infinity, hi = 0;
  for (let j = 0; j < 40000; j++) { const d = norm(relState(sy, 1, 26 * C.JYR + j * 366 * DAY / 40000)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  assert.ok(lo > 356e6 && hi < 407e6, `Moon distance ${(lo / 1e3).toFixed(0)}–${(hi / 1e3).toFixed(0)} km within 356–407 thousand km`);
  assert.ok(Math.abs(inclination(relState(sy, 1, 26 * C.JYR)) - 5.1) < 0.1, 'Moon inclination ≈ 5.1°');
  assert.ok(o.w1 > 0 && o.O1 < 0, 'ω advances, Ω regresses');
  assert.ok(Math.abs(2 * Math.PI / (o.w1 + o.O1) / C.JYR - 8.85) < 0.01, 'Moon ϖ̇ = ω̇ + Ω̇ ≈ 360°/8.85 yr');
  assert.ok(Math.abs(2 * Math.PI / o.M1 / DAY - 27.5546) < 0.01, 'anomalistic month ≈ 27.5546 d');
  assert.ok(Math.abs(2 * Math.PI / (o.M1 + o.w1) / DAY - 27.2122) < 0.01, 'draconic month ≈ 27.2122 d');
}

// 10) Velocity is the time derivative of position for every body (central difference, h = 5 s)
for (const k of Object.keys(BODIES).filter(q => BODIES[q].orb)) {
  const o = C.orbitElements(BODIES[k].orb), t = 8e8, h = 5, a = new Float64Array(6), b = new Float64Array(6), c = new Float64Array(6);
  C.orbitState(o, t, a, 0); C.orbitState(o, t - h, b, 0); C.orbitState(o, t + h, c, 0);
  const err = Math.hypot(...[0, 1, 2].map(j => (c[j] - b[j]) / (2 * h) - a[3 + j])) / Math.hypot(a[3], a[4], a[5]);
  assert.ok(err < 1e-6, `${k}: velocity matches d(position)/dt (${err.toExponential(1)})`);
}

// 11) Laplace frame: Io (i = 0) orbits in its Laplace plane, so its orbit normal is the plane's pole (RA 268.1°, Dec 64.5°)
{
  const st = new Float64Array(6); C.orbitState(C.orbitElements(BODIES.io.orb), 0, st, 0);
  const h = cross([st[0], st[1], st[2]], [st[3], st[4], st[5]]), n = h.map(x => x / norm(h)), e = C.OBLIQUITY;
  const eq = [n[0], Math.cos(e) * n[1] - Math.sin(e) * n[2], Math.sin(e) * n[1] + Math.cos(e) * n[2]]; // ecliptic -> equatorial
  assert.ok(Math.abs(((Math.atan2(eq[1], eq[0]) * DEG + 360) % 360) - 268.1) < 1e-9 && Math.abs(Math.asin(eq[2]) * DEG - 64.5) < 1e-9, 'Io orbit normal = Laplace pole');
}

// 12) Mission plane: Earth–Moon uses the Moon's orbit plane; the simplified model uses +z
{
  const sy = realSys(['earth', 'moon']), t = C.utcToDays(Date.UTC(2026, 10, 15)) * DAY, st = relState(sy, 1, t);
  const h = cross(st.slice(0, 3), st.slice(3)), n = C.missionPlane(sy, t);
  assert.ok(Math.abs(n[0] * h[0] + n[1] * h[1] + n[2] * h[2] - norm(h)) < 1e-6 * norm(h), 'mission plane = Moon orbit plane');
  assert.deepStrictEqual(C.missionPlane(s, 0), [0, 0, 1]);
}

// 12b) Dated ephemeris check (known sky events, independent check in place of Horizons): at opposition (and at
//      Venus's inferior conjunction) the planet and the Earth–Moon barycentre have equal heliocentric ecliptic longitudes
{
  const sy = realSys(['sun', 'earth', 'venus', 'mars', 'jupiter', 'saturn']), idx = k => ['sun', 'earth', 'venus', 'mars', 'jupiter', 'saturn'].indexOf(k);
  const tAt = (y, mo, d, h) => C.utcToDays(Date.UTC(y, mo - 1, d, h)) * DAY;
  const lon = (i, t) => { const st = relState(sy, i, t); return Math.atan2(st[1], st[0]) * DEG; };
  const dLon = (k, t) => { let a = lon(idx(k), t) - lon(idx('earth'), t); a = ((a % 360) + 540) % 360 - 180; return Math.abs(a); };
  for (const [k, y, mo, d, h, tol] of [
    ['mars', 2025, 1, 16, 2, 0.2], ['venus', 2025, 3, 23, 1, 0.2], ['saturn', 2025, 9, 21, 4, 0.3],
    ['jupiter', 2026, 1, 10, 8, 0.2], ['mars', 2027, 2, 19, 15, 0.2]])
    assert.ok(dLon(k, tAt(y, mo, d, h)) < tol, `${k} ${y}-${mo}-${d}: heliocentric longitude equals Earth's within ${tol}° (${dLon(k, tAt(y, mo, d, h)).toFixed(3)}°)`);
  // Earth–Moon barycentre perihelion falls on 2026-01-03 at 0.98330 ± 0.0001 AU
  const AU = 149597870.7e3, ie = idx('earth');
  let best = Infinity, tBest = 0;
  for (let t = tAt(2026, 1, 1, 0); t < tAt(2026, 1, 7, 0); t += 600) { const dd = norm(relState(sy, ie, t)); if (dd < best) { best = dd; tBest = t; } }
  const pd = new Date(C.daysToUtc(tBest / DAY));
  assert.ok(pd.getUTCFullYear() === 2026 && pd.getUTCMonth() === 0 && pd.getUTCDate() === 3, `Earth perihelion on 2026-01-03 (${pd.toISOString()})`);
  assert.ok(Math.abs(best / AU - 0.98330) < 1e-4, `Earth perihelion distance ${(best / AU).toFixed(5)} AU ≈ 0.98330`);
}

// ===== Phase 4: Lambert, porkchop, aerocapture =====
const add = (a, b) => a.map((x, i) => x + b[i]), scl = (a, k) => a.map(x => x * k), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const relErr = (a, b) => norm(add(a, scl(b, -1))) / norm(b);
// Independent two-body propagation for checking Lambert arcs: classical RK4, step 1e-3 of the local
// dynamical time r^1.5/√μ (does not use any of the Lambert formulas).
function propagate2(mu, r, v, T) {
  let t = 0;
  const acc = p => { const d = norm(p); return scl(p, -mu / (d * d * d)); };
  while (t < T) {
    const h = Math.min(T - t, 1e-3 * Math.pow(norm(r), 1.5) / Math.sqrt(mu));
    const k1r = v, k1v = acc(r), k2r = add(v, scl(k1v, h / 2)), k2v = acc(add(r, scl(k1r, h / 2)));
    const k3r = add(v, scl(k2v, h / 2)), k3v = acc(add(r, scl(k2r, h / 2))), k4r = add(v, scl(k3v, h)), k4v = acc(add(r, scl(k3r, h)));
    r = r.map((x, i) => x + h / 6 * (k1r[i] + 2 * k2r[i] + 2 * k3r[i] + k4r[i]));
    v = v.map((x, i) => x + h / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]));
    t += h;
  }
  return { r, v };
}
const reaches = (mu, r1, v1, r2, T) => relErr(propagate2(mu, r1, v1, T).r, r2);

// 17) Lambert, textbook examples. Book values, verified with an independent Curtis universal-variable solution.
{
  const km = v => v.map(x => x / 1e3), close = (v, ref, tol) => v.every((x, i) => Math.abs(x - ref[i]) < tol);
  // H. D. Curtis, Orbital Mechanics for Engineering Students, Example 5.2 (μ = 398600 km³/s², prograde, 1 h)
  const r1 = [5000e3, 10000e3, 2100e3], r2 = [-14600e3, 2500e3, 7000e3], c = C.lambert(398600e9, r1, r2, 3600, [0, 0, 1]);
  assert.ok(close(km(c.v1), [-5.99249, 1.92536, 3.24564], 1e-4) && close(km(c.v2), [-3.31246, -4.19662, -0.385288], 1e-4), `Curtis 5.2: v1 = ${km(c.v1)}, v2 = ${km(c.v2)}`);
  assert.ok(reaches(398600e9, r1, c.v1, r2, 3600) < 1e-7, 'Curtis 5.2 arc reaches r2 (two-body propagation)');
  // D. A. Vallado, Fundamentals of Astrodynamics and Applications, Example 7-5 (μ = 398600.4418 km³/s², short way, 76 min)
  const v = C.lambert(398600.4418e9, [15945.34e3, 0, 0], [12214.83899e3, 10249.46731e3, 0], 76 * 60, [0, 0, 1]);
  assert.ok(close(km(v.v1), [2.058913, 2.915964, 0], 1e-5) && close(km(v.v2), [-3.451565, 0.910314, 0], 1e-5), `Vallado 7-5: v1 = ${km(v.v1)}, v2 = ${km(v.v2)}`);
  assert.strictEqual(v.type, 1);
}

// 18) Lambert round trip: two points of a known orbit and the Kepler time between them give back the orbit's
//     velocities (elliptic type 1 and 2, M = 1, 2 revolutions on both branches, hyperbolic); every arc reaches r2
//     under independent two-body propagation.
{
  const mu = 398600.4418e9;
  const kep = (a, e, inc, O, w, nu) => {
    const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(inc), si = Math.sin(inc), cw = Math.cos(w), sw = Math.sin(w);
    const Px = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si], Qx = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
    const p = a * (1 - e * e), r = p / (1 + e * Math.cos(nu)), k = Math.sqrt(mu / p);
    return { r: add(scl(Px, r * Math.cos(nu)), scl(Qx, r * Math.sin(nu))), v: add(scl(Px, -k * Math.sin(nu)), scl(Qx, k * (e + Math.cos(nu)))), h: cross(Px, Qx) };
  };
  const tPeri = (a, e, nu) => { // time since periapsis
    if (e < 1) { const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2)); return (E - e * Math.sin(E)) / Math.sqrt(mu / (a * a * a)); }
    const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2)); return (e * Math.sinh(F) - F) / Math.sqrt(mu / -(a * a * a));
  };
  const a = 12000e3, inc = 0.4, O = 0.7, w = 1.1, nu1 = -0.5, Per = 2 * Math.PI * Math.sqrt(a * a * a / mu);
  for (const e of [0, 0.3, 0.7, 0.9]) for (const dnu of [40, 150, 200, 330]) for (const Mr of [0, 1, 2]) {
    const nu2 = nu1 + dnu / DEG, s1 = kep(a, e, inc, O, w, nu1), s2 = kep(a, e, inc, O, w, nu2);
    const tof = ((tPeri(a, e, nu2) - tPeri(a, e, nu1)) % Per + Per) % Per + Mr * Per, tag = `e=${e} Δν=${dnu}° M=${Mr}`;
    if (Mr === 0) {
      const sol = C.lambert(mu, s1.r, s2.r, tof, s1.h);
      assert.ok(sol && relErr(sol.v1, s1.v) < 1e-9 && relErr(sol.v2, s2.v) < 1e-9, `round trip ${tag}`);
      assert.strictEqual(sol.type, dnu < 180 ? 1 : 2, `transfer type ${tag}`);
    } else {
      const sols = [false, true].map(right => C.lambert(mu, s1.r, s2.r, tof, s1.h, Mr, right));
      assert.ok(sols.every(q => q), `both ${Mr}-revolution arcs exist ${tag}`);
      assert.ok(sols.some(q => relErr(q.v1, s1.v) < 1e-8 && relErr(q.v2, s2.v) < 1e-8), `one ${Mr}-revolution arc is the orbit ${tag}`);
      for (const q of sols) assert.ok(reaches(mu, s1.r, q.v1, s2.r, tof) < 1e-7, `${Mr}-revolution arc reaches r2 ${tag}`);
    }
  }
  assert.strictEqual(C.lambert(mu, kep(a, 0.1, inc, O, w, 0).r, kep(a, 0.1, inc, O, w, 1).r, 0.3 * Per, [0, 0, 1], 3, false), null, 'no arc with more revolutions than fit');
  // hyperbola (x > 1)
  const ah = -20000e3, eh = 1.6, h1 = kep(ah, eh, inc, O, w, -50 / DEG), h2 = kep(ah, eh, inc, O, w, 70 / DEG), th = tPeri(ah, eh, 70 / DEG) - tPeri(ah, eh, -50 / DEG);
  const hs = C.lambert(mu, h1.r, h2.r, th, h1.h);
  assert.ok(relErr(hs.v1, h1.v) < 1e-9 && relErr(hs.v2, h2.v) < 1e-9 && reaches(mu, h1.r, hs.v1, h2.r, th) < 1e-7, 'hyperbolic round trip');
}

// 19) 180° transfer: the arc's plane is undefined at exactly 180°. Coplanar: finite, in the reference plane and
//     continuous across 180°; slightly out of plane: finite, with a nearly polar plane (the porkchop's ridge).
{
  const mu = BODIES.sun.gm * 1e9, r1 = [C.AU, 0, 0], at = d => [1.5 * C.AU * Math.cos(d / DEG), 1.5 * C.AU * Math.sin(d / DEG), 0], tof = 250 * DAY;
  const [a, b, c] = [179.999, 180, 180.001].map(d => C.lambert(mu, r1, at(d), tof, [0, 0, 1]));
  for (const q of [a, b, c]) assert.ok(q && [...q.v1, ...q.v2].every(Number.isFinite) && Math.abs(q.v1[2]) < 1e-9 * norm(q.v1), '180°: finite and in the plane');
  assert.ok(relErr(a.v1, b.v1) < 1e-4 && relErr(c.v1, b.v1) < 1e-4 && relErr(a.v2, b.v2) < 1e-4, '180°: continuous across');
  assert.ok(a.type === 1 && c.type === 2, 'type 1 below 180°, type 2 above');
  const p = C.lambert(mu, r1, [-1.5 * C.AU, 0, 1.5e-3 * C.AU], tof, [0, 0, 1]);
  assert.ok(p && p.v1.every(Number.isFinite) && Math.abs(p.h[2]) < 1e-6, 'near 180° out of plane: polar transfer plane');
  assert.ok(reaches(mu, r1, p.v1, [-1.5 * C.AU, 0, 1.5e-3 * C.AU], tof) < 1e-7, 'near-180° arc reaches r2');
}

// 20) Simplified model: the porkchop minimum (escape + capture Δv) equals the patched-conic Hohmann transfer
//     within 2% (Δv and time of flight); the escape and capture costs may shift the cheapest point slightly.
{
  const sc = SCENARIOS.find(q => q.id === 'e_mars');
  const sy = C.buildSystem(sc.bodies.map(b => { const p = BODIES[b.k].simple; return { name: b.k, mass: p.mass, radius: p.radius * 1e3, parent: b.parent, a: p.a * 1e3, phase: 0 }; }));
  const Mh = { mode: 'capture', h0: 185, hB: 300, t0: 0, theta: 0, dv: 3600 }, gH = C.hohmannGuess(sy, Mh), tofH = gH.tof / DAY;
  const muS = sy.mu[2], r1 = sy.a[0], r2 = sy.a[1], rB = sy.R[1] + 300e3;
  const vinfA = Math.sqrt(muS / r2) - Math.sqrt(muS * 2 * r1 / (r2 * (r1 + r2)));
  const dvH = gH.dv + Math.sqrt(vinfA * vinfA + 2 * sy.mu[1] / rB) - Math.sqrt(sy.mu[1] / rB);
  const g = C.porkchop(sy, Mh, { t1a: gH.t0 - 30, t1b: gH.t0 + 30, fa: tofH - 40, fb: tofH + 40, nd: 121, nt: 161 });
  const tofMin = tofH - 40 + 80 * Math.floor(g.min / 121) / 160;
  assert.ok(Math.abs(g.dv[g.min] / dvH - 1) < 0.02, `porkchop minimum ${g.dv[g.min].toFixed(1)} m/s ≈ Hohmann ${dvH.toFixed(1)} m/s`);
  assert.ok(Math.abs(tofMin / tofH - 1) < 0.02, `minimum's time of flight ${tofMin.toFixed(1)} d ≈ Hohmann ${tofH.toFixed(1)} d`);
}

// 21) Real model, 2026 Mars window: the lowest departure C3 falls in Oct–Dec 2026; at the r_e_mars scenario's
//     date and arrival time the Lambert departure Δv is within 3% of the N-body solution's; the 3D arc reaches
//     Mars under two-body propagation about the Sun. Porkchop timing is printed.
const sEM = realSys(['earth', 'mars', 'sun']);
{
  const Mm = { mode: 'capture', h0: 185, hB: 300 }, ta = C.utcToDays(Date.UTC(2026, 8, 1)), tb = C.utcToDays(Date.UTC(2027, 1, 1));
  const g = C.porkchop(sEM, Mm, { t1a: ta, t1b: tb, fa: 100, fb: 420, nd: 100, nt: 75 });
  let kc = -1; g.c3.forEach((x, k) => { if (Number.isFinite(x) && (kc < 0 || x < g.c3[kc])) kc = k; });
  const dep = new Date(C.daysToUtc(ta + (tb - ta) * (kc % 100) / 99));
  assert.ok(dep.getUTCFullYear() === 2026 && dep.getUTCMonth() >= 9 && dep.getUTCMonth() <= 11, `lowest C3 departs in Oct–Dec 2026 (${dep.toISOString().slice(0, 10)})`);
  assert.ok(g.c3[kc] > 8 && g.c3[kc] < 11, `lowest C3 ${g.c3[kc].toFixed(2)} km²/s²`);
  const sc = SCENARIOS.find(q => q.id === 'r_e_mars'), Ms = { ...sc.M };
  Ms.duration = C.autoDuration(C.hohmannGuess(sEM, Ms), Ms.mode);
  const sim = C.simulate(sEM, Ms, { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 }), tr = C.lambertTransfer(sEM, Ms.t0 * DAY, sim.bPeri.t, Ms);
  assert.ok(Math.abs(tr.dvD / Ms.dv - 1) < 0.03, `Lambert departure Δv ${tr.dvD.toFixed(1)} m/s ≈ N-body ${Ms.dv.toFixed(1)} m/s`);
  assert.ok(Math.abs(tr.dvA / sim.captured.dv - 1) < 0.03, `Lambert capture Δv ${tr.dvA.toFixed(1)} m/s ≈ N-body ${sim.captured.dv.toFixed(1)} m/s`);
  const a = relState(sEM, 0, Ms.t0 * DAY), b = relState(sEM, 1, Ms.t0 * DAY + sim.bPeri.t);
  assert.ok(reaches(sEM.mu[2], a.slice(0, 3), tr.v1, b.slice(0, 3), sim.bPeri.t) < 1e-7, 'Earth→Mars 3D arc reaches Mars');
  const t = Date.now();
  C.porkchop(sEM, Mm, { t1a: ta, t1b: tb, fa: 100, fb: 420, nd: 200, nt: 150 });
  console.log(`porkchop 200×150 (Earth→Mars): ${Date.now() - t} ms`);
}

// 22) Asymptote departure: the initial state of a Lambert seed is the periapsis of a departure hyperbola whose
//     excess velocity vector (from the eccentricity vector, independent of the construction) is the Lambert v∞.
{
  const t1 = C.utcToDays(Date.UTC(2026, 9, 30)) * DAY, M0 = { mode: 'capture', side: 0, h0: 185, hB: 300 };
  for (const tofD of [310, 250, 260]) { // 250 d: δ∞ ≈ 56°, 260 d: ≈ −82° (beside the 180° ridge), out of the old θ/β reach
    const seed = C.lambertSeed(sEM, t1, tofD * DAY, M0), Mx = { ...M0, ...seed, duration: tofD };
    const y = C.initialState(sEM, Mx).y, mu = sEM.mu[0], P = new Float64Array(9), V = new Float64Array(9);
    C.states(sEM, t1, P, V); // r, v relative to Earth
    const r = [0, 1, 2].map(j => y[j] - P[j]), v = [0, 1, 2].map(j => y[3 + j] - V[j]);
    const h = cross(r, v), ev = add(scl(cross(v, h), 1 / mu), scl(r, -1 / norm(r))), ecc = norm(ev), eh = scl(ev, 1 / ecc), qh = scl(cross(h, eh), 1 / norm(cross(h, eh)));
    const vinf = Math.sqrt(dot(v, v) - 2 * mu / norm(r)), cn = -1 / ecc, sn = Math.sqrt(1 - cn * cn);
    assert.ok(Math.abs(norm(r) - sEM.R[0] - 185e3) < 1e-3 && Math.abs(dot(r, v)) < 1e-6 * norm(r) * norm(v), `departure at the parking orbit's periapsis (${tofD} d)`);
    assert.ok(relErr(scl(add(scl(eh, cn), scl(qh, sn)), vinf), seed.tr.vinfD) < 1e-9, `departure asymptote = Lambert v∞ (${tofD} d, δ∞ ${seed.beta.toFixed(1)}°)`);
  }
}

// 23) Aerocapture bookkeeping: off unless capture mode and the pass is below the final orbit; the raise burn
//     matches the vis-viva difference (Mars, 50 km pass, 300 km orbit ≈ 60 m/s).
{
  const mu = sEM.mu[1], R = sEM.R[1];
  assert.ok(C.aeroOn({ mode: 'capture', aero: true, hAtm: 50, hB: 300 }) && !C.aeroOn({ mode: 'flyby', aero: true, hAtm: 50, hB: 300 }) && !C.aeroOn({ mode: 'capture', aero: true, hAtm: 400, hB: 300 }));
  const dv = C.aeroRaise(mu, R + 50e3, R + 300e3), vp = Math.sqrt(mu * (2 / (R + 50e3) - 2 / (2 * R + 350e3)));
  assert.ok(Math.abs(dv - (Math.sqrt(mu / (R + 300e3)) - vp * (R + 50e3) / (R + 300e3))) < 1e-9 && dv > 55 && dv < 65, `raise burn ${dv.toFixed(2)} m/s`);
}

(async () => {
  // 24) Lambert seed -> N-body: the refinement reaches the target periapsis within 1 km and the chosen arrival
  //     time within 1 day; with aerocapture the pass is at the atmosphere altitude, the raise burn at the final
  //     orbit's apoapsis matches the vis-viva value.
  for (const [Mx, d0, tofD] of [
    [{ mode: 'capture', side: 0, h0: 185, hB: 300, hRet: 60 }, Date.UTC(2026, 10, 8, 10), 279],
    [{ mode: 'capture', side: 0, h0: 185, hB: 300, hRet: 60, aero: true, hAtm: 50 }, Date.UTC(2026, 9, 30), 310],
  ]) {
    const t1 = C.utcToDays(d0) * DAY, seed = C.lambertSeed(sEM, t1, tofD * DAY, Mx), M0 = { ...Mx, ...seed, duration: C.autoDuration({ tof: tofD * DAY }, Mx.mode) };
    const r = await C.refineSeed(sEM, M0), sim = C.simulate(sEM, { ...M0, theta: r.theta, dv: r.dv, beta: r.beta }, { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 });
    const tag = Mx.aero ? 'aerocapture' : 'capture', alt = (sim.bPeri.d - sEM.R[1]) / 1e3;
    assert.ok(Math.abs(alt - (Mx.aero ? Mx.hAtm : Mx.hB)) < 1, `${tag}: periareion ${alt.toFixed(3)} km`);
    assert.ok(Math.abs(sim.bPeri.t / DAY - tofD) < 1, `${tag}: arrival after ${(sim.bPeri.t / DAY).toFixed(3)} d ≈ ${tofD} d`);
    assert.ok(Math.abs(r.dv / seed.dv - 1) < 0.01, `${tag}: N-body departure Δv ${r.dv.toFixed(1)} m/s within 1% of Lambert ${seed.dv.toFixed(1)} m/s`);
    if (Mx.aero) {
      assert.deepStrictEqual(sim.events.map(e => e.label), ['ev.depart', 'ev.targetPeri', 'ev.aero', 'ev.raise']);
      assert.ok(Math.abs((sim.captured.d - sEM.R[1]) / 1e3 - Mx.hB) < 1, 'aerocapture: apoapsis on the final orbit');
      assert.ok(Math.abs(sim.captured.dv - C.aeroRaise(sEM.mu[1], sim.aero.d, sim.captured.d)) < 0.5, `aerocapture: raise burn ${sim.captured.dv.toFixed(2)} m/s`);
    } else assert.ok(sim.captured && Math.abs(sim.captured.dv / seed.tr.dvA - 1) < 0.03, 'capture Δv ≈ Lambert');
  }

  // 3) Solver converges for capture mode
  const Mc = { ...M, mode: 'capture', hB: 100, theta: g.theta, dv: g.dv };
  const o = await C.optimize(s, Mc);
  assert.ok(o.f < 1e-6, 'capture solve should converge');

  // 13) Real model solves: Earth→Moon free return on a fixed date; Earth→Mars finds the late-2026 window
  const solveReal = async (keys, Mr) => {
    const sy = realSys(keys), gr = C.hohmannGuess(sy, Mr), sib = gr.case === 'sibling';
    const M0 = { ...Mr, theta: gr.theta, dv: gr.dv, t0: gr.t0, beta: 0, duration: C.autoDuration(gr, Mr.mode) };
    const r = await C.optimize(sy, M0, { varyT0: sib, varyBeta: sib });
    return { r, sy, sim: C.simulate(sy, { ...M0, ...r }, { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 }) };
  };
  const t26 = C.utcToDays(Date.UTC(2026, 10, 15));
  const fr = await solveReal(['earth', 'moon'], { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: t26, theta: 0, dv: 3100, duration: 12 });
  assert.ok(fr.r.f < 1e-4 && fr.sim.bPeri && fr.sim.aRet, 'real free return converges');
  assert.ok(Math.abs((fr.sim.bPeri.d - fr.sy.R[1]) / 1e3 - 250) < 5 && Math.abs((fr.sim.aRet.d - fr.sy.R[0]) / 1e3 - 60) < 5, 'real free return: 250 km perilune, 60 km perigee');
  assert.strictEqual(fr.sim.bPeri.dir, -1, 'real free return passes the Moon retrograde');
  const ma = await solveReal(['earth', 'mars', 'sun'], { mode: 'capture', side: 0, h0: 185, hB: 300, hRet: 60, t0: C.utcToDays(Date.UTC(2026, 8, 1)), theta: 0, dv: 3600, duration: 300 });
  const dep = new Date(C.daysToUtc(ma.r.t0));
  assert.ok(ma.r.f < 1e-6 && ma.sim.captured, 'real Earth→Mars converges and captures');
  assert.ok(dep.getUTCFullYear() === 2026 && dep.getUTCMonth() >= 9, `Earth→Mars departs in late 2026 (${dep.toISOString().slice(0, 10)})`);
  assert.ok(Math.abs((ma.sim.bPeri.d - ma.sy.R[1]) / 1e3 - 300) < 5, 'Earth→Mars: 300 km periareion');

  // 14) The app's real scenarios still hit their targets with the stored values
  for (const sc of SCENARIOS.filter(q => q.model === 'real')) {
    const sy = realSys(sc.bodies.map(b => b.k)), Ms = { ...sc.M };
    Ms.duration = C.autoDuration(C.hohmannGuess(sy, Ms), Ms.mode);
    const r2 = C.simulate(sy, Ms, { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 });
    assert.ok(r2.impact < 0 && r2.bPeri && Math.abs((r2.bPeri.d - sy.R[1]) / 1e3 - Ms.hB) < 5, `${sc.id}: target periapsis ≈ ${Ms.hB} km`);
    if (Ms.mode === 'free') assert.ok(r2.aRet && Math.abs((r2.aRet.d - sy.R[0]) / 1e3 - Ms.hRet) < 5, `${sc.id}: return ≈ ${Ms.hRet} km`);
    if (Ms.mode === 'capture') assert.ok(r2.captured, `${sc.id}: captured`);
  }
  console.log('OK — all core tests passed');
})();

// ===== Aerocapture altitudes: AMAT values are kept as is and converted to our radius =====
{
  const { BODIES: B, atmAltitudes } = require('../js/bodies.js');
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`);
  for (const [k, b] of Object.entries(B)) {
    if (!b.atm) { assert.strictEqual(atmAltitudes(k), null, k); continue; }
    assert.ok(Number.isFinite(b.atmR), `${k}: atmR`);
    const [lo, sk] = atmAltitudes(k);
    near(b.radius + lo, b.atmR + b.atm[0], k + ' h_low'); // same distance from the centre
    near(b.radius + sk, b.atmR + b.atm[1], k + ' h_skip');
  }
  assert.deepStrictEqual(B.mars.atm, [50, 120]);        // AMAT values untouched
  near(atmAltitudes('uranus')[0], 10 + 25559 - 25362, 'uranus h_low');
  near(atmAltitudes('uranus')[1], 1500 + 25559 - 25362, 'uranus h_skip');
  near(atmAltitudes('earth')[0], 50 + 6371.0 - 6371.0084, 'earth h_low');
  near(atmAltitudes('titan')[0], 300 + 2575.0 - 2574.7, 'titan h_low');
  console.log('aerocapture altitude conversion ok');
}
