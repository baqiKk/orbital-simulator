// ===================== Data =====================
const BODY_PRESETS = {
  sun:     { name: 'Güneş',   mass: 1.98847e30, radius: 695700,  parentKey: null,      a: 0,         color: '#ffd27a' },
  mercury: { name: 'Merkür',  mass: 3.3011e23,  radius: 2439.7,  parentKey: 'sun',     a: 57909050,  color: '#a9a49c' },
  venus:   { name: 'Venüs',   mass: 4.8675e24,  radius: 6051.8,  parentKey: 'sun',     a: 108210000, color: '#e8c98f' },
  earth:   { name: 'Dünya',   mass: 5.9722e24,  radius: 6371,    parentKey: 'sun',     a: 149598000, color: '#5b9cf0' },
  moon:    { name: 'Ay',      mass: 7.342e22,   radius: 1737.4,  parentKey: 'earth',   a: 384400,    color: '#cbc8bf' },
  mars:    { name: 'Mars',    mass: 6.4171e23,  radius: 3389.5,  parentKey: 'sun',     a: 227939000, color: '#e0703f' },
  phobos:  { name: 'Phobos',  mass: 1.0659e16,  radius: 11.27,   parentKey: 'mars',    a: 9376,      color: '#a08f7e' },
  jupiter: { name: 'Jüpiter', mass: 1.89813e27, radius: 69911,   parentKey: 'sun',     a: 778570000, color: '#d9b48c' },
  europa:  { name: 'Europa',  mass: 4.7998e22,  radius: 1560.8,  parentKey: 'jupiter', a: 671034,    color: '#d4c7ad' },
  custom:  { name: 'Özel cisim', mass: 1e23,    radius: 2000,    parentKey: undefined, a: 500000,    color: '#b590f2' },
};
const PRESET_ORDER = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'phobos', 'jupiter', 'europa', 'custom'];

const SCENARIOS = [
  { id: 'em_free', name: 'Dünya → Ay · Serbest dönüş (8 / S)', frame: 'rot',
    note: 'Apollo tipi serbest dönüş: Ay\'ın arkasından retrograd geçip motor yakmadan Dünya\'ya döner. Dönen çerçevede 8 biçimi görünür.',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }],
    M: { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: 0, theta: -132.26090326368262, dv: 3162.1420118609917, autoDur: true, duration: 12 } },
  { id: 'em_cap', name: 'Dünya → Ay · Yörüngeye giriş', frame: 'A',
    note: 'Translunar enjeksiyon, ardından 100 km dairesel Ay yörüngesine giriş yanması.',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }],
    M: { mode: 'capture', side: -1, h0: 185, hB: 100, hRet: 60, t0: 0, theta: -122.6404245345841, dv: 3141.0061695917125, autoDur: true, duration: 7 } },
  { id: 'em_sun', name: 'Dünya → Ay · Güneş etkisiyle (3 cisim)', frame: 'rot',
    note: 'Aynı serbest dönüş, üçüncü cisim olarak Güneş\'in çekimi eklenmiş. Güneş, Dünya merkezli tanımda 1 AU yörüngede görünür.',
    bodies: [{ k: 'earth', parent: -1 }, { k: 'moon', parent: 0 }, { k: 'sun', parent: 0, a: 149598000, phase: 90 }],
    M: { mode: 'free', side: -1, h0: 185, hB: 250, hRet: 60, t0: 0, theta: -132.31541604192466, dv: 3161.2744423190697, autoDur: true, duration: 12 } },
  { id: 'e_mars', name: 'Dünya → Mars · Hohmann + yakalama', frame: 'inertial',
    note: 'Güneş merkezli Hohmann transferi. Kalkış anı, Mars\'ın doğru faz açısında olduğu pencereye ayarlı.',
    bodies: [{ k: 'earth', parent: 2 }, { k: 'mars', parent: 2 }, { k: 'sun', parent: -1 }],
    M: { mode: 'capture', side: 0, h0: 185, hB: 300, hRet: 60, t0: 685.7782603563348, theta: -150.0725460254747, dv: 3615.9489071591897, autoDur: true, duration: 336 } },
  { id: 'moon_mars', name: 'Ay → Mars · 4 cisim', frame: 'inertial',
    note: 'Alçak Ay yörüngesinden kalkış: önce Ay\'dan, sonra Dünya\'nın kuyusundan kaçış, ardından Mars.',
    bodies: [{ k: 'moon', parent: 2 }, { k: 'mars', parent: 3 }, { k: 'earth', parent: 3 }, { k: 'sun', parent: -1 }],
    M: { mode: 'capture', side: 0, h0: 100, hB: 300, hRet: 60, t0: 677.8485252280739, theta: -103.79516935006063, dv: 1591.5641379638673, autoDur: true, duration: 336 } },
  { id: 'e_venus', name: 'Dünya → Venüs · Geçiş', frame: 'inertial',
    note: 'İçe doğru Hohmann transferi ve 500 km irtifada Venüs yakın geçişi.',
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

const $ = s => document.querySelector(s);
const APSIS = { earth: 'perigee', moon: 'perilune', sun: 'perihelion', mars: 'periareion', venus: 'pericytherion', mercury: 'perihermion', jupiter: 'perijove' };
const peri = i => (S.bodies[i] && APSIS[S.bodies[i].key]) || 'periapsis';
const Peri = i => { const p = peri(i); return p[0].toUpperCase() + p.slice(1); };
const NF = (d) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: d, minimumFractionDigits: d });
const nf0 = NF(0), nf1 = NF(1), nf2 = NF(2), nf3 = NF(3);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const parseNum = v => { const x = parseFloat(String(v).replace(',', '.').replace(/\s/g, '')); return Number.isFinite(x) ? x : NaN; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtDist(m) {
  const km = m / 1e3;
  if (km < 1000) return nf1.format(km) + ' km';
  if (km < 5e7) return nf0.format(km) + ' km';
  return nf3.format(m / 1.495978707e11) + ' AU';
}
function fmtSpeed(v) { return v < 1000 ? nf0.format(v) + ' m/s' : nf3.format(v / 1000) + ' km/s'; }
function fmtDur(sec, withSec) {
  const d = Math.floor(sec / DAY); let r = sec - d * DAY;
  const h = Math.floor(r / 3600); r -= h * 3600; const mi = Math.floor(r / 60); const s = Math.floor(r - mi * 60);
  const p = n => String(n).padStart(2, '0');
  return `${d}g ${p(h)}:${p(mi)}` + (withSec ? `:${p(s)}` : '');
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
  return { key: k, name: p.name, mass: p.mass, radius: p.radius, parent: -1, a: p.a, phase: 0, color: p.color, ...over };
}

// ===================== Scenario =====================
function loadScenario(id) {
  const sc = SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
  S.scenario = sc.id;
  S.bodies = sc.bodies.map(b => bodyFromPreset(b.k, { parent: b.parent, ...(b.a != null ? { a: b.a } : {}), phase: b.phase || 0 }));
  S.M = { ...sc.M };
  S.frame = sc.frame; S.follow = 'free';
  $('#scenario').value = sc.id;
  $('#scNote').textContent = sc.note;
  renderBodies(); syncMission(); renderFrameSeg();
  rebuild({ fit: true, resetU: true });
  setStatus('');
  if (!reduceMotion) S.playing = true;
  setPlayIcon();
}

// ===================== Body cards =====================
function renderBodies() {
  const box = $('#bodies');
  const N = S.bodies.length;
  box.innerHTML = S.bodies.map((b, i) => {
    const role = i === 0 ? '<span class="role dep">Kalkış</span>' : i === 1 ? '<span class="role tgt">Hedef</span>' : '<span class="role">Ek</span>';
    const opts = PRESET_ORDER.map(k => `<option value="${k}" ${k === b.key ? 'selected' : ''}>${BODY_PRESETS[k].name}</option>`).join('');
    const pOpts = `<option value="-1" ${b.parent < 0 ? 'selected' : ''}>Merkez (sabit)</option>` +
      S.bodies.map((o, j) => j === i ? '' : `<option value="${j}" ${b.parent === j ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
    // natural-parent hint (only for orbiting bodies placed around a non-natural parent)
    const pk = BODY_PRESETS[b.key].parentKey;
    let hint = '';
    if (pk && b.parent >= 0 && S.bodies[b.parent].key !== pk && !S.bodies.some(o => o.key === pk)) {
      const pn = BODY_PRESETS[pk].name;
      hint = `<p class="hint">${esc(b.name)} normalde ${pn} etrafında döner.${N < 4 ? ` <button type="button" class="linkbtn" data-act="addparent" data-k="${pk}">Ekle: ${pn}</button>` : ''}</p>`;
    }
    return `<div class="bcard" data-i="${i}">
      <div class="bhead"><span class="dot" style="background:${b.color}"></span>${role}
        <select data-f="key" aria-label="Cisim seçimi">${opts}</select>
        ${i >= 2 ? `<button type="button" class="xbtn" data-act="remove" aria-label="Cismi kaldır">✕</button>` : ''}</div>
      ${b.key === 'custom' ? `<label class="field"><span>Ad</span><input type="text" data-f="name" value="${esc(b.name)}"></label>` : ''}
      <div class="grid2">
        <label class="field"><span>Kütle (kg)</span><input type="text" inputmode="decimal" data-f="mass" value="${fmtMass(b.mass)}"><small data-hint="mass">${massHint(b.mass)}</small></label>
        <label class="field"><span>Yarıçap (km)</span><input type="number" step="any" data-f="radius" value="${b.radius}"></label>
        <label class="field"><span>Etrafında döner</span><select data-f="parent">${pOpts}</select></label>
        <label class="field"><span>Yörünge yarıçapı (km)</span><input type="number" step="any" data-f="a" value="${b.a}" ${b.parent < 0 ? 'disabled' : ''}></label>
        <label class="field"><span>Başlangıç fazı (°)</span><input type="number" step="any" data-f="phase" value="${b.phase}" ${b.parent < 0 ? 'disabled' : ''}></label>
      </div>${hint}
    </div>`;
  }).join('');
  $('#addBody').hidden = N >= 4;
}

function applyPreset(i, k) {
  const p = BODY_PRESETS[k], b = S.bodies[i];
  Object.assign(b, { key: k, name: p.name, mass: p.mass, radius: p.radius, color: p.color });
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
  applyPreset(S.bodies.length - 1, key);
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
  for (const b of S.bodies) {
    if (b.parent === i) b.parent = gone.parent > i ? gone.parent - 1 : gone.parent;
    else if (b.parent > i) b.parent--;
  }
  renderBodies(); rebuild({ fit: true });
}

$('#bodies').addEventListener('change', e => {
  const card = e.target.closest('.bcard'); if (!card) return;
  const i = +card.dataset.i, f = e.target.dataset.f;
  if (f === 'key') { applyPreset(i, e.target.value); renderBodies(); renderFrameSeg(); rebuild({ fit: true }); }
  else if (f === 'parent') { S.bodies[i].parent = +e.target.value; renderBodies(); rebuild({ fit: true }); }
});
$('#bodies').addEventListener('input', e => {
  const card = e.target.closest('.bcard'); if (!card) return;
  const i = +card.dataset.i, f = e.target.dataset.f, b = S.bodies[i];
  if (!f || f === 'key' || f === 'parent') return;
  if (f === 'name') { b.name = e.target.value || 'Cisim'; renderFrameSeg(); scheduleRebuild(); return; }
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
  if (btn.dataset.act === 'remove') removeBody(+btn.closest('.bcard').dataset.i);
  if (btn.dataset.act === 'addparent') addParentFor(+btn.closest('.bcard').dataset.i, btn.dataset.k);
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
$('#sideSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.M.side = +b.dataset.v; syncMission(); setStatus('Geçiş yönü çözücüde kullanılır: "Hedefe göre çöz" ile uygulayın.'); });

let rebuildQueued = false;
function scheduleRebuild() { if (rebuildQueued) return; rebuildQueued = true; requestAnimationFrame(() => { rebuildQueued = false; rebuild({}); }); }

// ===================== Build & simulate =====================
function sysList() { return S.bodies.map(b => ({ name: b.name, mass: b.mass, radius: b.radius * 1e3, parent: b.parent, a: b.a * 1e3, phase: b.phase })); }

function showErr(t) { const e = $('#err'); e.textContent = t || ''; e.hidden = !t; const m = $('#msg'); m.textContent = t ? 'Cisim ayarlarını düzeltin: ' + t : ''; m.hidden = !t; }

function rebuild(o = {}) {
  const s = buildSystem(sysList());
  if (s.error) { showErr(s.error); sys = null; simR = null; C = null; updateResults(); return; }
  if (!(S.M.h0 >= 0)) { showErr('Park irtifası negatif olamaz.'); return; }
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

const SUB = 5;
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
    if (e.type === 'burn') txt = (e.body === 0 ? 'Δv ' : 'Giriş Δv ') + nf0.format(e.dv) + ' m/s';
    else if (e.type === 'peri') txt = (e.body === 1 ? Peri(1) + ' ' : 'Dönüş ' + peri(0) + ' ') + nf1.format(e.alt / 1e3) + ' km' + (e.body === 0 && e.alt < 150e3 ? ' · atmosfer girişi' : '');
    else txt = 'Çarpma · ' + S.bodies[e.body].name;
    const label = e.type === 'peri' ? (e.body === 1 ? S.bodies[1].name + ' ' + peri(1) : 'Dönüş ' + peri(0)) : e.label;
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
  const K = 420, NB = sys.N; C.tracks = [];
  for (let b = 0; b < NB; b++) C.tracks.push(new Float64Array(2 * (K + 1)));
  for (let k = 0; k <= K; k++) {
    const t = C.T * k / K; frameAt(t);
    for (let b = 0; b < NB; b++) { tf(SP[2 * b], SP[2 * b + 1], o); C.tracks[b][2 * k] = o[0]; C.tracks[b][2 * k + 1] = o[1]; }
  }
  for (const m of C.markers) { frameAt(m.t); tf(m.x, m.y, o); m.fx = o[0]; m.fy = o[1]; }
}

// ===================== Canvas =====================
const cv = $('#cv'), ctx = cv.getContext('2d'), stage = $('#stage');
let W = 0, H = 0, DPR = 1, stars = null;
const css = getComputedStyle(document.documentElement);
const COL = { traj: css.getPropertyValue('--traj').trim() || '#ffb547', orbit: css.getPropertyValue('--orbit').trim() || '#6b9be0', burn: css.getPropertyValue('--burn').trim() || '#ff7a52', dim: css.getPropertyValue('--dim').trim() || '#8a96ae', faint: css.getPropertyValue('--faint').trim() || '#56637d', void: css.getPropertyValue('--void').trim() || '#04060b', ink: css.getPropertyValue('--ink').trim() || '#e2e8f3', bad: css.getPropertyValue('--bad').trim() || '#ff6f6f' };

function resize() {
  const r = stage.getBoundingClientRect();
  W = Math.max(1, r.width); H = Math.max(1, r.height); DPR = (typeof lowQ !== 'undefined' && lowQ) ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  makeStars();
}
function makeStars() {
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
const ro = new ResizeObserver(() => { resize(); INS = null; }); ro.observe(stage); ro.observe(document.querySelector('.hud-top')); ro.observe(document.querySelector('.timeline'));

const sx = x => W / 2 + (x - cam.cx) * cam.scale;
const sy = y => H / 2 - (y - cam.cy) * cam.scale;
let INS = null;
function insets() { if (!INS) INS = measureInsets(); return INS; }
function measureInsets() { const top = document.querySelector('.hud-top').getBoundingClientRect().height + 24; const bot = document.querySelector('.timeline').getBoundingClientRect().height + 28; return { top: Math.min(top, H * 0.45), bot: Math.min(bot, H * 0.35) }; }

function fit() {
  if (!C) return; frameCache();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (let i = 0; i < C.fx.length; i++) add(C.fx[i], C.fy[i]);
  for (const b of [0, 1]) { const tr = C.tracks[b]; for (let k = 0; k < tr.length; k += 2) add(tr[k], tr[k + 1]); }
  const pad = Math.max(sys.R[0], sys.R[1]) * 2;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const { top, bot } = insets();
  const uh = Math.max(80, H - top - bot), uw = Math.max(80, W - 40);
  cam.scale = Math.min(uw / (x1 - x0), uh / (y1 - y0)) * 0.9;
  cam.cx = (x0 + x1) / 2;
  cam.cy = (y0 + y1) / 2 + ((top - bot) / 2) / cam.scale;
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
  $('#lbl-hB').textContent = 'Hedef ' + peri(1) + ' (km)'; $('#lbl-hRet').textContent = 'Dönüş ' + peri(0) + ' (km)';
  const A = S.bodies[0] ? S.bodies[0].name : 'A', B = S.bodies[1] ? S.bodies[1].name : 'B';
  const fr = [['inertial', 'Eylemsiz'], ['A', A + ' merkezli'], ['B', B + ' merkezli'], ['rot', 'Dönen ' + A + '–' + B]];
  $('#frameSeg').innerHTML = fr.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${S.frame === v}">${esc(l)}</button>`).join('');
  const fo = [['free', 'Serbest'], ['craft', 'Araç'], ['A', A], ['B', B]];
  $('#followSeg').innerHTML = fo.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${S.follow === v}">${esc(l)}</button>`).join('');
}
$('#frameSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.frame = b.dataset.v; renderFrameSeg(); if (S.follow === 'free') needFit = true; });
$('#followSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; S.follow = b.dataset.v; renderFrameSeg();
  if ((S.follow === 'A' || S.follow === 'B') && sys) {
    const k = S.follow === 'A' ? 0 : 1, R = sys.R[k], rad = Math.min(sys.soi[k], 45 * R);
    const { top, bot } = insets(); cam.scale = Math.min(W, H - top - bot) * 0.42 / rad;
  }
  if (S.follow === 'free') needFit = true;
});
$('#fit').addEventListener('click', () => { S.follow = 'free'; renderFrameSeg(); fit(); });
$('#tSoi').addEventListener('change', e => { S.soi = e.target.checked; });
$('#tTracks').addEventListener('change', e => { S.tracks = e.target.checked; });

// ===================== Timeline =====================
const playSvg = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>';
const pauseSvg = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1" fill="currentColor"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="1" fill="currentColor"/></svg>';
function setPlayIcon() { const b = $('#play'); b.innerHTML = S.playing ? pauseSvg : playSvg; b.setAttribute('aria-label', S.playing ? 'Duraklat' : 'Oynat'); }
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
  if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); $('#play').click(); }
});
function renderTicks() {
  const box = $('#ticks'); if (!C) { box.innerHTML = ''; return; }
  box.innerHTML = C.markers.map(m => `<button type="button" class="tick ${m.type}" style="left:${(tToU(m.t) * 100).toFixed(3)}%" title="${esc(m.label)} · T+ ${fmtDur(m.t)}" aria-label="${esc(m.label)}" data-t="${m.t}"></button>`).join('');
  $('#tend').textContent = '/ ' + fmtDur(C.T);
}
$('#ticks').addEventListener('click', e => { const b = e.target.closest('.tick'); if (!b) return; S.u = tToU(+b.dataset.t); });

// ===================== Results =====================
function updateResults() {
  const chip = $('#chip'), res = $('#res');
  if (!simR || !sys) { chip.className = 'chip bad'; chip.textContent = 'Hesaplanamadı'; res.innerHTML = ''; return; }
  const r = simR, A = S.bodies[0].name, B = S.bodies[1].name, M = S.M;
  let cls = 'warn', txt;
  if (r.impact >= 0) { cls = 'bad'; txt = r.impact === 1 ? B + ' yüzeyine çarptı' : S.bodies[r.impact].name + ' yüzeyine çarptı'; }
  else if (M.mode === 'capture' && r.captured) { cls = 'good'; txt = B + ' yörüngesine girildi'; }
  else if (M.mode === 'free' && r.aRet) { cls = 'good'; txt = 'Serbest dönüş tamam'; }
  else if (M.mode === 'free' && r.bPeri) { txt = B + ' geçişi var, dönüş yok'; }
  else if (r.bPeri) { cls = 'good'; txt = B + ' yakın geçişi'; }
  else txt = B + ' ıskalandı · en yakın ' + fmtDist(r.dmin[1] - sys.R[1]);
  chip.className = 'chip ' + cls; chip.textContent = txt;
  const rows = [];
  const dv2 = r.captured ? r.captured.dv : 0;
  const vdep = r.vc + M.dv, c3 = (vdep * vdep - 2 * sys.mu[0] / r.r0) / 1e6;
  rows.push(['Kalkış Δv', nf1.format(M.dv), 'm/s']);
  if (M.mode === 'capture') rows.push(['Giriş Δv', r.captured ? nf1.format(dv2) : '—', 'm/s']);
  if (M.mode === 'capture') rows.push(['Toplam Δv', nf1.format(M.dv + dv2), 'm/s']);
  rows.push(['C3 · ' + A, nf2.format(c3), 'km²/s²']);
  if (r.bPeri) {
    rows.push([B + ' varış süresi', fmtDur(r.bPeri.t), '']);
    rows.push([Peri(1) + ' irtifası', nf1.format((r.bPeri.d - sys.R[1]) / 1e3), 'km · ' + (r.bPeri.dir > 0 ? 'prograd' : 'retrograd')]);
    const vinf2 = r.bPeri.v * r.bPeri.v - 2 * sys.mu[1] / r.bPeri.d;
    rows.push([Peri(1) + ' hızı', nf3.format(r.bPeri.v / 1e3), 'km/s']);
    rows.push(['v∞ · ' + B, vinf2 > 0 ? nf3.format(Math.sqrt(vinf2) / 1e3) : 'bağlı', vinf2 > 0 ? 'km/s' : '']);
  } else {
    rows.push(['En yakın yaklaşım', fmtDist(r.dmin[1] - sys.R[1]), 'irtifa']);
    rows.push(['Zamanı', fmtDur(r.tmin[1]), '']);
  }
  if (M.mode === 'free') rows.push(['Dönüş ' + peri(0), r.aRet ? nf1.format((r.aRet.d - sys.R[0]) / 1e3) : '—', r.aRet ? 'km · T+ ' + fmtDur(r.aRet.t) : 'dönmüyor']);
  if (guess && Number.isFinite(guess.dv)) rows.push(['Hohmann referansı', nf1.format(guess.dv), 'm/s · ' + nf1.format(guess.tof / DAY) + ' g']);
  rows.push(['Entegrasyon', nf0.format(r.steps), 'adım']);
  res.innerHTML = rows.map(([l, v, u]) => `<div><span class="lbl">${esc(l)}</span><b>${v}${u ? `<em>${esc(u)}</em>` : ''}</b></div>`).join('');
}
function setStatus(t) { $('#status').textContent = t; }

// ===================== Hohmann & Solver =====================
$('#hohmann').addEventListener('click', () => {
  if (!sys) return;
  const g = hohmannGuess(sys, S.M);
  if (!Number.isFinite(g.dv)) { setStatus('Bu yapılandırma için Hohmann tahmini üretilemedi.'); return; }
  Object.assign(S.M, { theta: g.theta, dv: g.dv, t0: g.t0 });
  syncMission(); rebuild({ resetU: true, fit: true });
  setStatus(`Hohmann: Δv ${nf1.format(g.dv)} m/s · transfer ${nf2.format(g.tof / DAY)} gün` + (g.case === 'sibling' ? ` · t₀ ${nf1.format(g.t0)} g` : '') + '. İnce ayar için "Hedefe göre çöz".');
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
  btn.textContent = 'Durdur'; btn.classList.add('busy');
  const s2 = buildSystem(sysList());
  const g = hohmannGuess(s2, S.M);
  const M0 = { ...S.M, theta: g.theta, dv: g.dv, t0: g.t0 };
  if (M0.autoDur) { const k = M0.mode === 'free' ? 2.4 : M0.mode === 'capture' ? 1.3 : 1.5; M0.duration = clamp(g.tof * k / DAY, 0.2, 5000); }
  const varyT0 = g.case === 'sibling';
  const t1 = performance.now();
  setStatus('Çözülüyor…');
  try {
    const opt = { varyT0, t0Grid: g.nested ? [-12, -9, -6, -3, 0, 3, 6, 9, 12] : [-4, -2, 0, 2, 4] };
    const prog = n => setStatus(`Çözülüyor… ${nf0.format(n)} yörünge denendi`);
    const r = await runSolver(sysList(), M0, opt, prog, s2);
    Object.assign(S.M, { theta: r.theta, dv: r.dv, t0: r.t0 });
    syncMission(); rebuild({ resetU: true, fit: true });
    if (!reduceMotion) { S.playing = true; setPlayIcon(); }
    const secs = (performance.now() - t1) / 1000;
    const okv = r.f < 1e-4;
    setStatus((okv ? 'Çözüldü' : 'Tam çözüm bulunamadı, en yakın sonuç uygulandı') + ` · ${nf0.format(r.evals)} yörünge · ${nf1.format(secs)} s`);
  } catch (e) {
    if (e === 'cancel') setStatus('Durduruldu; değerler değişmedi.'); else { setStatus('Çözücü hata verdi: ' + e); console.error(e); }
  } finally {
    solving = false; btn.textContent = 'Hedefe göre çöz'; btn.classList.remove('busy');
  }
}

// ===================== Render loop =====================
const SPo = new Float64Array(8), SVo = new Float64Array(8);
function orbitPos(t, out) {
  states(sys, S.M.t0 * DAY + t, SPo, SVo);
  const o = C.orbit, a = o.w * (t - C.T), c = Math.cos(a), s = Math.sin(a);
  out[0] = SPo[2] + o.rx * c - o.ry * s; out[1] = SPo[3] + o.rx * s + o.ry * c; return out;
}
let last = performance.now(), hold = 0, hudTick = 0, frameAvg = 1 / 60, slowFrames = 0, lowQ = false;
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
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // adaptive quality: if frames stay slow, drop glow and render at 1x pixel ratio
  frameAvg = frameAvg * 0.95 + dt * 0.05;
  if (!lowQ && frameAvg > 0.03 && ++slowFrames > 90) { lowQ = true; resize(); }
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
      if (r > 30) { ctx.fillStyle = hexA(COL.dim, 0.7); ctx.font = '500 10px ' + 'IBM Plex Mono, monospace'; ctx.fillText('SOI', sx(bpos[b][0]) + r * 0.707 + 4, sy(bpos[b][1]) - r * 0.707 - 4); }
    }
    ctx.setLineDash([]);
  }
  // trajectory
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = hexA(COL.traj, 0.26); ctx.lineWidth = 1.2;
  strokePath(C.fx, C.fy, 0, C.fx.length - 1);
  for (const [lw, col] of (lowQ ? [[1.8, COL.traj]] : [[6, hexA(COL.traj, 0.16)], [1.8, COL.traj]])) {
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    strokePath(C.fx, C.fy, 0, pathIdx);
    ctx.beginPath(); ctx.moveTo(sx(C.fx[pathIdx]), sy(C.fy[pathIdx])); ctx.lineTo(sx(cpos[0]), sy(cpos[1])); ctx.stroke();
  }

  if (ext) {
    const rr = C.orbit.r * cam.scale;
    if (rr > 2 && rr < 1e5) { ctx.strokeStyle = hexA(COL.traj, 0.55); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(sx(bpos[1][0]), sy(bpos[1][1]), rr, 0, 6.2832); ctx.stroke(); }
  }
  // markers
  ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
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
    if (isSun) {
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
    ctx.fillText(S.bodies[b].name.toLocaleUpperCase('tr-TR'), x + r + 7, y + r + 12);
  }

  // spacecraft
  {
    const x = sx(cpos[0]), y = sy(cpos[1]);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
    g.addColorStop(0, hexA(COL.traj, 0.6)); g.addColorStop(1, hexA(COL.traj, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.2832); ctx.fill();
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
    const { bot } = insets();
    const target = 110 / cam.scale; const p = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map(k => k * p).reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);
    const px = nice * cam.scale, x0 = 20, y0 = H - bot - 4;
    ctx.strokeStyle = hexA(COL.dim, 0.9); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 5); ctx.stroke();
    ctx.fillStyle = COL.dim; ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText(fmtDist(nice), x0 + 2, y0 - 8);
  }

  // HUD text
  if ((hudTick++ & 3) === 0) {
    const absX = craft[0], absY = craft[1];
    states(sys, S.M.t0 * DAY + tNow, SP, SV);
    const dA = Math.hypot(absX - SP[0], absY - SP[1]), dB = Math.hypot(absX - SP[2], absY - SP[3]);
    const i2 = segAtTime(tNow), h2 = simR.t[i2 + 1] - simR.t[i2], f2 = h2 > 0 ? clamp((tNow - simR.t[i2]) / h2, 0, 1) : 1;
    let vx = simR.vx[i2] + (simR.vx[i2 + 1] - simR.vx[i2]) * f2, vy = simR.vy[i2] + (simR.vy[i2 + 1] - simR.vy[i2]) * f2;
    const near = dB - sys.R[1] < dA - sys.R[0] ? 1 : 0;
    if (ext) { const rx = absX - SP[2], ry = absY - SP[3]; vx = SV[2] - C.orbit.w * ry; vy = SV[3] + C.orbit.w * rx; }
    const A = S.bodies[0].name, B = S.bodies[1].name;
    setT('#r-t', 'T+ ' + fmtDur(tNow, true));
    setT('#tplus', 'T+ ' + fmtDur(tNow, true));
    setT('#r-l1', 'İrtifa · ' + A); setT('#r-v1', fmtDist(Math.max(0, dA - sys.R[0])));
    setT('#r-l2', 'İrtifa · ' + B); setT('#r-v2', fmtDist(Math.max(0, dB - sys.R[1])));
    setT('#r-l3', 'Bağıl hız · ' + (near ? B : A));
    setT('#r-v3', fmtSpeed(Math.hypot(vx - SV[2 * near], vy - SV[2 * near + 1])));
    setT('#tend', '/ ' + fmtDur(C.T) + (ext ? ' · yörüngede ' + (1 + Math.floor(S.ext / C.orbit.P)) + '. tur' : ''));
    if (!scrubbing) scrub.value = Math.round(S.u * 10000);
  }
  requestAnimationFrame(draw);
}

// ===================== Glossary =====================
const GLOSS = [
  ['Yörünge noktaları', [
    ['Periapsis / Apoapsis', 'peri- / apo-', 'Bir yörüngenin merkez cisme en yakın (periapsis) ve en uzak (apoapsis) noktaları. Genel isimdir; cisme göre özel adlar kullanılır (aşağıdaki tablo).'],
    ['__APSIS__'],
    ['Perigee / Apogee', 'Dünya', 'Dünya etrafındaki yörüngenin en yakın ve en uzak noktası. Serbest dönüşte "dönüş perigee" atmosfere giriş irtifasıdır.'],
    ['Perilune / Apolune', 'Ay', 'Ay etrafındaki en yakın ve en uzak nokta. Apollo görevlerinde "pericynthion" da denir.'],
    ['Perihelion / Aphelion', 'Güneş', 'Güneş etrafındaki yörüngede en yakın ve en uzak nokta. Dünya–Mars Hohmann transferinde kalkış perihelion, varış aphelion noktasındadır.'],
  ]],
  ['Manevralar', [
    ['Δv (delta-v)', 'm/s', 'Bir manevra için gereken hız değişimi. Roket denklemiyle doğrudan yakıt miktarına bağlıdır: <code>Δv = Isp·g₀·ln(m₀/m₁)</code>.'],
    ['Hohmann transferi', '', 'İki dairesel yörünge arasında, iki teğetsel yanmayla yapılan en az enerjili transfer. Transfer elipsi bir yörüngeye periapsisinde, diğerine apoapsisinde değer.'],
    ['Park yörüngesi', '', 'Transferden önce aracın beklediği alçak dairesel yörünge. Kalkış yanması buradan yapılır.'],
    ['TLI', 'Trans-Lunar Injection', 'Dünya park yörüngesinden Ay\'a gönderen kalkış yanması. Alçak yörüngede yaklaşık 3,1 km/s.'],
    ['Yörüngeye giriş', 'capture', 'Hedefe varışta aracı yavaşlatıp hedefin etrafında kapalı bir yörüngeye sokan yanma. Uygulamada periapsiste, dairesel yörüngeye anlık yanma olarak modellenir.'],
    ['Prograd / Retrograd', '', 'Prograd: yörünge hareketi yönünde. Retrograd: ters yönde. Hedefin etrafında retrograd geçiş, serbest dönüşte 8 (S) biçimini verir.'],
    ['Anlık yanma', 'impulsive burn', 'Motor yanma süresinin yörünge periyoduna göre çok kısa olduğu varsayımı; hız bir anda değişir. Düşük itkili motorlarda geçerli değildir.'],
  ]],
  ['Görev tipleri', [
    ['Serbest dönüş', 'free return', 'Hedefin yanından geçip ek yanma yapmadan başlangıç cismine geri dönen yörünge. Apollo 13 bu yörüngeyle kurtarıldı.'],
    ['Yakın geçiş', 'flyby', 'Hedefin yanından yörüngeye girmeden geçmek. Hedefin çekimi aracın yönünü ve hızını değiştirir (kütleçekim yardımı).'],
    ['Kütleçekim yardımı', 'gravity assist', 'Bir gezegenin yanından geçerken onun yörünge hareketinden hız ödünç almak. Hedefe göre hız aynı kalır, Güneş\'e göre değişir.'],
    ['Cycler', '', 'İki cisim arasında periyodik olarak gidip gelen, kendini tekrarlayan yörünge (ör. Aldrin cycler, Dünya–Mars). Korunması için küçük düzeltme yanmaları gerekir.'],
    ['Atmosfer girişi', 'entry interface', 'Dünya için yaklaşık 120 km irtifa. Dönüş perigee\'si bu koridorun içine nişanlanırsa sürtünme aracı yakalar.'],
  ]],
  ['Hız ve enerji', [
    ['v∞', 'hiperbolik fazla hız', 'Aracın bir cismin etki küresinden çıkarken (ya da girerken) o cisme göre sahip olduğu artık hız. Kaçış hızını aşan kısımdır.'],
    ['C3', 'karakteristik enerji, km²/s²', 'Kalkıştaki yörünge enerjisinin iki katı: <code>C3 = v∞²</code>. Negatifse araç cisme bağlıdır (Ay transferi), pozitifse kaçar (Mars transferi).'],
    ['Kaçış hızı', '', 'Bir cismin çekiminden kurtulmak için gereken en düşük hız: <code>v = √(2μ/r)</code>. Dünya yüzeyinde ≈ 11,2 km/s.'],
    ['μ (mu)', 'GM, m³/s²', 'Standart kütleçekim parametresi; cismin kütlesi ile G\'nin çarpımı. Kütleden çok daha hassas bilinir.'],
  ]],
  ['Model ve görünüm', [
    ['SOI', 'Sphere of Influence · etki küresi', 'Bir cismin çekiminin baskın sayıldığı bölge: <code>r ≈ a·(m/M)^(2/5)</code>. Ay\'ın SOI\'si ≈ 66.000 km, Dünya\'nınki (Güneş\'e göre) ≈ 925.000 km.'],
    ['Faz açısı', 'fırlatma penceresi', 'Kalkış anında hedefin, kalkış cismine göre önde olması gereken açı. Dünya–Mars için ≈ 44°; bu geometri yaklaşık her 26 ayda bir tekrarlar.'],
    ['Eylemsiz çerçeve', '', 'Dönmeyen, sabit yıldızlara göre tanımlı görünüm. Yörüngeler "gerçek" şekilleriyle görünür.'],
    ['Dönen çerçeve', 'sinodik', 'İki cismi aynı yerde sabit tutan, onlarla birlikte dönen görünüm. Serbest dönüşün 8 biçimi yalnızca burada görünür.'],
    ['Kısıtlı N-cisim', '', 'Aracın kütlesinin ihmal edildiği model: cisimler aracı çeker, araç cisimleri çekmez. Bu uygulamanın kullandığı modeldir.'],
    ['Patched conic', 'yamalı konikler', 'Yörüngeyi her SOI\'de tek bir cismin Kepler yörüngesi olarak hesaplayıp sınırlarda birleştiren yaklaşım. "Hohmann tahmini" bununla yapılır.'],
  ]],
];
const APSIS_TABLE = [['Dünya', 'perigee', 'apogee'], ['Ay', 'perilune', 'apolune'], ['Güneş', 'perihelion', 'aphelion'], ['Mars', 'periareion', 'apoareion'], ['Venüs', 'pericytherion', 'apocytherion'], ['Jüpiter', 'perijove', 'apojove']];
function renderGloss(q) {
  const n = s => s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const qq = n(q.trim());
  let html = '';
  for (const [grp, items] of GLOSS) {
    const rows = items.filter(it => {
      if (it[0] === '__APSIS__') return !qq || APSIS_TABLE.some(r => r.some(c => n(c).includes(qq)));
      return !qq || n(it.join(' ').replace(/<[^>]+>/g, '')).includes(qq);
    }).map(it => it[0] === '__APSIS__'
      ? `<div><table class="apsis"><thead><tr><th>Cisim</th><th>En yakın</th><th>En uzak</th></tr></thead><tbody>${APSIS_TABLE.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>`
      : `<div><dt>${it[0]}${it[1] ? `<i>${it[1]}</i>` : ''}</dt><dd>${it[2]}</dd></div>`).join('');
    if (rows) html += `<div class="gloss-grp"><span>${grp}</span><dl>${rows}</dl></div>`;
  }
  $('#glossBody').innerHTML = html || '<p class="none">Bu aramayla eşleşen terim yok.</p>';
}
function setGloss(open) {
  $('#gloss').hidden = !open; $('#helpBtn').setAttribute('aria-expanded', String(open));
  if (open) { renderGloss($('#glossQ').value); $('#glossQ').focus({ preventScroll: true }); }
}
$('#helpBtn').addEventListener('click', () => setGloss($('#gloss').hidden));
$('#glossClose').addEventListener('click', () => { setGloss(false); $('#helpBtn').focus(); });
$('#glossQ').addEventListener('input', e => renderGloss(e.target.value));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#gloss').hidden) { setGloss(false); $('#helpBtn').focus(); } });
document.addEventListener('pointerdown', e => { if (!$('#gloss').hidden && !e.target.closest('#gloss') && !e.target.closest('#helpBtn')) setGloss(false); });

// ===================== Init =====================
$('#scenario').innerHTML = SCENARIOS.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
$('#scenario').addEventListener('change', e => loadScenario(e.target.value));
resize();
loadScenario('em_free');
setPlayIcon();
requestAnimationFrame(t => { last = t; draw(t); });
