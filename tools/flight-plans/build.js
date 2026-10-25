'use strict';
// Makes js/flightdata.js (FLIGHT_DATA) for the cabin's flight plans (js/flightplans.js FLIGHT_PLANS) with js/core.js.
// Run: node tools/flight-plans/build.js   (no dependencies; a few seconds)
//   em, mars: the simulator's scenario (js/app.js SCENARIOS) simulated as the app does; the legs cut at the target
//     periapsis (and, for the free return, the return perigee).
//   saturn, jupiter: each leg from the last arrival (the first from the plan's date): a porkchop grid over two synodic
//     periods × 0.5–1.6 Hohmann times of flight, its lowest Δv refined in N-body (lambertSeed + refineSeed, capture into
//     the tour's orbit), the next lowest when one does not reach its periapsis within 1 km.
// Each track keeps the integrator's own points (dense where the motion bends) thinned greedily: a point goes when
// cubic Hermite interpolation between its neighbours reproduces every dropped point within FP_TOL of the distance to
// the nearest body. Positions rounded to 1 m, speeds to 0.1 mm/s, times to 1 ms.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../../js/core.js');
const { BODIES } = require('../../js/bodies.js');
const F = require('../../js/flightplans.js');

const ROOT = path.join(__dirname, '..', '..'), DAY = C.DAY, FP_TOL = 2e-5;
const OPTS = { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 };
const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const scStart = appSrc.indexOf('const SCENARIOS = [') + 'const SCENARIOS = '.length;
const SCENARIOS = vm.runInNewContext('(' + appSrc.slice(scStart, appSrc.indexOf('\n];', scStart) + 2) + ')');

// the integrator's points up to tEnd (the first of two points at an impulsive burn)
function recorded(sim, tEnd) {
  const t = [], y = [];
  for (let i = 0; i < sim.t.length && sim.t[i] <= tEnd; i++) {
    if (t.length && sim.t[i] === t[t.length - 1]) continue;
    t.push(sim.t[i]); y.push([sim.x[i], sim.y[i], sim.z[i], sim.vx[i], sim.vy[i], sim.vz[i]]);
  }
  return { t, y };
}
// greedy thinning (see above); returns the kept indices
function thin(sys, t0, rec) {
  const n = rec.t.length, P = new Float64Array(3 * sys.N), V = new Float64Array(3 * sys.N), tol = new Float64Array(n), out = new Array(6);
  for (let i = 0; i < n; i++) {
    C.states(sys, t0 + rec.t[i], P, V);
    let d = Infinity; for (let b = 0; b < sys.N; b++) d = Math.min(d, Math.hypot(rec.y[i][0] - P[3 * b], rec.y[i][1] - P[3 * b + 1], rec.y[i][2] - P[3 * b + 2]));
    tol[i] = FP_TOL * d;
  }
  const ok = (a, b) => {
    for (let i = a + 1; i < b; i++) {
      F.fpHermite(rec.y[a], rec.y[b], rec.t[a], rec.t[b], (rec.t[i] - rec.t[a]) / (rec.t[b] - rec.t[a]), out);
      if (Math.hypot(out[0] - rec.y[i][0], out[1] - rec.y[i][1], out[2] - rec.y[i][2]) > tol[i]) return false;
    }
    return true;
  };
  const keep = [0];
  for (let a = 0; a < n - 1;) { let b = a + 1; while (b + 1 < n && ok(a, b + 1)) b++; keep.push(b); a = b; }
  return keep;
}
const r1 = x => Math.round(x), r4 = x => Math.round(x * 1e4) / 1e4, r3 = x => Math.round(x * 1e3) / 1e3, r9 = x => Math.round(x * 1e9) / 1e9;
function track(keys, M, sys, sim, tEnd) {
  const rec = recorded(sim, tEnd), keep = thin(sys, M.t0 * DAY, rec);
  return { keys, M, t: keep.map(i => r3(rec.t[i])), y: keep.flatMap(i => rec.y[i].map((q, j) => (j < 3 ? r1(q) : r4(q)))), n: rec.t.length };
}
// the break orbit about body b of sys: circular, radius rho, in the plane of the state y relative to b at t, starting
// at its direction; P: the period
function breakOrbit(sys, M, y, t, b, rho) {
  const P = new Float64Array(3 * sys.N), V = new Float64Array(3 * sys.N); C.states(sys, M.t0 * DAY + t, P, V);
  const i = b, r = [0, 1, 2].map(j => y[j] - P[3 * i + j]), v = [0, 1, 2].map(j => y[3 + j] - V[3 * i + j]);
  const n = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], nl = Math.hypot(...n), rl = Math.hypot(...r);
  const u = r.map(q => q / rl), nn = n.map(q => q / nl), w = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]];
  return { body: sys.keys[i], rho: r1(rho), u: u.map(r9), w: w.map(r9), P: r3(2 * Math.PI * Math.sqrt(r1(rho) ** 3 / sys.mu[i])) };
}

function fromScenario(id) {
  const def = F.FLIGHT_PLANS[id], sc = SCENARIOS.find(q => q.id === def.sc), keys = sc.bodies.map(b => b.k), sys = F.fpSystem(keys);
  sys.keys = keys;
  const M = { ...sc.M }; M.duration = C.autoDuration(C.hohmannGuess(sys, M), M.mode);
  const sim = C.simulate(sys, M, OPTS);
  if (!sim.bPeri || (M.mode === 'free' && !sim.aRet)) throw new Error(id + ': the scenario does not reach its periapses');
  const end = M.mode === 'free' ? sim.aRet.t : sim.bPeri.t, tr = track(keys, M, sys, sim, end), at = t => F.fpTrack(tr, t);
  const yB = at(sim.bPeri.t); // the state at the target periapsis (before a capture burn: the track's last point)
  let legs;
  if (id === 'em') {
    const tB = sim.bPeri.t, tA = sim.aRet.t;
    legs = [{ tr: 0, ta: 0, tb: r3(tB), look: 'moon', brk: breakOrbit(sys, M, yB, tB, 1, sim.bPeri.d) },
      { tr: 0, ta: r3(tB), tb: r3(tA), look: 'earth', brk: breakOrbit(sys, M, at(tA), tA, 0, sys.R[0] + def.park * 1e3) }];
  } else {
    const T = sim.bPeri.t;
    legs = Array.from({ length: def.slices }, (_, k) => ({ tr: 0, ta: r3(T * k / def.slices), tb: r3(T * (k + 1) / def.slices), look: k < def.turn ? keys[0] : keys[1], brk: { cruise: true } }));
    legs[def.slices - 1].tb = r3(T);
    legs[def.slices - 1].brk = breakOrbit(sys, M, yB, T, 1, sim.bPeri.d);
  }
  delete tr.n;
  return { loop: def.loop, extra: def.extra, tracks: [tr], legs };
}

async function tour(id) {
  const def = F.FLIGHT_PLANS[id], legs = [], tracks = [];
  let t = C.utcToDays(def.from); // days since J2000: the earliest departure
  for (let k = 0; k < def.tour.length; k++) {
    const [a, h0] = def.tour[k], [b, hB] = def.tour[(k + 1) % def.tour.length], keys = [a, b, def.parent], sys = F.fpSystem(keys);
    sys.keys = keys;
    const Mx = { mode: 'capture', side: 0, h0, hB, hRet: 60 }, mu = sys.mu[2], aA = sys.a[0], aB = sys.a[1];
    const hoh = Math.PI * Math.sqrt(((aA + aB) / 2) ** 3 / mu) / DAY, syn = 1 / Math.abs(sys.n[0] - sys.n[1]) * 2 * Math.PI / DAY;
    const g = { t1a: t, t1b: t + 2 * syn, fa: 0.5 * hoh, fb: 1.6 * hoh, nd: 80, nt: 40 }, pc = C.porkchop(sys, Mx, g);
    const cells = [...pc.dv.keys()].filter(i => Number.isFinite(pc.dv[i])).sort((p, q) => pc.dv[p] - pc.dv[q]);
    let done = null;
    for (const c of cells.slice(0, 12)) {
      const i = c % pc.nd, j = Math.floor(c / pc.nd), t1 = g.t1a + (g.t1b - g.t1a) * i / (pc.nd - 1), tof = g.fa + (g.fb - g.fa) * j / (pc.nt - 1);
      if (done && Math.abs(t1 - done.t1) < syn / 4) continue;
      const seed = C.lambertSeed(sys, t1 * DAY, tof * DAY, Mx); if (!seed) continue;
      const M0 = { ...Mx, ...seed, duration: C.autoDuration({ tof: tof * DAY }, Mx.mode) };
      delete M0.tr;
      let r; try { r = await C.refineSeed(sys, M0); } catch (e) { continue; }
      const M = { ...M0, theta: r.theta, dv: r.dv, beta: r.beta }, sim = C.simulate(sys, M, OPTS);
      const alt = sim.bPeri && (sim.bPeri.d - sys.R[1]) / 1e3;
      process.stdout.write(`  ${a} → ${b}: ${new Date(C.daysToUtc(t1)).toISOString().slice(0, 16)} + ${tof.toFixed(2)} d, Δv ${(seed.tr.dv).toFixed(0)} m/s, periapsis ${alt == null ? '—' : alt.toFixed(2)} km\n`);
      if (sim.bPeri && sim.captured && !sim.events.some(e => e.type === 'impact' && e.t <= sim.bPeri.t) && Math.abs(alt - hB) < 1) { done = { M, sim, t1 }; break; }
    }
    if (!done) throw new Error(`${id}: no leg ${a} → ${b}`);
    const { M, sim } = done, tB = sim.bPeri.t, pre = sim.t.findIndex(q => q === tB);
    const tr = track(keys, M, sys, sim, tB); delete tr.n;
    tracks.push(tr);
    legs.push({ tr: k, ta: 0, tb: r3(tB), look: b, brk: breakOrbit(sys, M, [sim.x[pre], sim.y[pre], sim.z[pre], sim.vx[pre], sim.vy[pre], sim.vz[pre]], tB, 1, sim.bPeri.d) });
    t = M.t0 + tB / DAY + 0.25; // the next leg leaves after the arrival
  }
  return { loop: def.loop, extra: def.extra, tracks, legs };
}

(async () => {
  const D = {};
  for (const id of F.FP_IDS) {
    console.log(id);
    D[id] = F.FLIGHT_PLANS[id].sc ? fromScenario(id) : await tour(id);
    console.log(`  ${D[id].tracks.map(q => q.t.length).join(' + ')} points, legs ${D[id].legs.map(l => ((l.tb - l.ta) / DAY).toFixed(2) + ' d').join(', ')}`);
  }
  const head = `'use strict';
// Generated by tools/flight-plans/build.js from js/core.js and js/flightplans.js FLIGHT_PLANS: do not edit by hand.
// Per plan: loop, extra (as FLIGHT_PLANS), tracks { keys (the real model's system), M (the mission as simulate() takes it;
// t0 in days since J2000 TDB), t (s after departure), y (absolute r m, v m/s per point) } and legs { tr, ta, tb (s on
// the track), look, brk (cruise, or the break orbit: body, rho m, u and w (unit, ecliptic), P s) }.
// tests/core.test.js simulates every track again and checks the points.
`;
  fs.writeFileSync(path.join(ROOT, 'js/flightdata.js'), head + 'const FLIGHT_DATA = ' + JSON.stringify(D) + ';\nif (typeof module !== \'undefined\') module.exports = { FLIGHT_DATA };\n');
  console.log('js/flightdata.js: ' + (fs.statSync(path.join(ROOT, 'js/flightdata.js')).size / 1024).toFixed(0) + ' KB');
})().catch(e => { console.error(e); process.exit(1); });
