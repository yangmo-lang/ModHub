// 遊戲內疊加介面：全域快捷鍵（預設 Alt+N）在遊戲畫面上叫出 / 收起置頂的小面板
//
// - 不注入遊戲，只是一個置頂的 ModHub 視窗；遊戲需為「視窗化」或「無邊框全螢幕」，獨占全螢幕時看不到
// - 叫出時依正在執行的遊戲程序判斷遊戲（XXMI 設定裡的 game_process_exe），沒有就用 ModHub 目前的遊戲
// - 面板失去焦點（點回遊戲）、按 Esc 或再按一次快捷鍵就收起；地圖模式（終末地）不會因失去焦點收起
const { execFile } = require('node:child_process');

const DEFAULT_HOTKEY = 'Alt+N';
const GAME_EXE = { SRMI: 'StarRail.exe', ZZMI: 'ZenlessZoneZero.exe', WWMI: 'Client-Win64-Shipping.exe', EFMI: 'Endfield.exe' };
const WIDTH = 500;
const WIDE_MAX = 1280; // 地圖模式：放寬面板

/** tasklist /fo csv /nh 的輸出 → 小寫程序名稱集合 */
function parseTasklist(csv) {
  const names = new Set();
  for (const line of String(csv || '').split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line.trim());
    if (m) names.add(m[1].toLowerCase());
  }
  return names;
}

/** 依執行中的程序找遊戲；同時開了好幾個時以 prefer（ModHub 目前的遊戲）優先 */
function detectGame(names, prefer) {
  const running = Object.entries(GAME_EXE).filter(([, exe]) => names.has(exe.toLowerCase())).map(([id]) => id);
  if (!running.length) return null;
  return running.includes(prefer) ? prefer : running[0];
}

function listProcesses() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 3000 }, (err, out) => resolve(err ? new Set() : parseTasklist(out)));
  });
}

const MODIFIERS = new Set(['Alt', 'Ctrl', 'Control', 'Shift', 'Super', 'Meta', 'CommandOrControl', 'CmdOrCtrl', 'AltGr', 'Option', 'Command', 'Cmd']);
const KEY_RE = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|Plus|[`\-=[\]\\;',./]|num[0-9]|numadd|numsub|nummult|numdiv|numdec)$/;

/**
 * 檢查快捷鍵格式（Electron accelerator）：需要至少一個修飾鍵，F1–F24 例外
 * @returns 正規化後的字串，格式不對時丟出錯誤
 */
function normalizeHotkey(input) {
  const parts = String(input || '').split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('請輸入快捷鍵');
  const key = parts.pop();
  const mods = [...new Set(parts.map((m) => (m === 'Control' ? 'Ctrl' : m)))];
  for (const m of mods) if (!MODIFIERS.has(m)) throw new Error(`不認得的修飾鍵：${m}`);
  const k = key.length === 1 ? key.toUpperCase() : key;
  if (!KEY_RE.test(k)) throw new Error(`不支援的按鍵：${key}`);
  if (!mods.length && !/^F\d+$/.test(k)) throw new Error('快捷鍵需要搭配 Alt、Ctrl 或 Shift（F1–F24 除外）');
  const order = ['Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'AltGr', 'Shift', 'Super', 'Meta'];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, k].join('+');
}

/**
 * @param ctx { BrowserWindow, globalShortcut, screen, preload, load(win, hash), currentGame(), onShow? }
 */
function createOverlay(ctx) {
  let win = null;
  let hotkey = null;
  let lastHide = 0;
  let wide = false;

  /** 面板位置：滑鼠所在螢幕的右側（遊戲通常在那個螢幕）；地圖模式加寬並佔滿高度 */
  function boundsFor(workArea) {
    const width = wide ? Math.min(WIDE_MAX, workArea.width - 48) : WIDTH;
    const height = wide ? workArea.height - 48 : Math.min(760, workArea.height - 80);
    return { x: workArea.x + workArea.width - width - 24, y: workArea.y + (wide ? 24 : 40), width, height };
  }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    win = new ctx.BrowserWindow({
      width: WIDTH,
      height: 640,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      backgroundColor: '#14161c',
      title: 'ModHub 疊加介面',
      webPreferences: { preload: ctx.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // 點回遊戲就收起；地圖模式例外（內嵌地圖的 <webview> 會讓視窗失去焦點），用快捷鍵或 ✕ 收起
    win.on('blur', () => { if (!wide) hide(); });
    ctx.load(win, 'overlay');
    return win;
  }

  function hide() {
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.hide();
      lastHide = Date.now();
    }
  }

  async function show() {
    const w = ensureWindow();
    const prefer = ctx.currentGame();
    const running = detectGame(await listProcesses(), prefer);
    const gameId = running || prefer;
    const { workArea } = ctx.screen.getDisplayNearestPoint(ctx.screen.getCursorScreenPoint());
    w.setBounds(boundsFor(workArea));
    w.webContents.send('overlay:show', { gameId, detected: Boolean(running) });
    w.show();
    w.focus();
    w.moveTop();
  }

  function toggle() {
    if (win && !win.isDestroyed() && win.isVisible()) return hide();
    // 按快捷鍵時面板會先因失去焦點收起，避免「收起後又馬上打開」
    if (Date.now() - lastHide < 250) return undefined;
    return show();
  }

  /** 切換地圖模式（加寬面板）；面板開著時就地調整，維持在目前的螢幕 */
  function setWide(on) {
    if (wide === on) return wide;
    wide = on;
    if (win && !win.isDestroyed() && win.isVisible()) {
      const { workArea } = ctx.screen.getDisplayMatching(win.getBounds());
      win.setBounds(boundsFor(workArea));
    }
    return wide;
  }

  /** 換快捷鍵：先註冊新的，成功才放掉舊的；key 為空字串 = 停用 */
  function setHotkey(key) {
    const next = key ? normalizeHotkey(key) : '';
    if (next === hotkey) {
      suspend(false); // 可能剛錄製完、還在暫停中
      return hotkey;
    }
    const prev = hotkey;
    if (prev) ctx.globalShortcut.unregister(prev);
    if (next) {
      let ok = false;
      try { ok = ctx.globalShortcut.register(next, toggle); } catch { ok = false; }
      if (!ok) {
        // 新的被佔用：恢復原本的快捷鍵
        if (prev) { try { ctx.globalShortcut.register(prev, toggle); } catch { hotkey = null; } }
        throw new Error(`無法使用 ${next}：可能已被其他程式佔用`);
      }
    }
    hotkey = next;
    return hotkey;
  }

  /** 設定視窗錄製新快捷鍵時暫停全域快捷鍵（否則按下去會被攔截，輸入框收不到） */
  function suspend(on) {
    if (!hotkey) return;
    if (on) ctx.globalShortcut.unregister(hotkey);
    else if (!ctx.globalShortcut.isRegistered(hotkey)) {
      try { ctx.globalShortcut.register(hotkey, toggle); } catch { /* 恢復失敗就維持停用 */ }
    }
  }

  function destroy() {
    if (hotkey) ctx.globalShortcut.unregister(hotkey);
    hotkey = null;
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }

  return { setHotkey, suspend, toggle, show, hide, destroy, setWide, get hotkey() { return hotkey; }, get window() { return win; } };
}

module.exports = { createOverlay, normalizeHotkey, parseTasklist, detectGame, DEFAULT_HOTKEY, GAME_EXE };
