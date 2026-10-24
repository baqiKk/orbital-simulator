// ===================== Data =====================
// Body data lives in js/bodies.js (BODIES). Simplified model: every body plus a free-form custom one;
// real model: the bodies with an ephemeris (the Sun and everything with orbit elements).
const KEYS_SIMPLE = Object.keys(BODIES);
const KEYS_REAL = KEYS_SIMPLE.filter(k => BODIES[k].gm);
// orbit maneuvers: the bodies with J2 and an equatorial radius (the planets and the Moon)
const KEYS_MV = KEYS_REAL.filter(k => BODIES[k].j2);
const AU_KM = AU / 1e3;
// Simplified-model numbers (mass kg, radius km, circular orbit radius km): Phase 1 values where kept, else derived.
function simpleData(k) {
  const b = BODIES[k], s = b.simple;
  if (s) return s;
  const o = b.orb;
  return { mass: b.gm * 1e9 / G, radius: b.radius, a: !o ? 0 : o.jpl ? o.jpl[0][0] * AU_KM : o.sb ? o.sb[1] * AU_KM : o.sat[0] };
}

// model 'simple': t0 in days from the model's epoch. model 'real': t0 in days since J2000 TDB
// (date in the comment), β = out-of-plane burn angle found by the solver for sibling transfers.
const SCENARIOS = [
  { id: 'em_free', model: 'simple', frame: 'rot',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }],
    M: { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: 0, theta: -132.26090326368262, dv: 3162.1420118609917, autoDur: true, duration: 12 } },
  { id: 'em_cap', model: 'simple', frame: 'A',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }],
    M: { mode: 'capture', side: -1, h0: 185, hB: 100, hRet: 60, t0: 0, theta: -122.6404245345841, dv: 3141.0061695917125, autoDur: true, duration: 7 } },
  { id: 'em_sun', model: 'simple', frame: 'rot',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }, { k: 'sun', parent: 0, a: 149598000, phase: 90 }],
    M: { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: 0, theta: -132.31541604192466, dv: 3161.2744423190697, autoDur: true, duration: 12 } },
  { id: 'e_mars', model: 'simple', frame: 'inertial',
    bodies: [{ k: 'earth', parent: 2 }, { k: 'mars', parent: 2 }, { k: 'sun', parent: -1 }],
    M: { mode: 'capture', side: 0, h0: 185, hB: 300, hRet: 60, t0: 685.7782603563348, theta: -150.0725460254747, dv: 3615.9489071591897, autoDur: true, duration: 336 } },
  { id: 'moon_mars', model: 'simple', frame: 'inertial',
    bodies: [{ k: 'moon', parent: 2 }, { k: 'mars', parent: 3 }, { k: 'earth', parent: 3 }, { k: 'sun', parent: -1 }],
    M: { mode: 'capture', side: 0, h0: 100, hB: 300, hRet: 60, t0: 677.8485252280739, theta: -103.79516935006063, dv: 1591.5641379638673, autoDur: true, duration: 336 } },
  { id: 'e_venus', model: 'simple', frame: 'inertial',
    bodies: [{ k: 'earth', parent: 2 }, { k: 'venus', parent: 2 }, { k: 'sun', parent: -1 }],
    M: { mode: 'flyby', side: 0, h0: 185, hB: 500, hRet: 60, t0: 500.5162440898973, theta: -114.42780944038475, dv: 3508.1053919040405, autoDur: true, duration: 220 } },
  // 2026-11-15 00:00 UTC
  { id: 'r_em_free', model: 'real', frame: 'rot',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }],
    M: { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: 9814.500800740741, theta: -133.53427594294783, dv: 3161.142486126646, beta: 0, autoDur: true, duration: 12 } },
  // 2026-11-08 10:07 UTC
  { id: 'r_e_mars', model: 'real', frame: 'inertial',
    bodies: [{ k: 'earth', parent: 2 }, { k: 'mars', parent: 2 }, { k: 'sun', parent: -1 }],
    M: { mode: 'capture', side: 0, h0: 185, hB: 300, hRet: 60, t0: 9807.922656497507, theta: -171.3206731748794, dv: 3658.9015727828582, beta: 6.2686864976017125, autoDur: true, duration: 300 } },
  // 2026-11-01 06:48 UTC
  { id: 'r_gan_cal', model: 'real', frame: 'inertial',
    bodies: [{ k: 'ganymede', parent: 2 }, { k: 'callisto', parent: 2 }, { k: 'jupiter', parent: -1 }],
    M: { mode: 'capture', side: 0, h0: 100, hB: 200, hRet: 60, t0: 9800.78452933949, theta: -115.32101579869845, dv: 1133.8633422404118, beta: -2.9268533075196106, autoDur: true, duration: 10 } },
  // orbit maneuvers about one body (altitudes above its equatorial radius, km; angles deg); 2026-11-15 00:00 UTC
  { id: 'mv_leo_geo', model: 'man', frame: 'eq',
    M: { body: 'earth', t0: 9814.500800740741, hp0: 191.34411, ha0: 191.34411, i0: 0, O0: 0, hp1: 35781.34857, e1: 0, i1: 0, type: 'hohmann', rb: 100000, plane: 'comb', k: 1, m0: 2000, md: 500, isp: 320, j2: false, thrust: 'imp', F: 400, steer: 'local' } },
  { id: 'mv_cape_geo', model: 'man', frame: 'eq',
    M: { body: 'earth', t0: 9814.500800740741, hp0: 185, ha0: 185, i0: 28.5, O0: 0, hp1: 35786, e1: 0, i1: 0, type: 'hohmann', rb: 100000, plane: 'comb', k: 1, m0: 2000, md: 500, isp: 320, j2: false, thrust: 'imp', F: 400, steer: 'local' } },
  { id: 'mv_bielliptic', model: 'man', frame: 'eq',
    M: { body: 'earth', t0: 9814.500800740741, hp0: 191.34411, ha0: 191.34411, i0: 0, O0: 0, hp1: 376310, e1: 0, i1: 0, type: 'bielliptic', rb: 503873, plane: 'comb', k: 1, m0: 2000, md: 500, isp: 320, j2: false, thrust: 'imp', F: 400, steer: 'local' } },
  { id: 'mv_gto', model: 'man', frame: 'eq',
    M: { body: 'earth', t0: 9814.500800740741, hp0: 250, ha0: 35786, i0: 28.5, O0: 0, hp1: 35786, e1: 0, i1: 0, type: 'hohmann', rb: 100000, plane: 'comb', k: 3, m0: 3500, md: 1900, isp: 320, j2: false, thrust: 'fin', F: 400, steer: 'local' } },
  { id: 'mv_spiral', model: 'man', frame: 'eq',
    M: { body: 'earth', t0: 9814.500800740741, hp0: 400, ha0: 400, i0: 28.5, O0: 0, hp1: 35786, e1: 0, i1: 0, type: 'spiral', rb: 100000, plane: 'comb', k: 1, m0: 1000, md: 600, isp: 1800, j2: false, thrust: 'fin', F: 0.3, steer: 'local' } },
  { id: 'mv_sso', model: 'man', frame: 'p0',
    M: { body: 'earth', t0: 9814.500800740741, hp0: 250, ha0: 250, i0: 98.6, O0: 0, hp1: 800, e1: 0, i1: 98.6, type: 'hohmann', rb: 100000, plane: 'comb', k: 1, m0: 1000, md: 800, isp: 300, j2: true, thrust: 'imp', F: 400, steer: 'local' } },
];

// ===================== State =====================
// speed: playback relative to the mission length; rate: real-time playback (simulated s per s, 0 = off)
// kind: 'transfer' (between bodies) or 'man' (orbit maneuvers about one body, S.M holds the maneuver)
const S = { kind: 'transfer', model: 'simple', loop: false, ext: 0, bodies: [], M: {}, frame: 'rot', follow: 'free', soi: false, tracks: true, focus: true, speed: 1, rate: 0, playing: true, u: 0, scenario: 'em_free' };
let sys = null, simR = null, guess = null, C = null;
// maneuver mission: body data, frames and plan of the current one (null for transfers)
let MAN = null;
const cam = { cx: 0, cy: 0, scale: 1e-6 };
let needFit = true, solving = false, cancelSolve = false;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduceMotion) S.playing = false;

// View-mode quality profiles. sub: Hermite sub-samples per integrator step; trackK: body-track points;
// hudMs: HUD text refresh period (0 = every 4th frame); fpsCap: 0 = display rate; ellK: points per orbit ellipse;
// tex: planet textures and lit globes (js/globe.js) — never in the low-resource mode, which then downloads no image.
const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const QUALITY = {
  normal: { stars: true, glow: true, tex: true, texMax: 2048, dprMax: 1.5, fpsCap: 0, sub: 5, trackK: 420, hudMs: 0, ellK: 180, trailK: 96, trailFade: true },
  low:    { stars: false, glow: false, tex: false, texMax: 0, dprMax: 1, fpsCap: 30, sub: 2, trackK: 140, hudMs: 250, ellK: 72, trailK: 36, trailFade: false },
  // 3D (js/mode3d.js): the normal profile, drawn with WebGL; phones render at a lower pixel ratio and get 2k tiers at most
  '3d':   { stars: true, glow: true, tex: true, texMax: COARSE ? 2048 : 4096, dprMax: COARSE ? 1.25 : 1.5, fpsCap: 0, sub: 5, trackK: 420, hudMs: 0, ellK: 180, trailK: 96, trailFade: true },
};
let MODE = 'normal', Q = QUALITY.normal;
// Quality ladder (normal and 3D modes): when frames stay slow, effects go one step at a time — 1: the Sun's glare and
// Earth's clouds, 2: relief, cast shadows and the glint on water, 3: sharper texture tiers; then the old last step
// (lowQ: pixel ratio 1, no glow, no new downloads, the "lighter mode?" tip).
const FX = { lvl: 0 }, FXON = { glare: true, clouds: true, relief: true, glint: true };
function fxSet(l) { FX.lvl = l; FXON.glare = FXON.clouds = l < 1; FXON.relief = FXON.glint = l < 2; }
// widest texture tier now: the mode's, the GPU's limit (3D), base files only from ladder step 3
const texCap = () => (lowQ || FX.lvl >= 3 ? 1024 : Math.min(Q.texMax, V3 ? V3.renderer.capabilities.maxTextureSize : 4096));
const LS = (() => { try { return window.localStorage; } catch (e) { return null; } })();
const SS = (() => { try { return window.sessionStorage; } catch (e) { return null; } })();

const $ = s => document.querySelector(s);
const APSIS = DICT['apsis'];
const peri = i => (S.bodies[i] && APSIS[S.bodies[i].key] && APSIS[S.bodies[i].key][0]) || _('apsis.generic');
const Peri = i => { const p = peri(i); return p[0].toUpperCase() + p.slice(1); };
const NF = (d) => new Intl.NumberFormat(DICT['meta.locale'], { maximumFractionDigits: d, minimumFractionDigits: d });
const nf0 = NF(0), nf1 = NF(1), nf2 = NF(2), nf3 = NF(3);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const parseNum = v => { const x = parseFloat(String(v).replace(',', '.').replace(/\s/g, '')); return Number.isFinite(x) ? x : NaN; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtDist(m) {
  const km = m / 1e3;
  if (km < 1000) return nf1.format(km) + ' km';
  if (km < 5e7) return nf0.format(km) + ' km';
  return nf3.format(m / 1.495978707e11) + ' ' + _('unit.au');
}
function fmtSpeed(v) { return v < 1000 ? nf0.format(v) + ' m/s' : nf3.format(v / 1000) + ' km/s'; }
function fmtDur(sec, withSec) {
  const d = Math.floor(sec / DAY); let r = sec - d * DAY;
  const h = Math.floor(r / 3600); r -= h * 3600; const mi = Math.floor(r / 60); const s = Math.floor(r - mi * 60);
  const p = n => String(n).padStart(2, '0');
  return `${d}${_('unit.d')} ${p(h)}:${p(mi)}` + (withSec ? `:${p(s)}` : '');
}
function fmtPeriod(sec) {
  const d = sec / DAY;
  if (d < 2) return nf2.format(sec / 3600) + ' ' + _('unit.h');
  if (d < 1000) return nf2.format(d) + ' ' + _('unit.d');
  return nf2.format(sec / JYR) + ' ' + _('unit.yr');
}
// real-model calendar: departure date and the date at mission time t (s)
const DATEF = new Intl.DateTimeFormat(DICT['meta.locale'], { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = ms => _('hud.date', { d: DATEF.format(ms) });
const dateAt = t => daysToUtc(S.M.t0) + t * 1000;
const isoMinute = ms => new Date(ms).toISOString().slice(0, 16);
const inEphem = d => { const y = new Date(daysToUtc(d)).getUTCFullYear(); return y >= EPHEM_YEARS[0] && y <= EPHEM_YEARS[1]; };
function fmtMass(m) { return m.toExponential(4).replace('e+', 'e'); }
function massHint(m) {
  const e = m / 5.9722e24;
  if (e >= 1000) return '≈ ' + nf0.format(e) + ' M⊕';
  if (e >= 0.001) return '≈ ' + NF(e < 1 ? 4 : 2).format(e) + ' M⊕';
  return '≈ ' + e.toExponential(2) + ' M⊕';
}

// mass, radius and orbit radius are the simplified model's; the real model reads BODIES directly
function bodyFromPreset(k, over = {}) {
  const p = simpleData(k);
  return { key: k, name: _('body.' + k), mass: p.mass, radius: p.radius, parent: -1, a: p.a, phase: 0, color: BODIES[k].color, ...over };
}

// Real model: every body orbits its natural parent when that parent is in the list, else it is a root.
function linkReal() {
  for (const b of S.bodies) b.parent = S.bodies.findIndex(o => o.key === BODIES[b.key].parent);
}
const depth = k => { let d = 0; while (BODIES[k].parent) { k = BODIES[k].parent; d++; } return d; };

// ===================== Scenario =====================
function loadScenario(id) {
  const sc = SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
  S.scenario = sc.id; S.kind = sc.model === 'man' ? 'man' : 'transfer';
  S.M = { ...sc.M };
  if (S.kind === 'man') { S.model = 'real'; S.bodies = [bodyFromPreset(S.M.body)]; } // dated: lighting, rotation
  else {
    S.model = sc.model;
    S.bodies = sc.bodies.map(b => bodyFromPreset(b.k, { parent: b.parent, ...(b.a != null ? { a: b.a } : {}), phase: b.phase || 0 }));
    if (S.model === 'real') linkReal();
  }
  S.frame = sc.frame; S.follow = 'free';
  openRows.clear(); ovReveal(); MAP.needFit = true;
  $('#scenario').value = sc.id;
  $('#scNote').textContent = _('sc.' + sc.id + '.note');
  syncKind(); syncModel(); renderBodies(); syncMission(); renderFrameSeg();
  rebuild({ fit: true, resetU: true });
  setStatus('');
  if (!reduceMotion) S.playing = true;
  setPlayIcon();
}

// Switch the current setup to the other model. Custom bodies have no ephemeris: if one is the departure
// or target body, the real model starts from its first scenario instead.
function setModel(m) {
  if (m === S.model) return;
  if (m === 'real') {
    if (S.bodies.slice(0, 2).some(b => !BODIES[b.key].gm)) { loadScenario(SCENARIOS.find(s => s.model === 'real').id); return; }
    S.bodies = S.bodies.filter(b => BODIES[b.key].gm);
    S.model = 'real'; linkReal();
    S.M.t0 = utcToDays(Math.floor(Date.now() / 60000) * 60000); S.M.beta = 0;
    S.M.dep = 'burn'; S.M.tof = 0;
  } else {
    S.model = 'simple';
    for (const b of S.bodies) Object.assign(b, simpleData(b.key), { phase: 0 });
    S.M.t0 = 0; S.M.dep = 'burn'; S.M.tof = 0;
  }
  S.scenario = ''; $('#scenario').value = ''; $('#scNote').textContent = _('sc.custom.note');
  openRows.clear();
  syncModel(); renderBodies(); syncMission(); renderFrameSeg();
  rebuild({ fit: true, resetU: true });
}
function syncModel() {
  const real = S.model === 'real';
  setSeg('#modelSeg', S.model);
  $('#dateWrap').hidden = !real; $('#betaWrap').hidden = !real; $('#t0Wrap').hidden = real;
  $('#r-date').hidden = !real;
}
$('#modelSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setModel(b.dataset.v); });

// ===================== Mission kind: transfer / orbit maneuver =====================
// Each kind keeps its own setup: switching back finds the mission as it was left (the first visit loads a scenario).
const KSAVE = { transfer: null, man: null };
function saveKind() { KSAVE[S.kind] = { scenario: S.scenario, model: S.model, bodies: S.bodies, M: S.M, frame: S.frame }; }
function restoreKind(k) {
  const v = KSAVE[k];
  Object.assign(S, { kind: k, scenario: v.scenario, model: v.model, bodies: v.bodies, M: v.M, frame: v.frame, follow: 'free' });
  $('#scenario').value = S.scenario;
  $('#scNote').textContent = S.scenario ? _('sc.' + S.scenario + '.note') : '';
}
function setKind(k) {
  if (k === S.kind) return;
  if (solving) $('#solve').click();
  saveKind();
  if (!KSAVE[k]) { loadScenario(k === 'man' ? SCENARIOS.find(s => s.model === 'man').id : 'em_free'); return; }
  restoreKind(k);
  openRows.clear(); MAP.needFit = true;
  syncKind(); syncModel(); renderBodies(); syncMission(); renderFrameSeg();
  rebuild({ fit: true, resetU: true });
  setStatus('');
}
// the overview picks departure and target bodies: from a maneuver, back to the transfer setup first (no rebuild)
function toTransfer() {
  if (S.kind !== 'man') return;
  saveKind();
  if (KSAVE.transfer) restoreKind('transfer');
  else { const sc = SCENARIOS.find(s => s.id === 'em_free'); Object.assign(S, { kind: 'transfer', model: sc.model, M: { ...sc.M }, frame: sc.frame }); }
  syncKind();
}
function syncKind() {
  const man = S.kind === 'man';
  setSeg('#kindSeg', S.kind);
  $('#mvWrap').hidden = !man; $('#trWrap').hidden = man; $('#modelSeg').hidden = man;
  $('#lbl-date').textContent = _(man ? 'ui.mvDate' : 'ui.date');
  if (!man) MAN = null;
}
$('#kindSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setKind(b.dataset.v); });

// ===================== Body rows =====================
// Overview-style rows (colour, preset, role, parent); the editable fields fold out per row.
const openRows = new Set();
const ICON_CHEV = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';
const ICON_X = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9"/></svg>';
function renderBodies() {
  const box = $('#bodies');
  if (S.kind === 'man') { // one central body: pick it here or in the mission window
    const b = S.bodies[0], open = openRows.has(0);
    box.innerHTML = `<div class="brow" data-i="0">
      <div class="brow-h"><span class="dot" style="background:${b.color}"></span>
        <select data-f="key" aria-label="${_('body.select')}">${KEYS_MV.map(k => `<option value="${k}" ${k === b.key ? 'selected' : ''}>${_('body.' + k)}</option>`).join('')}</select>
        <span class="role dep">${_('body.role.center')}</span><span class="par">${esc(_('body.parentRoot'))}</span>
        <button type="button" class="ibtn" data-act="toggle" aria-expanded="${open}" aria-controls="brow-b0" aria-label="${esc(_('body.details', { name: b.name }))}">${ICON_CHEV}</button><span></span></div>
      <div class="brow-b" id="brow-b0" ${open ? '' : 'hidden'}>${realInfo(b)}</div></div>`;
    $('#addBody').hidden = true;
    renderOverview();
    return;
  }
  const N = S.bodies.length, real = S.model === 'real';
  const roots = S.bodies.filter(b => b.parent < 0).length;
  box.innerHTML = S.bodies.map((b, i) => {
    const role = i === 0 ? `<span class="role dep">${_('body.role.dep')}</span>` : i === 1 ? `<span class="role tgt">${_('body.role.tgt')}</span>` : `<span class="role">${_('body.role.extra')}</span>`;
    const opts = (real ? KEYS_REAL : KEYS_SIMPLE).map(k => `<option value="${k}" ${k === b.key ? 'selected' : ''}>${_('body.' + k)}</option>`).join('');
    const par = esc(b.parent < 0 ? _('body.parentRoot') : _('body.orbits', { parent: S.bodies[b.parent].name }));
    const open = openRows.has(i);
    // natural-parent hint: simplified model, body placed around a non-natural parent;
    // real model, body whose parent is missing while another body is the centre
    const pk = BODIES[b.key].parent;
    let hint = '';
    if (pk && !S.bodies.some(o => o.key === pk) && (real ? b.parent < 0 && roots > 1 : b.parent >= 0 && S.bodies[b.parent].key !== pk)) {
      const pn = _('body.' + pk);
      hint = `<p class="hint">${_('body.hint', { name: esc(b.name), parent: pn })}${N < 4 ? ` <button type="button" class="linkbtn" data-act="addparent" data-k="${pk}">${_('body.hintAdd', { parent: pn })}</button>` : ''}</p>`;
    }
    return `<div class="brow" data-i="${i}">
      <div class="brow-h"><span class="dot" style="background:${b.color}"></span>
        <select data-f="key" aria-label="${_('body.select')}">${opts}</select>${role}
        <span class="par" title="${par}">${par}</span>
        <button type="button" class="ibtn" data-act="toggle" aria-expanded="${open}" aria-controls="brow-b${i}" aria-label="${esc(_('body.details', { name: b.name }))}">${ICON_CHEV}</button>
        ${i >= 2 ? `<button type="button" class="ibtn x" data-act="remove" aria-label="${_('body.remove')}">${ICON_X}</button>` : '<span></span>'}</div>
      <div class="brow-b" id="brow-b${i}" ${open ? '' : 'hidden'}>${real ? realInfo(b) : simpleFields(b, i)}</div>${hint}
    </div>`;
  }).join('');
  $('#addBody').hidden = N >= 4;
  renderOverview();
}
function simpleFields(b, i) {
  const pOpts = `<option value="-1" ${b.parent < 0 ? 'selected' : ''}>${_('body.parentRoot')}</option>` +
    S.bodies.map((o, j) => j === i ? '' : `<option value="${j}" ${b.parent === j ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
  return `${b.key === 'custom' ? `<label class="field"><span>${_('body.name')}</span><input type="text" data-f="name" value="${esc(b.name)}"></label>` : ''}
        <div class="grid2">
          <label class="field"><span>${_('body.mass')}</span><input type="text" inputmode="decimal" data-f="mass" value="${fmtMass(b.mass)}"><small data-hint="mass">${massHint(b.mass)}</small></label>
          <label class="field"><span>${_('body.radius')}</span><input type="number" step="any" data-f="radius" value="${b.radius}"></label>
          <label class="field"><span>${_('body.parent')}</span><select data-f="parent">${pOpts}</select></label>
          <label class="field"><span>${_('body.a')}</span><input type="number" step="any" data-f="a" value="${b.a}" ${b.parent < 0 ? 'disabled' : ''}></label>
          <label class="field"><span>${_('body.phase')}</span><input type="number" step="any" data-f="phase" value="${b.phase}" ${b.parent < 0 ? 'disabled' : ''}></label>
        </div>`;
}
// Real model: read-only physical data and the orbit elements at the departure date.
function realInfo(b) {
  const d = BODIES[b.key], rows = [
    [_('body.mu'), nf1.format(d.gm), 'km³/s²'], [_('body.size'), nf1.format(d.radius), 'km'], [_('body.tilt'), nf2.format(d.tilt), '°']];
  if (b.parent >= 0 && d.orb) {
    const o = orbitElements(d.orb), t = S.M.t0 * DAY, inc = (o.i0 + o.i1 * t) * 180 / Math.PI;
    rows.push([_('body.sma'), fmtDist(o.a0 + o.a1 * t), ''], [_('body.ecc'), nf3.format(o.e0 + o.e1 * t), ''],
      [_('body.inc'), nf2.format(Math.abs(inc) < 0.005 ? 0 : inc), '°'], [_('body.period'), fmtPeriod(2 * Math.PI / (o.O1 + o.w1 + o.M1)), ''],
      [_('body.ref'), _(d.orb.jpl || !d.orb.lp ? 'body.ref.ecl' : 'body.ref.laplace'), '']);
  } else rows.push([_('body.parent'), _('body.parentRoot'), '']);
  if (S.kind === 'man' && d.j2) rows.push([_('body.j2'), nf2.format(d.j2[0] / 1e3) + '·10⁻³', ''], [_('body.req'), nf1.format(d.j2[1]), 'km']);
  return `<table class="ov binfo"><tbody>${rows.map(([l, v, u]) => `<tr><th scope="row">${esc(l)}</th><td>${esc(v)}${u ? `<em>${esc(u)}</em>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

function applyPreset(i, k) {
  const p = BODIES[k], d = simpleData(k), b = S.bodies[i];
  Object.assign(b, { key: k, name: _('body.' + k), mass: d.mass, radius: d.radius, color: p.color });
  if (S.model === 'real') { linkReal(); return; }
  if (p.parent === null) {
    // a star: becomes the fixed centre; previous centre now orbits it
    const r = S.bodies.findIndex((o, j) => j !== i && o.parent < 0);
    if (r >= 0) {
      const rb = S.bodies[r];
      rb.parent = i;
      rb.a = BODIES[rb.key].parent === k || BODIES[rb.key].parent === 'sun' ? simpleData(rb.key).a : 149598000;
    }
    b.parent = -1;
  } else if (p.parent) {
    const j = S.bodies.findIndex((o, jj) => jj !== i && o.key === p.parent);
    if (j >= 0 && S.bodies[j].parent !== i) b.parent = j;
    if (b.parent >= 0) b.a = d.a;
  }
}

function addBody(k) {
  if (S.bodies.length >= 4) return;
  if (S.model === 'real') {
    // the Sun first, then the next body whose parent is already there
    const has = key => S.bodies.some(b => b.key === key);
    const key = k || (has('sun') ? KEYS_REAL.find(q => !has(q) && has(BODIES[q].parent)) || KEYS_REAL.find(q => !has(q)) : 'sun');
    S.bodies.push(bodyFromPreset(key)); linkReal();
    openRows.add(S.bodies.length - 1);
    renderBodies(); rebuild({ fit: true });
    return;
  }
  const key = k || (S.bodies.some(b => b.key === 'sun') ? 'custom' : 'sun');
  const root = S.bodies.findIndex(b => b.parent < 0);
  S.bodies.push(bodyFromPreset(key, { parent: root >= 0 ? root : 0 }));
  const nb = S.bodies.length - 1;
  openRows.add(nb);
  applyPreset(nb, key);
  const b = S.bodies[nb], pk = BODIES[key].parent;
  // preset orbit only fits around the natural parent; otherwise pick a fitting radius
  if (b.parent >= 0 && !(pk && S.bodies[b.parent].key === pk)) b.a = defaultOrbitRadius(sysList().slice(0, nb), b.parent, b.radius * 1e3) / 1e3;
  renderBodies(); rebuild({ fit: true });
}

// insert natural parent k between body i and its current parent
function addParentFor(i, k) {
  if (S.bodies.length >= 4) return;
  if (S.model === 'real') { S.bodies.push(bodyFromPreset(k)); linkReal(); renderBodies(); rebuild({ fit: true }); return; }
  const child = S.bodies[i], P = BODIES[k];
  const nb = bodyFromPreset(k, { parent: child.parent });
  if (nb.parent >= 0) nb.a = S.bodies[nb.parent].key === P.parent ? simpleData(k).a : child.a;
  S.bodies.push(nb);
  child.parent = S.bodies.length - 1;
  child.a = simpleData(child.key).a;
  renderBodies(); rebuild({ fit: true });
}

function removeBody(i) {
  const gone = S.bodies[i];
  S.bodies.splice(i, 1);
  openRows.clear();
  if (S.model === 'real') linkReal();
  else for (const b of S.bodies) {
    if (b.parent === i) b.parent = gone.parent > i ? gone.parent - 1 : gone.parent;
    else if (b.parent > i) b.parent--;
  }
  renderBodies(); rebuild({ fit: true });
}

$('#bodies').addEventListener('change', e => {
  const card = e.target.closest('.brow'); if (!card) return;
  const i = +card.dataset.i, f = e.target.dataset.f;
  if (f === 'key' && S.kind === 'man') { setCentral(e.target.value); return; }
  if (f === 'key') { applyPreset(i, e.target.value); renderBodies(); renderFrameSeg(); rebuild({ fit: true }); }
  else if (f === 'parent') { S.bodies[i].parent = +e.target.value; renderBodies(); rebuild({ fit: true }); }
});
$('#bodies').addEventListener('input', e => {
  const card = e.target.closest('.brow'); if (!card) return;
  const i = +card.dataset.i, f = e.target.dataset.f, b = S.bodies[i];
  if (!f || f === 'key' || f === 'parent') return;
  if (f === 'name') { b.name = e.target.value || _('body.default'); renderFrameSeg(); scheduleRebuild(); return; }
  const v = parseNum(e.target.value);
  const bad = !Number.isFinite(v) || (f !== 'phase' && v <= 0);
  e.target.setAttribute('aria-invalid', bad ? 'true' : 'false');
  if (bad) return;
  b[f] = v;
  if (f === 'mass') card.querySelector('[data-hint=mass]').textContent = massHint(v);
  scheduleRebuild();
});
$('#bodies').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  if (btn.dataset.act === 'toggle') {
    const i = +btn.closest('.brow').dataset.i, open = !openRows.has(i);
    open ? openRows.add(i) : openRows.delete(i);
    btn.setAttribute('aria-expanded', String(open)); $('#brow-b' + i).hidden = !open;
    clampWins();
  }
  if (btn.dataset.act === 'remove') removeBody(+btn.closest('.brow').dataset.i);
  if (btn.dataset.act === 'addparent') addParentFor(+btn.closest('.brow').dataset.i, btn.dataset.k);
});
$('#addBody').addEventListener('click', () => addBody());

// ===================== Mission inputs =====================
const MF = ['h0', 'hB', 'hRet', 't0', 'theta', 'dv', 'dur'];
function syncMission() {
  if (S.kind === 'man') { syncMan(); return; }
  const M = S.M;
  $('#m-h0').value = +M.h0.toFixed(3); $('#m-hB').value = +M.hB.toFixed(3); $('#m-hRet').value = +M.hRet.toFixed(3);
  $('#m-t0').value = +M.t0.toFixed(4); $('#m-theta').value = +M.theta.toFixed(4); $('#m-dv').value = +M.dv.toFixed(2);
  $('#m-theta-r').value = M.theta; $('#m-dur').value = +M.duration.toFixed(2); $('#m-auto').checked = M.autoDur;
  $('#m-dur').disabled = M.autoDur;
  if (S.model === 'real') {
    const d = $('#m-date'); d.value = isoMinute(daysToUtc(M.t0)); d.setAttribute('aria-invalid', 'false');
    $('#m-beta').value = +(M.beta || 0).toFixed(4);
  }
  setSeg('#modeSeg', M.mode); setSeg('#sideSeg', String(M.side));
  $('#retWrap').hidden = M.mode !== 'free';
  // departure type: burn point (θ, β) or, for missions set up from the porkchop, the asymptote (λ∞, δ∞)
  const asym = M.dep === 'asym';
  $('#lbl-theta').textContent = _(asym ? 'ui.lam' : 'ui.theta'); $('#lbl-beta').textContent = _(asym ? 'ui.dec' : 'ui.beta');
  $('#m-theta-r').setAttribute('aria-label', _(asym ? 'ui.lamRange' : 'ui.thetaRange')); $('#m-theta').setAttribute('aria-label', _(asym ? 'ui.lamNum' : 'ui.thetaNum'));
  $('#betaWrap').title = _(asym ? 'ui.decTip' : 'ui.betaTip');
  syncAero();
}
// Aerocapture: offered in capture mode for targets with atmosphere data (js/bodies.js atm = [h_low, h_skip]);
// the pass altitude starts at h_low for each new target and is editable up to h_skip.
const tgtAtm = () => (S.bodies[1] && atmAltitudes(S.bodies[1].key)) || null; // altitudes above our radius
function syncAero() {
  const M = S.M, atm = tgtAtm(), key = S.bodies[1] && S.bodies[1].key;
  if (!atm) M.aero = false;
  else if (M.atmFor !== key || !Number.isFinite(M.hAtm)) { M.hAtm = atm[0]; M.atmFor = key; }
  $('#aeroWrap').hidden = M.mode !== 'capture' || !atm;
  $('#m-aero').checked = !!M.aero; $('#atmWrap').hidden = !M.aero;
  if (!atm) return;
  const inp = $('#m-hAtm');
  if (document.activeElement !== inp) inp.value = +M.hAtm.toFixed(3);
  const ok = M.hAtm >= 0 && M.hAtm <= atm[1] && M.hAtm < M.hB;
  inp.setAttribute('aria-invalid', String(!ok));
  const h = $('#atmHint'); h.hidden = !M.aero; h.classList.toggle('warn', !ok);
  h.textContent = _(ok ? 'ui.atmHint' : 'ui.atmBad', { top: nf0.format(atm[1]), hB: nf0.format(M.hB) });
}
$('#m-aero').addEventListener('change', e => { S.M.aero = e.target.checked; syncAero(); scheduleRebuild(); });
$('#m-hAtm').addEventListener('input', e => {
  const v = parseNum(e.target.value);
  if (!Number.isFinite(v)) { e.target.setAttribute('aria-invalid', 'true'); return; }
  S.M.hAtm = v; syncAero(); scheduleRebuild();
});
// date limits of the planet table
$('#m-date').min = `${EPHEM_YEARS[0]}-01-01T00:00`; $('#m-date').max = `${EPHEM_YEARS[1]}-12-31T23:59`;
function setDeparture(ms) {
  const d = utcToDays(ms), ok = Number.isFinite(d) && inEphem(d);
  $('#m-date').setAttribute('aria-invalid', ok ? 'false' : 'true');
  if (!ok) { setStatus(_('err.dateRange', { from: EPHEM_YEARS[0], to: EPHEM_YEARS[1] })); return; }
  S.M.t0 = d; setStatus('');
  rebuild({ resetU: true, fit: true });
}
$('#m-date').addEventListener('change', e => setDeparture(Date.parse(e.target.value + 'Z')));
$('#m-now').addEventListener('click', () => { setDeparture(Math.floor(Date.now() / 60000) * 60000); syncMission(); });
$('#m-beta').addEventListener('input', e => {
  const v = parseNum(e.target.value), bad = !Number.isFinite(v) || Math.abs(v) > 90;
  e.target.setAttribute('aria-invalid', bad ? 'true' : 'false');
  if (!bad) { S.M.beta = v; scheduleRebuild(); }
});
function setSeg(sel, v) { document.querySelectorAll(sel + ' button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false')); }
function setDvRange() {
  const c = guess && Number.isFinite(guess.dv) && guess.dv > 0 ? guess.dv : S.M.dv || 1000;
  const r = $('#m-dv-r');
  let lo = c * 0.85, hi = c * 1.15;
  if (S.M.dv < lo) lo = S.M.dv * 0.95; if (S.M.dv > hi) hi = S.M.dv * 1.05;
  r.min = Math.max(0, lo).toFixed(1); r.max = hi.toFixed(1); r.value = S.M.dv;
}
for (const [id, key] of [['m-h0', 'h0'], ['m-hB', 'hB'], ['m-hRet', 'hRet'], ['m-t0', 't0'], ['m-theta', 'theta'], ['m-dv', 'dv'], ['m-dur', 'duration']]) {
  $('#' + id).addEventListener('input', e => {
    const v = parseNum(e.target.value);
    const bad = !Number.isFinite(v) || ((key === 'dv' || key === 'duration') && v <= 0) || ((key === 'h0' || key === 'hB') && v < 0);
    e.target.setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (bad) return;
    S.M[key] = v;
    if (key === 'theta') $('#m-theta-r').value = v;
    if (key === 'dv') $('#m-dv-r').value = v;
    scheduleRebuild();
  });
}
$('#m-theta-r').addEventListener('input', e => { S.M.theta = +e.target.value; $('#m-theta').value = S.M.theta; scheduleRebuild(); });
$('#m-dv-r').addEventListener('input', e => { S.M.dv = +e.target.value; $('#m-dv').value = S.M.dv; scheduleRebuild(); });
$('#m-auto').addEventListener('change', e => { S.M.autoDur = e.target.checked; $('#m-dur').disabled = S.M.autoDur; scheduleRebuild(); });
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.M.mode = b.dataset.v; syncMission(); scheduleRebuild(); });
$('#sideSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.M.side = +b.dataset.v; syncMission(); setStatus(_('st.side')); });

// ===================== Orbit maneuver inputs =====================
// apsis names for the maneuver labels: the body's own pair when the table has both, else periapsis / apoapsis
const apsNames = k => { const a = APSIS[k]; return a && a[1] ? a : [_('apsis.generic'), _('apsis.genericApo')]; };
const cap1 = s => s[0].toLocaleUpperCase(DICT['meta.locale']) + s.slice(1);
const MVF = ['hp0', 'ha0', 'i0', 'hp1', 'e1', 'i1', 'rb', 'k', 'm0', 'md', 'isp', 'F', 'O0'];
// the engine runs: finite burns, or the spiral (always with the engine)
const mvFinite = M => M.type === 'spiral' || M.thrust === 'fin';
function syncMan() {
  const M = S.M, [pn, an] = apsNames(M.body).map(cap1), sel = $('#mv-body'), spiral = M.type === 'spiral', fin = mvFinite(M);
  if (sel.options.length !== KEYS_MV.length) sel.innerHTML = KEYS_MV.map(k => `<option value="${k}">${esc(_('body.' + k))}</option>`).join('');
  sel.value = M.body;
  for (const f of MVF) { const el = $('#mv-' + f); if (document.activeElement !== el) { el.value = +(+M[f]).toFixed(6); el.setAttribute('aria-invalid', 'false'); } }
  $('#mv-j2').checked = !!M.j2;
  $('#lbl-hp0').textContent = $('#lbl-hp1').textContent = _('mv.hp', { peri: pn });
  $('#lbl-ha0').textContent = _('mv.ha', { apo: an }); $('#lbl-rb').textContent = _('mv.rb', { apo: an });
  setSeg('#mvTypeSeg', M.type); setSeg('#mvPlaneSeg', M.plane); setSeg('#mvThrSeg', fin ? 'fin' : 'imp'); setSeg('#mvSteerSeg', M.steer);
  // the spiral has its own steering (Edelbaum), no pieces, no separate plane change, and always the engine
  $('#mvRbWrap').hidden = M.type !== 'bielliptic';
  $('#mvPlaneWrap').hidden = $('#mvKWrap').hidden = $('#mvThrSeg').hidden = spiral;
  $('#mvFWrap').hidden = !fin; $('#mvSteerWrap').hidden = !fin || spiral; $('#mvFinHint').hidden = !fin;
  const d = BODIES[M.body], Re = d.j2[1], ra = (Re + M.hp1) * (1 + M.e1) / (1 - M.e1), a = (Re + M.hp1 + ra) / 2;
  $('#mvHa').textContent = M.e1 > 0 ? _('mv.haHint', { apo: an, h: nf0.format(ra - Re), a: nf0.format(a) }) : _('mv.circHint', { a: nf0.format(a) });
  const ok = M.md > 0 && M.md < M.m0 && M.isp > 0, h = $('#mvAvail');
  h.classList.toggle('warn', !ok);
  h.textContent = ok ? _('mv.avail', { dv: nf0.format(dvAvail(M.m0, M.md, M.isp)), c: nf0.format(M.isp * G0) }) : _('mv.availBad');
  if (fin) $('#mvFinHint').textContent = _('mv.finHint', { mdot: NF(5).format(M.F / (M.isp * G0)), acc: NF(M.F / M.m0 < 0.01 ? 6 : 3).format(M.F / M.m0) });
  const sh = $('#mvSpiralHint');
  sh.hidden = !spiral;
  if (spiral) { // the averaged estimate, before the worker flies it
    const circ = M.hp0 === M.ha0 && M.e1 === 0, { o0, o1 } = mvOrbits(M, Re * 1e3);
    const e = circ ? spiralEstimate(d.gm * 1e9, o0, o1, { F: M.F, isp: M.isp, m0: M.m0 }) : null;
    sh.classList.toggle('warn', !circ);
    sh.textContent = circ ? _('mv.spiralHint', { revs: nf0.format(e.revs), days: nf1.format(e.t / DAY), dv: nf0.format(e.dv), fuel: nf0.format(e.fuel) }) : _('mv.spiralCirc', { peri: pn, apo: an });
  }
  if (S.model === 'real') { const dt = $('#m-date'); dt.value = isoMinute(daysToUtc(M.t0)); dt.setAttribute('aria-invalid', 'false'); }
}
// value checks per field (cross-field ones, like apoapsis ≥ periapsis, come back from maneuverPlan)
const MV_OK = { hp0: v => v > 0, ha0: v => v > 0, hp1: v => v > 0, rb: v => v > 0, e1: v => v >= 0 && v <= 0.99, i0: v => v >= 0 && v <= 180, i1: v => v >= 0 && v <= 180,
  k: v => Number.isInteger(v) && v >= 1 && v <= 8, m0: v => v > 0, md: v => v > 0, isp: v => v > 0, F: v => v > 0, O0: () => true };
for (const f of MVF) {
  $('#mv-' + f).addEventListener('input', e => {
    const v = parseNum(e.target.value), bad = !Number.isFinite(v) || !MV_OK[f](v);
    e.target.setAttribute('aria-invalid', String(bad));
    if (bad) return;
    S.M[f] = v; syncMan(); scheduleRebuild();
  });
}
function setCentral(k) {
  S.M.body = k; S.bodies = [bodyFromPreset(k)];
  S.scenario = ''; $('#scenario').value = ''; $('#scNote').textContent = _('sc.mv.note');
  openRows.clear(); S.follow = 'free';
  renderBodies(); syncMan(); renderFrameSeg();
  rebuild({ fit: true, resetU: true });
}
$('#mv-body').addEventListener('change', e => setCentral(e.target.value));
$('#mv-j2').addEventListener('change', e => { S.M.j2 = e.target.checked; scheduleRebuild(); });
$('#mvTypeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.M.type = b.dataset.v; syncMan(); rebuild({ fit: true, resetU: true }); });
$('#mvPlaneSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.M.plane = b.dataset.v; syncMan(); rebuild({ resetU: true }); });
$('#mvThrSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.M.thrust = b.dataset.v; syncMan(); rebuild({ resetU: true }); });
$('#mvSteerSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.M.steer = b.dataset.v; syncMan(); rebuild({}); });

let rebuildQueued = false;
function scheduleRebuild() { if (rebuildQueued) return; rebuildQueued = true; requestAnimationFrame(() => { rebuildQueued = false; rebuild({}); }); }

// ===================== Build & simulate =====================
function sysList() {
  if (S.model === 'real') return S.bodies.map(b => { const d = BODIES[b.key]; return { name: b.name, mu: d.gm * 1e9, radius: d.radius * 1e3, parent: b.parent, a: 0, orb: d.orb }; });
  return S.bodies.map(b => ({ name: b.name, mass: b.mass, radius: b.radius * 1e3, parent: b.parent, a: b.a * 1e3, phase: b.phase }));
}

function showErr(t, key = 'err.fix') { const e = $('#err'); e.textContent = t || ''; e.hidden = !t; const m = $('#msg'); m.textContent = t ? _(key, { e: t }) : ''; m.hidden = !t; }
const errText = r => _(r.error, { ...r.params, name: (r.params && r.params.name) || _('body.default') });
// Real model: the hierarchy is fixed, so name the body whose parent is missing instead of the generic error.
function realErr() {
  const seen = new Set();
  for (const b of S.bodies) { if (seen.has(b.key)) return _('err.dup', { name: b.name }); seen.add(b.key); }
  const roots = S.bodies.filter(b => b.parent < 0);
  if (roots.length < 2) return '';
  const b = roots.reduce((p, q) => depth(q.key) > depth(p.key) ? q : p);
  return _('err.realParent', { name: b.name, parent: _('body.' + BODIES[b.key].parent) });
}

// mission plane at departure: the two-body views (A, B, rotating A–B) project onto it
let PLANE = planeBasis([0, 0, 1]);
function rebuild(o = {}) {
  if (S.kind === 'man') { rebuildMan(o); return; }
  const pre = S.model === 'real' ? realErr() : '';
  const s = pre ? { error: true } : buildSystem(sysList());
  if (s.error) { showErr(pre || errText(s)); sys = null; simR = null; C = null; updateResults(); return; }
  if (!(S.M.h0 >= 0)) { showErr(_('err.parkNeg')); return; }
  showErr('');
  sys = s;
  try { guess = hohmannGuess(sys, S.M); } catch (e) { guess = null; }
  if (S.M.autoDur) {
    // a mission from the porkchop runs for its own time of flight, not the Hohmann one
    S.M.duration = autoDuration(S.M.dep === 'asym' && S.M.tof > 0 ? { tof: S.M.tof * DAY } : guess, S.M.mode);
    $('#m-dur').value = +S.M.duration.toFixed(2);
  }
  syncAero(); pcSync();
  simR = simulate(sys, S.M, { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 });
  PLANE = planeBasis(simR.normal);
  if (o.resetU) { S.u = 0; S.ext = 0; }
  buildCache();
  if (o.fit) needFit = true;
  $('#dateWarn').hidden = S.model !== 'real' || inEphem(S.M.t0);
  setDvRange(); updateResults(); renderTicks(); renderFrameSeg();
}

// Orbit maneuver: the analytic plan (core.js maneuverPlan), flown by maneuverSim in the body's equator frame; samples
// come back in ecliptic axes about the body (at the origin of the one-body system). Altitudes are measured from the
// equatorial radius (NSSDCA, the J2 reference radius), the globe and impacts use the mean radius.
// Equator frame: Earth's J2000 equator and equinox (x = γ, the frame of the textbook examples), else the IAU pole.
function eqFrame(k, t) {
  const d = BODIES[k];
  return k === 'earth' ? laplaceFrame(-90, 90) : d.pole ? equatorFrame(d.pole, t, 6) : equatorFrame(d.axis, t, 4);
}
function rebuildMan(o = {}) {
  const M = S.M, k = M.body, d = BODIES[k], t0 = M.t0 * DAY, spiral = M.type === 'spiral', fin = mvFinite(M);
  sys = buildSystem(sysList()); guess = null;
  const mu = d.gm * 1e9, R = d.radius * 1e3, Re = d.j2[1] * 1e3, rot = eqFrame(k, t0);
  const { o0, o1, opt } = mvOrbits(M, Re);
  const bad = MVF.some(f => !Number.isFinite(M[f]) || !MV_OK[f](M[f]));
  // the spiral flies no impulsive plan; its Hohmann counterpart is the comparison
  const hoh = maneuverPlan(mu, R, o0, o1, { ...opt, type: 'hohmann', plane: 'comb', k: 1 });
  const plan = bad ? { error: 'err.mvApsis' } : spiral ? (o0.ra === o0.rp && o1.ra === o1.rp ? (hoh.error ? hoh : { burns: [], nodes: [], dv: 0, tof: 0, o0, o1 }) : { error: 'err.mvSpiralCirc' })
    : maneuverPlan(mu, R, o0, o1, opt);
  if (plan.error) { mvStop(); showErr(_(plan.error), 'err.mvFix'); simR = null; C = null; MAN = null; updateResults(); renderTicks(); return; }
  showErr('');
  const c = { mu, R, J2: M.j2 ? d.j2[0] * 1e-6 : 0, Re, rot, O0: M.O0 * D2R }, prev = MAN;
  // impulsive: flown here at once (also what a finite flight shows until the worker returns); the spiral keeps the
  // previous spiral on screen meanwhile
  if (!spiral) simR = maneuverSim(c, plan, { tol: 1e-10 });
  else if (!(prev && prev.spiral && prev.res)) { simR = null; C = null; }
  // frames (ecliptic axes): the equator, the initial and the target orbit planes (x along the line of nodes ℓ)
  const ecl = u => [0, 1, 2].map(j => rot[3 * j] * u[0] + rot[3 * j + 1] * u[1] + rot[3 * j + 2] * u[2]);
  const O0 = M.O0 * D2R, L = ecl([Math.cos(O0), Math.sin(O0), 0]);
  const plane = i => { const n = ecl([Math.sin(i) * Math.sin(O0), -Math.sin(i) * Math.cos(O0), Math.cos(i)]); return { x: L, y: [n[1] * L[2] - n[2] * L[1], n[2] * L[0] - n[0] * L[2], n[0] * L[1] - n[1] * L[0]], n }; };
  const fr = { eq: { x: [rot[0], rot[3], rot[6]], y: [rot[1], rot[4], rot[7]], n: [rot[2], rot[5], rot[8]] }, p0: plane(o0.i), p1: plane(o1.i) };
  MAN = { key: k, mu, R, Re, rot, plan, hoh, o0, o1, opt, fr, j2: c.J2, spiral, fin, res: null, busy: fin, prog: 0, fit: !!o.fit || !simR };
  if (spiral && simR) MAN.res = prev.res; // shown until the new one arrives
  if (!['eq', 'p0', 'p1'].includes(S.frame)) S.frame = 'eq';
  if (o.resetU) { S.u = 0; S.ext = 0; }
  if (simR) { PLANE = planeBasis(simR.normal); buildCache(); }
  if (o.fit) needFit = true;
  $('#dateWarn').hidden = inEphem(M.t0);
  if (fin) mvStart({ c, o0, o1, opt: { ...opt, type: M.type }, fin: { F: M.F, isp: M.isp, m0: M.m0, md: M.md, steer: M.steer }, cap: MODE === 'low' ? 20000 : 60000 }, MAN);
  else mvStop();
  updateResults(); renderTicks(); renderFrameSeg(); pcSync();
}
// Finite burns and spirals fly in a worker (core.js maneuverRun); a newer job replaces a running one. Without workers
// the job runs here, after this frame.
const MVJ = { worker: null, busy: false, id: 0 };
function mvStop() { MVJ.id++; if (MVJ.busy && MVJ.worker) { MVJ.worker.terminate(); MVJ.worker = null; } MVJ.busy = false; }
function mvStart(job, man) {
  mvStop();
  const id = MVJ.id;
  const done = r => {
    if (id !== MVJ.id || MAN !== man) return;
    MVJ.busy = false; man.busy = false; setStatus('');
    if (r.error) { showErr(_(r.error, r.params), 'err.mvFix'); simR = null; C = null; man.res = null; updateResults(); renderTicks(); return; }
    man.res = r; simR = r.sim; PLANE = planeBasis(simR.normal);
    buildCache();
    if (man.fit) needFit = true;
    updateResults(); renderTicks();
  };
  const prog = p => { if (id !== MVJ.id) return; man.prog = p; setStatus(_(man.spiral ? 'st.mvSpiralBusy' : 'st.mvBusy', { p: nf0.format(p) })); if (!man.res || man.spiral) updateResults(); };
  let w = MVJ.worker;
  if (!w) { try { w = MVJ.worker = makeWorker(); } catch (e) { w = null; } }
  if (!w) { setTimeout(() => { if (id === MVJ.id) done(maneuverRun(job)); }, 0); return; }
  MVJ.busy = true;
  w.onmessage = e => { const d = e.data; if (d.p != null) prog(d.p); else done(d.done || { error: 'err.mvWorker', params: { e: d.error } }); };
  w.onerror = e => { if (MVJ.worker) MVJ.worker.terminate(); MVJ.worker = null; MVJ.busy = false; done({ error: 'err.mvWorker', params: { e: e.message || 'worker' } }); };
  w.postMessage({ mv: job });
}
// one revolution of orbit o ({ rp, ra, i }, node Ω, ω = 0) about the maneuver body: K points, ecliptic axes, m
function mvRing(o, O0, K) {
  const out = new Float64Array(3 * K), a = (o.rp + o.ra) / 2, e = (o.ra - o.rp) / (o.ra + o.rp), q = Math.sqrt(1 - e * e), rot = MAN.rot;
  const P = [Math.cos(O0), Math.sin(O0), 0], Qv = [-Math.sin(O0) * Math.cos(o.i), Math.cos(O0) * Math.cos(o.i), Math.sin(o.i)];
  for (let k = 0; k < K; k++) {
    const E = 2 * Math.PI * k / K, xo = a * (Math.cos(E) - e), yo = a * q * Math.sin(E), u = [0, 1, 2].map(j => xo * P[j] + yo * Qv[j]);
    for (let j = 0; j < 3; j++) out[3 * k + j] = rot[3 * j] * u[0] + rot[3 * j + 1] * u[1] + rot[3 * j + 2] * u[2];
  }
  return out;
}

// cubic Hermite position at fraction f of sample segment i
function herm(i, f, out) {
  const r = simR, h = r.t[i + 1] - r.t[i];
  const f2 = f * f, f3 = f2 * f;
  const h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
  out[0] = h00 * r.x[i] + h10 * h * r.vx[i] + h01 * r.x[i + 1] + h11 * h * r.vx[i + 1];
  out[1] = h00 * r.y[i] + h10 * h * r.vy[i] + h01 * r.y[i + 1] + h11 * h * r.vy[i + 1];
  out[2] = h00 * r.z[i] + h10 * h * r.vz[i] + h01 * r.z[i + 1] + h11 * h * r.vz[i + 1];
  return out;
}
function segAtTime(t) { // last i with t_i <= t, skipping zero-length segments forward
  const T = simR.t; let lo = 0, hi = T.length - 1;
  if (t <= T[0]) return 0;
  if (t >= T[hi]) return hi - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  while (lo < T.length - 2 && T[lo + 1] - T[lo] <= 0) lo++;
  return lo;
}
// velocity at fraction f of segment i: the derivative of the cubic Hermite position (consistent with herm())
function hermV(i, f, out) {
  const r = simR, h = r.t[i + 1] - r.t[i], f2 = f * f;
  const d00 = (6 * f2 - 6 * f) / h, d10 = 3 * f2 - 4 * f + 1, d01 = (-6 * f2 + 6 * f) / h, d11 = 3 * f2 - 2 * f;
  out[0] = d00 * r.x[i] + d10 * r.vx[i] + d01 * r.x[i + 1] + d11 * r.vx[i + 1];
  out[1] = d00 * r.y[i] + d10 * r.vy[i] + d01 * r.y[i + 1] + d11 * r.vy[i + 1];
  out[2] = d00 * r.z[i] + d10 * r.vz[i] + d01 * r.z[i + 1] + d11 * r.vz[i + 1];
  return out;
}
function posAtTime(t, out) {
  const i = segAtTime(t), h = simR.t[i + 1] - simR.t[i];
  if (!(h > 0)) { out[0] = simR.x[i + 1]; out[1] = simR.y[i + 1]; out[2] = simR.z[i + 1]; return out; }
  return herm(i, clamp((t - simR.t[i]) / h, 0, 1), out);
}

let SUB = Q.sub;
function buildCache() {
  // a spiral's samples are already dense (decimated in the worker): no Hermite sub-samples
  const r = simR, n = r.t.length, sub = S.kind === 'man' && MAN && MAN.spiral ? 1 : SUB;
  const px = [], py = [], pz = [], pt = [], segStart = new Int32Array(n);
  const o = [0, 0, 0];
  for (let i = 0; i < n - 1; i++) {
    segStart[i] = px.length;
    const h = r.t[i + 1] - r.t[i];
    if (!(h > 0)) continue;
    for (let k = 0; k < sub; k++) { herm(i, k / sub, o); px.push(o[0]); py.push(o[1]); pz.push(o[2]); pt.push(r.t[i] + h * k / sub); }
  }
  segStart[n - 1] = px.length; px.push(r.x[n - 1]); py.push(r.y[n - 1]); pz.push(r.z[n - 1]); pt.push(r.t[n - 1]);
  const T = r.t[n - 1] || 1;
  // after the integrated span the craft keeps orbiting analytically (C.orbit.rel: position and velocity relative to
  // body C.orbit.body, ecliptic axes, dt after T): captured, a circle about B; a maneuver, its final ellipse with the
  // secular J2 drift
  let orbit = null;
  if (S.kind === 'man') orbit = r.impact < 0 && MAN ? mvOrbit(r) : null;
  else if (r.captured && r.impact < 0) {
    states(sys, S.M.t0 * DAY + T, SP, SV);
    const rv = [r.x[n - 1] - SP[3], r.y[n - 1] - SP[4], r.z[n - 1] - SP[5]], vv = [r.vx[n - 1] - SV[3], r.vy[n - 1] - SV[4], r.vz[n - 1] - SV[5]];
    const h = [rv[1] * vv[2] - rv[2] * vv[1], rv[2] * vv[0] - rv[0] * vv[2], rv[0] * vv[1] - rv[1] * vv[0]];
    const hl = Math.hypot(...h), rr = Math.hypot(...rv), w = hl / (rr * rr), k = h.map(x => x / hl);
    const q = [k[1] * rv[2] - k[2] * rv[1], k[2] * rv[0] - k[0] * rv[2], k[0] * rv[1] - k[1] * rv[0]], ring = new Float64Array(3 * EL_RING);
    for (let j = 0; j < EL_RING; j++) { const a = 2 * Math.PI * j / EL_RING, c = Math.cos(a), s = Math.sin(a); for (let m = 0; m < 3; m++) ring[3 * j + m] = rv[m] * c + q[m] * s; }
    orbit = { body: 1, r: rr, P: 2 * Math.PI / w, ring, rel(dt, out) { // rotate r0 about the orbit normal k (r0 ⟂ k)
      const a = w * dt, c = Math.cos(a), s = Math.sin(a);
      for (let m = 0; m < 3; m++) { out[m] = rv[m] * c + q[m] * s; out[3 + m] = w * (q[m] * c - rv[m] * s); }
      return out;
    } };
  }
  const cum = new Float64Array(n);
  C = { sub, orbit, px: Float64Array.from(px), py: Float64Array.from(py), pz: Float64Array.from(pz), pt: Float64Array.from(pt), segStart, cum, T, n, fx: null, fy: null, frameKey: '' };
  // maneuvers: the initial and the target orbit as reference rings about the body (ecliptic axes)
  C.rings = S.kind === 'man' && MAN ? [{ p: mvRing(MAN.o0, S.M.O0 * D2R, Q.ellK), col: COL.dim, a: 0.5 }, { p: mvRing(MAN.o1, S.M.O0 * D2R, Q.ellK), col: COL.cyan, a: 0.55, dash: true }] : [];
  rebuildCum();
  let nodeNo = 0, lastNode = -1;
  C.markers = r.events.filter(e => e.type !== 'impact' || true).map(e => {
    const p = posAtTime(e.t, [0, 0, 0]);
    let txt = '', label = null;
    if (e.label === 'ev.mvBurn') { // maneuver burns: numbered by burn (the pieces of a split one share its number)
      if (e.node !== lastNode && !e.sep) nodeNo++;
      lastNode = e.node;
      const v = nf0.format(e.dv), di = nf2.format(Math.abs(e.di) / D2R), turn = Math.abs(e.di) > 1e-5 ? _('mk.mvTurn', { di }) : '';
      txt = (e.sep ? _('mk.mvSep', { di, v }) : _(e.pieces > 1 ? 'mk.mvPiece' : 'mk.mvBurn', { n: nodeNo, j: e.piece, k: e.pieces, v }) + turn)
        + (e.finite ? _('mk.mvFin', { t: fmtBurn(e.t1 - e.t0) }) : '');
      label = e.sep ? _('ev.mvSep') : _(e.pieces > 1 ? 'ev.mvPiece' : 'ev.mvBurn', { n: nodeNo, j: e.piece, k: e.pieces });
    } else if (e.label === 'ev.mvSpiral0') txt = _('mk.mvSpiral0', { v: nf0.format(e.dv) });
    else if (e.label === 'ev.mvSpiral1') txt = _('mk.mvSpiral1', { n: nf0.format(r.burns[0].revs) });
    else if (e.label === 'ev.fuelOut') txt = _('mk.fuelOut');
    else if (e.type === 'burn') txt = _(e.body === 0 ? 'mk.dv' : e.label === 'ev.raise' ? 'mk.raiseDv' : 'mk.capDv', { v: nf0.format(e.dv) });
    else if (e.type === 'aero') txt = _('mk.aero', { v: nf0.format(e.dv) });
    else if (e.type === 'peri') txt = (e.body === 1 ? Peri(1) : _('ev.returnPeri', { peri: peri(0) })) + ' ' + nf1.format(e.alt / 1e3) + ' km' + (e.body === 0 && e.alt < 150e3 ? _('mk.entry') : '');
    else txt = _('mk.impact', { name: S.bodies[e.body].name });
    if (label === null) label = e.type === 'peri' && !e.spiral ? (e.body === 1 ? S.bodies[1].name + ' ' + peri(1) : _('ev.returnPeri', { peri: peri(0) })) : _(e.label);
    return { ...e, label, x: p[0], y: p[1], z: p[2], txt };
  });
  // engine on (finite burns, the spiral): timeline bands; the arcs of finite burns are highlighted on the path
  C.spans = S.kind === 'man' && r.burns && r.burns.length && r.burns[0].t1 != null ? r.burns.map(b => [b.t0, b.t1, !!b.spiral]) : [];
  const idx = t => { let lo = 0, hi = C.pt.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (C.pt[m] < t) lo = m + 1; else hi = m; } return lo; };
  C.burnIdx = C.spans.filter(s => !s[2]).map(([a, b]) => [idx(a), Math.max(idx(a), idx(b) - (C.pt[idx(b)] > b ? 1 : 0))]);
}
// the thrust direction (ecliptic) at mission time t for the craft at abs, or null with the engine off
function thrustNow(t, abs) {
  const j = burnAt(t); if (j < 0) return null;
  states(sys, S.M.t0 * DAY + t, SPo, SVo);
  const i = segAtTime(t), h = simR.t[i + 1] - simR.t[i], v = h > 0 ? hermV(i, clamp((t - simR.t[i]) / h, 0, 1), [0, 0, 0]) : [simR.vx[i + 1], simR.vy[i + 1], simR.vz[i + 1]];
  const r = [abs[0] - SPo[0], abs[1] - SPo[1], abs[2] - SPo[2]], vel = [v[0] - SVo[0], v[1] - SVo[1], v[2] - SVo[2]];
  return thrustDir(j, r, vel, massAt(t));
}
// an arrow of len px from (x, y) along screen direction (dx, dy)
function arrow(x, y, dx, dy, col, len) {
  const l = Math.hypot(dx, dy); if (!(l > 1e-6)) return;
  const ux = dx / l, uy = dy / l;
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(x + ux * 5, y + uy * 5); ctx.lineTo(x + ux * len, y + uy * len); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + ux * (len + 2), y + uy * (len + 2)); ctx.lineTo(x + ux * (len - 4) - uy * 3.5, y + uy * (len - 4) + ux * 3.5); ctx.lineTo(x + ux * (len - 4) + uy * 3.5, y + uy * (len - 4) - ux * 3.5); ctx.closePath(); ctx.fill();
}
// a burn's duration: seconds, minutes and seconds, or days and hours
function fmtBurn(s) {
  if (s < 100) return nf1.format(s) + ' ' + _('unit.s');
  if (s < 7200) return Math.floor(s / 60) + ' ' + _('unit.min') + ' ' + Math.round(s % 60) + ' ' + _('unit.s');
  return fmtDur(s);
}
// engine state at mission time t: the burn on (index into simR.burns) or −1, the mass (finite flights record it)
function burnAt(t) { const b = simR && simR.m ? simR.burns : null; if (b) for (let j = 0; j < b.length; j++) if (t >= b[j].t0 && t <= b[j].t1) return j; return -1; }
function massAt(t) {
  if (!simR || !simR.m) return NaN;
  const i = segAtTime(t), h = simR.t[i + 1] - simR.t[i], f = h > 0 ? clamp((t - simR.t[i]) / h, 0, 1) : 1;
  return simR.m[i] + (simR.m[i + 1] - simR.m[i]) * f;
}
// thrust direction (ecliptic axes, unit) of burn j for the craft at r, v (relative to the body) with mass m
function thrustDir(j, r, v, m) {
  const b = simR.burns[j], st = b.steer, vl = Math.hypot(...v);
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], hl = Math.hypot(...h);
  if (st.spiral) { // Edelbaum: β from the Δv delivered so far, out of the plane with the sign of cos u
    const s = st.ve * Math.log(st.m0 / m), be = Math.atan2(st.sb, st.cb - s), sg = st.sgI * (r[0] * st.L[0] + r[1] * st.L[1] + r[2] * st.L[2] >= 0 ? 1 : -1);
    return [0, 1, 2].map(k => Math.cos(be) * v[k] / vl + Math.sin(be) * sg * h[k] / hl);
  }
  // Δv delivered so far: c·ln(m₀/m), c from the burn's own Δv and masses
  const s = b.m1 < b.m0 ? b.dv * Math.log(b.m0 / m) / Math.log(b.m0 / b.m1) : 0, p = st.psi + st.psi1 * (2 * s / st.dvRef - 1);
  if (st.inertial) return [0, 1, 2].map(k => Math.cos(p) * st.P[k] + Math.sin(p) * st.N[k]);
  return [0, 1, 2].map(k => Math.cos(p) * st.sgP * v[k] / vl + Math.sin(p) * h[k] / hl);
}
const EL_RING = 128; // points of a reference ring (the parking orbit after capture)
// the final orbit of a maneuver after the integrated span: Kepler from the end state (equator frame), with the
// secular J2 drift when J2 is on, turned into ecliptic axes
function mvOrbit(r) {
  const { mu, rot } = MAN, r0 = r.end.slice(0, 3), v0 = r.end.slice(3, 6), el = rv2el(mu, r0, v0), q = new Array(6);
  if (!(el.a > 0) || !(el.e < 1)) return null;
  const rates = MAN.j2 ? j2Rates(mu, MAN.j2, MAN.Re, el.a, el.e, el.i) : null;
  return { body: 0, r: el.a, P: 2 * Math.PI * Math.sqrt(el.a * el.a * el.a / mu), ring: null, rel(dt, out) {
    keplerStep(mu, r0, v0, dt, rates, q);
    for (let j = 0; j < 3; j++) {
      out[j] = rot[3 * j] * q[0] + rot[3 * j + 1] * q[1] + rot[3 * j + 2] * q[2];
      out[3 + j] = rot[3 * j] * q[3] + rot[3 * j + 1] * q[4] + rot[3 * j + 2] * q[5];
    }
    return out;
  } };
}
function rebuildCum() {
  if (!C) return;
  const r = simR, n = C.n, a = S.focus ? 0.22 : 1;
  for (let i = 0; i < n; i++) C.cum[i] = a * r.t[i] / C.T + (1 - a) * (n > 1 ? i / (n - 1) : 0);
}
function uToSeg(u) {
  const cum = C.cum; let lo = 0, hi = C.n - 1;
  if (u <= 0) return [0, 0];
  if (u >= 1) return [C.n - 2, 1];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= u) lo = m; else hi = m; }
  const d = cum[lo + 1] - cum[lo];
  return [lo, d > 0 ? (u - cum[lo]) / d : 1];
}
function tToU(t) {
  const i = segAtTime(t), h = simR.t[i + 1] - simR.t[i];
  const f = h > 0 ? clamp((t - simR.t[i]) / h, 0, 1) : 1;
  return C.cum[i] + f * (C.cum[i + 1] - C.cum[i]);
}
function uToT(u) { const [i, f] = uToSeg(u), h = simR.t[i + 1] - simR.t[i]; return simR.t[i] + (h > 0 ? f * h : 0); }

// ===================== Frames =====================
// 3D -> view plane. Inertial: the ecliptic (x, y). A- and B-centred: the mission plane at departure
// (PLANE: for Earth–Moon the Moon's orbit plane, so its 5° tilt does not skew the view).
// Rotating A–B: the same plane, x axis turning with the A→B direction.
const SP = new Float64Array(12), SV = new Float64Array(12);
const EX = [1, 0, 0], EY = [0, 1, 0], EZ = [0, 0, 1], RX = [1, 0, 0], RY = [0, 1, 0];
const FP = { cx: 0, cy: 0, cz: 0, X: EX, Y: EY, Z: EZ };
function frameAt(t) { // t: sim time (relative to t0)
  states(sys, S.M.t0 * DAY + t, SP, SV);
  const f = S.frame;
  if (f === 'inertial') { FP.cx = 0; FP.cy = 0; FP.cz = 0; FP.X = EX; FP.Y = EY; FP.Z = EZ; }
  else if (MAN && MAN.fr[f]) { const b = MAN.fr[f]; FP.cx = SP[0]; FP.cy = SP[1]; FP.cz = SP[2]; FP.X = b.x; FP.Y = b.y; FP.Z = b.n; } // maneuver frames
  else if (f === 'A' || f === 'B') { const k = f === 'A' ? 0 : 3; FP.cx = SP[k]; FP.cy = SP[k + 1]; FP.cz = SP[k + 2]; FP.X = PLANE.x; FP.Y = PLANE.y; FP.Z = PLANE.n; }
  else {
    const mA = sys.m[0], mB = sys.m[1], n = PLANE.n;
    FP.cx = (mA * SP[0] + mB * SP[3]) / (mA + mB); FP.cy = (mA * SP[1] + mB * SP[4]) / (mA + mB); FP.cz = (mA * SP[2] + mB * SP[5]) / (mA + mB);
    let ux = SP[3] - SP[0], uy = SP[4] - SP[1], uz = SP[5] - SP[2];
    const d = ux * n[0] + uy * n[1] + uz * n[2]; ux -= d * n[0]; uy -= d * n[1]; uz -= d * n[2];
    const l = Math.hypot(ux, uy, uz); RX[0] = ux / l; RX[1] = uy / l; RX[2] = uz / l;
    RY[0] = n[1] * RX[2] - n[2] * RX[1]; RY[1] = n[2] * RX[0] - n[0] * RX[2]; RY[2] = n[0] * RX[1] - n[1] * RX[0];
    FP.X = RX; FP.Y = RY; FP.Z = n;
  }
  return FP;
}
function tf(x, y, z, out) {
  const dx = x - FP.cx, dy = y - FP.cy, dz = z - FP.cz, X = FP.X, Y = FP.Y;
  out[0] = dx * X[0] + dy * X[1] + dz * X[2]; out[1] = dx * Y[0] + dy * Y[1] + dz * Y[2]; return out;
}
// 3D view: the same frame with its third axis Z = X × Y (the ecliptic pole, or the mission plane normal)
function tf3(x, y, z, out) {
  const dx = x - FP.cx, dy = y - FP.cy, dz = z - FP.cz, X = FP.X, Y = FP.Y, Z = FP.Z;
  out[0] = dx * X[0] + dy * X[1] + dz * X[2]; out[1] = dx * Y[0] + dy * Y[1] + dz * Y[2]; out[2] = dx * Z[0] + dy * Z[1] + dz * Z[2]; return out;
}

function frameCache() {
  const key = S.frame + '|' + C.pt.length;
  if (C.frameKey === key) return;
  C.frameKey = key;
  const n = C.pt.length; C.fx = new Float64Array(n); C.fy = new Float64Array(n);
  const o = [0, 0];
  for (let i = 0; i < n; i++) { frameAt(C.pt[i]); tf(C.px[i], C.py[i], C.pz[i], o); C.fx[i] = o[0]; C.fy[i] = o[1]; }
  const K = Q.trackK, NB = sys.N; C.tracks = [];
  for (let b = 0; b < NB; b++) C.tracks.push(new Float64Array(2 * (K + 1)));
  for (let k = 0; k <= K; k++) {
    const t = C.T * k / K; frameAt(t);
    for (let b = 0; b < NB; b++) { tf(SP[3 * b], SP[3 * b + 1], SP[3 * b + 2], o); C.tracks[b][2 * k] = o[0]; C.tracks[b][2 * k + 1] = o[1]; }
  }
  for (const m of C.markers) {
    frameAt(m.t); tf(m.x, m.y, m.z, o); m.fx = o[0]; m.fy = o[1];
    const bb = m.body || 0; tf(SP[3 * bb], SP[3 * bb + 1], SP[3 * bb + 2], o); m.bfx = o[0]; m.bfy = o[1];
  }
  // maneuvers: the reference rings in the view plane, relative to the body (the frames do not turn)
  frameAt(0);
  C.ring2 = C.rings.map(g => {
    const K = g.p.length / 3, e = new Float64Array(2 * K), X = FP.X, Y = FP.Y, p = g.p;
    for (let k = 0; k < K; k++) { e[2 * k] = p[3 * k] * X[0] + p[3 * k + 1] * X[1] + p[3 * k + 2] * X[2]; e[2 * k + 1] = p[3 * k] * Y[0] + p[3 * k + 1] * Y[1] + p[3 * k + 2] * Y[2]; }
    return e;
  });
  // real model, non-rotating views: each orbit's ellipse (relative to its parent) in the view plane
  C.ell = [];
  if (sys.real && S.frame !== 'rot') {
    frameAt(0);
    const X = FP.X, Y = FP.Y, K2 = Q.ellK;
    for (let b = 0; b < NB; b++) {
      if (!sys.orb[b]) { C.ell.push(null); continue; }
      const p = orbitPath(sys, b, S.M.t0 * DAY, K2), e = new Float64Array(2 * K2);
      for (let k = 0; k < K2; k++) {
        const x = p[3 * k], y = p[3 * k + 1], z = p[3 * k + 2];
        e[2 * k] = x * X[0] + y * X[1] + z * X[2]; e[2 * k + 1] = x * Y[0] + y * Y[1] + z * Y[2];
      }
      C.ell.push(e);
    }
  }
}

// ===================== Canvas =====================
const cv = $('#cv'), ctx = cv.getContext('2d'), stage = $('#stage');
let W = 0, H = 0, DPR = 1, stars = null;
const css = getComputedStyle(document.documentElement);
const COL = { traj: css.getPropertyValue('--traj').trim() || '#ffb547', orbit: css.getPropertyValue('--orbit').trim() || '#6b9be0', burn: css.getPropertyValue('--burn').trim() || '#ff7a52', dim: css.getPropertyValue('--dim').trim() || '#8a96ae', faint: css.getPropertyValue('--faint').trim() || '#56637d', void: css.getPropertyValue('--void').trim() || '#04060b', ink: css.getPropertyValue('--ink').trim() || '#e2e8f3', bad: css.getPropertyValue('--bad').trim() || '#ff6f6f', warn: css.getPropertyValue('--warn').trim() || '#f2c85b', accent: css.getPropertyValue('--accent').trim() || '#ffb547', solid: css.getPropertyValue('--solid').trim() || '#080c10', line: css.getPropertyValue('--line2').trim() || 'rgba(140,196,212,.28)', cyan: css.getPropertyValue('--cyan').trim() || '#9fd6e4' };

function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(1, r.width); H = Math.max(1, r.height); DPR = lowQ ? 1 : Math.min(Q.dprMax, window.devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  if (V3) V3.size(W, H, DPR);
  if (stars) skyLater(); else makeStars(); // the old sky stretches meanwhile
}
// Normal 2D background: the real sky, fixed (it does not turn with the view frame): looking down the ecliptic's south
// pole (the 2D view looks along −z, screen x = ecliptic x, y up = ecliptic y), gnomonic, 100° across the larger side;
// the Milky Way (SVS Deep Star Maps) and the bright stars (Yale BSC). Built once per size, map tier and viewer's gain,
// after both have loaded; the eye adaptation dims it when drawn (draw()).
let skyKey = '', skyTimer = 0;
const skyPx2d = () => Math.max(W, H) / 2 / Math.tan(50 * Math.PI / 180) * Math.PI / 180; // screen px per degree
function makeStars() {
  if (!Q.stars || MODE === '3d') { stars = null; skyKey = ''; return; }
  const sk = skyReady(true, skyHi(skyPx2d())); if (!sk) { stars = null; skyKey = 'wait'; return; }
  const mi = sk.milky.img, mw = mi.naturalWidth, mh = mi.naturalHeight;
  skyKey = [W, H, DPR, mw, SKYU.user].join('|');
  stars = document.createElement('canvas'); stars.width = cv.width; stars.height = cv.height;
  const g = stars.getContext('2d'), f = Math.max(W, H) / 2 / Math.tan(50 * Math.PI / 180);
  // Milky Way at css-pixel resolution: each pixel's direction -> celestial plate carrée (RA increasing to the left),
  // sampled bilinearly in linear light, dithered (no banding in the dark gradients)
  const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
  const mg = mc.getContext('2d', { willReadFrequently: true }); mg.drawImage(mi, 0, 0); const md = mg.getImageData(0, 0, mw, mh).data;
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }, srgb = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const LUT = new Float32Array(256).map((_, i) => lin(i));
  const w1 = Math.ceil(W), h1 = Math.ceil(H), c1 = document.createElement('canvas'); c1.width = w1; c1.height = h1;
  const hg = c1.getContext('2d'), im = hg.createImageData(w1, h1), ce = Math.cos(OBLIQ), se = Math.sin(OBLIQ), vd = linC(COL.void), gain = SKY_GAIN * SKYU.user;
  for (let y = 0; y < h1; y++) for (let x = 0; x < w1; x++) {
    const ex = (x + 0.5 - W / 2) / f, ey = (H / 2 - y - 0.5) / f, l = Math.hypot(ex, ey, 1);
    const e0 = ex / l, e1 = ey / l, e2 = -1 / l, q1 = ce * e1 - se * e2, q2 = se * e1 + ce * e2;
    let u = 0.5 - Math.atan2(q1, e0) / (2 * Math.PI); u -= Math.floor(u);
    const v = 0.5 - Math.asin(q2) / Math.PI, px = u * mw - 0.5, py = Math.min(mh - 1, Math.max(0, v * mh - 0.5)), x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    const a = 4 * (y0 * mw + (x0 + mw) % mw), b = 4 * (y0 * mw + (x0 + 1) % mw), dy = 4 * mw * (Math.min(mh - 1, y0 + 1) - y0), o = 4 * (y * w1 + x);
    for (let c = 0; c < 3; c++) {
      const m = (1 - fy) * ((1 - fx) * LUT[md[a + c]] + fx * LUT[md[b + c]]) + fy * ((1 - fx) * LUT[md[a + dy + c]] + fx * LUT[md[b + dy + c]]);
      im.data[o + c] = srgb(Math.min(1, vd[c] + m * gain)) + Math.random() - 0.5;
    }
    im.data[o + 3] = 255;
  }
  hg.putImageData(im, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(c1, 0, 0, w1, h1, 0, 0, w1 * DPR, h1 * DPR);
  // stars: the same brightness law as in 3D (peak from the V magnitude, brighter ones wider)
  g.scale(DPR, DPR); g.globalCompositeOperation = 'lighter';
  const S = sk.stars;
  const sg = SKYU.user;
  for (let i = 0; i < S.n; i++) {
    const dz = S.dir[3 * i + 2]; if (dz >= -0.05) continue;
    const x = W / 2 + f * S.dir[3 * i] / -dz, y = H / 2 - f * S.dir[3 * i + 1] / -dz; if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
    const p = starPeak(S.mag[i]) * sg; if (p < 0.02) continue;
    const a = Math.min(1, p), r = 0.7 * Math.min(4, Math.max(1, Math.pow(p, 0.35)));
    g.fillStyle = `rgba(${Math.round(srgb(S.col[3 * i]))},${Math.round(srgb(S.col[3 * i + 1]))},${Math.round(srgb(S.col[3 * i + 2]))},${a.toFixed(3)})`;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}
// rebuild the 2D sky a moment after its inputs changed (size, the viewer's gain)
function skyLater() { clearTimeout(skyTimer); skyTimer = setTimeout(() => { skyTimer = 0; makeStars(); }, 150); }
// the sharper Milky Way tier: where the screen magnifies the base, not after the quality drop or on touch devices
const skyHi = px => !lowQ && FX.lvl < 3 && !COARSE && skyHiNeed(px);
// Sky brightness: the viewer's gain (slider, saved) and the eye adaptation. Each frame the bodies drawn add their sunlit
// share of the screen (disc area on screen × the lit fraction of the disc seen × albedo from their colour; a ringed
// planet's rings add their own lit face) and the Sun's disc or glare adds a lot: the more light in view, the dimmer the sky, eased over time (darkening
// in ~0.5 s, brightening in ~2 s, like an eye). Looking into empty space or at a night side, the sky comes back.
const SKYU = { user: skyGainOf(readPref(LS, PREF_KEYS.sky)), adapt: 1, lit: 0 };
const ALB = {};
function skyLit(x, y, r, cosA, key, ring) {
  if (!Q.stars || !(r > 0)) return;
  const cx = Math.max(0, Math.min(W, x + r) - Math.max(0, x - r)), cy = Math.max(0, Math.min(H, y + r) - Math.max(0, y - r));
  if (!cx || !cy) return;
  if (ALB[key] == null) { const c = linC(BODIES[key] ? BODIES[key].color : '#888888'); ALB[key] = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  // the rings: about twice the disc's area, their lit face whatever the planet's phase
  SKYU.lit += Math.PI / 4 * cx * cy / (W * H) * ALB[key] * (Math.max(0, (1 + cosA) / 2) + (ring ? 1.2 : 0));
}
// the Sun in view: i = how much of its disc or glare shows, rs its radius (px): a small one dazzles a little, a large one a lot
function skySun(i, rs) { if (Q.stars) SKYU.lit += i * Math.min(0.5, 0.02 + 6 * Math.PI * rs * rs / (W * H)); }
function skyAdapt(dt) {
  const tgt = clamp(1 / (1 + 22 * SKYU.lit), 0.1, 1), tau = tgt < SKYU.adapt ? 0.5 : 2;
  SKYU.adapt += (tgt - SKYU.adapt) * (1 - Math.exp(-dt / tau)); SKYU.lit = 0;
}
const skyGain = () => SKYU.user * SKYU.adapt;
$('#tSky').value = Math.round(SKYU.user * 100);
$('#tSky').addEventListener('input', e => { SKYU.user = skyGainOf(+e.target.value / 100); writePref(LS, PREF_KEYS.sky, String(SKYU.user)); if (!is3d()) skyLater(); });
const ro = new ResizeObserver(() => {
  resize();
  $('#wins').style.setProperty('--tl-h', Math.ceil(stage.getBoundingClientRect().bottom - $('#timeline').getBoundingClientRect().top + 8) + 'px');
  clampWins(); INS = null;
});
for (const el of [stage, $('#ctrls'), $('#hudBot'), $('#wins')]) ro.observe(el);

const MARK_FONT = '500 11px "IBM Plex Mono", ui-monospace, monospace', MARK_LH = 13, MARK_WRAP = 140;
// a marker label's lines (a long one breaks at its first '·') and their widths; needs ctx.font = MARK_FONT
function markLines(m) {
  if (!m.lines) {
    const i = m.txt.indexOf('·');
    m.lines = i > 0 && ctx.measureText(m.txt).width > MARK_WRAP ? [m.txt.slice(0, i).trim(), m.txt.slice(i + 1).trim()] : [m.txt];
    m.lw = m.lines.map(t => ctx.measureText(t).width); m.tw = Math.max(...m.lw);
  }
  return m;
}
// baseline offset of a label's first line from its marker: 14 px away from the event's body (u: unit vector,
// screen y down); a label above grows upwards, so its extra lines do not cover the marker
const markBase = (uy, n) => 14 * uy + 4 + (uy > 0.3 ? 8 : 0) - (uy < -0.3 ? (n - 1) * MARK_LH : 0);
const sx = x => W / 2 + (x - cam.cx) * cam.scale;
const sy = y => H / 2 - (y - cam.cy) * cam.scale;
// the free rectangle the last fit() used: marker labels are kept inside it
let FITQ = null;
// Free area of the plot: the maximal rectangles not covered by floating windows and HUD (cached, see INS = null).
// insets() is the largest one as { l, r, t, b } in px from each edge; fit() tries them all.
let INS = null;
const freeArea = () => INS || (INS = measureFree());
const rectInsets = q => ({ l: q.x0, r: W - q.x1, t: q.y0, b: H - q.y1 });
function insets() { return rectInsets(bestRect(freeArea())); }
function measureFree() {
  const sr = stage.getBoundingClientRect(), gap = 12;
  const rel = el => { const r = el.getBoundingClientRect(); return { x0: r.left - sr.left, x1: r.right - sr.left, y0: r.top - sr.top, y1: r.bottom - sr.top }; };
  const shown = el => !el.hidden && el.getClientRects().length > 0;
  const hud = [...$('#ctrls').children, $('#readout'), $('#timeline'), $('#caption')].filter(shown).map(rel);
  const wins = floating() ? [...document.querySelectorAll('.win:not([hidden])')].map(rel) : [];
  const rects = freeRects(W, H, [...hud, ...wins], gap);
  // too little room left between the windows: let them overlap the plot instead (HUD still counts)
  const q = bestRect(rects);
  if (wins.length && (!q || q.x1 - q.x0 < Math.min(260, W * 0.35) || q.y1 - q.y0 < Math.min(180, H * 0.3))) return freeRects(W, H, hud, gap);
  return rects.length ? rects : [{ x0: 0, x1: W, y0: 0, y1: H }];
}

function fit() {
  if (is3d()) { fit3(); return; }
  if (!C || W < 50 || H < 50) return; // stage not laid out yet (hidden tab/pane): keep needFit for later
  frameCache();
  INS = null; // windows may have changed size this frame (Results after a new mission), before their observer runs
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (let i = 0; i < C.fx.length; i++) add(C.fx[i], C.fy[i]);
  for (const b of [0, 1]) { if (b >= sys.N) continue; const tr = C.tracks[b]; for (let k = 0; k < tr.length; k += 2) add(tr[k], tr[k + 1]); }
  for (const e of C.ring2) for (let k = 0; k < e.length; k += 2) add(e[k], e[k + 1]);
  const pad = Math.max(sys.R[0], sys.N > 1 ? sys.R[1] : 0) * 2;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  // marker labels stick out past the path's bounding box: their overhang (px) on each side at scale s,
  // placed as in draw() (markBase; text 10 px above the first baseline, 3 px below the last)
  ctx.font = MARK_FONT;
  const overhang = (s, uw, uh) => {
    let L = 0, R = 0, T = 0, B = 0;
    for (const m of C.markers) {
      const dx = m.fx - m.bfx, dy = m.fy - m.bfy, d = Math.hypot(dx, dy) * s;
      const ux = d < 1 ? Math.SQRT1_2 : dx * s / d, uy = d < 1 ? -Math.SQRT1_2 : -dy * s / d, { tw, lines } = markLines(m);
      const a = 14 * ux + (ux < -0.3 ? -tw : ux < 0.3 ? -tw / 2 : 0), base = (y1 - m.fy) * s + markBase(uy, lines.length);
      L = Math.max(L, -((m.fx - x0) * s + a)); R = Math.max(R, (m.fx - x1) * s + a + tw);
      T = Math.max(T, -(base - 10)); B = Math.max(B, base + 3 + (lines.length - 1) * MARK_LH - (y1 - y0) * s);
    }
    // never give labels more than 60% of the width or height (draw() keeps the rest inside the free area)
    const kx = Math.min(1, uw * 0.6 / (L + R || 1)), ky = Math.min(1, uh * 0.6 / (T + B || 1));
    return [L * kx, R * kx, T * ky, B * ky];
  };
  // scale the path plus labels into each free rectangle (twice, as the labels' share depends on the scale);
  // the one that shows it largest wins, the larger rectangle on a near tie
  let best = null;
  for (const q of freeArea()) {
    const uw = Math.max(80, q.x1 - q.x0 - 20), uh = Math.max(80, q.y1 - q.y0 - 12);
    let L = 0, R = 0, T = 0, B = 0;
    const scaleFor = () => Math.min(Math.max(40, uw - L - R) / (x1 - x0), Math.max(40, uh - T - B) / (y1 - y0)) * 0.94;
    let s = scaleFor();
    for (let j = 0; j < 2; j++) { [L, R, T, B] = overhang(s, uw, uh); s = scaleFor(); }
    const area = uw * uh;
    if (!best || s > best.s * 1.03 || (s > best.s * 0.97 && area > best.area)) best = { s, L, R, T, B, area, ...rectInsets(q) };
  }
  const { s, L, R, T, B, l, r, t, b } = best;
  cam.scale = s; FITQ = { l, r, t, b };
  cam.cx = (x0 + x1) / 2 - ((l + L - r - R) / 2) / s;
  cam.cy = (y0 + y1) / 2 + ((t + T - b - B) / 2) / s;
  needFit = false;
}
function zoomAt(px, py, k) {
  const ns = clamp(cam.scale * k, 1e-15, 0.05);
  if (MAP.on ? MAP.follow != null : S.follow !== 'free') { cam.scale = ns; return; }
  const wx = cam.cx + (px - W / 2) / cam.scale, wy = cam.cy - (py - H / 2) / cam.scale;
  cam.scale = ns; cam.cx = wx - (px - W / 2) / ns; cam.cy = wy + (py - H / 2) / ns;
}

// pointer controls: a press that stays within TAP_PX is a tap (focus a body; two quick taps zoom onto it
// or, on empty space, fit); moving further drags the view and drops the follow; wheel/pinch keep it.
// 3D: a drag turns the camera about its target and keeps the follow; a right or middle (or Shift) drag and a
// two-finger drag pan it and drop the follow, as a drag does in 2D
const ptrs = new Map(); let pinch0 = null, gest = null, lastTap = null, hoverPt = null;
const TAP_PX = { mouse: 5, touch: 10 }, HIT_PX = { mouse: 12, touch: 20 };
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (ptrs.size === 1) gest = { x0: e.offsetX, y0: e.offsetY, moved: false, multi: false, touch: e.pointerType !== 'mouse', btn: e.button, pan: e.button === 1 || e.button === 2 || e.shiftKey };
  else if (gest) gest.multi = true;
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: cam.scale, dist: cam3().dist, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, pan: 0 }; }
});
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) { hoverPt = e.pointerType === 'mouse' ? { x: e.offsetX, y: e.offsetY } : null; return; }
  let dx = e.offsetX - p.x, dy = e.offsetY - p.y; p.x = e.offsetX; p.y = e.offsetY;
  if (ptrs.size === 1) {
    if (!gest || gest.multi) return; // the finger left over from a pinch does not pan
    if (!gest.moved) {
      dx = e.offsetX - gest.x0; dy = e.offsetY - gest.y0;
      if (Math.hypot(dx, dy) < TAP_PX[gest.touch ? 'touch' : 'mouse']) return;
      gest.moved = true; cv.classList.add('drag'); hoverPt = null;
      if (!is3d() || gest.pan) unfollow();
    }
    if (!is3d()) { cam.cx -= dx / cam.scale; cam.cy += dy / cam.scale; }
    else if (gest.pan) pan3(dx, dy); else rot3(dx, dy);
  } else if (ptrs.size === 2 && pinch0) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (!is3d()) { zoomAt(mx, my, (pinch0.s * d / pinch0.d) / cam.scale); return; }
    zoom3(mx, my, (pinch0.dist * pinch0.d / Math.max(1, d)) / cam3().dist);
    // the two fingers moving together pan, once past twice the tap distance
    const pdx = mx - pinch0.mx, pdy = my - pinch0.my; pinch0.mx = mx; pinch0.my = my;
    if (pinch0.pan < 2 * TAP_PX.touch) { pinch0.pan += Math.hypot(pdx, pdy); if (pinch0.pan >= 2 * TAP_PX.touch) unfollow(); }
    else pan3(pdx, pdy);
  }
});
const endPtr = e => {
  if (!ptrs.delete(e.pointerId)) return;
  if (ptrs.size < 2) pinch0 = null;
  if (ptrs.size) return;
  cv.classList.remove('drag');
  const g = gest; gest = null;
  if (e.type === 'pointerup' && g && !g.moved && !g.multi && g.btn === 0) tap(e.offsetX, e.offsetY, g.touch);
};
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hoverPt = null; });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  if (is3d()) zoom3(e.offsetX, e.offsetY, Math.exp(e.deltaY * 0.0015)); else zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
function tap(x, y, touch) {
  const h = hitAt(x, y, HIT_PX[touch ? 'touch' : 'mouse']), now = performance.now();
  const dbl = lastTap && now - lastTap.t < 350 && Math.hypot(x - lastTap.x, y - lastTap.y) < 24;
  // the first tap re-centres the body it hit, so the second one acts on that body, not on where it landed
  const tgt = dbl && lastTap.h ? lastTap.h : h;
  lastTap = dbl ? null : { t: now, x, y, h };
  if (tgt) focusHit(tgt, dbl);
  else if (dbl) { if (MAP.on) fitMap(); else { S.follow = 'free'; renderFrameSeg(); fit(); } }
}

// ===================== Picking & focus =====================
// screen positions of the bodies (and the craft) drawn in the current frame: kind 'b' mission body,
// 'c' craft, 'm' map body; id is the body index in sys or mapSys
let HITS = [], hoverHit = null, focusTxt = null;
const addHit = (kind, id, x, y, r) => { HITS.push({ kind, id, x, y, r }); };
// the target nearest the pointer among those whose (enlarged) disc contains it
function hitAt(px, py, minR) {
  let best = null, bd = Infinity;
  for (const h of HITS) { const d = Math.hypot(px - h.x, py - h.y); if (d <= Math.max(minR, h.r + 4) && d < bd) { bd = d; best = h; } }
  return best;
}
// single tap: follow at the current scale; double tap: also zoom onto the body's moons or its SOI
function focusHit(h, zoom) {
  if (h.kind === 'm') {
    if (zoom) mapCenter(MAPK[h.id]);
    MAP.needFit = false; MAP.follow = h.id;
  } else {
    S.follow = h.kind === 'c' ? 'craft' : h.id === 0 ? 'A' : h.id === 1 ? 'B' : 'b' + h.id;
    renderFrameSeg();
    if (zoom && h.kind === 'b') followZoom(h.id);
  }
}
// drop the follow of the current view; the camera stays where it is
function unfollow() {
  if (MAP.on) MAP.follow = null;
  else if (S.follow !== 'free') { S.follow = 'free'; renderFrameSeg(); }
}
$('#focusOff').addEventListener('click', unfollow);
function focusName() {
  if (MAP.on) return MAP.follow == null ? '' : _('body.' + MAPK[MAP.follow]);
  if (S.follow === 'free') return '';
  if (S.follow === 'craft') return _('fo.craft');
  const b = S.bodies[S.follow === 'A' ? 0 : S.follow === 'B' ? 1 : +S.follow.slice(1)];
  return b ? b.name : '';
}
// end of a frame: HUD focus tag, hover cursor and ring (rings are plain in the low-resource mode)
function frameEnd() {
  setCaption();
  const n = focusName();
  if (n !== focusTxt) { focusTxt = n; $('#focusName').textContent = n; $('#focusTag').hidden = !n; }
  const h = hoverPt && !ptrs.size ? hitAt(hoverPt.x, hoverPt.y, HIT_PX.mouse) : null;
  if (!!h !== !!hoverHit) cv.classList.toggle('hot', !!h);
  hoverHit = h;
  if (!h) return;
  const r = Math.max(h.kind === 'c' ? 8 : 6, h.r + 5);
  ctx.strokeStyle = hexA(COL.ink, 0.85); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, 6.2832); ctx.stroke();
  if (Q.glow) { ctx.strokeStyle = hexA(COL.ink, 0.22); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(h.x, h.y, r + 3, 0, 6.2832); ctx.stroke(); }
}

// ===================== HUD controls =====================
function renderFrameSeg() {
  $('#lbl-hB').textContent = _('m.target', { peri: peri(1) }); $('#lbl-hRet').textContent = _('m.return', { peri: peri(0) });
  const A = S.bodies[0] ? S.bodies[0].name : 'A', B = S.bodies[1] ? S.bodies[1].name : 'B', man = S.kind === 'man';
  const fr = man ? [['eq', _('fr.eq', { name: A })], ['p0', _('fr.p0')], ['p1', _('fr.p1')]]
    : [['inertial', _('fr.inertial')], ['A', _('fr.centered', { name: A })], ['B', _('fr.centered', { name: B })], ['rot', _('fr.rot', { a: A, b: B })]];
  $('#frameSeg').innerHTML = fr.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${S.frame === v}">${esc(l)}</button>`).join('');
  const fo = [['free', _('fo.free')], ['craft', _('fo.craft')], ['A', A], ...(man ? [] : [['B', B]])];
  $('#followSeg').innerHTML = fo.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${S.follow === v}">${esc(l)}</button>`).join('');
}
$('#frameSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.frame = b.dataset.v; renderFrameSeg(); if (S.follow === 'free') needFit = true; });
$('#followSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; S.follow = b.dataset.v; renderFrameSeg();
  if (S.follow === 'A' || S.follow === 'B') followZoom(S.follow === 'A' ? 0 : 1);
  if (S.follow === 'free') needFit = true;
});
// zoom onto body k of the mission: its moons in the mission, else its SOI (at most 45 radii)
function followZoom(k) {
  if (is3d()) { followZoom3(k); return; }
  if (!sys || !(k < sys.N)) return;
  let rad = Math.min(sys.soi[k], 45 * sys.R[k]), moons = 0;
  for (let b = 0; b < sys.N; b++) if (sys.parent[b] === k) moons = Math.max(moons, 1.25 * sys.a[b]);
  if (moons) rad = moons;
  const { l, r, t, b } = insets(); cam.scale = Math.min(W - l - r, H - t - b) * 0.42 / rad;
}
// follow mission body i: A and B through the follow buttons, extra bodies as 'b<i>'
function followBody(i) {
  S.follow = i === 0 ? 'A' : i === 1 ? 'B' : 'b' + i;
  renderFrameSeg(); followZoom(i);
}
$('#fit').addEventListener('click', () => { if (MAP.on) { fitMap(); return; } S.follow = 'free'; renderFrameSeg(); fit(); });
$('#tSoi').addEventListener('change', e => { S.soi = e.target.checked; });
$('#tTracks').addEventListener('change', e => { S.tracks = e.target.checked; });

// ===================== Timeline =====================
const playSvg = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>';
const pauseSvg = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1" fill="currentColor"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="1" fill="currentColor"/></svg>';
function setPlayIcon() { const b = $('#play'); b.innerHTML = S.playing ? pauseSvg : playSvg; b.setAttribute('aria-label', _(S.playing ? 'play.pause' : 'play.play')); }
$('#play').addEventListener('click', () => { if (!S.playing && S.u >= 1 && !(C && C.orbit && !S.loop)) { S.u = 0; S.ext = 0; } S.playing = !S.playing; setPlayIcon(); });
$('#loop').addEventListener('change', e => { S.loop = e.target.checked; });
let scrubbing = false;
const scrub = $('#scrub');
scrub.addEventListener('input', () => { S.u = +scrub.value / 10000; S.ext = 0; });
scrub.addEventListener('pointerdown', () => { scrubbing = true; });
window.addEventListener('pointerup', () => { scrubbing = false; });
// "r<seconds>" values play in real time (simulated seconds per second); the others scale the whole mission
$('#speed').addEventListener('change', e => { const v = e.target.value; S.rate = v[0] === 'r' ? +v.slice(1) : 0; if (!S.rate) S.speed = +v; });
$('#focus').addEventListener('change', e => { S.focus = e.target.checked; rebuildCum(); renderTicks(); });
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(document.activeElement.tagName)) { e.preventDefault(); $('#play').click(); }
});
function renderTicks() {
  const box = $('#ticks'); if (!C) { box.innerHTML = ''; return; }
  box.innerHTML = (C.spans || []).map(([a, b]) => { const u0 = tToU(a) * 100, u1 = tToU(b) * 100; return `<span class="band" style="left:${u0.toFixed(3)}%;width:${Math.max(0.4, u1 - u0).toFixed(3)}%"></span>`; }).join('') + C.markers.map(m => `<button type="button" class="tick ${m.type}" style="left:${(tToU(m.t) * 100).toFixed(3)}%" title="${esc(_('tick.title', { label: m.label, t: fmtDur(m.t) }))}" aria-label="${esc(m.label)}" data-t="${m.t}"></button>`).join('');
  $('#tend').textContent = '/ ' + fmtDur(C.T);
}
$('#ticks').addEventListener('click', e => { const b = e.target.closest('.tick'); if (!b) return; S.u = tToU(+b.dataset.t); });

// ===================== Results =====================
const resRows = rows => rows.map(([l, v, u]) => v == null ? `<tr class="sec"><th scope="rowgroup" colspan="2">${esc(l)}</th></tr>`
  : `<tr><th scope="row">${esc(l)}</th><td>${v}${u ? `<em>${esc(u)}</em>` : ''}</td></tr>`).join('');
// Orbit maneuver: the analytic plan (per burn, its plane-change share; total, time, propellant, comparisons), what the
// integration flew and reached, and the secular J2 rates of the final orbit.
function updateResultsMan() {
  const chip = $('#chip'), res = $('#res'), M = S.M, busy = MAN && MAN.busy;
  if (!MAN || (!simR && !busy)) { chip.className = 'chip bad'; chip.textContent = _('res.fail'); res.innerHTML = ''; return; }
  const p = MAN.plan, r = simR, [pn, an] = apsNames(MAN.key), km = v => nf1.format(v / 1e3), deg = v => nf2.format(v / D2R), o1 = MAN.o1;
  const sgn = v => (v >= 0 ? '+' : '−') + nf1.format(Math.abs(v)), cur = MAN.res && !(busy && MAN.spiral) ? MAN.res : null;
  const rows = [];
  // where a burn is: an apsis of the orbit before it (else of the one after it; else a circle)
  const where = n => {
    for (const a of [n.a1, n.a2]) { const o = 2 * a - n.r; if (Math.abs(o - n.r) > 1e-9 * n.r) return n.r < o ? pn : an; }
    return _('res.mvCircle');
  };
  if (MAN.spiral) { // the spiral: revolutions, time, Δv against Edelbaum and the impulsive Hohmann, propellant
    rows.push([_('res.sec.mvSpiral', { F: NF(M.F < 1 ? 2 : 0).format(M.F), isp: nf0.format(M.isp) })]);
    if (!cur) rows.push([_('res.mvFinBusy'), nf0.format(MAN.prog) + ' %', '']);
    else {
      const b = r.burns[0], est = r.est, hd = MAN.hoh.dv;
      rows.push([_('res.mvRevs'), nf0.format(b.revs), _('res.mvRevsUnit', { est: nf0.format(est.revs) })]);
      rows.push([_('res.mvSpiralTime'), fmtDur(b.t1), '']);
      rows.push([_('res.mvSpiralDv'), nf1.format(b.dv), _('res.mvSpiralDvUnit', { edel: nf1.format(est.dv) })]);
      rows.push([_('res.mvSpiralHoh'), nf1.format(hd), _('res.mvCmpUnit', { d: sgn(hd - b.dv) })]);
      rows.push([_('res.mvSpiralFuel'), nf1.format(r.fuel), _('res.mvSpiralFuelUnit', { imp: nf1.format(propMass(M.m0, hd, M.isp)) })]);
      rows.push([_('res.mvLeft'), nf1.format(M.m0 - r.fuel), 'kg']);
      if (r.fuelOut) rows.push([_('res.mvNote'), esc(_('res.mvFuelOut', { t: fmtDur(b.t1) })), '']);
    }
  } else { // the impulsive plan: per burn, total, time, propellant, comparisons
    rows.push([_('res.sec.mvPlan')]);
    let no = 0;
    for (const n of p.nodes) {
      const l = n.sep ? _('res.mvSepRow', { where: where(n) }) : _('res.mvBurn', { n: ++no, where: where(n) });
      rows.push([l, nf1.format(n.dv), 'm/s' + (n.di > 1e-7 ? _('res.mvTurn', { di: deg(n.di) }) : '') + (M.k > 1 ? _('res.mvPieces', { k: M.k }) : '')]);
    }
    rows.push([_('res.mvTot'), nf1.format(p.dv), 'm/s']);
    if (p.burns.length > 1) rows.push([_('res.mvTof'), fmtDur(p.tof), '']);
    const avail = dvAvail(M.m0, M.md, M.isp), prop = propMass(M.m0, p.dv, M.isp), unit = _('res.mvPropUnit', { m0: nf0.format(M.m0), isp: nf0.format(M.isp) });
    if (p.dv <= avail) { rows.push([_('res.mvProp'), nf1.format(prop), unit]); rows.push([_('res.mvLeft'), nf1.format(M.m0 - prop), 'kg']); }
    else rows.push([_('res.mvProp'), '—', _('res.mvShort', { dv: nf0.format(avail) })]);
    // the same transfer with the other plane-change option, and the bi-elliptic one against Hohmann
    const alt = opt => { const q = maneuverPlan(MAN.mu, MAN.R, MAN.o0, o1, { ...MAN.opt, ...opt }); return q.error ? null : q.dv; };
    const cmp = (l, v) => { if (v != null) rows.push([l, nf1.format(v), _('res.mvCmpUnit', { d: sgn(v - p.dv) })]); };
    if (Math.abs(o1.i - MAN.o0.i) > 1e-9) { const other = M.plane === 'sep' ? 'comb' : 'sep'; cmp(_('res.mvCmpPlane', { mode: _('mv.plane.' + other) }), alt({ plane: other })); }
    if (M.type === 'bielliptic') cmp(_('res.mvCmpHoh'), alt({ type: 'hohmann' }));
    if (MAN.fin) { // the engine: per burn duration, Δv, propellant, arc; totals; the difference from the impulsive flight
      rows.push([_('res.sec.mvFin', { F: NF(M.F < 1 ? 2 : 0).format(M.F), isp: nf0.format(M.isp) })]);
      if (!cur) rows.push([_('res.mvFinBusy'), nf0.format(MAN.prog) + ' %', '']);
      else {
        const s = cur.sim;
        let k = 0, last = -1, maxArc = 0;
        for (const b of s.burns) {
          const n = p.nodes[b.node]; if (b.node !== last && !b.sep) k++; last = b.node;
          const l = (b.sep ? _('res.mvSepRow', { where: where(n) }) : _('res.mvBurn', { n: k, where: where(n) })) + (b.pieces > 1 ? ` · ${b.piece}/${b.pieces}` : '');
          rows.push([l, fmtBurn(b.t1 - b.t0), _('res.mvFinUnit', { dv: nf1.format(b.dv), fuel: nf1.format(b.m0 - b.m1), arc: nf1.format(b.arc / D2R) }).slice(3)]);
          maxArc = Math.max(maxArc, b.arc);
        }
        rows.push([_('res.mvBurnTime'), fmtBurn(s.burns.reduce((a, b) => a + b.t1 - b.t0, 0)), '']);
        rows.push([_('res.mvFinDv'), nf1.format(s.dvFin), _('res.mvFinDvUnit')]);
        rows.push([_('res.mvFinFuel'), nf1.format(s.fuel), _('res.mvFinFuelUnit', { imp: nf1.format(s.fuelImp) })]);
        rows.push([_('res.mvLoss'), sgn(s.loss), _('res.mvLossUnit', { pct: nf2.format(100 * s.loss / Math.max(1e-9, s.dvImp)), fuel: sgn(s.fuel - s.fuelImp) })]);
        if (s.trim > 0.05) {
          rows.push([_('res.mvTrim'), nf1.format(s.trim), _('res.mvTrimUnit')]);
          rows.push([_('res.mvLossTot'), sgn(s.lossTot), _('res.mvLossTotUnit')]);
        }
        if (maxArc > Math.PI / 3) { // over 60°: the warning, and what splitting would save
          rows.push([_('res.mvArcWarn'), esc(_('res.mvArcWarnText', { arc: nf0.format(maxArc / D2R) })), '']);
          if (cur.split) rows.push([_('res.mvSplit'), cur.split.map(q => q.error || !q.ok ? '—' : nf1.format(q.lossTot)).join(' / '), _('res.mvSplitUnit')]);
        }
        if (s.fuelOut) rows.push([_('res.mvNote'), esc(_('res.mvFuelOut', { t: fmtDur(s.burns[s.burns.length - 1].t1) })), '']);
      }
    }
  }
  // what the integration flew and reached
  let cls = 'good', txt = _('chip.mvDone');
  if (r) {
    const fin = r.done || rv2el(MAN.mu, r.end.slice(0, 3), r.end.slice(3));
    const dev = Math.max(Math.abs(fin.rp - o1.rp), Math.abs(fin.ra - o1.ra)), dI = Math.abs(fin.i - o1.i);
    // with J2 the elements right after the last burn are osculating: within the short-period swing (≈ 3·J2·Re²/a in
    // radius, 3·J2·(Re/a)² in inclination) the target counts as reached
    const a1 = (o1.rp + o1.ra) / 2, swing = MAN.j2 ? 3 * MAN.j2 * MAN.Re * MAN.Re / a1 : 1e3, swingI = MAN.j2 ? 3 * MAN.j2 * (MAN.Re / a1) ** 2 : 1e-4;
    txt = _(MAN.j2 && dev > 1e3 ? 'chip.mvDoneJ2' : 'chip.mvDone', { d: fmtDist(dev) });
    if (r.impact >= 0) { cls = 'bad'; txt = _('chip.impact', { name: S.bodies[0].name }); }
    else if (r.fuelOut) { cls = 'bad'; txt = _('chip.mvFuel'); }
    else if (!r.ok) { cls = 'bad'; txt = _('chip.mvFail'); }
    else if (!p.burns.length && !MAN.spiral) { cls = 'warn'; txt = _('chip.mvNone'); }
    else if (dev > Math.max(1e3, swing) || dI > Math.max(1e-4, swingI)) { cls = 'warn'; txt = _('chip.mvOff', { d: fmtDist(dev) }); }
    rows.push([_('res.sec.mvSim')]);
    if (r.burns.length) rows.push([_('res.mvFlown'), nf1.format(r.burns.reduce((a, b) => a + b.dv, 0)), _('res.mvFlownUnit')]);
    rows.push([_('res.mvFinal'), km(fin.rp - MAN.Re) + ' × ' + km(fin.ra - MAN.Re), _('res.mvFinalUnit', { peri: pn, apo: an })]);
    rows.push([_('res.mvFinalI'), deg(fin.i), '°']);
    rows.push([_('res.mvErr'), km(fin.rp - o1.rp) + ' / ' + km(fin.ra - o1.ra), _('res.mvErrUnit', { peri: pn, apo: an, di: nf3.format((fin.i - o1.i) / D2R) })]);
    rows.push([_('res.mvPeriod'), fmtPeriod(2 * Math.PI * Math.sqrt(fin.a ** 3 / MAN.mu)), '']);
    rows.push([_('res.integration'), nf0.format(r.steps), _('res.steps')]);
    if (MAN.j2) {
      const q = j2Rates(MAN.mu, MAN.j2, MAN.Re, fin.a, fin.e, fin.i), dd = v => (v >= 0 ? '+' : '−') + nf3.format(Math.abs(v / D2R * DAY));
      rows.push([_('res.sec.mvJ2')]);
      rows.push([_('res.mvNode'), dd(q.dO), _('res.degDay')]);
      rows.push([_('res.mvApse'), dd(q.dw), _('res.degDay')]);
      const notes = [];
      if (MAN.key === 'earth' && Math.abs(q.dO / D2R * DAY - 360 / 365.2421897) < 0.02) notes.push(_('res.mvSSO'));
      if (fin.e > 1e-3 && Math.abs(q.dw / D2R * DAY) < 0.02) notes.push(_('res.mvCrit'));
      notes.push(_('res.mvOsc'));
      for (const t of notes) rows.push([_('res.mvNote'), esc(t), '']);
    }
  }
  if (busy) { cls = 'warn'; txt = _('chip.mvBusy', { p: nf0.format(MAN.prog) }); }
  chip.className = 'chip ' + cls; chip.textContent = txt;
  res.innerHTML = resRows(rows);
}
function updateResults() {
  if (S.kind === 'man') { updateResultsMan(); return; }
  const chip = $('#chip'), res = $('#res');
  if (!simR || !sys) { chip.className = 'chip bad'; chip.textContent = _('res.fail'); res.innerHTML = ''; return; }
  const r = simR, A = S.bodies[0].name, B = S.bodies[1].name, M = S.M;
  let cls = 'warn', txt;
  if (r.impact >= 0) { cls = 'bad'; txt = _('chip.impact', { name: S.bodies[r.impact].name }); }
  else if (M.mode === 'capture' && r.captured) { cls = 'good'; txt = _('chip.captured', { name: B }); }
  else if (M.mode === 'free' && r.aRet) { cls = 'good'; txt = _('chip.freeDone'); }
  else if (M.mode === 'free' && r.bPeri) { txt = _('chip.noReturn', { name: B }); }
  else if (r.bPeri) { cls = 'good'; txt = _('chip.flyby', { name: B }); }
  else txt = _('chip.missed', { name: B, d: fmtDist(r.dmin[1] - sys.R[1]) });
  chip.className = 'chip ' + cls; chip.textContent = txt;
  const rows = [];
  const dv2 = r.captured ? r.captured.dv : 0;
  const vdep = r.vc + M.dv, c3 = (vdep * vdep - 2 * sys.mu[0] / r.r0) / 1e6;
  const real = S.model === 'real';
  if (real) rows.push([_('res.depDate'), esc(fmtDate(dateAt(0))), '']);
  rows.push([_('res.dv'), nf1.format(M.dv), 'm/s']);
  if (M.dep === 'asym') rows.push([_('res.asym'), nf2.format(M.theta) + ' / ' + nf2.format(real ? M.beta || 0 : 0), _('res.asymUnit')]);
  else if (real && M.beta) rows.push([_('res.beta'), nf2.format(M.beta), '°']);
  if (c3 > 0) rows.push([_('res.vinfDep'), nf3.format(Math.sqrt(c3)), 'km/s']);
  rows.push([_('res.c3', { name: A }), nf2.format(c3), 'km²/s²']);
  if (M.mode === 'capture' && r.aero) {
    rows.push([_('res.aero'), nf0.format(r.aero.dv), _('res.aeroUnit')]);
    rows.push([_('res.raiseDv'), r.captured ? nf1.format(dv2) : '—', 'm/s']);
  } else if (M.mode === 'capture') rows.push([_('res.capDv'), r.captured ? nf1.format(dv2) : '—', 'm/s']);
  if (M.mode === 'capture') rows.push([_('res.totDv'), nf1.format(M.dv + dv2), 'm/s']);
  if (r.bPeri) {
    rows.push([_('res.arrival', { name: B }), fmtDur(r.bPeri.t), '']);
    if (real) rows.push([_('res.arrDate', { name: B }), esc(fmtDate(dateAt(r.bPeri.t))), '']);
    rows.push([_('res.periAlt', { peri: Peri(1) }), nf1.format((r.bPeri.d - sys.R[1]) / 1e3), 'km · ' + _(r.bPeri.dir > 0 ? 'res.pro' : 'res.retro')]);
    const vinf2 = r.bPeri.v * r.bPeri.v - 2 * sys.mu[1] / r.bPeri.d;
    rows.push([_('res.periSpeed', { peri: Peri(1) }), nf3.format(r.bPeri.v / 1e3), 'km/s']);
    rows.push([_('res.vinf', { name: B }), vinf2 > 0 ? nf3.format(Math.sqrt(vinf2) / 1e3) : _('res.bound'), vinf2 > 0 ? 'km/s' : '']);
  } else {
    rows.push([_('res.closest'), fmtDist(r.dmin[1] - sys.R[1]), _('res.altUnit')]);
    rows.push([_('res.time'), fmtDur(r.tmin[1]), '']);
  }
  if (M.mode === 'free') rows.push([_('res.retPeri', { peri: peri(0) }), r.aRet ? nf1.format((r.aRet.d - sys.R[0]) / 1e3) : '—', r.aRet ? 'km · ' + _('hud.tplus', { t: fmtDur(r.aRet.t) }) : _('res.noReturn')]);
  if (guess && Number.isFinite(guess.dv)) rows.push([_('res.hohmann'), nf1.format(guess.dv), _('res.hohmannUnit', { days: nf1.format(guess.tof / DAY) })]);
  rows.push([_('res.integration'), nf0.format(r.steps), _('res.steps')]);
  // sibling transfers: the patched-conic (Lambert) estimate for the same departure and arrival times; the plane
  // change is part of its Δv, shown as information only
  const tArr = r.bPeri ? r.bPeri.t : M.dep === 'asym' && M.tof > 0 ? M.tof * DAY : r.tmin[1];
  const tr = isSibling(sys) && tArr > 0 ? lambertTransfer(sys, M.t0 * DAY, tArr, M) : null;
  if (tr) {
    rows.push([_('res.sec.lambert')]);
    rows.push([_('res.lambert'), nf1.format(tr.dv), _('res.lambertUnit', { type: tr.type === 1 ? 'I' : 'II' })]);
    rows.push([_('res.incl'), nf2.format(tr.incl), _('res.inclUnit', { name: A })]);
    rows.push([_('res.dec'), nf2.format(tr.dec), '°']);
    rows.push([_('res.oop'), nf0.format(tr.oop), _('res.oopUnit')]);
    if (tr.vEntry) rows.push([_('res.vEntry'), nf3.format(tr.vEntry / 1e3), 'km/s']);
  }
  res.innerHTML = resRows(rows);
}
// the overview window repeats the mission status, so picks and solver progress show where the user clicked
function setStatus(t) { $('#status').textContent = t; $('#ovStatus').textContent = t; }

// ===================== Hohmann & Solver =====================
// Apply the patched-conic guess to the mission; returns the status text (without its tail) or null.
function applyHohmann() {
  let g;
  try { g = hohmannGuess(sys, S.M); } catch (e) { return null; }
  if (!Number.isFinite(g.dv)) return null;
  Object.assign(S.M, { dep: 'burn', tof: 0, theta: g.theta, dv: g.dv, t0: g.t0, beta: 0 });
  syncMission(); rebuild({ resetU: true, fit: true });
  const when = g.case !== 'sibling' ? '' : S.model === 'real' ? _('st.hohmannDate', { date: fmtDate(daysToUtc(g.t0)) }) : _('st.hohmannT0', { t0: nf1.format(g.t0) });
  return _('st.hohmann', { dv: nf1.format(g.dv), days: nf2.format(g.tof / DAY) }) + when;
}
$('#hohmann').addEventListener('click', () => {
  if (!sys) return;
  const st = applyHohmann();
  setStatus(st ? st + _('st.hohmannTail') : _('st.noHohmann'));
});
$('#solve').addEventListener('click', solve);
// Solver runs in a Web Worker so the animation never stalls; falls back to the main thread.
let solverWorker = null, rejectSolve = null;
// The same worker code serves the porkchop grid (pc: grid spec; progress = rows done).
const WORKER_BODY = `
onmessage = async (e) => {
  const { list, M, opt, pc, mv } = e.data;
  if (mv) { try { postMessage({ done: maneuverRun(mv, p => postMessage({ p })) }); } catch (err) { postMessage({ error: String(err) }); } return; }
  try {
    const s = buildSystem(list);
    if (pc) { const g = porkchop(s, M, { ...pc, onRow: j => { if (j % 8 === 0) postMessage({ p: j }); } }); postMessage({ done: g }, [g.dv.buffer, g.c3.buffer, g.va.buffer]); return; }
    const r = await (opt.refine ? refineSeed : optimize)(s, M, { ...opt, onProgress: n => postMessage({ p: n }) }); postMessage({ done: r });
  }
  catch (err) { postMessage({ error: String(err) }); }
};`;
function makeWorker() {
  const el = document.getElementById('core');
  // Site build: core.js is a separate file -> load it into the worker by absolute URL.
  if (el && el.src) return new Worker(URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(el.src)});` + WORKER_BODY], { type: 'text/javascript' })));
  // Single-file build: core is inlined in the page.
  return new Worker(URL.createObjectURL(new Blob([el.textContent + WORKER_BODY], { type: 'text/javascript' })));
}
function runSolver(list, M, opt, prog, sysLocal) {
  let w = null;
  try { w = makeWorker(); } catch (e) { w = null; }
  if (!w) return (opt.refine ? refineSeed : optimize)(sysLocal, M, { ...opt, onProgress: prog, cancelled: () => cancelSolve });
  solverWorker = w;
  return new Promise((res, rej) => {
    rejectSolve = rej;
    w.onmessage = e => { const d = e.data; if (d.p != null) prog(d.p); else { w.terminate(); solverWorker = null; d.done ? res(d.done) : rej(d.error); } };
    w.onerror = e => { w.terminate(); solverWorker = null; rej(e.message || 'worker'); };
    w.postMessage({ list, M, opt });
  });
}

async function solve() {
  const btn = $('#solve');
  if (solving) { cancelSolve = true; if (solverWorker) { solverWorker.terminate(); solverWorker = null; rejectSolve && rejectSolve('cancel'); } return; }
  if (!sys) return;
  solving = true; cancelSolve = false;
  btn.textContent = _('ui.stop'); btn.classList.add('busy');
  const s2 = buildSystem(sysList());
  // a mission from the porkchop keeps its date and time of flight: Lambert seed, then N-body refinement;
  // anything else starts from the Hohmann guess
  const seed = S.M.dep === 'asym' && S.M.tof > 0 ? lambertSeed(s2, S.M.t0 * DAY, S.M.tof * DAY, S.M) : null;
  let M0, opt;
  if (seed) {
    M0 = { ...S.M, dep: 'asym', theta: seed.theta, beta: seed.beta, dv: seed.dv, t0: seed.t0, tof: seed.tof };
    if (M0.autoDur) M0.duration = autoDuration({ tof: seed.tof * DAY }, M0.mode);
    opt = { refine: true };
  } else {
    const g = hohmannGuess(s2, S.M);
    M0 = { ...S.M, dep: 'burn', tof: 0, theta: g.theta, dv: g.dv, t0: g.t0, beta: 0 };
    if (M0.autoDur) M0.duration = autoDuration(g, M0.mode);
    const varyT0 = g.case === 'sibling';
    opt = { varyT0, varyBeta: varyT0, t0Grid: g.nested ? [-12, -9, -6, -3, 0, 3, 6, 9, 12] : [-4, -2, 0, 2, 4] };
  }
  const t1 = performance.now();
  setStatus(seed ? _('st.pcSeed', { date: S.model === 'real' ? fmtDate(daysToUtc(seed.t0)) : _('pc.i.day', { d: nf1.format(seed.t0) }), days: nf1.format(seed.tof), dv: nf1.format(seed.dv) }) : _('st.solving'));
  try {
    const prog = n => setStatus(_('st.progress', { n: nf0.format(n) }));
    const r = await runSolver(sysList(), M0, opt, prog, s2);
    Object.assign(S.M, { dep: M0.dep, tof: M0.tof, theta: r.theta, dv: r.dv, t0: r.t0, beta: r.beta != null ? r.beta : M0.beta });
    syncMission(); rebuild({ resetU: true, fit: true });
    if (!reduceMotion) { S.playing = true; setPlayIcon(); }
    const secs = (performance.now() - t1) / 1000;
    const okv = r.f < 1e-4;
    const info = _('st.solvedInfo', { evals: nf0.format(r.evals), secs: nf1.format(secs) });
    if (seed && okv) setStatus(_('st.refined', { lam: nf1.format(seed.tr.dv), nb: nf1.format(S.M.dv + (simR && simR.captured ? simR.captured.dv : 0)) }) + info);
    else setStatus(_(okv ? 'st.solved' : 'st.nearest') + info);
  } catch (e) {
    if (e === 'cancel') setStatus(_('st.cancelled')); else { setStatus(_('st.solverErr', { e })); console.error(e); }
  } finally {
    solving = false; btn.textContent = _('ui.solve'); btn.classList.remove('busy');
  }
}

// ===================== Transfer window: porkchop =====================
// Departure × time-of-flight grid of Lambert transfers (core.js porkchop) for sibling bodies, computed in a worker
// while the window is open, whenever the pair, the Δv definition (h0, hB, mission type, aerocapture), the range or
// the view mode changes. Colour: one-hue ramp from the solid panel colour to the accent (OKLab), cheapest =
// brightest, saturating at twice the minimum; contour lines (labelled in normal mode). The plot and its contours
// are drawn once into an offscreen canvas; pointer moves only redraw the markers.
const PC = { pair: '', key: '', rng: null, res: null, metric: 'dv', worker: null, timer: 0, cur: null, base: null, baseKey: '' };
const PC_GRID = { normal: [200, 150], low: [100, 75] };
const EPH_T = [utcToDays(Date.UTC(EPHEM_YEARS[0], 0, 1)), utcToDays(Date.UTC(EPHEM_YEARS[1] + 1, 0, 1))];
const PCDATE = new Intl.DateTimeFormat(DICT['meta.locale'], { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const PCMON = new Intl.DateTimeFormat(DICT['meta.locale'], { timeZone: 'UTC', month: 'short', year: '2-digit' });
const PCDAY = new Intl.DateTimeFormat(DICT['meta.locale'], { timeZone: 'UTC', month: 'short', day: 'numeric' });
const pcCv = $('#pcCv'), pcCtx = pcCv.getContext('2d');
const pcStatus = t => { $('#pcStatus').textContent = t; };
const pcOpen = () => WINS.transfer.open && !WINS.transfer.collapsed;
const pcM = () => ({ mode: S.M.mode, h0: S.M.h0, hB: S.M.hB, aero: aeroOn(S.M), hAtm: S.M.hAtm });

// Default range: the Hohmann window ± 0.2 synodic periods, 0.4–1.6 Hohmann transfer times.
function pcDefaults() {
  let g = null;
  try { g = hohmannGuess(sys, S.M); } catch (e) { g = null; }
  const syn = 2 * Math.PI / Math.abs(sys.n[0] - sys.n[1]) / DAY, th = g && g.tof > 0 ? g.tof / DAY : 100;
  const c = g && Number.isFinite(g.t0) ? g.t0 : S.M.t0, half = Number.isFinite(syn) ? 0.2 * syn : 0.5 * th;
  return pcClamp({ d0: c - half, d1: c + half, f0: 0.4 * th, f1: 1.6 * th, syn });
}
function pcClamp(r) {
  if (S.model === 'real') { r.d0 = Math.max(r.d0, EPH_T[0]); r.d1 = Math.min(r.d1, EPH_T[1] - 1); }
  return r;
}
function pcFields() {
  const r = PC.rng, real = S.model === 'real';
  for (const [id, v] of [['pc-d0', r.d0], ['pc-d1', r.d1]]) {
    const el = $('#' + id);
    el.type = real ? 'date' : 'number'; el.step = real ? '1' : 'any';
    el.min = real ? `${EPHEM_YEARS[0]}-01-01` : ''; el.max = real ? `${EPHEM_YEARS[1]}-12-31` : '';
    el.value = real ? new Date(daysToUtc(v)).toISOString().slice(0, 10) : +v.toFixed(2);
  }
  $('#pc-f0').value = +r.f0.toFixed(1); $('#pc-f1').value = +r.f1.toFixed(1);
  for (const id of ['pc-d0', 'pc-d1', 'pc-f0', 'pc-f1']) $('#' + id).setAttribute('aria-invalid', 'false');
}
function pcReadFields() {
  const real = S.model === 'real', rd = id => { const v = $('#' + id).value; return real ? utcToDays(Date.parse(v + 'T00:00Z')) : parseNum(v); };
  const r = { ...PC.rng, d0: rd('pc-d0'), d1: rd('pc-d1'), f0: parseNum($('#pc-f0').value), f1: parseNum($('#pc-f1').value) };
  const ok = [r.d0, r.d1, r.f0, r.f1].every(Number.isFinite) && r.d1 > r.d0 && r.f0 > 0 && r.f1 > r.f0;
  for (const id of ['pc-d0', 'pc-d1', 'pc-f0', 'pc-f1']) $('#' + id).setAttribute('aria-invalid', String(!ok));
  if (!ok) { pcStatus(_('pc.badRange')); return; }
  PC.rng = pcClamp(r); pcSync();
}
for (const id of ['pc-d0', 'pc-d1', 'pc-f0', 'pc-f1']) $('#' + id).addEventListener('change', pcReadFields);
function pcShift(k) {
  const r = PC.rng, d = k * r.syn;
  if (!r || !Number.isFinite(d)) return;
  const n = pcClamp({ ...r, d0: r.d0 + d, d1: r.d1 + d });
  if (n.d1 - n.d0 < 0.5 * (r.d1 - r.d0)) return; // ran into the end of the ephemeris
  PC.rng = n; pcFields(); pcSync();
}
$('#pcPrev').addEventListener('click', () => pcShift(-1));
$('#pcNext').addEventListener('click', () => pcShift(1));
$('#pcReset').addEventListener('click', () => { if (!sys || !isSibling(sys)) return; PC.rng = pcDefaults(); pcFields(); pcSync(); });
$('#pcMetric').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  PC.metric = b.dataset.v; setSeg('#pcMetric', PC.metric); PC.base = null; pcDraw(); pcInfo();
});

// Called after every rebuild and when the window opens: pair label, range reset for a new pair, recompute when
// anything the grid depends on changed (debounced), else just redraw the mission marker.
function pcSync() {
  if (!pcOpen()) return;
  if (S.kind === 'man') { $('#pcBody').hidden = true; $('#pcPair').textContent = _('pc.noneMan'); pcStop(); PC.res = null; PC.pair = ''; PC.key = ''; pcStatus(''); return; }
  if (!sys) return;
  const sib = isSibling(sys), A = S.bodies[0].name, B = S.bodies[1].name;
  $('#pcBody').hidden = !sib;
  if (!sib) {
    $('#pcPair').textContent = _('pc.none', { a: A, b: B });
    pcStop(); PC.res = null; PC.pair = ''; PC.key = ''; pcStatus(''); return;
  }
  $('#pcPair').textContent = _('pc.pair', { a: A, b: B, parent: S.bodies[sys.parent[0]].name });
  const pair = S.model + '|' + JSON.stringify(sysList());
  if (pair !== PC.pair) { PC.pair = pair; PC.rng = pcDefaults(); PC.res = null; PC.cur = null; pcFields(); }
  const key = pair + JSON.stringify([pcM(), PC.rng, MODE]);
  if (key !== PC.key) { PC.key = key; clearTimeout(PC.timer); PC.timer = setTimeout(pcRun, 120); }
  else { pcDraw(); pcInfo(); }
}
function pcStop() { if (PC.worker) { PC.worker.terminate(); PC.worker = null; } }
function pcRun() {
  if (!sys || !isSibling(sys) || !PC.rng) return;
  pcStop();
  const [nd, nt] = PC_GRID[MODE] || PC_GRID.normal, r = PC.rng, M = pcM(), key = PC.key, t = performance.now();
  const g = { t1a: r.d0, t1b: r.d1, fa: r.f0, fb: r.f1, nd, nt };
  if (S.model === 'real') { g.tMin = EPH_T[0]; g.tMax = EPH_T[1]; }
  const done = res => {
    PC.worker = null;
    if (key !== PC.key) return; // superseded while computing
    PC.res = { ...res, g }; PC.base = null;
    pcStatus(_('pc.done', { n: nf0.format(nd * nt), ms: nf0.format(performance.now() - t) }));
    pcDraw(); pcInfo();
  };
  const fail = e => { PC.worker = null; pcStatus(_('pc.err', { e })); };
  pcStatus(_('pc.busy', { p: 0 }));
  let w = null;
  try { w = makeWorker(); } catch (e) { w = null; }
  if (!w) { try { done(porkchop(buildSystem(sysList()), M, g)); } catch (e) { fail(e); } return; }
  PC.worker = w;
  w.onmessage = e => {
    const d = e.data;
    if (d.p != null) pcStatus(_('pc.busy', { p: Math.round(100 * d.p / nt) }));
    else { w.terminate(); d.done ? done(d.done) : fail(d.error); }
  };
  w.onerror = e => { w.terminate(); fail(e.message || 'worker'); };
  w.postMessage({ list: sysList(), M, pc: g });
}

// Values of the current metric in display units (km/s; C3 in km²/s²), their minimum and the colour range.
function pcVals() {
  const r = PC.res;
  if (r.vals && r.valsFor === PC.metric) return r.vals;
  const src = PC.metric === 'c3' ? r.c3 : PC.metric === 'va' ? r.va : r.dv, k = PC.metric === 'c3' ? 1 : 1e-3, v = new Float32Array(src.length);
  let lo = Infinity, at = -1;
  for (let i = 0; i < v.length; i++) { v[i] = src[i] * k; if (v[i] < lo) { lo = v[i]; at = i; } }
  Object.assign(r, { vals: v, valsFor: PC.metric, lo, at, hi: lo > 0 ? 2 * lo : lo + 1 });
  return v;
}
const pcUnit = () => (PC.metric === 'c3' ? 'km²/s²' : 'km/s');
// colour ramp: 256 steps from --solid (index 0) to --accent (255), interpolated in OKLab
let PC_LUT = null;
const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function oklab(hex) {
  const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map(x => toLin(x / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function oklabRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
    .map(x => Math.round(255 * toSrgb(clamp(x, 0, 1))));
}
function pcLut() {
  if (PC_LUT) return PC_LUT;
  const a = oklab(COL.solid), b = oklab(COL.accent);
  PC_LUT = new Uint8ClampedArray(256 * 3);
  for (let k = 0; k < 256; k++) PC_LUT.set(oklabRgb(a.map((x, j) => x + (b[j] - x) * k / 255)), 3 * k);
  return PC_LUT;
}
const pcIdx = x => Math.round((1 - clamp((x - PC.res.lo) / (PC.res.hi - PC.res.lo), 0, 1)) * 255);
const niceStep = x => { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
const niceTicks = (a, b, n) => { const st = niceStep((b - a) / n), out = []; for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + 1e-9 * st; v += st) out.push(v); return out; };

// Marching squares: segments (grid coordinates i, j; 4 numbers each) where the field crosses level L.
function contourSegs(v, nd, nt, L, out) {
  const e = new Float64Array(8);
  for (let j = 0; j < nt - 1; j++) for (let i = 0; i < nd - 1; i++) {
    const a = v[j * nd + i], b = v[j * nd + i + 1], c = v[(j + 1) * nd + i + 1], d = v[(j + 1) * nd + i];
    if (!(a === a && b === b && c === c && d === d)) continue; // NaN corner
    let n = 0;
    const edge = (p, q, pi, pj, qi, qj) => { if ((p < L) !== (q < L)) { const t = (L - p) / (q - p); e[n++] = pi + (qi - pi) * t; e[n++] = pj + (qj - pj) * t; } };
    edge(a, b, i, j, i + 1, j); edge(b, c, i + 1, j, i + 1, j + 1); edge(c, d, i + 1, j + 1, i, j + 1); edge(d, a, i, j + 1, i, j);
    if (n === 4) out.push(e[0], e[1], e[2], e[3]);
    else if (n === 8) { // saddle: the centre decides which corners connect
      if (((a + b + c + d) / 4 < L) === (a < L)) out.push(e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7]);
      else out.push(e[6], e[7], e[0], e[1], e[2], e[3], e[4], e[5]);
    }
  }
}

function pcLayout() {
  const w = pcCv.clientWidth, h = pcCv.clientHeight;
  if (w < 60 || h < 60) return null;
  return { w, h, dpr: MODE === 'low' ? 1 : Math.min(Q.dprMax, window.devicePixelRatio || 1), x0: 40, x1: w - 10, y0: 18, y1: h - 32 };
}
const pcX = (L, t1) => { const g = PC.res.g; return L.x0 + (t1 - g.t1a) / (g.t1b - g.t1a) * (L.x1 - L.x0); };
const pcY = (L, tof) => { const g = PC.res.g; return L.y1 - (tof - g.fa) / (g.fb - g.fa) * (L.y1 - L.y0); };
function pcAt(px, py) {
  const L = pcLayout(); if (!L || !PC.res) return null;
  if (px < L.x0 - 2 || px > L.x1 + 2 || py < L.y0 - 2 || py > L.y1 + 2) return null;
  const g = PC.res.g;
  return { t1: g.t1a + clamp((px - L.x0) / (L.x1 - L.x0), 0, 1) * (g.t1b - g.t1a), tof: g.fa + clamp((L.y1 - py) / (L.y1 - L.y0), 0, 1) * (g.fb - g.fa) };
}
function pcMinPoint() {
  const r = PC.res; if (!r) return null;
  pcVals(); if (r.at < 0) return null;
  const g = r.g, i = r.at % g.nd, j = Math.floor(r.at / g.nd);
  return { t1: g.t1a + (g.t1b - g.t1a) * i / (g.nd - 1), tof: g.fa + (g.fb - g.fa) * j / (g.nt - 1) };
}
const pcFmtV = v => NF(PC.metric === 'c3' ? 1 : 2).format(v);

// heat map, contours and axes into an offscreen canvas
function pcBase(L) {
  const r = PC.res, v = pcVals(), g = r.g, nd = g.nd, nt = g.nt, lut = pcLut();
  const img = new ImageData(nd, nt);
  for (let j = 0; j < nt; j++) for (let i = 0; i < nd; i++) {
    const x = v[j * nd + i];
    if (!(x === x)) continue; // no arc or outside the ephemeris: transparent
    const p = 4 * ((nt - 1 - j) * nd + i), k = 3 * pcIdx(x);
    img.data[p] = lut[k]; img.data[p + 1] = lut[k + 1]; img.data[p + 2] = lut[k + 2]; img.data[p + 3] = 255;
  }
  const heat = document.createElement('canvas'); heat.width = nd; heat.height = nt; heat.getContext('2d').putImageData(img, 0, 0);
  const c = document.createElement('canvas'); c.width = Math.round(L.w * L.dpr); c.height = Math.round(L.h * L.dpr);
  const x = c.getContext('2d'); x.scale(L.dpr, L.dpr);
  const cw = (L.x1 - L.x0) / (nd - 1), ch = (L.y1 - L.y0) / (nt - 1), X = i => L.x0 + i * cw, Y = j => L.y1 - j * ch;
  x.save(); x.beginPath(); x.rect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0); x.clip();
  x.imageSmoothingEnabled = MODE !== 'low';
  x.drawImage(heat, L.x0 - cw / 2, L.y0 - ch / 2, cw * nd, ch * nt); // grid nodes at pixel centres
  const levels = niceTicks(r.lo, r.hi, 6).filter(l => l > r.lo), segs = [];
  x.lineWidth = 1; x.strokeStyle = hexA(COL.ink, 0.3);
  for (const lev of levels) {
    const seg = []; contourSegs(v, nd, nt, lev, seg); segs.push(seg);
    x.beginPath();
    for (let k = 0; k < seg.length; k += 4) { x.moveTo(X(seg[k]), Y(seg[k + 1])); x.lineTo(X(seg[k + 2]), Y(seg[k + 3])); }
    x.stroke();
  }
  x.restore();
  // labels on every other level, where the contour crosses the column above the minimum (they stack there in
  // order); a label that would leave the plot or overlap another one moves along its contour or is dropped
  if (MODE !== 'low' && r.at >= 0) {
    x.font = '500 10px "IBM Plex Mono", ui-monospace, monospace'; x.textBaseline = 'middle'; x.textAlign = 'center';
    const mx = X(r.at % nd), my = Y(Math.floor(r.at / nd)), boxes = [[mx - 9, my - 19, mx + 120, my + 9]]; // the minimum and its label
    const dec = levels.length > 1 && levels[1] - levels[0] < 1 ? 1 : 0;
    segs.forEach((seg, n) => {
      if (n % 2) return;
      const t = NF(dec).format(levels[n]), tw = x.measureText(t).width + 6, pts = [];
      for (let k = 0; k < seg.length; k += 2) { const px = X(seg[k]), py = Y(seg[k + 1]); pts.push([Math.abs(px - mx) + (py < my ? 0 : 400), px, py]); }
      pts.sort((a, b) => a[0] - b[0]);
      for (const [, px, py] of pts) {
        const b = [px - tw / 2, py - 7, px + tw / 2, py + 7];
        if (b[0] < L.x0 + 2 || b[2] > L.x1 - 2 || b[1] < L.y0 + 2 || b[3] > L.y1 - 2) continue;
        if (boxes.some(q => b[0] < q[2] + 4 && b[2] > q[0] - 4 && b[1] < q[3] + 2 && b[3] > q[1] - 2)) continue;
        boxes.push(b);
        x.fillStyle = hexA(COL.solid, 0.8); x.fillRect(b[0], b[1], tw, 14);
        x.fillStyle = COL.ink; x.fillText(t, px, py);
        break;
      }
    });
  }
  // axes: departure (dates in the real model, days in the simplified one) and time of flight
  x.strokeStyle = COL.line; x.lineWidth = 1; x.beginPath();
  x.moveTo(L.x0 - 0.5, L.y0); x.lineTo(L.x0 - 0.5, L.y1 + 0.5); x.lineTo(L.x1, L.y1 + 0.5); x.stroke();
  x.fillStyle = COL.dim; x.textAlign = 'center'; x.textBaseline = 'top';
  const tick = (px, py, qx, qy) => { x.beginPath(); x.moveTo(px, py); x.lineTo(qx, qy); x.stroke(); };
  const room = Math.max(2, Math.floor((L.x1 - L.x0) / 62));
  if (S.model === 'real' && g.t1b - g.t1a < 60) { // short window (moons): days at UTC midnight
    const st = Math.max(1, niceStep((g.t1b - g.t1a) / room)), a = daysToUtc(g.t1a), end = daysToUtc(g.t1b);
    for (let dn = Math.ceil(a / 864e5 / st) * st; dn * 864e5 <= end; dn += st) {
      const ms = dn * 864e5, px = pcX(L, utcToDays(ms)); tick(px, L.y1, px, L.y1 + 4); x.fillText(PCDAY.format(ms), px, L.y1 + 6);
    }
  } else if (S.model === 'real') {
    const a = new Date(daysToUtc(g.t1a)), end = daysToUtc(g.t1b), months = (g.t1b - g.t1a) / 30.44;
    const st = [1, 2, 3, 6, 12, 24, 60, 120].find(q => months / q <= room) || 240;
    for (let m = a.getUTCFullYear() * 12 + a.getUTCMonth() + 1; ; m++) {
      if (m % st) continue;
      const ms = Date.UTC(Math.floor(m / 12), m % 12, 1); if (ms > end) break;
      const px = pcX(L, utcToDays(ms)); tick(px, L.y1, px, L.y1 + 4); x.fillText(PCMON.format(ms), px, L.y1 + 6);
    }
  } else for (const d of niceTicks(g.t1a, g.t1b, Math.max(2, Math.floor((L.x1 - L.x0) / 56)))) { const px = pcX(L, d); tick(px, L.y1, px, L.y1 + 4); x.fillText(nf0.format(d), px, L.y1 + 6); }
  x.textAlign = 'right'; x.textBaseline = 'middle';
  for (const d of niceTicks(g.fa, g.fb, Math.max(2, Math.floor((L.y1 - L.y0) / 34)))) { const py = pcY(L, d); tick(L.x0 - 4, py, L.x0, py); x.fillText(nf0.format(d), L.x0 - 6, py); }
  x.font = '500 9.5px "Chakra Petch", system-ui, sans-serif'; x.fillStyle = COL.faint;
  x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.fillText(_('pc.axisY').toLocaleUpperCase(DICT['meta.locale']), 4, 11);
  x.textAlign = 'right'; x.fillText(_(S.model === 'real' ? 'pc.axisX' : 'pc.axisXd').toLocaleUpperCase(DICT['meta.locale']), L.x1, L.h - 3);
  return c;
}

// one marker with a label that stays inside the plot (above the marker, or below it: the mission's square)
function pcMark(L, px, py, txt, col, square) {
  const x = pcCtx;
  x.strokeStyle = col; x.lineWidth = 1.5;
  if (square) x.strokeRect(px - 4, py - 4, 8, 8);
  else { x.beginPath(); x.arc(px, py, 5, 0, 6.2832); x.stroke(); x.beginPath(); x.moveTo(px - 9, py); x.lineTo(px - 6, py); x.moveTo(px + 6, py); x.lineTo(px + 9, py); x.moveTo(px, py - 9); x.lineTo(px, py - 6); x.moveTo(px, py + 6); x.lineTo(px, py + 9); x.stroke(); }
  x.font = '500 10.5px "IBM Plex Mono", ui-monospace, monospace'; x.textBaseline = 'middle';
  const tw = x.measureText(txt).width, right = px + 12 + tw < L.x1, lx = right ? px + 12 : px - 12 - tw, ly = clamp(py + (square ? 11 : -11), L.y0 + 7, L.y1 - 7);
  x.fillStyle = hexA(COL.solid, 0.8); x.fillRect(lx - 3, ly - 7, tw + 6, 14);
  x.fillStyle = COL.ink; x.textAlign = 'left'; x.fillText(txt, lx, ly);
}
function pcDraw() {
  if (!pcOpen()) return;
  const L = pcLayout(); if (!L) return;
  const W2 = Math.round(L.w * L.dpr), H2 = Math.round(L.h * L.dpr);
  if (pcCv.width !== W2 || pcCv.height !== H2) { pcCv.width = W2; pcCv.height = H2; }
  const x = pcCtx;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W2, H2);
  if (!PC.res) { pcScale(); return; }
  const bk = [L.w, L.h, L.dpr, PC.metric, MODE].join('|');
  if (!PC.base || PC.baseKey !== bk) { PC.base = pcBase(L); PC.baseKey = bk; }
  x.drawImage(PC.base, 0, 0);
  x.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  pcScale();
  const inside = (px, py) => px >= L.x0 - 1 && px <= L.x1 + 1 && py >= L.y0 - 1 && py <= L.y1 + 1;
  // the current mission (departure, arrival at the target periapsis or the chosen time of flight)
  const m = pcMinPoint();
  if (m) pcMark(L, pcX(L, m.t1), pcY(L, m.tof), _('pc.lblMin', { v: pcFmtV(PC.res.lo) + ' ' + pcUnit() }), COL.ink, false);
  const tof = simR && simR.bPeri ? simR.bPeri.t / DAY : S.M.dep === 'asym' ? S.M.tof : 0;
  if (tof > 0) { const px = pcX(L, S.M.t0), py = pcY(L, tof); if (inside(px, py)) pcMark(L, px, py, _('pc.lblMission'), COL.orbit, true); }
  if (PC.cur) { // crosshair
    const px = pcX(L, PC.cur.t1), py = pcY(L, PC.cur.tof);
    x.strokeStyle = hexA(COL.ink, 0.45); x.lineWidth = 1; x.setLineDash([3, 3]);
    x.beginPath(); x.moveTo(px, L.y0); x.lineTo(px, L.y1); x.moveTo(L.x0, py); x.lineTo(L.x1, py); x.stroke(); x.setLineDash([]);
    x.strokeStyle = COL.ink; x.beginPath(); x.arc(px, py, 4, 0, 6.2832); x.stroke();
  }
}
function pcScale() {
  const r = PC.res;
  if (!r) { $('#pcLo').textContent = ''; $('#pcHi').textContent = ''; $('#pcRamp').style.background = ''; return; }
  const lut = pcLut(), stop = k => `rgb(${lut[3 * k]},${lut[3 * k + 1]},${lut[3 * k + 2]})`;
  $('#pcRamp').style.background = `linear-gradient(90deg, ${[255, 191, 128, 64, 0].map((k, n) => `${stop(k)} ${n * 25}%`).join(', ')})`;
  $('#pcLo').textContent = pcFmtV(r.lo) + ' ' + pcUnit(); $('#pcHi').textContent = '≥ ' + pcFmtV(r.hi);
}
// details of the point under the pointer (or the keyboard cursor), else of the minimum
function pcInfo() {
  const box = $('#pcInfo'), cap = $('#pcInfoCap');
  const p = PC.res && sys && isSibling(sys) ? PC.cur || pcMinPoint() : null;
  if (!p) { box.innerHTML = ''; cap.textContent = ''; return; }
  cap.textContent = PC.cur ? _('pc.capCursor') : _('pc.capMin', { m: _('pc.m.' + PC.metric) });
  const tr = lambertTransfer(sys, p.t1 * DAY, p.tof * DAY, S.M);
  if (!tr) { box.innerHTML = `<tr><td colspan="2">${esc(_('pc.noArc'))}</td></tr>`; return; }
  const dd = d => S.model === 'real' ? PCDATE.format(daysToUtc(d)) : _('pc.i.day', { d: nf1.format(d) });
  const rows = [
    [_('pc.i.dates'), esc(dd(p.t1) + ' → ' + dd(p.t1 + p.tof)), ''],
    [_('pc.i.tof'), esc(_('pc.i.days', { d: nf1.format(p.tof), type: tr.type === 1 ? 'I' : 'II' })), ''],
    [_('pc.i.c3'), nf2.format(tr.c3 / 1e6), 'km²/s²'],
    [_('pc.i.vinf'), nf2.format(tr.vd / 1e3) + ' / ' + nf2.format(tr.va / 1e3), 'km/s'],
    [_('pc.i.dv'), nf0.format(tr.dvD) + ' + ' + nf0.format(tr.dvA), 'm/s'],
    [_('pc.i.tot'), nf0.format(tr.dv), 'm/s'],
    [_('pc.i.incl'), nf1.format(tr.incl), '°'],
  ];
  box.innerHTML = rows.map(([l, v, u]) => `<tr><th scope="row">${esc(l)}</th><td>${v}${u ? `<em>${esc(u)}</em>` : ''}</td></tr>`).join('');
}
// Set the mission up from a porkchop point: Lambert seed (departure asymptote), then the N-body refinement.
function pcPick(p) {
  if (!sys || !isSibling(sys) || !p) return;
  const seed = lambertSeed(sys, p.t1 * DAY, p.tof * DAY, S.M);
  if (!seed) { pcStatus(_('pc.noArc')); return; }
  Object.assign(S.M, { dep: 'asym', theta: seed.theta, beta: seed.beta, dv: seed.dv, t0: seed.t0, tof: seed.tof, autoDur: true });
  S.scenario = ''; $('#scenario').value = ''; $('#scNote').textContent = _('sc.pc.note');
  syncMission(); rebuild({ resetU: true, fit: true });
  if (!reduceMotion) { S.playing = true; setPlayIcon(); }
  startSolve();
}
// start the solver, cancelling a running one first
function startSolve() {
  if (!solving) { solve(); return; }
  if (!cancelSolve) $('#solve').click();
  setTimeout(startSolve, 20);
}
let pcDown = null;
pcCv.addEventListener('pointerdown', e => { pcDown = { x: e.offsetX, y: e.offsetY, touch: e.pointerType !== 'mouse' }; });
pcCv.addEventListener('pointercancel', () => { pcDown = null; });
pcCv.addEventListener('pointerup', e => {
  const d = pcDown; pcDown = null;
  if (!d || Math.hypot(e.offsetX - d.x, e.offsetY - d.y) > TAP_PX[d.touch ? 'touch' : 'mouse']) return;
  const p = pcAt(e.offsetX, e.offsetY);
  if (p) { PC.cur = p; pcDraw(); pcInfo(); pcPick(p); }
});
pcCv.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || !PC.res) return;
  const p = pcAt(e.offsetX, e.offsetY);
  if (!p && !PC.cur) return;
  PC.cur = p; pcDraw(); pcInfo();
});
pcCv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && PC.cur && document.activeElement !== pcCv) { PC.cur = null; pcDraw(); pcInfo(); } });
// keyboard: arrows move a cursor over the grid (Shift: 10 cells), Enter sets the mission up
pcCv.addEventListener('keydown', e => {
  if (!PC.res) return;
  const g = PC.res.g, p = PC.cur || pcMinPoint(), k = e.shiftKey ? 10 : 1;
  const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (mv && p) {
    e.preventDefault();
    PC.cur = { t1: clamp(p.t1 + mv[0] * k * (g.t1b - g.t1a) / (g.nd - 1), g.t1a, g.t1b), tof: clamp(p.tof + mv[1] * k * (g.fb - g.fa) / (g.nt - 1), g.fa, g.fb) };
    pcDraw(); pcInfo();
  } else if ((e.key === 'Enter' || e.key === ' ') && p) { e.preventDefault(); pcPick(p); }
});
pcCv.addEventListener('blur', () => { if (PC.cur) { PC.cur = null; pcDraw(); pcInfo(); } });
new ResizeObserver(() => { PC.base = null; pcDraw(); }).observe($('#pcPlot'));

// ===================== Solar system map =====================
// Always the real solar system (JPL elements), heliocentric, projected on the ecliptic. Date: the mission
// departure plus the timeline time (real model) or today plus the timeline time (simplified model).
// The map has its own camera: entering the map swaps it with the mission view's.
const MAPK = KEYS_REAL, MSUN = MAPK.indexOf('sun');
const mapSys = buildSystem(MAPK.map(k => { const d = BODIES[k]; return { name: k, mu: d.gm * 1e9, radius: d.radius * 1e3, parent: MAPK.indexOf(d.parent), a: 0, orb: d.orb }; }));
const MPAR = MAPK.map(k => MAPK.indexOf(BODIES[k].parent));
const MKIDS = MAPK.map(k => MAPK.filter(q => BODIES[q].parent === k).map(q => MAPK.indexOf(q)));
const isMoon = i => MPAR[i] >= 0 && MPAR[i] !== MSUN;
const MP = new Float64Array(3 * mapSys.N), MV = new Float64Array(3 * mapSys.N);
const MAP = { on: false, log: false, moons: true, follow: null, needFit: true, cam: { cx: 0, cy: 0, scale: 1e-9 }, today: 0, orb: null, pos: null };
const simCam = { cx: 0, cy: 0, scale: 1e-6 };
let tNowG = 0, ovLast = 0;
MAP.today = utcToDays(Date.now()) * DAY;
const mapTime = t => (S.model === 'real' ? S.M.t0 * DAY : MAP.today) + t;

// Logarithmic scale: radial distance from the Sun r -> AU·ln(1 + r/r0); directions are kept.
const LOG_R0 = 0.05 * AU;
function mapXY(x, y, out) {
  if (MAP.log) { const r = Math.hypot(x, y), k = r > 0 ? AU * Math.log1p(r / LOG_R0) / r : 0; out[0] = x * k; out[1] = y * k; }
  else { out[0] = x; out[1] = y; }
  return out;
}
// heliocentric ecliptic x, y of map body i (after states(mapSys, …))
const hx = i => MP[3 * i] - MP[3 * MSUN], hy = i => MP[3 * i + 1] - MP[3 * MSUN + 1];

function setMap(on) {
  if (on === MAP.on) return;
  if (on) { Object.assign(simCam, cam); Object.assign(cam, MAP.cam); MAP.today = utcToDays(Date.now()) * DAY; }
  else { Object.assign(MAP.cam, cam); Object.assign(cam, simCam); }
  MAP.on = on; INS = null;
  syncMapUI();
}
function syncMapUI() {
  $('#mapBtn').setAttribute('aria-pressed', String(MAP.on));
  for (const s of ['#frameSeg', '#followSeg', '#tSoiWrap', '#tTracksWrap']) $(s).hidden = MAP.on;
  for (const s of ['#mapSeg', '#mapMoonsWrap']) $(s).hidden = !MAP.on;
  setSeg('#mapSeg', MAP.log ? 'log' : 'lin');
}
$('#mapBtn').addEventListener('click', () => setMap(!MAP.on));
$('#mapSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  MAP.log = b.dataset.v === 'log'; syncMapUI();
  if (C) C.mapKey = '';
  MAP.needFit = true;
});
$('#tMoons').addEventListener('change', e => { MAP.moons = e.target.checked; });
document.addEventListener('keydown', e => {
  if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) setMap(!MAP.on);
});

// Fit: the planets out to the mission's bodies (at least to Mars) in the linear scale, Neptune in the log scale.
function fitMap() {
  if (is3d()) { fitMap3(); return; }
  if (W < 50 || H < 50) return;
  states(mapSys, mapTime(tNowG), MP, MV);
  let R = 1.75 * AU;
  if (MAP.log) R = mapXY(31 * AU, 0, [0, 0])[0];
  else for (const b of S.bodies) { const i = MAPK.indexOf(b.key); if (i >= 0) R = Math.max(R, 1.2 * Math.hypot(hx(i), hy(i))); }
  const { l, r, t, b } = insets();
  cam.scale = Math.min(W - l - r, H - t - b) * 0.47 / R;
  cam.cx = -((l - r) / 2) / cam.scale; cam.cy = ((t - b) / 2) / cam.scale;
  MAP.follow = null; MAP.needFit = false;
}
// Centre on body k and follow it; in the linear scale zoom to its moons (or its neighbourhood).
function mapCenter(k) {
  const i = MAPK.indexOf(k); if (i < 0) return;
  if (is3d()) { mapCenter3(i); return; }
  if (i === MSUN) { fitMap(); return; }
  MAP.needFit = false; MAP.follow = i;
  if (MAP.log) return;
  states(mapSys, mapTime(tNowG), MP, MV);
  const a = q => Math.hypot(MP[3 * q] - MP[3 * MPAR[q]], MP[3 * q + 1] - MP[3 * MPAR[q] + 1]);
  const R = MKIDS[i].length ? 1.4 * Math.max(...MKIDS[i].map(a)) : isMoon(i) ? 2.5 * a(i) : 0.3 * a(i);
  const { l, r, t, b } = insets();
  cam.scale = Math.min(W - l - r, H - t - b) * 0.47 / R;
}

// orbit outlines cached per ~30 days of map time: planets relative to the Sun (mapped), moons to their planet
function mapOrbits(T) {
  const key = Math.round(T / (30 * DAY)) + '|' + MAP.log + '|' + Q.ellK;
  if (MAP.orb && MAP.orb.key === key) return MAP.orb;
  const K = Q.ellK, o = [0, 0], paths = [];
  for (let i = 0; i < mapSys.N; i++) {
    if (!mapSys.orb[i]) { paths.push(null); continue; }
    const p = orbitPath(mapSys, i, T, K), e = new Float64Array(2 * K);
    if (!isMoon(i)) for (let k = 0; k < K; k++) { mapXY(p[3 * k], p[3 * k + 1], o); e[2 * k] = o[0]; e[2 * k + 1] = o[1]; }
    else for (let k = 0; k < K; k++) { e[2 * k] = p[3 * k]; e[2 * k + 1] = p[3 * k + 1]; }
    paths.push(e);
  }
  return (MAP.orb = { key, paths });
}

// Real model: the craft path in heliocentric map coordinates. The offset from the mission's root body
// to the Sun is sampled 400 times and interpolated (it changes slowly over a mission).
const SPm = new Float64Array(12), SVm = new Float64Array(12);
function mapOffset(t, out) { // map(root body) − sim(root body) at mission time t, after states(mapSys, …)
  const r = sys.root, rk = MAPK.indexOf(S.bodies[r].key);
  states(sys, S.M.t0 * DAY + t, SPm, SVm);
  out[0] = hx(rk) - SPm[3 * r]; out[1] = hy(rk) - SPm[3 * r + 1]; return out;
}
function mapTraj() {
  if (S.model !== 'real' || !C || !sys) return null;
  const key = MAP.log + '|' + C.pt.length;
  if (C.mapKey === key) return C;
  const n = C.pt.length, K = 400, off = new Float64Array(2 * (K + 1)), o = [0, 0];
  for (let k = 0; k <= K; k++) { const t = C.T * k / K; states(mapSys, S.M.t0 * DAY + t, MP, MV); mapOffset(t, o); off[2 * k] = o[0]; off[2 * k + 1] = o[1]; }
  C.mx = new Float64Array(n); C.my = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = clamp(C.pt[i] / C.T * K, 0, K), k = Math.min(K - 1, Math.floor(f)), g = f - k;
    const ox = off[2 * k] + (off[2 * k + 2] - off[2 * k]) * g, oy = off[2 * k + 1] + (off[2 * k + 3] - off[2 * k + 1]) * g;
    mapXY(C.px[i] + ox, C.py[i] + oy, o); C.mx[i] = o[0]; C.my[i] = o[1];
  }
  C.mapKey = key;
  return C;
}

const LABEL_FONT = '600 11px "Chakra Petch", system-ui, sans-serif';
function drawMap(T, glow, craft, tNow, pathIdx) {
  const tr = mapTraj(); // before the states below (it reuses MP)
  states(mapSys, T, MP, MV);
  const N = mapSys.N, pos = MAP.pos || (MAP.pos = new Float64Array(2 * N)), o = [0, 0];
  for (let i = 0; i < N; i++) { mapXY(hx(i), hy(i), o); pos[2 * i] = o[0]; pos[2 * i + 1] = o[1]; }
  CAPTION.push(...mapNotes(T)); setCaption(); // before fitting: the caption box is an obstacle of the free area
  if (MAP.needFit) fitMap();
  if (MAP.follow != null) { cam.cx = pos[2 * MAP.follow]; cam.cy = pos[2 * MAP.follow + 1]; }
  const keyA = S.bodies[0] && S.bodies[0].key, keyB = S.bodies[1] && S.bodies[1].key, sc = cam.scale;
  const moonsOn = MAP.moons && !MAP.log;
  // a moon is shown (linear scale only) once its orbit is a few pixels across
  const moonR = i => Math.hypot(MP[3 * i] - MP[3 * MPAR[i]], MP[3 * i + 1] - MP[3 * MPAR[i] + 1]) * sc;
  const showBody = i => !isMoon(i) || (moonsOn && moonR(i) > 5);

  // orbits
  const orb = mapOrbits(T);
  ctx.lineWidth = 1;
  for (let i = 0; i < N; i++) {
    const e = orb.paths[i]; if (!e || !showBody(i)) continue;
    const p = MPAR[i], cx0 = isMoon(i) ? sx(pos[2 * p]) : sx(0), cy0 = isMoon(i) ? sy(pos[2 * p + 1]) : sy(0);
    const k = MAPK[i], hi = k === keyA || k === keyB;
    ctx.strokeStyle = hexA(BODIES[k].color, hi ? 0.5 : isMoon(i) ? 0.18 : 0.26);
    ctx.beginPath();
    for (let j = 0; j < e.length; j += 2) { const x = cx0 + e[j] * sc, y = cy0 - e[j + 1] * sc; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.stroke();
  }
  // craft path (real model)
  if (tr && craft) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = hexA(COL.traj, 0.3); ctx.lineWidth = 1.2;
    strokePath(tr.mx, tr.my, 0, tr.mx.length - 1);
    ctx.strokeStyle = COL.traj; ctx.lineWidth = 1.8;
    strokePath(tr.mx, tr.my, 0, pathIdx);
    mapOffset(tNow, o); mapXY(craft[0] + o[0], craft[1] + o[1], o);
    const x = sx(o[0]), y = sy(o[1]);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = COL.traj; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.2832); ctx.stroke();
  }
  // bodies and labels: Sun and planets first, then moons; a label that would overlap another is skipped
  ctx.font = LABEL_FONT;
  const placed = [], fits = (x, y, w) => !placed.some(q => x < q[0] + q[2] + 4 && x + w + 4 > q[0] && Math.abs(y - q[1]) < 13);
  const order = [...Array(N).keys()].sort((p, q) => isMoon(p) - isMoon(q));
  for (const i of order) {
    if (!showBody(i)) continue;
    const k = MAPK[i], x = sx(pos[2 * i]), y = sy(pos[2 * i + 1]), col = BODIES[k].color, moon = isMoon(i);
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
    const r = Math.max(i === MSUN ? 4.5 : moon ? 1.6 : 2.6, MAP.log ? 0 : mapSys.R[i] * sc);
    addHit('m', i, x, y, r);
    if (i === MSUN) skySun(x > 0 && x < W && y > 0 && y < H ? 1 : 0, r); else skyLit(x, y, r, 0, k, !!BODIES[k].rings); // lit from the side: half the disc
    if (i === MSUN || !globeMap(i, x, y, r, T)) { ctx.fillStyle = i === MSUN ? '#fff3d6' : col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); }
    if (i === MSUN && glow) glare2d(x, y, r);
    if (k === keyA || k === keyB) { ctx.strokeStyle = k === keyA ? COL.traj : COL.orbit; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 6.2832); ctx.stroke(); }
    if (moon && (!Q.glow || moonR(i) < 22)) continue; // low-resource mode: planet labels only
    const txt = _('body.' + k).toLocaleUpperCase(DICT['meta.locale']), w = ctx.measureText(txt).width;
    const lx = x + r + 6, ly = y + 4;
    if (!fits(lx, ly, w)) continue;
    placed.push([lx, ly, w]);
    ctx.fillStyle = hexA(COL.ink, moon ? 0.6 : 0.85); ctx.fillText(txt, lx, ly);
  }
}
// map caption: the date, and what the scale or the model leaves out
function mapNotes(T) {
  const notes = [_('map.caption', { date: fmtDate(daysToUtc(T / DAY)) })];
  if (MAP.log) notes.push(_('map.logNote'));
  if (S.model !== 'real') notes.push(_('map.today'));
  return notes;
}
// Caption lines of this frame (map date, what the 3D grid shows, node marks): shown in the HUD box #caption at the
// bottom left, which counts as an obstacle for the free plot area like the readout, so labels and fits avoid it.
const CAPTION = [];
let capTxt = null;
function setCaption() {
  const t = CAPTION.join('\n');
  if (t === capTxt) return;
  capTxt = t; const el = $('#caption'); el.textContent = t; el.hidden = !t;
}

// ===================== Overview (body picker) =====================
// Tree of the real bodies: the Sun, the planets, their moons (folded per planet). Distances follow the map date.
const ovOpen = new Set();
let OVD = [];
const ICON_CHEV_R = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9"/></svg>';
// unfold the planets that hold the departure or target body
function ovReveal() { for (const b of S.bodies.slice(0, 2)) { const p = BODIES[b.key] && BODIES[b.key].parent; if (p && p !== 'sun') ovOpen.add(p); } }
function renderOverview() {
  const A = S.bodies[0] && S.bodies[0].key, B = S.bodies[1] && S.bodies[1].key, inM = new Set(S.bodies.map(b => b.key));
  const rows = [];
  const row = (i, lvl) => {
    const k = MAPK[i], name = _('body.' + k), kids = MKIDS[i], open = lvl === 0 || ovOpen.has(k);
    const fold = lvl === 1 && kids.length
      ? `<button type="button" class="ibtn" data-act="fold" aria-expanded="${open}" aria-label="${esc(_('ov.moons', { name }))}">${open ? ICON_CHEV : ICON_CHEV_R}</button>`
      : lvl === 1 ? '<span class="ot-sp"></span>' : '';
    rows.push(`<tr data-k="${k}" class="l${lvl}${inM.has(k) ? ' inm' : ''}">
      <th scope="row"><span class="ot-n">${fold}<button type="button" class="ot-name" data-act="center" title="${esc(_('ov.center', { name }))}"><span class="dot" style="background:${BODIES[k].color}"></span><span>${esc(name)}</span></button></span></th>
      <td class="ot-d" data-i="${i}">—</td>
      <td class="ot-p"><button type="button" class="pick dep" data-act="dep" aria-pressed="${k === A}" aria-label="${esc(_('ov.pickDep', { name }))}" title="${esc(_('ov.pickDep', { name }))}"></button></td>
      <td class="ot-p"><button type="button" class="pick tgt" data-act="tgt" aria-pressed="${k === B}" aria-label="${esc(_('ov.pickTgt', { name }))}" title="${esc(_('ov.pickTgt', { name }))}"></button></td></tr>`);
    if (open) for (const c of kids) row(c, lvl + 1);
  };
  row(MSUN, 0);
  $('#ovBody').innerHTML = rows.join('');
  OVD = [...$('#ovBody').querySelectorAll('td[data-i]')].map(el => [el, +el.dataset.i]).filter(([, i]) => i !== MSUN);
  ovDist(true);
}
function ovDist(force) {
  if (!force && (!WINS.overview.open || WINS.overview.collapsed)) return;
  states(mapSys, mapTime(tNowG), MP, MV);
  for (const [el, i] of OVD) {
    // planets in AU from the Sun, moons in km from their planet
    const p = MPAR[i], d = Math.hypot(MP[3 * i] - MP[3 * p], MP[3 * i + 1] - MP[3 * p + 1], MP[3 * i + 2] - MP[3 * p + 2]);
    const v = isMoon(i) ? fmtDist(d) : nf3.format(d / AU) + ' ' + _('unit.au');
    if (el.textContent !== v) el.textContent = v;
  }
}
$('#ovBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const k = btn.closest('tr').dataset.k, act = btn.dataset.act;
  if (act === 'fold') { ovOpen.has(k) ? ovOpen.delete(k) : ovOpen.add(k); renderOverview(); clampWins(); $(`#ovBody tr[data-k="${k}"] [data-act=fold]`).focus(); }
  else if (act === 'center') centerBody(k);
  else pickBody(k, act);
});
// a mission body is followed in the mission view; any other body is centred on the map
function centerBody(k) {
  const i = S.bodies.findIndex(b => b.key === k);
  if (i >= 0 && sys) { setMap(false); followBody(i); }
  else { setMap(true); mapCenter(k); }
}

// Pick the departure or target body: the list becomes the two bodies plus the parents they need,
// in the real model (from the simplified model, departing today), with the Hohmann guess applied.
function pickBody(k, role) {
  if (solving) $('#solve').click(); // cancel a running solve: its result would belong to the old bodies
  const cur = S.bodies.map(b => b.key);
  toTransfer(); // a maneuver's body counts as the departure; the target picks a transfer
  if (cur.length < 2) cur.push(cur[0] === 'earth' ? 'moon' : 'earth');
  let a = role === 'dep' ? k : cur[0], b = role === 'tgt' ? k : cur[1];
  if (a === b) { if (role === 'dep') b = cur[0]; else a = cur[1]; } // picking the other role's body swaps them
  const eph = q => q && BODIES[q] && BODIES[q].gm;
  if (!eph(a)) a = b === 'earth' ? 'moon' : 'earth';
  if (!eph(b)) b = a === 'earth' ? 'moon' : 'earth';
  const ch = missionChain(a, b, q => BODIES[q].parent || null);
  if (ch.error) { setStatus(_(ch.error, { ...ch.params, a: _('body.' + a), b: _('body.' + b) })); return; }
  const switched = S.model !== 'real';
  if (switched) { S.model = 'real'; S.M.t0 = utcToDays(Math.floor(Date.now() / 60000) * 60000); }
  S.M.beta = 0; S.M.dep = 'burn'; S.M.tof = 0;
  S.bodies = ch.keys.map(q => bodyFromPreset(q)); linkReal();
  S.scenario = ''; $('#scenario').value = ''; $('#scNote').textContent = _('sc.pick.note');
  // a body and its own moon: rotating view (A–B line fixed); anything else: inertial, and a free return
  // (which only makes sense around a body's own moon) becomes an orbit insertion
  const pair = ch.parent[1] === 0 || ch.parent[0] === 1;
  S.frame = pair ? 'rot' : 'inertial'; S.follow = 'free';
  if (!pair && S.M.mode === 'free') S.M.mode = 'capture';
  openRows.clear(); ovReveal();
  syncModel(); renderBodies(); syncMission(); renderFrameSeg();
  rebuild({ fit: true, resetU: true });
  if (MAP.follow == null) MAP.needFit = true;
  const st = sys ? applyHohmann() : null;
  setStatus((switched ? _('st.pickReal') : '') + _('st.picked', { a: S.bodies[0].name, b: S.bodies[1].name }) + (st ? st + _('st.pickTail') : _('st.noHohmann')) + (sys && isSibling(sys) ? _('st.pickPc') : ''));
  if (!reduceMotion) S.playing = true;
  setPlayIcon();
}

// ===================== Render loop =====================
const SPo = new Float64Array(12), SVo = new Float64Array(12), RELo = new Array(6);
// craft position after the integrated span (t > C.T): the analytic orbit about its body
function orbitPos(t, out) {
  states(sys, S.M.t0 * DAY + t, SPo, SVo);
  const b = 3 * C.orbit.body; C.orbit.rel(t - C.T, RELo);
  out[0] = SPo[b] + RELo[0]; out[1] = SPo[b + 1] + RELo[1]; out[2] = SPo[b + 2] + RELo[2]; return out;
}
// Orbit trail after capture: the analytic orbit sampled trailK times per revolution (sample j at C.T + j·P/K),
// in the current view frame, for the last TRAIL_REVS revolutions. Samples are cached on C and only new ones are
// added each frame; a frame or quality change, or time running backwards, starts over.
function trailUpdate(ext) {
  const o = C.orbit, K = Q.trailK, dts = o.P / K, cap = TRAIL_REVS * K + 2;
  const jEnd = Math.floor(ext / dts), jStart = Math.max(0, jEnd - TRAIL_REVS * K), key = S.frame + '|' + K;
  let tr = C.trail;
  if (!tr || tr.key !== key || jEnd < tr.jHi || jStart > tr.jHi) {
    tr = C.trail = { key, dts, base: jStart, jLo: jStart, jHi: jStart - 1, x: new Float64Array(2 * cap), y: new Float64Array(2 * cap), z: new Float64Array(2 * cap) };
  }
  const p = [0, 0, 0], q = [0, 0, 0];
  for (let j = tr.jHi + 1; j <= jEnd; j++) {
    if (j - tr.base >= tr.x.length) { // full: move the samples still needed to the front
      const from = Math.max(tr.jLo, jStart) - tr.base, n = tr.jHi - tr.base + 1 - from;
      tr.x.copyWithin(0, from, from + n); tr.y.copyWithin(0, from, from + n); tr.z.copyWithin(0, from, from + n);
      tr.base += from; tr.jLo = tr.base;
    }
    const t = C.T + j * dts;
    frameAt(t); tf3(...orbitPos(t, p), q); // the 2D views use x, y; the 3D view also z
    tr.x[j - tr.base] = q[0]; tr.y[j - tr.base] = q[1]; tr.z[j - tr.base] = q[2];
  }
  tr.jHi = jEnd; tr.jLo = Math.max(tr.jLo, jStart);
}
// draw the trail up to the craft (cpos, frame coords); fading oldest revolutions in normal mode
function drawTrail(ext, cpos) {
  const tr = C.trail, P = C.orbit.P, K = Q.trailK; if (!tr || tr.jHi < tr.jLo) return;
  const i0 = tr.jLo - tr.base, i1 = tr.jHi - tr.base;
  ctx.lineWidth = 1.6;
  const fade = Q.trailFade, chunk = fade ? Math.max(4, K >> 4) : Infinity;
  for (let a = i0; a < i1; a += chunk) {
    const b = Math.min(i1, a + chunk), age = (ext - (tr.base + (a + b) / 2) * tr.dts) / P;
    const al = trailAlpha(age, fade); if (al <= 0) continue;
    ctx.strokeStyle = hexA(COL.traj, 0.9 * al);
    strokePath(tr.x, tr.y, a, b); ctx.stroke();
  }
  ctx.strokeStyle = hexA(COL.traj, 0.9);
  ctx.beginPath(); ctx.moveTo(sx(tr.x[i1]), sy(tr.y[i1])); ctx.lineTo(sx(cpos[0]), sy(cpos[1])); ctx.stroke();
}
let last = performance.now(), hold = 0, hudTick = 0, hudLast = 0, frameAvg = 1 / 60, slowFrames = 0, lowQ = false;
const tmp = [0, 0], tmp2 = [0, 0], tmp3 = [0, 0, 0];

// Clip each segment to the viewport (no giant coordinates reach the rasterizer)
// and drop sub-pixel steps (dense parking-orbit clusters collapse to a few vertices).
let CL0 = 0, CL1 = 1;
function clip(x0, y0, x1, y1, L, R, T, B) {
  let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
  const P = [-dx, dx, -dy, dy], Q = [x0 - L, R - x0, y0 - T, B - y0];
  for (let k = 0; k < 4; k++) {
    const p = P[k], q = Q[k];
    if (p === 0) { if (q < 0) return false; }
    else { const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } }
  }
  CL0 = t0; CL1 = t1; return true;
}
function strokePath(fx, fy, from, to) {
  ctx.beginPath();
  if (to <= from) return;
  const m = 30, L = -m, R = W + m, T = -m, B = H + m;
  let ex = sx(fx[from]), ey = sy(fy[from]), pen = false;
  for (let i = from + 1; i <= to; i++) {
    const x = sx(fx[i]), y = sy(fy[i]);
    const ddx = x - ex, ddy = y - ey;
    if (i < to && ddx * ddx + ddy * ddy < 0.8) continue;
    if (clip(ex, ey, x, y, L, R, T, B)) {
      const ax = ex + ddx * CL0, ay = ey + ddy * CL0, bx = ex + ddx * CL1, by = ey + ddy * CL1;
      if (!pen || CL0 > 0) ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      pen = CL1 >= 1;
    } else pen = false;
    ex = x; ey = y;
  }
  ctx.stroke();
}
// event marker at (x, y) px with its label pushed outward from (bx, by), where the event's body was;
// placed: label boxes of this frame (needs ctx.font = MARK_FONT)
function drawMark(m, x, y, bx, by, reached, placed) {
  if (x < -50 || x > W + 50 || y < -50 || y > H + 50) return;
  const col = m.type === 'burn' ? COL.burn : m.type === 'impact' ? COL.bad : m.type === 'aero' ? COL.warn : COL.orbit;
  ctx.globalAlpha = reached ? 1 : 0.55;
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.4;
  if (m.type === 'burn') { ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.2832); ctx.fill(); ctx.strokeStyle = 'rgba(4,6,11,0.9)'; ctx.lineWidth = 1.2; ctx.stroke(); }
  ctx.fillStyle = hexA(col, reached ? 0.95 : 0.6);
  // push label outward from the body the event belongs to (where it was at the event, as fit() assumes)
  let ox = x - bx, oy = y - by; let ol = Math.hypot(ox, oy);
  if (ol < 1) { ox = 1; oy = -1; ol = Math.SQRT2; }
  ox /= ol; oy /= ol;
  const { tw, lines, lw } = markLines(m), lh = lines.length * MARK_LH;
  let lx = x + ox * 14 + (ox < -0.3 ? -tw : ox < 0.3 ? -tw / 2 : 0), ly = y + markBase(oy, lines.length);
  // inside the fitted free area when the marker is, so a label never slides under a window; else on screen
  const q = FITQ && x > FITQ.l && x < W - FITQ.r && y > FITQ.t && y < H - FITQ.b ? FITQ : { l: 0, r: 0 };
  lx = clamp(lx, q.l + 6, W - q.r - tw - 6);
  // avoid stacking labels of coincident events (e.g. perilune + capture burn)
  for (let guard = 0; guard < 6 && placed.some(q => lx < q[0] + q[2] && lx + tw > q[0] && ly < q[1] + q[3] && ly + lh > q[1]); guard++) ly += oy >= 0 ? 14 : -14;
  placed.push([lx, ly, tw, lh]);
  // lines line up on the side facing the marker
  lines.forEach((t, j) => ctx.fillText(t, lx + (ox < -0.3 ? tw - lw[j] : ox < 0.3 ? (tw - lw[j]) / 2 : 0), ly + j * MARK_LH));
  ctx.globalAlpha = 1;
}
// lit (textured) globe of mission body b at (x, y), r px, in the normal 2D mode; false: draw the plain disc
function globe2d(b, sunIdx, x, y, r, tNow) {
  const o = bodyLook3(b, r, tNow); if (!o) return false;
  return drawGlobe(ctx, x, y, r, W, H, DPR, { rot: o.rot, sun: sunDir3(b, sunIdx, tNow, [0, 0, 0]), color: S.bodies[b].color, look: o.look });
}
// the same on the map (ecliptic axes, lit from the Sun at the origin; after states(mapSys, T, …))
function globeMap(i, x, y, r, T) {
  const look = globeLook(MAPK[i], r, Q.tex, !lowQ, texCap(), FXON, T); if (!look) return false;
  const p = [hx(i), hy(i), MP[3 * i + 2] - MP[3 * MSUN + 2]], l = Math.hypot(...p) || 1;
  return drawGlobe(ctx, x, y, r, W, H, DPR, { rot: bodyAxes(MAPK[i], T, MP, MV, i, MPAR[i], new Array(9)), sun: p.map(c => -c / l), color: BODIES[MAPK[i]].color, look });
}
// the Sun's glare in 2D (normal mode): the same profile as in 3D, drawn additively
function glare2d(x, y, rs) {
  if (!FXON.glare) return;
  const L = glareL(rs), e = L * GLARE_EXT;
  if (x + e < 0 || x - e > W || y + e < 0 || y - e > H) return;
  ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glareSprite(), x - e, y - e, 2 * e, 2 * e); ctx.globalCompositeOperation = 'source-over';
}
const _txt = new Map();
function setT(sel, v) { if (_txt.get(sel) !== v) { _txt.set(sel, v); document.querySelector(sel).textContent = v; } }
const _hx = new Map();
function hexA(hex, a) { const k = hex + a; let v = _hx.get(k); if (!v) { v = hexA0(hex, a); _hx.set(k, v); } return v; }
function hexA0(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }

function draw(now) {
  // frame cap (low-resource mode); the small slack keeps 60 Hz displays at an even 30 fps
  if (Q.fpsCap && now - last < 1000 / Q.fpsCap - 4) { requestAnimationFrame(draw); return; }
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // adaptive quality (normal and 3D modes): if frames stay slow, the ladder (FX) turns effects off one step at a time,
  // then drops glow, renders at 1x pixel ratio and suggests a lighter mode
  if (MODE !== 'low' && !lowQ) {
    frameAvg = frameAvg * 0.95 + dt * 0.05;
    if (frameAvg > 0.03 && ++slowFrames > 90) {
      slowFrames = 0; frameAvg = 1 / 60;
      if (FX.lvl < 3) fxSet(FX.lvl + 1); else { lowQ = true; resize(); showPerfTip(); }
    }
  }
  const glow = Q.glow && !lowQ;
  HITS = []; CAPTION.length = 0;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const v3 = is3d(); // 3D: the WebGL canvas below draws the scene, this one only the overlay
  if (v3) ctx.clearRect(0, 0, W, H);
  else {
    // the sky: built once the map and stars are in, again when the sharper map tier arrives; dimmed by the eye adaptation
    // (alpha on sRGB values ≈ the linear gain^(1/2.2))
    if (Q.stars && !skyTimer && (skyKey === 'wait' || stars)) { const sk = skyReady(true, skyHi(skyPx2d())); if (sk && (skyKey === 'wait' || sk.milky.img.naturalWidth !== +skyKey.split('|')[3])) makeStars(); }
    ctx.fillStyle = COL.void; ctx.fillRect(0, 0, W, H);
    if (stars) { ctx.globalAlpha = Math.pow(SKYU.adapt, 1 / 2.2); ctx.drawImage(stars, 0, 0, W, H); ctx.globalAlpha = 1; }
  }
  if (!sys || !simR || !C) {
    if (MAP.on) { if (v3) drawMap3(mapTime(0), glow, null, 0, 0); else { drawMap(mapTime(0), glow, null, 0, 0); if (!MAP.log) drawScale(); } }
    else if (v3) { V3.setActive('none'); V3.render({ stars: Q.stars, skyGain: skyGain() }); }
    skyAdapt(dt); frameEnd(); requestAnimationFrame(draw); return;
  }
  if (S.kind === 'man' && !MAP.on) { CAPTION.push(_('mv.caption')); setCaption(); } // before fitting: an obstacle
  if (!v3) frameCache();
  if (needFit && !MAP.on && !v3) fit(); // 3D: draw3d fits once its caption is in place

  if (S.playing && !scrubbing) {
    if (S.u >= 1) {
      if (S.loop) { hold += dt; if (hold > 1.6) { S.u = 0; S.ext = 0; hold = 0; } }
      else if (C.orbit) S.ext += dt * (S.rate || S.speed * C.orbit.P / 8);
      else { S.playing = false; setPlayIcon(); }
    } else if (S.rate) { const tn = uToT(S.u) + dt * S.rate; S.u = tn >= C.T ? 1 : Math.max(S.u, tToU(tn)); }
    else S.u = Math.min(1, S.u + dt * S.speed / 30);
  }
  if (S.u < 1) S.ext = 0;
  const ext = S.ext > 0 && C.orbit;
  const [si, sf] = uToSeg(S.u);
  const segH = simR.t[si + 1] - simR.t[si];
  const tNow = ext ? C.T + S.ext : simR.t[si] + (segH > 0 ? sf * segH : 0);
  tNowG = tNow;
  const craft = ext ? orbitPos(tNow, [0, 0, 0]) : segH > 0 ? herm(si, sf, [0, 0, 0]) : [simR.x[si + 1], simR.y[si + 1], simR.z[si + 1]];
  const pathIdx = ext ? C.pt.length - 1 : Math.min(C.pt.length - 1, C.segStart[si] + Math.floor(sf * (segH > 0 ? C.sub : 0)));
  // a point a little later: the craft's velocity direction (finite difference)
  const dtv = ext ? C.orbit.P / 300 : Math.max(1, (segH > 0 ? segH : 60) * 0.02);
  const t2 = ext ? tNow + dtv : Math.min(C.T, tNow + dtv);
  const craft2 = ext ? orbitPos(t2, [0, 0, 0]) : posAtTime(t2, [0, 0, 0]);

  if (v3) { if (MAP.on) drawMap3(mapTime(tNow), glow, craft, tNow, pathIdx); else draw3d(tNow, craft, craft2, t2, pathIdx, ext, glow); }
  else {
    // body states & frame at current time
    frameAt(tNow);
    const N = sys.N, bpos = [];
    for (let b = 0; b < N; b++) { tf(SP[3 * b], SP[3 * b + 1], SP[3 * b + 2], tmp); bpos.push([tmp[0], tmp[1]]); }
    const cpos = tf(craft[0], craft[1], craft[2], [0, 0]);
    frameAt(t2); const cpos2 = tf(craft2[0], craft2[1], craft2[2], [0, 0]);
    if (ext && !MAP.on) trailUpdate(S.ext);
    frameAt(tNow);

    if (MAP.on) { /* the map has its own camera and follow */ }
    else if (S.follow === 'craft') { cam.cx = cpos[0]; cam.cy = cpos[1]; }
    else if (S.follow === 'A') { cam.cx = bpos[0][0]; cam.cy = bpos[0][1]; }
    else if (S.follow === 'B') { cam.cx = bpos[1][0]; cam.cy = bpos[1][1]; }
    else if (S.follow[0] === 'b' && bpos[+S.follow.slice(1)]) { const p = bpos[+S.follow.slice(1)]; cam.cx = p[0]; cam.cy = p[1]; }

    if (MAP.on) drawMap(mapTime(tNow), glow, craft, tNow, pathIdx);
    else {
      // orbits (non-rotating frames): circles in the simplified model, projected ellipses in the real one
      ctx.lineWidth = 1;
      if (S.frame !== 'rot') {
        const diag = Math.hypot(W, H);
        for (let b = 0; b < N; b++) {
          const p = sys.parent[b]; if (p < 0) continue;
          const ell = C.ell[b];
          const r = (ell ? sys.a[b] : Math.hypot(bpos[b][0] - bpos[p][0], bpos[b][1] - bpos[p][1])) * cam.scale;
          if (r < 4 || r > 1e5) continue;
          const cx0 = sx(bpos[p][0]), cy0 = sy(bpos[p][1]), dc = Math.hypot(cx0 - W / 2, cy0 - H / 2), ro = ell ? r * 1.3 : r;
          if (dc - ro > diag / 2 || (ell ? r * 0.7 : r) - dc > diag / 2) continue; // entirely off-screen
          ctx.setLineDash(r < 1500 ? [3, 5] : []);
          ctx.strokeStyle = hexA(S.bodies[b].color, r < 1500 ? 0.2 : 0.12);
          ctx.beginPath();
          if (ell) { for (let k = 0; k < ell.length; k += 2) { const x = cx0 + ell[k] * cam.scale, y = cy0 - ell[k + 1] * cam.scale; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); }
          else ctx.arc(cx0, cy0, r, 0, 6.2832);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      // maneuvers: the initial and the target orbit about the body
      for (let g = 0; g < C.ring2.length; g++) {
        const e = C.ring2[g], st = C.rings[g], cx0 = sx(bpos[0][0]), cy0 = sy(bpos[0][1]), s = cam.scale;
        ctx.strokeStyle = hexA(st.col, st.a); ctx.lineWidth = 1; ctx.setLineDash(st.dash ? [5, 5] : []);
        ctx.beginPath();
        for (let k = 0; k < e.length; k += 2) { const x = cx0 + e[k] * s, y = cy0 - e[k + 1] * s; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.setLineDash([]);
      // body tracks over the mission
      if (S.tracks) {
        ctx.lineWidth = 1.2;
        for (let b = 0; b < N; b++) {
          const tr = C.tracks[b]; ctx.strokeStyle = hexA(S.bodies[b].color, 0.38);
          ctx.beginPath();
          for (let k = 0; k < tr.length; k += 2) { const x = sx(tr[k]), y = sy(tr[k + 1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.stroke();
        }
      }
      // SOI
      if (S.soi) {
        ctx.setLineDash([1.5, 4]); ctx.strokeStyle = hexA(COL.dim, 0.5); ctx.lineWidth = 1;
        for (let b = 0; b < N; b++) {
          if (!isFinite(sys.soi[b])) continue;
          const r = sys.soi[b] * cam.scale; if (r < 3 || r > 1e5) continue;
          ctx.beginPath(); ctx.arc(sx(bpos[b][0]), sy(bpos[b][1]), r, 0, 6.2832); ctx.stroke();
          if (r > 30) { ctx.fillStyle = hexA(COL.dim, 0.7); ctx.font = '500 10px ' + 'IBM Plex Mono, monospace'; ctx.fillText(_('canvas.soi'), sx(bpos[b][0]) + r * 0.707 + 4, sy(bpos[b][1]) - r * 0.707 - 4); }
        }
        ctx.setLineDash([]);
      }
      // trajectory
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = hexA(COL.traj, 0.26); ctx.lineWidth = 1.2;
      strokePath(C.fx, C.fy, 0, C.fx.length - 1);
      for (const [lw, col] of (glow ? [[6, hexA(COL.traj, 0.16)], [1.8, COL.traj]] : [[1.8, COL.traj]])) {
        ctx.strokeStyle = col; ctx.lineWidth = lw;
        strokePath(C.fx, C.fy, 0, pathIdx);
        // up to the craft between samples; after the integrated span the trail takes over
        if (!ext) { ctx.beginPath(); ctx.moveTo(sx(C.fx[pathIdx]), sy(C.fy[pathIdx])); ctx.lineTo(sx(cpos[0]), sy(cpos[1])); }
        ctx.stroke();
      }
      if (ext) drawTrail(S.ext, cpos);
      // finite burns: the engine-on arcs (reached ones bright, the rest faint)
      for (const [i0, i1] of C.burnIdx || []) {
        if (pathIdx > i0) { ctx.strokeStyle = COL.burn; ctx.lineWidth = 2.6; strokePath(C.fx, C.fy, i0, Math.min(i1, pathIdx)); }
        if (i1 > pathIdx) { ctx.strokeStyle = hexA(COL.burn, 0.4); ctx.lineWidth = 2; strokePath(C.fx, C.fy, Math.max(i0, pathIdx), i1); }
      }
      // where the integrated mission ends (orbit insertion, or the mission complete), once reached
      if (S.u >= 1) {
        const e = C.fx.length - 1, x = sx(C.fx[e]), y = sy(C.fy[e]);
        ctx.fillStyle = COL.traj; ctx.strokeStyle = 'rgba(4,6,11,0.9)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 6.2832); ctx.fill(); ctx.stroke();
      }

      if (ext && C.orbit.ring) {
        // the parking orbit around its body, projected (an ellipse when its plane is tilted to the view)
        const rr = C.orbit.r * cam.scale;
        if (rr > 2 && rr < 1e5) {
          const p = C.orbit.ring, X = FP.X, Y = FP.Y, b = C.orbit.body, cx0 = sx(bpos[b][0]), cy0 = sy(bpos[b][1]), s = cam.scale;
          ctx.strokeStyle = hexA(COL.traj, 0.3); ctx.lineWidth = 1.2; ctx.beginPath();
          for (let j = 0; j < p.length; j += 3) {
            const x = cx0 + (p[j] * X[0] + p[j + 1] * X[1] + p[j + 2] * X[2]) * s, y = cy0 - (p[j] * Y[0] + p[j + 1] * Y[1] + p[j + 2] * Y[2]) * s;
            j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.closePath(); ctx.stroke();
        }
      }
      // markers
      ctx.font = MARK_FONT;
      const placed = [];
      for (const m of C.markers) drawMark(m, sx(m.fx), sy(m.fy), sx(m.bfx), sy(m.bfy), m.t <= tNow + 1e-6, placed);

      // bodies
      /*bodies*/
      const sunIdx = S.bodies.findIndex(b => b.key === 'sun');
      for (const b of [...Array(N).keys()].sort((p, q) => sys.R[q] - sys.R[p])) {
        const x = sx(bpos[b][0]), y = sy(bpos[b][1]);
        const isSun = S.bodies[b].key === 'sun';
        const minR = b < 2 ? 5 : 4;
        const r = Math.max(minR, sys.R[b] * cam.scale);
        if (x + r < -60 || x - r > W + 60 || y + r < -60 || y - r > H + 60) continue;
        addHit('b', b, x, y, r);
        if (isSun) skySun(x > 0 && x < W && y > 0 && y < H ? 1 : 0, r); else skyLit(x, y, r, sunDir3(b, sunIdx, tNow, tmp3)[2], S.bodies[b].key, !!BODIES[S.bodies[b].key].rings);
        const col = S.bodies[b].color;
        if (!Q.glow) { // low-resource: flat discs, no gradients
          ctx.fillStyle = isSun ? '#fff3d6' : col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        } else if (isSun) {
          ctx.fillStyle = '#fff3d6'; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
          if (glow) glare2d(x, y, r);
        } else if (!globe2d(b, sunIdx, x, y, r, tNow)) {
          let lx = -0.6, ly = -0.8;
          if (sunIdx >= 0) { const dx = sx(bpos[sunIdx][0]) - x, dy = sy(bpos[sunIdx][1]) - y, d = Math.hypot(dx, dy); if (d > 0) { lx = dx / d; ly = dy / d; } }
          const g = ctx.createRadialGradient(x + lx * r * 0.45, y + ly * r * 0.45, r * 0.1, x, y, r * 1.05);
          g.addColorStop(0, col); g.addColorStop(0.65, hexA(col, 0.75)); g.addColorStop(1, 'rgba(8,10,18,0.95)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
          ctx.strokeStyle = hexA(col, 0.35); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 6.2832); ctx.stroke();
        }
        ctx.font = '600 11px "Chakra Petch", system-ui, sans-serif';
        ctx.fillStyle = hexA(COL.ink, 0.82);
        ctx.fillText(S.bodies[b].name.toLocaleUpperCase(DICT['meta.locale']), x + r + 7, y + r + 12);
      }

      // spacecraft
      {
        const x = sx(cpos[0]), y = sy(cpos[1]);
        addHit('c', 0, x, y, 3.2);
        if (Q.glow) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
          g.addColorStop(0, hexA(COL.traj, 0.6)); g.addColorStop(1, hexA(COL.traj, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.2832); ctx.fill();
        } else { ctx.strokeStyle = COL.traj; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.2832); ctx.stroke(); }
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.2832); ctx.fill();
        const td = !ext ? thrustNow(tNow, craft) : null;
        if (td) { // the thrust direction while the engine burns, in the view plane
          const X = FP.X, Y = FP.Y, ax = td[0] * X[0] + td[1] * X[1] + td[2] * X[2], ay = -(td[0] * Y[0] + td[1] * Y[1] + td[2] * Y[2]);
          arrow(x, y, ax, ay, COL.burn, 34);
        }
        const vx = sx(cpos2[0]) - x, vy = sy(cpos2[1]) - y, vl = Math.hypot(vx, vy);
        if (vl > 1e-6) {
          const ux = vx / vl, uy = vy / vl, L = 22;
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x + ux * 6, y + uy * 6); ctx.lineTo(x + ux * L, y + uy * L); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + ux * L, y + uy * L); ctx.lineTo(x + ux * (L - 5) - uy * 3.5, y + uy * (L - 5) + ux * 3.5); ctx.lineTo(x + ux * (L - 5) + uy * 3.5, y + uy * (L - 5) - ux * 3.5); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
        }
      }
    }

    if (!(MAP.on && MAP.log)) drawScale();
  }

  // HUD text
  if (Q.hudMs ? now - hudLast >= Q.hudMs : (hudTick++ & 3) === 0) {
    hudLast = now;
    const absX = craft[0], absY = craft[1], absZ = craft[2];
    states(sys, S.M.t0 * DAY + tNow, SP, SV);
    const dA = Math.hypot(absX - SP[0], absY - SP[1], absZ - SP[2]), dB = Math.hypot(absX - SP[3], absY - SP[4], absZ - SP[5]);
    const i2 = segAtTime(tNow), h2 = simR.t[i2 + 1] - simR.t[i2], f2 = h2 > 0 ? clamp((tNow - simR.t[i2]) / h2, 0, 1) : 1;
    const hv = h2 > 0 ? hermV(i2, f2, [0, 0, 0]) : [simR.vx[i2 + 1], simR.vy[i2 + 1], simR.vz[i2 + 1]];
    let vx = hv[0], vy = hv[1], vz = hv[2];
    if (ext) { // the analytic orbit about its body
      const b = 3 * C.orbit.body; C.orbit.rel(tNow - C.T, RELo);
      vx = SV[b] + RELo[3]; vy = SV[b + 1] + RELo[4]; vz = SV[b + 2] + RELo[5];
    }
    const A = S.bodies[0].name;
    setT('#r-t', _('hud.tplus', { t: fmtDur(tNow, true) }));
    setT('#tplus', _('hud.tplus', { t: fmtDur(tNow, true) }));
    if (S.model === 'real') setT('#r-date', fmtDate(dateAt(tNow)));
    const row4 = S.kind === 'man' && !!(MAN && simR.m); // the mass row: flights with an engine
    if ($('#r-l4').hidden === row4) $('#r-l4').hidden = $('#r-v4').hidden = !row4;
    if (S.kind === 'man' && MAN) { // altitude above the equatorial radius, speed, osculating apsis altitudes
      const rr = [absX - SP[0], absY - SP[1], absZ - SP[2]], vv = [vx - SV[0], vy - SV[1], vz - SV[2]], el = rv2el(MAN.mu, rr, vv);
      setT('#r-l1', _('hud.alt', { name: A })); setT('#r-v1', fmtDist(Math.max(0, dA - MAN.Re)));
      setT('#r-l2', _('hud.rel', { name: A })); setT('#r-v2', fmtSpeed(Math.hypot(...vv)));
      setT('#r-l3', _('hud.osc'));
      setT('#r-v3', el.a > 0 && el.e < 1 ? nf0.format((el.rp - MAN.Re) / 1e3) + ' × ' + nf0.format((el.ra - MAN.Re) / 1e3) + ' km' : '—');
      const m = ext ? (simR.mEnd || NaN) : massAt(tNow); // finite flights: the mass, and whether the engine burns
      setT('#r-l4', _(!ext && burnAt(tNow) >= 0 ? 'hud.massOn' : 'hud.mass')); setT('#r-v4', Number.isFinite(m) ? nf1.format(m) + ' kg' : '—');
    } else {
      const B = S.bodies[1].name, near = dB - sys.R[1] < dA - sys.R[0] ? 1 : 0;
      setT('#r-l1', _('hud.alt', { name: A })); setT('#r-v1', fmtDist(Math.max(0, dA - sys.R[0])));
      setT('#r-l2', _('hud.alt', { name: B })); setT('#r-v2', fmtDist(Math.max(0, dB - sys.R[1])));
      setT('#r-l3', _('hud.rel', { name: near ? B : A }));
      setT('#r-v3', fmtSpeed(Math.hypot(vx - SV[3 * near], vy - SV[3 * near + 1], vz - SV[3 * near + 2])));
    }
    setT('#tend', '/ ' + fmtDur(C.T) + (ext ? _('hud.lap', { n: 1 + Math.floor(S.ext / C.orbit.P) }) : ''));
    if (!scrubbing) scrub.value = Math.round(S.u * 10000);
  }
  if (now - ovLast > 500) { ovLast = now; ovDist(); }
  skyAdapt(dt);
  frameEnd();
  requestAnimationFrame(draw);
}

// scale bar, bottom-left of the free plot area
// scale: px per metre (3D: at the camera target's distance)
function drawScale(scale = cam.scale) {
  const { l, b: bot } = insets();
  const target = 110 / scale; const p = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map(k => k * p).reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
  const px = nice * scale, x0 = l + 8, y0 = H - bot - 4;
  ctx.strokeStyle = hexA(COL.dim, 0.9); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 5); ctx.stroke();
  ctx.fillStyle = COL.dim; ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillText(fmtDist(nice), x0 + 2, y0 - 8);
}

// ===================== Sources (credits) =====================
// Data sources, then every texture with its source, credit line and what was done to it, the licence notes of the
// sources used and the disclaimer. Built from js/bodies.js (TEX_SRC, DATA_SRC, tex / texAlt / rings) and cred.* texts.
// a body's image layers with the key of their note text (cred.note.*)
const credLayers = (k, b) => [[b.tex, 'cred.note.' + k], [b.texAlt, 'cred.note.' + k], [b.rings, 'cred.note.' + k + 'Rings'], [b.rings && b.rings.tau, 'cred.note.' + k + 'Tau'],
  [b.relief, 'cred.note.' + k + 'Relief'], [b.clouds, 'cred.note.' + k + 'Clouds'], [b.night, 'cred.note.' + k + 'Night'], [b.ocean, 'cred.note.' + k + 'Ocean']];
const link = (url, txt) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(txt)}</a>`;
function renderCredits() {
  const rows = [], used = new Set();
  for (const [k, b] of Object.entries(BODIES)) {
    for (const [t, note] of credLayers(k, b)) {
      if (!t) continue;
      used.add(t.src);
      rows.push(`<tr><td>${esc(_('body.' + k))}</td><td>${link(TEX_SRC[t.src], _('cred.src.' + t.src))}<br>${esc(_('cred.by.' + t.src))}</td><td>${esc(_(note))}</td></tr>`);
    }
  }
  for (const [id, t] of Object.entries(SKY)) { used.add(t.src); rows.push(`<tr><td>${esc(_('cred.sky.' + id))}</td><td>${link(TEX_SRC[t.src], _('cred.src.' + t.src))}<br>${esc(_('cred.by.' + t.src))}</td><td>${esc(_('cred.note.sky.' + id))}</td></tr>`); }
  rows.push(`<tr><td>${esc(_('cred.plainBodies'))}</td><td>—</td><td>${esc(_('cred.note.plain'))}</td></tr>`);
  $('#credBody').innerHTML = `<p>${esc(_('cred.intro'))}</p>
    <h3>${esc(_('cred.h.data'))}</h3>
    <ul>${Object.keys(DATA_SRC).map(k => `<li>${link(DATA_SRC[k], _('cred.data.' + k))}</li>`).join('')}</ul>
    <h3>${esc(_('cred.h.img'))}</h3>
    <table><thead><tr><th>${esc(_('cred.col.body'))}</th><th>${esc(_('cred.col.src'))}</th><th>${esc(_('cred.col.note'))}</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <label class="chk"><input type="checkbox" id="venusRadar"${TEXOPT.venusRadar ? ' checked' : ''}><span>${esc(_('cred.venusRadar'))}</span></label>
    <label class="chk"><input type="checkbox" id="earthClouds"${TEXOPT.clouds ? ' checked' : ''}><span>${esc(_('cred.clouds'))}</span></label>
    <h3>${esc(_('cred.h.lic'))}</h3>
    <ul>${[...used].map(s => `<li><b>${esc(_('cred.src.' + s))}</b>: ${esc(_('cred.lic.' + s))}</li>`).join('')}</ul>
    <p>${esc(_('cred.disclaimer'))}</p>`;
}
$('#credBody').addEventListener('change', e => {
  if (e.target.id === 'venusRadar') { TEXOPT.venusRadar = e.target.checked; writePref(LS, PREF_KEYS.venusRadar, e.target.checked ? '1' : '0'); }
  if (e.target.id === 'earthClouds') { TEXOPT.clouds = e.target.checked; writePref(LS, PREF_KEYS.clouds, e.target.checked ? '1' : '0'); }
});
TEXOPT.venusRadar = readPref(LS, PREF_KEYS.venusRadar) === '1';
TEXOPT.clouds = readPref(LS, PREF_KEYS.clouds) !== '0';

// ===================== Glossary =====================
const GLOSS = DICT['gloss'];
const APSIS_TABLE = Object.entries(APSIS).filter(([, v]) => v[1]).map(([k, v]) => [_('body.' + k), v[0], v[1]]);
function renderGloss(q) {
  const n = s => s.toLocaleLowerCase(DICT['meta.locale']).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const qq = n(q.trim());
  let html = '';
  for (const [grp, items] of GLOSS) {
    const rows = items.filter(it => {
      if (it[0] === '__APSIS__') return !qq || APSIS_TABLE.some(r => r.some(c => n(c).includes(qq)));
      return !qq || n(it.join(' ').replace(/<[^>]+>/g, '')).includes(qq);
    }).map(it => it[0] === '__APSIS__'
      ? `<div><table class="apsis"><thead><tr><th>${_('apsis.table.body')}</th><th>${_('apsis.table.near')}</th><th>${_('apsis.table.far')}</th></tr></thead><tbody>${APSIS_TABLE.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>`
      : `<div><dt>${it[0]}${it[1] ? `<i>${it[1]}</i>` : ''}</dt><dd>${it[2]}</dd></div>`).join('');
    if (rows) html += `<div class="gloss-grp"><span>${grp}</span><dl>${rows}</dl></div>`;
  }
  $('#glossBody').innerHTML = html || `<p class="none">${_('gloss.none')}</p>`;
}
$('#glossQ').addEventListener('input', e => renderGloss(e.target.value));

// ===================== Windows =====================
// Floating, draggable, collapsible windows on wide screens; stacked panels under the plot on narrow ones.
// Layout persists in localStorage. A null x/y means "default spot", recomputed on every layout change.
const mqFloat = window.matchMedia('(min-width: 861px)');
function floating() { return mqFloat.matches; }
// narrow desktop (~<1100 px): Results starts collapsed; wide (≥ 1440 px): the overview starts open, collapsed
// to its title bar below 1920 px.
// Neither touches a saved layout.
const narrowDesk = () => ({ narrow: window.matchMedia('(min-width: 861px) and (max-width: 1099px)').matches, wide: window.matchMedia('(min-width: 1440px)').matches, full: window.matchMedia('(min-width: 1920px)').matches });
const WINS = parseWins(readPref(LS, PREF_KEYS.wins), narrowDesk());
const ICON_MINUS = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7M6 2.5v7"/></svg>';
let zTop = 10;
const winEl = id => $('#w-' + id);
const railBtn = id => $(`.rail-btn[data-win="${id}"]`);
function saveWins() { writePref(LS, PREF_KEYS.wins, JSON.stringify(WINS)); }

// Default spots: mission top-left, results under the view controls on the right and the overview beside
// results (to its left, same top), so the centre stays clear and nothing overlaps the HUD or each other.
function defaultWinPos(id, el) {
  const box = $('#wins'), cw = box.clientWidth, ch = box.clientHeight, m = 12, w = el.offsetWidth;
  const cssW = k => parseFloat(getComputedStyle(winEl(k)).width) || 0;
  const below = $('#ctrls').getBoundingClientRect().bottom - box.getBoundingClientRect().top + 10;
  switch (id) {
    case 'mission': return [m, m];
    case 'bodies': case 'transfer': return [m + cssW('mission') + 10, m];
    case 'results': return [cw - w - m, below];
    case 'overview': return [cw - w - m - (WINS.results.open && floating() ? winEl('results').offsetWidth + 10 : 0), below];
    case 'gloss': return [cw - w - m - cssW('results') - 10, below];
    default: return [(cw - w) / 2, ch * 0.16];
  }
}
function placeWin(id) {
  const st = WINS[id], el = winEl(id), box = $('#wins');
  if (!st.open || !floating()) return;
  const def = st.x == null || st.y == null;
  let [x, y] = def ? defaultWinPos(id, el) : [st.x, st.y];
  // Results and the overview in their default spots get the height left under the view controls, down to the
  // readout / timeline (they scroll)
  if (id === 'overview' || id === 'results') {
    const ro = $('#readout').getBoundingClientRect(), bx = box.getBoundingClientRect();
    const readoutTop = ro.height && !$('#readout').hidden && ro.left < bx.left + x + el.offsetWidth && ro.right > bx.left + x ? ro.top - bx.top - 10 : Infinity;
    el.style.maxHeight = def ? Math.max(180, Math.min(box.clientHeight - 12, readoutTop) - y) + 'px' : '';
  }
  // pull inside the visible area; the saved spot is kept, so it comes back when the screen grows again
  [x, y] = clampWin(x, y, el.offsetWidth, el.offsetHeight, box.clientWidth, box.clientHeight);
  el.style.left = x + 'px'; el.style.top = y + 'px';
}
function clampWins() { for (const id of WIN_IDS) placeWin(id); INS = null; }
function applyWin(id) {
  const st = WINS[id], el = winEl(id), cb = el.querySelector('[data-act=collapse]');
  el.hidden = !st.open;
  el.classList.toggle('collapsed', st.collapsed);
  cb.innerHTML = st.collapsed ? ICON_PLUS : ICON_MINUS;
  cb.setAttribute('aria-label', _(st.collapsed ? 'win.expand' : 'win.collapse'));
  cb.setAttribute('aria-expanded', String(!st.collapsed));
  railBtn(id).setAttribute('aria-pressed', String(st.open));
  if (id === 'gloss' && st.open) renderGloss($('#glossQ').value);
  if (id === 'credits' && st.open) renderCredits();
  if (id === 'overview' && st.open) ovDist(true);
  placeWin(id);
  if (id === 'transfer' && st.open && !st.collapsed) pcSync();
}
function setWin(id, patch) {
  const wasOpen = WINS[id].open;
  Object.assign(WINS[id], patch);
  applyWin(id); saveWins(); INS = null;
  if (WINS[id].open && !wasOpen) {
    bringFront(winEl(id));
    if (id === 'gloss') $('#glossQ').focus({ preventScroll: true });
  }
}
function bringFront(el) { el.style.zIndex = ++zTop; }

document.querySelector('.rail').addEventListener('click', e => {
  const b = e.target.closest('[data-win]'); if (!b) return;
  setWin(b.dataset.win, { open: !WINS[b.dataset.win].open, collapsed: false });
});
$('#wins').addEventListener('click', e => {
  const b = e.target.closest('.wbtn'); if (!b) return;
  const id = b.closest('.win').dataset.win;
  if (b.dataset.act === 'collapse') setWin(id, { collapsed: !WINS[id].collapsed });
  else { setWin(id, { open: false }); railBtn(id).focus(); }
});
// drag by the title bar
$('#wins').addEventListener('pointerdown', e => {
  const win = e.target.closest('.win'); if (!win) return;
  if (floating()) bringFront(win);
  const head = e.target.closest('.win-h');
  if (!head || e.target.closest('button') || !floating() || e.button !== 0) return;
  e.preventDefault();
  const id = win.dataset.win, box = $('#wins');
  const ox = e.clientX - win.offsetLeft, oy = e.clientY - win.offsetTop;
  head.setPointerCapture(e.pointerId); win.classList.add('drag');
  const move = ev => {
    const [x, y] = clampWin(ev.clientX - ox, ev.clientY - oy, win.offsetWidth, win.offsetHeight, box.clientWidth, box.clientHeight);
    win.style.left = x + 'px'; win.style.top = y + 'px'; WINS[id].x = x; WINS[id].y = y;
  };
  const up = () => {
    head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
    win.classList.remove('drag'); saveWins(); INS = null;
  };
  head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
});
$('#resetWins').addEventListener('click', () => {
  clearPref(LS, PREF_KEYS.wins);
  Object.assign(WINS, defaultWins(narrowDesk()));
  for (const id of WIN_IDS) applyWin(id);
  INS = null; S.follow = 'free'; renderFrameSeg(); needFit = true; MAP.needFit = true;
});
// Esc closes the reference windows (glossary, model, sources) when focus is inside them
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const win = document.activeElement && document.activeElement.closest('.win');
  if (win && ['gloss', 'model', 'credits'].includes(win.dataset.win)) { setWin(win.dataset.win, { open: false }); railBtn(win.dataset.win).focus(); }
});
// buttons that open another window (Model -> Sources)
$('#wins').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) setWin(b.dataset.open, { open: true, collapsed: false }); });
// The view controls (focus tag, wrapping), Results (grows with the mission), the readout and the window area
// (timeline height) change size after first layout: re-place every window still at its default spot.
const roDefaults = new ResizeObserver(() => { for (const id of WIN_IDS) if (WINS[id].x == null || WINS[id].y == null) placeWin(id); INS = null; });
for (const el of [$('#ctrls'), $('#readout'), $('#wins'), winEl('results')]) roDefaults.observe(el);
// any window growing or shrinking (content, collapse) changes the free plot area
const roWins = new ResizeObserver(() => { INS = null; });
for (const id of WIN_IDS) roWins.observe(winEl(id));
roWins.observe($('#caption'));
mqFloat.addEventListener('change', () => { for (const id of WIN_IDS) applyWin(id); INS = null; needFit = true; });

// ===================== View mode =====================
let want3 = false;
function setMode(m, save) {
  if (!QUALITY[m]) return;
  want3 = m === '3d';
  if (m === '3d' && !V3) { want3d(save); return; } // Three.js arrives first; the current mode stays until then
  const flip = (m === '3d') !== (MODE === '3d');
  MODE = m; Q = QUALITY[m]; SUB = Q.sub;
  document.documentElement.dataset.q = m;
  if (m !== 'low') { lowQ = false; slowFrames = 0; frameAvg = 1 / 60; fxSet(0); }
  if (flip) { needFit = true; MAP.needFit = true; }
  sync3dUI();
  $('#tSkyWrap').hidden = !Q.stars;
  resize();
  if (sys && simR) { buildCache(); renderTicks(); }
  PC.base = null; pcSync(); // grid resolution and drawing follow the mode
  document.querySelectorAll('#viewMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === m)));
  if (save) writePref(LS, PREF_KEYS.mode, m);
  $('#perfTip').hidden = true;
}
// first pick of the 3D mode: fetch the renderer and Three.js (load3d); a failure leaves the 3D button disabled
function want3d(save) {
  if (!GL2 || V3fail) return;
  const em = $('#v3em'); em.hidden = false;
  load3d().then(() => { em.hidden = true; if (want3) setMode('3d', save); })
    .catch(e => { console.error(e); em.hidden = true; want3 = false; setStatus(_('mode.fail')); sync3dUI(); });
}
$('#viewMode').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  setMode(b.dataset.v, true);
});

// First visit: start in normal mode and ask once; either answer is remembered.
let perfTipPending = false, perfTipShown = false;
function askMode() {
  const d = $('#askDlg');
  const done = m => {
    setMode(m, true);
    if (d.open) d.close();
    if (perfTipPending && m === 'normal') showPerfTip();
  };
  $('#askLow').addEventListener('click', () => done('low'));
  $('#askNormal').addEventListener('click', () => done('normal'));
  d.addEventListener('cancel', e => { e.preventDefault(); done('normal'); });
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  $('#askNormal').focus();
}

// Non-modal suggestion when adaptive quality kicks in; at most once per session.
function showPerfTip() {
  if ($('#askDlg').open) { perfTipPending = true; return; }
  perfTipPending = false;
  if (MODE === 'low' || perfTipShown || readPref(SS, PREF_KEYS.perfTip)) return;
  perfTipShown = true; writePref(SS, PREF_KEYS.perfTip, '1');
  $('#perfText').textContent = _(MODE === '3d' ? 'perf.text3d' : 'perf.text');
  $('#perfTip').hidden = false;
}
$('#perfGo').addEventListener('click', () => setMode(MODE === '3d' ? 'normal' : 'low', true));
$('#perfX').addEventListener('click', () => { $('#perfTip').hidden = true; });

// ===================== Init =====================
applyI18n();
// scenarios grouped by model; the hidden empty option stands for a setup changed by switching the model
const scGroup = (m, key) => `<optgroup label="${esc(_(key))}">${SCENARIOS.filter(s => s.model === m).map(s => `<option value="${s.id}">${esc(_('sc.' + s.id + '.name'))}</option>`).join('')}</optgroup>`;
$('#scenario').innerHTML = `<option value="" hidden>${esc(_('sc.custom.name'))}</option>` + scGroup('simple', 'sc.group.simple') + scGroup('real', 'sc.group.real') + scGroup('man', 'sc.group.man');
$('#scenario').addEventListener('change', e => { if (e.target.value) loadScenario(e.target.value); });
$('#dateWarn').textContent = _('err.dateRange', { from: EPHEM_YEARS[0], to: EPHEM_YEARS[1] });
const start = startupMode(LS);
bind3d();
setMode(start.mode === '3d' ? 'normal' : start.mode, false);
if (start.mode === '3d') setMode('3d', false); // normal 2D until Three.js has loaded
loadScenario('em_free');
setPlayIcon();
syncMapUI();
setSeg('#pcMetric', PC.metric);
for (const id of WIN_IDS) applyWin(id);
if (start.ask) askMode();
requestAnimationFrame(t => { last = t; draw(t); });
