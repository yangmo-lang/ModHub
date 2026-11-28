// MaaEnd（MXU）的實例任務清單與任務選項：讀 interface.json 的定義、讀寫 config\mxu-MaaEnd.json
//
// - 任務 / 選項定義：interface.json（JSONC）與它 import 的 tasks\*.json（task[]、option{}），名稱用 locales\interface\zh_tw.json
// - 使用者設定：config\mxu-MaaEnd.json 的 instances[].tasks[]：{ id, taskName, enabled, enabledByController, optionValues }
//   optionValues[鍵] = { type:'select', caseName } | { type:'checkbox', caseNames } | { type:'switch', value } | { type:'input', values }
//   沒存的選項 MaaEnd 會用預設值（default_case / input.default），所以只寫有改的值
// - 只改 instances[].tasks，其他欄位原樣保留；第一次寫入前備份成 .modhub-bak；MaaEnd 執行中不寫（它把設定放在記憶體，關閉時會蓋回去）
// - 啟動遊戲的前置任務（__MXU_PRETASK__*）與切換帳號（AccountSwitch）在 ModHub 不顯示、不能改（ModHub 自己透過 XXMI 開遊戲）
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseJsonc, configFile, isHidden } = require('./maaend.cjs');
const YES = ['Yes', 'yes', 'Y', 'y'];

const readJsonc = (file) => parseJsonc(fs.readFileSync(file, 'utf8'));

/** 選項預設值（與 MaaEnd 沒存值時的行為相同：switch / select 用 default_case，沒有就第一個 case） */
function defaultValue(def) {
  const type = def?.type || 'select';
  if (type === 'input' || type === 'hotkey') {
    const values = {};
    for (const i of (type === 'input' ? def.inputs : def.hotkeys) || []) values[i.name] = i.default || '';
    return { type, values };
  }
  if (type === 'switch') return { type, value: YES.includes(def.default_case || def.cases?.[0]?.name || 'Yes') };
  if (type === 'checkbox') return { type, caseNames: [...(def.default_case || [])] };
  return { type: 'select', caseName: def.default_case || def.cases?.[0]?.name || '' };
}

/** 目前值下有子選項的 case（switch / select 一個，checkbox 可能多個） */
function activeCases(def, value) {
  const type = def?.type || 'select';
  const v = value && value.type === type ? value : defaultValue(def);
  const cases = def?.cases || [];
  if (type === 'checkbox') return cases.filter((c) => v.caseNames.includes(c.name));
  if (type === 'switch') return cases.filter((c) => (v.value ? YES : ['No', 'no', 'N', 'n']).includes(c.name)).slice(0, 1);
  if (type === 'select') return cases.filter((c) => c.name === v.caseName).slice(0, 1);
  return [];
}

/** 新任務的選項值：依預設值遞迴展開子選項 */
function initValues(keys, options, out = {}) {
  for (const k of keys || []) {
    const def = options[k];
    if (!def || out[k]) continue;
    out[k] = defaultValue(def);
    for (const c of activeCases(def, out[k])) initValues(c.option, options, out);
  }
  return out;
}

/** 從某些選項開始，所有 case 底下可能出現的選項鍵（驗證寫入時用） */
function reachable(keys, options, out = new Set()) {
  for (const k of keys || []) {
    if (out.has(k) || !options[k]) continue;
    out.add(k);
    for (const c of options[k].cases || []) reachable(c.option, options, out);
  }
  return out;
}

const cache = new Map(); // root → { key, data }

/**
 * 讀 MaaEnd 的任務與選項定義（翻成繁中、去掉 pipeline_override），依 interface.json 與語系檔的修改時間快取
 * @returns { tasks: { 名稱: { name, label, description, group, controller, option } }, options: { 鍵: 定義 }, groups: [{ name, label }] }
 */
function loadInterface(root, lang = 'zh_tw') {
  const ifaceFile = path.join(root, 'interface.json');
  const st = fs.statSync(ifaceFile);
  let iface = readJsonc(ifaceFile);
  const locFile = iface.languages?.[lang] || iface.languages?.zh_cn;
  let locMtime = 0;
  try { locMtime = locFile ? fs.statSync(path.join(root, locFile)).mtimeMs : 0; } catch {}
  const key = `${st.mtimeMs}|${locMtime}|${lang}`;
  const hit = cache.get(root);
  if (hit && hit.key === key) return hit.data;

  let locale = {};
  if (locFile) try { locale = readJsonc(path.join(root, locFile)); } catch {}
  const tr = (s) => (typeof s === 'string' && s.startsWith('$') ? locale[s.slice(1)] ?? '' : s ?? '');
  const rawTasks = [...(iface.task || [])];
  const rawOptions = { ...(iface.option || {}) };
  for (const rel of iface.import || []) {
    if (typeof rel !== 'string' || rel.includes('..')) continue;
    let j;
    try { j = readJsonc(path.join(root, rel)); } catch { continue; }
    rawTasks.push(...(j.task || []));
    Object.assign(rawOptions, j.option || {});
  }
  const tasks = {};
  for (const t of rawTasks) {
    if (!t?.name) continue;
    tasks[t.name] = { name: t.name, label: tr(t.label) || t.name, description: tr(t.description), group: t.group || [], controller: t.controller || null, resource: t.resource || null, option: t.option || [] };
  }
  const options = {};
  for (const [k, d] of Object.entries(rawOptions)) {
    const type = d.type || 'select';
    const o = {
      type,
      label: tr(d.label) || k,
      description: tr(d.description),
      controller: d.controller || null,
      resource: d.resource || null,
    };
    if (d.cases) o.cases = d.cases.map((c) => ({ name: c.name, label: tr(c.label) || c.name, description: tr(c.description), option: c.option || [] }));
    if (d.default_case !== undefined) o.default_case = d.default_case;
    if (d.min_count !== undefined) o.min_count = d.min_count;
    if (d.max_count !== undefined) o.max_count = d.max_count;
    if (d.inputs) o.inputs = d.inputs.map((i) => ({ name: i.name, label: tr(i.label) || i.name, description: tr(i.description), default: i.default ?? '', pipeline_type: i.pipeline_type || 'string', verify: i.verify || '', pattern_msg: tr(i.pattern_msg), input_type: i.input_type || 'text', password: Boolean(i.password) }));
    if (d.hotkeys) o.hotkeys = d.hotkeys.map((i) => ({ name: i.name, label: tr(i.label) || i.name, default: i.default ?? '' }));
    o.dflt = defaultValue(o);
    options[k] = o;
  }
  const groups = (iface.group || []).map((g) => ({ name: g.name, label: tr(g.label) || g.name }));
  const data = { tasks, options, groups };
  cache.set(root, { key, data });
  return data;
}

const applies = (list, value) => !list || !value || list.includes(value);

function readConfig(root) {
  const text = fs.readFileSync(configFile(root), 'utf8').replace(/^﻿/, '');
  const cfg = JSON.parse(text);
  if (!Array.isArray(cfg.instances)) throw new Error('MaaEnd 設定檔格式不對（沒有 instances）');
  return cfg;
}

function findInstance(cfg, instanceId) {
  const inst = cfg.instances.find((i) => i && String(i.id) === String(instanceId));
  if (!inst) throw new Error('找不到這個 MaaEnd 實例（可能已在 MaaEnd 裡刪除），請重新讀取');
  return inst;
}

const isEnabled = (inst, t) => {
  const byCtl = t.enabledByController && inst.controllerName ? t.enabledByController[inst.controllerName] : undefined;
  return byCtl !== undefined ? Boolean(byCtl) : Boolean(t.enabled);
};

/**
 * 某個實例的任務（不含隱藏的）、可新增的任務與選項定義
 */
function readDetail(root, instanceId) {
  const def = loadInterface(root);
  const cfg = readConfig(root);
  const inst = findInstance(cfg, instanceId);
  const ctl = inst.controllerName || '';
  const res = inst.resourceName || '';
  const tasks = (inst.tasks || []).filter((t) => t && !isHidden(t.taskName)).map((t) => {
    const d = def.tasks[t.taskName];
    return {
      id: String(t.id),
      name: t.taskName,
      label: t.customName || d?.label || t.taskName,
      description: d?.description || '',
      known: Boolean(d),
      enabled: isEnabled(inst, t),
      option: d ? d.option : [],
      values: t.optionValues || {},
    };
  });
  const available = Object.values(def.tasks)
    .filter((t) => !isHidden(t.name) && applies(t.controller, ctl) && applies(t.resource, res))
    .map((t) => ({ name: t.name, label: t.label, group: t.group[0] || '' }));
  return { id: String(inst.id), name: inst.name, controller: ctl, resource: res, tasks, available, options: def.options, groups: def.groups };
}

/** 寫回設定檔：只動 instances，其他欄位原樣保留；第一次先備份；先寫暫存檔再改名 */
function writeConfig(root, cfg) {
  const file = configFile(root);
  const bak = `${file}.modhub-bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  const tmp = `${file}.modhub-tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 4)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function mutate(root, instanceId, fn) {
  const cfg = readConfig(root);
  const inst = findInstance(cfg, instanceId);
  if (!Array.isArray(inst.tasks)) inst.tasks = [];
  fn(inst, loadInterface(root));
  writeConfig(root, cfg);
  return readDetail(root, instanceId);
}

const setEnabled = (inst, t, on) => {
  t.enabled = Boolean(on);
  if (inst.controllerName) t.enabledByController = { ...(t.enabledByController || {}), [inst.controllerName]: Boolean(on) };
};

/** 勾選與順序：list = [{ id, enabled }]（只含顯示的任務）；隱藏的任務維持在最前面、內容不動 */
function setTasks(root, instanceId, list) {
  return mutate(root, instanceId, (inst) => {
    const hidden = inst.tasks.filter((t) => !t || isHidden(t.taskName));
    const visible = new Map(inst.tasks.filter((t) => t && !isHidden(t.taskName)).map((t) => [String(t.id), t]));
    const ordered = [];
    for (const item of Array.isArray(list) ? list : []) {
      const t = visible.get(String(item?.id));
      if (!t) continue;
      visible.delete(String(item.id));
      setEnabled(inst, t, item.enabled);
      ordered.push(t);
    }
    inst.tasks = [...hidden, ...ordered, ...visible.values()]; // 清單裡沒提到的（例如剛在 MaaEnd 新增的）放最後
  });
}

/** 驗證並整理一個選項值 */
function cleanValue(def, value) {
  const type = def.type || 'select';
  if (!value || value.type !== type) throw new Error('選項類型不符');
  if (type === 'select') {
    if (!def.cases.some((c) => c.name === value.caseName)) throw new Error('沒有這個選項');
    return { type, caseName: value.caseName };
  }
  if (type === 'switch') return { type, value: Boolean(value.value) };
  if (type === 'checkbox') {
    const names = new Set(def.cases.map((c) => c.name));
    const picked = def.cases.map((c) => c.name).filter((n) => (value.caseNames || []).includes(n) && names.has(n));
    if (def.min_count && picked.length < def.min_count) throw new Error(`至少要選 ${def.min_count} 項`);
    if (def.max_count && picked.length > def.max_count) throw new Error(`最多只能選 ${def.max_count} 項`);
    return { type, caseNames: picked };
  }
  if (type === 'input') {
    const values = {};
    for (const i of def.inputs) {
      if (i.password) throw new Error('密碼欄位請在 MaaEnd 裡設定');
      const v = String(value.values?.[i.name] ?? i.default ?? '');
      if (v.length > 2000) throw new Error(`${i.label} 太長`);
      if (i.verify) {
        let re = null;
        try { re = new RegExp(i.verify); } catch {}
        if (re && !re.test(v)) throw new Error(i.pattern_msg || `${i.label} 格式不對`);
      } else if (i.pipeline_type === 'int' && !/^-?\d+$/.test(v)) throw new Error(`${i.label} 要填整數`);
      else if (i.pipeline_type === 'bool' && !/^(true|false)$/i.test(v)) throw new Error(`${i.label} 要填 true 或 false`);
      values[i.name] = v;
    }
    return { type, values };
  }
  throw new Error('這種選項請在 MaaEnd 裡設定');
}

/** 改一個任務的一個選項（只接受這個任務可能用到的選項） */
function setOption(root, instanceId, taskId, key, value) {
  return mutate(root, instanceId, (inst, def) => {
    const t = inst.tasks.find((x) => x && String(x.id) === String(taskId));
    if (!t || isHidden(t.taskName)) throw new Error('找不到這個任務');
    const td = def.tasks[t.taskName];
    if (!td || !reachable(td.option, def.options).has(key)) throw new Error('這個任務沒有這個選項');
    t.optionValues = { ...(t.optionValues || {}), [key]: cleanValue(def.options[key], value) };
  });
}

function newId(existing) {
  for (;;) {
    const id = crypto.randomBytes(6).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 7);
    if (id.length === 7 && !existing.has(id)) return id;
  }
}

/** 新增任務到最後（勾選、選項用預設值） */
function addTask(root, instanceId, taskName) {
  return mutate(root, instanceId, (inst, def) => {
    const td = def.tasks[taskName];
    if (!td || isHidden(taskName)) throw new Error('沒有這個任務');
    if (!applies(td.controller, inst.controllerName) || !applies(td.resource, inst.resourceName)) throw new Error('這個任務不適用目前的控制器');
    const t = { id: newId(new Set(inst.tasks.map((x) => String(x?.id)))), taskName, enabled: true, optionValues: initValues(td.option, def.options) };
    setEnabled(inst, t, true);
    inst.tasks.push(t);
  });
}

function removeTask(root, instanceId, taskId) {
  return mutate(root, instanceId, (inst) => {
    const i = inst.tasks.findIndex((x) => x && String(x.id) === String(taskId));
    if (i < 0 || isHidden(inst.tasks[i].taskName)) throw new Error('找不到這個任務');
    inst.tasks.splice(i, 1);
  });
}

const PRETASK = '__MXU_PRETASK__LaunchGamePC';

/** 實例的「啟動遊戲（PC）」前置任務狀態 { exists, enabled, region } */
function readLaunchPretask(root, instanceId) {
  const inst = findInstance(readConfig(root), instanceId);
  const t = (inst.tasks || []).find((x) => x && x.taskName === PRETASK);
  if (!t) return { exists: false, enabled: false, region: '' };
  const v = t.optionValues?.LaunchGamePCRegion;
  return { exists: true, enabled: isEnabled(inst, t), region: v?.type === 'select' ? v.caseName : '' };
}

/**
 * 交給 MaaEnd 開遊戲時：打開實例的「啟動遊戲（PC）」前置任務，有指定伺服器就一併設定（沒有這個前置任務就加在最前面）
 * 已經是想要的樣子就不寫檔；回傳是否有修改
 */
function ensureLaunchPretask(root, instanceId, region) {
  const def = loadInterface(root);
  const regionDef = def.options.LaunchGamePCRegion;
  if (region && !(regionDef?.cases || []).some((c) => c.name === region)) throw new Error(`MaaEnd 沒有這個伺服器選項：${region}`);
  const cur = readLaunchPretask(root, instanceId);
  if (cur.exists && cur.enabled && (!region || cur.region === region)) return false;
  mutate(root, instanceId, (inst) => {
    let t = inst.tasks.find((x) => x && x.taskName === PRETASK);
    if (!t) {
      t = { id: newId(new Set(inst.tasks.map((x) => String(x?.id)))), taskName: PRETASK, enabled: true, optionValues: {} };
      inst.tasks.unshift(t);
    }
    setEnabled(inst, t, true);
    if (region) t.optionValues = { ...(t.optionValues || {}), LaunchGamePCRegion: { type: 'select', caseName: region } };
  });
  return true;
}

module.exports = { PRETASK, readLaunchPretask, ensureLaunchPretask, isHidden, defaultValue, activeCases, initValues, reachable, loadInterface, readDetail, setTasks, setOption, addTask, removeTask, cleanValue };
