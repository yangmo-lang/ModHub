// 系統匣：主視窗最小化 / 關閉時可以縮到系統匣，讓遊戲內面板的快捷鍵一直有效
//
// 設定（settings.json）：
//   trayOnMinimize  最小化時縮到系統匣（預設 true）
//   trayOnClose     按 ✕ 時縮到系統匣而不是結束（預設 true）
const DEFAULTS = { trayOnMinimize: true, trayOnClose: true };

const trayOptions = (settings) => ({
  trayOnMinimize: settings?.trayOnMinimize ?? DEFAULTS.trayOnMinimize,
  trayOnClose: settings?.trayOnClose ?? DEFAULTS.trayOnClose,
});

/** 系統匣選單內容（純資料，方便測試） */
function menuTemplate({ hotkey, onShow, onOverlay, onQuit }) {
  return [
    { label: '開啟 ModHub', click: onShow },
    { label: hotkey ? `遊戲內面板（${hotkey}）` : '遊戲內面板', click: onOverlay },
    { type: 'separator' },
    { label: '結束 ModHub', click: onQuit },
  ];
}

/**
 * @param ctx { Tray, Menu, icon, getWindow(), getSettings(), getHotkey(), onOverlay(), onQuit() }
 */
function createTray(ctx) {
  const tray = new ctx.Tray(ctx.icon);
  tray.setToolTip('ModHub');
  let hintShown = false;

  function showWindow() {
    const w = ctx.getWindow();
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }

  function refreshMenu() {
    tray.setContextMenu(ctx.Menu.buildFromTemplate(menuTemplate({
      hotkey: ctx.getHotkey(),
      onShow: showWindow,
      onOverlay: ctx.onOverlay,
      onQuit: ctx.onQuit,
    })));
  }

  /** 第一次縮到系統匣時提示一次，避免以為程式被關掉了 */
  function hintOnce() {
    if (hintShown) return;
    hintShown = true;
    const hk = ctx.getHotkey();
    try {
      tray.displayBalloon({
        iconType: 'info',
        title: 'ModHub 仍在系統匣執行',
        content: `${hk ? `在遊戲中按 ${hk} 叫出 MOD 面板；` : ''}點系統匣圖示可重新開啟，右鍵可結束。`,
      });
    } catch { /* 部分系統不支援氣球提示 */ }
  }

  /** 接上主視窗的最小化 / 關閉；isQuitting() 為 true 時照常關閉 */
  function attach(win, isQuitting) {
    win.on('minimize', () => {
      if (!trayOptions(ctx.getSettings()).trayOnMinimize) return;
      win.hide();
      hintOnce();
    });
    win.on('close', (e) => {
      if (isQuitting() || !trayOptions(ctx.getSettings()).trayOnClose) return;
      e.preventDefault();
      win.hide();
      hintOnce();
    });
  }

  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  refreshMenu();

  return { attach, refreshMenu, showWindow, destroy: () => tray.destroy() };
}

module.exports = { createTray, menuTemplate, trayOptions, DEFAULTS };
