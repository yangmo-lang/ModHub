const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, launchArgs, launcherExe, startCommand } = require('../electron/launcher.cjs');

test('XXMI 啟動參數與 Quick Start 捷徑相同', () => {
  assert.deepEqual(launchArgs('SRMI'), ['--nogui', '--xxmi', 'SRMI']);
  assert.deepEqual(launchArgs('EFMI', { gui: true }), ['--xxmi', 'EFMI']);
  assert.throws(() => launchArgs('HACK & calc'), /不支援/);
});

test('XXMI 啟動：找不到執行檔時提示；透過 Shell（cmd start）啟動以觸發 UAC；失敗會回報', async () => {
  const { EventEmitter } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-xxmi-'));
  const calls = [];
  let exitCode = 0;
  const fakeSpawn = (exe, args, opts) => {
    calls.push({ exe, args, opts });
    const c = new EventEmitter();
    setImmediate(() => c.emit('exit', exitCode));
    return c;
  };
  await assert.rejects(launch(root, 'ZZMI', {}, fakeSpawn), /找不到 XXMI Launcher/);
  fs.mkdirSync(path.dirname(launcherExe(root)), { recursive: true });
  fs.writeFileSync(launcherExe(root), '');
  const r = await launch(root, 'ZZMI', {}, fakeSpawn);
  assert.deepEqual(r.args, ['--nogui', '--xxmi', 'ZZMI']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].exe, /cmd\.exe$/i);
  assert.equal(calls[0].opts.windowsVerbatimArguments, true);
  const line = calls[0].args.at(-1);
  assert.ok(line.includes(`start "" /D "${path.dirname(launcherExe(root))}" "${launcherExe(root)}" --nogui --xxmi ZZMI`), line);
  exitCode = 1;
  await assert.rejects(launch(root, 'ZZMI', {}, fakeSpawn), /系統管理員/);
  assert.throws(() => startCommand('C:\\a"b\\x.exe', []), /不支援的字元/);
});
