// The design wizard (Phase 16c): the mission window's face in the plain layout (the expert layout shows the full form).
// First "Ne yapmak istiyorsun?": change an orbit about one body, go to another body (a transfer), a free burn. A path is a
// few steps (cards: the open one shows its fields, the others a one-line summary), examples that fill it in one click,
// a warning in plain words next to an always visible "Görevi başlat", which computes and plays; then a result card
// ("Değiştir" goes back to the form). The wizard writes the same state the full form edits (S.M, the bodies) and runs
// the same rebuild, so the expert layout shows what it set. Classic script after app.js (its globals).
const WZ = { path: '', step: 0, res: false, auto: null, raf: 0, go: null };
const wzToday = () => new Date().toISOString().slice(0, 10);
const WZ_DEF = { body: 'earth', c0: 'circ', h0: '600', p0: '250', a0: '35786', i0: '0', c1: 'circ', h1: '1300', p1: '600', a1: '1300', i1: '0',
  meth: 'auto', plane: 'comb', rb: '100000', thr: 'imp', F: '400', isp: '', m0: '', md: '', j2: false,
  // "Başka bir cisme git": departure and its parking orbit, target, arrival (capture, flyby, free return), when
  dep: 'earth', gh0: '185', tgt: 'mars', mode: 'capture', ghB: '300', ghRet: '60', when: 'cheap', date: wzToday(),
  // "Serbest yanma": where (the periapsis, the apoapsis, or T s after the periapsis) and Δv [prograde, radial, normal]
  fbAt: 'peri', fbT: '600', fbP: '500', fbR: '0', fbN: '0' };
const WZV = { ...WZ_DEF };
const WZ_EX = WIZ_EX; // prefs.js (the tests fly each)
const WZ_CHIPS = ['earth', 'moon', 'mars'];
// "Başka bir cisme git": the usual bodies as chips, the rest in a list; examples
const WZ_DEP = ['earth', 'moon', 'mars'], WZ_TGT = ['moon', 'mars', 'venus', 'jupiter'];
const WZ_GO_KEYS = KEYS_REAL.filter(k => k !== 'sun' && BODIES[k].gm);
const WZ_GEX = {
  mars: { dep: 'earth', gh0: '185', tgt: 'mars', mode: 'capture', ghB: '300', when: 'cheap' },
  moonFree: { dep: 'earth', gh0: '185', tgt: 'moon', mode: 'free', ghB: '250', ghRet: '60', when: 'date' },
  moonOrbit: { dep: 'earth', gh0: '185', tgt: 'moon', mode: 'capture', ghB: '100', when: 'date' },
  venus: { dep: 'earth', gh0: '185', tgt: 'venus', mode: 'flyby', ghB: '500', when: 'cheap' },
};
// "Serbest yanma": examples (the start orbit and the burn)
const WZ_FEX = {
  raise: { body: 'earth', c0: 'circ', h0: '400', i0: '51.6', fbAt: 'peri', fbP: '300', fbR: '0', fbN: '0' },
  plane: { body: 'earth', c0: 'circ', h0: '400', i0: '0', fbAt: 'peri', fbP: '0', fbR: '0', fbN: '500' },
  radial: { body: 'earth', c0: 'circ', h0: '400', i0: '0', fbAt: 'peri', fbP: '0', fbR: '200', fbN: '0' },
  escape: { body: 'earth', c0: 'circ', h0: '300', i0: '0', fbAt: 'peri', fbP: '3300', fbR: '0', fbN: '0' },
  moonDown: { body: 'moon', c0: 'circ', h0: '100', i0: '0', fbAt: 'peri', fbP: '-20', fbR: '0', fbN: '0' },
};
// a body and its own moon (either way): a free return makes sense, the porkchop does not (not siblings)
const wzPair = (a, b) => BODIES[b].parent === a || BODIES[a].parent === b;
const wzSib = (a, b) => !!BODIES[a].parent && BODIES[a].parent === BODIES[b].parent;
const chipRow = (id, keys, cur, all) => `<div class="wz-chips" id="${id}">${keys.map(k => `<button type="button" data-v="${k}" aria-pressed="${cur === k}">${esc(_('body.' + k))}</button>`).join('')}`
  + `<select data-for="${id.slice(3)}" aria-label="${esc(_('wz.other'))}"><option value="">${esc(_('wz.other'))}</option>${all.filter(k => !keys.includes(k)).map(k => `<option value="${k}"${cur === k ? ' selected' : ''}>${esc(_('body.' + k))}</option>`).join('')}</select></div>`;
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
    return [
      { t: 'wz.s.body', b: chipRow('wz-body', WZ_CHIPS, WZV.body, KEYS_MV) },
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
  if (WZ.path === 'free') {
    const [pn, an] = wzNames(WZV.body);
    return [
      { t: 'wz.s.body', b: chipRow('wz-body', WZ_CHIPS, WZV.body, KEYS_MV) },
      { t: 'wz.s.start', b: orbitFields(0) },
      { t: 'wz.s.burn', b: `<div class="seg full" id="wz-fbAt" role="group">${[['peri', pn], ['apo', an], ['t', _('wz.fb.t')]].map(([x, l]) => `<button type="button" data-v="${x}" aria-pressed="${WZV.fbAt === x}">${esc(l)}</button>`).join('')}</div>`
        + `<div class="grid2">${fld('wz-fbT', _('wz.fb.T'), WZV.fbT)}</div>`
        + `<div class="grid3">${fld('wz-fbP', _('wz.fb.P'), WZV.fbP)}${fld('wz-fbR', _('wz.fb.R'), WZV.fbR)}${fld('wz-fbN', _('wz.fb.N'), WZV.fbN)}</div>`
        + `<p class="wz-d" id="wz-fbD"></p>` },
    ];
  }
  if (WZ.path === 'go') {
    const pnT = wzNames(WZV.tgt)[0], pnD = wzNames(WZV.dep)[0];
    return [
      { t: 'wz.s.dep', b: chipRow('wz-dep', WZ_DEP, WZV.dep, WZ_GO_KEYS) + `<div class="grid2">${fld('wz-gh0', _('wz.park'), WZV.gh0)}</div>` },
      { t: 'wz.s.tgt', b: chipRow('wz-tgt', WZ_TGT, WZV.tgt, WZ_GO_KEYS) },
      { t: 'wz.s.arr', b: seg2('wz-mode', [['capture', 'wz.arr.capture'], ['flyby', 'wz.arr.flyby'], ['free', 'wz.arr.free']], WZV.mode) + `<p class="wz-d" id="wz-modeD"></p>`
        + `<div class="grid2">${fld('wz-ghB', _('wz.peri', { peri: pnT }), WZV.ghB)}${fld('wz-ghRet', _('wz.hRet', { peri: pnD }), WZV.ghRet)}</div>` },
      { t: 'wz.s.when', b: seg2('wz-when', [['cheap', 'wz.when.cheap'], ['date', 'wz.when.date']], WZV.when) + `<p class="wz-d" id="wz-whenD"></p>`
        + `<label class="field" id="wz-dateW"><span>${esc(_('wz.date'))}</span><input type="date" id="wz-date" value="${esc(WZV.date)}" min="${EPHEM_YEARS[0]}-01-01" max="${EPHEM_YEARS[1]}-12-31"></label>` },
    ];
  }
  return [];
}
function wzRender() {
  const st = wzSteps();
  wzEl('wzSteps').innerHTML = st.map((s, i) => `<section class="wz-step" data-i="${i}"><button type="button" class="wz-h" aria-expanded="false"><span class="wz-n">${i + 1}</span><span class="wz-t">${esc(_(s.t))}</span><span class="wz-sum"></span></button>`
    + `<div class="wz-b">${s.b}${i < st.length - 1 ? `<button type="button" class="btn sm wz-next">${esc(_('wz.next'))}</button>` : ''}</div></section>`).join('');
  const ex = WZ.path === 'orbit' ? [WZ_EX, 'wz.ex.'] : WZ.path === 'go' ? [WZ_GEX, 'wz.exg.'] : WZ.path === 'free' ? [WZ_FEX, 'wz.exf.'] : null;
  wzEl('wzEx').innerHTML = ex ? Object.keys(ex[0]).map(k => `<button type="button" data-ex="${k}">${esc(_(ex[1] + k))}</button>`).join('') : '';
  wzEl('wzEx').hidden = !ex;
  wzOpen(WZ.step); wzSync();
}
function wzOpen(i) {
  WZ.step = i;
  for (const s of wzEl('wzSteps').querySelectorAll('.wz-step')) { const on = +s.dataset.i === i; s.classList.toggle('on', on); s.querySelector('.wz-h').setAttribute('aria-expanded', String(on)); }
  INS = null;
}
// what depends on the values: shown fields, labels, summaries, the method's description
function wzSync() {
  if (WZ.path === 'go') { wzSyncGo(); return; }
  if (WZ.path !== 'orbit' && WZ.path !== 'free') return;
  const [pn, an] = wzNames(WZV.body);
  for (const n of WZ.path === 'free' ? [0] : [0, 1]) {
    const circ = WZV['c' + n] === 'circ';
    wzEl('wz-h' + n + 'W').hidden = !circ; wzEl('wz-p' + n + 'W').hidden = circ; wzEl('wz-a' + n + 'W').hidden = circ;
    wzEl('wz-p' + n + 'L').textContent = _('wz.peri', { peri: pn }); wzEl('wz-a' + n + 'L').textContent = _('wz.apo', { apo: an });
  }
  if (WZ.path === 'free') { wzSyncFree(); return; }
  const m = WZV.meth, inc = wzNum(WZV.i0) !== wzNum(WZV.i1);
  wzEl('wz-methD').textContent = _('wz.m.' + m + 'D');
  wzEl('wz-planeW').hidden = m === 'auto' || !inc; wzEl('wz-rbW').hidden = m !== 'bielliptic';
  const fin = WZV.thr === 'fin'; wzEl('wz-FW').hidden = !fin; wzEl('wz-mdW').hidden = !fin;
  // summaries
  const sums = wzEl('wzSteps').querySelectorAll('.wz-sum'), orb = n => WZV['c' + n] === 'circ'
    ? _('wz.sumCirc', { h: WZV['h' + n], i: WZV['i' + n] }) : _('wz.sumEll', { p: WZV['p' + n], a: WZV['a' + n], i: WZV['i' + n] });
  sums[0].textContent = _('body.' + WZV.body); sums[1].textContent = orb(0); sums[2].textContent = orb(1);
  sums[3].textContent = _('wz.m.' + m) + (fin ? ' · ' + _('wz.thr.fin') : '');
}
function wzSyncFree() {
  const v = WZV, [pn, an] = wzNames(v.body), sums = wzEl('wzSteps').querySelectorAll('.wz-sum');
  wzEl('wz-fbTW').hidden = v.fbAt !== 't';
  const p = wzNum(v.fbP), r = wzNum(v.fbR), n = wzNum(v.fbN), tot = Math.hypot(p, r, n);
  wzEl('wz-fbD').textContent = Number.isFinite(tot) ? _('wz.fb.tot', { dv: nf1.format(tot) }) : _('wz.fb.d');
  sums[0].textContent = _('body.' + v.body);
  sums[1].textContent = v.c0 === 'circ' ? _('wz.sumCirc', { h: v.h0, i: v.i0 }) : _('wz.sumEll', { p: v.p0, a: v.a0, i: v.i0 });
  sums[2].textContent = (v.fbAt === 'peri' ? pn : v.fbAt === 'apo' ? an : 'T+' + v.fbT + ' s') + ' · ' + (Number.isFinite(tot) ? nf1.format(tot) + ' m/s' : '—');
}
function wzSyncGo() {
  const v = WZV, sib = wzSib(v.dep, v.tgt);
  wzEl('wz-modeD').textContent = _('wz.arr.' + v.mode + 'D');
  wzEl('wz-ghRetW').hidden = v.mode !== 'free';
  // the cheapest window needs a porkchop: bodies about one parent (else: a date)
  wzEl('wz-when').hidden = !sib; const when = sib ? v.when : 'date';
  wzEl('wz-whenD').textContent = _(sib ? 'wz.when.' + when + 'D' : 'wz.when.dateOnly');
  wzEl('wz-dateW').querySelector('span').textContent = _(when === 'cheap' ? 'wz.dateFrom' : 'wz.date');
  const sums = wzEl('wzSteps').querySelectorAll('.wz-sum');
  sums[0].textContent = _('wz.sumGo', { body: _('body.' + v.dep), h: v.gh0 }); sums[1].textContent = _('body.' + v.tgt);
  sums[2].textContent = _('wz.arr.' + v.mode) + ' · ' + v.ghB + ' km'; sums[3].textContent = when === 'cheap' ? _('wz.when.cheap') : v.date;
}
// ----- checks: the first problem, in plain words, and the step it is in -----
function wzOrbitVals() {
  const v = WZV, k = v.body, d = BODIES[k], Re = d.j2[1] * 1e3, R = d.radius * 1e3;
  const ap = n => v['c' + n] === 'circ' ? [wzNum(v['h' + n]), wzNum(v['h' + n])] : [wzNum(v['p' + n]), wzNum(v['a' + n])];
  const [hp0, ha0] = ap(0), [hp1, ha1] = ap(1), rp1 = Re + hp1 * 1e3, ra1 = Re + ha1 * 1e3;
  return { k, d, Re, R, mu: d.gm * 1e9, hp0, ha0, hp1, ha1, i0: wzNum(v.i0), i1: wzNum(v.i1), e1: (ra1 - rp1) / (ra1 + rp1), soi: wzSoi(k) };
}
function wzCheck() {
  if (WZ.path === 'go') return wzCheckGo();
  if (WZ.path !== 'orbit' && WZ.path !== 'free') return { err: '' };
  const v = WZV, o = wzOrbitVals(), [pn, an] = wzNames(o.k), name = _('body.' + o.k);
  const fail = (step, id, err) => ({ err, step, id });
  for (const n of WZ.path === 'free' ? [0] : [0, 1]) {
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
  if (WZ.path === 'free') { // the burn: three numbers, not all zero; a time after the periapsis not negative
    const strip = s => s.replace(/ \(.*\)$/, '');
    for (const [f, key] of [['fbP', 'wz.fb.P'], ['fbR', 'wz.fb.R'], ['fbN', 'wz.fb.N']].concat(v.fbAt === 't' ? [['fbT', 'wz.fb.T']] : [])) {
      if (!Number.isFinite(wzNum(v[f]))) return fail(2, 'wz-' + f, _('wz.e.num', { f: strip(_(key)) }));
    }
    if (v.fbAt === 't' && !(wzNum(v.fbT) >= 0)) return fail(2, 'wz-fbT', _('wz.e.neg', { f: strip(_('wz.fb.T')) }));
    if (!(Math.hypot(wzNum(v.fbP), wzNum(v.fbR), wzNum(v.fbN)) > 0)) return fail(2, 'wz-fbP', _('wz.e.zeroDv'));
    return { err: '' };
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
function wzCheckGo() {
  const v = WZV, fail = (step, id, err) => ({ err, step, id }), strip = s => s.replace(/ \(.*\)$/, '');
  if (v.dep === v.tgt) return fail(1, '', _('wz.e.sameBody'));
  const ch = missionChain(v.dep, v.tgt, q => BODIES[q].parent || null);
  if (ch.error) return fail(1, '', _(ch.error, { ...ch.params, a: _('body.' + v.dep), b: _('body.' + v.tgt) }));
  const h0 = wzNum(v.gh0), hB = wzNum(v.ghB), hRet = wzNum(v.ghRet);
  if (!Number.isFinite(h0)) return fail(0, 'wz-gh0', _('wz.e.num', { f: strip(_('wz.park')) }));
  if (!(h0 > 0)) return fail(0, 'wz-gh0', _('wz.e.belowStart'));
  if (!Number.isFinite(hB)) return fail(2, 'wz-ghB', _('wz.e.num', { f: strip(_('wz.peri', { peri: wzNames(v.tgt)[0] })) }));
  if (!(hB > 0)) return fail(2, 'wz-ghB', _('wz.e.below'));
  if (v.mode === 'free') {
    if (!wzPair(v.dep, v.tgt)) return fail(2, '', _('wz.e.freePair'));
    if (!Number.isFinite(hRet)) return fail(2, 'wz-ghRet', _('wz.e.num', { f: strip(_('wz.hRet', { peri: wzNames(v.dep)[0] })) }));
    if (!(hRet >= 0)) return fail(2, 'wz-ghRet', _('wz.e.neg', { f: strip(_('wz.hRet', { peri: wzNames(v.dep)[0] })) }));
  }
  const d = Date.parse(v.date + 'T00:00:00Z'), y = new Date(d).getUTCFullYear();
  if (!Number.isFinite(d) || y < EPHEM_YEARS[0] || y > EPHEM_YEARS[1] - 1) return fail(3, 'wz-date', _('wz.e.date', { a: EPHEM_YEARS[0], b: EPHEM_YEARS[1] - 1 }));
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
  if (WZ.path === 'free') { Object.assign(WZV, WZ_FEX[b.dataset.ex]); wzRender(); wzOpen(-1); wzCheckShow(); wzEl('wzGo').focus(); return; }
  if (WZ.path === 'go') { Object.assign(WZV, WZ_GEX[b.dataset.ex], { date: wzToday() }); wzRender(); wzOpen(-1); wzCheckShow(); wzEl('wzGo').focus(); return; }
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
  if (g === 'body' || g === 'dep' || g === 'tgt') wzRender();
  wzSync(); wzCheckShow();
});
wzEl('wzSteps').addEventListener('input', e => {
  const t = e.target, f = t.id.replace('wz-', '');
  if (t.dataset.for) { if (t.value) { WZV[t.dataset.for] = t.value; wzRender(); wzCheckShow(); } return; }
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
  else if (WZ.path === 'go') wzRunGo();
  else if (WZ.path === 'free') wzRunFree();
}
// "Serbest yanma": the maneuver state with type 'free' (app.js rebuildMan flies core.js freeBurn); the target is the start
function wzRunFree() {
  const v = WZV, o = wzOrbitVals();
  if (S.kind !== 'man') saveKind();
  if (MAP.on) setMap(false);
  Object.assign(S, { kind: 'man', model: 'real', frame: 'eq', scenario: '', follow: 'free' });
  S.M = { ...MV_DEF, body: o.k, t0: utcToDays(Math.floor(Date.now() / 60000) * 60000), hp0: o.hp0, ha0: o.ha0, i0: o.i0, O0: 0, hp1: o.hp0, e1: 0, i1: o.i0,
    type: 'free', rb: 100000, plane: 'comb', k: 1, j2: false, thrust: 'imp', steer: 'local', m0: 1000, md: 300, isp: 320, F: 400, veh: '',
    fbAt: v.fbAt === 'apo' ? 1 : v.fbAt === 't' ? 't' : 0, fbT: wzNum(v.fbT) || 0, fbP: wzNum(v.fbP), fbR: wzNum(v.fbR), fbN: wzNum(v.fbN) };
  S.bodies = [bodyFromPreset(o.k)];
  $('#scenario').value = ''; $('#scNote').textContent = _('sc.mv.note');
  openRows.clear(); MAP.needFit = true;
  syncKind(); syncModel(); renderBodies(); syncMission(); syncMan(); renderFrameSeg();
  APP.mode = 'design';
  rebuild({ fit: true, resetU: true });
  S.playing = !reduceMotion; setPlayIcon();
  WZ.res = true; wzShow(); wzResult();
}
function wzResultFree() {
  const box = wzEl('wzRes'), o = wzOrbitVals(), name = _('body.' + o.k), [pn, an] = apsNames(o.k);
  const orb = (rp, ra) => Math.abs(ra - rp) < 0.5 ? kmTxt(rp) + ' km' : kmTxt(rp) + ' × ' + kmTxt(ra) + ' km';
  let html = `<div class="wr-h"><b>${esc(_('wz.r.freeTitle', { body: name }))}</b><button type="button" class="btn sm" data-wr="edit">${esc(_('wz.r.edit'))}</button></div>`;
  const r = simR, b = r && MAN && MAN.free && r.burns && r.burns[0];
  if (!b) { box.innerHTML = html + `<p class="wr-note">${esc(_('wz.r.fail', { e: $('#err').textContent || _('chip.impact', { name }) }))}</p>`; return; }
  const dn = r.done, bound = dn.e < 1 && dn.a > 0, Re = MAN.Re;
  html += `<div class="wr-big"><div><span>Δv</span><b>${esc(fmtSpeed(b.dv))}</b></div><div><span>${esc(_(bound ? 'wz.r.newOrbit' : 'wz.r.escape'))}</span><b>${esc(bound ? orb((dn.rp - Re) / 1e3, (dn.ra - Re) / 1e3) : nf3.format(Math.sqrt(-MAN.mu / dn.a) / 1e3) + ' km/s')}</b></div></div>`;
  const rows = [[_('wz.r.before'), orb(o.hp0, o.ha0) + ' · ' + nf2.format(o.i0) + '°'],
    [_('wz.r.speed'), nf3.format(r.vBefore / 1e3) + ' → ' + nf3.format(r.vAfter / 1e3) + ' km/s']];
  if (bound) {
    rows.push([_('wz.r.after'), orb((dn.rp - Re) / 1e3, (dn.ra - Re) / 1e3) + ' · ' + nf2.format(dn.i / D2R) + '°']);
    rows.push([_('wz.r.apsides', { peri: cap1(pn), apo: an }), kmTxt((dn.rp - Re) / 1e3) + ' / ' + kmTxt((dn.ra - Re) / 1e3) + ' km']);
    rows.push([_('res.mvPeriod'), fmtPeriod(2 * Math.PI * Math.sqrt(dn.a ** 3 / MAN.mu))]);
  }
  if (r.impact >= 0) rows.push([_('wz.r.impact'), _('chip.impact', { name })]);
  html += `<table class="wr-burns"><tbody>${rows.map(([l, x]) => `<tr><th scope="row">${esc(l)}</th><td>${esc(x)}</td></tr>`).join('')}</tbody></table>`;
  box.innerHTML = html + `<div class="wr-act"><button type="button" class="btn sm" data-wr="replay">${esc(_('wz.r.replay'))}</button><button type="button" class="btn sm" data-wr="more">${esc(_('wz.r.more'))}</button></div>`;
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

// "Başka bir cisme git": the transfer state as the overview's pick builds it (the chain of bodies, the real model), then
// either the cheapest window (bodies about one parent: a porkchop over the window after the date, its least-Δv cell
// seeds the Lambert departure) or the Hohmann guess from the date, then the solver (app.js solve: judged by the
// trajectory, the status says when it misses).
async function wzRunGo() {
  const v = WZV, a = v.dep, b = v.tgt, ch = missionChain(a, b, q => BODIES[q].parent || null);
  if (ch.error) return;
  const pair = ch.parent[1] === 0 || ch.parent[0] === 1, cheap = v.when === 'cheap' && wzSib(a, b);
  const sc = SCENARIOS.find(s => s.id === 'em_free').M;
  const base = S.kind === 'transfer' ? S.M : KSAVE.transfer ? KSAVE.transfer.M : sc;
  if (S.kind !== 'transfer') saveKind();
  if (MAP.on) setMap(false);
  Object.assign(S, { kind: 'transfer', model: 'real', scenario: '', follow: 'free', frame: pair ? 'rot' : 'inertial' });
  S.M = { ...sc, ...base, mode: v.mode, h0: wzNum(v.gh0), hB: wzNum(v.ghB), hRet: v.mode === 'free' ? wzNum(v.ghRet) : base.hRet || 60, side: 0, aero: false,
    dep: 'burn', tof: 0, beta: 0, autoDur: true, t0: utcToDays(Date.parse(v.date + 'T00:00:00Z')) };
  S.bodies = ch.keys.map(q => bodyFromPreset(q)); linkReal();
  $('#scenario').value = ''; $('#scNote').textContent = _('sc.pick.note');
  openRows.clear(); ovReveal(); MAP.needFit = true;
  syncKind(); syncModel(); renderBodies(); syncMission(); renderFrameSeg();
  APP.mode = 'design';
  rebuild({ fit: true, resetU: true });
  const run = WZ.go = { busy: true, phase: cheap ? 'pc' : 'solve', p: 0, err: '' };
  WZ.res = true; wzShow(); wzResult();
  if (!sys) { run.busy = false; run.err = $('#err').textContent; wzResult(); return; }
  try {
    if (cheap) {
      const pc = await wzPorkchop(run);
      if (WZ.go !== run) return; // superseded
      const best = wzPcMin(pc), seed = best && lambertSeed(sys, best.t1 * DAY, best.tof * DAY, S.M);
      if (seed) { Object.assign(S.M, { dep: 'asym', theta: seed.theta, beta: seed.beta, dv: seed.dv, t0: seed.t0, tof: seed.tof, autoDur: true }); syncMission(); rebuild({ resetU: true, fit: true }); }
      else applyHohmann();
    } else applyHohmann();
    run.phase = 'solve'; wzResult();
    if (solving) { $('#solve').click(); while (solving) await new Promise(r => setTimeout(r, 30)); }
    if (WZ.go !== run) return;
    await solve();
  } catch (e) { run.err = String(e); }
  if (WZ.go !== run) return;
  run.busy = false; wzResult();
}
// the porkchop over the window after the date (app.js pcDefaults: ±0.2 synodic period about the next Hohmann
// opportunity, 0.4–1.6 × its time of flight; never before the date: a window already open is searched from the date
// on), the light grid; in a worker when there is one
function wzPorkchop(run) {
  const r = pcDefaults(), [nd, nt] = PC_GRID.low, w = Number.isFinite(r.syn) ? 0.4 * r.syn : r.d1 - r.d0, t1a = Math.max(r.d0, S.M.t0);
  const g = { t1a, t1b: Math.min(Math.max(r.d1, t1a + 0.5 * w), EPH_T[1] - 1), fa: r.f0, fb: r.f1, nd, nt, tMin: EPH_T[0], tMax: EPH_T[1] };
  return new Promise((res, rej) => {
    let w = null;
    try { w = makeWorker(); } catch (e) { w = null; }
    if (!w) { try { res({ ...porkchop(buildSystem(sysList()), pcM(), g), g }); } catch (e) { rej(e); } return; }
    w.onmessage = e => {
      const d = e.data;
      if (WZ.go !== run) { w.terminate(); return; }
      if (d.p != null) { run.p = Math.round(100 * d.p / nt); wzResult(); } else { w.terminate(); d.done ? res({ ...d.done, g }) : rej(d.error); }
    };
    w.onerror = e => { w.terminate(); rej(e.message || 'worker'); };
    w.postMessage({ list: sysList(), M: pcM(), pc: g });
  });
}
function wzPcMin(pc) {
  const g = pc.g; let at = -1, m = Infinity;
  for (let i = 0; i < pc.dv.length; i++) if (pc.dv[i] > 0 && pc.dv[i] < m) { m = pc.dv[i]; at = i; }
  if (at < 0) return null;
  const i = at % g.nd, j = Math.floor(at / g.nd);
  return { t1: g.t1a + (g.t1b - g.t1a) * i / (g.nd - 1), tof: g.fa + (g.fb - g.fa) * j / (g.nt - 1) };
}
function wzResultGo() {
  const box = wzEl('wzRes'), v = WZV, run = WZ.go || { busy: false }, A = _('body.' + v.dep), B = _('body.' + v.tgt);
  let html = `<div class="wr-h"><b>${esc(_('wz.r.goTitle', { a: A, b: B }))}</b><button type="button" class="btn sm" data-wr="edit">${esc(_('wz.r.edit'))}</button></div>`;
  if (run.busy) html += `<p class="wr-note">${esc(run.phase === 'pc' ? _('wz.r.pc', { p: nf0.format(run.p || 0) }) : _('wz.r.solving'))}</p>`;
  if (run.err) html += `<p class="wr-note">${esc(_('wz.r.fail', { e: run.err }))}</p>`;
  const st = $('#status');
  if (!run.busy && st.textContent) html += `<p class="${st.classList.contains('warn') ? 'wr-note' : 'wr-cmp'}">${esc(st.textContent)}</p>`;
  if (simR && sys && S.kind === 'transfer' && S.bodies.length >= 2) {
    const r = simR, M = S.M, dv2 = r.captured ? r.captured.dv : 0, [pnB] = apsNames(S.bodies[1].key), [pnA] = apsNames(S.bodies[0].key);
    const tot = M.dv + (M.mode === 'capture' ? dv2 : 0), tArr = r.bPeri ? r.bPeri.t : 0;
    html += `<div class="wr-big"><div><span>${esc(_(M.mode === 'capture' ? 'wz.r.total' : 'wz.r.depDv'))}</span><b>${esc(fmtSpeed(tot))}</b></div><div><span>${esc(_('wz.r.flight'))}</span><b>${esc(tArr ? fmtDur(tArr) : '—')}</b></div></div>`;
    const rows = [[_('wz.r.dep'), fmtDate(dateAt(0))]];
    if (r.bPeri) rows.push([_('wz.r.arr'), fmtDate(dateAt(r.bPeri.t))]);
    rows.push([_('wz.r.depDv'), nf1.format(M.dv) + ' m/s']);
    if (M.mode === 'capture') rows.push([_('wz.r.capDv'), r.captured ? nf1.format(dv2) + ' m/s' : '—']);
    if (r.bPeri) rows.push([_('wz.r.peri', { peri: pnB }), nf0.format((r.bPeri.d - sys.R[1]) / 1e3) + ' km']);
    if (M.mode === 'free') rows.push([_('wz.r.ret', { peri: pnA }), r.aRet ? nf0.format((r.aRet.d - sys.R[0]) / 1e3) + ' km' : '—']);
    html += `<table class="wr-burns"><tbody>${rows.map(([l, x]) => `<tr><th scope="row">${esc(l)}</th><td>${esc(x)}</td></tr>`).join('')}</tbody></table>`;
  }
  const pcB = wzSib(v.dep, v.tgt) ? `<button type="button" class="btn sm" data-wr="pc">${esc(_('wz.r.pcOpen'))}</button>` : '';
  box.innerHTML = html + `<div class="wr-act"><button type="button" class="btn sm" data-wr="replay">${esc(_('wz.r.replay'))}</button><button type="button" class="btn sm" data-wr="more">${esc(_('wz.r.more'))}</button>${pcB}</div>`;
}

// ----- the result card -----
const wzSpan = s => (s < 1 ? '—' : fmtDur(s));
function wzResult() {
  if (!WZ.res) return;
  if (WZ.path === 'go') { wzResultGo(); return; }
  if (WZ.path === 'free') { wzResultFree(); return; }
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
  WZ.raf = requestAnimationFrame(() => { WZ.raf = 0; if (((WZ.path === 'orbit' || WZ.path === 'free') && S.kind === 'man') || (WZ.path === 'go' && S.kind === 'transfer')) wzResult(); });
}
wzEl('wzRes').addEventListener('click', e => {
  const tr = e.target.closest('tr.go');
  if (tr && C) { S.u = tToU(+tr.dataset.t); S.ext = 0; slowJump(); return; }
  const b = e.target.closest('[data-wr]'); if (!b) return;
  const w = b.dataset.wr;
  if (w === 'edit') { WZ.res = false; wzShow(); wzCheckShow(); wzEl('wzGo').focus(); }
  else if (w === 'replay' && C) { S.u = 0; S.ext = 0; slowJump(); S.playing = true; setPlayIcon(); }
  else if (w === 'more') setWin('results', { open: true, collapsed: false });
  else if (w === 'pc') setWin('transfer', { open: true, collapsed: false });
});
wzShow();
