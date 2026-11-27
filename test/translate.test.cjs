const test = require('node:test');
const assert = require('node:assert');
const { translate, isChinese, chunks, applyGlossary, toTraditional } = require('../electron/translate.cjs');

test('翻譯：只把簡體的行轉繁體，繁體行保留原字', async () => {
  assert.equal(toTraditional('这是我第一次制作mod\n這台電腦在這裡'), '這是我第一次製作mod\n這台電腦在這裡');
  assert.equal(toTraditional('这里'), '這裡', '說明文字的「裡」不改成「里」');
  const calls = [];
  const r = await translate('mixed output please', { fetchImpl: fakeGoogle(calls, () => '这是我第一次制作mod\n按 H 切換，這台主機') });
  assert.equal(r.text, '這是我第一次製作mod\n按 H 切換，這台主機');
});

const fakeGoogle = (calls, map = (q) => `譯:${q}`) => async (url, opts) => {
  const q = new URLSearchParams(opts.body).get('q');
  calls.push(q);
  return { ok: true, json: async () => [[[map(q), q]], null, 'en'] };
};

test('翻譯：中文說明在本機轉繁體，不連網', async () => {
  const calls = [];
  const r = await translate('这个模组替换了流萤的服装', { fetchImpl: fakeGoogle(calls) });
  assert.equal(r.engine, 'opencc');
  assert.equal(r.text, '這個模組替換了流螢的服裝');
  assert.equal(calls.length, 0);
  assert.equal(isChinese('こんにちは 流萤'), false, '含假名的是日文');
});

test('翻譯：其他語言送翻譯並先套用角色名詞彙表', async () => {
  const calls = [];
  const glossary = [{ en: 'Firefly', zh: '流螢' }, { en: 'March 7th', zh: '三月七' }, { en: 'March', zh: '錯的' }, { en: 'Si', zh: '短名不換' }];
  const r = await translate('Firefly outfit for March 7th.\nSimple install, see firefly2 too.', { glossary, fetchImpl: fakeGoogle(calls) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], '流螢 outfit for 三月七.\nSimple install, see firefly2 too.');
  assert.equal(r.engine, 'google');
  assert.equal(r.lang, 'en');
  assert.ok(r.text.startsWith('譯:流螢'));
  // 相同內容走快取
  await translate('Firefly outfit for March 7th.\nSimple install, see firefly2 too.', { glossary, fetchImpl: fakeGoogle(calls) });
  assert.equal(calls.length, 1);
});

test('翻譯：長文依行切段，保留換行', async () => {
  const line = 'a'.repeat(1000);
  const text = [line, line, '', line].join('\n');
  const parts = chunks(text, 1800);
  assert.equal(parts.length, 3);
  assert.equal(parts.join('\n'), text);
  assert.ok(chunks('b'.repeat(4000), 1800).every((p) => p.length <= 1800));
  const calls = [];
  const r = await translate(`unique ${text}`, { fetchImpl: fakeGoogle(calls, (q) => q.toUpperCase()) });
  assert.equal(calls.length, 3);
  assert.equal(r.text, `UNIQUE ${text}`.toUpperCase());
});

test('翻譯：服務錯誤時丟出說明', async () => {
  let n = 0;
  await assert.rejects(translate('rate limited text', { retryDelay: 1, fetchImpl: async () => { n++; return { ok: false, status: 429 }; } }), /稍後再試/);
  assert.equal(n, 2, '429 會重試一次');
  assert.equal(applyGlossary('no glossary', []), 'no glossary');
  assert.equal((await translate('   ')).engine, 'none');
});
