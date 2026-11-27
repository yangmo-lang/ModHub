// 終末地圖鑑：用隱藏視窗打開森空島 wiki，讀取頁面已載入的干員目錄
// （wiki 的 API 需要網頁簽名，直接讀頁面資料最穩定）
const { BrowserWindow } = require('electron');

const URL = 'https://wiki.skland.com/endfield?header=0';

// 在頁面內執行：從 __CHIMERA_STORE__ 找出「干员」目錄與篩選標籤
const EXTRACT = `(() => {
  const store = window.__CHIMERA_STORE__;
  if (!store || !store.dataMap) return null;
  let items = null, tagTree = null;
  const seen = new Set();
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 9 || seen.has(o)) return;
    seen.add(o);
    if (!items && Array.isArray(o.catalogList)) {
      for (const main of o.catalogList) {
        const sub = (main.typeSub || []).find((t) => t.name === '干员' && Array.isArray(t.items) && t.items.length);
        if (sub) items = sub.items;
      }
    }
    if (!tagTree && Array.isArray(o.filterTagTree) && o.filterTagTree.some((g) => g.name === '星级')) tagTree = o.filterTagTree;
    for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') walk(v, d + 1); }
  };
  walk(store.dataMap, 0);
  if (!items) return null;
  return JSON.parse(JSON.stringify({
    items: items.map((it) => ({ itemId: it.itemId, name: it.name, tagIds: it.tagIds, brief: { name: it.brief && it.brief.name, cover: it.brief && it.brief.cover, dotType: it.brief && it.brief.dotType } })),
    tagTree,
  }));
})()`;

async function loadEndfield({ timeoutMs = 40000 } = {}) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'skland-wiki' },
  });
  try {
    await win.loadURL(URL);
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const r = await win.webContents.executeJavaScript(EXTRACT, true).catch(() => null);
      if (r && r.items && r.items.length && r.tagTree) return r;
      await new Promise((res) => setTimeout(res, 800));
    }
    throw new Error('讀取森空島 wiki 逾時');
  } finally {
    win.destroy();
  }
}

module.exports = { loadEndfield };
