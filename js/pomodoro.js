'use strict';
// The cabin's pomodoro timer (Phase 10). DOM-free: kabin.html runs it, Node tests run it with a fake clock.
// The state holds wall-clock timestamps only (Date.now(), never frame counts or timers): the time left is worked out
// again on every look, so a hidden tab, a sleeping computer or a reload changes nothing. The state is saved as JSON
// (prefs.js PREF_KEYS.pomo) and read back with parsePomo.
//   phase: idle (nothing started) · work · short / long (breaks) · wait (a break is over, the next work waits for the
//   user unless auto is on)
//   t0: the phase's start; paused: ms spent paused in it; pausedAt: the pause's start (null while running)
//   seen: the last clock reading (a clock set backwards shifts t0, so the elapsed time stays continuous)
//   n: work sessions in this cycle (a long break every cfg.every); flight: work sessions flown in the flight plan
//   (js/flightplans.js: the leg), skipped ones too; plan: the flight plan's id ('' for none)
// A work session ends into its break by itself. A break ends into the next work only with auto on and only when the
// end is seen in time (within POMO_LATE): after a night asleep the timer waits instead of counting sessions nobody did.
const POMO_PRESETS = { p25: { work: 25, short: 5, long: 15, every: 4 }, p50: { work: 50, short: 10, long: 30, every: 3 }, p15: { work: 15, short: 5, long: 15, every: 4 } };
const POMO_LIM = { work: [5, 120], short: [1, 60], long: [0, 60], every: [2, 8] }; // minutes (every: sessions); long 0: no long break
const POMO_PHASES = ['idle', 'work', 'short', 'long', 'wait'];
const POMO_LATE = 60000;  // an end seen later than this: no chime, no automatic start
const POMO_DAYS = 30;     // daily statistics kept
const POMO_MIN = 60000;

function pomoCfg(c) {
  const o = {};
  for (const [k, [lo, hi]] of Object.entries(POMO_LIM)) { const v = c && Number.isFinite(c[k]) ? Math.round(c[k]) : POMO_PRESETS.p25[k]; o[k] = Math.min(hi, Math.max(lo, v)); }
  return o;
}
function pomoNew(preset = 'p25') {
  return { v: 1, preset: POMO_PRESETS[preset] ? preset : 'p25', cfg: { ...(POMO_PRESETS[preset] || POMO_PRESETS.p25) }, auto: false,
    phase: 'idle', t0: 0, paused: 0, pausedAt: null, seen: 0, n: 0, flight: 0, plan: 'em' };
}
const pomoTimed = ph => ph === 'work' || ph === 'short' || ph === 'long';
const pomoDur = (s, ph = s.phase) => (ph === 'work' ? s.cfg.work : ph === 'short' ? s.cfg.short : ph === 'long' ? s.cfg.long : 0) * POMO_MIN;
const pomoElapsed = (s, now) => Math.max(0, (s.pausedAt ?? now) - s.t0 - s.paused);
const pomoRunning = s => pomoTimed(s.phase) && s.pausedAt == null;
// the break after the n-th work session of the cycle
const pomoBreakAfter = (s, n) => (s.cfg.long > 0 && n % s.cfg.every === 0 ? 'long' : 'short');

function pomoBegin(s, ph, at) { s.phase = ph; s.t0 = at; s.paused = 0; s.pausedAt = null; }
// a clock set backwards: move the phase's start (and a pause's) by the same step
function pomoSync(s, now) {
  if (s.seen && now < s.seen) { const d = now - s.seen; s.t0 += d; if (s.pausedAt != null) s.pausedAt += d; }
  s.seen = now;
}
// Bring the state up to now. Returns what happened, in order:
//   { type: 'end', phase, next, at, late }      a phase ran out at `at` (late: how long ago)
//   { type: 'focus', ms, at, done }             focus time for the statistics (done: a whole session)
function pomoAdvance(s, now) {
  pomoSync(s, now);
  const ev = [];
  for (let guard = 0; guard < 6 && pomoRunning(s) && pomoElapsed(s, now) >= pomoDur(s); guard++) {
    const ph = s.phase, dur = pomoDur(s), at = s.t0 + s.paused + dur;
    if (ph === 'work') { s.n++; s.flight++; pomoBegin(s, pomoBreakAfter(s, s.n), at); }
    else pomoBegin(s, s.auto && now - at < POMO_LATE ? 'work' : 'wait', at);
    ev.push({ type: 'end', phase: ph, next: s.phase, at, late: now - at });
    if (ph === 'work') ev.push({ type: 'focus', ms: dur, at, done: true });
  }
  return ev;
}
// start (idle / waiting: a new work session; paused: go on)
function pomoStart(s, now) {
  const ev = pomoAdvance(s, now);
  if (s.phase === 'idle' || s.phase === 'wait') pomoBegin(s, 'work', now);
  else if (s.pausedAt != null) { s.paused += now - s.pausedAt; s.pausedAt = null; }
  return ev;
}
function pomoPause(s, now) {
  const ev = pomoAdvance(s, now);
  if (pomoRunning(s)) s.pausedAt = now;
  return ev;
}
// back to idle; the cycle starts over (the flight plan keeps its place); work done so far counts as focus time
function pomoReset(s, now) {
  const ev = pomoAdvance(s, now);
  if (s.phase === 'work') { const ms = pomoElapsed(s, now); if (ms > 0) ev.push({ type: 'focus', ms, at: now, done: false }); }
  pomoBegin(s, 'idle', 0); s.n = 0;
  return ev;
}
// end the phase now: a skipped work session moves the cycle and the flight on but is not counted as done
function pomoSkip(s, now) {
  const ev = pomoAdvance(s, now), ph = s.phase;
  if (ph === 'work') {
    const ms = pomoElapsed(s, now);
    s.n++; s.flight++;
    pomoBegin(s, pomoBreakAfter(s, s.n), now);
    ev.push({ type: 'end', phase: ph, next: s.phase, at: now, late: 0, skipped: true });
    if (ms > 0) ev.push({ type: 'focus', ms, at: now, done: false });
  } else if (ph === 'short' || ph === 'long') {
    pomoBegin(s, s.auto ? 'work' : 'wait', now);
    ev.push({ type: 'end', phase: ph, next: s.phase, at: now, late: 0, skipped: true });
  }
  return ev;
}
// what the clock and the HUD show (call pomoAdvance first)
function pomoView(s, now) {
  const dur = pomoDur(s), el = pomoTimed(s.phase) ? Math.min(dur, pomoElapsed(s, now)) : 0;
  return { phase: s.phase, running: pomoRunning(s), paused: s.pausedAt != null, dur, left: dur - el, frac: dur ? el / dur : 0,
    // the session within the cycle: during work the one under way, during its break the one just done
    k: s.phase === 'work' ? s.n % s.cfg.every + 1 : s.phase === 'short' || s.phase === 'long' ? (s.n - 1) % s.cfg.every + 1 : 0, every: s.cfg.every };
}
// mm:ss (or h:mm:ss past an hour; the desk clock shows minutes up to 99)
function pomoClock(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(t / 60), sec = t % 60;
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

// A saved state, checked field by field; anything unusable gives a fresh idle timer (or idle with the saved settings).
function parsePomo(raw) {
  let o = null; try { o = JSON.parse(raw); } catch (e) { /* fresh */ }
  if (!o || typeof o !== 'object' || o.v !== 1) return pomoNew();
  const s = pomoNew(POMO_PRESETS[o.preset] ? o.preset : 'p25');
  if (o.preset === 'custom') s.preset = 'custom';
  s.cfg = pomoCfg(o.cfg); s.auto = o.auto === true;
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const cnt = v => (Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0);
  s.n = cnt(o.n); s.flight = cnt(o.flight);
  s.plan = typeof o.plan === 'string' && /^[a-z]{0,16}$/.test(o.plan) ? o.plan : 'em';
  if (POMO_PHASES.includes(o.phase) && o.phase !== 'idle' && fin(o.t0) && o.t0 > 0 && fin(o.paused) && o.paused >= 0 && (o.pausedAt == null || (fin(o.pausedAt) && o.pausedAt >= o.t0))) {
    s.phase = o.phase; s.t0 = o.t0; s.paused = o.paused; s.pausedAt = o.pausedAt ?? null;
    s.seen = fin(o.seen) ? o.seen : 0;
    if (!pomoTimed(s.phase)) s.pausedAt = null;
  }
  return s;
}

// ---- daily statistics: { 'YYYY-MM-DD' (local): [sessions done, focus ms] }, the last POMO_DAYS days ----
const pomoDay = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function pomoPrune(st) {
  const keys = Object.keys(st).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - POMO_DAYS))) delete st[k];
  return st;
}
function parsePomoStats(raw) {
  let o = null; try { o = JSON.parse(raw); } catch (e) { /* none */ }
  const st = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(v) && Number.isInteger(v[0]) && v[0] >= 0 && Number.isFinite(v[1]) && v[1] >= 0) st[k] = [v[0], v[1]];
  }
  return pomoPrune(st);
}
// add the focus events of pomoAdvance / pomoSkip / pomoReset; true when something changed
function pomoStatsAdd(st, events) {
  let ch = false;
  for (const e of events) {
    if (e.type !== 'focus' || !(e.ms > 0)) continue;
    const k = pomoDay(e.at), d = st[k] || (st[k] = [0, 0]);
    d[0] += e.done ? 1 : 0; d[1] += e.ms; ch = true;
  }
  if (ch) pomoPrune(st);
  return ch;
}

if (typeof module !== 'undefined') module.exports = { POMO_PRESETS, POMO_LIM, POMO_PHASES, POMO_LATE, POMO_DAYS, pomoCfg, pomoNew, pomoTimed, pomoDur, pomoElapsed, pomoRunning,
  pomoAdvance, pomoStart, pomoPause, pomoReset, pomoSkip, pomoView, pomoClock, parsePomo, pomoDay, parsePomoStats, pomoStatsAdd };
