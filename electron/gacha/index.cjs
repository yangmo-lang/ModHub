// 抽卡紀錄：IPC、帳號與紀錄存檔（不保存任何 token / authkey）
const fs = require('node:fs');
const path = require('node:path');
const { dialog, shell } = require('electron');
const stats = require('./stats.cjs');
const ef = require('./endfield.cjs');
const zzz = require('./zzz.cjs');
const hsr = require('./hsr.cjs');
const login = require('./login.cjs');
const visual = require('./visual.cjs');
const lcx = require('./lcx.cjs');
const { createLcxWindow } = require('./lcx-window.cjs');
const schedule = require('../schedule.cjs');
const { UA } = require('../net.cjs');
const uigf = require('./uigf.cjs');
const { normalizeName, toTw, loadCache: loadCharCache } = require('../characters.cjs');

const SUPPORTED = { SRMI: 'hsr', EFMI: 'endfield', ZZMI: 'zzz' };

// HoYoverse 遊戲（同一套 authkey / getGachaLog / HoYoLAB 登入）
const HOYO = {
  ZZMI: { mod: zzz, game: '絕區零', biz: 'nap_global', host: 'public-operation-nap-sg.hoyoverse.com', official: (r) => login.hoyoOfficial(r), account: true, open: '遊戲內開啟「調頻紀錄」頁面', label: '調頻紀錄' },
  SRMI: { mod: hsr, game: '星穹鐵道', biz: 'hkrpg_global', host: 'public-operation-hkrpg-sg.hoyoverse.com', official: null, account: false, open: '遊戲內開啟「躍遷 → 查看詳情 → 紀錄」頁面', label: '躍遷紀錄' },
};

function register(ipcMain, ctx) {
  // ctx: { userData(), xxmiRoot(), emit(channel, payload) }
  const dir = (gameId) => path.join(ctx.userData(), 'gacha', gameId);
  const file = (gameId, accountId) => path.join(dir(gameId), `${String(accountId).replace(/[^\w.-]/g, '_')}.json`);
  const load = (gameId, accountId) => { try { return JSON.parse(fs.readFileSync(file(gameId, accountId), 'utf8')); } catch { return null; } };
  const save = (gameId, data) => {
    fs.mkdirSync(dir(gameId), { recursive: true });
    const f = file(gameId, data.account.id);
    fs.writeFileSync(f + '.tmp', JSON.stringify(data));
    fs.renameSync(f + '.tmp', f);
  };
  const rulesOf = (gameId, records) => (gameId === 'EFMI' ? ef.rulesFor(records) : HOYO[gameId].mod.rulesFor());

  function accounts(gameId) {
    if (!fs.existsSync(dir(gameId))) return [];
    return fs.readdirSync(dir(gameId)).filter((f) => f.endsWith('.json')).map((f) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir(gameId), f), 'utf8'));
        return { ...d.account, updatedAt: d.updatedAt, count: d.records.length };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function view(gameId, data) {
    return { account: data.account, updatedAt: data.updatedAt, records: data.records, summary: stats.summary(data.records, rulesOf(gameId, data.records)) };
  }

  ipcMain.handle('gacha:supported', () => Object.keys(SUPPORTED));
  ipcMain.handle('gacha:accounts', (_e, gameId) => accounts(gameId));
  ipcMain.handle('gacha:get', (_e, gameId, accountId) => {
    const d = load(gameId, accountId);
    return d ? view(gameId, d) : null;
  });

  // ---- 終末地卡池內容快取（UP 角色、立繪）：存在 _meta 資料夾，不會被當成帳號 ----
  const poolsFile = () => path.join(dir('EFMI'), '_meta', 'pools.json');
  const loadPools = () => { try { return JSON.parse(fs.readFileSync(poolsFile(), 'utf8')); } catch { return {}; } };
  async function refreshPoolInfo(provider, serverId, records) {
    const cache = loadPools();
    const ids = [...new Set(records.map((r) => r.bannerId).filter(Boolean)), 'standard'];
    let changed = false;
    for (const id of ids) {
      const c = cache[id];
      // 查到的不再查；查不到的（舊卡池）一天最多重試一次
      if (c && (c.up6 || c.all6?.length || Date.now() - (c.fetchedAt || 0) < 86400000)) continue;
      const info = await ef.fetchPoolContent(provider, serverId, id);
      cache[id] = info || { missing: true, fetchedAt: Date.now() };
      changed = true;
    }
    if (changed) {
      fs.mkdirSync(path.dirname(poolsFile()), { recursive: true });
      fs.writeFileSync(poolsFile(), JSON.stringify(cache));
    }
  }

  /** 用一組臨時憑證下載某個帳號的新紀錄並合併存檔（保留官方統計等其他欄位） */
  async function pullEndfield(auth, account, progress) {
    const old = load('EFMI', account.id);
    const known = new Set((old?.records || []).map((r) => r.id));
    const { records } = await ef.fetchRecords(auth, known, progress);
    const data = { ...old, account: { ...old?.account, ...account, serverId: auth.serverId }, updatedAt: Date.now(), records: stats.mergeRecords(old?.records, records) };
    save('EFMI', data);
    progress({ stage: '讀取卡池資訊' });
    await refreshPoolInfo(auth.provider, auth.serverId, data.records).catch(() => {});
    return { data, added: records.length };
  }

  async function pullHoyo(gameId, auth, account, progress) {
    const old = load(gameId, account.id);
    const known = new Set((old?.records || []).map((r) => r.id));
    const { records } = await HOYO[gameId].mod.fetchRecords(auth, known, progress);
    const data = { ...old, account: { ...old?.account, ...account }, updatedAt: Date.now(), records: stats.mergeRecords(old?.records, records) };
    save(gameId, data);
    return { data, added: records.length };
  }

  /** 用已登入的官方帳號更新：帳號底下每個角色都更新 */
  async function updateByAccount(gameId, progress) {
    const results = [];
    if (gameId === 'EFMI') {
      for (const provider of ['gryphline', 'hypergryph']) {
        const s = await login.hgRoles(provider).catch(() => null);
        if (!s) continue;
        for (const role of s.roles) {
          progress({ stage: `${role.name || role.roleId}：換取憑證` });
          const token = await login.hgU8Token(provider, role.uid, s.oauth);
          const auth = { provider, token, serverId: role.serverId, lang: 'zh-tw' };
          const account = { id: `${provider}-${role.roleId}`, name: role.name, server: role.server || (provider === 'gryphline' ? '國際服' : '官服'), provider, via: 'account' };
          results.push(await pullEndfield(auth, account, (p) => progress({ ...p, stage: `${role.name}｜${p.stage}` })));
        }
      }
      if (!results.length) throw new Error('沒有已登入的鷹角帳號，或帳號底下沒有終末地角色');
    } else if (HOYO[gameId]) {
      const H = HOYO[gameId];
      // 星鐵：HoYoLAB 產生的 authkey 會被 getGachaLog 拒絕（-100 authkey error），官方工具也只能從遊戲內開啟
      if (!H.account) throw new Error(`${H.game}的${H.label}只能從遊戲讀取：官方不接受 HoYoLAB 登入產生的憑證。請在${H.open}後按「從遊戲更新」，或「貼上網址」`);
      const roles = await login.hoyoRoles(H.biz);
      if (!roles) throw new Error('HoYoLAB 尚未登入或登入已過期，請重新登入');
      if (!roles.length) throw new Error(`這個 HoYoLAB 帳號沒有${H.game}角色`);
      for (const role of roles) {
        progress({ stage: `${role.name || role.uid}：產生${H.label}憑證` });
        const key = await login.hoyoAuthKey(role);
        const auth = { ...key, game_biz: H.biz, region: role.region, lang: 'zh-tw', host: H.host, via: 'account' };
        const account = { id: role.uid, uid: role.uid, name: role.name, server: role.server, region: role.region, via: 'account' };
        const res = await pullHoyo(gameId, auth, account, (p) => progress({ ...p, stage: `${role.name}｜${p.stage}` }));
        // HoYoLAB 官方統計：全部版本的出貨紀錄、UP 判定、目前卡池
        progress({ stage: `${role.name}｜讀取官方統計` });
        try {
          res.data.official = await H.official(role);
          save(gameId, res.data);
        } catch (e) {
          progress({ stage: `官方統計讀取失敗：${e.message}` });
        }
        results.push(res);
      }
    } else {
      throw new Error('這個遊戲還不支援抽卡紀錄');
    }
    const first = results[0];
    return { ...view(gameId, first.data), added: results.reduce((s, r) => s + r.added, 0), accounts: results.length };
  }

  /** 更新：mode = 'account'（官方帳號）、或從遊戲讀取連結 / 使用者貼上的網址 */
  ipcMain.handle('gacha:update', async (_e, gameId, opts = {}) => {
    const progress = (p) => ctx.emit('gacha:progress', { gameId, ...p });
    if (opts.mode === 'account') return updateByAccount(gameId, progress);
    if (gameId === 'EFMI') {
      const auth = opts.url ? ef.parseGachaUrl(opts.url) : ef.findFromLog();
      if (!auth && opts.url) throw new Error('這不是終末地的尋訪紀錄網址');
      // 新版遊戲不再把含 u8_token 的網址寫進 HGWebview.log：日誌裡只剩舊連結（已過期）或沒有。
      // 有登入鷹角帳號時直接改用帳號更新。
      const viaAccount = async (why) => {
        const logged = await Promise.all(['gryphline', 'hypergryph'].map((p) => login.hgRoles(p).catch(() => null)));
        if (logged.some((x) => x?.roles?.length)) {
          progress({ stage: `${why}，改用已登入的鷹角帳號` });
          return updateByAccount(gameId, progress);
        }
        throw new Error(`${why}。新版終末地不再把抽卡連結寫進遊戲日誌，請在上方「官方帳號」登入鷹角通行證後按「用帳號更新」（或貼上網址）`);
      };
      if (!auth) return viaAccount('遊戲日誌裡找不到抽卡連結');
      progress({ stage: '確認帳號' });
      try {
        const role = await ef.queryRole(auth);
        const account = role
          ? { id: `${auth.provider}-${role.id}`, name: role.name, server: role.server || (auth.provider === 'gryphline' ? '國際服' : '官服'), provider: auth.provider }
          : { id: `${auth.provider}-server${auth.serverId}`, name: '', server: auth.provider === 'gryphline' ? '國際服' : '官服', provider: auth.provider };
        // 查不到角色 = 連結多半已過期；不要另外建一個「server2」帳號，先試帳號登入
        if (!role && !opts.url) return viaAccount('遊戲日誌裡的抽卡連結已過期');
        const { data, added } = await pullEndfield(auth, account, progress);
        return { ...view(gameId, data), added };
      } catch (e) {
        if (e.expired && !opts.url) return viaAccount('遊戲日誌裡的抽卡連結已過期');
        throw e;
      }
    }
    if (HOYO[gameId]) {
      const H = HOYO[gameId];
      let auth;
      if (opts.url) {
        auth = H.mod.parseAuthUrl(opts.url);
        if (!auth) throw new Error(`這不是${H.game}的${H.label}網址（需要含 authkey）`);
      } else {
        const cands = H.mod.findFromCache(H.mod.findGameDataDirs(ctx.xxmiRoot()));
        if (!cands.length) {
          const dirs = H.mod.findGameDataDirs(ctx.xxmiRoot());
          throw new Error(dirs.length
            ? `找不到${H.label}連結：請先在${H.open}，等頁面載入後再按「從遊戲更新」${H.account ? '，或改用「登入 HoYoLAB」' : ''}`
            : `找不到${H.game}的遊戲資料夾：請確認遊戲已安裝並至少開過一次（XXMI 設定或遊戲日誌會記錄位置），或用「貼上網址」`);
        }
        progress({ stage: '確認連結' });
        auth = await H.mod.pickValid(cands);
      }
      // 先查 uid，才知道要合併到哪個帳號、哪些紀錄已經有了
      progress({ stage: '確認帳號' });
      const uid = (await H.mod.probeUid(auth)) || 'unknown';
      const old = load(gameId, uid);
      const { data, added } = await pullHoyo(gameId, auth, { id: uid, uid, server: old?.account?.server || auth.region || auth.game_biz }, progress);
      // 有登入 HoYoLAB 且是同一個 uid：順便更新官方統計（每期卡池、UP 判定、全部版本）
      const role = H.official ? (await login.hoyoRoles(H.biz).catch(() => null))?.find((r) => r.uid === uid) : null;
      if (role) {
        progress({ stage: '讀取 HoYoLAB 官方統計' });
        try {
          data.official = await H.official(role);
          data.account = { ...data.account, name: data.account.name || role.name };
          save(gameId, data);
        } catch (e) {
          progress({ stage: `官方統計讀取失敗：${e.message}` });
        }
      }
      return { ...view(gameId, data), added };
    }
    throw new Error('這個遊戲還不支援抽卡紀錄');
  });

  // ---- 圖像化總覽 ----
  async function iconMap(gameId) {
    const map = {};
    try {
      const c = await ctx.getCodex(gameId);
      for (const s of c.sections) for (const it of s.items) {
        if (!it.icon) continue;
        for (const n of [it.name, it.zh, it.en]) if (n) map[normalizeName(toTw(n))] = it.icon;
      }
    } catch {}
    return map;
  }

  // ---- bannerhistory 的卡池歷史（星鐵 / 絕區零）：用來對照每一抽當時的 UP，快取 12 小時，失敗就用舊的 ----
  async function bannerPools(gameId) {
    if (gameId !== 'SRMI' && gameId !== 'ZZMI') return [];
    const f = path.join(dir(gameId), '_meta', 'bannerhistory.json');
    let cache = null;
    try { cache = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    if (cache && Date.now() - cache.fetchedAt < 12 * 3600 * 1000) return cache.pools;
    try {
      const r = await fetch(schedule.bhUrl(gameId), { headers: { 'User-Agent': UA, Accept: 'text/html' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const pools = schedule.parseBannerHistory(await r.text())
        .filter((p) => p.start)
        .map((p) => ({ start: p.start, end: p.end, version: p.version, characters: p.characters.map((c) => ({ name: c.name })) }));
      if (!pools.length) throw new Error('沒有卡池資料');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ fetchedAt: Date.now(), pools }));
      return pools;
    } catch {
      return cache?.pools || [];
    }
  }

  /** 終末地角色的實裝順序（圖鑑快取的 meta.order），名稱用簡繁兩種寫法都對得到 */
  function endfieldOrder() {
    const order = new Map();
    const data = loadCharCache(ctx.userData(), 'EFMI');
    for (const c of data?.characters || []) {
      const o = c.meta?.order;
      if (o == null) continue;
      for (const n of [c.name, c.nameTw, toTw(c.name || '')]) if (n) order.set(normalizeName(n), o);
    }
    return order;
  }

  ipcMain.handle('gacha:visual', async (_e, gameId, accountId) => {
    const d = load(gameId, accountId);
    if (!d) return null;
    if (gameId === 'EFMI') {
      const provider = d.account.provider || 'gryphline';
      const serverId = d.account.serverId || (provider === 'gryphline' ? '2' : '1');
      await refreshPoolInfo(provider, serverId, d.records).catch(() => {});
    }
    const icons = await iconMap(gameId);
    // 官方統計裡的圖示也加進去（逐抽格子用）
    if (d.official?.types) {
      for (const t of Object.values(d.official.types)) for (const p of [...(t.hist || []), ...(t.cur || [])]) {
        for (const x of [...(p.cur_records || []), ...(p.cur_item_list || [])]) if (x.icon && x.name) icons[normalizeName(x.name)] = icons[normalizeName(x.name)] || x.icon;
      }
    }
    let v;
    if (gameId === 'EFMI') {
      const pools = loadPools();
      v = visual.mergeHistory(visual.buildEndfield(d.records, pools, icons), d.history, d.records, icons);
      // 沒有官方 UP 資料的卡池：依常駐名單與角色實裝順序推斷 UP / 歪（包含歪出以前的限定角色）
      v = visual.refineEndfieldUps(v, { standard: pools.standard?.all6 || [], order: endfieldOrder() });
    } else {
      const bhPools = await bannerPools(gameId);
      v = gameId === 'SRMI' ? visual.buildHsr(d.records, icons, { bhPools }) : visual.buildZzz(d.records, d.official, icons, { bhPools });
    }
    v = visual.addUpAverages(v);
    return {
      account: d.account,
      updatedAt: d.updatedAt,
      officialAt: d.official?.fetchedAt || null,
      recordCount: d.records.length,
      recordRange: d.records.length ? [d.records[0].time, d.records[d.records.length - 1].time] : null,
      ...v,
      icons,
    };
  });

  ipcMain.handle('gacha:grid', async (_e, gameId, accountId, opts) => {
    const d = load(gameId, accountId);
    if (!d) return [];
    const icons = await iconMap(gameId);
    return visual.pullGrid(d.records, icons, opts);
  });

  ipcMain.handle('gacha:records', (_e, gameId, accountId) => load(gameId, accountId)?.records || []);

  // ---- 官方帳號登入 ----
  const providersOf = (gameId) => (gameId === 'EFMI' ? ['gryphline', 'hypergryph'] : HOYO[gameId] ? [login.hoyoProviderFor(HOYO[gameId].biz)] : []);
  ipcMain.handle('gacha:loginStatus', async (_e, gameId) => Promise.all(providersOf(gameId).map(async (p) => ({ provider: p, label: login.PROVIDERS[p].label, ...(await login.status(p)) }))));
  ipcMain.handle('gacha:login', async (e, gameId, provider) => {
    if (!providersOf(gameId).includes(provider)) throw new Error('不支援的帳號類型');
    const { BrowserWindow } = require('electron');
    await login.openLogin(provider, BrowserWindow.fromWebContents(e.sender));
    return { provider, label: login.PROVIDERS[provider].label, ...(await login.status(provider)) };
  });
  ipcMain.handle('gacha:logout', async (_e, gameId, provider) => {
    if (!providersOf(gameId).includes(provider)) throw new Error('不支援的帳號類型');
    return login.logout(provider);
  });

  // ---- 離愁軒摘要：在 ModHub 開的視窗裡登入離愁軒，讀取頁面上的卡池卡片 ----
  let lcxWin = null;
  const lcxWindow = () => {
    if (!lcxWin) {
      const { BrowserWindow } = require('electron');
      lcxWin = createLcxWindow({ BrowserWindow, parent: () => BrowserWindow.getAllWindows().find((w) => !w.getParentWindow?.() && w.isVisible()) });
    }
    return lcxWin;
  };
  ipcMain.handle('gacha:lcxOpen', () => { lcxWindow().open(); return true; });
  ipcMain.handle('gacha:lcxClose', () => { lcxWindow().close(); return true; });
  ipcMain.handle('gacha:lcxRead', async () => {
    const data = await lcxWindow().read();
    const r = applyLcx(data.kinds, data.uid);
    lcxWindow().close();
    return { ...r, uid: data.uid, cards: data.cards };
  });

  /** 離愁軒摘要補到終末地帳號：頁面上有 UID 就找同 UID 的帳號，否則用最近更新的帳號；同名卡池以新讀到的為準 */
  function applyLcx(kinds, uid) {
    const list = accounts('EFMI');
    const same = uid ? list.find((a) => String(a.uid || '') === uid || String(a.id).endsWith(`-${uid}`) || String(a.id) === uid) : null;
    const acc = same || list[0];
    if (!acc) throw new Error('請先用帳號更新一次終末地紀錄，再匯入離愁軒摘要');
    const d = load('EFMI', acc.id);
    d.history = lcx.mergeInto(d.history, lcx.parse(kinds));
    save('EFMI', d);
    return { ...view('EFMI', d), lcxAccount: acc.id, uidMatched: Boolean(same) };
  }

  // format: 'modhub'（預設，ModHub 自己的 JSON）| 'uigf'（UIGF v4.0，星鐵 / 絕區零）
  ipcMain.handle('gacha:export', async (_e, gameId, accountId, format = 'modhub') => {
    const d = load(gameId, accountId);
    if (!d) throw new Error('沒有紀錄');
    const asUigf = format === 'uigf';
    if (asUigf && !uigf.GAMES[gameId]) throw new Error('UIGF 只支援星鐵與絕區零');
    const r = await dialog.showSaveDialog({
      defaultPath: asUigf ? `UIGF_${uigf.GAMES[gameId].key}_${accountId}.json` : `${gameId}-gacha-${accountId}.json`,
      filters: [{ name: asUigf ? 'UIGF v4 JSON' : 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const body = asUigf
      ? uigf.toUIGF(gameId, [{ account: d.account, records: d.records }], ctx.appVersion?.() || '')
      : { app: 'ModHub', game: gameId, exportedAt: new Date().toISOString(), account: d.account, records: d.records };
    fs.writeFileSync(r.filePath, JSON.stringify(body, null, 1));
    return r.filePath;
  });

  ipcMain.handle('gacha:import', async (_e, gameId) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: uigf.GAMES[gameId] ? 'ModHub / UIGF / SRGF 抽卡紀錄 JSON' : 'ModHub 抽卡紀錄 JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    let j;
    try { j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { throw new Error('檔案不是有效的 JSON'); }
    // UIGF v4 / SRGF：可能含多個 uid，各自合併到對應帳號
    if (uigf.isUIGF(j)) {
      const blocks = uigf.fromUIGF(gameId, j);
      let last = null;
      let added = 0;
      let skipped = 0;
      for (const b of blocks) {
        const old = load(gameId, b.uid);
        const before = old?.records?.length || 0;
        const data = { ...old, account: { id: b.uid, uid: b.uid, ...old?.account }, updatedAt: Date.now(), records: stats.mergeRecords(old?.records, b.records) };
        save(gameId, data);
        added += data.records.length - before;
        skipped += b.skipped;
        last = data;
      }
      return { ...view(gameId, last), imported: { format: 'UIGF', accounts: blocks.length, added, skipped } };
    }
    // 離愁軒摘要（各池卡片：{ limited, weapon, standard, newbie, joint }）→ 補到最近的終末地帳號
    if (gameId === 'EFMI' && !j.app && (Array.isArray(j.limited) || Array.isArray(j.weapon))) {
      return applyLcx(j, '');
    }
    if (j.app !== 'ModHub' || j.game !== gameId || !Array.isArray(j.records) || !j.account?.id) throw new Error('不是這個遊戲的 ModHub 抽卡紀錄檔');
    const old = load(gameId, j.account.id);
    const data = { ...old, account: { ...j.account, ...old?.account }, updatedAt: Date.now(), records: stats.mergeRecords(old?.records, j.records) };
    save(gameId, data);
    return view(gameId, data);
  });

  ipcMain.handle('gacha:official', (_e, gameId) => {
    if (HOYO[gameId]) return shell.openExternal(HOYO[gameId].mod.OFFICIAL_PAGE);
    return null;
  });
}

module.exports = { register, SUPPORTED };
