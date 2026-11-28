#!/usr/bin/env node
// 發布流程：檢查 → 測試 → 建置 → 掃描個人資料 → 產生發布說明 →（--publish）上傳 GitHub Release → 下載回來驗證
//
//   node scripts/release.cjs --notes changes.md            只建置與檢查，不上傳
//   node scripts/release.cjs --notes changes.md --publish  上傳並驗證
//
// changes.md 只寫「## 變更」底下的條列；下載表與 SHA-256 由腳本加上。
// 版本號取自 package.json（請先 `npm version <ver> --no-git-tag-version`、commit、push）。
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'yangmo-lang/ModHub';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VER = pkg.version;
const OUT = path.join(ROOT, 'release', `v${VER}`);
const FILES = [`ModHub-Setup-${VER}.exe`, `ModHub-Setup-${VER}.exe.blockmap`, 'latest.yml', `ModHub-${VER}-portable.exe`];

function step(msg) { console.log(`\n▶ ${msg}`); }
function die(msg) { console.error(`\n✖ ${msg}`); process.exit(1); }

function run(cmd, cmdArgs, { capture = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (r.error) die(`${cmd} 無法執行：${r.error.message}`);
  if (r.status !== 0 && !allowFail) die(`${path.basename(cmd)} ${cmdArgs.join(' ')} 失敗（${r.status}）${capture ? `\n${r.stderr || r.stdout}` : ''}`);
  return capture ? String(r.stdout || '').trim() : r.status;
}
const git = (...a) => run('git', a, { capture: true });
const node = (...a) => run(process.execPath, a);

function ghExe() {
  if (process.env.GH) return process.env.GH;
  const win = 'C:\\Program Files\\GitHub CLI\\gh.exe';
  return process.platform === 'win32' && fs.existsSync(win) ? win : 'gh';
}

const sha = (file, algo, enc) => crypto.createHash(algo).update(fs.readFileSync(file)).digest(enc);

// ---- 1. 檢查 ----
function preflight() {
  step(`檢查（版本 ${VER}）`);
  const notes = opt('--notes');
  if (!notes || !fs.existsSync(notes)) die('請用 --notes <檔案> 指定這版的變更說明');
  const dirty = git('status', '--porcelain', '--untracked-files=no');
  if (dirty) die(`有尚未 commit 的變更：\n${dirty}`);
  run('git', ['fetch', '-q', 'origin']);
  const head = git('rev-parse', 'HEAD');
  if (head !== git('rev-parse', 'origin/main')) die('HEAD 和 origin/main 不同，請先 push');
  if (flag('--publish') && run(ghExe(), ['release', 'view', `v${VER}`, '--repo', REPO], { capture: true, allowFail: true }) !== '') {
    // gh release view 找不到時回傳非 0、輸出空白
    die(`GitHub 上已經有 v${VER}`);
  }
  return { notes: fs.readFileSync(notes, 'utf8').trim(), head };
}

// ---- 2. 測試與建置 ----
function build() {
  step('測試');
  node('--test', 'test/');
  step('建置前端');
  node(path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build');
  step(`打包到 release/v${VER}`);
  node(path.join('node_modules', 'electron-builder', 'cli.js'), '--win', '--x64', '--publish', 'never', `-c.directories.output=release/v${VER}`);
  for (const f of FILES) if (!fs.existsSync(path.join(OUT, f))) die(`缺少 ${f}`);
  const yml = fs.readFileSync(path.join(OUT, 'latest.yml'), 'utf8');
  if (!yml.includes(`version: ${VER}`)) die('latest.yml 版本不符');
  const want = /^sha512: (.+)$/m.exec(yml)?.[1];
  if (want !== sha(path.join(OUT, FILES[0]), 'sha512', 'base64')) die('latest.yml 的 sha512 和安裝檔不符');
}

// ---- 3. 掃描 app.asar 裡的個人資料（樣式在執行時從這台電腦取得，不寫進 repo） ----
function personalPatterns() {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = new Set();
  try { words.add(os.userInfo().username); } catch { /* 沒有帳號資訊 */ }
  words.add(path.basename(os.homedir()));
  const email = run('git', ['config', 'user.email'], { capture: true, allowFail: true });
  if (email) { words.add(email); words.add(email.split('@')[0]); }
  const pats = [...words].filter((w) => w && w.length >= 3).map((w) => new RegExp(esc(w), 'i'));
  return [...pats, /authkey=[A-Za-z0-9%]{20}/i, /account_token=/i, /cookie_token=/i, /ltoken_v2=/i];
}

function scanAsar() {
  step('掃描 app.asar');
  const asar = require('@electron/asar');
  const A = path.join(OUT, 'win-unpacked', 'resources', 'app.asar');
  const bad = personalPatterns();
  const hits = [];
  for (const raw of asar.listPackage(A)) {
    const f = raw.split('\\').join('/');
    if (/\.(bat|env|log)$/i.test(f) || /(settings|presets)\.json$|\/gacha\/[^/]+\.json$/.test(f)) hits.push(`不該打包的檔案 ${f}`);
    if (!/\.(js|cjs|mjs|json|html|css|md|txt|yml)$/.test(f)) continue;
    let t;
    try { t = asar.extractFile(A, f.slice(1)).toString('utf8'); } catch { continue; }
    for (const r of bad) if (r.test(t)) hits.push(`${f} 符合 ${r.source.length > 40 ? '個人資料樣式' : r}`);
  }
  if (JSON.parse(asar.extractFile(A, 'package.json')).version !== VER) hits.push('app.asar 的 package.json 版本不符');
  if (hits.length) die(`app.asar 檢查沒過：\n${hits.join('\n')}`);
  console.log(`  沒有發現個人資料（${bad.length} 種樣式）`);
}

// ---- 4. 發布說明 ----
function writeNotes(changes) {
  const [setup, , , portable] = FILES;
  const body = `${/^##\s/m.test(changes) ? changes : `## 變更\n\n${changes}`}

## 下載

| 檔案 | 說明 |
|---|---|
| \`${setup}\` | **建議**。安裝版，之後可在程式內自動更新 |
| \`${portable}\` | 免安裝版，不能自動更新 |

- 已安裝 0.1.2 以後的安裝版：ModHub 會自動提示更新，按「下載更新」→「重新啟動並更新」即可。
- 從免安裝版升級：下載安裝版裝一次，資料（\`%APPDATA%\\modhub\`）會沿用。
- 沒有程式碼簽章，SmartScreen 顯示警告時按「其他資訊」→「仍要執行」。

SHA-256
- \`${setup}\`：\`${sha(path.join(OUT, setup), 'sha256', 'hex')}\`
- \`${portable}\`：\`${sha(path.join(OUT, portable), 'sha256', 'hex')}\`
`;
  const file = path.join(OUT, 'release-notes.md');
  fs.writeFileSync(file, body, 'utf8');
  step(`發布說明：${path.relative(ROOT, file)}`);
  return file;
}

// ---- 5. 上傳與驗證 ----
async function publish(notesFile, head) {
  step(`建立 GitHub Release v${VER}`);
  run(ghExe(), ['release', 'create', `v${VER}`, ...FILES.map((f) => path.join(OUT, f)), '--repo', REPO, '--target', head, '--latest', '--title', `ModHub v${VER}`, '--notes-file', notesFile]);

  step('從 releases/latest/download 下載回來驗證');
  const base = `https://github.com/${REPO}/releases/latest/download/`;
  for (const f of FILES) {
    let buf = null;
    for (let i = 0; i < 5 && !buf; i++) {
      const r = await fetch(base + encodeURIComponent(f), { redirect: 'follow' });
      if (r.ok) buf = Buffer.from(await r.arrayBuffer());
      else await new Promise((res) => setTimeout(res, 3000));
    }
    if (!buf) die(`下載不到 ${f}`);
    const local = fs.readFileSync(path.join(OUT, f));
    if (!buf.equals(local)) die(`${f} 下載內容和本機不同`);
    console.log(`  ✔ ${f}（${buf.length} bytes）`);
  }
}

if (require.main !== module) {
  module.exports = { personalPatterns, FILES };
  return;
}

(async () => {
  const { notes, head } = preflight();
  build();
  scanAsar();
  const notesFile = writeNotes(notes);
  if (flag('--publish')) await publish(notesFile, head);
  else console.log('\n沒有加 --publish：只建置與檢查，未上傳。');
  console.log('\n完成');
})().catch((e) => die(e.stack || e.message));
