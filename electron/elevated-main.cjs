// 免確認啟動（工作排程）的主程序：狀態、建立 / 更新 / 移除、啟動時優先走工作排程
const el = require('./elevated.cjs');

/**
 * @param ctx { entries() → elevated.entry() 的陣列（目前設定下想要的工作） }
 * @returns { status(), start(name, fallback) }
 */
function register(ipcMain, ctx, deps = {}) {
  const query = deps.queryTasks || el.queryTasks;
  const apply = deps.applyTasks || el.applyTasks;
  const run = deps.runTask || el.runTask;

  // 工作排程查詢要開 PowerShell（約 1 秒），短時間內重複啟動時沿用結果
  let cache = null;
  async function existing(force = false) {
    if (!force && cache && Date.now() - cache.at < 30000) return cache.list;
    const list = await query();
    cache = { at: Date.now(), list };
    return list;
  }

  async function status(force = false) {
    let desired = [];
    let entryError = '';
    try { desired = ctx.entries(); } catch (e) { entryError = e.message; }
    try {
      return { ...el.compare(desired, await existing(force)), entryError };
    } catch (e) {
      return { items: desired.map((d) => ({ ...d, state: 'unknown' })), extra: [], any: false, allOk: false, error: `讀不到工作排程：${e.message}`, entryError };
    }
  }

  /**
   * 有對應且命令列相同的工作就用 schtasks /run（不跳 UAC），否則用 fallback（原本的啟動方式，會跳 UAC）
   * @returns 'task' | 'fallback'
   */
  async function start(name, fallback) {
    let ok = false;
    try {
      const desired = ctx.entries().find((d) => d.name === name);
      ok = Boolean(desired) && el.compare([desired], await existing()).items[0].state === 'ok';
    } catch { ok = false; }
    if (ok) {
      try { await run(name); return 'task'; } catch { cache = null; /* 工作被刪掉等：改用原本的方式 */ }
    }
    await fallback();
    return 'fallback';
  }

  ipcMain.handle('elev:status', () => status(true));
  ipcMain.handle('elev:setup', async () => {
    const desired = ctx.entries();
    if (!desired.length) throw new Error('沒有可以設定的程式（找不到 XXMI Launcher、OneDragon 或 MaaEnd）');
    try { await apply(desired, el.currentUserId()); } finally { cache = null; }
    return status(true);
  });
  ipcMain.handle('elev:remove', async () => {
    try { await apply([], el.currentUserId()); } finally { cache = null; }
    return status(true);
  });

  return { status, start };
}

module.exports = { register };
