const test = require('node:test');
const assert = require('node:assert');
const { toUIGF, fromUIGF, isUIGF } = require('../electron/gacha/uigf.cjs');
const hsr = require('../electron/gacha/hsr.cjs');
const zzz = require('../electron/gacha/zzz.cjs');

const pool = (mod, key) => mod.POOLS.find((p) => p.key === key);

test('UIGF：星鐵匯出再匯入結果相同', () => {
  const raw = [
    { id: '1700000000000000001', gacha_id: '2001', item_id: '1310', name: '流螢', item_type: '角色', rank_type: '5', time: '2024-06-19 12:00:00' },
    { id: '1700000000000000002', gacha_id: '3001', item_id: '23025', name: '夢應歸於何處', item_type: '光錐', rank_type: '5', time: '2024-06-19 12:01:00' },
  ];
  const records = [hsr.norm(raw[0], pool(hsr, 'hsr:11'), ''), hsr.norm(raw[1], pool(hsr, 'hsr:12'), '')];
  const out = toUIGF('SRMI', [{ account: { id: '800000001', uid: '800000001', server: 'prod_official_asia' }, records }], '0.1.5');
  assert.equal(out.info.version, 'v4.0');
  assert.equal(out.info.export_app, 'ModHub');
  assert.equal(out.hkrpg[0].uid, '800000001');
  assert.equal(out.hkrpg[0].timezone, 8);
  assert.deepEqual(out.hkrpg[0].list[0], {
    gacha_id: '2001', gacha_type: '11', item_id: '1310', count: '1', time: '2024-06-19 12:00:00',
    name: '流螢', item_type: '角色', rank_type: '5', id: '1700000000000000001',
  });
  assert.equal(out.hkrpg[0].list[1].gacha_type, '12');
  assert.ok(isUIGF(JSON.parse(JSON.stringify(out))));
  const back = fromUIGF('SRMI', out);
  assert.equal(back.length, 1);
  assert.deepEqual(back[0].records.map((r) => [r.id, r.pool, r.time, r.name, r.rarity]), records.map((r) => [r.id, r.pool, r.time, r.name, r.rarity]));
});

test('UIGF：美服時區與絕區零 gacha_type', () => {
  const r = zzz.norm({ id: '1', gacha_id: '2001', item_id: '1191', name: '艾蓮', item_type: '代理人', rank_type: '4', time: '2024-07-04 10:00:00' }, pool(zzz, 'zzz:2'));
  const out = toUIGF('ZZMI', [{ account: { id: '1000001', uid: '1000001', server: 'prod_gf_us' }, records: [r] }]);
  assert.equal(out.nap[0].timezone, -5);
  assert.equal(out.nap[0].list[0].gacha_type, '2');
  const back = fromUIGF('ZZMI', out)[0].records[0];
  assert.equal(back.time, Date.parse('2024-07-04T10:00:00-05:00'));
  assert.equal(back.pool, 'zzz:2');
  assert.equal(back.rarityLabel, 'S');
});

test('UIGF：匯入其他工具的檔案（多帳號、簡體名稱、不完整的紀錄）', () => {
  const j = {
    info: { export_app: 'other', version: 'v4.1' },
    hk4e: [{ uid: '100', list: [] }],
    hkrpg: [
      { uid: '800000001', timezone: 8, list: [
        { gacha_type: '1', id: '10', time: '2023-04-26 10:00:00', name: '姬子', item_type: '角色', rank_type: '5', item_id: '1003' },
        { gacha_type: '99', id: '11', time: '2023-04-26 10:00:00', rank_type: '3' },
        { gacha_type: '2', id: '12', time: '2023-04-26 10:00:00' },
      ] },
      { uid: '800000002', timezone: 8, list: [{ gacha_type: '11', id: '20', time: '2023-05-01 10:00:00', name: '希儿', item_type: '角色', rank_type: '5' }] },
      { uid: 'bad', list: [] },
    ],
  };
  const r = fromUIGF('SRMI', j);
  assert.deepEqual(r.map((b) => [b.uid, b.records.length, b.skipped]), [['800000001', 1, 2], ['800000002', 1, 0]]);
  assert.equal(r[1].records[0].name, '希兒');
  assert.throws(() => fromUIGF('ZZMI', j), /沒有絕區零/);
});

test('SRGF v1 匯入', () => {
  const j = { info: { uid: '800000003', region_time_zone: 8, srgf_version: 'v1.0' }, list: [{ gacha_type: '12', id: '30', time: '2023-05-01 10:00:00', name: '於夜色中', item_type: '光錐', rank_type: '5' }] };
  assert.ok(isUIGF(j));
  const r = fromUIGF('SRMI', j);
  assert.equal(r[0].uid, '800000003');
  assert.equal(r[0].records[0].pool, 'hsr:12');
  assert.throws(() => fromUIGF('ZZMI', j), /SRGF/);
  assert.equal(isUIGF({ app: 'ModHub', records: [] }), false);
});
