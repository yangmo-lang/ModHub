const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const od = require('../electron/onedragon.cjs');
const { shellStart } = require('../electron/onedragon-main.cjs');
const { EventEmitter } = require('node:events');

test('啟動參數：一條龍 + 跑完動作 + 帳號實例', () => {
  assert.deepEqual(od.launchArgs({ odAfter: 'close' }), ['-o', '-c']);
  assert.deepEqual(od.launchArgs({ odAfter: 'none' }), ['-o']);
  assert.deepEqual(od.launchArgs({ odAfter: 'shutdown' }), ['-o', '-c', '-s', '60']);
  assert.deepEqual(od.launchArgs({ odAfter: 'sleep', odInstance: ' 1, 2 ' }), ['-o', '-c', '--sleep', '-i', '1,2']);
  assert.deepEqual(od.launchArgs({ odAfter: 'hibernate' }), ['-o', '-c', '--hibernate']);
  assert.throws(() => od.launchArgs({ odInstance: '1;calc' }), /帳號實例/);
  assert.deepEqual(od.launchArgs(od.options({})), ['-o', '-c'], '預設：跑完關遊戲');
});

test('定時：時間到、今天還沒跑、30 分鐘內才執行', () => {
  const s = { odScheduleEnabled: true, odScheduleTime: '04:30', odLastRunDate: '' };
  const at = (h, m, d = 28) => new Date(2026, 10, d, h, m);
  assert.equal(od.dueNow(at(4, 29), s), false);
  assert.equal(od.dueNow(at(4, 30), s), true);
  assert.equal(od.dueNow(at(5, 0), s), true);
  assert.equal(od.dueNow(at(5, 1), s), false, '超過 30 分鐘不補跑');
  assert.equal(od.dueNow(at(4, 40), { ...s, odLastRunDate: '2026-11-28' }), false, '今天跑過了');
  assert.equal(od.dueNow(at(4, 40), { ...s, odLastRunDate: '2026-11-27' }), true);
  assert.equal(od.dueNow(at(4, 40), { ...s, odScheduleEnabled: false }), false);
  assert.equal(od.dueNow(at(4, 40), { ...s, odScheduleTime: '25:00' }), false);
  assert.equal(od.dateKey(at(1, 0, 3)), '2026-11-03');
});

test('偵測 OneDragon 資料夾：設定優先，其次各磁碟名稱含 OneDragon 的資料夾', () => {
  const dir = (name) => ({ name, isDirectory: () => true });
  const tree = { 'C:\\': [dir('Windows')], 'D:\\': [dir('ZZZ-OneDragon')], [path.join('D:\\', 'ZZZ-OneDragon')]: [dir('app')] };
  const exe = path.join('D:\\', 'ZZZ-OneDragon', 'app', 'OneDragon-Launcher.exe');
  const opts = { home: '', drives: ['C', 'D'], exists: (p) => p === exe, readdir: (d) => { if (!tree[d]) throw new Error('x'); return tree[d]; } };
  assert.equal(od.detect('', opts), path.join('D:\\', 'ZZZ-OneDragon', 'app'));
  assert.equal(od.detect('E:\\nope', opts), '', '設定的資料夾裡沒有就不亂找');
});

test('挑官方安裝程式；shellStart 用 start 啟動並拒絕特殊字元', async () => {
  const rel = od.pickInstaller({ tag_name: 'v2.6.1', assets: [{ name: 'ZenlessZoneZero-OneDragon-v2.6.1-Full.zip' }, { name: 'ZenlessZoneZero-OneDragon-v2.6.1-Installer.exe', browser_download_url: 'u', size: 9, digest: `sha256:${'b'.repeat(64)}` }] });
  assert.deepEqual([rel.version, rel.url, rel.sha256], ['2.6.1', 'u', 'b'.repeat(64)]);
  let seen = null;
  const fake = (cmd, args) => { seen = args[3]; const c = new EventEmitter(); setImmediate(() => c.emit('exit', 0)); return c; };
  await shellStart('D:\\OD\\OneDragon-Launcher.exe', ['-o', '-c'], fake);
  assert.equal(seen, '"start "" /D "D:\\OD" "D:\\OD\\OneDragon-Launcher.exe" -o -c"');
  assert.throws(() => shellStart('D:\\a&b\\x.exe', ['-o'], fake), /不支援的字元/);
});

test('一條龍前開遊戲：預設由 ModHub 透過 XXMI 開；waitFor 逾時回傳 false', async () => {
  assert.equal(od.options({}).odLaunchVia, 'xxmi');
  assert.equal(od.GAME_EXE, 'ZenlessZoneZero.exe');
  const { waitFor } = require('../electron/onedragon-main.cjs');
  let n = 0;
  assert.equal(await waitFor(async () => ++n >= 3, 1000, 5), true);
  assert.equal(await waitFor(async () => false, 30, 10), false);
});
