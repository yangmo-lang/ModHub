const test = require('node:test');
const assert = require('node:assert');
const { isMapUrl, isWebUrl, MAPS } = require('../electron/maps.cjs');

test('isMapUrl 只接受 https 的 zmdmap.com 與子網域', () => {
  assert.ok(isMapUrl('https://www.zmdmap.com/'));
  assert.ok(isMapUrl('https://zmdmap.com/map?id=1'));
  assert.ok(isMapUrl('https://cdn.zmdmap.com/a.png'));
  assert.ok(!isMapUrl('http://www.zmdmap.com/'));
  assert.ok(!isMapUrl('https://www.zmdmap.com.evil.example/'));
  assert.ok(!isMapUrl('https://evilzmdmap.com/'));
  assert.ok(!isMapUrl('https://example.com/?u=https://www.zmdmap.com/'));
  assert.ok(!isMapUrl('file:///C:/x.html'));
  assert.ok(!isMapUrl('not a url'));
  assert.ok(!isMapUrl(undefined));
});

test('isWebUrl 只接受 http / https', () => {
  assert.ok(isWebUrl('https://example.com/'));
  assert.ok(isWebUrl('http://example.com/'));
  assert.ok(!isWebUrl('file:///C:/Windows/notepad.exe'));
  assert.ok(!isWebUrl('javascript:alert(1)'));
  assert.ok(!isWebUrl(''));
});

test('終末地地圖網址本身通過檢查', () => {
  assert.ok(isMapUrl(MAPS.EFMI.url));
});
