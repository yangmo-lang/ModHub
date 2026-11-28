const test = require('node:test');
const assert = require('node:assert');
const { sanitize, isLcxUrl, scrapePage } = require('../electron/gacha/lcx-window.cjs');
const lcx = require('../electron/gacha/lcx.cjs');

test('離愁軒網址判斷', () => {
  assert.equal(isLcxUrl('https://wiki.lcx.cab/zmd/gacha_tracker.php'), true);
  assert.equal(isLcxUrl('https://lcx.cab/'), true);
  assert.equal(isLcxUrl('http://wiki.lcx.cab/'), false);
  assert.equal(isLcxUrl('https://lcx.cab.evil.example/'), false);
});

test('頁面資料清理：只留需要的欄位、限制數量，結果可直接交給 lcx.parse', () => {
  const raw = {
    loggedIn: true,
    uid: '4555097649',
    kinds: {
      limited: [{ head: '冬猎 09月02日 ~ 09月04日 合计 74 抽 垫6 产出 5240', extra: 'x', items: [
        { six: '', pull: 6, date: '', stamps: ['暂未出货', 'evil'], fives: [] },
        { six: '提弗洛斯', pull: '68', date: '09-02', stamps: [], fives: ['弧光', '弧光'] },
        { six: '', pull: 10, date: '<b>', stamps: ['免'], fives: [] },
      ] }],
      weapon: 'nope',
    },
  };
  const s = sanitize(raw);
  assert.equal(s.cards, 1);
  assert.equal(s.uid, '4555097649');
  assert.deepEqual(s.kinds.limited[0].items[0].stamps, ['暂未出货']);
  assert.equal(s.kinds.limited[0].items[1].pull, 68);
  assert.equal(s.kinds.limited[0].items[2].date, '');
  assert.deepEqual(s.kinds.weapon, []);
  assert.equal(sanitize({ uid: 'x; drop' }).uid, '');
  const parsed = lcx.parse(s.kinds, { now: new Date(2026, 10, 28).getTime() });
  const b = parsed.groups['char:E_CharacterGachaPoolType_Special'][0];
  assert.equal(b.name, '冬獵');
  assert.equal(b.free, 10);
  assert.equal(b.entries.find((e) => e.type === 'top').name, '提弗洛斯');
});

test('讀取程式可以序列化後在頁面執行', () => {
  const src = `(${scrapePage.toString()})()`;
  assert.ok(src.includes('#content-'));
  assert.doesNotThrow(() => new Function(src));
});
