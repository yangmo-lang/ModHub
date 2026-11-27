// 從 HoYoLAB 同步養成進度（星鐵、絕區零）與背包材料（星鐵）
//
// 星鐵：HoYoLAB「遊戲工具 → 素材計算」（/event/rpgcultivate）
//   avatar/list            擁有的角色與等級
//   calc/avatar/detail     技能等級、已點亮的行跡、裝備的光錐
//   calc/compute           素材計算；回應裡的 user_owns_materials 是相關素材的實際持有數量
// 絕區零：HoYoLAB「戰績」（/event/game_record_zzz）
//   avatar/basic           擁有的代理人與等級
//   avatar/info            技能等級（含核心技）、裝備的音擎
// 都是用 ModHub 已登入的 HoYoLAB 分區呼叫，不另外保存任何憑證
const calc = require('./calc.cjs');

const HSR = 'https://sg-act-public-api.hoyolab.com/event/rpgcultivate';
const ZZZ = 'https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz';

// 絕區零戰績的 skill_type → ModHub 技能 id
const ZZZ_SKILL = { 0: 'basic', 1: 'special', 2: 'dodge', 3: 'chain', 5: 'core', 6: 'assist' };

// ---------------- 純函式：把官方資料轉成 ModHub 的「目前進度」 ----------------

/** 星鐵角色：detail → { level, skills: {pointXX: lvl}, nodes: [pointXX] } */
function hsrCharacterProgress(model, detail) {
  const level = Number(detail.avatar?.cur_level) || 1;
  const all = [...(detail.skills || []), ...(detail.skills_other || []), ...(detail.skills_servant || []), ...(detail.skills_special || [])];
  const byAnchor = new Map(all.map((s) => [String(s.anchor || '').toLowerCase(), s]));
  const skills = {};
  for (const sk of model.skills) {
    const s = byAnchor.get(sk.id);
    if (s) skills[sk.id] = Math.max(sk.minLevel, Number(s.cur_level) || sk.minLevel);
  }
  const nodes = model.nodes.filter((n) => {
    const s = byAnchor.get(n.id);
    return s && (s.progress === 'Learned' || Number(s.cur_level) >= 1);
  }).map((n) => n.id);
  return { level, stage: calc.minStageForLevel(model, level), skills, nodes };
}

/** 絕區零代理人：info → { level, skills } */
function zzzCharacterProgress(model, info) {
  const level = Number(info.level) || 1;
  const skills = {};
  for (const s of info.skills || []) {
    const id = ZZZ_SKILL[s.skill_type];
    const sk = model.skills.find((x) => x.id === id);
    if (sk) skills[id] = Math.min(sk.maxLevel, Math.max(sk.minLevel, Number(s.level) || sk.minLevel));
  }
  return { level, stage: calc.minStageForLevel(model, level), skills, nodes: [] };
}

/** 武器 / 光錐 / 音擎：只有等級 */
function weaponProgress(model, level) {
  const lv = Math.max(1, Math.min(model.maxLevel, Number(level) || 1));
  return { level: lv, stage: calc.minStageForLevel(model, lv), skills: {}, nodes: [] };
}

/**
 * 套用同步結果：目前進度換成官方資料；目標若比目前低就跟著拉高（normalizeConfig 會處理）
 */
function applyProgress(model, cfg, cur) {
  return calc.normalizeConfig(model, { ...cfg, cur: { ...cfg.cur, ...cur, skills: { ...cfg.cur.skills, ...cur.skills } }, tgt: cfg.tgt });
}

// ---------------- 呼叫官方 API ----------------

async function hsrSync({ roles, fetchJson, entries, modelOf, onProgress }) {
  const role = roles[0];
  const q = new URLSearchParams({ game: 'hkrpg', game_biz: 'hkrpg_global', badge_region: role.region, badge_uid: role.uid });
  const get = async (p, extra = {}) => {
    const j = await fetchJson(`${HSR}${p}?${new URLSearchParams({ ...Object.fromEntries(q), ...extra })}`);
    if (j.retcode !== 0) throw new Error(`HoYoLAB ${p}：${j.retcode} ${j.message || ''}`);
    return j.data;
  };
  const post = async (p, body) => {
    const j = await fetchJson(`${HSR}${p}?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, game: 'hkrpg', game_biz: 'hkrpg_global', badge_region: role.region, badge_uid: role.uid }) });
    if (j.retcode !== 0) throw new Error(`HoYoLAB ${p}：${j.retcode} ${j.message || ''}`);
    return j.data;
  };

  const avatars = new Map(((await get('/avatar/list')).avatars || []).map((a) => [String(a.item_id), a]));
  const lcs = new Map(((await get('/equipment/list').catch(() => ({ list: [] }))).list || []).map((e) => [String(e.item_id), e]));
  const out = [];
  const inventory = {};
  const equipped = new Map(); // 光錐 id → 最高等級（從角色身上裝備的光錐）
  const addOwned = (map) => { for (const [id, n] of Object.entries(map || {})) inventory[id] = Math.max(inventory[id] || 0, Number(n) || 0); };

  for (const e of entries.filter((x) => x.kind === 'character')) {
    const a = avatars.get(String(e.id));
    if (!a?.is_own) { out.push({ key: e.key, status: 'not-owned' }); continue; }
    onProgress?.(`讀取 ${a.item_name}`);
    const model = await modelOf(e);
    const d = await get('/calc/avatar/detail', { item_id: e.id, change_target_level: 0 });
    const cur = hsrCharacterProgress(model, d);
    const cfg = applyProgress(model, e, cur);
    out.push({ key: e.key, status: 'ok', cfg });
    if (d.equipment?.item_id) equipped.set(String(d.equipment.item_id), Math.max(equipped.get(String(d.equipment.item_id)) || 0, Number(d.equipment.cur_level) || 1));
    // 背包：用目前 → 目標算一次，官方會回傳相關素材的持有數量
    const all = [...(d.skills || []), ...(d.skills_other || []), ...(d.skills_servant || []), ...(d.skills_special || [])];
    const skillList = all.map((s) => {
      const key = String(s.anchor || '').toLowerCase();
      const tgt = cfg.tgt.skills[key] ?? (cfg.tgt.nodes.includes(key) ? 1 : Number(s.cur_level) || 0);
      return { item_id: s.point_id, cur_level: Number(s.cur_level) || 0, target_level: Math.max(Number(s.cur_level) || 0, Number(tgt) || 0) };
    }).filter((s) => s.target_level > s.cur_level);
    try {
      const c = await post('/calc/compute', { avatar: { item_id: e.id, cur_level: cfg.cur.level, target_level: Math.max(cfg.cur.level, cfg.tgt.level) }, skill_list: skillList });
      addOwned(c.user_owns_materials);
    } catch {}
  }

  for (const e of entries.filter((x) => x.kind === 'weapon')) {
    const model = await modelOf(e);
    const lv = equipped.get(String(e.id)) || Number(lcs.get(String(e.id))?.cur_level) || null;
    if (lv && lv > 1) out.push({ key: e.key, status: 'ok', cfg: applyProgress(model, e, weaponProgress(model, lv)) });
    else out.push({ key: e.key, status: 'unknown' });
    try {
      const c = await post('/calc/compute', { equipment: { item_id: e.id, cur_level: lv || 1, target_level: model.maxLevel } });
      addOwned(c.user_owns_materials);
    } catch {}
  }
  return { results: out, inventory, role: { uid: role.uid, name: role.name, server: role.server } };
}

async function zzzSync({ roles, fetchJson, entries, modelOf, onProgress }) {
  const role = roles[0];
  const q = (extra = {}) => new URLSearchParams({ server: role.region, role_id: role.uid, ...extra });
  const basic = await fetchJson(`${ZZZ}/avatar/basic?${q()}`);
  if (basic.retcode !== 0) throw new Error(`HoYoLAB 戰績：${basic.retcode} ${basic.message || ''}（請確認 HoYoLAB 戰績設為公開或已綁定角色）`);
  const owned = new Map((basic.data?.avatar_list || []).map((a) => [String(a.id), a]));
  const charEntries = entries.filter((x) => x.kind === 'character');
  const ids = charEntries.map((e) => String(e.id)).filter((id) => owned.has(id));
  const infos = new Map();
  for (let i = 0; i < ids.length; i += 8) {
    onProgress?.(`讀取代理人 ${i + 1}–${Math.min(ids.length, i + 8)}`);
    const p = q();
    for (const id of ids.slice(i, i + 8)) p.append('id_list[]', id);
    p.set('need_wiki', 'false');
    const j = await fetchJson(`${ZZZ}/avatar/info?${p}`);
    if (j.retcode !== 0) throw new Error(`HoYoLAB 戰績：${j.retcode} ${j.message || ''}`);
    for (const a of j.data?.avatar_list || []) infos.set(String(a.id), a);
  }
  const out = [];
  const weapons = new Map(); // 音擎 id → 最高等級
  for (const e of charEntries) {
    const info = infos.get(String(e.id));
    if (!info) { out.push({ key: e.key, status: owned.has(String(e.id)) ? 'unknown' : 'not-owned' }); continue; }
    const model = await modelOf(e);
    out.push({ key: e.key, status: 'ok', cfg: applyProgress(model, e, zzzCharacterProgress(model, info)) });
    if (info.weapon?.id) weapons.set(String(info.weapon.id), Math.max(weapons.get(String(info.weapon.id)) || 0, Number(info.weapon.level) || 1));
  }
  for (const e of entries.filter((x) => x.kind === 'weapon')) {
    const lv = weapons.get(String(e.id));
    if (!lv) { out.push({ key: e.key, status: 'unknown' }); continue; }
    const model = await modelOf(e);
    out.push({ key: e.key, status: 'ok', cfg: applyProgress(model, e, weaponProgress(model, lv)) });
  }
  return { results: out, inventory: {}, role: { uid: role.uid, name: role.name, server: role.server }, ownedIds: [...owned.keys()] };
}

module.exports = { hsrSync, zzzSync, hsrCharacterProgress, zzzCharacterProgress, weaponProgress, applyProgress, ZZZ_SKILL };
