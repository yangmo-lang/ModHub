const test = require('node:test');
const assert = require('node:assert');
const hs = require('../electron/planner/hoyosync.cjs');
const calc = require('../electron/planner/calc.cjs');

const hsrModel = {
  game: 'SRMI', kind: 'character', id: '1305', maxLevel: 80, currencyId: '2',
  levels: Array.from({ length: 79 }, (_, i) => ({ level: i + 1, exp: 1, pool: 'p', gold: 0 })),
  stages: [20, 30, 40, 50, 60, 70].map((lv, i) => ({ stage: i + 1, level: lv, materials: [] })),
  skills: [{ id: 'point01', minLevel: 1, maxLevel: 6, costs: {} }, { id: 'point02', minLevel: 1, maxLevel: 10, costs: {} }],
  nodes: [{ id: 'point07', stage: 2, materials: [] }, { id: 'point08', stage: 4, materials: [] }],
};

test('星鐵：detail → 目前進度（anchor 對應技能、已點亮的行跡）', () => {
  const detail = {
    avatar: { cur_level: 70 },
    skills: [{ anchor: 'Point01', cur_level: 2 }, { anchor: 'Point02', cur_level: 8 }],
    skills_other: [{ anchor: 'Point07', cur_level: 1, progress: 'Learned' }, { anchor: 'Point08', cur_level: 0, progress: 'CanLearnButStillNotLearn' }],
  };
  const p = hs.hsrCharacterProgress(hsrModel, detail);
  assert.deepEqual(p, { level: 70, stage: 5, skills: { point01: 2, point02: 8 }, nodes: ['point07'] });
});

test('套用進度：目標不低於目前，原本的目標保留', () => {
  const cfg = calc.defaultConfig(hsrModel, 'k');
  const out = hs.applyProgress(hsrModel, { ...cfg, tgt: { ...cfg.tgt, level: 60 } }, { level: 70, stage: 5, skills: { point01: 2 }, nodes: ['point07'] });
  assert.equal(out.cur.level, 70);
  assert.equal(out.tgt.level, 70, '目標 60 低於目前 70，拉高到 70');
  assert.equal(out.cur.skills.point01, 2);
  assert.equal(out.tgt.skills.point02, 10, '原本的目標保留');
  assert.ok(out.tgt.nodes.includes('point07'));
});

test('絕區零：skill_type 對應 ModHub 技能 id', () => {
  const model = { maxLevel: 60, stages: [10, 20, 30, 40, 50].map((lv, i) => ({ stage: i + 1, level: lv })), skills: ['basic', 'dodge', 'special', 'chain', 'assist'].map((id) => ({ id, minLevel: 1, maxLevel: 12 })).concat([{ id: 'core', minLevel: 1, maxLevel: 7 }]), nodes: [] };
  const info = { level: 50, skills: [{ skill_type: 0, level: 12 }, { skill_type: 1, level: 9 }, { skill_type: 2, level: 8 }, { skill_type: 3, level: 7 }, { skill_type: 5, level: 7 }, { skill_type: 6, level: 6 }] };
  assert.deepEqual(hs.zzzCharacterProgress(model, info), { level: 50, stage: 4, skills: { basic: 12, special: 9, dodge: 8, chain: 7, core: 7, assist: 6 }, nodes: [] });
});
