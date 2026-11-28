const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const me = require('../electron/maaend.cjs');
const { schedule } = require('../electron/maaend-main.cjs');
const od = require('../electron/onedragon.cjs');

test('啟動參數：--autostart -i 實例 [-q]', () => {
  assert.deepEqual(me.launchArgs('日常任務', { meQuit: true }), ['--autostart', '-i', '日常任務', '-q']);
  assert.deepEqual(me.launchArgs(' A ', { meQuit: false }), ['--autostart', '-i', 'A']);
  assert.throws(() => me.launchArgs(''), /實例/);
  assert.throws(() => me.launchArgs('a"b'), /不支援/);
});

test('JSONC：註解、結尾逗號，字串裡的 // 不動', () => {
  const j = me.parseJsonc('﻿{\n // c\n "url": "https://x.y/a", /* b */ "a": [1, 2,],\n}');
  assert.deepEqual(j, { url: 'https://x.y/a', a: [1, 2] });
  assert.deepEqual(me.parseJsonc('{"s": "a\\"//b"}'), { s: 'a"//b' });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-maaend-'));
  fs.writeFileSync(path.join(root, 'MaaEnd.exe'), '');
  fs.mkdirSync(path.join(root, 'tasks'));
  fs.mkdirSync(path.join(root, 'locales', 'interface'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'interface.json'), `{
    "languages": { "zh_tw": "locales/interface/zh_tw.json" },
    "task": [],
    "import": [
      // 註解
      "tasks/DailyRewards.json",
      "../outside.json"
    ]
  }`);
  fs.writeFileSync(path.join(root, 'tasks', 'DailyRewards.json'), '{ "task": [{ "name": "DailyRewards", "label": "$task.DailyRewards.label" }, { "name": "Visit", "label": "拜訪" }] }');
  fs.writeFileSync(path.join(root, 'locales', 'interface', 'zh_tw.json'), '{ "task.DailyRewards.label": "日常獎勵" }');
  return root;
}

test('任務名稱：讀 interface.json 的 import 與繁中語系檔', () => {
  const root = fixture();
  assert.deepEqual(me.taskLabels(root), { DailyRewards: '日常獎勵', Visit: '拜訪' });
  assert.deepEqual(me.taskLabels(path.join(root, 'nope')), {});
});

test('實例：讀 config\\mxu-MaaEnd.json（依控制器的勾選）、自動執行實例、選擇順序', () => {
  const root = fixture();
  assert.match(me.readInstances(root).error, /先打開 MaaEnd/);
  fs.writeFileSync(me.configFile(root), JSON.stringify({
    version: '1',
    settings: { autoStartInstanceId: 'b' },
    instances: [
      { id: 'a', name: '日常', controllerName: 'Win32-Front', tasks: [
        { taskName: 'DailyRewards', enabled: false, enabledByController: { 'Win32-Front': true } },
        { taskName: 'Visit', enabled: true, enabledByController: { 'Win32-Front': false } },
        { taskName: 'Unknown', enabled: true, customName: '我的任務' },
      ] },
      { id: 'b', name: '快速', tasks: [] },
      { id: 'c' },
    ],
  }));
  const r = me.readInstances(root);
  assert.equal(r.instances.length, 2);
  assert.deepEqual(r.instances[0].tasks, [
    { name: 'DailyRewards', label: '日常獎勵', enabled: true },
    { name: 'Visit', label: '拜訪', enabled: false },
    { name: 'Unknown', label: '我的任務', enabled: true },
  ]);
  assert.equal(r.defaultName, '快速');
  assert.equal(me.resolveInstance('日常', r), '日常');
  assert.equal(me.resolveInstance('不存在', r), '快速', '設定的實例被刪掉 → MaaEnd 的自動執行實例');
  assert.equal(me.resolveInstance('', { ...r, defaultName: '' }), '日常', '都沒有 → 第一個');
  assert.equal(me.resolveInstance('', { instances: [], defaultName: '' }), '');
  fs.writeFileSync(me.configFile(root), '{bad');
  assert.match(me.readInstances(root).error, /讀不到/);
});

test('尋找 MaaEnd：設定的資料夾優先，否則找名稱含 MaaEnd 的資料夾', () => {
  const root = fixture();
  assert.equal(me.detect(root), root);
  assert.equal(me.detect(path.join(root, 'x')), '');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-maaend-base-'));
  const inner = path.join(base, 'MaaEnd-win-x86_64-v3.3.0', 'MaaEnd');
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, 'MaaEnd.exe'), '');
  assert.equal(me.detect('', { home: base, drives: [] }), inner);
});

test('GitHub 最新版：選 Windows x86_64 / arm64 壓縮檔與 SHA-256', () => {
  const rel = {
    tag_name: 'v3.3.0', html_url: 'https://github.com/MaaEnd/MaaEnd/releases/tag/v3.3.0',
    assets: [
      { name: 'MaaEnd-android-universal-v3.3.0.apk', browser_download_url: 'u0', size: 1 },
      { name: 'MaaEnd-win-aarch64-v3.3.0.zip', browser_download_url: 'u1', size: 2, digest: 'sha256:' + 'a'.repeat(64) },
      { name: 'MaaEnd-win-x86_64-v3.3.0.zip', browser_download_url: 'u2', size: 3, digest: 'sha256:' + 'B'.repeat(64) },
    ],
  };
  const x = me.pickPackage(rel, 'x64');
  assert.equal(x.url, 'u2');
  assert.equal(x.sha256, 'b'.repeat(64));
  assert.equal(x.version, '3.3.0');
  assert.equal(me.pickPackage(rel, 'arm64').url, 'u1');
  assert.equal(me.pickPackage({ assets: [] }), null);
});

test('定時：沿用一條龍的判斷（meSchedule* 欄位）', () => {
  const o = me.options({ meScheduleEnabled: true, meScheduleTime: '05:00' });
  assert.equal(od.dueNow(new Date(2026, 10, 28, 5, 10), schedule(o)), true);
  assert.equal(od.dueNow(new Date(2026, 10, 28, 5, 10), schedule({ ...o, meLastRunDate: '2026-11-28' })), false);
  assert.equal(od.dueNow(new Date(2026, 10, 28, 5, 10), schedule(me.options({}))), false, '預設關閉');
});
