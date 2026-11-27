const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createModsWatcher } = require('../electron/watcher.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-watch-'));

function waitFor(pred, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (pred()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('timeout'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('新增與改名資料夾會（合併後）通知一次，並帶上 key', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '流萤'));
  const calls = [];
  const w = createModsWatcher({ onChange: (k) => calls.push(k), debounceMs: 150 });
  try {
    assert.equal(w.set('SRMI', dir), true);
    fs.mkdirSync(path.join(dir, '流萤', 'SkinA'));
    fs.renameSync(path.join(dir, '流萤', 'SkinA'), path.join(dir, '流萤', 'DISABLED_SkinA'));
    await waitFor(() => calls.length > 0);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(calls, ['SRMI']);
  } finally {
    w.stop();
  }
});

test('只修改檔案內容不會通知', async () => {
  const dir = tmp();
  const ini = path.join(dir, 'mod.ini');
  fs.writeFileSync(ini, 'a');
  const calls = [];
  const w = createModsWatcher({ onChange: (k) => calls.push(k), debounceMs: 100 });
  try {
    w.set('SRMI', dir);
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(ini, 'b');
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(calls, []);
  } finally {
    w.stop();
  }
});

test('同資料夾重複 set 不重建；換資料夾後舊的不再通知；不存在的資料夾回傳 false', () => {
  const a = tmp();
  const b = tmp();
  let created = 0;
  const fake = () => {
    created++;
    const w = new (require('node:events'))();
    w.close = () => {};
    return w;
  };
  const w = createModsWatcher({ onChange: () => {}, watch: fake });
  assert.equal(w.set('SRMI', a), true);
  assert.equal(w.set('SRMI', a), true);
  assert.equal(created, 1);
  w.set('ZZMI', b);
  assert.equal(created, 2);
  assert.deepEqual(w.watching, { key: 'ZZMI', dir: b });
  assert.equal(w.set('ZZMI', path.join(b, 'nope')), false);
  assert.equal(w.watching, null);
});
