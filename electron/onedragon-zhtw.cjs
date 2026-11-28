// 絕區零一條龍：讓 OneDragon 支援繁體中文遊戲畫面
//
// OneDragon 只支援遊戲文字為简体中文 / English，因為它用 OCR 比對簡體字（例如「训练」）。
// ModHub 安裝一個自己寫的小外掛到 <OneDragon>\plugins\modhub_zh_tw\：OneDragon 載入外掛時，
// 把 OCR 模型輸出的文字先繁轉簡（對照表 t2s.json 在安裝時用 opencc-js 產生，OpenCC 字典為 Apache-2.0）。
// plugins\ 在 OneDragon 的 .gitignore 裡，不會被它的程式更新蓋掉；不修改 OneDragon 本身的任何檔案。
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN_ID = 'modhub_zh_tw';
const VERSION = 2; // 外掛內容改了就加一（2：對照表不再轉換本身是簡體結果的字），ModHub 會提示更新
const SOURCE_DIR = path.join(__dirname, 'onedragon-plugin');
const FILES = ['__init__.py', `${PLUGIN_ID}_const.py`, `${PLUGIN_ID}_factory.py`];

const pluginDir = (root) => path.join(root, 'plugins', PLUGIN_ID);
const markerFile = (root) => path.join(pluginDir(root), 'modhub.json');

/**
 * 繁 → 簡單字對照表（只收一對一、和原字不同的字）
 * 本身就是某個繁體字的簡體結果的字不轉（例如 OpenCC 有「麼→么」也有「么→幺」，「什么」的「么」不能再變成「幺」）
 */
function buildMap(convert) {
  const raw = {};
  for (let c = 0x3400; c <= 0x9fff; c++) {
    const ch = String.fromCharCode(c);
    const s = convert(ch);
    if (s !== ch && s.length === 1) raw[ch] = s;
  }
  const targets = new Set(Object.values(raw));
  const map = {};
  for (const [t, s] of Object.entries(raw)) if (!targets.has(t)) map[t] = s;
  return map;
}

function status(root) {
  if (!root) return { installed: false };
  const dir = pluginDir(root);
  if (!fs.existsSync(path.join(dir, `${PLUGIN_ID}_factory.py`))) return { installed: false, dir };
  let version = 0;
  try { version = JSON.parse(fs.readFileSync(markerFile(root), 'utf8')).version || 0; } catch {}
  return { installed: true, dir, version, outdated: version < VERSION };
}

/** 安裝或更新外掛（覆寫外掛資料夾裡 ModHub 自己的檔案） */
function install(root, { convert } = {}) {
  if (!root || !fs.existsSync(path.join(root, 'plugins'))) throw new Error('OneDragon 資料夾裡找不到 plugins 資料夾');
  const conv = convert || require('opencc-js').Converter({ from: 'tw', to: 'cn' });
  const dir = pluginDir(root);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FILES) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(SOURCE_DIR, f)));
  fs.writeFileSync(path.join(dir, 't2s.json'), JSON.stringify(buildMap(conv)), 'utf8');
  fs.writeFileSync(markerFile(root), JSON.stringify({ by: 'ModHub', version: VERSION, installedAt: new Date().toISOString() }, null, 2), 'utf8');
  return status(root);
}

module.exports = { PLUGIN_ID, VERSION, FILES, pluginDir, buildMap, status, install };
