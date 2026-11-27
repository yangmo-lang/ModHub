const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCharacterList, buildEndfieldList, buildIndex, matchCharacter, normalizeName } = require('../electron/characters.cjs');
const { scanMods, createCategory, moveModToCategory } = require('../electron/scanner.cjs');

const HSR = {
  1001: { zh: '三月七', en: 'March 7th' },
  1224: { zh: '三月七', en: 'March 7th' },
  1213: { zh: '丹恒•饮月', en: 'Dan Heng • Imbibitor Lunae' },
  1303: { zh: '阮•梅', en: 'Ruan Mei' },
  1310: { zh: '流萤', en: 'Firefly' },
  1506: { zh: '银狼LV.<unbreak>999</unbreak>', en: 'Silver Wolf LV.<unbreak>999</unbreak>' },
  1507: { zh: '千冶•刃', en: 'Mortenax Blade' },
  8001: { zh: '{NICKNAME}', en: '{NICKNAME}' },
  8002: { zh: '{NICKNAME}', en: '{NICKNAME}' },
  8003: { zh: '{NICKNAME}', en: '{NICKNAME}' },
};

test('HSR 角色清單：主角、三月七、特例名稱', () => {
  const list = buildCharacterList('hsr', HSR);
  const names = list.map((c) => c.name);
  assert.deepEqual(names.sort(), ['三月七-存护', '三月七-巡猎', '丹恒-饮月', '女主', '流萤', '男主', '银狼LV.999', '阮梅', '刃-千治'].sort());
  assert.ok(list.find((c) => c.name === '流萤').avatarUrl.endsWith('/hsr/avatarshopicon/1310.webp'));
});

test('資料夾名稱比對（QAQ 命名、英文名、間隔號差異）', () => {
  const idx = buildIndex(buildCharacterList('hsr', HSR));
  assert.equal(matchCharacter(idx, '丹恒-饮月').id, '1213');
  assert.equal(matchCharacter(idx, '丹恒·饮月').id, '1213');
  assert.equal(matchCharacter(idx, 'Firefly').id, '1310');
  assert.equal(matchCharacter(idx, 'DISABLED_流萤').id, '1310');
  assert.equal(matchCharacter(idx, '刃-千治').id, '1507');
  assert.equal(matchCharacter(idx, '三月七').id, '1001');
  assert.equal(matchCharacter(idx, '开拓者').name, '男主');
  assert.equal(matchCharacter(idx, 'stelle').name, '女主');
  assert.equal(matchCharacter(idx, 'random_mod_123'), null);
});

test('鳴潮漂泊者依立繪分男女、ZZZ 去掉「」', () => {
  const ww = buildCharacterList('ww', {
    1501: { zh: '漂泊者·衍射', en: 'Rover: Spectro', icon: '/Game/Aki/UI/UIResources/Common/Image/IconRoleHead256/T_IconRoleHead256_4_UI.T_IconRoleHead256_4_UI', background: 'T_IconRole_Pile_zhujuenan_UI' },
    1502: { zh: '漂泊者·衍射', en: 'Rover: Spectro', icon: '/Game/Aki/UI/x/T_5_UI.T_5_UI', background: 'T_IconRole_Pile_zhujue_UI' },
    1604: { zh: '漂泊者·湮灭', en: 'Rover: Havoc', icon: '', background: 'T_IconRole_Pile_zhujue_UI' },
  });
  assert.deepEqual(ww.map((c) => c.name).sort(), ['女主', '男主']);
  assert.equal(ww.find((c) => c.name === '男主').avatarUrl, 'https://static.nanoka.cc/assets/ww/UIResources/Common/Image/IconRoleHead256/T_IconRoleHead256_4_UI.webp');
  const zzz = buildCharacterList('zzz', { 1041: { zh: '「11号」', en: 'Soldier 11', icon: 'IconRole04' } });
  assert.ok(zzz.some((c) => c.name === '11号'));
  assert.ok(zzz.some((c) => c.name === '男主') && zzz.some((c) => c.name === '女主'));
  assert.equal(normalizeName('「11号」'), normalizeName('11号'));
});

test('屬性、繁體名稱、繁體資料夾比對', () => {
  const list = buildCharacterList('hsr', {
    1212: { zh: '镜流', en: 'Jingliu', rank: 'CombatPowerAvatarRarityType5', damageType: 'Ice', baseType: 'Warrior', release: 1700000000 },
    1514: { zh: '艾莲', en: 'Ellen', rank: 'CombatPowerAvatarRarityType5', damageType: 'Ice', baseType: 'Rogue', release: 0 },
  });
  const jl = list.find((c) => c.id === '1212');
  assert.equal(jl.nameTw, '鏡流');
  assert.deepEqual([jl.meta.rarity, jl.meta.element, jl.meta.role, jl.meta.preview], [5, '冰', '毀滅', false]);
  assert.equal(list.find((c) => c.id === '1514').meta.preview, true);
  const idx = buildIndex(list);
  assert.equal(matchCharacter(idx, '鏡流').id, '1212');
  const zzz = buildCharacterList('zzz', { 1621: { zh: '洛克茜', en: 'Roxy', icon: 'IconRole68', rank: 4, type: 1, element: 203 } });
  const roxy = zzz.find((c) => c.id === '1621');
  assert.ok(roxy.avatarUrl.endsWith('/zzz/IconRoleSelect68.webp'));
  assert.deepEqual([roxy.meta.rarity, roxy.meta.element, roxy.meta.role], [5, '電', '強攻']);
});

test('終末地 wiki 目錄轉換', () => {
  const tagTree = [
    { id: '10000', name: '星级', children: [{ id: '10006', name: '6星' }] },
    { id: '10100', name: '属性', children: [{ id: '10104', name: '自然' }] },
    { id: '10200', name: '干员职业', children: [{ id: '10204', name: '先锋' }] },
    { id: '10208', name: '武器', children: [{ id: '10213', name: '长柄武器' }] },
  ];
  const items = [
    { itemId: '2923', name: '米米诺', tagIds: ['10006'], brief: { cover: 'https://bbs.hycdn.cn/a.png', dotType: 'label_type_preview' } },
    { itemId: '2922', name: '小刻', tagIds: ['10006', '10104', '10204', '10213'], brief: { cover: 'https://bbs.hycdn.cn/b.png', dotType: 'label_type_up' } },
    { itemId: '100', name: '管理员 (男)', tagIds: [], brief: { cover: 'https://bbs.hycdn.cn/c.png' } },
  ];
  const list = buildEndfieldList(items, tagTree);
  const xk = list.find((c) => c.id === '2922');
  assert.deepEqual([xk.meta.rarity, xk.meta.element, xk.meta.role, xk.meta.weapon, xk.meta.preview], [6, '自然', '先鋒', '長柄武器', false]);
  assert.equal(list.find((c) => c.id === '2923').meta.preview, true);
  assert.equal(list.find((c) => c.id === '2923').en, 'Mimino');
  assert.equal(list.find((c) => c.id === '100').name, '男主');
  assert.ok(list.find((c) => c.id === '2923').meta.order > xk.meta.order, 'wiki 前面的比較新');
});

test('把未分類 MOD 移入角色資料夾', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-m-'));
  fs.mkdirSync(path.join(root, 'baizhi_23a73', 'BaiZhi'), { recursive: true });
  fs.writeFileSync(path.join(root, 'baizhi_23a73', 'BaiZhi', 'a.ini'), '');
  const target = moveModToCategory(root, path.join(root, 'baizhi_23a73'), '白芷', null);
  assert.equal(target, path.join(root, '白芷', 'baizhi_23a73'));
  assert.ok(fs.existsSync(path.join(target, 'BaiZhi', 'a.ini')));
  assert.throws(() => moveModToCategory(root, path.join(root, '..'), '白芷', null));
});

test('MOD 與目標分類同名：移成 角色/角色', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-s-'));
  fs.mkdirSync(path.join(root, '庄方宜'), { recursive: true });
  fs.writeFileSync(path.join(root, '庄方宜', 'mod.ini'), '');
  const target = moveModToCategory(root, path.join(root, '庄方宜'), '庄方宜', null);
  assert.equal(target, path.join(root, '庄方宜', '庄方宜'));
  assert.ok(fs.existsSync(path.join(target, 'mod.ini')));
  assert.deepEqual(fs.readdirSync(root), ['庄方宜']);
});

test('QAQ 角色資料夾內有零散 ini 仍視為分類', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-q-'));
  fs.mkdirSync(path.join(root, '庄方宜', 'summertime_fangyi'), { recursive: true });
  fs.writeFileSync(path.join(root, '庄方宜', 'summertime_fangyi', 'a.ini'), '');
  fs.writeFileSync(path.join(root, '庄方宜', 'EndfieldV1_3Hotfix.ini'), '');
  fs.writeFileSync(path.join(root, '庄方宜', '_cover.png'), 'x');
  fs.mkdirSync(path.join(root, 'SomeMod', 'tex'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SomeMod', 'a.ini'), '');
  const list = buildEndfieldList([{ itemId: '1', name: '庄方宜', tagIds: [], brief: {} }], []);
  const idx = buildIndex(list);
  const r = scanMods(root, { characters: list, matchCharacter: (n) => matchCharacter(idx, n) });
  const cat = r.categories.find((c) => c.name === '庄方宜');
  assert.ok(cat, '應為分類');
  assert.equal(cat.total, 1);
  assert.ok(r.mods.some((m) => m.name === 'SomeMod' && m.category === '未分類'));
});

test('掃描套用圖鑑：無封面也算分類、列出缺少角色、建立資料夾', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-c-'));
  const avatar = path.join(root, '..', `av-${Date.now()}.webp`);
  fs.writeFileSync(avatar, 'img');
  fs.mkdirSync(path.join(root, 'Firefly', 'SkinA'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Firefly', 'SkinA', 'a.ini'), '');
  fs.mkdirSync(path.join(root, 'acheron_mod'), { recursive: true });
  fs.writeFileSync(path.join(root, 'acheron_mod', 'a.ini'), '');
  const list = buildCharacterList('hsr', { ...HSR, 1308: { zh: '黄泉', en: 'Acheron' } }).map((c) => ({ ...c, avatar }));
  const idx = buildIndex(list);
  const r = scanMods(root, { characters: list, matchCharacter: (n) => matchCharacter(idx, n) });
  const cat = r.categories.find((c) => c.name === 'Firefly');
  assert.equal(cat.character.id, '1310');
  assert.equal(cat.cover, avatar);
  assert.equal(cat.hasOwnCover, false);
  assert.ok(r.missingCharacters.some((c) => c.name === '黄泉'));
  assert.ok(!r.missingCharacters.some((c) => c.name === '流萤'));
  const created = createCategory(root, '黄泉', avatar);
  assert.ok(fs.existsSync(path.join(created, '_cover.webp')));
});

test('終末地：舊快取讀取時補上對照表裡的英文名', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const chars = require('../electron/characters.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-efen-'));
  try {
    fs.mkdirSync(path.join(tmp, 'characters', 'EFMI'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'characters', 'EFMI', 'characters.json'), JSON.stringify({
      characters: [
        { id: '1', name: '诀', zh: '诀', en: '', aliases: ['诀'] },
        { id: '2', name: '小刻', zh: '小刻', en: 'Kay', aliases: ['小刻', 'kay'] },
        { id: '3', name: '男主', zh: '管理员（男）', en: 'Endministrator', aliases: ['男主'] },
        { id: '4', name: '未知角色', zh: '未知角色', en: '', aliases: ['未知角色'] },
      ],
    }));
    const d = chars.loadCache(tmp, 'EFMI');
    const by = Object.fromEntries(d.characters.map((c) => [c.name, c]));
    require('node:assert').equal(by['诀'].en, 'Arcane');
    require('node:assert').ok(by['诀'].aliases.includes('arcane'), '英文名可用來搜尋 / 比對資料夾');
    require('node:assert').equal(by['小刻'].en, 'Kay');
    require('node:assert').equal(by['未知角色'].en, '', '對照表沒有的維持空白');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
