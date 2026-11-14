// Sound on the simulator page (2026-11-15; classic script, before app.js: it only defines and binds its own controls;
// app.js calls simAudioTick each frame). No files: a quiet space hum (brown noise under a low-pass, a few low partials,
// a slow swell) and an engine rumble while the craft fires near the camera (brown noise through two low-passes and a
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
function saStart() {
  if (SA.ctx || !SA.set.on) return;
  let c; try { c = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  SA.ctx = c; SA.out = c.createGain(); SA.out.gain.value = 0; SA.out.connect(c.destination);
  const buf = saNoise(c);
  // the hum
  const hum = c.createGain(); hum.gain.value = 0.55; hum.connect(SA.out);
  const ns = c.createBufferSource(), lp = c.createBiquadFilter(); ns.buffer = buf; ns.loop = true; lp.type = 'lowpass'; lp.frequency.value = 170;
  ns.connect(lp); lp.connect(hum); ns.start();
  for (const [f, a] of [[48, 0.12], [96, 0.04]]) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.value = a; o.connect(g); g.connect(hum); o.start(); }
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.05; lg.gain.value = 0.15; lfo.connect(lg); lg.connect(hum.gain); lfo.start();
  SA.hum = hum;
  // the engine rumble: low-passed noise and a low band, its gain set per frame
  const eg = c.createGain(); eg.gain.value = 0; eg.connect(SA.out);
  const es = c.createBufferSource(), l1 = c.createBiquadFilter(), l2 = c.createBiquadFilter(), bp = c.createBiquadFilter(), bg = c.createGain();
  es.buffer = buf; es.loop = true; es.playbackRate.value = 0.8; l1.type = l2.type = 'lowpass'; l1.frequency.value = 220; l2.frequency.value = 140; l1.Q.value = 0.9;
  bp.type = 'bandpass'; bp.frequency.value = 55; bp.Q.value = 1.4; bg.gain.value = 1.6;
  es.connect(l1); l1.connect(l2); l2.connect(eg); es.connect(bp); bp.connect(bg); bg.connect(eg); es.start();
  SA.eng = eg;
  saApply();
}
// the settings into the graph: the master level (the volume, a quiet start), the hum on with the sound
function saApply() {
  const s = SA.set;
  saEl('sndBtn').setAttribute('aria-pressed', String(s.on)); saEl('sndBtn').classList.toggle('off', !s.on);
  saEl('sndOn').checked = s.on; saEl('sndVol').value = Math.round(s.vol * 100); saEl('sndEng').checked = s.eng;
  if (!SA.ctx) return;
  const t = SA.ctx.currentTime;
  SA.out.gain.setTargetAtTime(s.on ? 0.5 * s.vol * s.vol : 0, t, 0.4);
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
document.addEventListener('visibilitychange', () => { if (!SA.ctx) return; if (document.hidden) SA.ctx.suspend(); else if (SA.set.on) SA.ctx.resume(); });
// the controls: the speaker button opens a small panel (on, volume, the engine effect)
function sndPop(open = saEl('sndPop').hidden) { saEl('sndPop').hidden = !open; saEl('sndBtn').setAttribute('aria-expanded', String(open)); }
saEl('sndBtn').addEventListener('click', () => sndPop());
document.addEventListener('pointerdown', e => { if (!saEl('sndPop').hidden && !e.target.closest('#sndPop, #sndBtn')) sndPop(false); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !saEl('sndPop').hidden) { sndPop(false); saEl('sndBtn').focus(); } });
saEl('sndOn').addEventListener('change', e => { SA.set.on = e.target.checked; saSave(); if (SA.set.on) saStart(); });
saEl('sndVol').addEventListener('input', e => { SA.set.vol = Math.max(0, Math.min(1, +e.target.value / 100)); saSave(); });
saEl('sndEng').addEventListener('change', e => { SA.set.eng = e.target.checked; saSave(); });
saApply();
