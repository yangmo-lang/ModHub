// 角色圖鑑：同步角色名單、頭像與屬性，快取在本機
//
// 星鐵 / 鳴潮 / 絕區零 —— nanoka.cc 的靜態資料：
//   https://static.nanoka.cc/manifest.json                  → 各遊戲最新資料版本（含前瞻）
//   https://static.nanoka.cc/<game>/<version>/character.json → 角色清單（zh 為簡體，和 QAQ 資料夾命名一致）
//   https://static.nanoka.cc/assets/<game>/...               → 頭像
// 終末地 —— 森空島 wiki（wiki.skland.com/endfield），由 skland.cjs 讀取頁面資料後交給 buildEndfieldList

const fs = require('node:fs');
const path = require('node:path');
const OpenCC = require('opencc-js');

const BASE = 'https://static.nanoka.cc';
const UA = 'ModHub/0.1 (+local mod manager)';
const toTwText = OpenCC.Converter({ from: 'cn', to: 'tw' });
// 人名 / 物品名：OpenCC 會把「里」轉成「裡」（例如 賽維里安 → 賽維裡安），名稱裡幾乎不會用「裡」，轉回來
const toTw = (s) => toTwText(String(s ?? '')).replace(/裡/g, '里');

// XXMI 代號 → 圖鑑來源
const SOURCES = { SRMI: 'hsr', WWMI: 'ww', ZZMI: 'zzz', EFMI: 'endfield' };
const NANOKA_GAME = { SRMI: 'hsr', WWMI: 'ww', ZZMI: 'zzz' };

// ---- 屬性對照（顯示用，繁體） ----
const META = {
  hsr: {
    roleLabel: '命途',
    element: { Physical: '物理', Fire: '火', Ice: '冰', Thunder: '雷', Wind: '風', Quantum: '量子', Imaginary: '虛數' },
    role: { Warrior: '毀滅', Rogue: '巡獵', Mage: '智識', Shaman: '同諧', Warlock: '虛無', Knight: '存護', Priest: '豐饒', Memory: '記憶', Elation: '歡愉' },
  },
  ww: {
    roleLabel: '武器',
    element: { 1: '冷凝', 2: '熱熔', 3: '導電', 4: '氣動', 5: '衍射', 6: '湮滅' },
    role: { 1: '長刃', 2: '迅刀', 3: '佩槍', 4: '臂鎧', 5: '音感儀' },
  },
  zzz: {
    roleLabel: '特性',
    element: { 200: '物理', 201: '火', 202: '冰', 203: '電', 205: '以太' },
    role: { 1: '強攻', 2: '擊破', 3: '異常', 4: '支援', 5: '防護', 6: '命破' },
  },
  endfield: { roleLabel: '職業' },
};

function stripTags(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '').trim();
}

/** 比對用的名稱正規化：去掉間隔號、連字號、引號、空白，轉小寫，繁體轉簡體比對也通 */
function normalizeName(s) {
  return stripTags(s)
    .toLowerCase()
    .replace(/^disabled_?/i, '')
    .replace(/[\s•·・‧\-_.「」『』"'&＆()（）:：★]/g, '');
}

const toCn = OpenCC.Converter({ from: 'tw', to: 'cn' });
/** 正規化後再轉成簡體，讓繁體資料夾名稱也對得上 */
function matchKey(s) {
  return toCn(normalizeName(s));
}

/** 建資料夾用的名稱：間隔號改成 -（Windows 資料夾比較好打） */
function folderSafeName(s) {
  return stripTags(s)
    .replace(/[「」『』]/g, '')
    .replace(/\s*[•·・‧]\s*/g, '-')
    .replace(/\s*[(（]\s*/g, '-')
    .replace(/\s*[)）]\s*/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();
}

function avatarUrl(game, id, c) {
  if (game === 'hsr') return `${BASE}/assets/hsr/avatarshopicon/${id}.webp`;
  // IconRole01（全身立繪）→ IconRoleSelect01（半身頭像）
  // 不用 IconRoleCircle：部分編號是舊資源（例如洛克茜 68 會變成別的角色）
  if (game === 'zzz') return c.icon ? `${BASE}/assets/zzz/${c.icon.replace(/^IconRole/, 'IconRoleSelect')}.webp` : null;
  if (game === 'ww') {
    // /Game/Aki/UI/UIResources/.../T_X_UI.T_X_UI → assets/ww/UIResources/.../T_X_UI.webp
    const m = /^\/Game\/Aki\/UI\/(.+?)(\.[^/]+)?$/.exec(c.icon || '');
    return m ? `${BASE}/assets/ww/${m[1]}.webp` : null;
  }
  return null;
}

// 主角：依 QAQ 慣例收成「男主 / 女主」
function trailblazerName(game, id, c) {
  if (game === 'hsr' && Number(id) >= 8001 && Number(id) <= 8999) return Number(id) % 2 === 1 ? '男主' : '女主';
  if (game === 'ww' && /漂泊者/.test(c.zh || '')) return /zhujuenan/i.test(c.background || '') ? '男主' : '女主';
  return null;
}

function metaFor(game, id, c) {
  const M = META[game];
  if (game === 'hsr') {
    const rarity = Number(/(\d)$/.exec(c.rank || '')?.[1]) || null;
    const release = c.release ? c.release * 1000 : null;
    return {
      rarity,
      element: M.element[c.damageType] || c.damageType || null,
      role: M.role[c.baseType] || c.baseType || null,
      release,
      order: release || Number(id) * 1e6, // 沒有日期的（前瞻）排最後
      preview: !release || release > Date.now(),
    };
  }
  if (game === 'ww') {
    return { rarity: c.rank || null, element: M.element[c.element] || null, role: M.role[c.weapon] || null, release: null, order: Number(id), preview: false };
  }
  if (game === 'zzz') {
    // rank 3 = A 級、4 = S 級 → 顯示成 4★ / 5★
    return { rarity: c.rank ? c.rank + 1 : null, element: M.element[c.element] || null, role: M.role[c.type] || null, release: null, order: Number(id), preview: false };
  }
  return {};
}

// 與 QAQ 預設資料夾名稱不同的特例
const EXTRA_ALIASES = {
  hsr: {
    1001: { name: '三月七-存护', aliases: ['三月七', 'march7th', 'mar7th'] },
    1224: { name: '三月七-巡猎', aliases: ['march7thhunt'] },
    1507: { name: '刃-千治', aliases: ['千治刃'] },
    1303: { name: '阮梅' },
    1506: { name: '银狼LV.999' },
  },
  ww: {
    1412: { name: '希格莉卡', aliases: ['西格莉卡'] },
    1109: { aliases: ['露琪拉'] },
  },
  zzz: {},
  endfield: {},
};
const TRAILBLAZER_ALIASES = {
  男主: ['开拓者', '穹', 'caelus', 'trailblazer', '漂泊者', 'rover', 'wise', '哲', '管理员男', 'endministratormale', 'maleendministrator'],
  女主: ['星', 'stelle', 'belle', '铃', '管理员女', 'endministratorfemale', 'femaleendministrator'],
};

function finishEntry(entry) {
  entry.nameTw = toTw(entry.name);
  entry.aliases = [...new Set([...entry.aliases, ...entry.aliases.map(toCn), normalizeName(entry.nameTw)])].filter(Boolean);
  return entry;
}

/** 把 nanoka 的 character.json 轉成 ModHub 角色清單 */
function buildCharacterList(game, raw) {
  const out = [];
  const byKey = new Map();
  for (const [id, c] of Object.entries(raw)) {
    const zh = stripTags(c.zh);
    const en = stripTags(c.en);
    const tb = trailblazerName(game, id, c);
    if ((!zh || zh.includes('{')) && !tb) continue; // HSR 主角的名字是 {NICKNAME}
    const extra = (EXTRA_ALIASES[game] || {})[id] || {};
    const name = tb || extra.name || folderSafeName(zh);
    const key = normalizeName(name);
    const aliases = [name, zh, en, c.code, ...(extra.aliases || []), ...(tb ? TRAILBLAZER_ALIASES[tb] : [])]
      .filter(Boolean).map(normalizeName).filter(Boolean);

    if (byKey.has(key)) {
      // 同名不同元素（例如漂泊者各屬性）→ 合併別名，保留第一個頭像
      const prev = byKey.get(key);
      prev.aliases = [...new Set([...prev.aliases, ...aliases])];
      if (prev.meta && metaFor(game, id, c).element !== prev.meta.element) prev.meta.element = '多屬性';
      continue;
    }
    const entry = {
      id: String(id),
      name,
      zh,
      en: en.includes('{') ? '' : en,
      avatarUrl: avatarUrl(game, id, c),
      meta: metaFor(game, id, c),
      aliases,
    };
    byKey.set(key, entry);
    out.push(entry);
  }
  // ZZZ 沒有可操作的主角資料，補上 QAQ 慣用的分類
  if (game === 'zzz') {
    for (const tb of ['男主', '女主']) {
      if (!byKey.has(tb)) {
        out.push({ id: `tb-${tb}`, name: tb, zh: tb, en: '', avatarUrl: null, meta: { order: 0 }, aliases: [tb, ...TRAILBLAZER_ALIASES[tb]].map(normalizeName) });
      }
    }
  }
  return out.map(finishEntry);
}

// 終末地干員英文名（森空島 wiki 只有中文；MOD 網站多用英文命名）
const ENDFIELD_EN = {
  佩丽卡: 'Perlica', 陈千语: 'Chen Qianyu', 余烬: 'Ember', 赛希: 'Xaihi', 秋栗: 'Akekuri', 莱万汀: 'Laevatain',
  伊冯: 'Yvonne', 洁尔佩塔: 'Gilberta', 艾尔黛拉: 'Ardelia', 别礼: 'Last Rite', 黎风: 'Lifeng', 骏卫: 'Pogranichnik',
  阿列什: 'Alesh', 弧光: 'Arclight', 艾维文娜: 'Avywenna', 大潘: 'Da Pan', 昼雪: 'Snowshine', 狼卫: 'Wulfgard',
  安塔尔: 'Antal', 卡契尔: 'Catcher', 埃特拉: 'Estella', 萤石: 'Fluorite', 汤汤: 'Tangtang', 洛茜: 'Rossi',
  庄方宜: 'Zhuang Fangyi', 小刻: 'Kay', 管理员男: 'Endministrator', 管理员女: 'Endministrator',
  // endfield.gg 官方英文名（2026-11-28 依 endfield.gg/operators 的職業 / 陣營與讀音核對；米米诺為前瞻，尚無英文名）
  诀: 'Arcane', 明河: 'Argent Flow', 卡缪: 'Camille', 梨诺: 'Liino', 弭弗: 'Mi Fu', 祀: 'Si', 提弗洛斯: 'Typhoeus', 噗切娜: 'Purrchena',
};

/**
 * 終末地：森空島 wiki 干員目錄 → ModHub 角色清單
 * @param {Array} items     catalog 裡「干员」的 items
 * @param {Array} tagTree   filterTagTree（星級/職業/屬性/武器的代碼對照）
 */
function buildEndfieldList(items, tagTree) {
  const tagName = {};
  const groupOf = {};
  for (const g of tagTree || []) {
    for (const t of g.children || []) {
      tagName[t.id] = t.name;
      groupOf[t.id] = g.name;
    }
  }
  const out = [];
  const n = items.length;
  items.forEach((it, i) => {
    const raw = stripTags(it.name || it.brief?.name);
    if (!raw) return;
    const tags = (it.tagIds || []).map(String);
    const pick = (group) => {
      const id = tags.find((t) => groupOf[t] === group);
      return id ? tagName[id] : null;
    };
    const tb = /管理员\s*[(（]\s*男/.test(raw) ? '男主' : /管理员\s*[(（]\s*女/.test(raw) ? '女主' : null;
    const name = tb || folderSafeName(raw);
    const en = ENDFIELD_EN[normalizeName(raw)] || ENDFIELD_EN[raw] || '';
    out.push({
      id: String(it.itemId),
      name,
      zh: raw,
      en,
      avatarUrl: it.brief?.cover || null,
      meta: {
        rarity: Number(/(\d)/.exec(pick('星级') || '')?.[1]) || null,
        element: pick('属性') ? toTw(pick('属性')) : null,
        role: pick('干员职业') ? toTw(pick('干员职业')) : null,
        weapon: pick('武器') ? toTw(pick('武器')) : null,
        release: null,
        order: n - i, // wiki 依新到舊排列
        preview: it.brief?.dotType === 'label_type_preview',
      },
      aliases: [name, raw, en && !tb ? en : '', ...(tb ? TRAILBLAZER_ALIASES[tb] : [])].map(normalizeName).filter(Boolean),
    });
  });
  return out.map(finishEntry);
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`下載失敗 ${r.status}：${url}`);
  return r.json();
}

async function downloadFile(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`下載失敗 ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest + '.part', buf);
  fs.renameSync(dest + '.part', dest);
}

function cacheDir(userDataDir, gameId) {
  return path.join(userDataDir, 'characters', gameId);
}

function loadCache(userDataDir, gameId) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(cacheDir(userDataDir, gameId), 'characters.json'), 'utf8'));
  } catch {
    return null;
  }
  if (gameId === 'EFMI') applyEndfieldEn(data);
  return data;
}

/**
 * 終末地英文名只在同步時寫進快取；對照表之後補上的名字，讀快取時也套用（不用重新同步）
 */
function applyEndfieldEn(data) {
  for (const c of data?.characters || []) {
    if (c.en || !c.zh || c.name === '男主' || c.name === '女主') continue;
    const en = ENDFIELD_EN[normalizeName(c.zh)] || ENDFIELD_EN[c.zh];
    if (!en) continue;
    c.en = en;
    c.aliases = [...new Set([...(c.aliases || []), normalizeName(en)])];
  }
  return data;
}

async function loadNanoka(gameId) {
  const game = NANOKA_GAME[gameId];
  const manifest = await fetchJson(`${BASE}/manifest.json`);
  const version = manifest?.[game]?.latest;
  if (!version) throw new Error('nanoka manifest 沒有版本資訊');
  const raw = await fetchJson(`${BASE}/${game}/${encodeURIComponent(version)}/character.json`);
  return { source: 'nanoka.cc', version, characters: buildCharacterList(game, raw) };
}

/**
 * 同步一個遊戲的角色清單與頭像
 * @param {object} opts.loadEndfield  async () => ({ items, tagTree })，由主程序用隱藏視窗讀取 wiki
 */
async function syncCharacters(userDataDir, gameId, { onProgress, loadEndfield } = {}) {
  let result;
  if (NANOKA_GAME[gameId]) {
    result = await loadNanoka(gameId);
  } else if (gameId === 'EFMI' && loadEndfield) {
    const { items, tagTree } = await loadEndfield();
    result = { source: 'wiki.skland.com', version: new Date().toISOString().slice(0, 10), characters: buildEndfieldList(items, tagTree) };
  } else {
    throw new Error(`${gameId} 目前沒有圖鑑來源`);
  }
  const list = result.characters;

  const dir = cacheDir(userDataDir, gameId);
  const avatarDir = path.join(dir, 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });

  let done = 0;
  let failed = 0;
  const queue = list.filter((c) => c.avatarUrl);
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      const base = path.basename(new URL(c.avatarUrl).pathname);
      const file = path.join(avatarDir, `${c.id}_${base}`);
      try {
        if (!fs.existsSync(file)) await downloadFile(c.avatarUrl, file);
        c.avatar = file;
      } catch {
        failed++;
      }
      done++;
      onProgress?.({ done, total: list.length });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  const data = {
    gameId,
    source: result.source,
    version: result.version,
    roleLabel: META[SOURCES[gameId]]?.roleLabel || '類型',
    syncedAt: new Date().toISOString(),
    failed,
    characters: list,
  };
  fs.writeFileSync(path.join(dir, 'characters.json'), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

/**
 * 建立「別名 → 角色」索引
 * @param extra  其他來源的別名（例如 QAQ）：[{ alias, displayName, en }]，displayName 要能對到角色
 */
function buildIndex(characters, extra = []) {
  const idx = new Map();
  for (const c of characters || []) {
    for (const a of c.aliases || []) if (!idx.has(a)) idx.set(a, c);
  }
  for (const e of extra) {
    const c = idx.get(normalizeName(e.displayName)) || idx.get(matchKey(e.displayName));
    if (!c) continue;
    for (const a of [e.alias, e.en]) {
      const k = normalizeName(a);
      if (k && !idx.has(k)) idx.set(k, c);
    }
  }
  return idx;
}

function matchCharacter(index, folderName) {
  if (!index) return null;
  return index.get(normalizeName(folderName)) || index.get(matchKey(folderName)) || null;
}

/** 模糊猜測（只用於「建議分類」）：名稱中包含最長的角色別名 */
function guessCharacter(index, folderName) {
  if (!index) return null;
  const exact = matchCharacter(index, folderName);
  if (exact) return exact;
  const n = matchKey(folderName);
  let best = null;
  let bestLen = 0;
  for (const [alias, c] of index) {
    const ascii = /^[a-z0-9]+$/.test(alias);
    if (alias.length < (ascii ? 4 : 2) || alias.length <= bestLen) continue;
    if (n.includes(alias)) { best = c; bestLen = alias.length; }
  }
  return best;
}

module.exports = {
  META,
  SOURCES,
  NANOKA_GAME,
  toTw,
  toTwText,
  normalizeName,
  folderSafeName,
  buildCharacterList,
  buildEndfieldList,
  syncCharacters,
  loadCache,
  buildIndex,
  matchCharacter,
  guessCharacter,
  cacheDir,
};
