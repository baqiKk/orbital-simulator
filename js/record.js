// Mission recording (Phase 17c): the mission from start to end as a GIF or a video, drawn frame by frame (not a
// screen capture): the progress u steps from 0 to 1 on a fixed schedule, each frame is drawn on demand (app.js
// drawBody), the canvases (3D below, the overlay above) are copied at the recording's size right after drawing, and a
// watermark (and, if asked, the mission's name and total Δv) is added. A slow device still gives an even film. By
// default the background is the plain void (no Milky Way, stars or Sun glare: app.js skyRec), small and calm; the
// panel's "Yıldızlı arka plan" keeps the sky. Each frame is drawn at the film's own size on a virtual screen (app.js
// recView; a 1080 px film draws as a 720 px screen at 1.5×: lines and labels keep their share), twice as large, and
// scaled down smoothly; the screen gets its own size back after.
// GIF: js/rec-worker.mjs (gifenc, vendor/gifenc) in a module worker, one palette for the film with the theme's tokens
// kept exactly (recFixed), sized under ~8 MB (frame rate, colours, then width, lowered when a probe says it would not
// fit; the viewer is told). Video: WebCodecs VideoEncoder with mp4-muxer (H.264) or
// webm-muxer (VP9/VP8) from vendor/, whatever the browser encodes; hidden without WebCodecs. The libraries come only
// with a recording (worker, import()). Classic script after app.js (its globals); the top part is DOM-free (tests).

// ===================== Pure part (tests/ui.test.js) =====================
// the site's address in the watermark: the one place it is written (the domain will change)
const SITE_URL = 'baqikk.github.io/orbital-simulator';
// fps: frames per second (fpsList: offered); base: seconds for the mission, perEvent: added per event (burn, periapsis,
// …), kept within min..max; hold: the last frame's pause (s); events slow the film down (slow: extra density at an
// event, width: its half-width in u); maxGif: the GIF size aimed under; widths offered. Drawing: each frame at ss times
// the recording's size (supersampling; ssPx: the most pixels that may take), scaled down smoothly; the virtual screen is
// the recording's width / vk CSS px wide (at least vMin): lines, bodies and labels keep their share of the picture (a
// 1080 px film draws as a 720 px screen at 1.5×). aspect: the height / width kept within these.
const REC_OPT = { fps: 24, fpsList: [15, 24, 30], base: 12, perEvent: 0.8, min: 10, max: 20, hold: 1.5, slow: 2.5, width: 0.012, maxGif: 8e6, widths: [480, 720, 1080],
  ss: 2, ssPx: 16e6, vk: 1.5, vMin: 480, aspect: [9 / 16, 16 / 9] };
// the frames: the u of each (0 … 1) and how long each shows (ms; GIF delays are in hundredths, the rounding carried so
// the film keeps its length), the last one held. evU: the events' u.
function recSchedule(evU, o = {}) {
  const P = { ...REC_OPT, ...o }, ev = (evU || []).filter(u => u >= 0 && u <= 1);
  const T = Math.min(P.max, Math.max(P.min, P.base + P.perEvent * ev.length)), N = Math.max(2, Math.round(T * P.fps));
  const G = 4000, cum = new Float64Array(G + 1);
  for (let i = 1; i <= G; i++) {
    const u = (i - 0.5) / G; let d = 1;
    for (const e of ev) { const x = (u - e) / P.width; d += P.slow * Math.exp(-x * x); }
    cum[i] = cum[i - 1] + d;
  }
  const u = new Float64Array(N);
  for (let k = 0, j = 0; k < N; k++) {
    const c = cum[G] * k / (N - 1);
    while (j < G && cum[j + 1] < c) j++;
    u[k] = j >= G ? 1 : (j + (c - cum[j]) / (cum[j + 1] - cum[j] || 1)) / G;
  }
  u[0] = 0; u[N - 1] = 1;
  const delay = [];
  for (let k = 0; k < N; k++) delay.push((Math.round((k + 1) * 100 / P.fps) - Math.round(k * 100 / P.fps)) * 10);
  delay[N - 1] += Math.round(P.hold * 100) * 10;
  return { u, delay, fps: P.fps, T };
}
// the recording's size from the screen's (CSS px; only its shape counts: the frame is drawn anew, not copied): w as
// asked, h by the screen's aspect (within REC_OPT.aspect), even numbers (video encoders want them); the virtual screen
// cw × ch CSS px it is drawn as, k device px per CSS px in the film, ss the supersampling (drawn at k·ss, canvases ss·w ×
// ss·h, fewer than maxPx pixels)
function recSize(cssW, cssH, want, maxPx = REC_OPT.ssPx) {
  const P = REC_OPT, a = Math.min(P.aspect[1], Math.max(P.aspect[0], cssH / cssW));
  const w = Math.max(2, 2 * Math.round(want / 2)), h = Math.max(2, 2 * Math.round(w * a / 2));
  const cw = Math.max(Math.min(w, P.vMin), w / P.vk), k = w / cw, ss = Math.max(1, Math.min(P.ss, Math.sqrt(maxPx / (w * h))));
  return { w, h, cw, ch: cw * h / w, k, ss };
}
// what to try for a GIF, in order: as asked; 15 frames/s; coarser colours (rgb444, 128: a turning sky changes every pixel
// of every frame, and finer colours cost the most there); each smaller width; 64 colours
function recLadder(want, fps = REC_OPT.fps) {
  const c0 = { fmt: 'rgb565', colors: 255 }, c1 = { fmt: 'rgb444', colors: 128 }, c2 = { fmt: 'rgb444', colors: 64 }, f1 = Math.min(fps, 15);
  const out = [{ w: want, fps, ...c0 }];
  if (fps > 15) out.push({ w: want, fps: 15, ...c0 });
  out.push({ w: want, fps: f1, ...c1 });
  for (const w of REC_OPT.widths.filter(x => x < want).reverse()) out.push({ w, fps: f1, ...c1 });
  out.push({ w: Math.min(want, REC_OPT.widths[0]), fps: Math.min(f1, 10), ...c2 });
  return out;
}
// the GIF palette's fixed colours (js/rec-worker.mjs keeps them exactly, the film through): the theme's tokens (col:
// { name: '#rrggbb' }, the background col.void first), the bodies' colours, and ramps toward the background for soft
// edges: steps tones each of the amber path (col.traj) and the white (col.ink), half as many of the orbit colour
function recFixed(col, bodies, steps = 12) {
  const rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim()); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
  const bg = rgb(col.void), out = [bg];
  const add = c => { if (c && !out.some(q => q[0] === c[0] && q[1] === c[1] && q[2] === c[2])) out.push(c); };
  for (const k of Object.keys(col)) add(rgb(col[k]));
  for (const b of bodies || []) add(rgb(b));
  const ramp = (h, n) => { const c = rgb(h); if (c) for (let i = 1; i <= n; i++) { const t = i / (n + 1); add(c.map((v, j) => Math.round(v + (bg[j] - v) * t))); } };
  ramp(col.traj, steps); ramp(col.ink, steps); ramp(col.orbit, Math.round(steps / 2));
  return out;
}
// the video's bit rate: bits per pixel per frame by quality ('high' | 'std'), within 0.6–20 Mbit/s
const recBitrate = (w, h, fps, q) => Math.round(Math.min(2e7, Math.max(6e5, (q === 'std' ? 0.05 : 0.12) * w * h * fps)));
// a GIF's size from a probe: the first frame, then n − 1 following frames (a little margin)
const recEstimate = (key, diff, n) => key + Math.max(0, n - 1) * diff * 1.1 + 1000;
// file names: Turkish letters to ASCII, lower case, words joined by '-', at most 64 characters before the extension
function recSlug(s) {
  const map = { ı: 'i', İ: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c', â: 'a', î: 'i', û: 'u' };
  return String(s == null ? '' : s).replace(/[ıİşŞğĞüÜöÖçÇâîû]/g, c => map[c]).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function recFileName(words, ext) { return (words.map(recSlug).filter(Boolean).join('-').slice(0, 64).replace(/-+$/, '') || 'yorunge') + '.' + ext; }
// the words of a mission's file name. m: { kind: 'man' | 'transfer', body, type, hp0, ha0, hp1 (km) } or { a, b, mode };
// tr: a dictionary lookup (the words are the dictionary's: rec.fn.*). Example: yorunge-dunya-600-1300km
function recWords(m, tr) {
  const n = v => String(Math.round(+v || 0));
  if (m.kind === 'man') {
    const tail = m.type === 'free' ? tr('rec.fn.free') : m.type === 'burn' ? tr('rec.fn.burn')
      : (m.hp0 === m.ha0 ? n(m.hp0) : n(m.hp0) + 'x' + n(m.ha0)) + '-' + n(m.hp1) + 'km';
    return [tr('rec.fn'), m.body, tail];
  }
  return [tr('rec.fn'), m.a, m.b, m.mode === 'free' ? tr('rec.fn.return') : m.mode === 'flyby' ? tr('rec.fn.flyby') : ''];
}
// the watermark's text: the site's name and address
const recMark = tr => tr('meta.title') + ' · ' + SITE_URL;
// draws the watermark (bottom right, small, half transparent) and the title (top left, if any) on ctx (w × h px).
// o: { mark, title, sub, ink (colour), font }
function recDecorate(ctx, w, h, o) {
  const f = Math.max(9, Math.round(w * 0.017)), pad = Math.round(f * 0.9), font = o.font || 'system-ui, sans-serif';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = Math.max(2, f * 0.3);
  ctx.fillStyle = o.ink; ctx.globalAlpha = 0.55;
  ctx.font = `500 ${f}px ${font}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(o.mark, w - pad, h - pad);
  if (o.title) {
    ctx.globalAlpha = 0.85; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `600 ${Math.round(f * 1.25)}px ${font}`; ctx.fillText(o.title, pad, pad);
    if (o.sub) { ctx.globalAlpha = 0.7; ctx.font = `500 ${f}px ${font}`; ctx.fillText(o.sub, pad, pad + Math.round(f * 1.6)); }
  }
  ctx.restore();
}
// one frame: the void, the canvases (drawn larger: supersampled) scaled down smoothly to w × h, bottom first, halving
// in steps while more than twice as large (half: (src, w, h) → a canvas of that size; the page's), the decoration
function recCompose(ctx, srcs, w, h, deco, half) {
  ctx.fillStyle = deco.bg; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (let s of srcs) {
    if (!s) continue;
    while (half && s.width > 2.01 * w) s = half(s, Math.ceil(s.width / 2), Math.ceil(s.height / 2));
    ctx.drawImage(s, 0, 0, w, h);
  }
  recDecorate(ctx, w, h, deco);
}
if (typeof module !== 'undefined') module.exports = { SITE_URL, REC_OPT, recSchedule, recSize, recLadder, recFixed, recBitrate, recEstimate, recSlug, recFileName, recWords, recMark, recDecorate, recCompose };

// ===================== The recorder (the page) =====================
if (typeof document !== 'undefined' && typeof S !== 'undefined') (() => {
  // dither: null follows the starry background (on with it, off on the plain void); q: the video's quality
  const W0 = { fmt: 'gif', w: 1080, fps: 24, title: true, sky: false, dither: null, q: 'high' }, CAN_VIDEO = typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
  const phone = () => VW.phone.matches;
  const load = () => { try { const o = JSON.parse(readPref(LS, PREF_KEYS.rec) || 'null'); if (o && typeof o === 'object') return o; } catch (e) { /* defaults */ } return null; };
  // phones: video at 720 px (memory: the supersampled canvases), fewer pixels drawn per frame
  const R = { set: Object.assign({}, W0, phone() ? { fmt: CAN_VIDEO ? 'video' : 'gif', w: 720 } : {}, load() || {}), cancel: false, url: null, file: null };
  const maxPx = () => (phone() ? 6e6 : REC_OPT.ssPx);
  if (!REC_OPT.widths.includes(R.set.w)) R.set.w = W0.w;
  if (!REC_OPT.fpsList.includes(R.set.fps)) R.set.fps = W0.fps;
  if (R.set.q !== 'std') R.set.q = 'high';
  if (R.set.fmt === 'video' && !CAN_VIDEO) R.set.fmt = 'gif';
  const dither = () => (R.set.dither == null ? !!R.set.sky : !!R.set.dither);
  const panel = $('#recPanel'), btn = $('#recBtn');
  const show = (id, on) => { $(id).hidden = !on; };
  function sync() {
    setSeg('#recFmt', R.set.fmt); setSeg('#recW', String(R.set.w)); setSeg('#recFps', String(R.set.fps)); setSeg('#recQ', R.set.q);
    show('#recQRow', R.set.fmt === 'video'); show('#recDitherRow', R.set.fmt === 'gif'); $('#recDither').checked = dither();
    $('#recFmt button[data-v="video"]').disabled = !CAN_VIDEO;
    $('#recFmtNote').textContent = _(!CAN_VIDEO ? 'rec.noVideo' : R.set.fmt === 'gif' ? 'rec.gifD' : 'rec.videoD');
    $('#recTitle').checked = !!R.set.title; $('#recSky').checked = !!R.set.sky;
  }
  const save = () => writePref(LS, PREF_KEYS.rec, JSON.stringify(R.set));
  function stage(s) { show('#recSetup', s === 'setup'); show('#recProg', s === 'prog'); show('#recDone', s === 'done'); }
  function open() {
    if (!panel.hidden) { if (!REC.busy) panel.hidden = true; return; }
    sync(); stage('setup'); $('#recMsg').textContent = ''; panel.hidden = false;
    $('#recGo').disabled = !(C && simR) || (MAN && MAN.busy);
    $('#recNote').textContent = $('#recGo').disabled ? _('rec.busy') : '';
  }
  btn.addEventListener('click', open);
  $('#recX').addEventListener('click', () => { if (!REC.busy) panel.hidden = true; });
  $('#recFmt').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; R.set.fmt = b.dataset.v; save(); sync(); });
  $('#recW').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; R.set.w = +b.dataset.v; save(); sync(); });
  $('#recTitle').addEventListener('change', e => { R.set.title = e.target.checked; save(); });
  $('#recSky').addEventListener('change', e => { R.set.sky = e.target.checked; R.set.dither = null; save(); sync(); }); // dithering follows the sky again
  $('#recFps').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; R.set.fps = +b.dataset.v; save(); sync(); });
  $('#recQ').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; R.set.q = b.dataset.v; save(); sync(); });
  $('#recDither').addEventListener('change', e => { R.set.dither = e.target.checked; save(); });
  $('#recCancel').addEventListener('click', () => { R.cancel = true; });
  $('#recGo').addEventListener('click', () => { recStart().catch(err => fail(err)); });
  $('#recSave').addEventListener('click', deliver);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden && !REC.busy) panel.hidden = true; });

  const status = (key, p, prog) => { $('#recMsg').textContent = _(key, p); if (prog != null) $('#recBar').value = prog; };
  function fail(err) { finish(); stage('setup'); $('#recNote').textContent = R.cancel ? _('rec.canceled') : _('rec.fail', { msg: String(err && err.message || err) }); }
  // the mission's file name, title and total Δv
  function words() {
    const M = S.M;
    if (S.kind === 'man') return recWords({ kind: 'man', body: _('body.' + M.body), type: M.type, hp0: M.hp0, ha0: M.ha0, hp1: M.hp1 }, _);
    return recWords({ kind: 'transfer', a: S.bodies[0] && S.bodies[0].name, b: S.bodies[1] && S.bodies[1].name, mode: M.mode }, _);
  }
  function totalDv() {
    if (!simR) return 0;
    if (S.kind === 'man') { const b = simR.burns || []; return b.reduce((a, x) => a + (x.dv || 0), 0) || (MAN && MAN.plan ? MAN.plan.dv : 0); }
    return S.M.dv + (S.M.mode === 'capture' && simR.captured ? simR.captured.dv : 0);
  }
  // the events where the film slows down: the markers' times (duplicates within a frame's step dropped)
  function eventsU() {
    const us = (C.markers || []).map(m => tToU(m.t)).filter(u => u > 0.001 && u < 0.999).sort((a, b) => a - b);
    return us.filter((u, i) => !i || u - us[i - 1] > 0.004);
  }

  // drawing one frame at u onto the recording canvas: the app draws at the recording's own size, supersampled (app.js
  // recView: its canvases ss·w × ss·h, the virtual screen sz.cw × sz.ch CSS px), and the frame is scaled down to w × h
  let oc = null, octx = null, deco = null;
  function canvasOf(sz) {
    recView({ cw: sz.cw, ch: sz.ch, dpr: sz.k * sz.ss });
    oc = document.createElement('canvas'); oc.width = sz.w; oc.height = sz.h;
    octx = oc.getContext('2d', { willReadFrequently: true });
  }
  const halves = [];
  function half(src, w, h) { // a scratch canvas per step down (kept for the recording)
    let c = halves.find(q => q.width === w && q.height === h && q !== src);
    if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; halves.push(c); }
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.clearRect(0, 0, w, h); x.drawImage(src, 0, 0, w, h);
    return c;
  }
  function renderAt(u) {
    S.u = u; S.ext = 0;
    const t = performance.now(); last = t - 40; // a frame's step for the draw loop (keeps time, passes any frame cap)
    drawBody(t, true);
    recCompose(octx, is3d() ? [$('#gl'), cv] : [cv], oc.width, oc.height, deco, half); // 3D: read right after drawing
  }
  // the palette's fixed colours: the theme's tokens, the mission's bodies, ramps of the path and the labels
  const fixedCols = () => recFixed(COL, S.bodies.map(b => b.color));
  const pixels = () => octx.getImageData(0, 0, oc.width, oc.height).data;
  // a yield to the page (progress, input) that background tabs do not slow down as they do timers
  const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

  let worker = null, W0css = { w: 16, h: 9 };
  function ask(msg, transfer) {
    return new Promise((res, rej) => {
      worker.onmessage = e => (e.data.cmd === 'error' ? rej(new Error(e.data.msg)) : res(e.data));
      worker.onerror = e => rej(new Error(e.message || 'worker'));
      worker.postMessage(msg, transfer || []);
    });
  }

  async function recStart() {
    if (REC.busy || !C || !simR) return;
    const keep = { u: S.u, ext: S.ext, playing: S.playing };
    W0css = { w: W, h: H }; // the screen's shape sets the film's
    R.cancel = false; R.keep = keep; REC.busy = true; REC.full = true; REC.sky = !!R.set.sky; INS = null; needFit = true;
    S.playing = false; setPlayIcon();
    stage('prog'); $('#recBar').value = 0; status('rec.probe'); btn.disabled = true;
    const notes = [];
    deco = { bg: COL.void, ink: COL.ink, mark: recMark(_), font: '"IBM Plex Sans", system-ui, sans-serif', title: '', sub: '' };
    if (R.set.title) { deco.title = S.scenario ? _('sc.' + S.scenario + '.name') : $('#modeText').textContent; const dv = totalDv(); if (dv > 0) deco.sub = _('rec.dv', { v: fmtSpeed(dv) }); }
    const ev = eventsU(), name = recFileName(words(), R.set.fmt === 'gif' ? 'gif' : 'x');
    let blob;
    if (R.set.fmt === 'gif') blob = await recGif(ev, notes);
    else blob = await recVideo(ev, notes, name);
    if (!blob) return;
    R.file = new File([blob], R.set.fmt === 'gif' ? name : name.replace(/\.x$/, '.' + R.ext), { type: blob.type });
    finish();
    stage('done');
    $('#recDoneMsg').textContent = _('rec.done', { name: R.file.name, size: fmtBytes(R.file.size) });
    $('#recDoneNote').textContent = notes.join(' ');
    const share = phone() && navigator.canShare && navigator.canShare({ files: [R.file] });
    $('#recSave').textContent = _(share ? 'rec.share' : 'rec.save');
    if (!share) deliver(); // desktop: the file comes down at once (the button downloads it again)
  }
  // back to the mission as it was
  function finish() {
    if (worker) { worker.terminate(); worker = null; }
    if (R.keep) { S.u = R.keep.u; S.ext = R.keep.ext; S.playing = R.keep.playing; R.keep = null; setPlayIcon(); }
    REC.full = false; REC.busy = false; recView(null); halves.length = 0; btn.disabled = false; last = performance.now();
  }
  function deliver() {
    const f = R.file; if (!f) return;
    if (phone() && navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: f.name }).catch(() => {}); return; }
    if (R.url) URL.revokeObjectURL(R.url);
    R.url = URL.createObjectURL(f);
    const a = document.createElement('a'); a.href = R.url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  }
  const fmtBytes = b => (b < 1e6 ? nf0.format(b / 1e3) + ' KB' : nf1.format(b / 1e6) + ' MB');

  // GIF: probe the ladder (pairs of neighbouring frames at a few places), pick the first setting under maxGif, encode
  async function recGif(ev, notes) {
    worker = new Worker(new URL('js/rec-worker.mjs', document.baseURI), { type: 'module' });
    let pick = null, est = 0, samples = null;
    const fixed = fixedCols();
    for (const cfg of recLadder(R.set.w, R.set.fps)) {
      const sz = recSize(W0css.w, W0css.h, cfg.w, maxPx()), sc = recSchedule(ev, { fps: cfg.fps }), n = sc.u.length;
      canvasOf(sz);
      const pairs = [];
      for (const f of [0.08, 0.3, 0.5, 0.7, 0.92]) {
        const k = Math.min(n - 2, Math.round(f * (n - 1)));
        renderAt(sc.u[k]); const a = pixels(); renderAt(sc.u[k + 1]); pairs.push([a, pixels()]);
        await tick(); if (R.cancel) throw new Error('cancel');
      }
      const r = await ask({ cmd: 'probe', w: sz.w, h: sz.h, pairs, o: { fmt: cfg.fmt, colors: cfg.colors, fixed, dither: dither() } });
      est = recEstimate(r.key, r.diff, n);
      pick = { sz, sc, cfg }; samples = pairs.map(p => p[0]);
      if (est <= REC_OPT.maxGif) break;
    }
    const lowered = [];
    if (pick.cfg.fps < R.set.fps) lowered.push(_('rec.redFps', { n: pick.cfg.fps }));
    if (pick.cfg.colors < 255) lowered.push(_('rec.redCol', { n: pick.cfg.colors }));
    if (pick.cfg.w < R.set.w) lowered.push(_('rec.redW', { w: pick.sz.w }));
    if (lowered.length) notes.push(_('rec.reduced', { what: lowered.length > 1 ? lowered.slice(0, -1).join(', ') + _('rec.and') + lowered[lowered.length - 1] : lowered[0] }));
    if (est > REC_OPT.maxGif) notes.push(_('rec.big', { size: fmtBytes(est) }));
    if (pick.sz.w !== oc.width) canvasOf(pick.sz); // the ladder went further: back to the picked size
    await ask({ cmd: 'start', w: pick.sz.w, h: pick.sz.h, samples, o: { fmt: pick.cfg.fmt, colors: pick.cfg.colors, fixed, dither: dither() } });
    const { u, delay } = pick.sc, n = u.length;
    for (let k = 0; k < n; k++) {
      if (R.cancel) throw new Error('cancel');
      renderAt(u[k]);
      const px = pixels();
      await ask({ cmd: 'frame', rgba: px.buffer, delay: delay[k] }, [px.buffer]);
      status('rec.frames', { n: k + 1, m: n }, (k + 1) / n);
      if (k % 4 === 3) await tick();
    }
    status('rec.finishing');
    const r = await ask({ cmd: 'end' });
    return new Blob([r.bytes], { type: 'image/gif' });
  }

  // video: the first container and codec the browser encodes (MP4/H.264, else WebM/VP9, VP8)
  async function videoCfg(w, h, fps) {
    const bitrate = recBitrate(w, h, fps, R.set.q);
    const cands = [['mp4', 'avc1.640028'], ['mp4', 'avc1.4D4028'], ['mp4', 'avc1.42E028'], ['mp4', 'avc1.42E01F'], ['webm', 'vp09.00.40.08'], ['webm', 'vp8']];
    for (const [box, codec] of cands) {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps, ...(box === 'mp4' ? { avc: { format: 'avc' } } : {}) };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r && r.supported) return { box, codec, cfg }; } catch (e) { /* next */ }
    }
    return null;
  }
  async function recVideo(ev, notes) {
    const sz = recSize(W0css.w, W0css.h, R.set.w, maxPx()), sc = recSchedule(ev, { fps: R.set.fps }), fps = sc.fps;
    const v = await videoCfg(sz.w, sz.h, fps);
    if (!v) throw new Error(_('rec.noVideo'));
    const lib = await import(new URL(v.box === 'mp4' ? 'vendor/mp4-muxer/mp4-muxer.mjs' : 'vendor/webm-muxer/webm-muxer.mjs', document.baseURI).href);
    const target = new lib.ArrayBufferTarget();
    const muxer = v.box === 'mp4'
      ? new lib.Muxer({ target, video: { codec: 'avc', width: sz.w, height: sz.h }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' })
      : new lib.Muxer({ target, video: { codec: v.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: sz.w, height: sz.h, frameRate: fps }, firstTimestampBehavior: 'offset' });
    let err = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; } });
    enc.configure(v.cfg);
    canvasOf(sz);
    const n = sc.u.length, us = 1e6 / fps, hold = Math.round(REC_OPT.hold * fps);
    try {
      for (let k = 0; k < n + hold; k++) {
        if (R.cancel) throw new Error('cancel');
        if (err) throw err;
        if (k < n) renderAt(sc.u[k]);
        const fr = new VideoFrame(oc, { timestamp: Math.round(k * us), duration: Math.round(us) });
        enc.encode(fr, { keyFrame: k % (fps * 2) === 0 }); fr.close();
        while (enc.encodeQueueSize > 4) await new Promise(r => { const t = setTimeout(r, 50); enc.addEventListener('dequeue', () => { clearTimeout(t); r(); }, { once: true }); });
        status('rec.frames', { n: Math.min(k + 1, n), m: n }, Math.min(1, (k + 1) / (n + hold)));
        if (k % 4 === 3) await tick();
      }
      status('rec.finishing');
      await enc.flush(); if (err) throw err;
      muxer.finalize();
    } finally { if (enc.state !== 'closed') enc.close(); }
    R.ext = v.box;
    return new Blob([target.buffer], { type: v.box === 'mp4' ? 'video/mp4' : 'video/webm' });
  }
})();
