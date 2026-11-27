const test = require('node:test');
const assert = require('node:assert');
const stats = require('../electron/gacha/stats.cjs');
const ef = require('../electron/gacha/endfield.cjs');
const zzz = require('../electron/gacha/zzz.cjs');

const rec = (i, tier, extra = {}) => ({ id: String(i), pool: 'p', poolName: '池', name: tier === 'top' ? `六星${i}` : `x${i}`, tier, time: 1000 + i, ...extra });

test('保底計算：免費抽不累計、免費出的六星不重置', () => {
  const list = [];
  let i = 0;
  for (let k = 0; k < 9; k++) list.push(rec(++i, 'low'));
  list.push(rec(++i, 'top'));                       // 第 10 抽出六星 → 保底 10
  for (let k = 0; k < 4; k++) list.push(rec(++i, 'low'));
  list.push(rec(++i, 'top', { free: true }));       // 免費抽出的六星：不重置
  list.push(rec(++i, 'low', { free: true }));       // 免費抽：不累計
  for (let k = 0; k < 2; k++) list.push(rec(++i, 'mid'));
  list.push(rec(++i, 'low', { gift: true }));       // 獎勵：不算抽數
  const [p] = stats.poolStats(list, { p: { label: '特許', pityMax: 80 } });
  assert.equal(p.total, 18);
  assert.equal(p.free, 2);
  assert.equal(p.gifts, 1);
  assert.equal(p.pity, 6, '4 + 2（免費的不算）');
  assert.deepEqual(p.tops.map((t) => [t.name, t.pity, t.free]), [['六星15', 0, true], ['六星10', 10, false]]);
  assert.equal(p.avgTopPity, 10);
  assert.equal(p.counts.top, 2);
});

test('限定池本期大保底只算最新一期的付費抽', () => {
  const list = [
    rec(1, 'low', { bannerId: 'A' }), rec(2, 'low', { bannerId: 'A' }),
    rec(3, 'low', { bannerId: 'B', bannerName: '新池' }), rec(4, 'low', { bannerId: 'B', free: true, bannerName: '新池' }), rec(5, 'low', { bannerId: 'B', bannerName: '新池' }),
  ];
  const [p] = stats.poolStats(list, { p: { pityMax: 80, bannerPityMax: 120 } });
  assert.deepEqual(p.banner, { id: 'B', name: '新池', paid: 2, max: 120 });
  assert.equal(p.pity, 4);
});

test('合併紀錄：去重、依時間與大整數 id 排序', () => {
  const a = [{ id: '1700000000000000002', time: 5 }, { id: '1700000000000000001', time: 5 }];
  const b = [{ id: '1700000000000000002', time: 5, name: 'new' }, { id: '999', time: 1 }];
  const m = stats.mergeRecords(a, b);
  assert.deepEqual(m.map((r) => r.id), ['999', '1700000000000000001', '1700000000000000002']);
  assert.equal(m[2].name, 'new');
});

test('終末地網址解析與紀錄轉換', () => {
  const a = ef.parseGachaUrl('https://ef-webview.gryphline.com/page/gacha_char?pool_id=x&u8_token=TOKEN&platform=Windows&lang=zh-tw&server=2');
  assert.deepEqual(a, { provider: 'gryphline', token: 'TOKEN', serverId: '2', lang: 'zh-tw' });
  assert.equal(ef.parseGachaUrl('https://evil.example.com/page/gacha_char?u8_token=x'), null);
  assert.equal(ef.parseGachaUrl('https://ef-webview.gryphline.com/page/gacha_char?lang=zh'), null);
  const r = ef.normChar({ seqId: '12', charName: '莱万汀', charId: 'c', rarity: 6, gachaTs: '1700000000', isFree: true, poolId: 'p1', poolName: '火' }, 'E_CharacterGachaPoolType_Special');
  assert.equal(r.name, '萊萬汀');
  assert.equal(r.tier, 'top');
  assert.equal(r.time, 1700000000000);
  assert.equal(r.free, true);
  assert.equal(r.pool, 'char:E_CharacterGachaPoolType_Special');
  assert.equal(ef.weaponPoolType('weaponbox_constant_2'), 'constant');
  assert.equal(ef.weaponPoolType('rerun_weapon_1'), 'rerun');
});

test('絕區零網址：只接受調頻紀錄的 authkey', () => {
  const ok = zzz.parseAuthUrl('https://gs.hoyoverse.com/nap/event/e20230424gacha/index.html?authkey_ver=1&sign_type=2&auth_appid=webview_gacha&authkey=AK&lang=zh-tw&game_biz=nap_global&region=prod_gf_jp');
  assert.equal(ok.authkey, 'AK');
  assert.equal(ok.host, 'public-operation-nap-sg.hoyoverse.com');
  assert.equal(zzz.parseAuthUrl('https://act.hoyoverse.com/zzz/event/e20261120reserve/index.html?auth_appid=e20261120invite&authkey=AK'), null, '活動頁的 authkey 不能用');
  const r = zzz.norm({ id: '17', uid: '100', name: '艾莲', item_id: '1191', item_type: '代理人', rank_type: '4', time: '2026-11-01 12:00:00' }, zzz.POOLS[0]);
  assert.equal(r.name, '艾蓮');
  assert.equal(r.tier, 'top');
  assert.equal(r.rarityLabel, 'S');
  assert.equal(r.time, Date.parse('2026-11-01T12:00:00+08:00'));
});
