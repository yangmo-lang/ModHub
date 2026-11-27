// 終末地抽卡紀錄
// 參考 bhaoo/endfield-gacha（MIT）的做法：
//   1. 玩家在遊戲內開啟「寻访记录」後，遊戲日誌 HGWebview.log 會留下
//      https://ef-webview.{hypergryph|gryphline}.com/page/gacha_char?...&u8_token=...&server=...
//   2. 用 u8_token 呼叫 ef-webview 的 /api/record/char、/api/record/weapon 分頁讀取
// u8_token 只在記憶體中使用，不寫入檔案
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UA } = require('../net.cjs');
const { toTw } = require('../characters.cjs');

const CHAR_POOLS = {
  E_CharacterGachaPoolType_Special: { label: '特許尋訪', order: 1, pityMax: 80, bannerPityMax: 120 },
  E_CharacterGachaPoolType_Rerun: { label: '重構尋訪', order: 2, pityMax: 80, bannerPityMax: 120 },
  E_CharacterGachaPoolType_Joint: { label: '輝光慶典', order: 3, pityMax: 80 },
  E_CharacterGachaPoolType_Standard: { label: '基礎尋訪', order: 4, pityMax: 80 },
  E_CharacterGachaPoolType_Beginner: { label: '啟程尋訪', order: 5, pityMax: 80 },
};
const WEAPON_POOL_LABEL = { special: '限定申領', constant: '常駐申領', rerun: '重構申領' };

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function weaponPoolType(poolId) {
  const v = String(poolId || '').toLowerCase();
  if (v.includes('constant')) return 'constant';
  if (v.startsWith('rerun') || v.includes('rerun_')) return 'rerun';
  return 'special';
}

/** 從日誌網址取出參數 */
function parseGachaUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  const m = /^ef-webview\.(hypergryph|gryphline)\.com$/.exec(u.host);
  if (!m || !u.pathname.startsWith('/page/gacha')) return null;
  const token = u.searchParams.get('u8_token') || u.searchParams.get('token');
  if (!token) return null;
  return {
    provider: m[1],
    token,
    serverId: u.searchParams.get('server') || u.searchParams.get('server_id') || u.searchParams.get('serverId') || '1',
    lang: u.searchParams.get('lang') || 'zh-tw',
  };
}

/** 讀兩個伺服器的日誌，回傳最新的抽卡網址參數 */
function findFromLog() {
  const home = os.homedir();
  const found = [];
  for (const prov of ['Gryphline', 'Hypergryph']) {
    const f = path.join(home, 'AppData', 'LocalLow', prov, 'Endfield', 'sdklogs', 'HGWebview.log');
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const urls = text.match(/https:\/\/ef-webview\.(hypergryph|gryphline)\.com\/page\/gacha_[^\s"'<>]*/g) || [];
    const last = urls.length ? parseGachaUrl(urls[urls.length - 1]) : null;
    if (last) found.push({ ...last, mtime: fs.statSync(f).mtimeMs, logFile: f });
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0] || null;
}

async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status}（${new URL(url).pathname}）`);
  return r.json();
}

async function queryRole(auth) {
  try {
    const j = await getJson(`https://u8.${auth.provider}.com/game/role/v1/query_role_list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: auth.token, serverId: auth.serverId }),
    });
    const roles = j?.data?.list || j?.data?.roles || j?.data || [];
    const role = (Array.isArray(roles) ? roles : []).find((r) => String(r.serverId) === String(auth.serverId)) || (Array.isArray(roles) ? roles[0] : null);
    if (role) return { id: String(role.roleId || role.uid), name: role.nickName || role.nickname || '', server: role.serverName || '' };
  } catch {}
  return null;
}

/** 分頁讀取；遇到已知紀錄就停止 */
async function pages(baseUrl, params, known, onPage) {
  const all = [];
  let seq = '';
  for (let guard = 0; guard < 500; guard++) {
    const q = new URLSearchParams({ ...params });
    if (seq) q.set('seq_id', seq);
    const j = await getJson(`${baseUrl}?${q}`);
    if (j.code !== 0) {
      if (j.code === 40100 || j.code === 401 || /token is invalid|过期|失效/i.test(j.msg || '')) {
        const e = new Error('抽卡連結已過期，請在遊戲內開啟「尋訪紀錄」頁面後，馬上回來按「更新」');
        e.expired = true;
        throw e;
      }
      throw new Error(`終末地 API 錯誤 ${j.code}：${j.msg || ''}`);
    }
    const list = j.data?.list || [];
    if (!list.length) break;
    const fresh = list.filter((x) => !known.has(String(x.seqId)));
    all.push(...fresh);
    onPage?.(all.length);
    if (fresh.length < list.length || !j.data?.hasMore) break;
    seq = list[list.length - 1].seqId;
    await delay(400 + Math.random() * 300);
  }
  return all;
}

const toMs = (ts) => {
  const n = Number(ts);
  if (!Number.isFinite(n)) return Date.parse(ts) || 0;
  return n < 1e12 ? n * 1000 : n;
};
const tierOf = (r) => (r >= 6 ? 'top' : r === 5 ? 'mid' : 'low');

function normChar(x, poolType) {
  const rarity = Number(x.rarity) || 0;
  return {
    id: `c:${x.seqId}`,
    pool: `char:${poolType}`,
    poolName: CHAR_POOLS[poolType]?.label || toTw(x.poolName || poolType),
    bannerId: x.poolId || '',
    bannerName: toTw(x.poolName || ''),
    name: toTw(x.charName || x.nameText || ''),
    itemId: x.charId || '',
    kind: 'character',
    rarity,
    tier: tierOf(rarity),
    time: toMs(x.gachaTs),
    free: Boolean(x.isFree),
    gift: /^gift/i.test(String(x.kind || '')),
  };
}

function normWeapon(x, pool) {
  const rarity = Number(x.rarity) || 0;
  return {
    id: `w:${x.seqId}`,
    pool: `weapon:${pool.poolId}`,
    poolName: toTw(pool.poolName || x.poolName || ''),
    bannerId: pool.poolId,
    bannerName: toTw(pool.poolName || x.poolName || ''),
    name: toTw(x.weaponName || x.nameText || ''),
    itemId: x.weaponId || '',
    kind: 'weapon',
    rarity,
    tier: tierOf(rarity),
    time: toMs(x.gachaTs),
    free: false,
    gift: /^gift/i.test(String(x.kind || '')),
  };
}

/**
 * 讀取紀錄
 * @param auth   { provider, token, serverId, lang }
 * @param known  Set<id>（已存在的紀錄 id，帶前綴）
 */
async function fetchRecords(auth, known = new Set(), onProgress) {
  const base = `https://ef-webview.${auth.provider}.com/api/record`;
  const common = { token: auth.token, server_id: auth.serverId, lang: auth.lang };
  const knownSeq = new Set([...known].map((id) => id.replace(/^[cw]:/, '')));
  const out = [];
  const rules = {};

  // 角色池：先問有哪些池，失敗就用內建清單
  let poolTypes = Object.keys(CHAR_POOLS);
  try {
    const meta = await getJson(`${base}/char/meta?${new URLSearchParams(common)}`);
    const tabs = meta?.data?.tabs || meta?.data?.list || meta?.data || [];
    const types = (Array.isArray(tabs) ? tabs : []).map((t) => t?.poolType).filter(Boolean);
    if (types.length) poolTypes = [...new Set(types)];
  } catch {}
  for (const pt of poolTypes) {
    onProgress?.({ stage: `角色：${CHAR_POOLS[pt]?.label || pt}`, count: out.length });
    const list = await pages(`${base}/char`, { ...common, pool_type: pt }, knownSeq, (n) => onProgress?.({ stage: `角色：${CHAR_POOLS[pt]?.label || pt}`, count: out.length + n }));
    out.push(...list.map((x) => normChar(x, pt)));
    rules[`char:${pt}`] = CHAR_POOLS[pt] || { label: pt, order: 9, pityMax: 80 };
  }

  // 武器池：每個池各自保底
  let pools = [];
  try {
    const j = await getJson(`${base}/weapon/pool?${new URLSearchParams(common)}`);
    pools = Array.isArray(j?.data) ? j.data : j?.data?.list || [];
  } catch {}
  let order = 20;
  for (const p of pools) {
    if (!p?.poolId) continue;
    onProgress?.({ stage: `武器：${toTw(p.poolName || p.poolId)}`, count: out.length });
    const list = await pages(`${base}/weapon`, { ...common, pool_id: p.poolId }, knownSeq);
    out.push(...list.map((x) => normWeapon(x, p)));
    const type = weaponPoolType(p.poolId);
    rules[`weapon:${p.poolId}`] = { label: `${toTw(p.poolName || p.poolId)}（${WEAPON_POOL_LABEL[type]}）`, order: order++, pityMax: 40, bannerPityMax: type === 'special' ? 80 : undefined };
  }
  return { records: out, rules };
}

/**
 * 卡池內容（公開 API，不需 token）：UP 6★ 名稱、UP 立繪、池內所有 6★
 * 只有近期卡池查得到，舊卡池回傳 null
 */
async function fetchPoolContent(provider, serverId, poolId, lang = 'zh-tw') {
  try {
    const q = new URLSearchParams({ lang, pool_id: poolId, server_id: serverId });
    const j = await getJson(`https://ef-webview.${provider}.com/api/content?${q}`);
    const p = j?.code === 0 ? j.data?.pool : null;
    if (!p) return null;
    return {
      name: toTw(p.pool_name || ''),
      up6: toTw(p.up6_name || '') || null,
      up6Avatar: p.up6_avatar || p.up6_image || null,
      all6: (p.all || []).filter((x) => Number(x.rarity) === 6).map((x) => toTw(x.name)),
      fetchedAt: Date.now(),
    };
  } catch { return null; }
}

/** 依紀錄重建保底規則（不需連網） */
function rulesFor(records) {
  const rules = {};
  let order = 20;
  for (const r of records) {
    if (rules[r.pool]) continue;
    if (r.pool.startsWith('char:')) {
      const pt = r.pool.slice(5);
      rules[r.pool] = CHAR_POOLS[pt] || { label: r.poolName || pt, order: 9, pityMax: 80 };
    } else {
      const type = weaponPoolType(r.bannerId);
      rules[r.pool] = { label: `${r.poolName}（${WEAPON_POOL_LABEL[type]}）`, order: order++, pityMax: 40, bannerPityMax: type === 'special' ? 80 : undefined };
    }
  }
  return rules;
}

module.exports = { parseGachaUrl, findFromLog, queryRole, fetchRecords, fetchPoolContent, rulesFor, normChar, normWeapon, weaponPoolType, CHAR_POOLS };
