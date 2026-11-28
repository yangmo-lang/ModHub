// 內嵌互動地圖（終末地：zmdmap.com）
//
// - 網站設了 X-Frame-Options，iframe 載不進來，所以用 Electron 的 <webview>（獨立的頁面，不受限制）
// - <webview> 一律用獨立的 persist:zmdmap 分區、沙箱、無 preload，只能載入地圖網域
// - 地圖頁裡點到其他網站的連結 → 用系統瀏覽器開啟，不在 ModHub 裡瀏覽
const MAP_PARTITION = 'persist:zmdmap';
const MAPS = {
  EFMI: { url: 'https://www.zmdmap.com/', name: '終末地互動地圖', site: 'zmdmap.com' },
};
const MAP_HOST_RE = /^([a-z0-9-]+\.)*zmdmap\.com$/i;

/** 是否為允許在內嵌地圖裡開啟的網址（https + zmdmap.com 與其子網域） */
function isMapUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && MAP_HOST_RE.test(u.hostname);
  } catch { return false; }
}

/** 是否可以交給系統瀏覽器開啟（只接受 http / https） */
function isWebUrl(url) {
  try { return ['https:', 'http:'].includes(new URL(String(url)).protocol); } catch { return false; }
}

/**
 * 管理所有視窗裡的 <webview>：只放行地圖、強制安全設定
 * @param ctx { app, session, shell }
 */
function setupMapWebviews({ app, session, shell }) {
  const ses = session.fromPartition(MAP_PARTITION);
  // 地圖不需要任何權限（定位、通知、相機…）
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);

  const openOutside = (url) => { if (isWebUrl(url)) shell.openExternal(url); };

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (ev, webPreferences, params) => {
      if (!isMapUrl(params.src)) { ev.preventDefault(); return; }
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      params.partition = MAP_PARTITION;
      params.allowpopups = '';
    });
    contents.on('did-attach-webview', (_ev, guest) => {
      guest.setWindowOpenHandler(({ url }) => {
        if (isMapUrl(url)) guest.loadURL(url);
        else openOutside(url);
        return { action: 'deny' };
      });
      guest.on('will-navigate', (ev, url) => {
        if (!isMapUrl(url)) { ev.preventDefault(); openOutside(url); }
      });
    });
  });
}

module.exports = { MAPS, MAP_PARTITION, isMapUrl, isWebUrl, setupMapWebviews };
