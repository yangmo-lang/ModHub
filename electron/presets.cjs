// 預設組合：記下「哪些 MOD 是啟用的」，之後一鍵切回（純 Node，可單獨測試）
//
// MOD 以「相對 Mods 的路徑、去掉 DISABLED_ 前綴」當作識別，例如 `流萤/SkinA`、`LooseMod`，
// 所以 MOD 被停用 / 啟用改名後仍認得出來。套用 = 組合裡的 MOD 啟用，其他 MOD 停用（只改資料夾名稱，可還原）。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scanMods, setModEnabled, cleanName } = require('./scanner.cjs');

const BACKUP_ID = 'before-apply';
const BACKUP_NAME = '套用前的狀態';

/** MOD 的識別鍵：相對路徑（/ 分隔），最後一層去掉 DISABLED_ */
function modKey(modsRoot, modPath) {
  const rel = path.relative(path.resolve(modsRoot), path.resolve(modPath)).split(path.sep);
  rel[rel.length - 1] = cleanName(rel[rel.length - 1]);
  return rel.join('/');
}

// scanOpts 要和介面掃描用的一樣（已知分類、角色比對），否則分類資料夾可能被當成 MOD 整個停用
function currentMods(modsRoot, scanOpts) {
  return scanMods(modsRoot, scanOpts).mods.map((m) => ({ key: modKey(modsRoot, m.path), path: m.path, name: m.name, category: m.category, enabled: m.enabled }));
}

/** 把目前的啟用狀態做成組合內容 */
function snapshot(modsRoot, scanOpts) {
  return currentMods(modsRoot, scanOpts).filter((m) => m.enabled).map((m) => m.key).sort();
}

/** 計算套用組合會改動什麼（不動檔案） */
function planApply(modsRoot, enabledKeys, scanOpts) {
  const want = new Set(enabledKeys);
  const mods = currentMods(modsRoot, scanOpts);
  const present = new Set(mods.map((m) => m.key));
  const toEnable = mods.filter((m) => !m.enabled && want.has(m.key));
  const toDisable = mods.filter((m) => m.enabled && !want.has(m.key));
  const missing = [...want].filter((k) => !present.has(k)).sort();
  return { toEnable, toDisable, missing, unchanged: mods.length - toEnable.length - toDisable.length };
}

/** 套用：逐一改名，遇到同名衝突等錯誤就記下來繼續 */
function applyPlan(modsRoot, plan) {
  const errors = [];
  let enabled = 0;
  let disabled = 0;
  // 先停用再啟用，避免同時有多個同角色 MOD 啟用的中間狀態
  for (const m of plan.toDisable) {
    try { setModEnabled(modsRoot, m.path, false); disabled++; } catch (e) { errors.push(`${m.key}：${e.message}`); }
  }
  for (const m of plan.toEnable) {
    try { setModEnabled(modsRoot, m.path, true); enabled++; } catch (e) { errors.push(`${m.key}：${e.message}`); }
  }
  return { enabled, disabled, missing: plan.missing, errors };
}

// ---------- 儲存 ----------
// 檔案：<userData>/presets.json → { [gameId]: [{ id, name, enabled: [key], createdAt, updatedAt, auto? }] }

function createStore(file) {
  const readAll = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
  };
  const writeAll = (all) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 1), 'utf8');
    fs.renameSync(tmp, file);
  };
  const list = (gameId) => (readAll()[gameId] || []).filter((p) => p && p.id && Array.isArray(p.enabled));
  const save = (gameId, items) => { const all = readAll(); all[gameId] = items; writeAll(all); };
  const cleanTitle = (name) => {
    const n = String(name || '').trim().slice(0, 60);
    if (!n) throw new Error('請輸入組合名稱');
    return n;
  };

  return {
    list,
    create(gameId, name, enabled) {
      const items = list(gameId);
      const title = cleanTitle(name);
      if (items.some((p) => !p.auto && p.name === title)) throw new Error(`已有同名組合：${title}`);
      const now = Date.now();
      const p = { id: crypto.randomUUID(), name: title, enabled: [...enabled], createdAt: now, updatedAt: now };
      save(gameId, [...items, p]);
      return p;
    },
    update(gameId, id, patch) {
      const items = list(gameId);
      const i = items.findIndex((p) => p.id === id);
      if (i < 0) throw new Error('找不到這個組合');
      const next = { ...items[i], updatedAt: Date.now() };
      if (patch.name !== undefined) {
        next.name = cleanTitle(patch.name);
        if (items.some((p, j) => j !== i && !p.auto && p.name === next.name)) throw new Error(`已有同名組合：${next.name}`);
      }
      if (patch.enabled) next.enabled = [...patch.enabled];
      items[i] = next;
      save(gameId, items);
      return next;
    },
    remove(gameId, id) {
      save(gameId, list(gameId).filter((p) => p.id !== id));
      return true;
    },
    get(gameId, id) {
      return list(gameId).find((p) => p.id === id) || null;
    },
    /** 套用前自動備份（每個遊戲只留一份，會被下一次覆蓋） */
    backup(gameId, enabled) {
      const now = Date.now();
      const items = list(gameId).filter((p) => p.id !== BACKUP_ID);
      const p = { id: BACKUP_ID, name: BACKUP_NAME, enabled: [...enabled], createdAt: now, updatedAt: now, auto: true };
      save(gameId, [...items, p]);
      return p;
    },
  };
}

module.exports = { modKey, snapshot, planApply, applyPlan, createStore, BACKUP_ID };
