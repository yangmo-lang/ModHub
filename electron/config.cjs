// 遊戲定義與使用者設定
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

const GAMES = [
  { id: 'SRMI', name: '崩壞：星穹鐵道', short: '星鐵', qaqId: 'honkai-star-rail', gamebananaId: 18366 },
  { id: 'WWMI', name: '鳴潮', short: '鳴潮', qaqId: 'wuwa', gamebananaId: 20357 },
  { id: 'ZZMI', name: '絕區零', short: '絕區零', qaqId: 'zzz', gamebananaId: 19567 },
  { id: 'EFMI', name: '明日方舟：終末地', short: '終末地', qaqId: 'endfield', gamebananaId: null },
];

const DEFAULT_SETTINGS = {
  xxmiRoot: path.join(APPDATA, 'XXMI Launcher'),
  qaqRoot: path.join(LOCALAPPDATA, 'Programs', 'QAQManagerV4'),
  lastGame: 'SRMI',
};

function settingsFile(userDataDir) {
  return path.join(userDataDir, 'settings.json');
}

function loadSettings(userDataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(userDataDir), 'utf8'));
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(userDataDir, settings) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(settingsFile(userDataDir), JSON.stringify(settings, null, 2), 'utf8');
}

function modsDirFor(settings, gameId) {
  return path.join(settings.xxmiRoot, gameId, 'Mods');
}

/** 若有安裝 QAQ Manager，借用它的角色名單來辨識分類資料夾（唯讀） */
function loadKnownCategories(settings, game) {
  const set = new Set(['npc', 'ui', 'character', 'object', 'weapon', '其他', '大世界', '功能', '光錐', '光锥', '武器']);
  const file = path.join(settings.qaqRoot, 'resources', 'games', game.qaqId, 'character-config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const n of cfg.defaultCharacters || []) set.add(String(n).toLowerCase());
    for (const v of Object.values(cfg.manualMappings || {})) {
      if (v && v.displayName) set.add(String(v.displayName).toLowerCase());
    }
  } catch {}
  return set;
}

/** QAQ 的別名表：[{ alias, displayName, en }]（唯讀，沒裝 QAQ 就回傳空陣列） */
function loadQaqAliases(settings, game) {
  const file = path.join(settings.qaqRoot, 'resources', 'games', game.qaqId, 'character-config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Object.entries(cfg.manualMappings || {})
      .filter(([, v]) => v && v.displayName)
      .map(([alias, v]) => ({ alias, displayName: v.displayName, en: v.canonicalEnName || '' }));
  } catch {
    return [];
  }
}

module.exports = {
  loadQaqAliases, GAMES, DEFAULT_SETTINGS, loadSettings, saveSettings, modsDirFor, loadKnownCategories };
