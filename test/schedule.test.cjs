const test = require('node:test');
const assert = require('node:assert');
const schedule = require('../electron/schedule.cjs');

// 模擬 Next.js 頁面：資料切成好幾段 self.__next_f.push([1, "..."])（內容是自己編的測試資料）
function nextPage(data) {
  const flight = `1c:["$","$L1c",null,${JSON.stringify({ data })}]\n`;
  const cut = Math.floor(flight.length / 2);
  return [flight.slice(0, cut), flight.slice(cut)]
    .map((s) => `<script>self.__next_f.push(${JSON.stringify([1, s])})</script>`)
    .join('\n');
}

const NOW = Date.UTC(2030, 5, 15);
const D = 86400000;
const ch = (id, tw, en, icon) => ({ id, enName: en, zhName: tw, twName: tw, icon });

test('bannerhistory：星鐵的 groups 與平的 pickups 都讀得到，"$undefined" 不算有值', () => {
  const hsr = nextPage({ pickups: [
    { id: 'v9', version: '9.0', groups: [
      { id: 'v9-1', phase: 1, kind: 'main', startAt: NOW - 3 * D, endAt: NOW + 10 * D, scheduleUnannounced: '$undefined', characters: [ch('A', '甲角色', 'Alpha', '/icons/a.png')] },
      { id: 'v9-2', phase: 2, kind: 'warp', startAt: null, endAt: null, scheduleUnannounced: true, characters: [ch('B', '乙角色', 'Beta', 'https://cdn.example/b.png')] },
    ] },
  ] });
  const list = schedule.parseBannerHistory(hsr);
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].version, list[0].phase, list[0].kind, list[0].unannounced], ['9.0', 1, 'main', false]);
  assert.equal(list[0].characters[0].icon, 'https://bannerhistory.app/icons/a.png');
  assert.equal(list[1].unannounced, true);

  const flat = nextPage({ pickups: [
    { id: 'x', version: '2.1', phase: 2, kind: '$undefined', collab: 'other', startAt: NOW, endAt: NOW + D, characters: [ch('C', '丙', 'Gamma')] },
  ] });
  const f = schedule.parseBannerHistory(flat);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'collab');
  assert.equal(schedule.parseBannerHistory('<html>沒有資料</html>').length, 0);
});

test('近期與未來：去掉結束超過兩週的，依開始時間排序，未公布排最後', () => {
  const p = (id, start, end, unannounced = false) => ({ id, start, end, unannounced, characters: [] });
  const out = schedule.upcomingPools([
    p('old', NOW - 60 * D, NOW - 30 * D),
    p('tba', null, null, true),
    p('next', NOW + 5 * D, NOW + 20 * D),
    p('recent', NOW - 20 * D, NOW - 3 * D),
    p('live', NOW - 2 * D, NOW + 2 * D),
  ], NOW);
  assert.deepEqual(out.map((x) => x.id), ['recent', 'live', 'next', 'tba']);
});

test('BWiki：北京時間轉 UTC，活動與光錐卡池分開，手機版重複的卡片只算一次', () => {
  assert.equal(schedule.parseCst('2030/06/15 10:00'), Date.UTC(2030, 5, 15, 2, 0));
  assert.equal(schedule.parseCst(''), null);
  const card = (title, info, start, end, links = '') => `<div><b>${title}</b>${links}<span class="eventTimer" data-start="${start}" data-end="${end}" data-info="${info}"></span></div>`;
  const lc = '<a href="/sr/%E5%85%89%E9%94%A5A" title="光锥A"><img alt="光锥A" src="https://img.example/a.png"></a><a href="/sr/%E8%B7%83%E8%BF%81" title="跃迁"></a>';
  const html = [
    card('「测试」光锥活动跃迁', '跃迁', '2030/06/10 10:00', '2030/07/01 11:59', lc),
    card('「测试活动」第一期', '活动', '2030/06/12 04:00', '2030/06/26 03:59'),
    card('「测试活动」第一期', '活动', '2030/06/12 04:00', '2030/06/26 03:59'),
  ].join('');
  const { activities, warps } = schedule.parseBwikiHome(html);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].name, '「測試活動」第一期');
  assert.equal(activities[0].start, Date.UTC(2030, 5, 11, 20, 0));
  assert.equal(warps.length, 1);
  assert.equal(warps[0].type, '光錐卡池');
  assert.deepEqual(warps[0].items.map((x) => x.zh), ['光锥A']);
});

test('getSchedule：對應圖鑑頭像、單一來源失敗只記錯誤', async () => {
  const page = nextPage({ pickups: [{ id: 'p', version: '9.0', phase: 1, startAt: NOW, endAt: NOW + D, characters: [ch('A', '甲角色', 'Alpha', '/icons/a.png')] }] });
  const findItem = (name) => (name === '甲角色' ? { id: '1001', kind: 'character', name: '甲角色', icon: 'https://static.nanoka.cc/a.webp' } : null);
  const fetchImpl = async (url) => {
    if (url.includes('bannerhistory')) return page;
    throw new Error('offline');
  };
  const r = await schedule.getSchedule('SRMI', { findItem, fetchImpl, now: NOW });
  assert.equal(r.pools.length, 1);
  assert.deepEqual(r.pools[0].items[0], { id: '1001', kind: 'character', name: '甲角色', icon: 'https://static.nanoka.cc/a.webp', up: true, url: schedule.bhUrl('SRMI') });
  assert.equal(r.activities.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /活動排程/);
  assert.deepEqual(await schedule.getSchedule('EFMI', { fetchImpl }), { pools: [], activities: [], sources: [], errors: [] });
});
