const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const presets = require('../electron/presets.cjs');

function mk(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content ?? '');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-preset-'));
  mk(root, '流萤/_cover.png', 'x');
  mk(root, '流萤/SkinA/mod.ini');
  mk(root, '流萤/DISABLED_SkinB/mod.ini');
  mk(root, 'LooseMod/a.ini');
  mk(root, 'DISABLED_Old/a.ini');
  return root;
}

const names = (root, rel = '') => fs.readdirSync(path.join(root, rel)).sort();

test('snapshot 用去掉 DISABLED_ 的相對路徑', () => {
  const root = fixture();
  assert.deepEqual(presets.snapshot(root), ['LooseMod', '流萤/SkinA']);
  assert.equal(presets.modKey(root, path.join(root, '流萤', 'DISABLED_SkinB')), '流萤/SkinB');
});

test('套用組合：組合內啟用、其他停用，缺少的列出來', () => {
  const root = fixture();
  const plan = presets.planApply(root, ['流萤/SkinB', 'Old', '已刪除/X']);
  assert.deepEqual(plan.toEnable.map((m) => m.key).sort(), ['Old', '流萤/SkinB']);
  assert.deepEqual(plan.toDisable.map((m) => m.key).sort(), ['LooseMod', '流萤/SkinA']);
  assert.deepEqual(plan.missing, ['已刪除/X']);
  const r = presets.applyPlan(root, plan);
  assert.equal(r.enabled, 2);
  assert.equal(r.disabled, 2);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(names(root, '流萤'), ['DISABLED_SkinA', 'SkinB', '_cover.png']);
  assert.deepEqual(names(root), ['DISABLED_LooseMod', 'Old', '流萤']);
  // 再套一次不會有變動
  const again = presets.planApply(root, ['流萤/SkinB', 'Old']);
  assert.equal(again.toEnable.length + again.toDisable.length, 0);
});

test('來回切換可還原', () => {
  const root = fixture();
  const before = presets.snapshot(root);
  presets.applyPlan(root, presets.planApply(root, []));
  assert.deepEqual(presets.snapshot(root), []);
  presets.applyPlan(root, presets.planApply(root, before));
  assert.deepEqual(presets.snapshot(root), before);
  assert.deepEqual(names(root, '流萤'), ['DISABLED_SkinB', 'SkinA', '_cover.png']);
});

test('同名衝突時記錄錯誤並繼續', () => {
  const root = fixture();
  mk(root, '流萤/SkinB/mod.ini'); // 同時有 SkinB 與 DISABLED_SkinB
  const r = presets.applyPlan(root, presets.planApply(root, []));
  assert.ok(r.errors.some((e) => e.includes('同名')));
  assert.ok(r.disabled >= 2);
});

test('沒有 _cover 的角色資料夾要靠 scanOpts 辨識，不會被整個停用', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-preset-'));
  mk(root, '白露/Skin1/mod.ini');
  mk(root, '白露/Skin2/mod.ini');
  const opts = { knownCategories: new Set(['白露']) };
  assert.deepEqual(presets.snapshot(root, opts), ['白露/Skin1', '白露/Skin2']);
  presets.applyPlan(root, presets.planApply(root, ['白露/Skin2'], opts));
  assert.deepEqual(names(root), ['白露']);
  assert.deepEqual(names(root, '白露'), ['DISABLED_Skin1', 'Skin2']);
});

test('組合儲存：新增、改名、覆蓋、刪除、套用前備份', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-preset-store-'));
  const store = presets.createStore(path.join(dir, 'presets.json'));
  const a = store.create('SRMI', ' 日常 ', ['A']);
  assert.equal(a.name, '日常');
  assert.throws(() => store.create('SRMI', '日常', []), /同名/);
  assert.throws(() => store.create('SRMI', '  ', []), /名稱/);
  store.create('SRMI', '拍照', ['B']);
  assert.equal(store.update('SRMI', a.id, { name: '日常 2' }).name, '日常 2');
  assert.throws(() => store.update('SRMI', a.id, { name: '拍照' }), /同名/);
  assert.deepEqual(store.update('SRMI', a.id, { enabled: ['C'] }).enabled, ['C']);
  store.backup('SRMI', ['X']);
  store.backup('SRMI', ['Y']);
  const list = store.list('SRMI');
  assert.equal(list.filter((p) => p.auto).length, 1);
  assert.deepEqual(store.get('SRMI', presets.BACKUP_ID).enabled, ['Y']);
  store.remove('SRMI', a.id);
  assert.deepEqual(store.list('SRMI').map((p) => p.name), ['拍照', '套用前的狀態']);
  assert.deepEqual(store.list('WWMI'), []);
});
