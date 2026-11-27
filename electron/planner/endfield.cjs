// 終末地：akedata（data.akedata.wiki）的遊戲資料表 → 共用養成模型
//
// 用到的資料表：CharGrowthTable、CharLevelUpTable、ItemTable、I18nTextTable_TC、ExpItemDataMap、
//              WeaponBasicTable、WeaponUpgradeTemplateTable、WeaponBreakThroughTemplateTable、WeaponExpItemTable
// 原始表約 20 MB，下載後只保留整理好的精簡結果（planner/endfield-<版本>.json）
const fs = require('node:fs');
const path = require('node:path');
const { fetchJson, UA } = require('../net.cjs');

const CDN = 'https://data.akedata.wiki';
const TABLES = ['CharGrowthTable', 'CharLevelUpTable', 'ItemTable', 'I18nTextTable_TC', 'ExpItemDataMap', 'WeaponBasicTable', 'WeaponUpgradeTemplateTable', 'WeaponBreakThroughTemplateTable', 'WeaponExpItemTable'];
const GOLD = 'item_gold';

// 文字 id 是 64 位元整數，直接 JSON.parse 會失去精度 → 先轉成字串
function safeParse(text) {
  return JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
}

async function fetchTable(versionPath, name) {
  const r = await fetch(`${CDN}/${versionPath}/${name}.json`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`akedata ${name} HTTP ${r.status}`);
  return safeParse(await r.text());
}

const mats = (list) => (list || []).filter((m) => m && m.id && m.count).map((m) => ({ id: String(m.id), count: Number(m.count) }));

/** 從已解析的資料表建立模型（純函式，方便測試） */
function buildFromTables(t, version) {
  const text = (ref) => {
    const id = ref && ref.id !== undefined ? String(ref.id) : '';
    return (id && id !== '0' && t.I18nTextTable_TC[id]) || (ref && ref.text) || '';
  };
  const used = new Set([GOLD]);
  const use = (list) => { for (const m of list) used.add(m.id); return list; };

  // ---- 經驗池 ----
  const pools = {
    efExp1: { label: '作戰紀錄（Lv.1~59）', items: [], currencyId: null },
    efExp2: { label: '認知載體（Lv.60 以上）', items: [], currencyId: null },
    efWeapon: { label: '武器經驗', items: [], currencyId: null },
  };
  for (const [id, x] of Object.entries(t.ExpItemDataMap || {})) {
    const pool = Number(x.expType) === 0 ? 'efExp1' : 'efExp2';
    pools[pool].items.push({ id, exp: Number(x.expGain) });
    used.add(id);
  }
  for (const x of Object.values(t.WeaponExpItemTable || {})) {
    if (x.expItemId && x.itemExp) { pools.efWeapon.items.push({ id: x.expItemId, exp: Number(x.itemExp) }); used.add(x.expItemId); }
  }
  for (const p of Object.values(pools)) p.items.sort((a, b) => b.exp - a.exp);

  // ---- 角色 ----
  const lvRows = Object.entries(t.CharLevelUpTable || {}).map(([lv, r]) => ({ level: Number(lv), exp: Number(r.exp) || 0, gold: Number(r.gold) || 0 })).sort((a, b) => a.level - b.level);
  const charMax = lvRows.length ? lvRows[lvRows.length - 1].level : 90;
  const characters = [];
  for (const [charId, c] of Object.entries(t.CharGrowthTable || {})) {
    if (/9000/.test(charId)) continue; // 劇情用的管理員
    const stages = Object.values(c.charBreakCostMap || {})
      .filter((n) => Number(n.nodeType) === 1)
      .map((n) => ({ stage: Number(n.breakStage), level: Number(/(\d+)$/.exec(n.nodeId)?.[1]) || 0, materials: use(mats(n.requiredItem)) }))
      .filter((s) => s.stage && s.level)
      .sort((a, b) => a.stage - b.stage);
    const skills = Object.entries(c.skillGroupMap || {}).map(([sid, s]) => {
      const rows = (c.skillLevelUp || []).filter((x) => x.skillGroupId === sid);
      const costs = {};
      for (const r of rows) costs[r.level] = use([...mats(r.itemBundle), ...(r.goldCost ? [{ id: GOLD, count: Number(r.goldCost) }] : [])]);
      const kind = /ComboSkill/.test(sid) ? '連攜技' : /NormalAttack/.test(sid) ? '普通攻擊' : /UltimateSkill/.test(sid) ? '終結技' : /NormalSkill/.test(sid) ? '戰技' : '';
      return { id: sid, name: text(s.name) || kind || sid, typeName: kind, minLevel: 1, maxLevel: Math.max(1, ...rows.map((r) => r.level)), costs };
    }).filter((s) => s.maxLevel > 1);
    const nodes = [];
    for (const n of Object.values(c.talentNodeMap || {})) {
      const type = Number(n.nodeType);
      if (type === 1) continue; // 精英化（已在 stages）
      const m = use(mats(n.requiredItem));
      if (!m.length) continue;
      const a = n.attributeNodeInfo || {};
      const ps = n.passiveSkillNodeInfo || {};
      const f = n.factorySkillNodeInfo || {};
      if (type === 2) nodes.push({ id: n.nodeId, name: `裝備欄位 ${String(n.nodeId).replace(/^equipBreakT/, 'T')}`, group: '裝備突破', stage: 0, materials: m });
      else if (type === 3) nodes.push({ id: n.nodeId, name: `${text(a.title) || '屬性'}（精英 ${a.breakStage}）`, group: '屬性節點', stage: Number(a.breakStage) || 0, materials: m });
      else if (type === 4) nodes.push({ id: n.nodeId, name: `${text(ps.name) || '天賦'} Lv.${ps.level}`, group: '天賦', stage: Number(ps.breakStage) || 0, materials: m });
      else if (type === 5) nodes.push({ id: n.nodeId, name: `基建技能 ${Number(f.index) + 1} Lv.${f.level}`, group: '基建技能', stage: Number(f.breakStage) || 0, materials: m });
      else nodes.push({ id: n.nodeId, name: n.nodeId, group: '其他', stage: 0, materials: m });
    }
    const order = { 屬性節點: 1, 天賦: 2, 基建技能: 3, 裝備突破: 4, 其他: 5 };
    nodes.sort((x, y) => order[x.group] - order[y.group] || x.stage - y.stage || x.name.localeCompare(y.name, 'zh-Hant'));
    characters.push({
      game: 'EFMI', kind: 'character', id: charId, name: text(c.name) || c.engName || charId, en: c.engName || '', icon: null, rarity: Number(c.rarity) || null,
      currencyId: GOLD, maxLevel: charMax,
      levels: lvRows.filter((r) => r.level < charMax).map((r) => ({ level: r.level, exp: r.exp, pool: r.level < 60 ? 'efExp1' : 'efExp2', gold: r.gold })),
      stages, skills, nodes,
    });
  }

  // ---- 武器 ----
  const weapons = [];
  for (const [wid, w] of Object.entries(t.WeaponBasicTable || {})) {
    const curve = t.WeaponUpgradeTemplateTable?.[w.levelTemplateId]?.list || [];
    const bt = t.WeaponBreakThroughTemplateTable?.[w.breakthroughTemplateId]?.list || [];
    const maxLevel = Number(w.maxLv) || Math.max(...curve.map((x) => Number(x.weaponLv)), 1);
    const stages = bt
      .filter((b) => Number(b.breakthroughShowLv) > 0)
      .map((b) => ({ stage: Number(b.breakthroughShowLv), level: Number(b.breakthroughLv), materials: use([...mats(b.breakItemList), ...(b.breakthroughGold ? [{ id: GOLD, count: Number(b.breakthroughGold) }] : [])]) }))
      .filter((s) => s.materials.length)
      .sort((a, b) => a.stage - b.stage);
    const item = t.ItemTable?.[wid];
    weapons.push({
      game: 'EFMI', kind: 'weapon', id: wid, name: text(item?.name) || text(w.engName) || wid, en: text(w.engName), icon: null, rarity: Number(w.rarity) || null,
      currencyId: GOLD, maxLevel,
      levels: curve.filter((x) => Number(x.weaponLv) < maxLevel).map((x) => ({ level: Number(x.weaponLv), exp: Number(x.lvUpExp) || 0, pool: 'efWeapon', gold: Number(x.lvUpGold) || 0 })),
      stages, skills: [], nodes: [],
    });
  }

  // ---- 材料目錄（只留用得到的） ----
  const items = {};
  for (const id of used) {
    const it = t.ItemTable?.[id];
    items[id] = { name: text(it?.name) || id, iconId: it?.iconId || id, rarity: Number(it?.rarity) || 1 };
  }
  characters.sort((a, b) => (b.rarity || 0) - (a.rarity || 0) || a.name.localeCompare(b.name, 'zh-Hant'));
  weapons.sort((a, b) => (b.rarity || 0) - (a.rarity || 0) || a.name.localeCompare(b.name, 'zh-Hant'));
  return { version, builtAt: Date.now(), pools, items, characters, weapons };
}

/** 下載最新版資料表並整理（有快取就直接用） */
async function loadEndfield(userDataDir, { force = false, onProgress } = {}) {
  const dir = path.join(userDataDir, 'planner');
  fs.mkdirSync(dir, { recursive: true });
  let manifest = null;
  try { manifest = await fetchJson(`${CDN}/manifest.json`); } catch {}
  const latest = manifest && (manifest.versions || []).find((v) => v.id === manifest.latest);
  const cached = fs.readdirSync(dir).filter((f) => /^endfield-.*\.json$/.test(f)).sort().pop();
  const wantFile = latest ? `endfield-${latest.id.replace(/[^\w.@-]/g, '_')}.json` : cached;
  if (!force && wantFile && fs.existsSync(path.join(dir, wantFile))) return JSON.parse(fs.readFileSync(path.join(dir, wantFile), 'utf8'));
  if (!latest) {
    if (cached) return JSON.parse(fs.readFileSync(path.join(dir, cached), 'utf8'));
    throw new Error('無法取得 akedata 版本資訊');
  }
  const t = {};
  for (let i = 0; i < TABLES.length; i++) {
    onProgress?.({ done: i, total: TABLES.length, table: TABLES[i] });
    t[TABLES[i]] = await fetchTable(latest.tableCfgPath, TABLES[i]);
  }
  onProgress?.({ done: TABLES.length, total: TABLES.length });
  const data = buildFromTables(t, latest.gameVersion || latest.id);
  for (const f of fs.readdirSync(dir)) if (/^endfield-.*\.json$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
  fs.writeFileSync(path.join(dir, wantFile), JSON.stringify(data));
  return data;
}

module.exports = { loadEndfield, buildFromTables, safeParse };
