const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createTray, menuTemplate, trayOptions } = require('../electron/tray.cjs');

function fakes() {
  const trays = [];
  class Tray extends EventEmitter {
    constructor(icon) { super(); this.icon = icon; trays.push(this); this.balloons = []; }
    setToolTip(t) { this.tip = t; }
    setContextMenu(m) { this.menu = m; }
    displayBalloon(b) { this.balloons.push(b); }
    destroy() { this.destroyed = true; }
  }
  const Menu = { buildFromTemplate: (t) => t };
  class Win extends EventEmitter {
    constructor() { super(); this.visible = true; this.min = false; }
    hide() { this.visible = false; }
    show() { this.visible = true; }
    focus() {}
    restore() { this.min = false; }
    isMinimized() { return this.min; }
    isDestroyed() { return false; }
    close() { const e = { prevented: false, preventDefault() { this.prevented = true; } }; this.emit('close', e); return e.prevented; }
  }
  return { trays, Tray, Menu, Win };
}

test('預設：最小化與關閉都縮到系統匣', () => {
  assert.deepEqual(trayOptions({}), { trayOnMinimize: true, trayOnClose: true });
  assert.deepEqual(trayOptions({ trayOnClose: false }), { trayOnMinimize: true, trayOnClose: false });
});

test('選單顯示目前的快捷鍵', () => {
  const labels = menuTemplate({ hotkey: 'Alt+N' }).map((x) => x.label || x.type);
  assert.deepEqual(labels, ['開啟 ModHub', '遊戲內面板（Alt+N）', 'separator', '結束 ModHub']);
  assert.equal(menuTemplate({ hotkey: '' })[1].label, '遊戲內面板');
});

test('關閉 / 最小化依設定縮到系統匣；結束時照常關閉；點圖示叫回視窗', () => {
  const { trays, Tray, Menu, Win } = fakes();
  let settings = {};
  let quitting = false;
  const win = new Win();
  const t = createTray({ Tray, Menu, icon: 'x.png', getWindow: () => win, getSettings: () => settings, getHotkey: () => 'Alt+N', onOverlay() {}, onQuit() {} });
  t.attach(win, () => quitting);

  assert.equal(win.close(), true, '預設按 ✕ 不關閉');
  assert.equal(win.visible, false);
  assert.equal(trays[0].balloons.length, 1, '第一次縮到系統匣有提示');

  trays[0].emit('click');
  assert.equal(win.visible, true);

  win.emit('minimize');
  assert.equal(win.visible, false);
  assert.equal(trays[0].balloons.length, 1, '提示只出現一次');
  trays[0].emit('double-click');

  settings = { trayOnClose: false, trayOnMinimize: false };
  assert.equal(win.close(), false, '關掉設定後照常關閉');
  win.emit('minimize');
  assert.equal(win.visible, true);

  settings = {};
  quitting = true;
  assert.equal(win.close(), false, '結束程式時不攔截');
  assert.match(trays[0].menu[1].label, /Alt\+N/);
});
