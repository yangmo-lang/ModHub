const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const t = require('../electron/onedragon-tasks.cjs');

const constFile = (root, dir, id, name, def) => {
  const d = path.join(root, 'src', 'zzz_od', 'application', dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${id}_const.py`), `APP_ID = "${id}"\nAPP_NAME = "${name}"\nDEFAULT_GROUP = ${def ? 'True' : 'False'}\n`);
};

function fixture({ group, legacy } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-od-'));
  fs.mkdirSync(path.join(root, 'config', '01'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'one_dragon.yml'), yaml.dump({ instance_list: [{ idx: 1, name: '01', active: true, active_in_od: true }] }));
  constFile(root, 'random_play', 'random_play', '录像店营业', true);
  constFile(root, 'coffee', 'coffee', '咖啡店', true);
  constFile(root, 'charge_plan', 'charge_plan', '体力刷本', true);
  constFile(root, 'daily_signin', 'daily_signin', '每日签到', true);
  constFile(root, 'notify', 'notify', '通知', true);
  constFile(root, 'auto_battle', 'auto_battle', '自动战斗', false);
  if (group) {
    fs.mkdirSync(path.join(root, 'config', '01', 'one_dragon'), { recursive: true });
    fs.writeFileSync(t.groupFile(root, 1), yaml.dump(group));
  }
  if (legacy) fs.writeFileSync(t.legacyFile(root, 1), yaml.dump(legacy));
  return root;
}

test('任務名單從安裝目錄的 *_const.py 讀；通知與非預設任務不列入', () => {
  const root = fixture();
  const c = t.readAppCatalog(root);
  assert.equal(c.fromInstall, true);
  assert.deepEqual(c.defaults.sort(), ['charge_plan', 'coffee', 'daily_signin', 'random_play']);
  assert.equal(c.names.auto_battle, '自动战斗');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-od-'));
  assert.equal(t.readAppCatalog(empty).fromInstall, false, '讀不到就用內建名單');
});

test('讀 _group.yml：已存的照順序，新的預設任務以停用排在後面', () => {
  const root = fixture({ group: { app_list: [{ app_id: 'random_play', enabled: true }, { app_id: 'coffee', enabled: true }, { app_id: 'notify', enabled: true }] } });
  const r = t.readTasks(root, 1);
  assert.equal(r.exists, true);
  assert.deepEqual(r.tasks.map((x) => `${x.id}:${x.enabled}`), ['random_play:true', 'coffee:true', 'charge_plan:false', 'daily_signin:false']);
  assert.equal(r.tasks[0].name, '錄像店營業');
});

test('沒有 _group.yml：ModHub 自己建立；有舊版設定就先遷移', () => {
  const fresh = fixture();
  const r0 = t.readTasks(fresh, 1);
  assert.equal(r0.exists, false);
  assert.ok(r0.tasks.every((x) => !x.enabled));
  const r1 = t.writeTasks(fresh, 1, r0.tasks.map((x) => ({ id: x.id, enabled: x.id === 'daily_signin' })));
  assert.equal(r1.exists, true);
  assert.equal(fs.existsSync(`${t.groupFile(fresh, 1)}.modhub-bak`), false, '新建的檔案不用備份');
  assert.deepEqual(r1.tasks.filter((x) => x.enabled).map((x) => x.id), ['daily_signin']);

  const old = fixture({ legacy: { app_order: ['coffee', 'random_play'], app_run_list: ['coffee'] } });
  const r2 = t.readTasks(old, 1);
  assert.equal(r2.migrated, true);
  assert.deepEqual(r2.tasks.slice(0, 2).map((x) => `${x.id}:${x.enabled}`), ['coffee:true', 'random_play:false']);
});

test('寫回：保留每個項目的其他欄位與清單外的已存項目，第一次先備份', () => {
  const root = fixture({ group: { app_list: [{ app_id: 'coffee', enabled: true, extra: 1 }, { app_id: 'notify', enabled: true }, { app_id: 'plugin_x', enabled: true }], other: 'keep' } });
  const file = t.groupFile(root, 1);
  const before = fs.readFileSync(file, 'utf8');
  t.writeTasks(root, 1, [{ id: 'charge_plan', enabled: true }, { id: 'coffee', enabled: false }]);
  const doc = yaml.load(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.app_list, [
    { app_id: 'charge_plan', enabled: true },
    { app_id: 'coffee', enabled: false, extra: 1 },
    { app_id: 'notify', enabled: true },
    { app_id: 'plugin_x', enabled: true },
  ]);
  assert.equal(doc.other, 'keep');
  assert.equal(fs.readFileSync(`${file}.modhub-bak`, 'utf8'), before);
  assert.throws(() => t.writeTasks(root, 9, []), /找不到帳號實例/);
  assert.throws(() => t.writeTasks(root, 1, [{ id: '../x', enabled: true }]), /格式/);
});

test('挑帳號實例', () => {
  const inst = [{ idx: 1, active: false }, { idx: 2, active: true }];
  assert.equal(t.pickInstance(inst, ''), 2);
  assert.equal(t.pickInstance(inst, '1,2'), 1);
  assert.equal(t.pickInstance([], ''), null);
});
