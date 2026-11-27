const test = require('node:test');
const assert = require('node:assert');
const { calcEntry, summarize, convertExp, normalizeConfig, defaultConfig, minStageForLevel } = require('../electron/planner/calc.cjs');

// 簡化版模型：最高 40 級，20 級突破一次
const model = {
  game: 'T', kind: 'character', id: 'c1', name: '測試角色', currencyId: 'gold',
  maxLevel: 40,
  levels: Array.from({ length: 39 }, (_, i) => ({ level: i + 1, exp: 100, pool: 'charExp', gold: 10 })),
  stages: [{ stage: 1, level: 20, materials: [{ id: 'gem', count: 5 }, { id: 'gold', count: 1000 }] }],
  skills: [{ id: 's1', name: '技能', minLevel: 1, maxLevel: 3, costs: { 2: [{ id: 'book', count: 2 }], 3: [{ id: 'book', count: 4 }, { id: 'crown', count: 1 }] } }],
  nodes: [{ id: 'n1', name: '行跡', stage: 1, materials: [{ id: 'book', count: 1 }] }],
};

test('突破階段與等級一致', () => {
  assert.equal(minStageForLevel(model, 20), 0);
  assert.equal(minStageForLevel(model, 21), 1);
  const c = normalizeConfig(model, { cur: { level: 30, stage: 0 }, tgt: { level: 10, stage: 0 } });
  assert.equal(c.cur.stage, 1, '30 級一定已突破');
  assert.equal(c.tgt.level, 30, '目標不能低於目前');
  const d = normalizeConfig(model, { cur: { level: 5, stage: 1 }, tgt: {} });
  assert.equal(d.cur.level, 20, '已突破代表至少 20 級');
});

test('單一目標全滿', () => {
  const r = calcEntry(model, defaultConfig(model, 'k'));
  assert.equal(r.exp.charExp, 39 * 100);
  assert.equal(r.materials.get('gold'), 39 * 10 + 1000);
  assert.equal(r.materials.get('gem'), 5);
  assert.equal(r.materials.get('book'), 2 + 4 + 1);
  assert.equal(r.materials.get('crown'), 1);
});

test('只算目前到目標之間', () => {
  const r = calcEntry(model, { cur: { level: 20, stage: 1, skills: { s1: 2 }, nodes: ['n1'] }, tgt: { level: 22, stage: 1, skills: { s1: 3 }, nodes: ['n1'] } });
  assert.equal(r.exp.charExp, 200);
  assert.equal(r.materials.get('gem'), undefined);
  assert.equal(r.materials.get('book'), 4);
});

test('經驗換算：先扣背包，再用最高級補，餘數用最低級', () => {
  const pool = { items: [{ id: 'big', exp: 20000, cost: 0 }, { id: 'small', exp: 1000 }] };
  const c = convertExp(45500, pool, { small: 2 });
  assert.equal(c.ownedExp, 2000);
  assert.equal(c.shortExp, 43500);
  assert.deepEqual(c.buy, [{ id: 'big', count: 2 }, { id: 'small', count: 4 }]);
  const lc = convertExp(6000, { items: [{ id: 'a', exp: 6000, cost: 3000 }] });
  assert.equal(lc.currency, 3000);
});

test('彙總、庫存缺口、材料反查', () => {
  const pools = { charExp: { label: '角色經驗', items: [{ id: 'xp', exp: 1000 }] } };
  const s = summarize([{ model, cfg: defaultConfig(model, 'a') }, { model: { ...model, id: 'c2', name: '角色二' }, cfg: defaultConfig({ ...model, id: 'c2' }, 'b') }], pools, { book: 10, xp: 3 });
  const book = s.materials.find((m) => m.id === 'book');
  assert.equal(book.need, 14);
  assert.equal(book.have, 10);
  assert.equal(book.short, 4);
  assert.deepEqual(book.usedBy.map((u) => u.name), ['測試角色', '角色二']);
  assert.equal(s.exp[0].need, 7800);
  assert.equal(s.exp[0].shortExp, 4800);
  assert.deepEqual(s.exp[0].buy, [{ id: 'xp', count: 5 }], '4800 經驗要 5 個 1000 的道具');
});
