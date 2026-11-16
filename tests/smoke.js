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
    const step = async (what, fn) => { try { await fn(); } catch (e) { errs.push(what + ': ' + e.message.split('\n').slice(0, 6).join(' | ')); } };
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
      if (!(await page.isVisible('#flyTip')) || !(await page.isVisible('#flyHow'))) throw new Error('no hints the first time, or no "Nasıl uçulur?"');
      await page.click('#flyTipSkip'); if (await page.isVisible('#flyTip')) throw new Error('the hints did not skip');
      // Phase 19c: a click on the path puts a node, its prograde handle dragged gives it Δv, the N-body refinement comes
      // back (solid path), U undoes the drag and then the node
      await page.click('#flyWarp [data-w="1"]');
      const at = await page.evaluate(() => { const g = FREE.pred.segs[0], k = Math.floor(g.n / 4); states(mapSys, FREE.st.t, MP, MV); const P = flyScr(g.b, g.pts[3 * k], g.pts[3 * k + 1], g.pts[3 * k + 2], is3d()), r = document.querySelector('#cv').getBoundingClientRect(); return P && { x: r.left + P[0], y: r.top + P[1] }; });
      if (!at) throw new Error('the path is not on screen');
      await page.mouse.click(at.x, at.y); await page.waitForTimeout(300);
      const hd = await page.evaluate(() => { const r = document.querySelector('#cv').getBoundingClientRect(), h = FREE.hnd.find(q => q.k === 0 && q.s === 1); return FREE.nodes.length === 1 && h && { x: r.left + h.x, y: r.top + h.y, ux: h.ux, uy: h.uy }; });
      if (!hd) throw new Error('no node with handles after a click on the path');
      await page.mouse.move(hd.x, hd.y); await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(hd.x + hd.ux * 10 * i, hd.y + hd.uy * 10 * i);
      const mid = await page.evaluate(() => ({ dv: FREE.nodes[0].d[0], prov: flyPath().prov })); await page.mouse.up();
      if (!(mid.dv > 50) || !mid.prov) throw new Error(`the drag: ${JSON.stringify(mid)}`);
      await page.waitForFunction(() => FREE.ref && FREE.ref.ver === FREE.ver && !flyPath().prov, null, { timeout: 10000 });
      await page.keyboard.press('u'); await page.keyboard.press('u');
      if (await page.evaluate(() => FREE.nodes.length)) throw new Error('U did not undo the node');
      // 2026-11-16: a node's mark slid along the orbit: its time moves on, its Δv stays, the path follows (dashed) while it moves
      const t7 = await page.evaluate(() => { const g = FREE.pred.segs[0], t = g.ts[Math.floor(g.n / 5)]; flyEdit(); FREE.nodes.push({ t, d: [120, 0, 0] }); FREE.sel = 0; flyChanged(); return t; });
      await page.waitForTimeout(600);
      const way7 = await page.evaluate(() => {
        const s = FREE.st, g = flyPredict(mapSys, s.t, s.r, s.v, { revs: 1, T: 30 * DAY, K: 160, nodes: [], maxSeg: 10 }).segs[0], r = document.querySelector('#cv').getBoundingClientRect(), m = FREE.nmk[0];
        states(mapSys, s.t, MP, MV); const k0 = g.ts.findIndex(t => t >= FREE.nodes[0].t), pts = [];
        for (let i = 1; i <= 12; i++) { const k = Math.min(g.n - 1, k0 + Math.floor(g.n * 0.015 * i)), P = flyScr(g.b, g.pts[3 * k], g.pts[3 * k + 1], g.pts[3 * k + 2], is3d()); if (P) pts.push({ x: r.left + P[0], y: r.top + P[1] }); }
        return m && { x: r.left + m.x, y: r.top + m.y, pts };
      });
      if (!way7 || way7.pts.length < 6) throw new Error('the node mark or the path is not on screen');
      await page.mouse.move(way7.x, way7.y); await page.mouse.down();
      let prov7 = false; for (const p of way7.pts) { await page.mouse.move(p.x, p.y); await page.waitForTimeout(30); prov7 = prov7 || await page.evaluate(() => flyPath().prov && !!FREE.drag); }
      await page.mouse.up(); await page.waitForTimeout(300);
      const r7 = await page.evaluate(() => ({ t: FREE.nodes[0] && FREE.nodes[0].t, d: FREE.nodes[0] && FREE.nodes[0].d.join(','), n: FREE.nodes.length }));
      if (!(r7.t > t7 + 60) || r7.d !== '120,0,0' || r7.n !== 1 || !prov7) throw new Error('the node slid along the orbit: ' + JSON.stringify({ ...r7, t7, prov7 }));
      await page.evaluate(() => { FREE.nodes = []; FREE.sel = -1; flyChanged(); });
      // Phase 19d: a prograde node fired by "Otomatik ateşle" after "Düğüme hızlandır": the orbit the node promised; the
      // engine panel; a double click on the craft comes close (the 3D model drawn), Esc goes back
      const node = await page.evaluate(async () => {
        const sl = ms => new Promise(r => setTimeout(r, ms));
        const g = FREE.pred.segs[0], t = g.ts[Math.floor(g.n / 3)];
        flyEdit(); FREE.nodes.push({ t, d: [150, 0, 0] }); FREE.sel = 0; flyChanged(); await sl(400);
        const want = flyAfterOrbit(0);
        document.querySelector('#fnWarp').click();
        for (let i = 0; i < 300 && FREE.warpTo != null; i++) await sl(50);
        flyWarp(10);
        let fired = false; for (let i = 0; i < 600; i++) { await sl(50); if (FREE.burn) fired = true; if (fired && !FREE.burn) break; }
        const b = FREE.tb, Pp = mapSys.P, Vv = mapSys.V; states(mapSys, FREE.st.t, Pp, Vv);
        const el = rv2el(mapSys.mu[b], [0, 1, 2].map(j => FREE.st.r[j] - Pp[3 * b + j]), [0, 1, 2].map(j => FREE.st.v[j] - Vv[3 * b + j]));
        return { fired, left: FREE.nodes.length, want: want && want.ap, ap: el.a * (1 + el.e) - mapSys.R[b], panel: !document.querySelector('#engPanel').hidden };
      });
      if (!node.fired || node.left || !(Math.abs(node.ap - node.want) < 20e3) || !node.panel) throw new Error('auto fire: ' + JSON.stringify(node));
      await page.click('#flyWarp [data-w="1"]');
      const cp = await page.evaluate(() => { const r = document.querySelector('#cv').getBoundingClientRect(); return { x: r.left + FREE.cx, y: r.top + FREE.cy }; });
      await page.mouse.dblclick(cp.x, cp.y); await page.waitForTimeout(1500);
      const ap = await page.evaluate(() => ({ appr: FREE.appr, lpx: FREE.lpx || 0, v3: is3d() }));
      if (!ap.appr || (ap.v3 && !(ap.lpx > 100))) throw new Error('free flight, the craft up close: ' + JSON.stringify(ap));
      await page.keyboard.press('Escape'); if (await page.evaluate(() => FREE.appr)) throw new Error('Esc did not go back');
      // Phase 19e: the Moon as the target, its transfer window from the worker, its node laid: the path meets the Moon
      const win = await page.evaluate(async () => {
        const sl = ms => new Promise(r => setTimeout(r, ms));
        FREE.nodes = []; FREE.sel = -1; flyChanged();
        const sel = document.querySelector('#fnTgt'); sel.value = String(MAPK.indexOf('moon')); sel.dispatchEvent(new Event('change'));
        document.querySelector('#fnWin').click(); for (let i = 0; i < 300 && FREE.winBusy; i++) await sl(50);
        const ok = !document.querySelector('#fnWinGo').hidden; document.querySelector('#fnWinGo').click(); FREE.tcaAt = 0; await sl(2200);
        return { ok, nodes: FREE.nodes.length, soi: !!(FREE.tca && FREE.tca.soi), info: document.querySelector('#fnTgtInfo').textContent };
      });
      if (!win.ok || win.nodes !== 1 || !win.soi) throw new Error('the transfer window to the Moon: ' + JSON.stringify(win));
      // fly it (warp to the node, auto fire): a correction is suggested by itself; laid, the pass is within ±20 km of 100 km
      const cor = await page.evaluate(async () => {
        const sl = ms => new Promise(r => setTimeout(r, ms));
        document.querySelector('#fnWarp').click(); for (let i = 0; i < 400 && FREE.warpTo != null; i++) await sl(50);
        flyWarp(10); let f = false; for (let i = 0; i < 600; i++) { await sl(50); if (FREE.burn) f = true; if (f && !FREE.burn) break; }
        flyWarp(1); FREE.tcaAt = 0; FREE.tcaDirty = true;
        for (let i = 0; i < 150 && !(FREE.cor && (FREE.cor.node || FREE.cor.error)); i++) await sl(100);
        const info = document.querySelector('#fnCorInfo').textContent;
        if (!document.querySelector('#fnCorGo').hidden) document.querySelector('#fnCorGo').click();
        await sl(300); FREE.tcaAt = 0; FREE.tcaDirty = true; await sl(2000);
        return { f, info, alt: FREE.tca && FREE.tca.soi ? FREE.tca.alt : null };
      });
      if (!cor.f || cor.alt == null || Math.abs(cor.alt - 100e3) > 20e3) throw new Error('the course correction: ' + JSON.stringify(cor));
      await page.evaluate(() => { FREE.nodes = []; FREE.sel = -1; flyChanged(); });
      // 2026-11-16: the engine changed in flight (the panel's picker, then the engine window's button): the same moment,
      // place and velocity, the new engine full, a notice; the mission is not touched and no new one starts
      const eng = await page.evaluate(async () => {
        const sl = ms => new Promise(r => setTimeout(r, ms));
        FREE.paused = true; flyBarSync(); await sl(100);
        const s0 = { t: FREE.st.t, r: [...FREE.st.r], v: [...FREE.st.v] }, M0 = S.M, E0 = S.M.eng, same = () => FREE.st.t === s0.t && FREE.st.r.every((x, j) => x === s0.r[j]) && FREE.st.v.every((x, j) => x === s0.v[j]);
        const sel = document.querySelector('#fnEng'), mono = 'p:' + ENGINES.find(e => e.type === 'mono').id;
        sel.value = mono; sel.dispatchEvent(new Event('change')); await sl(300);
        const a = { id: FREE.eng.E.id, full: FREE.st.m === FREE.eng.s.m0, same: same(), note: !document.querySelector('#flyNote').hidden, ok: FREE.eng.E.id === mono };
        sel.value = 'w'; sel.dispatchEvent(new Event('change')); await sl(300);
        const lab = document.querySelector('#engApply').textContent;
        const pre = document.querySelector('#engPre'); pre.value = 'p:rl10'; pre.dispatchEvent(new Event('change')); await sl(100);
        document.querySelector('#engApply').click(); await sl(400);
        const b = { on: FREE.on, mode: APP.mode, id: FREE.eng.E.id, same: same(), mission: S.M === M0 && S.M.eng === E0 };
        setWin('engine', { open: false }); FREE.paused = false; flyBarSync();
        return { a, lab, b };
      });
      if (!eng.a.ok || !eng.a.full || !eng.a.same || !eng.a.note || eng.lab !== 'Serbest uçuştaki araca uygula' || !eng.b.on || eng.b.mode !== 'fly' || eng.b.id !== 'p:rl10' || !eng.b.same || !eng.b.mission) throw new Error('the engine changed in flight: ' + JSON.stringify(eng));
      // 2026-11-16: a turn takes time: prograde → retrograde with the throttle up, the nose is still far from retrograde
      // a moment later, the main engine waits ("Yönleniyor…"), then fires once the nose is on it
      const turn = await page.evaluate(async () => {
        const sl = ms => new Promise(r => setTimeout(r, ms));
        flyWarp(1); FREE.eng.lock = 'pro'; flyLockSync(); for (let i = 0; i < 40 && !FREE.att.ok; i++) await sl(50);
        const retro = () => { const b = FREE.tb, V = mapSys.V; states(mapSys, FREE.st.t, mapSys.P, V); const v = [0, 1, 2].map(j => FREE.st.v[j] - V[3 * b + j]), l = Math.hypot(...v), n = FREE.att.n; return Math.acos(Math.max(-1, Math.min(1, -(n[0] * v[0] + n[1] * v[1] + n[2] * v[2]) / l))) * 180 / Math.PI; };
        document.querySelector('#fnLock [data-v="retro"]').click(); flyThr(1); await sl(500);
        const a = { off: retro(), fire: FREE.fire, att: document.querySelector('#fnAtt').textContent };
        for (let i = 0; i < 400 && !(FREE.fire > 0); i++) await sl(50);
        const b = { off: retro(), fire: FREE.fire };
        flyThr(0); FREE.eng.lock = 'pro'; flyLockSync();
        return { a, b };
      });
      if (!(turn.a.off > 120) || turn.a.fire !== 0 || !/Yönleniyor/.test(turn.a.att) || !(turn.b.fire > 0) || !(turn.b.off < 5)) throw new Error('the turn: ' + JSON.stringify(turn));
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
  // Phase 19f: free flight on a phone. "Kendin uç" on the start screen: a flight in a low Earth orbit, the node panel
  // folded to its line, the panels leave most of the screen to the view, no sideways scroll; unfolded it scrolls inside;
  // a node and a target survive a reload (the session's snapshot)
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true }), page = await ctx.newPage(), errs = [];
    watch(page, errs);
    const step = async (name, fn) => { try { await fn(); } catch (e) { errs.push(name + ': ' + (e && e.message || e)); } };
    await page.goto(base + 'index.html', { waitUntil: 'load' }).catch(e => errs.push('goto: ' + e.message));
    await page.waitForTimeout(1500);
    await step('"Kendin uç" on the start screen', async () => {
      await page.click('#startCards [data-go="fly"]'); await page.waitForTimeout(1500);
      const q = await page.evaluate(() => ({ on: FREE.on, body: MAPK[FREE.tb], fold: document.querySelector('#flyNode').classList.contains('fold') }));
      if (!q.on || q.body !== 'earth' || !q.fold) throw new Error(JSON.stringify(q));
    });
    await step('the view stays free on a phone', async () => {
      if (await page.isVisible('#flyTip')) await page.click('#flyTipSkip');
      const q = await page.evaluate(() => { const top = Math.min(...['#flyNode', '#engPanel'].map(s => document.querySelector(s)).filter(e => !e.hidden && e.getClientRects().length).map(e => e.getBoundingClientRect().top)); return { top, h: innerHeight, sw: document.documentElement.scrollWidth, w: innerWidth }; });
      if (q.sw > q.w) throw new Error('sideways scroll: ' + q.sw);
      if (q.top < q.h * 0.55) throw new Error(`the panels start at ${Math.round(q.top)} px of ${q.h}`);
    });
    await step('the node panel unfolds and scrolls inside', async () => {
      await page.click('#fnTop'); await page.waitForTimeout(300);
      const q = await page.evaluate(() => ({ fold: document.querySelector('#flyNode').classList.contains('fold'), mh: getComputedStyle(document.querySelector('#fnMain')).maxHeight, sw: document.documentElement.scrollWidth }));
      if (q.fold || q.mh === 'none' || q.sw > 390) throw new Error(JSON.stringify(q));
    });
    await step('a reload brings the flight back', async () => {
      await page.evaluate(() => { const g = FREE.pred.segs[0]; flyEdit(); FREE.nodes.push({ t: g.ts[Math.floor(g.n / 3)], d: [50, 0, 0] }); FREE.sel = 0; flyChanged(); const s = document.querySelector('#fnTgt'); s.value = String(MAPK.indexOf('moon')); s.dispatchEvent(new Event('change')); flySave(); });
      await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(2000);
      const q = await page.evaluate(() => ({ on: FREE.on, nodes: FREE.nodes.length, target: MAPK[FREE.target], eng: FREE.eng && FREE.eng.E.id }));
      if (!q.on || q.nodes !== 1 || q.target !== 'moon' || q.eng !== 'p:rl10') throw new Error(JSON.stringify(q));
    });
    await page.waitForTimeout(800);
    report('index.html: free flight on a phone', errs);
    await ctx.close();
  }
  await browser.close(); srv.close();
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nOK — smoke test passed');
})().catch(e => { console.error(e); process.exit(1); });
