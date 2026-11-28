const test = require('node:test');
const assert = require('node:assert');
const login = require('../electron/gacha/login.cjs');

test('星鐵、絕區零各用自己的 HoYoLAB 登入分區', () => {
  assert.equal(login.hoyoProviderFor('hkrpg_global'), 'hoyolab-sr');
  assert.equal(login.hoyoProviderFor('nap_global'), 'hoyolab');
  const sr = login.PROVIDERS['hoyolab-sr'];
  const zzz = login.PROVIDERS.hoyolab;
  assert.notEqual(sr.partition, zzz.partition);
  assert.equal(zzz.partition, 'persist:modhub-hoyolab', '絕區零沿用原本的分區，不用重新登入');
  assert.equal(sr.gameBiz, 'hkrpg_global');
  assert.ok(login.isHoyo('hoyolab-sr') && login.isHoyo('hoyolab') && !login.isHoyo('gryphline'));
});
