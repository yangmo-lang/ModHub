const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const z = require('../electron/onedragon-zhtw.cjs');

test('繁簡對照表：只收一對一的字', () => {
  const OpenCC = require('opencc-js');
  const map = z.buildMap(OpenCC.Converter({ from: 'tw', to: 'cn' }));
  assert.equal(map['訓'], '训');
  assert.equal(map['練'], '练');
  assert.equal(map['麗'], '丽');
  assert.equal(map['日'], undefined, '簡繁相同的字不收');
  assert.ok(Object.keys(map).length > 2000);
});

test('安裝外掛：外掛資料夾名稱 = APP_ID，有 const / factory / 對照表 / 版本標記', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-zhtw-'));
  assert.throws(() => z.install(root), /plugins/);
  fs.mkdirSync(path.join(root, 'plugins'));
  assert.equal(z.status(root).installed, false);
  const st = z.install(root, { convert: (c) => (c === '訓' ? '训' : c) });
  assert.equal(st.installed, true);
  assert.equal(st.outdated, false);
  const dir = path.join(root, 'plugins', 'modhub_zh_tw');
  for (const f of ['__init__.py', 'modhub_zh_tw_const.py', 'modhub_zh_tw_factory.py', 't2s.json', 'modhub.json']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  const constPy = fs.readFileSync(path.join(dir, 'modhub_zh_tw_const.py'), 'utf8');
  assert.match(constPy, /APP_ID = 'modhub_zh_tw'/);
  assert.match(constPy, /INTERNAL_APP = True/, '不會出現在一條龍任務裡');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 't2s.json'), 'utf8')), { 訓: '训' });
  fs.writeFileSync(path.join(dir, 'modhub.json'), JSON.stringify({ version: 0 }));
  assert.equal(z.status(root).outdated, true, '舊版提示更新');
});
