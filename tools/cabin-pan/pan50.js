// WebKit, iPhone 13 emulation: pan the cabin's room back and forth N times (synthetic touch pointer events, as the page
// reads them) and check that no canvas is allocated or resized meanwhile (CVS from js/cabin.js, ?debug=1); then two trips
// to the glass and back (the move canvases sized once). argv: url [N] [low: 1 = the safety net's low mode]
const { webkit, devices } = require('playwright');
const [url, N = '50', low = '0'] = process.argv.slice(2);
(async () => {
  const b = await webkit.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] }), p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('crash', () => errs.push('CRASH'));
  if (low === '1') await p.addInitScript(() => { try { sessionStorage.setItem('orbsim.cab.boot', String(Date.now())); } catch (e) { /* none */ } });
  await p.goto(url); await p.waitForTimeout(12000);
  const r = await p.evaluate(async n => {
    const raf = () => new Promise(res => requestAnimationFrame(() => res()));
    const sleep = ms => new Promise(res => setTimeout(res, ms));
    const root = document.getElementById('kRoot'), y = innerHeight * 0.3, snap = () => ({ area: CVS.area, n: CVS.n, by: { ...CVS.by } });
    const ev = (t, x, tgt) => tgt.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }));
    let live = 0;
    async function drag(x0, x1) {
      ev('pointerdown', x0, root);
      for (let i = 1; i <= 12; i++) { ev('pointermove', x0 + (x1 - x0) * i / 12, window); await raf(); if (/translate3d/.test(document.getElementById('kStage').style.transform)) live++; }
      await sleep(120); ev('pointerup', x1, window);
      for (let i = 0; i < 30; i++) await raf();
    }
    const W = innerWidth, able = panAble(), range = panRange().map(v => v * deskCam().s);
    await drag(W * 0.8, W * 0.2); await drag(W * 0.2, W * 0.8); // warm up
    const s0 = snap(), xs = [];
    for (let i = 0; i < n; i++) { await drag(i % 2 ? W * 0.2 : W * 0.8, i % 2 ? W * 0.8 : W * 0.2); xs.push(PAN.x); }
    await sleep(1500); const [lo, hi] = panRange(), inRange = PAN.x >= lo - 1e-6 && PAN.x <= hi + 1e-6;
    const s1 = snap(), tf = document.getElementById('kStage').style.transform, px = Number((tf.match(/translate\(([-\d.]+)px/) || [])[1]);
    const mv = [MV.A.width, MV.A.height, MV.B.width, MV.B.height];
    // two trips to the glass and back
    const trip = async to => { go(to); for (let i = 0; i < 120 && ANIM; i++) await raf(); await sleep(300); };
    await trip('window'); await trip('desk'); const s2 = snap(); await trip('window'); await trip('desk'); const s3 = snap();
    return { inRange, able, range, low: LOWQ, crashed: CRASHED, live, moved: Math.max(...xs) - Math.min(...xs), s0, s1, tf, wholePx: Number.isFinite(px) && Math.abs(px - Math.round(px)) < 1e-6, mvDuringPans: mv,
      mvAfterTrips: [MV.A.width, MV.A.height], sky: [SP.cv.width, SP.cv.height, FV.cv.width, FV.cv.height], s2, s3, mem: memLine() };
  }, +N);
  console.log(JSON.stringify({ errs, ...r }, null, 1));
  const same = r.s1.area === r.s0.area && r.s1.n === r.s0.n && r.inRange && r.wholePx && r.live > 0;
  console.log(same ? `OK: ${N} pans, canvas allocations unchanged (${r.s0.n} resizes, ${(r.s0.area * 4 / 1048576).toFixed(1)} MB so far)` : `FAIL: allocations grew ${r.s0.n} → ${r.s1.n} resizes, ${(r.s0.area * 4 / 1048576).toFixed(1)} → ${(r.s1.area * 4 / 1048576).toFixed(1)} MB`);
  await b.close(); process.exit(same && !errs.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
