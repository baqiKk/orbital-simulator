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
//    (recorded before the refactor): periapses within 1 m, capture Δv within 1 mm/s. The integrator's step count is
//    printed for information only (its last digits, and so the step sequence, may differ between Node versions and
//    processors). Scenarios are read from js/app.js, body numbers from js/bodies.js.
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
const phase1Steps = [];
for (const sc of SCENARIOS.filter(q => q.model === 'simple')) {
  const want = PHASE1[sc.id]; assert.ok(want, `Phase 1 reference for ${sc.id}`);
  const list = sc.bodies.map(b => { const p = BODIES[b.k].simple; return { name: b.k, mass: p.mass, radius: p.radius * 1e3, parent: b.parent, a: (b.a != null ? b.a : p.a) * 1e3, phase: b.phase || 0 }; });
  const sy = C.buildSystem(list), Ms = { ...sc.M };
  Ms.duration = C.autoDuration(C.hohmannGuess(sy, Ms), Ms.mode);
  const r2 = C.simulate(sy, Ms, { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 });
  phase1Steps.push(`${sc.id} ${r2.steps} (${want.steps})`);
  assert.ok(Math.abs(r2.bPeri.d - want.bPeri) < 1, `${sc.id}: target periapsis within 1 m of Phase 1 (${(r2.bPeri.d - want.bPeri).toFixed(4)} m)`);
  if (want.aRet) assert.ok(Math.abs(r2.aRet.d - want.aRet) < 1, `${sc.id}: return periapsis within 1 m of Phase 1 (${(r2.aRet.d - want.aRet).toFixed(4)} m)`);
  if (want.cap) assert.ok(Math.abs(r2.captured.dv - want.cap) < 1e-3, `${sc.id}: capture Δv within 1 mm/s of Phase 1`);
  assert.ok(r2.z.every(z => z === 0), `${sc.id}: simplified model stays in the z = 0 plane`);
}
console.log('Phase 1 integration steps (recorded):', phase1Steps.join(', '));

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
  const planets = keys.filter(k => BODIES[k].parent === 'sun' && BODIES[k].orb.jpl), d = planets.map(helio);
  assert.deepStrictEqual(planets, ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1], `${planets[i]} beyond ${planets[i - 1]}`);
  assert.ok(Math.abs(helio('earth') - 1) < 0.02 && Math.abs(helio('neptune') - 30) < 0.5, 'Earth ≈ 1 AU, Neptune ≈ 30 AU');
  for (const k of keys.filter(q => BODIES[q].parent && BODIES[q].parent !== 'sun')) {
    const i = keys.indexOf(k), p = sy.parent[i], r = Math.hypot(P[3 * i] - P[3 * p], P[3 * i + 1] - P[3 * p + 1], P[3 * i + 2] - P[3 * p + 2]);
    assert.ok(r < sy.soi[p], `${k} inside the SOI of ${keys[p]}`);
  }
}

// 16b) Phase 5c-2 bodies. Ceres and Vesta (SBDB osculating elements, fixed ellipse): at the elements' epoch the
//    position is JPL Horizons' (heliocentric, ecliptic J2000, AU, fetched 2026-10-24) to < 100 km; the period is the
//    record's (Ceres 1679.853 d, Vesta 1325.389 d) and perihelion its q; away from the epoch the two-body ellipse
//    drifts from the real orbit, ≈ 2° (Ceres) and 1.3° (Vesta) in 2000 and 2050 (documented in the Model text).
//    Saturn's moons (mean elements, SAT441): sidereal period = the table's P, distance within a(1 ± e) of Saturn.
{
  const H = { // Horizons vectors: JD -> [x, y, z] au
    ceres: [[2451545.0, -2.379327705915647, 0.7954860388931395, 0.4630055715902157], [2461200.5, 1.414905393057902, 2.369595284745641, -0.1856420348619075], [2469807.5, -0.6181352238856437, 2.534002319527305, 0.1971352223562529]],
    vesta: [[2451545.0, -1.353580437607153, -1.673136657862151, 0.2149018113721361], [2461200.5, 2.269028147514296, -0.5440517022896132, -0.2601452414921288], [2469807.5, -1.949918486540614, 1.417227294549071, 0.1958674180185284]] };
  const ref = { ceres: [1679.853119758983, 2.545159361382861], vesta: [1325.389042911101, 2.148361914524259] }, out = new Float64Array(6);
  for (const k of ['ceres', 'vesta']) {
    const o = C.orbitElements(BODIES[k].orb);
    assert.ok(Math.abs(2 * Math.PI / o.M1 / DAY - ref[k][0]) < 1e-6, k + ': period');
    assert.ok(Math.abs(o.a0 * (1 - o.e0) / C.AU - ref[k][1]) < 1e-9, k + ': perihelion q');
    for (const [jd, x, y, z] of H[k]) {
      C.orbitState(o, (jd - 2451545) * DAY, out, 0);
      const d = Math.hypot(out[0] - x * C.AU, out[1] - y * C.AU, out[2] - z * C.AU), ang = d / Math.hypot(x, y, z) / C.AU * DEG;
      if (jd === 2461200.5) assert.ok(d < 1e5, `${k}: Horizons at the epoch, ${(d / 1e3).toFixed(1)} km`);
      else assert.ok(ang < 2.5, `${k}: drift ${ang.toFixed(2)}° at JD ${jd}`);
    }
  }
  const mk = ['saturn', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'iapetus'], sy = realSys(mk);
  for (let i = 1; i < sy.N; i++) {
    const k = mk[i], o = sy.orb[i], P = BODIES[k].orb.sat[6];
    assert.ok(Math.abs(2 * Math.PI / (o.M1 + o.w1 + o.O1) / DAY - P) < 1e-9, k + ': sidereal period = P');
    for (let j = 0; j < 50; j++) { const r = norm(relState(sy, i, j * P * DAY / 50)); assert.ok(r > o.a0 * (1 - o.e0) * 0.999999 && r < o.a0 * (1 + o.e0) * 1.000001, k + ': distance within a(1 ± e)'); }
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

  // 3) Solver converges for capture mode. The solver tests check what the solution does (periapsis within 1 km of the
  //    target, captured, the departure in its window), not the residual: its last digits change with the Node
  //    version and the processor, the trajectory does not.
  // The solves go through solveMission, as the app's "solve for the target" does.
  const SOPTS = { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 };
  const Mc = { ...M, mode: 'capture', hB: 100, theta: g.theta, dv: g.dv };
  const o = await C.solveMission(s, Mc), oc = C.simulate(s, o.M, SOPTS);
  assert.ok(o.hit && oc.impact < 0 && oc.bPeri && oc.captured && Math.abs((oc.bPeri.d - s.R[1]) / 1e3 - 100) < 1, `capture solve: 100 km perilune (${oc.bPeri && ((oc.bPeri.d - s.R[1]) / 1e3).toFixed(3)} km), captured`);

  // 13) Real model solves: Earth→Moon free return on a fixed date; Earth→Mars finds the late-2026 window. Each also
  //     from inputs with 10⁻¹² relative noise (a stand-in for another engine's last digits: the plain optimizer lands in
  //     a local minimum for some of them, e.g. a 50 000 km periareion); every run must hit.
  let nz = 20261025; const noise = () => 1 + 1e-12 * (((nz = (nz * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1);
  const solveReal = async (keys, Mr, jitter) => {
    const sy = realSys(keys), gr = C.hohmannGuess(sy, Mr), sib = gr.case === 'sibling';
    const M0 = { ...Mr, dep: 'burn', theta: gr.theta * (jitter ? noise() : 1), dv: gr.dv * (jitter ? noise() : 1), t0: gr.t0 * (jitter ? noise() : 1), beta: 0, duration: C.autoDuration(gr, Mr.mode) };
    const r = await C.solveMission(sy, M0, { varyT0: sib, varyBeta: sib });
    return { r, sy, sim: C.simulate(sy, r.M, SOPTS) };
  };
  const t26 = C.utcToDays(Date.UTC(2026, 10, 15)), km = (d, i, sy) => (d - sy.R[i]) / 1e3;
  const FR = { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: t26, theta: 0, dv: 3100, duration: 12 };
  const MA = { mode: 'capture', side: 0, h0: 185, hB: 300, hRet: 60, t0: C.utcToDays(Date.UTC(2026, 8, 1)), theta: 0, dv: 3600, duration: 300 };
  for (let k = 0; k < 5; k++) {
    const fr = await solveReal(['earth', 'moon'], FR, k > 0), tag = k ? ` (noise run ${k})` : '';
    assert.ok(fr.r.hit && fr.sim.impact < 0 && fr.sim.bPeri && fr.sim.aRet, 'real free return: perilune and return perigee' + tag);
    assert.ok(Math.abs(km(fr.sim.bPeri.d, 1, fr.sy) - 250) < 1 && Math.abs(km(fr.sim.aRet.d, 0, fr.sy) - 60) < 1,
      `real free return: 250 km perilune (${km(fr.sim.bPeri.d, 1, fr.sy).toFixed(3)}), 60 km perigee (${km(fr.sim.aRet.d, 0, fr.sy).toFixed(3)})${tag}`);
    assert.strictEqual(fr.sim.bPeri.dir, -1, 'real free return passes the Moon retrograde' + tag);
  }
  for (let k = 0; k < 8; k++) {
    const ma = await solveReal(['earth', 'mars', 'sun'], MA, k > 0), tag = k ? ` (noise run ${k})` : '', dep = new Date(C.daysToUtc(ma.r.M.t0));
    assert.ok(ma.r.hit && ma.sim.impact < 0 && ma.sim.bPeri && ma.sim.captured, 'real Earth→Mars reaches Mars and captures' + tag);
    assert.ok(dep.getUTCFullYear() === 2026 && dep.getUTCMonth() >= 9 && dep.getUTCMonth() <= 11, `Earth→Mars departs in the Oct–Dec 2026 window (${dep.toISOString().slice(0, 10)})${tag}`);
    assert.ok(Math.abs(km(ma.sim.bPeri.d, 1, ma.sy) - 300) < 1, `Earth→Mars: 300 km periareion (${km(ma.sim.bPeri.d, 1, ma.sy).toFixed(3)})${tag}`);
  }
  // the verdict itself: the stored scenario hits; 30 m/s short of it, or a free return aimed at the wrong side, misses
  {
    const sc = SCENARIOS.find(q => q.id === 'r_e_mars'), sy = realSys(sc.bodies.map(b => b.k)), Ms = { ...sc.M };
    Ms.duration = C.autoDuration(C.hohmannGuess(sy, Ms), Ms.mode);
    const okv = C.missionMiss(sy, Ms), bad = C.missionMiss(sy, { ...Ms, dv: Ms.dv - 30 });
    assert.ok(okv.hit && okv.miss < 5 && !bad.hit && bad.miss > 100, `missionMiss: the scenario hits (${okv.miss.toFixed(3)} km), 30 m/s short misses (${bad.miss.toFixed(0)} km)`);
    const sf = SCENARIOS.find(q => q.id === 'r_em_free'), sy2 = realSys(sf.bodies.map(b => b.k)), Mf = { ...sf.M };
    Mf.duration = C.autoDuration(C.hohmannGuess(sy2, Mf), Mf.mode);
    assert.ok(C.missionMiss(sy2, Mf).hit && !C.missionMiss(sy2, { ...Mf, side: 1 }).hit, 'missionMiss: the wrong side of the Moon is a miss');
  }

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

// ===== Body orientation: IAU poles (NAIF PCK) against the axial tilts of the table, spin rate, Earth's meridian =====
{
  const { BODIES } = require('../js/bodies.js');
  const D = Math.PI / 180, deg = x => x / D;
  for (const [k, b] of Object.entries(BODIES)) {
    if (!b.pole) continue;
    const F = C.bodyFrame(b.pole, 0), col = j => [F[j], F[3 + j], F[6 + j]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(dot(col(i), col(j)) - (i === j)) < 1e-12, `${k}: orthonormal`);
    const x = col(0), y = col(1), z = col(2);
    assert.ok(Math.abs(dot([x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], z) - 1) < 1e-12, `${k}: right-handed`);
    // obliquity: spin axis (right-hand rule: the IAU north pole, flipped for retrograde W) vs orbit normal (Sun: ecliptic pole)
    let n = [0, 0, 1];
    const io = b.orb && (b.orb.jpl ? [b.orb.jpl[0][2], b.orb.jpl[0][5]] : b.orb.sb ? [b.orb.sb[3], b.orb.sb[4]] : null);
    if (io) { const I = io[0] * D, O = io[1] * D; n = [Math.sin(I) * Math.sin(O), -Math.sin(I) * Math.cos(O), Math.cos(I)]; }
    const ob = deg(Math.acos(dot(n, z) * Math.sign(b.pole[5])));
    assert.ok(Math.abs(ob - b.tilt) < 0.15, `${k}: obliquity from the PCK pole ${ob.toFixed(2)}° vs table tilt ${b.tilt}°`);
    // one day later the prime meridian has turned by W1 about the pole
    const G = C.bodyFrame(b.pole, C.DAY), x1 = [G[0], G[3], G[6]];
    const ang = Math.atan2(dot([z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]], x1), dot(x, x1));
    const want = ((b.pole[5] % 360) + 540) % 360 - 180;
    assert.ok(Math.abs(deg(ang) - want) < 0.05, `${k}: spin ${deg(ang).toFixed(3)}° per day vs ${want.toFixed(3)}°`);
  }
  // Earth at J2000: the Greenwich meridian points to right ascension ≈ GMST = 280.46° (W is in TDB, GMST in UT1)
  const E = C.bodyFrame(BODIES.earth.pole, 0), ce = Math.cos(C.OBLIQUITY), se = Math.sin(C.OBLIQUITY);
  const gx = E[0], gy = ce * E[3] - se * E[6];
  const ra = (deg(Math.atan2(gy, gx)) + 360) % 360;
  assert.ok(Math.abs(ra - 280.46) < 0.5, `Earth prime meridian RA at J2000: ${ra.toFixed(2)}°`);
  console.log('body orientation (PCK poles) ok');
}

// ===== Orbit maneuvers about one body (Phase 6a) =====
// Textbook examples: the expected numbers are the books' answers, each "bağımsız hesapla doğrulandı" (verified with an
// independent calculation, vis-viva by hand), with each book's μ and radius.
{
  const D = Math.PI / 180, near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
  const muV = 398600.4418e9, ReV = 6378.1363e3; // Vallado
  const circ = (R, h, i = 0) => ({ rp: R + h * 1e3, ra: R + h * 1e3, i: i * D });
  const plan = (mu, o0, o1, opt) => C.maneuverPlan(mu, 1e6, o0, o1, { type: 'hohmann', plane: 'comb', k: 1, ...opt });

  // 24a) Vallado Ex. 6-1, Hohmann LEO (191.34411 km) → GEO (35 781.34857 km): Δv 3.935224 km/s, 5.256713 h
  //      (bağımsız hesapla doğrulandı)
  let p = plan(muV, circ(ReV, 191.34411), circ(ReV, 35781.34857));
  near(p.dv, 3935.224, 0.002, 'Vallado 6-1 Δv'); near(p.tof / 3600, 5.256713, 1e-5, 'Vallado 6-1 time');
  near(p.burns[0].dv, 2457.038, 0.002, 'Vallado 6-1 Δv_a'); near(p.burns[1].dv, 1478.187, 0.002, 'Vallado 6-1 Δv_b');
  // 24b) Vallado Ex. 6-2, bi-elliptic: same LEO → 376 310 km via 503 873 km (both altitudes): 3.904057 km/s
  //      (3.156233 + 0.677358 + 0.070466), 593.92 h (bağımsız hesapla doğrulandı)
  p = plan(muV, circ(ReV, 191.34411), circ(ReV, 376310), { type: 'bielliptic', rb: ReV + 503873e3 });
  near(p.dv, 3904.057, 0.002, 'Vallado 6-2 Δv'); near(p.tof / 3600, 593.92, 0.005, 'Vallado 6-2 time');
  [3156.233, 677.358, 70.466].forEach((v, j) => near(p.burns[j].dv, v, 0.002, `Vallado 6-2 Δv${j + 1}`));
  // 24c) Vallado Ex. 6-4, inclination only, Δi = 15° at v = 5.892311 km/s: 2v·sin(Δi/2) = 1.538202 km/s, one burn
  //      (bağımsız hesapla doğrulandı)
  const r64 = muV / 5892.311 ** 2;
  p = plan(muV, { rp: r64, ra: r64, i: 55 * D }, { rp: r64, ra: r64, i: 40 * D });
  near(p.dv, 1538.202, 0.002, 'Vallado 6-4 Δv'); assert.strictEqual(p.burns.length, 1, 'Vallado 6-4: a single burn');
  near(p.burns[0].iAfter / D, 40, 1e-9, 'Vallado 6-4 final inclination');
  // 24d) Vallado Ex. 6-7 type, LEO 28.5° → GEO with the plane change split between the two burns: ≈ 4.270 km/s with
  //      ≈ 2.2° at the first burn; all of it at apogee costs 4.294 km/s (bağımsız hesapla doğrulandı)
  const leo = circ(ReV, 191.34411, 28.5), geo = circ(ReV, 35781.34857, 0);
  p = plan(muV, leo, geo);
  near(p.dv, 4270.1, 0.5, 'combined plane change Δv'); near(-p.burns[0].di / D, 2.17, 0.05, 'first-burn share');
  const vs = n => [n.v1, n.v2], allEnd = C.burnDv(...vs(p.nodes[0]), 0) + C.burnDv(...vs(p.nodes[1]), 28.5 * D);
  near(allEnd, 4294.1, 0.5, 'plane change all at apogee'); assert.ok(p.dv < allEnd, 'the split beats doing it all at apogee');
  // separately at the slowest point (the transfer apogee): Hohmann + 2·v_apo·sin(Δi/2), in three burns
  const ps = plan(muV, leo, geo, { plane: 'sep' }), h61 = plan(muV, circ(ReV, 191.34411), circ(ReV, 35781.34857));
  const vApo = C.visViva(muV, geo.rp, (leo.rp + geo.rp) / 2);
  near(ps.dv, h61.dv + 2 * vApo * Math.sin(14.25 * D), 1e-6, 'separate plane change at the transfer apogee');
  assert.ok(ps.burns.length === 3 && ps.burns[1].sep && ps.burns[2].now, 'separate turn, then the circularisation right after it');
  // 24e) Curtis Ex. 6.1, from the elliptic 480 × 800 km orbit to a 16 000 km circle (μ 398 600, R 6378): Δv 3.0522 km/s
  //      from perigee (the cheaper apsis), propellant 1291 kg for 2000 kg at Isp 300 s (bağımsız hesapla doğrulandı)
  const muC = 398600e9, ReC = 6378e3;
  p = plan(muC, { rp: ReC + 480e3, ra: ReC + 800e3, i: 0 }, circ(ReC, 16000));
  near(p.dv, 3052.2, 0.05, 'Curtis 6.1 Δv'); near(p.burns[0].dv, 1722.5, 0.05, 'Curtis 6.1 Δv_A'); near(p.burns[1].dv, 1329.7, 0.05, 'Curtis 6.1 Δv_B');
  assert.strictEqual(p.burns[0].side, 0, 'Curtis 6.1: first burn at perigee');
  near(C.propMass(2000, p.dv, 300), 1291, 1, 'Curtis 6.1 propellant');
  // 24f) Curtis Ex. 6.3, 7000 → 105 000 km circles, bi-elliptic via 210 000 km: 4.0285 km/s against Hohmann 4.0463 km/s
  //      (bağımsız hesapla doğrulandı)
  p = plan(muC, circ(0, 7000), circ(0, 105000), { type: 'bielliptic', rb: 210000e3 });
  near(p.dv, 4028.5, 0.1, 'Curtis 6.3 bi-elliptic'); near(plan(muC, circ(0, 7000), circ(0, 105000)).dv, 4046.3, 0.1, 'Curtis 6.3 Hohmann');
  // 24g) Hohmann Δv/v₁ peaks at R = r₂/r₁ ≈ 15.58; with r_b → ∞ the bi-elliptic transfer is cheaper beyond R ≈ 11.94
  const unit = (R, opt) => C.maneuverPlan(1, 0.1, circ(0, 1e-3), circ(0, R * 1e-3), { type: 'hohmann', plane: 'comb', k: 1, ...opt }).dv, hoh = R => unit(R);
  let best = 0, bestR = 0;
  for (let R = 14; R < 17; R += 0.001) { const v = hoh(R); if (v > best) { best = v; bestR = R; } }
  near(bestR, 15.58, 0.01, 'Hohmann maximum');
  const gain = R => hoh(R) - unit(R, { type: 'bielliptic', rb: 1e12 });
  let lo = 10, hi = 14;
  for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (gain(m) > 0) hi = m; else lo = m; }
  near(lo, 11.94, 0.02, 'bi-elliptic break-even');
  // 24h) Elliptic start: the first burn is at the apsis that is cheaper for the target
  assert.strictEqual(plan(muC, { rp: ReC + 300e3, ra: ReC + 20000e3, i: 0 }, circ(ReC, 400)).burns[0].side, 1, 'lowering the apogee: burn at apogee first');
  // GTO 250 × 35 786 km, 28.5° → GEO: the transfer orbit is the GTO itself, one apogee burn with the whole plane change
  p = plan(muV, { rp: ReV + 250e3, ra: ReV + 35786e3, i: 28.5 * D }, circ(ReV, 35786));
  assert.ok(p.burns.length === 1 && p.burns[0].side === 1, 'GTO → GEO: a single apogee burn');
  // 24i) k pieces: the same total Δv; the pieces wait full revolutions of their intermediate orbits
  for (const k of [2, 4]) {
    const q = plan(muV, leo, geo, { k });
    near(q.dv, plan(muV, leo, geo).dv, 1e-6, `k = ${k}: same Δv`);
    assert.strictEqual(q.burns.length, 2 * k, `k = ${k}: ${2 * k} pieces`);
  }
  assert.strictEqual(plan(muV, circ(ReV, 300), circ(ReV, 300, 0)).burns.length, 0, 'nothing to do: no burn');
  assert.strictEqual(C.maneuverPlan(muV, ReV, circ(ReV, 300), circ(ReV, 1000), { type: 'bielliptic', rb: ReV + 500e3 }).error, 'err.mvRb');

  // 25) Flying the plan (J2 off): the closed-loop burns cost what the plan says and land on the target orbit
  const cases = [
    ['LEO 28.5° → GEO', muV, leo, geo, {}],
    ['separate plane change', muV, leo, geo, { plane: 'sep' }],
    ['k = 3', muV, leo, geo, { k: 3 }],
    ['Curtis 6.1', muC, { rp: ReC + 480e3, ra: ReC + 800e3, i: 0 }, circ(ReC, 16000), {}],
    ['equatorial → 40°, elliptic target', muV, circ(ReV, 300), { rp: ReV + 600e3, ra: ReV + 20000e3, i: 40 * D }, {}],
    ['GTO → GEO', muV, { rp: ReV + 250e3, ra: ReV + 35786e3, i: 28.5 * D }, circ(ReV, 35786), {}],
    ['bi-elliptic', muV, circ(ReV, 191.34411), circ(ReV, 376310), { type: 'bielliptic', rb: ReV + 503873e3 }],
    ['lowering, k = 2', muV, circ(ReV, 20000, 10), { rp: ReV + 400e3, ra: ReV + 5000e3, i: 60 * D }, { k: 2 }],
  ];
  for (const [name, mu, o0, o1, opt] of cases) {
    const q = plan(mu, o0, o1, opt), sim = C.maneuverSim({ mu, R: 6000e3, rot: C.laplaceFrame(-90, 90), O0: 0.7 }, q);
    assert.ok(sim.ok && sim.impact < 0 && sim.burns.length === q.burns.length, `${name}: every burn fired`);
    near(sim.burns.reduce((a, b) => a + b.dv, 0), q.dv, 1e-3, `${name}: Δv flown`);
    near(sim.done.rp, o1.rp, 1, `${name}: periapsis`); near(sim.done.ra, o1.ra, 1, `${name}: apoapsis`);
    near(sim.done.i, o1.i, 1e-9, `${name}: inclination`);
    near(sim.tLast - sim.tFirst, q.tof, 1e-6 * q.tof + 1e-3, `${name}: time of flight`);
  }

  // 25b) The app's maneuver scenarios (stored values, altitudes above the NSSDCA equatorial radius, J2 as set) reach
  // their targets; with J2 within the short-period swing of the osculating elements (≈ 3·J2·Re²/a)
  const { BODIES: B } = require('../js/bodies.js');
  for (const sc of SCENARIOS.filter(q => q.model === 'man')) {
    const M = sc.M, d = B[M.body], Re = d.j2[1] * 1e3, mu = d.gm * 1e9, { o0, o1, opt } = C.mvOrbits(M, Re), J2 = M.j2 ? d.j2[0] * 1e-6 : 0;
    const c = { mu, R: d.radius * 1e3, J2, Re, rot: C.laplaceFrame(-90, 90), O0: M.O0 * D }, fin = { F: M.F, isp: M.isp, m0: M.m0, md: M.md, steer: M.steer };
    if (M.type === 'spiral') { // the ion spiral: Edelbaum's Δv, on the target radius and plane, propellant within the tank
      const s = C.spiralFlight(c, o0, o1, fin, { cap: 60000 });
      assert.ok(s.ok && Math.abs(s.done.a / o1.rp - 1) < 3e-3 && Math.abs(s.done.i - o1.i) < 0.1 * D && s.fuel < M.m0 - M.md, `${sc.id}: spiral flown`);
      continue;
    }
    const q = C.maneuverPlan(mu, d.radius * 1e3, o0, o1, opt);
    const sim = C.maneuverSim(c, q);
    const tol = J2 ? 3 * J2 * Re * Re / ((o1.rp + o1.ra) / 2) : 1;
    assert.ok(!q.error && sim.ok && sim.impact < 0 && sim.burns.length === q.burns.length, `${sc.id}: flown`);
    near(sim.done.rp, o1.rp, tol, `${sc.id}: periapsis`); near(sim.done.ra, o1.ra, tol, `${sc.id}: apoapsis`);
    near(sim.done.i, o1.i, J2 ? 3e-3 : 1e-9, `${sc.id}: inclination`);
    if (M.thrust === 'fin') { // the 400 N apogee engine in three pieces: lands on the plane, total loss ≈ 9 m/s (the note)
      const f = C.maneuverFlight(c, q, fin);
      assert.ok(f.ok && Math.abs(f.done.i - o1.i) < 1e-6 && f.lossTot > 5 && f.lossTot < 15 && Math.max(...f.burns.map(b => b.arc)) < Math.PI / 3, `${sc.id}: finite burns (loss ${f.lossTot.toFixed(1)} m/s)`);
    }
  }
  near(C.maneuverPlan(B.earth.gm * 1e9, 6e6, ...Object.values(C.mvOrbits(SCENARIOS.find(q => q.id === 'mv_leo_geo').M, 6378.137e3)).slice(0, 2), { type: 'hohmann', plane: 'comb', k: 1 }).dv,
    3935.22, 0.05, 'mv_leo_geo scenario = Vallado 6-1');
}

// 26) J2 (Earth, NSSDCA J2 and equatorial radius): nodal regression from the integrated path against
// Ω̇ = −(3/2)·n·J2·(Re/p)²·cos i — about −5.00°/day for a 400 km, 51.6° orbit; the 800 km sun-synchronous inclination
// (Ω̇ = 360°/tropical year) ≈ 98.6°; ω̇ = 0 at the critical inclination 63.43°.
{
  const { BODIES: B } = require('../js/bodies.js');
  const D = Math.PI / 180, mu = B.earth.gm * 1e9, Re = B.earth.j2[1] * 1e3, J2 = B.earth.j2[0] * 1e-6;
  const nodeRate = (h, inc, days) => {
    const o = { rp: Re + h * 1e3, ra: Re + h * 1e3, i: inc * D };
    const s = C.maneuverSim({ mu, R: B.earth.radius * 1e3, J2, Re }, { burns: [], o0: o }, { tail: days * C.DAY });
    const T = [], O = [];
    for (let k = 1; k < s.t.length; k++) if (s.z[k - 1] < 0 && s.z[k] >= 0) { // ascending node: its longitude
      const f = s.z[k - 1] / (s.z[k - 1] - s.z[k]);
      T.push(s.t[k - 1] + f * (s.t[k] - s.t[k - 1])); O.push(Math.atan2(s.y[k - 1] + f * (s.y[k] - s.y[k - 1]), s.x[k - 1] + f * (s.x[k] - s.x[k - 1])));
      if (O.length > 1) O[O.length - 1] -= 2 * Math.PI * Math.round((O[O.length - 1] - O[O.length - 2]) / (2 * Math.PI));
    }
    const n = T.length, mt = T.reduce((a, b) => a + b) / n, mo = O.reduce((a, b) => a + b) / n;
    let sxy = 0, sxx = 0; for (let k = 0; k < n; k++) { sxy += (T[k] - mt) * (O[k] - mo); sxx += (T[k] - mt) ** 2; }
    return { meas: sxy / sxx / D * C.DAY, an: C.j2Rates(mu, J2, Re, o.rp, 0, o.i).dO / D * C.DAY };
  };
  const iss = nodeRate(400, 51.6, 10);
  assert.ok(Math.abs(iss.an + 5.00) < 0.02, `ISS-like analytic Ω̇ ${iss.an.toFixed(3)}°/day`);
  assert.ok(Math.abs(iss.meas / iss.an - 1) < 0.01, `ISS-like integrated Ω̇ ${iss.meas.toFixed(3)} vs ${iss.an.toFixed(3)}°/day`);
  const need = 360 / 365.2421897, a = Re + 800e3, iSSO = Math.acos(need / (C.j2Rates(mu, J2, Re, a, 0, 0).dO / D * C.DAY)) / D;
  assert.ok(Math.abs(iSSO - 98.6) < 0.05, `sun-synchronous inclination at 800 km: ${iSSO.toFixed(2)}°`);
  const sso = nodeRate(800, iSSO, 10);
  assert.ok(Math.abs(sso.meas / need - 1) < 0.02, `sun-synchronous integrated Ω̇ ${sso.meas.toFixed(4)}°/day`);
  assert.ok(Math.abs(C.j2Rates(mu, J2, Re, 26600e3, 0.74, Math.acos(Math.sqrt(0.2))).dw) < 1e-20, 'ω̇ = 0 at the critical inclination');

  // 27) Kepler step: one period returns to the start; it agrees with the integrator; the J2 drift turns the orbit
  const o = { rp: Re + 500e3, ra: Re + 30000e3, i: 30 * D }, y0 = C.orbitPoint(mu, o, 0, -Math.PI / 2), out = [];
  const P = 2 * Math.PI * Math.sqrt(((o.rp + o.ra) / 2) ** 3 / mu);
  C.keplerStep(mu, y0.slice(0, 3), y0.slice(3), P, null, out);
  assert.ok(Math.hypot(out[0] - y0[0], out[1] - y0[1], out[2] - y0[2]) < 1e-3, 'Kepler step: one period');
  const sim = C.maneuverSim({ mu, R: 6000e3 }, { burns: [], o0: o }, { tail: 0.37 * P });
  C.keplerStep(mu, y0.slice(0, 3), y0.slice(3), sim.tEnd, null, out);
  assert.ok(Math.hypot(out[0] - sim.end[0], out[1] - sim.end[1], out[2] - sim.end[2]) < 1, 'Kepler step = integration');
  const rates = { dO: 1e-6, dw: 0, dM: 0 };
  C.keplerStep(mu, y0.slice(0, 3), y0.slice(3), P, rates, out);
  const ang = Math.atan2(out[1], out[0]) - Math.atan2(y0[1], y0[0]);
  assert.ok(Math.abs(ang - rates.dO * P) < 1e-9, 'J2 drift: Ω turns by Ω̇·Δt');

  // 29) Finite burns (Phase 6b): the flight reaches the impulsive flight's orbit; the loss vanishes in the short-burn
  // limit as the square of the burn time; the rocket equation holds for every burn
  {
    const muV = 398600.4418e9, ReV = 6378.1363e3, c = { mu: muV, R: 6371e3, rot: C.laplaceFrame(-90, 90), O0: 0 };
    const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
    const circ = (h, i = 0) => ({ rp: ReV + h * 1e3, ra: ReV + h * 1e3, i: i * D });
    const plan = (o0, o1, opt) => C.maneuverPlan(muV, ReV, o0, o1, { type: 'hohmann', plane: 'comb', k: 1, ...opt });
    const leoGeo = plan(circ(300), circ(35786)), fly = (p, fin) => C.maneuverFlight(c, p, { m0: 2000, md: 300, isp: 300, steer: 'local', ...fin });
    const Fs = [1e4, 1e5, 1e6], runs = Fs.map(F => fly(leoGeo, { F })), ve = 300 * C.G0;
    for (const [j, s] of runs.entries()) {
      assert.ok(s.ok && s.burns.length === 2, 'finite LEO → GEO flown');
      for (const b of s.burns) { // Δv = c·ln(m₀/m₁) = ∫F/m dt; duration = Δm/ṁ
        assert.ok(Math.abs(b.dvAcc - b.dv) < 1e-9 * b.dv, `Tsiolkovsky: c·ln(m0/m1) ${b.dv} = ∫F/m dt ${b.dvAcc}`);
        near(b.t1 - b.t0, (b.m0 - b.m1) / (Fs[j] / ve), 1e-6 * (b.t1 - b.t0), 'burn time = Δm/ṁ');
        near(b.m1, b.m0 * Math.exp(-b.dv / ve), 1e-9 * b.m0, 'mass after the burn');
      }
      near(s.fuel, 2000 - s.burns[1].m1, 1e-9, 'propellant = m₀ − m₁');
      near(s.burns[0].el.w, 0, 1e-6, 'centred: the transfer orbit\'s apse line stays on the burn line');
    }
    const [l4, l5, l6] = runs.map(s => s.loss), [d4, d5] = runs.map(s => Math.abs(s.done.ra - leoGeo.o1.ra));
    assert.ok(l4 / l5 > 70 && l4 / l5 < 140 && l5 / l6 > 70 && l5 / l6 < 140, `loss ∝ t_b²: ${l4}, ${l5}, ${l6} m/s`);
    assert.ok(Math.abs(l6) < 0.01 && Math.abs(runs[2].fuel - runs[2].fuelImp) < 0.01, 'short-burn limit: finite = impulsive (Δv, propellant)');
    assert.ok(d4 / d5 > 70 && runs[2].trim < 1e-3, `what is left of the target is second order in the burn time (${d4} m, ${d5} m)`);
    for (const r of runs) near(r.dvImp, leoGeo.dv, 1e-3, 'the impulsive reference = the plan (J2 off)');
    // a plane change lands on the planned inclination, whatever the steering; the separate turn costs little extra
    for (const steer of ['local', 'inertial']) {
      const s = fly(plan(circ(185, 28.5), circ(35786)), { F: 2e4, steer });
      assert.ok(s.ok && Math.abs(s.done.i) < 1e-6 && s.loss < 10, `${steer}: combined plane change lands (loss ${s.loss.toFixed(2)} m/s)`);
    }
    const sep = fly(plan(circ(185, 28.5), circ(35786), { plane: 'sep' }), { F: 2e4 });
    assert.ok(sep.ok && Math.abs(sep.done.i) < 1e-6 && sep.loss < 20, `separate plane change, local steering (loss ${sep.loss.toFixed(2)} m/s)`);
    // splitting a long apogee burn: the loss (with the trim to the target) falls with k
    const gto = { rp: ReV + 250e3, ra: ReV + 35786e3, i: 28.5 * D }, gf = { F: 400, m0: 3500, md: 1900, isp: 320 };
    const tot = [1, 2, 4].map(k => C.maneuverFlight(c, plan(gto, circ(35786), { k }), { steer: 'local', ...gf }).lossTot);
    assert.ok(tot[0] > tot[1] && tot[1] > tot[2] && tot[2] < 0.15 * tot[0], `k = 1, 2, 4: ${tot.map(v => v.toFixed(1)).join(' / ')} m/s`);
    // more than 60° of arc: the run offers k = 1, 2, 4
    const job = { c, o0: gto, o1: circ(35786), opt: { type: 'hohmann', plane: 'comb', k: 1, rb: 0 }, fin: { ...gf, F: 120, steer: 'local' } };
    const run = C.maneuverRun(job);
    assert.ok(run.sim.burns[0].arc > Math.PI / 3 && run.split && run.split.length === 3 && run.split[2].lossTot < run.split[0].lossTot, 'long burn: k = 1, 2, 4 offered');
    // out of propellant: the engine stops at the dry mass
    const dry = fly(leoGeo, { F: 1e4, md: 1500 });
    assert.ok(!dry.ok && dry.fuelOut && Math.abs(dry.mEnd - 1500) < 1e-6, 'dry mass reached: engine off');
  }

  // 30) Low-thrust spiral (Edelbaum): coplanar Δv = v₀ − v₁, with a plane change Edelbaum's Δv lands on the target
  // inclination; revolutions and time agree with the averaged estimate; timing printed
  {
    const muV = 398600.4418e9, ReV = 6378.1363e3, c = { mu: muV, R: 6371e3, rot: C.laplaceFrame(-90, 90), O0: 0 };
    const circ = (h, i = 0) => ({ rp: ReV + h * 1e3, ra: ReV + h * 1e3, i: i * D }), fin = { F: 1, m0: 1000, md: 500, isp: 2000 };
    let t = Date.now();
    const s = C.spiralFlight(c, circ(400), circ(35786), fin, { cap: 60000 }), b = s.burns[0];
    const ms = Date.now() - t, v0 = Math.sqrt(muV / circ(400).rp), v1 = Math.sqrt(muV / circ(35786).rp);
    assert.ok(s.ok && Math.abs(b.dv / (v0 - v1) - 1) < 1e-3, `coplanar spiral Δv ${b.dv.toFixed(1)} vs v0 − v1 ${(v0 - v1).toFixed(1)} m/s`);
    assert.ok(Math.abs(b.revs / s.est.revs - 1) < 0.01 && Math.abs(b.t1 / s.est.t - 1) < 0.01, `revolutions ${b.revs.toFixed(1)} vs estimate ${s.est.revs.toFixed(1)}`);
    assert.ok(Math.abs(b.el.a / circ(35786).rp - 1) < 1e-6, 'spiral ends at the target radius');
    assert.ok(s.t.length < 60000 * 1.3, 'samples within the cap');
    console.log(`spiral LEO → GEO, 1 N: ${b.revs.toFixed(0)} revolutions, ${ms} ms`);
    const e = C.spiralFlight(c, circ(400, 10), circ(35786, 0), fin, { cap: 60000 }), be = e.burns[0];
    assert.ok(Math.abs(be.dv / e.est.dv - 1) < 1e-6 && Math.abs(be.el.i) < 0.1 * D && Math.abs(be.el.a / circ(35786).rp - 1) < 1e-3,
      `Edelbaum Δi = 10°: Δv ${be.dv.toFixed(1)} m/s, i ${(be.el.i / D).toFixed(3)}°`);
    assert.ok(e.est.dv > b.dv, 'a plane change costs more');
    assert.strictEqual(C.spiralFlight(c, { rp: ReV + 300e3, ra: ReV + 900e3, i: 0 }, circ(35786), fin).error, 'err.mvSpiralCirc');
    assert.strictEqual(C.spiralFlight(c, circ(400), circ(35786), { ...fin, F: 0.001 }).error, 'err.mvSpiralRevs');
  }

  // 28) The Moon's IAU pole (PCK, with its 0.1°+ periodic terms) keeps its equator ≈ 1.54° from the ecliptic
  // (Cassini's laws), whatever the node's phase in its 18.6-year cycle
  for (const yr of [2000, 2005, 2010, 2016]) {
    const F = C.equatorFrame(B.moon.axis, (yr - 2000) * C.JYR, 4), tilt = Math.acos(F[8]) / D;
    assert.ok(Math.abs(tilt - 1.54) < 0.06, `Moon equator to ecliptic in ${yr}: ${tilt.toFixed(3)}°`);
  }
  console.log('orbit maneuvers ok');
}

// ===== Phase 6c: the osculating orbit drawn each frame =====
{
  const muE = 398600.4418e9, D = Math.PI / 180, out = new Float64Array(3 * 400);
  const dist = (k, r) => Math.hypot(out[3 * k] - r[0], out[3 * k + 1] - r[1], out[3 * k + 2] - r[2]);
  // 31) An ellipse from a state: the conic closes, every point is on r = p/(1 + e cos ν), the apsides are a(1 ∓ e), the
  // state itself is on it (to the sampling), the points lie in the orbit plane
  {
    const r = [7000e3, 0, 0], v = [0, 8500 * Math.cos(30 * D), 8500 * Math.sin(30 * D)], c = C.conicPoints(muE, r, v, 360, 1e12, out), el = C.rv2el(muE, r, v);
    assert.ok(c && c.closed && Math.abs(c.e - el.e) < 1e-12 && Math.abs(c.a / el.a - 1) < 1e-12, 'ellipse: e and a as rv2el');
    let rmin = Infinity, rmax = 0, off = 0, near = Infinity;
    for (let k = 0; k < c.n; k++) {
      const q = [out[3 * k], out[3 * k + 1], out[3 * k + 2]], rr = Math.hypot(...q);
      rmin = Math.min(rmin, rr); rmax = Math.max(rmax, rr); off = Math.max(off, Math.abs(q[0] * el.n[0] + q[1] * el.n[1] + q[2] * el.n[2]) / rr);
      const cnu = (q[0] * out[0] + q[1] * out[1] + q[2] * out[2]) / (rr * Math.hypot(out[0], out[1], out[2]));
      assert.ok(Math.abs(rr - c.p / (1 + c.e * cnu)) < 1e-6 * rr, 'on the conic equation');
      near = Math.min(near, dist(k, r));
    }
    assert.ok(Math.abs(rmin / el.rp - 1) < 1e-9 && Math.abs(rmax / el.ra - 1) < 1e-3 && off < 1e-12, `apsides ${(rmin / 1e3).toFixed(1)} / ${(rmax / 1e3).toFixed(1)} km, in plane`);
    assert.ok(near < 2 * Math.PI * el.a / 360, 'the craft lies on its drawn orbit');
  }
  // 32) Open orbits: a hyperbola stays inside its asymptotes and within rMax, its v∞ is √(v² − 2μ/r); a near-parabola
  // works; nothing beyond rMax; a radial state draws nothing
  {
    const r = [7000e3, 0, 0], v = [0, 12000, 0], c = C.conicPoints(muE, r, v, 200, 1e9, out), vinf = Math.sqrt(144e6 - 2 * muE / 7000e3);
    assert.ok(c && !c.closed && c.e > 1 && Math.abs(c.vinf / vinf - 1) < 1e-12, `hyperbola v∞ ${(c.vinf / 1e3).toFixed(4)} km/s`);
    const nuInf = Math.acos(-1 / c.e);
    for (let k = 0; k < c.n; k++) {
      const q = [out[3 * k], out[3 * k + 1], out[3 * k + 2]], rr = Math.hypot(...q), nu = Math.atan2(q[1], q[0]);
      assert.ok(rr <= 1e9 * (1 + 1e-9) && Math.abs(nu) < nuInf, 'within rMax and the asymptotes');
    }
    C.conicPoints(muE, r, v, 200, 1e8, out);
    assert.ok(Math.abs(Math.hypot(out[0], out[1], out[2]) - 1e8) < 1, 'a branch reaching past rMax ends there');
    const vp = Math.sqrt(2 * muE / 7000e3), cp = C.conicPoints(muE, r, [0, vp, 0], 100, 1e9, out);
    assert.ok(cp && !cp.closed && Number.isFinite(out[0]) && Math.abs(Math.hypot(out[0], out[1], out[2]) - 1e9) < 1e3, 'parabola');
    assert.strictEqual(C.conicPoints(muE, r, v, 100, 6000e3, out), null, 'the whole branch beyond rMax');
    assert.strictEqual(C.conicPoints(muE, r, [1000, 0, 0], 100, 1e9, out), null, 'radial: no conic');
  }
  // 33) The body to draw it about: the innermost sphere of influence holding the craft (Earth–Moon: near the Moon the
  // Moon, outside its SOI the Earth even when the Moon is nearer than the Earth would suggest)
  {
    const P = new Float64Array(6); C.states(s, 0, P, new Float64Array(6));
    const mx = P[3], my = P[4], soi = s.soi[1];
    assert.strictEqual(C.domBody(s, P, mx + 0.5 * soi, my, 0), 1, 'inside the Moon’s SOI: the Moon');
    assert.strictEqual(C.domBody(s, P, mx + 1.2 * soi, my, 0), 0, 'outside it: the Earth');
    assert.strictEqual(C.domBody(s, P, 1e15, 0, 0), s.root, 'far away: the root');
  }
  console.log('osculating orbit ok');
}

// ===== Phase 6c-2: the vehicle planner and the single firing =====
{
  const muE = 398600.4418e9, ReE = 6378.137e3, D = Math.PI / 180, G0 = C.G0, c = { mu: muE, R: 6371e3, J2: 0, Re: ReE, rot: null, O0: 0 };
  const gto = C.mvOrbits({ hp0: 250, ha0: 35786, i0: 28.5, O0: 0, hp1: 35786, e1: 0, i1: 0, type: 'hohmann', rb: 1e5, plane: 'comb', k: 1 }, ReE);
  const fin = { F: 420, isp: 318, m0: 3500, md: 1900, steer: 'local' }, mdot = fin.F / (fin.isp * G0);
  // 34) Split to the vehicle: every flown piece within the longest firing, as many ignitions as pieces, the same total
  // impulsive Δv as unsplit, the target reached; the refusals say what it would take; the wait between ignitions holds
  {
    const base = C.maneuverPlan(muE, c.R, gto.o0, gto.o1, gto.opt);
    for (const tMax of [3960, 1800, 900]) {
      const sp = C.splitPlan(muE, c.R, gto.o0, gto.o1, gto.opt, { ...fin, tMax, nMax: 0 });
      assert.ok(!sp.error && sp.n === sp.kNode.reduce((a, q) => a + q, 0) && sp.plan.burns.length === sp.n, `tMax ${tMax}: ${sp.n} ignitions`);
      assert.ok(Math.abs(sp.plan.dv - base.dv) < 1e-6, 'splitting keeps the impulsive Δv');
      const s = C.maneuverRun({ c, ...gto, fin, lim: { tMax } }).sim, durs = s.burns.map(b => b.t1 - b.t0);
      assert.ok(s.ok && durs.length === sp.n && Math.max(...durs) <= tMax, `every firing ≤ ${tMax} s (longest ${Math.max(...durs).toFixed(0)} s)`);
      // the cut-off lands a; the rest of the shape is the second-order error the trim Δv accounts for
      assert.ok(Math.abs(s.done.a - gto.o1.rp) < 5e3 && s.trim < 5 && s.done.i < 0.01 * D, `tMax ${tMax}: GEO reached (trim ${s.trim.toFixed(2)} m/s)`);
    }
    // fewer, longer firings lose more
    const loss = t => C.maneuverRun({ c, ...gto, fin, lim: { tMax: t } }).sim.lossTot;
    assert.ok(loss(900) < loss(1800) && loss(1800) < loss(3960), 'shorter firings, smaller loss');
    const ign = C.splitPlan(muE, c.R, gto.o0, gto.o1, gto.opt, { ...fin, tMax: 1800, nMax: 2 });
    assert.ok(ign.error === 'err.vehIgn' && ign.params.need > 2 && ign.params.max === 2, 'too many ignitions: the number needed');
    const fu = C.splitPlan(muE, c.R, gto.o0, gto.o1, gto.opt, { ...fin, md: 3200, tMax: 0 });
    assert.ok(fu.error === 'err.vehFuel' && Math.abs(fu.params.avail - fin.isp * G0 * Math.log(3500 / 3200)) < 1e-6 && fu.params.need > fu.params.avail, 'not enough propellant: needed and available Δv');
    const leo = C.mvOrbits({ hp0: 400, ha0: 400, i0: 0, O0: 0, hp1: 35786, e1: 0, i1: 0, type: 'hohmann', rb: 1e5, plane: 'comb', k: 1 }, ReE);
    assert.strictEqual(C.splitPlan(muE, c.R, leo.o0, leo.o1, leo.opt, { F: 0.07, isp: 1640, m0: 367, md: 284.5, tMax: 864000, nMax: 0 }).error, 'err.vehSpiral', 'low thrust: the spiral');
    const w = 15 * 3600, sw = C.maneuverRun({ c, ...gto, fin, lim: { tMax: 1800, wait: w } }).sim, b = sw.burns;
    assert.ok(sw.ok && b.slice(1).every((q, i) => q.t0 - b[i].t1 >= w - 1), 'the wait between ignitions holds');
    assert.ok(Math.abs(sw.done.ra - gto.o1.ra) < 50e3, 'and the target is still reached');
  }
  // 35) One firing: Δv = c·ln(m₀/m₁) = ∫F/m dt, propellant ṁT; each of the six directions changes what it should (to first
  // order: prograde raises the far apsis, retrograde lowers it, normal / antinormal turn the plane, radial tilts the
  // apse line with a unchanged); centred on the apsis it matches the same Δv applied at once to third order in T; the
  // dry mass cuts it short; enough of it escapes
  {
    const L = C.mvOrbits({ hp0: 400, ha0: 400, i0: 28.5, O0: 0, hp1: 400, e1: 0, i1: 28.5, type: 'hohmann', rb: 1e5, plane: 'comb', k: 1 }, ReE), o0 = L.o0;
    const run = (dir, T, f = fin) => C.burnFor(c, o0, f, { at: 0, T, dir });
    const s = run('pro', 120), b = s.burns[0];
    assert.ok(Math.abs(b.dv - fin.isp * G0 * Math.log(b.m0 / b.m1)) < 1e-9 && Math.abs(b.dv - b.dvAcc) < 1e-6 && Math.abs(s.fuel - mdot * 120) < 1e-6, 'Tsiolkovsky, ∫F/m and ṁT agree');
    const d = q => q.done, km = 1e3;
    assert.ok(d(s).ra - o0.ra > 40 * km && Math.abs(d(s).rp - o0.rp) < km, 'prograde raises the far apsis');
    const r = run('retro', 120); assert.ok(o0.rp - d(r).rp > 40 * km && Math.abs(d(r).ra - o0.ra) < km, 'retrograde lowers the far apsis');
    const n = run('norm', 120), an = run('anti', 120);
    assert.ok(d(n).i - o0.i > 0.05 * D && o0.i - d(an).i > 0.05 * D && Math.abs(d(n).a - (o0.rp + o0.ra) / 2) < km, 'normal and antinormal turn the plane');
    const ro = run('out', 120); assert.ok(d(ro).e > 1e-3 && Math.abs(d(ro).a - (o0.rp + o0.ra) / 2) < km, 'radial: eccentric, the same a');
    const diff = T => { const q = run('pro', T); return Math.abs(q.done.ra - q.imp.ra); };
    assert.ok(diff(240) / diff(120) > 6 && diff(120) < 100, `finite vs impulsive: third order in T (${diff(120).toFixed(1)} m at 120 s)`);
    const dry = run('pro', 3000, { ...fin, md: 3400 });
    assert.ok(dry.fuelOut && Math.abs(dry.burns[0].t1 - dry.burns[0].t0 - 100 / mdot) < 1e-3, 'the dry mass ends the firing');
    const esc = run('pro', 600, { F: 99200, isp: 450.5, m0: 23073, md: 2243 });
    assert.ok(esc.done.e > 1 && esc.done.a < 0, 'a long, strong firing escapes');
  }
  console.log('vehicle planner and single firing ok');
}

// ===== Phase 10 flight plans (js/flightplans.js, js/flightdata.js) =====
// Every track is simulate() output. Flown again from its stored mission (on any Node version and processor: the step
// times differ in their last digits, so they are never matched), the new path passes through the stored points: the new
// integrator points, Hermite-interpolated at the stored times, agree within 10⁻⁶ of the distance to the nearest body
// + 1 km, the speed within the matching amount (that error over the local time scale d / v) + 1 cm/s; the new run
// reaches the same periapses within 1 km and a second. The stored, thinned track reproduces every new integrator point
// within the thinning tolerance (2·10⁻⁵ of the distance) plus the same allowance. The legs: the free return out to a
// 250 km perilune and back to a 60 km perigee; Mars in eight contiguous slices to a 300 km periareion; the moon tours
// closed, each leg leaving after the last arrival and reaching its tour altitude (all within 1 km). Break orbits start
// where the leg ends and close after a period; the timer maps onto the legs as the plan says.
{
  const F = require('../js/flightplans.js'), { FLIGHT_DATA } = require('../js/flightdata.js'), T = require('../js/pomodoro.js');
  const OPTS = { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 }, MIN = 60000;
  assert.deepStrictEqual(Object.keys(FLIGHT_DATA), F.FP_IDS, 'data for every plan');
  const alt = (sys, tr, t, k) => { const P = new Float64Array(3 * sys.N), V = new Float64Array(3 * sys.N); C.states(sys, tr.M.t0 * DAY + t, P, V); const y = F.fpTrack(tr, t), i = tr.keys.indexOf(k); return (Math.hypot(y[0] - P[3 * i], y[1] - P[3 * i + 1], y[2] - P[3 * i + 2]) - sys.R[i]) / 1e3; };
  // the new integrator points up to tEnd (at an impulsive burn, the point before it), as a track
  const flown = (sim, tEnd) => {
    const t = [], y = [];
    for (let i = 0; i < sim.t.length && sim.t[i] <= tEnd; i++) { if (t.length && sim.t[i] === t[t.length - 1]) continue; t.push(sim.t[i]); y.push(sim.x[i], sim.y[i], sim.z[i], sim.vx[i], sim.vy[i], sim.vz[i]); }
    return { t, y };
  };
  // distance to the nearest body and the speed relative to it (after states())
  const nearest = (sys, P, V, q) => {
    let d = Infinity, v = 0;
    for (let b = 0; b < sys.N; b++) { const db = Math.hypot(q[0] - P[3 * b], q[1] - P[3 * b + 1], q[2] - P[3 * b + 2]); if (db < d) { d = db; v = Math.hypot(q[3] - V[3 * b], q[4] - V[3 * b + 1], q[5] - V[3 * b + 2]); } }
    return [d, v];
  };
  for (const [id, D] of Object.entries(FLIGHT_DATA)) {
    for (const tr of D.tracks) {
      const sys = F.fpSystem(tr.keys), sim = C.simulate(sys, tr.M, OPTS), P = new Float64Array(3 * sys.N), V = new Float64Array(3 * sys.N), y = new Array(6);
      const free = tr.M.mode === 'free', ev = free ? sim.aRet : sim.bPeri, tEnd = tr.t[tr.t.length - 1];
      assert.ok(sim.bPeri && ev && Math.abs(ev.t - tEnd) < 1, `${id}: flown again, it arrives when stored (${ev && (ev.t - tEnd).toFixed(4)} s)`);
      const km = (d, i) => (d - sys.R[i]) / 1e3;
      assert.ok(Math.abs(km(sim.bPeri.d, 1) - alt(sys, tr, sim.bPeri.t, tr.keys[1])) < 1 && (!free || Math.abs(km(sim.aRet.d, 0) - alt(sys, tr, sim.aRet.t, tr.keys[0])) < 1), `${id}: the same periapses within 1 km`);
      const nw = flown(sim, ev.t);
      let wp = 0, wi = 0;
      for (let i = 0; i < tr.t.length; i++) { // the stored points on the new path
        C.states(sys, tr.M.t0 * DAY + tr.t[i], P, V); F.fpTrack(nw, Math.min(tr.t[i], ev.t), y);
        const q = tr.y.slice(6 * i, 6 * i + 6), [d, v] = nearest(sys, P, V, q), tp = 1e-6 * d + 1e3, tv = tp * v / d + 0.01;
        wp = Math.max(wp, Math.hypot(y[0] - q[0], y[1] - q[1], y[2] - q[2]) / tp, Math.hypot(y[3] - q[3], y[4] - q[4], y[5] - q[5]) / tv);
      }
      assert.ok(wp <= 1, `${id}: the stored points lie on the path flown again (worst ${wp.toFixed(3)} of the tolerance)`);
      for (let i = 0; i < nw.t.length; i++) { // the new integrator points on the stored, thinned track
        C.states(sys, tr.M.t0 * DAY + nw.t[i], P, V); F.fpTrack(tr, nw.t[i], y);
        const q = nw.y.slice(6 * i, 6 * i + 6), [d] = nearest(sys, P, V, q);
        wi = Math.max(wi, Math.hypot(y[0] - q[0], y[1] - q[1], y[2] - q[2]) / (2e-5 * d + 1e-6 * d + 1e3));
      }
      assert.ok(wi <= 1, `${id}: the thinned track within its tolerance (worst ${wi.toFixed(3)})`);
    }
    // break orbits: start at the leg's end, period, closed
    for (const leg of D.legs) {
      if (leg.brk.cruise) continue;
      const tr = D.tracks[leg.tr], sys = F.fpSystem(tr.keys), i = tr.keys.indexOf(leg.brk.body);
      assert.ok(Math.abs(leg.brk.P - 2 * Math.PI * Math.sqrt(leg.brk.rho ** 3 / sys.mu[i])) < 1e-2, `${id}: break orbit period`);
      const a0 = F.fpAt(D, { leg: D.legs.indexOf(leg), mode: 'orbit', tau: 0 }), a1 = F.fpAt(D, { leg: D.legs.indexOf(leg), mode: 'orbit', tau: leg.brk.P });
      const P = new Float64Array(3 * sys.N), V = new Float64Array(3 * sys.N); C.states(sys, tr.M.t0 * DAY + leg.tb + leg.brk.P, P, V);
      const r1 = [0, 1, 2].map(j => a1.y[j] - P[3 * i + j]), v1 = [0, 1, 2].map(j => a1.y[3 + j] - V[3 * i + j]);
      assert.ok(Math.abs(Math.hypot(...r1) - leg.brk.rho) < 1 && Math.abs(Math.hypot(...v1) - Math.sqrt(sys.mu[i] / leg.brk.rho)) < 1e-6 * Math.sqrt(sys.mu[i] / leg.brk.rho), `${id}: circular`);
      if (!(id === 'em' && leg.brk.body === 'earth')) { const e = F.fpTrack(tr, leg.tb); assert.ok(Math.hypot(a0.y[0] - e[0], a0.y[1] - e[1], a0.y[2] - e[2]) < 3e-5 * leg.brk.rho + 2, `${id}: the break orbit starts where the leg ends`); }
    }
  }
  // the free return: out to the perilune, back to the return perigee, one track, contiguous
  const E = FLIGHT_DATA.em, Es = F.fpSystem(E.tracks[0].keys);
  assert.ok(E.loop && E.legs.length === 2 && E.legs[0].ta === 0 && E.legs[1].ta === E.legs[0].tb && E.legs[0].look === 'moon' && E.legs[1].look === 'earth');
  assert.ok(Math.abs(alt(Es, E.tracks[0], E.legs[0].tb, 'moon') - 250) < 1 && Math.abs(alt(Es, E.tracks[0], E.legs[1].tb, 'earth') - 60) < 1, 'free return: 250 km perilune, 60 km perigee');
  assert.ok(Math.abs(E.legs[1].brk.rho / 1e3 - Es.R[0] / 1e3 - 185) < 0.01 && E.legs[0].brk.body === 'moon', 'breaks: lunar orbit at the perilune, the 185 km parking orbit');
  // Mars: eight contiguous slices to the periareion, looking back for four; a 300 km orbit after the last
  const Ma = FLIGHT_DATA.mars, Ms = F.fpSystem(Ma.tracks[0].keys);
  assert.ok(!Ma.loop && Ma.legs.length === 8 && Ma.legs.every((l, k) => (k ? l.ta === Ma.legs[k - 1].tb : l.ta === 0) && l.look === (k < 4 ? 'earth' : 'mars') && !!l.brk.cruise === k < 7));
  assert.ok(Math.abs(alt(Ms, Ma.tracks[0], Ma.legs[7].tb, 'mars') - 300) < 1 && Math.abs(Ma.legs[7].brk.rho / 1e3 - Ms.R[1] / 1e3 - 300) < 1, 'Mars: 300 km');
  // the tours: closed loops, dates in order, each arrival at the tour altitude
  for (const id of ['saturn', 'jupiter']) {
    const D = FLIGHT_DATA[id], tour = F.FLIGHT_PLANS[id].tour;
    D.tracks.forEach((tr, k) => {
      assert.deepStrictEqual(tr.keys, [tour[k][0], tour[(k + 1) % tour.length][0], F.FLIGHT_PLANS[id].parent], `${id}: leg ${k} bodies`);
      assert.ok(tr.M.h0 === tour[k][1] && tr.M.hB === tour[(k + 1) % tour.length][1], `${id}: leg ${k} leaves and reaches the tour orbits`);
      assert.ok(Math.abs(alt(F.fpSystem(tr.keys), tr, D.legs[k].tb, tr.keys[1]) - tr.M.hB) < 1, `${id}: leg ${k} periapsis at ${tr.M.hB} km`);
      if (k) assert.ok(tr.M.t0 * DAY >= D.tracks[k - 1].M.t0 * DAY + D.legs[k - 1].tb, `${id}: leg ${k} leaves after the last arrival`);
      assert.strictEqual(D.legs[k].brk.body, tr.keys[1]);
    });
    assert.ok(D.loop && D.tracks[0].M.t0 >= C.utcToDays(F.FLIGHT_PLANS[id].from), `${id}: from the plan's date`);
  }
  // the timer -> the flight (25/5, long break 15 every 4)
  const t0 = Date.UTC(2026, 9, 25, 8), s = T.pomoNew('p25'), where = now => F.fpWhere(E, s, T.pomoView(s, now), now);
  assert.strictEqual(where(t0), null, 'idle: no flight');
  T.pomoStart(s, t0);
  let w = where(t0); assert.ok(w.mode === 'work' && w.leg === 0 && F.fpAt(E, w).t === 0, 'the first session leaves Earth');
  let last = -1;
  for (let m = 0; m < 25; m += 0.5) { const a = F.fpAt(E, where(t0 + m * MIN)); assert.ok(a.t > last); last = a.t; }
  assert.ok(Math.abs(F.fpAt(E, where(t0 + 12.5 * MIN)).t - E.legs[0].tb / 2) < 1, 'linear in the session');
  T.pomoPause(s, t0 + 10 * MIN); const tp = F.fpAt(E, where(t0 + 10 * MIN)).t;
  assert.strictEqual(F.fpAt(E, where(t0 + 40 * MIN)).t, tp, 'paused: the craft stops');
  T.pomoStart(s, t0 + 40 * MIN);
  T.pomoAdvance(s, t0 + 55 * MIN); w = where(t0 + 55 * MIN);
  assert.ok(w.mode === 'orbit' && w.leg === 0 && w.tau === 0 && F.fpAt(E, w).around === 'moon', 'the break begins in lunar orbit');
  w = where(t0 + 57.5 * MIN); assert.ok(Math.abs(w.tau - E.legs[0].brk.P / 2) < 1e-6, 'one turn per short break');
  T.pomoAdvance(s, t0 + 61 * MIN); w = where(t0 + 61 * MIN);
  assert.ok(s.phase === 'wait' && w.mode === 'orbit' && Math.abs(w.tau - 1.2 * E.legs[0].brk.P) < 1e-6, 'waiting: the orbit goes on');
  T.pomoStart(s, t0 + 61 * MIN); w = where(t0 + 61 * MIN);
  assert.ok(w.mode === 'work' && w.leg === 1 && F.fpAt(E, w).t === E.legs[1].ta && F.fpAt(E, w).look === 'earth', 'the second session flies home');
  s.n = 3; T.pomoAdvance(s, t0 + 86 * MIN); w = where(t0 + 86 * MIN + 7.5 * MIN);
  assert.ok(s.phase === 'long' && w.leg === 1 && F.fpAt(E, w).around === 'earth' && Math.abs(w.tau - 1.5 * E.legs[1].brk.P) < 1e-6, 'the long break: three turns of the parking orbit');
  s.flight = 4; s.phase = 'work'; s.t0 = t0; s.paused = 0;
  assert.strictEqual(F.fpWhere(E, s, T.pomoView(s, t0), t0).leg, 0, 'round and round');
  // Mars: the cruise breaks roll, the fourth turns the view, the ninth session is in Mars orbit for good
  const m = T.pomoNew('p25'), mw = now => F.fpWhere(Ma, m, T.pomoView(m, now), now);
  m.flight = 3; T.pomoStart(m, t0); T.pomoAdvance(m, t0 + 25 * MIN);
  let a = F.fpAt(Ma, mw(t0 + 27.5 * MIN));
  assert.ok(a.look === 'earth' && a.look2 === 'mars' && Math.abs(a.mix - 0.5) < 1e-9 && a.t === Ma.legs[3].tb && Math.abs(a.roll - 2 * Math.PI * 2.5 / 20) < 1e-9, 'the fourth break turns from Earth to Mars, rolling');
  m.flight = 2; a = F.fpAt(Ma, mw(t0 + 27.5 * MIN)); assert.ok(a.mix === 0 && a.look === 'earth', 'other cruise breaks keep their view');
  m.flight = 8; a = F.fpAt(Ma, mw(t0 + 27.5 * MIN)); assert.strictEqual(a.around, 'mars', 'after the last slice: Mars orbit');
  m.flight = 9; assert.strictEqual(mw(t0 + 27.5 * MIN).mode, 'done');
  m.phase = 'work'; m.t0 = t0; assert.strictEqual(mw(t0 + MIN).mode, 'done', 'a finished plan stays in orbit');
  const lb = F.fpLabel('mars', Ma, { leg: 2, mode: 'work', u: 0.5 });
  assert.ok(lb.key === 'fp.mars.go' && lb.p.d === Math.floor((Ma.legs[2].ta + Ma.legs[2].tb) / 2 / DAY) && lb.p.n === Math.round(Ma.legs[7].tb / DAY), 'Mars: day of the cruise');
  // the bodies to draw: the system, extras about their anchors, the Sun's direction
  const bm = F.fpBodies(Ma, F.fpAt(Ma, { leg: 0, mode: 'work', u: 0.5 })), pe = bm.list.find(b => b.key === 'earth').p, pm = bm.list.find(b => b.key === 'moon').p;
  assert.ok(Math.abs(Math.hypot(pe[0] - pm[0], pe[1] - pm[1], pe[2] - pm[2]) / 1e6 - 384) < 30 && Math.abs(Math.hypot(...bm.sun) - 1) < 1e-12, 'Mars: the Moon beside the Earth');
  const bs = F.fpBodies(FLIGHT_DATA.saturn, F.fpAt(FLIGHT_DATA.saturn, { leg: 0, mode: 'work', u: 0.3 }));
  assert.deepStrictEqual(bs.list.map(b => b.key).sort(), ['dione', 'enceladus', 'iapetus', 'mimas', 'rhea', 'saturn', 'tethys', 'titan'], 'Saturn: every moon once');
  const ps = bs.list.find(b => b.key === 'saturn').p, pt = bs.list.find(b => b.key === 'tethys').p;
  assert.ok(Math.abs(Math.hypot(ps[0] - pt[0], ps[1] - pt[1], ps[2] - pt[2]) / 1e6 - 295) < 3, 'Tethys at its distance');
  assert.ok(bs.sun.every(Number.isFinite) && Math.abs(Math.hypot(...bs.sun) - 1) < 1e-12, 'the Sun from outside the system');
  console.log('flight plans ok');
}
