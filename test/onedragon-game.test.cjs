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
  assert.deepEqual(g.fill(root, [1, 2], exe), [2]);
  assert.equal(fs.readFileSync(g.accountFile(root, 1), 'utf8'), 'game_path: D:\\mine.exe\r\naccount: secret\r\n', '已設定的不動');
  assert.equal(fs.readFileSync(g.accountFile(root, 2), 'utf8'), `game_path: ${exe}\n`);
  assert.deepEqual(g.status(root, [1, 2, 3]), [{ idx: 1, path: 'D:\\mine.exe' }, { idx: 2, path: exe }, { idx: 3, path: '' }]);
  assert.deepEqual(g.fill(root, [3], ''), [], '找不到 exe 就不寫');
});
