// 圖鑑與前瞻：把 nanoka.cc（星鐵/鳴潮/絕區零）和森空島 wiki（終末地）整理成同一種格式
//
// 回傳 { gameId, source, versions, fetchedAt, sections: [{ kind, label, items }], preview: {...} }
// item: { id, kind, name, zh, en, rarity, rarityLabel, element, role, icon, portrait, desc, release, preview, url, skins? }
//
// 前瞻判斷：
//   nanoka —— 「最新資料版本（測試服）」有、「正式服版本」沒有的項目；星鐵角色另外看實裝日期
//   森空島 —— wiki 標記為「前瞻」的項目，加上目前的 UP 卡池、活動、情報資訊
const fs = require('node:fs');
const path = require('node:path');
const { fetchJson } = require('./net.cjs');
const { META, toTw, toTwText } = require('./characters.cjs');
const schedule = require('./schedule.cjs');

const BASE = 'https://static.nanoka.cc';
const NANOKA_GAME = { SRMI: 'hsr', WWMI: 'ww', ZZMI: 'zzz' };
const TTL = 6 * 60 * 60 * 1000;

// ---- 文字清理 ----
function cleanText(s) {
  return String(s ?? '')
    .replace(/\{RUBY_B#[^}]*\}/g, '')
    .replace(/\{RUBY_E#\}/g, '')
    .replace(/\{NICKNAME\}/g, '開拓者')
    .replace(/\{TEXTJOIN#\d+\}/g, '')
    .replace(/\\n/g, '\n')
    .replace(/<te href=\d+>(.*?)<\/te>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const tw = (s) => toTwText(cleanText(s)); // 說明文字
const twName = (s) => toTw(cleanText(s)); // 名稱（避免 里→裡）

function wwAsset(p) {
  const m = /^\/Game\/Aki\/UI\/(.+?)(\.[^/]+)?$/.exec(p || '');
  return m ? `${BASE}/assets/ww/${m[1]}.webp` : null;
}

const ZZZ_RANK = { 2: 'B', 3: 'A', 4: 'S' };
// 絕區零的 icon 有時是完整路徑（UI/Sprite/.../BangbooGarageRole49.png），只取檔名
const zzzIcon = (icon) => (icon ? `${BASE}/assets/zzz/${path.basename(String(icon), path.extname(String(icon)))}.webp` : null);

// ---- nanoka 各類資料的轉換 ----
const NANOKA_KINDS = {
  hsr: [
    {
      kind: 'character', label: '角色', file: 'character',
      map: (id, c) => {
        const tb = Number(id) >= 8001;
        const role = META.hsr.role[c.baseType] || c.baseType;
        const release = c.release ? c.release * 1000 : null;
        return {
          name: tb ? `開拓者・${role}（${Number(id) % 2 ? '穹' : '星'}）` : tw(c.zh),
          en: tb ? `Trailblazer (${role})` : cleanText(c.en),
          rarity: Number(/(\d)$/.exec(c.rank || '')?.[1]) || null,
          element: META.hsr.element[c.damageType] || c.damageType,
          role,
          icon: `${BASE}/assets/hsr/avatarshopicon/${id}.webp`,
          portrait: `${BASE}/assets/hsr/avatardrawcard/${id}.webp`,
          descEn: cleanText(c.desc),
          release,
          previewByDate: !release || release > Date.now(),
          url: `https://hsr.nanoka.cc/character/${id}`,
        };
      },
    },
    {
      kind: 'lightcone', label: '光錐', file: 'lightcone',
      map: (id, c) => ({
        name: twName(c.zh), en: cleanText(c.en),
        rarity: Number(/(\d)$/.exec(c.rank || '')?.[1]) || null,
        role: META.hsr.role[c.baseType] || c.baseType,
        icon: `${BASE}/assets/hsr/lightconemediumicon/${id}.webp`,
        portrait: `${BASE}/assets/hsr/lightconemediumicon/${id}.webp`,
        descEn: cleanText(c.desc),
        url: `https://hsr.nanoka.cc/lightcone/${id}`,
      }),
    },
  ],
  ww: [
    {
      kind: 'character', label: '角色', file: 'character',
      map: (id, c) => {
        const rover = /漂泊者/.test(c.zh || '');
        return {
          name: twName(c.zh) + (rover ? (/zhujuenan/i.test(c.background || '') ? '（男）' : '（女）') : ''),
          en: cleanText(c.en),
          rarity: c.rank || null,
          element: META.ww.element[c.element] || null,
          role: META.ww.role[c.weapon] || null,
          icon: wwAsset(c.icon),
          portrait: wwAsset(c.background) || wwAsset(c.icon),
          descEn: cleanText(c.desc),
          url: `https://ww.nanoka.cc/character/${id}`,
        };
      },
    },
    {
      kind: 'weapon', label: '武器', file: 'weapon',
      map: (id, c) => ({
        name: twName(c.zh), en: cleanText(c.en),
        rarity: c.rank || null,
        role: META.ww.role[c.type] || null,
        icon: wwAsset(c.icon), portrait: wwAsset(c.icon),
        descEn: cleanText(c.desc),
        url: `https://ww.nanoka.cc/weapon/${id}`,
      }),
    },
  ],
  zzz: [
    {
      kind: 'character', label: '代理人', file: 'character',
      map: (id, c) => ({
        name: twName(c.zh), en: cleanText(c.en),
        rarity: c.rank ? c.rank + 1 : null,
        rarityLabel: ZZZ_RANK[c.rank] || null,
        element: META.zzz.element[c.element] || null,
        role: META.zzz.role[c.type] || null,
        icon: c.icon ? `${BASE}/assets/zzz/${c.icon.replace(/^IconRole/, 'IconRoleSelect')}.webp` : null,
        portrait: c.icon ? `${BASE}/assets/zzz/${c.icon}.webp` : null,
        descEn: cleanText(c.desc),
        skins: Object.entries(c.skin || {}).map(([sid, s]) => ({
          id: sid, name: cleanText(s.name), desc: cleanText(s.desc),
          image: s.image ? `${BASE}/assets/zzz/${s.image}.webp` : null,
        })),
        url: `https://zzz.nanoka.cc/character/${id}`,
      }),
    },
    {
      kind: 'weapon', label: '音擎', file: 'weapon',
      map: (id, c) => ({
        name: twName(c.zh), en: cleanText(c.en),
        rarity: c.rank ? c.rank + 1 : null,
        rarityLabel: ZZZ_RANK[c.rank] || null,
        role: META.zzz.role[c.type] || null,
        icon: zzzIcon(c.icon),
        portrait: zzzIcon(c.icon),
        descEn: cleanText(c.desc),
        url: `https://zzz.nanoka.cc/weapon/${id}`,
      }),
    },
    {
      kind: 'bangboo', label: '邦布', file: 'bangboo',
      map: (id, c) => ({
        name: twName(c.zh), en: cleanText(c.en),
        rarity: c.rank ? c.rank + 1 : null,
        rarityLabel: ZZZ_RANK[c.rank] || null,
        icon: zzzIcon(c.icon),
        portrait: zzzIcon(c.icon),
        descEn: cleanText(c.desc),
        url: `https://zzz.nanoka.cc/bangboo/${id}`,
      }),
    },
  ],
};

function versionKey(v) {
  return String(v).split('+')[0].split('.').map(Number);
}
function versionNewer(a, b) {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

async function nanokaCodex(gameId) {
  const game = NANOKA_GAME[gameId];
  const manifest = await fetchJson(`${BASE}/manifest.json`);
  const m = manifest[game];
  if (!m) throw new Error('nanoka 沒有這個遊戲');
  const latest = m.latest;
  const live = m.live;
  const hasBeta = live && latest !== live && versionNewer(latest, live);
  const file = (ver, f) => fetchJson(`${BASE}/${game}/${encodeURIComponent(ver)}/${f}.json`);

  const sections = [];
  const previewGroups = [];
  for (const def of NANOKA_KINDS[game]) {
    const raw = await file(latest, def.file);
    let liveIds = null;
    if (hasBeta) {
      try { liveIds = new Set(Object.keys(await file(live, def.file))); } catch { liveIds = null; }
    }
    const items = [];
    for (const [id, c] of Object.entries(raw)) {
      if (!c || (!c.zh && !c.en)) continue;
      const base = def.map(id, c);
      if (!base.name || base.name.includes('{')) continue;
      const preview = Boolean((liveIds && !liveIds.has(id)) || (def.kind === 'character' && game === 'hsr' && base.previewByDate));
      delete base.previewByDate;
      items.push({ id: String(id), kind: def.kind, zh: cleanText(c.zh), ...base, preview, order: Number(id) || 0 });
    }
    // 清單裡沒有圖示的（多半是新加入的邦布），從詳細資料補
    const noIcon = items.filter((x) => !x.icon).slice(0, 12);
    await Promise.all(noIcon.map(async (x) => {
      try {
        const d = await fetchJson(`${BASE}/${game}/${encodeURIComponent(latest)}/zh/${def.file}/${x.id}.json`);
        if (d.icon) x.icon = x.portrait = game === 'zzz' ? zzzIcon(d.icon) : wwAsset(d.icon);
      } catch {}
    }));
    items.sort((a, b) => (b.release || 0) - (a.release || 0) || b.order - a.order);
    sections.push({ kind: def.kind, label: def.label, items });
    const pv = items.filter((x) => x.preview);
    if (pv.length) previewGroups.push({ kind: def.kind, label: `前瞻${def.label}`, items: pv });
  }

  return {
    gameId,
    source: 'nanoka.cc',
    siteUrl: `https://${game}.nanoka.cc/`,
    versions: { live, latest, hasBeta },
    fetchedAt: Date.now(),
    sections,
    preview: {
      note: hasBeta
        ? `正式服 ${live} · 前瞻資料 ${latest}：以下是測試資料裡才有、正式服還沒有的內容（未上線，內容可能變動）。`
        : `目前 nanoka 的最新資料就是正式服 ${live}，沒有額外的前瞻內容。`,
      groups: previewGroups,
      pools: [],
      activities: [],
      news: [],
    },
  };
}

/**
 * 點開項目時才抓的中文詳細資料（nanoka 的 /<game>/<ver>/zh/<kind>/<id>.json）
 * 回傳 { desc, facts: [[標題, 內容]], effect?: { name, desc } }
 */
async function nanokaDetail(gameId, kind, id, version) {
  const game = NANOKA_GAME[gameId];
  const d = await fetchJson(`${BASE}/${game}/${encodeURIComponent(version)}/zh/${kind}/${encodeURIComponent(id)}.json`);
  const facts = [];
  const add = (k, v) => { if (v) facts.push([k, tw(v)]); };
  let desc = '';
  let effect = null;
  // 效果說明裡的 #1[i]% 等參數換成「?」，避免顯示一堆代碼
  const fx = (s) => tw(String(s || '').replace(/#\d+\[[a-z0-9]+\]%?/gi, '?'));
  if (game === 'hsr') {
    desc = tw(d.desc);
    if (kind === 'lightcone' && d.refinements) effect = { name: twName(d.refinements.name), desc: fx(d.refinements.desc) };
  } else if (game === 'ww') {
    desc = tw(d.desc);
    add('稱號', d.nick_name);
    if (d.tag) add('定位', Object.values(d.tag).map((t) => t.name).join('、'));
    if (kind === 'weapon' && d.effect) effect = { name: twName(d.effect_name), desc: fx(d.effect) };
  } else if (game === 'zzz') {
    if (kind === 'character') {
      const p = d.partner_info || {};
      add('全名', p.full_name);
      add('生日', p.birthday);
      add('身高', p.stature ? `${p.stature} cm` : '');
      add('陣營', d.camp && Object.values(d.camp)[0]);
      add('屬性', d.element_type && Object.values(d.element_type)[0]);
      desc = tw(p.profile_desc || '');
      if (p.impressions) desc += `\n\n${tw(p.impressions)}`;
    } else if (kind === 'weapon') {
      desc = tw(d.desc && d.desc !== '...' ? d.desc : '');
      if (d.desc2) effect = { name: '效果', desc: fx(d.desc2) };
    } else {
      desc = tw(d.desc);
    }
  }
  return { desc: desc.trim(), facts, effect };
}

// ---- 森空島（終末地） ----
function tagHelpers(tree) {
  const name = {};
  const group = {};
  for (const g of tree || []) for (const t of g.children || []) { name[t.id] = t.name; group[t.id] = g.name; }
  return (tags) => {
    const out = { rarity: null, element: null, role: null, tags: [] };
    for (const t of tags || []) {
      const n = name[t];
      if (!n) continue;
      const g = group[t] || '';
      if (/星/.test(g)) out.rarity = Number(/(\d)/.exec(n)?.[1]) || null;
      else if (/属性/.test(g)) out.element = toTw(n);
      else if (/职业|类型/.test(g) && !out.role) out.role = toTw(n);
      else out.tags.push(toTw(n));
    }
    return out;
  };
}

const ENTRY_ID = (link) => /gameEntryId=(\d+)/.exec(link || '')?.[1] || null;

function sklandCodex(w, DETAIL) {
  const want = [['干员', 'character', '干員'], ['武器', 'weapon', '武器'], ['装扮', 'outfit', '裝扮']];
  const byId = new Map();
  const sections = [];
  for (const [sub, kind, label] of want) {
    const cat = w.catalogs.find((c) => c.sub === sub);
    if (!cat) continue;
    const tagsOf = tagHelpers(w.tagTrees[`${cat.mainId}:${cat.subId}`]);
    const n = cat.items.length;
    const items = cat.items.map((it, i) => {
      const t = tagsOf(it.tagIds);
      const item = {
        id: String(it.id), kind, name: toTw(it.name), zh: it.name, en: '',
        rarity: t.rarity, element: t.element, role: t.role, extraTags: t.tags,
        icon: it.cover, portrait: it.cover,
        desc: toTwText(it.caption || ''),
        preview: it.dotType === 'label_type_preview',
        up: it.dotType === 'label_type_up',
        order: n - i,
        url: DETAIL(cat.mainId, cat.subId, it.id),
      };
      byId.set(item.id, item);
      return item;
    });
    sections.push({ kind, label, items });
  }

  const groups = sections
    .map((s) => ({ kind: s.kind, label: `前瞻${s.label}`, items: s.items.filter((x) => x.preview) }))
    .filter((g) => g.items.length);

  const ts = (x) => (Number(x) || 0) * 1000;
  const poolItems = (arr) => (arr || []).map((p) => {
    const id = ENTRY_ID(p.pcLink);
    const ref = id && byId.get(id);
    return { id, name: ref?.name || toTw(p.name || ''), icon: p.pic || ref?.icon || null, rarity: Number(/(\d)/.exec(p.rarity || '')?.[1]) || ref?.rarity || null, up: p.dotType === 'label_type_up', url: p.pcLink };
  });
  const pools = [
    ...(w.charPools || []).map((p) => ({ type: '角色卡池', name: toTw(p.name), start: ts(p.poolStartAtTs || p.startAtTs), end: ts(p.poolEndAtTs || p.endAtTs), items: poolItems(p.chars) })),
    ...(w.weaponPools || []).map((p) => ({ type: '武器卡池', name: toTw(p.name), start: ts(p.poolStartAtTs || p.startAtTs), end: ts(p.poolEndAtTs || p.endAtTs), items: poolItems(p.weapons) })),
  ];
  const activities = (w.activities || []).map((a) => ({
    name: toTw(a.name), type: toTw(a.description || ''), pic: a.pic, url: a.pcLink,
    start: ts(a.activityStartAtTs || a.startAtTs), end: ts(a.activityEndAtTs || a.endAtTs),
  }));
  const newsCat = w.catalogs.find((c) => c.sub === '情报资讯');
  const news = newsCat ? newsCat.items.map((it) => ({ name: toTw(it.name), pic: it.cover, date: it.publishedAt, url: DETAIL(newsCat.mainId, newsCat.subId, it.id) })) : [];

  return {
    gameId: 'EFMI',
    source: 'wiki.skland.com',
    siteUrl: 'https://wiki.skland.com/endfield',
    versions: null,
    fetchedAt: Date.now(),
    sections,
    preview: {
      note: '森空島 wiki 標記為「前瞻」的內容，以及目前的 UP 卡池、活動與官方情報。',
      groups,
      pools,
      activities,
      news,
    },
  };
}

// ---- 卡池時間表 / 活動排程（失敗不影響圖鑑） ----
const normName = (s) => String(s || '').toLowerCase().replace(/[\s•·・\-_:：「」]/g, '');

/** 依名稱找圖鑑項目：繁中名、簡中名、英文名 */
function itemFinder(sections) {
  const map = new Map();
  for (const sec of sections) {
    for (const it of sec.items) {
      for (const k of [it.name, it.zh, it.en]) {
        const n = normName(k);
        if (n && !map.has(n)) map.set(n, it);
      }
    }
  }
  return (...names) => {
    const keys = names.map(normName).filter(Boolean);
    for (const n of keys) {
      const hit = map.get(n);
      if (hit) return hit;
    }
    // 稱號前綴（例如「星神★阿哈」對「阿哈」）：圖鑑名稱以它結尾、且只有一個符合時才算
    for (const n of keys) {
      if (n.length < 2) continue;
      const hits = new Set([...map].filter(([k]) => k.endsWith(n) && /[★☆]/.test(k)).map(([, v]) => v));
      if (hits.size === 1) return [...hits][0];
    }
    return null;
  };
}

async function addSchedule(data, gameId, fetchSchedule = schedule.getSchedule) {
  try {
    const s = await fetchSchedule(gameId, { findItem: itemFinder(data.sections) });
    data.preview.pools = s.pools;
    data.preview.activities = s.activities;
    data.preview.scheduleSources = s.sources;
    data.preview.scheduleErrors = s.errors;
  } catch (e) {
    data.preview.scheduleErrors = [e.message];
  }
}

// ---- 快取 ----
function cacheFile(userDataDir, gameId) {
  return path.join(userDataDir, 'codex', `${gameId}.json`);
}

async function getCodex(userDataDir, gameId, opts = {}) {
  const { force = false, loadWiki, DETAIL } = opts;
  const file = cacheFile(userDataDir, gameId);
  if (!force) {
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.now() - c.fetchedAt < TTL) return { ...c, cached: true };
    } catch {}
  }
  let data;
  if (NANOKA_GAME[gameId]) {
    data = await nanokaCodex(gameId);
    await addSchedule(data, gameId, opts.fetchSchedule);
  }
  else if (gameId === 'EFMI') data = sklandCodex(await loadWiki(), DETAIL);
  else throw new Error('這個遊戲沒有圖鑑來源');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
  return data;
}

module.exports = { getCodex, nanokaCodex, nanokaDetail, sklandCodex, cleanText, versionNewer, itemFinder, addSchedule };
