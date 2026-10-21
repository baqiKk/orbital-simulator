// ===================== Data =====================
const BODY_PRESETS = {
  sun:     { mass: 1.98847e30, radius: 695700,  parentKey: null,      a: 0,         color: '#ffd27a' },
  mercury: { mass: 3.3011e23,  radius: 2439.7,  parentKey: 'sun',     a: 57909050,  color: '#a9a49c' },
  venus:   { mass: 4.8675e24,  radius: 6051.8,  parentKey: 'sun',     a: 108210000, color: '#e8c98f' },
  earth:   { mass: 5.9722e24,  radius: 6371,    parentKey: 'sun',     a: 149598000, color: '#5b9cf0' },
  moon:    { mass: 7.342e22,   radius: 1737.4,  parentKey: 'earth',   a: 384400,    color: '#cbc8bf' },
  mars:    { mass: 6.4171e23,  radius: 3389.5,  parentKey: 'sun',     a: 227939000, color: '#e0703f' },
  phobos:  { mass: 1.0659e16,  radius: 11.27,   parentKey: 'mars',    a: 9376,      color: '#a08f7e' },
  jupiter: { mass: 1.89813e27, radius: 69911,   parentKey: 'sun',     a: 778570000, color: '#d9b48c' },
  europa:  { mass: 4.7998e22,  radius: 1560.8,  parentKey: 'jupiter', a: 671034,    color: '#d4c7ad' },
  custom:  { mass: 1e23,    radius: 2000,    parentKey: undefined, a: 500000,    color: '#b590f2' },
};
const PRESET_ORDER = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'phobos', 'jupiter', 'europa', 'custom'];

const SCENARIOS = [
  { id: 'em_free', frame: 'rot',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }],
    M: { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: 0, theta: -132.26090326368262, dv: 3162.1420118609917, autoDur: true, duration: 12 } },
  { id: 'em_cap', frame: 'A',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }],
    M: { mode: 'capture', side: -1, h0: 185, hB: 100, hRet: 60, t0: 0, theta: -122.6404245345841, dv: 3141.0061695917125, autoDur: true, duration: 7 } },
  { id: 'em_sun', frame: 'rot',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }, { k: 'sun', parent: 0, a: 149598000, phase: 90 }],
    M: { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: 0, theta: -132.31541604192466, dv: 3161.2744423190697, autoDur: true, duration: 12 } },
  { id: 'e_mars', frame: 'inertial',
    bodies: [{ k: 'earth', parent: 2 }, { k: 'mars', parent: 2 }, { k: 'sun', parent: -1 }],
    M: { mode: 'capture', side: 0, h0: 185, hB: 300, hRet: 60, t0: 685.7782603563348, theta: -150.0725460254747, dv: 3615.9489071591897, autoDur: true, duration: 336 } },
  { id: 'moon_mars', frame: 'inertial',
    bodies: [{ k: 'moon', parent: 2 }, { k: 'mars', parent: 3 }, { k: 'earth', parent: 3 }, { k: 'sun', parent: -1 }],
    M: { mode: 'capture', side: 0, h0: 100, hB: 300, hRet: 60, t0: 677.8485252280739, theta: -103.79516935006063, dv: 1591.5641379638673, autoDur: true, duration: 336 } },
  { id: 'e_venus', frame: 'inertial',
    bodies: [{ k: 'earth', parent: 2 }, { k: 'venus', parent: 2 }, { k: 'sun', parent: -1 }],
    M: { mode: 'flyby', side: 0, h0: 185, hB: 500, hRet: 60, t0: 500.5162440898973, theta: -114.42780944038475, dv: 3508.1053919040405, autoDur: true, duration: 220 } },
];

// ===================== State =====================
const S = { loop: false, ext: 0, bodies: [], M: {}, frame: 'rot', follow: 'free', soi: false, tracks: true, focus: true, speed: 1, playing: true, u: 0, scenario: 'em_free' };
let sys = null, simR = null, guess = null, C = null;
const cam = { cx: 0, cy: 0, scale: 1e-6 };
let needFit = true, solving = false, cancelSolve = false;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduceMotion) S.playing = false;

// View-mode quality profiles. sub: Hermite sub-samples per integrator step; trackK: body-track points;
// hudMs: HUD text refresh period (0 = every 4th frame); fpsCap: 0 = display rate.
const QUALITY = {
  normal: { stars: true, glow: true, dprMax: 1.5, fpsCap: 0, sub: 5, trackK: 420, hudMs: 0 },
  low:    { stars: false, glow: false, dprMax: 1, fpsCap: 30, sub: 2, trackK: 140, hudMs: 250 },
};
let MODE = 'normal', Q = QUALITY.normal;
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
function fmtMass(m) { return m.toExponential(4).replace('e+', 'e'); }
function massHint(m) {
  const e = m / 5.9722e24;
  if (e >= 1000) return '≈ ' + nf0.format(e) + ' M⊕';
  if (e >= 0.001) return '≈ ' + NF(e < 1 ? 4 : 2).format(e) + ' M⊕';
  return '≈ ' + e.toExponential(2) + ' M⊕';
}

function bodyFromPreset(k, over = {}) {
  const p = BODY_PRESETS[k];
  return { key: k, name: _('body.' + k), mass: p.mass, radius: p.radius, parent: -1, a: p.a, phase: 0, color: p.color, ...over };
}

// ===================== Scenario =====================
function loadScenario(id) {
  const sc = SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
  S.scenario = sc.id;
  S.bodies = sc.bodies.map(b => bodyFromPreset(b.k, { parent: b.parent, ...(b.a != null ? { a: b.a } : {}), phase: b.phase || 0 }));
  S.M = { ...sc.M };
  S.frame = sc.frame; S.follow = 'free';
  openRows.clear();
  $('#scenario').value = sc.id;
  $('#scNote').textContent = _('sc.' + sc.id + '.note');
  renderBodies(); syncMission(); renderFrameSeg();
  rebuild({ fit: true, resetU: true });
  setStatus('');
  if (!reduceMotion) S.playing = true;
  setPlayIcon();
}

// ===================== Body rows =====================
// Overview-style rows (colour, preset, role, parent); the editable fields fold out per row.
const openRows = new Set();
const ICON_CHEV = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';
const ICON_X = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9"/></svg>';
function renderBodies() {
  const box = $('#bodies');
  const N = S.bodies.length;
  box.innerHTML = S.bodies.map((b, i) => {
    const role = i === 0 ? `<span class="role dep">${_('body.role.dep')}</span>` : i === 1 ? `<span class="role tgt">${_('body.role.tgt')}</span>` : `<span class="role">${_('body.role.extra')}</span>`;
    const opts = PRESET_ORDER.map(k => `<option value="${k}" ${k === b.key ? 'selected' : ''}>${_('body.' + k)}</option>`).join('');
    const pOpts = `<option value="-1" ${b.parent < 0 ? 'selected' : ''}>${_('body.parentRoot')}</option>` +
      S.bodies.map((o, j) => j === i ? '' : `<option value="${j}" ${b.parent === j ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
    const par = esc(b.parent < 0 ? _('body.parentRoot') : _('body.orbits', { parent: S.bodies[b.parent].name }));
    const open = openRows.has(i);
    // natural-parent hint (only for orbiting bodies placed around a non-natural parent)
    const pk = BODY_PRESETS[b.key].parentKey;
    let hint = '';
    if (pk && b.parent >= 0 && S.bodies[b.parent].key !== pk && !S.bodies.some(o => o.key === pk)) {
      const pn = _('body.' + pk);
      hint = `<p class="hint">${_('body.hint', { name: esc(b.name), parent: pn })}${N < 4 ? ` <button type="button" class="linkbtn" data-act="addparent" data-k="${pk}">${_('body.hintAdd', { parent: pn })}</button>` : ''}</p>`;
    }
    return `<div class="brow" data-i="${i}">
      <div class="brow-h"><span class="dot" style="background:${b.color}"></span>
        <select data-f="key" aria-label="${_('body.select')}">${opts}</select>${role}
        <span class="par" title="${par}">${par}</span>
        <button type="button" class="ibtn" data-act="toggle" aria-expanded="${open}" aria-controls="brow-b${i}" aria-label="${esc(_('body.details', { name: b.name }))}">${ICON_CHEV}</button>
        ${i >= 2 ? `<button type="button" class="ibtn x" data-act="remove" aria-label="${_('body.remove')}">${ICON_X}</button>` : '<span></span>'}</div>
      <div class="brow-b" id="brow-b${i}" ${open ? '' : 'hidden'}>
        ${b.key === 'custom' ? `<label class="field"><span>${_('body.name')}</span><input type="text" data-f="name" value="${esc(b.name)}"></label>` : ''}
        <div class="grid2">
          <label class="field"><span>${_('body.mass')}</span><input type="text" inputmode="decimal" data-f="mass" value="${fmtMass(b.mass)}"><small data-hint="mass">${massHint(b.mass)}</small></label>
          <label class="field"><span>${_('body.radius')}</span><input type="number" step="any" data-f="radius" value="${b.radius}"></label>
          <label class="field"><span>${_('body.parent')}</span><select data-f="parent">${pOpts}</select></label>
          <label class="field"><span>${_('body.a')}</span><input type="number" step="any" data-f="a" value="${b.a}" ${b.parent < 0 ? 'disabled' : ''}></label>
          <label class="field"><span>${_('body.phase')}</span><input type="number" step="any" data-f="phase" value="${b.phase}" ${b.parent < 0 ? 'disabled' : ''}></label>
        </div>
      </div>${hint}
    </div>`;
  }).join('');
  $('#addBody').hidden = N >= 4;
}

function applyPreset(i, k) {
  const p = BODY_PRESETS[k], b = S.bodies[i];
  Object.assign(b, { key: k, name: _('body.' + k), mass: p.mass, radius: p.radius, color: p.color });
  if (p.parentKey === null) {
    // a star: becomes the fixed centre; previous centre now orbits it
    const r = S.bodies.findIndex((o, j) => j !== i && o.parent < 0);
    if (r >= 0) {
      const rb = S.bodies[r];
      rb.parent = i;
      rb.a = BODY_PRESETS[rb.key].parentKey === k || BODY_PRESETS[rb.key].parentKey === 'sun' ? BODY_PRESETS[rb.key].a : 149598000;
    }
    b.parent = -1;
  } else if (p.parentKey) {
    const j = S.bodies.findIndex((o, jj) => jj !== i && o.key === p.parentKey);
    if (j >= 0 && S.bodies[j].parent !== i) b.parent = j;
    if (b.parent >= 0) b.a = p.a;
  }
}

function addBody(k) {
  if (S.bodies.length >= 4) return;
  const key = k || (S.bodies.some(b => b.key === 'sun') ? 'custom' : 'sun');
  const root = S.bodies.findIndex(b => b.parent < 0);
  S.bodies.push(bodyFromPreset(key, { parent: root >= 0 ? root : 0 }));
  const nb = S.bodies.length - 1;
  openRows.add(nb);
  applyPreset(nb, key);
  const b = S.bodies[nb], pk = BODY_PRESETS[key].parentKey;
  // preset orbit only fits around the natural parent; otherwise pick a fitting radius
  if (b.parent >= 0 && !(pk && S.bodies[b.parent].key === pk)) b.a = defaultOrbitRadius(sysList().slice(0, nb), b.parent, b.radius * 1e3) / 1e3;
  renderBodies(); rebuild({ fit: true });
}

// insert natural parent k between body i and its current parent
function addParentFor(i, k) {
  if (S.bodies.length >= 4) return;
  const child = S.bodies[i], P = BODY_PRESETS[k];
  const nb = bodyFromPreset(k, { parent: child.parent });
  if (nb.parent >= 0) nb.a = S.bodies[nb.parent].key === P.parentKey ? P.a : child.a;
  S.bodies.push(nb);
  child.parent = S.bodies.length - 1;
  child.a = BODY_PRESETS[child.key].a;
  renderBodies(); rebuild({ fit: true });
}

function removeBody(i) {
  const gone = S.bodies[i];
  S.bodies.splice(i, 1);
  openRows.clear();
  for (const b of S.bodies) {
    if (b.parent === i) b.parent = gone.parent > i ? gone.parent - 1 : gone.parent;
    else if (b.parent > i) b.parent--;
  }
  renderBodies(); rebuild({ fit: true });
}

$('#bodies').addEventListener('change', e => {
  const card = e.target.closest('.brow'); if (!card) return;
  const i = +card.dataset.i, f = e.target.dataset.f;
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
  const M = S.M;
  $('#m-h0').value = +M.h0.toFixed(3); $('#m-hB').value = +M.hB.toFixed(3); $('#m-hRet').value = +M.hRet.toFixed(3);
  $('#m-t0').value = +M.t0.toFixed(4); $('#m-theta').value = +M.theta.toFixed(4); $('#m-dv').value = +M.dv.toFixed(2);
  $('#m-theta-r').value = M.theta; $('#m-dur').value = +M.duration.toFixed(2); $('#m-auto').checked = M.autoDur;
  $('#m-dur').disabled = M.autoDur;
  setSeg('#modeSeg', M.mode); setSeg('#sideSeg', String(M.side));
  $('#retWrap').hidden = M.mode !== 'free';
}
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

let rebuildQueued = false;
function scheduleRebuild() { if (rebuildQueued) return; rebuildQueued = true; requestAnimationFrame(() => { rebuildQueued = false; rebuild({}); }); }

// ===================== Build & simulate =====================
function sysList() { return S.bodies.map(b => ({ name: b.name, mass: b.mass, radius: b.radius * 1e3, parent: b.parent, a: b.a * 1e3, phase: b.phase })); }

function showErr(t) { const e = $('#err'); e.textContent = t || ''; e.hidden = !t; const m = $('#msg'); m.textContent = t ? _('err.fix', { e: t }) : ''; m.hidden = !t; }
const errText = r => _(r.error, { ...r.params, name: (r.params && r.params.name) || _('body.default') });

function rebuild(o = {}) {
  const s = buildSystem(sysList());
  if (s.error) { showErr(errText(s)); sys = null; simR = null; C = null; updateResults(); return; }
  if (!(S.M.h0 >= 0)) { showErr(_('err.parkNeg')); return; }
  showErr('');
  sys = s;
  try { guess = hohmannGuess(sys, S.M); } catch (e) { guess = null; }
  if (S.M.autoDur) {
    const k = S.M.mode === 'free' ? 2.4 : S.M.mode === 'capture' ? 1.3 : 1.5;
    const tof = guess && Number.isFinite(guess.tof) ? guess.tof : 10 * DAY;
    S.M.duration = clamp(tof * k / DAY, 0.2, 5000);
    $('#m-dur').value = +S.M.duration.toFixed(2);
  }
  simR = simulate(sys, S.M, { tol: 1e-10, hmaxDiv: 500, maxSteps: 120000 });
  if (o.resetU) { S.u = 0; S.ext = 0; }
  buildCache();
  if (o.fit) needFit = true;
  setDvRange(); updateResults(); renderTicks(); renderFrameSeg();
}

// cubic Hermite position at fraction f of sample segment i
function herm(i, f, out) {
  const r = simR, h = r.t[i + 1] - r.t[i];
  const f2 = f * f, f3 = f2 * f;
  const h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
  out[0] = h00 * r.x[i] + h10 * h * r.vx[i] + h01 * r.x[i + 1] + h11 * h * r.vx[i + 1];
  out[1] = h00 * r.y[i] + h10 * h * r.vy[i] + h01 * r.y[i + 1] + h11 * h * r.vy[i + 1];
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
function posAtTime(t, out) {
  const i = segAtTime(t), h = simR.t[i + 1] - simR.t[i];
  if (!(h > 0)) { out[0] = simR.x[i + 1]; out[1] = simR.y[i + 1]; return out; }
  return herm(i, clamp((t - simR.t[i]) / h, 0, 1), out);
}

let SUB = Q.sub;
function buildCache() {
  const r = simR, n = r.t.length;
  const px = [], py = [], pt = [], segStart = new Int32Array(n);
  const o = [0, 0];
  for (let i = 0; i < n - 1; i++) {
    segStart[i] = px.length;
    const h = r.t[i + 1] - r.t[i];
    if (!(h > 0)) continue;
    for (let k = 0; k < SUB; k++) { herm(i, k / SUB, o); px.push(o[0]); py.push(o[1]); pt.push(r.t[i] + h * k / SUB); }
  }
  segStart[n - 1] = px.length; px.push(r.x[n - 1]); py.push(r.y[n - 1]); pt.push(r.t[n - 1]);
  const T = r.t[n - 1] || 1;
  // captured: keep orbiting analytically after the integrated span
  let orbit = null;
  if (r.captured && r.impact < 0) {
    states(sys, S.M.t0 * DAY + T, SP, SV);
    const rx = r.x[n - 1] - SP[2], ry = r.y[n - 1] - SP[3], vx = r.vx[n - 1] - SV[2], vy = r.vy[n - 1] - SV[3];
    const rr = Math.hypot(rx, ry), w = (rx * vy - ry * vx) / (rr * rr);
    orbit = { rx, ry, w, r: rr, P: 2 * Math.PI / Math.abs(w) };
  }
  const cum = new Float64Array(n);
  C = { orbit, px: Float64Array.from(px), py: Float64Array.from(py), pt: Float64Array.from(pt), segStart, cum, T, n, fx: null, fy: null, frameKey: '' };
  rebuildCum();
  C.markers = r.events.filter(e => e.type !== 'impact' || true).map(e => {
    const p = posAtTime(e.t, [0, 0]);
    let txt = '';
    if (e.type === 'burn') txt = _(e.body === 0 ? 'mk.dv' : 'mk.capDv', { v: nf0.format(e.dv) });
    else if (e.type === 'peri') txt = (e.body === 1 ? Peri(1) : _('ev.returnPeri', { peri: peri(0) })) + ' ' + nf1.format(e.alt / 1e3) + ' km' + (e.body === 0 && e.alt < 150e3 ? _('mk.entry') : '');
    else txt = _('mk.impact', { name: S.bodies[e.body].name });
    const label = e.type === 'peri' ? (e.body === 1 ? S.bodies[1].name + ' ' + peri(1) : _('ev.returnPeri', { peri: peri(0) })) : _(e.label);
    return { ...e, label, x: p[0], y: p[1], txt };
  });
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

// ===================== Frames =====================
const SP = new Float64Array(8), SV = new Float64Array(8);
const FP = { cx: 0, cy: 0, c: 1, s: 0, vx: 0, vy: 0 };
function frameAt(t) { // t: sim time (relative to t0)
  states(sys, S.M.t0 * DAY + t, SP, SV);
  const f = S.frame;
  if (f === 'inertial') { FP.cx = 0; FP.cy = 0; FP.c = 1; FP.s = 0; }
  else if (f === 'A' || f === 'B') { const k = f === 'A' ? 0 : 1; FP.cx = SP[2 * k]; FP.cy = SP[2 * k + 1]; FP.c = 1; FP.s = 0; }
  else {
    const mA = sys.m[0], mB = sys.m[1];
    FP.cx = (mA * SP[0] + mB * SP[2]) / (mA + mB); FP.cy = (mA * SP[1] + mB * SP[3]) / (mA + mB);
    const ang = Math.atan2(SP[3] - SP[1], SP[2] - SP[0]); FP.c = Math.cos(ang); FP.s = Math.sin(ang);
  }
  return FP;
}
function tf(x, y, out) { const dx = x - FP.cx, dy = y - FP.cy; out[0] = dx * FP.c + dy * FP.s; out[1] = -dx * FP.s + dy * FP.c; return out; }

function frameCache() {
  const key = S.frame + '|' + C.pt.length;
  if (C.frameKey === key) return;
  C.frameKey = key;
  const n = C.pt.length; C.fx = new Float64Array(n); C.fy = new Float64Array(n);
  const o = [0, 0];
  for (let i = 0; i < n; i++) { frameAt(C.pt[i]); tf(C.px[i], C.py[i], o); C.fx[i] = o[0]; C.fy[i] = o[1]; }
  const K = Q.trackK, NB = sys.N; C.tracks = [];
  for (let b = 0; b < NB; b++) C.tracks.push(new Float64Array(2 * (K + 1)));
  for (let k = 0; k <= K; k++) {
    const t = C.T * k / K; frameAt(t);
    for (let b = 0; b < NB; b++) { tf(SP[2 * b], SP[2 * b + 1], o); C.tracks[b][2 * k] = o[0]; C.tracks[b][2 * k + 1] = o[1]; }
  }
  for (const m of C.markers) {
    frameAt(m.t); tf(m.x, m.y, o); m.fx = o[0]; m.fy = o[1];
    const bb = m.body || 0; tf(SP[2 * bb], SP[2 * bb + 1], o); m.bfx = o[0]; m.bfy = o[1];
  }
}

// ===================== Canvas =====================
const cv = $('#cv'), ctx = cv.getContext('2d'), stage = $('#stage');
let W = 0, H = 0, DPR = 1, stars = null;
const css = getComputedStyle(document.documentElement);
const COL = { traj: css.getPropertyValue('--traj').trim() || '#ffb547', orbit: css.getPropertyValue('--orbit').trim() || '#6b9be0', burn: css.getPropertyValue('--burn').trim() || '#ff7a52', dim: css.getPropertyValue('--dim').trim() || '#8a96ae', faint: css.getPropertyValue('--faint').trim() || '#56637d', void: css.getPropertyValue('--void').trim() || '#04060b', ink: css.getPropertyValue('--ink').trim() || '#e2e8f3', bad: css.getPropertyValue('--bad').trim() || '#ff6f6f' };

function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(1, r.width); H = Math.max(1, r.height); DPR = lowQ ? 1 : Math.min(Q.dprMax, window.devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  makeStars();
}
function makeStars() {
  if (!Q.stars) { stars = null; return; }
  stars = document.createElement('canvas'); stars.width = cv.width; stars.height = cv.height;
  const g = stars.getContext('2d'); g.scale(DPR, DPR);
  let seed = 1234567; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const hz = g.createRadialGradient(W * 0.72, H * 0.3, 0, W * 0.72, H * 0.3, Math.max(W, H) * 0.8);
  hz.addColorStop(0, 'rgba(60,80,140,0.10)'); hz.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hz; g.fillRect(0, 0, W, H);
  const n = Math.round(W * H / 1800);
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, m = rnd(), r = m > 0.985 ? 1.3 : m > 0.9 ? 0.9 : 0.55;
    const tint = rnd(); g.fillStyle = tint > 0.85 ? `rgba(255,214,170,${0.25 + rnd() * 0.5})` : tint > 0.7 ? `rgba(170,200,255,${0.25 + rnd() * 0.5})` : `rgba(230,236,248,${0.15 + rnd() * 0.45})`;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
}
const ro = new ResizeObserver(() => {
  resize();
  $('#wins').style.setProperty('--tl-h', Math.ceil(stage.getBoundingClientRect().bottom - $('#timeline').getBoundingClientRect().top + 8) + 'px');
  clampWins(); INS = null;
});
for (const el of [stage, $('#ctrls'), $('#hudBot'), $('#wins')]) ro.observe(el);

const MARK_FONT = '500 11px "IBM Plex Mono", ui-monospace, monospace';
const sx = x => W / 2 + (x - cam.cx) * cam.scale;
const sy = y => H / 2 - (y - cam.cy) * cam.scale;
// Free area of the plot not covered by floating windows and HUD: { l, r, t, b } in px from each edge.
let INS = null;
function insets() { if (!INS) INS = measureInsets(); return INS; }
function measureInsets() {
  const sr = stage.getBoundingClientRect(), gap = 12;
  const rel = el => { const r = el.getBoundingClientRect(); return { x0: r.left - sr.left, x1: r.right - sr.left, y0: r.top - sr.top, y1: r.bottom - sr.top }; };
  let l = 0, r = 0, t = 0, b = 0;
  // windows hug the left or right edge
  if (floating()) for (const el of document.querySelectorAll('.win:not([hidden])')) {
    const o = rel(el);
    if ((o.x0 + o.x1) / 2 < W / 2) l = Math.max(l, o.x1 + gap); else r = Math.max(r, W - o.x0 + gap);
  }
  if (W - l - r < Math.max(260, W * 0.35)) l = r = 0; // too narrow: let windows overlap instead
  // HUD blocks the top or bottom where it reaches into the free columns
  for (const el of [$('#ctrls'), $('#readout'), $('#timeline')]) {
    const o = rel(el);
    if (o.x1 <= l || o.x0 >= W - r || o.y1 <= o.y0) continue;
    if ((o.y0 + o.y1) / 2 < H / 2) t = Math.max(t, o.y1 + gap); else b = Math.max(b, H - o.y0 + gap);
  }
  return { l, r, t: Math.min(t, H * 0.45), b: Math.min(b, H * 0.4) };
}

function fit() {
  if (!C || W < 50 || H < 50) return; // stage not laid out yet (hidden tab/pane): keep needFit for later
  frameCache();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (let i = 0; i < C.fx.length; i++) add(C.fx[i], C.fy[i]);
  for (const b of [0, 1]) { const tr = C.tracks[b]; for (let k = 0; k < tr.length; k += 2) add(tr[k], tr[k + 1]); }
  const pad = Math.max(sys.R[0], sys.R[1]) * 2;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const { l, r, t, b } = insets();
  const uh = Math.max(80, H - t - b), uw = Math.max(80, W - l - r - 20);
  const scaleFor = w => Math.min(w / (x1 - x0), uh / (y1 - y0)) * 0.9;
  // marker labels stick out sideways past the path's bounding box: reserve their overhang (px) on each side
  ctx.font = MARK_FONT;
  const overhang = s => {
    let L = 0, R = 0;
    for (const m of C.markers) {
      const dx = m.fx - m.bfx, dy = m.fy - m.bfy, d = Math.hypot(dx, dy) * s;
      const ux = d < 1 ? Math.SQRT1_2 : dx * s / d, tw = ctx.measureText(m.txt).width;
      const a = 14 * ux + (ux < -0.3 ? -tw : ux < 0.3 ? -tw / 2 : 0);
      L = Math.max(L, -((m.fx - x0) * s + a)); R = Math.max(R, (m.fx - x1) * s + a + tw);
    }
    const k = Math.min(1, uw * 0.4 / (L + R || 1)); // never give labels more than 40% of the width
    return [L * k, R * k];
  };
  let s = scaleFor(uw), L = 0, R = 0;
  for (let k = 0; k < 2; k++) { [L, R] = overhang(s); s = scaleFor(Math.max(80, uw - L - R)); }
  cam.scale = s;
  cam.cx = (x0 + x1) / 2 - ((l + L - r - R) / 2) / s;
  cam.cy = (y0 + y1) / 2 + ((t - b) / 2) / s;
  needFit = false;
}
function zoomAt(px, py, k) {
  const ns = clamp(cam.scale * k, 1e-15, 0.05);
  if (S.follow !== 'free') { cam.scale = ns; return; }
  const wx = cam.cx + (px - W / 2) / cam.scale, wy = cam.cy - (py - H / 2) / cam.scale;
  cam.scale = ns; cam.cx = wx - (px - W / 2) / ns; cam.cy = wy + (py - H / 2) / ns;
}

// pointer controls
const ptrs = new Map(); let pinch0 = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); cv.classList.add('drag'); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: cam.scale }; } });
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const dx = e.offsetX - p.x, dy = e.offsetY - p.y; p.x = e.offsetX; p.y = e.offsetY;
  if (ptrs.size === 1) {
    if (S.follow !== 'free' && Math.hypot(dx, dy) > 0) { S.follow = 'free'; renderFrameSeg(); }
    cam.cx -= dx / cam.scale; cam.cy += dy / cam.scale;
  } else if (ptrs.size === 2 && pinch0) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch0.s * d / pinch0.d) / cam.scale);
  }
});
const endPtr = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; if (!ptrs.size) cv.classList.remove('drag'); };
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
cv.addEventListener('dblclick', () => { S.follow = 'free'; renderFrameSeg(); fit(); });

// ===================== HUD controls =====================
function renderFrameSeg() {
  $('#lbl-hB').textContent = _('m.target', { peri: peri(1) }); $('#lbl-hRet').textContent = _('m.return', { peri: peri(0) });
  const A = S.bodies[0] ? S.bodies[0].name : 'A', B = S.bodies[1] ? S.bodies[1].name : 'B';
  const fr = [['inertial', _('fr.inertial')], ['A', _('fr.centered', { name: A })], ['B', _('fr.centered', { name: B })], ['rot', _('fr.rot', { a: A, b: B })]];
  $('#frameSeg').innerHTML = fr.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${S.frame === v}">${esc(l)}</button>`).join('');
  const fo = [['free', _('fo.free')], ['craft', _('fo.craft')], ['A', A], ['B', B]];
  $('#followSeg').innerHTML = fo.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${S.follow === v}">${esc(l)}</button>`).join('');
}
$('#frameSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.frame = b.dataset.v; renderFrameSeg(); if (S.follow === 'free') needFit = true; });
$('#followSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; S.follow = b.dataset.v; renderFrameSeg();
  if ((S.follow === 'A' || S.follow === 'B') && sys) {
    const k = S.follow === 'A' ? 0 : 1, R = sys.R[k], rad = Math.min(sys.soi[k], 45 * R);
    const { l, r, t, b } = insets(); cam.scale = Math.min(W - l - r, H - t - b) * 0.42 / rad;
  }
  if (S.follow === 'free') needFit = true;
});
$('#fit').addEventListener('click', () => { S.follow = 'free'; renderFrameSeg(); fit(); });
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
$('#speed').addEventListener('change', e => { S.speed = +e.target.value; });
$('#focus').addEventListener('change', e => { S.focus = e.target.checked; rebuildCum(); renderTicks(); });
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(document.activeElement.tagName)) { e.preventDefault(); $('#play').click(); }
});
function renderTicks() {
  const box = $('#ticks'); if (!C) { box.innerHTML = ''; return; }
  box.innerHTML = C.markers.map(m => `<button type="button" class="tick ${m.type}" style="left:${(tToU(m.t) * 100).toFixed(3)}%" title="${esc(_('tick.title', { label: m.label, t: fmtDur(m.t) }))}" aria-label="${esc(m.label)}" data-t="${m.t}"></button>`).join('');
  $('#tend').textContent = '/ ' + fmtDur(C.T);
}
$('#ticks').addEventListener('click', e => { const b = e.target.closest('.tick'); if (!b) return; S.u = tToU(+b.dataset.t); });

// ===================== Results =====================
function updateResults() {
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
  rows.push([_('res.dv'), nf1.format(M.dv), 'm/s']);
  if (M.mode === 'capture') rows.push([_('res.capDv'), r.captured ? nf1.format(dv2) : '—', 'm/s']);
  if (M.mode === 'capture') rows.push([_('res.totDv'), nf1.format(M.dv + dv2), 'm/s']);
  rows.push([_('res.c3', { name: A }), nf2.format(c3), 'km²/s²']);
  if (r.bPeri) {
    rows.push([_('res.arrival', { name: B }), fmtDur(r.bPeri.t), '']);
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
  res.innerHTML = rows.map(([l, v, u]) => `<tr><th scope="row">${esc(l)}</th><td>${v}${u ? `<em>${esc(u)}</em>` : ''}</td></tr>`).join('');
}
function setStatus(t) { $('#status').textContent = t; }

// ===================== Hohmann & Solver =====================
$('#hohmann').addEventListener('click', () => {
  if (!sys) return;
  const g = hohmannGuess(sys, S.M);
  if (!Number.isFinite(g.dv)) { setStatus(_('st.noHohmann')); return; }
  Object.assign(S.M, { theta: g.theta, dv: g.dv, t0: g.t0 });
  syncMission(); rebuild({ resetU: true, fit: true });
  setStatus(_('st.hohmann', { dv: nf1.format(g.dv), days: nf2.format(g.tof / DAY) }) + (g.case === 'sibling' ? _('st.hohmannT0', { t0: nf1.format(g.t0) }) : '') + _('st.hohmannTail'));
});
$('#solve').addEventListener('click', solve);
// Solver runs in a Web Worker so the animation never stalls; falls back to the main thread.
let solverWorker = null, rejectSolve = null;
const WORKER_BODY = `
onmessage = async (e) => {
  const { list, M, opt } = e.data;
  try { const s = buildSystem(list); const r = await optimize(s, M, { ...opt, onProgress: n => postMessage({ p: n }) }); postMessage({ done: r }); }
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
  if (!w) return optimize(sysLocal, M, { ...opt, onProgress: prog, cancelled: () => cancelSolve });
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
  const g = hohmannGuess(s2, S.M);
  const M0 = { ...S.M, theta: g.theta, dv: g.dv, t0: g.t0 };
  if (M0.autoDur) { const k = M0.mode === 'free' ? 2.4 : M0.mode === 'capture' ? 1.3 : 1.5; M0.duration = clamp(g.tof * k / DAY, 0.2, 5000); }
  const varyT0 = g.case === 'sibling';
  const t1 = performance.now();
  setStatus(_('st.solving'));
  try {
    const opt = { varyT0, t0Grid: g.nested ? [-12, -9, -6, -3, 0, 3, 6, 9, 12] : [-4, -2, 0, 2, 4] };
    const prog = n => setStatus(_('st.progress', { n: nf0.format(n) }));
    const r = await runSolver(sysList(), M0, opt, prog, s2);
    Object.assign(S.M, { theta: r.theta, dv: r.dv, t0: r.t0 });
    syncMission(); rebuild({ resetU: true, fit: true });
    if (!reduceMotion) { S.playing = true; setPlayIcon(); }
    const secs = (performance.now() - t1) / 1000;
    const okv = r.f < 1e-4;
    setStatus(_(okv ? 'st.solved' : 'st.nearest') + _('st.solvedInfo', { evals: nf0.format(r.evals), secs: nf1.format(secs) }));
  } catch (e) {
    if (e === 'cancel') setStatus(_('st.cancelled')); else { setStatus(_('st.solverErr', { e })); console.error(e); }
  } finally {
    solving = false; btn.textContent = _('ui.solve'); btn.classList.remove('busy');
  }
}

// ===================== Render loop =====================
const SPo = new Float64Array(8), SVo = new Float64Array(8);
function orbitPos(t, out) {
  states(sys, S.M.t0 * DAY + t, SPo, SVo);
  const o = C.orbit, a = o.w * (t - C.T), c = Math.cos(a), s = Math.sin(a);
  out[0] = SPo[2] + o.rx * c - o.ry * s; out[1] = SPo[3] + o.rx * s + o.ry * c; return out;
}
let last = performance.now(), hold = 0, hudTick = 0, hudLast = 0, frameAvg = 1 / 60, slowFrames = 0, lowQ = false;
const tmp = [0, 0], tmp2 = [0, 0];

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
const _txt = new Map();
function setT(sel, v) { if (_txt.get(sel) !== v) { _txt.set(sel, v); document.querySelector(sel).textContent = v; } }
const _hx = new Map();
function hexA(hex, a) { const k = hex + a; let v = _hx.get(k); if (!v) { v = hexA0(hex, a); _hx.set(k, v); } return v; }
function hexA0(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }

function draw(now) {
  // frame cap (low-resource mode); the small slack keeps 60 Hz displays at an even 30 fps
  if (Q.fpsCap && now - last < 1000 / Q.fpsCap - 4) { requestAnimationFrame(draw); return; }
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // adaptive quality (normal mode): if frames stay slow, drop glow, render at 1x pixel ratio and suggest low mode
  if (MODE === 'normal') {
    frameAvg = frameAvg * 0.95 + dt * 0.05;
    if (!lowQ && frameAvg > 0.03 && ++slowFrames > 90) { lowQ = true; resize(); showPerfTip(); }
  }
  const glow = Q.glow && !lowQ;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = COL.void; ctx.fillRect(0, 0, W, H);
  if (stars) ctx.drawImage(stars, 0, 0, W, H);
  if (!sys || !simR || !C) { requestAnimationFrame(draw); return; }
  frameCache();
  if (needFit) fit();

  if (S.playing && !scrubbing) {
    if (S.u >= 1) {
      if (S.loop) { hold += dt; if (hold > 1.6) { S.u = 0; S.ext = 0; hold = 0; } }
      else if (C.orbit) S.ext += dt * S.speed * C.orbit.P / 8;
      else { S.playing = false; setPlayIcon(); }
    } else S.u = Math.min(1, S.u + dt * S.speed / 30);
  }
  if (S.u < 1) S.ext = 0;
  const ext = S.ext > 0 && C.orbit;
  const [si, sf] = uToSeg(S.u);
  const segH = simR.t[si + 1] - simR.t[si];
  const tNow = ext ? C.T + S.ext : simR.t[si] + (segH > 0 ? sf * segH : 0);
  const craft = ext ? orbitPos(tNow, [0, 0]) : segH > 0 ? herm(si, sf, [0, 0]) : [simR.x[si + 1], simR.y[si + 1]];
  const pathIdx = ext ? C.fx.length - 1 : Math.min(C.fx.length - 1, C.segStart[si] + Math.floor(sf * (segH > 0 ? SUB : 0)));

  // body states & frame at current time
  frameAt(tNow);
  const N = sys.N, bpos = [];
  for (let b = 0; b < N; b++) { tf(SP[2 * b], SP[2 * b + 1], tmp); bpos.push([tmp[0], tmp[1]]); }
  const cpos = tf(craft[0], craft[1], [0, 0]);
  // velocity direction in frame (finite diff)
  const dtv = ext ? C.orbit.P / 300 : Math.max(1, (segH > 0 ? segH : 60) * 0.02);
  const t2 = ext ? tNow + dtv : Math.min(C.T, tNow + dtv);
  const craft2 = ext ? orbitPos(t2, [0, 0]) : posAtTime(t2, [0, 0]);
  frameAt(t2); const cpos2 = tf(craft2[0], craft2[1], [0, 0]);
  frameAt(tNow);

  if (S.follow === 'craft') { cam.cx = cpos[0]; cam.cy = cpos[1]; }
  else if (S.follow === 'A') { cam.cx = bpos[0][0]; cam.cy = bpos[0][1]; }
  else if (S.follow === 'B') { cam.cx = bpos[1][0]; cam.cy = bpos[1][1]; }

  // orbit circles (non-rotating frames)
  ctx.lineWidth = 1;
  if (S.frame !== 'rot') {
    const diag = Math.hypot(W, H);
    for (let b = 0; b < N; b++) {
      const p = sys.parent[b]; if (p < 0) continue;
      const r = Math.hypot(bpos[b][0] - bpos[p][0], bpos[b][1] - bpos[p][1]) * cam.scale;
      if (r < 4 || r > 1e5) continue;
      const cx0 = sx(bpos[p][0]), cy0 = sy(bpos[p][1]), dc = Math.hypot(cx0 - W / 2, cy0 - H / 2);
      if (dc - r > diag / 2 || r - dc > diag / 2) continue; // circle entirely off-screen
      ctx.setLineDash(r < 1500 ? [3, 5] : []);
      ctx.strokeStyle = hexA(S.bodies[b].color, r < 1500 ? 0.2 : 0.12);
      ctx.beginPath(); ctx.arc(cx0, cy0, r, 0, 6.2832); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
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
    ctx.beginPath(); ctx.moveTo(sx(C.fx[pathIdx]), sy(C.fy[pathIdx])); ctx.lineTo(sx(cpos[0]), sy(cpos[1])); ctx.stroke();
  }

  if (ext) {
    const rr = C.orbit.r * cam.scale;
    if (rr > 2 && rr < 1e5) { ctx.strokeStyle = hexA(COL.traj, 0.55); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(sx(bpos[1][0]), sy(bpos[1][1]), rr, 0, 6.2832); ctx.stroke(); }
  }
  // markers
  ctx.font = MARK_FONT;
  const placed = [];
  for (const m of C.markers) {
    const x = sx(m.fx), y = sy(m.fy), reached = m.t <= tNow + 1e-6;
    if (x < -50 || x > W + 50 || y < -50 || y > H + 50) continue;
    const col = m.type === 'burn' ? COL.burn : m.type === 'impact' ? COL.bad : COL.orbit;
    ctx.globalAlpha = reached ? 1 : 0.55;
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.4;
    if (m.type === 'burn') { ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.2832); ctx.fill(); ctx.strokeStyle = 'rgba(4,6,11,0.9)'; ctx.lineWidth = 1.2; ctx.stroke(); }
    ctx.fillStyle = hexA(col, reached ? 0.95 : 0.6);
    // push label outward from the body the event belongs to
    const bb = m.body || 0; let ox = x - sx(bpos[bb][0]), oy = y - sy(bpos[bb][1]); let ol = Math.hypot(ox, oy);
    if (ol < 1) { ox = 1; oy = -1; ol = Math.SQRT2; }
    ox /= ol; oy /= ol;
    const tw = ctx.measureText(m.txt).width;
    let lx = x + ox * 14 + (ox < -0.3 ? -tw : ox < 0.3 ? -tw / 2 : 0), ly = y + oy * 14 + 4 + (oy > 0.3 ? 8 : 0);
    lx = clamp(lx, 6, W - tw - 6);
    // avoid stacking labels of coincident events (e.g. perilune + capture burn)
    for (let guard = 0; guard < 6 && placed.some(q => lx < q[0] + q[2] && lx + tw > q[0] && Math.abs(ly - q[1]) < 13); guard++) ly += oy >= 0 ? 14 : -14;
    placed.push([lx, ly, tw]);
    ctx.fillText(m.txt, lx, ly);
    ctx.globalAlpha = 1;
  }

  // bodies
  /*bodies*/
  const sunIdx = S.bodies.findIndex(b => b.key === 'sun');
  for (const b of [...Array(N).keys()].sort((p, q) => sys.R[q] - sys.R[p])) {
    const x = sx(bpos[b][0]), y = sy(bpos[b][1]);
    const isSun = S.bodies[b].key === 'sun';
    const minR = b < 2 ? 5 : 4;
    const r = Math.max(minR, sys.R[b] * cam.scale);
    if (x + r < -60 || x - r > W + 60 || y + r < -60 || y - r > H + 60) continue;
    const col = S.bodies[b].color;
    if (!Q.glow) { // low-resource: flat discs, no gradients
      ctx.fillStyle = isSun ? '#fff3d6' : col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    } else if (isSun) {
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 4.5);
      g.addColorStop(0, hexA(col, 0.55)); g.addColorStop(0.25, hexA(col, 0.18)); g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4.5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#fff3d6'; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    } else {
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
    if (Q.glow) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
      g.addColorStop(0, hexA(COL.traj, 0.6)); g.addColorStop(1, hexA(COL.traj, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.2832); ctx.fill();
    } else { ctx.strokeStyle = COL.traj; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.2832); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.2832); ctx.fill();
    const vx = sx(cpos2[0]) - x, vy = sy(cpos2[1]) - y, vl = Math.hypot(vx, vy);
    if (vl > 1e-6) {
      const ux = vx / vl, uy = vy / vl, L = 22;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x + ux * 6, y + uy * 6); ctx.lineTo(x + ux * L, y + uy * L); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + ux * L, y + uy * L); ctx.lineTo(x + ux * (L - 5) - uy * 3.5, y + uy * (L - 5) + ux * 3.5); ctx.lineTo(x + ux * (L - 5) + uy * 3.5, y + uy * (L - 5) - ux * 3.5); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
    }
  }

  // scale bar
  {
    const { l, b: bot } = insets();
    const target = 110 / cam.scale; const p = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map(k => k * p).reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
    const px = nice * cam.scale, x0 = l + 8, y0 = H - bot - 4;
    ctx.strokeStyle = hexA(COL.dim, 0.9); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 5); ctx.stroke();
    ctx.fillStyle = COL.dim; ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(fmtDist(nice), x0 + 2, y0 - 8);
  }

  // HUD text
  if (Q.hudMs ? now - hudLast >= Q.hudMs : (hudTick++ & 3) === 0) {
    hudLast = now;
    const absX = craft[0], absY = craft[1];
    states(sys, S.M.t0 * DAY + tNow, SP, SV);
    const dA = Math.hypot(absX - SP[0], absY - SP[1]), dB = Math.hypot(absX - SP[2], absY - SP[3]);
    const i2 = segAtTime(tNow), h2 = simR.t[i2 + 1] - simR.t[i2], f2 = h2 > 0 ? clamp((tNow - simR.t[i2]) / h2, 0, 1) : 1;
    let vx = simR.vx[i2] + (simR.vx[i2 + 1] - simR.vx[i2]) * f2, vy = simR.vy[i2] + (simR.vy[i2 + 1] - simR.vy[i2]) * f2;
    const near = dB - sys.R[1] < dA - sys.R[0] ? 1 : 0;
    if (ext) { const rx = absX - SP[2], ry = absY - SP[3]; vx = SV[2] - C.orbit.w * ry; vy = SV[3] + C.orbit.w * rx; }
    const A = S.bodies[0].name, B = S.bodies[1].name;
    setT('#r-t', _('hud.tplus', { t: fmtDur(tNow, true) }));
    setT('#tplus', _('hud.tplus', { t: fmtDur(tNow, true) }));
    setT('#r-l1', _('hud.alt', { name: A })); setT('#r-v1', fmtDist(Math.max(0, dA - sys.R[0])));
    setT('#r-l2', _('hud.alt', { name: B })); setT('#r-v2', fmtDist(Math.max(0, dB - sys.R[1])));
    setT('#r-l3', _('hud.rel', { name: near ? B : A }));
    setT('#r-v3', fmtSpeed(Math.hypot(vx - SV[2 * near], vy - SV[2 * near + 1])));
    setT('#tend', '/ ' + fmtDur(C.T) + (ext ? _('hud.lap', { n: 1 + Math.floor(S.ext / C.orbit.P) }) : ''));
    if (!scrubbing) scrub.value = Math.round(S.u * 10000);
  }
  requestAnimationFrame(draw);
}

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
const WINS = parseWins(readPref(LS, PREF_KEYS.wins));
const ICON_MINUS = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7M6 2.5v7"/></svg>';
let zTop = 10;
const winEl = id => $('#w-' + id);
const railBtn = id => $(`.rail-btn[data-win="${id}"]`);
function saveWins() { writePref(LS, PREF_KEYS.wins, JSON.stringify(WINS)); }

// Default spots: mission top-left, results under the view controls on the right, so the centre stays clear.
function defaultWinPos(id, el) {
  const box = $('#wins'), cw = box.clientWidth, ch = box.clientHeight, m = 12, w = el.offsetWidth;
  const cssW = k => parseFloat(getComputedStyle(winEl(k)).width) || 0;
  const below = $('#ctrls').getBoundingClientRect().bottom - box.getBoundingClientRect().top + 10;
  switch (id) {
    case 'mission': return [m, m];
    case 'bodies': return [m + cssW('mission') + 10, m];
    case 'results': return [cw - w - m, below];
    case 'gloss': return [cw - w - m - cssW('results') - 10, below];
    default: return [(cw - w) / 2, ch * 0.16];
  }
}
function placeWin(id) {
  const st = WINS[id], el = winEl(id), box = $('#wins');
  if (!st.open || !floating()) return;
  let [x, y] = st.x == null || st.y == null ? defaultWinPos(id, el) : [st.x, st.y];
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
  placeWin(id);
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
  Object.assign(WINS, defaultWins());
  for (const id of WIN_IDS) applyWin(id);
  INS = null; S.follow = 'free'; renderFrameSeg(); needFit = true;
});
// Esc closes the reference windows (glossary, model) when focus is inside them
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const win = document.activeElement && document.activeElement.closest('.win');
  if (win && (win.dataset.win === 'gloss' || win.dataset.win === 'model')) { setWin(win.dataset.win, { open: false }); railBtn(win.dataset.win).focus(); }
});
mqFloat.addEventListener('change', () => { for (const id of WIN_IDS) applyWin(id); INS = null; needFit = true; });

// ===================== View mode =====================
function setMode(m, save) {
  if (!QUALITY[m]) return;
  MODE = m; Q = QUALITY[m]; SUB = Q.sub;
  document.documentElement.dataset.q = m;
  if (m === 'normal') { lowQ = false; slowFrames = 0; frameAvg = 1 / 60; }
  resize();
  if (sys && simR) { buildCache(); renderTicks(); }
  document.querySelectorAll('#viewMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === m)));
  if (save) writePref(LS, PREF_KEYS.mode, m);
  if (m === 'low') $('#perfTip').hidden = true;
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
  if (MODE !== 'normal' || perfTipShown || readPref(SS, PREF_KEYS.perfTip)) return;
  perfTipShown = true; writePref(SS, PREF_KEYS.perfTip, '1');
  $('#perfTip').hidden = false;
}
$('#perfGo').addEventListener('click', () => setMode('low', true));
$('#perfX').addEventListener('click', () => { $('#perfTip').hidden = true; });

// ===================== Init =====================
applyI18n();
$('#scenario').innerHTML = SCENARIOS.map(s => `<option value="${s.id}">${esc(_('sc.' + s.id + '.name'))}</option>`).join('');
$('#scenario').addEventListener('change', e => loadScenario(e.target.value));
const start = startupMode(LS);
setMode(start.mode, false);
loadScenario('em_free');
setPlayIcon();
for (const id of WIN_IDS) applyWin(id);
if (start.ask) askMode();
requestAnimationFrame(t => { last = t; draw(t); });
