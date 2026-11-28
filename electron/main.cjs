const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, globalShortcut, screen, Tray, Menu, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const scanner = require('./scanner.cjs');
const config = require('./config.cjs');
const chars = require('./characters.cjs');
const skland = require('./skland.cjs');

const charCache = new Map(); // gameId → { data, index }
function getChars(gameId) {
  if (!charCache.has(gameId)) {
    let data = chars.loadCache(app.getPath('userData'), gameId);
    if (data && !data.roleLabel) data = null; // 舊版快取沒有屬性資料 → 需重新同步
    const extra = settings ? config.loadQaqAliases(settings, gameById(gameId)) : [];
    // 沒有英文名的角色（終末地）用 QAQ 別名補上，優先用有空格的寫法（例如 "last rite"）
    if (data) {
      for (const c of data.characters) {
        if (c.en) continue;
        const cands = extra.filter((e) => chars.normalizeName(e.displayName) === chars.normalizeName(c.name) || e.displayName === c.zh);
        const spaced = cands.map((e) => e.alias).filter((a) => /^[a-z0-9 ]+$/i.test(a) && a.includes(' ')).sort((a, b) => b.length - a.length)[0];
        const en = spaced || cands.map((e) => e.en).find(Boolean) || '';
        if (en) c.en = en.replace(/\b\w/g, (m) => m.toUpperCase());
      }
    }
    charCache.set(gameId, data ? { data, index: chars.buildIndex(data.characters, extra) } : null);
  }
  return charCache.get(gameId);
}

const online = require('./online.cjs');
const codex = require('./codex.cjs');
const planner = require('./planner/index.cjs');
const gacha = require('./gacha/index.cjs');
const updater = require('./updater.cjs');
const blueprint = require('./blueprint.cjs');
const presets = require('./presets.cjs');
const launcher = require('./launcher.cjs');
const { createModsWatcher } = require('./watcher.cjs');
const overlayMod = require('./overlay.cjs');
const trayMod = require('./tray.cjs');
const maps = require('./maps.cjs');
const eff = require('./eff.cjs');
const effMain = require('./eff-main.cjs');
const keybinds = require('./keybinds.cjs');
const keyCache = new Map(); // ini 路徑 → 解析過的按鍵（依大小 + 修改時間失效）

const isDev = process.argv.includes('--dev');
let settings;

// 只允許一個 ModHub；第二次啟動（例如點 nxm:// 連結）把參數交給既有視窗
let handleNxm = null;
let mainWin = null;
let overlay = null;
const pendingNxm = [];
const nxmFromArgv = (argv) => argv.filter((a) => /^nxm:\/\//i.test(a));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  pendingNxm.push(...nxmFromArgv(process.argv));
  app.on('second-instance', (_e, argv) => {
    // ModHub.exe --toggle-overlay：叫出 / 收起疊加介面（可綁到搖桿或其他快捷鍵工具）
    if (argv.includes('--toggle-overlay')) { overlay?.toggle(); return; }
    const w = mainWin && !mainWin.isDestroyed() ? mainWin : null;
    if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
    for (const l of nxmFromArgv(argv)) (handleNxm ? handleNxm(l) : pendingNxm.push(l));
  });
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'modimg', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function gameById(id) {
  const g = config.GAMES.find((x) => x.id === id);
  if (!g) throw new Error(`未知遊戲：${id}`);
  return g;
}

// XXMI Launcher 內建的遊戲 logo 圖塊（只讀這個資料夾）
const tilesDir = () => path.join(settings.xxmiRoot, 'Themes', 'Default', 'MainWindow', 'LauncherFrame');
function gameLogo(gameId) {
  const f = path.join(tilesDir(), `game-tile-${gameId.toLowerCase()}.png`);
  return fs.existsSync(f) ? f : null;
}

// 終末地的 EFF：MOD 在遊戲資料夾的 plugin/mods（停用的在 plugin/mods_disabled）
const effGameDir = () => eff.resolveGameDir(settings);
function effRoots() {
  const dir = effGameDir();
  if (!dir) return [];
  const p = eff.effPaths(dir);
  return [p.mods, p.disabled];
}

function allModsRoots() {
  return [
    ...config.GAMES.map((g) => config.modsDirFor(settings, g.id)),
    ...effRoots(),
    path.join(app.getPath('userData'), 'characters'),
    tilesDir(),
  ];
}

function isInsideAnyRoot(p) {
  return allModsRoots().some((root) => {
    try { scanner.assertInside(root, p); return true; } catch { return false; }
  });
}

// 主視窗與疊加介面共用同一份前端，疊加介面用 #overlay
function loadRenderer(win, hash) {
  if (isDev) win.loadURL(`http://localhost:5173/${hash ? `#${hash}` : ''}`);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), hash ? { hash } : undefined);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#14161c',
    title: 'ModHub',
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // 內嵌互動地圖（maps.cjs 限制只能載入地圖網域）
    },
  });
  loadRenderer(win);
  mainWin = win;
  tray?.attach(win, () => quitting);
  // 疊加視窗是隱藏的常駐視窗，主視窗關閉時一起關掉，程式才會結束
  win.on('closed', () => { mainWin = null; overlay?.destroy(); tray?.destroy(); tray = null; });
}

const APP_ICON = path.join(__dirname, 'assets', 'icon.png');
let tray = null;
let quitting = false; // 真的要結束時（系統匣「結束」、更新安裝）主視窗才會關閉，否則縮到系統匣

app.whenReady().then(() => {
  if (!gotLock) return;
  settings = config.loadSettings(app.getPath('userData'));

  // modimg://img/?p=<絕對路徑>  只允許讀取 Mods 目錄內的圖片
  protocol.handle('modimg', (req) => {
    const p = new URL(req.url).searchParams.get('p');
    if (!p || !isInsideAnyRoot(p) || !fs.existsSync(p)) {
      return new Response('not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(p).toString());
  });

  const publicSettings = () => {
    const { nexusKeyEnc, ...rest } = settings;
    return rest;
  };

  ipcMain.handle('state:get', () => ({
    settings: publicSettings(),
    games: config.GAMES.map((g) => ({
      ...g,
      modsDir: config.modsDirFor(settings, g.id),
      available: fs.existsSync(config.modsDirFor(settings, g.id)),
      logo: gameLogo(g.id),
    })),
  }));

  // 介面只能改這些設定；金鑰等由專用 IPC 處理
  const RENDERER_KEYS = new Set(['xxmiRoot', 'qaqRoot', 'lastGame', 'showAdult', 'trayOnMinimize', 'trayOnClose', 'effGameDir']);
  ipcMain.handle('settings:save', (_e, patch) => {
    const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => RENDERER_KEYS.has(k)));
    settings = { ...settings, ...clean };
    config.saveSettings(app.getPath('userData'), settings);
    return publicSettings();
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // 手動對應：settings.manualMap[gameId][資料夾名] = 角色 id，或 '__none__'（不是角色）
  function matcherFor(gameId) {
    const c = getChars(gameId);
    if (!c) return { c: null };
    const manual = settings.manualMap?.[gameId] || {};
    const byId = new Map(c.data.characters.map((x) => [x.id, x]));
    const matchCharacter = (name) => {
      if (Object.prototype.hasOwnProperty.call(manual, name)) {
        return manual[name] === '__none__' ? null : byId.get(manual[name]) || null;
      }
      return chars.matchCharacter(c.index, name);
    };
    return { c, byId, matchCharacter, guessCharacter: (name) => chars.guessCharacter(c.index, name) };
  }

  // ---- 圖鑑 / 前瞻 ----
  ipcMain.handle('codex:get', (_e, gameId, force) => {
    gameById(gameId);
    return codex.getCodex(app.getPath('userData'), gameId, { force: Boolean(force), loadWiki: () => skland.loadWiki({ maxAgeMs: force ? 0 : undefined }), DETAIL: skland.DETAIL });
  });
  const detailCache = new Map();
  ipcMain.handle('codex:detail', async (_e, gameId, kind, id) => {
    const key = `${gameId}:${kind}:${id}`;
    if (!detailCache.has(key)) {
      const c = await codex.getCodex(app.getPath('userData'), gameId, { loadWiki: () => skland.loadWiki(), DETAIL: skland.DETAIL });
      if (!c.versions) return null; // 終末地的說明已在清單資料裡
      detailCache.set(key, await codex.nanokaDetail(gameId, kind, id, c.versions.latest));
    }
    return detailCache.get(key);
  });

  // ---- 養成計算機 ----
  planner.register(ipcMain, {
    userData: () => app.getPath('userData'),
    getCodex: (gameId) => codex.getCodex(app.getPath('userData'), gameId, { loadWiki: () => skland.loadWiki(), DETAIL: skland.DETAIL }),
    loadWiki: () => skland.loadWiki(),
    emit: (channel, payload) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload); },
  });

  // ---- 終末地 AIC 藍圖（終末地一圖流） ----
  blueprint.register(ipcMain, { userData: () => app.getPath('userData') });

  // ---- 自動更新 ----
  updater.register(ipcMain, {
    emit: (channel, payload) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload); },
  });

  // ---- 抽卡紀錄 ----
  gacha.register(ipcMain, {
    userData: () => app.getPath('userData'),
    appVersion: () => app.getVersion(),
    xxmiRoot: () => settings.xxmiRoot,
    getCodex: (gameId) => codex.getCodex(app.getPath('userData'), gameId, { loadWiki: () => skland.loadWiki(), DETAIL: skland.DETAIL }),
    emit: (channel, payload) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload); },
  });

  const onlineApi = online.register(ipcMain, {
    getSettings: () => settings,
    saveSettings: (patch) => {
      settings = { ...settings, ...patch };
      config.saveSettings(app.getPath('userData'), settings);
    },
    modsDirFor: (gameId) => config.modsDirFor(settings, gameById(gameId).id),
    matcherFor,
    effGameDir,
  });

  // ---- EFF 框架本體：狀態、一鍵安裝 / 更新 ----
  effMain.register(ipcMain, {
    getSettings: () => settings,
    userData: () => app.getPath('userData'),
    dialog,
    BrowserWindow,
    emit: (channel, payload) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload); },
  });
  handleNxm = onlineApi.handleNxm;
  for (const l of pendingNxm.splice(0)) handleNxm(l);

  // 掃描選項：介面掃描與預設組合共用，兩邊對「哪些是分類、哪些是 MOD」的判斷才會一致
  const scanOptions = (gameId) => {
    const game = gameById(gameId);
    const { c, matchCharacter, guessCharacter } = matcherFor(gameId);
    return {
      knownCategories: config.loadKnownCategories(settings, game),
      characters: c?.data.characters,
      matchCharacter: c ? matchCharacter : null,
      guessCharacter: c ? guessCharacter : null,
    };
  };

  // 外部（檔案總管等）改動 Mods 資料夾時通知介面；監看的是最近一次掃描的遊戲
  const modsWatcher = createModsWatcher({
    onChange: (gameId) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('mods:changed', { gameId }); },
  });
  app.on('will-quit', () => modsWatcher.stop());

  // 終末地 EFF 的 MOD（gameId = 'EFF'）：角色資料沿用終末地
  function scanEffMods() {
    const dir = effGameDir();
    const st = eff.status(dir);
    const { c, guessCharacter } = matcherFor('EFMI');
    const base = {
      loader: 'eff',
      eff: st,
      modsDir: st.modsDir || '',
      allCharacters: c ? c.data.characters.map((x) => ({ id: x.id, name: x.name, nameTw: x.nameTw, en: x.en, avatar: x.avatar || null, meta: x.meta || {} })) : [],
      charDb: c ? { version: c.data.version, source: c.data.source, roleLabel: c.data.roleLabel, syncedAt: c.data.syncedAt, count: c.data.characters.length } : null,
      charDbSupported: false, // 同步圖鑑在 XXMI 那邊做
    };
    if (!st.gameFound || !fs.existsSync(eff.effPaths(dir).plugin)) {
      modsWatcher.stop();
      return { ...base, missing: true, categories: [], mods: [] };
    }
    modsWatcher.set(eff.EFF_ID, eff.effPaths(dir).plugin); // 一次監看 mods 與 mods_disabled
    const result = eff.scanEff(dir, { characters: c?.data.characters, guessCharacter: c ? guessCharacter : null });
    for (const cat of result.categories) cat.displayName = cat.character ? cat.character.nameTw : chars.toTw(cat.name);
    for (const m of result.mods) m.categoryTw = m.character ? m.character.nameTw : chars.toTw(m.category);
    return { ...base, ...result };
  }

  ipcMain.handle('mods:scan', (_e, gameId) => {
    if (gameId === eff.EFF_ID) return scanEffMods();
    gameById(gameId);
    const modsDir = config.modsDirFor(settings, gameId);
    if (!fs.existsSync(modsDir)) { modsWatcher.stop(); return { modsDir, missing: true, categories: [], mods: [] }; }
    modsWatcher.set(gameId, modsDir);
    const { c } = matcherFor(gameId);
    const result = scanner.scanMods(modsDir, scanOptions(gameId));
    const manual = settings.manualMap?.[gameId] || {};
    for (const cat of result.categories) {
      cat.displayName = cat.character ? cat.character.nameTw : chars.toTw(cat.name);
      cat.manual = Object.prototype.hasOwnProperty.call(manual, cat.name);
    }
    for (const m of result.mods) {
      m.categoryTw = chars.toTw(m.category);
      m.keyCount = keybinds.modKeyBinds(m.path, keyCache).length; // ini 裡的 [Key…] 按鍵數（有快取）
    }
    return {
      modsDir,
      ...result,
      allCharacters: c ? c.data.characters.map((x) => ({ id: x.id, name: x.name, nameTw: x.nameTw, en: x.en, avatar: x.avatar || null, meta: x.meta || {} })) : [],
      charDb: c ? { version: c.data.version, source: c.data.source, roleLabel: c.data.roleLabel, syncedAt: c.data.syncedAt, count: c.data.characters.length } : null,
      charDbSupported: Boolean(chars.SOURCES[gameId]),
    };
  });

  ipcMain.handle('chars:sync', async (e, gameId) => {
    gameById(gameId);
    const data = await chars.syncCharacters(app.getPath('userData'), gameId, {
      onProgress: (p) => e.sender.send('chars:progress', { gameId, ...p }),
      loadEndfield: () => skland.loadEndfield(),
    });
    charCache.delete(gameId);
    return { version: data.version, count: data.characters.length, failed: data.failed };
  });

  ipcMain.handle('chars:setMapping', (_e, gameId, folderName, charId) => {
    gameById(gameId);
    const all = { ...(settings.manualMap || {}) };
    const map = { ...(all[gameId] || {}) };
    if (charId === null || charId === undefined) delete map[folderName];
    else map[folderName] = String(charId);
    all[gameId] = map;
    settings = { ...settings, manualMap: all };
    config.saveSettings(app.getPath('userData'), settings);
    return true;
  });

  ipcMain.handle('mods:moveToCategory', (_e, gameId, modPath, target) => {
    // target: { charId } 移到角色資料夾；或 { categoryName } 移到既有分類
    const root = config.modsDirFor(settings, gameById(gameId).id);
    if (target.charId) {
      const { c, byId, matchCharacter } = matcherFor(gameId);
      const ch = c && byId.get(String(target.charId));
      if (!ch) throw new Error('找不到角色資料，請先同步圖鑑');
      // 若已有對應這個角色的資料夾（例如英文名），就用那個
      const existing = fs.readdirSync(root, { withFileTypes: true })
        .find((d) => d.isDirectory() && matchCharacter(d.name)?.id === ch.id && path.join(root, d.name) !== modPath);
      return scanner.moveModToCategory(root, modPath, existing ? existing.name : ch.name, ch.avatar);
    }
    return scanner.moveModToCategory(root, modPath, target.categoryName, null);
  });

  ipcMain.handle('chars:createCategory', (_e, gameId, charId) => {
    const root = config.modsDirFor(settings, gameById(gameId).id);
    const c = getChars(gameId)?.data.characters.find((x) => x.id === charId);
    if (!c) throw new Error('找不到角色資料，請先同步圖鑑');
    return scanner.createCategory(root, c.name, c.avatar);
  });

  ipcMain.handle('chars:fillCovers', (_e, gameId) => {
    const root = config.modsDirFor(settings, gameById(gameId).id);
    const c = getChars(gameId);
    if (!c) throw new Error('請先同步圖鑑');
    const { categories } = scanner.scanMods(root, { matchCharacter: matcherFor(gameId).matchCharacter });
    let written = 0;
    for (const cat of categories) {
      if (!cat.hasOwnCover && cat.character?.avatar && scanner.writeCover(root, cat.path, cat.character.avatar)) written++;
    }
    return written;
  });

  // MOD 的按鍵設定明細（ini 的 [Key…] 區段）
  ipcMain.handle('mods:keys', (_e, gameId, modPath) => {
    if (gameId === eff.EFF_ID) return [];
    scanner.assertInside(config.modsDirFor(settings, gameById(gameId).id), modPath);
    return keybinds.modKeyBinds(modPath, keyCache);
  });

  ipcMain.handle('mods:setEnabled', (_e, gameId, modPath, enabled) => {
    if (gameId === eff.EFF_ID) return eff.setEnabled(effGameDir(), modPath, Boolean(enabled));
    const root = config.modsDirFor(settings, gameById(gameId).id);
    return scanner.setModEnabled(root, modPath, enabled);
  });

  // 透過 XXMI Launcher 啟動遊戲（opts.gui = 只開 XXMI 視窗）
  ipcMain.handle('xxmi:launch', async (_e, gameId, opts) => {
    const r = await launcher.launch(settings.xxmiRoot, gameById(gameId).id, { gui: Boolean(opts?.gui) });
    return { args: r.args };
  });
  ipcMain.handle('xxmi:available', () => fs.existsSync(launcher.launcherExe(settings.xxmiRoot)));

  // ---------- 預設組合 ----------
  const presetStore = () => presets.createStore(path.join(app.getPath('userData'), 'presets.json'));
  const presetRoot = (gameId) => {
    const root = config.modsDirFor(settings, gameById(gameId).id);
    if (!fs.existsSync(root)) throw new Error(`找不到 Mods 資料夾：${root}`);
    return root;
  };
  const presetSummary = (p) => ({ id: p.id, name: p.name, count: p.enabled.length, createdAt: p.createdAt, updatedAt: p.updatedAt, auto: Boolean(p.auto) });
  const planSummary = (plan) => ({
    toEnable: plan.toEnable.map((m) => m.key),
    toDisable: plan.toDisable.map((m) => m.key),
    missing: plan.missing,
    unchanged: plan.unchanged,
  });

  ipcMain.handle('presets:list', (_e, gameId) => presetStore().list(gameById(gameId).id).map(presetSummary));
  ipcMain.handle('presets:create', (_e, gameId, name) => {
    const root = presetRoot(gameId);
    return presetSummary(presetStore().create(gameId, name, presets.snapshot(root, scanOptions(gameId))));
  });
  // patch: { name } 改名；{ capture: true } 用目前狀態覆蓋
  ipcMain.handle('presets:update', (_e, gameId, id, patch = {}) => {
    gameById(gameId);
    const p = {};
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.capture) p.enabled = presets.snapshot(presetRoot(gameId), scanOptions(gameId));
    return presetSummary(presetStore().update(gameId, id, p));
  });
  ipcMain.handle('presets:remove', (_e, gameId, id) => presetStore().remove(gameById(gameId).id, id));
  ipcMain.handle('presets:preview', (_e, gameId, id) => {
    const root = presetRoot(gameId);
    const p = presetStore().get(gameId, id);
    if (!p) throw new Error('找不到這個組合');
    return planSummary(presets.planApply(root, p.enabled, scanOptions(gameId)));
  });
  ipcMain.handle('presets:apply', (_e, gameId, id) => {
    const root = presetRoot(gameId);
    const store = presetStore();
    const p = store.get(gameId, id);
    if (!p) throw new Error('找不到這個組合');
    const opts = scanOptions(gameId);
    const plan = presets.planApply(root, p.enabled, opts);
    if (!plan.toEnable.length && !plan.toDisable.length) return { enabled: 0, disabled: 0, missing: plan.missing, errors: [] };
    // 套用前先記下目前狀態，套錯了可以用「套用前的狀態」切回來
    if (id !== presets.BACKUP_ID) store.backup(gameId, presets.snapshot(root, opts));
    return presets.applyPlan(root, plan);
  });

  // 刪除 MOD：確認後移到資源回收筒（不做永久刪除）
  ipcMain.handle('mods:trash', async (e, gameId, modPath) => {
    if (gameId === eff.EFF_ID) eff.locate(effGameDir(), modPath);
    else scanner.assertInside(config.modsDirFor(settings, gameById(gameId).id), modPath);
    if (!fs.statSync(modPath).isDirectory()) throw new Error('這不是 MOD 資料夾');
    const name = path.basename(modPath).replace(/^DISABLED_/i, '');
    const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
      type: 'warning',
      title: '刪除 MOD',
      message: `要刪除「${name}」嗎？`,
      detail: `資料夾會移到資源回收筒，需要時可以從資源回收筒還原。

${modPath}`,
      buttons: ['移到資源回收筒', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (r.response !== 0) return false;
    await shell.trashItem(modPath);
    return true;
  });

  ipcMain.handle('shell:open', (_e, gameId, p) => {
    if (gameId === eff.EFF_ID) {
      // EFF：plugin/mods、plugin/mods_disabled 本身或裡面的 MOD
      const roots = effRoots();
      if (roots.some((r) => path.resolve(r) === path.resolve(p))) fs.mkdirSync(p, { recursive: true });
      else eff.locate(effGameDir(), p);
      return shell.openPath(p);
    }
    const root = config.modsDirFor(settings, gameById(gameId).id);
    if (path.resolve(p) !== path.resolve(root)) scanner.assertInside(root, p);
    return shell.openPath(p);
  });

  // ---------- 內嵌互動地圖 ----------
  maps.setupMapWebviews({ app, session, shell });
  ipcMain.handle('maps:list', () => maps.MAPS);

  // ---------- 遊戲內疊加介面（全域快捷鍵） ----------
  overlay = overlayMod.createOverlay({
    BrowserWindow, globalShortcut, screen,
    preload: path.join(__dirname, 'preload.cjs'),
    load: loadRenderer,
    currentGame: () => settings.lastGame || 'SRMI',
  });
  const savedHotkey = settings.overlayHotkey ?? overlayMod.DEFAULT_HOTKEY;
  let hotkeyError = '';
  try { overlay.setHotkey(savedHotkey); } catch (e) { hotkeyError = e.message; }
  ipcMain.handle('overlay:getHotkey', () => ({ hotkey: overlay.hotkey, saved: savedHotkey, default: overlayMod.DEFAULT_HOTKEY, error: hotkeyError }));
  ipcMain.handle('overlay:setHotkey', (_e, key) => {
    const hotkey = overlay.setHotkey(String(key ?? ''));
    hotkeyError = '';
    settings = { ...settings, overlayHotkey: hotkey };
    config.saveSettings(app.getPath('userData'), settings);
    tray?.refreshMenu();
    return hotkey;
  });
  ipcMain.handle('overlay:suspend', (_e, on) => overlay.suspend(Boolean(on)));
  ipcMain.handle('overlay:hide', () => overlay.hide());
  ipcMain.handle('overlay:setWide', (_e, on) => overlay.setWide(Boolean(on)));
  ipcMain.handle('overlay:openMain', () => {
    overlay.hide();
    if (mainWin && !mainWin.isDestroyed()) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  // ---------- 系統匣 ----------
  tray = trayMod.createTray({
    Tray, Menu,
    icon: path.join(__dirname, 'assets', 'tray.png'),
    getWindow: () => mainWin,
    getSettings: () => settings,
    getHotkey: () => overlay?.hotkey || '',
    games: config.GAMES.map((g) => ({ id: g.id, name: g.name, short: g.short })),
    onLaunch: (gameId, opts) => launcher.launch(settings.xxmiRoot, gameById(gameId).id, { gui: Boolean(opts?.gui) }),
    onOverlay: () => overlay?.show(),
    onQuit: () => { quitting = true; app.quit(); },
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());

// 關閉前把官方帳號登入分區的 cookie 寫回磁碟（Chromium 預設延遲寫入，太快關閉會遺失登入）
let flushed = false;
app.on('before-quit', (e) => {
  quitting = true;
  if (flushed) return;
  e.preventDefault();
  flushed = true;
  const login = require('./gacha/login.cjs');
  Promise.race([login.flushAll(), new Promise((r) => setTimeout(r, 2000))]).finally(() => app.quit());
});
