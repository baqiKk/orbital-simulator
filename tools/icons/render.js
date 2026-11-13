// Site icons: the PNGs from favicon.svg and favicon-kabin.svg (the SVGs are the sources, drawn by hand). Playwright is
// not a dependency of the site: install playwright-core (and a WebKit) in a folder outside the repository and run this
// from there, see README.md. Writes into the repository root; with a second argument, also a preview sheet (16, 32 and
// 180 px on a dark and a light tab, the small ones magnified with their pixels kept) into that folder.
//   node render.js <repo> [preview-dir]
const { webkit } = require('playwright-core');
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const repo = path.resolve(process.argv[2] || '.'), prev = process.argv[3] ? path.resolve(process.argv[3]) : null;
const TILE = '#0b1116'; // the icons' own rounded tile (favicon.svg)
// [source, size px, output, solid background (none: transparent), art's share of the size]
// apple-touch-icon: opaque and full bleed on the tile's colour (iOS rounds the corners itself); icon-192/512 (manifest,
// "any maskable"): on the tile's colour, the orbit's ends inside the safe circle (40 % of the size from the centre)
const JOBS = [
  ['favicon.svg', 32, 'favicon-32.png'],
  ['favicon.svg', 180, 'apple-touch-icon.png', TILE, 1],
  ['favicon.svg', 192, 'icon-192.png', TILE, 0.88],
  ['favicon.svg', 512, 'icon-512.png', TILE, 0.88],
  ['favicon-kabin.svg', 32, 'favicon-kabin-32.png'],
  ['favicon-kabin.svg', 180, 'apple-touch-icon-kabin.png', TILE, 1],
];
(async () => {
  const b = await webkit.launch(), page = await b.newPage({ deviceScaleFactor: 1 });
  const tmp = path.join(prev || require('os').tmpdir(), '_icons.html');
  const show = async html => { fs.writeFileSync(tmp, '<!doctype html><meta charset="utf-8">' + html); await page.goto(pathToFileURL(tmp).href); };
  // the SVG as an image (its own size media queries apply), at size px on the background
  async function png(src, size, out, bg, k = 1) {
    const a = Math.round(size * k), o = (size - a) / 2;
    await page.setViewportSize({ width: size, height: size });
    await show(`<body style="margin:0;background:${bg || 'transparent'}"><img src="${pathToFileURL(path.join(repo, src)).href}" width="${a}" height="${a}" style="position:absolute;left:${o}px;top:${o}px">`);
    await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
    await page.screenshot({ path: out, omitBackground: !bg, clip: { x: 0, y: 0, width: size, height: size } });
  }
  for (const [src, size, out, bg, k] of JOBS) { await png(src, size, path.join(repo, out), bg, k); console.log(out); }
  if (prev) {
    const rows = [];
    for (const src of ['favicon.svg', 'favicon-kabin.svg']) {
      const cells = [];
      for (const s of [16, 32, 180]) { const f = path.join(prev, `p${s}.png`); await png(src, s, f, s === 180 ? TILE : null, 1); cells.push([s, fs.readFileSync(f).toString('base64')]); }
      rows.push(['#202124', '#f1f3f4'].map(bg => cells.map(([s, d]) => `<div style="background:${bg};padding:12px;display:flex;gap:12px;align-items:center"><img src="data:image/png;base64,${d}" style="width:${s < 100 ? s * 4 : s}px;image-rendering:pixelated"><span style="font:12px sans-serif;color:${bg === '#202124' ? '#ddd' : '#333'}">${s} px${s < 100 ? ' (×4)' : ''}</span></div>`).join('')).join(''));
    }
    await page.setViewportSize({ width: 1300, height: 420 });
    await show(`<body style="margin:0;background:#888">${rows.map(r => `<div style="display:flex">${r}</div>`).join('')}`);
    await page.screenshot({ path: path.join(prev, 'icons-preview.png'), fullPage: true });
    console.log(path.join(prev, 'icons-preview.png'));
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
