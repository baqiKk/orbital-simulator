// The engine (Phase 18a): the "Motor tasarla" window, the mission's engine, saved engines, the engine's charts and the
// lines the result cards show. Classic script after app.js (its globals) and before wizard.js. The engine model is
// core.js engineSpec / engineCurve; the ready-made engines and propellant data js/engines.js.
//
// An engine as the window and the mission hold it (E): { id ('' typed in, 'p:<id>' ready-made, 's:<n>' saved), type,
// prop (PROPS key), F (N), isp (s), of, pm ('tot' | 'split'), mp, mf, mox, md (kg), r0 (cm, hybrid port), grain }.
// The mission's engine is S.M.eng (maneuvers and transfers); a maneuver also keeps its F, isp, m0 = md + mp and md in
// step (app.js engSyncM), so everything that read those before still does.
const ENG_PROP_OF = { liq: ['lox_lh2', 'lox_rp1', 'nto_mmh', 'nto_a50'], hyb: ['n2o_htpb', 'lox_paraffin'], sol: ['apcp'], mono: ['n2h4', 'h2o2'] };
const ENG_DEF = { id: '', type: 'liq', prop: 'nto_mmh', F: 400, isp: 320, of: 1.65, pm: 'tot', mp: 700, mf: 264, mox: 436, md: 300, r0: 3, grain: 'bates' };
const ENG_NUM = ['F', 'isp', 'of', 'mp', 'mf', 'mox', 'md', 'r0'];
let SAVED_ENG = parseEngines(readPref(LS, PREF_KEYS.engines));
// an engine from a ready-made one (its masses from the vehicle it flew on, else its own)
function engPreset(id) {
  const p = ENGINES.find(q => q.id === id); if (!p) return null;
  const v = p.veh ? VEHICLES.find(q => q.id === p.veh) : null;
  const mp = v ? v.m0 - v.md : p.mp, md = v ? v.md : p.md;
  return { ...ENG_DEF, id: 'p:' + id, type: p.type, prop: p.prop, F: p.F, isp: p.isp, of: p.of || 0, pm: 'tot', mp, md, mf: 0, mox: 0,
    r0: p.hyb ? p.hyb.r0 * 100 : ENG_DEF.r0, grain: p.sol ? p.sol.grain : 'bates' };
}
const engOfVehicle = vid => { const p = ENGINES.find(q => q.veh === vid); return p ? engPreset(p.id) : null; };
// the core's input
function engIn(E) {
  const bi = E.type === 'liq' || E.type === 'hyb', split = bi && E.pm === 'split', h = (PROPS[E.prop] || {}).hyb || {};
  return { type: E.type, F: +E.F, isp: +E.isp, of: bi ? +E.of : 0, md: +E.md, ...(split ? { mf: +E.mf, mox: +E.mox } : { mp: +E.mp }),
    hyb: E.type === 'hyb' ? { a: h.a, n: h.n, rho: h.rho || 0, ispOF: h.ispOF || null, r0: +E.r0 / 100 } : undefined, sol: E.type === 'sol' ? { grain: E.grain } : undefined };
}
const engSpecOf = E => (E ? engineSpec(engIn(E)) : null);
const engName = E => (!E ? '' : E.id.startsWith('p:') ? _('eng.' + E.id.slice(2)) : E.id.startsWith('s:') && SAVED_ENG[+E.id.slice(2)] ? SAVED_ENG[+E.id.slice(2)].name : _('eng.custom'));
const fmtF = F => (F >= 1e4 ? nf1.format(F / 1e3) + ' kN' : NF(F < 10 ? 2 : 1).format(F) + ' N');
const fmtKg = m => (m >= 1e4 ? nf0.format(m) : nf1.format(m)) + ' kg';
const fmtMd = q => NF(q < 0.1 ? 4 : q < 10 ? 3 : 2).format(q) + ' kg/s';
// the one-line summary (the wizard's engine step)
function engSummary(E, s) {
  if (!s || s.error) return s && s.error ? _(s.error) : '';
  return _('eng.sum', { name: engName(E), F: fmtF(s.F), isp: nf1.format(s.isp), dv: fmtSpeed(s.dv), t: fmtBurn(s.tb) });
}

// ----- the mission's engine and its burns -----
// the burns flown (or planned) with the mission's engine: each one's length, Δv, fuel and oxidizer (finite flights:
// from the engine's clock τ at the start and the end; impulsive: Tsiolkovsky one after the other, core.js engBurns);
// short: the propellant missing for the impulsive plan (kg)
function engMission() {
  const E = S.M && S.M.eng, s = engSpecOf(E);
  if (!s || s.error || !simR) return s && s.error ? { error: s.error } : null;
  const fin = S.kind === 'man' && MAN && MAN.res && simR.burns && simR.burns.some(b => b.tau1 != null);
  let burns = [], dvs = [];
  if (S.kind === 'man') {
    const bs = simR.burns || [];
    if (fin) burns = bs.map(b => { const u0 = engUsed(s, b.tau0), u1 = engUsed(s, b.tau1); return { t: b.t0, t1: b.t1, len: b.t1 - b.t0, dv: b.dv, fuel: u1.fuel - u0.fuel, ox: u1.ox - u0.ox, tau0: b.tau0, tau1: b.tau1, out: b.fuelOut }; });
    dvs = MAN && MAN.plan && MAN.plan.burns ? MAN.plan.burns.map(b => b.dv) : bs.map(b => b.dv);
    if (MAN && MAN.free && bs[0]) dvs = [bs[0].dv];
    if (!fin) { const at = bs.map(b => (b.t0 != null ? b.t0 : b.t)); burns = engBurns(s, bs.map(b => b.dv)).burns.map((q, j) => ({ ...q, t: at[j], t1: at[j], len: q.t })); }
  } else {
    const M = S.M, cap = M.mode === 'capture' && simR.captured ? simR.captured.dv : 0, ts = [0];
    dvs = [M.dv]; if (cap) { dvs.push(cap); ts.push(simR.captured.t || 0); }
    burns = engBurns(s, dvs).burns.map((q, j) => ({ ...q, t: ts[j], t1: ts[j], len: q.t }));
  }
  const imp = engBurns(s, dvs);
  return { s, E, fin, burns, short: imp.short, need: imp.need, dv: imp.dv };
}
// the result card's lines for the engine (wizard.js; the results window shows the warning row too)
function engCardHtml() {
  const m = engMission();
  if (!m) return '';
  if (m.error) return `<p class="wr-note">${esc(_(m.error))}</p>`;
  const bi = m.s.type === 'liq' || m.s.type === 'hyb';
  let html = `<p class="wr-cmp">${esc(_('eng.cardH', { name: engName(m.E) }))}</p><table class="wr-burns"><tbody>`;
  html += m.burns.map((b, j) => `<tr class="go" data-t="${b.t}"><th scope="row">${esc(_('eng.burnN', { n: j + 1 }))}<small>${esc(_('sch.dur', { d: fmtBurn(b.len) }))}</small></th><td>${esc(bi ? _('eng.fuelOx', { f: fmtKg(b.fuel), o: fmtKg(b.ox) }) : fmtKg(b.fuel + b.ox))}</td></tr>`).join('');
  html += '</tbody></table>';
  if (m.short > 0) html += `<p class="wr-note">${esc(_('eng.short', { kg: nf0.format(m.short) }))}</p>`;
  if (m.s.type === 'sol' && Math.abs(m.dv - m.s.dv) > 1) html += `<p class="wr-note">${esc(_('eng.solFix', { dv: fmtSpeed(m.s.dv), kg: nf0.format(engNeed(m.dv, m.s.md, m.s.isp)) }))}</p>`;
  return html;
}
// the results window: the engine and, when the propellant does not last, how much is missing ([label, html, unit])
function engResRows() {
  const m = engMission();
  if (!m || m.error) return [];
  const rows = [[_('eng.resH'), esc(engName(m.E)), fmtF(m.s.F) + ' · ' + nf1.format(m.s.isp) + ' s']];
  if (m.short > 0) rows.push([_('eng.resShort'), '<span class="warn">' + esc(nf0.format(m.short)) + '</span>', 'kg']);
  return rows;
}

// ----- the window -----
const ENGW = { E: { ...ENG_DEF }, linked: false, s: null, tau: -1, st: null };
const engEl = id => document.getElementById(id);
function engOpenFrom(E) { ENGW.E = { ...(E || ENGW.E) }; ENGW.linked = !!E && S.M && S.M.eng === E; engRender(); }
function engRenderPre() {
  const sel = engEl('engPre'), cur = ENGW.E.id;
  sel.innerHTML = `<option value="">${esc(_('eng.custom'))}</option><optgroup label="${esc(_('eng.presets'))}">${ENGINES.map(p => `<option value="p:${p.id}">${esc(_('eng.' + p.id))}</option>`).join('')}</optgroup>`
    + (SAVED_ENG.length ? `<optgroup label="${esc(_('eng.saved'))}">${SAVED_ENG.map((q, j) => `<option value="s:${j}">${esc(q.name)}</option>`).join('')}</optgroup>` : '');
  sel.value = cur; if (sel.value !== cur) sel.value = '';
  engEl('engDel').hidden = !cur.startsWith('s:');
}
function engRender() {
  const E = ENGW.E, bi = E.type === 'liq' || E.type === 'hyb';
  setSeg('#engType', E.type); setSeg('#engPm', E.pm); setSeg('#engGrain', E.grain);
  engRenderPre();
  const ps = engEl('engProp'), list = ENG_PROP_OF[E.type];
  if (!list.includes(E.prop)) E.prop = list[0];
  ps.innerHTML = list.map(k => `<option value="${k}">${esc(_('eng.p.' + k))}</option>`).join(''); ps.value = E.prop;
  for (const f of ENG_NUM) { const el = engEl('eng-' + f); if (document.activeElement !== el) { el.value = +(+E[f] || 0).toFixed(f === 'of' ? 4 : 2); el.setAttribute('aria-invalid', 'false'); } }
  engEl('engPmW').hidden = !bi;
  engEl('eng-ofW').hidden = !bi || E.pm === 'split';
  engEl('eng-mpW').hidden = bi && E.pm === 'split';
  engEl('eng-mfW').hidden = engEl('eng-moxW').hidden = !(bi && E.pm === 'split');
  engEl('engHybW').hidden = E.type !== 'hyb'; engEl('engSolW').hidden = E.type !== 'sol';
  engCompute();
}
// the figures, the charts, the mission's burns
function engCompute() {
  const E = ENGW.E, s = ENGW.s = engSpecOf(E), out = engEl('engOut'), err = engEl('engErr');
  ENGW.linked = !!(S.M && S.M.eng) && JSON.stringify(S.M.eng) === JSON.stringify(E);
  err.textContent = s.error ? _(s.error) : ''; err.hidden = !s.error;
  engEl('engApply').disabled = !!s.error;
  engEl('engNote').textContent = ENGW.linked ? _('eng.linked') : S.M && S.M.eng ? _('eng.unlinked') : '';
  if (s.error) { out.innerHTML = ''; engChart(null); engEl('engBurns').innerHTML = ''; return; }
  const bi = s.type === 'liq' || s.type === 'hyb', g = v => NF(2).format(v / G0);
  const rows = [
    [_('eng.o.mdot'), fmtMd(s.mdot)], [_('eng.o.tb'), fmtBurn(s.tb)],
    ...(bi ? [[_('eng.o.fuel'), fmtKg(s.mf) + ' · ' + fmtMd(s.mdotF)], [_('eng.o.ox'), fmtKg(s.mox) + ' · ' + fmtMd(s.mdotOx)], [_('eng.o.of'), nf2.format(s.of) + (s.type === 'hyb' ? ' · ' + _('eng.o.of0', { a: nf2.format(s.of0), b: nf2.format(s.of1) }) : '')]] : []),
    [_('eng.o.dv'), fmtSpeed(s.dv)], [_('eng.o.m0'), fmtKg(s.m0)],
    [_('eng.o.acc'), _('eng.o.accV', { a: NF(3).format(s.a0), b: NF(3).format(s.a1), ga: g(s.a0), gb: g(s.a1) })],
  ];
  if (s.type === 'hyb') rows.push([_('eng.o.port'), _('eng.o.portV', { a: nf1.format(s.r0 * 100), b: nf1.format(s.r1 * 100) }) + (s.L ? ' · ' + _('eng.o.len', { L: nf2.format(s.L) }) : '')]);
  if (s.type === 'sol' || s.type === 'hyb') rows.push([_('eng.o.F01'), fmtF(s.F0) + ' → ' + fmtF(s.F1)]);
  const m = ENGW.linked ? engMission() : null;
  if (m && !m.error) rows.push([_('eng.o.left'), fmtKg(Math.max(0, s.mp - m.burns.reduce((a, b) => a + b.fuel + b.ox, 0)))]);
  out.innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  const h = (PROPS[E.prop] || {}).hyb;
  if (E.type === 'hyb' && h) engEl('engHybD').textContent = _('eng.hybD', { a: String(h.a), n: String(h.n) }) + ' ' + _(h.ispOF ? 'eng.hybIspT' : 'eng.hybIspC');
  // the mission's burns on the engine's clock
  const tb = engEl('engBurns');
  if (m && !m.error && m.burns.length) {
    tb.innerHTML = `<caption>${esc(_('eng.burnsH'))}</caption><tbody>` + m.burns.map((b, j) => `<tr><th scope="row">${esc(_('eng.burnN', { n: j + 1 }))}</th><td>${esc(fmtBurn(b.len))}</td><td>${esc(fmtSpeed(b.dv))}</td><td>${esc(bi ? _('eng.fuelOx', { f: fmtKg(b.fuel), o: fmtKg(b.ox) }) : fmtKg(b.fuel + b.ox))}</td></tr>`).join('') + '</tbody>'
      + (m.short > 0 ? `<tfoot><tr><td colspan="4" class="warn">${esc(_('eng.short', { kg: nf0.format(m.short) }))}</td></tr></tfoot>` : '');
  } else tb.innerHTML = '';
  engChart(s, m && !m.error ? m : null);
}

// ----- the charts: thrust, mass flow, fuel and oxidizer left, O/F against the engine's clock -----
// drawn once per change on the lower canvas; the upper one holds only the playhead (engTick: O(1) per frame)
function engChart(s, m) {
  const cv = engEl('engCv'), pv = engEl('engCvP'), box = cv.parentElement;
  const w = Math.max(160, box.clientWidth), dpr = Math.min(2, window.devicePixelRatio || 1);
  const bi = s && (s.type === 'liq' || s.type === 'hyb'), rows = s ? (bi ? ['F', 'md', 'left', 'of'] : ['F', 'md', 'left']) : [];
  const RH = 54, top = 4, bot = 18, h = rows.length ? top + rows.length * RH + bot : 0;
  for (const c of [cv, pv]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = h + 'px'; }
  ENGW.st = null; ENGW.tau = -1;
  engEl('engChartNote').textContent = '';
  if (!s) return;
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = 46, R = 8, W = w - L - R, N = 121, tb = s.tb, X = t => L + W * t / tb;
  const css = getComputedStyle(document.documentElement), tok = k => css.getPropertyValue(k).trim();
  const col = { F: tok('--accent'), md: tok('--burn'), fuel: tok('--orbit'), ox: tok('--cyan'), of: tok('--warn'), line: tok('--line'), faint: tok('--faint'), dim: tok('--dim'), span: tok('--accent-soft') };
  const at = t => engAt(s, Math.min(t, tb * (1 - 1e-9)));
  const series = {
    F: [[t => at(t).F, col.F]], md: [[t => at(t).md, col.md]],
    left: bi ? [[t => s.mf - engUsed(s, t).fuel, col.fuel], [t => s.mox - engUsed(s, t).ox, col.ox]] : [[t => s.mp - engUsed(s, t).fuel, col.fuel]],
    of: [[t => at(t).of, col.of]],
  };
  const unit = { F: s.F0 >= 1e4 || s.F >= 1e4 ? 'kN' : 'N', md: 'kg/s', left: 'kg', of: 'O/F' }, k = { F: s.F >= 1e4 ? 1e-3 : 1, md: 1, left: 1, of: 1 };
  x.font = '10px ' + tok('--f-mono'); x.textBaseline = 'middle';
  rows.forEach((r, i) => {
    const y0 = top + i * RH + 4, y1 = top + (i + 1) * RH - 6;
    let lo = Infinity, hi = -Infinity;
    const pts = series[r].map(([f]) => { const a = new Float64Array(N); for (let j = 0; j < N; j++) { a[j] = f(tb * j / (N - 1)) * k[r]; lo = Math.min(lo, a[j]); hi = Math.max(hi, a[j]); } return a; });
    if (r === 'left') lo = Math.min(0, lo); // what is left goes to zero; thrust, flow and O/F show their own range
    if (hi - lo < 0.02 * Math.max(1e-9, Math.abs(hi))) { const p = Math.max(Math.abs(hi) * 0.05, 1e-6); hi += p; lo = Math.max(0, lo - p); }
    else if (r !== 'left') { const p = 0.08 * (hi - lo); hi += p; lo = Math.max(0, lo - p); }
    const Y = v => y1 - (y1 - y0) * (v - lo) / (hi - lo);
    x.strokeStyle = col.line; x.lineWidth = 1; x.beginPath(); x.moveTo(L, y1 + 0.5); x.lineTo(L + W, y1 + 0.5); x.stroke();
    x.fillStyle = col.dim; x.textAlign = 'right';
    const nf = v => { v = Math.abs(v) < 1e-9 ? 0 : v; return NF(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2).format(v); };
    x.fillText(nf(hi), L - 4, y0 + 2); x.fillText(unit[r], L - 4, (y0 + y1) / 2 + 2); x.fillText(nf(lo), L - 4, y1 - 3);
    pts.forEach((a, si) => {
      x.strokeStyle = series[r][si][1]; x.lineWidth = 1.5; x.beginPath();
      for (let j = 0; j < N; j++) { const px = L + W * j / (N - 1), py = Y(a[j]); if (j) x.lineTo(px, py); else x.moveTo(px, py); }
      x.stroke();
    });
  });
  // the mission's burns: their spans on the engine's clock, Y1 Y2 …
  if (m) m.burns.forEach((b, j) => {
    const a = X(Math.min(b.tau0, tb)), c = X(Math.min(b.tau1, tb));
    x.fillStyle = col.span; x.fillRect(a, top, Math.max(1, c - a), rows.length * RH);
    x.fillStyle = col.faint; x.textAlign = 'left'; x.fillText(_('eng.yN', { n: j + 1 }), a + 2, top + 6);
  });
  x.fillStyle = col.dim; x.textAlign = 'left'; x.fillText('0', L, h - 8);
  x.textAlign = 'right'; x.fillText(_('eng.axis', { t: fmtBurn(tb) }), L + W, h - 8);
  ENGW.st = { L, W, tb, top, H: rows.length * RH, dpr, m, col: tok('--ink') };
  engTick(true);
}
// the playhead: the mission's moment on the engine's clock (still between burns: "motor kapalı")
function engTau(m, t) {
  let tau = 0, on = false;
  for (const b of m.burns) {
    if (t < b.t) break;
    if (t <= b.t1 && b.t1 > b.t) { tau = b.tau0 + (b.tau1 - b.tau0) * (t - b.t) / (b.t1 - b.t); on = true; break; }
    tau = b.tau1;
  }
  return { tau, on };
}
function engTick(force) {
  const st = ENGW.st;
  if (!st || !st.m || !C || engEl('w-engine').hidden) return;
  const t = uToT(S.u), q = engTau(st.m, t);
  if (!force && Math.abs(q.tau - ENGW.tau) < st.tb / 2000 && q.on === ENGW.on) return;
  ENGW.tau = q.tau; ENGW.on = q.on;
  const pv = engEl('engCvP'), x = pv.getContext('2d');
  x.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); x.clearRect(0, 0, pv.width, pv.height);
  const px = st.L + st.W * Math.min(1, q.tau / st.tb);
  x.strokeStyle = st.col; x.globalAlpha = q.on ? 0.9 : 0.4; x.lineWidth = 1; x.beginPath(); x.moveTo(px + 0.5, st.top); x.lineTo(px + 0.5, st.top + st.H); x.stroke(); x.globalAlpha = 1;
  engEl('engChartNote').textContent = q.on ? _('eng.on', { t: fmtBurn(q.tau) }) : _('eng.off');
}

// ----- events -----
function engEdit() { ENGW.E.id = ''; engRenderPre(); engCompute(); }
engEl('engType').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; ENGW.E.type = b.dataset.v; ENGW.E.id = ''; engRender(); });
engEl('engPm').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const E = ENGW.E;
  if (b.dataset.v === E.pm) return;
  // switching keeps the same load: total + O/F ⇄ fuel + oxidizer
  if (b.dataset.v === 'split') { E.mf = +(E.mp / (1 + E.of)).toFixed(3); E.mox = +(E.mp - E.mf).toFixed(3); } else { E.mp = +(E.mf + E.mox).toFixed(3); if (E.mf > 0) E.of = +(E.mox / E.mf).toFixed(4); }
  E.pm = b.dataset.v; engEdit(); engRender();
});
engEl('engGrain').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; ENGW.E.grain = b.dataset.v; engEdit(); setSeg('#engGrain', ENGW.E.grain); });
engEl('engProp').addEventListener('change', e => { ENGW.E.prop = e.target.value; engEdit(); });
engEl('engPre').addEventListener('change', e => {
  const v = e.target.value;
  if (v.startsWith('p:')) ENGW.E = engPreset(v.slice(2));
  else if (v.startsWith('s:')) ENGW.E = { ...ENG_DEF, ...SAVED_ENG[+v.slice(2)], id: v };
  else ENGW.E.id = '';
  engRender();
});
for (const f of ENG_NUM) engEl('eng-' + f).addEventListener('input', e => {
  const v = parseNum(e.target.value), bad = !Number.isFinite(v) || v < 0;
  e.target.setAttribute('aria-invalid', String(bad));
  if (bad) return;
  ENGW.E[f] = v; engEdit();
});
engEl('engApply').addEventListener('click', () => { if (!ENGW.s || ENGW.s.error) return; engApply({ ...ENGW.E }); });
engEl('engSave').addEventListener('click', () => {
  const name = (engEl('eng-name').value.trim() || _('eng.auto', { n: SAVED_ENG.length + 1 })).slice(0, 40), q = { ...ENGW.E, name };
  delete q.id;
  const list = SAVED_ENG.filter(v => v.name !== name).concat([q]), ok = parseEngines(JSON.stringify(list));
  if (ok.length !== list.length) { engEl('engNote').textContent = _('eng.bad'); return; }
  SAVED_ENG = ok; writePref(LS, PREF_KEYS.engines, JSON.stringify(ok));
  ENGW.E.id = 's:' + ok.findIndex(v => v.name === name); engEl('eng-name').value = '';
  engRenderPre(); engEl('engNote').textContent = _('eng.saved1', { name });
});
engEl('engDel').addEventListener('click', () => {
  if (!ENGW.E.id.startsWith('s:')) return;
  SAVED_ENG.splice(+ENGW.E.id.slice(2), 1); writePref(LS, PREF_KEYS.engines, JSON.stringify(SAVED_ENG));
  ENGW.E.id = ''; engRenderPre();
});
if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (!engEl('w-engine').hidden && ENGW.s && !ENGW.s.error) engChart(ENGW.s, ENGW.linked ? engMission() : null); }).observe(engEl('engCv').parentElement);
// the window opens on the mission's engine when it has one
function engWinOpened() { engOpenFrom(S.M && S.M.eng ? S.M.eng : null); }
// a finished result (app.js updateResults): the window follows when it shows the mission's engine
function engAfterResults() { if (!engEl('w-engine').hidden) engCompute(); }
engRender();
