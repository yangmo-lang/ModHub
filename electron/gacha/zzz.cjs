// 絕區零調頻紀錄
// 玩家在遊戲內開啟「調頻紀錄」後，遊戲的網頁快取（ZenlessZoneZero_Data/webCaches/<版本>/Cache/Cache_Data/data_2）
// 會留下含 authkey 的網址（auth_appid=webview_gacha）。用它呼叫官方 getGachaLog 分頁讀取。
// authkey 只在記憶體中使用，不寫入檔案。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UA } = require('../net.cjs');
const { toTw } = require('../characters.cjs');

const POOLS = [
  { real: 2, gacha: 2001, key: 'zzz:2', label: '獨家頻段', order: 1, pityMax: 90 },
  { real: 3, gacha: 3001, key: 'zzz:3', label: '音擎頻段', order: 2, pityMax: 80 },
  { real: 1, gacha: 1001, key: 'zzz:1', label: '常駐頻段', order: 3, pityMax: 90 },
  { real: 5, gacha: 5001, key: 'zzz:5', label: '邦布頻段', order: 4, pityMax: 80 },
];
const API_HOST = { nap_global: 'public-operation-nap-sg.hoyoverse.com', nap_cn: 'public-operation-nap.mihoyo.com' };
const OFFICIAL_PAGE = 'https://act.hoyolab.com/zzz/event/gacha-record/index.html';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** 遊戲資料夾：XXMI 設定 → 玩家日誌 → 預設 */
function findGameDataDirs(xxmiRoot) {
  const dirs = new Set();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(xxmiRoot, 'XXMI Launcher Config.json'), 'utf8'));
    const folder = cfg?.Importers?.ZZMI?.Importer?.game_folder;
    if (folder) dirs.add(path.join(folder, 'ZenlessZoneZero_Data'));
  } catch {}
  for (const sub of ['miHoYo/ZenlessZoneZero', 'miHoYo/絕區零', 'miHoYo/绝区零']) {
    try {
      const log = fs.readFileSync(path.join(os.homedir(), 'AppData', 'LocalLow', ...sub.split('/'), 'Player.log'), 'utf8');
      const m = /([A-Z]:[\\/][^\r\n]*?ZenlessZoneZero_Data)/i.exec(log);
      if (m) dirs.add(path.normalize(m[1]));
    } catch {}
  }
  return [...dirs].filter((d) => fs.existsSync(d));
}

/** 判斷是不是調頻紀錄的 authkey 網址 */
function parseAuthUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  const p = u.searchParams;
  if (!p.get('authkey')) return null;
  const isGacha = p.get('auth_appid') === 'webview_gacha' || /getGachaLog|gacha/i.test(u.pathname);
  if (!isGacha) return null;
  const biz = p.get('game_biz') || (/mihoyo\.com$/.test(u.host) ? 'nap_cn' : 'nap_global');
  return {
    authkey: p.get('authkey'),
    authkey_ver: p.get('authkey_ver') || '1',
    sign_type: p.get('sign_type') || '2',
    game_biz: biz,
    region: p.get('region') || '',
    lang: p.get('lang') || 'zh-tw',
    host: API_HOST[biz] || API_HOST.nap_global,
  };
}

/** 從網頁快取找最新的調頻紀錄網址（新版本資料夾、檔案後段優先） */
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
  // 去掉重複的 authkey
  const seen = new Set();
  return cands.filter((c) => (seen.has(c.authkey) ? false : (seen.add(c.authkey), true)));
}

// 官方 API 會限速（retcode -110 visit too frequently）：每個請求至少間隔 RATE.gap，被限速時等待後重試
const RATE = { gap: 600, backoff: 2000, retries: 4 };
let lastAt = 0;
async function throttle() {
  const wait = lastAt + RATE.gap + Math.random() * RATE.gap * 0.3 - Date.now();
  if (wait > 0) await delay(wait);
  lastAt = Date.now();
}

async function call(auth, pool, endId, size = 20) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callOnce(auth, pool, endId, size);
    } catch (e) {
      if (!e.rateLimited || attempt >= RATE.retries) throw e;
      await delay(RATE.backoff * 2 ** attempt);
    }
  }
}

async function callOnce(auth, pool, endId, size) {
  await throttle();
  const q = new URLSearchParams({
    authkey_ver: auth.authkey_ver, sign_type: auth.sign_type, auth_appid: 'webview_gacha',
    authkey: auth.authkey, lang: auth.lang, game_biz: auth.game_biz,
    real_gacha_type: String(pool.real), gacha_type: String(pool.gacha), init_log_gacha_type: String(pool.gacha),
    page: '1', size: String(size), end_id: String(endId || 0),
  });
  if (auth.region) q.set('region', auth.region);
  const r = await fetch(`https://${auth.host}/common/gacha_record/api/getGachaLog?${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.retcode !== 0) {
    const rateLimited = j.retcode === -110 || /too frequently/i.test(j.message || '');
    const expired = !rateLimited && (j.retcode === -101 || /authkey/i.test(j.message || ''));
    const e = new Error(rateLimited ? `請求太頻繁，被官方暫時限制，請等 1～2 分鐘後再更新（${j.retcode} ${j.message || ''}）`
      : expired ? '調頻紀錄連結已過期，請在遊戲內開啟「調頻紀錄」頁面後，馬上回來按「更新」' : `絕區零 API 錯誤 ${j.retcode}：${j.message || ''}`);
    e.expired = expired;
    e.rateLimited = rateLimited;
    throw e;
  }
  return j.data || {};
}

/** 試每一個候選 authkey，回傳第一個有效的 */
async function pickValid(cands) {
  let lastErr = null;
  for (const c of cands.slice(0, 6)) {
    try {
      await call(c, POOLS[2], 0, 1);
      return c;
    } catch (e) {
      if (e.rateLimited) throw e;
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

const tierOf = (rank) => (Number(rank) >= 4 ? 'top' : Number(rank) === 3 ? 'mid' : 'low');
const RANK_LABEL = { 2: 'B', 3: 'A', 4: 'S' };

function norm(x, pool) {
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
    rarityLabel: RANK_LABEL[x.rank_type] || '',
    tier: tierOf(x.rank_type),
    time: Date.parse(String(x.time || '').replace(' ', 'T') + '+08:00') || 0,
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
      const data = await call(auth, pool, endId);
      const list = data.list || [];
      if (!list.length) break;
      const fresh = list.filter((x) => !known.has(String(x.id)));
      out.push(...fresh.map((x) => norm(x, pool)));
      uid = uid || String(list[0].uid || '');
      if (fresh.length < list.length) break;
      endId = list[list.length - 1].id;
    }
  }
  return { records: out, uid, region: auth.region };
}

/** 用每個池 1 筆的請求找出 uid（沒有任何紀錄就回傳空字串） */
async function probeUid(auth) {
  for (const pool of POOLS) {
    const data = await call(auth, pool, 0, 1);
    if (data.list?.length) return String(data.list[0].uid || '');
  }
  return '';
}

function rulesFor() {
  return Object.fromEntries(POOLS.map((p) => [p.key, { label: p.label, order: p.order, pityMax: p.pityMax }]));
}

module.exports = { POOLS, OFFICIAL_PAGE, RATE, findGameDataDirs, parseAuthUrl, findFromCache, pickValid, probeUid, fetchRecords, rulesFor, norm };
