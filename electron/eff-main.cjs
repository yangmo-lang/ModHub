// EFF（Endfield Framework）的主程序 IPC：狀態、檢查最新版、一鍵安裝 / 更新框架本體
// 純邏輯在 eff.cjs；這裡負責下載、確認視窗與遊戲是否執行中
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const eff = require('./eff.cjs');
const net = require('./net.cjs');
const installer = require('./installer.cjs');
const { parseTasklist } = require('./overlay.cjs');

const LATEST_TTL = 60 * 60 * 1000;

function gameRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      resolve(err ? false : parseTasklist(out).has(eff.GAME_EXE.toLowerCase()));
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
 * @param ctx { getSettings(), userData(), dialog, BrowserWindow, emit(channel, payload) }
 */
function register(ipcMain, ctx) {
  let latest = null; // { at, data, error }

  async function getLatest(force) {
    if (!force && latest && Date.now() - latest.at < LATEST_TTL) return latest;
    try {
      const r = await net.fetchJson(`https://api.github.com/repos/${eff.REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      latest = { at: Date.now(), data: eff.pickRelease(r), error: '' };
    } catch (e) {
      latest = { at: Date.now(), data: latest?.data || null, error: e.message };
    }
    return latest;
  }

  const gameDir = () => eff.resolveGameDir(ctx.getSettings());
  const info = (l) => ({ ...eff.status(gameDir()), pages: eff.PAGES, latest: l?.data || null, latestError: l?.error || '' });

  ipcMain.handle('eff:status', async (_e, opts) => info(opts?.checkLatest ? await getLatest(Boolean(opts.force)) : latest));

  ipcMain.handle('eff:installFramework', async (e) => {
    const dir = gameDir();
    const st = eff.status(dir);
    if (!st.gameFound) throw new Error(`找不到終末地的遊戲資料夾（${dir || '未設定'}）。請到「設定」指定 EFF 遊戲資料夾。`);
    const l = await getLatest(true);
    const rel = l.data;
    if (!rel) throw new Error(`讀不到 EFF 的最新版本${l.error ? `：${l.error}` : ''}`);
    if (await gameRunning()) throw new Error('終末地正在執行中，請先關閉遊戲再安裝 / 更新 EFF');

    const win = ctx.BrowserWindow.fromWebContents(e.sender);
    const action = st.installed ? `更新 EFF：v${st.version || '?'} → v${rel.version}` : `安裝 EFF v${rel.version}`;
    const r = await ctx.dialog.showMessageBox(win, {
      type: 'warning',
      title: 'EFF（Endfield Framework）',
      message: `${action}？`,
      detail: [
        `來源：${rel.page}`,
        `檔案：${rel.name}${rel.sha256 ? '（會比對 GitHub 提供的 SHA-256）' : ''}`,
        `安裝到：${dir}`,
        '',
        '會放入 d3dcompiler_47.dll、vulkan-1.dll（代理 DLL）與 plugin\\ 資料夾；被覆蓋的舊檔先備份到 ModHub 的 backups\\eff。',
        '保留：plugin\\eff.ini（你的設定）、plugin\\mods 裡的 MOD 與 state.ini。',
        '',
        'EFF 是第三方工具（AGPL-3.0），會載入遊戲程序。使用 MOD 可能違反遊戲條款，風險自負。',
      ].join('\n'),
      buttons: [st.installed ? '更新' : '安裝', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (r.response !== 0) return { cancelled: true };

    const work = path.join(ctx.userData(), 'staging', `eff-${crypto.randomUUID()}`);
    try {
      ctx.emit('eff:progress', { step: 'downloading', received: 0, total: rel.size });
      const zip = path.join(work, net.safeFileName(rel.name));
      await net.download(rel.url, zip, { onProgress: (p) => ctx.emit('eff:progress', { step: 'downloading', ...p }) });
      if (rel.sha256) {
        ctx.emit('eff:progress', { step: 'verifying' });
        const got = await sha256File(zip);
        if (got !== rel.sha256) throw new Error('下載的檔案 SHA-256 與 GitHub 不符，已停止安裝');
      }
      ctx.emit('eff:progress', { step: 'extracting' });
      const out = path.join(work, 'x');
      await installer.extractArchive(zip, out);
      const tree = eff.checkFrameworkTree(out);
      if (await gameRunning()) throw new Error('終末地正在執行中，請先關閉遊戲再安裝 / 更新 EFF');
      ctx.emit('eff:progress', { step: 'installing' });
      const backupDir = path.join(ctx.userData(), 'backups', 'eff', `${new Date().toISOString().replace(/[:.]/g, '-')}${st.version ? `-v${st.version}` : ''}`);
      const res = eff.installFramework({ gameDir: dir, sourceRoot: tree.root, files: tree.files, backupDir });
      if (!res.backedUp.length) fs.rmSync(backupDir, { recursive: true, force: true });
      return { ...info(l), installedVersion: rel.version, kept: res.kept, backedUp: res.backedUp.length, backupDir: res.backedUp.length ? backupDir : '' };
    } finally {
      ctx.emit('eff:progress', null);
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
}

module.exports = { register };
