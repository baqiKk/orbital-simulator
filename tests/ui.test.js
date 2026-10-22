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
for (const f of ['js/app.js', 'js/core.js']) {
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
assert.deepStrictEqual(P.startupMode(store('3d')), { mode: 'normal', ask: true }, '3D is not selectable yet');
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

// 6) Clamping pulls windows fully inside; oversize windows pin to the top-left
assert.deepStrictEqual(P.clampWin(900, 700, 300, 200, 1000, 800), [700, 600]);
assert.deepStrictEqual(P.clampWin(-50, -20, 300, 200, 1000, 800), [0, 0]);
assert.deepStrictEqual(P.clampWin(100, 100, 300, 200, 1000, 800), [100, 100]);
assert.deepStrictEqual(P.clampWin(100, 100, 1200, 900, 1000, 800), [0, 0]);

console.log('OK — all UI tests passed');
