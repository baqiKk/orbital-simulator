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
  const report = (name, errs) => { if (errs.length) { failed++; console.error(`✗ ${name}\n  ` + errs.join('\n  ')); } else console.log('✓ ' + name); };
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
  // engine and applies it (the finite burns fly on it), the result card lists the burns
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
    await page.waitForTimeout(1000);
    report('index.html: wizard maneuver + engine window', errs);
    await ctx.close();
  }
  await browser.close(); srv.close();
  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nOK — smoke test passed');
})().catch(e => { console.error(e); process.exit(1); });
