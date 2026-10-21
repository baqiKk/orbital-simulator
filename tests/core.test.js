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

(async () => {
  // 3) Solver converges for capture mode
  const Mc = { ...M, mode: 'capture', hB: 100, theta: g.theta, dv: g.dv };
  const o = await C.optimize(s, Mc);
  assert.ok(o.f < 1e-6, 'capture solve should converge');
  console.log('OK — all core tests passed');
})();
