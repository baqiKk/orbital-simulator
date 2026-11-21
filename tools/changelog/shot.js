// The release notes' picture (Phase 20A-8): a screenshot of the site itself, made reproducible. Playwright stays out of
// the repository (PLAYWRIGHT_MODULE=<folder>/node_modules/playwright, as tests/smoke.js); the site is served by any
// static server. Usage: node tools/changelog/shot.js <url of index.html> <out.jpg>  (default: http://localhost:8765/, img/changelog/0.9.jpg)
// v0.9: free flight from the start card (the Earth, 400 km), the close view, the engine at full throttle; the interface
// hidden but the view, the stage only (the rail left out), 1040 × 585 CSS px at 1.5×, JPEG quality 80.
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const url = process.argv[2] || 'http://localhost:8765/', out = process.argv[3] || path.join(__dirname, '../../img/changelog/0.9.jpg');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1040, height: 585 }, deviceScaleFactor: 1.5 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#startCards [data-go="fly"]', { state: 'visible' });
  await page.click('#startCards [data-go="fly"]'); await page.click('#startFlyPick .fly-b[data-k="earth"]');
  await page.waitForFunction(() => FREE.on && FREE.tb >= 0);
  await page.evaluate(() => { flyAppr(true); FREE.fast = true; });
  await page.waitForFunction(() => FREE.appr && !FREE.aim, null, { timeout: 15000 });
  await page.evaluate(() => flyThr(1));
  await page.waitForFunction(() => FREE.pl > 0.95, null, { timeout: 20000 });
  await page.addStyleTag({ content: '.rail,#ctrls,#flyNode,#engPanel,#missionTag,#flyHelp,#modeChip,#hudBot,#caption,#liveBar,#notesToast,#apprTip,#focusTag{visibility:hidden!important}' });
  await page.waitForTimeout(1500);
  const clip = await page.evaluate(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  await page.screenshot({ path: out, type: 'jpeg', quality: 80, clip });
  await browser.close();
  console.log('wrote', out);
})().catch(e => { console.error(e); process.exit(1); });
