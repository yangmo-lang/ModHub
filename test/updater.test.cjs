const test = require('node:test');
const assert = require('node:assert');
const { newer } = require('../electron/updater.cjs');

test('版本比較：數字逐段比較，忽略 v 前綴', () => {
  assert.equal(newer('0.1.2', '0.1.1'), true);
  assert.equal(newer('v0.1.10', '0.1.9'), true);
  assert.equal(newer('0.2.0', '0.10.0'), false);
  assert.equal(newer('0.1.1', '0.1.1'), false);
  assert.equal(newer('1.0', '0.9.9'), true);
  assert.equal(newer('0.1.1', '0.1.2'), false);
});

test('重新檢查：沒檢查過或太舊才重查；檢查中、下載中、已下載不重查', () => {
  const { shouldRecheck, RECHECK_EVERY, SETTINGS_MAX_AGE } = require('../electron/updater.cjs');
  const now = 1_000_000_000;
  assert.equal(shouldRecheck({ status: 'idle' }, now, SETTINGS_MAX_AGE), true);
  assert.equal(shouldRecheck({ status: 'latest', checkedAt: now - 60_000 }, now, SETTINGS_MAX_AGE), false);
  assert.equal(shouldRecheck({ status: 'latest', checkedAt: now - SETTINGS_MAX_AGE }, now, SETTINGS_MAX_AGE), true);
  assert.equal(shouldRecheck({ status: 'error', checkedAt: now - RECHECK_EVERY - 1 }, now, RECHECK_EVERY), true);
  assert.equal(shouldRecheck({ status: 'available', checkedAt: now - RECHECK_EVERY }, now, RECHECK_EVERY), true);
  for (const status of ['dev', 'checking', 'downloading', 'downloaded']) {
    assert.equal(shouldRecheck({ status }, now, 0), false, status);
  }
});
