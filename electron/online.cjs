// 線上瀏覽與下載安裝（GameBanana / Nexus Mods）
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, dialog, shell, safeStorage, BrowserWindow } = require('electron');
const gb = require('./sources/gamebanana.cjs');
const nx = require('./sources/nexus.cjs');
const net = require('./net.cjs');
const installer = require('./installer.cjs');
const scanner = require('./scanner.cjs');

const ALLOWED_EXTERNAL = /^https:\/\/((www\.)?gamebanana\.com|(www\.|next\.)?nexusmods\.com|users\.nexusmods\.com|(hsr|ww|zzz)\.nanoka\.cc|wiki\.skland\.com|www\.skland\.com|ef\.yituliu\.cn|cos\.yituliu\.cn|github\.com|creativecommons\.org|www\.bilibili\.com)\//i;

function register(ipcMain, ctx) {
  // ctx: { getSettings, saveSettings, modsDirFor(gameId), matcherFor(gameId), toTw }
  const ud = () => app.getPath('userData');
  const dirs = () => ({
    downloads: path.join(ud(), 'downloads'),
    staging: path.join(ud(), 'staging'),
    backups: path.join(ud(), 'backups'),
  });
  const jobs = new Map();
  const controllers = new Map();

  const publicJob = (j) => {
    const { analysis, ...rest } = j;
    return { ...rest, analysis: analysis ? { ...analysis, root: undefined } : null };
  };
  const emit = (j) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('jobs:update', publicJob(j));
  };
  const update = (j, patch) => { Object.assign(j, patch); emit(j); };

  // ---- Nexus API 金鑰（用 Windows DPAPI 加密存放） ----
  function getNexusKey() {
    const enc = ctx.getSettings().nexusKeyEnc;
    if (!enc) return null;
    try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { return null; }
  }

  ipcMain.handle('nexus:status', async () => {
    const s = ctx.getSettings();
    return { hasKey: Boolean(s.nexusKeyEnc), user: s.nexusUser || null, premium: Boolean(s.nexusPremium), nxmRegistered: app.isDefaultProtocolClient('nxm', ...protocolArgs()) };
  });

  ipcMain.handle('nexus:setKey', async (_e, key) => {
    key = String(key || '').trim();
    if (!key) throw new Error('請輸入 API 金鑰');
    const info = await nx.validateKey(key);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('此系統無法加密儲存金鑰');
    ctx.saveSettings({ nexusKeyEnc: safeStorage.encryptString(key).toString('base64'), nexusUser: info.name, nexusPremium: info.premium });
    return info;
  });

  ipcMain.handle('nexus:clearKey', () => {
    ctx.saveSettings({ nexusKeyEnc: null, nexusUser: null, nexusPremium: false });
    return true;
  });

  // ---- nxm:// 連結處理（使用者在設定裡按了才註冊） ----
  function protocolArgs() {
    return app.isPackaged ? [process.execPath] : [process.execPath, [path.resolve(app.getAppPath())]];
  }
  ipcMain.handle('nxm:register', () => app.setAsDefaultProtocolClient('nxm', ...protocolArgs()));
  ipcMain.handle('nxm:unregister', () => app.removeAsDefaultProtocolClient('nxm', ...protocolArgs()));

  // ---- 瀏覽 ----
  function installedIndex(gameId) {
    const root = ctx.modsDirFor(gameId);
    const idx = new Map();
    if (!fs.existsSync(root)) return idx;
    for (const m of scanner.scanMods(root).mods) {
      if (m.origin) idx.set(`${m.origin.source}:${m.origin.modId}`, { path: m.path, name: m.name, category: m.category, ...m.origin });
    }
    return idx;
  }

  function annotate(gameId, items) {
    const { guessCharacter } = ctx.matcherFor(gameId);
    const idx = installedIndex(gameId);
    return items.map((it) => {
      const ch = guessCharacter ? guessCharacter(it.category) || guessCharacter(it.name) : null;
      const inst = idx.get(`${it.source}:${it.id}`) || null;
      return {
        ...it,
        suggest: ch ? { charId: ch.id, name: ch.name, nameTw: ch.nameTw } : null,
        installed: inst ? { path: inst.path, name: inst.name, category: inst.category, updatedAt: inst.updatedAt, fileId: inst.fileId, version: inst.version } : null,
        hasUpdate: Boolean(inst && it.updatedAt && inst.updatedAt && it.updatedAt > inst.updatedAt + 60000),
      };
    });
  }

  ipcMain.handle('online:list', async (_e, gameId, source, opts) => {
    const r = source === 'nexus' ? await nx.list(gameId, opts) : await gb.list(gameId, opts);
    return { ...r, items: annotate(gameId, r.items) };
  });

  ipcMain.handle('online:details', async (_e, gameId, source, modId) => {
    const d = source === 'nexus' ? await nx.details(gameId, modId) : await gb.details(modId);
    return annotate(gameId, [d])[0];
  });

  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (!ALLOWED_EXTERNAL.test(String(url))) throw new Error('不允許開啟這個網址');
    return shell.openExternal(url);
  });

  // ---- 下載 → 解壓 → 分析（等待使用者確認） ----
  async function prepare(j, getUrl, { md5, headers } = {}) {
    const ac = new AbortController();
    controllers.set(j.id, ac);
    try {
      let archive = j.localPath;
      if (!archive) {
        update(j, { status: 'downloading' });
        const url = await getUrl();
        archive = path.join(dirs().downloads, j.id, net.safeFileName(j.fileName));
        await net.download(url, archive, {
          signal: ac.signal,
          headers,
          onProgress: (p) => update(j, { received: p.received, total: p.total || j.total }),
        });
        if (md5) {
          update(j, { status: 'verifying' });
          const got = await installer.md5File(archive);
          if (got.toLowerCase() !== md5.toLowerCase()) throw new Error('檔案校驗失敗（MD5 不符），已取消安裝');
        }
        j.archivePath = archive;
      }
      update(j, { status: 'extracting' });
      const staging = installer.newStagingDir(dirs().staging);
      j.stagingDir = staging;
      await installer.extractArchive(archive, staging);
      const analysis = installer.analyze(staging);
      update(j, { status: 'ready', analysis });
    } catch (e) {
      if (ac.signal.aborted) update(j, { status: 'cancelled' });
      else update(j, { status: 'error', error: e.message });
      cleanup(j);
    } finally {
      controllers.delete(j.id);
    }
  }

  function cleanup(j) {
    if (j.stagingDir) fs.rmSync(j.stagingDir, { recursive: true, force: true });
    if (j.archivePath) fs.rmSync(path.dirname(j.archivePath), { recursive: true, force: true });
  }

  function newJob(fields) {
    const j = { id: crypto.randomUUID(), createdAt: Date.now(), received: 0, total: 0, status: 'queued', ...fields };
    jobs.set(j.id, j);
    emit(j);
    return j;
  }

  function suggestFor(gameId, category, name) {
    const { guessCharacter } = ctx.matcherFor(gameId);
    const ch = guessCharacter ? guessCharacter(category || '') || guessCharacter(name || '') : null;
    return ch ? { charId: ch.id, name: ch.name, nameTw: ch.nameTw } : null;
  }

  ipcMain.handle('online:download', async (_e, gameId, source, modId, fileId) => {
    const d = source === 'nexus' ? await nx.details(gameId, modId) : await gb.details(modId);
    const f = d.files.find((x) => x.id === String(fileId));
    if (!f) throw new Error('找不到這個檔案');
    const inst = installedIndex(gameId).get(`${source}:${d.id}`);
    const base = {
      gameId, source, modId: d.id, fileId: f.id, title: d.name, fileName: f.name, total: f.size,
      thumb: d.thumb, suggest: suggestFor(gameId, d.category, d.name), replacePath: inst?.path || null,
      meta: { source, modId: d.id, fileId: f.id, name: d.name, version: f.version || d.version, url: d.url, updatedAt: d.updatedAt, fileName: f.name },
    };
    if (source === 'gamebanana') {
      const j = newJob(base);
      prepare(j, async () => f.downloadUrl, { md5: f.md5 });
      return publicJob(j);
    }
    // Nexus
    const key = getNexusKey();
    const s = ctx.getSettings();
    if (!key || !s.nexusPremium) {
      // 免費會員（或沒設金鑰）只能從網頁按「Mod Manager Download」
      return { needsBrowser: true, pageUrl: f.pageUrl, hasKey: Boolean(key), nxmRegistered: app.isDefaultProtocolClient('nxm', ...protocolArgs()) };
    }
    const fileName = f.name.includes('.') ? f.name : `${f.name}-${f.id}.zip`;
    const j = newJob({ ...base, fileName });
    prepare(j, async () => {
      const url = await nx.downloadLink(d.domain, d.id, f.id, key);
      j.fileName = net.safeFileName(decodeURIComponent(new URL(url).pathname.split('/').pop() || fileName));
      return url;
    });
    return publicJob(j);
  });

  /** 處理 nxm:// 連結（免費會員從網頁按 Mod Manager Download） */
  async function handleNxm(link) {
    const n = nx.parseNxm(link);
    if (!n) return;
    const gameId = nx.gameIdForDomain(n.domain);
    const key = getNexusKey();
    if (!gameId) return dialog.showErrorBox('ModHub', `不支援的遊戲：${n.domain}`);
    if (!key) return dialog.showErrorBox('ModHub', '請先在「設定」輸入 Nexus API 金鑰，再從網頁按 Mod Manager Download。');
    let d = null;
    try { d = await nx.details(gameId, n.modId); } catch {}
    const f = d?.files.find((x) => x.id === n.fileId);
    const inst = installedIndex(gameId).get(`nexus:${n.modId}`);
    const j = newJob({
      gameId, source: 'nexus', modId: n.modId, fileId: n.fileId, title: d?.name || `Nexus #${n.modId}`,
      fileName: `${n.modId}-${n.fileId}.zip`, total: f?.size || 0, thumb: d?.thumb || null,
      suggest: d ? suggestFor(gameId, d.category, d.name) : null, replacePath: inst?.path || null,
      meta: { source: 'nexus', modId: n.modId, fileId: n.fileId, name: d?.name || '', version: f?.version || '', url: d?.url || '', updatedAt: d?.updatedAt || 0 },
    });
    prepare(j, async () => {
      const url = await nx.downloadLink(n.domain, n.modId, n.fileId, key, n);
      j.fileName = net.safeFileName(decodeURIComponent(new URL(url).pathname.split('/').pop() || j.fileName));
      return url;
    });
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); w.webContents.send('jobs:focus', j.id); }
  }

  // ---- 本機壓縮檔安裝（拖曳或選檔） ----
  function localJob(gameId, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!installer.ARCHIVE_EXT.has(ext)) throw new Error('只支援 zip / 7z / rar 壓縮檔');
    const name = path.basename(filePath, ext);
    const j = newJob({
      gameId, source: 'local', title: name, fileName: path.basename(filePath), localPath: filePath,
      total: fs.statSync(filePath).size, suggest: suggestFor(gameId, '', name), replacePath: null,
      meta: null,
    });
    prepare(j);
    return publicJob(j);
  }

  ipcMain.handle('local:pick', async (_e, gameId) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'MOD 壓縮檔', extensions: ['zip', '7z', 'rar'] }] });
    if (r.canceled) return [];
    return r.filePaths.map((p) => localJob(gameId, p));
  });
  ipcMain.handle('local:fromPaths', (_e, gameId, paths) => paths.map((p) => localJob(gameId, p)));

  // ---- 工作清單 / 安裝 / 取消 ----
  ipcMain.handle('jobs:list', () => [...jobs.values()].map(publicJob));

  ipcMain.handle('jobs:cancel', (_e, id) => {
    const j = jobs.get(id);
    if (!j) return false;
    controllers.get(id)?.abort();
    if (['ready', 'error', 'cancelled', 'done'].includes(j.status)) {
      cleanup(j);
      jobs.delete(id);
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('jobs:removed', id);
    }
    return true;
  });

  ipcMain.handle('jobs:install', async (_e, id, opts) => {
    const j = jobs.get(id);
    if (!j || j.status !== 'ready') throw new Error('這個項目還不能安裝');
    const root = ctx.modsDirFor(j.gameId);
    update(j, { status: 'installing' });
    try {
      let categoryDir;
      if (opts.charId) {
        const { c, byId, matchCharacter } = ctx.matcherFor(j.gameId);
        const ch = c && byId.get(String(opts.charId));
        if (!ch) throw new Error('找不到角色資料');
        const existing = fs.readdirSync(root, { withFileTypes: true }).find((d) => d.isDirectory() && matchCharacter(d.name)?.id === ch.id);
        categoryDir = existing ? path.join(root, existing.name) : scanner.createCategory(root, ch.name, ch.avatar);
      } else if (opts.categoryName) {
        categoryDir = scanner.createCategory(root, opts.categoryName, null);
      } else {
        categoryDir = root; // 不分類
      }
      if (opts.disableOthers && categoryDir !== root) {
        for (const e of fs.readdirSync(categoryDir, { withFileTypes: true })) {
          const full = path.join(categoryDir, e.name);
          if (e.isDirectory() && !scanner.isDisabledName(e.name) && full !== j.replacePath) scanner.setModEnabled(root, full, false);
        }
      }
      const target = installer.install({
        modsRoot: root,
        categoryDir,
        analysis: j.analysis,
        folderName: opts.folderName,
        excludeExecutables: opts.excludeExecutables !== false,
        replacePath: opts.replace ? j.replacePath : null,
        backupDir: path.join(dirs().backups, j.gameId),
        meta: j.meta,
      });
      // 壓縮檔裡沒有圖片時，存一張線上預覽圖
      if (!j.analysis.hasImage && j.thumb) {
        try { await net.download(j.thumb, path.join(target, `preview${path.extname(new URL(j.thumb).pathname) || '.jpg'}`)); } catch {}
      }
      cleanup(j);
      update(j, { status: 'done', installedPath: target });
      return target;
    } catch (e) {
      update(j, { status: 'ready', error: e.message });
      throw e;
    }
  });

  // 啟動時清掉上次殘留的暫存
  try { fs.rmSync(dirs().staging, { recursive: true, force: true }); fs.rmSync(dirs().downloads, { recursive: true, force: true }); } catch {}

  return { handleNxm };
}

module.exports = { register };
