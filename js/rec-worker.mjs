// The mission recording's GIF encoder (js/record.js): a module worker around gifenc (vendor/gifenc, MIT), fetched only
// when a GIF recording starts. One global palette (up to 255 colours, or fewer and coarser when the file must shrink:
// o = { fmt: 'rgb565' | 'rgb444', colors }; quantized once from sample frames, no dithering: steady colours, smaller
// files) plus one transparent entry; every frame after the first writes only what changed since the one before
// (unchanged pixels are transparent and the frame is drawn over it: disposal 1). The functions are exported for
// tests/ui.test.js; in a worker they answer messages.
import { GIFEncoder, quantize, applyPalette } from '../vendor/gifenc/gifenc.esm.js';

const DEF = { fmt: 'rgb565', colors: 255 };

// samples: RGBA frames (Uint8ClampedArray, any sizes); returns the palette with the transparent entry last
export function gifPalette(samples, o = DEF) {
  let n = 0; for (const s of samples) n += s.length;
  const all = new Uint8ClampedArray(n); let at = 0;
  for (const s of samples) { all.set(s, at); at += s.length; }
  const fmt = o.fmt || DEF.fmt, pal = quantize(all, Math.min(255, o.colors || 255), { format: fmt });
  return { pal: [...pal, [0, 0, 0]], clear: pal.length, fmt };
}
// a new GIF of w × h with palette p (from gifPalette); repeat 0 = loops forever
export function gifStart(w, h, p) { return { w, h, p, enc: GIFEncoder(), prev: null, n: 0 }; }
// one frame (RGBA w × h), shown for delay ms; returns the bytes written so far
export function gifFrame(g, rgba, delay) {
  const idx = applyPalette(rgba, g.p.pal.slice(0, g.p.clear), g.p.fmt);
  let out = idx;
  if (g.prev) {
    out = new Uint8Array(idx.length);
    for (let i = 0; i < idx.length; i++) out[i] = idx[i] === g.prev[i] ? g.p.clear : idx[i];
  }
  g.enc.writeFrame(out, g.w, g.h, { palette: g.n ? undefined : g.p.pal, delay, repeat: 0, transparent: !!g.prev, transparentIndex: g.p.clear, dispose: 1 });
  g.prev = idx; g.n++;
  return g.enc.bytesView().length;
}
export function gifEnd(g) { g.enc.finish(); return g.enc.bytes(); }
// size estimate from pairs of neighbouring frames [a, b]: the first frame's bytes and a following frame's (mean)
export function gifProbe(w, h, pairs, o = DEF) {
  const p = gifPalette(pairs.map(q => q[0]), o);
  let key = 0, diff = 0;
  for (const [a, b] of pairs) {
    const g = gifStart(w, h, p), k = gifFrame(g, a, 70);
    key += k; diff += gifFrame(g, b, 70) - k;
  }
  return { key: key / pairs.length, diff: diff / pairs.length, p };
}

// the worker: { cmd: 'probe' | 'start' | 'frame' | 'end', … } → { cmd, … }
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  let g = null;
  self.onmessage = e => {
    const m = e.data;
    try {
      if (m.cmd === 'probe') { const r = gifProbe(m.w, m.h, m.pairs, m.o); self.postMessage({ cmd: 'probe', key: r.key, diff: r.diff }); }
      else if (m.cmd === 'start') { g = gifStart(m.w, m.h, gifPalette(m.samples, m.o)); self.postMessage({ cmd: 'start' }); }
      else if (m.cmd === 'frame') self.postMessage({ cmd: 'frame', bytes: gifFrame(g, new Uint8ClampedArray(m.rgba), m.delay) });
      else if (m.cmd === 'end') { const b = gifEnd(g); g = null; self.postMessage({ cmd: 'end', bytes: b }, [b.buffer]); }
    } catch (err) { self.postMessage({ cmd: 'error', msg: String(err && err.message || err) }); }
  };
}
