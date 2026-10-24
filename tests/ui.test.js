// UI regression tests (no DOM): dictionary coverage and persisted preferences. Run: node tests/ui.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('../js/prefs.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ctx = {};
vm.runInNewContext(read('js/i18n.js') + '\nthis.DICT = DICT;', ctx);
const DICT = ctx.DICT;
const has = k => typeof DICT[k] === 'string';

// 1) Every key the markup asks for exists
const html = read('index.html');
for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) assert.ok(has(m[1]), `index.html key missing from dictionary: ${m[1]}`);

// 2) Every literal key in app.js / core.js exists (string literals inside a dictionary namespace, incl. ternaries)
const spaces = new Set(Object.keys(DICT).map(k => k.split('.')[0]));
for (const f of ['js/app.js', 'js/core.js', 'js/mode3d.js', 'js/globe.js']) {
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

// 4) Startup mode: saved choice wins; nothing valid saved -> normal + ask; broken storage never throws
const store = v => ({ getItem: () => v, setItem() {}, removeItem() {} });
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
assert.deepStrictEqual(P.startupMode(store('low')), { mode: 'low', ask: false });
assert.deepStrictEqual(P.startupMode(store('normal')), { mode: 'normal', ask: false });
assert.deepStrictEqual(P.startupMode(store(null)), { mode: 'normal', ask: true });
assert.deepStrictEqual(P.startupMode(store('3d')), { mode: '3d', ask: false });
assert.deepStrictEqual(P.startupMode(store('vr')), { mode: 'normal', ask: true }, 'unknown modes fall back');
assert.deepStrictEqual(P.startupMode(broken), { mode: 'normal', ask: true });
assert.deepStrictEqual(P.startupMode(null), { mode: 'normal', ask: true });
assert.strictEqual(P.writePref(broken, P.PREF_KEYS.mode, 'low'), false);
assert.doesNotThrow(() => P.clearPref(broken, P.PREF_KEYS.wins));
{ // round trip through a working store
  const m = new Map(), s = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
  assert.ok(P.writePref(s, P.PREF_KEYS.mode, 'low'));
  assert.deepStrictEqual(P.startupMode(s), { mode: 'low', ask: false });
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

console.log('OK — all UI tests passed');
