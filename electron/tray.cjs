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

/** 系統匣選單內容（純資料，方便測試）；games = [{ id, name }]，onLaunch(gameId, { gui }) */
function menuTemplate({ hotkey, games = [], onShow, onOverlay, onLaunch, onQuit }) {
  const launchItems = games.length && onLaunch ? [{
    label: '啟動遊戲',
    submenu: [
      ...games.map((g) => ({ label: g.name, click: () => onLaunch(g.id, { gui: false }) })),
      { type: 'separator' },
      ...games.map((g) => ({ label: `在 XXMI Launcher 開啟：${g.short || g.name}`, click: () => onLaunch(g.id, { gui: true }) })),
    ],
  }] : [];
  return [
    { label: '開啟 ModHub', click: onShow },
    ...launchItems,
    { label: hotkey ? `遊戲內面板（${hotkey}）` : '遊戲內面板', click: onOverlay },
    { type: 'separator' },
    { label: '結束 ModHub', click: onQuit },
  ];
}

/**
 * @param ctx { Tray, Menu, icon, getWindow(), getSettings(), getHotkey(), games?, onLaunch?(gameId, { gui }) → Promise, onOverlay(), onQuit() }
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

  function balloon(title, content, iconType = 'info') {
    try { tray.displayBalloon({ iconType, title, content }); } catch { /* 部分系統不支援氣球提示 */ }
  }

  /** 透過 XXMI 啟動；失敗（找不到 XXMI、UAC 按了否）用氣球提示，主視窗可能是隱藏的 */
  function launch(gameId, opts) {
    return Promise.resolve()
      .then(() => ctx.onLaunch(gameId, opts))
      .catch((e) => balloon('無法啟動遊戲', String(e?.message || e), 'error'));
  }

  function refreshMenu() {
    tray.setContextMenu(ctx.Menu.buildFromTemplate(menuTemplate({
      hotkey: ctx.getHotkey(),
      games: ctx.games || [],
      onShow: showWindow,
      onOverlay: ctx.onOverlay,
      onLaunch: ctx.onLaunch ? launch : null,
      onQuit: ctx.onQuit,
    })));
  }

  /** 第一次縮到系統匣時提示一次，避免以為程式被關掉了 */
  function hintOnce() {
    if (hintShown) return;
    hintShown = true;
    const hk = ctx.getHotkey();
    balloon('ModHub 仍在系統匣執行', `${hk ? `在遊戲中按 ${hk} 叫出 MOD 面板；` : ''}點系統匣圖示可重新開啟，右鍵可啟動遊戲或結束。`);
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

  return { attach, refreshMenu, showWindow, launch, destroy: () => tray.destroy() };
}

module.exports = { createTray, menuTemplate, trayOptions, DEFAULTS };
