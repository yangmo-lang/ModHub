// 共用網路工具：JSON 請求、帶進度的下載
const fs = require('node:fs');
const path = require('node:path');

const UA = 'ModHub/0.1 (+local mod manager)';

async function fetchJson(url, { headers = {}, method = 'GET', body } = {}) {
  const r = await fetch(url, { method, body, headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch {}
    const err = new Error(`HTTP ${r.status}${msg ? `：${msg}` : ''}（${new URL(url).host}）`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/** 下載檔案（先寫 .part，完成後改名），回傳最終路徑 */
async function download(url, dest, { onProgress, signal, headers = {} } = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow', signal });
  if (!r.ok || !r.body) throw new Error(`下載失敗 HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const out = fs.createWriteStream(part);
  let received = 0;
  let last = 0;
  try {
    for await (const chunk of r.body) {
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
      const now = Date.now();
      if (onProgress && now - last > 200) { last = now; onProgress({ received, total }); }
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw e;
  }
  onProgress?.({ received, total: total || received });
  fs.renameSync(part, dest);
  return dest;
}

/** 從 Content-Disposition 或 URL 推檔名，並清掉不合法字元 */
function safeFileName(name, fallback = 'download.bin') {
  const n = String(name || '').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').trim();
  return n && n !== '.' && n !== '..' ? n.slice(0, 180) : fallback;
}

module.exports = { UA, fetchJson, download, safeFileName };
