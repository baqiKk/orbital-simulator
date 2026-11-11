// The design wizard (Phase 16c): the mission window's face in the plain layout (the expert layout shows the full form).
// First "Ne yapmak istiyorsun?": change an orbit about one body, go to another body (a transfer), a free burn. A path is a
// few steps (cards: the open one shows its fields, the others a one-line summary), examples that fill it in one click,
// a warning in plain words next to an always visible "Görevi başlat", which computes and plays; then a result card
// ("Değiştir" goes back to the form). The wizard writes the same state the full form edits (S.M, the bodies) and runs
// the same rebuild, so the expert layout shows what it set. Classic script after app.js (its globals).
const WZ = { path: '', step: 0, res: false, auto: null, raf: 0 };
const WZ_DEF = { body: 'earth', c0: 'circ', h0: '600', p0: '250', a0: '35786', i0: '0', c1: 'circ', h1: '1300', p1: '600', a1: '1300', i1: '0',
  meth: 'auto', plane: 'comb', rb: '100000', thr: 'imp', F: '400', isp: '', m0: '', md: '', j2: false };
const WZV = { ...WZ_DEF };
const WZ_EX = WIZ_EX; // prefs.js (the tests fly each)
const WZ_CHIPS = ['earth', 'moon', 'mars'];
const wzEl = id => document.getElementById(id);
// a number as typed (a comma or a point for decimals, spaces between thousands), nothing else after it
const wzNum = v => { const s = String(v).replace(/\s/g, '').replace(',', '.'); return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? +s : NaN; };
// a body's sphere of influence (m): a·(m/M)^0.4 about its parent; the Sun's is unbounded
function wzSoi(k) {
  const d = BODIES[k], p = d.parent && BODIES[d.parent];
  if (!p || !d.orb) return Infinity;
  const a = d.orb.jpl ? d.orb.jpl[0][0] * AU : d.orb.sat ? d.orb.sat[0] * 1e3 : d.orb.sb ? d.orb.sb[1] * AU : 0;
  return a > 0 ? a * Math.pow(d.gm / p.gm, 0.4) : Infinity;
}
const wzNames = k => apsNames(k).map(cap1);
const kmTxt = v => nf0.format(v);

// ----- the form -----
function wzShow() {
  const pick = !WZ.path, res = WZ.res && !pick;
  wzEl('wzPick').hidden = !pick; wzEl('wzForm').hidden = pick || res; wzEl('wzRes').hidden = !res; wzEl('wzFoot').hidden = pick || res;
  INS = null;
}
function wzPick(path) {
  WZ.path = path; WZ.res = false; WZ.step = 0;
  wzRender(); wzShow(); wzCheckShow();
  const f = wzEl('wzSteps').querySelector('.wz-step.on input, .wz-step.on button, .wz-step.on select'); if (f) f.focus();
}
const seg2 = (id, opts, v) => `<div class="seg full" id="${id}" role="group">${opts.map(([val, key]) => `<button type="button" data-v="${val}" aria-pressed="${val === v}">${esc(_(key))}</button>`).join('')}</div>`;
const fld = (id, label, v, extra = '') => `<label class="field" id="${id}W"><span id="${id}L">${esc(label)}</span><input type="text" inputmode="decimal" id="${id}" value="${esc(v)}" ${extra}></label>`;
function orbitFields(n) { // n: 0 start, 1 target
  const [pn, an] = wzNames(WZV.body), c = WZV['c' + n];
  return seg2('wz-c' + n, [['circ', 'wz.circ'], ['ell', 'wz.ell']], c)
    + `<div class="grid3">${fld('wz-h' + n, _('wz.alt'), WZV['h' + n])}${fld('wz-p' + n, _('wz.peri', { peri: pn }), WZV['p' + n])}${fld('wz-a' + n, _('wz.apo', { apo: an }), WZV['a' + n])}${fld('wz-i' + n, _('wz.inc'), WZV['i' + n])}</div>`;
}
function wzSteps() {
  if (WZ.path === 'orbit') {
    const other = KEYS_MV.filter(k => !WZ_CHIPS.includes(k));
    return [
      { t: 'wz.s.body', b: `<div class="wz-chips" id="wz-body">${WZ_CHIPS.map(k => `<button type="button" data-v="${k}" aria-pressed="${WZV.body === k}">${esc(_('body.' + k))}</button>`).join('')}`
        + `<select id="wz-other" aria-label="${esc(_('wz.other'))}"><option value="">${esc(_('wz.other'))}</option>${other.map(k => `<option value="${k}"${WZV.body === k ? ' selected' : ''}>${esc(_('body.' + k))}</option>`).join('')}</select></div>` },
      { t: 'wz.s.start', b: orbitFields(0) },
      { t: 'wz.s.target', b: orbitFields(1) },
      { t: 'wz.s.method', b: seg2('wz-meth', [['auto', 'wz.m.auto'], ['hohmann', 'wz.m.hohmann'], ['bielliptic', 'wz.m.bielliptic']], WZV.meth) + `<p class="wz-d" id="wz-methD"></p>`
        + `<div class="field" id="wz-planeW"><span>${esc(_('wz.plane'))}</span>${seg2('wz-plane', [['comb', 'wz.plane.comb'], ['sep', 'wz.plane.sep']], WZV.plane)}</div>`
        + fld('wz-rb', _('wz.rb'), WZV.rb)
        + `<details class="adv"><summary>${esc(_('wz.adv'))}</summary><div class="adv-b wz-adv">`
        + `<div class="field"><span>${esc(_('wz.thr'))}</span>${seg2('wz-thr', [['imp', 'wz.thr.imp'], ['fin', 'wz.thr.fin']], WZV.thr)}</div>`
        + `<div class="grid2">${fld('wz-m0', _('wz.m0'), WZV.m0)}${fld('wz-isp', _('wz.isp'), WZV.isp)}${fld('wz-F', _('wz.F'), WZV.F)}${fld('wz-md', _('wz.md'), WZV.md)}</div>`
        + `<p class="wz-d" id="wz-fuelD">${esc(_('wz.fuelHint'))}</p>`
        + `<label class="chk"><input type="checkbox" id="wz-j2"${WZV.j2 ? ' checked' : ''}><span>${esc(_('wz.j2'))}</span></label></div></details>` },
    ];
  }
  return [];
}
function wzRender() {
  const st = wzSteps();
  wzEl('wzSteps').innerHTML = st.map((s, i) => `<section class="wz-step" data-i="${i}"><button type="button" class="wz-h" aria-expanded="false"><span class="wz-n">${i + 1}</span><span class="wz-t">${esc(_(s.t))}</span><span class="wz-sum"></span></button>`
    + `<div class="wz-b">${s.b}${i < st.length - 1 ? `<button type="button" class="btn sm wz-next">${esc(_('wz.next'))}</button>` : ''}</div></section>`).join('');
  wzEl('wzEx').innerHTML = WZ.path === 'orbit' ? Object.keys(WZ_EX).map(k => `<button type="button" data-ex="${k}">${esc(_('wz.ex.' + k))}</button>`).join('') : '';
  wzEl('wzEx').hidden = WZ.path !== 'orbit';
  wzOpen(WZ.step); wzSync();
}
function wzOpen(i) {
  WZ.step = i;
  for (const s of wzEl('wzSteps').querySelectorAll('.wz-step')) { const on = +s.dataset.i === i; s.classList.toggle('on', on); s.querySelector('.wz-h').setAttribute('aria-expanded', String(on)); }
  INS = null;
}
// what depends on the values: shown fields, labels, summaries, the method's description
function wzSync() {
  if (WZ.path !== 'orbit') return;
  const [pn, an] = wzNames(WZV.body);
  for (const n of [0, 1]) {
    const circ = WZV['c' + n] === 'circ';
    wzEl('wz-h' + n + 'W').hidden = !circ; wzEl('wz-p' + n + 'W').hidden = circ; wzEl('wz-a' + n + 'W').hidden = circ;
    wzEl('wz-p' + n + 'L').textContent = _('wz.peri', { peri: pn }); wzEl('wz-a' + n + 'L').textContent = _('wz.apo', { apo: an });
  }
  const m = WZV.meth, inc = wzNum(WZV.i0) !== wzNum(WZV.i1);
  wzEl('wz-methD').textContent = _('wz.m.' + m + 'D');
  wzEl('wz-planeW').hidden = m === 'auto' || !inc; wzEl('wz-rbW').hidden = m !== 'bielliptic';
  const fin = WZV.thr === 'fin'; wzEl('wz-FW').hidden = !fin; wzEl('wz-mdW').hidden = !fin;
  // summaries
  const sums = wzEl('wzSteps').querySelectorAll('.wz-sum'), orb = n => WZV['c' + n] === 'circ'
    ? _('wz.sumCirc', { h: WZV['h' + n], i: WZV['i' + n] }) : _('wz.sumEll', { p: WZV['p' + n], a: WZV['a' + n], i: WZV['i' + n] });
  sums[0].textContent = _('body.' + WZV.body); sums[1].textContent = orb(0); sums[2].textContent = orb(1);
  sums[3].textContent = _('wz.m.' + m) + (fin ? ' · ' + _('wz.thr.fin') : '');
  for (const b of wzEl('wz-body').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === WZV.body));
  wzEl('wz-other').value = WZ_CHIPS.includes(WZV.body) ? '' : WZV.body;
}
// ----- checks: the first problem, in plain words, and the step it is in -----
function wzOrbitVals() {
  const v = WZV, k = v.body, d = BODIES[k], Re = d.j2[1] * 1e3, R = d.radius * 1e3;
  const ap = n => v['c' + n] === 'circ' ? [wzNum(v['h' + n]), wzNum(v['h' + n])] : [wzNum(v['p' + n]), wzNum(v['a' + n])];
  const [hp0, ha0] = ap(0), [hp1, ha1] = ap(1), rp1 = Re + hp1 * 1e3, ra1 = Re + ha1 * 1e3;
  return { k, d, Re, R, mu: d.gm * 1e9, hp0, ha0, hp1, ha1, i0: wzNum(v.i0), i1: wzNum(v.i1), e1: (ra1 - rp1) / (ra1 + rp1), soi: wzSoi(k) };
}
function wzCheck() {
  if (WZ.path !== 'orbit') return { err: '' };
  const v = WZV, o = wzOrbitVals(), [pn, an] = wzNames(o.k), name = _('body.' + o.k);
  const fail = (step, id, err) => ({ err, step, id });
  for (const n of [0, 1]) {
    const ids = v['c' + n] === 'circ' ? ['h' + n] : ['p' + n, 'a' + n];
    for (const f of [...ids, 'i' + n]) {
      const x = wzNum(v[f]), lbl = f[0] === 'h' ? _('wz.alt') : f[0] === 'p' ? _('wz.peri', { peri: pn }) : f[0] === 'a' ? _('wz.apo', { apo: an }) : _('wz.inc');
      if (!Number.isFinite(x)) return fail(1 + n, 'wz-' + f, _('wz.e.num', { f: lbl.replace(/ \(.*\)$/, '') }));
    }
    const hp = n ? o.hp1 : o.hp0, ha = n ? o.ha1 : o.ha0, i = n ? o.i1 : o.i0;
    if (o.Re + hp * 1e3 <= o.R || hp <= 0) return fail(1 + n, 'wz-' + (v['c' + n] === 'circ' ? 'h' : 'p') + n, _(n ? 'wz.e.below' : 'wz.e.belowStart'));
    if (ha < hp) return fail(1 + n, 'wz-a' + n, _('wz.e.apsis', { apo: an, peri: pn }));
    if (o.Re + ha * 1e3 > o.soi) return fail(1 + n, 'wz-' + (v['c' + n] === 'circ' ? 'h' : 'a') + n, _(n ? 'wz.e.soi' : 'wz.e.soiStart', { body: name, r: kmTxt(o.soi / 1e3) }));
    if (!(i >= 0 && i <= 180)) return fail(1 + n, 'wz-i' + n, _('wz.e.inc'));
  }
  if (Math.abs(o.hp0 - o.hp1) < 1e-9 && Math.abs(o.ha0 - o.ha1) < 1e-9 && Math.abs(o.i0 - o.i1) < 1e-9) return fail(2, 'wz-' + (v.c1 === 'circ' ? 'h1' : 'p1'), _('wz.e.same'));
  if (v.meth === 'bielliptic') {
    const rb = wzNum(v.rb);
    if (!Number.isFinite(rb)) return fail(3, 'wz-rb', _('wz.e.num', { f: _('wz.rb').replace(/ \(.*\)$/, '') }));
    if (!(rb > Math.max(o.ha0, o.ha1)) || o.Re + rb * 1e3 > o.soi / 2) return fail(3, 'wz-rb', _('wz.e.rb'));
  }
  const m0 = wzNum(v.m0), isp = wzNum(v.isp), F = wzNum(v.F), md = wzNum(v.md);
  if (v.thr === 'fin') {
    for (const [f, x, key] of [['m0', m0, 'wz.m0'], ['isp', isp, 'wz.isp'], ['F', F, 'wz.F'], ['md', md, 'wz.md']]) {
      const lbl = _(key).replace(/ \(.*\)$/, '');
      if (!Number.isFinite(x)) return fail(3, 'wz-' + f, _('wz.e.num', { f: lbl }));
      if (!(x > 0)) return fail(3, 'wz-' + f, _('wz.e.pos', { f: lbl }));
    }
    if (!(md < m0)) return fail(3, 'wz-md', _('wz.e.mass'));
  } else if ((v.m0 !== '' || v.isp !== '') && !(m0 > 0 && isp > 0)) return fail(3, v.m0 === '' || !(m0 > 0) ? 'wz-m0' : 'wz-isp', _('wz.e.mass2'));
  // the plan itself (the core's own refusals: escape, a burn below the surface)
  const { o0, o1 } = mvOrbits({ hp0: o.hp0, ha0: o.ha0, i0: o.i0, hp1: o.hp1, e1: o.e1, i1: o.i1, type: 'hohmann', rb: 0, plane: 'comb', k: 1 }, o.Re);
  const p = maneuverPlan(o.mu, o.R, o0, o1, { type: 'hohmann', plane: 'comb', k: 1 });
  if (p.error) return fail(2, '', _(p.error));
  return { err: '' };
}
function wzCheckShow() {
  const c = wzCheck(), st = wzEl('wzSteps');
  wzEl('wzErr').textContent = c.err; wzEl('wzGo').disabled = !!c.err;
  for (const s of st.querySelectorAll('.wz-step')) { s.classList.toggle('bad', !!c.err && +s.dataset.i === c.step); s.classList.toggle('ok', !c.err || +s.dataset.i < c.step); }
  for (const i of st.querySelectorAll('input[type=text]')) i.setAttribute('aria-invalid', String(i.id === c.id));
  return c;
}

// ----- events -----
wzEl('wzPick').addEventListener('click', e => { const c = e.target.closest('.wiz-card'); if (c) wzPick(c.dataset.path); });
wzEl('wzBack').addEventListener('click', () => { WZ.path = ''; wzShow(); wzEl('wzPick').querySelector('.wiz-card').focus(); });
wzEl('wzEx').addEventListener('click', e => {
  const b = e.target.closest('[data-ex]'); if (!b) return;
  Object.assign(WZV, { ...WZ_DEF, m0: WZV.m0, isp: WZV.isp, F: WZV.F, md: WZV.md, thr: WZV.thr, j2: WZV.j2 }, WZ_EX[b.dataset.ex]);
  wzRender(); wzOpen(-1); wzCheckShow(); wzEl('wzGo').focus();
});
wzEl('wzSteps').addEventListener('click', e => {
  const h = e.target.closest('.wz-h'); if (h) { const i = +h.parentElement.dataset.i; wzOpen(WZ.step === i ? -1 : i); return; }
  if (e.target.closest('.wz-next')) { wzOpen(WZ.step + 1); const f = wzEl('wzSteps').querySelector('.wz-step.on input, .wz-step.on button:not(.wz-h)'); if (f) f.focus(); return; }
  const b = e.target.closest('.seg button, .wz-chips button'); if (!b) return;
  const g = b.parentElement.id.replace('wz-', '');
  WZV[g] = b.dataset.v;
  for (const x of b.parentElement.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
  if (g === 'body') wzRender();
  wzSync(); wzCheckShow();
});
wzEl('wzSteps').addEventListener('input', e => {
  const t = e.target, f = t.id.replace('wz-', '');
  if (t.id === 'wz-other') { if (t.value) { WZV.body = t.value; wzRender(); wzCheckShow(); } return; }
  if (t.type === 'checkbox') WZV[f] = t.checked; else if (f in WZV) WZV[f] = t.value.trim();
  wzSync(); wzCheckShow();
});
wzEl('wzSteps').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[type=text]')) { e.preventDefault(); wzGo(); } });
wzEl('wzGo').addEventListener('click', () => wzGo());
wzEl('wzExpert').addEventListener('click', () => { const x = $('#expertUi'); x.checked = true; x.dispatchEvent(new Event('change')); });

// ----- run -----
function wzGo() {
  const c = wzCheckShow();
  if (c.err) { if (c.step != null) wzOpen(c.step); const el = c.id && wzEl(c.id); if (el) el.focus(); return; }
  if (WZ.path === 'orbit') wzRunOrbit();
}
// the maneuver state for the core (the full form's fields), the automatic method resolved here
function wzRunOrbit() {
  const v = WZV, o = wzOrbitVals(), fin = v.thr === 'fin';
  let type = v.meth, plane = v.plane, rb = wzNum(v.rb);
  WZ.auto = null;
  if (v.meth === 'auto') {
    const { o0, o1 } = mvOrbits({ hp0: o.hp0, ha0: o.ha0, i0: o.i0, hp1: o.hp1, e1: o.e1, i1: o.i1, type: 'hohmann', rb: 0, plane: 'comb', k: 1 }, o.Re);
    const a = maneuverAuto(o.mu, o.R, o0, o1, { k: 1 }, o.soi / 2);
    if (a.error) { wzEl('wzErr').textContent = _(a.error); return; }
    type = a.type; plane = a.plane; if (a.rb) rb = (a.rb - o.Re) / 1e3;
    WZ.auto = a;
  } else if (wzNum(v.i0) === wzNum(v.i1)) plane = 'comb';
  if (!Number.isFinite(rb) || !(rb > Math.max(o.ha0, o.ha1))) rb = Math.max(o.ha0, o.ha1) * 2 + 1000; // unused unless bi-elliptic
  const m0 = wzNum(v.m0), isp = wzNum(v.isp), F = wzNum(v.F), md = wzNum(v.md);
  if (S.kind !== 'man') saveKind();
  if (MAP.on) setMap(false);
  Object.assign(S, { kind: 'man', model: 'real', frame: 'eq', scenario: '', follow: 'free' });
  S.M = { ...MV_DEF, body: o.k, t0: utcToDays(Math.floor(Date.now() / 60000) * 60000), hp0: o.hp0, ha0: o.ha0, i0: o.i0, O0: 0, hp1: o.hp1, e1: +o.e1.toFixed(9), i1: o.i1,
    type, rb, plane, k: 1, j2: !!v.j2, thrust: fin ? 'fin' : 'imp', steer: 'local',
    m0: m0 > 0 ? m0 : 1000, isp: isp > 0 ? isp : 320, F: F > 0 ? F : 400, md: md > 0 && md < (m0 > 0 ? m0 : 1000) ? md : 0.3 * (m0 > 0 ? m0 : 1000), veh: '' };
  S.bodies = [bodyFromPreset(o.k)];
  $('#scenario').value = ''; $('#scNote').textContent = _('sc.mv.note');
  openRows.clear(); MAP.needFit = true;
  syncKind(); syncModel(); renderBodies(); syncMission(); syncMan(); renderFrameSeg();
  APP.mode = 'design';
  rebuild({ fit: true, resetU: true });
  S.playing = !reduceMotion; setPlayIcon();
  WZ.res = true; wzShow(); wzResult();
}

// ----- the result card -----
const wzSpan = s => (s < 1 ? '—' : fmtDur(s));
function wzResult() {
  if (!WZ.res) return;
  const box = wzEl('wzRes'), v = WZV, o = wzOrbitVals(), name = _('body.' + o.k);
  const orb = n => (n ? o.hp1 === o.ha1 : o.hp0 === o.ha0) ? kmTxt(n ? o.hp1 : o.hp0) + ' km' : kmTxt(n ? o.hp1 : o.hp0) + ' × ' + kmTxt(n ? o.ha1 : o.ha0) + ' km';
  const head = `<div class="wr-h"><b>${esc(_('wz.r.title', { body: name, a: orb(0), b: orb(1) }))}</b><button type="button" class="btn sm" data-wr="edit">${esc(_('wz.r.edit'))}</button></div>`;
  const act = `<div class="wr-act"><button type="button" class="btn sm" data-wr="replay">${esc(_('wz.r.replay'))}</button><button type="button" class="btn sm" data-wr="more">${esc(_('wz.r.more'))}</button></div>`;
  if (!MAN || !simR) { box.innerHTML = head + `<p class="wr-note">${esc(_('wz.r.fail', { e: $('#err').textContent || _('res.fail') }))}</p>`; return; }
  const [pn, an] = wzNames(o.k), plan = MAN.plan, busy = MAN.busy && !MAN.res;
  // the burns flown (finite: each with its start and length), where each is (an apsis of the orbit before it)
  const burns = (simR.burns || []).map(b => ({ t: b.t0 != null ? b.t0 : b.t, len: b.t1 != null ? b.t1 - b.t0 : 0, dv: b.dv, node: b.node }));
  const where = b => {
    const n = plan.nodes && plan.nodes[b.node]; if (!n) return '';
    for (const a of [n.a1, n.a2]) { const r2 = 2 * a - n.r; if (Math.abs(r2 - n.r) > 1e-9 * n.r) return n.r < r2 ? pn : an; }
    return _('res.mvCircle');
  };
  const total = burns.reduce((s, b) => s + b.dv, 0) || plan.dv, t0 = burns.length ? burns[0].t : 0, tof = burns.length > 1 ? burns[burns.length - 1].t - t0 : plan.tof;
  let html = head;
  if (busy) html += `<p class="wr-note">${esc(_('wz.r.busy', { p: nf0.format(MAN.prog || 0) }))}</p>`;
  html += `<div class="wr-big"><div><span>${esc(_('wz.r.total'))}</span><b>${esc(fmtSpeed(total))}</b></div><div><span>${esc(_('wz.r.tof'))}</span><b>${esc(wzSpan(tof))}</b></div></div>`;
  const m0 = wzNum(v.m0), isp = wzNum(v.isp);
  if (m0 > 0 && isp > 0) html += `<div class="wr-big"><div style="grid-column:1/-1"><span>${esc(_('wz.r.fuel', { m: kmTxt(m0), isp: kmTxt(isp) }))}</span><b>${esc(nf1.format(propMass(m0, total, isp)))} kg</b></div></div>`;
  html += `<table class="wr-burns"><caption class="sr">${esc(_('wz.r.burns'))}</caption><tbody>` + burns.map((b, j) => `<tr class="go" data-t="${b.t}"><th scope="row">${j + 1} · ${esc(cap1(where(b)))}<small>${esc(_('hud.tplus', { t: fmtDur(b.t - t0, true) }))}${b.len ? ' · ' + esc(_('sch.dur', { d: fmtBurn(b.len) })) : ''}</small></th><td>${esc(nf1.format(b.dv))} m/s</td></tr>`).join('') + '</tbody></table>';
  if (WZ.auto) {
    const a = WZ.auto, row = (key, x, on) => x ? `${on ? '<b>' : ''}${esc(_(key))}: ${esc(_('wz.r.cmpRow', { dv: fmtSpeed(x.dv), t: wzSpan(x.tof) }))}${on ? ' (' + esc(_('wz.r.pick')) + ')</b>' : ''}` : '';
    html += `<p class="wr-cmp">${esc(_('wz.r.cmp'))}: ${[row('wz.r.hoh', a.hoh, a.type === 'hohmann'), row('wz.r.bi', a.bi, a.type === 'bielliptic')].filter(Boolean).join(' · ')}</p>`;
  }
  box.innerHTML = html + act;
}
// called by app.js updateResults (a finished worker job, a rebuild): the card follows, once per frame
function wzAfterResults() {
  if (!WZ.res || WZ.raf) return;
  WZ.raf = requestAnimationFrame(() => { WZ.raf = 0; if (WZ.path === 'orbit' && S.kind === 'man') wzResult(); });
}
wzEl('wzRes').addEventListener('click', e => {
  const tr = e.target.closest('tr.go');
  if (tr && C) { S.u = tToU(+tr.dataset.t); S.ext = 0; slowJump(); return; }
  const b = e.target.closest('[data-wr]'); if (!b) return;
  const w = b.dataset.wr;
  if (w === 'edit') { WZ.res = false; wzShow(); wzCheckShow(); wzEl('wzGo').focus(); }
  else if (w === 'replay' && C) { S.u = 0; S.ext = 0; slowJump(); S.playing = true; setPlayIcon(); }
  else if (w === 'more') setWin('results', { open: true, collapsed: false });
});
wzShow();
