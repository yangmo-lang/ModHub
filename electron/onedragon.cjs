// 絕區零一條龍（自動每日）：啟動第三方工具 ZenlessZoneZero-OneDragon
//   https://github.com/OneDragon-Anything/ZenlessZoneZero-OneDragon（GPL-3.0）
//
// ModHub 不包含 OneDragon 的任何程式碼，只用它公開的命令列參數啟動：
//   OneDragon-Launcher.exe -o [-c] [-s 秒 | --sleep | --hibernate] [-i 實例]
//     -o 一條龍運行、-c 運行後關閉遊戲、-s 運行後關機、-i 指定帳號實例（例如 1,2）
// 定時：ModHub 開著時（含縮在系統匣），每天到指定時間啟動一次。
const fs = require('node:fs');
const path = require('node:path');

const EXE = 'OneDragon-Launcher.exe';
const REPO = 'OneDragon-Anything/ZenlessZoneZero-OneDragon';
const PAGES = {
  github: `https://github.com/${REPO}`,
  releases: `https://github.com/${REPO}/releases`,
  home: 'https://one-dragon.com/zzz/zh/home.html',
};
const AFTER = ['none', 'close', 'shutdown', 'sleep', 'hibernate'];
// odLaunchVia：一條龍前誰開遊戲。'xxmi' = ModHub 先透過 XXMI 開（Epic 版直接執行 exe 會少啟動參數而自行結束）；'onedragon' = 交給 OneDragon
const DEFAULTS = { odRoot: '', odAfter: 'close', odInstance: '', odLaunchVia: 'xxmi', odScheduleEnabled: false, odScheduleTime: '04:30', odLastRunDate: '' };
const GAME_EXE = 'ZenlessZoneZero.exe';

const options = (s) => ({ ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).filter((k) => s?.[k] !== undefined).map((k) => [k, s[k]])) });

/** 啟動參數 */
function launchArgs({ odAfter = 'close', odInstance = '' } = {}) {
  const args = ['-o'];
  if (odAfter !== 'none') args.push('-c');
  if (odAfter === 'shutdown') args.push('-s', '60');
  else if (odAfter === 'sleep') args.push('--sleep');
  else if (odAfter === 'hibernate') args.push('--hibernate');
  const inst = String(odInstance || '').replace(/\s+/g, '');
  if (inst) {
    if (!/^\d+(,\d+)*$/.test(inst)) throw new Error('帳號實例格式不對：請用數字，多個用英文逗號分隔（例如 1,2）');
    args.push('-i', inst);
  }
  return args;
}

const launcherPath = (root) => (root ? path.join(root, EXE) : '');

/** 找 OneDragon：設定的資料夾優先，其次常見位置（各磁碟根目錄、使用者資料夾底下名稱含 OneDragon 的資料夾，往下兩層） */
function detect(settingsRoot, { home = process.env.USERPROFILE || '', drives = ['C', 'D', 'E', 'F'], exists = fs.existsSync, readdir = (d) => fs.readdirSync(d, { withFileTypes: true }) } = {}) {
  if (settingsRoot) return exists(launcherPath(settingsRoot)) ? settingsRoot : '';
  const bases = [...drives.map((d) => `${d}:\\`), home, home && path.join(home, 'Desktop'), home && path.join(home, 'Documents'), home && path.join(home, 'Downloads')].filter(Boolean);
  for (const base of bases) {
    let entries;
    try { entries = readdir(base); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || !/onedragon|一条龙|一條龍/i.test(e.name)) continue;
      const dir = path.join(base, e.name);
      if (exists(launcherPath(dir))) return dir;
      let inner = [];
      try { inner = readdir(dir); } catch {}
      for (const s of inner) if (s.isDirectory() && exists(launcherPath(path.join(dir, s.name)))) return path.join(dir, s.name);
    }
  }
  return '';
}

/** 'HH:MM' → { h, m }，格式不對回傳 null */
function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return { h: +m[1], m: +m[2] };
}

const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * 今天該不該自動執行：時間到了、今天還沒跑過、而且還在 windowMin 分鐘內
 * （晚上才打開 ModHub 時不會突然啟動遊戲）
 */
function dueNow(now, { odScheduleEnabled, odScheduleTime, odLastRunDate }, windowMin = 30) {
  if (!odScheduleEnabled) return false;
  const t = parseTime(odScheduleTime);
  if (!t) return false;
  if (odLastRunDate === dateKey(now)) return false;
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.m, 0).getTime();
  return now.getTime() >= at && now.getTime() - at <= windowMin * 60000;
}

/** GitHub 最新版的官方安裝程式 { version, name, url, size, sha256, page } */
function pickInstaller(release) {
  const asset = (release?.assets || []).find((a) => /-Installer\.exe$/i.test(a.name));
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

module.exports = { GAME_EXE, EXE, REPO, PAGES, AFTER, DEFAULTS, options, launchArgs, launcherPath, detect, parseTime, dateKey, dueNow, pickInstaller };
