// 養成計算機：IPC 與資料快取
const fs = require('node:fs');
const path = require('node:path');
const calc = require('./calc.cjs');
const nanoka = require('./nanoka.cjs');
const endfield = require('./endfield.cjs');
const { normalizeName, toTw } = require('../characters.cjs');

function register(ipcMain, ctx) {
  // ctx: { userData(), getCodex(gameId), loadWiki() }
  const plansFile = () => path.join(ctx.userData(), 'planner', 'plans.json');
  const iconsFile = () => path.join(ctx.userData(), 'planner', 'endfield-icons.json');
  const models = new Map(); // `${game}:${kind}:${id}` → model
  const catalogs = new Map(); // game → { at, items }
  let efData = null;
  let efLoading = null;

  const readPlans = () => { try { return JSON.parse(fs.readFileSync(plansFile(), 'utf8')); } catch { return {}; } };
  const writePlans = (all) => { fs.mkdirSync(path.dirname(plansFile()), { recursive: true }); fs.writeFileSync(plansFile(), JSON.stringify(all, null, 1)); };

  // ---------- 終末地資料 ----------
  async function ef(force = false) {
    if (efData && !force) return efData;
    if (!efLoading) {
      efLoading = endfield.loadEndfield(ctx.userData(), { force, onProgress: (p) => ctx.emit('planner:progress', { gameId: 'EFMI', ...p }) })
        .then((d) => { efData = d; return d; })
        .finally(() => { efLoading = null; });
    }
    return efLoading;
  }

  /** 終末地圖示：森空島 wiki 的干員 / 武器 / 物品目錄，用名稱對應（有快取） */
  function readEfIcons() { try { return JSON.parse(fs.readFileSync(iconsFile(), 'utf8')); } catch { return null; } }
  async function efIcons({ refresh = false } = {}) {
    const cached = readEfIcons();
    if (cached && !refresh) return cached;
    try {
      const w = await ctx.loadWiki();
      const map = {};
      // 干員、武器、物品、貴重品庫…都可能有材料圖示；排除影音與情報類
      const skip = new Set(['游戏视频', '游戏壁纸', '情报资讯']);
      const prefer = ['干员', '武器', '物品'];
      const cats = [...w.catalogs].filter((c) => !skip.has(c.sub)).sort((a, b) => (prefer.includes(b.sub) ? 1 : 0) - (prefer.includes(a.sub) ? 1 : 0));
      for (const cat of cats) {
        for (const it of cat.items) {
          const k = normalizeName(toTw(it.name));
          if (it.cover && !map[k]) map[k] = it.cover;
        }
      }
      fs.mkdirSync(path.dirname(iconsFile()), { recursive: true });
      fs.writeFileSync(iconsFile(), JSON.stringify(map));
      return map;
    } catch {
      return cached || {};
    }
  }
  const iconFor = (icons, name) => icons[normalizeName(name)] || null;

  // ---------- 清單 / 模型 / 材料目錄 ----------
  async function entities(gameId) {
    if (gameId === 'EFMI') {
      const d = await ef();
      const icons = await efIcons();
      const pick = (m) => ({ kind: m.kind, id: m.id, name: m.name, en: m.en, rarity: m.rarity, icon: iconFor(icons, m.name) });
      return [...d.characters.map(pick), ...d.weapons.map(pick)];
    }
    const c = await ctx.getCodex(gameId);
    const out = [];
    for (const s of c.sections) {
      const kind = s.kind === 'character' ? 'character' : ['lightcone', 'weapon'].includes(s.kind) ? 'weapon' : null;
      if (!kind) continue;
      for (const it of s.items) out.push({ kind, id: it.id, name: it.name, en: it.en, rarity: it.rarity, rarityLabel: it.rarityLabel, element: it.element, role: it.role, icon: it.icon, preview: it.preview });
    }
    return out;
  }

  async function model(gameId, kind, id) {
    const key = `${gameId}:${kind}:${id}`;
    if (models.has(key)) return models.get(key);
    let m;
    if (gameId === 'EFMI') {
      const d = await ef();
      const icons = await efIcons();
      m = (kind === 'character' ? d.characters : d.weapons).find((x) => x.id === id);
      if (!m) throw new Error('找不到這個養成目標');
      m = { ...m, icon: iconFor(icons, m.name) };
    } else {
      const c = await ctx.getCodex(gameId);
      const section = c.sections.find((s) => (kind === 'character' ? s.kind === 'character' : ['lightcone', 'weapon'].includes(s.kind)));
      const meta = section?.items.find((x) => x.id === String(id)) || {};
      m = await nanoka.buildModel(gameId, kind, id, c.versions.latest, { name: meta.name, icon: meta.icon, rarity: meta.rarity });
    }
    models.set(key, m);
    return m;
  }

  async function catalog(gameId) {
    const hit = catalogs.get(gameId);
    if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.items;
    let items;
    if (gameId === 'EFMI') {
      const d = await ef();
      const icons = await efIcons();
      items = Object.fromEntries(Object.entries(d.items).map(([id, it]) => [id, { name: it.name, rarity: it.rarity, icon: iconFor(icons, it.name) }]));
    } else {
      const c = await ctx.getCodex(gameId);
      items = await nanoka.itemCatalog(gameId, c.versions.latest);
    }
    catalogs.set(gameId, { at: Date.now(), items });
    return items;
  }

  async function pools(gameId) {
    if (gameId === 'EFMI') return (await ef()).pools;
    return nanoka.expPools(gameId);
  }

  // ---------- IPC ----------
  ipcMain.handle('planner:entities', (_e, gameId) => entities(gameId));
  ipcMain.handle('planner:model', (_e, gameId, kind, id) => model(gameId, kind, id));
  ipcMain.handle('planner:get', (_e, gameId) => readPlans()[gameId] || { entries: [], inventory: {} });
  ipcMain.handle('planner:save', (_e, gameId, plan) => {
    const all = readPlans();
    all[gameId] = { entries: Array.isArray(plan?.entries) ? plan.entries : [], inventory: plan?.inventory && typeof plan.inventory === 'object' ? plan.inventory : {} };
    writePlans(all);
    return true;
  });
  ipcMain.handle('planner:default', async (_e, gameId, kind, id) => calc.defaultConfig(await model(gameId, kind, id), `${kind}:${id}:${Date.now().toString(36)}`));
  ipcMain.handle('planner:calc', async (_e, gameId, plan) => {
    const list = [];
    for (const cfg of plan.entries || []) {
      try { list.push({ model: await model(gameId, cfg.kind, cfg.id), cfg }); } catch {}
    }
    const p = await pools(gameId);
    const result = calc.summarize(list, p, plan.inventory || {});
    const items = await catalog(gameId);
    const expItemIds = new Set(Object.values(p).flatMap((x) => x.items.map((i) => i.id)));
    const info = (id) => items[id] || { name: id, icon: null, rarity: 1 };
    return {
      materials: result.materials
        .map((m) => ({ ...m, ...info(m.id) }))
        .sort((a, b) => (b.short > 0) - (a.short > 0) || (b.rarity || 0) - (a.rarity || 0) || b.need - a.need),
      exp: result.exp.map((x) => ({
        ...x,
        items: x.items.map((i) => ({ ...i, ...info(i.id), have: Number(plan.inventory?.[i.id]) || 0 })),
        buy: x.buy.map((b) => ({ ...b, ...info(b.id) })),
      })),
      perEntry: result.perEntry.map((e) => ({ key: e.key, cfg: e.cfg, exp: e.exp, materials: Object.entries(e.materials).map(([id, count]) => ({ id, count, ...info(id) })) })),
      expItemIds: [...expItemIds],
      notes: [...new Set(list.flatMap((x) => x.model.notes || []))],
    };
  });
  // 從 HoYoLAB 同步目前進度（星鐵、絕區零）與背包（星鐵）；不修改存檔，回傳結果讓介面套用
  ipcMain.handle('planner:hoyoSync', async (_e, gameId, plan) => {
    const login = require('../gacha/login.cjs');
    const hoyosync = require('./hoyosync.cjs');
    const biz = gameId === 'SRMI' ? 'hkrpg_global' : gameId === 'ZZMI' ? 'nap_global' : null;
    if (!biz) throw new Error('這個遊戲沒有 HoYoLAB 同步');
    const roles = await login.hoyoRoles(biz);
    if (!roles) throw new Error('HoYoLAB 尚未登入：請到「抽卡紀錄」的「官方帳號」登入 HoYoLAB');
    if (!roles.length) throw new Error(`這個 HoYoLAB 帳號沒有綁定${gameId === 'SRMI' ? '星鐵' : '絕區零'}角色`);
    const args = {
      roles,
      fetchJson: login.hoyoFetchJson,
      entries: plan.entries || [],
      modelOf: (e) => model(gameId, e.kind, e.id),
      onProgress: (stage) => ctx.emit('planner:progress', { gameId, stage, done: 0, total: 1 }),
    };
    return gameId === 'SRMI' ? hoyosync.hsrSync(args) : hoyosync.zzzSync(args);
  });

  ipcMain.handle('planner:refresh', async (_e, gameId) => {
    models.clear();
    catalogs.delete(gameId);
    if (gameId === 'EFMI') { await ef(true); await efIcons({ refresh: true }); }
    return true;
  });
}

module.exports = { register };
