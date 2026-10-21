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

(async () => {
  // 3) Solver converges for capture mode
  const Mc = { ...M, mode: 'capture', hB: 100, theta: g.theta, dv: g.dv };
  const o = await C.optimize(s, Mc);
  assert.ok(o.f < 1e-6, 'capture solve should converge');
  console.log('OK — all core tests passed');
})();
