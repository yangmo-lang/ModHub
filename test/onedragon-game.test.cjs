const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const g = require('../electron/onedragon-game.cjs');

test('讀 game_path：只看這一行，引號、空值都處理', () => {
  assert.equal(g.readGamePath('platform: PC\r\ngame_path: C:\\ZenlessZoneZero Game\\ZenlessZoneZero.exe\r\n'), 'C:\\ZenlessZoneZero Game\\ZenlessZoneZero.exe');
  assert.equal(g.readGamePath("game_path: 'D:\\遊戲\\ZenlessZoneZero.exe'\n"), 'D:\\遊戲\\ZenlessZoneZero.exe');
  assert.equal(g.readGamePath("game_path: ''\n"), '');
  assert.equal(g.readGamePath('game_path:\n'), '');
  assert.equal(g.readGamePath('account: x\n'), '');
});

test('補上 game_path：已有值不動；空的換掉；沒有就加在最後；保留換行符號與其他內容', () => {
  const exe = 'C:\\ZenlessZoneZero Game\\ZenlessZoneZero.exe';
  assert.equal(g.withGamePath(`game_path: D:\\x.exe\n`, exe), null);
  assert.equal(g.withGamePath(`a: 1\r\ngame_path: ''\r\nb: 2\r\n`, exe), `a: 1\r\ngame_path: ${exe}\r\nb: 2\r\n`);
  assert.equal(g.withGamePath('a: 1\r\nb: 2', exe), `a: 1\r\nb: 2\r\ngame_path: ${exe}\r\n`);
  assert.equal(g.withGamePath('', exe), `game_path: ${exe}\n`);
  const tricky = 'C:\\Games #1\\ZZZ: Beta\\ZenlessZoneZero.exe';
  assert.equal(g.readGamePath(g.withGamePath('', tricky)), tricky, '特殊字元會加引號');
});

test('找遊戲 exe：XXMI 設定優先，其次 Player.log', () => {
  const files = {
    'X\\XXMI Launcher Config.json': JSON.stringify({ Importers: { ZZMI: { Importer: { game_folder: 'C:/ZenlessZoneZero Game' } } } }),
    'H\\AppData\\LocalLow\\miHoYo\\ZenlessZoneZero\\Player.log': 'Loading D:/HoYoPlay/games/ZenlessZoneZero Game/ZenlessZoneZero_Data/x',
  };
  const read = (f) => { const k = Object.keys(files).find((x) => path.normalize(f).endsWith(path.normalize(x))); if (!k) throw new Error('ENOENT'); return files[k]; };
  let exists = (f) => /ZenlessZoneZero Game[\\/]ZenlessZoneZero\.exe$/.test(f);
  assert.equal(g.findGameExe('X', { home: 'H', read, exists }), path.normalize('C:/ZenlessZoneZero Game/ZenlessZoneZero.exe'));
  exists = (f) => f.startsWith('D:');
  assert.equal(g.findGameExe('X', { home: 'H', read, exists }), path.normalize('D:/HoYoPlay/games/ZenlessZoneZero Game/ZenlessZoneZero.exe'));
  assert.equal(g.findGameExe('X', { home: 'H', read, exists: () => false }), '');
});

test('填入：只填空的實例；沒有檔案就建立只有這一行的檔案', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-odgame-'));
  fs.mkdirSync(path.join(root, 'config', '01'), { recursive: true });
  fs.writeFileSync(g.accountFile(root, 1), 'game_path: D:\\mine.exe\r\naccount: secret\r\n');
  const exe = 'C:\\Z\\ZenlessZoneZero.exe';
  assert.deepEqual(g.fill(root, [1, 2], exe), [{ idx: 2, path: exe }]);
  assert.equal(fs.readFileSync(g.accountFile(root, 1), 'utf8'), 'game_path: D:\\mine.exe\r\naccount: secret\r\n', '已設定的不動');
  assert.equal(fs.readFileSync(g.accountFile(root, 2), 'utf8'), `game_path: ${exe}\n`);
  assert.deepEqual(g.status(root, [1, 2, 3]), [{ idx: 1, path: 'D:\\mine.exe', region: null }, { idx: 2, path: exe, region: null }, { idx: 3, path: '', region: null }]);
  assert.deepEqual(g.fill(root, [3], ''), [], '找不到 exe 就不寫');
});

test('區服：config.ini 分國服 / B 服 / 國際服，國際服再用 UID 分區', () => {
  const ini = (body) => ({ read: () => `[General]\r\n${body}\r\n` });
  const exe = 'C:\\Z\\ZenlessZoneZero.exe';
  assert.equal(g.detectClient(exe, ini('cps=pcseaepic\r\nuapc={"hyp":{"uapc":""},"nap_global":{"uapc":""}}')), 'intl');
  assert.equal(g.detectClient(exe, ini('cps=mihoyo\r\nuapc={"nap_cn":{"uapc":""}}')), 'cn');
  assert.equal(g.detectClient(exe, ini('cps=bilibili\r\nuapc={"nap_cn":{"uapc":""}}')), 'cnb');
  assert.equal(g.detectClient(exe, { read: () => { throw new Error('ENOENT'); } }), '');
  assert.equal(g.regionFromUid('1300004194'), 'asia');
  assert.equal(g.regionFromUid('1712345678'), 'twhkmo');
  assert.equal(g.regionFromUid('1012345678'), 'us');
  assert.equal(g.regionFromUid('1512345678'), 'eu');
  assert.equal(g.regionFromUid('12345678'), '');
  const intl = ini('uapc={"nap_global":{}}');
  assert.deepEqual(g.guessRegion(exe, ['1300004194'], intl), { region: 'asia', client: 'intl', source: 'UID 1300004194' });
  assert.deepEqual(g.guessRegion(exe, [], intl), { region: 'twhkmo', client: 'intl', source: '預設' });
  assert.equal(g.guessRegion(exe, ['1300004194'], ini('uapc={"nap_cn":{}}')).region, 'cn', '國服不看 UID');
  assert.equal(g.guessRegion('', []).region, '');
});

test('填入區服：只在從沒設定過（沒有 game_region 這一行）時補上；設定過的（含國服）不動', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-odregion-'));
  fs.mkdirSync(path.join(root, 'config', '01'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config', '02'), { recursive: true });
  fs.writeFileSync(g.accountFile(root, 1), 'game_path: D:\\mine.exe\r\npassword: secret\r\n');
  fs.writeFileSync(g.accountFile(root, 2), 'game_region: cn\n');
  const exe = 'C:\\Z\\ZenlessZoneZero.exe';
  assert.deepEqual(g.fill(root, [1, 2, 3], exe, 'asia'), [{ idx: 1, region: 'asia' }, { idx: 2, path: exe }, { idx: 3, path: exe, region: 'asia' }]);
  assert.equal(fs.readFileSync(g.accountFile(root, 1), 'utf8'), 'game_path: D:\\mine.exe\r\npassword: secret\r\ngame_region: asia\r\n');
  assert.equal(g.readField(fs.readFileSync(g.accountFile(root, 2), 'utf8'), 'game_region'), 'cn', '使用者設定的國服不改');
  assert.deepEqual(g.status(root, [1, 2]).map((i) => i.region), ['asia', 'cn']);
  assert.deepEqual(g.fill(root, [1], '', 'mars'), [], '不認得的區服不寫');
});
