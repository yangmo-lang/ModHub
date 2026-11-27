// Nexus Mods
//  瀏覽 / 搜尋 / 檔案清單：v2 GraphQL（不需登入）
//  下載：v1 download_link，需要使用者自己的 API 金鑰
//    - Premium 會員：可直接取得下載連結
//    - 免費會員：Nexus 規定要從網頁按「Mod Manager Download」，產生 nxm:// 連結（含 key/expires）才能下載
const { fetchJson } = require('../net.cjs');

const GQL = 'https://api.nexusmods.com/v2/graphql';
const V1 = 'https://api.nexusmods.com/v1';
const DOMAINS = { SRMI: 'honkaistarrail', WWMI: 'wutheringwaves', ZZMI: 'zenlesszonezero', EFMI: 'arknightendfield' };
const SORTS = { new: { createdAt: { direction: 'DESC' } }, updated: { updatedAt: { direction: 'DESC' } }, popular: { endorsements: { direction: 'DESC' } } };
const PAGE = 20;

const gameIdCache = {};

async function gql(query, variables) {
  const r = await fetchJson(GQL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (r.errors?.length) throw new Error(`Nexus：${r.errors[0].message}`);
  return r.data;
}

async function gameIdFor(domain) {
  if (!gameIdCache[domain]) {
    const d = await gql('query($d:String!){ game(domainName:$d){ id } }', { d: domain });
    gameIdCache[domain] = String(d.game.id);
  }
  return gameIdCache[domain];
}

function stripBbcode(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '$2 ($1)')
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, '')
    .replace(/\[\/?[a-z*]+(=[^\]]*)?\]/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#92;/g, '\\')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const FIELDS = 'modId name summary version pictureUrl thumbnailUrl adultContent author updatedAt createdAt downloads endorsements modCategory { name }';

function normalize(n, domain) {
  return {
    source: 'nexus',
    id: String(n.modId),
    name: n.name,
    author: n.author || '',
    thumb: n.thumbnailUrl || n.pictureUrl || null,
    url: `https://www.nexusmods.com/${domain}/mods/${n.modId}`,
    updatedAt: Date.parse(n.updatedAt || n.createdAt) || 0,
    likes: n.endorsements || 0,
    downloads: n.downloads || 0,
    adult: Boolean(n.adultContent),
    category: n.modCategory?.name || '',
    version: n.version || '',
    summary: n.summary || '',
  };
}

async function list(gameId, { sort = 'new', page = 1, search = '' } = {}) {
  const domain = DOMAINS[gameId];
  if (!domain) throw new Error('Nexus 沒有這個遊戲');
  const filter = { gameDomainName: [{ value: domain, op: 'EQUALS' }] };
  if (search.trim()) filter.nameStemmed = [{ value: search.trim(), op: 'MATCHES' }];
  const d = await gql(
    `query($f: ModsFilter, $s: [ModsSort!], $o: Int, $c: Int) { mods(filter: $f, sort: $s, offset: $o, count: $c) { totalCount nodes { ${FIELDS} } } }`,
    { f: filter, s: [SORTS[sort] || SORTS.new], o: (page - 1) * PAGE, c: PAGE },
  );
  const items = d.mods.nodes.map((n) => normalize(n, domain));
  return { items, total: d.mods.totalCount, hasMore: page * PAGE < d.mods.totalCount };
}

async function details(gameId, modId) {
  const domain = DOMAINS[gameId];
  const gid = await gameIdFor(domain);
  const d = await gql(
    `query($f: ModsFilter, $m: ID!, $g: ID!) {
      mods(filter: $f) { nodes { ${FIELDS} description } }
      modFiles(modId: $m, gameId: $g) { fileId name version category sizeInBytes date description primary }
    }`,
    { f: { gameId: [{ value: gid, op: 'EQUALS' }], modId: [{ value: String(modId), op: 'EQUALS' }] }, m: String(modId), g: gid },
  );
  const n = d.mods.nodes[0];
  if (!n) throw new Error('找不到這個 Nexus MOD');
  const base = normalize(n, domain);
  const files = (d.modFiles || [])
    .filter((f) => !['ARCHIVED', 'REMOVED', 'DELETED'].includes(f.category))
    .sort((a, b) => (b.primary || 0) - (a.primary || 0) || b.date - a.date)
    .map((f) => ({
      id: String(f.fileId),
      name: f.name,
      size: Number(f.sizeInBytes) || 0,
      date: (f.date || 0) * 1000,
      description: stripBbcode(f.description),
      version: f.version || '',
      category: f.category,
      pageUrl: `https://www.nexusmods.com/${domain}/mods/${modId}?tab=files&file_id=${f.fileId}`,
    }));
  return { ...base, domain, images: [n.pictureUrl].filter(Boolean), description: stripBbcode(n.description || n.summary), files };
}

async function validateKey(apiKey) {
  const r = await fetchJson(`${V1}/users/validate.json`, { headers: { apikey: apiKey } });
  return { name: r.name, premium: Boolean(r.is_premium) };
}

/** 取得實際下載網址；免費會員要帶 nxm 連結裡的 key / expires */
async function downloadLink(domain, modId, fileId, apiKey, nxm) {
  const qs = nxm ? `?key=${encodeURIComponent(nxm.key)}&expires=${encodeURIComponent(nxm.expires)}` : '';
  const r = await fetchJson(`${V1}/games/${domain}/mods/${modId}/files/${fileId}/download_link.json${qs}`, { headers: { apikey: apiKey } });
  if (!Array.isArray(r) || !r[0]?.URI) throw new Error('Nexus 沒有回傳下載連結');
  return r[0].URI;
}

async function fileInfo(domain, modId, fileId, apiKey) {
  return fetchJson(`${V1}/games/${domain}/mods/${modId}/files/${fileId}.json`, { headers: { apikey: apiKey } });
}

/** nxm://<domain>/mods/<modId>/files/<fileId>?key=..&expires=.. */
function parseNxm(link) {
  const m = /^nxm:\/\/([^/]+)\/mods\/(\d+)\/files\/(\d+)\?(.*)$/i.exec(String(link || '').trim());
  if (!m) return null;
  const q = new URLSearchParams(m[4]);
  return { domain: m[1].toLowerCase(), modId: m[2], fileId: m[3], key: q.get('key'), expires: q.get('expires') };
}

function gameIdForDomain(domain) {
  return Object.keys(DOMAINS).find((k) => DOMAINS[k] === domain) || null;
}

module.exports = { DOMAINS, list, details, validateKey, downloadLink, fileInfo, parseNxm, gameIdForDomain, stripBbcode };
