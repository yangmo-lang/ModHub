// 絕區零一條龍：個別任務的設定（錄像店 / 咖啡店的傳送地點、體力刷本的副本計畫）
//   設定檔：<OneDragon>\config\<idx 兩位數>\one_dragon\<app_id>.yml（OneDragon 自己的格式，只改下面列出的欄位）
//   選項：從使用者安裝的 OneDragon 讀
//     - 傳送地點：src\zzz_od\application\{random_play,coffee}\*_config.py 裡的 TransportPoint('區域', '傳送點')
//     - 副本：assets\game_data\compendium_data.yml 的「训练」分頁（实战模拟室 / 区域巡防 / 专业挑战室 / 恶名狩猎）
// 只以文字讀取，不執行 OneDragon 的程式，也不含它的程式碼。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { toTw } = require('./characters.cjs');

/** 顯示用：簡體 → 繁體對照（設定檔裡仍存 OneDragon 的原文） */
function labelsFor(strings) {
  const out = {};
  for (const s of strings) if (s) out[s] = toTw(s);
  return out;
}

const CHARGE_TAB = '训练';
const CHARGE_CATEGORIES = ['实战模拟室', '区域巡防', '专业挑战室', '恶名狩猎'];
const SKIP_TYPES = new Set(['代理人方案培养', '自定义模板']); // 需要在 OneDragon 裡另外設定的類型

// OneDragon 新增體力計畫時的預設值（ChargePlanItem）
const PLAN_DEFAULTS = {
  tab_name: CHARGE_TAB, level: '默认等级', auto_battle_config: '全配队通用', run_times: 0,
  card_num: '默认数量', predefined_team_idx: -1, notorious_hunt_buff_num: 1,
};

const appFile = (root, idx, appId) => path.join(root, 'config', String(idx).padStart(2, '0'), 'one_dragon', `${appId}.yml`);

function readYaml(file) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { if (e.code === 'ENOENT') return null; throw new Error(`讀不懂 ${path.basename(file)}：${e.message}`); }
}

/** *_config.py 裡的 TransportPoint('區域', '傳送點') → ['區域 - 傳送點', …]（第一個是 OneDragon 的預設） */
function readTransportPoints(root, appDir) {
  const dir = path.join(root, 'src', 'zzz_od', 'application', appDir);
  let text = '';
  try {
    const f = fs.readdirSync(dir).find((n) => /_config\.py$/.test(n));
    if (f) text = fs.readFileSync(path.join(dir, f), 'utf8');
  } catch { return []; }
  return [...text.matchAll(/TransportPoint\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => `${m[1]} - ${m[2]}`);
}

/**
 * 副本選項 [{ category, types: [{ name, drop, missions: [名稱], drops: { 名稱: 產出 } }] }]（沒有 missions 的類型直接選類型）
 * drop / drops：OneDragon 資料裡的 *_display 欄位（區域巡防 = 驅動盤套裝、實戰模擬室 = 產出），沒有就是空字串
 */
function readCompendium(root) {
  let doc;
  try { doc = yaml.load(fs.readFileSync(path.join(root, 'assets', 'game_data', 'compendium_data.yml'), 'utf8')); } catch { return []; }
  const tab = (Array.isArray(doc) ? doc : []).find((t) => t?.tab_name === CHARGE_TAB);
  return (tab?.category_list || [])
    .filter((c) => CHARGE_CATEGORIES.includes(c?.category_name))
    .map((c) => ({
      category: c.category_name,
      types: (c.mission_type_list || [])
        .filter((t) => t?.mission_type_name && !SKIP_TYPES.has(t.mission_type_name))
        .map((t) => ({
          name: t.mission_type_name,
          drop: dropText(t.mission_type_name_display),
          missions: (t.mission_list || []).map((m) => m?.mission_name).filter(Boolean),
          drops: Object.fromEntries((t.mission_list || []).filter((m) => m?.mission_name && m.mission_name_display).map((m) => [m.mission_name, dropText(m.mission_name_display)])),
        })),
    }))
    .filter((c) => c.types.length);
}

/** 「摇摆爵士 混沌重金属」→「摇摆爵士、混沌重金属」（區域巡防的兩個驅動盤套裝） */
function dropText(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).join('、');
}

// 每日簽到可選的地點（讀不到安裝目錄時用）：OneDragon 簽到設定介面的 ConfigItem('名稱', 'app_id')
const SIGN_FALLBACK = [['吼吼饼铺', 'hou_hou_bakery'], ['卦象集录', 'trigrams_collection'], ['刮刮卡', 'scratch_card']];

/** 每日簽到地點 [{ value, label }]（第一個是 OneDragon 的預設） */
function readSignOptions(root) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, 'src', 'zzz_od', 'gui', 'app_setting', 'daily_signin_setting_flyout.py'), 'utf8'); } catch {}
  const found = [...text.matchAll(/ConfigItem\(\s*['"]([^'"]+)['"]\s*,\s*['"]([a-z0-9_]+)['"]\s*\)/g)].map((m) => [m[1], m[2]]);
  return (found.length ? found : SIGN_FALLBACK).map(([label, value]) => ({ value, label }));
}

function readOptions(root) {
  return {
    transport: { random_play: readTransportPoints(root, 'random_play'), coffee: readTransportPoints(root, 'coffee') },
    compendium: readCompendium(root),
  };
}

/** 讀某個任務的設定（ModHub 會用到的欄位） */
function readAppConfig(root, idx, appId) {
  const doc = readYaml(appFile(root, idx, appId)) || {};
  if (appId === 'random_play' || appId === 'coffee') {
    const points = readTransportPoints(root, appId);
    return { transport_point: doc.transport_point || points[0] || '', options: points, labels: labelsFor(points) };
  }
  if (appId === 'daily_signin') {
    const options = readSignOptions(root);
    return { selected_sign: doc.selected_sign || options[0]?.value || '', options: options.map((o) => o.value), labels: Object.fromEntries(options.map((o) => [o.value, toTw(o.label)])) };
  }
  if (appId === 'charge_plan') {
    const compendium = readCompendium(root);
    return {
      plan_list: (Array.isArray(doc.plan_list) ? doc.plan_list : []).map((p) => ({
        plan_id: p.plan_id || null, category_name: p.category_name, mission_type_name: p.mission_type_name,
        mission_name: p.mission_name ?? null, plan_times: Number(p.plan_times) || 1,
      })),
      loop: doc.loop !== false,
      compendium,
      labels: labelsFor(compendium.flatMap((c) => [c.category, ...c.types.flatMap((t) => [t.name, t.drop, ...t.missions, ...Object.values(t.drops)])])),
    };
  }
  throw new Error(`這個任務沒有可以在 ModHub 調整的設定：${appId}`);
}

/** 檢查一筆體力計畫是否在副本清單裡 */
function validPlan(compendium, p) {
  const cat = compendium.find((c) => c.category === p.category_name);
  const type = cat?.types.find((t) => t.name === p.mission_type_name);
  if (!type) return false;
  return type.missions.length ? type.missions.includes(p.mission_name) : p.mission_name == null;
}

/**
 * 寫回任務設定（只改允許的欄位，其他原樣保留；檔案不存在就建立；第一次覆寫前備份）
 * patch：random_play / coffee → { transport_point }；charge_plan → { plan_list: [{ plan_id?, category_name, mission_type_name, mission_name, plan_times }] }
 */
function writeAppConfig(root, idx, appId, patch) {
  const file = appFile(root, idx, appId);
  if (!fs.existsSync(path.dirname(path.dirname(file)))) throw new Error(`找不到帳號實例 ${String(idx).padStart(2, '0')} 的設定資料夾`);
  const doc = readYaml(file) || {};
  if (appId === 'random_play' || appId === 'coffee') {
    const points = readTransportPoints(root, appId);
    if (!points.includes(patch?.transport_point)) throw new Error('不認得這個地點');
    doc.transport_point = patch.transport_point;
  } else if (appId === 'daily_signin') {
    if (!readSignOptions(root).some((o) => o.value === patch?.selected_sign)) throw new Error('不認得這個簽到地點');
    doc.selected_sign = patch.selected_sign;
  } else if (appId === 'charge_plan') {
    const compendium = readCompendium(root);
    const list = Array.isArray(patch?.plan_list) ? patch.plan_list.slice(0, 50) : [];
    const old = new Map((Array.isArray(doc.plan_list) ? doc.plan_list : []).filter((p) => p?.plan_id).map((p) => [p.plan_id, p]));
    doc.plan_list = list.map((p) => {
      const plan = { category_name: String(p.category_name || ''), mission_type_name: String(p.mission_type_name || ''), mission_name: p.mission_name == null || p.mission_name === '' ? null : String(p.mission_name) };
      if (!validPlan(compendium, plan)) throw new Error(`不認得這個副本：${plan.category_name} / ${plan.mission_type_name}${plan.mission_name ? ` / ${plan.mission_name}` : ''}`);
      const times = Math.max(1, Math.min(999, Math.round(Number(p.plan_times) || 1)));
      const prev = p.plan_id && old.get(p.plan_id);
      // 既有計畫：保留它的戰鬥設定（配隊、卡片數、等級…）；新計畫用 OneDragon 的預設值
      return prev && prev.category_name === plan.category_name && prev.mission_type_name === plan.mission_type_name && (prev.mission_name ?? null) === plan.mission_name
        ? { ...prev, plan_times: times }
        : { ...PLAN_DEFAULTS, ...(prev ? pickBattle(prev) : {}), ...plan, plan_times: times, plan_id: (prev && prev.plan_id) || crypto.randomUUID() };
    });
  } else {
    throw new Error(`這個任務沒有可以在 ModHub 調整的設定：${appId}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bak = `${file}.modhub-bak`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
  fs.writeFileSync(`${file}.tmp`, yaml.dump(doc, { lineWidth: -1 }), 'utf8');
  fs.renameSync(`${file}.tmp`, file);
  return readAppConfig(root, idx, appId);
}

/** 換了副本的既有計畫：沿用配隊與戰鬥設定 */
function pickBattle(p) {
  const out = {};
  for (const k of ['auto_battle_config', 'predefined_team_idx']) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

const CONFIGURABLE = new Set(['random_play', 'coffee', 'daily_signin', 'charge_plan']);

module.exports = { readSignOptions, CONFIGURABLE, appFile, readTransportPoints, readCompendium, readOptions, readAppConfig, writeAppConfig, validPlan, PLAN_DEFAULTS };
