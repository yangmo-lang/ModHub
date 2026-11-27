const test = require('node:test');
const assert = require('node:assert');
const v = require('../electron/gacha/visual.cjs');

const SP = 'char:E_CharacterGachaPoolType_Special';
let seq = 0;
const r = (bannerId, tier, name, extra = {}) => ({ id: String(++seq), pool: SP, poolName: '特許尋訪', bannerId, bannerName: bannerId, name, tier, rarity: tier === 'top' ? 6 : 4, time: seq * 1000, ...extra });

test('終末地：每期卡池、加急尋訪、歪、已墊（帶到下一期）', () => {
  seq = 0;
  const recs = [];
  for (let i = 0; i < 9; i++) recs.push(r('A', 'low', 'x'));
  recs.push(r('A', 'top', '萊萬汀'));                  // A 期第 10 抽：UP
  for (let i = 0; i < 5; i++) recs.push(r('A', 'low', 'x')); // A 期結束時墊 5 抽
  for (let i = 0; i < 10; i++) recs.push(r('B', 'low', 'x', { free: true })); // B 期加急 10 抽
  for (let i = 0; i < 65; i++) recs.push(r('B', 'low', 'x'));
  recs.push(r('B', 'top', '祀'));                      // 5 + 66 = 71 抽，常駐角色 → 歪
  recs.push(r('standard', 'top', '祀', { pool: 'char:E_CharacterGachaPoolType_Standard' }));
  const out = v.buildEndfield(recs, { A: { up6: '萊萬汀' }, B: { up6: '小刻', up6Avatar: 'up.png' } }, {});
  const g = out.groups.find((x) => x.key === SP);
  assert.deepEqual(g.banners.map((b) => b.id), ['B', 'A'], '新的在前');
  const [B, A] = g.banners;
  assert.equal(A.pad, 5);
  const hits = B.entries.filter((e) => e.type === 'top');
  assert.equal(hits[0].name, '祀');
  assert.equal(hits[0].pity, 71);
  assert.equal(hits[0].isUp, false);
  assert.deepEqual(B.entries.find((e) => e.type === 'free'), { type: 'free', count: 10, time: 25000 });
  assert.equal(B.pulls, 76);
  assert.equal(B.free, 10);
  assert.equal(B.upIcon, 'up.png');
  assert.equal(g.pityNow, 0);
  assert.deepEqual(g.bigPity, { paid: 66, max: 120, remaining: 54, gotUp: false, name: 'B' });
  assert.equal(out.totals.upWin, 0.5);
});

test('絕區零：官方統計 → 卡池（is_up、目前卡池、尚未開放的不列入）', () => {
  const official = {
    index: { total: 100, s: 2 },
    types: {
      GACHA_TYPE_CHARACTER_UP: {
        stat: { total_count: '100', s_count: '2', up_count: '1', next_s_cur_times: 7, new_s_max_times: 87 },
        cur: [
          { gacha_state: 'GACHA_STATE_IN_PROGRESS', version: '3.3', start_ts: 100, end_ts: 200, cur_item_list: [{ name: '赛维里安', rarity: 'S', icon: 's.png' }], cur_records: [] },
          { gacha_state: 'GACHA_STATE_NOT_START', version: '3.4', cur_item_list: [{ name: '挽昼', rarity: 'S' }], cur_records: [] },
        ],
        hist: [{ version: '3.1', cur_item_list: [], cur_records: [{ name: '蕾米埃尔', is_up: true, count: '79', record_time: '50', icon: 'r.png' }, { name: '莱卡恩', is_up: false, count: '79', record_time: '40' }] }],
      },
    },
  };
  const out = v.buildZzz([], official, {});
  const g = out.groups[0];
  assert.equal(g.pityMax, 90, '保底上限固定 90（官方的 new_s_max_times 是歷來最多）');
  assert.equal(g.worstPity, 87);
  assert.deepEqual(g.banners.map((b) => b.name), ['賽維里安', '蕾米埃爾'], '繁體、不含尚未開放');
  const hist = g.banners[1];
  assert.deepEqual(hist.entries.map((e) => [e.name, e.isUp]), [['蕾米埃爾', true], ['萊卡恩', false]]);
  assert.equal(out.totals.upWin, 0.5);
});

test('逐抽格子：T 編號與各稀有度計數', () => {
  seq = 0;
  const recs = [r('A', 'low', 'a'), r('A', 'mid', 'b'), r('A', 'low', 'c'), r('A', 'top', 'd'), r('B', 'low', 'e')];
  const all = v.pullGrid(recs, {}, { pool: SP });
  assert.deepEqual(all.map((x) => [x.t, x.name, x.n]), [[5, 'e', 2], [4, 'd', 4], [3, 'c', 2], [2, 'b', 2], [1, 'a', 1]]);
  assert.equal(v.pullGrid(recs, {}, { pool: SP, bannerId: 'B' }).length, 1);
});
