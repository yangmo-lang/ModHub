// 繞過 MaaEnd 的「隱藏 UID MOD」檢查
//
// MaaEnd 每個任務開始前的場景檢查裡有 __SceneImageCheckMod：用 OCR 看畫面左下角的 UID，
// 看不到就走 __SceneImageCheckModFailedFinish（跳提示並中止整個任務）。隱藏 UID 的 HUD MOD（例如 Advanced HUD Control）會讓它一直失敗。
// 繞過 = 把這個節點的 next 從 [Success, FailedFinish] 改成 [Success, EmptyNode]（MaaEnd 自己的空節點，
// 和它檢查 Windows 浮水印的 __SceneImageCheckWindowsActivation 相同寫法），檢查不通過也繼續往下。
// 只改 resource*\pipeline\nodes.json 裡這一行的節點名稱，可精確改回；第一次修改前備份成 nodes.json.modhub-bak。
// MaaEnd 更新資源時會覆蓋這個檔案，所以 ModHub 每次執行 MaaEnd 前都會重新套用。
const fs = require('node:fs');
const path = require('node:path');

const NODE = '"__SceneImageCheckMod": {';
const FAIL = '__SceneImageCheckModFailedFinish';
const SKIP = 'EmptyNode';
const RESOURCE_DIRS = ['resource', 'resource_cloud'];

const files = (root) => RESOURCE_DIRS.map((d) => path.join(root, d, 'pipeline', 'nodes.json')).filter((f) => fs.existsSync(f));

/** 找出節點的 next 陣列位置與內容 */
function locate(text) {
  const i = text.indexOf(NODE);
  if (i < 0) return null;
  const close = text.indexOf('\n    }', i);
  const end = close < 0 ? text.length : close;
  const m = /"next"\s*:\s*\[([^\]]*)\]/.exec(text.slice(i, end));
  if (!m) return null;
  const start = i + m.index + m[0].indexOf('[') + 1;
  const names = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  return { start, stop: start + m[1].length, inner: m[1], names };
}

/** 'original' | 'bypassed' | 'unknown'（MaaEnd 改了結構，不動） | 'missing'（沒有這個節點） */
function stateOf(text) {
  const loc = locate(text);
  if (!loc) return 'missing';
  const n = loc.names;
  if (n.length === 2 && n[0] === '__SceneImageCheckModSuccess' && n[1] === FAIL) return 'original';
  if (n.length === 2 && n[0] === '__SceneImageCheckModSuccess' && n[1] === SKIP) return 'bypassed';
  return 'unknown';
}

/** 全部 nodes.json 的狀態：'bypassed'（都已繞過）| 'original' | 'partial' | 'unknown' | 'missing' */
function status(root) {
  const states = files(root).map((f) => stateOf(fs.readFileSync(f, 'utf8')));
  const relevant = states.filter((s) => s !== 'missing');
  if (!relevant.length) return 'missing';
  if (relevant.includes('unknown')) return 'unknown';
  if (relevant.every((s) => s === 'bypassed')) return 'bypassed';
  if (relevant.every((s) => s === 'original')) return 'original';
  return 'partial';
}

function rewrite(text, from, to) {
  const loc = locate(text);
  const inner = loc.inner.replace(`"${from}"`, `"${to}"`);
  return text.slice(0, loc.start) + inner + text.slice(loc.stop);
}

function writeAtomic(file, text) {
  const tmp = `${file}.modhub-tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

/** 套用（on = true）或還原（on = false）；回傳變更的檔案數。結構不是預期的樣子時丟錯、不改 */
function apply(root, on) {
  let changed = 0;
  for (const f of files(root)) {
    const text = fs.readFileSync(f, 'utf8');
    const st = stateOf(text);
    if (st === 'missing') continue;
    if (st === 'unknown') throw new Error(`MaaEnd 的 MOD 檢查節點格式和預期不同（可能是新版改了），沒有修改：${f}`);
    if (on && st === 'original') {
      if (!/\n {4}"EmptyNode": \{/.test(text)) throw new Error(`找不到 MaaEnd 的 EmptyNode 節點，沒有修改：${f}`);
      const bak = `${f}.modhub-bak`;
      if (!fs.existsSync(bak)) fs.copyFileSync(f, bak);
      writeAtomic(f, rewrite(text, FAIL, SKIP));
      changed++;
    } else if (!on && st === 'bypassed') {
      writeAtomic(f, rewrite(text, SKIP, FAIL));
      changed++;
    }
  }
  return changed;
}

module.exports = { NODE, FAIL, SKIP, locate, stateOf, status, apply };
