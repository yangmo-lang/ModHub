// 抽卡統計（純函式）
//
// 統一的紀錄格式（各遊戲轉接器產生）：
// { id, pool, poolName, bannerId?, bannerName?, name, itemId, kind, rarity, tier: 'top'|'mid'|'low', time, free?, gift? }
//   pool   = 保底計算的分組（同一組共用保底）
//   tier   = top 為最高稀有度（終末地 6★、絕區零 S）
//   gift   = 獎勵贈送，不算抽數也不影響保底
//   free   = 免費抽：算抽數，但依遊戲規則可能不累計保底（由 pityCountsFree 決定）

/** 依 id 合併新舊紀錄（同 id 以新資料為準），由舊到新排序 */
function mergeRecords(oldList, newList) {
  const map = new Map();
  for (const r of oldList || []) map.set(r.id, r);
  for (const r of newList || []) map.set(r.id, r);
  return [...map.values()].sort(compareRecord);
}

/** 由舊到新：先比時間，再比 id（id 可能是大整數字串） */
function compareRecord(a, b) {
  if (a.time !== b.time) return a.time - b.time;
  return compareId(a.id, b.id);
}

function compareId(a, b) {
  const x = String(a);
  const y = String(b);
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
    if (x.length !== y.length) return x.length - y.length;
  }
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * 每個保底分組的統計
 * @param rules { [pool]: { label, pityMax, order, pityCountsFree?: boolean } }
 */
function poolStats(records, rules = {}) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.pool)) groups.set(r.pool, []);
    groups.get(r.pool).push(r);
  }
  const out = [];
  for (const [pool, list] of groups) {
    const rule = rules[pool] || {};
    const pulls = list.filter((r) => !r.gift);
    let pity = 0;
    let midPity = 0;
    const tops = [];
    const counts = { top: 0, mid: 0, low: 0 };
    for (const r of pulls) {
      // 免費抽（例如終末地的加急招募）預設不累計保底，抽到最高稀有度也不重置保底
      const counts4Pity = !r.free || rule.pityCountsFree === true;
      if (counts4Pity) { pity++; midPity++; }
      counts[r.tier] = (counts[r.tier] || 0) + 1;
      if (r.tier === 'top') {
        tops.push({ name: r.name, itemId: r.itemId, pity: counts4Pity ? pity : 0, time: r.time, bannerName: r.bannerName || r.poolName, free: Boolean(r.free), id: r.id });
        if (counts4Pity) { pity = 0; midPity = 0; }
      } else if (r.tier === 'mid' && counts4Pity) {
        midPity = 0;
      }
    }
    // 限定池的「本期大保底」：最新一期卡池裡的付費抽數
    let banner = null;
    if (rule.bannerPityMax) {
      const lastBanner = pulls.length ? pulls[pulls.length - 1].bannerId : null;
      if (lastBanner) {
        const inBanner = pulls.filter((r) => r.bannerId === lastBanner && !r.free);
        banner = { id: lastBanner, name: pulls[pulls.length - 1].bannerName, paid: inBanner.length, max: rule.bannerPityMax };
      }
    }
    const paid = tops.filter((t) => t.pity > 0);
    out.push({
      pool,
      label: rule.label || list[0]?.poolName || pool,
      order: rule.order ?? 99,
      pityMax: rule.pityMax || null,
      banner,
      total: pulls.length,
      free: pulls.filter((r) => r.free).length,
      gifts: list.length - pulls.length,
      pity,
      midPity,
      counts,
      tops: tops.reverse(), // 新的在前
      avgTopPity: paid.length ? Math.round((paid.reduce((s, t) => s + t.pity, 0) / paid.length) * 10) / 10 : null,
      first: list[0]?.time || null,
      last: list[list.length - 1]?.time || null,
    });
  }
  return out.sort((a, b) => a.order - b.order || b.total - a.total);
}

function summary(records, rules) {
  const pools = poolStats(records, rules);
  const pulls = records.filter((r) => !r.gift);
  return {
    pools,
    total: pulls.length,
    tops: pulls.filter((r) => r.tier === 'top').length,
    first: records[0]?.time || null,
    last: records[records.length - 1]?.time || null,
  };
}

module.exports = { mergeRecords, compareRecord, compareId, poolStats, summary };
