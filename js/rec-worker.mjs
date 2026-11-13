// The mission recording's GIF encoder (js/record.js): a module worker around gifenc (vendor/gifenc, MIT), fetched only
// when a GIF recording starts. One global palette for the whole film (no flicker between frames): first the fixed
// colours the page sends (the theme's tokens exactly: the void, the amber path, the bodies, the labels; and ramps of the
// amber and the white toward the void for soft line edges), then up to the rest quantized from sample frames, leaving
// out the pixels a fixed colour already shows (the dark background's many shades do not eat the palette); coarser on
// request when the file must shrink (o = { fmt: 'rgb565' | 'rgb444', colors, fixed, dither }). Pixels map to their
// nearest palette colour (cached per 5-6-5 or 4-4-4 cell); with dither, an ordered 4 × 4 Bayer offset first (the same
// pattern every frame: it does not crawl). Plus one transparent entry: every frame after the first writes only what
// changed since the one before (unchanged pixels transparent, drawn over it: disposal 1). The functions are exported for
// tests/ui.test.js; in a worker they answer messages.
import { GIFEncoder, quantize } from '../vendor/gifenc/gifenc.esm.js';

const DEF = { fmt: 'rgb565', colors: 255, fixed: [], dither: false };
const NEAR = 10 * 10 * 3; // a sample pixel within this squared distance of a fixed colour is left out of the quantizing
// the 4 × 4 Bayer matrix, centred: offsets in (−0.5, 0.5); AMP: its amplitude in 0…255 levels
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5), AMP = 14;
const cellOf = (fmt, r, g, b) => (fmt === 'rgb444' ? ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4) : ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
const centre = (fmt, k) => (fmt === 'rgb444' ? [((k >> 8) << 4) + 8, (((k >> 4) & 15) << 4) + 8, ((k & 15) << 4) + 8]
  : [((k >> 11) << 3) + 4, (((k >> 5) & 63) << 2) + 2, ((k & 31) << 3) + 4]);
function nearest(pal, n, r, g, b) {
  let best = 0, bd = 1e9;
  for (let i = 0; i < n; i++) { const p = pal[i], dr = p[0] - r, dg = p[1] - g, db = p[2] - b, d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = i; } }
  return best;
}

// samples: RGBA frames (Uint8ClampedArray, any sizes); returns the palette with the transparent entry last
export function gifPalette(samples, o = DEF) {
  const fmt = o.fmt || DEF.fmt, max = Math.min(255, o.colors || 255), fixed = [], seen = new Set();
  for (const c of o.fixed || []) { const k = c.join(','); if (!seen.has(k) && fixed.length < max) { seen.add(k); fixed.push([c[0], c[1], c[2]]); } }
  // the sample pixels no fixed colour shows (decided once per colour cell)
  const near = new Uint8Array(fmt === 'rgb444' ? 4096 : 65536); // 0 unknown, 1 near a fixed colour, 2 not
  let n = 0; for (const s of samples) n += s.length;
  const rest = new Uint8ClampedArray(n); let at = 0;
  for (const s of samples) for (let i = 0; i < s.length; i += 4) {
    const r = s[i], g = s[i + 1], b = s[i + 2], k = cellOf(fmt, r, g, b);
    if (!near[k]) { const j = fixed.length ? nearest(fixed, fixed.length, r, g, b) : -1, f = j >= 0 ? fixed[j] : null; near[k] = f && (f[0] - r) ** 2 + (f[1] - g) ** 2 + (f[2] - b) ** 2 <= NEAR ? 1 : 2; }
    if (near[k] === 2) { rest[at] = r; rest[at + 1] = g; rest[at + 2] = b; rest[at + 3] = 255; at += 4; }
  }
  const room = max - fixed.length, extra = room > 0 && at >= 4 ? quantize(rest.subarray(0, at), room, { format: fmt }) : [];
  const pal = fixed.concat(extra.map(c => [c[0], c[1], c[2]]));
  if (!pal.length) pal.push([0, 0, 0]);
  return { pal: [...pal, [0, 0, 0]], clear: pal.length, fmt, fixedN: fixed.length, dither: !!o.dither };
}
// a frame's palette indices (w px wide; dither as the palette says)
export function gifIndex(p, rgba, w) {
  const fmt = p.fmt, cache = p.cache || (p.cache = new Int16Array(fmt === 'rgb444' ? 4096 : 65536).fill(-1)), n = rgba.length >> 2, out = new Uint8Array(n);
  if (!p.exact) { // the cells holding a fixed colour, and the colours
    p.exact = new Map(); p.exCell = new Uint8Array(cache.length);
    for (let m = 0; m < (p.fixedN || 0); m++) { const q = p.pal[m]; p.exact.set((q[0] << 16) | (q[1] << 8) | q[2], m); p.exCell[cellOf(fmt, q[0], q[1], q[2])] = 1; }
  }
  const ex = p.exCell;
  for (let i = 0; i < n; i++) {
    let r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2];
    if (p.dither) {
      const x = i % w, y = (i / w) | 0, d = BAYER[((y & 3) << 2) | (x & 3)] * AMP;
      r = Math.max(0, Math.min(255, Math.round(r + d))); g = Math.max(0, Math.min(255, Math.round(g + d))); b = Math.max(0, Math.min(255, Math.round(b + d)));
    }
    const k = cellOf(fmt, r, g, b);
    let j = cache[k];
    if (j < 0) { const c = centre(fmt, k); j = cache[k] = nearest(p.pal, p.clear, c[0], c[1], c[2]); }
    // an exact fixed colour (the tokens) is always itself, whatever its cell's centre is nearest to
    if (ex[k]) { const e = p.exact.get((r << 16) | (g << 8) | b); if (e !== undefined) j = e; }
    out[i] = j;
  }
  return out;
}
// a new GIF of w × h with palette p (from gifPalette); repeat 0 = loops forever
export function gifStart(w, h, p) { return { w, h, p, enc: GIFEncoder(), prev: null, n: 0 }; }
// one frame (RGBA w × h), shown for delay ms; returns the bytes written so far
export function gifFrame(g, rgba, delay) {
  const idx = gifIndex(g.p, rgba, g.w);
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
