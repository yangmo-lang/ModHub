const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const kb = require('../electron/keybinds.cjs');

const INI = `[Constants]
global persist $swapkey0 = 0

; 換衣服
[KeySwap_0]
condition = $active0 == 1
key = Ctrl 7
type = cycle
$swapkey0 = 0,1,

[KeySwap_1]
condition = $active0 == 1
key = Ctrl 6
back = Ctrl 5
type = cycle
$swapkey1 = 0,1,2 ; 三種

; Decensor Keybinding ------

[KeyCensor]
key = no_modifiers \\
key = XB_DPAD_UP XB_A
type = toggle
$censor = 0,1

[KeyEmpty]
type = cycle

[TextureOverrideBody]
hash = 1234
key = 9
`;

test('解析 [Key…] 區段：按鍵、反向、類型、變數、條件、說明', () => {
  const b = kb.parseKeyBinds(INI);
  assert.deepEqual(b.map((x) => x.section), ['KeySwap_0', 'KeySwap_1', 'KeyCensor'], '沒有 key 的區段與非 Key 區段不算');
  assert.equal(b[0].label, '換衣服');
  assert.equal(b[0].keys[0].text, 'Ctrl + 7');
  assert.equal(b[0].type, 'cycle');
  assert.equal(b[0].typeLabel, '循環切換');
  assert.equal(b[0].condition, '$active0 == 1');
  assert.deepEqual(b[0].vars, [{ name: '$swapkey0', values: ['0', '1'] }]);
  assert.equal(b[1].label, 'Swap 1', '沒有註解時用區段名稱');
  assert.equal(b[1].back[0].text, 'Ctrl + 5');
  assert.deepEqual(b[1].vars[0].values, ['0', '1', '2'], '行尾註解去掉');
  assert.equal(b[2].label, 'Decensor Keybinding', '隔空行的註解也算');
  assert.deepEqual(b[2].keys.map((k) => [k.text, k.gamepad]), [['\\', false], ['手把 DPAD UP + 手把 A', true]]);
  assert.equal(b[2].typeLabel, '開 / 關');
});

test('按鍵顯示：去掉 no_ 修飾、VK_ 名稱好讀', () => {
  const t = (s) => kb.formatKey(s).text;
  assert.equal(t('NO_ALT CTRL 0'), 'Ctrl + 0');
  assert.equal(t('no_ctrl no_shift vk_lbutton'), '滑鼠左鍵');
  assert.equal(kb.formatKey('vk_rbutton').mouse, true);
  assert.equal(t('CTRL VK_OEM_MINUS'), 'Ctrl + -');
  assert.equal(t('no_alt ctrl up'), 'Ctrl + ↑');
  assert.equal(t('shift vk_numpad5'), 'Shift + 數字鍵 5');
  assert.equal(t('alt f12'), 'Alt + F12');
  assert.equal(t('h'), 'H');
  assert.equal(t(']'), ']');
  assert.equal(t('VK_CONTROL 1'), 'Ctrl + 1');
});

test('讀 MOD 資料夾：含子資料夾，略過 DISABLED 開頭的 ini；GBK 註解也讀得懂；有快取', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modhub-keys-'));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'mod.ini'), INI);
  fs.writeFileSync(path.join(dir, 'DISABLED_old.ini'), '[KeyX]\nkey = 1\n');
  // 「切換」的 GBK 編碼
  fs.writeFileSync(path.join(dir, 'sub', 'extra.ini'), Buffer.concat([Buffer.from('; '), Buffer.from([0xc7, 0xd0, 0xbb, 0xbb]), Buffer.from('\n[KeyY]\nkey = 2\n$y = 0,1\n')]));
  const cache = new Map();
  const r = kb.modKeyBinds(dir, cache);
  assert.equal(r.length, 4);
  assert.ok(!r.some((b) => b.section === 'KeyX'));
  const y = r.find((b) => b.section === 'KeyY');
  assert.equal(y.file, path.join('sub', 'extra.ini'));
  assert.equal(y.label, '切换');
  assert.equal(cache.size, 2);
  assert.equal(kb.modKeyBinds(dir, cache).length, 4, '第二次用快取');
});
