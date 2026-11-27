// 崩壞：星穹鐵道 躍遷紀錄
// 取得 authkey 的方式和絕區零相同（參考 starrailstation.com 的匯入說明）：
//   玩家在遊戲內開啟「躍遷 → 查看詳情 → 紀錄」後，StarRail_Data/webCaches/<版本>/Cache/Cache_Data/data_2
//   會留下含 authkey 的網址；或由 HoYoLAB 登入產生 authkey（與 HoYoLAB 官方躍遷紀錄工具相同）。
// 一般卡池用 getGachaLog，聯動卡池（gacha_type 21 / 22）用 getLdGachaLog。authkey 只在記憶體中使用。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UA } = require('../net.cjs');
const { toTw } = require('../characters.cjs');

const POOLS = [
  { gacha: 11, key: 'hsr:11', label: '角色活動躍遷', order: 1, pityMax: 90, limited: true },
  { gacha: 12, key: 'hsr:12', label: '光錐活動躍遷', order: 2, pityMax: 80, limited: true },
  { gacha: 21, key: 'hsr:21', label: '聯動角色躍遷', order: 3, pityMax: 90, limited: true, ld: true },
  { gacha: 22, key: 'hsr:22', label: '聯動光錐躍遷', order: 4, pityMax: 80, limited: true, ld: true },
  { gacha: 1, key: 'hsr:1', label: '群星躍遷', order: 5, pityMax: 90 },
  { gacha: 2, key: 'hsr:2', label: '始發躍遷', order: 6, pityMax: 50 },
];
const API_HOST = { hkrpg_global: 'public-operation-hkrpg-sg.hoyoverse.com', hkrpg_cn: 'public-operation-hkrpg.mihoyo.com' };
const OFFICIAL_PAGE = 'https://act.hoyolab.com/sr/event/gt-aio/gacha-records/index.html#/index-pc';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** 遊戲資料夾：XXMI 設定 → 玩家日誌 → （找不到就沒有） */
function findGameDataDirs(xxmiRoot) {
  const dirs = new Set();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(xxmiRoot, 'XXMI Launcher Config.json'), 'utf8'));
    const folder = cfg?.Importers?.SRMI?.Importer?.game_folder;
    if (folder) dirs.add(path.join(folder, 'StarRail_Data'));
  } catch {}
  for (const sub of ['Cognosphere/Star Rail', 'miHoYo/崩坏：星穹铁道', 'miHoYo/崩壞：星穹鐵道']) {
    for (const log of ['Player.log', 'Player-prev.log']) {
      try {
        const text = fs.readFileSync(path.join(os.homedir(), 'AppData', 'LocalLow', ...sub.split('/'), log), 'utf8');
        const m = /([A-Z]:[\\/][^\r\n]*?StarRail_Data)/i.exec(text);
        if (m) dirs.add(path.normalize(m[1]));
      } catch {}
    }
  }
  return [...dirs].filter((d) => fs.existsSync(d));
}

/** 判斷是不是星鐵躍遷紀錄的 authkey 網址 */
function parseAuthUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  const p = u.searchParams;
  if (!p.get('authkey')) return null;
  const biz = p.get('game_biz') || (/mihoyo\.com$/.test(u.host) ? 'hkrpg_cn' : /hkrpg|hoyoverse|hoyolab/.test(u.host) ? 'hkrpg_global' : '');
  if (!/^hkrpg_/.test(biz)) return null;
  const isGacha = p.get('auth_appid') === 'webview_gacha' || /gacha/i.test(u.pathname + u.hash);
  if (!isGacha) return null;
  return {
    authkey: p.get('authkey'),
    authkey_ver: p.get('authkey_ver') || '1',
    sign_type: p.get('sign_type') || '2',
    game_biz: biz,
    region: p.get('region') || '',
    lang: 'zh-tw',
    host: API_HOST[biz] || API_HOST.hkrpg_global,
  };
}

/** 從網頁快取找最新的躍遷紀錄網址（新版本資料夾、檔案後段優先），去掉重複的 authkey */
function findFromCache(dataDirs) {
  const cands = [];
  for (const d of dataDirs) {
    const wc = path.join(d, 'webCaches');
    if (!fs.existsSync(wc)) continue;
    for (const v of fs.readdirSync(wc)) {
      const f = path.join(wc, v, 'Cache', 'Cache_Data', 'data_2');
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f).toString('latin1');
      const urls = text.match(/https:\/\/[a-z0-9.-]+\/[^\0\s"'<>]*authkey=[^\0\s"'<>]*/g) || [];
      urls.forEach((url, i) => {
        const a = parseAuthUrl(url);
        if (a) cands.push({ ...a, mtime: fs.statSync(f).mtimeMs, pos: i });
      });
    }
  }
  cands.sort((a, b) => b.mtime - a.mtime || b.pos - a.pos);
  const seen = new Set();
  return cands.filter((c) => (seen.has(c.authkey) ? false : (seen.add(c.authkey), true)));
}

async function call(auth, pool, endId, size = 20) {
  const q = new URLSearchParams({
    authkey_ver: auth.authkey_ver, sign_type: auth.sign_type, auth_appid: 'webview_gacha',
    authkey: auth.authkey, lang: auth.lang || 'zh-tw', game_biz: auth.game_biz,
    gacha_type: String(pool.gacha), page: '1', size: String(size), end_id: String(endId || 0),
  });
  if (auth.region) q.set('region', auth.region);
  const ep = pool.ld ? 'getLdGachaLog' : 'getGachaLog';
  const r = await fetch(`https://${auth.host}/common/gacha_record/api/${ep}?${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.retcode !== 0) {
    const expired = j.retcode === -101 || j.retcode === -100 || /authkey/i.test(j.message || '');
    const e = new Error(expired ? '躍遷紀錄連結已過期，請在遊戲內開啟「躍遷 → 查看詳情 → 紀錄」後，馬上回來按「從遊戲更新」' : `星鐵 API 錯誤 ${j.retcode}：${j.message || ''}`);
    e.expired = expired;
    throw e;
  }
  return j.data || {};
}

/** 試每一個候選 authkey，回傳第一個有效的 */
async function pickValid(cands) {
  let lastErr = null;
  for (const c of cands.slice(0, 6)) {
    try {
      await call(c, POOLS[4], 0, 1);
      return c;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return null;
}

const tierOf = (rank) => (Number(rank) >= 5 ? 'top' : Number(rank) === 4 ? 'mid' : 'low');

/** 時間是伺服器當地時間（亞服 / 國服 UTC+8、美服 UTC-5、歐服 UTC+1） */
const TZ = { prod_official_usa: '-05:00', prod_official_eur: '+01:00' };

function norm(x, pool, region) {
  return {
    id: String(x.id),
    pool: pool.key,
    poolName: pool.label,
    bannerId: String(x.gacha_id || ''),
    bannerName: '',
    name: toTw(x.name || ''),
    itemId: String(x.item_id || ''),
    kind: x.item_type || '',
    rarity: Number(x.rank_type) || 0,
    rarityLabel: x.rank_type ? `${x.rank_type}★` : '',
    tier: tierOf(x.rank_type),
    time: Date.parse(String(x.time || '').replace(' ', 'T') + (TZ[region] || '+08:00')) || 0,
    timeText: x.time || '',
    uid: String(x.uid || ''),
  };
}

async function fetchRecords(auth, known = new Set(), onProgress) {
  const out = [];
  let uid = '';
  for (const pool of POOLS) {
    let endId = 0;
    for (let guard = 0; guard < 1000; guard++) {
      onProgress?.({ stage: pool.label, count: out.length });
      let data;
      try {
        data = await call(auth, pool, endId);
      } catch (e) {
        // 聯動池在舊帳號 / 國服可能不存在：只有聯動池失敗時略過
        if (pool.ld && !e.expired) break;
        throw e;
      }
      const list = data.list || [];
      if (!list.length) break;
      const fresh = list.filter((x) => !known.has(String(x.id)));
      out.push(...fresh.map((x) => norm(x, pool, auth.region)));
      uid = uid || String(list[0].uid || '');
      if (fresh.length < list.length) break;
      endId = list[list.length - 1].id;
      await delay(300 + Math.random() * 200);
    }
  }
  return { records: out, uid, region: auth.region };
}

/** 用每個池 1 筆的請求找出 uid（沒有任何紀錄就回傳空字串） */
async function probeUid(auth) {
  for (const pool of POOLS) {
    const data = await call(auth, pool, 0, 1).catch((e) => { if (pool.ld && !e.expired) return {}; throw e; });
    if (data.list?.length) return String(data.list[0].uid || '');
  }
  return '';
}

function rulesFor() {
  return Object.fromEntries(POOLS.map((p) => [p.key, { label: p.label, order: p.order, pityMax: p.pityMax }]));
}

module.exports = { POOLS, OFFICIAL_PAGE, findGameDataDirs, parseAuthUrl, findFromCache, pickValid, probeUid, fetchRecords, rulesFor, norm };
