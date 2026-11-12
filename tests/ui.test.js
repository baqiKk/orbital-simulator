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
for (const f of ['js/app.js', 'js/core.js', 'js/mode3d.js', 'js/globe.js', 'js/wizard.js', 'js/record.js']) {
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
  assert.ok(/fly2\(S\.follow !== 'free'\)/.test(app) && /fly2\(MAP\.follow != null\)/.test(app) && /fly3\(c, S\.follow !== 'free'\)/.test(m3) && /fly3\(c, MAP\.follow != null\)/.test(m3), 'all four views apply the move');
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
  assert.strictEqual([...app.matchAll(/res\.innerHTML = resRows\(rows\) \+ schedHtml\(\);/g)].length, 4, 'schedule in transfer, maneuver, single-firing and free-burn results');
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
  assert.ok(app.includes("function tlRoom() { const tl = $('#timeline').getBoundingClientRect(); $('#wins').style.setProperty('--tl-h', (tl.height ?") && app.includes("new ResizeObserver(() => clampWins()).observe($('#ctrls'))"), 'windows: no timeline room while it is hidden; they follow the controls');
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
  for (const g of ['scene', 'mission', 'design', 'cabin']) assert.ok(page.includes('data-go="' + g + '"'), 'card ' + g);
  for (const sc of ['em_free', 'r_e_mars']) assert.ok(page.includes('data-sc="' + sc + '"') && app.includes("{ id: '" + sc + "'"), 'mission ' + sc);
  assert.ok(['start.title', 'start.scene', 'start.mission', 'start.design', 'start.cabin', 'start.foot', 'start.reopen'].every(has), 'start texts');
  assert.ok(app.includes("if (go === 'cabin') { writePref(LS, PREF_KEYS.start, 'scene'); return; }") && app.includes("$('#startBtn').addEventListener('click', () => startOpen(parseStart(readPref(LS, PREF_KEYS.start), SCENARIOS.map(s => s.id))));") && app.includes("if (e.key === 'Escape' && !$('#start').hidden) { e.stopPropagation(); startClose(); startScene(); }"), 'remembered, not the cabin; Esc: the scene; the logo opens it');
  assert.ok(/@media \(max-width:560px\)\{\n  \.start\{[^}]*\}\n  \.start-in\{[^}]*\}\n  \.start-cards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(css), 'phones: 2 × 2');
  assert.ok(!page.includes('id="welcome"'), 'the old welcome card is gone');
  // Phase 16b: on every new visit (session), over the tour; not back from the cabin, from a link or on a reload in the
  // same session; the remembered choice only marks its card. Compact: at the bottom, the tour above it in view; phones
  // 2 × 2 in the lower half.
  assert.ok(P.startShow({ seen: false, snap: false, deep: false }), 'a new visit: the start screen');
  for (const o of [{ seen: true }, { snap: true }, { deep: true }]) assert.ok(!P.startShow({ seen: false, snap: false, deep: false, ...o }), 'not when ' + Object.keys(o)[0]);
  assert.strictEqual(P.sceneParam('?manzara=earth'), 'earth'); assert.strictEqual(P.sceneParam('?x=1&manzara=tour'), 'tour');
  assert.strictEqual(P.sceneParam('?manzara=pluto'), null); assert.strictEqual(P.sceneParam(''), null);
  assert.ok(app.includes("const seen = !!readPref(SS, PREF_KEYS.startSeen); writePref(SS, PREF_KEYS.startSeen, '1');") && app.includes("if (startShow({ seen, snap: !!SNAP, deep })) { APP.mode = 'scene'; startOpen(st); }"), 'shown per session, the remembered choice marked');
  assert.ok(P.PREF_KEYS.startSeen && has('start.last') && (page.match(/data-i18n-data-last="start\.last"/g) || []).length === 5, 'the "last choice" tag');
  assert.ok(/\.start\{[^}]*place-items:end center/.test(css) && /\.start-in\{[^}]*max-height:50vh/.test(css), 'compact: at the bottom; phones in the lower half');
}
// 28) The rail's names (hover on desktop, under the icons on phones), the less used ones in "Diğer" on phones so no name
// is shortened, and a short tour offered once when the viewer first chooses to design
{
  const app = read('js/app.js'), page = read('index.html'), css = read('css/style.css');
  for (const w of ['mission', 'bodies', 'results', 'overview', 'transfer', 'gloss', 'model', 'credits'])
    assert.ok(page.includes('data-win="' + w + '" data-i18n-aria-label="win.' + w + '" data-i18n-data-label="rail.' + w + '"') && has('rail.' + w), 'rail name ' + w);
  assert.ok(page.includes('data-i18n-data-label="rail.cabin"') && page.includes('data-i18n-data-label="rail.reset"') && page.includes('id="railMore"') && page.includes('id="railMoreList"'), 'cabin, reset, more');
  assert.ok(app.includes("more: ['bodies', 'transfer', 'gloss', 'model', 'credits']") && app.includes("$('#resetWins')]"), 'the less used ones go into Diğer');
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
  assert.ok(app.includes("for (const id of ['mission', 'results', 'overview']) if (WINS[id].open) { SCENE.hide.add(id);"), 'scene: the overview aside');
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
  assert.ok(/<script src="js\/app\.js"><\/script>\n<script src="js\/wizard\.js"><\/script>/.test(html), 'wizard.js after app.js');
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
      assert.ok(o.fov >= P.SAT_SHOT.fovMin && o.fov <= P.SAT_SHOT.fovMax && o.dist > 3 * R, `${tag}: field of view ${o.fov.toFixed(1)}°`);
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
// (u from 0 to 1, 10–20 s at 15 frames/s, slower around events, GIF delays in hundredths that keep the film's length,
// the last frame held); sizes (even, no wider than the canvas); the GIF ladder (frame rate, colours, width); file names
// from the mission; the watermark (bottom right) on every frame, the last included; a real GIF from the encoder (header,
// size, loop, one image per frame, the last frame's pause, unchanged pixels transparent). The libraries load only with
// a recording; the app draws a frame on demand and fits to the whole canvas while recording; the licences in Kaynakça.
{
  const Rc = require('../js/record.js');
  const sc = Rc.recSchedule([0.3, 0.7]), n = sc.u.length;
  assert.ok(n >= 10 * 15 && n <= 20 * 15 && sc.u[0] === 0 && sc.u[n - 1] === 1, `recording: ${n} frames`);
  for (let k = 1; k < n; k++) assert.ok(sc.u[k] > sc.u[k - 1], 'recording: u only grows');
  const step = u => { let k = 0; while (k < n - 1 && sc.u[k + 1] < u) k++; return sc.u[k + 1] - sc.u[k]; };
  assert.ok(step(0.3) < step(0.5) / 2.5 && step(0.7) < step(0.5) / 2.5, `recording: slower at events (${(step(0.5) / step(0.3)).toFixed(1)}×)`);
  const total = sc.delay.reduce((a, b) => a + b, 0) / 1000;
  assert.ok(sc.delay.every(d => d % 10 === 0) && Math.abs(total - (sc.T + Rc.REC_OPT.hold)) < 0.011 && sc.delay[n - 1] >= Rc.REC_OPT.hold * 1000, `recording: ${total.toFixed(2)} s with the last frame held`);
  const many = Rc.recSchedule(new Array(40).fill(0).map((_, i) => i / 40)), none = Rc.recSchedule([]);
  assert.ok(many.T === Rc.REC_OPT.max && none.T >= Rc.REC_OPT.min && none.T <= Rc.REC_OPT.max, 'recording: 10–20 s');
  const s1 = Rc.recSize(1392, 900, 720), s2 = Rc.recSize(390 * 2, 790 * 2, 1080), s3 = Rc.recSize(301, 201, 720);
  assert.ok(s1.w === 720 && s1.h % 2 === 0 && Math.abs(s1.h / s1.w - 900 / 1392) < 0.01 && !s1.capped, 'recording: 720 px wide, aspect kept, even');
  assert.ok(s2.w === 780 && s2.capped && s3.w % 2 === 0 && s3.h % 2 === 0 && s3.w <= 301, 'recording: never wider than the canvas');
  const lad = Rc.recLadder(720);
  assert.ok(lad[0].w === 720 && lad[0].fps === 15 && lad[0].colors === 255 && lad.some(c => c.fps === 10) && lad.some(c => c.colors < 255) && lad[lad.length - 1].w === 480, 'recording: the GIF ladder (frame rate, colours, width)');
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
  assert.ok(rj.includes("phone() ? { fmt: CAN_VIDEO ? 'video' : 'gif', w: 480 }") && rj.includes('navigator.canShare') && rj.includes('navigator.share('), 'recording: phones default to video at 480 px, share sheet');
  // the background: plain void by default (no Milky Way, stars or glare in the recording; the screen unchanged), the
  // starry one on request ("Yıldızlı arka plan")
  const m3 = read('js/mode3d.js');
  assert.ok(rj.includes("const W0 = { fmt: 'gif', w: 720, title: true, sky: false }") && rj.includes('REC.sky = !!R.set.sky;') && html.includes('id="recSky"') && has('rec.sky') && has('rec.skyTip'), 'recording: the starry background is an option, off by default');
  assert.ok(app.includes('const REC = { busy: false, full: false, sky: false };') && app.includes('const skyRec = () => REC.busy && !REC.sky;'), 'recording: the sky is left out only while a recording draws');
  assert.ok(app.includes('if (stars && !skyRec())') && app.includes('if (!FXON.glare || skyRec()) return;') && app.includes('V3.render({ stars: Q.stars && !skyRec(), skyGain: skyGain() });'), 'recording: 2D stars and glare left out');
  assert.strictEqual((m3.match(/V3\.render\(\{ stars: Q\.stars && !skyRec\(\)/g) || []).length, (m3.match(/V3\.render\(/g) || []).length, 'recording: every 3D render leaves the sky out');
  assert.ok(m3.includes('if (!Q.glow || lowQ || !FXON.glare || skyRec()) return null;'), 'recording: no 3D glare');
  assert.ok(Rc.recLadder(720)[0].w === 720 && Rc.recLadder(720)[0].fps === 15, 'recording: a plain background fits the first step (720 px, 15 frames/s; 785 KB measured in 3D, the turning frame)');
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
  console.log('OK — all UI tests passed');
})().catch(e => { console.error(e); process.exit(1); });
