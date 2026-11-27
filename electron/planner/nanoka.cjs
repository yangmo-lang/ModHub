// 星鐵 / 鳴潮 / 絕區零：nanoka.cc 的詳細資料 → 共用養成模型
const path = require('node:path');
const { fetchJson } = require('../net.cjs');
const { toTw } = require('../characters.cjs');
const C = require('./exp-constants.json');

const BASE = 'https://static.nanoka.cc';
const GAME = { SRMI: 'hsr', WWMI: 'ww', ZZMI: 'zzz' };

const clean = (s) => toTw(String(s ?? '').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').replace(/\\n/g, ' ').trim());
const wwAsset = (p) => {
  const m = /^\/Game\/Aki\/UI\/(.+?)(\.[^/]+)?$/.exec(p || '');
  return m ? `${BASE}/assets/ww/${m[1]}.webp` : null;
};
const zzzAsset = (p) => (p ? `${BASE}/assets/zzz/${path.basename(String(p), path.extname(String(p)))}.webp` : null);
const HSR_RARITY = { Normal: 1, NotNormal: 2, Rare: 3, VeryRare: 4, SuperRare: 5 };

/** 各遊戲的經驗池：哪些道具、每個給多少經驗、使用時花多少貨幣 */
function expPools(gameId) {
  if (gameId === 'SRMI') {
    return {
      hsrChar: { label: '角色經驗', items: C.hsr.charExpItems, currencyId: C.hsr.currencyId },
      hsrLc: { label: '光錐經驗', items: C.hsr.lcExpItems, currencyId: C.hsr.currencyId },
    };
  }
  if (gameId === 'WWMI') {
    return {
      wwChar: { label: '角色經驗', items: C.ww.charExpItems, currencyId: C.ww.currencyId },
      wwWeapon: { label: '武器經驗', items: C.ww.weaponExpItems, currencyId: C.ww.currencyId },
    };
  }
  return {
    zzzChar: { label: '代理人經驗', items: C.zzz.charExpItems, currencyId: C.zzz.currencyId },
    zzzWeapon: { label: '音擎經驗', items: C.zzz.weaponExpItems, currencyId: C.zzz.currencyId },
  };
}

/** 材料目錄：id → { name, icon, rarity } */
async function itemCatalog(gameId, version) {
  const game = GAME[gameId];
  const raw = await fetchJson(`${BASE}/${game}/${encodeURIComponent(version)}/zh/item.json`);
  const out = {};
  for (const [id, it] of Object.entries(raw)) {
    if (game === 'hsr') out[id] = { name: toTw(it.item_name), icon: `${BASE}/assets/hsr/itemfigures/${id}.webp`, rarity: HSR_RARITY[it.rarity] || 1 };
    else if (game === 'ww') out[id] = { name: toTw(it.name), icon: wwAsset(it.icon), rarity: it.rank || 1 };
    else out[id] = { name: toTw(it.name), icon: zzzAsset(it.icon), rarity: it.rank || 1 };
  }
  return out;
}

const hsrMats = (list) => (list || []).map((m) => ({ id: String(m.item_id), count: m.item_num }));
const wwMats = (list) => (list || []).map((m) => ({ id: String(m.key), count: m.value }));
const zzzMats = (obj) => Object.entries(obj || {}).map(([id, count]) => ({ id: String(id), count: Number(count) }));
const zzzMatString = (s) => String(s || '').split(',').filter(Boolean).map((p) => { const [id, n] = p.split(':'); return { id, count: Number(n) }; });

// ---------------- 星鐵 ----------------
function hsrCharacter(id, d, meta) {
  const caps = [20, 30, 40, 50, 60, 70];
  const stages = [];
  // stats[p].cost = 從第 p 階突破到第 p+1 階的花費（在 caps[p] 等級時）
  for (let p = 0; p < 6; p++) {
    const mats = hsrMats(d.stats?.[p]?.cost);
    if (mats.length) stages.push({ stage: p + 1, level: caps[p], materials: mats });
  }
  const skills = [];
  const nodes = [];
  for (const [key, pt] of Object.entries(d.skill_trees || {})) {
    const first = pt['1'];
    if (!first) continue;
    if (first.max_level > 1) {
      const skillId = first.level_up_skill_id?.[0];
      const sk = d.skills?.[skillId];
      const costs = {};
      for (let lvl = 2; lvl <= first.max_level; lvl++) costs[lvl] = hsrMats(pt[lvl]?.material_list);
      skills.push({ id: key, name: clean(sk?.name) || key, typeName: clean(sk?.type_name), minLevel: 1, maxLevel: first.max_level, costs });
    } else if (first.material_list?.length) {
      const stat = (first.status_add_list || [])[0];
      const statName = stat ? clean(stat.name || stat.property_name || '') : '';
      nodes.push({
        id: key,
        name: clean(first.point_name) || statName || '屬性加成',
        group: first.point_name ? '行跡' : '屬性加成',
        stage: first.avatar_promotion_limit || 0,
        materials: hsrMats(first.material_list),
      });
    }
  }
  return {
    game: 'SRMI', kind: 'character', id: String(id), name: meta.name || clean(d.name), icon: meta.icon, rarity: meta.rarity,
    currencyId: C.hsr.currencyId, maxLevel: 80,
    levels: C.hsr.charCurve.slice(0, 79).map((exp, i) => ({ level: i + 1, exp, pool: 'hsrChar', gold: 0 })),
    stages, skills, nodes,
    notes: ['角色升級時消耗的信用點未計入（遊戲資料未提供）'],
  };
}

function hsrLightcone(id, d, meta) {
  const rarity = Number(/(\d)$/.exec(d.rarity || '')?.[1]) || meta.rarity || 3;
  const curve = C.hsr.lcCurves[C.hsr.lcExpTypeByRarity[rarity]] || [];
  const stages = [];
  const entries = Object.values(d.stats || {});
  entries.forEach((s, p) => {
    const mats = hsrMats(s.promotion_cost_list);
    if (mats.length) stages.push({ stage: p + 1, level: s.max_level, materials: mats });
  });
  const maxLevel = Math.max(...entries.map((s) => s.max_level || 0), 80);
  return {
    game: 'SRMI', kind: 'weapon', id: String(id), name: meta.name || clean(d.name), icon: meta.icon, rarity,
    currencyId: C.hsr.currencyId, maxLevel,
    levels: curve.slice(0, maxLevel - 1).map((exp, i) => ({ level: i + 1, exp, pool: 'hsrLc', gold: 0 })),
    stages, skills: [], nodes: [],
  };
}

// ---------------- 鳴潮 ----------------
const WW_CAPS = [20, 40, 50, 60, 70, 80];

function wwCharacter(id, d, meta) {
  const stages = [];
  Object.keys(d.ascensions || {}).sort((a, b) => a - b).forEach((k, i) => {
    const mats = wwMats(d.ascensions[k]);
    if (mats.length && i < 6) stages.push({ stage: i + 1, level: WW_CAPS[i], materials: mats });
  });
  const skills = [];
  const nodes = [];
  for (const [key, n] of Object.entries(d.skill_trees || {})) {
    const s = n.skill || {};
    if (n.node_type === 1 || n.node_type === 2) {
      const lv = Object.keys(s.consume || {}).map(Number);
      if (!lv.length || Math.max(...lv) <= 1) continue;
      const costs = {};
      for (const l of lv) costs[l] = wwMats(s.consume[l]);
      skills.push({ id: key, name: clean(s.name), typeName: clean(s.type), minLevel: 1, maxLevel: Math.max(...lv), costs });
    } else if ((n.node_type === 3 && (n.parent_nodes || []).length) || n.node_type === 4) {
      const mats = wwMats(n.consume);
      if (!mats.length) continue;
      const param = Array.isArray(s.param) ? s.param.flat().find((x) => typeof x === 'string' && /%|\d/.test(x)) : '';
      nodes.push({ id: key, name: clean(s.name) + (n.node_type === 4 && param ? ` ${param}` : ''), group: n.node_type === 4 ? '屬性加成' : '固有技能', stage: 0, materials: mats });
    }
  }
  return {
    game: 'WWMI', kind: 'character', id: String(id), name: meta.name || clean(d.name), icon: meta.icon, rarity: d.rarity || meta.rarity,
    currencyId: C.ww.currencyId, maxLevel: 90,
    // level_exp[L] = 從 L 級升到 L+1 級
    levels: Array.from({ length: 89 }, (_, i) => ({ level: i + 1, exp: d.level_exp?.[i + 1] || 0, pool: 'wwChar', gold: 0 })),
    stages, skills, nodes,
    notes: ['角色升級時消耗的貝幣未計入（遊戲資料未提供）'],
  };
}

function wwWeapon(id, d, meta) {
  const rarity = d.rarity || meta.rarity || 1;
  const curve = C.ww.weaponCurves[C.ww.weaponLevelIdByQuality[rarity] || rarity] || [];
  const stages = [];
  Object.keys(d.ascensions || {}).sort((a, b) => a - b).forEach((k, i) => {
    const mats = wwMats(d.ascensions[k]);
    if (mats.length && i < 6) stages.push({ stage: i + 1, level: WW_CAPS[i], materials: mats });
  });
  return {
    game: 'WWMI', kind: 'weapon', id: String(id), name: meta.name || clean(d.name), icon: meta.icon, rarity,
    currencyId: C.ww.currencyId, maxLevel: 90,
    levels: curve.slice(0, 89).map((exp, i) => ({ level: i + 1, exp, pool: 'wwWeapon', gold: 0 })),
    stages, skills: [], nodes: [],
  };
}

// ---------------- 絕區零 ----------------
const ZZZ_SKILL = { basic: '普通攻擊', dodge: '閃避', special: '特殊技', chain: '連攜技', assist: '支援技' };

function zzzCharacter(id, d, meta) {
  const entries = Object.values(d.level || {});
  const stages = [];
  entries.forEach((e, i) => {
    const mats = zzzMats(e.materials);
    if (mats.length) stages.push({ stage: i + 1, level: e.level_max, materials: mats });
  });
  const maxLevel = Math.max(...entries.map((e) => e.level_max || 0), 60);
  const skills = Object.entries(d.skill || {}).map(([key, s]) => {
    const costs = {};
    const lv = Object.keys(s.material || {}).map(Number);
    // material[n] = 從 n 級升到 n+1 級
    for (const n of lv) costs[n + 1] = zzzMats(s.material[n]);
    return { id: key, name: ZZZ_SKILL[key] || key, minLevel: 1, maxLevel: Math.max(...lv, 1), costs };
  });
  if (d.passive?.materials) {
    const costs = {};
    const lv = Object.keys(d.passive.materials).map(Number);
    for (const n of lv) costs[n + 1] = zzzMats(d.passive.materials[n]);
    skills.push({ id: 'core', name: '核心技', minLevel: 1, maxLevel: Math.max(...lv) + 1, costs });
  }
  return {
    game: 'ZZMI', kind: 'character', id: String(id), name: meta.name || clean(d.name), icon: meta.icon, rarity: meta.rarity,
    currencyId: C.zzz.currencyId, maxLevel,
    levels: Array.from({ length: maxLevel - 1 }, (_, i) => ({ level: i + 1, exp: d.level_exp?.[i] || 0, pool: 'zzzChar', gold: 0 })),
    stages, skills, nodes: [],
    notes: ['代理人升級時消耗的丁尼未計入（遊戲資料未提供）'],
  };
}

function zzzWeapon(id, d, meta) {
  const caps = [10, 20, 30, 40, 50];
  const stages = String(d.materials || '').split('|').map((part, i) => ({ stage: i + 1, level: caps[i], materials: zzzMatString(part) })).filter((s) => s.materials.length && s.level);
  const maxLevel = 60;
  return {
    game: 'ZZMI', kind: 'weapon', id: String(id), name: meta.name || clean(d.name), icon: meta.icon, rarity: meta.rarity,
    currencyId: C.zzz.currencyId, maxLevel,
    levels: Array.from({ length: maxLevel - 1 }, (_, i) => ({ level: i + 1, exp: d.level?.[i + 1]?.exp || 0, pool: 'zzzWeapon', gold: 0 })),
    stages, skills: [], nodes: [],
  };
}

const BUILDERS = {
  hsr: { character: ['character', hsrCharacter], weapon: ['lightcone', hsrLightcone] },
  ww: { character: ['character', wwCharacter], weapon: ['weapon', wwWeapon] },
  zzz: { character: ['character', zzzCharacter], weapon: ['weapon', zzzWeapon] },
};

/** 讀取一個角色 / 武器的養成模型 */
async function buildModel(gameId, kind, id, version, meta = {}) {
  const game = GAME[gameId];
  const [file, build] = BUILDERS[game][kind];
  const d = await fetchJson(`${BASE}/${game}/${encodeURIComponent(version)}/zh/${file}/${encodeURIComponent(id)}.json`);
  return build(id, d, meta);
}

module.exports = { GAME, expPools, itemCatalog, buildModel, hsrCharacter, hsrLightcone, wwCharacter, wwWeapon, zzzCharacter, zzzWeapon };
