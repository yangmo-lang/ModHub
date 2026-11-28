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

test('終末地：推斷沒有官方資料的卡池 UP，歪出以前的限定角色也算歪；平均 UP 抽數', () => {
  const top = (name, extra = {}) => ({ type: 'top', name, isUp: true, free: false, ...extra });
  const vis = {
    totals: { pulls: 0, upWin: null, upKnown: 0 },
    groups: [
      { key: 'char:E_CharacterGachaPoolType_Special', pityNow: 10, banners: [
        { name: 'D', start: 40, end: 41, pulls: 60, free: 0, upName: '小刻', entries: [top('小刻'), top('祀', { isUp: false })] },
        { name: 'C', start: 30, end: 31, pulls: 80, free: 10, entries: [top('訣'), top('梨諾'), top('黎風'), top('梨諾', { free: true })] },
        { name: 'B', start: 20, end: 21, pulls: null, entries: [top('洛茜'), top('莊方宜')] },
        { name: 'A', start: 10, end: 11, pulls: 100, free: 0, entries: [top('洛茜'), top('洛茜')] },
      ] },
      { key: 'char:E_CharacterGachaPoolType_Standard', banners: [{ name: 'S', pulls: 10, entries: [top('別禮', { isUp: null })] }] },
    ],
  };
  const order = new Map([['洛茜', 27], ['莊方宜', 28], ['訣', 31], ['梨諾', 32], ['小刻', 36], ['祀', 34]].map(([n, o]) => [n, o]));
  v.refineEndfieldUps(vis, { standard: ['黎風'], order });
  const g = vis.groups[0];
  const marks = (b) => b.entries.filter((e) => e.type === 'top').map((e) => `${e.name}${e.isUp === true ? '+' : e.isUp === false ? '-' : '?'}`).join(' ');
  assert.equal(marks(g.banners[3]), '洛茜+ 洛茜+');
  assert.equal(marks(g.banners[2]), '洛茜- 莊方宜+', '以前的 UP 再出現算歪');
  assert.equal(marks(g.banners[1]), '訣- 梨諾+ 黎風- 梨諾+', '多個新限定取實裝最新的；常駐算歪');
  assert.equal(g.banners[1].upName, '梨諾');
  assert.equal(g.banners[1].upInferred, true);
  assert.equal(marks(g.banners[0]), '小刻+ 祀-', '有官方資料的不動');
  // 不歪率：A 2/2、B 1/2、C 1/3（免費抽不算）、D 1/2 → 5/9
  assert.equal(vis.totals.upKnown, 9);
  assert.equal(vis.totals.upWin, 5 / 9);

  v.addUpAverages(vis);
  // 有抽數的卡池：A 100 + C 70 + D 60 = 230，扣已墊 10 → 220；UP（不含免費）A2 + C1 + D1 = 4
  assert.deepEqual(vis.totals.avgUpChar, { avg: 55, ups: 4, pulls: 220 });
  assert.equal(vis.totals.avgUpWeapon, null);
  assert.equal(vis.groups[1].avgUp, null);
});

test('推斷：沒有實裝順序又有多個候選時標成未知', () => {
  const vis = { totals: {}, groups: [{ key: 'char:E_CharacterGachaPoolType_Special', banners: [
    { name: 'X', start: 1, end: 2, pulls: 10, entries: [{ type: 'top', name: '甲', isUp: true }, { type: 'top', name: '乙', isUp: true }] },
  ] }] };
  v.refineEndfieldUps(vis, {});
  assert.deepEqual(vis.groups[0].banners[0].entries.map((e) => e.isUp), [null, null]);
});

test('星鐵：後來加入常駐的角色（刃）從確定的時間起算歪，它自己的限定池仍算 UP', () => {
  let t = 0;
  const pulls = (bannerId, seq, pool = 'hsr:11') => seq.map((name) => ({ id: String(++t), pool, bannerId, time: t * 1000, name: name || '路人', tier: name ? 'top' : 'low', rarity: name ? 5 : 3 }));
  const records = [
    ...pulls('blade-1', [null, '刃']), // 刃自己的限定池
    ...pulls('pearl', [null, '真珠', '真珠', '刃', '真珠']), // 刃在別人的池出現 → 常駐
    ...pulls('aha', ['星神★阿哈', null, '刃', '星神★阿哈']),
    ...pulls('feixiao', ['緋英', '姬子']),
    ...pulls('tie', ['甲', '乙']), // 次數一樣，分不出來
  ];
  const vis = v.buildHsr(records, {});
  const g = vis.groups.find((x) => x.key === 'hsr:11');
  const byName = Object.fromEntries(g.banners.map((b) => [b.bannerId, b.entries.map((e) => `${e.name}${e.isUp ? '+' : '-'}`).reverse().join(' ')]));
  assert.equal(byName['blade-1'], '刃+');
  assert.equal(byName.pearl, '真珠+ 真珠+ 刃- 真珠+');
  assert.equal(byName.aha, '星神★阿哈+ 刃- 星神★阿哈+');
  assert.equal(byName.feixiao, '緋英+ 姬子-');
  assert.equal(g.banners.find((b) => b.bannerId === 'aha').name, '星神★阿哈', '卡池名稱不再列出刃');
  const since = v.learnStandardSince(records, new Set(['hsr:11']), () => false);
  assert.ok(since.has('刃') && !since.has('甲') && !since.has('乙'));
});

test('星鐵：用 bannerhistory 對照當時的 UP（星緣相邀的刃算歪、千冶•刃不會誤配）', () => {
  const D = 86400000;
  const bhPools = [
    { start: 100 * D, end: 140 * D, characters: [{ name: '真珠' }] },
    { start: 120 * D, end: 140 * D, characters: [{ name: '千冶•刃' }] },
    { start: 141 * D, end: 180 * D, characters: [{ name: '阿哈' }] },
  ];
  assert.equal(v.matchesUp('星神★阿哈', new Set(['阿哈'])), true);
  assert.equal(v.matchesUp('刃', v.activeUps(bhPools, 130 * D)), false);
  assert.equal(v.matchesUp('千冶•刃', v.activeUps(bhPools, 130 * D)), true);
  let t = 0;
  const recs = (bannerId, day, seq) => seq.map((name) => ({ id: String(++t), pool: 'hsr:11', bannerId, time: day * D + t * 1000, name: name || '路人', tier: name ? 'top' : 'low', rarity: name ? 5 : 3 }));
  const records = [
    ...recs('pearl', 110, ['刃', null, '真珠']), // 只出過一次刃也能判斷
    ...recs('qianye', 125, ['千冶•刃', '真珠']), // 千冶池裡歪出真珠（同時開的另一池 UP）
    ...recs('aha', 150, ['刃', '星神★阿哈']),
  ];
  const vis = v.buildHsr(records, {}, { bhPools });
  const g = vis.groups.find((x) => x.key === 'hsr:11');
  const marks = Object.fromEntries(g.banners.map((b) => [b.bannerId, b.entries.map((e) => `${e.name}${e.isUp ? '+' : '-'}`).reverse().join(' ')]));
  assert.equal(marks.pearl, '刃- 真珠+');
  assert.equal(marks.qianye, '千冶•刃+ 真珠+', '同時開的兩個 UP 各一次分不出來時都算 UP');
  assert.equal(marks.aha, '刃- 星神★阿哈+');
  assert.equal(vis.totals.upKnown, 6);
  // 沒有 bannerhistory 資料時沿用常駐名單（刃不在名單 → 算 UP）
  const old = v.buildHsr(recs('x', 200, ['刃']), {}, {});
  assert.equal(old.groups[0].banners[0].entries[0].isUp, true);
});

test('平均 UP 抽數：只有出貨抽數的卡池（絕區零官方統計）用出貨抽數加總', () => {
  const vis = { totals: {}, groups: [
    { key: 'GACHA_TYPE_CHARACTER_UP', pityNow: 3, banners: [
      { pulls: null, entries: [{ type: 'top', name: 'A', pity: 77, isUp: true }, { type: 'top', name: 'B', pity: 80, isUp: false }] },
      { pulls: null, entries: [{ type: 'top', name: 'C', pity: 60, isUp: true }] },
    ] },
    { key: 'GACHA_TYPE_WEAPON_UP', pityNow: 0, banners: [{ pulls: null, entries: [{ type: 'top', name: 'W', isUp: true }] }] },
  ] };
  v.addUpAverages(vis);
  assert.deepEqual(vis.totals.avgUpChar, { avg: 108.5, ups: 2, pulls: 217 }, '77 + 80 + 60，不扣已墊（出貨抽數本來就不含）');
  assert.equal(vis.totals.avgUpWeapon, null, '抽數完全不明的不列入');
});
