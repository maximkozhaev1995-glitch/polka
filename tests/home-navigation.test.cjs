// UI navigation regression tests. No network, database, Telegram or credentials required.
// Run: node --test tests/home-navigation.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const load = file => fs.readFileSync(path.join(root, file), 'utf8');
const src = load('src/stoika.html');
const index = load('index.html');

test('index.html exactly matches build_app.py assembly', () => {
  const cfg = load('app/config.js');
  const shim = load('app/shim.js');
  let expected = src.replace('<title>',
    '<script src="https://telegram.org/js/telegram-web-app.js"></script>\n<title>');
  const insertAt = expected.indexOf('<script>');
  assert.ok(insertAt >= 0, 'Main script must exist');
  expected = expected.slice(0, insertAt) +
    '<script>' + cfg + '</script>\n<script>' + shim + '</script>\n' +
    expected.slice(insertAt);
  assert.equal(index, expected, 'Rebuild index.html from src/stoika.html before merging');
});

test('embedded JavaScript is syntactically valid', () => {
  const scripts = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, code] of scripts) new vm.Script(code);
});

test('off-bar list only contains non-retired items with warehouse stock > 0', () => {
  const match = src.match(/function itemsV2\(\)\{[\s\S]*?\n(?=async function putDoc)/);
  assert.ok(match, 'itemsV2 implementation must exist');
  const items = [
    {id: 'warehouse-only', b: 'Example', l: '', n: 'Apple', d: '', t: [], warehouse: 3, bar: false},
    {id: 'no-stock', b: 'Example', l: '', n: 'Banana', d: '', t: [], warehouse: 0, bar: false},
    {id: 'already-on-bar', b: 'Example', l: '', n: 'Cherry', d: '', t: [], warehouse: 2, bar: true},
    {id: 'retired', b: 'Example', l: '', n: 'Date', d: '', t: [], warehouse: 5, bar: false, retired: true},
  ];
  const context = {
    DATA: items,
    st: {tab: 'bar', barView: 'off', q: ''},
    norm: v => String(v).toLowerCase(),
    flag: (x, name) => !!x[name],
    onBar: x => x.bar,
    wh: x => x.warehouse,
  };
  const run = () => vm.runInNewContext(match[0] + '\nitemsV2().map(x=>x.id)', context);
  assert.deepEqual(Array.from(run()), ['warehouse-only']);
  context.st.q = 'banana';
  assert.deepEqual(Array.from(run()), [], 'Search may not include items with zero warehouse stock');
  context.st.q = 'date';
  assert.deepEqual(Array.from(run()), [], 'Search may not include retired items');
  context.st.q = 'apple';
  assert.deepEqual(Array.from(run()), ['warehouse-only']);
});

test('off-bar counter uses same warehouse-positive condition', () => {
  assert.match(src, /st\.barView==="off"\?DATA\.filter\(x=>!flag\(x,"retired"\)&&!onBar\(x\)&&wh\(x\)>0\)\.length/);
  assert.match(src, /st\.barView==="off"\?"не на стойке"/);
});

test('home screen has nine navigation tiles and retains access to extra menu', () => {
  const tiles = [...src.matchAll(/class="home-tile(?: home-hero)?" data-home="([^"]+)"/g)]
    .map(m => m[1]);
  assert.deepEqual(tiles, ['ai', 'bar', 'off', 'wh', 'stop', 'order', 'slow', 'sup', 'log']);
  assert.doesNotMatch(src, /body\.home-mode #menu-btn/);
  assert.match(src, /#bnav\{display:none!important\}/);
  assert.match(src, /\$\("#home-btn"\)\.onclick=\(\)=>go\("home"\)/);
});

test('suppliers tile is visible but disabled until staff authentication', () => {
  assert.match(src, /supTile\.disabled=!staffReady/);
  assert.match(src, /supTile\.setAttribute\("aria-disabled",String\(!staffReady\)\)/);
  assert.match(src, /if\(t==="sup"&&!staffReady\)return/);
  assert.match(src, /supTile\.querySelector\("small"\)\.textContent=staffReady/);
});

test('home and AI transitions clean body state, Telegram back targets home', () => {
  assert.match(src, /document\.body\.classList\.remove\("ai-mode","has-tray"\)/);
  assert.match(src, /st\.tab="home";render\(\)/);
  assert.match(src, /tgw\.BackButton\.onClick\(\(\)=>go\("home"\)\)/);
});
