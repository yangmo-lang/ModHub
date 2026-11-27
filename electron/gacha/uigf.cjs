// UIGF 標準格式（https://uigf.org）：星鐵 hkrpg、絕區零 nap
//   匯出：UIGF v4.0
//   匯入：UIGF v4.x，以及舊的 SRGF v1（星鐵）
// 終末地不在 UIGF 範圍內，仍用 ModHub 自己的 JSON。
const { toTw } = require('../characters.cjs');
const hsr = require('./hsr.cjs');
const zzz = require('./zzz.cjs');

const GAMES = {
  SRMI: { key: 'hkrpg', mod: hsr, poolType: (p) => p.gacha, tz: { prod_official_usa: -5, prod_official_eur: 1 } },
  ZZMI: { key: 'nap', mod: zzz, poolType: (p) => p.real, tz: { prod_gf_us: -5, prod_gf_eu: 1 } },
};

const pad = (n) => String(n).padStart(2, '0');
const tzText = (h) => `${h < 0 ? '-' : '+'}${pad(Math.abs(Math.trunc(h)))}:${pad(Math.round((Math.abs(h) % 1) * 60))}`;

/** 毫秒時間 → 伺服器當地時間字串（紀錄沒有原始時間字串時才用） */
function localText(ms, tz) {
  const d = new Date(ms + tz * 3600e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function timezoneOf(gameId, account) {
  const g = GAMES[gameId];
  const region = account?.region || account?.server || '';
  return g.tz[region] ?? 8;
}

/**
 * 匯出 UIGF v4.0
 * @param {string} gameId SRMI | ZZMI
 * @param {Array<{account, records}>} list
 */
function toUIGF(gameId, list, appVersion = '') {
  const g = GAMES[gameId];
  if (!g) throw new Error('UIGF 只支援星鐵與絕區零');
  const typeOf = Object.fromEntries(g.mod.POOLS.map((p) => [p.key, String(g.poolType(p))]));
  return {
    info: { export_timestamp: Math.floor(Date.now() / 1000), export_app: 'ModHub', export_app_version: appVersion, version: 'v4.0' },
    [g.key]: list.map(({ account, records }) => {
      const tz = timezoneOf(gameId, account);
      return {
        uid: String(account.uid || account.id),
        timezone: tz,
        lang: 'zh-tw',
        list: records.filter((r) => typeOf[r.pool]).map((r) => ({
          gacha_id: r.bannerId || '',
          gacha_type: typeOf[r.pool],
          item_id: r.itemId || '',
          count: '1',
          time: r.timeText || localText(r.time, tz),
          name: r.name || '',
          item_type: r.kind || '',
          rank_type: String(r.rarity || ''),
          id: String(r.id),
        })),
      };
    }),
  };
}

const isUIGF = (j) => Boolean(j && typeof j === 'object' && j.info && (j.info.srgf_version || /^v4/i.test(String(j.info.version || ''))));

/**
 * 解析 UIGF v4 / SRGF v1 → [{ uid, timezone, records, skipped }]
 * records 是 ModHub 內部格式（與從遊戲更新的一樣）
 */
function fromUIGF(gameId, j) {
  const g = GAMES[gameId];
  if (!g) throw new Error('UIGF 只支援星鐵與絕區零');
  let blocks;
  if (j?.info?.srgf_version) {
    if (gameId !== 'SRMI') throw new Error('SRGF 是星鐵的紀錄格式');
    blocks = [{ uid: j.info.uid, timezone: j.info.region_time_zone, list: j.list }];
  } else {
    blocks = Array.isArray(j?.[g.key]) ? j[g.key] : [];
  }
  const byType = new Map(g.mod.POOLS.map((p) => [String(g.poolType(p)), p]));
  const out = [];
  for (const b of blocks) {
    const uid = String(b?.uid || '').trim();
    if (!/^\d{4,12}$/.test(uid) || !Array.isArray(b.list)) continue;
    const tz = Number.isFinite(Number(b.timezone)) ? Number(b.timezone) : 8;
    const records = [];
    let skipped = 0;
    for (const x of b.list) {
      const pool = byType.get(String(x?.gacha_type));
      if (!pool || !x.id || !x.time || !x.rank_type) { skipped++; continue; }
      const r = g.mod.norm({ ...x, uid }, pool, '');
      r.name = toTw(x.name || '');
      r.time = Date.parse(String(x.time).replace(' ', 'T') + tzText(tz)) || 0;
      records.push(r);
    }
    out.push({ uid, timezone: tz, records, skipped });
  }
  if (!out.length) throw new Error(`檔案裡沒有${gameId === 'SRMI' ? '星鐵' : '絕區零'}的紀錄`);
  return out;
}

module.exports = { toUIGF, fromUIGF, isUIGF, timezoneOf, GAMES };
