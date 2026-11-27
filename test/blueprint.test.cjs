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

test('藍圖：欄位順序、型別註記、陣列結尾格式改變也讀得到', () => {
  const src = `<script setup>
const cnList = ref([
  { title: '第一区', type: 'section' }, { code: 'EF01AAAAbbbb1111', label: '产线 [1]', type: 'code' } ]);
const servers = [{ entries: cnList, title: '国服', key: 'cn' }];
</script>`;
  const d = parse(src);
  assert.deepEqual(d.regions, [{ key: 'cn', title: '国服', entries: [
    { type: 'section', title: '第一区' },
    { type: 'code', label: '产线 [1]', code: 'EF01AAAAbbbb1111' },
  ] }]);
});

test('藍圖：沒有伺服器清單時，每個含藍圖碼的陣列各算一區', () => {
  const src = `const asiaEntries = [
  { name: '线 A', code: 'EF01CCCCdddd2222' },
];
const euUsEntries = [{ label: '线 B', code: 'EF01EEEEffff3333' }];`;
  const d = parse(src);
  assert.deepEqual(d.regions.map((r) => [r.key, r.title, r.entries[0].label]), [['asia', '亚服蓝图码', '线 A'], ['eu-us', '欧美服蓝图码', '线 B']]);
});

test('藍圖：原檔搬走時從 repo 檔案樹找新位置', async () => {
  const { locateSource, rankCandidates, SOURCE_URL } = require('../electron/blueprint.cjs');
  assert.deepEqual(rankCandidates(['app/pages/blueprint/x.vue', 'README.md', 'app/pages/aic/blueprint/index.vue', 'types/blueprint.d.ts']),
    ['app/pages/aic/blueprint/index.vue', 'app/pages/blueprint/x.vue']);
  const files = {
    'app/pages/aic/blueprint/index.vue': `const cnEntries = [{ type: 'code', label: 'L', code: 'EF01AAAAbbbb1111' }];`,
  };
  const fetched = [];
  const fetchText = async (url) => {
    fetched.push(url);
    const p = Object.keys(files).find((k) => url.endsWith(k));
    if (!p) throw new Error('HTTP 404');
    return files[p];
  };
  const fetchJson = async () => ({ tree: [{ type: 'blob', path: 'app/pages/aic/blueprint/index.vue' }, { type: 'blob', path: 'README.md' }] });
  const r = await locateSource(fetchText, fetchJson, null);
  assert.equal(r.relocated, true);
  assert.ok(r.url.endsWith('/dev/app/pages/aic/blueprint/index.vue'));
  assert.equal(r.parsed.regions[0].entries[0].code, 'EF01AAAAbbbb1111');
  assert.equal(fetched[0], SOURCE_URL);
  // 下次先試上次成功的位置
  fetched.length = 0;
  await locateSource(fetchText, fetchJson, r.url);
  assert.deepEqual(fetched, [r.url]);
  // 全都失敗時丟出說明
  await assert.rejects(locateSource(async () => 'nothing', async () => ({ tree: [] }), null), /讀不到藍圖碼/);
});
