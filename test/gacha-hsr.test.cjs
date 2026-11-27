const test = require('node:test');
const assert = require('node:assert');
const hsr = require('../electron/gacha/hsr.cjs');
const v = require('../electron/gacha/visual.cjs');

test('星鐵：辨識躍遷紀錄網址，忽略其他遊戲', () => {
  const a = hsr.parseAuthUrl('https://gs.hoyoverse.com/hkrpg/gacha/index.html?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&authkey=abc%2Bdef&game_biz=hkrpg_global&region=prod_official_asia#/log');
  assert.equal(a.authkey, 'abc+def');
  assert.equal(a.game_biz, 'hkrpg_global');
  assert.equal(a.host, 'public-operation-hkrpg-sg.hoyoverse.com');
  assert.equal(a.region, 'prod_official_asia');
  const cn = hsr.parseAuthUrl('https://webstatic.mihoyo.com/hkrpg/event/e20211215gacha-v2/index.html?authkey=k&auth_appid=webview_gacha&game_biz=hkrpg_cn');
  assert.equal(cn.host, 'public-operation-hkrpg.mihoyo.com');
  assert.equal(hsr.parseAuthUrl('https://x.hoyoverse.com/gacha?authkey=k&auth_appid=webview_gacha&game_biz=nap_global'), null, '絕區零的網址不算');
  assert.equal(hsr.parseAuthUrl('not a url'), null);
});

test('星鐵：紀錄正規化（時區依伺服器、5★ 為最高稀有度）', () => {
  const pool = hsr.POOLS.find((p) => p.gacha === 11);
  const x = { id: '170', uid: '800', gacha_id: '2003', gacha_type: '11', item_id: '1102', name: '希儿', rank_type: '5', item_type: '角色', time: '2024-01-01 12:00:00' };
  const asia = hsr.norm(x, pool, 'prod_official_asia');
  assert.equal(asia.name, '希兒');
  assert.equal(asia.tier, 'top');
  assert.equal(asia.bannerId, '2003');
  assert.equal(asia.time, Date.parse('2024-01-01T04:00:00Z'));
  assert.equal(hsr.norm(x, pool, 'prod_official_usa').time, Date.parse('2024-01-01T17:00:00Z'));
  assert.equal(hsr.norm({ ...x, rank_type: '4' }, pool).tier, 'mid');
});

test('星鐵：限定池依 gacha_id 分期、保底跨期、常駐 5★ 算歪', () => {
  let seq = 0;
  const r = (pool, gid, tier, name) => ({ id: String(++seq), pool, bannerId: gid, name, tier, rarity: tier === 'top' ? 5 : 3, time: seq * 1000 });
  const recs = [];
  for (let i = 0; i < 9; i++) recs.push(r('hsr:11', 'A', 'low', 'x'));
  recs.push(r('hsr:11', 'A', 'top', '希兒'));            // A 期第 10 抽：UP
  for (let i = 0; i < 4; i++) recs.push(r('hsr:11', 'A', 'low', 'x')); // 墊 4 抽帶到 B 期
  for (let i = 0; i < 75; i++) recs.push(r('hsr:11', 'B', 'low', 'x'));
  recs.push(r('hsr:11', 'B', 'top', '姬子'));            // 4 + 76 = 80 抽，常駐 → 歪
  recs.push(r('hsr:12', 'C', 'top', '銀河鐵道之夜'));     // 光錐常駐 → 歪
  recs.push(r('hsr:1', '1001', 'top', '克拉拉'));
  const out = v.buildHsr(recs);
  const g = out.groups.find((x) => x.key === 'hsr:11');
  assert.deepEqual(g.banners.map((b) => b.bannerId), ['B', 'A'], '新的在前');
  const [B, A] = g.banners;
  assert.equal(A.name, '希兒');
  assert.equal(A.pad, 4);
  assert.equal(B.entries[0].pity, 80);
  assert.equal(B.entries[0].isUp, false);
  assert.equal(out.groups.find((x) => x.key === 'hsr:12').banners[0].entries[0].isUp, false);
  assert.equal(out.groups.find((x) => x.key === 'hsr:1').banners[0].entries[0].isUp, null, '常駐池不判斷歪');
  assert.equal(out.totals.tops, 4);
  assert.equal(out.totals.upWin, 1 / 3);
  assert.equal(out.totals.topLabel, '5★');
});
