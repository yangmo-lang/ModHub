// 前瞻：卡池時間表與活動排程
//
// - 卡池（星鐵 / 鳴潮 / 絕區零）：bannerhistory.app 的「卡池時間表」頁面（Next.js，資料在頁面內嵌的 flight 資料裡）
//   取最近結束的與尚未結束 / 尚未公布時間的卡池
// - 活動（星鐵）：BWiki 首頁「本期UP&限時活動」（MediaWiki API 取 HTML，讀 eventTimer 的開始 / 結束時間）
//   另外補上 BWiki 列出的光錐活動躍迁（bannerhistory 只有角色）
//
// 只在執行時讀取公開頁面顯示，不把資料存進 repo。來源格式改變時回傳空陣列，不影響圖鑑其他部分。
const { UA } = require('./net.cjs');
const { toTw } = require('./characters.cjs');

const BH_PAGE = { SRMI: 'hsr', WWMI: 'wuwa', ZZMI: 'zzz' };
const BH_BASE = 'https://bannerhistory.app';
const bhUrl = (gameId) => `${BH_BASE}/tw/${BH_PAGE[gameId]}-pickup-history`;
const BWIKI_API = 'https://wiki.biligame.com/sr/api.php?action=parse&page=%E9%A6%96%E9%A1%B5&prop=text&format=json&formatversion=2';
const BWIKI_BASE = 'https://wiki.biligame.com';

const DAY = 86400000;
const RECENT = 14 * DAY; // 已結束的卡池保留兩週

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}（${new URL(url).host}）`);
  return r.text();
}

// ---- bannerhistory ----

/** 從 Next.js 頁面的 self.__next_f.push([1, "..."]) 片段組回 flight 文字 */
function flightText(html) {
  let out = '';
  for (const m of String(html).matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try {
      const a = JSON.parse(m[1]);
      if (typeof a[1] === 'string') out += a[1];
    } catch { /* 不是資料片段 */ }
  }
  return out;
}

/** 從 start 位置的 { 開始，用括號配對取出完整 JSON 物件（略過字串內的括號） */
function sliceObject(text, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < text.length; j++) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, j + 1);
  }
  return null;
}

const absUrl = (u, base) => (!u ? null : /^https?:\/\//.test(u) ? u : u.startsWith('/') ? base + u : null);
const num = (x) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null);
const flag = (x) => x === true; // flight 資料用 "$undefined" 表示沒有值

/**
 * bannerhistory 頁面 → 卡池清單
 * 星鐵是 pickups[].groups[]（每期再分上下半），鳴潮 / 絕區零直接是 pickups[]
 * @returns [{ id, version, phase, kind, start, end, unannounced, projected, characters: [{ id, name, en, icon }] }]
 */
function parseBannerHistory(html) {
  const text = flightText(html);
  const i = text.indexOf('{"data":{"pickups"');
  if (i < 0) return [];
  let data;
  try { data = JSON.parse(sliceObject(text, i)).data; } catch { return []; }
  const out = [];
  for (const p of Array.isArray(data?.pickups) ? data.pickups : []) {
    const groups = Array.isArray(p.groups) ? p.groups : [p];
    for (const g of groups) {
      const chars = (Array.isArray(g.characters) ? g.characters : []).map((c) => ({
        id: String(c.id || ''),
        name: c.twName || toTw(c.zhName || '') || c.enName || '',
        zh: c.zhName || '',
        en: c.enName || '',
        icon: absUrl(c.icon, BH_BASE),
      })).filter((c) => c.name);
      if (!chars.length) continue;
      out.push({
        id: String(g.id || p.id || ''),
        version: String(p.version || g.version || ''),
        phase: num(g.phase ?? p.phase),
        kind: typeof g.kind === 'string' && g.kind !== '$undefined' ? g.kind : (typeof g.collab === 'string' && g.collab !== '$undefined' ? 'collab' : ''),
        start: num(g.startAt),
        end: num(g.endAt),
        unannounced: flag(g.scheduleUnannounced) || (!num(g.startAt) && !num(g.endAt)),
        projected: flag(g.scheduleProjected),
        characters: chars,
      });
    }
  }
  return out;
}

/** 近期與未來：結束不到兩週的、還沒結束的、時間未公布的；依開始時間排序（未公布的排最後） */
function upcomingPools(list, now = Date.now()) {
  return list
    .filter((p) => p.unannounced || (p.end ? p.end > now - RECENT : p.start && p.start > now - RECENT))
    .sort((a, b) => (a.unannounced - b.unannounced) || (a.start || Infinity) - (b.start || Infinity) || (a.phase || 0) - (b.phase || 0));
}

const KIND_LABEL = { main: '角色卡池', warp: '角色卡池', collab: '聯動卡池', giveaway: '贈送', rerun: '復刻卡池', legacy: '復刻卡池' };

// ---- BWiki（星鐵） ----

/** BWiki 的時間是北京時間，例如 "2026/11/11 10:00" */
function parseCst(s) {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(s || '').trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0'] = m;
  return Date.UTC(+y, +mo - 1, +d, +h - 8, +mi);
}

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/<[^>]+>/g, '').trim();

/**
 * BWiki 首頁 HTML → { activities, warps }
 * 每個活動卡片：<b>名稱</b> … <span class="eventTimer" data-start data-end data-info="活动|跃迁">
 */
function parseBwikiHome(html) {
  const h = String(html || '');
  const re = /<span class="eventTimer" data-start="([^"]*)" data-end="([^"]*)" data-info="([^"]*)"/g;
  const activities = [];
  const warps = [];
  const seen = new Set();
  let prev = 0;
  let m;
  while ((m = re.exec(h))) {
    const seg = h.slice(prev, m.index);
    prev = m.index;
    const title = decode([...seg.matchAll(/<b>([\s\S]*?)<\/b>/g)].pop()?.[1]);
    const start = parseCst(m[1]);
    const end = parseCst(m[2]);
    if (!title || (!start && !end)) continue;
    const key = `${m[3]}|${title}|${m[1]}`;
    if (seen.has(key)) continue; // 手機版與電腦版各有一份
    seen.add(key);
    const links = [...seg.matchAll(/<a href="(\/sr\/[^"#]+)(?:#[^"]*)?" title="([^"]+)"/g)].map((x) => ({ href: BWIKI_BASE + x[1], title: decode(x[2]) }));
    const imgs = [...seg.matchAll(/<img alt="([^"]*)" src="([^"]+)"/g)].map((x) => ({ alt: decode(x[1]), src: x[2] }));
    if (m[3] === '跃迁') {
      const items = links
        .filter((l) => l.title !== '跃迁' && l.title !== '商店' && imgs.some((i) => i.alt === l.title))
        .map((l) => ({ name: toTw(l.title), zh: l.title, url: l.href }));
      warps.push({ name: toTw(title), type: /光锥/.test(title) ? '光錐卡池' : '角色卡池', start, end, items: dedupe(items) });
    } else {
      const own = links.find((l) => l.title === title);
      activities.push({ name: toTw(title), type: '限時活動', start, end, url: own?.href || `${BWIKI_BASE}/sr/${encodeURIComponent(title)}` });
    }
  }
  return { activities, warps };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((x) => (seen.has(x.zh) ? false : (seen.add(x.zh), true)));
}

// ---- 合併成前瞻頁面用的格式 ----

/**
 * @param findItem (name, en) => 圖鑑項目（用來換成 nanoka 的頭像、點擊開詳細資料）
 * @returns {{ pools, activities, sources, errors }}
 */
async function getSchedule(gameId, { findItem = () => null, fetchImpl = fetchText, now = Date.now() } = {}) {
  const result = { pools: [], activities: [], sources: [], errors: [] };
  if (!BH_PAGE[gameId]) return result;

  const toItem = (c) => {
    const ref = findItem(c.name, c.en, c.zh);
    return { id: ref?.id || null, kind: ref?.kind || 'character', name: ref?.name || c.name, icon: ref?.icon || c.icon, up: true, url: bhUrl(gameId) };
  };

  try {
    const list = upcomingPools(parseBannerHistory(await fetchImpl(bhUrl(gameId))), now);
    for (const p of list) {
      result.pools.push({
        type: KIND_LABEL[p.kind] || '角色卡池',
        name: `${p.version ? `${p.version} 版本` : ''}${p.phase ? ` 第 ${p.phase} 期` : ''}`.trim() || '卡池',
        start: p.start,
        end: p.end,
        unannounced: p.unannounced,
        projected: p.projected,
        items: p.characters.map(toItem),
        source: 'bannerhistory',
      });
    }
    result.sources.push({ name: 'BannerHistory', url: bhUrl(gameId) });
  } catch (e) {
    result.errors.push(`卡池時間表：${e.message}`);
  }

  if (gameId === 'SRMI') {
    try {
      const j = JSON.parse(await fetchImpl(BWIKI_API));
      const { activities, warps } = parseBwikiHome(j?.parse?.text || '');
      // BWiki 是國服時間，和 bannerhistory（國際服）可能差一小時
      result.activities = activities
        .map((a) => ({ ...a, type: `${a.type} · 國服時間` }))
        .sort((a, b) => (a.end || Infinity) - (b.end || Infinity));
      // 角色卡池以 bannerhistory 為準；bannerhistory 沒有光錐，從 BWiki 補本期的光錐卡池
      for (const w of warps.filter((x) => x.type === '光錐卡池')) {
        result.pools.push({
          ...w,
          type: `${w.type} · 國服時間`,
          items: w.items.map((x) => {
            const ref = findItem(x.name, '', x.zh);
            return { id: ref?.id || null, kind: ref?.kind || 'lightcone', name: ref?.name || x.name, icon: ref?.icon || null, up: true, url: x.url };
          }),
          source: 'bwiki',
        });
      }
      // 同一天開始的：角色卡池排在光錐前面
      const day = (t) => (t ? Math.floor((t + 8 * 3600000) / DAY) : Infinity);
      result.pools.sort((a, b) => (Boolean(a.unannounced) - Boolean(b.unannounced)) || day(a.start) - day(b.start)
        || (a.source === 'bwiki') - (b.source === 'bwiki') || (a.start || Infinity) - (b.start || Infinity));
      result.sources.push({ name: 'BWiki', url: `${BWIKI_BASE}/sr/%E9%A6%96%E9%A1%B5` });
    } catch (e) {
      result.errors.push(`活動排程：${e.message}`);
    }
  }
  return result;
}

module.exports = { getSchedule, parseBannerHistory, upcomingPools, parseBwikiHome, parseCst, flightText, sliceObject, bhUrl };
