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
