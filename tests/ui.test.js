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
// the cabin draft page too (its markup and its script's _('…') / data-tip keys)
const kab = read('kabin-taslak.html');
for (const m of kab.matchAll(/data-(?:i18n(?:-[a-z-]+)?|tip|rich)="([^"]+)"|_\('([^']+)'\)/g)) assert.ok(has(m[1] || m[2]), `kabin-taslak.html key missing from dictionary: ${m[1] || m[2]}`);
assert.ok(!/img\/planets/.test(kab), 'kabin-taslak.html asks for planet images only through globeLook()');

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
  assert.strictEqual([...app.matchAll(/res\.innerHTML = resRows\(rows\) \+ schedHtml\(\);/g)].length, 3, 'schedule in transfer, maneuver and single-firing results');
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
  assert.ok(/<script src="js\/globe\.js"><\/script>\s*<script src="js\/sounds\.js"><\/script>\s*<script src="js\/cabin-audio\.js"><\/script>\s*<script src="js\/cabin\.js">/.test(page), 'cabin scripts in order: globe, sounds, cabin-audio, cabin');
  assert.ok(!/img\/planets|img\/sky/.test(page + js), 'cabin images of bodies and sky only through globeLook / skyReady');
  for (const m of js.matchAll(/globeLook\(([^;]*?)\)/g)) assert.ok(/, !LOWQ, !LOWQ,/.test(m[1]), 'cabin globeLook: nothing drawn or fetched in low mode: ' + m[1]);
  assert.ok(/if \(LOWQ\) SP\.sky = plainSky\(\); else \{ const sk = skyReady\(/.test(js), 'cabin sky: skyReady only outside low mode');
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
    const wc = P.cabGlassCam(vw, vh, g);
    assert.ok(wc.x >= g.x0 - 1e-6 && wc.x + vw / wc.s <= g.x1 + 1e-6 && wc.y >= g.y0 - 1e-6 && wc.y + vh / wc.s <= g.y1 + 1e-6, `window view ${vw}×${vh} stays on the glass`);
  }
}

// 15) Phase 11 cabin sound: every track is CC0 with both files (Opus/WebM and MP3) and a sane duration; the space
// recordings carry their credit and source; the radio starts only on a gesture; storage through prefs.js; settings
// parsing falls back per field; the credits name the music and the recordings.
{
  const S = require('../js/sounds.js'), page = read('kabin.html'), aud = read('js/cabin-audio.js'), cab = read('js/cabin.js');
  const size = f => fs.statSync(path.join(__dirname, '..', f)).size;
  assert.strictEqual(S.MUSIC_LIC, 'cc0', 'music only CC0');
  assert.ok(S.MUSIC.length >= 5 && new Set(S.MUSIC.map(m => m.id)).size === S.MUSIC.length, 'distinct tracks');
  let bytes = 0;
  for (const m of S.MUSIC) {
    assert.ok(m.title && S.MUSIC_ALBUM[m.album] && S.SND_SRC[m.album] && m.dur > 60 && m.dur < 600, 'track data ' + m.id);
    for (const e of ['webm', 'mp3']) { const n = size(`audio/cabin/music/${m.id}.${e}`); assert.ok(n > m.dur * 4000 && n < m.dur * 20000, `audio/cabin/music/${m.id}.${e} size`); bytes += n; }
  }
  for (const s of S.SPACE_SND) {
    assert.ok(s.credit.startsWith('NASA/JPL-Caltech') && S.SND_SRC[s.src] && s.dur > 10, 'space sound data ' + s.id);
    for (const e of ['webm', 'mp3']) bytes += size(`audio/cabin/space/${s.id}.${e}`);
  }
  assert.ok(bytes < 45 * 1048576, 'cabin audio under 45 MB in all: ' + (bytes / 1048576).toFixed(1));
  assert.ok(fs.readdirSync(path.join(__dirname, '..', 'audio/cabin/music')).every(f => /^[a-z0-9-]+\.(webm|mp3)$/.test(f)), 'only encoded files in audio/cabin/music');
  // gesture, storage, keys
  assert.ok(/addEventListener\('pointerdown', audGesture, true\)/.test(cab) && !/sndStart\(/.test(cab.split('// ---------- sound')[0]), 'the radio starts on a gesture');
  assert.ok(!/localStorage\.|sessionStorage\./.test(aud), 'cabin-audio.js keeps no storage of its own');
  for (const m of (page + cab + aud).matchAll(/'(kab\.audio\.[A-Za-z0-9_.]+)'|data-i18n(?:-[a-z-]+)?="(kab\.audio\.[^"]+)"/g)) assert.ok(has(m[1] || m[2]), 'sound key missing: ' + (m[1] || m[2]));
  assert.ok(/<script src="js\/sounds\.js"><\/script>[\s\S]*<script src="js\/app\.js">/.test(html) && /cred\.cabin\.music/.test(app) && /cred\.cabin\.space/.test(app) && has('cred.cabin.musicNote') && has('cred.cabin.spaceNote'), 'credits name the radio and the recordings');
  // settings
  assert.deepStrictEqual(P.parseCabAudio(null), P.CAB_AUDIO, 'defaults: radio on, layers off');
  assert.deepStrictEqual(P.parseCabAudio('{"music":{"on":false,"vol":2},"noise":{"type":"red","vol":-1},"muted":"yes"}'),
    { muted: false, music: { on: false, vol: 1 }, space: { on: false, vol: 0.5 }, hum: { on: false, vol: 0.4 }, noise: { on: false, vol: 0, type: 'pink' } }, 'per-field fallback');
  assert.strictEqual(P.parseCabAudio('{"noise":{"type":"brown"}}').noise.type, 'brown');
  assert.ok(P.PREF_KEYS.cabAudio, 'saved under a pref key');
}

// 16) Simulator ↔ cabin: the rail and the welcome card link to the cabin (a beta badge on the rail); the view goes along
// as ?manzara=; the snapshot for the way back is read only when fresh and well formed; kabin.html stays noindex and
// out of the sitemap until Phase 10.
{
  assert.ok(/<a class="rail-btn rail-cabin" href="kabin\.html" id="railCabin"[^>]*>[\s\S]*?<span class="rail-beta" data-i18n="ui\.betaTag"><\/span><\/a>/.test(html), 'rail: cabin link with a beta badge');
  assert.ok(/<a class="btn sm" href="kabin\.html" id="wcCabin" data-i18n="wc\.cabin"><\/a>/.test(html), 'welcome card: go to the cabin');
  assert.ok(/'kabin\.html\?manzara=' \+ SCENE\.kind/.test(app) && /get\('manzara'\)/.test(read('js/cabin.js')), 'the view goes along');
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
  assert.ok(/<meta name="robots" content="noindex">/.test(read('kabin.html')) && !/kabin/.test(read('sitemap.xml')), 'kabin.html: noindex, not in the sitemap (until Phase 10)');
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
}

console.log('OK — all UI tests passed');
