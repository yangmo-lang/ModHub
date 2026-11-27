// 終末地 AIC 藍圖（來源：終末地一圖流 https://ef.yituliu.cn/aic/blueprint）
//
// 一圖流網站內容採 CC BY-NC 4.0，前端程式碼為 GPL-3.0，所以 ModHub 不內建、不複製他們的資料或程式：
// 執行時才讀取他們公開 repo（Arknights-yituliu/ef-frontend-v1）裡的頁面原始檔，從中解析藍圖碼，
// 快取在使用者自己的 %APPDATA%\modhub\blueprints\，畫面上標示來源、授權與原頁連結。
const fs = require('node:fs');
const path = require('node:path');
const { UA } = require('./net.cjs');
const { toTw } = require('./characters.cjs');

const PAGE_URL = 'https://ef.yituliu.cn/aic/blueprint';
const SOURCE_URL = 'https://raw.githubusercontent.com/Arknights-yituliu/ef-frontend-v1/dev/app/pages/aic/blueprint.vue';
const REPO_URL = 'https://github.com/Arknights-yituliu/ef-frontend-v1';
const LICENSE = { name: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hant' };
const MAX_AGE = 6 * 3600 * 1000;

const unq = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"');
const CODE_RE = /^[A-Za-z0-9]{6,64}$/;
const REGION_TITLES = { cn: '国服蓝图码', asia: '亚服蓝图码', 'eu-us': '欧美服蓝图码' };

/**
 * 從 openIdx（指向 '[' 或 '{'）開始找對應的結尾括號，略過字串、樣板字串與註解。
 * 回傳括號內的文字；找不到就回傳 ''。
 */
function balanced(text, openIdx) {
  const open = text[openIdx];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) return '';
      i++;
    } else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(openIdx + 1, i);
  }
  return '';
}

/** 所有 `const <name>(: 型別)? = [ ... ]` 陣列：{ name: 內容 } */
function constArrays(text) {
  const out = {};
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=;\n]+)?=\s*(?:ref\s*\(\s*)?\[/g)) {
    if (!(m[1] in out)) out[m[1]] = balanced(text, m.index + m[0].length - 1);
  }
  return out;
}

/** 陣列內容裡最外層的 {...} 物件，各自解析成字串欄位 */
function objectsIn(block) {
  const out = [];
  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '"' || ch === "'" || ch === '`') { for (i++; i < block.length && block[i] !== ch; i++) if (block[i] === '\\') i++; continue; }
    if (ch !== '{') continue;
    const body = balanced(block, i);
    const obj = {};
    for (const f of body.matchAll(/(?:^|[,{\s])['"]?(\w+)['"]?\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$]*)`|(\w+))/g)) {
      if (!(f[1] in obj)) obj[f[1]] = f[5] !== undefined ? { ident: f[5] } : unq(f[2] ?? f[3] ?? f[4]);
    }
    out.push(obj);
    i += body.length + 1;
  }
  return out;
}

const str = (v) => (typeof v === 'string' ? v : '');

/** 物件 → 藍圖項目：有合法 code 就是藍圖碼；只有標題就是分段 */
function toEntry(obj) {
  const code = str(obj.code).trim();
  if (code) return CODE_RE.test(code) ? { type: 'code', label: str(obj.label) || str(obj.name) || str(obj.title), code } : null;
  if ((obj.type === undefined || obj.type === 'section') && str(obj.title)) return { type: 'section', title: str(obj.title) };
  return null;
}

function entriesOf(block) {
  const list = objectsIn(block).map(toEntry).filter(Boolean);
  // 去掉後面沒有任何藍圖碼的分段
  return list.filter((e, i) => e.type === 'code' || list.slice(i + 1).find((x) => x.type === 'code' || x.type === 'section')?.type === 'code');
}

/** 解析頁面原始檔（純文字解析，不執行任何程式碼） */
function parse(src) {
  const text = String(src || '');
  const title = (/<h1[^>]*>([^<]+)<\/h1>/.exec(text)?.[1] || '').trim();
  const arrays = constArrays(text);
  const strings = (block) => [...(block || '').matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => unq(m[1] ?? m[2]));
  const videos = strings(arrays.tutorialVideoUrls).filter((u) => /^https:\/\//.test(u));
  const images = objectsIn(arrays.images || '').map((o) => str(o.url)).filter((u) => /^https:\/\//.test(u));

  // 1. 伺服器清單：任何含 { key, title, entries: 變數 } 的物件（欄位順序不拘）
  const regions = [];
  const seen = new Set();
  for (const block of Object.values(arrays)) {
    for (const o of objectsIn(block)) {
      if (!o.entries?.ident || !str(o.key) || seen.has(o.key)) continue;
      const list = entriesOf(arrays[o.entries.ident] || '');
      if (!list.some((e) => e.type === 'code')) continue;
      seen.add(o.key);
      regions.push({ key: o.key, title: str(o.title) || REGION_TITLES[o.key] || o.key, entries: list });
    }
  }
  // 2. 找不到伺服器清單：每個含藍圖碼的陣列各算一區（cnEntries → cn）
  if (!regions.length) {
    for (const [name, block] of Object.entries(arrays)) {
      const list = entriesOf(block);
      if (!list.some((e) => e.type === 'code')) continue;
      const key = name.replace(/Entries$|Codes?$|List$/i, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() || name;
      regions.push({ key, title: REGION_TITLES[key] || name, entries: list });
    }
  }
  // 3. 連陣列都認不出來：整份檔案裡的藍圖碼物件放在同一區
  if (!regions.length) {
    const list = entriesOf(text);
    if (list.some((e) => e.type === 'code')) regions.push({ key: 'all', title: '蓝图码', entries: list });
  }
  return { title, videos, images, regions };
}

/** 標題、分類、名稱轉繁體（藍圖碼保持原樣） */
function toTraditional(d) {
  return {
    ...d,
    title: toTw(d.title),
    regions: d.regions.map((r) => ({
      ...r,
      title: toTw(r.title),
      entries: r.entries.map((e) => (e.type === 'section' ? { ...e, title: toTw(e.title) } : { ...e, label: toTw(e.label) })),
    })),
  };
}

const REPO = 'Arknights-yituliu/ef-frontend-v1';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/`;

/** repo 裡可能放藍圖碼的檔案，依可能性排序（aic 頁面優先） */
function rankCandidates(paths) {
  const score = (p) => (/\/aic\//i.test(p) ? 0 : /pages\//i.test(p) ? 1 : 2) + (/blueprint\.vue$/i.test(p) ? 0 : 0.5);
  return paths
    .filter((p) => /blueprint/i.test(p) && /\.(vue|ts|js|json)$/i.test(p) && !/node_modules|\.d\.ts$|test/i.test(p))
    .sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}

/**
 * 找到能解析出藍圖碼的原始檔：先試上次成功的位置與預設位置；
 * 都失敗（檔案搬走、改名或格式變了）就列出 repo 的檔案樹，依序試可能的檔案。
 * @returns {{ url, parsed, relocated }}
 */
async function locateSource(fetchText, fetchJson, lastUrl) {
  const tried = new Set();
  const errors = [];
  const tryUrl = async (url) => {
    if (tried.has(url)) return null;
    tried.add(url);
    try {
      const parsed = parse(await fetchText(url));
      if (parsed.regions.length) return parsed;
      errors.push(`${url.replace(RAW_BASE, '')}：讀不到藍圖碼`);
    } catch (e) { errors.push(`${url.replace(RAW_BASE, '')}：${e.message}`); }
    return null;
  };
  for (const url of [lastUrl, SOURCE_URL].filter((u) => u && u.startsWith(RAW_BASE))) {
    const parsed = await tryUrl(url);
    if (parsed) return { url, parsed, relocated: url !== SOURCE_URL };
  }
  for (const branch of ['dev', 'main', 'master']) {
    let tree;
    try { tree = await fetchJson(`https://api.github.com/repos/${REPO}/git/trees/${branch}?recursive=1`); } catch { continue; }
    const paths = (tree?.tree || []).filter((x) => x.type === 'blob').map((x) => x.path);
    for (const p of rankCandidates(paths).slice(0, 6)) {
      const url = `${RAW_BASE}${branch}/${p.split('/').map(encodeURIComponent).join('/')}`;
      const parsed = await tryUrl(url);
      if (parsed) return { url, parsed, relocated: true };
    }
    break; // 有拿到檔案樹就不必再試其他分支
  }
  throw new Error(`來源格式或位置改變，讀不到藍圖碼（${errors.slice(0, 3).join('；') || '無法連線到 GitHub'}）`);
}

function register(ipcMain, ctx) {
  const file = () => path.join(ctx.userData(), 'blueprints', 'endfield.json');
  const loadCache = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return null; } };
  const get = async (url) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };

  ipcMain.handle('blueprint:get', async (_e, force) => {
    const cache = loadCache();
    if (cache && !force && Date.now() - cache.fetchedAt < MAX_AGE) return cache;
    try {
      const found = await locateSource((u) => get(u).then((r) => r.text()), (u) => get(u).then((r) => r.json()), cache?.source?.file);
      const data = {
        ...toTraditional(found.parsed),
        fetchedAt: Date.now(),
        source: { page: PAGE_URL, repo: REPO_URL, file: found.url, relocated: found.relocated, license: LICENSE },
      };
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(data));
      return data;
    } catch (e) {
      if (cache) return { ...cache, stale: true, error: e.message };
      throw new Error(`讀取藍圖失敗：${e.message}`);
    }
  });
}

module.exports = { register, parse, locateSource, rankCandidates, PAGE_URL, SOURCE_URL, LICENSE };
