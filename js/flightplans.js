'use strict';
// Flight plans for the cabin's pomodoro (Phase 10): work sessions fly the legs of a real mission, breaks are spent in
// orbit. DOM-free: kabin.html, Node tests and tools/flight-plans/build.js run it (after js/core.js, js/bodies.js).
// The trajectories are js/core.js simulate() output, made once by tools/flight-plans/build.js into js/flightdata.js
// (FLIGHT_DATA: per plan, tracks of integrator points thinned to what cubic Hermite interpolation reproduces, and the
// legs on them); this file holds the plans' definitions, the systems the tracks were flown in and the mapping from the
// timer to the flight:
//   work: the session flies its leg; the mission clock runs linearly from the leg's start to its end over the session
//     (paused: the craft stops). Leg = work sessions flown (pomodoro state `flight`), round the plan for a loop.
//   break (and the wait after it): the mission clock stops at the leg's end. At a body: a circular orbit through the
//     arrival periapsis in the approach plane (illustrative: a free return does not stay; radius from the plan), one
//     turn per short break, a long break the same speed (more turns); the bodies move on by the orbit's time. In a cruise
//     (Mars): the craft rolls slowly (passive thermal control, one turn in FP_ROLL), the view turning from the plan's
//     first look to its second in the turning break.
const FPX = typeof buildSystem === 'function' ? { buildSystem, states, BODIES, DAY } : { ...require('./core.js'), ...require('./bodies.js') };

// sc: the simulator's scenario (js/app.js SCENARIOS) a plan flies; tour: [body, orbit altitude km] in order, the last
// leg back to the first body; extra: [body, anchor] drawn too, placed about the anchor of the track's system
const FLIGHT_PLANS = {
  // Earth–Moon free return (r_em_free, 2026-11-15): out to the 250 km perilune, back to the 60 km return perigee;
  // breaks in a 250 km lunar orbit and on the 185 km parking orbit
  em: { sc: 'r_em_free', loop: true, park: 185, extra: [] },
  // Earth to Mars (r_e_mars, 2026-11-08): the cruise in eight slices, looking back at the shrinking Earth and Moon in
  // the first four and ahead at Mars in the rest, the turn in the fourth break; after the eighth, a 300 km Mars orbit
  mars: { sc: 'r_e_mars', loop: false, slices: 8, turn: 4, extra: [['moon', 'earth']] },
  // Saturn's moons: Titan → Enceladus → Dione → Rhea → Titan, from 2026-11-15, each leg on its lowest-Δv date after
  // the last arrival; the long break of a 4-session cycle falls at Titan
  saturn: { loop: true, parent: 'saturn', from: Date.UTC(2026, 10, 15), tour: [['titan', 1500], ['enceladus', 100], ['dione', 100], ['rhea', 100]],
    extra: ['mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus'].map(k => [k, 'saturn']) },
  // Jupiter's Galilean moons: Callisto → Io → Europa → Ganymede → Callisto
  jupiter: { loop: true, parent: 'jupiter', from: Date.UTC(2026, 10, 15), tour: [['callisto', 200], ['io', 100], ['europa', 100], ['ganymede', 200]],
    extra: ['io', 'europa', 'ganymede', 'callisto'].map(k => [k, 'jupiter']) },
};
const FP_IDS = Object.keys(FLIGHT_PLANS);
const FP_ROLL = 20 * 60000; // ms per turn of the cruise roll (Apollo's barbecue roll: about three an hour)

// the real model's system for body keys, as the simulator builds it (parents from js/bodies.js)
function fpSystem(keys) {
  return FPX.buildSystem(keys.map(k => { const b = FPX.BODIES[k]; return { name: k, mu: b.gm * 1e9, radius: b.radius * 1e3, parent: keys.indexOf(b.parent), a: 0, orb: b.orb }; }));
}
const fpSys = tr => tr._sys || Object.defineProperty(tr, '_sys', { value: fpSystem(tr.keys) })._sys;

// ---- cubic Hermite on (t, r, v) between thinned integrator points ----
// state at s ∈ [0, 1] between a = [r, v] at ta and b at tb, written to out (6)
function fpHermite(a, b, ta, tb, s, out) {
  const h = tb - ta, s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const d00 = (6 * s2 - 6 * s) / h, d10 = 3 * s2 - 4 * s + 1, d01 = (-6 * s2 + 6 * s) / h, d11 = 3 * s2 - 2 * s;
  for (let j = 0; j < 3; j++) {
    out[j] = h00 * a[j] + h10 * h * a[3 + j] + h01 * b[j] + h11 * h * b[3 + j];
    out[3 + j] = d00 * a[j] + d10 * a[3 + j] + d01 * b[j] + d11 * b[3 + j];
  }
  return out;
}
// the craft on track tr at t (s after the track's departure), absolute in the track's system
function fpTrack(tr, t, out = new Array(6)) {
  const T = tr.t, n = T.length, Y = tr.y;
  if (t <= T[0]) { for (let j = 0; j < 6; j++) out[j] = Y[j]; return out; }
  if (t >= T[n - 1]) { for (let j = 0; j < 6; j++) out[j] = Y[6 * (n - 1) + j]; return out; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  return fpHermite(Y.slice(6 * lo, 6 * lo + 6), Y.slice(6 * hi, 6 * hi + 6), T[lo], T[hi], (t - T[lo]) / (T[hi] - T[lo]), out);
}

// ---- the timer -> the flight ----
// Where plan D is for pomodoro state s and its view v (js/pomodoro.js pomoView) at now; null when idle.
//   { leg, mode: 'work' | 'orbit' | 'cruise' | 'done', u (work: 0–1), tau (orbit: s along it), frac (cruise break: 0–1+),
//     el (break: ms into it) }
function fpWhere(D, s, v, now) {
  const L = D.legs.length, f = s.flight;
  if (v.phase === 'idle') return null;
  if (v.phase === 'work') {
    if (!D.loop && f >= L) return fpDone(D, s, now - s.t0 - s.paused);
    return { leg: D.loop ? f % L : f, mode: 'work', u: v.frac };
  }
  if (f < 1) return null;
  const j = D.loop ? (f - 1) % L : f - 1;
  if (!D.loop && j >= L) return fpDone(D, s, now - s.t0 - s.paused);
  // the break's length and the time into it (waiting: past its end, the orbit goes on)
  const brk = v.phase === 'wait' ? (s.cfg.long > 0 && s.n % s.cfg.every === 0 ? 'long' : 'short') : v.phase;
  const dur = (brk === 'long' ? s.cfg.long : s.cfg.short) * 60000, el = v.phase === 'wait' ? dur + Math.max(0, now - s.t0) : v.frac * dur;
  const B = D.legs[j].brk;
  if (B.cruise) return { leg: j, mode: 'cruise', frac: el / dur, el };
  const turns = brk === 'long' ? Math.max(1, Math.round(s.cfg.long / s.cfg.short)) : 1;
  return { leg: j, mode: 'orbit', tau: el / dur * turns * B.P, el };
}
// a finished plan (Mars): round and round the last orbit, one turn per short break
function fpDone(D, s, el) {
  const j = D.legs.length - 1;
  return { leg: j, mode: 'done', tau: Math.max(0, el) / (s.cfg.short * 60000) * D.legs[j].brk.P, el };
}
// The craft for a fpWhere result: { tr (track), t (s after the track's departure: the bodies' time), y (absolute in the
// track's system), look (body key the camera turns to, or null: along the orbit), look2 + mix (a turning break),
// roll (rad), around (orbited body key) }
function fpAt(D, w) {
  const leg = D.legs[w.leg], tr = D.tracks[leg.tr];
  if (w.mode === 'work') return { tr, t: leg.ta + w.u * (leg.tb - leg.ta), y: fpTrack(tr, leg.ta + w.u * (leg.tb - leg.ta)), look: leg.look, roll: 0 };
  const B = leg.brk;
  if (w.mode === 'cruise') {
    const nx = D.legs[w.leg + 1], mix = nx && nx.look !== leg.look ? Math.min(1, Math.max(0, w.frac)) : 0, e = mix * mix * (3 - 2 * mix);
    return { tr, t: leg.tb, y: fpTrack(tr, leg.tb), look: leg.look, look2: nx ? nx.look : leg.look, mix: e, roll: 2 * Math.PI * (w.el / FP_ROLL % 1) };
  }
  // on the break orbit: the body moves on by tau, the craft goes round it
  const sys = fpSys(tr), i = tr.keys.indexOf(B.body), t = leg.tb + w.tau, P = new Float64Array(3 * sys.N), V = new Float64Array(3 * sys.N);
  FPX.states(sys, tr.M.t0 * FPX.DAY + t, P, V);
  const ph = 2 * Math.PI * (w.tau / B.P % 1), c = Math.cos(ph), sn = Math.sin(ph), vc = 2 * Math.PI * B.rho / B.P, y = new Array(6);
  for (let j = 0; j < 3; j++) { y[j] = P[3 * i + j] + B.rho * (c * B.u[j] + sn * B.w[j]); y[3 + j] = V[3 * i + j] + vc * (c * B.w[j] - sn * B.u[j]); }
  return { tr, t, y, look: null, roll: 0, around: B.body };
}

// The bodies to draw at fpAt result a: the track's system exactly, extras about their anchors (from the anchor's own
// system), and the Sun's direction from the craft (unit). Returns { list: [{ key, p: [x, y, z] }], sun }.
const FP_SUBS = new Map();
function fpBodies(D, a) {
  const tr = a.tr, sys = fpSys(tr), T = tr.M.t0 * FPX.DAY + a.t, P = new Float64Array(3 * sys.N), V = new Float64Array(3 * sys.N);
  FPX.states(sys, T, P, V);
  const list = tr.keys.map((key, i) => ({ key, p: [P[3 * i], P[3 * i + 1], P[3 * i + 2]] }));
  const sub = keys => { const id = keys.join(); if (!FP_SUBS.has(id)) FP_SUBS.set(id, fpSystem(keys)); return FP_SUBS.get(id); };
  const byAnchor = {};
  for (const [k, an] of D.extra) if (!tr.keys.includes(k) && tr.keys.includes(an)) (byAnchor[an] = byAnchor[an] || []).push(k);
  for (const [an, ks] of Object.entries(byAnchor)) {
    const keys = [an, ...ks], s2 = sub(keys), P2 = new Float64Array(3 * s2.N), V2 = new Float64Array(3 * s2.N), ia = tr.keys.indexOf(an);
    FPX.states(s2, T, P2, V2);
    ks.forEach((k, m) => list.push({ key: k, p: [0, 1, 2].map(j => P[3 * ia + j] + P2[3 * (m + 1) + j] - P2[j]) }));
  }
  // the Sun: in the system, or from the root's place about it
  let sun;
  const is = tr.keys.indexOf('sun');
  if (is >= 0) sun = [0, 1, 2].map(j => P[3 * is + j] - a.y[j]);
  else {
    const root = tr.keys[sys.root], s3 = sub(['sun', root]), P3 = new Float64Array(6), V3 = new Float64Array(6);
    FPX.states(s3, T, P3, V3);
    sun = [0, 1, 2].map(j => P3[j] - P3[3 + j] + P[3 * sys.root + j] - a.y[j]);
  }
  const l = Math.hypot(...sun);
  return { list, sun: sun.map(q => q / l) };
}

// What the HUD says: a dictionary key and its parameters, and the progress (0–1) through the phase
function fpLabel(id, D, w) {
  const leg = D.legs[w.leg];
  if (w.mode === 'work') {
    if (id === 'mars') { const tot = D.legs[D.legs.length - 1].tb; return { key: 'fp.mars.go', p: { d: Math.floor((leg.ta + w.u * (leg.tb - leg.ta)) / FPX.DAY), n: Math.round(tot / FPX.DAY) }, u: w.u }; }
    return { key: `fp.${id}.go${w.leg}`, p: {}, u: w.u };
  }
  if (w.mode === 'done') return { key: 'fp.mars.done', p: {}, u: null };
  if (w.mode === 'cruise') return { key: 'fp.mars.cruise', p: {}, u: null };
  return { key: 'fp.orbit', p: { b: leg.brk.body }, u: null };
}

if (typeof module !== 'undefined') module.exports = { FLIGHT_PLANS, FP_IDS, FP_ROLL, fpSystem, fpSys, fpHermite, fpTrack, fpWhere, fpAt, fpBodies, fpLabel };
