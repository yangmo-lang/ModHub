const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const inst = require('../electron/installer.cjs');
const { parseNxm } = require('../electron/sources/nexus.cjs');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `modhub-${p}-`));

// 用 Python 做測試用 zip（可以塞進 ../ 這種惡意路徑）
function makeZip(file, entries) {
  const py = `import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1],'w')\nfor n,c in json.loads(sys.argv[2]).items(): z.writestr(n,c)\nz.close()`;
  execFileSync('python', ['-I', '-c', py, file, JSON.stringify(entries)]);
}

test('路徑清理', () => {
  assert.equal(inst.sanitizeEntryPath('../../evil.txt'), 'evil.txt');
  assert.equal(inst.sanitizeEntryPath('C:\\Windows\\x.dll'), path.join('Windows', 'x.dll'));
  assert.equal(inst.sanitizeEntryPath('/abs/a:b.ini'), path.join('abs', 'a_b.ini'));
  assert.equal(inst.sanitizeEntryPath('Mod/./sub/../a.ini'), path.join('Mod', 'sub', 'a.ini'));
});

test('解壓：惡意路徑不會跑出暫存區、找到 MOD 根目錄、標出可執行檔', async () => {
  const dir = tmp('zip');
  const zip = path.join(dir, 'm.zip');
  makeZip(zip, {
    'Wrapper/FireflyMod/mod.ini': '[x]',
    'Wrapper/FireflyMod/tex/a.dds': 'dds',
    'Wrapper/FireflyMod/preview.png': 'png',
    'Wrapper/FireflyMod/tool.exe': 'MZ',
    '../../escape.txt': 'bad',
  });
  const staging = path.join(dir, 'staging');
  await inst.extractArchive(zip, staging).catch(() => {});
  assert.ok(!fs.existsSync(path.join(dir, 'escape.txt')), '不可寫到暫存區外');
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'escape.txt')));
  // 只看正常的部分
  fs.rmSync(path.join(staging, 'escape.txt'), { force: true });
  const a = inst.analyze(staging);
  assert.equal(a.rootName, 'FireflyMod');
  assert.equal(a.iniCount, 1);
  assert.deepEqual(a.executables, ['tool.exe']);
  assert.equal(a.hasImage, true);
});

test('安裝：排除可執行檔、寫入來源資訊、同名自動加編號', async () => {
  const dir = tmp('inst');
  const mods = path.join(dir, 'Mods');
  const cat = path.join(mods, '流萤');
  fs.mkdirSync(path.join(cat, 'FireflyMod'), { recursive: true });
  const zip = path.join(dir, 'm.zip');
  makeZip(zip, { 'FireflyMod/mod.ini': '[x]', 'FireflyMod/run.bat': 'echo' });
  const staging = path.join(dir, 'st');
  await inst.extractArchive(zip, staging);
  const a = inst.analyze(staging);
  const target = inst.install({ modsRoot: mods, categoryDir: cat, analysis: a, excludeExecutables: true, meta: { source: 'gamebanana', modId: '1' } });
  assert.equal(target, path.join(cat, 'FireflyMod (2)'));
  assert.ok(fs.existsSync(path.join(target, 'mod.ini')));
  assert.ok(!fs.existsSync(path.join(target, 'run.bat')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, '.modhub.json'), 'utf8')).modId, '1');
});

test('更新：舊版備份、保留停用狀態', async () => {
  const dir = tmp('upd');
  const mods = path.join(dir, 'Mods');
  const old = path.join(mods, '流萤', 'DISABLED_Old');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'old.ini'), '');
  const zip = path.join(dir, 'm.zip');
  makeZip(zip, { 'NewVer/mod.ini': '[x]' });
  const staging = path.join(dir, 'st');
  await inst.extractArchive(zip, staging);
  const backups = path.join(dir, 'backups');
  const target = inst.install({ modsRoot: mods, categoryDir: path.join(mods, '流萤'), analysis: inst.analyze(staging), replacePath: old, backupDir: backups });
  assert.equal(path.basename(target), 'DISABLED_NewVer');
  assert.ok(!fs.existsSync(old));
  assert.equal(fs.readdirSync(backups).length, 1);
  assert.throws(() => inst.install({ modsRoot: mods, categoryDir: path.join(dir, 'elsewhere'), analysis: { root: staging, executables: [] } }), /Mods/);
});

test('nxm 連結解析', () => {
  assert.deepEqual(parseNxm('nxm://honkaistarrail/mods/12/files/34?key=k&expires=99&user_id=1'), { domain: 'honkaistarrail', modId: '12', fileId: '34', key: 'k', expires: '99' });
  assert.equal(parseNxm('https://evil/mods/1/files/2'), null);
});
