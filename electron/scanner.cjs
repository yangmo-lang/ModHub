// MOD 掃描與啟用/停用邏輯（純 Node，可單獨測試）
//
// 目錄慣例（與 QAQ Manager 相容）：
//   Mods/<分類(角色)>/<MOD>/...   分類資料夾可有 _cover.png/.webp/.jpg
//   Mods/<MOD>/...                未分類 MOD
// 3DMigoto 會略過名稱以 "DISABLED" 開頭的資料夾，因此停用 = 加上 DISABLED_ 前綴。

const fs = require('node:fs');
const path = require('node:path');

const DISABLED_RE = /^disabled_?/i;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const PREVIEW_NAMES = ['_cover', 'preview', 'cover', 'thumbnail', 'icon'];

function isDisabledName(name) {
  return DISABLED_RE.test(name);
}

function cleanName(name) {
  return name.replace(DISABLED_RE, '');
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function hasIniDirect(entries) {
  return entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.ini'));
}

function findCover(dir, entries = safeReaddir(dir)) {
  const images = entries.filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()));
  for (const want of PREVIEW_NAMES) {
    const hit = images.find((e) => path.parse(e.name).name.toLowerCase() === want);
    if (hit) return path.join(dir, hit.name);
  }
  return images.length ? path.join(dir, images[0].name) : null;
}

// 在 MOD 資料夾內（含子層）找預覽圖，最多往下 3 層
function findPreviewDeep(dir, depth = 0) {
  const entries = safeReaddir(dir);
  const direct = findCover(dir, entries);
  if (direct || depth >= 3) return direct;
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findPreviewDeep(path.join(dir, e.name), depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function countIni(dir, depth = 0) {
  let n = 0;
  for (const e of safeReaddir(dir)) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.ini')) n++;
    else if (e.isDirectory() && depth < 6) n += countIni(path.join(dir, e.name), depth + 1);
  }
  return n;
}

function makeMod(fullPath, category) {
  const name = path.basename(fullPath);
  let mtime = 0;
  try { mtime = fs.statSync(fullPath).mtimeMs; } catch {}
  let origin = null;
  try {
    const o = JSON.parse(fs.readFileSync(path.join(fullPath, '.modhub.json'), 'utf8'));
    origin = { source: o.source, modId: String(o.modId), fileId: o.fileId ? String(o.fileId) : null, version: o.version || '', url: o.url || '', updatedAt: o.updatedAt || 0, installedAt: o.installedAt };
  } catch {}
  return {
    id: fullPath,
    path: fullPath,
    folderName: name,
    name: cleanName(name),
    enabled: !isDisabledName(name),
    category,
    preview: findPreviewDeep(fullPath),
    iniCount: countIni(fullPath),
    mtime,
    origin,
  };
}

/**
 * 判斷第一層資料夾是「分類」還是「MOD」
 *  - 直接含 .ini → MOD
 *  - 有封面圖 / 在已知角色名單 → 分類
 *  - 其他（例如下載解壓多出來的外層資料夾）→ MOD
 */
function isCategoryFolder(dir, entries, knownCategories, character) {
  const hasCover = entries.some((e) => e.isFile() && path.parse(e.name).name.toLowerCase() === '_cover');
  const hasSubdirs = entries.some((e) => e.isDirectory());
  // 直接含 .ini 通常是 MOD；但「角色名 + _cover + 有子資料夾」是 QAQ 的角色資料夾，
  // 只是裡面多放了零散的 ini（例如版本修正檔）
  if (hasIniDirect(entries) && !(character && hasCover && hasSubdirs)) return false;
  if (character) return true;
  const name = cleanName(path.basename(dir));
  if (knownCategories && knownCategories.has(name.toLowerCase())) return true;
  return hasCover;
}

function charInfo(c) {
  return c ? { id: c.id, name: c.name, nameTw: c.nameTw || c.name, en: c.en, avatar: c.avatar || null, meta: c.meta || {} } : null;
}

/**
 * 掃描一個 Mods 目錄
 * @returns {{categories: Array, mods: Array}}
 */
function scanMods(modsDir, { knownCategories, matchCharacter, guessCharacter, characters } = {}) {
  const categories = [];
  const mods = [];
  const UNCATEGORIZED = '未分類';
  const matchedIds = new Set();

  for (const e of safeReaddir(modsDir)) {
    if (!e.isDirectory()) continue;
    const full = path.join(modsDir, e.name);
    const entries = safeReaddir(full);
    const character = matchCharacter ? matchCharacter(e.name) : null;
    if (isCategoryFolder(full, entries, knownCategories, character)) {
      const catMods = entries
        .filter((c) => c.isDirectory())
        .map((c) => makeMod(path.join(full, c.name), e.name));
      if (character) matchedIds.add(character.id);
      const cover = findCover(full, entries);
      categories.push({
        name: e.name,
        path: full,
        cover: cover || character?.avatar || null,
        hasOwnCover: Boolean(cover),
        character: charInfo(character),
        total: catMods.length,
        enabled: catMods.filter((m) => m.enabled).length,
      });
      mods.push(...catMods);
    } else {
      const mod = makeMod(full, UNCATEGORIZED);
      // 未分類 MOD 名稱若能對應角色，標出建議分類
      const guess = (guessCharacter || matchCharacter)?.(mod.name) || null;
      if (guess) {
        mod.suggestedCategory = guess.name;
        mod.suggestedCharId = guess.id;
      }
      mods.push(mod);
    }
  }

  // 圖鑑裡有、但 Mods 裡還沒有資料夾的角色
  const missingCharacters = (characters || [])
    .filter((c) => !matchedIds.has(c.id))
    .map(charInfo);

  const uncategorized = mods.filter((m) => m.category === UNCATEGORIZED);
  if (uncategorized.length) {
    categories.push({
      name: UNCATEGORIZED,
      path: modsDir,
      cover: null,
      total: uncategorized.length,
      enabled: uncategorized.filter((m) => m.enabled).length,
      virtual: true,
    });
  }
  categories.sort((a, b) => (a.virtual ? 1 : 0) - (b.virtual ? 1 : 0) || a.name.localeCompare(b.name, 'zh-Hant'));
  return { categories, mods, missingCharacters };
}

/** 為角色建立分類資料夾，並放入頭像當 _cover */
function createCategory(modsRoot, name, avatar) {
  const target = path.join(modsRoot, name);
  assertInside(modsRoot, target);
  if (/[<>:"/\\|?*]/.test(name)) throw new Error(`資料夾名稱含非法字元：${name}`);
  fs.mkdirSync(target, { recursive: true });
  if (avatar && fs.existsSync(avatar) && !findCover(target)) {
    fs.copyFileSync(avatar, path.join(target, `_cover${path.extname(avatar)}`));
  }
  return target;
}

/** 把 MOD 移進某個分類資料夾（不存在就建立） */
function moveModToCategory(modsRoot, modPath, categoryName, avatar) {
  assertInside(modsRoot, modPath);
  const wanted = path.resolve(modsRoot, categoryName);
  const rel = path.relative(path.resolve(modPath), wanted);
  if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    // MOD 資料夾和目標分類同名（或分類在 MOD 裡面）：先改成暫時名稱，再建分類、移進去
    if (rel) throw new Error('目標分類位在這個 MOD 裡面，無法移動');
    const temp = path.join(path.dirname(modPath), `.modhub-move-${Date.now()}`);
    fs.renameSync(modPath, temp);
    try {
      const catDir = createCategory(modsRoot, categoryName, avatar);
      const target = path.join(catDir, path.basename(modPath));
      fs.renameSync(temp, target);
      return target;
    } catch (e) {
      if (fs.existsSync(temp) && !fs.existsSync(modPath)) fs.renameSync(temp, modPath); // 失敗就還原
      throw e;
    }
  }
  const catDir = createCategory(modsRoot, categoryName, avatar);
  if (path.resolve(path.dirname(modPath)) === path.resolve(catDir)) return modPath;
  const target = path.join(catDir, path.basename(modPath));
  if (fs.existsSync(target)) throw new Error(`「${categoryName}」裡已有同名資料夾：${path.basename(modPath)}`);
  fs.renameSync(modPath, target);
  return target;
}

/** 把頭像複製成分類的 _cover（只在沒有封面時） */
function writeCover(modsRoot, categoryPath, avatar) {
  assertInside(modsRoot, categoryPath);
  if (findCover(categoryPath)) return false;
  fs.copyFileSync(avatar, path.join(categoryPath, `_cover${path.extname(avatar)}`));
  return true;
}

function assertInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路徑不在 Mods 目錄內：${target}`);
  }
}

/** 啟用或停用一個 MOD（重新命名資料夾），回傳新路徑 */
function setModEnabled(modsRoot, modPath, enabled) {
  assertInside(modsRoot, modPath);
  const dir = path.dirname(modPath);
  const base = path.basename(modPath);
  const currentlyEnabled = !isDisabledName(base);
  if (currentlyEnabled === enabled) return modPath;
  const newBase = enabled ? cleanName(base) : `DISABLED_${base}`;
  const target = path.join(dir, newBase);
  if (fs.existsSync(target)) {
    throw new Error(`已有同名資料夾，無法切換：${newBase}`);
  }
  fs.renameSync(modPath, target);
  return target;
}

/** 同分類只保留指定 MOD 啟用（一角一皮） */
function enableOnly(modsRoot, modPath) {
  const parent = path.dirname(modPath);
  if (path.resolve(parent) === path.resolve(modsRoot)) {
    throw new Error('未分類的 MOD 不支援「只啟用這個」');
  }
  const changed = [];
  for (const e of safeReaddir(parent)) {
    if (!e.isDirectory()) continue;
    const full = path.join(parent, e.name);
    if (full === modPath || isDisabledName(e.name)) continue;
    changed.push(setModEnabled(modsRoot, full, false));
  }
  const newPath = setModEnabled(modsRoot, modPath, true);
  return { newPath, disabled: changed };
}

module.exports = {
  scanMods,
  setModEnabled,
  enableOnly,
  createCategory,
  moveModToCategory,
  writeCover,
  isDisabledName,
  cleanName,
  findCover,
  findPreviewDeep,
  assertInside,
};
