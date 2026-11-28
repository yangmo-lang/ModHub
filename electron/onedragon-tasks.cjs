// 絕區零一條龍的任務清單：讀寫 OneDragon 自己的設定檔，讓 ModHub 勾選要跑哪些任務、調整順序
//   <OneDragon>\config\one_dragon.yml                         instance_list: [{ idx, name, active, active_in_od, ... }]
//   <OneDragon>\config\<idx 兩位數>\one_dragon\_group.yml       app_list: [{ app_id, enabled }]（順序 = 執行順序）
//   （舊版）<OneDragon>\config\<idx>\one_dragon_app.yml          app_order / app_run_list —— 沒有新檔時拿來遷移
// 任務名稱與「一條龍預設任務」從使用者安裝的 OneDragon 讀（src\zzz_od\application\**\*_const.py 的 APP_ID / APP_NAME / DEFAULT_GROUP），
// 讀不到才用內建名單。ModHub 不含 OneDragon 的程式碼；只改 app_list，其他設定保留，第一次寫入前備份成 .modhub-bak。
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { toTw } = require('./characters.cjs');

// 讀不到安裝目錄的 const 檔時用的名單（OneDragon 一條龍預設任務，簡體名稱，顯示時轉繁體）
const KNOWN_APPS = {
  email: '邮件', random_play: '录像店营业', daily_signin: '每日签到', coffee: '咖啡店', charge_plan: '体力刷本',
  notorious_hunt: '恶名狩猎', engagement_reward: '活跃度奖励', city_fund: '丽都城募', ridu_weekly: '丽都周纪 (领奖励)',
  drive_disc_dismantle: '驱动盘拆解', hollow_eval_speed: '零号业绩速刷', lost_void: '迷失之地', withered_domain: '枯萎之都',
  intel_board: '情报板', redemption_code: '兑换码', shiyu_defense: '式舆防卫战', suibian_temple: '随便观', world_patrol: '锄大地',
  life_on_line: '真·拿命验收',
};
const HIDDEN = new Set(['notify', 'one_dragon']); // 不是遊戲任務（通知、一條龍本身）

const configDir = (root) => path.join(root, 'config');
const instanceDir = (root, idx) => path.join(configDir(root), String(idx).padStart(2, '0'));
const groupFile = (root, idx) => path.join(instanceDir(root, idx), 'one_dragon', '_group.yml');
const legacyFile = (root, idx) => path.join(instanceDir(root, idx), 'one_dragon_app.yml');

function readYaml(file) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { if (e.code === 'ENOENT') return null; throw new Error(`讀不懂 ${path.basename(file)}：${e.message}`); }
}

/** 帳號實例清單 [{ idx, name, active }]；沒有設定檔時回傳空陣列 */
function readInstances(root) {
  const doc = readYaml(path.join(configDir(root), 'one_dragon.yml'));
  const list = Array.isArray(doc?.instance_list) ? doc.instance_list : [];
  return list
    .filter((i) => Number.isInteger(Number(i?.idx)))
    .map((i) => ({ idx: Number(i.idx), name: String(i.name ?? String(i.idx).padStart(2, '0')), active: Boolean(i.active), inOneDragon: i.active_in_od !== false }));
}

/**
 * 從安裝目錄讀任務資訊：{ names: { id: 名稱 }, defaults: [一條龍預設任務 id] }
 * 只用正規表示式讀 *_const.py 裡的常數字串，不執行任何程式
 */
function readAppCatalog(root) {
  const names = {};
  const defaults = [];
  const base = path.join(root, 'src', 'zzz_od', 'application');
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4 && e.name !== '__pycache__') walk(full, depth + 1);
      else if (e.isFile() && /_const\.py$/.test(e.name)) {
        let text = '';
        try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
        const id = /^APP_ID\s*=\s*['"]([a-z0-9_]+)['"]/m.exec(text)?.[1];
        const name = /^APP_NAME\s*=\s*['"]([^'"\n]+)['"]/m.exec(text)?.[1];
        if (!id) continue;
        if (name) names[id] = name;
        if (/^DEFAULT_GROUP\s*=\s*True/m.test(text) && !HIDDEN.has(id)) defaults.push(id);
      }
    }
  };
  walk(base, 0);
  if (!defaults.length) return { names: { ...KNOWN_APPS }, defaults: Object.keys(KNOWN_APPS), fromInstall: false };
  return { names: { ...KNOWN_APPS, ...names }, defaults, fromInstall: true };
}

const displayName = (catalog, id) => {
  const n = catalog.names[id];
  return n ? toTw(n.replace(/\[[^\]]*\]$/, '').trim()) : id; // 去掉「[即将移除请转插件]」這類註記
};

/** 目前的任務清單（[{ id, enabled }]，順序 = 執行順序）；沒有新檔時從舊版設定或預設任務組出來 */
function currentList(root, idx, catalog) {
  const doc = readYaml(groupFile(root, idx));
  if (doc) {
    const saved = (Array.isArray(doc.app_list) ? doc.app_list : [])
      .filter((x) => x && typeof x.app_id === 'string')
      .map((x) => ({ id: x.app_id, enabled: x.enabled === true }));
    const have = new Set(saved.map((x) => x.id));
    // 新加入、還沒存過的預設任務：和 OneDragon 一樣以「停用」顯示
    return { exists: true, list: [...saved, ...catalog.defaults.filter((id) => !have.has(id)).map((id) => ({ id, enabled: false }))] };
  }
  const legacy = readYaml(legacyFile(root, idx));
  if (legacy) {
    const run = new Set((legacy.app_run_list || []).map(String));
    const order = (legacy.app_order || []).map(String);
    const ids = [...new Set([...order, ...catalog.defaults])];
    return { exists: false, migrated: true, list: ids.map((id) => ({ id, enabled: run.has(id) })) };
  }
  return { exists: false, list: catalog.defaults.map((id) => ({ id, enabled: false })) };
}

/** 某個帳號實例的任務（不含通知等隱藏項目） */
function readTasks(root, idx) {
  const catalog = readAppCatalog(root);
  const cur = currentList(root, idx, catalog);
  return {
    exists: cur.exists,
    migrated: Boolean(cur.migrated),
    fromInstall: catalog.fromInstall,
    tasks: cur.list.filter((t) => !HIDDEN.has(t.id)).map((t) => ({ ...t, name: displayName(catalog, t.id) })),
  };
}

/**
 * 寫回勾選與順序（檔案不存在就建立）
 * @param tasks [{ id, enabled }]（照要的順序）
 */
function writeTasks(root, idx, tasks) {
  if (!fs.existsSync(instanceDir(root, idx))) throw new Error(`找不到帳號實例 ${String(idx).padStart(2, '0')} 的設定資料夾`);
  const ids = tasks.map((t) => String(t.id));
  if (ids.some((id) => !/^[a-z0-9_]+$/.test(id))) throw new Error('任務 id 格式不對');
  const file = groupFile(root, idx);
  const doc = readYaml(file) || {};
  const saved = Array.isArray(doc.app_list) ? doc.app_list.filter((x) => x && typeof x.app_id === 'string') : [];
  const byId = new Map(saved.map((x) => [x.app_id, x]));
  const listed = new Set(ids);
  doc.app_list = [
    ...tasks.map((t) => ({ ...(byId.get(String(t.id)) || {}), app_id: String(t.id), enabled: Boolean(t.enabled) })),
    // 清單上沒有的已存項目（通知、外掛、未知任務）原樣保留在後面
    ...saved.filter((x) => !listed.has(x.app_id)),
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bak = `${file}.modhub-bak`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
  fs.writeFileSync(`${file}.tmp`, yaml.dump(doc, { lineWidth: -1 }), 'utf8');
  fs.renameSync(`${file}.tmp`, file);
  return readTasks(root, idx);
}

/** 要顯示哪個帳號實例：指定的（ModHub 設定的第一個實例）→ OneDragon 目前選中的 → 第一個 */
function pickInstance(instances, preferred) {
  const want = Number(String(preferred || '').split(',')[0]);
  return (instances.find((i) => i.idx === want) || instances.find((i) => i.active) || instances[0])?.idx ?? null;
}

module.exports = { KNOWN_APPS, HIDDEN, groupFile, legacyFile, readInstances, readAppCatalog, readTasks, writeTasks, pickInstance };
