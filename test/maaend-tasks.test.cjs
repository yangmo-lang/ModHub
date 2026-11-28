const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mt = require('../electron/maaend-tasks.cjs');
const me = require('../electron/maaend.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-metasks-'));
  for (const d of ['tasks', 'locales/interface', 'config']) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, 'interface.json'), `{
    // 註解
    "languages": { "zh_tw": "locales/interface/zh_tw.json" },
    "group": [{ "name": "dijiang", "label": "$group.dijiang" }],
    "task": [],
    "import": ["tasks/A.json"]
  }`);
  fs.writeFileSync(path.join(root, 'tasks', 'A.json'), JSON.stringify({
    task: [
      { name: 'Dijiang', label: '$task.Dijiang', group: ['dijiang'], option: ['Clue', 'Grow', 'Rooms'] },
      { name: 'Credit', label: '信用', option: ['Keep'] },
      { name: 'AccountSwitch', label: '切號', option: [] },
      { name: 'AdbOnly', label: '安卓', controller: ['ADB'], option: [] },
    ],
    option: {
      LaunchGamePCRegion: { type: 'select', label: '伺服器', cases: [{ name: 'CN' }, { name: 'Global' }, { name: 'Steam' }, { name: 'Epic' }], default_case: 'CN' },
      Clue: { type: 'switch', label: '$opt.Clue', cases: [{ name: 'Yes', option: ['ClueSend'] }, { name: 'No' }], pipeline_override: { big: 1 } },
      ClueSend: { type: 'input', label: '贈送', inputs: [{ name: 'Max', default: '2', pipeline_type: 'int' }] },
      Grow: { label: '種植', cases: [{ name: 'None', label: '不種' }, { name: 'Any', label: '任意', option: ['Items'] }], default_case: 'None' },
      Items: { type: 'checkbox', label: '材料', cases: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], default_case: ['A'], max_count: 2 },
      Rooms: { type: 'switch', label: '只在 ADB', controller: ['ADB'], cases: [{ name: 'Yes' }, { name: 'No' }], default_case: 'No' },
      Keep: { type: 'input', label: '保留', inputs: [{ name: 'N', default: '300', verify: '^\\d+$', pattern_msg: '$msg.num' }] },
    },
  }));
  fs.writeFileSync(path.join(root, 'locales', 'interface', 'zh_tw.json'), JSON.stringify({ 'task.Dijiang': '基建任務', 'opt.Clue': '線索設定', 'group.dijiang': '帝江號', 'msg.num': '請填數字' }));
  fs.writeFileSync(me.configFile(root), JSON.stringify({
    settings: { secret: 'keep-me' },
    instances: [{
      id: 'i1', name: '日常', controllerName: 'Win32-Front', resourceName: '官服',
      tasks: [
        { id: 'p1', taskName: '__MXU_PRETASK__LaunchGamePC', enabled: false, optionValues: {} },
        { id: 'a1', taskName: 'AccountSwitch', enabled: false, optionValues: {} },
        { id: 't1', taskName: 'Dijiang', enabled: true, enabledByController: { 'Win32-Front': true }, optionValues: { Grow: { type: 'select', caseName: 'Any' } } },
        { id: 't2', taskName: 'Credit', enabled: false, optionValues: {} },
      ],
    }],
  }, null, 4));
  return root;
}

test('預設值與子選項：switch / select 用 default_case（沒有就第一個），只展開目前選到的 case', () => {
  const { options } = mt.loadInterface(fixture());
  assert.deepEqual(options.Clue.dflt, { type: 'switch', value: true });
  assert.deepEqual(options.Grow.dflt, { type: 'select', caseName: 'None' });
  assert.deepEqual(options.Items.dflt, { type: 'checkbox', caseNames: ['A'] });
  assert.deepEqual(options.ClueSend.dflt, { type: 'input', values: { Max: '2' } });
  assert.equal(options.Clue.label, '線索設定');
  assert.equal(options.Clue.pipeline_override, undefined, '不傳 pipeline_override');
  assert.deepEqual(mt.initValues(['Clue', 'Grow'], options), {
    Clue: { type: 'switch', value: true },
    ClueSend: { type: 'input', values: { Max: '2' } },
    Grow: { type: 'select', caseName: 'None' },
  });
  assert.deepEqual([...mt.reachable(['Grow'], options)], ['Grow', 'Items']);
});

test('讀實例：隱藏啟動前置任務與切換帳號；可新增的任務依控制器過濾', () => {
  const root = fixture();
  const d = mt.readDetail(root, 'i1');
  assert.deepEqual(d.tasks.map((t) => [t.id, t.label, t.enabled]), [['t1', '基建任務', true], ['t2', '信用', false]]);
  assert.deepEqual(d.available.map((a) => a.name), ['Dijiang', 'Credit']);
  assert.deepEqual(d.groups, [{ name: 'dijiang', label: '帝江號' }]);
  assert.deepEqual(me.readInstances(root).instances[0].tasks.map((t) => t.name), ['Dijiang', 'Credit'], '總覽也不顯示隱藏的任務');
  assert.throws(() => mt.readDetail(root, 'nope'), /找不到/);
});

test('勾選與順序：隱藏的任務留在最前面，enabledByController 一起更新，其他設定保留，第一次先備份', () => {
  const root = fixture();
  const before = fs.readFileSync(me.configFile(root), 'utf8');
  const d = mt.setTasks(root, 'i1', [{ id: 't2', enabled: true }, { id: 't1', enabled: false }, { id: 'p1', enabled: true }]);
  assert.deepEqual(d.tasks.map((t) => [t.id, t.enabled]), [['t2', true], ['t1', false]]);
  const cfg = JSON.parse(fs.readFileSync(me.configFile(root), 'utf8'));
  assert.deepEqual(cfg.instances[0].tasks.map((t) => t.id), ['p1', 'a1', 't2', 't1']);
  assert.equal(cfg.instances[0].tasks[0].enabled, false, '隱藏的任務不能從 ModHub 開啟');
  assert.deepEqual(cfg.instances[0].tasks[2].enabledByController, { 'Win32-Front': true });
  assert.equal(cfg.instances[0].tasks[3].enabledByController['Win32-Front'], false);
  assert.equal(cfg.settings.secret, 'keep-me');
  assert.equal(fs.readFileSync(`${me.configFile(root)}.modhub-bak`, 'utf8'), before);
  mt.setTasks(root, 'i1', [{ id: 't1', enabled: true }]);
  assert.equal(fs.readFileSync(`${me.configFile(root)}.modhub-bak`, 'utf8'), before, '備份只做一次');
  assert.deepEqual(JSON.parse(fs.readFileSync(me.configFile(root), 'utf8')).instances[0].tasks.map((t) => t.id), ['p1', 'a1', 't1', 't2'], '沒列到的放最後');
});

test('改選項：驗證類型、case、數量與格式；只接受這個任務用得到的選項（含子選項）', () => {
  const root = fixture();
  let d = mt.setOption(root, 'i1', 't1', 'Items', { type: 'checkbox', caseNames: ['C', 'A', 'Z'] });
  assert.deepEqual(d.tasks[0].values.Items, { type: 'checkbox', caseNames: ['A', 'C'] }, '依定義順序、去掉不存在的');
  assert.throws(() => mt.setOption(root, 'i1', 't1', 'Items', { type: 'checkbox', caseNames: ['A', 'B', 'C'] }), /最多/);
  d = mt.setOption(root, 'i1', 't1', 'ClueSend', { type: 'input', values: { Max: '5', Bad: 'x' } });
  assert.deepEqual(d.tasks[0].values.ClueSend, { type: 'input', values: { Max: '5' } });
  assert.throws(() => mt.setOption(root, 'i1', 't1', 'ClueSend', { type: 'input', values: { Max: 'abc' } }), /整數/);
  assert.throws(() => mt.setOption(root, 'i2', 't1', 'Clue', { type: 'switch', value: false }), /找不到/);
  assert.throws(() => mt.setOption(root, 'i1', 't1', 'Grow', { type: 'select', caseName: 'Nope' }), /沒有這個選項/);
  assert.throws(() => mt.setOption(root, 'i1', 't1', 'Grow', { type: 'switch', value: true }), /類型/);
  assert.throws(() => mt.setOption(root, 'i1', 't1', 'Keep', { type: 'input', values: { N: '1' } }), /沒有這個選項/, '別的任務的選項');
  assert.throws(() => mt.setOption(root, 'i1', 't2', 'Keep', { type: 'input', values: { N: 'x' } }), /請填數字/);
  assert.throws(() => mt.setOption(root, 'i1', 'a1', 'Clue', { type: 'switch', value: true }), /找不到/, '隱藏的任務不能改');
  d = mt.setOption(root, 'i1', 't1', 'Clue', { type: 'switch', value: 0 });
  assert.deepEqual(d.tasks[0].values.Clue, { type: 'switch', value: false });
  assert.deepEqual(d.tasks[0].values.Grow, { type: 'select', caseName: 'Any' }, '其他選項保留');
});

test('新增 / 移除任務：新任務用預設值、id 不重複；隱藏與不適用控制器的任務不能新增', () => {
  const root = fixture();
  let d = mt.addTask(root, 'i1', 'Dijiang');
  assert.equal(d.tasks.length, 3);
  const added = d.tasks[2];
  assert.match(added.id, /^[a-z0-9]{7}$/);
  assert.equal(added.enabled, true);
  assert.deepEqual(Object.keys(added.values).sort(), ['Clue', 'ClueSend', 'Grow', 'Rooms'], '和 MaaEnd 一樣，不分控制器都先給預設值');
  assert.throws(() => mt.addTask(root, 'i1', 'AccountSwitch'), /沒有這個任務/);
  assert.throws(() => mt.addTask(root, 'i1', 'AdbOnly'), /控制器/);
  assert.throws(() => mt.addTask(root, 'i1', 'Nope'), /沒有這個任務/);
  d = mt.removeTask(root, 'i1', added.id);
  assert.equal(d.tasks.length, 2);
  assert.throws(() => mt.removeTask(root, 'i1', 'p1'), /找不到/);
});

test('依遊戲資料夾判斷伺服器', () => {
  assert.equal(me.guessRegion('C:/Program Files/Epic Games/ArknightsEndfieldgowoU/games/EndField Game'), 'Epic');
  assert.equal(me.guessRegion('D:/SteamLibrary/steamapps/common/Endfield'), 'Steam');
  assert.equal(me.guessRegion('C:/Program Files/GRYPHLINK/games/Endfield Game'), 'Global');
  assert.equal(me.guessRegion('C:/Program Files/Hypergryph Launcher/games/Endfield Game'), 'CN');
  assert.equal(me.guessRegion('E:/Games/Endfield'), '');
  assert.equal(me.guessRegion(''), '');
});

test('交給 MaaEnd 開遊戲：打開「啟動遊戲」前置任務並設定伺服器；已經對了就不寫檔', () => {
  const root = fixture();
  const file = me.configFile(root);
  assert.deepEqual(mt.readLaunchPretask(root, 'i1'), { exists: true, enabled: false, region: '' });
  assert.equal(mt.ensureLaunchPretask(root, 'i1', 'Epic'), true);
  assert.deepEqual(mt.readLaunchPretask(root, 'i1'), { exists: true, enabled: true, region: 'Epic' });
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(cfg.instances[0].tasks[0].enabledByController, { 'Win32-Front': true });
  assert.equal(cfg.instances[0].tasks[0].id, 'p1', '原本的前置任務原地修改');
  const mtime = fs.statSync(file).mtimeMs;
  assert.equal(mt.ensureLaunchPretask(root, 'i1', 'Epic'), false);
  assert.equal(mt.ensureLaunchPretask(root, 'i1', ''), false, '沒指定伺服器時只確保打開');
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  assert.throws(() => mt.ensureLaunchPretask(root, 'i1', 'Mars'), /伺服器/);
  // 沒有前置任務：加在最前面
  const c2 = JSON.parse(fs.readFileSync(file, 'utf8'));
  c2.instances[0].tasks = c2.instances[0].tasks.filter((t) => t.taskName !== mt.PRETASK);
  fs.writeFileSync(file, JSON.stringify(c2));
  assert.equal(mt.ensureLaunchPretask(root, 'i1', 'Steam'), true);
  const c3 = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(c3.instances[0].tasks[0].taskName, mt.PRETASK);
  assert.deepEqual(mt.readLaunchPretask(root, 'i1'), { exists: true, enabled: true, region: 'Steam' });
  assert.deepEqual(mt.readDetail(root, 'i1').tasks.map((t) => t.id), ['t1', 't2'], '任務清單仍然不顯示前置任務');
});
