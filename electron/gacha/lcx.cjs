// 離愁軒（wiki.lcx.cab）終末地抽卡紀錄 → ModHub「歷史摘要」
//
// 離愁軒頁面只顯示每期卡池的摘要：卡池名稱、日期、合計抽數、已墊、每個 6★（名稱、日期、抽數、歪）與加急次數，
// 沒有逐抽紀錄。這裡把使用者登入後頁面上看到的內容（DOM 讀出來的資料）整理成 ModHub 的卡池格式，
// 用來補 ModHub 逐抽紀錄開始之前的卡池。不呼叫離愁軒的 API。
const { toTw } = require('../characters.cjs');

const GROUP_KEY = {
  limited: 'char:E_CharacterGachaPoolType_Special',
  weapon: 'weapon',
  standard: 'char:E_CharacterGachaPoolType_Standard',
  newbie: 'char:E_CharacterGachaPoolType_Beginner',
  joint: 'char:E_CharacterGachaPoolType_Joint',
};

/** 「MM-DD」或「MM月DD日」→ 當地中午的時間戳；月份比現在大就算去年 */
function dayMs(month, day, now) {
  const n = new Date(now);
  let y = n.getFullYear();
  if (month > n.getMonth() + 1) y--;
  return new Date(y, month - 1, day, 12, 0, 0).getTime();
}

function parseHead(head, now) {
  const h = String(head || '').replace(/\s+/g, ' ').trim();
  const m = /^(.*?)\s*(\d{1,2})月(\d{1,2})日\s*~\s*(\d{1,2})月(\d{1,2})日/.exec(h);
  const num = (re) => { const x = re.exec(h); return x ? Number(x[1]) : null; };
  return {
    name: toTw((m ? m[1] : h.split(' ')[0]).trim()),
    start: m ? dayMs(+m[2], +m[3], now) : 0,
    end: m ? dayMs(+m[4], +m[5], now) : 0,
    total: num(/合计\s*(\d+)\s*抽/) ?? num(/合計\s*(\d+)\s*抽/),
    pad: num(/垫\s*(\d+)/) ?? num(/(?:大保底|保底)\s*(\d+)\s*\//),
  };
}

/**
 * @param scraped { limited|weapon|standard|newbie|joint: [{ head, items: [{ six, pull, date, stamps, fives }] }] }（每池新→舊）
 * @returns { source, fetchedAt, groups: { [groupKey]: [Banner(舊→新)] } }
 */
function parse(scraped, { now = Date.now() } = {}) {
  const groups = {};
  for (const [kind, cards] of Object.entries(scraped || {})) {
    const key = GROUP_KEY[kind];
    if (!key || !Array.isArray(cards)) continue;
    const banners = [];
    for (const card of cards) {
      const h = parseHead(card.head, now);
      const items = [...(card.items || [])].reverse(); // 舊 → 新
      let nth = 0;
      let free = 0;
      const entries = [];
      for (const it of items) {
        const stamps = it.stamps || [];
        const count = Number(it.pull) || 0;
        if (it.six) {
          nth += count;
          const dm = /^(\d{1,2})-(\d{1,2})$/.exec(it.date || '');
          entries.push({
            type: 'top',
            name: toTw(it.six),
            pity: count,
            isUp: kind === 'limited' || kind === 'weapon' || kind === 'joint' ? !stamps.includes('歪') : null,
            free: false,
            time: dm ? dayMs(+dm[1], +dm[2], now) : h.end,
            nth,
            fives: (it.fives || []).map(toTw),
          });
        } else if (stamps.includes('免')) {
          free += count;
          nth += count;
          entries.push({ type: 'free', count, time: h.start });
        }
      }
      banners.push({ ...h, free, paid: h.total, entries, ...(card.source ? { source: card.source } : {}), ...(card.note ? { note: card.note } : {}) });
    }
    groups[key] = banners.sort((a, b) => a.end - b.end);
  }
  return { source: 'lcx', fetchedAt: now, groups };
}

/** 把另一份摘要併進現有的 history：同類型同名的卡池以新的為準 */
function mergeInto(history, extra) {
  const out = { ...(history || { source: extra.source, groups: {} }), groups: { ...(history?.groups || {}) } };
  for (const [key, banners] of Object.entries(extra.groups || {})) {
    const names = new Set(banners.map((b) => b.name));
    out.groups[key] = [...(out.groups[key] || []).filter((b) => !names.has(b.name)), ...banners].sort((a, b) => a.end - b.end);
  }
  return out;
}

module.exports = { parse, parseHead, mergeInto, GROUP_KEY };
