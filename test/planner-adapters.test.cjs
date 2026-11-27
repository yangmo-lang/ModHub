const test = require('node:test');
const assert = require('node:assert');
const nk = require('../electron/planner/nanoka.cjs');
const ef = require('../electron/planner/endfield.cjs');
const calc = require('../electron/planner/calc.cjs');

test('終末地：64 位元文字 id 不失真', () => {
  const t = ef.safeParse('{"a":{"id":-2579965889461209287},"b":[7201533996830628902, 3]}');
  assert.equal(t.a.id, '-2579965889461209287');
  assert.equal(t.b[0], '7201533996830628902');
  assert.equal(t.b[1], 3);
});

test('終末地：資料表 → 模型', () => {
  const T = {
    I18nTextTable_TC: { 11: '佩麗卡', 12: '戰技', 13: '殲滅協議', 14: '昔日精品', 15: '折金票', 16: '協議圓盤' },
    CharLevelUpTable: { 1: { exp: 20, gold: 0 }, 2: { exp: 30, gold: 5 }, 3: { exp: 40, gold: 5 } },
    ExpItemDataMap: { item_exp_a: { expGain: 1000, expType: 0 }, item_exp_b: { expGain: 1000, expType: 2 } },
    WeaponExpItemTable: { 1: { expItemId: 'item_wexp', itemExp: 500 } },
    ItemTable: { item_gold: { name: { id: '15' }, iconId: 'item_gold', rarity: 4 }, item_char_break_stage_1_2: { name: { id: '16' }, rarity: 3 }, wpn_x: { name: { id: '14' } } },
    CharGrowthTable: {
      chr_0004_pelica: {
        name: { id: '11' }, engName: 'Perlica', rarity: 5,
        charBreakCostMap: { charBreak2: { nodeId: 'charBreak2', nodeType: 1, breakStage: 1, requiredItem: [{ id: 'item_char_break_stage_1_2', count: 8 }, { id: 'item_gold', count: 1600 }] } },
        skillGroupMap: { chr_0004_pelica_NormalSkill: { name: { id: '12' } } },
        skillLevelUp: [{ skillGroupId: 'chr_0004_pelica_NormalSkill', level: 2, goldCost: 1000, itemBundle: [{ id: 'item_skill', count: 6 }] }],
        talentNodeMap: {
          p1: { nodeId: 'p1', nodeType: 4, passiveSkillNodeInfo: { name: { id: '13' }, level: 1, breakStage: 1 }, requiredItem: [{ id: 'item_skill', count: 12 }] },
          charBreak2: { nodeId: 'charBreak2', nodeType: 1, requiredItem: [{ id: 'x', count: 1 }] },
        },
      },
      chr_9000_endmin: { name: { id: '0' } },
    },
    WeaponBasicTable: { wpn_x: { maxLv: 3, rarity: 6, levelTemplateId: 'c', breakthroughTemplateId: 'b' } },
    WeaponUpgradeTemplateTable: { c: { list: [{ weaponLv: 1, lvUpExp: 10, lvUpGold: 1 }, { weaponLv: 2, lvUpExp: 20, lvUpGold: 2 }, { weaponLv: 3, lvUpExp: 0, lvUpGold: 0 }] } },
    WeaponBreakThroughTemplateTable: { b: { list: [{ breakthroughShowLv: 0, breakthroughLv: 1, breakItemList: [] }, { breakthroughShowLv: 1, breakthroughLv: 2, breakItemList: [{ id: 'item_wb', count: 5 }], breakthroughGold: 2200 }] } },
  };
  const d = ef.buildFromTables(T, '1.0');
  assert.equal(d.characters.length, 1, '劇情管理員要排除');
  const p = d.characters[0];
  assert.equal(p.name, '佩麗卡');
  assert.equal(p.maxLevel, 3);
  assert.deepEqual(p.stages, [{ stage: 1, level: 2, materials: [{ id: 'item_char_break_stage_1_2', count: 8 }, { id: 'item_gold', count: 1600 }] }]);
  assert.equal(p.skills[0].name, '戰技');
  assert.deepEqual(p.nodes.map((n) => n.name), ['殲滅協議 Lv.1']);
  assert.equal(p.levels[1].gold, 5);
  const r = calc.calcEntry(p, calc.defaultConfig(p, 'k'));
  assert.equal(r.materials.get('item_gold'), 1600 + 1000 + 5 + 0);
  const w = d.weapons[0];
  assert.equal(w.name, '昔日精品');
  assert.deepEqual(w.stages.map((s) => s.level), [2]);
  assert.equal(calc.calcEntry(w, calc.defaultConfig(w, 'w')).exp.efWeapon, 30);
  assert.equal(d.items.item_gold.name, '折金票');
  assert.equal(d.pools.efExp2.items[0].id, 'item_exp_b');
});

test('星鐵：晉階花費與技能、行跡', () => {
  const d = {
    stats: { 0: { cost: [{ item_id: 2, item_num: 4000 }, { item_id: 9, item_num: 5 }] }, 1: { cost: [{ item_id: 2, item_num: 8000 }] }, 6: { cost: [] } },
    skills: { 101: { name: '战技' } },
    skill_trees: {
      point02: { 1: { max_level: 3, level_up_skill_id: [101], material_list: [] }, 2: { material_list: [{ item_id: 2, item_num: 2500 }] }, 3: { material_list: [{ item_id: 7, item_num: 1 }] } },
      point07: { 1: { max_level: 1, point_name: '模组', avatar_promotion_limit: 2, material_list: [{ item_id: 8, item_num: 1 }] } },
    },
  };
  const m = nk.hsrCharacter('1310', d, { name: '流螢' });
  assert.deepEqual(m.stages.map((s) => [s.stage, s.level]), [[1, 20], [2, 30]]);
  assert.equal(m.skills[0].name, '戰技');
  assert.deepEqual(m.skills[0].costs[3], [{ id: '7', count: 1 }]);
  assert.equal(m.nodes[0].stage, 2);
  assert.equal(m.levels.length, 79);
});

test('絕區零：技能花費是「從 n 升到 n+1」', () => {
  const d = {
    level: { 1: { level_min: 0, level_max: 10, materials: { 10: 24000 } }, 2: { level_min: 10, level_max: 20, materials: {} } },
    level_exp: Array(60).fill(10),
    skill: { basic: { material: { 1: { 10: 2000 }, 2: { 10: 3000 }, 3: {} } } },
    passive: { materials: { 1: { 10: 5000 } } },
  };
  const m = nk.zzzCharacter('1', d, {});
  assert.deepEqual(m.stages, [{ stage: 1, level: 10, materials: [{ id: '10', count: 24000 }] }]);
  const basic = m.skills.find((s) => s.id === 'basic');
  assert.equal(basic.maxLevel, 3);
  assert.deepEqual(basic.costs[2], [{ id: '10', count: 2000 }]);
  const core = m.skills.find((s) => s.id === 'core');
  assert.equal(core.maxLevel, 2);
});
