// WebKit, iPhone 13 emulation: pan the cabin's room (synthetic touch pointer events, as the page reads them) and check
// that no canvas is allocated or resized meanwhile, and nothing is laid out, sized or decoded during the pan's phases
// (CVS from js/cabin.js, ?debug=1). Runs: N slow drags back and forth; fast flings (300 px in 40 ms) into the glide;
// flings against both edges (the stretch and the spring back); N fast flings in a row, each catching the last glide;
// the viewport's height going up and down (Safari's toolbar) between flings; two trips to the glass and back (the move
// canvases sized once). Then the black box's record. argv: url [N] [low: 1 = the safety net's low mode]
const { webkit, devices } = require('playwright');
const [url, N = '50', low = '0'] = process.argv.slice(2);
(async () => {
  const b = await webkit.launch(), dev = devices['iPhone 13'], ctx = await b.newContext({ ...dev }), p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('crash', () => errs.push('CRASH'));
  if (low === '1') await p.addInitScript(() => { try { if (!sessionStorage.getItem('orbsim.cab.boot')) sessionStorage.setItem('orbsim.cab.boot', String(Date.now())); localStorage.removeItem('orbsim.cab.box.v1'); } catch (e) { /* none */ } });
  await p.goto(url); await p.waitForTimeout(12000);
  // helpers inside the page
  await p.evaluate(() => {
    const raf = () => new Promise(res => requestAnimationFrame(() => res()));
    const sleep = ms => new Promise(res => setTimeout(res, ms));
    const root = document.getElementById('kRoot'), y = innerHeight * 0.3;
    const ev = (t, x, tgt) => tgt.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
    const T = window.T = { raf, sleep, live: 0, maxDur: 0, phases: new Set() };
    T.snap = () => ({ area: CVS.area, n: CVS.n, layout: CVS.layout, place: CVS.place, life: CVS.life, decode: CVS.decode, dur: { ...CVS.dur }, by: { ...CVS.by } });
    const watch = () => { if (/translate3d/.test(document.getElementById('kStage').style.transform)) T.live++; if (PHASE) T.phases.add(PHASE); };
    // slow: 12 frames, held before letting go (no glide)
    T.drag = async (x0, x1) => {
      ev('pointerdown', x0, root);
      for (let i = 1; i <= 12; i++) { ev('pointermove', x0 + (x1 - x0) * i / 12, window); await raf(); watch(); }
      await sleep(120); ev('pointerup', x1, window);
      for (let i = 0; i < 30; i++) { await raf(); watch(); }
    };
    // fast: dx px in ms milliseconds (moves every 10 ms), let go at once (a glide); then wait frames (0: the next one catches it)
    T.fling = async (x0, dx, ms, wait) => {
      ev('pointerdown', x0, root); const k = Math.max(2, Math.round(ms / 10));
      for (let i = 1; i <= k; i++) { await sleep(10); ev('pointermove', x0 + dx * i / k, window); watch(); }
      ev('pointerup', x0 + dx, window);
      for (let i = 0; i < wait; i++) { await raf(); watch(); }
    };
    T.rest = async () => { for (let i = 0; i < 400 && (PAN.raf || PHASE); i++) { await raf(); watch(); } await sleep(200); };
  });
  const run = (f, ...a) => p.evaluate(([f, a]) => T[f](...a), [f, a]);
  const snap = () => p.evaluate(() => T.snap());
  const W = dev.viewport.width, n = +N, out = { errs };
  out.able = await p.evaluate(() => panAble());
  await run('drag', W * 0.8, W * 0.2); await run('drag', W * 0.2, W * 0.8); await run('rest'); // warm up
  const s0 = snap(), r = {};
  const step = async (name, f) => { const a = await snap(); await f(); await run('rest'); const z = await snap(); r[name] = { resizes: z.n - a.n, areaMB: +((z.area - a.area) * 4 / 1048576).toFixed(2), layout: z.layout - a.layout, place: z.place - a.place, life: z.life - a.life, decode: z.decode - a.decode, dur: Object.values(z.dur).reduce((s, v) => s + v, 0) - Object.values(a.dur).reduce((s, v) => s + v, 0) }; };
  await step(`${n} slow drags`, async () => { for (let i = 0; i < n; i++) await run('drag', i % 2 ? W * 0.2 : W * 0.8, i % 2 ? W * 0.8 : W * 0.2); });
  await step('fast flings into the glide', async () => { for (let i = 0; i < 10; i++) { await run('fling', W * 0.5, i % 2 ? 300 : -300, 40, 60); await run('rest'); } });
  await step('flings against the edges', async () => { for (let i = 0; i < 6; i++) await run('fling', W * 0.2, 300, 40, 25); await run('rest'); for (let i = 0; i < 8; i++) await run('fling', W * 0.8, -300, 40, 25); });
  await step(`${n} fast flings in a row`, async () => { for (let i = 0; i < n; i++) await run('fling', W * 0.5, i % 2 ? 300 : -300, 40, 0); });
  // where the last pan came to rest: inside the range, on a whole pixel, a 2D transform
  out.state = await p.evaluate(() => { const [lo, hi] = panRange(), tf = document.getElementById('kStage').style.transform, px = Number((tf.match(/translate\(([-\d.]+)px/) || [])[1]);
    return { inRange: PAN.x >= lo - 1e-6 && PAN.x <= hi + 1e-6, wholePx: Number.isFinite(px) && (z => Math.abs(px * z - Math.round(px * z)) < 1e-4)(STAGE_ZOOM ? STAGE_Z : 1), zoom: document.getElementById('kStage').style.zoom, tf, live: T.live, phases: [...T.phases], low: LOWQ, crashed: CRASHED, mv: [MV.A.width, MV.A.height] }; });
  // Safari's toolbar: the viewport's height down and up (the width the same), also mid-fling; the first cycle may grow
  // the canvases once, after that a height change only places again: no layout, no sizeLife, no resize
  const tool = async () => { for (const h of [dev.viewport.height - 80, dev.viewport.height]) { run('fling', W * 0.5, 300, 40, 40); await p.setViewportSize({ width: W, height: h }); await p.waitForTimeout(500); } };
  await tool(); await run('rest');
  await step('toolbar up and down ×5 mid-fling (after the first)', async () => { for (let i = 0; i < 5; i++) await tool(); });
  // at rest: placed again (place), no layout, no canvas resized
  await step('toolbar up and down ×5 at rest', async () => { for (let i = 0; i < 5; i++) for (const h of [dev.viewport.height - 80, dev.viewport.height]) { await p.setViewportSize({ width: W, height: h }); await p.waitForTimeout(500); } });
  await step('fast flings after the toolbar', async () => { for (let i = 0; i < 10; i++) await run('fling', W * 0.5, i % 2 ? 300 : -300, 40, 0); });
  const s1 = await snap();
  // turning the phone: the width changes, a full layout (it may size the canvases afresh), and back
  await step('turn the phone and back', async () => { for (const [w, h] of [[dev.viewport.height, W], [W, dev.viewport.height]]) { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(800); } });
  await step('two trips to the glass and back', async () => { for (const to of ['window', 'desk', 'window', 'desk']) { await p.evaluate(t => go(t), to); await p.waitForTimeout(1700); } });
  out.box = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('orbsim.cab.box.v1')); } catch (e) { return null; } });
  out.note = await p.evaluate(() => { const n = document.getElementById('kSafe'); return n.hidden ? null : n.innerText; });
  out.mem = await p.evaluate(() => memLine());
  console.log(JSON.stringify({ ...out, steps: r, by: s1.by }, null, 1));
  const pans = Object.entries(r).filter(([k]) => !/glass|turn/.test(k));
  const bad = pans.filter(([, v]) => v.resizes || v.areaMB || v.decode || v.dur || v.layout || v.life).map(([k]) => k);
  if (!(r['toolbar up and down ×5 at rest'].place > 0)) bad.push('the toolbar at rest did not place again');
  if (!(r['turn the phone and back'].layout >= 2)) bad.push('turning the phone did not lay out');
  const ok = !bad.length && out.state.inRange && out.state.wholePx && out.state.live > 0 && out.box && out.box.act && !errs.length;
  console.log(ok ? `OK: no canvas allocated, no layout / sizeLife / decode during any pan (${pans.map(([k]) => k).join('; ')}; the toolbar at rest placed ${r['toolbar up and down ×5 at rest'].place}× with no layout and no resize; turning laid out ${r['turn the phone and back'].layout}×)` : `FAIL: ${bad.join('; ') || 'state, black box or page errors'}`);
  await b.close(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
