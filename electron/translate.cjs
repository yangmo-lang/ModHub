// MOD 說明翻譯成繁體中文
//
// - 已經是中文：本機用 opencc 把簡體的行轉繁體，不連網
// - 其他語言：送到 Google 翻譯的公開端點（translate.googleapis.com，client=gtx，免金鑰）
//   只送 MOD 網站上公開的說明文字，不含任何使用者資料
// - 翻譯前把圖鑑裡的角色英文名換成中文名（例如 Firefly → 流螢），避免被直譯
// - 結果快取在記憶體（同一段文字不重複翻譯）
const OpenCC = require('opencc-js');
const { UA } = require('./net.cjs');

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t';
const CHUNK = 1800;
const cache = new Map();

// 說明文字用一般的簡→繁（台灣用字）；不用 characters.cjs 的 toTw（那個為了角色名把「裡」改成「里」）
const s2tw = OpenCC.Converter({ from: 'cn', to: 'tw' });
const tw2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

/**
 * 只轉「看起來是簡體」的行：行內沒有繁體專用字、轉換後會改變。
 * 已是繁體的行原樣保留（避免「台」被改成「臺」之類）。Google 的 zh-TW 輸出偶爾有整句簡體，也靠這個修正。
 */
function toTraditional(text) {
  return String(text).split('\n').map((line) => (tw2s(line) === line && s2tw(line) !== line ? s2tw(line) : line)).join('\n');
}

/** 是否幾乎都是中文（不含日文假名、韓文） */
function isChinese(text) {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return true;
  if (/[぀-ヿ가-힯]/.test(letters)) return false;
  const han = (letters.match(/\p{Script=Han}/gu) || []).length;
  return han / letters.length >= 0.6;
}

/** 依行切段，每段不超過 max 字（單行過長再硬切） */
function chunks(text, max = CHUNK) {
  const out = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const parts = line.length > max ? line.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) : [line];
    for (const p of parts) {
      if (cur && cur.length + 1 + p.length > max) { out.push(cur); cur = p; } else cur = cur ? `${cur}\n${p}` : p;
    }
  }
  if (cur || !out.length) out.push(cur);
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 角色英文名 → 中文名（長的先換，避免 "March 7th" 被 "March" 搶先；前後不能接英數字） */
function applyGlossary(text, glossary) {
  const pairs = (glossary || [])
    .filter((g) => g && g.en && g.zh && g.en.length >= 3 && !/[{}<>]/.test(g.en))
    .sort((a, b) => b.en.length - a.en.length);
  if (!pairs.length) return text;
  const map = new Map(pairs.map((g) => [g.en.toLowerCase(), g.zh]));
  const re = new RegExp(`(?<![A-Za-z0-9_])(${pairs.map((g) => escapeRe(g.en)).join('|')})(?![A-Za-z0-9_])`, 'gi');
  return text.replace(re, (m) => map.get(m.toLowerCase()) || m);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function googleTranslate(text, fetchImpl, retryDelay = 1500) {
  const send = () => fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: text }).toString(),
  });
  let r = await send();
  // 偶爾會回 429：等一下再試一次
  if (r.status === 429) { await delay(retryDelay); r = await send(); }
  if (!r.ok) throw new Error(r.status === 429 ? '翻譯服務暫時限制請求，請稍後再試' : `翻譯失敗 HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j?.[0])) throw new Error('翻譯服務回應格式改變');
  return { text: j[0].map((s) => (Array.isArray(s) ? s[0] || '' : '')).join(''), lang: typeof j[2] === 'string' ? j[2] : '' };
}

/**
 * 翻譯一段純文字
 * @returns {{ text, lang, engine: 'opencc' | 'google' | 'none' }}
 */
async function translate(text, { glossary, fetchImpl = fetch, retryDelay } = {}) {
  const src = String(text || '');
  if (!src.trim()) return { text: src, lang: '', engine: 'none' };
  if (isChinese(src)) return { text: toTraditional(src), lang: 'zh', engine: 'opencc' };
  const prepared = applyGlossary(src, glossary);
  if (cache.has(prepared)) return cache.get(prepared);
  let lang = '';
  const out = [];
  for (const c of chunks(prepared)) {
    if (!c.trim()) { out.push(c); continue; }
    const r = await googleTranslate(c, fetchImpl, retryDelay);
    out.push(r.text);
    lang = lang || r.lang;
  }
  const result = { text: toTraditional(out.join('\n')), lang, engine: 'google' };
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(prepared, result);
  return result;
}

module.exports = { translate, isChinese, chunks, applyGlossary, toTraditional, ENDPOINT };
