// UI regression tests (no DOM): dictionary coverage and persisted preferences. Run: node tests/ui.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('../js/prefs.js');

// line endings normalised: a Windows checkout (core.autocrlf) has CRLF, the patterns below are written with \n
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const ctx = {};
vm.runInNewContext(read('js/i18n.js') + '\nthis.DICT = DICT;', ctx);
const DICT = ctx.DICT;
const has = k => typeof DICT[k] === 'string';

// 1) Every key the markup asks for exists
const html = read('index.html');
for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) assert.ok(has(m[1]), `index.html key missing from dictionary: ${m[1]}`);
// the cabin draft page too (its markup and its script's _('…') / data-tip keys)
const kab = read('kabin-taslak.html');
for (const m of kab.matchAll(/data-(?:i18n(?:-[a-z-]+)?|tip|rich)="([^"]+)"|_\('([^']+)'\)/g)) assert.ok(has(m[1] || m[2]), `kabin-taslak.html key missing from dictionary: ${m[1] || m[2]}`);
assert.ok(!/img\/planets/.test(kab), 'kabin-taslak.html asks for planet images only through globeLook()');

// 2) Every literal key in app.js / core.js exists (string literals inside a dictionary namespace, incl. ternaries)
const spaces = new Set(Object.keys(DICT).map(k => k.split('.')[0]));
for (const f of ['js/app.js', 'js/core.js', 'js/mode3d.js', 'js/globe.js', 'js/wizard.js', 'js/record.js', 'js/engine-ui.js']) {
  for (const m of read(f).matchAll(/'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)'/g)) {
    if (spaces.has(m[1].split('.')[0])) assert.ok(has(m[1]), `${f} key missing from dictionary: ${m[1]}`);
  }
}
// dynamic keys: scenario names/notes, body names (every key of js/bodies.js)
const app = read('js/app.js');
for (const m of app.matchAll(/\{ id: '(\w+)'/g)) for (const s of ['name', 'note']) assert.ok(has(`sc.${m[1]}.${s}`), `scenario text missing: sc.${m[1]}.${s}`);
const { BODIES } = require('../js/bodies.js');
for (const k of Object.keys(BODIES)) assert.ok(has('body.' + k), `body name missing: body.${k}`);
// scenario groups: every scenario names a model with a group label
for (const m of app.matchAll(/\{ id: '\w+', model: '(\w+)'/g)) assert.ok(has('sc.group.' + m[1]), `scenario group missing: sc.group.${m[1]}`);
assert.strictEqual([...app.matchAll(/\{ id: '\w+', model: /g)].length, [...app.matchAll(/\{ id: '/g)].length, 'every scenario names its model');
// body data is text-free: no body carries a display name
for (const [k, b] of Object.entries(BODIES)) assert.ok(!('name' in b), `bodies.js must not hold text: ${k}.name`);

// 3) Static defaults in index.html match the dictionary (crawlers and link previews do not run JS)
assert.ok(html.includes(`<title>${DICT['meta.title']}</title>`), '<title> matches meta.title');
assert.ok(html.includes(`content="${DICT['meta.description']}"`), 'meta description matches meta.description');

// 4) Startup mode: saved choice wins; nothing valid saved -> chosen for the device (auto); broken storage never throws
const store = v => ({ getItem: () => v, setItem() {}, removeItem() {} });
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
assert.deepStrictEqual(P.startupMode(store('low')), { mode: 'low', auto: false });
assert.deepStrictEqual(P.startupMode(store('normal')), { mode: 'normal', auto: false });
assert.deepStrictEqual(P.startupMode(store(null)), { mode: 'normal', auto: true });
assert.deepStrictEqual(P.startupMode(store('3d')), { mode: '3d', auto: false });
assert.deepStrictEqual(P.startupMode(store('vr')), { mode: 'normal', auto: true }, 'unknown modes fall back');
assert.deepStrictEqual(P.startupMode(broken), { mode: 'normal', auto: true });
assert.deepStrictEqual(P.startupMode(null), { mode: 'normal', auto: true });
assert.strictEqual(P.writePref(broken, P.PREF_KEYS.mode, 'low'), false);
assert.doesNotThrow(() => P.clearPref(broken, P.PREF_KEYS.wins));
{ // round trip through a working store
  const m = new Map(), s = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  assert.ok(P.writePref(s, P.PREF_KEYS.mode, 'low'));
  assert.deepStrictEqual(P.startupMode(s), { mode: 'low', auto: false });
}

// 5) Window layout parsing: defaults are mission + results open; corrupt/partial data falls back per field
const def = P.defaultWins();
assert.deepStrictEqual(P.WIN_IDS.filter(id => def[id].open), ['mission', 'results']);
assert.deepStrictEqual(P.parseWins(null), def);
assert.deepStrictEqual(P.parseWins('{not json'), def);
assert.deepStrictEqual(P.parseWins('42'), def);
const w = P.parseWins(JSON.stringify({ bodies: { open: true, collapsed: true, x: 40, y: 'a' }, mission: { open: false }, bogus: { open: true } }));
assert.deepStrictEqual(w.bodies, { open: true, collapsed: true, x: 40, y: null });
assert.strictEqual(w.mission.open, false);
assert.strictEqual(w.results.open, true, 'missing entries keep defaults');
assert.ok(!('bogus' in w));

// 5b) Narrow desktop: Results starts collapsed, but a saved layout is left alone
assert.strictEqual(P.defaultWins({ narrow: true }).results.collapsed, true);
assert.strictEqual(P.defaultWins({ narrow: true }).mission.collapsed, false);
assert.strictEqual(P.parseWins(null, { narrow: true }).results.collapsed, true);
assert.strictEqual(P.parseWins(JSON.stringify({ results: { open: true, collapsed: false } }), { narrow: true }).results.collapsed, false);
assert.strictEqual(P.parseWins(null, { narrow: false }).results.collapsed, false);

// 5c) Wide desktop (≥ 1440 px): the overview starts open on a first visit only; a saved layout is left alone
assert.ok(P.WIN_IDS.indexOf('overview') > P.WIN_IDS.indexOf('results'), 'overview is placed after results (its default spot is under it)');
assert.deepStrictEqual(P.WIN_IDS.filter(id => P.defaultWins({ wide: true })[id].open), ['mission', 'results', 'overview']);
assert.strictEqual(P.parseWins(null, { wide: true }).overview.open, true);
assert.strictEqual(P.parseWins('{broken', { wide: true }).overview.open, true, 'unreadable layout counts as none');
assert.strictEqual(P.parseWins(JSON.stringify({ mission: { open: true } }), { wide: true }).overview.open, false, 'older saved layout without the overview');
assert.strictEqual(P.parseWins(JSON.stringify({ overview: { open: true, x: 5, y: 6 } }), { wide: false }).overview.open, true);
assert.strictEqual(P.parseWins(null, { wide: false }).overview.open, false);
// below 1920 px it starts collapsed to its title bar; a saved layout keeps its own state
assert.strictEqual(P.parseWins(null, { wide: true }).overview.collapsed, true);
assert.strictEqual(P.parseWins(null, { wide: true, full: true }).overview.collapsed, false);
assert.strictEqual(P.parseWins(JSON.stringify({ overview: { open: true, collapsed: false } }), { wide: true }).overview.collapsed, false);
assert.strictEqual(P.defaultWins({ wide: true }).results.collapsed, false);

// 5d) Free plot area: maximal empty rectangles around windows / HUD
{
  const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  const key = q => [q.x0, q.y0, q.x1, q.y1].join(',');
  assert.deepStrictEqual(P.freeRects(100, 50, []).map(key), ['0,0,100,50']);
  // a window on the left and one on the right: the column between them, plus the strips above / below them
  const rs = P.freeRects(1000, 600, [box(0, 0, 300, 400), box(700, 100, 1000, 600)]);
  assert.ok(rs.some(q => key(q) === '300,0,700,600'), 'centre column');
  assert.ok(rs.some(q => key(q) === '0,400,700,600'), 'below the left window');
  assert.ok(rs.some(q => key(q) === '300,0,1000,100'), 'above the right window');
  for (const q of rs) for (const o of [box(0, 0, 300, 400), box(700, 100, 1000, 600)]) assert.ok(q.x1 <= o.x0 || q.x0 >= o.x1 || q.y1 <= o.y0 || q.y0 >= o.y1, 'no overlap: ' + key(q));
  assert.ok(!rs.some(p => rs.some(q => p !== q && p.x0 >= q.x0 && p.x1 <= q.x1 && p.y0 >= q.y0 && p.y1 <= q.y1)), 'only maximal ones');
  assert.strictEqual(key(P.bestRect(rs)), '300,0,700,600', 'largest area');
  // the gap grows each obstacle
  assert.deepStrictEqual(P.freeRects(100, 100, [box(0, 0, 100, 40)], 10).map(key), ['0,50,100,100']);
}

// 5e) Orbit trail opacity: last 10 revolutions; the oldest fade out (normal) or are cut (low-resource)
assert.strictEqual(P.trailAlpha(0, true), 1);
assert.strictEqual(P.trailAlpha(6.9, true), 1);
assert.ok(Math.abs(P.trailAlpha(8.5, true) - 0.5) < 1e-12, 'halfway through the fade');
assert.strictEqual(P.trailAlpha(10, true), 0);
assert.strictEqual(P.trailAlpha(10.5, true), 0);
assert.strictEqual(P.trailAlpha(9.9, false), 1, 'no fade in low-resource mode');
assert.strictEqual(P.trailAlpha(10.01, false), 0);
assert.strictEqual(P.trailAlpha(NaN, true), 0);

// 6) Clamping pulls windows fully inside; oversize windows pin to the top-left
assert.deepStrictEqual(P.clampWin(900, 700, 300, 200, 1000, 800), [700, 600]);
assert.deepStrictEqual(P.clampWin(-50, -20, 300, 200, 1000, 800), [0, 0]);
assert.deepStrictEqual(P.clampWin(100, 100, 300, 200, 1000, 800), [100, 100]);
assert.deepStrictEqual(P.clampWin(100, 100, 1200, 900, 1000, 800), [0, 0]);

// 7) 3D mode: Three.js is only reached through import() when the mode is picked (no script tag, nothing in the
// 2D code paths), the import map points at files that exist, and every custom shader includes the logdepthbuf
// chunks (logarithmic depth buffer: without them bodies and lines would not hide each other correctly)
{
  const fsx = f => fs.existsSync(path.join(__dirname, '..', f));
  assert.ok(!/<script[^>]*src="[^"]*(vendor\/three|view3d)/.test(html), 'no script tag loads Three.js or view3d.js');
  for (const f of ['js/app.js', 'js/core.js', 'js/prefs.js', 'css/style.css']) assert.ok(!/vendor\/three|view3d\.js/.test(read(f)), `${f} does not reference Three.js`);
  const m3 = read('js/mode3d.js');
  assert.strictEqual([...m3.matchAll(/import\([^)]/g)].length, 1, 'one dynamic import, in load3d');
  assert.ok(/V3load = import\(new URL\('js\/view3d\.js'/.test(m3));
  const map = JSON.parse(html.match(/<script type="importmap">([^<]*)<\/script>/)[1]).imports;
  assert.ok(fsx(map.three), 'import map: three');
  const v3 = read('js/view3d.js');
  for (const m of v3.matchAll(/from '(three\/addons\/[^']+)'/g)) assert.ok(fsx(map['three/addons/'] + m[1].slice('three/addons/'.length)), 'addon exists: ' + m[1]);
  const shaders = new Map([...v3.matchAll(/const (\w+_(?:VS|FS)) = \/\* glsl \*\/`([^`]*)`/g)].map(m => [m[1], m[2]]));
  assert.ok(shaders.size >= 4);
  for (const [name, src] of shaders) {
    const want = name.endsWith('_VS') ? ['common', 'logdepthbuf_pars_vertex', 'logdepthbuf_vertex'] : ['logdepthbuf_pars_fragment', 'logdepthbuf_fragment'];
    for (const c of want) assert.ok(src.includes(`#include <${c}>`), `${name} includes ${c}`);
  }
  const mats = [...v3.matchAll(/new THREE\.ShaderMaterial\(\{ vertexShader: (\w+), fragmentShader: (\w+)/g)];
  assert.ok(mats.length >= 2);
  for (const [, vs, fsh] of mats) assert.ok(shaders.has(vs) && shaders.has(fsh), `ShaderMaterial uses checked shaders: ${vs}, ${fsh}`);
  assert.ok(/logarithmicDepthBuffer: true/.test(v3));
  // the saved 3D mode is restored (Three.js then loads at startup)
  assert.ok(P.VIEW_MODES.includes('3d'));
  // the cabin's glass (Phase 10): Three.js only through one import() in cabin.js, after the 3D check (never in the
  // low-resource mode, with reduced motion or without WebGL 2), with its own import map; no script tag
  const kab = read('kabin.html'), cab = read('js/cabin.js');
  assert.ok(!/<script[^>]*src="[^"]*(vendor\/three|view3d)/.test(kab), 'kabin.html: no script tag loads Three.js');
  const kmap = JSON.parse(kab.match(/<script type="importmap">([^<]*)<\/script>/)[1]).imports;
  assert.deepStrictEqual(kmap, map, 'kabin.html: the same import map');
  assert.strictEqual([...cab.matchAll(/import\([^)]/g)].length, 1, 'cabin: one dynamic import');
  assert.ok(/if \(!fvGL\(\)\) \{ fvKick\(\); return; \}\n  if \(!FV\.load\) \{\n    FV\.load = import\(new URL\('js\/view3d\.js'/.test(cab), 'the import only past the 3D check');
  assert.ok(/if \(FV\.gl == null\) FV\.gl = !LOWQ && /.test(cab) && /return FV\.gl && !FV\.fail && !RM\.matches;/.test(cab), '3D check: not low-resource, WebGL 2, no reduced motion');
  for (const f of ['js/pomodoro.js', 'js/flightplans.js', 'js/flightdata.js', 'js/cabin-audio.js']) assert.ok(!/vendor\/three|view3d/.test(read(f)), `${f} does not reference Three.js`);
}

// 8) Planet images: the low-resource mode never fetches one; every texture and layer (with its sharper tiers) exists, is
// equirectangular (2:1; base files at most 2048 px wide, tiers at most 4096) and has its source, credit, licence and
// note texts; nothing in the markup or styles points at them
{
  const { TEX_SRC, DATA_SRC, SKY } = require('../js/bodies.js');
  const appSrc = read('js/app.js'), globe = read('js/globe.js'), m3 = read('js/mode3d.js');
  const prof = n => appSrc.match(new RegExp(`\\n  '?${n}'?:\\s*\\{([^}]*)\\}`))[1];
  assert.ok(/tex: false/.test(prof('low')), 'low-resource profile: no textures');
  assert.ok(/tex: true/.test(prof('normal')) && /tex: true/.test(prof('3d')), 'normal and 3D profiles: textures');
  // the only download point is texReady (globe.js), reached through globeLook, whose callers pass Q.tex
  assert.strictEqual([...globe.matchAll(/new Image\(\)/g)].length, 1, 'one place creates images');
  for (const f of [appSrc, m3]) {
    assert.ok(!/texReady\(/.test(f), 'texReady is only called inside globe.js');
    for (const m of f.matchAll(/globeLook\(([^;]*)\)/g)) assert.ok(/Q\.tex, !lowQ/.test(m[1]), 'globeLook asks with Q.tex (draw) and !lowQ (fetch): ' + m[1]);
  }
  for (const f of ['index.html', 'css/style.css']) assert.ok(!/img\/planets/.test(read(f)), `${f} does not refer to planet images`);
  const dims = file => {
    const b = fs.readFileSync(path.join(__dirname, '..', file));
    if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)];
    for (let i = 2; i < b.length - 9;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  };
  let n = 0;
  const strip = t => t === null || /rings/.test(t.file);
  for (const [k, b] of Object.entries(BODIES)) {
    const layers = [[b.tex, k], [b.texAlt, k], [b.rings, k + 'Rings'], [b.rings && b.rings.tau, k + 'Tau'], [b.relief, k + 'Relief'], [b.clouds, k + 'Clouds'], [b.night, k + 'Night'], [b.ocean, k + 'Ocean']];
    // the Sources window lists the same layers (credLayers in app.js)
    for (const [, note] of layers) assert.ok(appSrc.includes("'cred.note.' + k + '" + note.slice(k.length) + "'") || note === k, 'credits list layer ' + note);
    for (const [t, note] of layers) {
      if (!t) continue;
      n++;
      const files = [[t.w || 1024, t.file], ...(t.hi || [])];
      files.forEach(([wantW, file], tier) => {
        assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `texture file exists: ${file}`);
        const [w, h] = dims(file);
        if (strip(t)) assert.ok(w > h, 'ring strip is a horizontal strip');
        else {
          assert.ok(Math.abs(w - 2 * h) <= 1 && w === wantW && w <= (tier ? 4096 : 2048), `${file}: equirectangular, ${wantW} px wide (${w}×${h})`);
          if (tier) assert.ok(wantW > files[tier - 1][0], `${file}: tiers grow`);
        }
      });
      assert.ok(TEX_SRC[t.src], `${k}: source ${t.src} has a URL`);
      for (const key of ['cred.src.' + t.src, 'cred.by.' + t.src, 'cred.lic.' + t.src, 'cred.note.' + note]) assert.ok(has(key), `credit text: ${key}`);
    }
    if (b.relief) assert.ok(b.relief.h[0] < 0 && b.relief.h[1] > 0, k + ': relief height range in metres');
    // a data-less cap is filled in the shader (voidFill): a polar latitude band and a grey tone
    if (b.tex && b.tex.nodata) { const d = b.tex.nodata; assert.ok(d.lat[0] < d.lat[1] && (d.lat[0] === -90 || d.lat[1] === 90) && /^#([0-9a-f]{2})\1\1$/.test(d.tone), k + ': nodata band and tone'); }
  }
  assert.deepStrictEqual(Object.keys(BODIES).filter(k => BODIES[k].tex && BODIES[k].tex.nodata), ['vesta', 'ceres'], 'Ceres and Vesta fill their no-data caps');
  assert.ok(/uniform vec4 uVoid;/.test(globe) && /'uVoid', 'uVoidZ'/.test(globe) && /uVoid: new THREE\.Vector4\(\)/.test(read('js/view3d.js')), 'no-data fill wired in 2D and 3D');
  assert.ok(n >= 20, 'textures and layers listed');
  // the sky: files, sources and texts; 8 bytes per catalogue star
  for (const [id, t] of Object.entries(SKY)) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', t.file)), 'sky file exists: ' + t.file);
    for (const key of ['cred.src.' + t.src, 'cred.by.' + t.src, 'cred.lic.' + t.src, 'cred.sky.' + id, 'cred.note.sky.' + id]) assert.ok(has(key), `credit text: ${key}`);
  }
  { const [w, h] = dims(SKY.milky.file); assert.ok(w === 2 * h, 'Milky Way map is 2:1'); }
  assert.strictEqual(fs.statSync(path.join(__dirname, '..', SKY.stars.file)).size % 8, 0, 'star records are 8 bytes');
  assert.ok(has('cred.clouds') && P.PREF_KEYS.clouds, 'clouds switch and its saved choice');
  for (const k of Object.keys(DATA_SRC)) assert.ok(has('cred.data.' + k), `data source text: cred.data.${k}`);
  // the real model's untextured planets are the ones the Sources window lists as plain globes
  assert.deepStrictEqual(Object.keys(BODIES).filter(k => BODIES[k].parent === 'sun' && !BODIES[k].tex), ['venus', 'uranus', 'neptune']);
  assert.ok(P.WIN_IDS.includes('credits') && /data-win="credits"/.test(html), 'Sources window');
}

// 9) Texture tiers and what a look asks for (js/globe.js run in a sandbox; Image counts downloads): nothing in the
// low-resource mode or below TEX_MIN_PX; the base file first, then the tier the globe's size calls for, never above the
// mode's cap (2048 in normal 2D, 4096 in 3D, 1024 at ladder step 3); relief and clouds only while the ladder allows.
// The sky loads only where the profile has stars; one fetch() in all (the star catalogue).
{
  const asked = [];
  const sb = { performance: { now: () => 1e6 }, Image: class { set src(f) { asked.push(f); this._s = f; } get src() { return this._s; } }, Math, Object, Map, Set, Array, Number, console };
  vm.runInNewContext(read('js/bodies.js') + '\n' + read('js/globe.js') + '\nthis.api = { texTier, globeLook, TEXC, TIER, BIG, TEXOPT, BODIES, TEX_MIN_PX };', sb);
  const G = sb.api, W3 = [1024, 2048, 4096];
  // pure tier choice: about one texel per screen pixel, capped, sticky until the lower tier has 25 % to spare
  assert.strictEqual(G.texTier(W3, 50, 4096), 0);
  assert.strictEqual(G.texTier(W3, 300, 4096), 1);
  assert.strictEqual(G.texTier(W3, 1000, 4096), 2);
  assert.strictEqual(G.texTier(W3, 1000, 2048), 1, 'normal 2D: 2k at most');
  assert.strictEqual(G.texTier(W3, 1000, 1024), 0, 'ladder step 3: base only');
  assert.strictEqual(G.texTier(W3, 420, 4096, 2), 2, 'kept while the 2k tier is barely enough');
  assert.strictEqual(G.texTier(W3, 300, 4096, 2), 1, 'dropped once 2k has room to spare');
  assert.strictEqual(G.texTier([2048, 3601], 1000, 4096), 1, 'Jupiter: the original 3601 px file on top');
  const fx = { clouds: true, relief: true, glint: true };
  const reset = () => { asked.length = 0; G.TEXC.clear(); G.TIER.clear(); G.BIG.clear(); };
  const loadAll = () => { for (const e of G.TEXC.values()) e.img.onload(); };
  reset(); G.globeLook('earth', 900, false, false, 4096, fx, 0); G.globeLook('moon', 900, false, false, 4096, fx, 0);
  assert.strictEqual(asked.length, 0, 'low-resource mode: no request');
  reset(); G.globeLook('earth', G.TEX_MIN_PX - 1, true, true, 4096, fx, 0);
  assert.strictEqual(asked.length, 0, 'too small: no request');
  reset(); G.globeLook('earth', 900, true, false, 4096, fx, 0);
  assert.strictEqual(asked.length, 0, 'after the quality drop: no new download');
  reset(); G.globeLook('moon', 900, true, true, 2048, fx, 0); loadAll(); G.globeLook('moon', 900, true, true, 2048, fx, 0);
  assert.ok(asked.includes('img/planets/moon.jpg') && asked.includes('img/planets/moon_2k.jpg') && !asked.some(f => /_4k/.test(f)), 'normal 2D: base and 2k only: ' + asked);
  reset(); G.globeLook('moon', 900, true, true, 4096, fx, 0); loadAll(); G.globeLook('moon', 900, true, true, 4096, fx, 0);
  assert.ok(asked.includes('img/planets/moon_4k.jpg') && asked.includes('img/planets/moon_height_4k.png'), '3D close: 4k colour and heights');
  // three bodies close up at once: the third gets 2k
  reset(); for (const k of ['earth', 'moon', 'mars']) G.globeLook(k, 900, true, true, 4096, fx, 0); loadAll(); for (const k of ['earth', 'moon', 'mars']) G.globeLook(k, 900, true, true, 4096, fx, 0);
  assert.ok(asked.includes('img/planets/earth_4k.jpg') && asked.includes('img/planets/moon_4k.jpg') && !asked.includes('img/planets/mars_4k.jpg') && asked.includes('img/planets/mars_2k.jpg'), 'two 4k bodies at most');
  reset(); G.globeLook('moon', 900, true, true, 1024, { clouds: false, relief: false, glint: false }, 0);
  assert.deepStrictEqual([...asked], ['img/planets/moon.jpg'], 'ladder steps 2–3: base colour only');
  reset(); G.globeLook('earth', 100, true, true, 4096, { clouds: false, relief: true, glint: true }, 0);
  assert.ok(!asked.some(f => /clouds/.test(f)) && asked.includes('img/planets/earth_night.jpg'), 'ladder step 1: no clouds');
  G.TEXOPT.clouds = false; reset(); G.globeLook('earth', 100, true, true, 4096, fx, 0); G.TEXOPT.clouds = true;
  assert.ok(!asked.some(f => /clouds/.test(f)), 'clouds switched off: not fetched');
  reset(); G.globeLook('moon', 30, true, true, 4096, fx, 0);
  assert.ok(!asked.some(f => /height/.test(f)), 'relief only once the globe is large enough');
  // the sky: asked for behind a Q.stars check only; the star catalogue is the one fetch()
  const m3 = read('js/mode3d.js'), app = read('js/app.js'), globe = read('js/globe.js');
  assert.ok(/function sky3\(\) \{ if \(Q\.stars && !SCENE\.wait\) /.test(m3), '3D sky behind Q.stars');
  assert.ok(/function makeStars\(\) \{\n  if \(!Q\.stars \|\| MODE === '3d' \|\| SCENE\.wait\) \{[^}]*return; \}\n  const sk = skyReady\(true, skyHi\(/.test(app), '2D sky behind Q.stars (and after the first-run question)');
  assert.ok(/const skyHi = px => !lowQ && FX\.lvl < 3 && !COARSE && performance\.now\(\) > skyHiAt && skyHiNeed\(px\);/.test(app), 'sharper sky: not after the quality drop, ladder step 3 or on touch devices');
  assert.strictEqual([...(app + m3).matchAll(/skyReady\(/g)].length, 3, 'skyReady callers: makeStars, its rebuild, sky3');
  assert.strictEqual([...(globe + app + m3 + read('js/view3d.js')).matchAll(/fetch\(/g)].length, 1, 'one fetch: the star catalogue');
  // the Milky Way: base first, the 4096 tier only when asked for (hi) and needed (base magnified over 1.3×)
  const sky = { performance: sb.performance, Image: sb.Image, Math, Object, Map, Set, Array, Number, console, fetch: () => ({ then: () => ({ then: () => ({ catch: () => {} }) }) }) };
  vm.runInNewContext(read('js/bodies.js') + '\n' + read('js/globe.js') + '\nthis.api = { skyReady, skyHiNeed, TEXC };', sky);
  asked.length = 0; sky.api.skyReady(false, true);
  assert.strictEqual(asked.length, 0, 'sky: nothing unless wanted');
  sky.api.skyReady(true, false);
  assert.deepStrictEqual([...asked], ['img/sky/milkyway.jpg'], 'sky: base only without hi');
  sky.api.skyReady(true, true);
  assert.ok(asked.includes('img/sky/milkyway_4k.jpg'), 'sky: 4k when hi');
  assert.ok(!sky.api.skyHiNeed(7) && sky.api.skyHiNeed(8), 'sharper sky past 1.3 × 2048/360 px per degree');
}
// 10) Sky brightness: the saved gain is a number in 0–2, anything else is the default 1; the slider lives with the view
// toggles and is hidden where there is no sky
{
  assert.strictEqual(P.skyGainOf(null), 1); assert.strictEqual(P.skyGainOf('abc'), 1); assert.strictEqual(P.skyGainOf(''), 1);
  assert.strictEqual(P.skyGainOf('1.5'), 1.5); assert.strictEqual(P.skyGainOf(5), 2); assert.strictEqual(P.skyGainOf(-1), 0);
  assert.ok(/id="tSky"[^>]*min="0" max="200"/.test(html) && P.PREF_KEYS.sky, 'sky slider and its saved value');
  assert.ok(/\$\('#tSkyWrap'\)\.hidden = !Q\.stars;/.test(read('js/app.js')), 'slider hidden without a sky');
  const { SKY } = require('../js/bodies.js');
  assert.ok(SKY.milky.hi && SKY.milky.hi[0][0] === 4096 && fs.existsSync(path.join(__dirname, '..', SKY.milky.hi[0][1])), 'the 4k Milky Way tier exists');
}

// 11) Overview picks and double taps move the camera smoothly (fly2 / fly3 after the follow in every view), instantly in
// the low-resource mode and with reduced motion; the viewer's camera input stops a move
{
  const app = read('js/app.js'), m3 = read('js/mode3d.js');
  assert.ok(/function centerBody[\s\S]*?const a = flyFrom\(\); followBody\(i\); flyTo\(a\);[\s\S]*?const a = flyFrom\(\); mapCenter\(k\); flyTo\(a\);/.test(app), 'overview pick: flyFrom, zoom, flyTo');
  assert.ok(/function flyTo\(a\) \{\n  FLY\.on = false;\n  if \(!Q\.glow \|\| reduceMotion/.test(app), 'instant without glow (low-resource) or with reduced motion');
  assert.ok(/fly2\(S\.follow !== 'free'\)/.test(app) && /fly2\(MAP\.follow != null\)/.test(app) && /fly3\(c, S\.follow !== 'free'\)/.test(m3) && /fly3\(c, MAP\.follow != null \|\| FREE\.appr\)/.test(m3), 'all four views apply the move');
  assert.ok(/function sceneTouch\(\) \{ FLY\.on = false;/.test(app), 'camera input stops a move');
}

// 12) Phase 6c-1: the osculating orbit and the slow motion are switches with saved choices (on unless saved off); the
// slow motion and the turn of an impulsive burn are off in the low-resource mode and with reduced motion; the burn
// schedule goes into both results views and its rows move the timeline
{
  const app = read('js/app.js');
  assert.ok(P.PREF_KEYS.osc && P.PREF_KEYS.slow && /id="tOsc"/.test(html) && /id="slow"/.test(html), 'switches and saved keys');
  assert.ok(/S\.osc = readPref\(LS, PREF_KEYS\.osc\) !== '0';/.test(app) && /S\.slow = readPref\(LS, PREF_KEYS\.slow\) !== '0';/.test(app), 'on by default');
  assert.ok(/const slowOn = \(\) => S\.slow && Q\.glow && !lowQ && !reduceMotion;/.test(app), 'slow motion only where animations run');
  assert.strictEqual([...app.matchAll(/res\.innerHTML = resRows\(rows\.concat\(engResRows\(\)\)\) \+ schedHtml\(\);/g)].length, 4, 'schedule (and the engine rows) in transfer, maneuver, single-firing and free-burn results');
  assert.ok(/tr\.sch[\s\S]{0,120}S\.u = tToU\(\+tr\.dataset\.t\)/.test(app), 'a schedule row jumps to its burn');
  assert.ok(has('osc.morph') && /SLOW\.morph/.test(app), 'the impulsive turn is labelled a visual aid');
}

// 13) Phase 6c-2 vehicles: every ready-made vehicle is usable, has its name, note and sources (links and texts); the
// derived values follow from the published ones as js/vehicles.js says; saved vehicles are read defensively
{
  const { VEHICLES, VEH_SRC } = require('../js/vehicles.js');
  assert.ok(/<script src="js\/vehicles\.js"><\/script>[\s\S]*<script src="js\/app\.js">/.test(html), 'vehicles.js loads before app.js');
  for (const v of VEHICLES) {
    assert.ok(v.F > 0 && v.isp > 0 && v.m0 > v.md && v.md > 0 && v.tMax >= 0 && Number.isInteger(v.nMax) && v.nMax >= 0 && v.wait >= 0, 'usable vehicle ' + v.id);
    assert.ok(has('veh.' + v.id) && has('cred.veh.' + v.id) && v.src.length && v.src.every(s => VEH_SRC[s] && has('cred.vsrc.' + s)), 'texts and sources of ' + v.id);
  }
  const V = Object.fromEntries(VEHICLES.map(v => [v.id, v])), lb = 0.45359237, g0 = 9.80665;
  assert.ok(Math.abs(V.centaur.tMax - 20830 / (V.centaur.F / (V.centaur.isp * g0))) < 1, 'Centaur: the whole load in one burn');
  assert.ok(Math.abs(V.csm.m0 - 63493 * lb) < 0.1 && Math.abs(V.csm.md - (63493 - 39641.8) * lb) < 0.1 && Math.abs(V.csm.F - 20500 * 4.4482216) < 0.1, 'CSM: from the press kit and the handbook');
  assert.ok(V.mex.m0 === 1223 - 71 && V.mex.md === 1223 - 71 - 427 && V.smart1.md === 367 - 82.5 && V.smart1.tMax === 240 * 3600 && Math.abs(V.lp.md - (296.4 - 137.7)) < 1e-9, 'masses as derived');
  assert.deepStrictEqual(P.parseVehicles('not json'), []);
  assert.deepStrictEqual(P.parseVehicles('{"a":1}'), []);
  const ok = { name: ' A ', F: 400, isp: 320, m0: 1000, md: 500, tMax: 600, nMax: 3.5, wait: -1 };
  assert.deepStrictEqual(P.parseVehicles(JSON.stringify([ok, { ...ok, md: 2000 }, { ...ok, F: 0 }, { ...ok, name: '' }, null])),
    [{ name: 'A', F: 400, isp: 320, m0: 1000, md: 500, tMax: 600, nMax: 0, wait: 0 }], 'bad entries dropped, limits cleaned');
  assert.strictEqual(P.parseVehicles(JSON.stringify(Array.from({ length: 80 }, (_, j) => ({ ...ok, name: 'v' + j })))).length, 50, '50 at most');
  assert.ok(P.PREF_KEYS.vehicles && /<button type="button" data-v="burn"/.test(html) && ['pro', 'retro', 'norm', 'anti', 'out', 'in'].every(d => html.includes(`<option value="${d}"`) && has('mv.dir.' + d)), 'the single firing: six directions');
}

// 14) Phase 9 cabin (kabin.html, js/cabin.js): every text from the dictionary; every art tier holds every layer at its
// width; 7136 only on a desktop with enough memory, phones at most 2560; the crop covers the screen and keeps the window
// (wide) or the cat (portrait) in view; planet and sky images only through globeLook / skyReady, never in low mode;
// storage only through prefs.js; the sources (master.png, cat.png) stay out of the repo.
{
  const page = read('kabin.html'), js = read('js/cabin.js');
  for (const m of page.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) assert.ok(has(m[1]), `kabin.html key missing from dictionary: ${m[1]}`);
  for (const m of js.matchAll(/'((?:kab|kabin|wc)\.[A-Za-z0-9_.]+)'/g)) assert.ok(has(m[1]), `cabin.js key missing from dictionary: ${m[1]}`);
  assert.ok(page.includes(`content="${DICT['kabin.description']}"`) && page.includes(`<title>${DICT['kabin.title']}</title>`), 'kabin.html static title and description match the dictionary');
  assert.ok(/<script src="js\/bodies\.js"><\/script>\s*<script src="js\/core\.js"><\/script>\s*<script src="js\/globe\.js"><\/script>\s*<script src="js\/sounds\.js"><\/script>\s*<script src="js\/cabin-audio\.js"><\/script>\s*<script src="js\/pomodoro\.js"><\/script>\s*<script src="js\/flightplans\.js"><\/script>\s*<script src="js\/flightdata\.js"><\/script>\s*<script src="js\/vistas\.js"><\/script>\s*<script src="js\/cabin\.js">/.test(page),
    'cabin scripts in order: bodies, core, globe, sounds, cabin-audio, pomodoro, flightplans, flightdata, vistas, cabin');
  assert.ok(!/img\/planets|img\/sky/.test(page + js), 'cabin images of bodies and sky only through globeLook / skyReady');
  for (const m of js.matchAll(/globeLook\(([^;]*?)\)/g)) assert.ok(/, !LOWQ, !LOWQ,/.test(m[1]), 'cabin globeLook: nothing drawn or fetched in low mode: ' + m[1]);
  // the sky: through skyReady only on the 3D path (never in low mode: no Three.js there), the plain sky otherwise
  assert.strictEqual([...js.matchAll(/skyReady\(/g)].length, 1, 'cabin: one skyReady call');
  assert.ok(/function fvDraw3\(st, cam\) \{[^]*?skyReady\(true, /.test(js) && /if \(!FV\.plain\) FV\.plain = plainSky\(\);/.test(js), 'cabin sky: skyReady on the 3D path only, the plain sky on the 2D path');
  assert.ok(!/localStorage\.|sessionStorage\./.test(js.replace(/window\.localStorage/, '')), 'cabin storage only through prefs.js');
  const L = JSON.parse(read('img/cabin/layout.json'));
  assert.deepStrictEqual(L.tiers, P.CAB_TIERS, 'layout tiers = CAB_TIERS');
  const webpW = f => { const b = fs.readFileSync(path.join(__dirname, '..', f)); assert.strictEqual(b.toString('ascii', 12, 16), 'VP8X', f + ' has an alpha (VP8X) header'); return 1 + b.readUIntLE(24, 3); };
  for (const T of L.tiers) {
    assert.strictEqual(webpW(`img/cabin/${T}/room.webp`), T, `room tier ${T} width`);
    for (const [n, e] of Object.entries(L.layers)) assert.ok(Math.abs(webpW(`img/cabin/${T}/${n}.webp`) - e.w * T / L.size[0]) <= 1, `layer ${n} at tier ${T}`);
  }
  assert.ok(['shadow', 'tail', 'earL', 'earR', 'body'].every(n => L.layers[n]) && L.layers.tail.pivot && L.layers.earL.pivot && L.layers.earR.pivot, 'cat layers with pivots');
  assert.ok(/^img\/cabin\/art\/$/m.test(read('.gitignore')), 'illustration sources stay out of the repo');
  // device limits
  assert.strictEqual(P.cabTierMax({ phone: true, desktop: false, mem: 8 }), 2560);
  assert.strictEqual(P.cabTierMax({ phone: false, desktop: true, mem: undefined }), 7136, 'desktop with unknown memory');
  assert.strictEqual(P.cabTierMax({ phone: false, desktop: true, mem: 4 }), 3840, 'desktop with little memory');
  assert.strictEqual(P.cabTierMax({ phone: false, desktop: false, mem: 8 }), 3840, 'tablet');
  assert.strictEqual(P.cabTier(2186, 7136), 2560); assert.strictEqual(P.cabTier(6000, 7136), 7136); assert.strictEqual(P.cabTier(6000, 2560), 2560); assert.strictEqual(P.cabTier(100, 7136), 1600);
  // crops: cover the screen, inside the art; window centre visible when wide, the cat when portrait
  const g = L.glass, cat = L.layers.body, W = L.size[0], H = L.size[1];
  for (const [vw, vh] of [[1920, 1080], [2560, 1080], [1024, 768], [390, 844], [844, 390], [3840, 1080]]) {
    const c = P.cabCrop(vw, vh, W, H), w = vw / c.s, h = vh / c.s;
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + w <= W + 1e-6 && c.y + h <= H + 1e-6 && (Math.abs(w - W) < 1e-6 || Math.abs(h - H) < 1e-6), `crop ${vw}×${vh} covers the screen inside the art`);
    assert.ok(c.x <= cat.x && c.x + w >= cat.x + cat.w, `crop ${vw}×${vh} shows the cat`);
    if (vw / vh >= 1.3) assert.ok(c.x <= g.x0 && c.x + w >= g.x1, `crop ${vw}×${vh} shows the whole glass`);
    // window view: closer than the desk, inside the art, the cat and the sill in, the glass at least 60 % of the height,
    // the whole frame on landscape screens
    const wc = P.cabGlassCam(vw, vh, g), ww = vw / wc.s, wh = vh / wc.s, a = vw / vh;
    assert.ok(wc.s >= c.s - 1e-9 && wc.x >= -1e-6 && wc.y >= -1e-6 && wc.x + ww <= W + 1e-6 && wc.y + wh <= H + 1e-6, `window view ${vw}×${vh}: closer, inside the art`);
    assert.ok(wc.x <= cat.x && wc.x + ww >= cat.x + cat.w && wc.y + wh >= 2300, `window view ${vw}×${vh}: the cat on the sill`);
    assert.ok((Math.min(g.y1, wc.y + wh) - Math.max(g.y0, wc.y)) * wc.s >= 0.59 * vh, `window view ${vw}×${vh}: the glass fills the height`);
    if (vw < vh) { const wb = P.cabGlassCam(vw, vh, g, W, H, 56); assert.ok((P.CAB_PAWS_Y - wb.y) * wb.s <= vh - 56 + 1e-6 && wb.y <= P.CAB_WIN[1] + 1e-6, `window view ${vw}×${vh}: the paws just above the bottom bar, the glass whole`); }
    if (a >= 1.6 && a <= 2.4) assert.ok(wc.x <= P.CAB_WIN[0] && wc.x + ww >= P.CAB_WIN[2] && wc.y <= P.CAB_WIN[1] + 1e-6, `window view ${vw}×${vh}: the whole frame`);
  }
}

// 15) Phase 11 cabin sound: every track is CC0 or CC BY 4.0 (no other licence), names its artist and source page, has
// both files (Opus/WebM and MP3) and a sane duration; a CC BY track is credited while it plays and in the Sources
// window; the space recordings carry their credit and source; the radio starts only on a gesture; storage through
// prefs.js; settings parsing falls back per field; the credits name the music and the recordings.
{
  const S = require('../js/sounds.js'), page = read('kabin.html'), aud = read('js/cabin-audio.js'), cab = read('js/cabin.js');
  const size = f => fs.statSync(path.join(__dirname, '..', f)).size;
  assert.ok(S.MUSIC.length >= 30 && new Set(S.MUSIC.map(m => m.id)).size === S.MUSIC.length, 'distinct tracks, 30 or more');
  let bytes = 0;
  for (const m of S.MUSIC) {
    assert.ok(m.title && S.MUSIC_ARTISTS[m.artist] && (m.album === null || S.MUSIC_ALBUM[m.album]) && S.SND_SRC[m.src] && m.dur > 60 && m.dur < 600, 'track data ' + m.id);
    assert.ok(m.lic === 'cc0' || m.lic === 'ccby', 'licence CC0 or CC BY 4.0: ' + m.id);
    for (const e of ['webm', 'mp3']) { const n = size(`audio/cabin/music/${m.id}.${e}`); assert.ok(n > m.dur * 4000 && n < m.dur * 20000, `audio/cabin/music/${m.id}.${e} size`); bytes += n; }
  }
  assert.ok(/s\.track\.lic === 'ccby' \? _\('kab\.audio\.nowBy', \{ title: s\.track\.title, artist: MUSIC_ARTISTS\[s\.track\.artist\], lic: _\('cred\.cabin\.ccby'\) \}\)/.test(cab) && has('kab.audio.nowBy'), 'a CC BY track shows its credit while it plays');
  assert.ok(/function musicCredits\(\)/.test(app) && /MUSIC_ARTISTS\[a\]/.test(app) && /SND_SRC\[m\.src\]/.test(app) && has('cred.cabin.musicBy') && has('cred.cabin.ccby'), 'the Sources window credits every artist, each title linked');
  assert.ok(S.SND_SRC.ccby === 'https://creativecommons.org/licenses/by/4.0/' && S.SND_SRC.cc0, 'licence links');
  for (const s of S.SPACE_SND) {
    assert.ok(s.credit.startsWith('NASA/JPL-Caltech') && S.SND_SRC[s.src] && s.dur > 10, 'space sound data ' + s.id);
    for (const e of ['webm', 'mp3']) bytes += size(`audio/cabin/space/${s.id}.${e}`);
  }
  assert.ok(bytes < 300 * 1048576, 'cabin audio under 300 MB in all (about 55-80 radio tracks): ' + (bytes / 1048576).toFixed(1));
  assert.ok(fs.readdirSync(path.join(__dirname, '..', 'audio/cabin/music')).every(f => /^[a-z0-9-]+\.(webm|mp3)$/.test(f)), 'only encoded files in audio/cabin/music');
  // gesture, storage, keys
  assert.ok(/addEventListener\('pointerdown', audGesture, true\)/.test(cab) && !/sndStart\(/.test(cab.split('// ---------- sound')[0]), 'the radio starts on a gesture');
  assert.ok(!/localStorage\.|sessionStorage\./.test(aud), 'cabin-audio.js keeps no storage of its own');
  for (const m of (page + cab + aud).matchAll(/'(kab\.audio\.[A-Za-z0-9_.]+)'|data-i18n(?:-[a-z-]+)?="(kab\.audio\.[^"]+)"/g)) assert.ok(has(m[1] || m[2]), 'sound key missing: ' + (m[1] || m[2]));
  assert.ok(/<script src="js\/sounds\.js"><\/script>[\s\S]*<script src="js\/app\.js">/.test(html) && /cred\.cabin\.music/.test(app) && /cred\.cabin\.space/.test(app) && has('cred.cabin.musicNote') && has('cred.cabin.spaceNote'), 'credits name the radio and the recordings');
  // settings
  assert.deepStrictEqual(P.parseCabAudio(null), P.CAB_AUDIO, 'defaults: radio on, layers off');
  assert.deepStrictEqual(P.parseCabAudio('{"music":{"on":false,"vol":2},"noise":{"type":"red","vol":-1},"muted":"yes"}'),
    { muted: false, music: { on: false, vol: 1 }, space: { on: false, vol: 0.5 }, hum: { on: false, vol: 0.4 }, noise: { on: false, vol: 0, type: 'pink' }, chime: { on: true, vol: 0.6 }, purr: { on: true, vol: 0.5 } }, 'per-field fallback');
  assert.strictEqual(P.parseCabAudio('{"noise":{"type":"brown"}}').noise.type, 'brown');
  assert.ok(P.PREF_KEYS.cabAudio, 'saved under a pref key');
  // next track: a button beside the chip (shown only while the radio plays), a 1 s crossfade to the shuffle's next
  // track; the system's media keys get "next track" only (no previous track, no seeking)
  assert.ok(/<button type="button" class="ghost k-skip" id="kSkip" data-i18n-aria-label="kab\.audio\.next" data-i18n-title="kab\.audio\.next" hidden>/.test(page) && has('kab.audio.next'), 'skip button with its text');
  assert.ok(/\$\('#kSkip'\)\.addEventListener\('click', \(\) => sndNext\(\)\)/.test(cab) && /\$\('#kSkip'\)\.hidden = !\(SND\.started && set\.music\.on && !set\.muted && s\.track && !lost\)/.test(cab), 'skip: wired, only while playing');
  assert.ok(/function sndNext\(\) \{[^}]*l\.deck\.cross\(1\);\n\}/.test(aud), 'skip: 1 s crossfade through the shuffle');
  assert.ok(/setActionHandler\('nexttrack', sndNext\)/.test(aud) && /\['seekto', 'seekbackward', 'seekforward', 'previoustrack'\]\) try \{ ms\.setActionHandler\(a, null\)/.test(aud) && !/setActionHandler\('previoustrack', [a-z]/.test(aud), 'media session: next track only');
  // the shuffle never plays the same track twice in a row, also across rounds
  {
    const sb = { Math }; vm.runInNewContext(aud.slice(aud.indexOf('function shuffleBag'), aud.indexOf('// ---------- generated sound')) + '\nthis.shuffleBag = shuffleBag;', sb);
    const next = sb.shuffleBag(['a', 'b', 'c', 'd']), seq = Array.from({ length: 400 }, next);
    assert.ok(seq.every((x, i) => !i || x !== seq[i - 1]), 'no immediate repeat');
    for (let r = 0; r < 100; r++) assert.strictEqual(new Set(seq.slice(4 * r, 4 * r + 4)).size, 4, 'every track once per round');
    // with the real list: a random first track (300 fresh starts land on most tracks), each round shuffled anew (not
    // the last round's order), every round a full set without repeats, no repeat across a round's edge
    const { MUSIC } = require('../js/sounds.js'), N = MUSIC.length, first = new Set();
    for (let k = 0; k < 300; k++) first.add(sb.shuffleBag(MUSIC)().id);
    assert.ok(first.size > N / 2, 'random first track (' + first.size + ' of ' + N + ')');
    const nx = sb.shuffleBag(MUSIC), rounds = Array.from({ length: 6 }, () => Array.from({ length: N }, () => nx().id));
    for (let r = 0; r < rounds.length; r++) {
      assert.strictEqual(new Set(rounds[r]).size, N, 'round ' + r + ': every track once');
      if (r) { assert.notDeepStrictEqual(rounds[r], rounds[r - 1], 'round ' + r + ': shuffled anew'); assert.notStrictEqual(rounds[r][0], rounds[r - 1][N - 1], 'round ' + r + ': no repeat at the edge'); }
    }
    // the radio, the skip button and the fall-through after a failure all take the next track from that one bag
    assert.ok(['makeDeck(l.g, (bag => () => { const m = bag();', 'shuffleBag(MUSIC)', 'D.item = next(); load(B, D.item);', 'D.item = next(); load(E, D.item);'].every(t => aud.includes(t)), 'start, skip and fall-through follow the shuffle');
  }
}

// 16) Simulator ↔ cabin: the rail and the welcome card link to the cabin (a beta badge on the rail); the view goes along
// as ?manzara=; the snapshot for the way back is read only when fresh and well formed; since Phase 10 kabin.html is
// indexed, in the sitemap, with its static title, description and link preview.
{
  assert.ok(/<a class="rail-btn rail-cabin" href="kabin\.html" id="railCabin"[^>]*>[\s\S]*?<span class="rail-beta" data-i18n="ui\.betaTag"><\/span><\/a>/.test(html), 'rail: cabin link with a beta badge');
  assert.ok(/<a class="start-card" href="kabin\.html" id="wcCabin" data-go="cabin">/.test(html), 'start screen: focus in the cabin');
  assert.ok(app.includes("'kabin.html?manzara=' + (SCENE.kind === 'earth' ? 'earth' : 'saturn')") && /get\('manzara'\)/.test(read('js/cabin.js')), 'the view goes along (the tour as Saturn)');
  const now = 1e12, ok = { at: now - 1000, scene: '', map: false, S: { kind: 'transfer', bodies: [], M: {} } };
  assert.deepStrictEqual(P.parseSimSnap(JSON.stringify(ok), now), ok, 'a fresh snapshot is read');
  assert.strictEqual(P.parseSimSnap(JSON.stringify({ ...ok, at: now - P.SNAP_MAX_MS - 1 }), now), null, 'stale');
  assert.strictEqual(P.parseSimSnap(JSON.stringify({ ...ok, scene: 'mars' }), now), null, 'unknown view');
  assert.strictEqual(P.parseSimSnap(JSON.stringify({ ...ok, S: { kind: 'x', bodies: [], M: {} } }), now), null, 'unknown kind');
  assert.strictEqual(P.parseSimSnap('{', now), null); assert.strictEqual(P.parseSimSnap(null, now), null);
  // a key written twice silently keeps only the last value (the β label once shadowed the cabin's badge)
  const seen = new Set(), dup = [];
  for (const m of read('js/i18n.js').matchAll(/^ {4}'([^']+)':/gm)) { if (seen.has(m[1])) dup.push(m[1]); seen.add(m[1]); }
  assert.deepStrictEqual(dup, [], 'dictionary keys written twice');
  // Phase 10 done: the cabin is public, in the sitemap, with its own static title, description and link preview
  const kp = read('kabin.html');
  assert.ok(!/noindex/.test(kp) && /<loc>https:\/\/baqikk\.github\.io\/orbital-simulator\/kabin\.html<\/loc>/.test(read('sitemap.xml')), 'kabin.html: indexed, in the sitemap');
  assert.ok(kp.includes(`<meta property="og:title" data-i18n-content="kabin.title" content="${DICT['kabin.title']}">`) && kp.includes(`<meta property="og:description" data-i18n-content="kabin.description" content="${DICT['kabin.description']}">`)
    && /<link rel="canonical" href="https:\/\/baqikk\.github\.io\/orbital-simulator\/kabin\.html">/.test(kp), 'kabin.html: link preview and canonical URL');
  assert.ok(/document\.title = _\('kabin\.title'\);/.test(read('js/cabin.js')), 'the page title from the cabin keys');
  assert.ok(/data-i18n="ui\.model9"/.test(html) && has('ui.model9'), 'the Model window names the illustrative break orbits');
}

// 17) Phase 10 pomodoro (js/pomodoro.js, a fake clock): wall-clock durations to the millisecond, pause and resume, a
// night asleep (phases end at their true times, statistics count once, no automatic start nobody saw), a clock set
// backwards, a reload, long breaks, skip and reset, the day boundary, broken saved data
{
  const T = require('../js/pomodoro.js'), MIN = 60000, t0 = new Date(2026, 9, 25, 9, 0, 0).getTime();
  const s = T.pomoNew('p25');
  assert.deepStrictEqual(s.cfg, { work: 25, short: 5, long: 15, every: 4 });
  assert.deepStrictEqual(T.pomoStart(s, t0), []);
  assert.strictEqual(T.pomoView(s, t0 + 60000).left, 24 * MIN, 'one minute in');
  assert.deepStrictEqual(T.pomoAdvance(s, t0 + 25 * MIN - 1), [], 'not yet over 1 ms before the end');
  assert.strictEqual(T.pomoView(s, t0 + 25 * MIN - 1).left, 1);
  let ev = T.pomoAdvance(s, t0 + 25 * MIN);
  assert.deepStrictEqual(ev, [{ type: 'end', phase: 'work', next: 'short', at: t0 + 25 * MIN, late: 0 }, { type: 'focus', ms: 25 * MIN, at: t0 + 25 * MIN, done: true }], 'work ends into the short break');
  assert.ok(s.phase === 'short' && s.t0 === t0 + 25 * MIN && s.n === 1 && s.flight === 1);
  ev = T.pomoAdvance(s, t0 + 30 * MIN + 5000);
  assert.ok(s.phase === 'wait' && ev[0].next === 'wait' && ev[0].late === 5000, 'a break ends into waiting for the user');
  // pause and resume: paused time does not count
  T.pomoStart(s, t0 + 40 * MIN);
  T.pomoPause(s, t0 + 50 * MIN);
  assert.strictEqual(T.pomoView(s, t0 + 90 * MIN).left, 15 * MIN, 'paused: the time left stands still');
  assert.ok(T.pomoView(s, t0 + 90 * MIN).paused && !T.pomoView(s, t0 + 90 * MIN).running);
  assert.deepStrictEqual(T.pomoAdvance(s, t0 + 300 * MIN), [], 'a pause never runs out');
  T.pomoStart(s, t0 + 100 * MIN);
  assert.strictEqual(T.pomoView(s, t0 + 110 * MIN).left, 5 * MIN, 'resumed');
  ev = T.pomoAdvance(s, t0 + 115 * MIN);
  assert.strictEqual(ev[0].at, t0 + 115 * MIN, 'ends 25 working minutes after the start, the pause added');
  // a night asleep: the work ended, its break ran out unseen; with auto on still no new session starts by itself
  const z = T.pomoNew('p25'); z.auto = true; T.pomoStart(z, t0);
  ev = T.pomoAdvance(z, t0 + 8 * 60 * MIN);
  assert.deepStrictEqual(ev.map(e => [e.type, e.phase || '', e.next || '', e.at]), [['end', 'work', 'short', t0 + 25 * MIN], ['focus', '', '', t0 + 25 * MIN], ['end', 'short', 'wait', t0 + 30 * MIN]], 'asleep: phases end at their true times, then the timer waits');
  assert.ok(ev[0].late > T.POMO_LATE, 'too late to chime');
  assert.deepStrictEqual(T.pomoAdvance(z, t0 + 8 * 60 * MIN + 1000), [], 'nothing is counted twice');
  const st = {}; T.pomoStatsAdd(st, ev); T.pomoStatsAdd(st, []);
  assert.deepStrictEqual(st, { [T.pomoDay(t0)]: [1, 25 * MIN] }, 'one session, 25 minutes');
  // waking up within the break: it goes on to its true end; seen in time, auto starts the next work at that moment
  const w = T.pomoNew('p25'); w.auto = true; T.pomoStart(w, t0);
  T.pomoAdvance(w, t0 + 27 * MIN);
  assert.ok(w.phase === 'short' && T.pomoView(w, t0 + 27 * MIN).left === 3 * MIN, 'woke in the break');
  ev = T.pomoAdvance(w, t0 + 30 * MIN + 2000);
  assert.ok(w.phase === 'work' && w.t0 === t0 + 30 * MIN && ev[0].late === 2000, 'auto: the next work starts at the break end');
  // the clock set back an hour mid-session: the elapsed time stays continuous
  const b = T.pomoNew('p25'); T.pomoStart(b, t0); T.pomoAdvance(b, t0 + 10 * MIN);
  T.pomoAdvance(b, t0 - 50 * MIN);
  assert.strictEqual(T.pomoView(b, t0 - 50 * MIN).left, 15 * MIN, 'clock set backwards: 15 minutes still left');
  assert.strictEqual(T.pomoView(b, t0 - 45 * MIN).left, 10 * MIN);
  // a reload: the saved state gives the same time left
  const r = T.parsePomo(JSON.stringify(b));
  assert.deepStrictEqual(r, b, 'saved and read back unchanged');
  assert.strictEqual(T.pomoView(r, t0 - 45 * MIN).left, 10 * MIN);
  T.pomoPause(r, t0 - 44 * MIN); const r2 = T.parsePomo(JSON.stringify(r));
  assert.ok(r2.pausedAt === r.pausedAt && T.pomoView(r2, t0 + 600 * MIN).left === 9 * MIN, 'a paused session reloads paused');
  // long break every 4th session (skips count for the cycle and the flight, not for the statistics)
  const c = T.pomoNew('p25'), all = []; let now = t0;
  for (let i = 0; i < 4; i++) { T.pomoStart(c, now); if (i === 2) { now += 10 * MIN; all.push(...T.pomoSkip(c, now)); } else { now += 25 * MIN; all.push(...T.pomoAdvance(c, now)); } now += c.phase === 'long' ? 15 * MIN : 5 * MIN; all.push(...T.pomoAdvance(c, now)); }
  assert.deepStrictEqual(all.filter(e => e.type === 'end' && e.phase === 'work').map(e => e.next), ['short', 'short', 'short', 'long'], 'the 4th break is the long one');
  assert.ok(all.some(e => e.skipped) && c.flight === 4 && c.n === 4, 'a skipped session moves the flight on');
  const cs = {}; T.pomoStatsAdd(cs, all);
  assert.deepStrictEqual(cs[T.pomoDay(t0)], [3, 85 * MIN], 'three done, 25 + 25 + 10 + 25 minutes of focus');
  assert.strictEqual(T.pomoView(c, now).phase, 'wait');
  // skipping a break; reset counts the minutes worked and starts the cycle over, the flight stays
  T.pomoStart(c, now); T.pomoAdvance(c, now + 25 * MIN); ev = T.pomoSkip(c, now + 26 * MIN);
  assert.ok(c.phase === 'wait' && ev[0].phase === 'short' && ev[0].skipped, 'skip a break');
  T.pomoStart(c, now + 30 * MIN); ev = T.pomoReset(c, now + 42 * MIN);
  assert.ok(c.phase === 'idle' && c.n === 0 && c.flight === 5 && ev.length === 1 && ev[0].ms === 12 * MIN && !ev[0].done, 'reset');
  // 50/10: long break after the 3rd; custom limits
  const f = T.pomoNew('p50'); f.n = 2; T.pomoStart(f, t0); T.pomoAdvance(f, t0 + 50 * MIN);
  assert.strictEqual(f.phase, 'long');
  assert.deepStrictEqual(T.pomoCfg({ work: 500, short: 0, long: -3, every: 1.6 }), { work: 120, short: 1, long: 0, every: 2 });
  const nl = T.pomoNew(); nl.cfg = T.pomoCfg({ work: 5, short: 1, long: 0, every: 2 }); nl.n = 1; T.pomoStart(nl, t0); T.pomoAdvance(nl, t0 + 5 * MIN);
  assert.strictEqual(nl.phase, 'short', 'long 0: no long break');
  // the day boundary: a session ending after midnight counts for the new day
  const d = T.pomoNew('p25'), late = new Date(2026, 9, 25, 23, 50).getTime(); T.pomoStart(d, late);
  const ds = {}; T.pomoStatsAdd(ds, T.pomoAdvance(d, late + 25 * MIN));
  assert.deepStrictEqual(Object.keys(ds), ['2026-10-26']);
  // statistics: the last 30 days, broken entries dropped
  const many = {}; for (let i = 1; i <= 40; i++) many[`2026-09-${String(i).padStart(2, '0')}`] = [1, 1];
  many.bad = [1, 1]; many['2026-10-01'] = [-1, 5];
  const ps = T.parsePomoStats(JSON.stringify(many));
  assert.strictEqual(Object.keys(ps).length, 30); assert.ok(!ps.bad && !ps['2026-10-01'] && ps['2026-09-40'] && !ps['2026-09-01']);
  assert.deepStrictEqual(T.parsePomoStats('[1,2]'), {}); assert.deepStrictEqual(T.parsePomoStats(null), {});
  // broken saved state: a fresh idle timer, or idle with the saved settings
  assert.deepStrictEqual(T.parsePomo('{'), T.pomoNew()); assert.deepStrictEqual(T.parsePomo(null), T.pomoNew());
  const bad = T.parsePomo(JSON.stringify({ v: 1, preset: 'custom', cfg: { work: 40, short: 8, long: 20, every: 3 }, auto: true, phase: 'work', t0: 'x', n: -2, plan: 'ma rs' }));
  assert.ok(bad.phase === 'idle' && bad.preset === 'custom' && bad.cfg.work === 40 && bad.auto && bad.n === 0 && bad.plan === 'em', 'per-field fallback');
  assert.strictEqual(T.parsePomo(JSON.stringify({ v: 1, phase: 'short', t0: 5, paused: 0, pausedAt: 3 })).phase, 'idle', 'a pause before the start is broken');
  assert.strictEqual(T.pomoClock(25 * MIN), '25:00'); assert.strictEqual(T.pomoClock(61500), '01:02'); assert.strictEqual(T.pomoClock(-5), '00:00');
  assert.ok(P.PREF_KEYS.pomo && P.PREF_KEYS.pomoStats, 'saved under pref keys');
  // the page: the clock opens the panel; notification permission is asked only in the switch's own change handler; the
  // bell is synthesised (no file), follows the level and "mute all", ducks the radio; the timer keeps no storage of its own
  const cab = read('js/cabin.js'), aud = read('js/cabin-audio.js'), po = read('js/pomodoro.js');
  assert.ok(/\$\('#hClock'\)\.addEventListener\('click', \(\) => poPanel\(\)\)/.test(cab), 'the clock opens the pomodoro panel');
  assert.strictEqual([...cab.matchAll(/requestPermission\(/g)].length, 1, 'one permission request');
  assert.ok(/\$\('#kPomoNotify'\)\.addEventListener\('change', e => \{[^]*?Notification\.requestPermission\(\)[^]*?\n\}\);/.test(cab), 'asked only from the switch');
  assert.ok(/if \(!PO\.notify \|\| !document\.hidden/.test(cab), 'notifications only while the tab is hidden');
  assert.ok(/function sndChime\(set, kind\) \{\n  if \(set\.muted \|\| !set\.chime\.on/.test(aud) && /linearRampToValueAtTime\(0\.2 \* lv/.test(aud) && !/audio\/cabin\/[a-z]+\/chime/.test(aud), 'bell: level, mute, ducked radio, no file');
  assert.ok(/document\.querySelector\('\.k-arow\[data-k=chime\]/.test(cab) && /data-k="chime"/.test(read('kabin.html')), 'the bell has its row in the sound panel');
  assert.ok(!/localStorage|sessionStorage|document|window/.test(po), 'pomodoro.js: no DOM, no storage');
  assert.ok(!/setInterval\(clockTick/.test(cab) && /setInterval\(\(\) => \{ poDo\(pomoAdvance\); saverTick\(\); \}, 1000\)/.test(cab), 'one tick a second drives the clock');
  assert.ok(/id="kPomoDay"/.test(read('kabin.html')) && /LAP\.today\.textContent = /.test(cab) && /pomoStatsAdd\(st, ev\)\) writePref\(LS, PREF_KEYS\.pomoStats/.test(cab), 'daily statistics: saved, in the panel and on the laptop');
}

// 18) Phase 10 flight plans: every plan has its name and the HUD text of every leg; the break label names its body
{
  const F = require('../js/flightplans.js'), { FLIGHT_DATA } = require('../js/flightdata.js');
  for (const id of F.FP_IDS) {
    const D = F.fpPlan(FLIGHT_DATA[id], { cfg: { every: 4 } }); assert.ok(D && has('fp.name.' + id), 'plan name: ' + id);
    D.legs.forEach((leg, j) => {
      const w = F.fpLabel(id, D, { leg: j, mode: 'work', u: 0.5 }); assert.ok(has(w.key), `${id}: ${w.key}`);
      const b = F.fpLabel(id, D, leg.brk.cruise ? { leg: j, mode: 'cruise' } : { leg: j, mode: 'orbit' }); assert.ok(has(b.key) && (!b.p.b || has('body.' + b.p.b)), `${id}: break ${b.key}`);
    });
  }
  for (const k of ['fp.plan', 'fp.name.none', 'fp.restart', 'fp.note', 'fp.mars.done', 'fp.mars.approach']) assert.ok(has(k), k);
  // the light through the glass: off in the low-resource mode (not computed, not shown); the body colour only mixed
  // into the screen token
  const cab = read('js/cabin.js'), css = read('css/style.css');
  assert.ok(/function fvShineRun\(\) \{ if \(!LOWQ && /.test(cab) && /html\[data-q=low\] \.k-shine\{display:none\}/.test(css), 'cabin light: off in low mode');
  assert.ok(/color-mix\(in srgb, var\(--cab-screen\) 35%, \$\{BODIES\[FV\.shCol\]\.color\}\)/.test(cab), 'cabin light: body colour mixed into the screen cyan');
  // the light is geometric (no screen size in it), low-pass filtered in JS without a CSS transition, and held, like the
  // 3D frames and the art tier swap, while the camera moves between desk and glass (a moving room flickered)
  const tgt = cab.match(/function fvShineTarget\([^]*?\n\}/)[0];
  assert.ok(!/\bVW\b|\bVH\b|SP\.F|rpx/.test(tgt) && /FV_FOV_SR/.test(tgt), 'cabin light: solid angle in the field of view, not screen area');
  assert.ok(!/\.k-shine\{[^}]*transition/.test(css) && /FV\.shV \+= \(FV\.shTarget - FV\.shV\) \* \(1 - Math\.exp\(-dt \/ FV_SHINE_TAU\)\)/.test(cab), 'cabin light: low-pass filter, no CSS transition');
  assert.ok(/if \(ANIM \|\| document\.hidden\) return; \/\/ held while the camera moves/.test(cab) && /if \(ANIM\) TIER_SWAP = swap; else swap\(\);/.test(cab), 'held during the camera move: light, tier swap');
  assert.ok(!/if \(ANIM && !force\) return/.test(cab) && !/if \(ANIM\) \{ FV\.timer/.test(cab), 'the view through the glass keeps flowing during the move');
  // in a break (or a fast picture) the glass is drawn on every animation frame (30 a second in low-resource mode), its
  // time from performance.now() anchored to the wall clock; reduced motion keeps a slow timer
  assert.ok(/if \(tp - FV\.last < \(FV\.fast \? \(LOWQ \|\| DEV\.phone \? 32 : 0\) :/.test(cab) && /FV\.fast = st\.w\.mode !== 'work' \|\|/.test(cab) && /st = fvState\(wallNow\(t\)\)/.test(cab) && /FV\.last = tp; fvFrame\(false, tp\);/.test(cab) && !/t - FV\.drawn < 50/.test(cab), 'glass: every frame in a break, continuous time');
  assert.ok(/if \(!FV\.on \|\| document\.hidden \|\| RM\.matches\) return;/.test(cab) && /FV\.timer = setTimeout\(fvKick, FV\.fade \? 470 : RM\.matches \? 5000 : 60000\);/.test(cab), 'glass: reduced motion, a still picture every 5 s');
  // camera moves: the room, its light and shade and the cat on screen-sized canvases (those DOM layers hidden
  // meanwhile), the DOM stage back at rest at the shown tier; no will-change on the stage (only with
  // ?debug=1&move=dom&wc=1); no blend mode on the large light and shade layers; the canvases draw from a decoded set no
  // sharper than MV_CAP
  assert.ok(/const cv = mvBegin\(\), wc = !cv && DBG && DBG\.wc;/.test(cab) && /if \(MV\.on\) drawMove\(CAM\);/.test(cab) && /tierSwapNow\(\); sizeLife\(\); lifeNow\(\); mvEnd\(\);/.test(cab) && /drawMove\(CAM\); \$\('#kRoot'\)\.classList\.add\('k-moving'\);/.test(cab), 'camera move on the canvases, DOM back at rest; each handoff in one task, the side taking over complete first');
  assert.ok(!/willChange = 'transform'/.test(cab) && (cab.match(/stageWC\('transform'\)/g) || []).length === 1, 'no will-change on the stage outside the debug switch');
  assert.ok(/\.k-moving :is\(#kGlow,#kRoomSlot,#kShine,#kAqua,#kSteam,#kNight,#kSun,#kCat\)\{visibility:hidden\}/.test(css), 'DOM room layers hidden during the move');
  assert.ok(!/mix-blend-mode/.test(css.match(/\.k-night\{[^}]*\}/)[0] + css.match(/\.k-shine\{[^}]*\}/)[0]), 'no blend mode on the light and the shade');
  assert.ok(/const DEC = \{\}, MV_CAP = 3840;/.test(cab) && /const T = ks\.filter\(t => t <= MV_CAP\)\.pop\(\) \|\| ks\[0\]/.test(cab), 'move canvases: tier up to MV_CAP');
  // art tiers and planet textures stay within the GPU's texture limit; the debugging overlay exists only with ?debug=1
  assert.ok(/const TMAX = Math\.min\(cabTierMax\(DEV\), GPU\.max \?/.test(cab) && /const TEX_CAP = Math\.min\(DEV\.phone \? 2048 : 4096, GPU\.max \|\| Infinity/.test(cab) && !/DEV\.phone \? 2048 : 4096, FX/.test(cab), 'GPU texture limit respected');
  assert.ok(/if \(q\.get\('debug'\) !== '1'\) return null;/.test(cab) && /if \(DBG\) setInterval\(dbgShow, 250\);/.test(cab) && /if \(LOWQ\) return \{ gl2: false, max: 0 \};/.test(cab), 'debug overlay only with ?debug=1; no GPU probe in low mode');
  // light from outside: the room measured on the art agrees with the card (a rectangle on the desk once back-projected);
  // the patch lands on the sill and the desk, shifts against the light, none when the light goes up; eclipses cover the
  // Sun's disc smoothly; off in low-resource mode and on phones; no blend mode; hidden with the room during moves; the
  // ceiling strip off by default
  {
    const LY2 = JSON.parse(read('img/cabin/layout.json')), R = P.CAB_ROOM, q = LY2.card.map(a => P.cabUnproject(a, R.desk.y));
    const sd = [0, 1, 2, 3].map(i => [q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][2] - q[i][2]]), len = v => Math.hypot(...v);
    assert.ok(Math.abs(len(sd[0]) - len(sd[2])) < 0.02 * len(sd[0]) && Math.abs(len(sd[1]) - len(sd[3])) < 0.02 * len(sd[1]), 'room: the card back-projects with equal opposite sides');
    const cosA = (sd[0][0] * sd[1][0] + sd[0][1] * sd[1][1]) / len(sd[0]) / len(sd[1]);
    assert.ok(Math.abs(cosA) < Math.sin(1.5 * Math.PI / 180), 'room: the card back-projects with right angles');
    const o = P.cabGlassOutline(LY2.glass), n = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
    assert.strictEqual(P.cabLightPatch(n([0, -0.5, 1]), o), null, 'light going up: no patch');
    const p0 = P.cabLightPatch(n([0, 1, 1]), o), p1 = P.cabLightPatch(n([0.5, 1, 1]), o), mx = a => a.reduce((s, v) => s + v[0], 0) / a.length;
    assert.ok(p0.sill.length > 2 && p0.desk.length > 2, 'light down: sill and desk');
    assert.ok(p0.sill.every(v => v[1] >= R.sill.y - 1 && v[1] <= P.cabProject([0, R.sill.y, R.sill.z])[1] + 1), 'sill patch on the sill');
    assert.ok(p0.desk.every(v => v[1] >= R.desk.y - 1 && v[1] <= P.cabProject([0, R.desk.y, R.desk.z])[1] + 1), 'desk patch on the desk');
    assert.ok(mx(p1.desk) > mx(p0.desk) + 100, 'light from the left: the patch to the right');
    assert.ok(P.cabDiscCover(0.005, 0.3, 1) === 0 && P.cabDiscCover(0.005, 0.3, 0.1) === 1 && Math.abs(P.cabDiscCover(0.005, 0.3, 0.3) - 0.5) < 0.02, 'eclipse cover');
    let prev = 1; for (let d = 0.29; d <= 0.31; d += 0.0005) { const v = P.cabDiscCover(0.005, 0.3, d); assert.ok(v <= prev + 1e-9); prev = v; }
    assert.ok(/const LT_SIDE = \[75 \* deg, 95 \* deg\]/.test(cab) && /let so = look\(sd, sal\); \{ const sw = side\(sd\);/.test(cab) && /const LT_LAMP = 1,/.test(cab) && /te = Math\.max\(LT_BIG_TE, se \/ n\)/.test(cab), 'light from outside: the Sun in front of the window lights the room unseen; big bodies on the desk; the lamp does not dim it');
    assert.ok(/const LT_ON = !LOWQ && !DEV\.phone && \(!DBG \|\| DBG\.sun\);/.test(cab) && /function ltRun\(\) \{ if \(LT_ON && /.test(cab), 'light from outside: off in low mode, on phones, with sun=0');
    assert.ok(/if \(ANIM \|\| document\.hidden\) return; \/\/ held while the camera moves \(and unseen\)\n  let tg = \{\};/.test(cab), 'light from outside: held during camera moves');
    assert.ok(!/mix-blend-mode/.test(css) && /\.k-moving :is\([^)]*#kSun,#kCat\)\{visibility:hidden\}/.test(css), 'no blend modes; light hidden with the room during moves');
    assert.ok(!/strip/i.test(cab.replace(/\/\/[^\n]*/g, '')) && !/kStrip|strip-on/.test(css + read('kabin.html')) && !P.PREF_KEYS.cabStrip && !has('kab.stripOn') && !has('kab.strip') && P.PREF_OLD.includes('orbsim.cab.strip') && /for \(const k of PREF_OLD\) clearPref\(LS, k\);/.test(cab), 'ceiling strip gone: no button, area, drawing, key or words; the old setting cleared');
  }
  // narrow screens at the glass: one compact row, the other buttons folded into ⋯
  assert.ok(css.includes('.k-win:not(.k-more-open) .k-hud.bot>:is(#kVista,#kLamp){display:none}') && read('kabin.html').includes('id="kMore"') && has('kab.more') && cab.includes('cabGlassCam(VW, VH, LY.glass, ...LY.size, winBot())'),'compact bar at the glass on phones; the view keeps the cat above it');
  // at the glass the cat still answers (petting), the other objects rest
  assert.ok(cab.includes("querySelectorAll('.k-hit:not(#hGlass):not(#hCat)')) b.inert = to !== 'desk';"), 'the cat can be petted at the glass');
  // petting: the existing layers only (no new image), tail / ears / whiskers on the body so they move with it; reactions
  // never repeat back to back; too much gives a rest; reduced motion and low mode only move the ears a little; the purr
  // and the "mrr" are synthesised (no file), with their own row in the sound panel, after a gesture like the rest
  {
    const aud = read('js/cabin-audio.js'), page = read('kabin.html');
    assert.ok(/for \(const n of \['tail', 'earL', 'earR'\]\) part\(n, body, B\.x, B\.y\);/.test(cab) && /body\.appendChild\(wk\)/.test(cab), 'petting: tail, ears and whiskers ride on the body');
    assert.ok(/const kinds = PET_KINDS\.filter\(k => k !== PET\.kind\)/.test(cab) && /if \(PET\.tire > 1 && !resting\) petEnough\(now\);/.test(cab), 'petting: no repeated reaction, a rest after too much');
    assert.ok(/if \(small\) \{ earL \*= 0\.35; earR \*= 0\.35; body = 0; bsx = bsy = 1; tail = 0; \}/.test(cab), 'petting: reduced motion moves only the ears a little');
    assert.ok(/function sndPurr\(set, level\)/.test(aud) && /function sndMrr\(set\)/.test(aud) && !/purr\.(mp3|webm|ogg|wav)/.test(aud + cab), 'purr synthesised, no file');
    assert.ok(/const PET_SOUND = false;/.test(cab) && !/data-k="purr"/.test(page), 'purr: off for now, no panel row');
    assert.ok(!/<img[^>]*cat/i.test(page) && !/img\/cabin\/[^'"`]*(heart|pose)/.test(cab), 'petting: no new pictures');
  }
  // the laptop follows the plan while it flies
  assert.ok(/if \(st\) \{ lapPlan\(st\); return; \}/.test(cab), 'laptop: the plan track');
}

// 19) "Solve for the target" goes through core.js solveMission (worker and main-thread fallback alike) and trusts its
// physical verdict, never the residual; a miss is said plainly (with how far off), in the warning colour, never "solved"
{
  const app = read('js/app.js');
  assert.ok(/const r = await solveMission\(s, M, \{ \.\.\.opt, onProgress/.test(app) && /if \(!w\) return solveMission\(sysLocal, M,/.test(app), 'worker and fallback use solveMission');
  assert.ok(!/(optimize|refineSeed)\(s, M, \{ \.\.\.opt/.test(app) && !/r\.f < /.test(app), 'no residual threshold decides "solved"');
  assert.ok(/if \(!r\.hit\) setStatus\(_\(Number\.isFinite\(r\.miss\) && r\.miss < 1e6 \? 'st\.nearest' : 'st\.nearestNone', \{ km: nf1\.format\(r\.miss\) \}\) \+ info, true\);/.test(app), 'a miss: the nearest attempt, said as such');
  assert.ok(/\{km\}/.test(DICT['st.nearest']) && /çözüm değil/.test(DICT['st.nearest']) && has('st.nearestNone') && has('st.tries'), 'miss texts');
  assert.ok(/\.status\.warn\{color:var\(--warn\)\}/.test(read('css/style.css')), 'warning colour');
}

// 20) Phase 14 cabin views and screen saver: every view has its name and line; the picker is built from VISTA_IDS (no view
// written into the markup); the pick and the saver's idle start are saved (off by default); the saver asks for full screen
// only from its button, hides the interface, ends on input, keeps the pomodoro in a corner and its bell; a view in
// low-resource mode is a still picture; phones at most 30 frames a second; Phobos' shape from the PCK
{
  const V = require('../js/vistas.js'), cab = read('js/cabin.js'), page = read('kabin.html'), css = read('css/style.css');
  for (const id of V.VISTA_IDS) for (const k of ['kab.vista.' + id, 'kab.vista.' + id + '.d']) assert.ok(has(k), 'view text: ' + k);
  for (const k of ['kab.vista.label', 'kab.vista.title', 'kab.vista.flight', 'kab.saver.start', 'kab.saver.auto', 'kab.saver.off', 'kab.saver.after', 'kab.saver.note', 'ui.model10']) assert.ok(has(k), k);
  assert.ok(/\{m\}/.test(DICT['kab.saver.after']), 'idle minutes in the text');
  assert.ok(/for \(const id of VISTA_IDS\) \{/.test(cab) && !/data-v="/.test(page) && /id="kVistaList"/.test(page), 'picker built from VISTA_IDS');
  assert.ok(['earth', 'saturn'].every(k => V.VISTAS[k]) && /if \(VISTAS\[from\]\) writePref\(LS, PREF_KEYS\.cabScene, from\);/.test(cab), 'the simulator\'s ?manzara= still lands');
  assert.deepStrictEqual(P.parseCabSaver(null), { auto: 0 }, 'saver: off by default');
  assert.deepStrictEqual(P.parseCabSaver('{"auto":10}'), { auto: 10 }); assert.deepStrictEqual(P.parseCabSaver('{"auto":7}'), { auto: 0 }, 'saver: only listed minutes');
  assert.ok(P.PREF_KEYS.cabSaver && P.CAB_SAVER_AUTO[0] === 0, 'saver: saved under its key');
  assert.strictEqual([...cab.matchAll(/requestFullscreen\(/g)].length, 1, 'one full-screen request');
  assert.ok(/if \(user && de\.requestFullscreen/.test(cab) && /\$\('#kSaverGo'\)\.addEventListener\('click', \(\) => saverStart\(true\)\)/.test(cab) && /saverStart\(false\)/.test(cab), 'full screen only from the button');
  assert.ok(/\.k-saver :is\(\.k-hud,\.k-flight,\.k-audio,\.k-tip\)\{display:none!important\}/.test(css) && /\.k-saverhit\{position:fixed;inset:0;z-index:8\}/.test(css), 'saver: interface hidden, an overlay takes the input');
  assert.ok(/for \(const t of \['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'\]\) addEventListener\(t, saverInput/.test(cab), 'saver: any input ends it');
  assert.ok(/saverClock\(v\)/.test(cab) && /function poEnded\(e\) \{[^]*?sndChime\(/.test(cab), 'saver: the pomodoro in a corner, its bell as ever');
  assert.ok(/if \(LOWQ && FV\.vista\) \{ cancelAnimationFrame\(FV\.raf\); FV\.raf = 0; FV\.timer = setTimeout\(fvKick, 60000\); return; \}/.test(cab), 'low-resource mode: a view is a still picture');
  assert.ok(/LOWQ \|\| DEV\.phone \? 32 : 0/.test(cab), 'phones: at most 30 frames a second');
  // a flight plan locks the views (not a timer without one): a note and "end the pomodoro", asked once, then the timer stops
  assert.ok(/const st = fvState\(Date\.now\(\)\), fl = !!\(st && st\.D\);/.test(cab) && /b\.addEventListener\('click', \(\) => viPick\(id\)\);/.test(cab) && /if \(!FV\.flight\) \{ viSet\(id\); return; \}/.test(cab) && /poSet\(s => \{ s\.plan = ''; s\.flight = 0; \}\); if \(id\) viSet\(id\);/.test(cab) && has('kab.vista.planAsk') && /\$\('#kVistaLock'\)\.hidden = !FV\.flight;/.test(cab), 'a flight plan holds the glass; a view picked then asks, drops the plan and keeps the timer');
  assert.ok(/\$\('#kPomoEnd'\)\.addEventListener\('click', \(\) => \{ \$\('#kVistaAsk'\)\.hidden = true; \$\('#kPomoAsk'\)\.hidden = false;/.test(cab) && /\$\('#kPomoEndYes'\)\.addEventListener\('click', \(\) => \{ \$\('#kPomoAsk'\)\.hidden = true; poDo\(pomoReset\); viUi\(\); \}\);/.test(cab) && ['kab.vista.end', 'kab.vista.endAsk', 'kab.vista.endYes', 'kab.vista.endNo'].every(has) && /id="kPomoEnd"/.test(page), 'end the pomodoro: asked once, then reset');
  assert.ok(/function viF\(id\) \{ const fw = vistaLens\(id\); return fw \? SP\.GV\[0\] \/ 2 \/ Math\.tan/.test(cab) && /SP\.GV = \[\(x1 - x0\) \* d\.s, \(y1 - y0\) \* d\.s\]/.test(cab), 'a telephoto lens spans the glass the desk view shows');
  assert.ok(V.VISTAS.earth.pick === 12 && V.vistaLens('earth') === 42, 'Earth–Moon: 12 000 km, a 42° lens by default');
  assert.ok(/if \(FV\.sig && sig !== FV\.sig && !still\(\)\)/.test(cab) && /xfSnap\(pv, wrap \? 2500 : VI\.dur\)/.test(cab), 'cross-fade, never in low-resource mode or with reduced motion');
  const { BODIES } = require('../js/bodies.js');
  assert.deepStrictEqual(BODIES.phobos.shape, [13.0, 11.4, 9.1], 'Phobos: PCK triaxial radii');
  assert.ok(/uniform vec3 uSun, uCam, uAx;/.test(read('js/view3d.js')) && /uAx: new THREE\.Vector3\(1, 1, 1\)/.test(read('js/view3d.js')), 'triaxial globe in 3D');
}

// 21) Panning the room with a finger (desk view, a crop that hides part of the room): the rubber band never stretches
// more than its reach and is the identity inside; the range spans the art; the sky canvas covers the screen at both
// views and the whole glass at the desk scale (a panned glass is never without sky); touch and pen only, a drag on the
// cat pets it, a tap stays a tap and the click after a drag is swallowed; the room moves on the move canvases; no glide
// and no animated return in reduced motion or low-resource mode; back to the focus when idle, at a pomodoro's end and on
// the way to the glass; the lamp in the picture; the hint once, on touch screens
{
  const cab = read('js/cabin.js'), css = read('css/style.css'), page = read('kabin.html'), C = P.CAB_PAN;
  for (const x of [-500, -60, -1, 0, 30, 100, 101, 200, 5000]) {
    const y = P.cabRubber(x, 0, 100, 40);
    if (x >= 0 && x <= 100) assert.strictEqual(y, x, 'rubber: inside unchanged');
    else assert.ok(y > -40 && y < 140 && (x > 100 ? y > 100 : y < 0), 'rubber: past the edge, at most its reach');
  }
  let prev = -Infinity; for (let x = -300; x <= 400; x += 7) { const y = P.cabRubber(x, 0, 100, 40); assert.ok(y > prev); prev = y; }
  const LY2 = JSON.parse(read('img/cabin/layout.json')), [W, H] = LY2.size, g = LY2.glass;
  for (const [vw, vh] of [[375, 812], [414, 896], [390, 844], [1600, 900]]) {
    const d = P.cabCrop(vw, vh, W, H), r = P.cabPanRange(d, vw, W);
    assert.ok(Math.abs(d.x + r[0]) < 1e-9 && Math.abs(d.x + r[1] + vw / d.s - W) < 1e-6, 'pan range: the art\'s two edges');
    const w = P.cabGlassCam(vw, vh, g, W, H), gc = [(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2], scr = c => [(gc[0] - c.x) * c.s, (gc[1] - c.y) * c.s];
    const pd = scr(d), pw = scr(w), bx = P.cabSkyBox(vw, vh, pd, pw, (g.x1 - g.x0) * d.s, (g.y1 - g.y0) * d.s);
    // the box moves with the glass: at a camera whose glass centre is at q, it spans [q − g, q − g + size]
    const covers = (q, x0, x1, y0, y1) => q[0] - bx.g[0] <= x0 + 1e-6 && q[0] - bx.g[0] + bx.w >= x1 - 1e-6 && q[1] - bx.g[1] <= y0 + 1e-6 && q[1] - bx.g[1] + bx.h >= y1 - 1e-6;
    assert.ok(covers(pd, 0, vw, 0, vh) && covers(pw, 0, vw, 0, vh), `sky box ${vw}×${vh}: the screen at desk and window`);
    for (const px of [r[0], 0, r[1]]) { const q = [pd[0] - px * d.s, pd[1]]; assert.ok(covers(q, q[0] - (g.x1 - g.x0) * d.s / 2, q[0] + (g.x1 - g.x0) * d.s / 2, q[1] - (g.y1 - g.y0) * d.s / 2, q[1] + (g.y1 - g.y0) * d.s / 2), `sky box ${vw}×${vh}: the whole glass when panned`); }
    // phones: only the glass the screen shows over the pan range (with the stretch), smaller
    const rb = C.rubber, pr = [r[0] * d.s - rb, r[1] * d.s + rb], gwin = [(g.x1 - g.x0) * w.s, (g.y1 - g.y0) * w.s], bp = P.cabSkyBox(vw, vh, pd, pw, (g.x1 - g.x0) * d.s, (g.y1 - g.y0) * d.s, 40, pr, gwin);
    const coversP = (q, x0, x1, y0, y1) => q[0] - bp.g[0] <= x0 + 1e-6 && q[0] - bp.g[0] + bp.w >= x1 - 1e-6 && q[1] - bp.g[1] <= y0 + 1e-6 && q[1] - bp.g[1] + bp.h >= y1 - 1e-6;
    // the glass the screen shows (screen ∩ glass) at a camera: glass centre q, scale s; checked panned at the desk view and along the move to the window view
    const shown = (q, s) => { const hw = (g.x1 - g.x0) * s / 2, hh = (g.y1 - g.y0) * s / 2; return [Math.max(0, q[0] - hw), Math.min(vw, q[0] + hw), Math.max(0, q[1] - hh), Math.min(vh, q[1] + hh)]; };
    for (const px of [pr[0] / d.s, r[0], 0, r[1], pr[1] / d.s]) { const q = [pd[0] - px * d.s, pd[1]]; assert.ok(coversP(q, ...shown(q, d.s)), `phone sky box ${vw}×${vh}: the shown glass panned by ${px.toFixed(0)}`); }
    for (let k = 0; k <= 20; k++) { const t = k / 20, q = [pd[0] + (pw[0] - pd[0]) * t, pd[1] + (pw[1] - pd[1]) * t], s = d.s * Math.pow(w.s / d.s, t); assert.ok(coversP(q, ...shown(q, s)), `phone sky box ${vw}×${vh}: the shown glass along the move (${t})`); }
    assert.ok(bp.w * bp.h < bx.w * bx.h, `phone sky box ${vw}×${vh}: smaller (${bp.w}×${bp.h} vs ${bx.w}×${bx.h})`);
  }
  assert.ok(C.idle >= 8000 && C.idle <= 10000 && C.rubber > 0 && C.tap >= 6, 'pan: idle 8–10 s, a stretch, a tap threshold');
  assert.ok(/if \(e\.pointerType === 'mouse' \|\| !e\.isPrimary \|\| !panAble\(\)[^\n]*e\.target\.closest\('#hCat'\)\) return;/.test(cab), 'pan: touch and pen only, not from the cat');
  assert.ok(/if \(Math\.abs\(dx\) <= CAB_PAN\.tap\) return;/.test(cab) && /ROOT\.addEventListener\('click', e => \{ if \(PAN\.eat\)/.test(cab), 'pan: a tap stays a tap, the click after a drag is swallowed');
  { const pb = cab.slice(cab.indexOf('function panBegin()'), cab.indexOf('// stop whatever moves')), ps = cab.slice(cab.indexOf('function panShow(x)'), cab.indexOf('function panBegin()'));
    assert.ok(!/mvBegin|drawMove|mvEnd|cvSize/.test(pb + ps) && ps.includes('apply(deskAt(PAN.show), true);'), 'pan: no canvas drawn or sized, the DOM stage translated');
    assert.ok(cab.includes(": live ? `translate3d(${-c.x * c.s}px") && cab.includes("(live ? `translate3d(${-c.x}px") && cab.includes('PAN.x = PAN.show = panPixel(PAN.show); apply(deskAt(PAN.show));'), 'pan: translate3d while it moves, at rest on a whole pixel as a 2D transform'); }
  assert.ok(/if \(still\(\)\) \{ PAN\.x = Math\.min\(hi, Math\.max\(lo, PAN\.x\)\); panShow\(PAN\.x\); panEnd\(\); return; \}/.test(cab) && /if \(still\(\)\) \{ PAN\.x = 0; panBegin\(\); panShow\(0\); panEnd\(\); return; \}/.test(cab), 'pan: no glide, no animated return in reduced motion and low mode');
  assert.ok(/PAN\.timer = setTimeout\(\(\) => \{ if \(!PAN\.drag\) panHome\(\); \}, CAB_PAN\.idle\)/.test(cab) && /function poEnded\(e\) \{\n  panHome\(\);/.test(cab) && /panStop\(\); PAN\.x = 0; \/\/ a panned room goes back/.test(cab), 'pan: back to the focus when idle, at a pomodoro\'s end, via the glass');
  assert.ok(/\$\('#hLamp'\)\.addEventListener\('click'/.test(cab) && /id="kLamp"/.test(page), 'the lamp clickable in the picture and in the bar');
  assert.ok(/readPref\(LS, PREF_KEYS\.cabPanHint\) === '1'/.test(cab) && /writePref\(LS, PREF_KEYS\.cabPanHint, '1'\)/.test(cab) && /matchMedia\('\(pointer: coarse\)'\)/.test(cab) && has('kab.panHint') && /id="kPanHint"/.test(page), 'pan hint: once, on touch screens');
  assert.ok(css.includes('.k-root{touch-action:none}'), 'the room\'s pan is ours: no browser gesture under it (the panels are outside the room)');
}

// 22) Cabin memory (iOS Safari kills a tab over its memory and reloads it): canvases at most 2× the CSS size (1.5× on
// phones), art tiers at most 2560 on phones and iOS (never 7136), 2k planet textures and no 4k sky on phones, no MSAA
// there, hidden canvases freed, planet base images dropped when unused; the worst case computed from the same rules
// stays under 250 MB on phones; a start that died is followed by one in low-resource mode with a note; ?debug=1 shows
// the decoded memory
{
  const cab = read('js/cabin.js'), page = read('kabin.html'), L = JSON.parse(read('img/cabin/layout.json'));
  assert.strictEqual(P.cabDpr({ phone: true }, 3), 1.5); assert.strictEqual(P.cabDpr({ desktop: true }, 3), 2); assert.strictEqual(P.cabDpr({ desktop: true }, 1), 1);
  assert.strictEqual(P.cabTierMax({ phone: false, desktop: false, ios: true, mem: 8 }), 2560, 'iPad: 2560');
  assert.strictEqual(P.cabTierMax({ phone: true, desktop: false, ios: true }), 2560, 'iPhone: 2560, never 7136');
  for (const [vw, vh] of [[375, 812], [390, 844], [414, 896], [430, 932]]) {
    const dev = { phone: true, ios: true }, d = P.cabCrop(vw, vh, ...L.size), w = P.cabGlassCam(vw, vh, L.glass, ...L.size), g = L.glass;
    const gc = [(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2], scr = c => [(gc[0] - c.x) * c.s, (gc[1] - c.y) * c.s];
    const r = P.cabPanRange(d, vw, L.size[0]), box = P.cabSkyBox(vw, vh, scr(d), scr(w), (g.x1 - g.x0) * d.s, (g.y1 - g.y0) * d.s, 40, [r[0] * d.s - P.CAB_PAN.rubber, r[1] * d.s + P.CAB_PAN.rubber], [(g.x1 - g.x0) * w.s, (g.y1 - g.y0) * w.s]);
    // the worst view: Earth and Moon (Earth's surface, clouds, night, ocean; the Moon's surface and relief)
    const e = P.cabMemEstimate({ vw, vh, dpr: P.cabDpr(dev, 3), tier: P.cabTierMax(dev), layout: L, box, msaa: false, texCap: 2048, texLayers: 6, sky: 2048 });
    assert.ok(e.total < 250, `phone ${vw}×${vh}: ${e.total.toFixed(0)} MB decoded at worst (under 250)`);
  }
  assert.ok(/DPR = cabDpr\(DEV, devicePixelRatio\)/.test(cab) && /const TMAX = Math\.min\(cabTierMax\(DEV\)/.test(cab), 'cabin: canvas ratio and art tier from the device');
  assert.ok(/const TEX_CAP = Math\.min\(DEV\.phone \? 2048 : 4096/.test(cab) && /skyReady\(true, !DEV\.phone && /.test(cab), 'phones: 2k textures, no 4k sky');
  assert.ok(/m\.create\(FV\.cv, \{ antialias: !DEV\.phone && !DEV\.ios,/.test(cab) && /antialias: opts\.antialias !== false/.test(read('js/view3d.js')), 'no MSAA on phones and iOS');
  assert.ok(/if \(DEV\.phone \|\| DEV\.ios\) TEXOPT\.keepBase = false;/.test(cab) && /\(!base\.has\(f\) \|\| !TEXOPT\.keepBase\)/.test(read('js/globe.js')), 'phones: unused planet base images go');
  assert.ok(cab.includes('x.hidden = true; if (!KEEP_CV) cvSize(x, 0, 0);') && cab.includes('cv.hidden = true; if (!KEEP_CV) cvSize(cv, 0, 0);') && cab.includes('if (FV.V3) cvSize(SP.cv, 0, 0);') && cab.includes('const KEEP_CV = DEV.phone || DEV.ios;'), 'hidden canvases freed (desktop); phones keep the move and fade canvases once sized, no churn');
  // every canvas size goes through cvSize (resizes only on a change, counted for ?debug=1)
  { const body = cab.replace(/function cvSize[\s\S]*?\n\}\n/, ''); const bad = body.split('\n').filter(l => /(?<!style)\.(width|height)\s*=(?!=)/.test(l) && !/style\./.test(l.match(/(\S+)\.(width|height)\s*=(?!=)/)[1]));
    assert.deepStrictEqual(bad, [], 'canvas sizes only through cvSize'); }
  assert.ok(cab.includes('alloc: CVS.area * 4 / 1048576, resizes: CVS.n') && cab.includes('canvases allocated so far'), 'debug: canvas memory allocated so far and the resizes');
  assert.ok(cab.includes('const CRASHED = readPref(SS, PREF_KEYS.cabBoot) != null && !(BOX0 && BOX0.vis === false);') && /const LOWQ = CRASHED \|\| /.test(cab) && /addEventListener\('pagehide', \(\) => clearPref\(SS, PREF_KEYS\.cabBoot\)\)/.test(cab) && !/cabBoot\), 20000/.test(cab), 'safety net: a visit that died at any moment (the mark stays while open) → low-resource mode, unless it was hidden (a discarded tab)');
  assert.ok(has('kab.safeMode') && /id="kSafe"/.test(page) && cab.includes('if (CRASHED) safeNote();') && cab.includes("writePref(LS, PREF_KEYS.cabQ, 'normal'); location.reload();") && !/writePref\(LS, PREF_KEYS\.cabQ, 'low'\)/.test(cab), 'safety net: its note, back to normal; the crash never saves low');
  assert.ok(/function memDump\(\)/.test(cab) && /    memLine\(\),/.test(cab), 'debug: the decoded memory');
}

// 23) The main page's mode without asking: no first-run question; nothing saved, the device decides (a start that died,
// data saving, a small device — not on iOS, which does not tell), then the first seconds' frames; the choice is not
// saved; going light says so in a small note with "change"; the safety net as the cabin's
{
  const app = read('js/app.js'), page = read('index.html');
  assert.ok(!/askDlg|askMode/.test(app + page) && !has('ask.title'), 'no first-run question');
  assert.strictEqual(P.autoMode({ ios: false, mem: 8, cores: 8 }), 'normal');
  assert.strictEqual(P.autoMode({ ios: false, mem: 2, cores: 8 }), 'low', 'small memory');
  assert.strictEqual(P.autoMode({ ios: false, mem: undefined, cores: 2 }), 'low', 'two cores');
  assert.strictEqual(P.autoMode({ ios: true, mem: 2, cores: 2 }), 'normal', 'iOS: memory and cores are not trusted');
  assert.strictEqual(P.autoMode({ ios: true, crashed: true }), 'low', 'a start that died');
  assert.strictEqual(P.autoMode({ ios: false, mem: 8, cores: 8, saveData: true }), 'low', 'data saving');
  assert.strictEqual(P.autoModeFrames(Array(30).fill(1 / 60)), 'normal');
  assert.strictEqual(P.autoModeFrames([...Array(20).fill(0.05), ...Array(10).fill(1 / 60)]), 'low', 'slow frames');
  assert.strictEqual(P.autoModeFrames(Array(5).fill(0.1)), null, 'too few frames');
  assert.ok(/if \(start\.auto\) \{/.test(app) && /autoMode\(\{ crashed: CRASHED, saveData: /.test(app) && /if \(autoModeFrames\(AUTO\.dts\) === 'low' && MODE !== 'low'\) \{ setMode\('low', false\); liteTip\('lite\.text'\); \}/.test(app), 'the device, then the frames; not saved');
  assert.ok(/const CRASHED = readPref\(SS, PREF_KEYS\.simBoot\) != null;/.test(app) && /addEventListener\('pagehide', \(\) => clearPref\(SS, PREF_KEYS\.simBoot\)\)/.test(app) && /clearPref\(SS, PREF_KEYS\.simBoot\), 20000\)/.test(app), 'safety net on the main page');
  assert.ok(/id="liteTip"/.test(page) && has('lite.text') && has('lite.crash') && has('lite.change') && app.includes("$('#liteGo').addEventListener('click', () => { $('#liteTip').hidden = true; (liteTip.go || (() => setMode('normal', true)))(); });") && app.includes("function liteTip(key, goKey = 'lite.change', go = () => setMode('normal', true)) {"), 'the light note and its "change" (by default back to the normal mode, saved)');
}

// 24) Layout: on phones the view fills the screen down to the rail (100dvh, the home indicator's inset), no empty band;
// the windows' room above the timeline is none while it is hidden (the opening scene), so a window in its default spot
// sits under the view controls, and moves when they change height
{
  const css = read('css/style.css'), app = read('js/app.js');
  assert.ok(css.includes('.stage{grid-column:1;grid-row:1;height:calc(100vh - 54px - env(safe-area-inset-bottom,0px));height:calc(100dvh - 54px - env(safe-area-inset-bottom,0px))') && !css.includes('.stage{height:84vh'), 'phones: the view down to the rail');
  assert.ok(app.includes("function tlRoom() { const tl = $('#timeline').getBoundingClientRect(); $('#wins').style.setProperty('--tl-h', (tl.height ?") && app.includes("const o = new ResizeObserver(() => clampWins()); o.observe($('#ctrls')); o.observe($('#missionTag'));"), 'windows: no timeline room while it is hidden; they follow the controls (and the label at the top left)');
}

// 25) View controls, simple by default: the bar holds 2D / 3D, "follow" and the view menu; the menu the frames (plain
// names, a line each, a glossary link), map and camera, the switches and the sky, the quality and the expert switch;
// every old control keeps its id (moved, not copied); the expert layout puts them back, saved
{
  const app = read('js/app.js'), page = read('index.html');
  for (const id of ['viewMode', 'frameSeg', 'mapSeg', 'sizeSeg', 'followSeg', 'mapBtn', 'fit', 'topView', 'tSoi', 'tTracks', 'tGrid', 'tOsc', 'tSky', 'tMoons'])
    assert.strictEqual([...page.matchAll(new RegExp('id="' + id + '"', 'g'))].length, 1, 'one #' + id + ' still');
  for (const id of ['ctrlBar', 'dimSeg', 'viewBtn', 'viewMenu', 'qualSeg', 'expertUi', 'frameNote', 'frameGloss']) assert.ok(page.includes('id="' + id + '"'), '#' + id);
  for (const k of ['fr.inertial.d', 'fr.centered.d', 'fr.rot.d', 'fr.eq.d', 'fr.p0.d', 'fr.p1.d', 'vw.menu', 'vw.follow', 'vw.expert', 'vw.quality']) assert.ok(has(k), k);
  assert.strictEqual(DICT['fr.inertial'], 'Yıldızlara göre sabit', 'plain frame names');
  assert.ok(app.includes("function vwPut(el, slot) { vwHome(el); slot.appendChild(el); }") && app.includes("if (VW.expert) { for (const el of [$('#frameSeg'), ...cam, $('#followSeg'), $('.toggles')]) vwBack(el); }"), 'controls moved into the menu, back in the expert layout');
  assert.ok(app.includes("writePref(LS, PREF_KEYS.uiExpert, VW.expert ? '1' : '0')") && P.PREF_KEYS.uiExpert, 'the expert layout is saved');
  assert.ok(app.includes("if (VW.phone.matches && !VW.expert) vwPut($('#dimSeg'), slot('bar')); else vwBack($('#dimSeg'));"), 'phones: the view button and the follow control, the rest in the sheet');
}

// 26) The mode title at the top middle: the scene (and its way back once moved), a mission, one's own design, the map
{
  const app = read('js/app.js'), page = read('index.html');
  assert.ok(page.includes('id="modeChip"') && page.includes('id="modeBack"') && ['chip.scene', 'chip.free', 'chip.backSaturn', 'chip.backEarth', 'chip.replayTour', 'chip.mission', 'chip.design', 'chip.designMan', 'chip.map'].every(has), 'mode title and its texts');
  assert.ok(app.includes("if (SCENE.free) { t = _('chip.free'); back = SCENE.kind === 'earth' ? 'chip.backEarth' : SCENE.kind === 'tour' ? 'chip.replayTour' : 'chip.backSaturn'; }") && app.includes("$('#modeBack').addEventListener('click', () => { if (SCENE.on) { sceneSet(SCENE.kind); needFit = true; } });"), 'moved in the scene: a way back');
}
// 27) The start screen: four choices (the scene, a mission: the Moon or Mars, one's own design, the cabin), 2 × 2 on
// phones; remembered (not the cabin); Esc or a click outside is the scene; the logo opens it again
{
  const app = read('js/app.js'), page = read('index.html'), css = read('css/style.css');
  const ids = ['em_free', 'r_e_mars'];
  assert.strictEqual(P.parseStart('scene', ids), 'scene'); assert.strictEqual(P.parseStart('design', ids), 'design');
  assert.strictEqual(P.parseStart('mission:r_e_mars', ids), 'mission:r_e_mars'); assert.strictEqual(P.parseStart('mission:nope', ids), null); assert.strictEqual(P.parseStart('cabin', ids), null); assert.strictEqual(P.parseStart(null, ids), null);
  for (const g of ['scene', 'mission', 'design', 'fly', 'cabin']) assert.ok(page.includes('data-go="' + g + '"'), 'card ' + g);
  for (const sc of ['em_free', 'r_e_mars']) assert.ok(page.includes('data-sc="' + sc + '"') && app.includes("{ id: '" + sc + "'"), 'mission ' + sc);
  assert.ok(['start.title', 'start.scene', 'start.mission', 'start.design', 'start.cabin', 'start.foot', 'start.reopen'].every(has), 'start texts');
  assert.ok(app.includes("if (go === 'cabin') { writePref(LS, PREF_KEYS.start, 'scene'); return; }") && app.includes("$('#startBtn').addEventListener('click', () => startOpen(parseStart(readPref(LS, PREF_KEYS.start), SCENARIOS.map(s => s.id))));") && app.includes("if (e.key === 'Escape' && !$('#start').hidden) { e.stopPropagation(); startClose(); startScene(); }"), 'remembered, not the cabin; Esc: the scene; the logo opens it');
  assert.ok(/@media \(max-width:560px\)\{\n  \.start\{[^}]*\}\n  \.start-in\{[^}]*\}\n  \.start-cards,#startMis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(css) && css.includes('#startCards .start-card[data-go="fly"]{grid-column:1 / -1}'), 'phones: 2 × 2 (and "Kendin uç" across)');
  assert.ok(!page.includes('id="welcome"'), 'the old welcome card is gone');
  // Phase 16b: on every new visit (session), over the tour; not back from the cabin, from a link or on a reload in the
  // same session; the remembered choice only marks its card. Compact: at the bottom, the tour above it in view; phones
  // 2 × 2 in the lower half.
  assert.ok(P.startShow({ seen: false, snap: false, deep: false }), 'a new visit: the start screen');
  for (const o of [{ seen: true }, { snap: true }, { deep: true }]) assert.ok(!P.startShow({ seen: false, snap: false, deep: false, ...o }), 'not when ' + Object.keys(o)[0]);
  assert.strictEqual(P.sceneParam('?manzara=earth'), 'earth'); assert.strictEqual(P.sceneParam('?x=1&manzara=tour'), 'tour');
  assert.strictEqual(P.sceneParam('?manzara=pluto'), null); assert.strictEqual(P.sceneParam(''), null);
  assert.ok(app.includes("const seen = !!readPref(SS, PREF_KEYS.startSeen); writePref(SS, PREF_KEYS.startSeen, '1');") && app.includes("if (startShow({ seen, snap: !!SNAP, deep })) { APP.mode = 'scene'; startOpen(st); }"), 'shown per session, the remembered choice marked');
  assert.ok(P.PREF_KEYS.startSeen && has('start.last') && (page.match(/data-i18n-data-last="start\.last"/g) || []).length === 6, 'the "last choice" tag');
  assert.ok(/\.start\{[^}]*place-items:end center/.test(css) && /\.start-in\{[^}]*max-height:50vh/.test(css), 'compact: at the bottom; phones in the lower half');
}
// 28) The rail's names (hover on desktop, under the icons on phones), the less used ones in "Diğer" on phones so no name
// is shortened, and a short tour offered once when the viewer first chooses to design
{
  const app = read('js/app.js'), page = read('index.html'), css = read('css/style.css');
  for (const w of ['mission', 'bodies', 'results', 'overview', 'transfer', 'gloss', 'model', 'credits'])
    assert.ok(page.includes('data-win="' + w + '" data-i18n-aria-label="win.' + w + '" data-i18n-data-label="rail.' + w + '"') && has('rail.' + w), 'rail name ' + w);
  assert.ok(page.includes('data-i18n-data-label="rail.cabin"') && page.includes('data-i18n-data-label="rail.reset"') && page.includes('id="railMore"') && page.includes('id="railMoreList"'), 'cabin, reset, more');
  assert.ok(app.includes("more: ['bodies', 'transfer', 'engine', 'gloss', 'model', 'credits']") && app.includes("$('#resetWins')]"), 'the less used ones go into Diğer');
  assert.ok(css.includes('.rail-btn::after{content:attr(data-label)') && !css.includes('text-overflow:ellipsis;content:attr'), 'names from data-label, not cut');
  for (const k of ['tour.1', 'tour.2', 'tour.3', 'tour.4', 'tour.skip', 'tour.next', 'tour.done', 'tour.n']) assert.ok(has(k), k);
  assert.ok(P.PREF_KEYS.tour && app.includes('function tourStart() { if (readPref(LS, PREF_KEYS.tour)) return;') && app.includes("writePref(LS, PREF_KEYS.tour, '1')") && app.includes('setTimeout(tourStart, 700)'), 'tour once, skippable, from the design choice');
}
// 29) Guided missions: a caption line for each event (departure, leaving / entering a sphere of influence, the closest
// point, capture, the return); "Olaylarda dur" off by default, saved, stops at each event after the departure with "Devam";
// only in a mission chosen from the start screen
{
  const app = read('js/app.js'), page = read('index.html');
  for (const k of ['ui.evStop', 'ui.evStopTip', 'guide.go', 'guide.depart', 'guide.soiOut', 'guide.soiOutRoot', 'guide.soiIn', 'guide.peri', 'guide.capture', 'guide.aero', 'guide.raise', 'guide.return', 'guide.entry', 'guide.impact']) assert.ok(has(k), k);
  assert.ok(page.includes('id="guide"') && page.includes('id="guideGo"') && page.includes('<input type="checkbox" id="evStop">'), 'caption line, Devam, the switch (unchecked in the page)');
  assert.ok(P.PREF_KEYS.evStop && app.includes("stop: readPref(LS, PREF_KEYS.evStop) === '1'") && app.includes("writePref(LS, PREF_KEYS.evStop, GUIDE.stop ? '1' : '0')"), 'off by default, saved');
  assert.ok(app.includes("const guideOn = () => APP.mode === 'mission' && !!S.scenario && S.kind !== 'man'"), 'only in a guided mission');
  assert.ok(app.includes('if (e.t > 0 && e.t > GUIDE.last && e.t > t0 && e.t <= t1)') && app.includes('GUIDE.held = e; setPlayIcon();'), 'stops at events after the departure, holds for Devam');
  assert.ok(!app.includes("$('#modeChip'), $('#guide')]") && app.includes('function guidePlace()'), 'the caption at the top under the mode title, not an obstacle: the view does not move for it');
}
// 30) One follow control ("Takip: Satürn ▾", the choices in its menu, × lets go; the expert layout keeps the old row and
// tag); Turkish capitals keep their dots (no line box of 1 with overflow hidden on an uppercase label); in the scene the
// overview starts closed
{
  const app = read('js/app.js'), page = read('index.html'), css = read('css/style.css');
  assert.ok(page.includes('<html lang="tr">') && page.includes('id="followBtn"') && page.includes('id="followMenu"') && page.includes('id="followX"') && has('vw.followOn'), 'follow control');
  assert.ok(app.includes("vwPut($('#followSeg'), $('#followMenu'))") && app.includes("$('#followTxt').textContent = _('vw.followOn', { name: n || _('fo.free') })") && css.includes('html:not(.ui-expert) #focusTag,html:not(.ui-expert) .vw-follow>.lbl,html.ui-expert #followCtl{display:none}'), 'one control, the old ones in the expert layout');
  for (const rule of css.split('}')) if (/text-transform:uppercase/.test(rule) && /overflow:hidden/.test(rule) && /\/1[ ;]/.test(rule)) assert.ok(/padding:3px 0/.test(rule) || /padding:\s*3px/.test(rule), 'dots cut: ' + rule.trim().slice(0, 50));
  assert.ok(app.includes("for (const id of WIN_IDS) if (WINS[id].open) { SCENE.hide.add(id);"), 'scene: every open window aside (2026-11-21: Gök cisimleri too)');
  assert.ok(css.includes('.vw-btn{display:inline-flex;align-items:center;gap:7px}'), 'view button: icon and text apart');
}
// 31) Cabin pans on iPhone, fast ones too: the glide, the stretch, the spring back and the return only translate (no
// canvas, no layout, no sizeLife, no decode: counted in CVS.dur); a resize waits for the pan's rest, the same size does
// nothing, phones' canvases only grow for one width (Safari's toolbar); the browser does not pan, bounce or go back
// under the room; the black box every 500 ms with the last action; the crash note with the record to copy; the quality
// switch in ⋯, saved; a crash makes one start light without saving it
{
  const cab = read('js/cabin.js'), page = read('kabin.html'), css = read('css/style.css');
  const pan = cab.slice(cab.indexOf('const PAN = {'), cab.indexOf('// the hint, once on a touch screen'));
  assert.ok(!/layout\(\)|sizeLife\(|mvBegin|drawMove|cvSize\(|decode\(/.test(pan.replace('relayout()', '')), 'pan, glide, stretch, return: no layout, sizeLife, canvas or decode');
  assert.ok(cab.includes("panPhase('fling', PAN.v * deskCam().s);") && cab.includes("if (out != null) panPhase('rubber'") && cab.includes("panPhase('home');") && cab.includes("panPhase('drag');") && cab.includes('function cvCount(k) { CVS[k]++; if (PHASE) CVS.dur[k]++; }'), 'pan phases counted');
  assert.ok(cab.includes("cvCount(light ? 'place' : 'layout');") && cab.includes("cvCount('life');") && cab.includes("cvCount('decode');"), 'layout, sizeLife and decodes counted');
  assert.ok(cab.includes('if (PHASE) { PAN.relayout = true; return; } if (innerWidth === VW && innerHeight === VH) return; layout(KEEP_CV && innerWidth === VW') && cab.includes('if (PAN.relayout) { PAN.relayout = false; relayout(); }'), 'a resize waits for the rest; the same size does nothing; phones: the height alone only places again');
  assert.ok(cab.includes("if (light && !ANIM) { panStop(); PAN.x = 0; apply(cam); FV.cam = null; fvKick(); return; }") && cab.includes("cvCount(light ? 'place' : 'layout');"), 'height only: placed, no tier, no sizeLife, no realloc');
  assert.ok(cab.includes("if (FV.V3 && FV.sz !== key)") && cab.includes('const out = PLAIN.cv || (PLAIN.cv = document.createElement'), 'the 3D glass sized only on a change; one low-resource sky canvas');
  assert.ok(cab.includes('bx.w = STB.bw = Math.max(STB.bw, bx.w)') && cab.includes('const mh = KEEP_CV ? Math.max(VH, STB.h) : VH;') && cab.includes("grow = KEEP_CV && cv.dataset.vw === String(VW)"), 'phones: canvases only grow for one width');
  assert.ok(css.includes('.k-root{touch-action:none}') && css.includes('html:has(>body.k-page),.k-page{overscroll-behavior:none}') && cab.includes("ROOT.addEventListener('touchmove', e => { if (PAN.drag && PAN.drag.on) e.preventDefault(); }, { passive: false });"), 'no browser pan, bounce or back swipe');
  assert.ok(P.PREF_KEYS.cabBox && cab.includes('setInterval(() => { if (!document.hidden) boxWrite(); }, 500);') && cab.includes("boxWrite(); // hidden: vis false") && /act: PAN\.last\.a, v: PAN\.last\.v, at: PAN\.last\.t/.test(cab), 'black box: every 500 ms, the last action, its speed and time');
  assert.ok(has('kab.crashInfo') && has('kab.crashCopied') && has('kab.safeNormal') && cab.includes("if (BOX0) link('kab.crashInfo'"), 'crash note: the record to copy, back to normal');
  assert.ok(P.PREF_KEYS.cabQ && page.includes('id="kQual"') && ['kab.q.label', 'kab.q.low', 'kab.q.normal', 'kab.q.note'].every(has) && cab.includes('writePref(LS, PREF_KEYS.cabQ, b.dataset.q);') && css.includes('.k-more-open .k-hud.bot>#kQual{display:flex'), 'quality switch in ⋯, saved');
  assert.ok(/\{q\}/.test(DICT['kab.safeMode']), 'the note says the choice stays');
}
// 32) Switches for finding a crash on a real device (alone or together) and the black box's sound, images, real dpr,
// stage and layer estimate; the radio streams through <audio> (no decodeAudioData), generated buffers are counted
{
  const cab = read('js/cabin.js'), aud = read('js/cabin-audio.js'), css = read('css/style.css');
  assert.ok(!/decodeAudioData/.test(aud) && aud.includes('ctx.createMediaElementSource(el)'), 'the radio streams through media elements');
  assert.ok(aud.includes("const SND_OFF = (q => q.get('audio') === '0' || (q.get('bare') === '1' && !(q.get('keep') || '').split(',').includes('audio')))") &&aud.includes('  if (SND_OFF) return false;'), '?audio=0: no engine');
  assert.ok(aud.includes('SND.buf.n++; SND.buf.bytes += n * 2 * 4;') && (aud.match(/sndFree\(/g) || []).length >= 3, 'generated buffers counted in and out');
  assert.ok(cab.includes("const NOPAN = OFF('pan'), PAN_LEFT = QS.pan === 'left', NOGLASS = OFF('glass'), NOLIFE = OFF('life');") &&cab.includes("CAB_TIERS.includes(+QS.tier) ? +QS.tier : Infinity"), 'switches: pan, glass, life, tier');
  assert.ok(cab.includes('const panAble = () => !NOPAN &&') && cab.includes('if (NOGLASS || !LY ||') && cab.includes("if (NOLIFE) { for (const cv of [AQ.cv, ST.cv]) cvSize(cv, 0, 0); return; }") && css.includes('.k-nolife .k-cat,.k-nolife .k-cat *{animation:none!important}'), 'switches wired');
  { const a = cab.slice(cab.indexOf('function apply(c, live = false)'), cab.indexOf('// the bottom bar')); assert.ok(/if \(PAN_LEFT\) \{[\s\S]*marginLeft = m;[\s\S]*return;\s*\}/.test(a) && !/translate3d/.test(a.slice(a.indexOf('if (PAN_LEFT)'), a.indexOf('return;'))), '?pan=left: margin-left, no 3D transform'); }
  assert.ok(cab.includes("aud: typeof sndMem === 'function' ? sndMem() : null") && cab.includes('realDpr: devicePixelRatio, ...layerEst(), qs: QS') && cab.includes('imgMB: Math.round(m.img)'), 'black box: sound, images, real dpr, layer estimate, switches');
}
// 33) ?stage=zoom (CSS zoom instead of the scale; only on request: an iPhone crashed at once with it as the default);
// its own lengths in art px; the parts standing on the stage at rest removable one by one, ?bare=1 only the room image;
// the tip's place from the art box, not from getBoundingClientRect (unzoomed in WebKit)
{
  const cab = read('js/cabin.js');
  assert.ok(cab.includes("const STAGE_ZOOM = QS.stage === 'zoom';") && cab.includes("'stage', 'mask', 'paper', 'cat', 'top', 'cv', 'glow', 'bare', 'keep']"), 'zoom only on request; the parts at rest removable');
  assert.ok(cab.includes("BARE = QS.bare === '1', OFF = k => (BARE && !KEEP.has(k)) || QS[k] === '0';") && cab.includes("textContent: sel.join(',') + '{display:none!important}'") && read('js/cabin-audio.js').includes("q.get('bare') === '1'"), '?bare=1: only the room image; keep= brings parts back one at a time');
  assert.ok(cab.includes('const stageTf = (c, live) => STAGE_ZOOM ? (live ? `translate3d(${-c.x}px,${-c.y}px,0)` : `translate(${-c.x}px,${-c.y}px)`)') && cab.includes('for (const e of STAGES) e.style.zoom = s;'), 'zoomed: translate in art px, no scale()');
  assert.ok(cab.includes('(STAGE_ZOOM ? mp / b.s : mp)'), '?pan=left under zoom: the margin in art px');
  { const st = cab.slice(cab.indexOf('function showTip(b)'), cab.indexOf('function hideTip()')); assert.ok(!st.includes('.getBoundingClientRect()') && st.includes('HITS[b.id]'), 'the tip placed from the art box'); }
}

// 34) The opening tour (Phase 16b, prefs.js tourAt): Saturn → Jupiter → Mars → the Earth and the Moon → the Sun from the
// day's positions, for several dates: each stop held at its body and width, a continuous way that moves evenly on screen
// (van Wijk & Nuij: never more than a few % of the view's width per frame, the width never jumping), the view wide
// enough on the long hops to hold both ends, the end at the Sun with the inner planets in view, looked at from above.
{
  const C = require('../js/core.js'), K = ['sun', 'earth', 'moon', 'mars', 'jupiter', 'saturn'];
  const sy = C.buildSystem(K.map(k => { const d = BODIES[k]; return { name: k, mu: d.gm * 1e9, radius: d.radius * 1e3, parent: K.indexOf(d.parent), a: 0, orb: d.orb }; }));
  const X = new Float64Array(3 * K.length), V = new Float64Array(3 * K.length);
  assert.ok(Math.abs(P.OPEN_TOUR_S - 52) < 1e-9 && P.OPEN_TOUR.map(k => k.k).join() === 'saturn,jupiter,mars,earth,sun', 'tour: 52 s, its stops');
  for (const iso of ['2026-11-12T12:00:00Z', '2027-06-01T00:00:00Z', '2030-02-15T00:00:00Z']) {
    C.states(sy, C.utcToDays(Date.parse(iso)) * C.DAY, X, V);
    const Pp = {}; K.forEach((k, i) => { Pp[k] = [0, 1, 2].map(c => X[3 * i + c] - X[c]); });
    const D = P.tourDirs(Pp), dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    let t0 = 0, prev = null, shift = 0, dw = 0;
    for (let i = 0; i < P.OPEN_TOUR.length; i++) {
      const k = P.OPEN_TOUR[i];
      if (i) {
        // on the way, at its widest, both stops inside the view
        const a = Pp[P.OPEN_TOUR[i - 1].k], b = Pp[k.k];
        let best = Infinity;
        for (let f = 0; f <= 1; f += 0.005) { const m = P.tourAt(t0 + k.move * f, Pp, D); best = Math.min(best, Math.max(dist(m.t, a), dist(m.t, b)) / m.w); }
        assert.ok(best < 0.6, `${iso}: on the way to ${k.k} both ends in view (${best.toFixed(2)} of the width)`);
        t0 += k.move;
      }
      const h = P.tourAt(t0 + (k.hold || 0) / 2, Pp, D);
      assert.ok(dist(h.t, Pp[k.k]) < 1 && Math.abs(h.w / k.w - 1) < 1e-9 && h.stop === i, `${iso}: at ${k.k}`);
      assert.ok(Math.abs(Math.hypot(...D[i]) - 1) < 1e-9 && D[i][2] < 0, `${iso}: ${k.k} seen from above the ecliptic`);
      t0 += k.hold || 0;
    }
    for (let T = 0; T <= P.OPEN_TOUR_S + 2; T += 1 / 60) {
      const c = P.tourAt(T, Pp, D);
      if (prev) { shift = Math.max(shift, dist(c.t, prev.t) / Math.min(c.w, prev.w)); dw = Math.max(dw, Math.abs(Math.log(c.w / prev.w))); }
      prev = c;
    }
    assert.ok(shift < 0.03 && dw < 0.06, `${iso}: even motion (largest step ${(100 * shift).toFixed(1)} % of the view, width ×${Math.exp(dw).toFixed(3)} per frame)`);
    const end = P.tourAt(P.OPEN_TOUR_S + 30, Pp, D);
    assert.ok(end.done && dist(end.t, Pp.sun) < 1 && dist(Pp.mars, Pp.sun) < 0.5 * end.w && dist(Pp.earth, Pp.sun) < 0.5 * end.w, `${iso}: ends at the Sun, Mars and the Earth in view`);
  }
  // a hop of no distance is a plain zoom; the app aims with it in 2D and 3D, the cabin hands the tour over as Saturn
  const z = P.zoomPan(1, 100, 0);
  assert.ok(Math.abs(z.at(z.S)[1] - 100) < 1e-9 && z.at(z.S / 2)[0] === 0, 'zoom only');
  const app = read('js/app.js');
  assert.ok(app.includes('tourAt(SCENE.tt, P, SCENE.tD)') && /data-v="tour" data-i18n="wc.tour"/.test(html) && has('chip.replayTour') && has('wc.tour'), 'the tour stays on the scene switch, replayable');
  assert.ok(P.parseSimSnap(JSON.stringify({ at: 1000, scene: 'tour', map: false, K: {}, S: { kind: 'transfer', bodies: [], M: {} } }), 1000) !== null, 'back from the cabin to the tour');
}
// 35) The design wizard (Phase 16c, js/wizard.js): the mission window's face in the plain layout (the expert layout
// shows the full form); after app.js; its composed keys exist; every example flies (a plan without error, a Hohmann
// transfer chosen by the automatic method, within the body's sphere of influence); the result card follows updateResults.
{
  const C = require('../js/core.js'), wz = read('js/wizard.js'), css = read('css/style.css');
  assert.ok(/<script src="js\/mode3d\.js"><\/script>\n<script src="js\/engine-ui\.js"><\/script>\n<script src="js\/sim-audio\.js"><\/script>\n<script src="js\/fly\.js"><\/script>\n<script src="js\/app\.js"><\/script>\n<script src="js\/wizard\.js"><\/script>/.test(html), 'wizard.js after app.js; the engine window, the page\'s sound and the free flight before app.js (app.js calls them while starting)');
  assert.ok(css.includes('html:not(.ui-expert) #w-mission .win-b>:not(.wiz){display:none!important}') && css.includes('html.ui-expert #wiz{display:none}'), 'plain: the wizard; expert: the full form');
  for (const id of ['wiz', 'wzPick', 'wzForm', 'wzSteps', 'wzEx', 'wzRes', 'wzFoot', 'wzErr', 'wzGo', 'wzExpert']) assert.ok(html.includes('id="' + id + '"'), 'wizard element ' + id);
  for (const m of ['auto', 'hohmann', 'bielliptic']) assert.ok(has('wz.m.' + m) && has('wz.m.' + m + 'D'), 'method ' + m);
  for (const k of Object.keys(P.WIZ_EX)) assert.ok(has('wz.ex.' + k), 'example ' + k);
  assert.ok(app.includes("if (typeof wzAfterResults === 'function') wzAfterResults();"), 'the result card follows the results');
  assert.ok(wz.includes('maneuverAuto(o.mu, o.R, o0, o1, { k: 1 }, o.soi / 2)'), 'automatic: rb up to half the sphere of influence');
  const soi = k => { const d = BODIES[k], p = BODIES[d.parent], a = d.orb.jpl ? d.orb.jpl[0][0] * C.AU : d.orb.sat[0] * 1e3; return a * Math.pow(d.gm / p.gm, 0.4); };
  for (const [k, e] of Object.entries(P.WIZ_EX)) {
    const d = BODIES[e.body], Re = d.j2[1] * 1e3, mu = d.gm * 1e9, R = d.radius * 1e3;
    const ap = n => e['c' + n] === 'circ' ? [+e['h' + n], +e['h' + n]] : [+e['p' + n], +e['a' + n]];
    const [hp0, ha0] = ap(0), [hp1, ha1] = ap(1), rp1 = Re + hp1 * 1e3, ra1 = Re + ha1 * 1e3;
    const { o0, o1 } = C.mvOrbits({ hp0, ha0, i0: +e.i0, hp1, e1: (ra1 - rp1) / (ra1 + rp1), i1: +e.i1, type: 'hohmann', rb: 0, plane: 'comb', k: 1 }, Re);
    const a = C.maneuverAuto(mu, R, o0, o1, { k: 1 }, soi(e.body) / 2);
    assert.ok(!a.error && a.type === 'hohmann' && a.plan.burns.length >= 1 && ra1 < soi(e.body), `example ${k}: flies (${a.plan.dv.toFixed(0)} m/s)`);
  }
  // "Başka bir cisme git": its examples and texts; the cheapest window is searched only from the chosen date on, then the
  // app's own solver runs; a free return only between a body and its own moon
  const gex = (/const WZ_GEX = \{([\s\S]*?)\n\};/.exec(wz) || [])[1] || '';
  const gk = [...gex.matchAll(/^\s*(\w+): \{/gm)].map(m => m[1]);
  assert.ok(gk.length >= 3 && gk.every(k => has('wz.exg.' + k)), 'go: examples ' + gk.join(', '));
  for (const m of ['capture', 'flyby', 'free']) assert.ok(has('wz.arr.' + m) && has('wz.arr.' + m + 'D'), 'arrival ' + m);
  // "Serbest yanma": examples and texts; app.js flies type 'free' with core.js freeBurn, impulsive, no target ring
  const fex = (/const WZ_FEX = \{([\s\S]*?)\n\};/.exec(wz) || [])[1] || '', fk = [...fex.matchAll(/^\s*(\w+): \{/gm)].map(m => m[1]);
  assert.ok(fk.length >= 4 && fk.every(k => has('wz.exf.' + k)), 'free: examples ' + fk.join(', '));
  assert.ok(app.includes("if (free) simR = freeBurn(c, o0,") && app.includes("(M.thrust === 'fin' && M.type !== 'free')") && app.includes('MAN.burn || MAN.free ? []'), 'free: flown by freeBurn, impulsive, no target ring');
  {
    const d = BODIES.earth, mu = d.gm * 1e9, Re = d.j2[1] * 1e3, s = C.freeBurn({ mu, R: d.radius * 1e3, J2: 0, Re, rot: null, O0: 0 }, { rp: Re + 400e3, ra: Re + 400e3, i: 0 }, { at: 0, dv: [0, 0, 500] });
    assert.ok(!s.m && Math.abs(s.done.i - Math.atan(500 / s.vBefore)) < 1e-9, 'free: the plane example turns by atan(Δv/v); no mass without an engine');
  }
  assert.ok(wz.includes('t1a = Math.max(r.d0, S.M.t0)') && wz.includes('await solve();') && wz.includes("if (!wzPair(v.dep, v.tgt)) return fail(2, '', _('wz.e.freePair'));"), 'go: from the date on, the solver, free return only about a moon');
}
// 36) The opening view: Saturn back-lit (prefs.js saturnShot), the default instead of the tour. For several dates, a wide
// and a phone screen: the Sun behind Saturn and to one side (phase angle about 100–140°), the camera above the ecliptic,
// Saturn and the Sun inside the free area, the field of view within its limits, the ecliptic level on wide screens; the
// side kept once chosen; the bright band of the Milky Way in frame on today's wide screen. The camera breathes: swings of
// 40–60 s in azimuth, height and distance, seen within seconds (wide screens: the full ±6° azimuth swing), smooth
// between frames, and all along it (every quarter second over ten minutes, which holds the swings' extremes) the Sun in
// frame and the phase within 120–140°; none with reduced motion (sway off). The app opens on it, in 3D when it can,
// offering 2D (never switching) when the first seconds struggle; the old tour stays on the switch.
{
  const C = require('../js/core.js'), K = ['sun', 'saturn'];
  const sy = C.buildSystem(K.map(k => { const d = BODIES[k]; return { name: k, mu: d.gm * 1e9, radius: d.radius * 1e3, parent: K.indexOf(d.parent), a: 0, orb: d.orb }; }));
  const X = new Float64Array(6), V = new Float64Array(6), R = BODIES.saturn.rings.r[1] * BODIES.saturn.rings.req * 1e3;
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
  for (const iso of ['2026-11-12T12:00:00Z', '2029-03-01T00:00:00Z', '2033-07-01T00:00:00Z', '2041-01-01T00:00:00Z']) {
    const t = C.utcToDays(Date.parse(iso)) * C.DAY; C.states(sy, t, X, V);
    const F = C.bodyFrame(BODIES.saturn.pole, t), pole = [F[2], F[5], F[8]], sat = [X[3], X[4], X[5]], sun = [X[0], X[1], X[2]];
    const l = Math.hypot(X[0] - X[3], X[1] - X[4], X[2] - X[5]), s = [0, 1, 2].map(k => (sun[k] - sat[k]) / l);
    for (const box of [{ W: 1392, H: 900, l: 0, t: 119, w: 1392, h: 742 }, { W: 390, H: 790, l: 0, t: 158, w: 390, h: 597 }]) {
      const tag = iso.slice(0, 10) + ' ' + box.W + ' px', o = P.saturnShot(sat, sun, pole, box, { R });
      const ph = ang(o.e, s), inB = (x, y) => x > box.l && x < box.l + box.w && y > box.t && y < box.t + box.h;
      assert.ok(ph > 100 && ph < 140 && Math.abs(ph - o.phase) < 1e-6, `${tag}: the Sun behind Saturn (phase ${ph.toFixed(1)}°)`);
      assert.ok(o.e[2] > Math.sin(3 * Math.PI / 180) && o.e[2] < Math.sin(15 * Math.PI / 180), `${tag}: the camera a little above the ecliptic`);
      assert.ok(inB(o.x, o.y) && inB(o.sun[0], o.sun[1]), `${tag}: Saturn and the Sun in frame (${o.sun.map(v => v.toFixed(0))})`);
      assert.ok(o.fov >= P.SAT_SHOT.fovMin && o.fov <= P.SAT_SHOT.fovMax && o.dist > 2.4 * R, `${tag}: field of view ${o.fov.toFixed(1)}°, the camera ${(o.dist / R).toFixed(1)} ring radii out (2026-11-21: closer)`);
      if (box.w > box.h) assert.ok(o.roll === 0, `${tag}: the ecliptic level on a wide screen`);
      if (iso.startsWith('2026') && box.w > box.h) assert.ok(o.milky > 0.05, `${tag}: the Milky Way in frame (${o.milky.toFixed(3)})`);
      // no sway: the same place at any time
      assert.ok(ang(P.saturnShot(sat, sun, pole, box, { R, side: o.side, t: 37 }).e, o.e) < 1e-9 && o.sway.k === 0, `${tag}: no sway when it is off`);
      // the breathing camera: one fit, the frame kept, the extremes checked along ten minutes
      const sw = P.SAT_SHOT.sway, o1 = P.saturnShot(sat, sun, pole, box, { R, sway: true }), opt = t => ({ R, sway: true, side: o1.side, fit: o1.fit, t });
      assert.ok([sw.taz, sw.tel, sw.tdist].every(T => T >= 40 && T <= 60), 'swings of 40–60 s');
      assert.ok(o1.side.join() === o.side.join() && o1.sway.ke > 0 && o1.sway.dist > 0 && (box.w < box.h || o1.sway.k === 1), `${tag}: it breathes (azimuth ×${o1.sway.k}, height ×${o1.sway.ke})`);
      let pmin = 180, pmax = 0, jump = 0, moved = 0, prev = null, dmin = Infinity, dmax = 0;
      for (let tt = 0; tt <= 600; tt += 0.25) {
        const q = P.saturnShot(sat, sun, pole, box, opt(tt));
        assert.ok(q.roll === o1.roll && q.x === o1.x && q.f === o1.f, `${tag}: the frame kept while swaying`);
        assert.ok(inB(q.sun[0], q.sun[1]), `${tag}: the Sun in frame at ${tt} s (${q.sun.map(v => v.toFixed(0))})`);
        pmin = Math.min(pmin, q.phase); pmax = Math.max(pmax, q.phase); dmin = Math.min(dmin, q.dist); dmax = Math.max(dmax, q.dist);
        if (prev) jump = Math.max(jump, ang(q.e, prev.e));
        prev = q;
      }
      for (let tt = 0; tt < 60; tt += 1) moved = Math.max(moved, ang(P.saturnShot(sat, sun, pole, box, opt(tt)).e, P.saturnShot(sat, sun, pole, box, opt(tt + 3)).e));
      assert.ok(pmin >= 120 && pmax <= 140, `${tag}: phase ${pmin.toFixed(1)}–${pmax.toFixed(1)}° while swaying`);
      assert.ok(jump < 0.25 && moved > (box.w > box.h ? 1.5 : 0.5), `${tag}: smooth, yet seen within seconds (${moved.toFixed(2)}° in 3 s)`);
      assert.ok(dmax / dmin > 1.04 && dmax / dmin < 1.12, `${tag}: the distance opens and closes slightly (×${(dmax / dmin).toFixed(3)})`);
    }
  }
  const app = read('js/app.js'), m3 = read('js/mode3d.js');
  assert.ok(app.includes('sway, t: SCENE.age, side: SCENE.side, fit: SCENE.fit') && app.includes('sway = sceneDrift()') && app.includes('const sceneDrift = () => Q.glow && !lowQ && !reduceMotion;'), 'the camera breathes in the app, not with reduced motion or in the light mode');
  // the opening in 3D: automatic only, not light, WebGL 2 there; measured, a note offers 2D (saved), never a switch
  assert.strictEqual(P.auto3dFrames(new Array(20).fill(0.1)), null, '3D frames: too few, no verdict');
  assert.strictEqual(P.auto3dFrames(new Array(200).fill(1 / 60)), 'ok', '3D frames: 60 fps');
  assert.strictEqual(P.auto3dFrames(new Array(200).fill(0.045)), 'slow', '3D frames: over 40 ms');
  assert.strictEqual(P.auto3dFrames([...new Array(170).fill(1 / 60), ...new Array(30).fill(0.1)]), 'slow', '3D frames: frequent stalls');
  assert.strictEqual(P.auto3dFrames([...new Array(195).fill(1 / 60), ...new Array(5).fill(0.1)]), 'ok', '3D frames: a rare stall');
  assert.ok(app.includes("if (m === 'low') liteTip(CRASHED ? 'lite.crash' : 'lite.text');\n  else if (GL2) { start.mode = '3d'; AUTO.d3 = true; }") && app.includes("liteTip('lite.slow3d', 'lite.to2d')") && app.includes("go = () => setMode('normal', true)") && has('lite.slow3d') && has('lite.to2d'), 'the opening in 3D, a struggling device offered 2D');
  assert.ok(!/AUTO\.d3[^\n]*setMode\(/.test(app), '3D: never switched to 2D by itself');
  assert.deepStrictEqual(P.startupMode({ getItem: () => 'normal' }), { mode: 'normal', auto: false }, 'a saved 2D starts in 2D (no measuring, no note)');
  assert.ok(app.includes("else sceneSet('saturn');") && app.includes("kind: 'saturn', side: null") && app.includes('saturnShot(v(i), v(MSUN)'), 'the site opens on Saturn back-lit');
  assert.ok(m3.includes('V3.view(c.t, B.r, B.u, B.d, c.dist, B.cx, B.cy, B.fov);') && !m3.includes('B.cx, B.cy);') && m3.includes('camLevel3(c,'), "the shot's roll and field of view reach the renderer, and go back once the view is moved");
}
// 37) The rail icons look pressed only while their window is really in view (prefs.js railPressed): open, not collapsed,
// not set aside by the opening scene. For every window: its rail button exists, starts unpressed, has its window; the
// app writes the pressed state only through railSync, after every change of a window and of the scene's set-aside list;
// a click closes a window in view and brings any other one into view.
{
  for (const id of P.WIN_IDS) {
    assert.ok(new RegExp(`<button class="rail-btn" type="button" data-win="${id}"[^>]*aria-pressed="false"`).test(html) && html.includes(`id="w-${id}"`), `rail: ${id} has a button (unpressed at first) and a window`);
    for (const open of [false, true]) for (const collapsed of [false, true]) for (const aside of [false, true]) {
      assert.strictEqual(P.railPressed({ open, collapsed }, aside), open && !collapsed && !aside, `rail: ${id} open=${open} collapsed=${collapsed} aside=${aside}`);
    }
  }
  assert.ok(!P.railPressed(undefined, false) && !P.railPressed(null, false), 'rail: no state, not pressed');
  assert.strictEqual((html.match(/class="rail-btn[^"]*"[^>]*data-win=/g) || []).length, P.WIN_IDS.length, 'rail: one button per window');
  const app = read('js/app.js'), body = name => { const i = app.indexOf('function ' + name + '('); return app.slice(i, app.indexOf('\n}', i)); };
  assert.ok(!/railBtn\([^)]*\)\.setAttribute\('aria-pressed'/.test(app) && app.includes("function railSync() { for (const id of WIN_IDS) { const b = railBtn(id); if (b) b.setAttribute('aria-pressed', String(winShown(id))); } }"), 'rail: pressed state written only by railSync');
  assert.ok(app.includes("return railPressed(WINS[id], winEl(id).classList.contains('scene-hide'));"), 'rail: what is in view decides');
  for (const f of ['applyWin', 'sceneAside', 'sceneEnd', 'sceneUnhide']) assert.ok(body(f).includes('railSync()'), `rail: ${f} updates the icons`);
  assert.ok(app.includes('if (winShown(id)) { setWin(id, { open: false }); return; }\n  sceneUnhide(id); setWin(id, { open: true, collapsed: false });'), 'rail: a click closes what is in view, else brings it into view');
}
// 38) Site icons (tools/icons): every page of the site links its icon (SVG, 32 px PNG), the touch icon, the manifest and a
// theme colour; the files exist at their sizes (read from the PNG header), the touch icons opaque; the manifest names
// the site with the --bg token as its colour; the SVGs are well-formed enough to load as images (no "--" in comments).
{
  const png = f => { const b = fs.readFileSync(path.join(__dirname, '..', f)); assert.ok(b.slice(1, 4).toString() === 'PNG', f + ' is a PNG'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 }; };
  const exists = f => fs.existsSync(path.join(__dirname, '..', f));
  const bg = (/--bg:(#[0-9a-f]{6})/i.exec(read('css/style.css')) || [])[1];
  const pages = fs.readdirSync(path.join(__dirname, '..')).filter(f => f.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(f)); // not the search console's token file
  assert.ok(pages.includes('index.html') && pages.includes('kabin.html'), 'icons: the pages ' + pages.join(', '));
  for (const f of pages) {
    const h = read(f), k = /^kabin/.test(f) ? 'favicon-kabin' : 'favicon', touch = /^kabin/.test(f) ? 'apple-touch-icon-kabin.png' : 'apple-touch-icon.png';
    for (const tag of [`<link rel="icon" href="${k}-32.png" sizes="32x32" type="image/png">`, `<link rel="icon" href="${k}.svg" type="image/svg+xml">`, `<link rel="apple-touch-icon" href="${touch}">`, '<link rel="manifest" href="site.webmanifest">'])
      assert.ok(h.includes(tag), `icons: ${f} has ${tag}`);
    const tc = (/<meta name="theme-color" content="(#[0-9a-f]{6})">/i.exec(h) || [])[1];
    assert.ok(tc && new RegExp('--[a-z-]+:' + tc + '\\b', 'i').test(read('css/style.css')), `icons: ${f} theme colour from a token (${tc})`);
    assert.ok(h.indexOf(`${k}-32.png`) < h.indexOf(`${k}.svg`), `icons: ${f} lists the PNG before the SVG (browsers that read SVG take the SVG)`);
  }
  for (const [f, s, opaque] of [['favicon-32.png', 32], ['favicon-kabin-32.png', 32], ['apple-touch-icon.png', 180, true], ['apple-touch-icon-kabin.png', 180, true], ['icon-192.png', 192, true], ['icon-512.png', 512, true]]) {
    const p = png(f); assert.ok(p.w === s && p.h === s && (!opaque || !p.alpha), `icons: ${f} ${p.w}×${p.h}${opaque ? ', opaque' : ''}`);
  }
  for (const f of ['favicon.svg', 'favicon-kabin.svg']) {
    const s = read(f);
    assert.ok(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">') && s.trim().endsWith('</svg>') && /@media \(max-width:24px\)/.test(s), `icons: ${f} (64 × 64, simpler at tab size)`);
    for (const c of s.matchAll(/<!--([\s\S]*?)-->/g)) assert.ok(!c[1].includes('--'), `icons: ${f} comment without "--" (else not XML, the icon would not load)`);
    // every colour drawn is a css/style.css token (white aside: the spark)
    const css = read('css/style.css'), body = s.replace(/<!--[\s\S]*?-->/g, '');
    for (const [c] of body.matchAll(/#[0-9a-f]{6}\b/gi)) assert.ok(c.toLowerCase() === '#ffffff' || new RegExp('--[a-z-]+:' + c + '\\b', 'i').test(css), `icons: ${f} colour ${c} is a token`);
  }
  const man = JSON.parse(read('site.webmanifest'));
  assert.ok(man.name === 'Yörünge Transfer Simülatörü' && man.short_name === 'Yörünge' && man.theme_color === bg && man.background_color === bg && man.lang === 'tr', 'icons: the manifest names the site, colours from --bg');
  for (const i of man.icons) {
    assert.ok(exists(i.src), 'icons: manifest file ' + i.src);
    if (i.type === 'image/png') { const p = png(i.src); assert.strictEqual(i.sizes, p.w + 'x' + p.h, 'icons: manifest size of ' + i.src); }
  }
  assert.ok(man.icons.some(i => i.sizes === '192x192') && man.icons.some(i => i.sizes === '512x512'), 'icons: 192 and 512 in the manifest');
  assert.ok(!exists('tools/icons/node_modules') && !exists('tools/icons/package.json') && read('tools/icons/render.js').includes("require('playwright-core')"), 'icons: the renderer is a script, Playwright stays outside the repository');
}
// 39) Mission recording (js/record.js, js/rec-worker.mjs; Phase 17c): frame by frame, not a screen capture. The schedule
// (u from 0 to 1, 10–20 s at 24 frames/s, slower around events, GIF delays in hundredths that keep the film's length,
// the last frame held); sizes (as asked, even, the screen's shape, drawn supersampled on a virtual screen that keeps
// lines and labels in proportion); the GIF ladder (frame rate, colours, width); the palette's fixed colours (tokens
// exactly, ramps toward the void) and its dithering; file names
// from the mission; the watermark (bottom right) on every frame, the last included; a real GIF from the encoder (header,
// size, loop, one image per frame, the last frame's pause, unchanged pixels transparent). The libraries load only with
// a recording; the app draws a frame on demand and fits to the whole canvas while recording; the licences in Kaynakça.
{
  const Rc = require('../js/record.js');
  const sc = Rc.recSchedule([0.3, 0.7]), n = sc.u.length;
  assert.ok(Rc.REC_OPT.fps === 24 && Rc.REC_OPT.fpsList.join() === '15,24,30' && n >= 10 * 24 && n <= 20 * 24 && sc.u[0] === 0 && sc.u[n - 1] === 1, `recording: ${n} frames at 24/s`);
  const s15 = Rc.recSchedule([0.3, 0.7], { fps: 15 }), s30 = Rc.recSchedule([0.3, 0.7], { fps: 30 });
  for (const q of [s15, s30]) assert.ok(Math.abs(q.delay.reduce((a, b) => a + b, 0) / 1000 - (q.u.length / q.fps + Rc.REC_OPT.hold)) < 0.011, `recording: ${q.fps}/s keeps the length`);
  for (let k = 1; k < n; k++) assert.ok(sc.u[k] > sc.u[k - 1], 'recording: u only grows');
  const step = u => { let k = 0; while (k < n - 1 && sc.u[k + 1] < u) k++; return sc.u[k + 1] - sc.u[k]; };
  assert.ok(step(0.3) < step(0.5) / 2.5 && step(0.7) < step(0.5) / 2.5, `recording: slower at events (${(step(0.5) / step(0.3)).toFixed(1)}×)`);
  const total = sc.delay.reduce((a, b) => a + b, 0) / 1000;
  assert.ok(sc.delay.every(d => d % 10 === 0) && Math.abs(total - (n / sc.fps + Rc.REC_OPT.hold)) < 0.011 && Math.abs(n / sc.fps - sc.T) <= 0.5 / sc.fps && sc.delay[n - 1] >= Rc.REC_OPT.hold * 1000, `recording: ${total.toFixed(2)} s with the last frame held`);
  const many = Rc.recSchedule(new Array(40).fill(0).map((_, i) => i / 40)), none = Rc.recSchedule([]);
  assert.ok(many.T === Rc.REC_OPT.max && none.T >= Rc.REC_OPT.min && none.T <= Rc.REC_OPT.max, 'recording: 10–20 s');
  const s1 = Rc.recSize(1392, 900, 1080), s2 = Rc.recSize(390, 790, 1080), s3 = Rc.recSize(301, 201, 480), s4 = Rc.recSize(1392, 900, 720), s5 = Rc.recSize(390, 790, 1080, 6e6);
  assert.ok(s1.w === 1080 && s1.h % 2 === 0 && Math.abs(s1.h / s1.w - 900 / 1392) < 0.01, 'recording: 1080 px wide (any screen: drawn anew), the shape kept, even');
  assert.ok(s2.w === 1080 && s2.h === 1920 && s3.w === 480 && s3.h % 2 === 0, 'recording: a tall phone screen gives 9:16 at most');
  // the virtual screen: a 1080 px film draws as 720 CSS px at 1.5× (a 1.2 px line is 1.8 px), 720 and 480 px as 480 CSS px
  assert.ok(s1.cw === 720 && s1.k === 1.5 && Math.abs(s1.ch * s1.k - s1.h) < 1e-9 && s4.cw === 480 && s4.k === 1.5 && s3.cw === 480 && s3.k === 1, 'recording: lines and labels in proportion to the film');
  assert.ok(s1.ss === 2 && s4.ss === 2 && s5.ss >= 1 && s5.ss < 2 && 4 * s1.w * s1.h <= Rc.REC_OPT.ssPx && s5.ss * s5.ss * s5.w * s5.h <= 6e6 * 1.0001, 'recording: drawn at twice the size (fewer pixels on phones)');
  const lad = Rc.recLadder(1080);
  assert.ok(lad[0].w === 1080 && lad[0].fps === 24 && lad[0].colors === 255 && lad.some(c => c.fps === 15) && lad.some(c => c.colors < 255) && lad.some(c => c.w === 720) && lad[lad.length - 1].w === 480, 'recording: the GIF ladder (frame rate, colours, width)');
  // the palette's fixed colours: every hex token exactly, the bodies, 8–16 tones of the amber and the white toward the void
  const COLT = { traj: '#ffb547', orbit: '#7cc4d8', ink: '#d9e7eb', void: '#030507', dim: '#86a0a8', line: 'rgba(140,196,212,.28)' };
  const fx = Rc.recFixed(COLT, ['#c9a36b']), hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  assert.ok(hex(fx[0]) === '#030507' && ['#ffb547', '#7cc4d8', '#d9e7eb', '#86a0a8', '#c9a36b'].every(h => fx.some(c => hex(c) === h)), 'recording: the tokens and the bodies in the palette, the void first');
  const between = (a, b) => fx.filter(c => { const d = b.map((v, j) => v - a[j]), q = c.map((v, j) => v - a[j]), t = (q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) / (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]); return t > 0.01 && t < 0.99 && Math.hypot(...q.map((v, j) => v - t * d[j])) < 1.5; }).length; // tones on the line from a to b
  const ampR = between([255, 181, 71], [3, 5, 7]), inkR = between([217, 231, 235], [3, 5, 7]);
  assert.ok(ampR >= 8 && ampR <= 16 && inkR >= 8 && inkR <= 16 && fx.length < 100, `recording: ramps toward the void (amber ${ampR}, white ${inkR}; ${fx.length} fixed)`);
  assert.ok(Rc.recBitrate(1080, 698, 24, 'high') > Rc.recBitrate(1080, 698, 24, 'std') && Rc.recBitrate(1080, 698, 24, 'high') > Rc.recBitrate(480, 310, 24, 'high'), 'recording: the video bit rate by quality and size');
  assert.ok(Rc.recEstimate(1000, 100, 11) > 2000, 'recording: size estimate');
  const tr = k => DICT[k];
  const e600 = P.WIZ_EX.e600;
  assert.strictEqual(Rc.recFileName(Rc.recWords({ kind: 'man', body: DICT['body.' + e600.body], type: 'hohmann', hp0: +e600.h0, ha0: +e600.h0, hp1: +e600.h1 }, tr), 'gif'), 'yorunge-dunya-600-1300km.gif', 'recording: file name of a maneuver');
  assert.strictEqual(Rc.recFileName(Rc.recWords({ kind: 'transfer', a: DICT['body.earth'], b: DICT['body.moon'], mode: 'free' }, tr), 'mp4'), 'yorunge-dunya-ay-serbest-donus.mp4', 'recording: file name of a free return');
  assert.strictEqual(Rc.recFileName(Rc.recWords({ kind: 'transfer', a: DICT['body.earth'], b: DICT['body.mars'], mode: 'capture' }, tr), 'gif'), 'yorunge-dunya-mars.gif', 'recording: file name of a transfer');
  assert.strictEqual(Rc.recFileName(Rc.recWords({ kind: 'man', body: DICT['body.moon'], type: 'free' }, tr), 'webm'), 'yorunge-ay-serbest-yanma.webm', 'recording: file name of a free burn');
  assert.ok(Rc.recSlug('Şğüöçı İ Âb') === 'sguoci-i-ab' && Rc.recFileName([], 'gif') === 'yorunge.gif', 'recording: Turkish letters, empty name');
  // the watermark: one constant for the address, the site's name from the dictionary; on every frame, bottom right
  assert.strictEqual(Rc.recMark(tr), DICT['meta.title'] + ' · baqikk.github.io/orbital-simulator', 'recording: the watermark text');
  assert.strictEqual((read('js/record.js').match(/baqikk\.github\.io/g) || []).length, 1, 'recording: the address written once (SITE_URL)');
  const mock = () => { const ops = []; return { ops, save() {}, restore() {}, fillRect() {}, drawImage(s) { ops.push(['img', s]); }, fillText(t, x, y) { ops.push(['text', t, x, y, this.textAlign, this.textBaseline]); } }; };
  const deco = { bg: '#030507', ink: '#d9e7eb', mark: Rc.recMark(tr), title: 'Görev', sub: 'Toplam Δv 1 km/s' };
  let lastOps = null;
  for (let k = 0; k < n; k++) { const m = mock(); Rc.recCompose(m, ['gl', 'cv'], 720, 466, deco); lastOps = m.ops; assert.ok(m.ops.some(o => o[0] === 'text' && o[1] === deco.mark), 'recording: watermark on frame ' + k); }
  const wm = lastOps.find(o => o[0] === 'text' && o[1] === deco.mark);
  assert.ok(wm[2] > 600 && wm[3] > 420 && wm[4] === 'right' && wm[5] === 'bottom' && lastOps[0][1] === 'gl' && lastOps[1][1] === 'cv' && lastOps.some(o => o[1] === 'Görev' && o[2] < 40), 'recording: the last frame: canvases (3D below), title top left, watermark bottom right');
  // the libraries: vendored, unchanged, only with a recording
  const rj = read('js/record.js'), app = read('js/app.js');
  for (const [d, f, l] of [['gifenc', 'gifenc.esm.js', 'LICENSE.md'], ['mp4-muxer', 'mp4-muxer.mjs', 'LICENSE'], ['webm-muxer', 'webm-muxer.mjs', 'LICENSE']]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'vendor', d, f)) && /MIT License/.test(read(`vendor/${d}/${l}`)) && read(`vendor/${d}/README.md`).includes('sha1'), `recording: vendor/${d} (MIT, its source noted)`);
    assert.ok(!html.includes('vendor/' + d) && !app.includes('vendor/' + d), `recording: vendor/${d} not loaded with the page`);
  }
  assert.ok(rj.includes("new Worker(new URL('js/rec-worker.mjs', document.baseURI), { type: 'module' })") && rj.includes("await import(new URL(v.box === 'mp4' ? 'vendor/mp4-muxer/mp4-muxer.mjs' : 'vendor/webm-muxer/webm-muxer.mjs'") && read('js/rec-worker.mjs').includes("from '../vendor/gifenc/gifenc.esm.js'"), 'recording: the encoder in a worker, the muxers by import(), only when recording');
  assert.ok(html.includes('<script src="js/record.js"></script>') && html.includes('id="recBtn"') && html.includes('id="recPanel"') && has('rec.btn') && has('rec.tip'), 'recording: the button by the timeline');
  for (const k of ['three', 'gifenc', 'mp4', 'webm']) assert.ok(has('cred.code.' + k) && app.includes(`${k}: 'https://`), 'recording: Kaynakça names ' + k);
  // the app: one frame on demand, the loop idle meanwhile, the whole canvas as the frame
  const db = app.slice(app.indexOf('function drawBody(now, once) {'), app.indexOf('\nfunction draw(now) {'));
  assert.ok(db.length > 1000 && !db.replace(/if \(!once\) requestAnimationFrame\(draw\)/g, '').includes('requestAnimationFrame(draw)'), 'recording: drawBody never schedules itself when drawn once');
  assert.ok(app.includes('function draw(now) { if (REC.busy) { last = now; requestAnimationFrame(draw); return; } drawBody(now, false); }') && app.includes('if (REC.full) return [{ x0: 0, x1: W, y0: 0, y1: H }];'), 'recording: the loop idles, the frame is the whole canvas');
  assert.ok(rj.includes("recCompose(octx, is3d() ? [$('#gl'), cv] : [cv]") && rj.includes('drawBody(t, true);'), 'recording: 3D read right after drawing');
  assert.ok(rj.includes("phone() ? { fmt: CAN_VIDEO ? 'video' : 'gif', w: 720 }") && rj.includes('navigator.canShare') && rj.includes('navigator.share('), 'recording: phones default to video at 720 px, share sheet');
  // drawn at the film's own size: app.js recView sets the virtual screen and its pixel ratio, and gives the screen back
  assert.ok(app.includes('function recView(v) {') && app.includes('if (REC.view) { recView(REC.view); return; }') && rj.includes('recView({ cw: sz.cw, ch: sz.ch, dpr: sz.k * sz.ss });') && rj.includes('recView(null);'), 'recording: drawn at its own size, supersampled, the screen given back');
  assert.ok(html.includes('id="recFps"') && html.includes('id="recQ"') && html.includes('id="recDither"') && ['rec.fps', 'rec.q', 'rec.qHigh', 'rec.qStd', 'rec.dither', 'rec.ditherTip'].every(has), 'recording: frame rate, video quality and dithering in the panel');
  // the background: plain void by default (no Milky Way, stars or glare in the recording; the screen unchanged), the
  // starry one on request ("Yıldızlı arka plan")
  const m3 = read('js/mode3d.js');
  assert.ok(rj.includes("const W0 = { fmt: 'gif', w: 1080, fps: 24, title: true, sky: false, dither: null, q: 'high' }") && rj.includes('R.set.dither == null ? !!R.set.sky') && rj.includes('REC.sky = !!R.set.sky;') && html.includes('id="recSky"') && has('rec.sky') && has('rec.skyTip'), 'recording: the starry background is an option, off by default');
  assert.ok(app.includes('const REC = { busy: false, full: false, sky: false, view: null, fireC: null };') && app.includes('const skyRec = () => REC.busy && !REC.sky;'), 'recording: the sky is left out only while a recording draws');
  assert.ok(app.includes('if (stars && !skyRec())') && app.includes('if (!FXON.glare || skyRec()) return;') && app.includes('V3.render({ stars: Q.stars && !skyRec(), skyGain: skyGain() });'), 'recording: 2D stars and glare left out');
  assert.strictEqual((m3.match(/V3\.render\(\{ stars: Q\.stars && !skyRec\(\)/g) || []).length, (m3.match(/V3\.render\(/g) || []).length, 'recording: every 3D render leaves the sky out');
  assert.ok(m3.includes('if (!Q.glow || lowQ || !FXON.glare || skyRec()) return null;'), 'recording: no 3D glare');
  assert.ok(Rc.recLadder(1080)[0].w === 1080 && Rc.recLadder(1080)[0].fps === 24, 'recording: the first step as asked (1080 px, 24 frames/s)');
}
// 40) Engines (Phase 18a, js/engines.js, js/engine-ui.js): the ready-made engines' values exactly as their sources give
// them (converted only by the factors stated), each with a name, a note and its links in Kaynakça; the propellant data
// (regression laws, the CEA table as run); the engine window (types, presets, the two ways to give the load, the hybrid
// and solid inputs, the figures, the charts, apply / save) and its rail button; saved engines parsed safely; the
// charts' playhead draws only itself each frame; the wizard has an engine step; the Model window says what is assumed.
{
  const E = require('../js/engines.js'), lbf = 4.4482216, lb = 0.45359237, by = id => E.ENGINES.find(q => q.id === id);
  const V = require('../js/vehicles.js').VEHICLES, veh = id => V.find(q => q.id === id);
  assert.ok(by('rl10').F === 99200 && by('rl10').isp === 450.5 && by('rl10').of === 5.5 && by('rl10').veh === 'centaur' && veh('centaur').F === 99200, 'engines: RL10A-4-2 99.2 kN, 450.5 s, O/F 5.5 (Atlas V guide, L3Harris)');
  assert.ok(by('aj10').F === 91188.5 && by('aj10').isp === 314.5 && Math.abs(by('aj10').of - 24389.10 / 15252.70) < 1e-12, 'engines: AJ10-137, O/F from the AOH loads');
  assert.ok(by('s400').F === 420 && by('s400').isp === 318 && by('s400').of === 1.65, 'engines: S400-12 420 N, 318 s, O/F 1.65 (ArianeGroup)');
  assert.ok(by('n2h4').F === 22 && by('n2h4').isp === 230 && by('n2h4').type === 'mono' && !by('n2h4').of, 'engines: the 22 N hydrazine thruster');
  const st = by('star48');
  assert.ok(st.type === 'sol' && Math.abs(st.F - 15430 * lbf) < 1e-9 && st.isp === 292.1 && Math.abs(st.mp - 4431.2 * lb) < 1e-9 && Math.abs(st.md - 257.8 * lb) < 1e-9, 'engines: STAR 48B long nozzle (catalog: 15,430 lbf, 292.1 s, 4,431.2 / 257.8 lbm)');
  assert.ok(by('hyb').ex && by('hyb').prop === 'n2o_htpb' && !E.ENGINES.some(q => /merlin/i.test(q.id)), 'engines: the hybrid is marked as an example; no engine without a published Isp');
  const PR = E.PROPS;
  assert.ok(PR.lox_paraffin.hyb.a === 9.36e-2 && PR.lox_paraffin.hyb.n === 0.62 && PR.lox_paraffin.hyb.rho === 920 && PR.n2o_htpb.hyb.a === 0.1876 && PR.n2o_htpb.hyb.n === 0.347 && PR.n2o_htpb.hyb.ispOF === null, 'engines: the regression laws as published; no Isp table for N2O/HTPB yet');
  const cp = E.CEA.lox_paraffin, row = of => cp.find(r => r[0] === of);
  assert.ok(row(2.5)[1] === 3474.9 && row(1)[1] === 2633.8 && row(4)[1] === 3290.8 && row(3)[2] === 3755.3 && PR.lox_paraffin.hyb.ispOF.every((q, i) => Math.abs(q[1] * 9.80665 - cp[i][1]) < 1e-9), 'engines: the paraffin CEA table (Ivac, m/s) as run, the hybrid\'s Isp in seconds');
  // the other CEA tables and the densities as their sources print them; every liquid pair has both
  assert.ok(E.CEA.lox_lh2.find(r => r[0] === 5.5)[2] === 4724.5 && E.CEA.lox_rp1.find(r => r[0] === 2.75)[1] === 3529.8 && E.CEA.nto_mmh.find(r => r[0] === 2.5)[2] === 3587.5 && E.CEA.nto_a50.find(r => r[0] === 2)[1] === 3370.2, 'engines: CEA tables as run');
  assert.ok(E.RHO.lox === 1141.58 && E.RHO.lh2 === 70.8665 && E.RHO.mmh === 874 && E.RHO.nto === 1450 && Math.abs(E.RHO.a50 - 884.7) < 0.1 && E.RHO.rp1 === 810, 'engines: densities (NIST, PubChem/HSDB; A-50 derived; RP-1 secondary)');
  for (const k of ['lox_lh2', 'lox_rp1', 'nto_mmh', 'nto_a50']) assert.ok(PR[k].cea === k && E.CEA[k] && PR[k].rho.ox > 0 && PR[k].rho.fuel > 0, 'engines: CEA and densities for ' + k);
  assert.ok(has('cred.cea') && ['nist', 'pubchem', 'wikiRp1'].every(s => E.ENG_SRC[s] && has('cred.esrc.' + s)), 'engines: the CEA tables and densities credited');
  const ej = read('js/engines.js');
  assert.ok(/pressure 30 bar, supersonic area ratio Ae\/At = 50/.test(ej) && /equilibrium \(shifting\)/.test(ej) && ej.includes('CEA2, February 5, 2004'), 'engines: the CEA run\'s Pc, ε and equilibrium assumption in the comment');
  for (const q of E.ENGINES) {
    assert.ok(has('eng.' + q.id) && has('cred.eng.' + q.id) && q.src.every(s => E.ENG_SRC[s] && has('cred.esrc.' + s)), 'engines: name, note and links of ' + q.id);
    if (q.veh) assert.ok(veh(q.veh), 'engines: ' + q.id + ' takes its masses from ' + q.veh);
  }
  for (const k of ['lox_paraffin', 'n2o_htpb']) assert.ok(has('cred.prop.' + k) && PR[k].src.every(s => E.ENG_SRC[s]), 'engines: propellant data credited ' + k);
  const appJs = read('js/app.js'), ui = read('js/engine-ui.js');
  assert.ok(appJs.includes("${esc(_('cred.h.eng'))}") && appJs.includes('ENG_SRC[s]') && has('cred.h.eng'), 'engines: Kaynakça lists the engines and the propellant data');
  // the window and its rail button
  for (const id of ['w-engine', 'engType', 'engPre', 'engProp', 'eng-F', 'eng-isp', 'engPm', 'eng-of', 'eng-mp', 'eng-mf', 'eng-mox', 'eng-md', 'engGrain', 'eng-r0', 'engOut', 'engCv', 'engCvP', 'engBurns', 'engApply', 'engSave'])
    assert.ok(html.includes(`id="${id}"`), 'engine window: #' + id);
  assert.ok(P.WIN_IDS.includes('engine') && html.includes('data-win="engine"') && has('win.engine') && has('rail.engine'), 'engine window: a window with its rail button');
  // the two ways of giving the load never go to the core together; the hidden fields follow the choice
  assert.ok(/\.\.\.\(split \? \{ mf: \+E\.mf, mox: \+E\.mox \} : \{ mp: \+E\.mp \}\)/.test(ui) && ui.includes("engEl('eng-mfW').hidden = engEl('eng-moxW').hidden = !(bi && E.pm === 'split');") && ui.includes("engEl('eng-mpW').hidden = bi && E.pm === 'split';"), 'engine window: total or fuel + oxidizer, never both');
  // the playhead draws only itself (the charts are drawn once per change)
  const tick = ui.slice(ui.indexOf('function engTick('), ui.indexOf('// ----- events -----'));
  assert.ok(tick.length > 100 && !tick.includes('engChart(') && !tick.includes('engCompute(') && appJs.includes('  engTick(); // the engine charts'), 'engine charts: the playhead alone each frame');
  // saved engines
  const ok = P.parseEngines(JSON.stringify([{ name: 'A', type: 'liq', prop: 'nto_mmh', F: 400, isp: 320, of: 1.65, pm: 'tot', mp: 700, md: 300 }, { name: 'B', type: 'hyb', prop: 'n2o_htpb', F: 5000, isp: 250, of: 6.5, pm: 'tot', mp: 300, md: 150, r0: 0 }, { name: 'C', type: 'sol', prop: 'nto_mmh', F: 1, isp: 1, mp: 1, md: 1 }, null, 5]));
  assert.ok(ok.length === 1 && ok[0].name === 'A' && P.parseEngines('{') .length === 0 && P.PREF_KEYS.engines, 'saved engines: the broken ones left out');
  // mission: finite flights read the curve; a solid flies a single firing or the free burn; what is missing is said
  assert.ok(appJs.includes('fin: { F: M.F, isp: M.isp, m0: M.m0, md: M.md, steer: M.steer, eng },') && appJs.includes("_('err.engSolidPlan'") && has('err.engSolidPlan') && has('eng.short') && /\{kg\} kg itki maddesi eksik/.test(DICT['eng.short']), 'engine: the flight uses it, a solid\'s limits, the missing propellant in plain words');
  assert.ok(html.includes('data-i18n="ui.model11"') && has('ui.model11') && /CEA/.test(DICT['ui.model11']) && /Isp sabit/.test(DICT['ui.model11']), 'engine: the Model window states the assumptions');
  // the wizard: an engine step on each path, the result cards list each burn's length, fuel and oxidizer; the expert
  // form links the mission's engine
  const wz = read('js/wizard.js');
  assert.ok((wz.match(/\{ t: 'wz\.s\.engine', b: wzEngFields\(/g) || []).length === 3 && (wz.match(/engCardHtml\(\)/g) || []).length === 3 && wz.includes("fail('wz-eng', _('wz.e.eng'))") && has('wz.e.eng'), 'wizard: the engine step on every path, its lines in every result card');
  assert.ok(html.includes('id="mvEng"') && has('mv.eng') && read('js/app.js').includes("engOpenFrom(S.M.eng || null)"), 'maneuver form: the engine and a way to the window');
}
// 41) The smoke test (tests/smoke.js): a real browser over every page and a short design session, in CI (its own job,
// Playwright installed outside the repository); the site and the repository get no dependency.
{
  const sm = read('tests/smoke.js'), ci = read('.github/workflows/test.yml');
  assert.ok(/pageerror/.test(sm) && /'console'/.test(sm) && /requestfailed/.test(sm) && /fonts\\\.googleapis/.test(sm) && sm.includes("[{ width: 390, height: 844 }, 'phone']") && sm.includes('#wzGo') && sm.includes('#engApply'), 'smoke: page and console errors, failed requests (Google Fonts aside), phone size, the wizard and the engine window');
  assert.ok(/\n  smoke:\n/.test(ci) && ci.includes('playwright@1.49.1') && ci.includes('--prefix "$RUNNER_TEMP/pw"') && ci.includes('node tests/smoke.js'), 'smoke: its own CI job, Playwright outside the repository');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'package.json')) && !fs.existsSync(path.join(__dirname, '..', 'node_modules')), 'smoke: no package.json or node_modules in the repository');
  assert.ok(/Push'tan önce duman testini yerelde de çalıştır/.test(read('CLAUDE.md')), 'smoke: the rule in CLAUDE.md');
  assert.ok(['#apprBtn', '#cutBtn', "page.keyboard.press('a')", 'page.mouse.dblclick', '#engPlay'].every(k => sm.includes(k)), 'smoke: the craft up close (button, cutaway, A, double clicks) and the engine window\'s cutaway');
}
// 42) The craft and its plume (Phase 18b, 18c): a procedural model per engine type in view3d.js (no model files), its
// shaders in the logarithmic depth space (test 7 checks every *_VS / *_FS); the plume (redone 2026-11-14) a layered
// flame: a quad about its axis facing the camera with a core, a body and a halo, value noise drifting outwards, added
// light (ONE, ONE) without depth writes, a nozzle glow seen end on, plain without noise in the low quality; its colours
// by propellant, token mixes (PLUME_PAL: hydrogen blue with a violet core, kerosene orange-yellow, N2O4 storables pink-
// orange, solid white-yellow, monopropellant faint); the cutaway's colours the engine charts' tokens (fuel --burn,
// oxidizer --cyan);
// "Araca yaklaş": button, double tap on the craft or its path, A, Esc back, a one-time hint; the 2D cutaway in the engine
// window in every mode (plain shapes in the low mode); the 2D view's small plume; the engine window's rail icon.
{
  const v3 = read('js/view3d.js'), m3 = read('js/mode3d.js'), app = read('js/app.js'), ui = read('js/engine-ui.js');
  assert.ok(/export const CRAFT_VS/.test(v3) && /export const PLUME_FS/.test(v3) && v3.includes('new THREE.LatheGeometry(') && !/\.(glb|gltf|obj|fbx)['"]/.test(v3) && v3.includes('craft, dispose'), 'craft: procedural lathe model, no model files, exported');
  const pl = v3.slice(v3.indexOf('// a plume (2026-11-16: a volume)'), v3.indexOf('// build the model for engine type'));
  assert.ok(pl.includes('premultipliedAlpha: true, blending: THREE.AdditiveBlending, depthWrite: false') && pl.includes('vertexShader: PLUME_VS') && !v3.includes('PCORE_') && !v3.includes('flameQuad') && !v3.includes('PGLOW_') && pl.includes('const h = new THREE.Mesh(plumeHull, mat);') && pl.includes('THREE.BackSide : THREE.FrontSide'), 'plume: added light, no depth writes; one hull marched as a volume (no planes, no disc, no sprite), its back faces from inside');
  const pfs = v3.slice(v3.indexOf('export const PLUME_FS'), v3.indexOf('// Tone mapping: the custom operator'));
  assert.ok(['float vnoise(vec3 p)', 'uT * uLen * 1.4', 'float body =', 'float halo =', 'core = exp(', 'if (uSimple < 0.5)', 'for (int i = 0; i < N; i++)', '1.0 - exp(-tot * 1.1)', 'smoothstep(0.0, 0.02, a) * smoothstep(1.0, 0.85, a)'].every(k => pfs.includes(k)) && pfs.includes('A = dot(rd.xz, rd.xz)'), 'plume: marched through core, body and halo, 3D noise drifting downstream (none in the low quality), no edge at the exit or the tip, soft saturation');
  for (const ty of ["ty === 'liq'", "ty === 'hyb'", "ty === 'sol'"]) assert.ok(v3.includes(ty), 'craft: a model for ' + ty);
  assert.ok(m3.includes("col: { metal: COL.dim, nozzle: COL.faint, fuel: COL.burn, ox: COL.cyan, // fuel and oxidizer as the engine window's charts") && ui.includes("fuel: tok('--burn'), ox: tok('--cyan')") && ui.includes("fuel: engTok('--burn'), ox: engTok('--cyan')"), 'cutaway: fuel and oxidizer in the charts\' tokens, in 3D and 2D');
  const vm2 = require('vm'), E2 = {}; vm2.createContext(E2); vm2.runInContext(read('js/engines.js') + ';this.PROPS = PROPS;', E2);
  const PAL = ui.slice(ui.indexOf('const PLUME_PAL = {'), ui.indexOf('const engTok'));
  assert.ok(['blue', 'orange', 'pink', 'white', 'faint', 'amber'].every(k => PAL.includes(k + ': { core: [')) && !/#[0-9a-f]{3,6}/i.test(PAL) && ui.includes('function plumeCols(cls)') && m3.includes('plumeCols(en.plume)') && app.includes('plumeCols(en.plume)'), 'plume: colours by propellant, from the tokens');
  assert.ok(E2.PROPS.lox_lh2.plume === 'blue' && E2.PROPS.lox_rp1.plume === 'orange' && E2.PROPS.nto_mmh.plume === 'pink' && E2.PROPS.nto_a50.plume === 'pink' && E2.PROPS.apcp.plume === 'white' && E2.PROPS.n2h4.plume === 'faint', 'plume: classes by propellant');
  assert.ok(m3.includes('const fl = reduceMotion ? 1 :') && m3.includes('simple: lowQ || FX.lvl >= 2'), 'plume: flicker except with reduced motion, plain in the low quality');
  assert.ok(m3.includes('return unit3(toFrame3(craftAxis(tNow, craft, ext, en || engNow(tNow))))') && read('js/app.js').includes('function craftAxis(tNow, craft, ext, en) {') && m3.includes("if (S.follow === 'craft') return CRAFT.L * 0.9;"), 'craft: the nose along the thrust while burning (and through the plume fading); the camera kept outside it');
  // the craft's look (2026-11-14): procedural canvas textures painted from the theme's colours (no image files, no hex
  // in the painters), lathe v by length; foam on cryogenic tanks, gold foil on storables, bare metal for RP-1, a
  // composite case for nitrous oxide and the hybrid's motor, a light case for a solid; cooling channels and heat tint
  // on a liquid's nozzle, ablative ones for hybrids and solids; outside faces textured and lit by the Sun with a soft
  // highlight, insides plain; a liquid's tanks as long as their volumes in 3D too
  const paint = v3.slice(v3.indexOf('const PAINT = {'), v3.indexOf('const TEXC = new Map();'));
  assert.ok(['foam(', 'quiltA(', 'alu(', 'carbon(', 'case(', 'nozLiq(', 'nozAbl('].every(k => paint.includes(k)) && !/#[0-9a-f]{6}['"]/i.test(paint.replace(/'#ffffff'/g, '')) && v3.includes('new THREE.CanvasTexture(cv)') && v3.includes("document.createElement('canvas')"), 'craft textures: painted canvases from the theme\'s colours');
  assert.ok(v3.includes("oxTank: T(cryo ? 'foam' : prop === 'n2o_htpb' ? 'carbon' : fin), fuelTank: T(prop === 'lox_lh2' ? 'foam' : prop === 'lox_rp1' ? 'alu' : fin)") && v3.includes("caseC: T(ty === 'sol' ? 'case' : 'carbon')") && v3.includes('M.nozLiq') && v3.includes('M.nozAbl'), 'craft textures: finishes by propellant and type');
  assert.ok(v3.includes('uv.setY(k, rev ? 1 - cum[k % np] / tot : cum[k % np] / tot)') && v3.includes('gl_FrontFacing ? base * l + sp : uBack * 0.38') && v3.includes('pow(max(dot(n, H), 0.0), 28.0)'), 'craft textures: by length along the profile, outsides textured and lit, insides plain');
  assert.ok(m3.includes('engTanks(en.s, rho)') && m3.includes('fo = V ? V.ox / (V.ox + V.fuel) : 0.5') && v3.includes('const lo = Math.max(0.16, Math.min(span - 0.16, span * (fo > 0 ? fo : 0.5)))'), 'craft: a liquid\'s tanks as long as their volumes in 3D');
  // the cutaway fixed to the body (2026-11-15): the cut faces the local vertical (before: the frame's Z), never the camera; the
  // craft call's fields all live (none behind a comment)
  const cc = m3.slice(m3.indexOf('V3.craft({ show: true'), m3.indexOf('// the trail after capture')); // the call, in craftDraw (Phase 19d: shared with free flight)
  assert.ok(m3.includes("craftDraw('sim', CR3, ax, cutSide(ax, craftUp3(tNow, craft, ext)), L, sun, en, ext ? 0 : en.pl, CAM3.sim.dist);") && cc.includes('show: true, set, p, axis: ax, side, L, sun,') && cc.includes('cut: CRAFT.cut, type: en.E.type, grain: en.E.grain, prop: en.E.prop, fo, st: en.st,') && !cc.split('\n')[0].includes('//') && v3.includes('const sd = o.side || [0, 0, 1];') && !v3.includes('add(camera.position).normalize();'), 'cutaway: fixed to the body');
  // approaching the craft
  assert.ok(html.includes('id="apprBtn"') && html.includes('id="cutBtn"') && html.includes('id="engAppr"') && html.includes('id="engCut"') && html.includes('id="apprTip"') && ['appr.btn', 'appr.tip', 'appr.hint', 'appr.hintTouch', 'cut.btn', 'cut.tip', 'eng.play'].every(has), 'approach: the buttons, the hint, the words');
  assert.ok(app.includes("if (dbl && (FREE.on || (!MAP.on && C)) && ((tgt && tgt.kind === 'c') || onPath)) { sceneTouch(); apprSet(true); return; }") && app.includes('if (dbl && !tgt && APPR.on) { apprSet(false); return; }') && app.includes("if (e.key === 'a' || e.key === 'A') apprSet(!APPR.on);") && app.includes("e.key === 'Escape' && APPR.on"), 'approach: double tap on the craft or its path, empty space back, A, Esc');
  assert.ok(P.PREF_KEYS.apprTip && app.includes('writePref(LS, PREF_KEYS.apprTip, \'1\')'), 'approach: the hint once');
  // the 2D cutaway and the 2D plume
  assert.ok(ui.includes("low = lowQ || MODE === 'low'") && ui.includes('function engSchematic(') && html.includes('id="engSch"') && html.includes('id="engPlay"'), 'cutaway 2D: in the engine window, plain in the low mode, "Oynat"');
  assert.ok(app.includes('plume2d(x, y, tNow, craft, sx(cpos2[0]) - x, sy(cpos2[1]) - y, ext); // under the craft\'s dot') && app.includes('flame2d(ctx, (12 + 22 * k) * fl, 2.2, pc,') && app.includes('ts, !Q.glow);'), '2D view: a small flame under the craft, flat without glow');
  const f2 = ui.slice(ui.indexOf('function flame2d('), ui.indexOf('function plumeCols('));
  assert.ok(f2.includes("x.globalCompositeOperation = 'lighter'") && f2.includes('if (flat) {') && f2.includes('// halo') && f2.includes('// body') && f2.includes('// the core at the exit'), '2D flame: halo, wavering body and core in added light; one wedge when flat');
  assert.ok(html.includes('<path d="M7 1.5h6v3.1l-1.7 2.3v.3C12.5 8.5 14.9 11 15.4 14.6H4.6C5.1 11 7.5 8.5 8.7 7.2v-.3L7 4.6z"/><path class="acc" d="M6.8 15.6h6.4L10 19.6z"/>'), 'rail: the engine window\'s icon');
  // the engine window's fixes: a type brings its default engine (asked first after hand edits); warnings from the core;
  // the cutaway: liquid tanks by volume, the hybrid's end view, a fading, flickering cone (still in the low mode and with
  // reduced motion) drawn before a solid metal nozzle
  assert.ok(ui.includes("const ENG_TYPE_DEF = { liq: 'rl10', hyb: 'hyb', sol: 'star48', mono: 'n2h4' };") && ui.includes('if (ENGW.dirty) { ENGW.ask = b.dataset.v; engEl(\'engAsk\').hidden = false;') && html.includes('id="engAsk"') && ['eng.askType', 'eng.askYes', 'eng.askNo'].every(has), 'engine window: the type\'s default engine, asked first after hand edits');
  assert.ok(ui.includes('engChecks(s, { cea: pr.cea && CEA[pr.cea] ? engCea(CEA[pr.cea]) : null })') && html.includes('id="engWarn"') && ['warn.engOF', 'warn.engIsp', 'warn.engPort', 'warn.engLD', 'warn.engTW'].every(has), 'engine window: warnings (O/F, Isp, grain, T/W) in words');
  const sch = ui.slice(ui.indexOf('function engSchematic('), ui.indexOf('const SOL_GRAIN_VIEW'));
  assert.ok(sch.includes('engTanks(s, rho)') && sch.includes("_('eng.sch.end')") && has('eng.sch.end') && sch.includes('still = low || reduceMotion') && sch.includes('const fl = still ? 1 :') && sch.includes('flame2d(x, L, e * 0.95, col.plume,') && sch.indexOf('plume(X(c), e);') < sch.indexOf("x.fillStyle = hexA(col.metal, 0.75)"), 'cutaway: tanks by volume, the end view, the plume cone (flicker only when allowed), the nozzle over it in metal');
}
// 43) Burns in slow motion (2026-11-14, prefs.js burnShow / slowRho / slowAdvance, record.js recSchedule fires): a burn
// shows for at least a quarter of its length and at most its length (a 2 min burn 30 s, a 3 s burn 3 s, an 81 min
// burn 150 s), played at 60 frames/s from a fast base rate; the rate eases in and out (no step larger than about
// twice the last within a frame), a big frame step does not jump over a burn, a slow base rate is not sped up; impulsive
// burns burn for their own length centred on their moment (from 0 at the start); between burns the engine is off (no
// thrust, no plume: engStOf); the plume eases in and out over SLOW_W.fade s; the recording gives each burn its share,
// rates for the plume, and keeps the film's length; the rate shows by the clock.
{
  assert.ok(P.burnShow(120) === 30 && P.burnShow(3) === 3 && P.burnShow(8) === 3 && Math.abs(P.burnShow(4851) - 150) < 1e-9 && P.burnShow(2) === 2 && P.burnShow(600) === 150, 'slow motion: screen time by burn length');
  for (const [T, r0] of [[120, 3000], [4851, 600], [8, 1e5], [2, 100]]) {
    const f = P.slowFires([{ a: 1000, b: 1000 + T }]), dt = 1 / 60, rl = P.rampLen(f[0].c, r0);
    let t = 0, sin = 0, last = null, jump = 1;
    for (let k = 0; k < 4e5 && t < 1000 + T + 20 * r0; k++) {
      const t1 = P.slowAdvance(t, dt, r0, f);
      if (t >= 1000 && t1 <= 1000 + T) sin += dt;
      if (last && t > 1000 - 2 * rl && t < 1000 + T + 2 * rl) jump = Math.max(jump, (t1 - t) / last, last / (t1 - t));
      last = t1 - t; t = t1;
    }
    const show = P.burnShow(T);
    assert.ok(Math.abs(sin - show) < 0.05 * show + 2 * dt && sin >= Math.min(T / 4, 150) - 2 * dt && sin <= T + 2 * dt, `slow motion: a ${T} s burn shows ${sin.toFixed(2)} s (${show.toFixed(1)} s)`);
    assert.ok(jump < 2.2, `slow motion: the rate eases (largest change per frame ×${jump.toFixed(2)})`);
  }
  const f1 = P.slowFires([{ a: 1000, b: 1120 }]);
  assert.ok(P.slowAdvance(0, 0.5, 1e7, f1) < 1001, 'slow motion: a big frame step stops at the burn');
  assert.ok(Math.abs(P.slowAdvance(1030, 1, 2, f1) - 1032) < 0.6, 'slow motion: a slower base rate is kept');
  const ui = read('js/engine-ui.js'), app = read('js/app.js'), rj = read('js/record.js');
  assert.ok(ui.includes('const a = Math.max(0, Math.min(b.t - L / 2, T - L));') && ui.includes('function engStOf(s, tau, on) {') && ui.includes('if (!on) { st.on = false; st.F = 0; st.Fk = 0; }'), 'engine: impulsive burns centred on their moment; off between burns');
  assert.ok((ui + app).split('engState(s, on ? tau').length === 2 && !(ui + app).includes('engState(s, q.on'), 'engine: the firing comes from the mission, never from the load left');
  assert.ok(ui.includes('SLOW_W.fade * burnRate(q.j)') && ui.includes('pl = q.on ? st.Fk * Math.min(1, (t - a) / Math.max(w, 1e-9)) : ENGM.end[q.j] * (1 - q.e / w);') && P.SLOW_W.fade === 0.3, 'plume: lights and dies over 0.3 s of screen');
  assert.ok(app.includes('pa = playAdvance(t0, dt, r0, on ? slowFireList() : null, C.T, on ? SLOW.over : null)') && app.includes("_(SLOW.over ? 'tl.rateHand' : slow ? 'tl.rateSlow' : 'tl.rate', { r: fmtRate(rate), x: fmtX(rate) })") && has('tl.rate') && has('tl.rateSlow') && DICT['ui.slow'] === 'Yanmalarda yavaşla', 'slow motion: the playback runs through the warp, its rate by the clock');
  const Rc = require('../js/record.js'), base = Rc.recSchedule([0.3, 0.7]);
  const sc = Rc.recSchedule([0.3, 0.7], { fires: [{ ua: 0.3, ub: 0.3005, T: 120, show: 30 }, { ua: 0.7, ub: 0.72, T: 4851, show: 150 }], ease: { rate: P.rampRate, len: P.rampLen } }), n = sc.u.length;
  let rj2 = 1; for (let k = 2; k < n; k++) { const a = sc.u[k - 1] - sc.u[k - 2], b = sc.u[k] - sc.u[k - 1]; if (a > 0 && b > 0) rj2 = Math.max(rj2, a / b, b / a); }
  assert.ok(rj2 < 2.2, `recording: the rate eases into and out of the burns (×${rj2.toFixed(2)} per frame at most)`);
  const inF = (a, b) => sc.u.filter(u => u >= a && u <= b).length / sc.fps, b1 = inF(0.3, 0.3005), b2 = inF(0.7, 0.72);
  assert.ok(sc.T > base.T && sc.T <= Rc.REC_OPT.max && b1 > 0.8 && b2 > b1 * 3 && b1 + b2 <= Rc.REC_OPT.burnShare * sc.T + 0.2, `recording: burns get their share (${b1.toFixed(2)} s, ${b2.toFixed(2)} s of ${sc.T} s)`);
  assert.ok(sc.u[0] === 0 && sc.u[n - 1] === 1 && sc.u.every((u, k) => !k || u >= sc.u[k - 1]) && sc.fireC.length === 2 && sc.fireC.every(c => c > 0), 'recording: u grows, rates for the plume');
  assert.ok(rj.includes('fires: firesU(), ease: RAMP })') && rj.includes('REC.fireC = o;') && app.includes('if (REC.busy && REC.fireC) return REC.fireC[j]'), 'recording: the same mapping, the plume at the film\'s rates');
}
// 44) The engine a transfer flies when none is chosen (2026-11-15): an RL10-class stage (RL10A-4-2, the Centaur's dry
// mass) carrying a Mars Express-mass spacecraft, propellant just what the burns need: every ready-made transfer's
// departure burn between 30 s and 6 min (before: the default 400 N engine, 82 min); the big orbit raises from low orbit
// fly the Centaur with its RL10 (a ready-made vehicle brings its engine on loading)
{
  const ui = read('js/engine-ui.js'), app = read('js/app.js'), C = require('../js/core.js'), En = require('../js/engines.js'), Vh = require('../js/vehicles.js');
  assert.ok(ui.includes("return S.kind === 'man' ? ENG_DEF : ENG_AUTO;") && ui.includes("VEHICLES.find(v => v.id === 'centaur').md + VEHICLES.find(v => v.id === 'mex').m0") && ui.includes('1.02 * engNeed('), 'default engine: the sized stage');
  const rl = En.ENGINES.find(e => e.id === 'rl10'), md = Vh.VEHICLES.find(v => v.id === 'centaur').md + Vh.VEHICLES.find(v => v.id === 'mex').m0;
  const scStart = app.indexOf('const SCENARIOS = [') + 'const SCENARIOS = '.length, SC = require('vm').runInNewContext('(' + app.slice(scStart, app.indexOf('\n];', scStart) + 2) + ')');
  for (const sc of SC.filter(q => q.model !== 'man')) {
    const sp = C.engineSpec({ type: 'liq', F: rl.F, isp: rl.isp, of: rl.of, md, mp: 1.02 * C.engNeed(sc.M.dv, md, rl.isp) }), t = C.engBurns(sp, [sc.M.dv]).burns[0].t;
    assert.ok(t > 30 && t < 360, `default engine: ${sc.id} departs in ${t.toFixed(0)} s`);
  }
  for (const id of ['mv_leo_geo', 'mv_cape_geo', 'mv_bielliptic']) { const M = SC.find(q => q.id === id).M; assert.ok(M.veh === 'p:centaur' && M.F === 99200 && M.m0 === 23073, id + ': the Centaur'); }
  assert.ok(app.includes("if (S.kind === 'man' && S.M.veh && S.M.veh.startsWith('p:')) S.M.eng = engOfVehicle(S.M.veh.slice(2));"), 'a ready-made vehicle brings its engine');
}
// 45) The engine panel (2026-11-15): by the readout, ≈ 260 px wide, folds to its header (saved; phones folded by default:
// a strip with the bars and the two buttons); a small live cutaway (no labels), fuel and oxidizer bars in the charts'
// colours (one bar without an oxidizer), Δv left, thrust, firing / coasting and the time to the next burn; "Araca
// yaklaş" and "Kesit"; shown only when the mission's craft fires its engine, not on the map, in the scene or recording;
// an obstacle of the free plot area
{
  const ui = read('js/engine-ui.js'), app = read('js/app.js'), css = read('css/style.css');
  assert.ok(['engPanel', 'epTog', 'epState', 'epNext', 'epSch', 'epDv', 'epF', 'epOx', 'epFuel', 'epAppr', 'epCut'].every(id => html.includes('id="' + id + '"')) && ['ep.aria', 'ep.burn', 'ep.coast', 'ep.next', 'ep.left', 'ep.done', 'ep.dv', 'ep.F', 'ep.ox', 'ep.fuel', 'ep.prop', 'ep.fold', 'ep.unfold'].every(has), 'engine panel: its parts and words');
  assert.ok(css.includes('.eng-panel{pointer-events:auto;width:260px;order:-1;') && css.includes('.ep-bar.ox i{background:var(--cyan)}') && css.includes('.ep-bar.fuel i{background:var(--burn)}') && css.includes('.eng-panel.fold .ep-body{display:none}'), 'engine panel: size, bar colours, folding');
  assert.ok(ui.includes('const on = !!(m && m.burns && m.burns.length);') && ui.includes("epFold(sv ? sv === '1' : VW.phone.matches, false)") && ui.includes("bar('epOx', bi,") && ui.includes("{ k: 0.55, mini: true }") && ui.includes('s.ve * Math.log((s.md + left) / s.md)'), 'engine panel: only with burns, folded on phones, one bar without oxidizer, the small cutaway, Δv left');
  assert.ok(app.includes('engPanelTick(tNowG, !!(C && simR && !MAP.on && !SCENE.on && !REC.busy));') && app.includes("$('#engPanel'), $('#flyNode'), $('#timeline')") && app.includes("['#apprBtn', '#engAppr', '#epAppr']") && P.PREF_KEYS.engPanel, 'engine panel: per frame, an obstacle, its buttons, the saved fold');
}
// 46) The engine and the craft drawn closer to the real thing (2026-11-15): one continuous engine profile (injector dome,
// chamber, a cosine convergent into the throat, the bell leaving it with zero slope; the nozzle texture's heat tint at
// the profile's own throat), a gimbal block, feed lines with valves, a turbopump (cryogenic pairs) or pressurant
// bottles (storables); the storables' tanks in silver-grey quilted insulation (A of three compared; no gold foil); the
// cutaway's liquids the tank's own outline cut at the level by volume (core.js engTankLevel), in 3D and 2D; the 2D
// nozzle one outline
{
  const v3 = read('js/view3d.js'), ui = read('js/engine-ui.js');
  const prof = v3.slice(v3.indexOf('function engineProfile(o)'), v3.indexOf('// a tube along points'));
  assert.ok(prof.includes('0.5 - 0.5 * Math.cos(Math.PI * f)') && prof.includes('f / (f + 0.04)') && prof.includes('vt: cum[it] / tot') && v3.includes("M.nozLiq = T('nozLiq', { vt: ep.vt, ve: ep.ve });") && v3.includes("M.nozAbl = T('nozAbl', { vt: ep.vt });"), 'engine: one continuous profile, the heat tint at its throat');
  assert.ok(v3.includes('new THREE.TubeGeometry(') && v3.includes('// gimbal block') && v3.includes('// pressure-fed: the bipropellant valve block on the injector, helium bottles') && v3.includes('if (cryo) { // the turbopumps') && v3.includes('const valve = (cv, u, r'), 'engine: gimbal, feed lines, valves, turbopump or pressurant bottles');
  assert.ok(v3.includes("const TANK_FIN = 'quiltA';") && v3.includes('function quilt(') && !v3.includes('  mli(') && !v3.includes("'mli'"), 'tanks: silver-grey quilted insulation, no gold foil');
  assert.ok(v3.includes('if (vY > uClip) discard;') && v3.includes('m.material.uniforms.uClip.value = f.y0 + f.r * engTankLevel(k, len / f.r, f.k);') && v3.includes('new THREE.ShapeGeometry(sh, 4)'), 'cutaway 3D: the liquid in the tank\'s outline, its level by volume');
  assert.ok(ui.includes('r * engTankLevel(level, (x1 - x0) / r, 1)') && ui.includes('r * engTankLevel(st.fuel, 2, 1)') && ui.includes('// one continuous outline (2026-11-15)'), 'cutaway 2D: levels by volume, one nozzle outline');
}
// 47) Close to the craft (2026-11-15): the grid, the bodies' orbits and tracks fade out with the camera's distance
// (gone within 2 km, back by 80 km, smooth in its logarithm), the craft's own path down to a faint thin line; bodies,
// Sun and sky stay; on top of each line's own opacity
{
  const m3 = read('js/mode3d.js'), v3 = read('js/view3d.js'), ctx = {};
  require('vm').runInNewContext(m3.slice(m3.indexOf('const NEAR3 = '), m3.indexOf('// grid spacing for the camera distance')) + ';this.f = nearFade3;', ctx);
  assert.ok(ctx.f(100) === 0 && ctx.f(2e3) === 0 && ctx.f(8e4) === 1 && ctx.f(1e7) === 1 && ctx.f(1e4) > 0 && ctx.f(1e4) < ctx.f(3e4), 'close view: the fade by distance');
  assert.ok(m3.includes("const nk = S.follow === 'craft' ? nearFade3(c.dist) : 1;") && m3.includes("V3.fadeSet('sim', nk, OWN3, nk);") && m3.includes('grid3(c, V3S.grid, nk);') && m3.includes("OWN3 = new Set(['path', 'pathB', 'osc', 'conn', 'trail', 'park'])"), 'close view: lines and grid fade, the own path faint');
  assert.ok(v3.includes('m.opacity = m.userData.base * f;') && v3.includes("h.mats[0].userData.base = opacity; fadeApply(set, id, h.mats[0]);"), 'close view: on top of each line\'s opacity');
}
// 48) Sound on the simulator page (2026-11-15, js/sim-audio.js): no files (generated hum and engine rumble), Web Audio
// only after the first gesture, a quiet start; the speaker button by "Görünüm" with on / volume / the engine effect, saved
// (parseSimAudio falls back per field); the rumble's level the plume's strength times the camera's closeness, only while
// playing; suspended in a hidden tab; the cabin page does not load it
{
  const sa = read('js/sim-audio.js'), app = read('js/app.js'), cab = read('kabin.html');
  assert.ok(sa.includes("for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, function first()") && sa.includes('if (SA.ctx || !SA.set.on) return;'), 'sound: started by the first gesture');
  // the ambience (2026-11-15): a deep drone (steep low-passes moved by a slow LFO, detuned low tones) by default, or the
  // cabin's NASA recordings (the cabin's files, already credited); the rumble low-passed, no hiss
  assert.ok(sa.includes('l1 = saLow(c, 110), l2 = saLow(c, 110)') && sa.includes('sweep.frequency.value = 0.035') && sa.includes("[[41, 'sine', 0.5], [41.6, 'sine', 0.45], [61.5, 'triangle', 0.25]]") && sa.includes("'audio/cabin/space/' + q.id + '.' + ext") && sa.includes('e1 = saLow(c, 85), e2 = saLow(c, 85)') && !sa.includes('frequency.value = 220'), 'sound: a deep drone or the NASA recordings, a muffled rumble');
  assert.ok(P.SIM_AUDIO.kind === 'deep' && P.parseSimAudio('{"kind":"rec"}').kind === 'rec' && P.parseSimAudio('{"kind":"x"}').kind === 'deep' && html.includes('id="sndKind"') && ['snd.kind', 'snd.deep', 'snd.rec'].every(has) && html.indexOf('js/sounds.js') < html.indexOf('js/sim-audio.js'), 'sound: two ambiences to choose, the deep drone by default');
  assert.ok(sa.includes("SA.out.gain.setTargetAtTime(s.on ? 0.5 * s.vol * s.vol : 0, t, 0.4);") && P.SIM_AUDIO.vol <= 0.4 && sa.includes("if (document.hidden) { SA.ctx.suspend(); saRec(false); }"), 'sound: a quiet start, suspended when hidden');
  // 2026-11-15: the default volume halved (0.35 → 0.18); a saved volume stays as saved
  assert.ok(P.SIM_AUDIO.vol === 0.18 && P.parseSimAudio('{}').vol === 0.18 && P.parseSimAudio('{"vol":0.35}').vol === 0.35 && P.parseSimAudio(null).vol === 0.18, 'sound: half the old default, saved settings untouched');
  const d = P.parseSimAudio('{"on":false,"vol":7,"eng":"x"}');
  assert.ok(d.on === false && d.vol === 1 && d.eng === true && P.parseSimAudio('nope').on === true && P.PREF_KEYS.simAudio, 'sound: saved settings, each field falls back');
  // the city lights fade once magnified (globe.js nightFade: full to 2 px per texel, gone by 5)
  const gl = read('js/globe.js'), ctxN = {}; require('vm').runInNewContext(gl.slice(gl.indexOf('function nightFade('), gl.indexOf('function globeLook(')) + ';this.f = nightFade;', ctxN);
  const img = { img: { naturalWidth: 4096 } };
  assert.ok(ctxN.f(1000, img) === 1 && ctxN.f(4000, img) === 0 && ctxN.f(2600, img) > 0 && ctxN.f(2600, img) < 1 && ctxN.f(9e5, null) === 1 && gl.includes('* uLayers.y *'), 'city lights: fade when magnified');
  assert.ok(['sndBtn', 'sndPop', 'sndOn', 'sndVol', 'sndEng'].every(id => html.includes('id="' + id + '"')) && ['snd.btn', 'snd.title', 'snd.on', 'snd.vol', 'snd.eng', 'snd.engTip', 'snd.note'].every(has), 'sound: the button and its panel');
  assert.ok(app.includes("simAudioTick(FREE.on ? (FREE.appr && !FREE.paused ? FREE.pl * (FREE.fq || 1) : 0) : near > 0 ? engNow(tNowG).pl * near : 0);") && app.includes('!S.playing ? 0 :') && !cab.includes('sim-audio.js'), 'sound: the rumble by thrust and closeness, while playing (free flight: not paused); not on the cabin page');
  // 2026-11-21 (Phase 20A-1): the level by thrust — silent at zero, louder and brighter with the throttle, a change to zero
  // never skipped (before, a step under 0.01 was ignored and the last faint level could hang on), a short release
  const z = P.engSound(0), lo = P.engSound(0.2), hi = P.engSound(1);
  assert.ok(z.gain === 0 && !z.on && P.engSound(NaN).gain === 0 && P.engSound(-1).gain === 0 && P.engSound(0.003).gain === 0, 'engine sound: none at zero thrust');
  assert.ok(lo.gain > 0 && hi.gain > lo.gain && hi.cut > lo.cut && P.engSound(0.5).gain > lo.gain && hi.gain <= 0.9 + 1e-12, 'engine sound: rises with the throttle (level and brightness)');
  assert.ok(sa.includes('engSound(') && sa.includes('if (v === SA.lvl ||') && sa.includes('ENG_SND.rel') && P.ENG_SND.rel <= 0.2 && read('js/fly.js').includes('FREE.fq = th ? th.fq : FREE.fq;'), 'engine sound: always reaches zero, fades quickly, the thrust of a curve counts');
}
// 49) Free flight, the mode (Phase 19b, js/fly.js): entered from the mission's moment (real model; "Serbest uçuş" by the
// timeline), flown in the map's system (N-body below 1000×, on rails above), drawn on the map view with its prediction,
// trail and marker; the warp bar in place of the timeline (pause, the warp steps, "Şimdi", date / body / altitude /
// speed, "Çık"), , and . for the warp, Space pauses; the mission's windows step aside; one sessionStorage snapshot that
// comes back on a reload (parseFlySnap: finite, 12 hours)
{
  const fl = read('js/fly.js'), app = read('js/app.js'), now = Date.now(), ok = { t: 8.5e8, r: [1, 2, 3], v: [4, 5, 6], m: 1000, warp: 100, at: now - 1000 };
  assert.ok(P.parseFlySnap(JSON.stringify(ok), now).warp === 100 && P.parseFlySnap(JSON.stringify({ ...ok, at: now - 13 * 3600e3 }), now) === null && P.parseFlySnap(JSON.stringify({ ...ok, r: [1, 2] }), now) === null && P.parseFlySnap('x', now) === null && P.PREF_KEYS.flySnap, 'free flight: the snapshot');
  assert.ok(['flyNode', 'flyPause', 'flyWarp', 'flyNow', 'flyExit', 'flyDate', 'flyBody', 'flyGo'].every(id => html.includes('id="' + id + '"')) && ['fly.bar', 'fly.warp', 'fly.play', 'fly.pause', 'fly.now', 'fly.nowTip', 'fly.exit', 'fly.exitTip', 'fly.go', 'fly.goTip', 'fly.state', 'chip.fly'].every(has), 'free flight: the time controls (in the panel since 2026-11-16) and their words');
  assert.ok(fl.includes('flyAdvance(mapSys, s, adv, { rails: !th && FREE.warp >= RAILS_W, thrust: th, maxSteps: 4000 })') && fl.includes('if (!FREE.paused) flyStep(Math.min(dt, PLAY_DT_MAX), b);') && fl.includes('const RAILS_W = 1000') && fl.includes('flyPredict(mapSys, s.t, s.r, s.v, { revs: 1, T: Math.max(0, last) + (far ? 400 : 30) * DAY, K: 120, nodes: FREE.nodes, maxSeg: 10 })') && fl.includes("if (e.key === '.' || e.key === ',')") && fl.includes("e.code === 'Space'"), 'free flight: the advance, the prediction, the keys');
  assert.ok(app.includes('if (FREE.on) { flyFrame(dtw, v3, glow, now);') && app.includes('if (flyRestore()) startClose();') && app.includes("$('#flyGo').addEventListener('click', () => flyEnter());") && app.includes('|| !sys || FREE.on) return null;') && read('css/style.css').includes('html[data-fly] #timeline,html[data-fly] #readout'), 'free flight: hooked into the draw loop, restored on start, the mission path off the map');
}
// 50) The craft up close, framed again (2026-11-15): the mission's windows fold and unfold again; the craft in the middle of
// the free area, its length ≈ 45 % of it along its axis on screen, seen across the thrust axis a little from above and
// behind with the local vertical up (a low orbit shows the horizon), the cutaway's face up towards the camera; a body
// seen from close gets no label, hit or ring (from 400 km the Earth's hit ring circled the craft), large hits no hover
// ring; the night side keeps a faint light where the city lights fade; the flame held down up close; the scale bar in m.
{
  const app = read('js/app.js'), m3 = read('js/mode3d.js'), gl = read('js/globe.js'), v3 = read('js/view3d.js');
  assert.ok(app.includes("APPR_K = 0.45, APPR_FOLD = ['mission', 'results', 'overview', 'engine']") && app.includes('WINS[id].collapsed = true; applyWin(id); APPR.fold.push(id);') && app.includes('for (const id of APPR.fold) if (WINS[id].open && WINS[id].collapsed) { WINS[id].collapsed = false; applyWin(id); }'), 'approach: windows fold and come back');
  assert.ok(m3.includes('apprAim(c, craftAxis3(tNow, craft, ext), craftUp3(tNow, craft, ext), sd || [1, 0, 0]);') && m3.includes('} else apprKeep(c);') && m3.includes('if (needFit && !APPR.on) fit3();'), 'approach: aimed on the first frame, kept in the free area, no refit');
  // the aim itself (sandboxed): the craft across the view, the camera above and behind, the local vertical up on screen
  const sb = { Math, APPR_K: 0.45, APPR_EL: 85 * Math.PI / 180, FOV3: 45, W: 1440, H: 900, CRAFT: { L: 3, cut: false }, APPR: { aim: null }, FLY: {}, reduceMotion: false, flyTo() {}, insets: () => ({ l: 0, r: 0, t: 100, b: 250 }) };
  require('vm').runInNewContext('const clamp = (x, a, b) => Math.min(b, Math.max(a, x));' + app.slice(app.indexOf('const unit3 = '), app.indexOf('\n', app.indexOf('const unit3 = '))) + m3.slice(m3.indexOf('const CB = {'), m3.indexOf('// screen position of view-frame point p')) +
    app.slice(app.indexOf('function apprBox()'), app.indexOf('// while close: the craft stays')) + ';this.aim = apprAim; this.cb = camBasis; this.cutSide = cutSide;', sb);
  const ax = [1, 0, 0], vert = [0, 0.6, 0.8], c = { t: [0, 0, 0], yaw: 0, elev: 0, dist: 1, roll: 0, fov: 45 };
  sb.aim(c, ax, vert, [0, -1, 0]);
  const B = sb.cb(c), dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2], vu = vert.map((v, k) => v - dot(vert, B.d) * B.d[k]);
  const across = Math.abs(dot(B.d, ax)), lpx = 3 * Math.hypot(dot(ax, B.r), dot(ax, B.u)) * B.f / c.dist;
  assert.ok(across < 0.35 && dot(B.d, ax) < 0 && dot(B.d, vert) > 0.2 && dot(B.d, vert) < 0.6, `approach: across the axis (${across.toFixed(2)}), from behind and a little above`);
  assert.ok(dot(B.u, vu) / Math.hypot(...vu) > 0.99, 'approach: the local vertical up on screen');
  assert.ok(Math.abs(lpx / 1440 - 0.45) < 0.02 && c.cx === 720 && c.cy === 100 + 550 / 2, `approach: the craft ${(lpx / 1440 * 100).toFixed(0)} % of the free area, in its middle`);
  sb.CRAFT.cut = true; sb.aim(c, ax, vert, [0, -1, 0]);
  const sdC = sb.cutSide(ax, vert); assert.ok(dot(sb.cb(c).d, sdC) > 0.75 && Math.abs(dot(sdC, vert)) < 1e-9, 'approach: with the cutaway, onto its face (sideways, 2026-11-21)');
  assert.ok(m3.includes('cutSide(ax, craftUp3(tNow, craft, ext))') && app.includes("if (APPR.on && is3d() && !APPR.aim) { if (FREE.on) FREE.aim = flyFrom(); else APPR.aim = flyFrom(); }"), 'approach: the cut faces sideways; toggling it turns the camera');
  // 2026-11-21 (Phase 20A-2): the cut plane holds the body axis, its face square to the nose and to the local vertical
  // (before: it looked up, the cut seen from above); the approach looks onto it
  {
    const sbC = {}; require('vm').runInNewContext(app.slice(app.indexOf('const unit3 = '), app.indexOf(String.fromCharCode(10), app.indexOf('const unit3 = '))) + app.slice(app.indexOf('function acrossUp('), app.indexOf('// 3D, the first frame after')) + ';this.cs = cutSide;', sbC);
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    for (const [ax, up] of [[[1, 0, 0], [0, 0, 1]], [[0.6, 0.8, 0], [0.3, -0.2, 0.93]], [[0, 0, 1], [0, 0, 1]]]) {
      const s = sbC.cs(ax, up);
      assert.ok(Math.abs(Math.hypot(...s) - 1) < 1e-9 && Math.abs(dot(s, ax)) < 1e-9 && Math.abs(dot(s, up) - dot(ax, up) * 0) < 1 && Math.abs(dot(s, sbC.cs(ax, up))) > 0.999, 'cutaway: a unit side square to the axis');
    }
    const s1 = sbC.cs([1, 0, 0], [0, 0, 1]);
    assert.ok(Math.abs(dot(s1, [0, 0, 1])) < 1e-12 && Math.abs(Math.abs(s1[1]) - 1) < 1e-12, 'cutaway: the face looks sideways (not up)');
    assert.ok(app.includes('let w = cutSide(ax, vert);') && app.includes('if (!CRAFT.cut && dot(w, sun) < 0)') && !app.includes('CRAFT.cut ? up.map('), 'cutaway: the approach looks onto its face');
  }
  assert.ok(m3.includes('function close3(p, o, R)') && m3.includes('behind3(BP3, 3 * b, b) || close3(BP3, 3 * b, sys.R[b])') && m3.includes('close3(pos, 3 * i, mapSys.R[i])') && app.includes('if (!h || h.r > 60) return;'), 'approach: no label, hit or ring on a body seen from close');
  assert.ok(m3.includes("const td = !ext && lpx < 14 ? thrustNow(tNow, craft) : null;") && m3.includes('vl > 1e-6 && lpx < 14'), 'approach: no arrows over the model');
  const ctxL = {}; require('vm').runInNewContext(gl.slice(gl.indexOf('function nightFade('), gl.indexOf('function globeLook(')) + ';this.f = nightLow;', ctxL);
  const img = { img: { naturalWidth: 4096 } };
  assert.ok(ctxL.f(1000, img) === 0 && ctxL.f(4000, img) === 1 && ctxL.f(9e5, null) === 1 && ctxL.f(100, null) === 0 && gl.includes('uniform float uNightLo;') && gl.includes("'uNightLo'") && v3.includes('u.uNightLo.value = U.nightLo;') && gl.includes('nightLo: b.night ? nightLow(r, ni && ni.e) : 0'), 'night side: a faint light up close, both renderers');
  const pn = {}; require('vm').runInNewContext(m3.slice(m3.indexOf('const PLUME_NEAR'), m3.indexOf('function craft3(')) + ';this.f = plumeNear;', pn);
  assert.ok(pn.f(1) === 0 && pn.f(20) === 1 && pn.f(6) > 0 && pn.f(6) < 1 && m3.includes('* (0.3 + 0.7 * nq) : 0, len: (1.0 + 2.0 * k) * fl * (0.5 + 0.5 * nq)'), 'plume: held down up close');
  const fd = {}; require('vm').runInNewContext('const nf0 = new Intl.NumberFormat("tr", { maximumFractionDigits: 0 }), nf1 = new Intl.NumberFormat("tr", { minimumFractionDigits: 1, maximumFractionDigits: 1 }), nf2 = new Intl.NumberFormat("tr", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), nf3 = nf2; const _ = k => k;' + app.slice(app.indexOf('function fmtDist(m)'), app.indexOf('function fmtSpeed')) + ';this.f = fmtDist;', fd);
  assert.ok(fd.f(5) === '5 m' && fd.f(0.5) === '0,50 m' && fd.f(200) === '200 m' && fd.f(2000) === '2,0 km', 'scale bar: metres up close');
}
// 51) The playback speed (2026-11-15): rates of real time 1× (real time), 2×, 5×, 10×, 30×, 60× before the large ones;
// the clock's tag says the multiple of real time too; at real time "Yanmalarda yavaşla" goes off and faint and comes back
// as it was; a speed picked during a burn holds for that burn (faster or slower, capped by its length), the next burn
// slows down on its own; , and . step the speeds in the mission too.
{
  const app = read('js/app.js'), opts = [...html.matchAll(/<option value="(r\d+)"/g)].map(m => +m[1].slice(1));
  assert.deepStrictEqual(opts.slice(0, 7), [1, 2, 5, 10, 20, 30, 60], 'speed: real-time rates first');
  assert.ok(opts.slice(7).every(r => r >= 3600) && DICT['speed.r1'].includes('gerçek zaman'), 'speed: then the large ones; 1× says real time');
  assert.ok(['tl.rate', 'tl.rateSlow', 'tl.rateHand'].every(k => DICT[k].includes('{x}× gerçek zaman')) && has('ui.slowRt'), 'speed: the tag says the multiple of real time');
  // real time: 10 s of frames (60 per second, slow motion off) = 10 s of mission time
  let t = 500, r;
  for (let i = 0; i < 600; i++) { r = P.playAdvance(t, 1 / 60, 1, null, 1e6, null); t = r.t; }
  assert.ok(Math.abs(t - 510) < 1e-6 && r.rate === 1, `speed: real time, 10 s on the wall clock = ${(t - 500).toFixed(6)} s of mission`);
  // a long burn (2000 s) in slow motion: on its own 2000 / 150 ≈ 13.3×; picked by hand 20× (under the cap) → 20× until
  // its end, then the next burn slows down on its own again
  const f = P.slowFires([{ a: 1000, b: 3000, j: 0 }, { a: 9000, b: 11000, j: 1 }]), r0 = 600;
  assert.ok(Math.abs(P.playAdvance(1500, 1 / 60, r0, f, 1e6, null).rate - 2000 / 150) < 1e-6, 'speed: the burn on its own');
  const cap = Math.min(20, 50), over = { ...P.fireAt(f, 1500), r: cap };
  let q = P.playAdvance(1500, 1 / 60, r0, f, 1e6, over);
  assert.ok(q.rate === 20 && Math.abs(q.t - (1500 + 20 / 60)) < 1e-9 && q.over, 'speed: picked during a burn, 20× is 20×');
  t = 1500; let o = over; for (let i = 0; i < 400 && t < 3000; i++) { q = P.playAdvance(t, 0.5, r0, f, 1e6, o); t = q.t; o = q.over; }
  assert.ok(t === 3000 && P.playAdvance(t, 1 / 60, r0, f, 1e6, o).over === null, 'speed: the own rate ends with its burn');
  assert.ok(Math.abs(P.playAdvance(10000, 1 / 60, r0, f, 1e6, null).rate - 2000 / 150) < 1e-6, 'speed: the next burn slows down on its own');
  assert.ok(P.playAdvance(1500, 1 / 60, 2, f, 1e6, { ...P.fireAt(f, 1500), r: 2 }).rate === 2, 'speed: slower by hand too');
  assert.ok(app.includes('r: Math.min(S.rate ||') && app.includes('flyWarpMax(f.b - f.a)') && app.includes('const rt = S.rate === 1, el = $(\'#slow\');') && app.includes("el.disabled = rt; el.closest('label').classList.toggle('off', rt);") && read('css/style.css').includes('.chk.off{opacity:.45'), 'speed: capped by the burn; real time turns the slow motion off, faint');
  assert.ok(app.includes("if ((e.key !== ',' && e.key !== '.') || FREE.on") && app.includes('sort((p, q) => speedRate(p, T) - speedRate(q, T))'), 'speed: , and . in the mission, by rate');
}
// 52) Maneuver nodes (Phase 19c, js/fly.js): a click on the predicted path puts a node, a click on its mark selects it;
// six handles drag the components (faster further out, Shift finer); the panel's number fields, total, the orbit after,
// Sil and ↶ (U); Delete; the path after the first node in cyan; dashed and faint while dragged and until the N-body
// refinement (core.js flyRefine, in a worker) is back; the nodes kept in the snapshot.
{
  const fl = read('js/fly.js'), app = read('js/app.js'), v3 = read('js/view3d.js'), now = Date.now(), snap = { t: 8.5e8, r: [1, 2, 3], v: [4, 5, 6], m: 1000, warp: 1, at: now - 1000 };
  const q = P.parseFlySnap(JSON.stringify({ ...snap, nodes: [{ t: 8.5e8 + 600, d: [100, 0, -5] }, { t: 'x', d: [1, 2, 3] }, { t: 1, d: [1, 2] }] }), now);
  assert.ok(q.nodes.length === 1 && q.nodes[0].d[2] === -5 && P.parseFlySnap(JSON.stringify(snap), now).nodes.length === 0 && P.FLY_NODES_MAX >= 8, 'nodes: kept in the snapshot, the broken ones dropped');
  assert.ok(['flyNode', 'fnHint', 'fnBody', 'fnTitle', 'fnIn', 'fnPro', 'fnRad', 'fnNor', 'fnTot', 'fnAfter', 'fnProv', 'fnUndo', 'fnDel', 'fnPrev', 'fnNext'].every(id => html.includes('id="' + id + '"')) &&
    ['fn.aria', 'fn.hint', 'fn.pick', 'fn.title', 'fn.in', 'fn.pro', 'fn.rad', 'fn.nor', 'fn.tot', 'fn.orbit', 'fn.escape', 'fn.impact', 'fn.prov', 'fn.tip', 'fn.del', 'fn.undoTip'].every(has), 'nodes: the panel and its words');
  assert.ok(app.includes('if (flyTap(x, y, touch)) return;') && fl.includes("flyEl('stage').addEventListener('pointerdown'") && fl.includes('}, true);') && fl.includes("e.key === 'u' || e.key === 'U'") && fl.includes("e.key === 'Delete' || e.key === 'Backspace'"), 'nodes: taps, handle drags before the camera, U and Delete');
  // the drag's mapping: proportional near the node, faster further out, a tenth with Shift
  const dvs = {}; require('vm').runInNewContext(fl.slice(fl.indexOf('const flyDv = '), fl.indexOf('\n', fl.indexOf('const flyDv = '))) + '\nthis.f = flyDv;', dvs);
  assert.ok(Math.abs(dvs.f(10, false) - 10.83) < 0.01 && dvs.f(240, false) > 700 && Math.abs(dvs.f(100, true) - dvs.f(100, false) / 10) < 1e-9 && dvs.f(-50, false) < 0, 'nodes: the handle mapping');
  assert.ok(fl.includes("if (nn && FREE.ref && FREE.ref.ver === FREE.ver && !FREE.drag) return { segs: FREE.ref.segs, prov: false };") && fl.includes('ctx.setLineDash(pa.prov ? [6, 5] : [])') && fl.includes("V3.dynSet('map', 'flyP' + k, ao.p, m, FLY3.col, pa.prov ? flyDash(ao) : 0, CB.e)") && v3.includes('function dynOpacity(') && v3.includes('const gap = fl ? !!dash[j] : dash > 0'), 'nodes: dashed and faint until the refinement, then solid (2D and 3D)');
  assert.ok(app.includes('if (fly) { try { if (!self.FS) self.FS = buildSystem(list); postMessage({ done: flyRefine(self.FS, fly.t0, fly.r, fly.v, fly.opt), ver: fly.ver });') && fl.includes('now - FREE.editAt < FLY_REF_MS') && fl.includes('if (FREE.wkBusy && FREE.wk) { FREE.wk.terminate();'), 'nodes: the refinement in a worker, after a pause, a newer edit drops an old run');
}
// 53) Free flight's engine (Phase 19d, js/fly.js): the mission's engine at that moment (spec, clock, so the propellant
// left), "Otomatik ateşle" (a burn centred on the node, along its Δv fixed in space, cut at its Δv), the warp never over a
// burn's start and held at flyWarpMax while firing (steps above disabled), "Düğüme hızlandır", the throttle W/S/Z/X and
// the direction locks, the budget (burn, propellant, a warning), the engine panel, the 3D model in the map's set,
// "Araca yaklaş" and the double click, the hints the first time and "Nasıl uçulur?" under the mode chip; the snapshot
// keeps the engine.
{
  const fl = read('js/fly.js'), app = read('js/app.js'), m3 = read('js/mode3d.js'), v3 = read('js/view3d.js'), css = read('css/style.css'), now = Date.now();
  const snap = { t: 8.5e8, r: [1, 2, 3], v: [4, 5, 6], m: 1000, warp: 1, at: now - 1000 };
  const q = P.parseFlySnap(JSON.stringify({ ...snap, eng: { E: { type: 'liq', F: 1 }, tau: 12, auto: false, lock: 'nor' } }), now);
  assert.ok(q.eng && q.eng.tau === 12 && q.eng.auto === false && q.eng.lock === 'nor' && P.parseFlySnap(JSON.stringify({ ...snap, eng: { tau: 1 } }), now).eng === null && P.PREF_KEYS.flyTips, 'engine: kept in the snapshot');
  assert.ok(fl.includes('else if (C && simR) { const en = engNow(tNowG); E = en.E; s = en.s; tau = Math.min(en.tau, s ? s.tb : 0); }') && fl.includes('FREE.st.m = s.md + Math.max(0, s.mp - u.fuel - u.ox);'), 'engine: the mission\'s, with what is left');
  assert.ok(fl.includes('start: nd.t - b.T / 2') && fl.includes('const nd = FREE.nodes[0], q = FREE.nst[0], dvI = nodeDv(q.r, q.v, nd.d)') && fl.includes('else done = done || B.goal - got < 1e-3;') && fl.includes('done = done || (B.up ? q.E >= B.E - 1e-3 : q.E <= B.E + 1e-3)'), 'engine: the auto burn centred on its node, along its Δv, cut at it');
  assert.ok(fl.includes('if (!th && nb && nb.start > s.t) adv = Math.min(adv, nb.start - s.t);') && fl.includes('FREE.cap = th || FREE.burn ? (FREE.burn ? flyWarpMax(FREE.burn.T) : 10) : Infinity;') && fl.includes('bt.disabled = +bt.dataset.w > FREE.cap;') && fl.includes('rails: !th && FREE.warp >= RAILS_W'), 'engine: never over a burn\'s start, the warp held while firing, in the field');
  assert.ok(['fnBurn', 'fnWarn', 'fnWarp', 'fnAuto', 'fnLock', 'fnThr', 'flyHelp', 'flyTip', 'flyTipText', 'flyTipNext', 'flyTipSkip', 'flyHow'].every(id => html.includes('id="' + id + '"')) &&
    ['fn.burn', 'fn.short', 'fn.warp', 'fn.warpTip', 'fn.auto', 'fn.autoTip', 'fn.thrL', 'fn.lockAria', 'fn.thr', 'fn.thrTip', 'fly.how', 'fly.tipN', 'fly.tipNext', 'fly.tipDone', 'fly.tipSkip', 'fly.tip.appr', 'fly.tip.node', 'fly.tip.drag', 'fly.tip.warp', 'fly.tip.auto'].every(has) &&
    ['pro', 'retro', 'radOut', 'radIn', 'nor', 'anti'].every(k => has('fn.lock.' + k) && has('fn.lockS.' + k)), 'engine: the controls and their words');
  assert.ok(["e.key === 'w' || e.key === 'W'", "e.key === 's' || e.key === 'S'", "e.key === 'z' || e.key === 'Z'", "e.key === 'x' || e.key === 'X'"].every(k => fl.includes(k)), 'engine: the throttle keys');
  assert.ok(app.includes('if (FREE.on) flyEngPanel(); else engPanelTick(') && !css.includes('html[data-fly] #engPanel') && fl.includes("engSchematic(engEl('epSch'), s, st, e.E,"), 'engine: the engine panel in free flight');
  assert.ok(m3.includes("if (FREE.on) flyCraft3(c); else V3.craft({ show: false });") && v3.includes("root = roots[o.set || 'sim'];") && v3.includes('craftG.group.parent !== roots[set]') && fl.includes("craftDraw('map', p, ax, cutSide(ax, up), L, sun,"), 'engine: the 3D model in the map\'s set');
  assert.ok(app.includes('if (FREE.on) { flyAppr(on); return; }') && m3.includes('if (FREE.on && FREE.appr) flyApprCam(c);') && m3.includes('return FREE.appr ? CRAFT.L * 0.9 :') && fl.includes('apprAim(c, ax, unit3(r) || [0, 0, 1], sun)'), 'engine: "Araca yaklaş" and the double click in free flight');
  assert.ok(fl.includes("flyTips(readPref(LS, PREF_KEYS.flyTips) ? -1 : 0);") && fl.includes("flyEl('flyHow').addEventListener('click', () => flyTips(0));") && fl.includes("else if (FREE.on) writePref(LS, PREF_KEYS.flyTips, '1');") && css.includes('.fly-help{position:absolute'), 'engine: the hints once, skippable, "Nasıl uçulur?" always');
  assert.ok(app.includes("cv.addEventListener('mousedown', e => { if (e.detail > 1) e.preventDefault(); });"), 'a double click selects no text');
}
// 54) Targets and transfer windows (Phase 19e, js/fly.js): a target list (nearby first), how the path meets it (its
// sphere and the pass, else the closest approach) drawn as the target's and the craft's places then; "Transfer
// penceresi" runs core.js flyWindow in a worker; "Düğümleri koy" lays its nodes (the ejection and, between planets, the
// course correction) in one undo step; the auto burn cut on the orbit's energy when mostly prograde; the prediction long
// enough to reach a far target; the map frames a new dominant body; the snapshot keeps the target.
{
  const fl = read('js/fly.js'), app = read('js/app.js'), now = Date.now(), snap = { t: 8.5e8, r: [1, 2, 3], v: [4, 5, 6], m: 1000, warp: 1, at: now - 1000 };
  assert.ok(P.parseFlySnap(JSON.stringify({ ...snap, target: 'mars' }), now).target === 'mars' && P.parseFlySnap(JSON.stringify(snap), now).target === null, 'targets: kept in the snapshot');
  assert.ok(['fnTgt', 'fnTgtInfo', 'fnWin', 'fnWinInfo', 'fnWinGo'].every(id => html.includes('id="' + id + '"')) &&
    ['fn.tgt', 'fn.tgtNone', 'fn.tgtNear', 'fn.tgtAll', 'fn.tgtWait', 'fn.tgtCa', 'fn.tgtPass', 'fn.tgtHit', 'fn.tgtCaS', 'fn.tgtPassS', 'fn.tgtHitS', 'fn.win', 'fn.winTip', 'fn.winBusy', 'fn.winIn', 'fn.winSib', 'fn.winGo', 'err.flyWinSame', 'err.flyWinOrbit', 'err.flyWinCase', 'err.flyWinNone'].every(has), 'targets: the controls and their words');
  assert.ok(app.includes("if (e.data.flyWin) { const q = e.data.flyWin; try { postMessage({ done: flyWindow(buildSystem(list), q.t0, q.r, q.v, q.c) });") && fl.includes("w.postMessage({ list: mapList(), flyWin: job });"), 'targets: the window in a worker');
  assert.ok(fl.includes('for (const nd of r.nodes || [r.node]) FREE.nodes.push(') && fl.includes('flyEdit(); for (const nd of r.nodes'), 'targets: the window\'s nodes, one undo step');
  assert.ok(fl.includes("const pr = FREE.pred, ev = pr.events.find(e => e.type === 'soiIn' && e.b === c)") && fl.includes('const ca = flyClosest(mapSys, pr, c);') && fl.includes('now - FREE.tcaAt < FLY_CA_MS') && fl.includes('flyTcaDraw(true)') && fl.includes('flyTcaDraw(false)'), 'targets: the meeting, throttled, drawn in both views');
  assert.ok(fl.includes('const E = along > 0.5 ?') && fl.includes('T: Math.max(0, last) + (far ? 400 : 30) * DAY') && fl.includes('if (was >= 0 && !FREE.appr) flyFrameBody(b);'), 'targets: the energy cut, the long horizon, the new body framed');
}
// 55) The course correction (2026-11-15): "Düzeltme öner" and a suggestion by itself after a burn and ~30 % of the way,
// core.js flyCorrect in a worker, "Geçiş 1.506 km → düzeltme 12 m/s ile 100 km", "Düzeltmeyi koy" (one undo step)
{
  const fl = read('js/fly.js'), app = read('js/app.js');
  assert.ok(['fnCorRow', 'fnCor', 'fnCorInfo', 'fnCorGo'].every(id => html.includes('id="' + id + '"')) && ['fn.cor', 'fn.corTip', 'fn.corBusy', 'fn.corIs', 'fn.corOk', 'fn.corGo', 'err.flyCorNone', 'err.flyCorLate'].every(has), 'correction: the controls and their words');
  assert.ok(DICT['fn.corIs'] === 'Geçiş {from} → düzeltme {dv} m/s ile {to}', 'correction: the line as asked');
  assert.ok(app.includes('if (e.data.flyCor) { const q = e.data.flyCor; try { postMessage({ done: flyCorrect(buildSystem(list), q.t0, q.r, q.v, q.c) });') && fl.includes("w.postMessage({ list: mapList(), flyCor: job });"), 'correction: in a worker');
  assert.ok(fl.includes('FREE.corAuto = { at: performance.now() + 1500, after: performance.now(), from: FREE.st.t, mid: false };') && fl.includes('!FREE.predDirty && FREE.tcaAt > a.after && !FREE.tcaDirty) { if (q && q.soi) { a.at = 0; flyCorAsk(); } }') && fl.includes('FREE.st.t >= a.from + 0.3 * (q.t - a.from)') && fl.includes("flyEdit(); FREE.nodes.push({ t: r.node.t, d: r.node.d.map(x => Math.round(x * 100) / 100) });"), 'correction: by itself after a burn and ~30 % of the way, laid in one undo step');
}
// 56) Free flight, finished (Phase 19f): "Kendin uç" on the start screen (a 400 km, 51.6° Earth orbit on the Centaur,
// remembered like the other choices, a reload in the session brings the flight or a new one), "Buradan kendin uç" on the
// wizard's result cards, the node panel folding to one line (folded on phones, scrolling inside), the warp bar in two
// rows on phones, no free flight while a recording draws, the glossary's "Serbest uçuş" and the model's paragraph.
{
  const fl = read('js/fly.js'), app = read('js/app.js'), wz = read('js/wizard.js'), css = read('css/style.css'), ids = ['em_free'];
  assert.ok(P.parseStart('fly', ids) === 'fly' && html.includes('data-go="fly"') && has('start.fly') && has('start.flyD'), 'finished: the start card');
  assert.ok(app.includes("if (go === 'fly') { $('#startCards').hidden = true; $('#startFly').hidden = false; flyPick(") && app.includes("else if (st === 'fly') { APP.mode = 'scene'; bootFly = true; }") && app.includes('else if (bootFly) flyStartAt(flyLastBody());') && fl.includes("const E = o.E ? { ...o.E } : engPreset('rl10'), sp = engSpecOf(E);") && fl.includes('const FLY_INC = { earth: 51.6 }'), 'finished: the start card flies (the body first, 2026-11-21), a reload too');
  assert.ok((wz.match(/data-wr="fly"/g) || []).length === 3 && wz.includes("else if (w === 'fly') flyEnter();") && has('wz.r.fly') && has('wz.r.flyTip'), 'finished: from the wizard\'s result cards');
  assert.ok(html.includes('id="fnTop"') && html.includes('id="fnMain"') && fl.includes("flyFold(matchMedia('(max-width: 560px)').matches);") && css.includes('.fly-node.fold .fn-main{display:none}') && css.includes('.fly-node:not(.fold) .fn-main{max-height:38vh}') && css.includes('.fn-main{display:flex;flex-direction:column;gap:0;min-height:0;overflow:auto') && css.includes('.fn-time .fly-warp{display:contents}') && ['fn.fold', 'fn.sum', 'fn.sumNone', 'fn.sumTgt'].every(has), 'finished: the panel folds, phones');
  assert.ok(app.includes("S.model === 'real' && !REC.busy; if ($('#flyGo').hidden === fg)") && fl.includes("function flyEnter() { if (REC.busy) return;"), 'finished: no free flight while recording');
  const gl = DICT.gloss.find(g => g[0] === 'Serbest uçuş');
  assert.ok(gl && ['Manevra düğümü', 'Zaman hızlandırma', 'Yamalı konik', 'Transfer penceresi', 'B-düzlemi', 'Yol düzeltmesi'].every(t => gl[1].some(e => e[0] === t)) && html.includes('data-i18n="ui.model12"') && has('ui.model12'), 'finished: the glossary and the model');
  assert.ok(fl.includes('if (FREE.burn && !FREE.nodes.some(nd => nd.t === FREE.burn.t)) flyBurnEnd(false);'), 'finished: a burn stops with its node');
}
// 57) The approach camera (2026-11-16): close to the craft the camera orbits it in the craft's local frame (e3 the local
// vertical, e2 the orbit normal): a sideways drag turns it on a level circle about the craft (its height over the local
// horizon kept, the vertical up, no roll), a drag up or down stops short of the pole, the wheel moves towards the craft;
// all eased; a pan turns instead (the craft stays the centre); leaving the frame keeps the view where it is.
{
  const m3 = read('js/mode3d.js'), app = read('js/app.js'), fl = read('js/fly.js');
  const sb = { Math, FOV3: 45, ROT3: 0.006, W: 1440, H: 900, reduceMotion: false, FLY: { on: false }, performance: { t: 0, now() { return this.t; } }, MAP: { on: false }, FREE: {}, S: { follow: 'craft' }, CRAFT: { L: 3 / 0.9 }, cam3: () => sb.c };
  require('vm').runInNewContext('const clamp = (x, a, b) => Math.min(b, Math.max(a, x));' + app.slice(app.indexOf('const unit3 = '), app.indexOf('\n', app.indexOf('const unit3 = '))) +
    app.slice(app.indexOf('function acrossUp('), app.indexOf('// 3D, the first frame after')) + m3.slice(m3.indexOf('const CB = {'), m3.indexOf('// screen position of view-frame point p')) +
    m3.slice(m3.indexOf('// ---------- the approach camera'), m3.indexOf('// top-down view')) + ';this.api = { camLocal, camBasis, camEase3, camRebase, camFrame3, rot3, zoom3 };', sb);
  const A = sb.api, dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const c = sb.c = { t: [0, 0, 0], yaw: 0.4, elev: 0.3, dist: 10, roll: 0, fov: 45, cx: null, cy: null };
  const r = [7e6, 1e5, 2e5], v = [-100, 7600, 300];
  A.camLocal(c, r, v, 3);
  const e3 = c.lb[2], n = c.lb[1];
  assert.ok(Math.abs(dot(e3, r) / Math.hypot(...r) - 1) < 1e-12 && Math.abs(dot(n, v)) < 1e-9 && Math.abs(dot(c.lb[0], e3)) < 1e-12, 'approach camera: the local frame (vertical, orbit normal)');
  const step = k => { for (let i = 0; i < k; i++) { sb.performance.t += 16; A.camEase3(c); } };
  step(2); const h0 = dot(A.camBasis(c).d, e3);
  A.rot3(150, 0); step(3);
  const mid = c.yaw; step(120);
  const B1 = A.camBasis(c);
  assert.ok(Math.abs(c.yaw - (0.4 - 150 * 0.006)) < 1e-6 && mid > c.yaw && mid < 0.4, 'approach camera: a sideways drag turns it, eased');
  assert.ok(Math.abs(dot(B1.d, e3) - h0) < 1e-9 && dot(B1.u, e3) > 0.9 && c.roll === 0, 'approach camera: a level circle about the craft, the local vertical up');
  A.rot3(0, 2000); step(120);
  assert.ok(Math.abs(c.elev - 85 * Math.PI / 180) < 1e-6 && dot(A.camBasis(c).u, e3) > 0, 'approach camera: stops short of the pole, no flip');
  A.zoom3(0, 0, 0.01); step(120);
  assert.ok(Math.abs(c.dist - 3) < 1e-6, 'approach camera: the wheel towards the craft, not inside it');
  // the frame turning with the orbit (here a quarter turn) carries the camera along; a new body blends
  const d0 = A.camBasis(c).d.slice(), loc = c.lb.map(e => dot(e, d0));
  sb.performance.t += 16; A.camLocal(c, [-1e5, 7e6, 2e5], [-7600, -100, 300], 3);
  assert.ok(c.lb.every((e, k) => Math.abs(dot(e, A.camBasis(c).d) - loc[k]) < 1e-9), 'approach camera: keeps its place relative to the orbit');
  sb.performance.t += 16; A.camLocal(c, [0, 0, 1e7], [7000, 0, 0], 9);
  assert.ok(c.lbFrom && Math.abs(dot(c.lb[2], [0, 0, 1])) < 0.99, 'approach camera: a sphere left or entered blends');
  for (let i = 0; i < 60; i++) { sb.performance.t += 16; A.camLocal(c, [0, 0, 1e7], [7000, 0, 0], 9); }
  assert.ok(!c.lbFrom && Math.abs(dot(c.lb[2], [0, 0, 1]) - 1) < 1e-12, 'approach camera: … and settles');
  // leaving the frame: the same view in the view frame's axes
  const Bx = A.camBasis(c), dx = Bx.d.slice(), rx = Bx.r.slice(); A.camFrame3(c);
  const By = A.camBasis(c);
  assert.ok(!c.lb && dot(By.d, dx) > 1 - 1e-9 && dot(By.r, rx) > 1 - 1e-9, 'approach camera: leaving the frame keeps the view');
  const q = A.camRebase(1.1, -0.4, 0.3, null, [[0, 1, 0], [0, 0, 1], [1, 0, 0]]), q2 = A.camRebase(q.yaw, q.el, q.roll, [[0, 1, 0], [0, 0, 1], [1, 0, 0]], null);
  assert.ok(Math.abs(q2.yaw - 1.1) < 1e-9 && Math.abs(q2.el + 0.4) < 1e-9 && Math.abs(q2.roll - 0.3) < 1e-9, 'approach camera: re-expressed in another frame and back');
  assert.ok(app.includes('if ((!is3d() || gest.pan) && !APPR.on) unfollow();') && app.includes('else if (gest.pan && !APPR.on) pan3(dx, dy); else rot3(dx, dy);') && app.includes('if (APPR.on) return; // close to the craft two fingers only zoom'), 'approach camera: a pan turns instead, the craft stays the centre');
  assert.ok(m3.includes('const q = craftRV3(tNow, craft, ext); camLocal(c, q.r, q.v, q.b);') && m3.includes('if (!APPR.on && c.lb) camFrame3(c);') && m3.includes('if (FREE.on && FREE.appr) flyApprCam(c);') && fl.includes('camLocal(c, r, v, b);') && app.includes('if (c && a.lb !== c.lb) { const q = camRebase('), 'approach camera: in missions and in free flight; the smooth moves re-expressed');
}
// 58) The approach button follows the view (2026-11-16): zoomed out by hand until the craft is under APPR_OUT_PX on screen
// (2D: a view ten times the approach's), the approach ends by itself (the button "Araca yaklaş" again, the windows back,
// the view where it is), so the next press comes close; not during a smooth move or before the first aim.
{
  const app = read('js/app.js'), m3 = read('js/mode3d.js'), fl = read('js/fly.js');
  const sb = { Math, APPR: { on: true, aim: null, fold: [] }, FLY: { on: false }, FREE: { on: false, aim: null }, W: 1440, H: 900, cam: { scale: 1e-3 }, left: 0, is3d: () => true, insets: () => ({ l: 0, r: 0, t: 0, b: 0 }) };
  require('vm').runInNewContext(app.slice(app.indexOf('function apprBox()'), app.indexOf('\n', app.indexOf('function apprBox()'))) + app.slice(app.indexOf('const APPR_OUT_PX'), app.indexOf('function apprLeave()')) + ';function apprLeave() { left++; APPR.on = false; } this.w = apprWatch;', sb);
  sb.w(200); assert.ok(sb.left === 0, 'approach: a large craft keeps it');
  sb.FLY.on = true; sb.w(10); assert.ok(sb.left === 0, 'approach: not during a smooth move');
  sb.FLY.on = false; sb.APPR.aim = {}; sb.w(10); assert.ok(sb.left === 0, 'approach: not before the first aim');
  sb.APPR.aim = null; sb.w(10); assert.ok(sb.left === 1 && !sb.APPR.on, 'approach: zoomed out by hand, it ends');
  sb.APPR.on = true; sb.is3d = () => false; sb.cam.scale = 900 / 4e5; sb.w(0); assert.ok(sb.left === 1, 'approach 2D: the approach view keeps it');
  sb.cam.scale = 900 / 5e6; sb.w(0); assert.ok(sb.left === 2, 'approach 2D: ten times wider ends it');
  assert.ok(m3.includes('apprWatch(lpx); // the viewer zoomed out') && fl.includes('if (FREE.appr) apprWatch(lpx);') && fl.includes('if (FREE.appr) { flyFollow2(); apprWatch(0); }') && app.includes('if (!MAP.on && APPR.on) apprWatch(0);'), 'approach: watched in 3D, 2D and free flight');
  assert.ok(app.includes('if (FREE.on) { flyAppr(false); return; }') && /function apprLeave\(\)[\s\S]{0,400}if \(is3d\(\)\) camFrame3\(cam3\(\)\);\s+apprSync\(\);/.test(app), 'approach: leaving keeps the view, the button follows');
}
// 59) Free flight's one panel and the engine changed in flight (2026-11-16): the time controls, the engine and throttle,
// the direction, the target and the nodes in groups of one panel (no separate bar; the engine panel moves in), "Serbest
// uçuştan çık"; the "Motor" picker (presets, saved, "Motor tasarla…") and the engine window's button ("Serbest uçuştaki
// araca uygula") change the flying craft's engine: same place and velocity, the new engine's propellant full, a notice,
// no mission started.
{
  const fl = read('js/fly.js'), eu = read('js/engine-ui.js'), css = read('css/style.css');
  const panel = html.slice(html.indexOf('id="flyNode"'), html.indexOf('id="readout"'));
  assert.ok(!html.includes('id="flyBar"') && ['flyPause', 'flyWarp', 'flyNow', 'flyDate', 'flyBody', 'flyExit', 'fnEng', 'fnEngSlot', 'fnThrDn', 'fnThrUp', 'fnThrFull', 'fnThrCut', 'fnThrBar', 'fnLock', 'fnAuto', 'fnTgt', 'fnWin', 'fnBody', 'fnUndo', 'fnDel'].every(id => panel.includes('id="' + id + '"')), 'one panel: every control of the flight in it');
  assert.ok(['fn.gEng', 'fn.gTgt', 'fn.gNode'].every(k => panel.includes('data-i18n="' + k + '"')) && panel.indexOf('fn.gEng') < panel.indexOf('fn.gTgt') && panel.indexOf('fn.gTgt') < panel.indexOf('fn.gNode'), 'one panel: grouped (engine, target, nodes)');
  assert.ok(DICT['fly.exit'] === 'Serbest uçuştan çık' && DICT['eng.applyFly'] === 'Serbest uçuştaki araca uygula' && ['fly.engSet', 'fly.engBad', 'fn.engDesign', 'fn.thrFull', 'fn.thrCut', 'fn.dirL'].every(has), 'one panel: what "çık" does, the words');
  assert.ok(fl.includes("slot.appendChild(p); } epFold(false, false);") && fl.includes("flyEl('flyNode').before(p);") && eu.includes('if (!FREE.on) epFold(!EP.fold, true);') && css.includes('.fly-node .eng-panel{'), 'one panel: the engine panel moves in and back');
  const set = fl.slice(fl.indexOf('function flySetEngine('), fl.indexOf('// the engine panel moves into'));
  assert.ok(set.includes('FREE.st.m = s.m0;') && !/FREE\.st\.(r|v|t)\s*=/.test(set) && set.includes("flyNote(_('fly.engSet'") && !/engApply|rebuild|loadScenario/.test(set), 'engine in flight: full, same place and velocity, a notice, no mission');
  assert.ok(eu.includes('if (FREE.on) flySetEngine({ ...ENGW.E }); else engApply({ ...ENGW.E });') && eu.includes("FREE.on ? 'eng.applyFly' : 'eng.apply'") && eu.includes('engOpenFrom(FREE.on && FREE.eng ? FREE.eng.E :'), 'engine window: in free flight it applies to the flying craft');
  assert.ok(fl.includes("if (v === 'w') { flyEngList();") && fl.includes("'<option value=\"w\">' + esc(_('fn.engDesign'))"), 'engine picker: "Motor tasarla…" opens the window');
}
// 60) The craft turns (2026-11-16): free flight's nose turns at a finite rate (core.js slewStep, in game time; at a high
// warp at once) towards the locked direction or an auto burn's (ahead of its start); the main engine fires only within
// FLY_ALIGN ("Yönleniyor… 37°" until then; an auto burn waits too, holding its warp cap); the nose of the 3D model is the
// attitude; RCS quads at the nose and the tail puff for the turn's acceleration (the nozzles whose torque lies along it).
{
  const fl = read('js/fly.js'), v3 = read('js/view3d.js'), m3 = read('js/mode3d.js');
  assert.ok(fl.includes('const FLY_ALIGN = 5 * Math.PI / 180') && fl.includes('if (FREE.att && !FREE.att.ok) return null;') && fl.includes('flyAttStep(dt * FREE.warp, b, FREE.burn ? null : nb);') && fl.includes("A.acc = slewStep(A, d, dtg, key, FREE.st.t, flySlew());") && fl.includes('FREE.warp <= FLY_RCS_WARP'), 'turn: slewed in game time, the engine waits for the nose');
  assert.ok(fl.includes('nb.start - FREE.st.t <= slewTime(flyAng(A.n, nb.dir), flySlew()) + FLY_LEAD') && fl.includes('- slewTime(Math.PI, flySlew())); FREE.paused = false;'), 'turn: ahead of an auto burn, and "Düğüme hızlandır" leaves room for it');
  assert.ok(fl.includes("flyTxt('fnAtt', A && A.want && !A.ok ? _('fn.att'") && has('fn.att') && html.includes('id="fnAtt"'), 'turn: "Yönleniyor…" in the panel');
  assert.ok(fl.includes('function flyNose() { return FREE.att ? FREE.att.n : null; }') && fl.includes('FREE.pl, c.dist, flyRcs(1 / 60));') && m3.includes('rcs: rcs ? { a: craftLocal(rcs.a, ax, side)'), 'turn: the model\'s nose is the attitude, the puffs passed on');
  assert.ok(v3.includes('rcs.push({ m: pm, tau: new THREE.Vector3().crossVectors(p, e.clone().negate()).normalize() });') && v3.includes('const pm = plumeMesh();') && (v3.match(/for \(const \[cx, cz\] of \[\[1, 0\], \[0, 1\], \[-1, 0\], \[0, -1\]\]\)/g) || []).length === 1, 'turn: four RCS quads at the nose and four at the tail, puffs by torque');
  // the model axes: x the side made square to the nose, y the nose, z = x × y (as view3d.js builds them)
  const cl = {}; require('vm').runInNewContext(read('js/app.js').slice(read('js/app.js').indexOf('const unit3 = '), read('js/app.js').indexOf('\n', read('js/app.js').indexOf('const unit3 = '))) + m3.slice(m3.indexOf('function craftLocal('), m3.indexOf('// the trail after capture')) + ';this.f = craftLocal;', cl);
  const q = cl.f([0, 0, 1], [1, 0, 0], [0.4, 1, 0]), qn = cl.f([1, 0, 0], [1, 0, 0], [0.4, 1, 0]);
  assert.ok(Math.abs(q[0]) < 1e-12 && Math.abs(q[1]) < 1e-12 && Math.abs(q[2] + 1) < 1e-12 && Math.abs(qn[1] - 1) < 1e-12, 'turn: a direction in the model\'s axes');
}
// 61) The craft models, redone (2026-11-16): a liquid stage with forward and intertank skirts over the domes, an aft ring
// and an 8-strut truss to the gimbal, gimbal actuators, the oxidizer duct out of the upper tank's aft dome down the fuel
// tank on standoffs into its pump (or the valve block), the fuel duct through the truss, flanges and valves on the
// ducts, turbopumps (cryogenic) or helium bottles; the hybrid's interstage, main valve and bolted flanges; a STAR-like
// solid (near-spherical case, attach rings, payload fitting, long nozzle) whose cut grain follows the domes (the bore
// and a rod's outside clipped in the shader); a monopropellant craft (spherical tank on a girth ring and legs, deck,
// pressurant bottle, regulator and gas line, filter, latch valve, manifold, four canted thrusters with catalyst beds,
// plumes along their axes); a rebuilt model leaves whichever scene held the old one (free flight's map too).
{
  const v3 = read('js/view3d.js'), b = v3.slice(v3.indexOf('function craftBuild('), v3.indexOf('// o: { show, p (metres)'));
  assert.ok(b.includes('// intertank') && b.includes('// forward skirt, payload interface ring') && /for \(let i = 0; i < 8; i\+\+\) \{ const a0 = /.test(b) && b.includes('// gimbal actuators (pitch, yaw)'), 'models: liquid stage structure (skirts, truss, actuators)');
  assert.ok(b.includes('const oc = pipe(oxP, rD, duct); valve(oc, 0.82, rD);') && b.includes('// standoffs') && b.includes("'centripetal'") && b.includes('new THREE.TorusGeometry(r * 1.35, r * 0.45, 6, 16), M.valve'), 'models: the ducts routed, with flanges, valves and standoffs');
  assert.ok(b.includes('// interstage') && b.includes("// the case's bolted flanges") && b.includes('// bolt heads') && b.includes('// the aft closure'), 'models: the hybrid');
  assert.ok(b.includes("grainFill('grain', M.fuel, rc - 0.008, cB + 0.008, cT - 0.008, kc)") && b.includes('// payload attach fitting') && b.includes('// the igniter boss') && v3.includes('if (abs(vZ) < uPort || abs(vZ) > uRod) discard;') && v3.includes('U.uPort.value = ri > 0.001 ? ri * f.r : -1;'), 'models: the solid, its grain following the domes');
  assert.ok(['// girth ring', '// the deck', '// the pressurant bottle', '// regulator', '// filter', '// latch valve', '// manifold ring', '// catalyst bed', '// heater bands', '// thermal standoff'].every(k => b.includes(k)) && b.includes('const cant = 10 * Math.PI / 180') && v3.includes('p.quaternion.setFromUnitVectors(_nY, q.d);'), 'models: the monopropellant craft, canted thrusters and their plumes');
  assert.ok(b.includes('if (craftG.group.parent) craftG.group.parent.remove(craftG.group);') && !b.includes('roots.sim.remove(craftG.group)'), 'models: a rebuilt model replaces the old one in any scene');
  assert.ok(["skirt(", "deck("].every(k => v3.slice(v3.indexOf('const PAINT = {'), v3.indexOf('const TEXC = new Map();')).includes(k)), 'models: skirt and deck textures');
}
// 62) A node slid along the orbit (2026-11-16): its mark pressed and moved past the tap distance follows the path under
// the pointer (the prediction without it and the later nodes, near its own time first: an orbit seen edge on passes
// under the pointer twice), between its neighbours; the Δv components stay; the path is redone (dashed) while it moves;
// one undo step; a press that does not move still selects; the app's own pointer bookkeeping still ends the gesture.
{
  const fl = read('js/fly.js');
  assert.ok(fl.includes('FREE.mdown = m ? { i: m.i, x0: x, y0: y, id: e.pointerId') && fl.includes("if (Math.hypot(x - M.x0, y - M.y0) < (M.touch ? 10 : 5)) return;") && fl.includes('if (D.move) { const [x, y] = flyDragAt(e); flyMoveTo(x, y); return; }'), 'node slide: a press on the mark, moved past the tap distance');
  const mv = fl.slice(fl.indexOf('function flyMoveStart('), fl.indexOf('const flyDv ='));
  assert.ok(mv.includes('flyEdit();') && mv.includes('nodes: before') && mv.includes('before = FREE.nodes.slice(0, i)') && mv.includes('nd.t = tt; flyChanged();') && !/nd\.d\s*=/.test(mv) && mv.includes('nd.t - P / 4, nd.t + P / 4'), 'node slide: the path before it, its time only (Δv kept), near its own time, one undo step');
  assert.ok(fl.includes('if (mv) { FREE.moveEnd = performance.now(); flyChanged(); return; }') && fl.includes('if (performance.now() - (FREE.moveEnd || 0) < 120) return true;') && /function flyPathAt\(px, py, r, pred = FREE\.pred, lo = -Infinity, hi = Infinity\)/.test(fl), 'node slide: the release keeps the app\'s bookkeeping, its tap swallowed');
  assert.ok(DICT['fn.tip'].includes('yörünge boyunca sürükleyerek zamanını değiştir'), 'node slide: said in the panel');
}
// 63) The target's steps (2026-11-16): with a target, the Hedef group lists 1 Transfer penceresi ("aranıyor…" while the
// worker runs) → 2 Düğümleri koy → 3 Düğüme hızlandır → 4 Otomatik ateşle → 5 Düzeltme öner; done ones ticked, the
// first not done current, its button marked (none to press for step 4 while auto fire is on); a new target or window
// starts over; "Nasıl uçulur?" says the same.
{
  const fl = read('js/fly.js'), css = read('css/style.css');
  assert.ok(html.includes('<ol class="fn-flow" id="fnFlow"') && (html.match(/<li data-k="\d"><\/li>/g) || []).length === 5 && [1, 2, 3, 4, 5].every(i => has('fn.flow' + i)) && has('fn.flow1Busy') && has('fn.flowAria'), 'target steps: five, worded');
  assert.ok(DICT['fn.flow1'] === 'Transfer penceresi' && DICT['fn.flow1Busy'] === 'Transfer penceresi aranıyor…' && DICT['fn.flow2'] === 'Düğümleri koy' && DICT['fn.flow3'] === 'Düğüme hızlandır' && DICT['fn.flow4'] === 'Otomatik ateşle' && DICT['fn.flow5'] === 'Düzeltme öner', 'target steps: the words asked for');
  assert.ok(fl.includes("const FLY_FLOW_BTN = ['fnWin', 'fnWinGo', 'fnWarp', 'fnAuto', 'fnCor'];") && fl.includes("li.className = done[i] ? 'done' : i === cur ? 'cur' : '';") && fl.includes('FREE.flow = { placed: true };') && fl.includes('if (FREE.flow && FREE.flow.placed && FREE.flow.warped) FREE.flow.fired = true;') && fl.includes('(FREE.flow || (FREE.flow = {})).corrected = true;') && fl.includes('FREE.flow = {}; flyWinShow();'), 'target steps: each done by its action, a new target starts over');
  assert.ok(css.includes('.fn-flow li.done::before{content:"✓"') && css.includes('.fn-flow li.cur::before{') && css.includes('.fn-next:not(.primary){color:var(--accent)!important}') && css.includes('@media (prefers-reduced-motion:no-preference){.fn-next{animation:'), 'target steps: ticked, current, the next button marked (still with reduced motion)');
  assert.ok(fl.includes("'fly.tip.auto', 'fly.tip.flow']") && DICT['fly.tip.flow'].includes('1 Transfer penceresi → 2 Düğümleri koy → 3 Düğüme hızlandır → 4 Otomatik ateşle → 5 Düzeltme öner') && fl.includes('flyTipDid(5); });'), 'target steps: in "Nasıl uçulur?"');
}
// 64) The solid motor's shape (2026-11-16): from the engine and its propellant (js/engine-ui.js solShape): the STAR 48B
// keeps its published proportions (NG catalog: diameter 49.0 in, length 80.0 in, throat 3.98 in, exit 29.5 in), short
// and round; any other solid is a domed cylinder whose case L/D grows with its propellant within 1.5 … 3; the 3D model
// and the engine window's cutaway both use it.
{
  const ui = read('js/engine-ui.js'), v3 = read('js/view3d.js'), m3 = read('js/mode3d.js'), vm2 = require('vm'), c = {};
  vm2.createContext(c); vm2.runInContext(read('js/engines.js') + ui.slice(ui.indexOf('const SOL_NOZ_REAL'), ui.indexOf("// the solid's grain in the cutaway")) + ';this.f = solShape; this.E = ENGINES;', c);
  const d = c.E.find(e => e.id === 'star48').dim, in2m = 0.0254;
  assert.ok(Math.abs(d.D - 49.0 * in2m) < 1e-12 && Math.abs(d.L - 80.0 * in2m) < 1e-12 && Math.abs(d.Dt - 3.98 * in2m) < 1e-12 && Math.abs(d.De - 29.5 * in2m) < 1e-12 && read('js/engines.js').includes('"Motor diameter, in. 49.0", "Motor length,'), 'solid shape: the STAR 48B\'s dimensions as published');
  const st = c.f({ id: 'p:star48' });
  assert.ok(Math.abs(st.caseLD + st.noz - 80 / 49) < 1e-12 && Math.abs(st.exit - 29.5 / 49) < 1e-12 && Math.abs(st.thr - 3.98 / 49) < 1e-12 && st.real, `solid shape: the STAR 48B overall ${(st.caseLD + st.noz).toFixed(2)} diameters long, its exit ${st.exit.toFixed(2)} of it`);
  const lds = [10, 100, 1000, 1e4, 1e5, 1e6].map(mp => c.f({ id: '', mp }).caseLD);
  assert.ok(lds.every(v => v >= 1.5 && v <= 3) && lds.every((v, i) => !i || v >= lds[i - 1]) && lds[5] === 3 && lds[1] === 1.5 && c.f({ id: '', mp: 1e4 }).k === 0.5, `solid shape: a domed cylinder, case L/D ${lds.map(v => v.toFixed(2)).join(' → ')} with the propellant`);
  assert.ok(m3.includes("sol: en.E.type === 'sol' ? solShape(en.E, en.s) : null,") && v3.includes('const S = sol || {') && v3.includes('Dm = 0.94 / (S.caseLD + S.noz)') && v3.includes('o.sol ? [o.sol.caseLD,') && ui.includes('const S = solShape(E, s), Dp = Math.min(76, (w - 16) / (S.caseLD + S.noz))'), 'solid shape: the 3D model (rebuilt when it changes) and the cutaway share it');
}
// 65) The pace of a turn (2026-11-17): a 180° turn takes 3 s for a small probe up to 4 s for a heavy stage (by mass), 1 s
// with "Hızlı dönüş" (off by default, remembered); in game time (it scales with the warp).
{
  const fl = read('js/fly.js'), sb = { Math, FREE: { fast: false, st: { m: 296 } } };
  require('vm').runInNewContext(fl.slice(fl.indexOf('const flySlewT = '), fl.indexOf('\n', fl.indexOf('const flySlewT = '))) + ';this.f = flySlewT;', sb);
  const p = sb.f(); sb.FREE.st.m = 23000; const s = sb.f(); sb.FREE.st.m = 3e5; const h = sb.f(); sb.FREE.fast = true; const q = sb.f();
  assert.ok(Math.abs(p - 3) < 0.01 && s > 3.8 && s < 4 && h === 4 && q === 1, `turn pace: probe ${p.toFixed(2)} s, stage ${s.toFixed(2)} s, fast ${q} s`);
  assert.ok(html.includes('id="fnFast"') && has('fn.fast') && has('fn.fastTip') && P.PREF_KEYS.flyFast && fl.includes("FREE.fast = readPref(FLY_LS, PREF_KEYS.flyFast) === '1';") && fl.includes('flyAttStep(dt * FREE.warp, b,'), 'turn pace: the switch, remembered; in game time');
}
// the encoder itself (an ES module): a real GIF
(async () => {
  const G = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'js', 'rec-worker.mjs')).href);
  const w = 64, h = 40, frame = k => {
    const a = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { a[4 * i] = 3; a[4 * i + 1] = 5; a[4 * i + 2] = 7; a[4 * i + 3] = 255; }
    for (let y = 10; y < 20; y++) for (let x = 2 + 2 * k; x < 8 + 2 * k; x++) { const i = 4 * (y * w + x); a[i] = 255; a[i + 1] = 181; a[i + 2] = 71; }
    for (let y = h - 4; y < h - 1; y++) for (let x = w - 20; x < w - 2; x++) { const i = 4 * (y * w + x); a[i] = a[i + 1] = a[i + 2] = 200; }
    return a;
  };
  const delays = [70, 60, 70, 60, 70, 1570], N = delays.length, p = G.gifPalette([frame(0), frame(N - 1)]), g = G.gifStart(w, h, p);
  for (let k = 0; k < N; k++) G.gifFrame(g, frame(k), delays[k]);
  const b = G.gifEnd(g);
  // walk the GIF's blocks: header, screen, global table, extensions, images (LZW data skipped by sub-blocks)
  assert.strictEqual(String.fromCharCode(...b.slice(0, 6)), 'GIF89a', 'gif: header');
  assert.ok((b[6] | b[7] << 8) === w && (b[8] | b[9] << 8) === h && (b[10] & 0x80), 'gif: logical screen and a global palette');
  let i = 13 + 3 * (1 << ((b[10] & 7) + 1)), images = 0, loop = false;
  const gce = [], skipSub = () => { while (b[i]) i += b[i] + 1; i++; };
  while (i < b.length && b[i] !== 0x3b) {
    if (b[i] === 0x21) {
      const label = b[i + 1]; i += 2;
      if (label === 0xf9) gce.push({ dispose: (b[i + 1] >> 2) & 7, transp: b[i + 1] & 1, delay: (b[i + 2] | b[i + 3] << 8) * 10, index: b[i + 4] });
      if (label === 0xff && String.fromCharCode(...b.slice(i + 1, i + 12)) === 'NETSCAPE2.0') loop = true;
      skipSub();
    } else if (b[i] === 0x2c) { images++; const lct = b[i + 9] & 0x80; i += 10 + (lct ? 3 * (1 << ((b[i + 9] & 7) + 1)) : 0); i++; skipSub(); }
    else throw new Error('gif: unknown block ' + b[i] + ' at ' + i);
  }
  assert.ok(b[i] === 0x3b && images === N && gce.length === N && loop, `gif: ${images} images, looping, ends with the trailer`);
  assert.ok(gce[N - 1].delay === 1570 && gce.slice(1).every(e => e.transp && e.dispose === 1 && e.index === p.clear) && !gce[0].transp, 'gif: the last frame held; later frames draw only what changed');
  const pr = G.gifProbe(w, h, [[frame(0), frame(1)], [frame(3), frame(4)]]);
  assert.ok(pr.key > 0 && pr.diff > 0 && pr.diff < pr.key, 'gif: the probe (a following frame costs less than the first)');
  const coarse = G.gifPalette([frame(0)], { fmt: 'rgb444', colors: 64 });
  assert.ok(coarse.pal.length <= 65 && coarse.fmt === 'rgb444', 'gif: fewer, coarser colours on request');
  // fixed colours: kept exactly and first; the dark background's many shades do not eat the rest; exact pixels map to
  // themselves; a frame of soft shades on the void spends the free entries elsewhere
  const Rc2 = require('../js/record.js'), fixed = Rc2.recFixed({ void: '#030507', traj: '#ffb547', ink: '#d9e7eb', orbit: '#7cc4d8' }, []);
  const shaded = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = 3 + (i % 9); shaded[4 * i] = v; shaded[4 * i + 1] = v + 2; shaded[4 * i + 2] = v + 4; shaded[4 * i + 3] = 255; }
  for (let i = 0; i < 40; i++) { const j = 4 * (w * 5 + i); shaded[j] = 40 + 5 * i; shaded[j + 1] = 200 - 3 * i; shaded[j + 2] = 90; } // a gradient of other colours
  const pf = G.gifPalette([shaded, frame(2)], { fixed });
  assert.ok(pf.fixedN === fixed.length && fixed.every((c, j) => pf.pal[j].join() === c.join()), 'gif: the fixed colours first, exactly');
  const darkFree = pf.pal.slice(pf.fixedN, pf.clear).filter(c => c[0] < 16 && c[1] < 18 && c[2] < 20).length;
  assert.ok(darkFree <= 2, `gif: the void's shades take ${darkFree} free entries`);
  const ex = new Uint8ClampedArray(fixed.length * 4); fixed.forEach((c, j) => ex.set([c[0], c[1], c[2], 255], 4 * j));
  const ix = G.gifIndex(pf, ex, fixed.length);
  assert.ok(fixed.every((c, j) => ix[j] === j), 'gif: a token pixel is its own palette entry');
  // dithering: ordered (the same pattern every frame), off on request; a flat void stays one colour without it
  const pd = G.gifPalette([shaded], { fixed, dither: true }), a1 = G.gifIndex(pd, shaded, w), a2 = G.gifIndex(pd, shaded, w);
  assert.ok(pd.dither && a1.every((v, i) => v === a2[i]), 'gif: ordered dithering, steady from frame to frame');
  const flat = frame(0).map((v, i) => (i % 4 === 3 ? 255 : [3, 5, 7][i % 4])), pn = G.gifPalette([flat], { fixed });
  assert.ok(new Set(G.gifIndex(pn, flat, w)).size === 1 && !pn.dither, 'gif: no dithering by default, the plain void one entry');
// 66) The close view's road (2026-11-21, Phase 20A-4): up close the craft's own lines fade out entirely and one line takes
  // their place, the osculating conic through the craft's own state (exactly through the model's centre), thin, faint and
  // additive, its vertex colours out near the camera and at its ends; the near fade does not touch it; mission and free flight
  {
    const m3 = read('js/mode3d.js'), fl = read('js/fly.js'), v3 = read('js/view3d.js');
    assert.ok(m3.includes('function road3(set, g, u0, anchor, k)') && m3.includes("V3.dyn(set, 'road', cap, { color: '#ffffff', vertexColors: true, additive: true, width: 1.2 });") && m3.includes('ss((dc / Dc - 0.45) / 0.5)'), 'road: additive, faded near the camera');
    assert.ok(m3.includes("V3.fadeSet('sim', nk, OWN3, nk);") && m3.includes("road3('sim', g, g ? conicU(g, q.r) : 0,") && fl.includes("V3.fadeSet('map', nk, FLY_OWN, nk);") && fl.includes("road3('map', g, g ? conicU(g, r) : 0, an, 1 - nk);"), 'road: the own lines give way to it in missions and in free flight');
    assert.ok(v3.includes("f = id === 'road' ? 1 : own ? F.kOwn : F.k;"), 'road: not faded by the near fade');
  }
  // 67) The label at the top left (2026-11-21, Phase 20A-6): what is on screen and its phase, by the rail; the top middle
  // keeps only the scene's switch and the way back (hidden without them); the windows' default spots at the top left start
  // below the label; an obstacle for the free area; on a phone under the view controls
  {
    const app = read('js/app.js'), css = read('css/style.css');
    assert.ok(html.includes('id="missionTag"') && html.includes('id="mtTitle"') && html.includes('id="mtPhase"') && ['tag.scene', 'tag.sceneFree', 'tag.map', 'tag.transfer', 'tag.man', 'tag.fly', 'tag.flyOpen', 'tag.burnDep', 'tag.burnCap', 'tag.burnN', 'tag.coast', 'tag.coastTo', 'tag.flyBurn', 'tag.flyNode'].every(has), 'tag: markup and texts');
    assert.ok(app.includes('modeChip(); missionTag(now);') && app.includes("$('#modeChip').classList.toggle('none', !back && !sc);") && css.includes('.mode-chip.none{display:none}') || css.includes('.mode-chip.none'), 'tag: the top middle only for what comes and goes');
    assert.ok(app.includes("case 'mission': return [m, top];") && app.includes("$('#modeChip'), $('#missionTag'), $('#liveBar')]") && app.includes('function tagPlace()'), 'tag: windows below it, an obstacle, placed on a phone');
    const sb = { _: k => k }; require('vm').runInNewContext(app.slice(app.indexOf('function tagDur('), app.indexOf('function missionTag(')) + ';this.d = tagDur;', sb);
    assert.ok(sb.d(2 * 86400 + 4 * 3600 + 120).startsWith('2 unit.d') && sb.d(4812).startsWith('1 unit.h') && sb.d(12) === '12 unit.s', 'tag: the time to come in its two largest units');
  }
  // 68) "Kendin uç" anywhere (2026-11-21, Phase 20A-7): the start card and the wizard's first step pick a body in one step
  // (js/fly.js flyPick: the Earth, the Moon, Mars as cards, the rest in a list, optional altitude and inclination) and fly
  // at once from a low circular orbit (flyStartAt: the altitude by body, the equator from the IAU pole, only bodies whose
  // orbit lies well inside their sphere); the engine window flies its engine ("Kendin uç" and a body list, hidden in
  // free flight where its apply button serves the flying craft); the last body is remembered
  {
    const fl = read('js/fly.js'), wz = read('js/wizard.js'), eu = read('js/engine-ui.js'), app = read('js/app.js'), css = read('css/style.css');
    assert.ok(html.includes('id="startFly"') && html.includes('id="startFlyPick"') && html.includes('data-path="fly"') && html.includes('id="wzFlyPick"') && html.includes('id="engFly"') && html.includes('id="engFlyBody"') && ['fly.pickD', 'fly.at', 'fly.other', 'fly.opt', 'fly.alt', 'fly.inc', 'fly.badAlt', 'wz.fly', 'wz.flyD', 'eng.fly', 'eng.flyTip', 'eng.flyBody'].every(has), 'kendin uç: markup and texts');
    assert.ok(fl.includes('function flyStartAt(key, o = {})') && fl.includes("const FLY_FIRST = ['earth', 'moon', 'mars']") || fl.includes("FLY_FIRST = ['earth', 'moon', 'mars']"), 'kendin uç: the start');
    assert.ok(fl.includes('mapSys.soi[i] / 3') && fl.includes('const F = bodyAxes(key, t, P, V, i, MPAR[i], new Array(9));') && fl.includes('writePref(FLY_LS, PREF_KEYS.flyBody, key);') && P.PREF_KEYS.flyBody, 'kendin uç: bodies whose orbit fits, the equator from the pole, the body remembered');
    assert.ok(wz.includes("if (c.dataset.path === 'fly') wzFly(true); else wzPick(c.dataset.path);") && eu.includes("flyStartAt(engEl('engFlyBody').value || 'earth', { E: { ...ENGW.E } })") && css.includes('html[data-fly] .eng-fly{display:none}'), 'kendin uç: the wizard and the engine window');
  }
  // 69) Release notes, "Yenilikler" (2026-11-21, Phase 20A-8): one file (js/changelog.js: version, date, tr / en items, a
  // picture made from the site); versions compared as numbers; the notice once per new version after the welcome, to a
  // returning visitor only (a first visit: the dot); the window (latest large with "Yeni", its picture; older ones a plain
  // list); the version at the rail's foot (on a phone in "Diğer"), in the Model window and on the start screen; a start
  // choice made during free flight leaves the flight first
  {
    const N = require('../js/changelog.js'), app = read('js/app.js'), fs = require('fs'), path = require('path');
    assert.ok(N.verCmp('0.10', '0.9') > 0 && N.verCmp('1.0', '1') === 0 && N.verCmp('0.9', '0.9.1') < 0 && N.NOTES_LAST === N.CHANGELOG[0].v, 'notes: versions compared as numbers');
    const L = [{ v: '1.1' }, { v: '1.0' }, { v: '0.9' }];
    assert.deepStrictEqual(N.notesUnseen(L, '0.9').map(x => x.v), ['1.1', '1.0'], 'notes: only the unseen versions');
    assert.ok(N.notesUnseen(L, null).length === 3 && N.notesUnseen(L, '1.1').length === 0, 'notes: none seen, all unseen');
    assert.ok(N.notesToast(L, null, true) && !N.notesToast(L, null, false) && N.notesToast(L, '1.0', false) && !N.notesToast(L, '1.1', true), 'notes: the notice once per version, to returning visitors');
    for (const x of N.CHANGELOG) {
      assert.ok(/^\d+\.\d+(\.\d+)?$/.test(x.v) && !isNaN(Date.parse(x.date)) && x.tr.length >= 3 && x.tr.length <= 6 && x.en.length === x.tr.length, `notes: v${x.v} has a date and 3–6 items in both languages`);
      const f = x.img && path.join(__dirname, '..', x.img);
      if (x.img) assert.ok(fs.existsSync(f) && x.alt && x.alt.tr && x.alt.en && x.size && fs.statSync(f).size < 300e3, `notes: the picture of v${x.v} exists, small, with alt text`);
    }
    assert.ok(html.indexOf('js/prefs.js') < html.indexOf('js/changelog.js') && html.indexOf('js/changelog.js') < html.indexOf('js/app.js') && ['notesBtn', 'notes', 'notesB', 'notesToast', 'startNotes', 'modelNotes', 'modelVer'].every(id => html.includes('id="' + id + '"')) && ['notes.title', 'notes.link', 'notes.new', 'notes.old', 'notes.ver', 'notes.toast', 'notes.show', 'rail.notes'].every(has), 'notes: markup, texts, the file before app.js');
    assert.ok(app.includes("$('#notesToast').hidden = false;") && app.includes("function startClose() { $('#start').hidden = true; notesLater(600); }") && app.includes("$('#notesBtn'), $('#resetWins')]") && P.PREF_KEYS.notesRead && P.PREF_KEYS.notesShown, 'notes: after the welcome, saved, in Diğer on a phone');
    assert.ok(app.includes("function startScene() { if (FREE.on) flyExit();") && app.includes("function startMission(id) { if (FREE.on) flyExit();"), 'start: a choice during free flight leaves the flight');
  }
  console.log('OK — all UI tests passed');
})().catch(e => { console.error(e); process.exit(1); });
