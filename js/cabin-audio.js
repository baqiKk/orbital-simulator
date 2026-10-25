'use strict';
// Cabin sound (kabin.html, Phase 11): a lo-fi radio and three layers, through one Web Audio graph.
//   radio: js/sounds.js MUSIC in a shuffled order (no repeat until all have played), 3 s crossfades between two media
//     elements (Opus/WebM, MP3 where Opus does not play); no seeking. A failing track is retried quietly after 2, 5 and
//     15 s, then skipped; onState reports the trouble so the page can show a small warning.
//   space: the two NASA plasma-wave recordings (SPACE_SND) in turn, 4 s crossfades.
//   hum: the ship's low hum, synthesised (55 / 110 Hz, low-passed brown noise, a slow swell).
//   noise: white / pink / brown noise from a generated, seamlessly looping buffer.
// Everything starts on the first user gesture (browser rule) and keeps playing while the tab is hidden: fades are
// scheduled on the audio clock, a track's end also arrives as a media event. Muted or silent: the context is suspended.
const SND = { ctx: null, master: null, set: null, ext: 'mp3', started: false, layers: {}, onState: null, state: { track: null, trouble: 0 } };

function sndInit() {
  if (SND.ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  SND.ctx = new AC();
  SND.master = SND.ctx.createGain(); SND.master.connect(SND.ctx.destination);
  SND.ext = document.createElement('audio').canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'mp3';
  for (const k of ['music', 'space', 'hum', 'noise']) { const g = SND.ctx.createGain(); g.gain.value = 0; g.connect(SND.master); SND.layers[k] = { g, on: false }; }
}
const sndEmit = () => { if (SND.onState) SND.onState(SND.state); };

// ---------- a deck: two media elements crossfading through a list ----------
const RETRY_S = [2, 5, 15];
function makeDeck(out, next, xfade, report) {
  const ctx = SND.ctx, D = { els: [], cur: 0, item: null, fading: false, fails: 0, want: false, timer: 0, lastT: 0, lastMove: 0 };
  for (let i = 0; i < 2; i++) {
    const el = new Audio(); el.preload = 'auto';
    const g = ctx.createGain(); g.gain.value = 0; ctx.createMediaElementSource(el).connect(g); g.connect(out);
    const E = { el, g, item: null };
    el.addEventListener('timeupdate', () => { if (E === D.els[D.cur] && !D.fading && el.duration && el.duration - el.currentTime <= xfade) D.cross(xfade); });
    el.addEventListener('ended', () => { if (E === D.els[D.cur] && !D.fading) D.cross(0.05); });
    el.addEventListener('playing', () => { if (E === D.els[D.cur] && D.fails) { D.fails = 0; report(0); } });
    el.addEventListener('error', () => { if (E === D.els[D.cur] && D.want) D.trouble(); });
    D.els.push(E);
  }
  const load = (E, item, at = 0) => {
    E.item = item; E.el.src = item.url;
    if (at) E.el.addEventListener('loadedmetadata', () => { E.el.currentTime = at; }, { once: true });
    E.el.play().catch(() => {}); // an error event follows a real failure
  };
  D.start = () => {
    if (D.want) return; D.want = true; D.fails = 0;
    const E = D.els[D.cur]; D.item = next(); load(E, D.item);
    E.g.gain.cancelScheduledValues(ctx.currentTime); E.g.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    D.lastMove = performance.now(); report(0, D.item);
    clearInterval(D.timer); D.timer = setInterval(D.watch, 3000);
  };
  D.stop = () => {
    D.want = false; D.fading = false; clearInterval(D.timer);
    for (const E of D.els) { E.g.gain.cancelScheduledValues(ctx.currentTime); E.g.gain.value = 0; E.el.pause(); E.el.removeAttribute('src'); E.el.load(); }
  };
  // fade the current element out and the next item in over s seconds (audio clock: exact in a hidden tab too)
  D.cross = s => {
    if (!D.want || D.fading) return;
    D.fading = true;
    const A = D.els[D.cur], B = D.els[1 - D.cur], t = ctx.currentTime;
    D.item = next(); load(B, D.item);
    A.g.gain.cancelScheduledValues(t); A.g.gain.setValueAtTime(A.g.gain.value, t); A.g.gain.linearRampToValueAtTime(0, t + s);
    B.g.gain.cancelScheduledValues(t); B.g.gain.setValueAtTime(0, t); B.g.gain.linearRampToValueAtTime(1, t + s);
    D.cur = 1 - D.cur; D.lastMove = performance.now(); report(D.fails, D.item);
    setTimeout(() => { A.el.pause(); A.el.removeAttribute('src'); A.el.load(); D.fading = false; }, s * 1000 + 150);
  };
  // a failing or stalled element: retry the same item where it stopped, then give up on it and move on
  D.trouble = () => {
    const E = D.els[D.cur], wait = RETRY_S[RETRY_S.length - 1] * 1000;
    D.fails = Math.min(D.fails + 1, RETRY_S.length + 1); report(Math.min(D.fails, RETRY_S.length), D.item);
    // retries used up: the next item, then every 15 s while it keeps failing (no burst of requests while offline)
    if (D.fails > RETRY_S.length) { setTimeout(() => { if (D.want && E === D.els[D.cur]) { D.fails = RETRY_S.length; D.cross(0.05); } }, wait); return; }
    const at = E.el.currentTime || 0, item = E.item;
    setTimeout(() => { if (D.want && E === D.els[D.cur]) { D.lastMove = performance.now(); load(E, item, at); } }, RETRY_S[D.fails - 1] * 1000);
  };
  D.watch = () => {
    const E = D.els[D.cur]; if (!D.want || D.fading) return;
    if (E.el.currentTime !== D.lastT) { D.lastT = E.el.currentTime; D.lastMove = performance.now(); return; }
    if (performance.now() - D.lastMove > 12000) { D.lastMove = performance.now(); D.trouble(); } // network gone mid-track
  };
  D.retryNow = () => { if (D.want && D.fails) { const E = D.els[D.cur]; load(E, E.item, E.el.currentTime || 0); } };
  return D;
}

// ---------- the radio's order: every track once, shuffled, the next round not starting with the last one ----------
function shuffleBag(items) {
  let bag = [], last = null;
  return () => {
    if (!bag.length) { bag = items.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]]; }
    return (last = bag.pop());
  };
}

// ---------- generated sound ----------
// noise buffer (6 s, stereo); the end is blended into the start so the loop has no seam
function noiseBuffer(type) {
  const c = SND.ctx, sr = c.sampleRate, n = sr * 6, F = Math.round(sr * 0.5), buf = c.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const x = new Float32Array(n + F); let b0 = 0, b1 = 0, b2 = 0, br = 0;
    for (let i = 0; i < n + F; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') x[i] = w * 0.5;
      else if (type === 'pink') { b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
      else { br = (br + 0.02 * w) / 1.02; x[i] = br * 3.2; }
    }
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = i < F ? x[i] * (i / F) + x[n + i] * (1 - i / F) : x[i];
  }
  return buf;
}
function humStart(out) {
  const c = SND.ctx, swell = c.createGain(), nodes = [];
  swell.gain.value = 0.8; swell.connect(out);
  for (const [f, a] of [[55, 0.5], [110, 0.18], [165, 0.05]]) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.value = a; o.connect(g); g.connect(swell); o.start(); nodes.push(o, g); }
  const ns = c.createBufferSource(), lp = c.createBiquadFilter(), ng = c.createGain();
  ns.buffer = noiseBuffer('brown'); ns.loop = true; lp.type = 'lowpass'; lp.frequency.value = 160; ng.gain.value = 0.9;
  ns.connect(lp); lp.connect(ng); ng.connect(swell); ns.start(); nodes.push(ns, lp, ng);
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.06; lg.gain.value = 0.18; lfo.connect(lg); lg.connect(swell.gain); lfo.start(); nodes.push(lfo, lg);
  return () => { for (const nd of nodes) { try { nd.stop && nd.stop(); } catch (e) { /* stopped */ } nd.disconnect(); } swell.disconnect(); };
}
function noiseStart(out, type) {
  const s = SND.ctx.createBufferSource(); s.buffer = noiseBuffer(type); s.loop = true; s.connect(out); s.start();
  return () => { try { s.stop(); } catch (e) { /* stopped */ } s.disconnect(); };
}

// ---------- settings -> graph ----------
const SND_K = { music: 1, space: 1, hum: 0.5, noise: 0.35 }; // layer level at full volume
const sndUrl = (dir, id) => `audio/cabin/${dir}/${id}.${SND.ext}`;
function sndApply(set) {
  SND.set = set; if (!SND.started) return;
  const c = SND.ctx, t = c.currentTime, L = SND.layers, any = !set.muted && ['music', 'space', 'hum', 'noise'].some(k => set[k].on);
  if (any && c.state !== 'running') c.resume();
  SND.master.gain.setTargetAtTime(set.muted ? 0 : 1, t, 0.08);
  for (const k of ['music', 'space', 'hum', 'noise']) {
    const on = set[k].on && !set.muted, l = L[k];
    l.g.gain.setTargetAtTime(on ? SND_K[k] * set[k].vol * set[k].vol : 0, t, 0.15);
    if (k === 'noise' && on && l.on && l.type !== set.noise.type) { l.stop(); l.on = false; }
    if (on && !l.on) {
      l.on = true;
      if (k === 'music') { l.deck = l.deck || makeDeck(l.g, (bag => () => { const m = bag(); return { ...m, url: sndUrl('music', m.id) }; })(shuffleBag(MUSIC)), 3, (f, item) => { if (item) SND.state.track = item; SND.state.trouble = f; sndEmit(); sndSession(); }); l.deck.start(); }
      else if (k === 'space') { let i = 0; l.deck = l.deck || makeDeck(l.g, () => { const s = SPACE_SND[i++ % SPACE_SND.length]; return { ...s, url: sndUrl('space', s.id) }; }, 4, () => {}); l.deck.start(); }
      else if (k === 'hum') l.stop = humStart(l.g);
      else { l.type = set.noise.type; l.stop = noiseStart(l.g, l.type); }
    } else if (!on && l.on) {
      l.on = false;
      if (l.deck) l.deck.stop(); else if (l.stop) l.stop();
      if (k === 'music') { SND.state.track = null; SND.state.trouble = 0; sndEmit(); }
    }
  }
  if (!any) setTimeout(() => { if (SND.set === set && c.state === 'running') c.suspend(); }, 400);
  SND.state.active = any; sndEmit();
}
// the first gesture: build the graph and play what the settings ask for
function sndStart(set) {
  sndInit(); SND.started = true;
  SND.ctx.resume();
  sndApply(set || SND.set);
}
// the system's media controls show the track (no seeking: it is a radio)
function sndSession() {
  const ms = navigator.mediaSession, tr = SND.state.track; if (!ms || !tr || typeof MediaMetadata === 'undefined') return;
  try {
    ms.metadata = new MediaMetadata({ title: tr.title, artist: MUSIC_ARTIST, album: MUSIC_ALBUM[tr.album] || '' });
    for (const a of ['seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack']) ms.setActionHandler(a, null);
  } catch (e) { /* unsupported action */ }
}
addEventListener('online', () => { const l = SND.layers.music; if (l && l.deck) l.deck.retryNow(); });

// ---------- the pomodoro's bell (Phase 10) ----------
// A soft struck bowl, synthesised (no file): three inharmonic partials, each with its own decay, and a quieter second
// strike; 'break' (a work session is over) sounds a fourth below 'work' (a break is over). The radio ducks to a fifth of
// its level around it and comes back. Level: the sound panel's bell row; "mute all" silences it too. The context is
// made here if nothing else made it (the browser lets it start once the page has had a gesture); when no layer plays,
// it is suspended again afterwards.
const BOWL = [[1, 1, 2.8], [2.76, 0.35, 1.5], [5.4, 0.12, 0.7]]; // frequency ratio, amplitude, decay (s)
const sndAny = set => !!set && !set.muted && ['music', 'space', 'hum', 'noise'].some(k => set[k].on);
function sndChime(set, kind) {
  if (set.muted || !set.chime.on || !(set.chime.vol > 0)) return;
  sndInit();
  const c = SND.ctx; if (c.state !== 'running') c.resume().catch(() => {});
  const t0 = c.currentTime + 0.05, f0 = kind === 'break' ? 392 : 523.25, out = c.createGain();
  out.gain.value = 0.32 * set.chime.vol * set.chime.vol; out.connect(SND.master);
  for (const [at, amp] of [[0, 1], [1.15, 0.45]]) for (const [r, a, d] of BOWL) {
    const o = c.createOscillator(), g = c.createGain(), t = t0 + at;
    o.frequency.value = f0 * r;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a * amp, t + 0.012); g.gain.exponentialRampToValueAtTime(1e-4, t + d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
  }
  const m = SND.layers.music;
  if (SND.started && m && m.on) {
    const lv = SND_K.music * set.music.vol * set.music.vol, g = m.g.gain, t = c.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.2 * lv, t + 0.4);
    g.setValueAtTime(0.2 * lv, t + 3.4); g.linearRampToValueAtTime(lv, t + 4.9);
  }
  setTimeout(() => { out.disconnect(); if (!sndAny(SND.set) && c.state === 'running') c.suspend(); }, 5500);
}
