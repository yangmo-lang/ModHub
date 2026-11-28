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

// ---- game_account.yml 的單一欄位（只用正規式處理那一行，其他欄位不讀、不碰） ----
const lineRe = (key) => new RegExp(`^${key}:[ \t]*(.*?)[ \t]*$`, 'm');

/** 讀某個欄位；沒有這一行回傳 null，有但是空的回傳 '' */
function readField(text, key) {
  const m = lineRe(key).exec(String(text || ''));
  if (!m) return null;
  try { return String(yaml.load(`v: ${m[1]}`)?.v ?? '').trim(); } catch { return m[1].trim(); }
}
const readGamePath = (text) => readField(text, 'game_path') || '';

/** 設定欄位：有這一行就換掉，沒有就加在最後（保留換行符號） */
function setField(text, key, value) {
  const src = String(text || '');
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const line = yaml.dump({ [key]: value }, { lineWidth: -1 }).trimEnd();
  if (lineRe(key).test(src)) return src.replace(lineRe(key), line);
  return src + (src && !src.endsWith('\n') ? eol : '') + line + eol;
}

/** 補上 game_path：已有值不動。回傳新文字或 null（不用改） */
function withGamePath(text, exe) {
  if (readGamePath(text)) return null;
  return setField(text, 'game_path', exe);
}

// ---- 遊戲區服（OneDragon 依它決定要找的視窗標題：國服 / B 服找「绝区零」，國際服找「ZenlessZoneZero」） ----
// OneDragon 的 GameRegionEnum：cn 國服、cn_b B 服、us 美服、eu 歐服、asia 亞服、twhkmo 港澳台服
const REGION_LABEL = { cn: '國服', cn_b: 'B服', us: '美服', eu: '歐服', asia: '亞服', twhkmo: '港澳台服' };
const isCnRegion = (r) => r === 'cn' || r === 'cn_b';

/** 用戶端類型：讀遊戲資料夾的 config.ini（uapc 裡的 nap_global / nap_cn、cps）；判斷不了回傳 '' */
function detectClient(exe, { read = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  if (!exe) return '';
  let ini = '';
  try { ini = read(path.join(path.dirname(exe), 'config.ini')); } catch { return ''; }
  if (/^cps=.*bilibili/im.test(ini)) return 'cnb';
  if (/nap_global/i.test(ini)) return 'intl';
  if (/nap_cn/i.test(ini)) return 'cn';
  return '';
}

/** 絕區零國際服 UID 開頭 → 區服（10 美服、13 亞服、15 歐服、17 港澳台服） */
function regionFromUid(uid) {
  return { 10: 'us', 13: 'asia', 15: 'eu', 17: 'twhkmo' }[String(uid || '').slice(0, 2)] || '';
}

/**
 * 推測區服：國服 / B 服看 config.ini；國際服再用 ModHub 抽卡紀錄的 UID 分亞服 / 美服 / 歐服 / 港澳台服（沒有就港澳台服）
 * @returns { region, client, source }，判斷不了 region = ''
 */
function guessRegion(exe, uids = [], opts) {
  const client = detectClient(exe, opts);
  if (client === 'cn') return { region: 'cn', client, source: 'config.ini' };
  if (client === 'cnb') return { region: 'cn_b', client, source: 'config.ini' };
  if (client !== 'intl') return { region: '', client, source: '' };
  for (const u of uids) {
    const r = regionFromUid(u);
    if (r) return { region: r, client, source: `UID ${u}` };
  }
  return { region: 'twhkmo', client, source: '預設' };
}

/** 各實例的狀態 [{ idx, path, region }]（region：null = 沒設定過，OneDragon 會當成國服） */
function status(root, indices) {
  return indices.map((idx) => {
    let text = '';
    try { text = fs.readFileSync(accountFile(root, idx), 'utf8'); } catch {}
    return { idx, path: readGamePath(text), region: readField(text, 'game_region') };
  });
}

/**
 * 幫還沒設定的實例補上遊戲路徑與區服：game_path 是空的才填；game_region 沒有這一行（從沒設定過）才填
 * @returns [{ idx, path?, region? }]（有改的實例）
 */
function fill(root, indices, exe, region = '') {
  const changed = [];
  if (!exe && !region) return changed;
  for (const idx of indices) {
    const file = accountFile(root, idx);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') continue; }
    let next = text;
    const did = { idx };
    if (exe && !readGamePath(next)) { next = setField(next, 'game_path', exe); did.path = exe; }
    if (region && REGION_LABEL[region] && readField(next, 'game_region') == null) { next = setField(next, 'game_region', region); did.region = region; }
    if (next === text) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.modhub-tmp`;
    fs.writeFileSync(tmp, next, 'utf8');
    fs.renameSync(tmp, file);
    changed.push(did);
  }
  return changed;
}

module.exports = { REGION_LABEL, isCnRegion, accountFile, findGameExe, readField, readGamePath, setField, withGamePath, detectClient, regionFromUid, guessRegion, status, fill };
