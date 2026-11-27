// 自動更新
// - 安裝版（NSIS）：electron-updater 從 GitHub Releases 的 latest.yml 檢查，使用者按「下載」後背景下載，
//   下載完按「重新啟動並更新」（或下次關閉程式時）安裝。安裝包的 SHA-512 由 electron-updater 依 latest.yml 校驗。
// - 免安裝版（portable）：electron-updater 不支援，只查 GitHub 最新版並提示到 Releases 頁面下載。
// - 開發模式（npm start / dev）：不檢查。
const { app, shell } = require('electron');

const REPO = 'yangmo-lang/ModHub';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/** 版本比較：'0.1.10' > '0.1.9' */
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function mode() {
  if (!app.isPackaged) return 'dev';
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'portable';
  return 'installer';
}

function register(ipcMain, { emit }) {
  let state = { mode: mode(), version: app.getVersion(), status: 'idle' };
  const set = (patch) => { state = { ...state, ...patch }; emit('update:status', state); return state; };

  let updater = null;
  if (state.mode === 'installer') {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = false;          // 使用者同意才下載
    updater.autoInstallOnAppQuit = true;   // 已下載的更新在關閉程式時安裝
    updater.on('checking-for-update', () => set({ status: 'checking', error: null }));
    updater.on('update-available', (info) => set({ status: 'available', latest: info.version, notes: info.releaseNotes || null }));
    updater.on('update-not-available', (info) => set({ status: 'latest', latest: info.version }));
    updater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    updater.on('update-downloaded', (info) => set({ status: 'downloaded', latest: info.version, percent: 100 }));
    updater.on('error', (e) => set({ status: 'error', error: String(e?.message || e).split('\n')[0] }));
  }

  async function check() {
    if (state.mode === 'dev') return set({ status: 'dev' });
    if (state.mode === 'installer') {
      if (['downloading', 'downloaded'].includes(state.status)) return state;
      try { await updater.checkForUpdates(); } catch (e) { set({ status: 'error', error: String(e?.message || e).split('\n')[0] }); }
      return state;
    }
    // portable：只查最新版號
    set({ status: 'checking', error: null });
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ModHub' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const latest = String(j.tag_name || '').replace(/^v/, '');
      return set(newer(latest, state.version) ? { status: 'available', latest } : { status: 'latest', latest });
    } catch (e) {
      return set({ status: 'error', error: e.message });
    }
  }

  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:download', async () => {
    if (state.mode !== 'installer') { shell.openExternal(RELEASES_PAGE); return state; }
    if (state.status !== 'available') return state;
    set({ status: 'downloading', percent: 0 });
    try { await updater.downloadUpdate(); } catch (e) { set({ status: 'error', error: String(e?.message || e).split('\n')[0] }); }
    return state;
  });
  ipcMain.handle('update:install', () => {
    if (state.mode === 'installer' && state.status === 'downloaded') {
      // isSilent=true：不顯示安裝精靈；isForceRunAfter=true：裝完自動重開
      setImmediate(() => updater.quitAndInstall(true, true));
      return true;
    }
    return false;
  });
  ipcMain.handle('update:openReleases', () => shell.openExternal(RELEASES_PAGE));

  // 啟動後稍等再檢查，不拖慢開啟速度
  if (state.mode !== 'dev') setTimeout(() => { check(); }, 5000);
}

module.exports = { register, newer, RELEASES_PAGE };
