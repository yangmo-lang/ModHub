const test = require('node:test');
const assert = require('node:assert');
const el = require('../electron/elevated.cjs');
const elevMain = require('../electron/elevated-main.cjs');

test('命令列參數：有空白加引號、拒絕引號與換行', () => {
  assert.equal(el.joinArgs(['--nogui', '--xxmi', 'ZZMI']), '--nogui --xxmi ZZMI');
  assert.equal(el.joinArgs(['-i', '日常 任務', '-q']), '-i "日常 任務" -q');
  assert.throws(() => el.joinArgs(['a"b']), /不支援/);
  assert.throws(() => el.joinArgs(['a\nb']), /不支援/);
  assert.throws(() => el.entry({ name: '..\\x', exe: 'C:\\a.exe' }), /名稱/);
  assert.throws(() => el.entry({ name: 'OK', exe: 'C:\\a".exe' }), /路徑/);
});

test('比對工作排程：相同 / 需要更新 / 未設定 / 多餘', () => {
  const desired = [
    el.entry({ name: 'XXMI-ZZMI', exe: 'C:\\XXMI\\Resources\\Bin\\XXMI Launcher.exe', args: ['--nogui', '--xxmi', 'ZZMI'] }),
    el.entry({ name: 'OneDragon', exe: 'C:\\OD\\OneDragon-Launcher.exe', args: ['-o', '-c'] }),
    el.entry({ name: 'MaaEnd', exe: 'C:\\MaaEnd\\MaaEnd.exe', args: ['--autostart', '-i', '日常', '-q'] }),
  ];
  const existing = [
    { name: 'XXMI-ZZMI', exe: 'c:/xxmi/resources/bin/XXMI Launcher.exe', args: '--nogui  --xxmi ZZMI', level: 'Highest', enabled: 'True' },
    { name: 'OneDragon', exe: 'C:\\OD\\OneDragon-Launcher.exe', args: '-o', level: 'Highest', enabled: 'True' },
    { name: 'XXMI-OLD', exe: 'x', args: '', level: 'Highest', enabled: 'True' },
  ];
  const r = el.compare(desired, existing);
  assert.deepEqual(r.items.map((i) => i.state), ['ok', 'outdated', 'missing']);
  assert.deepEqual(r.extra, ['XXMI-OLD']);
  assert.equal(r.any, true);
  assert.equal(r.allOk, false);
  assert.equal(el.compare([desired[0]], [{ ...existing[0], level: 'Limited' }]).items[0].state, 'outdated', '不是最高權限');
  assert.equal(el.compare([desired[0]], [{ ...existing[0], enabled: 'False' }]).items[0].state, 'outdated', '被停用');
  assert.equal(el.compare([desired[0]], [existing[0]]).allOk, true);
  assert.equal(el.compare([], []).any, false);
});

test('查詢結果：PowerShell 的 JSON（單一物件或陣列）', () => {
  assert.deepEqual(el.parseQuery(''), []);
  assert.deepEqual(el.parseQuery('[]'), []);
  assert.deepEqual(el.parseQuery('{"name":"A","exe":"x"}'), [{ name: 'A', exe: 'x' }]);
  assert.equal(el.parseQuery('[{"name":"A"},{"name":"B"}]').length, 2);
});

test('建立工作的 PowerShell：最高權限、互動式、一般優先順序；字串用單引號跳脫；空清單 = 全部移除', () => {
  const s = el.setupScript([el.entry({ name: 'MaaEnd', label: "Bob's", exe: 'C:\\Maa End\\MaaEnd.exe', args: ['-i', "it's"], dir: 'C:\\Maa End' })], 'PC\\user');
  assert.match(s, /HighestAvailable/);
  assert.match(s, /InteractiveToken/);
  assert.match(s, /<Priority>4<\/Priority>/);
  assert.match(s, /<Triggers \/>/);
  assert.match(s, /New-ModHubTask 'MaaEnd' 'Bob''s' 'C:\\Maa End\\MaaEnd\.exe' '-i it''s' 'C:\\Maa End'/);
  assert.match(s, /\$user = 'PC\\user'/);
  assert.doesNotMatch(s, /DeleteFolder/);
  const rm = el.setupScript([], 'PC\\user');
  assert.match(rm, /\$keep = @\(\)/);
  assert.match(rm, /DeleteFolder\('ModHub', 0\)/);
  const outer = el.elevatedLauncherScript('exit 0');
  assert.match(outer, /-Verb RunAs/);
  assert.match(outer, new RegExp(`-EncodedCommand ${el.encode('exit 0')}`));
  assert.equal(Buffer.from(el.encode('中文'), 'base64').toString('utf16le'), '中文');
});

test('使用者名稱：網域\\帳號', () => {
  assert.equal(el.currentUserId({ USERNAME: 'lajid', USERDOMAIN: 'PC' }), 'PC\\lajid');
  assert.equal(el.currentUserId({ USERNAME: 'lajid', COMPUTERNAME: 'BOX' }), 'BOX\\lajid');
});

test('啟動：工作排程裡命令列相同才用 schtasks /run，否則用原本的方式（跳 UAC）', async () => {
  const handlers = {};
  const ipc = { handle: (k, f) => { handlers[k] = f; } };
  let existing = [];
  const ran = [];
  const entries = () => [el.entry({ name: 'OneDragon', exe: 'C:\\OD\\OneDragon-Launcher.exe', args: ['-o', '-c'] })];
  let applied = null;
  const api = elevMain.register(ipc, { entries }, {
    queryTasks: async () => existing,
    runTask: async (n) => { ran.push(n); },
    applyTasks: async (d) => { applied = d; existing = d.map((x) => ({ ...x, level: 'Highest', enabled: 'True' })); },
  });
  let fallback = 0;
  assert.equal(await api.start('OneDragon', async () => { fallback++; }), 'fallback');
  assert.equal(fallback, 1);
  const st = await handlers['elev:setup']();
  assert.equal(applied.length, 1);
  assert.equal(st.allOk, true);
  assert.equal(await api.start('OneDragon', async () => { fallback++; }), 'task');
  assert.deepEqual(ran, ['OneDragon']);
  assert.equal(await api.start('XXMI-ZZMI', async () => { fallback++; }), 'fallback', '沒有對應的工作');
  assert.equal(fallback, 2);
  await handlers['elev:remove']();
  assert.deepEqual(applied, []);
});
