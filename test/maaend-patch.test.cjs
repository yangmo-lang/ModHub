const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bypass = require('../electron/maaend-bypass.cjs');
const zhtw = require('../electron/maaend-zhtw.cjs');

const NODES = `{
    "EmptyNode": {
        "desc": "空节点",
        "post_delay": 0
    },
    "__SceneImageCheckMod": {
        "desc": "检查是否启用隐藏uid的mod",
        "max_hit": 1,
        "next": [
            "__SceneImageCheckModSuccess",
            "__SceneImageCheckModFailedFinish"
        ],
        "post_delay": 0
    },
    "__SceneImageCheckModFailedFinish": {
        "next": [
            "__SceneCheckAbortPipeline"
        ]
    }
}
`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-mepatch-'));
  fs.mkdirSync(path.join(root, 'resource', 'pipeline'), { recursive: true });
  fs.mkdirSync(path.join(root, 'resource', 'model', 'ocr'), { recursive: true });
  fs.writeFileSync(path.join(root, 'resource', 'pipeline', 'nodes.json'), NODES);
  fs.writeFileSync(zhtw.keysFile(root), 'a\r\n线\r\n線\r\n據點\r\n點\r\n');
  return root;
}

test('繞過 MOD 檢查：只改這個節點的下一步，可精確還原；第一次先備份', () => {
  const root = fixture();
  const file = path.join(root, 'resource', 'pipeline', 'nodes.json');
  assert.equal(bypass.status(root), 'original');
  assert.equal(bypass.apply(root, true), 1);
  assert.equal(bypass.status(root), 'bypassed');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(j.__SceneImageCheckMod.next, ['__SceneImageCheckModSuccess', 'EmptyNode']);
  assert.deepEqual(j.__SceneImageCheckModFailedFinish.next, ['__SceneCheckAbortPipeline'], '其他節點不動');
  assert.equal(fs.readFileSync(`${file}.modhub-bak`, 'utf8'), NODES);
  assert.equal(bypass.apply(root, true), 0, '已繞過就不再改');
  assert.equal(bypass.apply(root, false), 1);
  assert.equal(fs.readFileSync(file, 'utf8'), NODES, '還原後和原本一模一樣');
});

test('繞過 MOD 檢查：格式不同或沒有 EmptyNode 時不改', () => {
  const root = fixture();
  const file = path.join(root, 'resource', 'pipeline', 'nodes.json');
  fs.writeFileSync(file, NODES.replace('"__SceneImageCheckModFailedFinish"\n', '"Other"\n'));
  assert.equal(bypass.status(root), 'unknown');
  assert.throws(() => bypass.apply(root, true), /格式/);
  fs.writeFileSync(file, NODES.replace('"EmptyNode": {', '"NotEmpty": {'));
  assert.throws(() => bypass.apply(root, true), /EmptyNode/);
  fs.writeFileSync(file, '{}');
  assert.equal(bypass.status(root), 'missing');
});

test('繁中：OCR 字典逐行繁轉簡，行數與換行不變；MaaEnd 更新後重新套用；移除時還原', () => {
  const root = fixture();
  const map = { 線: '线', 點: '点', 據: '据' };
  const file = zhtw.keysFile(root);
  const original = fs.readFileSync(file, 'utf8');
  assert.deepEqual(zhtw.status(root, map), { found: true, installed: false, outdated: false, pending: 2 });
  let st = zhtw.install(root, map);
  assert.equal(st.installed, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'a\r\n线\r\n线\r\n據點\r\n点\r\n', '只換單字行');
  assert.equal(fs.readFileSync(zhtw.backupFile(root), 'utf8'), original);
  // MaaEnd 更新：換成新字典
  fs.writeFileSync(file, 'b\n線\n');
  assert.equal(zhtw.status(root, map).outdated, true);
  st = zhtw.install(root, map);
  assert.equal(fs.readFileSync(file, 'utf8'), 'b\n线\n');
  assert.equal(fs.readFileSync(zhtw.backupFile(root), 'utf8'), 'b\n線\n', '備份更新成新字典');
  zhtw.remove(root, map);
  assert.equal(fs.readFileSync(file, 'utf8'), 'b\n線\n');
  assert.equal(fs.existsSync(zhtw.backupFile(root)), false);
  assert.equal(zhtw.remove(root, map).installed, false, '沒有備份時不動');
});

test('繁中：opencc 對照表涵蓋常見遊戲用字', () => {
  const map = zhtw.t2sMap();
  for (const [t, s] of [['線', '线'], ['據', '据'], ['點', '点'], ['獎', '奖'], ['勵', '励'], ['錄', '录'], ['幹', '干'], ['員', '员']]) assert.equal(map[t], s, t);
});

test('繁中對照表：本身是簡體結果的字不再轉（麼→么，但「么」不變成「幺」）；不會連鎖', () => {
  const map = zhtw.t2sMap();
  assert.equal(map['麼'], '么');
  assert.equal(map['么'], undefined);
  for (const s of Object.values(map)) assert.equal(map[s], undefined, `連鎖：${s}`);
});
