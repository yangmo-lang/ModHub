const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const eff = require('../electron/eff.cjs');

const CHARS = [
  { id: '7', name: '莱万汀', nameTw: '萊萬汀', en: 'Laevatain' },
  { id: '4', name: '别礼', nameTw: '別禮', en: 'Last Rite' },
  { id: '1683', name: '梨诺', nameTw: '梨諾', en: '' },
];

const MOD_INI = `[Mod]
format=3
id=lvt
key_switch_enabled=1

[TextureBody_NM]
source.path=assets/beyond/arts/entity/actor/girl/liino/textures/t_n.tga

[MeshA]
target.path=assets/beyond/arts/entity/actor/lady/laevat/models/s_body.asset
[MeshB]
target.path=assets/beyond/arts/entity/actor/lady/laevat/models/s_cloth.asset
`;

function fixture() {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-eff-'));
  fs.writeFileSync(path.join(game, 'Endfield.exe'), '');
  const mods = path.join(game, 'plugin', 'mods');
  const mk = (rel, ini = MOD_INI) => {
    const d = path.join(mods, rel);
    fs.mkdirSync(path.join(d, 'meshes'), { recursive: true });
    fs.writeFileSync(path.join(d, 'mod.ini'), ini);
    fs.writeFileSync(path.join(d, 'meshes', 'a.effres'), 'x');
    fs.writeFileSync(path.join(d, 'state.ini'), '[Values]\n$shape=0.5\n');
    return d;
  };
  mk('lvtflames');
  mk('Pack/other', '[Mod]\nformat=3\nid=x\n');
  return { game, mods };
}

test('mod.ini 是否為 EFF 格式', () => {
  assert.equal(eff.isEffIni(MOD_INI), true);
  assert.equal(eff.isEffIni('[TextureOverrideBody]\nhash=1234\n'), false);
  assert.equal(eff.isEffIni('[Mod]\nid=x\n[Other]\nformat=3\n'), false, 'format 要在 [Mod] 區段裡');
  assert.equal(eff.iniValue(MOD_INI, 'Mod', 'id'), 'lvt');
});

test('從替換目標判斷角色（target.path 優先於材質來源）', () => {
  assert.deepEqual(eff.actorKeys(MOD_INI), ['laevat']);
  assert.deepEqual(eff.actorKeys('x=assets/a/actor/girl/liino/t.tga'), ['liino']);
  assert.equal(eff.characterForKey('laevat', CHARS).id, '7');
  assert.equal(eff.characterForKey('lastrite', CHARS).id, '4');
  assert.equal(eff.characterForKey('liino', CHARS), null, '沒有英文名的角色不亂猜');
  assert.equal(eff.characterForKey('la', CHARS), null, '太短不比對');
});

test('掃描：依角色分組，子資料夾裡的 MOD 也找得到', () => {
  const { game } = fixture();
  const r = eff.scanEff(game, { characters: CHARS });
  assert.equal(r.mods.length, 2);
  const lvt = r.mods.find((m) => m.name === 'lvtflames');
  assert.equal(lvt.enabled, true);
  assert.equal(lvt.category, '莱万汀');
  assert.equal(lvt.effId, 'lvt');
  assert.equal(r.mods.find((m) => m.name === 'other').category, '未分類');
  const cat = r.categories.find((c) => c.name === '莱万汀');
  assert.equal(cat.grouped, true);
  assert.equal(cat.total, 1);
  assert.equal(r.categories.at(-1).virtual, true, '未分類排最後');
});

test('停用 = 移到 mods_disabled（保留相對路徑與 state.ini），啟用再移回', () => {
  const { game, mods } = fixture();
  const p = eff.effPaths(game);
  const nested = path.join(mods, 'Pack', 'other');
  const off = eff.setEnabled(game, nested, false);
  assert.equal(off, path.join(p.disabled, 'Pack', 'other'));
  assert.ok(fs.existsSync(path.join(off, 'state.ini')));
  assert.ok(!fs.existsSync(path.join(mods, 'Pack')), '空的上層資料夾會清掉');
  assert.equal(eff.scanEff(game).mods.find((m) => m.name === 'other').enabled, false);

  const on = eff.setEnabled(game, off, true);
  assert.equal(on, nested);
  assert.ok(fs.existsSync(path.join(nested, 'mod.ini')));
  assert.equal(eff.setEnabled(game, on, true), on, '已啟用時不動');
});

test('停用時目標已有同名資料夾就拒絕；路徑不在 EFF 資料夾內也拒絕', () => {
  const { game, mods } = fixture();
  const p = eff.effPaths(game);
  fs.mkdirSync(path.join(p.disabled, 'lvtflames'), { recursive: true });
  assert.throws(() => eff.setEnabled(game, path.join(mods, 'lvtflames'), false), /同名/);
  assert.throws(() => eff.setEnabled(game, path.join(game, 'plugin'), false), /不在 EFF/);
  assert.throws(() => eff.setEnabled(game, path.join(os.tmpdir(), 'x'), false), /不在 EFF/);
});

test('安裝名稱不和啟用 / 停用中的 MOD 重複', () => {
  const { game } = fixture();
  const p = eff.effPaths(game);
  fs.mkdirSync(path.join(p.disabled, 'new (2)'), { recursive: true });
  fs.mkdirSync(path.join(p.mods, 'new'), { recursive: true });
  assert.equal(eff.uniqueModTarget(game, 'new'), path.join(p.mods, 'new (3)'));
  assert.equal(eff.uniqueModTarget(game, 'fresh'), path.join(p.mods, 'fresh'));
});

test('判斷壓縮檔：EFF MOD、EFF 框架、一般 3DMigoto MOD', () => {
  const read = (map) => (rel) => map[rel] || '';
  assert.deepEqual(
    eff.classifyFiles([{ rel: 'lvt\\mod.ini' }, { rel: 'lvt\\meshes\\a.effres' }], read({ 'lvt\\mod.ini': MOD_INI })),
    { framework: false, effMod: true, effInis: ['lvt\\mod.ini'], effres: 1 },
  );
  assert.equal(eff.classifyFiles([{ rel: 'plugin\\eff.dll' }, { rel: 'vulkan-1.dll' }], read({})).framework, true);
  const xx = eff.classifyFiles([{ rel: 'Body\\mod.ini' }, { rel: 'Body\\a.ib' }], read({ 'Body\\mod.ini': '[TextureOverrideA]\nhash=1\n' }));
  assert.equal(xx.effMod, false);
});

test('框架套件檢查：允許的檔案、拒絕預期外的位置', () => {
  const make = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-effpkg-'));
    for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), f); }
    return dir;
  };
  const ok = make(['d3dcompiler_47.dll', 'vulkan-1.dll', 'plugin/eff.dll', 'plugin/eff.ini', 'plugin/LICENSE']);
  assert.equal(eff.checkFrameworkTree(ok).files.length, 5);
  const wrapped = make(['EFF_v2/d3dcompiler_47.dll', 'EFF_v2/vulkan-1.dll', 'EFF_v2/plugin/eff.dll']);
  assert.equal(path.basename(eff.checkFrameworkTree(wrapped).root), 'EFF_v2', '多包一層也找得到');
  assert.throws(() => eff.checkFrameworkTree(make(['d3dcompiler_47.dll', 'vulkan-1.dll', 'plugin/eff.dll', 'run.exe'])), /預期外/);
  assert.throws(() => eff.checkFrameworkTree(make(['d3dcompiler_47.dll', 'vulkan-1.dll', 'plugin/eff.dll', 'plugin/mods/x/mod.ini'])), /預期外/);
  assert.throws(() => eff.checkFrameworkTree(make(['vulkan-1.dll', 'plugin/eff.dll'])), /缺少 d3dcompiler_47/);
  assert.throws(() => eff.checkFrameworkTree(make(['readme.txt'])), /找不到 plugin\/eff\.dll/);
});

test('安裝框架：備份被覆蓋的檔案、保留使用者的 eff.ini 與 MOD', () => {
  const { game, mods } = fixture();
  fs.writeFileSync(path.join(game, 'vulkan-1.dll'), 'old');
  fs.writeFileSync(path.join(game, 'plugin', 'eff.ini'), 'mine');
  fs.writeFileSync(path.join(game, 'plugin', 'eff.dll'), 'old-dll');
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-effsrc-'));
  const files = ['d3dcompiler_47.dll', 'vulkan-1.dll', path.join('plugin', 'eff.dll'), path.join('plugin', 'eff.ini')];
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true }); fs.writeFileSync(path.join(src, f), `new:${f}`); }
  const backupDir = path.join(src, 'backup');
  const r = eff.installFramework({ gameDir: game, sourceRoot: src, files, backupDir });
  assert.equal(fs.readFileSync(path.join(game, 'vulkan-1.dll'), 'utf8'), 'new:vulkan-1.dll');
  assert.equal(fs.readFileSync(path.join(game, 'plugin', 'eff.ini'), 'utf8'), 'mine', 'eff.ini 保留');
  assert.equal(fs.readFileSync(path.join(backupDir, 'vulkan-1.dll'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(backupDir, 'plugin', 'eff.dll'), 'utf8'), 'old-dll');
  assert.deepEqual(r.kept, [path.join('plugin', 'eff.ini')]);
  assert.ok(fs.existsSync(path.join(mods, 'lvtflames', 'state.ini')), 'MOD 不受影響');
  assert.throws(() => eff.installFramework({ gameDir: os.tmpdir(), sourceRoot: src, files, backupDir }), /Endfield\.exe/);
});

test('讀 DLL 版本資源；挑 GitHub release 的 DLL 套件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-ver-'));
  const f = path.join(dir, 'x.dll');
  fs.writeFileSync(f, Buffer.concat([Buffer.alloc(64), Buffer.from('ProductVersion\0\0\x002.0.17\0', 'utf16le'), Buffer.alloc(8)]));
  assert.equal(eff.readDllVersion(f), '2.0.17');
  fs.writeFileSync(f, Buffer.concat([Buffer.from('FileVersion\0', 'utf16le'), Buffer.from('2.1.0.0\0', 'utf16le')]));
  assert.equal(eff.readDllVersion(f), '2.1.0');
  assert.equal(eff.readDllVersion(path.join(dir, 'missing.dll')), '');

  const rel = eff.pickRelease({
    tag_name: 'v2.0.18', html_url: 'https://github.com/ssice-a/EFF/releases/tag/v2.0.18',
    assets: [
      { name: 'EFF_Shared_Native_Tools_v2.0.18.zip', browser_download_url: 'u1', size: 9 },
      { name: 'EFF_v2.0.18_dll.zip', browser_download_url: 'u2', size: 5, digest: `sha256:${'a'.repeat(64)}` },
    ],
  });
  assert.deepEqual([rel.version, rel.name, rel.url, rel.sha256], ['2.0.18', 'EFF_v2.0.18_dll.zip', 'u2', 'a'.repeat(64)]);
  assert.equal(eff.pickRelease({ tag_name: 'v1', assets: [] }), null);
});

test('遊戲資料夾：設定優先，其次 XXMI 設定', () => {
  const x = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-xxmi-'));
  fs.writeFileSync(path.join(x, 'XXMI Launcher Config.json'), JSON.stringify({ Importers: { EFMI: { Importer: { game_folder: 'D:\\Games\\Endfield' } } } }));
  assert.equal(eff.resolveGameDir({ xxmiRoot: x }), 'D:\\Games\\Endfield');
  assert.equal(eff.resolveGameDir({ xxmiRoot: x, effGameDir: 'E:\\EF' }), 'E:\\EF');
  assert.equal(eff.resolveGameDir({ xxmiRoot: path.join(x, 'none') }), '');
  const st = eff.status('');
  assert.equal(st.gameFound, false);
});

test('安裝前分析會標出 EFF MOD 與 EFF 框架', () => {
  const installer = require('../electron/installer.cjs');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-stage-'));
  fs.mkdirSync(path.join(stage, 'wrap', 'lvt', 'meshes'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'wrap', 'lvt', 'mod.ini'), MOD_INI);
  fs.writeFileSync(path.join(stage, 'wrap', 'lvt', 'meshes', 'a.effres'), 'x');
  const a = installer.analyze(stage);
  assert.equal(a.effMod, true);
  assert.equal(a.effFramework, false);
  assert.equal(a.rootName, 'lvt');

  const fw = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-stage-'));
  fs.mkdirSync(path.join(fw, 'plugin'), { recursive: true });
  fs.writeFileSync(path.join(fw, 'plugin', 'eff.dll'), 'x');
  fs.writeFileSync(path.join(fw, 'vulkan-1.dll'), 'x');
  assert.equal(installer.analyze(fw).effFramework, true);
});
