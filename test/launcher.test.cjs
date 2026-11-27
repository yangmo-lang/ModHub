const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, launchArgs, launcherExe } = require('../electron/launcher.cjs');

test('XXMI 啟動參數與 Quick Start 捷徑相同', () => {
  assert.deepEqual(launchArgs('SRMI'), ['--nogui', '--xxmi', 'SRMI']);
  assert.deepEqual(launchArgs('EFMI', { gui: true }), ['--xxmi', 'EFMI']);
  assert.throws(() => launchArgs('HACK & calc'), /不支援/);
});

test('XXMI 啟動：找不到執行檔時提示，找到時以獨立程序執行', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-xxmi-'));
  const calls = [];
  const fakeSpawn = (exe, args, opts) => { calls.push({ exe, args, opts }); return { on() {}, unref() {} }; };
  assert.throws(() => launch(root, 'ZZMI', {}, fakeSpawn), /找不到 XXMI Launcher/);
  fs.mkdirSync(path.dirname(launcherExe(root)), { recursive: true });
  fs.writeFileSync(launcherExe(root), '');
  launch(root, 'ZZMI', {}, fakeSpawn);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, launcherExe(root));
  assert.deepEqual(calls[0].args, ['--nogui', '--xxmi', 'ZZMI']);
  assert.equal(calls[0].opts.cwd, path.dirname(launcherExe(root)));
  assert.equal(calls[0].opts.detached, true);
});
