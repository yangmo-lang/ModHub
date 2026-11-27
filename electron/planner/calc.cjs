// 養成計算核心（純函式，不碰網路與檔案）
//
// GrowthModel（各遊戲轉接器產生）：
// {
//   game, kind: 'character' | 'weapon', id, name, icon, rarity, currencyId,
//   maxLevel,
//   levels: [{ level, exp, pool, gold }],          // 從 level 升到 level+1 的花費
//   stages: [{ stage, level, materials }],          // 第 stage 次突破，在 level 等級時進行
//   skills: [{ id, name, minLevel, maxLevel, costs: { [lvl]: Material[] } }],   // costs[lvl] = 升到 lvl 的花費
//   nodes:  [{ id, name, group, stage, materials }], // 一次性解鎖（行跡 / 固有 / 節點）
// }
// Material = { id, count }
//
// Config（使用者設定的養成目標）：
// { key, game, kind, id, cur: { level, stage, skills: {id: lvl}, nodes: [id] }, tgt: { 同上 } }

function stageCap(model, stage) {
  const next = model.stages.find((s) => s.stage === stage + 1);
  return next ? next.level : model.maxLevel;
}

/** 某等級至少需要第幾階突破（等級剛好等於突破等級時，可以是未突破也可以已突破） */
function minStageForLevel(model, level) {
  return model.stages.filter((s) => s.level < level).length;
}

function maxStage(model) {
  return model.stages.reduce((m, s) => Math.max(m, s.stage), 0);
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) n = lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** 把目前 / 目標的設定整理成合法範圍（目標不低於目前、等級與突破階段一致） */
function normalizeConfig(model, cfg) {
  const ms = maxStage(model);
  const side = (s, floor) => {
    const level = clamp(s?.level ?? 1, floor?.level ?? 1, model.maxLevel);
    const stage = clamp(s?.stage ?? 0, Math.max(floor?.stage ?? 0, minStageForLevel(model, level)), ms);
    // 突破階段太高但等級不夠時，把等級拉到該階段的下限（突破等級）
    const stageFloorLevel = stage > 0 ? (model.stages.find((x) => x.stage === stage)?.level ?? 1) : 1;
    const lvl = Math.max(level, Math.min(stageFloorLevel, model.maxLevel));
    const skills = {};
    for (const sk of model.skills) {
      const lo = Math.max(sk.minLevel, floor?.skills?.[sk.id] ?? sk.minLevel);
      skills[sk.id] = clamp(s?.skills?.[sk.id] ?? lo, lo, sk.maxLevel);
    }
    const valid = new Set(model.nodes.map((n) => n.id));
    const nodes = [...new Set([...(floor?.nodes || []), ...(s?.nodes || [])])].filter((id) => valid.has(id));
    return { level: lvl, stage, skills, nodes };
  };
  const cur = side(cfg.cur, null);
  const tgt = side(cfg.tgt, cur);
  return { ...cfg, cur, tgt };
}

/** 預設目標：目前全部最低，目標全部最高 */
function defaultConfig(model, key) {
  const skillsMin = Object.fromEntries(model.skills.map((s) => [s.id, s.minLevel]));
  const skillsMax = Object.fromEntries(model.skills.map((s) => [s.id, s.maxLevel]));
  return normalizeConfig(model, {
    key, game: model.game, kind: model.kind, id: model.id,
    cur: { level: 1, stage: 0, skills: skillsMin, nodes: [] },
    tgt: { level: model.maxLevel, stage: maxStage(model), skills: skillsMax, nodes: model.nodes.map((n) => n.id) },
  });
}

function addTo(map, mats, mult = 1) {
  for (const m of mats || []) {
    if (!m || !m.id || !m.count) continue;
    map.set(String(m.id), (map.get(String(m.id)) || 0) + m.count * mult);
  }
}

/** 單一目標的需求：{ materials: Map<id, count>, exp: { pool: amount } } */
function calcEntry(model, rawCfg) {
  const cfg = normalizeConfig(model, rawCfg);
  const materials = new Map();
  const exp = {};
  const { cur, tgt } = cfg;
  for (const row of model.levels) {
    if (row.level >= cur.level && row.level < tgt.level) {
      if (row.exp) exp[row.pool] = (exp[row.pool] || 0) + row.exp;
      if (row.gold && model.currencyId) addTo(materials, [{ id: model.currencyId, count: row.gold }]);
    }
  }
  for (const st of model.stages) if (st.stage > cur.stage && st.stage <= tgt.stage) addTo(materials, st.materials);
  for (const sk of model.skills) {
    const a = cur.skills[sk.id] ?? sk.minLevel;
    const b = tgt.skills[sk.id] ?? a;
    for (let lvl = a + 1; lvl <= b; lvl++) addTo(materials, sk.costs[lvl]);
  }
  const have = new Set(cur.nodes);
  for (const n of model.nodes) if (tgt.nodes.includes(n.id) && !have.has(n.id)) addTo(materials, n.materials);
  return { cfg, materials, exp };
}

/**
 * 經驗換算成經驗道具：先扣掉背包裡的經驗道具，不足的部分用最高級道具補，餘數用最低級道具補滿
 * pool: { items: [{ id, exp, cost? }]（由大到小）, currencyId? }
 */
function convertExp(need, pool, inventory = {}) {
  const items = [...pool.items].sort((a, b) => b.exp - a.exp);
  const ownedExp = items.reduce((s, it) => s + (Number(inventory[it.id]) || 0) * it.exp, 0);
  let remaining = Math.max(0, need - ownedExp);
  const buy = [];
  if (remaining > 0 && items.length) {
    const top = items[0];
    const n = Math.floor(remaining / top.exp);
    if (n) { buy.push({ id: top.id, count: n }); remaining -= n * top.exp; }
    if (remaining > 0) {
      const small = items[items.length - 1];
      const n2 = Math.ceil(remaining / small.exp);
      const same = buy.find((b) => b.id === small.id);
      if (same) same.count += n2;
      else buy.push({ id: small.id, count: n2 });
    }
  }
  // 使用經驗道具時另外花的貨幣（星鐵光錐、鳴潮武器）：每點經驗的花費固定
  const ratio = items[0]?.cost ? items[0].cost / items[0].exp : 0;
  return { need, ownedExp, shortExp: Math.max(0, need - ownedExp), buy, currency: ratio ? Math.ceil(need * ratio) : 0 };
}

/**
 * 彙總多個目標
 * @param entries   [{ model, cfg }]
 * @param pools     { poolId: { label, items, currencyId } }
 * @param inventory { itemId: count }
 */
function summarize(entries, pools, inventory = {}) {
  const total = new Map();
  const usedBy = new Map(); // id → [{ key, name, count }]
  const expNeed = {};
  const perEntry = [];
  for (const { model, cfg } of entries) {
    const r = calcEntry(model, cfg);
    for (const [id, n] of r.materials) {
      total.set(id, (total.get(id) || 0) + n);
      if (!usedBy.has(id)) usedBy.set(id, []);
      usedBy.get(id).push({ key: cfg.key, name: model.name, count: n });
    }
    for (const [pool, n] of Object.entries(r.exp)) expNeed[pool] = (expNeed[pool] || 0) + n;
    perEntry.push({ key: cfg.key, materials: Object.fromEntries(r.materials), exp: r.exp, cfg: r.cfg });
  }
  const exp = Object.entries(expNeed).map(([pool, need]) => {
    const p = pools[pool] || { label: pool, items: [] };
    const conv = convertExp(need, p, inventory);
    if (conv.currency && p.currencyId) {
      total.set(p.currencyId, (total.get(p.currencyId) || 0) + conv.currency);
      if (!usedBy.has(p.currencyId)) usedBy.set(p.currencyId, []);
      usedBy.get(p.currencyId).push({ key: `exp:${pool}`, name: `${p.label}（使用經驗道具）`, count: conv.currency });
    }
    return { pool, label: p.label, items: p.items, ...conv };
  });
  const materials = [...total.entries()].map(([id, need]) => {
    const have = Number(inventory[id]) || 0;
    return { id, need, have, short: Math.max(0, need - have), usedBy: usedBy.get(id) || [] };
  });
  return { materials, exp, perEntry };
}

module.exports = { calcEntry, summarize, convertExp, normalizeConfig, defaultConfig, stageCap, minStageForLevel, maxStage };
