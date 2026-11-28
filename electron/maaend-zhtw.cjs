// 終末地 MaaEnd 的 OCR 字典繁轉簡（已停用，只用來還原）
//
// 曾經仿照絕區零 OneDragon 外掛，把 MaaEnd OCR 字典 resource\model\ocr\keys.txt 裡的繁體字逐行換成簡體。
// 實測發現 MaaEnd 原生就支援繁中遊戲畫面：比對文字裡繁體、簡體（還有日、韓、英文）都有列，例如
// 「点击任意位置继续」「按下任意位置繼續」；兩岸用詞不同，轉成簡體反而兩邊都比對不到（標題畫面點不下去）。
// 所以 ModHub 不再套用；看到 keys.txt.modhub-bak（舊版留下的備份）就用 remove() 還原。
const fs = require('node:fs');
const path = require('node:path');
const { buildMap } = require('./onedragon-zhtw.cjs');

const keysFile = (root) => path.join(root, 'resource', 'model', 'ocr', 'keys.txt');
const backupFile = (root) => `${keysFile(root)}.modhub-bak`;

let cachedMap = null;
function t2sMap() {
  if (!cachedMap) cachedMap = buildMap(require('opencc-js').Converter({ from: 'tw', to: 'cn' }));
  return cachedMap;
}

/** 逐行轉換：只換「整行只有一個字、且有繁 → 簡對照」的行，保留換行符號與行數 */
function convertKeys(text, map = t2sMap()) {
  let changed = 0;
  const out = String(text).split(/(\r?\n)/).map((part) => {
    if (part.length === 1 && map[part]) { changed++; return map[part]; }
    return part;
  }).join('');
  return { text: out, changed };
}

/**
 * @returns { found, installed, outdated }
 *   installed：字典已經沒有可轉換的繁體字，且有備份（是 ModHub 改的）
 *   outdated：有備份但字典又出現繁體字（MaaEnd 更新後蓋掉了，執行前會重新套用）
 */
function status(root, map = t2sMap()) {
  const file = keysFile(root);
  if (!root || !fs.existsSync(file)) return { found: false, installed: false, outdated: false };
  const pending = convertKeys(fs.readFileSync(file, 'utf8'), map).changed;
  const hasBak = fs.existsSync(backupFile(root));
  return { found: true, installed: hasBak && pending === 0, outdated: hasBak && pending > 0, pending };
}

/** 套用：字典裡還有繁體字就先備份（覆蓋舊備份，因為可能是 MaaEnd 更新後的新字典）再轉換 */
function install(root, map = t2sMap()) {
  const file = keysFile(root);
  if (!fs.existsSync(file)) throw new Error('MaaEnd 資料夾裡找不到 OCR 字典（resource\\model\\ocr\\keys.txt）');
  const text = fs.readFileSync(file, 'utf8');
  const r = convertKeys(text, map);
  if (r.changed > 0) {
    fs.writeFileSync(backupFile(root), text, 'utf8');
    const tmp = `${file}.modhub-tmp`;
    fs.writeFileSync(tmp, r.text, 'utf8');
    fs.renameSync(tmp, file);
  }
  return status(root, map);
}

/** 移除：字典還是 ModHub 改過的樣子就用備份還原；MaaEnd 已經換成新字典時只刪掉舊備份 */
function remove(root, map = t2sMap()) {
  const file = keysFile(root);
  const bak = backupFile(root);
  if (!fs.existsSync(bak)) return status(root, map);
  const original = fs.readFileSync(bak, 'utf8');
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === convertKeys(original, map).text) {
    const tmp = `${file}.modhub-tmp`;
    fs.writeFileSync(tmp, original, 'utf8');
    fs.renameSync(tmp, file);
  }
  fs.rmSync(bak, { force: true });
  return status(root, map);
}

module.exports = { keysFile, backupFile, convertKeys, status, install, remove, t2sMap };
