// Sound on the simulator page (2026-11-15; classic script, after sounds.js, before app.js: it only defines and binds its
// own controls; app.js calls simAudioTick each frame). An ambience (a deep drone, or the cabin's NASA recordings) and an
// engine rumble while the craft fires near the camera (brown noise through two low-passes and a
// low band, its level the thrust times the camera's closeness, eased in and out at ignition and cut). Sound in vacuum
// is not real: the rumble is an effect and has its own switch. Web Audio starts only after the user's first gesture
// (browsers' rule), at a low level; the settings (on, volume, engine effect) saved (prefs.js parseSimAudio,
// PREF_KEYS.simAudio). Suspended while the tab is hidden; the cabin page (kabin.html) has its own sound and this page's
// stops when it is left.
const SA_LS = (() => { try { return window.localStorage; } catch (e) { return null; } })();
const SA = { ctx: null, out: null, hum: null, eng: null, set: parseSimAudio(readPref(SA_LS, PREF_KEYS.simAudio)), lvl: -1, want: 0 };
const saEl = id => document.getElementById(id);
// a looping brown-noise buffer, its ends cross-faded so the loop has no seam
function saNoise(c) {
  const sr = c.sampleRate, n = sr * 5, F = Math.round(sr * 0.4), buf = c.createBuffer(1, n, sr), x = new Float32Array(n + F);
  let br = 0;
  for (let i = 0; i < n + F; i++) { br = (br + 0.02 * (Math.random() * 2 - 1)) / 1.02; x[i] = br * 3.2; }
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = i < F ? x[i] * (i / F) + x[n + i] * (1 - i / F) : x[i];
  return buf;
}
// The ambience (2026-11-15, redone: the first hum hissed like white noise): "deep" a low drone, brown noise through
// a steep low-pass (two 12 dB stages near 110 Hz) whose cut-off a slow LFO moves between ~70 and ~150 Hz, under a few
// slightly detuned low sines and a triangle (41, 41.6, 61.5 Hz, the triangle's harmonics filtered off) breathing on a
// second slow LFO; "rec" the cabin's NASA space recordings (js/sounds.js SPACE_SND, the files the cabin plays, already
// credited), looped one after the other, quiet, over a faint drone. The engine rumble: brown noise through two
// low-passes near 80 Hz and a 45 Hz band, no hiss.
function saLow(c, f, q = 0.7) { const b = c.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; return b; }
function saStart() {
  if (SA.ctx || !SA.set.on) return;
  let c; try { c = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  SA.ctx = c; SA.out = c.createGain(); SA.out.gain.value = 0; SA.out.connect(c.destination);
  const buf = saNoise(c);
  // the drone
  const drone = c.createGain(); drone.gain.value = 0; drone.connect(SA.out); SA.drone = drone;
  const ns = c.createBufferSource(), l1 = saLow(c, 110), l2 = saLow(c, 110), ng = c.createGain(); ns.buffer = buf; ns.loop = true; ng.gain.value = 1.4;
  ns.connect(l1); l1.connect(l2); l2.connect(ng); ng.connect(drone); ns.start();
  const sweep = c.createOscillator(), sg = c.createGain(); sweep.frequency.value = 0.035; sg.gain.value = 40; sweep.connect(sg); sg.connect(l1.frequency); sg.connect(l2.frequency); sweep.start();
  const tones = c.createGain(), tl = saLow(c, 160); tones.gain.value = 0.22; tones.connect(tl); tl.connect(drone);
  for (const [f, typ, g] of [[41, 'sine', 0.5], [41.6, 'sine', 0.45], [61.5, 'triangle', 0.25]]) { const o = c.createOscillator(), og = c.createGain(); o.type = typ; o.frequency.value = f; og.gain.value = g; o.connect(og); og.connect(tones); o.start(); }
  const br = c.createOscillator(), bg = c.createGain(); br.frequency.value = 0.06; bg.gain.value = 0.08; br.connect(bg); bg.connect(tones.gain); br.start();
  // the recordings (only when chosen; streamed through a media element)
  const rec = c.createGain(); rec.gain.value = 0; rec.connect(SA.out); SA.rec = rec;
  // the engine rumble: low-passed noise and a low band, its gain set per frame
  const eg = c.createGain(); eg.gain.value = 0; eg.connect(SA.out);
  const es = c.createBufferSource(), e1 = saLow(c, 85), e2 = saLow(c, 85), bp = c.createBiquadFilter(), bgn = c.createGain(), eo = c.createGain();
  es.buffer = buf; es.loop = true; es.playbackRate.value = 0.7; bp.type = 'bandpass'; bp.frequency.value = 45; bp.Q.value = 1.2; bgn.gain.value = 1.4; eo.gain.value = 1.6;
  es.connect(e1); e1.connect(e2); e2.connect(eo); eo.connect(eg); es.connect(bp); bp.connect(bgn); bgn.connect(eg); es.start();
  SA.eng = eg;
  saApply();
}
// the recordings: one <audio> element through the graph, the list in turn (webm, else mp3)
function saRec(on) {
  if (!SA.ctx) return;
  if (on && !SA.el) {
    const el = new Audio(); el.preload = 'auto'; el.crossOrigin = 'anonymous'; SA.el = el; SA.ri = 0;
    const ext = el.canPlayType('audio/webm; codecs=opus') ? 'webm' : 'mp3', next = () => { const q = SPACE_SND[SA.ri++ % SPACE_SND.length]; el.src = 'audio/cabin/space/' + q.id + '.' + ext; el.play().catch(() => {}); };
    el.addEventListener('ended', next); SA.ctx.createMediaElementSource(el).connect(SA.rec); next();
  }
  if (SA.el) { if (on) SA.el.play().catch(() => {}); else SA.el.pause(); }
}
// the settings into the graph: the master level (the volume, a quiet start), the hum on with the sound
function saApply() {
  const s = SA.set;
  saEl('sndBtn').setAttribute('aria-pressed', String(s.on)); saEl('sndBtn').classList.toggle('off', !s.on);
  saEl('sndOn').checked = s.on; saEl('sndVol').value = Math.round(s.vol * 100); saEl('sndEng').checked = s.eng;
  for (const b of saEl('sndKind').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === s.kind));
  if (!SA.ctx) return;
  const t = SA.ctx.currentTime, rec = s.kind === 'rec';
  SA.out.gain.setTargetAtTime(s.on ? 0.5 * s.vol * s.vol : 0, t, 0.4);
  SA.drone.gain.setTargetAtTime(rec ? 0.25 : 1, t, 0.8); SA.rec.gain.setTargetAtTime(rec ? 0.35 : 0, t, 0.8);
  saRec(s.on && rec && !document.hidden);
  if (s.on && SA.ctx.state === 'suspended' && !document.hidden) SA.ctx.resume();
}
function saSave() { writePref(SA_LS, PREF_KEYS.simAudio, JSON.stringify(SA.set)); saApply(); }
// per frame: the engine's level (0 … 1: the plume's strength times the camera's closeness), eased in the audio clock
function simAudioTick(level) {
  if (!SA.eng) return;
  const v = SA.set.on && SA.set.eng ? Math.max(0, Math.min(1, level)) : 0;
  if (Math.abs(v - SA.lvl) < 0.01) return;
  SA.lvl = v; SA.eng.gain.setTargetAtTime(0.9 * v, SA.ctx.currentTime, v > 0.01 ? 0.12 : 0.18);
}
// the first gesture starts it (if on)
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, function first() { saStart(); removeEventListener('pointerdown', first, true); removeEventListener('keydown', first, true); }, true);
document.addEventListener('visibilitychange', () => { if (!SA.ctx) return; if (document.hidden) { SA.ctx.suspend(); saRec(false); } else if (SA.set.on) { SA.ctx.resume(); saRec(SA.set.kind === 'rec'); } });
// the controls: the speaker button opens a small panel (on, volume, the engine effect)
function sndPop(open = saEl('sndPop').hidden) { saEl('sndPop').hidden = !open; saEl('sndBtn').setAttribute('aria-expanded', String(open)); }
saEl('sndBtn').addEventListener('click', () => sndPop());
document.addEventListener('pointerdown', e => { if (!saEl('sndPop').hidden && !e.target.closest('#sndPop, #sndBtn')) sndPop(false); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !saEl('sndPop').hidden) { sndPop(false); saEl('sndBtn').focus(); } });
saEl('sndOn').addEventListener('change', e => { SA.set.on = e.target.checked; saSave(); if (SA.set.on) saStart(); });
saEl('sndVol').addEventListener('input', e => { SA.set.vol = Math.max(0, Math.min(1, +e.target.value / 100)); saSave(); });
saEl('sndEng').addEventListener('change', e => { SA.set.eng = e.target.checked; saSave(); });
saEl('sndKind').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; SA.set.kind = b.dataset.v; saSave(); });
saApply();
