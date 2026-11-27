const test = require('node:test');
const assert = require('node:assert');
const { cleanText, versionNewer, sklandCodex } = require('../electron/codex.cjs');

test('文字清理', () => {
  assert.equal(cleanText('{RUBY_B#みつき}三月{RUBY_E#}なのか'), '三月なのか');
  assert.equal(cleanText('a\\nb <color=#fff>c</color>'), 'a\nb c');
  assert.equal(cleanText('<te href=850124>bodyguard</te> of'), 'bodyguard of');
});

test('版本比較', () => {
  assert.ok(versionNewer('4.7.53', '4.7'));
  assert.ok(versionNewer('3.4.12+20855865', '3.3'));
  assert.ok(!versionNewer('3.8', '3.8'));
  assert.ok(!versionNewer('3.3', '3.4.1+1'));
});

test('森空島資料整理：前瞻、卡池、活動、情報', () => {
  const DETAIL = (m, s, id) => `https://wiki.skland.com/endfield/detail?mainTypeId=${m}&subTypeId=${s}&gameEntryId=${id}`;
  const w = {
    catalogs: [
      { mainId: '1', main: '终末地百科', subId: '1', sub: '干员', items: [
        { id: '2923', name: '米米诺', tagIds: ['10005'], cover: 'a.png', dotType: 'label_type_preview', caption: '火力支援' },
        { id: '2922', name: '小刻', tagIds: ['10006', '10104'], cover: 'b.png', dotType: 'label_type_up', caption: '' },
      ] },
      { mainId: '1', main: '终末地百科', subId: '2', sub: '武器', items: [{ id: '2924', name: '恣游', tagIds: [], cover: 'w.png', dotType: 'label_type_up' }] },
      { mainId: '9', main: '情报档案库', subId: '30', sub: '情报资讯', items: [{ id: '5', name: '版本前瞻', cover: 'n.png', publishedAt: 1795000000000 }] },
    ],
    tagTrees: { '1:1': [
      { name: '星级', children: [{ id: '10005', name: '5星' }, { id: '10006', name: '6星' }] },
      { name: '属性', children: [{ id: '10104', name: '自然' }] },
    ] },
    charPools: [{ name: '锻砧、行囊与蜜糖', poolStartAtTs: '1795536000', poolEndAtTs: '1797998399', chars: [{ pcLink: DETAIL(1, 1, 2922), pic: 'p.png', rarity: 'rarity_6', dotType: 'label_type_up' }] }],
    weaponPools: [],
    activities: [{ name: '蜜饼是我的祈愿', description: '叙事活动', activityStartAtTs: '1795579200', activityEndAtTs: '1799272800', pcLink: 'https://www.skland.com/article?id=1' }],
  };
  const c = sklandCodex(w, DETAIL);
  assert.deepEqual(c.sections.map((s) => s.label), ['干員', '武器']);
  const mi = c.sections[0].items.find((i) => i.id === '2923');
  assert.equal(mi.name, '米米諾');
  assert.equal(mi.preview, true);
  assert.equal(mi.rarity, 5);
  assert.equal(c.sections[0].items.find((i) => i.id === '2922').element, '自然');
  assert.deepEqual(c.preview.groups.map((g) => g.label), ['前瞻干員']);
  assert.equal(c.preview.pools[0].items[0].name, '小刻');
  assert.equal(c.preview.pools[0].name, '鍛砧、行囊與蜜糖');
  assert.equal(c.preview.activities[0].type, '敘事活動');
  assert.equal(c.preview.news[0].name, '版本前瞻');
});
