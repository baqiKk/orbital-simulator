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

(async () => {
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
