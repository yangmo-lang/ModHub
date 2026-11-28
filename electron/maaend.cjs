// 終末地自動每日：啟動第三方工具 MaaEnd（https://github.com/MaaEnd/MaaEnd，AGPL-3.0）
//
// ModHub 不包含 MaaEnd 的任何程式碼，只用它介面程式 MXU 公開的命令列參數啟動：
//   MaaEnd.exe --autostart -i <實例名稱> [-q]
//     --autostart 自動執行、-i 指定要執行的實例（MaaEnd 分頁）、-q 執行完自動關閉 MaaEnd
// 實例與任務清單只讀 MaaEnd 自己的設定 config\mxu-MaaEnd.json，不修改；任務請在 MaaEnd 裡設定。
const fs = require('node:fs');
const path = require('node:path');

const EXE = 'MaaEnd.exe';
const GAME_EXE = 'Endfield.exe';
const REPO = 'MaaEnd/MaaEnd';
const PAGES = {
  github: `https://github.com/${REPO}`,
  releases: `https://github.com/${REPO}/releases`,
  home: 'https://maaend.com/',
};
// meLaunchVia：'xxmi' = ModHub 先透過 XXMI 開終末地（載入 MOD）；'maaend' = 交給 MaaEnd（實例裡的「啟動遊戲」）
const DEFAULTS = { meRoot: '', meInstance: '', meQuit: true, meLaunchVia: 'xxmi', meScheduleEnabled: false, meScheduleTime: '05:00', meLastRunDate: '', meBypassModCheck: false, meRegion: '' };

// 啟動遊戲的前置任務與切換帳號：ModHub 自己透過 XXMI 開遊戲，這些在 ModHub 不顯示
const isHidden = (name) => String(name || '').startsWith('__MXU_PRETASK__') || name === 'AccountSwitch';

const options = (s) => ({ ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).filter((k) => s?.[k] !== undefined).map((k) => [k, s[k]])) });

function checkInstance(name) {
  const s = String(name || '').trim();
  if (!s) throw new Error('還沒選要執行的 MaaEnd 實例（請先打開 MaaEnd 建立並設定任務）');
  if (s.length > 100 || /["\r\n\0]/.test(s)) throw new Error(`MaaEnd 實例名稱含有不支援的字元：${s}`);
  return s;
}

/** 啟動參數 */
function launchArgs(instance, { meQuit = true } = {}) {
  const args = ['--autostart', '-i', checkInstance(instance)];
  if (meQuit) args.push('-q');
  return args;
}

const exePath = (root) => (root ? path.join(root, EXE) : '');

/** 找 MaaEnd：設定的資料夾優先，其次各磁碟根目錄、使用者資料夾底下名稱含 MaaEnd 的資料夾（往下兩層） */
function detect(settingsRoot, { home = process.env.USERPROFILE || '', drives = ['C', 'D', 'E', 'F'], exists = fs.existsSync, readdir = (d) => fs.readdirSync(d, { withFileTypes: true }) } = {}) {
  if (settingsRoot) return exists(exePath(settingsRoot)) ? settingsRoot : '';
  const bases = [...drives.map((d) => `${d}:\\`), home, home && path.join(home, 'Desktop'), home && path.join(home, 'Documents'), home && path.join(home, 'Downloads')].filter(Boolean);
  for (const base of bases) {
    let entries;
    try { entries = readdir(base); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || !/maa\s*end/i.test(e.name)) continue;
      const dir = path.join(base, e.name);
      if (exists(exePath(dir))) return dir;
      let inner = [];
      try { inner = readdir(dir); } catch {}
      for (const s of inner) if (s.isDirectory() && exists(exePath(path.join(dir, s.name)))) return path.join(dir, s.name);
    }
  }
  return '';
}

/** JSON with comments：去掉 // 與 /* *\/ 註解、結尾逗號（字串裡的不動） */
function parseJsonc(text) {
  const src = String(text || '').replace(/^﻿/, '');
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const readJsonc = (file) => parseJsonc(fs.readFileSync(file, 'utf8'));

/** 任務名稱 → 顯示名稱（讀 MaaEnd 安裝目錄的 interface.json、tasks\*.json 與繁中語系檔；讀不到就回傳空物件） */
function taskLabels(root, lang = 'zh_tw') {
  const labels = {};
  try {
    const iface = readJsonc(path.join(root, 'interface.json'));
    let locale = {};
    const locFile = iface.languages?.[lang] || iface.languages?.zh_cn;
    if (locFile) try { locale = readJsonc(path.join(root, locFile)); } catch {}
    const tr = (s) => (typeof s === 'string' && s.startsWith('$') ? locale[s.slice(1)] || '' : s || '');
    const tasks = [...(iface.task || [])];
    for (const rel of iface.import || []) {
      if (typeof rel !== 'string' || rel.includes('..')) continue;
      try { tasks.push(...(readJsonc(path.join(root, rel)).task || [])); } catch {}
    }
    for (const t of tasks) if (t?.name) labels[t.name] = tr(t.label) || t.name;
  } catch {}
  return labels;
}

/** MaaEnd 的設定檔（MXU 依 interface.json 的 name 命名） */
const configFile = (root) => path.join(root, 'config', 'mxu-MaaEnd.json');

/**
 * 讀 MaaEnd 的實例與任務（唯讀）
 * @returns { instances: [{ id, name, controller, tasks: [{ name, label, enabled }] }], defaultName, error? }
 */
function readInstances(root, labels = taskLabels(root)) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '')); } catch (e) {
    return { instances: [], defaultName: '', error: e.code === 'ENOENT' ? '還沒有 MaaEnd 設定：請先打開 MaaEnd 一次，建立實例並勾選任務' : `讀不到 MaaEnd 設定：${e.message}` };
  }
  const instances = (Array.isArray(cfg.instances) ? cfg.instances : []).filter((i) => i && i.name).map((i) => ({
    id: String(i.id || ''),
    name: String(i.name),
    controller: String(i.controllerName || ''),
    tasks: (Array.isArray(i.tasks) ? i.tasks : []).filter((t) => t && !isHidden(t.taskName)).map((t) => {
      const byCtl = t.enabledByController && i.controllerName ? t.enabledByController[i.controllerName] : undefined;
      return { name: String(t.taskName || ''), label: t.customName || labels[t.taskName] || t.taskName || '', enabled: byCtl !== undefined ? Boolean(byCtl) : Boolean(t.enabled) };
    }),
  }));
  const autoId = cfg.settings?.autoStartInstanceId;
  const defaultName = instances.find((i) => i.id && i.id === autoId)?.name || '';
  return { instances, defaultName };
}

/** 要執行哪個實例：ModHub 設定的（還存在才用）→ MaaEnd 設定的自動執行實例 → 第一個 */
function resolveInstance(meInstance, { instances, defaultName }) {
  const names = instances.map((i) => i.name);
  if (meInstance && names.includes(meInstance)) return meInstance;
  return defaultName || names[0] || '';
}

// MaaEnd「啟動遊戲」前置任務的伺服器（LaunchGamePCRegion 的 case 名稱）
const REGIONS = ['CN', 'Global', 'Bilibili', 'TapTap', 'Steam', 'Epic'];

/** 依遊戲資料夾判斷是哪個版本：Epic / Steam / 國際服（Gryphline）/ B 服 / TapTap / 國服（Hypergryph）；判斷不了回傳 '' */
function guessRegion(gameDir) {
  const p = String(gameDir || '').replace(/\\/g, '/').toLowerCase();
  if (!p) return '';
  if (p.includes('epic games')) return 'Epic';
  if (p.includes('steamapps')) return 'Steam';
  if (/bilibili/.test(p)) return 'Bilibili';
  if (/taptap/.test(p)) return 'TapTap';
  if (/gryph(line|link)/.test(p)) return 'Global';
  if (/hypergryph/.test(p)) return 'CN';
  return '';
}

/** GitHub 最新版的 Windows 壓縮檔 { version, name, url, size, sha256, page } */
function pickPackage(release, arch = process.arch) {
  const want = arch === 'arm64' ? 'aarch64' : 'x86_64';
  const asset = (release?.assets || []).find((a) => new RegExp(`^MaaEnd-win-${want}-v[\\w.-]+\\.zip$`, 'i').test(a.name));
  if (!asset) return null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '');
  return {
    version: String(release.tag_name || '').replace(/^v/, ''),
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    sha256: digest ? digest[1].toLowerCase() : '',
    page: release.html_url || PAGES.releases,
  };
}

module.exports = { isHidden, REGIONS, guessRegion, EXE, GAME_EXE, REPO, PAGES, DEFAULTS, options, launchArgs, checkInstance, exePath, detect, parseJsonc, taskLabels, configFile, readInstances, resolveInstance, pickPackage };
