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

// galactic axes in the J2000 ecliptic (IAU 1958 frame: the north galactic pole at RA 192.85948°, Dec +27.12825°, the
// centre at RA 266.40510°, Dec −28.93617°, J2000)
const VS_GAL = (() => {
  const eq = (ra, de) => { ra *= VS_D2R; de *= VS_D2R; const x = Math.cos(de) * Math.cos(ra), y = Math.cos(de) * Math.sin(ra), z = Math.sin(de), e = 23.4392911 * VS_D2R; return [x, Math.cos(e) * y + Math.sin(e) * z, -Math.sin(e) * y + Math.cos(e) * z]; };
  const Z = eq(192.85948, 27.12825), X0 = eq(266.40510, -28.93617), X = vsN(vsSub(X0, Z.map(v => v * vsDot(X0, Z))));
  return { X, Y: vsX(Z, X), Z };
})();

// Phobos over Mars' afternoon: the pass's moment (found once by tests/core.test.js "vistas": the Sun 35° from the
// Mars–Phobos line, Phobos moving away from the subsolar point)
const VS_MARS_EPOCH = Date.UTC(2026, 10, 8, 5, 25, 30);

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
  // Jupiter and the Galilean moons: 1 million km out (between Europa's and Ganymede's orbits), 4° above its equator, 15°
  // round from the Sun (nearly full); Io and Europa swing across the glass, Ganymede and Callisto pass wide; live,
  // 120× (Io round in 21 minutes, Jupiter turns in 5)
  jupiter: { keys: ['sun', 'jupiter', 'io', 'europa', 'ganymede', 'callisto'], rate: 120, look: 'jupiter',
    at(B, c) {
      const w = c.tau / 2400 * 2 * Math.PI;
      return vsAbout(B, c.T, 'jupiter', 1.0e9, (4 + 1.5 * Math.sin(w)) * VS_D2R, (15 + 4 * Math.sin(w * 0.6)) * VS_D2R, -8 * VS_D2R);
    } },
  // Earthrise from lunar orbit at Apollo 8's moment (1968-12-24 16:40 UTC, the photo AS08-14-2383 on the poster): a
  // circular orbit 110 km up whose plane holds the Earth's direction (near the lunar equator, as Apollo 8's was), the
  // camera level along the ground towards the Earth, the horizon low in the glass; the Earth rises at the orbit's true
  // rate (360° in 1.98 h, 3°/min), from just under the horizon to the glass's upper part, the camera tilting up a little.
  // Telephoto: 18° across the glass (the Earth 1.9°, a tenth of its width). L follows: the rise across the glass.
  earthrise: { keys: ['sun', 'earth', 'moon'], epoch: Date.UTC(1968, 11, 24, 16, 40), fovW: 18, look: 'earth', alt: 1.1e5,
    loop(view) { const om = this.om(); return (1.35 * view.vf + 1.5 * VS_D2R) / om; },
    om() { const r = (VSX.BODIES.moon.radius * 1e3 + this.alt); return Math.sqrt(VSX.BODIES.moon.gm * 1e9 / (r * r * r)); },
    at(B, c, view) {
      const M = B.at('moon'), E = B.at('earth'), e = vsN(vsSub(E.p, M.p)), F = VSX.equatorFrame(VSX.BODIES.moon.axis, c.T, 4), zm = [F[2], F[5], F[8]];
      const n = vsN(vsSub(zm, e.map(v => v * vsDot(zm, e)))), w = vsX(n, e), R = VSX.BODIES.moon.radius * 1e3, rc = R + this.alt, dip = Math.acos(R / rc);
      const ph = Math.acos(Math.sin(-dip - 1.5 * VS_D2R)) - this.om() * c.tau, rh = vsAdd(e.map(v => v * Math.cos(ph)), w, Math.sin(ph)), eye = vsAdd(M.p, rh, rc);
      const ec = vsN(vsSub(E.p, eye)), h = vsN(vsSub(ec, rh.map(v => v * vsDot(ec, rh)))), right = vsX(h, rh);
      // the horizon from half the glass's half-height under the middle to 0.85 of it: the camera tips up with the time
      const below = view.vf * (0.5 + 0.35 * c.tau / c.L), pitch = below - dip;
      return { y: eye, cam: vsCam(vsRot(h, right, pitch), rh) };
    } },
  // Mars close up, Phobos passing: the eye rides with Phobos (its orbit's frame: out from Mars, along the track, the
  // orbit's normal) about 200 km off it on the side away from Mars, a little behind it along the track, swinging across
  // the orbit plane over the loop, so Phobos (its true triaxial shape, about 7° long) crosses Mars' disc from one limb to
  // the other; the camera between Mars' centre and Phobos, rolled 30° (the crossing on a slant). Mars turns under at
  // Phobos' orbital rate less its own spin (47.1 − 14.6 ≈ 32.4°/h, 0.54°/min on the mean; Phobos' eccentricity moves it by
  // ±3 %); the swing, across the orbit plane, adds nothing along that slide. Afternoon over Mars' day side, the Sun behind
  // the eye. Real time, an 8-minute loop.
  mars: { keys: ['sun', 'mars', 'phobos', 'deimos'], epoch: VS_MARS_EPOCH, L: 480, look: 'mars', D: 2e5,
    at(B, c) {
      const M = B.at('mars'), P = B.at('phobos'), rr = vsN(vsSub(P.p, M.p)), vr = vsSub(P.v, M.v);
      const t = vsN(vsSub(vr, rr.map(v => v * vsDot(vr, rr)))), n = vsX(rr, t);
      const a = (-26 + 52 * vsSmooth(c.tau / c.L)) * VS_D2R;
      const u = vsN(vsAdd(vsAdd(rr.map(v => v * Math.cos(a)), n, Math.sin(a)), t, -0.12)), eye = vsAdd(P.p, u, this.D);
      const dm = vsN(vsSub(M.p, eye)), dp = vsN(vsSub(P.p, eye));
      return { y: eye, cam: vsCam(vsSlerp(dm, dp, 0.62), n, 30 * VS_D2R) };
    } },
  // the Milky Way: no body in view (the Sun behind the eye), the gaze sliding along the galactic equator, a turn in 2.5 h
  // (0.04°/s), the band across the glass at a slant
  milky: { keys: [], rate: 1, look: null,
    at(B, c) {
      const l = c.tau * 0.04 * VS_D2R + 3.6, f = vsAdd(VS_GAL.X.map(v => v * Math.cos(l)), VS_GAL.Y, Math.sin(l));
      return { y: [0, 0, 0], cam: vsCam(f, VS_GAL.Z, 28 * VS_D2R) };
    } },
  // Earth and Moon (the simulator's landing view): close to the Moon on its far side, the Earth just past its limb, true
  // sizes through a 42° lens (the Earth's 1.80–2.05° over the month then 4.3–4.9 % of the glass's width, the Moon filling
  // much of it). The
  // eye pick × 1000 km from the Moon's centre (12: the Moon about 40 % of the width; 15: about a third), the Earth a
  // separation sep from the Moon's centre (deg), swaying slowly; the camera between the two, the Earth–Moon line level.
  earth: { keys: ['sun', 'earth', 'moon'], rate: 1, look: 'moon', pick: 12, fovW: 42, sep: { 12: 14, 15: 12.5 },
    at(B, c) {
      const M = B.at('moon'), E = B.at('earth'), e = vsN(vsSub(E.p, M.p)), z = vsN(vsSub([0, 0, 1], e.map(v => v * e[2]))), w = vsX(e, z);
      const sw = c.tau / 1500 * 2 * Math.PI, D = this.pick * 1e6, a = (this.sep[this.pick] + 0.8 * Math.sin(sw)) * VS_D2R;
      const eye = vsAdd(M.p, vsN(vsAdd(vsAdd(e.map(v => -v * Math.cos(a)), w, Math.sin(a)), z, 0.06 + 0.02 * Math.sin(0.7 * sw))), D);
      const dm = vsN(vsSub(M.p, eye)), de = vsN(vsSub(E.p, eye)), th = Math.acos(Math.min(1, vsDot(dm, de)));
      // aim at the middle of the pair's extent: from the Moon's far limb to the Earth's
      const rM = Math.asin(VSX.BODIES.moon.radius * 1e3 / Math.hypot(...vsSub(M.p, eye))), rE = Math.asin(VSX.BODIES.earth.radius * 1e3 / Math.hypot(...vsSub(E.p, eye)));
      return { y: eye, cam: vsCam(vsSlerp(dm, de, (th + rE - rM) / 2 / th), [0, 0, 1]) };
    } },
};
const VISTA_IDS = ['saturn', 'jupiter', 'earthrise', 'mars', 'milky', 'earth'];
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

if (typeof module !== 'undefined') module.exports = { VISTAS, VISTA_IDS, VS_GAL, VS_MARS_EPOCH, vistaLens, vistaClock, vistaAt, vsSystem, vsBodies };
