// Mission recording (Phase 17c): the mission from start to end as a GIF or a video, drawn frame by frame (not a
// screen capture): the progress u steps from 0 to 1 on a fixed schedule, each frame is drawn on demand (app.js
// drawBody), the canvases (3D below, the overlay above) are copied at the recording's size right after drawing, and a
// watermark (and, if asked, the mission's name and total Δv) is added. A slow device still gives an even film. By
// default the background is the plain void (no Milky Way, stars or Sun glare: app.js skyRec), small and calm; the
// panel's "Yıldızlı arka plan" keeps the sky. The view on screen never changes.
// GIF: js/rec-worker.mjs (gifenc, vendor/gifenc) in a module worker, sized under ~8 MB (frame rate, then width, lowered
// when a probe says it would not fit; the viewer is told). Video: WebCodecs VideoEncoder with mp4-muxer (H.264) or
// webm-muxer (VP9/VP8) from vendor/, whatever the browser encodes; hidden without WebCodecs. The libraries come only
// with a recording (worker, import()). Classic script after app.js (its globals); the top part is DOM-free (tests).

// ===================== Pure part (tests/ui.test.js) =====================
// the site's address in the watermark: the one place it is written (the domain will change)
const SITE_URL = 'baqikk.github.io/orbital-simulator';
// fps: frames per second; base: seconds for the mission, perEvent: added per event (burn, periapsis, …), kept within
// min..max; hold: the last frame's pause (s); events slow the film down (slow: extra density at an event, width: its
// half-width in u); maxGif: the GIF size aimed under; widths offered
const REC_OPT = { fps: 15, base: 12, perEvent: 0.8, min: 10, max: 20, hold: 1.5, slow: 2.5, width: 0.012, maxGif: 8e6, widths: [480, 720, 1080] };
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
// the recording's size: width as asked (no larger than the canvas has pixels), even numbers (video encoders want them)
function recSize(srcW, srcH, want) {
  const w = Math.max(2, 2 * Math.floor(Math.min(want, srcW) / 2));
  return { w, h: Math.max(2, 2 * Math.round(w * srcH / srcW / 2)), capped: want > srcW };
}
// what to try for a GIF, in order: as asked; 10 frames/s; coarser colours (rgb444, 128: a turning sky changes every pixel
// of every frame, and finer colours cost the most there); 480 px; 64 colours
function recLadder(want) {
  const c0 = { fmt: 'rgb565', colors: 255 }, c1 = { fmt: 'rgb444', colors: 128 }, c2 = { fmt: 'rgb444', colors: 64 };
  const out = [{ w: want, fps: 15, ...c0 }, { w: want, fps: 10, ...c0 }, { w: want, fps: 10, ...c1 }];
  if (want > 480) out.push({ w: 480, fps: 10, ...c1 });
  out.push({ w: Math.min(want, 480), fps: 10, ...c2 });
  return out;
}
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
// one frame: the void, the canvases scaled to w × h (bottom first), the decoration
function recCompose(ctx, srcs, w, h, deco) {
  ctx.fillStyle = deco.bg; ctx.fillRect(0, 0, w, h);
  for (const s of srcs) if (s) ctx.drawImage(s, 0, 0, w, h);
  recDecorate(ctx, w, h, deco);
}
if (typeof module !== 'undefined') module.exports = { SITE_URL, REC_OPT, recSchedule, recSize, recLadder, recEstimate, recSlug, recFileName, recWords, recMark, recDecorate, recCompose };

// ===================== The recorder (the page) =====================
if (typeof document !== 'undefined' && typeof S !== 'undefined') (() => {
  const W0 = { fmt: 'gif', w: 720, title: true, sky: false }, CAN_VIDEO = typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
  const phone = () => VW.phone.matches;
  const load = () => { try { const o = JSON.parse(readPref(LS, PREF_KEYS.rec) || 'null'); if (o && typeof o === 'object') return o; } catch (e) { /* defaults */ } return null; };
  const R = { set: Object.assign({}, W0, phone() ? { fmt: CAN_VIDEO ? 'video' : 'gif', w: 480 } : {}, load() || {}), cancel: false, url: null, file: null };
  if (!REC_OPT.widths.includes(R.set.w)) R.set.w = 720;
  if (R.set.fmt === 'video' && !CAN_VIDEO) R.set.fmt = 'gif';
  const panel = $('#recPanel'), btn = $('#recBtn');
  const show = (id, on) => { $(id).hidden = !on; };
  function sync() {
    setSeg('#recFmt', R.set.fmt); setSeg('#recW', String(R.set.w));
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
  $('#recSky').addEventListener('change', e => { R.set.sky = e.target.checked; save(); });
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

  // drawing one frame at u onto the recording canvas
  let oc = null, octx = null, deco = null;
  function canvasOf(w, h) {
    oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    octx = oc.getContext('2d', { willReadFrequently: true });
  }
  function renderAt(u) {
    S.u = u; S.ext = 0;
    const t = performance.now(); last = t - 40; // a frame's step for the draw loop (keeps time, passes any frame cap)
    drawBody(t, true);
    recCompose(octx, is3d() ? [$('#gl'), cv] : [cv], oc.width, oc.height, deco); // 3D: read right after drawing
  }
  const pixels = () => octx.getImageData(0, 0, oc.width, oc.height).data;
  // a yield to the page (progress, input) that background tabs do not slow down as they do timers
  const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

  let worker = null;
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
    REC.full = false; REC.busy = false; INS = null; needFit = true; btn.disabled = false; last = performance.now();
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
    for (const cfg of recLadder(R.set.w)) {
      const sz = recSize(cv.width, cv.height, cfg.w), sc = recSchedule(ev, { fps: cfg.fps }), n = sc.u.length;
      canvasOf(sz.w, sz.h);
      const pairs = [];
      for (const f of [0.08, 0.3, 0.5, 0.7, 0.92]) {
        const k = Math.min(n - 2, Math.round(f * (n - 1)));
        renderAt(sc.u[k]); const a = pixels(); renderAt(sc.u[k + 1]); pairs.push([a, pixels()]);
        await tick(); if (R.cancel) throw new Error('cancel');
      }
      const r = await ask({ cmd: 'probe', w: sz.w, h: sz.h, pairs, o: { fmt: cfg.fmt, colors: cfg.colors } });
      est = recEstimate(r.key, r.diff, n);
      pick = { sz, sc, cfg }; samples = pairs.map(p => p[0]);
      if (est <= REC_OPT.maxGif) break;
    }
    const lowered = [];
    if (pick.cfg.fps < 15) lowered.push(_('rec.redFps', { n: pick.cfg.fps }));
    if (pick.cfg.colors < 255) lowered.push(_('rec.redCol', { n: pick.cfg.colors }));
    if (pick.cfg.w < R.set.w) lowered.push(_('rec.redW', { w: pick.sz.w }));
    if (lowered.length) notes.push(_('rec.reduced', { what: lowered.length > 1 ? lowered.slice(0, -1).join(', ') + _('rec.and') + lowered[lowered.length - 1] : lowered[0] }));
    if (est > REC_OPT.maxGif) notes.push(_('rec.big', { size: fmtBytes(est) }));
    if (pick.sz.capped) notes.push(_('rec.capped', { w: pick.sz.w }));
    await ask({ cmd: 'start', w: pick.sz.w, h: pick.sz.h, samples, o: { fmt: pick.cfg.fmt, colors: pick.cfg.colors } });
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
    const bitrate = Math.round(Math.min(6e6, Math.max(8e5, 2.5e6 * w * h / (1280 * 720))));
    const cands = [['mp4', 'avc1.640028'], ['mp4', 'avc1.4D4028'], ['mp4', 'avc1.42E028'], ['mp4', 'avc1.42E01F'], ['webm', 'vp09.00.40.08'], ['webm', 'vp8']];
    for (const [box, codec] of cands) {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps, ...(box === 'mp4' ? { avc: { format: 'avc' } } : {}) };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r && r.supported) return { box, codec, cfg }; } catch (e) { /* next */ }
    }
    return null;
  }
  async function recVideo(ev, notes) {
    const sz = recSize(cv.width, cv.height, R.set.w), sc = recSchedule(ev, { fps: REC_OPT.fps }), fps = sc.fps;
    if (sz.capped) notes.push(_('rec.capped', { w: sz.w }));
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
    canvasOf(sz.w, sz.h);
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
