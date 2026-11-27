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

/** 解析頁面原始檔（純文字解析，不執行任何程式碼） */
function parse(src) {
  const text = String(src || '');
  const title = (/<h1[^>]*>([^<]+)<\/h1>/.exec(text)?.[1] || '').trim();
  const arrayOf = (name) => {
    const m = new RegExp(`const\\s+${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`).exec(text);
    return m ? m[1] : '';
  };
  const strings = (block) => [...block.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => unq(m[1] ?? m[2]));
  const videos = strings(arrayOf('tutorialVideoUrls')).filter((u) => /^https:\/\//.test(u));
  const images = [...arrayOf('images').matchAll(/url:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((u) => /^https:\/\//.test(u));

  const entries = (name) => {
    const out = [];
    for (const m of arrayOf(name).matchAll(/\{([^{}]*)\}/g)) {
      const obj = {};
      for (const f of m[1].matchAll(/(\w+)\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) obj[f[1]] = unq(f[2] ?? f[3]);
      if (obj.type === 'section' && obj.title) out.push({ type: 'section', title: obj.title });
      else if (obj.type === 'code' && obj.code && /^[A-Za-z0-9]{6,64}$/.test(obj.code)) out.push({ type: 'code', label: obj.label || '', code: obj.code });
    }
    return out;
  };

  // 伺服器清單：{ key: 'cn', title: '国服蓝图码', entries: cnEntries }
  const regions = [];
  for (const m of text.matchAll(/\{\s*key:\s*['"]([\w-]+)['"]\s*,\s*title:\s*['"]([^'"]+)['"]\s*,\s*entries:\s*(\w+)\s*\}/g)) {
    const list = entries(m[3]);
    if (list.some((e) => e.type === 'code')) regions.push({ key: m[1], title: m[2], entries: list });
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

function register(ipcMain, ctx) {
  const file = () => path.join(ctx.userData(), 'blueprints', 'endfield.json');
  const loadCache = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return null; } };

  ipcMain.handle('blueprint:get', async (_e, force) => {
    const cache = loadCache();
    if (cache && !force && Date.now() - cache.fetchedAt < MAX_AGE) return cache;
    try {
      const r = await fetch(SOURCE_URL, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const parsed = parse(await r.text());
      if (!parsed.regions.length) throw new Error('來源頁面格式改變，讀不到藍圖碼');
      const data = { ...toTraditional(parsed), fetchedAt: Date.now(), source: { page: PAGE_URL, repo: REPO_URL, file: SOURCE_URL, license: LICENSE } };
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(data));
      return data;
    } catch (e) {
      if (cache) return { ...cache, stale: true, error: e.message };
      throw new Error(`讀取藍圖失敗：${e.message}`);
    }
  });
}

module.exports = { register, parse, PAGE_URL, SOURCE_URL, LICENSE };
