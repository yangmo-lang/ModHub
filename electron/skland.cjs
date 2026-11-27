// 終末地圖鑑：用隱藏視窗打開森空島 wiki，讀取頁面已載入的資料
// （wiki 的 API 需要網頁簽名，直接讀頁面資料最穩定）
const { BrowserWindow } = require('electron');

const URL = 'https://wiki.skland.com/endfield?header=0';
const DETAIL = (main, sub, id) => `https://wiki.skland.com/endfield/detail?mainTypeId=${main}&subTypeId=${sub}&gameEntryId=${id}`;

// 在頁面內執行：從 __CHIMERA_STORE__ 找出目錄、篩選標籤、卡池、活動
const EXTRACT = `(() => {
  const store = window.__CHIMERA_STORE__;
  if (!store || !store.dataMap) return null;
  const out = { catalogs: [], tagTrees: {}, charPools: null, weaponPools: null, activities: null, banners: null };
  const seen = new Set();
  const captionText = (cap) => (Array.isArray(cap) ? cap.map((c) => (c && c.text && c.text.text) || '').join('').trim() : '');
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 9 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o.catalogList)) {
      for (const main of o.catalogList) {
        for (const sub of main.typeSub || []) {
          if (!Array.isArray(sub.items) || !sub.items.length) continue;
          if (out.catalogs.some((c) => c.mainId === main.id && c.subId === sub.id)) continue;
          out.catalogs.push({
            mainId: main.id, main: main.name, subId: sub.id, sub: sub.name,
            items: sub.items.map((it) => ({
              id: it.itemId, name: it.name, tagIds: it.tagIds || [], publishedAt: Number(it.publishedAtTs || 0) * 1000,
              cover: it.brief && it.brief.cover, dotType: it.brief && it.brief.dotType,
              caption: captionText(it.caption).slice(0, 1200),
            })),
          });
        }
      }
    }
    if (Array.isArray(o.sidebar)) {
      for (const main of o.sidebar) for (const sub of main.typeSub || []) {
        if (Array.isArray(sub.filterTagTree) && sub.filterTagTree.length) out.tagTrees[main.id + ':' + sub.id] = sub.filterTagTree;
      }
    }
    if (!out.charPools && Array.isArray(o.charPoolList)) out.charPools = o.charPoolList;
    if (!out.weaponPools && Array.isArray(o.weaponPoolList)) out.weaponPools = o.weaponPoolList;
    if (!out.activities && Array.isArray(o.activityList)) out.activities = o.activityList;
    if (!out.banners && Array.isArray(o.bannerList)) out.banners = o.bannerList;
    for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') walk(v, d + 1); }
  };
  walk(store.dataMap, 0);
  if (!out.catalogs.some((c) => c.sub === '干员')) return null;
  return JSON.parse(JSON.stringify(out));
})()`;

let cache = null; // { at, data }

async function loadWiki({ timeoutMs = 45000, maxAgeMs = 10 * 60 * 1000 } = {}) {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.data;
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'skland-wiki' },
  });
  try {
    await win.loadURL(URL);
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
      const r = await win.webContents.executeJavaScript(EXTRACT, true).catch(() => null);
      // 卡池 / 活動是另外載入的，等它們也出現（最多再等幾秒）
      if (r) {
        last = r;
        // 情報資訊要在頁面上互動才會載入，不等它；有抓到就顯示
        if ((r.charPools && r.activities) || Date.now() - t0 > timeoutMs / 2) break;
      }
      await new Promise((res) => setTimeout(res, 800));
    }
    if (!last) throw new Error('讀取森空島 wiki 逾時');
    cache = { at: Date.now(), data: last };
    return last;
  } finally {
    win.destroy();
  }
}

/** 給角色圖鑑用（相容舊介面）：干員清單 + 篩選標籤 */
async function loadEndfield() {
  const w = await loadWiki();
  const ops = w.catalogs.find((c) => c.sub === '干员');
  const tagTree = w.tagTrees[`${ops.mainId}:${ops.subId}`] || Object.values(w.tagTrees).find((t) => t.some((g) => g.name === '星级'));
  return {
    items: ops.items.map((it) => ({ itemId: it.id, name: it.name, tagIds: it.tagIds, brief: { name: it.name, cover: it.cover, dotType: it.dotType } })),
    tagTree,
  };
}

module.exports = { loadWiki, loadEndfield, DETAIL };
