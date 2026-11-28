const test = require('node:test');
const assert = require('node:assert');
const { createOverlay, normalizeHotkey, parseTasklist, detectGame, DEFAULT_HOTKEY } = require('../electron/overlay.cjs');

test('快捷鍵格式：正規化、需要修飾鍵（F 鍵除外）、拒絕不認得的按鍵', () => {
  assert.equal(DEFAULT_HOTKEY, 'Alt+N');
  assert.equal(normalizeHotkey('alt+n'.replace('alt', 'Alt')), 'Alt+N');
  assert.equal(normalizeHotkey('Shift+Control+f'), 'Ctrl+Shift+F');
  assert.equal(normalizeHotkey('F9'), 'F9');
  assert.equal(normalizeHotkey('Alt+`'), 'Alt+`');
  assert.throws(() => normalizeHotkey('N'), /需要搭配/);
  assert.throws(() => normalizeHotkey('Alt+'), /請輸入|不支援/);
  assert.throws(() => normalizeHotkey('Hyper+N'), /修飾鍵/);
  assert.throws(() => normalizeHotkey('Alt+Ä'), /不支援的按鍵/);
});

test('tasklist 解析與遊戲判斷：同時開多個時以目前的遊戲優先', () => {
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"StarRail.exe","1234","Console","1","2,000,000 K"\r\n"ZenlessZoneZero.exe","5678","Console","1","1 K"\r\n';
  const names = parseTasklist(csv);
  assert.ok(names.has('starrail.exe'));
  assert.equal(detectGame(names, 'ZZMI'), 'ZZMI');
  assert.equal(detectGame(names, 'WWMI'), 'SRMI');
  assert.equal(detectGame(parseTasklist(''), 'SRMI'), null);
});

function fakeShortcut(taken = []) {
  const reg = new Map();
  return {
    reg,
    register: (k, fn) => { if (taken.includes(k) || reg.has(k)) return false; reg.set(k, fn); return true; },
    unregister: (k) => { reg.delete(k); },
    isRegistered: (k) => reg.has(k),
  };
}

test('換快捷鍵：成功才換；被佔用時保留原本的；空字串 = 停用；錄製時可暫停', () => {
  const gs = fakeShortcut(['Ctrl+Q']);
  const ov = createOverlay({ globalShortcut: gs });
  assert.equal(ov.setHotkey('Alt+N'), 'Alt+N');
  assert.deepEqual([...gs.reg.keys()], ['Alt+N']);

  assert.throws(() => ov.setHotkey('Ctrl+Q'), /佔用/);
  assert.equal(ov.hotkey, 'Alt+N');
  assert.deepEqual([...gs.reg.keys()], ['Alt+N'], '失敗時恢復原本的快捷鍵');

  assert.equal(ov.setHotkey('Alt+M'), 'Alt+M');
  assert.deepEqual([...gs.reg.keys()], ['Alt+M']);

  ov.suspend(true);
  assert.equal(gs.reg.size, 0);
  ov.suspend(false);
  assert.deepEqual([...gs.reg.keys()], ['Alt+M']);

  ov.suspend(true);
  assert.equal(ov.setHotkey('Alt+M'), 'Alt+M', '錄製到同一組合時恢復註冊');
  assert.deepEqual([...gs.reg.keys()], ['Alt+M']);

  assert.equal(ov.setHotkey(''), '');
  assert.equal(gs.reg.size, 0);
  ov.destroy();
});
