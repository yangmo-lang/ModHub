// 絕區零一條龍（OneDragon）的主程序：狀態、啟動、定時、下載官方安裝程式
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const od = require('./onedragon.cjs');
const tasks = require('./onedragon-tasks.cjs');
const apps = require('./onedragon-apps.cjs');
const zhtw = require('./onedragon-zhtw.cjs');
const { parseTasklist } = require('./overlay.cjs');
const net = require('./net.cjs');

/** 透過 Windows Shell 啟動（和雙擊一樣，需要系統管理員權限時會跳 UAC） */
function shellStart(exe, args, spawnImpl = spawn) {
  if (/["%^&|<>]/.test(exe) || args.some((a) => /["%^&|<>]/.test(a))) throw new Error(`路徑含有不支援的字元：${exe}`);
  const cmd = `start "" /D "${path.dirname(exe)}" "${exe}" ${args.join(' ')}`;
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], { windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore' });
    child.on('error', (e) => reject(new Error(`無法啟動 OneDragon：${e.message}`)));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('OneDragon 沒有啟動（可能是在系統管理員權限詢問視窗按了「否」）'))));
  });
}

const GAME_SETTLE_MS = 20000;
const TASK_NAME = 'OneDragon';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 每 intervalMs 檢查一次，timeoutMs 內成立就回傳 true */
async function waitFor(check, timeoutMs, intervalMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return false;
}

/** 某個程序是否在執行（tasklist） */
function processRunning(exe) {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? false : parseTasklist(out).has(exe.toLowerCase())));
  });
}

/** OneDragon 是否在執行（啟動器與它帶起來的程序名稱都以 OneDragon 開頭） */
function oneDragonRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return resolve(false);
      resolve([...parseTasklist(out)].some((n) => n.startsWith('onedragon')));
    });
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/**
 * @param ctx { getSettings(), saveSettings(patch), dialog, shell, BrowserWindow, downloadsDir(), launchGame() → Promise（透過 XXMI 開絕區零）, emit(channel, payload) }
 */
function register(ipcMain, ctx) {
  const root = () => od.detect(od.options(ctx.getSettings()).odRoot);

  function status() {
    const o = od.options(ctx.getSettings());
    const found = root();
    return { ...o, found, exe: found ? od.launcherPath(found) : '', pages: od.PAGES, configuredButMissing: Boolean(o.odRoot && !found), zhtw: found ? zhtw.status(found) : { installed: false } };
  }

  let busy = false;
  async function run(reason = 'manual') {
    const dir = root();
    if (!dir) throw new Error('找不到 OneDragon（OneDragon-Launcher.exe）。請到「自動每日」指定資料夾，或先下載安裝。');
    if (busy) throw new Error('一條龍正在準備中');
    const o = od.options(ctx.getSettings());
    const args = od.launchArgs(o);
    busy = true;
    try {
      // 先由 ModHub 透過 XXMI 開遊戲（和「▶ 啟動」相同，Epic 版需要這樣才有啟動參數），遊戲畫面出來後再交給 OneDragon
      if (o.odLaunchVia === 'xxmi' && !(await processRunning(od.GAME_EXE))) {
        ctx.emit('od:stage', { stage: 'launching' });
        await ctx.launchGame();
        ctx.emit('od:stage', { stage: 'waiting' });
        const ok = await waitFor(() => processRunning(od.GAME_EXE), 180000, 3000);
        if (!ok) throw new Error('3 分鐘內沒看到絕區零啟動（XXMI 沒開成功或被取消），沒有啟動 OneDragon');
        await sleep(GAME_SETTLE_MS); // 讓遊戲視窗出現並開始載入
      }
      ctx.emit('od:stage', { stage: 'onedragon' });
      // 有設定免確認啟動（工作排程）就不跳 UAC；沒有就和雙擊一樣透過 Shell 啟動
      const exe = od.launcherPath(dir);
      if (ctx.startElevated) await ctx.startElevated(TASK_NAME, exe, args, dir, () => shellStart(exe, args));
      else await shellStart(exe, args);
    } finally {
      busy = false;
      ctx.emit('od:stage', null);
    }
    ctx.saveSettings({ odLastRunDate: od.dateKey(new Date()) });
    ctx.emit('od:started', { reason, args });
    return { args };
  }

  ipcMain.handle('od:status', () => status());

  // 繁體中文遊戲畫面支援（ModHub 自己的 OneDragon 外掛）
  ipcMain.handle('od:zhtwInstall', () => {
    const dir = root();
    if (!dir) throw new Error('找不到 OneDragon');
    zhtw.install(dir);
    return status();
  });
  ipcMain.handle('od:zhtwRemove', async () => {
    const dir = root();
    const st = dir ? zhtw.status(dir) : null;
    if (st?.installed) await ctx.shell.trashItem(st.dir); // 移到資源回收筒
    return status();
  });
  ipcMain.handle('od:run', async () => {
    try { return await run('manual'); } catch (err) { ctx.emit('od:error', { message: err.message, reason: 'manual' }); throw err; }
  });

  // ---- 一條龍任務清單（讀寫 OneDragon 自己的 one_dragon\_group.yml） ----
  ipcMain.handle('od:tasks', (_e, idx) => {
    const dir = root();
    if (!dir) return { found: false, instances: [], idx: null, tasks: [] };
    const instances = tasks.readInstances(dir);
    const pick = idx != null && instances.some((i) => i.idx === Number(idx)) ? Number(idx) : tasks.pickInstance(instances, od.options(ctx.getSettings()).odInstance);
    if (pick == null) return { found: true, instances, idx: null, tasks: [], note: '還沒有帳號實例：請先打開 OneDragon 設定一次' };
    return { found: true, instances, idx: pick, ...tasks.readTasks(dir, pick) };
  });
  // 個別任務的設定（錄像店 / 咖啡店地點、體力刷本計畫）
  ipcMain.handle('od:appConfig', (_e, idx, appId) => {
    const dir = root();
    if (!dir) throw new Error('找不到 OneDragon');
    if (!apps.CONFIGURABLE.has(appId)) throw new Error('這個任務的設定請在 OneDragon 裡調整');
    return apps.readAppConfig(dir, Number(idx), appId);
  });
  ipcMain.handle('od:setAppConfig', async (_e, idx, appId, patch) => {
    const dir = root();
    if (!dir) throw new Error('找不到 OneDragon');
    if (!apps.CONFIGURABLE.has(appId)) throw new Error('這個任務的設定請在 OneDragon 裡調整');
    if (await oneDragonRunning()) throw new Error('OneDragon 正在執行，請先關閉 OneDragon 再修改設定（否則它會蓋掉這裡的設定）');
    return apps.writeAppConfig(dir, Number(idx), appId, patch);
  });

  ipcMain.handle('od:setTasks', async (_e, idx, list) => {
    const dir = root();
    if (!dir) throw new Error('找不到 OneDragon');
    if (await oneDragonRunning()) throw new Error('OneDragon 正在執行，請先關閉 OneDragon 再修改任務（否則它會蓋掉這裡的設定）');
    return tasks.writeTasks(dir, Number(idx), Array.isArray(list) ? list.slice(0, 100) : []);
  });

  // 從 GitHub 下載官方安裝程式到「下載」資料夾，由使用者自己雙擊安裝（需要系統管理員權限）
  ipcMain.handle('od:downloadInstaller', async (e) => {
    const rel = od.pickInstaller(await net.fetchJson(`https://api.github.com/repos/${od.REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } }));
    if (!rel) throw new Error('GitHub 最新版裡找不到 OneDragon 安裝程式');
    const dest = path.join(ctx.downloadsDir(), net.safeFileName(rel.name));
    const r = await ctx.dialog.showMessageBox(ctx.BrowserWindow.fromWebContents(e.sender), {
      type: 'question',
      title: '下載 OneDragon 安裝程式',
      message: `下載 ${rel.name}（v${rel.version}，${(rel.size / 1048576).toFixed(1)} MB）？`,
      detail: [
        `來源：${rel.page}`,
        `存到：${dest}`,
        rel.sha256 ? '下載後會比對 GitHub 提供的 SHA-256。' : '',
        '',
        'ModHub 只下載，不會執行；請自己雙擊安裝（需要系統管理員權限）。',
        'OneDragon 是第三方工具（GPL-3.0），會模擬操作遊戲，可能違反遊戲條款，風險自負。',
      ].filter((x) => x !== null).join('\n'),
      buttons: ['下載', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response !== 0) return { cancelled: true };
    await net.download(rel.url, dest, { onProgress: (p) => ctx.emit('od:progress', p) });
    ctx.emit('od:progress', null);
    if (rel.sha256 && (await sha256File(dest)) !== rel.sha256) {
      fs.rmSync(dest, { force: true });
      throw new Error('下載的檔案 SHA-256 與 GitHub 不符，已刪除');
    }
    ctx.shell.showItemInFolder(dest);
    return { path: dest, version: rel.version };
  });

  // 定時：ModHub 開著時每 30 秒檢查一次；到時間（30 分鐘內）且今天還沒跑過就啟動
  let running = false;
  const timer = setInterval(async () => {
    if (running || !od.dueNow(new Date(), od.options(ctx.getSettings()))) return;
    running = true;
    try {
      await run('schedule');
    } catch (err) {
      ctx.saveSettings({ odLastRunDate: od.dateKey(new Date()) }); // 失敗也記下，今天不再重試（避免一直跳 UAC）
      ctx.emit('od:error', { message: err.message, reason: 'schedule' });
    } finally {
      running = false;
    }
  }, 30000);
  timer.unref?.();

  /** 工作排程用的命令列（找不到 OneDragon 時不建立） */
  function taskEntry() {
    const dir = root();
    if (!dir) return null;
    return { name: TASK_NAME, label: 'OneDragon 一條龍', exe: od.launcherPath(dir), args: od.launchArgs(od.options(ctx.getSettings())), dir };
  }

  return { status, run, taskEntry };
}

module.exports = { register, TASK_NAME, shellStart, waitFor, processRunning, sha256File, sleep };
