'use strict';
// The cabin's views behind the glass (Phase 14): ready-made scenes on true geometry, shown when no flight plan flies
// and cycled by the screen saver. DOM-free and text-free: kabin.html runs it after js/core.js and js/bodies.js, the
// Node tests require it. Each view gives, for a wall-clock time, the eye's place, the bodies (the real model: JPL mean
// elements, js/core.js buildSystem / states, true sizes), the Sun's place and the camera axes; js/cabin.js draws it
// with the same 3D path as the flight plans (and the same light into the room).
//   Bodies and light are real; the camera's path is staged (like the flight plans' break orbits), slow and calm.
//   Time: a live view runs from now (a rate × real time where moons should visibly move); a looped view replays L
//   seconds from a fixed moment (the Apollo 8 Earthrise, a Phobos pass over Mars' day side), cross-faded at the wrap.
//   Lens: most views see through the glass as the flight plans do (the sky's 100° across the screen); a telephoto view
//   (fovW) narrows the glass's width at the desk view to fovW degrees, as a long lens would (Apollo 8's Earthrise was
//   taken with a 250 mm lens), so a far body is large enough to be seen.
// vistaAt(id, ms, view): view = { hf, vf } the glass's half-angles (rad) at the desk view through this view's lens.
// Returns { id, T (s since J2000 TDB), tau (s into the loop / since the start), cycle, L, y (eye, m, ecliptic), list
// [{ key, p, v }] (with the Sun), sunP, cam { f, r, u }, look (the main body's key, or null) }.
const VSX = typeof buildSystem === 'function' ? { buildSystem, states, BODIES, DAY, utcToDays, bodyFrame, equatorFrame }
  : { ...require('./core.js'), ...require('./bodies.js') };
const VS_D2R = Math.PI / 180;
const vsN = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const vsDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vsX = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vsAdd = (a, b, k = 1) => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const vsSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// v turned by angle a about unit axis k (Rodrigues)
const vsRot = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a), d = vsDot(k, v) * (1 - c), x = vsX(k, v); return [0, 1, 2].map(i => v[i] * c + x[i] * s + k[i] * d); };
function vsSlerp(a, b, t) {
  const th = Math.acos(Math.max(-1, Math.min(1, vsDot(a, b)))); if (th < 1e-9) return a;
  const s = Math.sin(th), p = Math.sin((1 - t) * th) / s, q = Math.sin(t * th) / s;
  return vsN([0, 1, 2].map(i => p * a[i] + q * b[i]));
}
// camera axes looking along f with up as near to `up` as can be, rolled by roll (rad, positive: counter-clockwise on screen)
function vsCam(f, up, roll = 0) {
  f = vsN(f); let r = vsX(f, up); if (Math.hypot(...r) < 1e-9) r = vsX(f, [0, 0, 1]); r = vsN(r);
  let u = vsX(r, f);
  if (roll) { const r0 = r; r = vsRot(r0, f, roll); u = vsRot(u, f, roll); }
  return { f, r, u };
}
const vsSmooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// the real model's system for body keys (parents from js/bodies.js; the Sun the root when present)
const VS_SYS = new Map();
function vsSystem(keys) {
  const id = keys.join();
  if (!VS_SYS.has(id)) VS_SYS.set(id, VSX.buildSystem(keys.map(k => { const b = VSX.BODIES[k]; return { name: k, mu: b.gm * 1e9, radius: b.radius * 1e3, parent: keys.indexOf(b.parent), a: 0, orb: b.orb }; })));
  return VS_SYS.get(id);
}
// the bodies of keys at T: { list, at(key) -> { key, p, v } }
function vsBodies(keys, T) {
  const s = vsSystem(keys), P = new Float64Array(3 * s.N), V = new Float64Array(3 * s.N);
  VSX.states(s, T, P, V);
  const list = keys.map((key, i) => ({ key, p: [P[3 * i], P[3 * i + 1], P[3 * i + 2]], v: [V[3 * i], V[3 * i + 1], V[3 * i + 2]] }));
  return { list, at: k => list.find(q => q.key === k) };
}
const vsPole = (key, T) => { const F = VSX.bodyFrame(VSX.BODIES[key].pole, T); return [F[2], F[5], F[8]]; };
const vsJ2000 = ms => VSX.utcToDays(ms) * VSX.DAY;
const VS_T0 = Date.now(); // live views run from the page's start (their rate × the wall clock since)

// the eye about a planet: distance D (m), elevation el above its equator and azimuth az from the Sun's (rad); the camera
// on the planet's centre, its up the planet's pole, rolled
function vsAbout(B, T, key, D, el, az, roll) {
  const c = B.at(key), z = vsPole(key, T), sun = vsN(vsSub(B.at('sun').p, c.p));
  let x = vsN(vsSub(sun, z.map(v => v * vsDot(sun, z)))); const y = vsX(z, x);
  x = vsAdd(x.map(v => v * Math.cos(az)), y, Math.sin(az));
  const d = vsAdd(x.map(v => v * Math.cos(el)), z, Math.sin(el)), eye = vsAdd(c.p, d, D);
  return { y: eye, cam: vsCam(vsSub(c.p, eye), z, roll) };
}



const VISTAS = {
  // Saturn and its rings: 750 000 km out, 22° above the ring plane on its sunlit side (the Sun's own elevation on the rings
  // is small in 2026, about 8° south), 30° round from the Sun's azimuth, slowly swaying; its moons where they are.
  // Live, 60× (Mimas round in 23 minutes).
  saturn: { keys: ['sun', 'saturn', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus'], rate: 60, look: 'saturn',
    at(B, c) {
      const S = B.at('saturn'), z = vsPole('saturn', c.T), sun = vsN(vsSub(B.at('sun').p, S.p)), side = vsDot(sun, z) < 0 ? -1 : 1;
      const w = c.tau / 1800 * 2 * Math.PI;
      return vsAbout(B, c.T, 'saturn', 7.5e8, side * (22 + 2 * Math.sin(w)) * VS_D2R, (30 + 5 * Math.sin(w * 0.7)) * VS_D2R, -14 * VS_D2R);
    } },
  // Earth and Moon (the simulator's landing view): the Moon near and the Earth behind it, true sizes. Candidate
  // framings (a, b, c) until one is picked:
  //   a: 20 000 km behind the Moon, a little aside, the glass between the two;
  //   b: about the Earth–Moon L2 point (61 000 km beyond the Moon), a slow halo-like circle about the line, telephoto 20°;
  //   c: 8 000 km from the Moon's centre, the Earth just off its limb.
  earth: { keys: ['sun', 'earth', 'moon'], rate: 1, look: 'moon', pick: 'b',
    get fovW() { return this.pick === 'b' ? 20 : 0; },
    at(B, c) {
      const M = B.at('moon'), E = B.at('earth'), e = vsN(vsSub(E.p, M.p)), z = vsN(vsSub([0, 0, 1], e.map(v => v * e[2]))), w = vsX(e, z);
      let eye, k;
      if (this.pick === 'a') { eye = vsAdd(M.p, vsN(vsAdd(e.map(v => -v), vsAdd(w.map(v => v * 0.15), z, 0.05))), 2e7); k = 0.5; }
      else if (this.pick === 'c') { eye = vsAdd(M.p, vsN(vsAdd(e.map(v => -v), vsAdd(w.map(v => v * 0.33), z, 0.06))), 8e6); k = 0.62; }
      else { const ph = c.tau / 1200 * 2 * Math.PI, o = vsAdd(w.map(v => v * Math.cos(ph) * 0.34), z, Math.sin(ph) * 0.12); eye = vsAdd(M.p, vsAdd(e.map(v => -v), o), 6.1e7); k = 0.5; }
      const dm = vsN(vsSub(M.p, eye)), de = vsN(vsSub(E.p, eye));
      return { y: eye, cam: vsCam(vsSlerp(dm, de, k), [0, 0, 1]) };
    } },
};
const VISTA_IDS = ['saturn', 'earth'];
const vistaLens = id => (VISTAS[id] && VISTAS[id].fovW) || 0;
// the view's clock at wall time ms: T, tau, cycle, loop length L (view: for a loop that depends on the glass)
function vistaClock(id, ms, view) {
  const V = VISTAS[id], s = Math.max(0, (ms - VS_T0) / 1000);
  if (V.epoch == null) return { T: vsJ2000(VS_T0) + V.rate * s, tau: s, cycle: 0, L: 0 };
  const L = V.L || V.loop(view), cycle = Math.floor(s / L), tau = s - cycle * L;
  return { T: vsJ2000(V.epoch) + tau, tau, cycle, L };
}
function vistaAt(id, ms, view) {
  const V = VISTAS[id]; if (!V) return null;
  const c = vistaClock(id, ms, view), B = vsBodies(V.keys.length ? V.keys : ['sun'], c.T), o = V.at(B, c, view);
  // no Sun in the system: far behind the eye
  const sunP = V.keys.length ? B.at('sun').p : vsAdd(o.y, o.cam.f, -1.5e11);
  return { id, T: c.T, tau: c.tau, cycle: c.cycle, L: c.L, y: o.y, list: V.keys.length ? B.list : [], sunP, cam: o.cam, look: V.look };
}

if (typeof module !== 'undefined') module.exports = { VISTAS, VISTA_IDS, vistaLens, vistaClock, vistaAt, vsSystem, vsBodies };
