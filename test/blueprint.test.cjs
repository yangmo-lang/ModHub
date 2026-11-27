const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../electron/blueprint.cjs');

// 自己寫的假資料，只模擬一圖流頁面原始檔的格式（不含他們的內容）
const SAMPLE = `<template>
  <h1 class="page-title">测试蓝图标题</h1>
</template>
<script setup lang="ts">
const tutorialVideoUrls = [
  'https://www.bilibili.com/video/BVtest1',
  'javascript:alert(1)',
];
const images = [
  { url: 'https://cos.example.com/a.JPG' },
];
const cnEntries: BlueprintEntry[] = [
  { type: 'section', title: '第一区' },
  { type: 'code', label: '产线 1', code: 'EF01AAAAbbbb1111' },
  { type: 'code', label: '坏的', code: 'EF01 <script>' },
];
const asiaEntries: BlueprintEntry[] = [
  { type: 'section', title: '第一区' },
  { type: 'code', label: "产线 '1'", code: 'EFO01CCCCdddd2222' },
];
const blueprintRegions = ref(
  (
    [
      { key: 'cn', title: '国服蓝图码', entries: cnEntries },
      { key: 'asia', title: '亚服蓝图码', entries: asiaEntries },
      { key: 'empty', title: '空的', entries: missingEntries },
    ] as BlueprintRegion[]
  ),
);
</script>`;

test('藍圖：解析一圖流頁面原始檔（不執行程式碼）', () => {
  const d = parse(SAMPLE);
  assert.equal(d.title, '测试蓝图标题');
  assert.deepEqual(d.videos, ['https://www.bilibili.com/video/BVtest1'], '只收 https 連結');
  assert.deepEqual(d.images, ['https://cos.example.com/a.JPG']);
  assert.deepEqual(d.regions.map((r) => r.key), ['cn', 'asia'], '沒有藍圖碼的伺服器略過');
  const cn = d.regions[0];
  assert.equal(cn.title, '国服蓝图码');
  assert.deepEqual(cn.entries, [
    { type: 'section', title: '第一区' },
    { type: 'code', label: '产线 1', code: 'EF01AAAAbbbb1111' },
  ], '格式不對的藍圖碼略過');
  assert.equal(d.regions[1].entries[1].label, "产线 '1'");
});

test('藍圖：格式改變時回傳空資料而不是丟錯', () => {
  assert.deepEqual(parse('<html>nothing</html>').regions, []);
  assert.deepEqual(parse(null).regions, []);
});
