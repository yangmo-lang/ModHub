// Endfield Framework（EFF）：終末地另一套 MOD 載入框架，和 XXMI 分開管理
//
// EFF 裝在遊戲資料夾（Endfield.exe 旁）：
//   d3dcompiler_47.dll、vulkan-1.dll（代理 DLL）
//   plugin/eff.dll、eff.ini、package-protocol.json
//   plugin/mods/<MOD>/mod.ini + meshes/ materials/ textures/ …（*.effres、*.dds）
// EFF 會遞迴讀取 plugin/mods 底下所有 MOD，不認 DISABLED_ 前綴，
// 所以 ModHub 停用 = 把整個 MOD 資料夾移到 plugin/mods_disabled/（同樣的相對路徑），啟用再移回來。
//
// 這裡只依公開文件與檔案結構實作，不含 EFF（AGPL-3.0）的任何程式碼。
const fs = require('node:fs');
const path = require('node:path');
const { findPreviewDeep } = require('./scanner.cjs');

const EFF_ID = 'EFF';
const GAME_EXE = 'Endfield.exe';
const REPO = 'ssice-a/EFF';
const PAGES = {
  github: `https://github.com/${REPO}`,
  releases: `https://github.com/${REPO}/releases`,
  gamebanana: 'https://gamebanana.com/tools/24565',
};
const UNCATEGORIZED = '未分類';

function effPaths(gameDir) {
  const plugin = path.join(gameDir, 'plugin');
  return { plugin, mods: path.join(plugin, 'mods'), disabled: path.join(plugin, 'mods_disabled'), dll: path.join(plugin, 'eff.dll') };
}

/** XXMI Launcher 設定裡終末地的遊戲資料夾 */
function gameDirFromXxmi(xxmiRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(xxmiRoot, 'XXMI Launcher Config.json'), 'utf8'));
    return cfg?.Importers?.EFMI?.Importer?.game_folder || '';
  } catch { return ''; }
}

/** 設定裡指定的資料夾優先，其次用 XXMI 的設定 */
function resolveGameDir(settings) {
  return settings?.effGameDir || gameDirFromXxmi(settings?.xxmiRoot || '');
}

/** 讀 PE 檔版本資源裡的 ProductVersion / FileVersion（UTF-16 字串），讀不到回傳空字串 */
function readDllVersion(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return ''; }
  for (const key of ['ProductVersion', 'FileVersion']) {
    const needle = Buffer.from(`${key}\0`, 'utf16le');
    let i = buf.indexOf(needle);
    while (i >= 0) {
      // 值在鍵名之後，中間可能有 0～2 個 UTF-16 的 \0 對齊
      let j = i + needle.length;
      while (j + 1 < buf.length && buf[j] === 0 && buf[j + 1] === 0) j += 2;
      let s = '';
      for (; j + 1 < buf.length && s.length < 40; j += 2) {
        const ch = buf.readUInt16LE(j);
        if (!ch) break;
        s += String.fromCharCode(ch);
      }
      const m = /^\d+(\.\d+){1,3}/.exec(s.trim());
      if (m) return m[0].replace(/^(\d+\.\d+\.\d+)\.0$/, '$1'); // 2.0.17.0 → 2.0.17
      i = buf.indexOf(needle, i + 2);
    }
  }
  return '';
}

/** EFF 是否已安裝、版本 */
function status(gameDir) {
  if (!gameDir) return { gameDir: '', gameFound: false, installed: false, version: '' };
  const p = effPaths(gameDir);
  const gameFound = fs.existsSync(path.join(gameDir, GAME_EXE));
  const installed = fs.existsSync(p.dll);
  return { gameDir, gameFound, installed, version: installed ? readDllVersion(p.dll) : '', modsDir: p.mods, disabledDir: p.disabled };
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

/** mod.ini 是否為 EFF 格式（有 [Mod] 區段與 format=） */
function isEffIni(text) {
  const m = /^\s*\[Mod\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/im.exec(String(text || ''));
  return Boolean(m && /^\s*format\s*=/im.test(m[1]));
}

function iniValue(text, section, key) {
  const m = new RegExp(`^\\s*\\[${section}\\]\\s*$([\\s\\S]*?)(?=^\\s*\\[|(?![\\s\\S]))`, 'im').exec(String(text || ''));
  if (!m) return '';
  const v = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'im').exec(m[1]);
  return v ? v[1].trim() : '';
}

/**
 * 從 mod.ini 找出替換的角色資源代號（assets/.../actor/<類型>/<代號>/...）
 * 優先看 target.path（真正被替換的模型），沒有再看所有路徑；回傳依出現次數排序的代號
 */
function actorKeys(text) {
  const count = (re) => {
    const n = new Map();
    for (const m of String(text || '').matchAll(re)) n.set(m[1].toLowerCase(), (n.get(m[1].toLowerCase()) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
  const targets = count(/^\s*target\.path\s*=.*?\/actor\/[a-z]+\/([a-z0-9_]+)\//gim);
  return targets.length ? targets : count(/\/actor\/[a-z]+\/([a-z0-9_]+)\//gi);
}

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** 資源代號 → 角色：英文名和代號互為開頭（laevat ↔ Laevatain），至少 4 個字母 */
function characterForKey(key, characters) {
  const k = squash(key);
  if (k.length < 4) return null;
  return (characters || []).find((c) => {
    const en = squash(c.en);
    return en.length >= 4 && (en.startsWith(k) || k.startsWith(en));
  }) || null;
}

/** 在 root 底下找 EFF MOD（直接含 mod.ini 的資料夾，不再往下找） */
function findModDirs(root, depth = 0, out = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  if (depth > 0 && entries.some((e) => e.isFile() && e.name.toLowerCase() === 'mod.ini')) {
    out.push(root);
    return out;
  }
  if (depth >= 4) return out;
  for (const e of entries) if (e.isDirectory()) findModDirs(path.join(root, e.name), depth + 1, out);
  return out;
}

function charInfo(c) {
  return c ? { id: c.id, name: c.name, nameTw: c.nameTw || c.name, en: c.en, avatar: c.avatar || null, meta: c.meta || {} } : null;
}

function makeEffMod(dir, root, enabled, { characters, guessCharacter }) {
  const ini = readText(path.join(dir, 'mod.ini'));
  let mtime = 0;
  try { mtime = fs.statSync(dir).mtimeMs; } catch {}
  let origin = null;
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, '.modhub.json'), 'utf8'));
    origin = { source: o.source, modId: String(o.modId), fileId: o.fileId ? String(o.fileId) : null, version: o.version || '', url: o.url || '', updatedAt: o.updatedAt || 0, installedAt: o.installedAt };
  } catch {}
  const name = path.basename(dir);
  const ch = (guessCharacter && guessCharacter(name))
    || actorKeys(ini).map((k) => characterForKey(k, characters)).find(Boolean)
    || null;
  return {
    id: dir,
    path: dir,
    rel: path.relative(root, dir),
    folderName: name,
    name,
    enabled,
    loader: 'eff',
    effId: iniValue(ini, 'Mod', 'id'),
    effFormat: iniValue(ini, 'Mod', 'format'),
    character: charInfo(ch),
    preview: findPreviewDeep(dir),
    iniCount: 1,
    mtime,
    origin,
  };
}

/**
 * 掃描 EFF 的 MOD（啟用的在 plugin/mods，停用的在 plugin/mods_disabled）
 * 分類依角色（從資料夾名稱或 mod.ini 判斷），格式與 scanner.scanMods 相同，介面可以共用
 */
function scanEff(gameDir, { characters, guessCharacter } = {}) {
  const p = effPaths(gameDir);
  const opts = { characters, guessCharacter };
  const mods = [
    ...findModDirs(p.mods).map((d) => makeEffMod(d, p.mods, true, opts)),
    ...findModDirs(p.disabled).map((d) => makeEffMod(d, p.disabled, false, opts)),
  ];
  const cats = new Map();
  for (const m of mods) {
    const key = m.character ? m.character.name : UNCATEGORIZED;
    m.category = key;
    if (!cats.has(key)) {
      cats.set(key, {
        name: key,
        path: null,
        cover: m.character?.avatar || null,
        hasOwnCover: true, // 不需要補封面
        character: m.character,
        total: 0,
        enabled: 0,
        virtual: !m.character,
        grouped: true, // 依內容分組，不是真的資料夾（介面不顯示「手動對應」）
      });
    }
    const c = cats.get(key);
    c.total += 1;
    if (m.enabled) c.enabled += 1;
  }
  const categories = [...cats.values()].sort((a, b) => (a.virtual ? 1 : 0) - (b.virtual ? 1 : 0) || a.name.localeCompare(b.name, 'zh-Hant'));
  return { categories, mods, missingCharacters: [] };
}

function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 確認路徑在 EFF 的 mods 或 mods_disabled 裡，回傳 { root, other, enabled } */
function locate(gameDir, modPath) {
  const p = effPaths(gameDir);
  if (isInside(p.mods, modPath)) return { root: p.mods, other: p.disabled, enabled: true };
  if (isInside(p.disabled, modPath)) return { root: p.disabled, other: p.mods, enabled: false };
  throw new Error(`路徑不在 EFF 的 MOD 資料夾內：${modPath}`);
}

function moveDir(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

/** 移走後清掉留下的空資料夾（只清 root 底下的） */
function pruneEmptyParents(root, dir) {
  let cur = dir;
  while (isInside(root, cur)) {
    try {
      if (fs.readdirSync(cur).length) return;
      fs.rmdirSync(cur);
    } catch { return; }
    cur = path.dirname(cur);
  }
}

/** 啟用 / 停用：在 mods 與 mods_disabled 之間搬移，保留相對路徑；回傳新路徑 */
function setEnabled(gameDir, modPath, enabled) {
  const loc = locate(gameDir, modPath);
  if (loc.enabled === enabled) return modPath;
  if (!fs.existsSync(modPath)) throw new Error(`找不到這個 MOD：${modPath}`);
  const rel = path.relative(loc.root, modPath);
  const target = path.join(loc.other, rel);
  if (fs.existsSync(target)) throw new Error(`${enabled ? 'mods' : 'mods_disabled'} 裡已有同名資料夾，無法切換：${rel}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  moveDir(modPath, target);
  pruneEmptyParents(loc.root, path.dirname(modPath));
  return target;
}

/** 安裝 MOD 時用：資料夾名稱在啟用與停用區都不能重複 */
function uniqueModTarget(gameDir, name) {
  const p = effPaths(gameDir);
  let n = name;
  for (let i = 2; fs.existsSync(path.join(p.mods, n)) || fs.existsSync(path.join(p.disabled, n)); i++) n = `${name} (${i})`;
  return path.join(p.mods, n);
}

// ---------- 判斷壓縮檔內容 ----------

/**
 * 分析解壓後的檔案清單（相對路徑），判斷是 EFF MOD、EFF 框架本體，還是一般 3DMigoto MOD
 * @param files [{ rel }]
 * @param readIni(rel) → 文字（只會讀 mod.ini）
 */
function classifyFiles(files, readIni) {
  const lower = files.map((f) => f.rel.replace(/\\/g, '/').toLowerCase());
  const framework = lower.some((r) => /(^|\/)plugin\/eff\.dll$/.test(r));
  const effres = lower.filter((r) => r.endsWith('.effres')).length;
  const effInis = files.filter((f, i) => /(^|\/)mod\.ini$/.test(lower[i]) && isEffIni(readIni(f.rel))).map((f) => f.rel);
  return { framework, effMod: !framework && (effInis.length > 0 || effres > 0), effInis, effres };
}

// ---------- EFF 本體安裝 / 更新 ----------

// 壓縮檔裡允許的檔案：根目錄的兩個代理 DLL 與 plugin/ 底下（不含 plugin/mods）
const FRAMEWORK_ROOT_FILES = new Set(['d3dcompiler_47.dll', 'vulkan-1.dll']);

/**
 * 檢查解壓後的 EFF 框架：要有 plugin/eff.dll 與兩個代理 DLL，不能有其他位置的檔案
 * @returns { root, files: [rel] }  root = 含 plugin/ 的那一層
 */
function checkFrameworkTree(stagingDir) {
  // 找含 plugin/eff.dll 的那一層（壓縮檔可能多包一層資料夾）
  const find = (dir, depth) => {
    if (fs.existsSync(path.join(dir, 'plugin', 'eff.dll'))) return dir;
    if (depth >= 3) return null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.toLowerCase() !== 'plugin') {
        const hit = find(path.join(dir, e.name), depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  const root = find(stagingDir, 0);
  if (!root) throw new Error('壓縮檔裡找不到 plugin/eff.dll，不是 EFF 的 DLL 套件');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files.push(path.relative(root, full));
    }
  };
  walk(root);
  const bad = files.filter((rel) => {
    const r = rel.replace(/\\/g, '/');
    if (!r.includes('/')) return !FRAMEWORK_ROOT_FILES.has(r.toLowerCase());
    if (!r.toLowerCase().startsWith('plugin/')) return true;
    return r.toLowerCase().startsWith('plugin/mods/') || /\.(exe|bat|cmd|ps1|vbs|js|msi|scr|com|lnk|reg)$/i.test(r);
  });
  if (bad.length) throw new Error(`EFF 套件含有預期外的檔案，已停止安裝：${bad.slice(0, 5).join('、')}`);
  for (const need of ['d3dcompiler_47.dll', 'vulkan-1.dll']) {
    if (!files.some((f) => f.toLowerCase() === need)) throw new Error(`EFF 套件缺少 ${need}`);
  }
  return { root, files };
}

/**
 * 把框架檔案複製進遊戲資料夾：被覆蓋的舊檔先備份；已存在的 plugin/eff.ini（使用者設定）保留
 * @returns { copied: [rel], kept: [rel], backedUp: [rel], backupDir }
 */
function installFramework({ gameDir, sourceRoot, files, backupDir }) {
  if (!fs.existsSync(path.join(gameDir, GAME_EXE))) throw new Error(`遊戲資料夾裡找不到 ${GAME_EXE}：${gameDir}`);
  const copied = [];
  const kept = [];
  const backedUp = [];
  for (const rel of files) {
    const dest = path.join(gameDir, rel);
    if (!isInside(gameDir, dest)) throw new Error(`路徑不在遊戲資料夾內：${rel}`);
    if (rel.replace(/\\/g, '/').toLowerCase() === 'plugin/eff.ini' && fs.existsSync(dest)) { kept.push(rel); continue; }
    if (fs.existsSync(dest)) {
      const b = path.join(backupDir, rel);
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(dest, b);
      backedUp.push(rel);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, rel), dest);
    copied.push(rel);
  }
  fs.mkdirSync(effPaths(gameDir).mods, { recursive: true });
  return { copied, kept, backedUp, backupDir };
}

/** GitHub 最新版的 DLL 套件 { version, name, url, size, sha256, page } */
function pickRelease(release) {
  const asset = (release?.assets || []).find((a) => /^EFF_v[\d.]+_dll\.zip$/i.test(a.name));
  if (!asset) return null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
  return {
    version: String(release.tag_name || '').replace(/^v/, ''),
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    sha256: digest ? digest[1].toLowerCase() : '',
    page: release.html_url || PAGES.releases,
    publishedAt: release.published_at || '',
  };
}

module.exports = {
  EFF_ID, GAME_EXE, REPO, PAGES, effPaths, gameDirFromXxmi, resolveGameDir, readDllVersion, status,
  isEffIni, iniValue, actorKeys, characterForKey, findModDirs, scanEff, locate, setEnabled, uniqueModTarget,
  classifyFiles, checkFrameworkTree, installFramework, pickRelease,
};
