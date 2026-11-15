// Smoke test in a real (headless) browser: every page of the site opens without a script error, and a short design
// session works (the wizard flies a maneuver, the engine window opens and applies an engine). It catches what the two
// Node test files cannot see: load order, a global used before its file has loaded, a typo on a path the page takes
// as it starts. Playwright is not a dependency of the site: CI installs it outside the repository
// (.github/workflows/test.yml); locally install it in a folder of your own and point to it:
//   npm i --prefix /tmp/pw playwright@1.49.1 && npx --prefix /tmp/pw playwright install chromium
//   PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright node tests/smoke.js
// (playwright-core works too.) A page fails on any uncaught exception (pageerror) or console error; network errors of
// the outside resources (Google Fonts) are ignored, the site's own requests must all succeed.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), WAIT = +(process.env.SMOKE_WAIT || 5000);
function loadPw() {
  for (const m of [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean)) { try { return require(m); } catch (e) { /* next */ } }
  console.error('Playwright not found: set PLAYWRIGHT_MODULE (see the head of tests/smoke.js).'); process.exit(2);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain', '.webm': 'audio/webm', '.mp3': 'audio/mpeg' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      let p = path.normalize(path.join(ROOT, decodeURIComponent(q.url.split('?')[0])));
      if (!p.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      fs.readFile(p, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); r.end(b); });
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}
const outside = url => /^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(url || '');
// collect what goes wrong on a page
function watch(page, errs) {
  page.on('pageerror', e => errs.push('pageerror: ' + (e && e.stack || e)));
  page.on('console', m => { if (m.type() === 'error' && !outside(m.location() && m.location().url)) errs.push('console: ' + m.text() + (m.location() && m.location().url ? ' @ ' + m.location().url : '')); });
  page.on('requestfailed', q => { if (!outside(q.url())) errs.push('request failed: ' + q.url() + ' ' + (q.failure() && q.failure().errorText)); });
  page.on('response', r => { if (r.status() >= 400 && !outside(r.url())) errs.push('HTTP ' + r.status() + ': ' + r.url()); });
}
(async () => {
  const pw = loadPw(), srv = await serve(), base = 'http://127.0.0.1:' + srv.address().port + '/';
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(f)).sort();
  const browser = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  let failed = 0;
  // a failure is also a GitHub Actions annotation (readable without the job's log)
  const report = (name, errs) => {
    if (!errs.length) { console.log('✓ ' + name); return; }
    failed++; console.error(`✗ ${name}\n  ` + errs.join('\n  '));
    if (process.env.GITHUB_ACTIONS) for (const e of errs.slice(0, 8)) console.log(`::error title=smoke ${name.replace(/[:,]/g, ' ')}::${String(e).replace(/\r?\n/g, ' ').slice(0, 400)}`);
  };
  for (const [vw, label] of [[{ width: 1280, height: 800 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
    for (const f of pages) {
      const ctx = await browser.newContext({ viewport: vw, deviceScaleFactor: 1 }), page = await ctx.newPage(), errs = [];
      watch(page, errs);
      await page.goto(base + f, { waitUntil: 'load' }).catch(e => errs.push('goto: ' + e.message));
      await page.waitForTimeout(WAIT);
      report(`${f} (${label})`, errs);
      await ctx.close();
    }
  }
  // a short design session: the wizard flies a maneuver (Earth 600 → 1300 km), the engine window opens on a ready-made
  // engine and applies it (the finite burns fly on it), the result card lists the burns; then the craft up close (the
  // button, the cutaway, Esc, A, double clicks) and the engine window's cutaway
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }), page = await ctx.newPage(), errs = [];
    watch(page, errs);
    const step = async (what, fn) => { try { await fn(); } catch (e) { errs.push(what + ': ' + e.message.split('\n')[0]); } };
    await page.goto(base + 'index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await step('close the start screen', async () => { if (await page.isVisible('#start')) await page.keyboard.press('Escape'); await page.waitForSelector('#start', { state: 'hidden', timeout: 5000 }); });
    await step('open the mission window', async () => { if (!(await page.isVisible('#wzPick')) && !(await page.isVisible('#wzForm'))) await page.click('.rail [data-win="mission"]'); await page.waitForSelector('#wzPick .wiz-card[data-path="orbit"]', { state: 'visible', timeout: 5000 }); });
    await step('the wizard: change an orbit', () => page.click('#wzPick .wiz-card[data-path="orbit"]'));
    await step('an example', () => page.click('#wzEx [data-ex="e600"]'));
    await step('start the mission', () => page.click('#wzGo'));
    await step('the result card', async () => { await page.waitForSelector('#wzRes .wr-big', { state: 'visible', timeout: 15000 }); });
    await step('open the engine window', async () => { await page.click('.rail [data-win="engine"]'); await page.waitForSelector('#w-engine:not([hidden])', { timeout: 5000 }); });
    await step('a ready-made engine', async () => { await page.selectOption('#engPre', 'p:s400'); const t = await page.textContent('#engOut'); if (!/kg\/s/.test(t)) throw new Error('no figures: ' + t); });
    await step('apply it', async () => { await page.click('#engApply'); await page.waitForFunction(() => typeof MAN === "object" && MAN && MAN.res && !MAN.busy && simR && simR.burns && simR.burns.every(b => b.tau1 != null), null, { timeout: 30000 }); });
    await step('the engine in the results', async () => { await page.waitForFunction(() => /S400/.test(document.querySelector('#res').textContent), null, { timeout: 5000 }); });
    // the craft up close (Phase 18b): the button, the cutaway, Esc and A, a double click on the craft and on empty space
    const appr = () => page.evaluate(() => APPR.on), cut = () => page.evaluate(() => CRAFT.cut);
    // paused (the play button): the craft stays where the double clicks aim
    await step('pause', async () => { if (await page.evaluate(() => S.playing)) await page.click('#play'); });
    const open0 = await page.evaluate(() => ['mission', 'results'].filter(id => WINS[id].open && !WINS[id].collapsed));
    await step('approach the craft (button)', async () => { await page.click('#apprBtn'); if (!(await appr())) throw new Error('not approached'); });
    // 2026-11-15: the craft in the middle of the free area (windows and bars aside), the mission's windows folded
    await step('the craft in the middle of the free area', async () => {
      await page.waitForTimeout(1400);
      const q = await page.evaluate(() => { const h = HITS.find(q => q.kind === 'c'), b = apprBox(); return { h: h && [h.x, h.y], b, fold: ['mission', 'results'].filter(id => WINS[id].open && !WINS[id].collapsed) }; });
      if (!q.h) throw new Error('the craft is not on screen');
      const dx = Math.abs(q.h[0] - q.b.x) / q.b.w, dy = Math.abs(q.h[1] - q.b.y) / q.b.h;
      if (dx > 0.06 || dy > 0.06) throw new Error(`the craft at ${q.h.map(Math.round)}, the free area's middle at ${[q.b.x, q.b.y].map(Math.round)} (${Math.round(q.b.w)} × ${Math.round(q.b.h)})`);
      if (q.fold.length) throw new Error('still unfolded: ' + q.fold.join(', '));
    });
    await step('the cutaway', async () => { await page.click('#cutBtn'); if (!(await cut())) throw new Error('no cutaway'); await page.waitForTimeout(800); await page.click('#cutBtn'); });
    await step('Esc goes back', async () => {
      await page.click('#cv', { position: { x: 5, y: 5 } }).catch(() => {}); await page.keyboard.press('Escape'); if (await appr()) throw new Error('still close');
      const back = await page.evaluate(ids => ids.filter(id => !(WINS[id].open && !WINS[id].collapsed)), open0);
      if (back.length) throw new Error('not unfolded again: ' + back.join(', '));
    });
    await step('the A key', async () => { await page.keyboard.press('a'); if (!(await appr())) throw new Error('A did not approach'); await page.keyboard.press('a'); if (await appr()) throw new Error('A did not go back'); });
    await step('double click on the craft', async () => {
      // the windows close (their rail buttons): nothing over the plot but the readout
      for (const w of ['engine', 'mission', 'results']) if (await page.evaluate(id => winShown(id), w)) await page.click('.rail [data-win="' + w + '"]');
      // a double click on empty space fits the whole mission (the craft on screen), then wait for the craft to be clear of
      // anything (it moves: behind the planet for a while)
      const e0 = await page.evaluate(() => { const r = document.querySelector('#cv').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height * 0.4 }; });
      await page.mouse.dblclick(e0.x, e0.y); await page.waitForTimeout(1200);
      const where = () => page.evaluate(() => { const h = HITS.find(q => q.kind === 'c'), cv = document.querySelector('#cv'), r = cv.getBoundingClientRect(); if (!h) return null; const x = r.left + h.x, y = r.top + h.y; return document.elementFromPoint(x, y) === cv ? { x, y } : null; });
      let p = null; for (let i = 0; i < 40 && !(p = await where()); i++) await page.waitForTimeout(250);
      if (!p) throw new Error('the craft is not on screen'); await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(300);
      if (!(await appr())) throw new Error('the double click did not approach');
    });
    await step('double click on empty space', async () => {
      await page.waitForTimeout(500);
      // a point with nothing under it: no body, not the craft, not its path, not a window (the path crosses the close view)
      const p = await page.evaluate(() => {
        const cv = document.querySelector('#cv'), r = cv.getBoundingClientRect();
        for (const fy of [0.15, 0.3, 0.5, 0.7, 0.85]) for (const fx of [0.08, 0.25, 0.75, 0.92]) {
          const x = r.width * fx, y = r.height * fy;
          if (!hitAt(x, y, 24) && !pathHit(x, y, 24) && document.elementFromPoint(r.left + x, r.top + y) === cv) return { x: r.left + x, y: r.top + y };
        }
        return null;
      });
      if (!p) throw new Error('no empty point on screen');
      await page.mouse.dblclick(p.x, p.y); await page.waitForTimeout(300);
      if (await appr()) throw new Error('still close after a double click on empty space');
    });
    await step('the nose along the velocity in the departure burn (Earth → Mars)', async () => {
      const a = await page.evaluate(async () => {
        sceneEnd(true); loadScenario('r_e_mars'); S.playing = false; setPlayIcon(); await new Promise(r => setTimeout(r, 600));
        const f = engFires()[0], t = (f.a + f.b) / 2; S.u = tToU(t); slowJump(); await new Promise(r => setTimeout(r, 300));
        const craft = posAtTime(t, [0, 0, 0]), ax = craftAxis(t, craft, false, engNow(t));
        states(sys, S.M.t0 * DAY + t, SPo, SVo); const b = domBody(sys, SPo, craft[0], craft[1], craft[2]), i = segAtTime(t), v = hermV(i, clamp((t - simR.t[i]) / (simR.t[i + 1] - simR.t[i]), 0, 1), [0, 0, 0]);
        const w = [v[0] - SVo[3 * b], v[1] - SVo[3 * b + 1], v[2] - SVo[3 * b + 2]], l = Math.hypot(...w);
        return Math.acos(Math.min(1, (ax[0] * w[0] + ax[1] * w[1] + ax[2] * w[2]) / l)) * 180 / Math.PI;
      });
      if (!(a < 5)) throw new Error('nose ' + a.toFixed(1) + '° off the velocity');
    });
    // the playback speed (2026-11-15): real time runs with the wall clock and turns the slow motion off (faint), another
    // speed brings it back; 20× picked during a long burn holds for it
    await step('the speed: real time, and 20× during a burn', async () => {
      const r = await page.evaluate(async () => {
        const sl = ms => new Promise(r => setTimeout(r, ms));
        sceneEnd(true); loadScenario('mv_gto'); S.playing = false; setPlayIcon();
        for (let i = 0; i < 300 && !(MAN.res && !MAN.busy && engFires()); i++) await sl(100);
        const sp = document.querySelector('#speed'), pick = v => { sp.value = v; sp.dispatchEvent(new Event('change')); };
        S.u = tToU(60); slowJump(); pick('r1');
        const off = document.querySelector('#slow').disabled && !S.slow;
        const t0 = uToT(S.u), w0 = performance.now(); S.playing = true; setPlayIcon(); await sl(2000);
        const real = (uToT(S.u) - t0) / ((performance.now() - w0) / 1000); S.playing = false; setPlayIcon();
        pick('1'); const back = !document.querySelector('#slow').disabled && S.slow === SLOW.keep;
        const f = engFires()[0]; S.u = tToU(f.a + 30); slowJump(); pick('r20');
        S.playing = true; setPlayIcon(); await sl(400); S.playing = false; setPlayIcon();
        return { off, real, back, on: slowOn(), rate: SLOW.rate, over: !!SLOW.over, tag: document.querySelector('#slowTag').textContent };
      });
      if (!r.off) throw new Error('real time left the slow motion on');
      if (!(Math.abs(r.real - 1) < 0.15)) throw new Error('real time ran at ' + r.real.toFixed(3) + '×');
      if (!r.back) throw new Error('the slow motion did not come back');
      if (r.on && !(r.over && Math.abs(r.rate - 20) < 1e-6 && /20× gerçek zaman/.test(r.tag))) throw new Error(`20× during the burn: ${r.rate} · ${r.tag}`);
    });
    await step('free flight: enter from the mission, warp, exit (Phase 19b)', async () => {
      await page.evaluate(async () => { sceneEnd(true); loadScenario('mv_leo_geo'); S.playing = false; setPlayIcon(); await new Promise(r => setTimeout(r, 600)); S.u = tToU(600); slowJump(); });
      await page.waitForTimeout(300); await page.click('#flyGo'); await page.waitForTimeout(400);
      const t0 = await page.evaluate(() => FREE.on && FREE.st.t); if (!t0) throw new Error('not in free flight');
      await page.click('#flyWarp [data-w="1000"]'); await page.waitForTimeout(1200);
      const r = await page.evaluate(() => ({ dt: FREE.st.t, segs: FREE.pred ? FREE.pred.segs.length : 0 }));
      if (!(r.dt - t0 > 200) || !(r.segs > 0)) throw new Error('the flight did not advance or predict: ' + JSON.stringify(r));
      await page.click('#flyExit'); await page.waitForTimeout(300);
      if (await page.evaluate(() => FREE.on || MAP.on)) throw new Error('still flying after Çık');
    });
    await step('the cutaway in the engine window plays', async () => { await page.click('.rail [data-win="engine"]'); await page.click('#engPlay'); await page.waitForTimeout(1500); const w = await page.evaluate(() => document.querySelector('#engSch').width); if (!(w > 0)) throw new Error('no cutaway drawn'); });
    await page.waitForTimeout(1000);
    report('index.html: wizard maneuver + engine window', errs);
    await ctx.close();
  }
  await browser.close(); srv.close();
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nOK — smoke test passed');
})().catch(e => { console.error(e); process.exit(1); });
