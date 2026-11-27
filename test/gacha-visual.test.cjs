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
  const out = v.buildEndfield(recs, { A: { up6: '萊萬汀' }, B: { up6: '小刻', up6Avatar: 'strip.png' } }, { 小刻: 'square.png', 祀: 'si.png' });
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
  assert.equal(B.upIcon, 'square.png', 'UP 頭像用方形角色圖，不用官方橫長名牌圖');
  assert.equal(hits[0].icon, 'si.png');
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

test('絕區零（無官方統計）：限定池依時間分期，名稱為該期 UP，保底跨期累計', () => {
  const v = require('../electron/gacha/visual.cjs');
  const D = 86400000;
  const t0 = Date.parse('2026-07-06T12:00:00Z');
  const recs = [];
  let id = 1;
  const add = (time, name, tier = 'low') => recs.push({ id: String(id++), pool: 'zzz:2', name, tier, rarity: tier === 'top' ? 4 : 2, time });
  for (let i = 0; i < 23; i++) add(t0 + i * 1000, 'x');
  add(t0 + 30000, '維琳娜', 'top');
  for (let i = 0; i < 6; i++) add(t0 + 40000 + i, 'x'); // 已墊 6
  for (let i = 0; i < 70; i++) add(t0 + 23 * D + i * 1000, 'x');
  add(t0 + 23 * D + 80000, '萊卡恩', 'top'); // 歪
  add(t0 + 23 * D + 90000, '蕾米埃爾', 'top');
  const g = v.buildZzzFromRecords(recs, {}).groups[0];
  assert.equal(g.banners.length, 2);
  const [newer, older] = g.banners;
  assert.equal(older.name, '維琳娜');
  assert.equal(older.pad, 6);
  assert.equal(newer.name, '蕾米埃爾');
  assert.equal(newer.entries.find((e) => e.name === '萊卡恩').pity, 77, '6 + 71：保底跨期累計');
  assert.equal(newer.entries.find((e) => e.name === '萊卡恩').isUp, false);
});

test('離愁軒摘要：只補 ModHub 紀錄之前的卡池，常駐只補之前的 6★', () => {
  const v = require('../electron/gacha/visual.cjs');
  const lcx = require('../electron/gacha/lcx.cjs');
  const now = Date.parse('2026-11-27T12:00:00');
  const h = lcx.parse({
    limited: [
      { head: '冬猎 09月02日 ~ 09月04日 合计 74 抽 垫6', items: [{ pull: 6, stamps: ['暂未出货'] }, { six: '提弗洛斯', pull: 68, date: '09-02', stamps: [] }, { pull: 10, stamps: ['免'] }] },
      { head: '狼珀 03月29日 ~ 03月31日 合计 60 抽 垫32', items: [{ pull: 32, stamps: ['暂未出货'] }, { pull: 10, stamps: ['免'] }, { six: '汤汤', pull: 28, date: '03-29', stamps: ['歪'] }] },
    ],
    standard: [{ head: '基础寻访 01月22日 ~ 10月10日 合计 172 抽 保底 14 / 80', items: [{ pull: 14, stamps: ['暂未出货'] }, { six: '骏卫', pull: 43, date: '09-21', stamps: [] }, { six: '别礼', pull: 39, date: '03-12', stamps: [] }] }],
  }, { now });
  const SPc = 'char:E_CharacterGachaPoolType_Special';
  const STD = 'char:E_CharacterGachaPoolType_Standard';
  const t = Date.parse('2026-09-02T11:00:00');
  const records = [
    { id: 'c:1', pool: SPc, bannerId: 'b1', bannerName: '冬獵', poolName: '特許尋訪', name: 'x', tier: 'low', rarity: 4, time: t },
    { id: 'c:2', pool: STD, bannerId: 's', bannerName: '基礎尋訪', poolName: '基礎尋訪', name: 'y', tier: 'low', rarity: 4, time: t },
  ];
  const vis = v.mergeHistory(v.buildEndfield(records, {}, {}), h, records, {});
  const sp = vis.groups.find((g) => g.key === SPc);
  assert.deepEqual(sp.banners.map((b) => b.name), ['冬獵', '狼珀'], '冬獵已有逐抽紀錄，不重複；狼珀補上');
  const wolf = sp.banners[1];
  assert.equal(wolf.pulls, 70);
  assert.equal(wolf.free, 10);
  assert.equal(wolf.entries.find((e) => e.type === 'top').isUp, false);
  const std = vis.groups.find((g) => g.key === STD);
  const old = std.banners.find((b) => b.history);
  assert.deepEqual(old.entries.map((e) => e.name), ['別禮'], '9/2 之後的 6★ 不補');
  assert.equal(old.pulls, null);
});

test('摘要合併：同名卡池以新的為準，標示來源與備註', () => {
  const lcx = require('../electron/gacha/lcx.cjs');
  const now = Date.parse('2026-11-27T12:00:00');
  const a = lcx.parse({ limited: [{ head: '临渊望北 07月17日 ~ 07月18日 合计 6 抽 垫6', items: [{ pull: 6, stamps: ['暂未出货'] }] }] }, { now });
  const b = lcx.parse({ limited: [{ source: '截圖', note: '缺頁', head: '临渊望北 07月16日 ~ 07月18日 合计 60 抽 垫57', items: [{ pull: 57, stamps: ['暂未出货'] }, { six: '訣', pull: 11, date: '07-16', stamps: [] }] }] }, { now });
  const m = lcx.mergeInto(a, b);
  const list = m.groups['char:E_CharacterGachaPoolType_Special'];
  assert.equal(list.length, 1);
  assert.equal(list[0].total, 60);
  assert.equal(list[0].source, '截圖');
  assert.equal(list[0].note, '缺頁');
});
