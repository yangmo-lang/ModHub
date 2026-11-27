// 抽卡紀錄：IPC、帳號與紀錄存檔（不保存任何 token / authkey）
const fs = require('node:fs');
const path = require('node:path');
const { dialog, shell } = require('electron');
const stats = require('./stats.cjs');
const ef = require('./endfield.cjs');
const zzz = require('./zzz.cjs');

const SUPPORTED = { EFMI: 'endfield', ZZMI: 'zzz' };

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
  const rulesOf = (gameId, records) => (gameId === 'EFMI' ? ef.rulesFor(records) : zzz.rulesFor());

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

  /** 更新：自動從遊戲讀取連結（或使用者貼上的網址），增量下載並合併 */
  ipcMain.handle('gacha:update', async (_e, gameId, opts = {}) => {
    const progress = (p) => ctx.emit('gacha:progress', { gameId, ...p });
    if (gameId === 'EFMI') {
      const auth = opts.url ? ef.parseGachaUrl(opts.url) : ef.findFromLog();
      if (!auth) throw new Error(opts.url ? '這不是終末地的尋訪紀錄網址' : '找不到抽卡連結：請先在遊戲內開啟「尋訪紀錄」頁面');
      progress({ stage: '確認帳號' });
      const role = await ef.queryRole(auth);
      const account = role
        ? { id: `${auth.provider}-${role.id}`, name: role.name, server: role.server || (auth.provider === 'gryphline' ? '國際服' : '官服'), provider: auth.provider }
        : { id: `${auth.provider}-server${auth.serverId}`, name: '', server: auth.provider === 'gryphline' ? '國際服' : '官服', provider: auth.provider };
      const old = load(gameId, account.id);
      const known = new Set((old?.records || []).map((r) => r.id));
      const { records } = await ef.fetchRecords(auth, known, progress);
      const data = { account, updatedAt: Date.now(), records: stats.mergeRecords(old?.records, records) };
      save(gameId, data);
      return { ...view(gameId, data), added: records.length };
    }
    if (gameId === 'ZZMI') {
      let auth;
      if (opts.url) {
        auth = zzz.parseAuthUrl(opts.url);
        if (!auth) throw new Error('這不是絕區零的調頻紀錄網址（需要含 authkey）');
      } else {
        const cands = zzz.findFromCache(zzz.findGameDataDirs(ctx.xxmiRoot()));
        if (!cands.length) throw new Error('找不到調頻紀錄連結：請先在遊戲內開啟「調頻紀錄」頁面');
        progress({ stage: '確認連結' });
        auth = await zzz.pickValid(cands);
      }
      // 先查 uid，才知道要合併到哪個帳號、哪些紀錄已經有了
      progress({ stage: '確認帳號' });
      const uid = (await zzz.probeUid(auth)) || 'unknown';
      const account = { id: uid, name: '', server: auth.region || auth.game_biz, uid };
      const old = load(gameId, account.id);
      const known = new Set((old?.records || []).map((r) => r.id));
      const { records } = await zzz.fetchRecords(auth, known, progress);
      const data = { account: { ...old?.account, ...account }, updatedAt: Date.now(), records: stats.mergeRecords(old?.records, records) };
      save(gameId, data);
      return { ...view(gameId, data), added: records.length };
    }
    throw new Error('這個遊戲還不支援抽卡紀錄');
  });

  ipcMain.handle('gacha:export', async (_e, gameId, accountId) => {
    const d = load(gameId, accountId);
    if (!d) throw new Error('沒有紀錄');
    const r = await dialog.showSaveDialog({ defaultPath: `${gameId}-gacha-${accountId}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify({ app: 'ModHub', game: gameId, exportedAt: new Date().toISOString(), account: d.account, records: d.records }, null, 1));
    return r.filePath;
  });

  ipcMain.handle('gacha:import', async (_e, gameId) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'ModHub 抽卡紀錄 JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (j.app !== 'ModHub' || j.game !== gameId || !Array.isArray(j.records) || !j.account?.id) throw new Error('不是這個遊戲的 ModHub 抽卡紀錄檔');
    const old = load(gameId, j.account.id);
    const data = { account: { ...j.account, ...old?.account }, updatedAt: Date.now(), records: stats.mergeRecords(old?.records, j.records) };
    save(gameId, data);
    return view(gameId, data);
  });

  ipcMain.handle('gacha:official', (_e, gameId) => {
    if (gameId === 'ZZMI') return shell.openExternal(zzz.OFFICIAL_PAGE);
    return null;
  });
}

module.exports = { register, SUPPORTED };
