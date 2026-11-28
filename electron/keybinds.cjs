// 讀出 3DMigoto MOD 的按鍵設定（ini 裡的 [Key…] 區段），在介面上列出「哪個鍵會切換什麼」
//
//   ; 換衣服                      ← 區段上方的註解當說明
//   [KeySwap_0]
//   condition = $active0 == 1
//   key = Ctrl 7                  ← 可以有多行 key（例如鍵盤 + 手把）
//   back = Ctrl 8                 ← 反向（cycle 時）
//   type = cycle                  ← cycle / toggle / hold / activate
//   $swapkey0 = 0,1,              ← 會被切換的變數與數值
//
// 3DMigoto 不會讀取檔名以 DISABLED 開頭的 ini，這些也略過。只讀不寫。
const fs = require('node:fs');
const path = require('node:path');

const MAX_FILES = 60;
const MAX_SIZE = 2 * 1024 * 1024;
const DISABLED_RE = /^disabled/i;

const TYPE_LABEL = { cycle: '循環切換', toggle: '開 / 關', hold: '按住時', activate: '按一下觸發' };

// 虛擬鍵碼 → 顯示名稱
const VK_NAMES = {
  lbutton: '滑鼠左鍵', rbutton: '滑鼠右鍵', mbutton: '滑鼠中鍵', xbutton1: '滑鼠側鍵 1', xbutton2: '滑鼠側鍵 2',
  up: '↑', down: '↓', left: '←', right: '→',
  return: 'Enter', enter: 'Enter', space: 'Space', tab: 'Tab', back: 'Backspace', escape: 'Esc', esc: 'Esc',
  prior: 'PageUp', next: 'PageDown', pgup: 'PageUp', pgdn: 'PageDown', home: 'Home', end: 'End', insert: 'Insert', delete: 'Delete',
  oem_minus: '-', oem_plus: '=', oem_comma: ',', oem_period: '.', oem_1: ';', oem_2: '/', oem_3: '`', oem_4: '[', oem_5: '\\', oem_6: ']', oem_7: "'",
  add: '數字鍵 +', subtract: '數字鍵 -', multiply: '數字鍵 *', divide: '數字鍵 /', decimal: '數字鍵 .',
  capital: 'CapsLock', numlock: 'NumLock', scroll: 'ScrollLock', pause: 'Pause', snapshot: 'PrintScreen',
};
const MODIFIERS = { ctrl: 'Ctrl', control: 'Ctrl', lctrl: '左 Ctrl', rctrl: '右 Ctrl', alt: 'Alt', menu: 'Alt', lalt: '左 Alt', ralt: '右 Alt', shift: 'Shift', lshift: '左 Shift', rshift: '右 Shift', win: 'Win', lwin: 'Win', rwin: 'Win' };

/**
 * 一行 key 的值 → { text, gamepad, mouse }
 * 去掉 no_ctrl / no_modifiers 這類「不能按」的修飾，VK_ 名稱改成好讀的字
 */
function formatKey(raw) {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const mods = [];
  const keys = [];
  let gamepad = false;
  let mouse = false;
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (low.startsWith('no_')) continue;
    if (MODIFIERS[low] || MODIFIERS[low.replace(/^vk_/, '')]) { mods.push(MODIFIERS[low] || MODIFIERS[low.replace(/^vk_/, '')]); continue; }
    if (low.startsWith('xb_')) {
      gamepad = true;
      keys.push(`手把 ${t.slice(3).toUpperCase().replace(/_/g, ' ')}`);
      continue;
    }
    const vk = low.replace(/^vk_/, '');
    if (/^(l|r|m|x)button\d?$/.test(vk)) mouse = true;
    if (VK_NAMES[vk]) keys.push(VK_NAMES[vk]);
    else if (/^numpad\d$/.test(vk)) keys.push(`數字鍵 ${vk.slice(6)}`);
    else if (/^f\d{1,2}$/.test(vk)) keys.push(vk.toUpperCase());
    else if (/^0x[0-9a-f]+$/i.test(t)) keys.push(t.toUpperCase());
    else keys.push(t.length === 1 ? t.toUpperCase() : t.toUpperCase());
  }
  const uniqMods = [...new Set(mods)];
  return { text: [...uniqMods, ...keys].join(' + ') || String(raw || '').trim(), gamepad, mouse };
}

/** ini 文字（UTF-8 或 GBK / Big5 等）→ 字串 */
function decodeIni(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    try { return new TextDecoder('gb18030').decode(buf); } catch { return buf.toString('latin1'); }
  }
}

/** 註解行 → 說明文字（去掉分隔線用的 = - * # 等） */
function commentText(line) {
  return line.replace(/^\s*;+/, '').replace(/^[\s=\-*#_~]+|[\s=\-*#_~]+$/g, '').trim();
}

/**
 * 解析一個 ini 的所有 [Key…] 區段
 * @returns [{ section, label, keys: [{ text, raw, gamepad, mouse }], back: [...], type, typeLabel, vars: [{ name, values }], condition, line }]
 */
function parseKeyBinds(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let cur = null;
  let pendingComments = [];
  const finish = () => { if (cur) out.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const sec = /^\[([^\]]+)\]/.exec(trimmed);
    if (sec) {
      finish();
      const name = sec[1].trim();
      if (/^key/i.test(name)) {
        const comment = pendingComments.map(commentText).filter(Boolean).slice(-2).join(' · ');
        cur = { section: name, label: comment, keys: [], back: [], type: 'activate', vars: [], condition: '', line: i + 1 };
      }
      pendingComments = [];
      continue;
    }
    if (!trimmed) continue; // 註解和區段之間隔空行也算說明
    // 註解先記著：下一個區段是 [Key…] 就當它的說明；中間出現設定值就清掉
    if (trimmed.startsWith(';')) { pendingComments.push(trimmed); continue; }
    pendingComments = [];
    if (!cur) continue;
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    const k = kv[1].trim().toLowerCase();
    const v = kv[2].replace(/\s;.*$/, '').trim();
    if (k === 'key') cur.keys.push({ raw: v, ...formatKey(v) });
    else if (k === 'back') cur.back.push({ raw: v, ...formatKey(v) });
    else if (k === 'type') cur.type = v.toLowerCase();
    else if (k === 'condition') cur.condition = v;
    else if (k.startsWith('$')) {
      cur.vars.push({ name: kv[1].trim(), values: v.split(',').map((x) => x.trim()).filter((x) => x !== '') });
    }
  }
  finish();
  return out
    .filter((b) => b.keys.length || b.back.length)
    .map((b) => ({ ...b, typeLabel: TYPE_LABEL[b.type] || b.type, label: b.label || prettySection(b.section) }));
}

/** [KeySwap_0] → Swap 0；[KeyToggle_MiniMap] → Toggle MiniMap */
function prettySection(name) {
  return name.replace(/^key[_\s-]?/i, '').replace(/_/g, ' ').trim() || name;
}

function listInis(dir, depth = 0, out = []) {
  if (out.length >= MAX_FILES) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    if (DISABLED_RE.test(e.name)) continue; // 3DMigoto 會略過 DISABLED 開頭的檔案與資料夾
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().endsWith('.ini')) out.push(full);
    else if (e.isDirectory() && depth < 6) listInis(full, depth + 1, out);
  }
  return out;
}

/**
 * 讀一個 MOD 資料夾的所有按鍵（依檔案大小 + 修改時間快取）
 * @param cache Map（跨掃描共用）
 * @returns [{ file（相對路徑）, ...binding }]
 */
function modKeyBinds(modDir, cache = new Map()) {
  const result = [];
  for (const file of listInis(modDir)) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (st.size > MAX_SIZE) continue;
    const sig = `${st.size}:${st.mtimeMs}`;
    let binds = cache.get(file);
    if (!binds || binds.sig !== sig) {
      let parsed = [];
      try { parsed = parseKeyBinds(decodeIni(fs.readFileSync(file))); } catch { parsed = []; }
      binds = { sig, list: parsed };
      cache.set(file, binds);
    }
    const rel = path.relative(modDir, file);
    for (const b of binds.list) result.push({ file: rel, ...b });
  }
  return result;
}

module.exports = { parseKeyBinds, formatKey, decodeIni, modKeyBinds, listInis, TYPE_LABEL };
