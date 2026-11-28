// 絕區零一條龍：自動幫 OneDragon 填遊戲路徑
//
// OneDragon 的遊戲路徑存在 config\<實例兩位數>\game_account.yml 的 game_path（同一個檔案也存帳號密碼）。
// 沒設定時它的「打開遊戲」會直接失敗（未配置游戏路径），所以從沒打開過 OneDragon 設定的人無法使用。
// ModHub 從 XXMI 設定的絕區零資料夾（或遊戲的 Player.log）找到 ZenlessZoneZero.exe，
// 只在 game_path 是空的時候補上這一行：其他內容原樣保留、不讀出也不顯示；已經設定過的路徑不覆蓋。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const GAME_EXES = ['ZenlessZoneZero.exe'];

const accountFile = (root, idx) => path.join(root, 'config', String(idx).padStart(2, '0'), 'game_account.yml');

/** 找絕區零的 exe：XXMI 設定 → Player.log → 找不到回傳 '' */
function findGameExe(xxmiRoot, { home = os.homedir(), exists = fs.existsSync, read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const dirs = [];
  try {
    const cfg = JSON.parse(read(path.join(xxmiRoot, 'XXMI Launcher Config.json')));
    const folder = cfg?.Importers?.ZZMI?.Importer?.game_folder;
    if (folder) dirs.push(folder);
  } catch {}
  for (const sub of [['miHoYo', 'ZenlessZoneZero'], ['miHoYo', '絕區零'], ['miHoYo', '绝区零']]) {
    try {
      const m = /([A-Z]:[\\/][^\r\n]*?)[\\/]ZenlessZoneZero_Data/i.exec(read(path.join(home, 'AppData', 'LocalLow', ...sub, 'Player.log')));
      if (m) dirs.push(m[1]);
    } catch {}
  }
  for (const d of dirs) {
    for (const exe of GAME_EXES) {
      const full = path.normalize(path.join(d, exe));
      if (exists(full)) return full;
    }
  }
  return '';
}

/** game_account.yml 文字裡的 game_path（只解析這一行，其他欄位不碰） */
function readGamePath(text) {
  const m = /^game_path:[ \t]*(.*?)[ \t]*$/m.exec(String(text || ''));
  if (!m) return '';
  try { return String(yaml.load(`v: ${m[1]}`)?.v ?? '').trim(); } catch { return m[1].trim(); }
}

/** 補上 game_path：已有值不動；有空的 game_path 行就換掉；沒有就加在最後。回傳新文字或 null（不用改） */
function withGamePath(text, exe) {
  const src = String(text || '');
  if (readGamePath(src)) return null;
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const line = yaml.dump({ game_path: exe }, { lineWidth: -1 }).trimEnd();
  if (/^game_path:.*$/m.test(src)) return src.replace(/^game_path:.*$/m, line);
  return src + (src && !src.endsWith('\n') ? eol : '') + line + eol;
}

/** 各實例的遊戲路徑狀態 [{ idx, path }]（只讀 game_path 這一行） */
function status(root, indices) {
  return indices.map((idx) => {
    let p = '';
    try { p = readGamePath(fs.readFileSync(accountFile(root, idx), 'utf8')); } catch {}
    return { idx, path: p };
  });
}

/** 幫還沒設定的實例填上遊戲路徑，回傳有填的實例編號 */
function fill(root, indices, exe) {
  const filled = [];
  if (!exe) return filled;
  for (const idx of indices) {
    const file = accountFile(root, idx);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') continue; }
    const next = withGamePath(text, exe);
    if (next == null) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.modhub-tmp`;
    fs.writeFileSync(tmp, next, 'utf8');
    fs.renameSync(tmp, file);
    filled.push(idx);
  }
  return filled;
}

module.exports = { accountFile, findGameExe, readGamePath, withGamePath, status, fill };
