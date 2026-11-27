const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanMods, setModEnabled, enableOnly } = require('../electron/scanner.cjs');

function mk(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content ?? '');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-'));
  mk(root, '流萤/_cover.png', 'x');
  mk(root, '流萤/SkinA/mod.ini');
  mk(root, '流萤/SkinA/preview.jpg', 'x');
  mk(root, '流萤/DISABLED_SkinB/mod.ini');
  mk(root, '流萤/SkinC/sub/mod.ini');
  mk(root, 'wrapper_123/Inner/mod.ini'); // 外層包裝資料夾 → 當成 MOD
  mk(root, 'LooseMod/a.ini'); // 直接含 ini → MOD
  mk(root, 'DISABLED_Old/a.ini');
  return root;
}

test('scan 分類與 MOD', () => {
  const root = fixture();
  const { categories, mods } = scanMods(root);
  const cat = categories.find((c) => c.name === '流萤');
  assert.ok(cat, '應辨識出分類');
  assert.equal(cat.total, 3);
  assert.equal(cat.enabled, 2);
  assert.ok(cat.cover.endsWith('_cover.png'));
  const unc = mods.filter((m) => m.category === '未分類').map((m) => m.name).sort();
  assert.deepEqual(unc, ['LooseMod', 'Old', 'wrapper_123']);
  const a = mods.find((m) => m.name === 'SkinA');
  assert.ok(a.preview.endsWith('preview.jpg'));
  assert.equal(mods.find((m) => m.name === 'Old').enabled, false);
});

test('啟用/停用 重新命名', () => {
  const root = fixture();
  const p = path.join(root, 'LooseMod');
  const off = setModEnabled(root, p, false);
  assert.equal(path.basename(off), 'DISABLED_LooseMod');
  assert.ok(fs.existsSync(off));
  const on = setModEnabled(root, off, true);
  assert.equal(path.basename(on), 'LooseMod');
});

test('只啟用這個', () => {
  const root = fixture();
  const r = enableOnly(root, path.join(root, '流萤', 'DISABLED_SkinB'));
  assert.equal(path.basename(r.newPath), 'SkinB');
  const names = fs.readdirSync(path.join(root, '流萤')).sort();
  assert.deepEqual(names, ['DISABLED_SkinA', 'DISABLED_SkinC', 'SkinB', '_cover.png']);
});

test('拒絕 Mods 外的路徑與名稱衝突', () => {
  const root = fixture();
  assert.throws(() => setModEnabled(root, path.join(root, '..'), false));
  mk(root, 'Dup/a.ini');
  mk(root, 'DISABLED_Dup/a.ini');
  assert.throws(() => setModEnabled(root, path.join(root, 'Dup'), false), /同名/);
});
