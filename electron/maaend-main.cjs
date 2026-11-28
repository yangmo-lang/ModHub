// 終末地自動每日（MaaEnd）的主程序：狀態、啟動、定時、下載官方壓縮檔
const fs = require('node:fs');
const path = require('node:path');
const me = require('./maaend.cjs');
const meTasks = require('./maaend-tasks.cjs');
const bypass = require('./maaend-bypass.cjs');
const zhtw = require('./maaend-zhtw.cjs');
const eff = require('./eff.cjs');
const od = require('./onedragon.cjs'); // 共用 parseTime / dueNow / dateKey
const { waitFor, processRunning, sha256File, sleep } = require('./onedragon-main.cjs');
const net = require('./net.cjs');

const GAME_SETTLE_MS = 20000;
const TASK_NAME = 'MaaEnd';

// dueNow 用的是 od* 欄位名稱
const schedule = (o) => ({ odScheduleEnabled: o.meScheduleEnabled, odScheduleTime: o.meScheduleTime, odLastRunDate: o.meLastRunDate });

/**
 * @param ctx { getSettings(), saveSettings(patch), dialog, shell, BrowserWindow, downloadsDir(), launchGame() → Promise（透過 XXMI 開終末地），
 *              startElevated(name, exe, args, dir) → Promise（工作排程或 UAC）, emit(channel, payload) }
 */
function register(ipcMain, ctx) {
  const root = () => me.detect(me.options(ctx.getSettings()).meRoot);

  function info() {
    const o = me.options(ctx.getSettings());
    const found = root();
    const cfg = found ? me.readInstances(found) : { instances: [], defaultName: '' };
    return { o, found, cfg, instance: me.resolveInstance(o.meInstance, cfg) };
  }

  /** 還原舊版 ModHub 改過的 OCR 字典（MaaEnd 原生支援繁中，不需要也不能轉換） */
  function restoreZhtw(dir) {
    try { if (dir && fs.existsSync(zhtw.backupFile(dir))) zhtw.remove(dir); } catch {}
  }

  /** 交給 MaaEnd 開遊戲用的伺服器：手動指定 → 依終末地資料夾判斷 → 沿用 MaaEnd 原本的設定 */
  function launchInfo(found, cfg, instance) {
    const gameDir = eff.resolveGameDir(ctx.getSettings());
    const guess = me.guessRegion(gameDir);
    const id = cfg.instances.find((i) => i.name === instance)?.id;
    let pretask = null;
    try { if (found && id) pretask = meTasks.readLaunchPretask(found, id); } catch {}
    const chosen = me.options(ctx.getSettings()).meRegion;
    return { gameDir, guess, pretask, region: (me.REGIONS.includes(chosen) && chosen) || guess || pretask?.region || '' };
  }

  function status() {
    const { o, found, cfg, instance } = info();
    restoreZhtw(found);
    let bypassState = 'missing';
    try { bypassState = found ? bypass.status(found) : 'missing'; } catch {}
    return { ...o, found, exe: found ? me.exePath(found) : '', pages: me.PAGES, configuredButMissing: Boolean(o.meRoot && !found), ...cfg, instance, bypassState, launch: launchInfo(found, cfg, instance) };
  }

  /** 工作排程用的命令列（找不到 MaaEnd 或沒有實例時不建立） */
  function taskEntry() {
    const { o, found, instance } = info();
    if (!found || !instance) return null;
    return { name: TASK_NAME, label: `MaaEnd 自動執行「${instance}」`, exe: me.exePath(found), args: me.launchArgs(instance, o), dir: found };
  }

  let busy = false;
  async function run(reason = 'manual') {
    const { o, found, cfg, instance } = info();
    if (!found) throw new Error('找不到 MaaEnd（MaaEnd.exe）。請到「終末地 → 自動每日」指定資料夾，或先下載。');
    if (cfg.error) throw new Error(cfg.error);
    const args = me.launchArgs(instance, o);
    if (busy) throw new Error('MaaEnd 正在準備中');
    // MaaEnd 只允許開一個：已經開著時再啟動只會把舊視窗叫到前面，不會自動執行
    if (await processRunning(me.EXE)) throw new Error('MaaEnd 已經開著：請先關閉 MaaEnd，或直接在 MaaEnd 裡按「開始」');
    // 繞過「隱藏 UID MOD」檢查：MaaEnd 更新資源會蓋掉，每次執行前重新套用
    if (o.meBypassModCheck) bypass.apply(found, true);
    // MaaEnd 原生支援繁中遊戲畫面（比對文字裡繁簡都有），舊版 ModHub 的 OCR 字典繁轉簡反而會讓它比對不到，有備份就還原
    restoreZhtw(found);
    // 交給 MaaEnd 開遊戲：打開實例的「啟動遊戲」前置任務並設定伺服器（這兩項在 ModHub 的任務清單裡不顯示）
    if (o.meLaunchVia === 'maaend') {
      const id = cfg.instances.find((i) => i.name === instance)?.id;
      if (id) meTasks.ensureLaunchPretask(found, id, launchInfo(found, cfg, instance).region);
    }
    busy = true;
    try {
      if (o.meLaunchVia === 'xxmi' && !(await processRunning(me.GAME_EXE))) {
        ctx.emit('me:stage', { stage: 'launching' });
        await ctx.launchGame();
        ctx.emit('me:stage', { stage: 'waiting' });
        const ok = await waitFor(() => processRunning(me.GAME_EXE), 180000, 3000);
        if (!ok) throw new Error('3 分鐘內沒看到終末地啟動（XXMI 沒開成功或被取消），沒有啟動 MaaEnd');
        await sleep(GAME_SETTLE_MS);
      }
      ctx.emit('me:stage', { stage: 'maaend' });
      await ctx.startElevated(TASK_NAME, me.exePath(found), args, found);
    } finally {
      busy = false;
      ctx.emit('me:stage', null);
    }
    ctx.saveSettings({ meLastRunDate: od.dateKey(new Date()) });
    ctx.emit('me:started', { reason, instance });
    return { args, instance };
  }

  ipcMain.handle('me:status', () => status());
  ipcMain.handle('me:setBypassModCheck', (_e, on) => {
    const dir = root();
    ctx.saveSettings({ meBypassModCheck: Boolean(on) });
    if (dir) bypass.apply(dir, Boolean(on));
    return status();
  });
  ipcMain.handle('me:run', async () => {
    try { return await run('manual'); } catch (err) { ctx.emit('me:error', { message: err.message, reason: 'manual' }); throw err; }
  });
  // ---- 任務清單與任務選項（讀寫 MaaEnd 的 config\mxu-MaaEnd.json） ----
  const need = () => {
    const dir = root();
    if (!dir) throw new Error('找不到 MaaEnd');
    return dir;
  };
  const LOCKED = 'MaaEnd 正在執行：它關閉時會用記憶體裡的設定蓋掉這裡的修改，請先關閉 MaaEnd 再調整';
  async function write(fn) {
    const dir = need();
    if (await processRunning(me.EXE)) throw new Error(LOCKED);
    return { ...fn(dir), running: false };
  }
  ipcMain.handle('me:tasks', async (_e, instanceId) => ({ ...meTasks.readDetail(need(), instanceId), running: await processRunning(me.EXE) }));
  ipcMain.handle('me:setTasks', (_e, instanceId, list) => write((dir) => meTasks.setTasks(dir, instanceId, Array.isArray(list) ? list.slice(0, 300) : [])));
  ipcMain.handle('me:setOption', (_e, instanceId, taskId, key, value) => write((dir) => meTasks.setOption(dir, instanceId, taskId, String(key), value)));
  ipcMain.handle('me:addTask', (_e, instanceId, name) => write((dir) => meTasks.addTask(dir, instanceId, String(name))));
  ipcMain.handle('me:removeTask', (_e, instanceId, taskId) => write((dir) => meTasks.removeTask(dir, instanceId, taskId)));

  ipcMain.handle('me:openConfigDir', async () => {
    const dir = root();
    if (!dir) throw new Error('找不到 MaaEnd');
    const file = me.configFile(dir);
    if (fs.existsSync(file)) ctx.shell.showItemInFolder(file); else await ctx.shell.openPath(dir);
  });

  // 從 GitHub 下載官方 Windows 壓縮檔到「下載」資料夾，由使用者自己解壓縮（ModHub 不執行）
  ipcMain.handle('me:downloadPackage', async (e) => {
    const rel = me.pickPackage(await net.fetchJson(`https://api.github.com/repos/${me.REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } }));
    if (!rel) throw new Error('GitHub 最新版裡找不到 MaaEnd 的 Windows 壓縮檔');
    const dest = path.join(ctx.downloadsDir(), net.safeFileName(rel.name));
    const r = await ctx.dialog.showMessageBox(ctx.BrowserWindow.fromWebContents(e.sender), {
      type: 'question',
      title: '下載 MaaEnd',
      message: `下載 ${rel.name}（v${rel.version}，${(rel.size / 1048576).toFixed(0)} MB）？`,
      detail: [
        `來源：${rel.page}`,
        `存到：${dest}`,
        rel.sha256 ? '下載後會比對 GitHub 提供的 SHA-256。' : '',
        '',
        'ModHub 只下載，不會解壓縮或執行；請自己解壓縮到想放的資料夾（例如 C:\\MaaEnd），再回來選資料夾。',
        'MaaEnd 是第三方工具（AGPL-3.0），會模擬操作遊戲，可能違反遊戲條款，風險自負。',
      ].join('\n'),
      buttons: ['下載', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response !== 0) return { cancelled: true };
    await net.download(rel.url, dest, { onProgress: (p) => ctx.emit('me:progress', p) });
    ctx.emit('me:progress', null);
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
    if (running || !od.dueNow(new Date(), schedule(me.options(ctx.getSettings())))) return;
    running = true;
    try {
      await run('schedule');
    } catch (err) {
      ctx.saveSettings({ meLastRunDate: od.dateKey(new Date()) }); // 失敗也記下，今天不再重試
      ctx.emit('me:error', { message: err.message, reason: 'schedule' });
    } finally {
      running = false;
    }
  }, 30000);
  timer.unref?.();

  return { status, run, taskEntry };
}

module.exports = { register, TASK_NAME, schedule };
