// 抽卡「圖像化總覽」資料（純函式）
//
// 產出：
// {
//   totals: { pulls, free, tops, topRate, upWin, upKnown, source },
//   groups: [{ key, label, pityNow, pityMax, bigPity?, banners: [Banner] }],   // 依卡池類型分頁
// }
// Banner: { id, name, version?, start, end, current, pulls, free, upName, upIcon,
//           entries: [ {type:'top', name, icon, pity, isUp, free, time, nth} | {type:'free', count, time} | {type:'pad', count, time} ],  // 新到舊
//           tops: [{ name, icon, count, isUp }] }     // 速覽用（同名合併）
const { normalizeName, toTw } = require('../characters.cjs');

const iconOf = (icons, name) => (icons && name ? icons[normalizeName(name)] || null : null);

function summarizeTops(entries) {
  const m = new Map();
  for (const e of entries) {
    if (e.type !== 'top') continue;
    const k = `${e.name}|${e.isUp === false ? 'off' : 'on'}`;
    const cur = m.get(k) || { name: e.name, icon: e.icon, count: 0, isUp: e.isUp };
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()];
}

// ---------------- 終末地 ----------------
const EF_CHAR = {
  E_CharacterGachaPoolType_Special: { label: '特許尋訪', order: 1, limited: true, pityMax: 80, bigMax: 120 },
  E_CharacterGachaPoolType_Rerun: { label: '重構尋訪', order: 2, limited: true, pityMax: 80, bigMax: 120 },
  E_CharacterGachaPoolType_Joint: { label: '輝光慶典', order: 3, limited: true, pityMax: 80 },
  E_CharacterGachaPoolType_Standard: { label: '基礎尋訪', order: 5, pityMax: 80 },
  E_CharacterGachaPoolType_Beginner: { label: '啟程尋訪', order: 6, pityMax: 80 },
};

/**
 * @param records   已排序（舊→新）的紀錄
 * @param poolInfo  { [bannerId]: { up6, up6Avatar, name } }（官方 api/content）
 * @param icons     { normalizedName: url }
 */
function buildEndfield(records, poolInfo = {}, icons = {}) {
  // 常駐 6★ 名單：基礎 / 啟程尋訪出過的 6★ + 官方 standard 池內容
  const roster = new Set(records.filter((r) => /Standard|Beginner/.test(r.pool) && r.tier === 'top').map((r) => r.name));
  for (const n of poolInfo.standard?.all6 || []) roster.add(n);

  const groupsMap = new Map();
  for (const r of records) {
    const isWeapon = r.pool.startsWith('weapon:');
    const gkey = isWeapon ? 'weapon' : r.pool;
    if (!groupsMap.has(gkey)) groupsMap.set(gkey, []);
    groupsMap.get(gkey).push(r);
  }

  const groups = [];
  let upWins = 0;
  let upKnown = 0;
  for (const [gkey, list] of groupsMap) {
    const isWeapon = gkey === 'weapon';
    const meta = isWeapon ? { label: '武器申領', order: 4, pityMax: 40, bigMax: 80, limited: true } : EF_CHAR[gkey.slice(5)] || { label: list[0].poolName, order: 9, pityMax: 80 };
    // 角色池：同類型共用保底；武器：每個池各自保底
    const pityKey = (r) => (isWeapon ? r.bannerId : 'all');
    const pity = new Map();
    const banners = new Map();
    for (const r of list) {
      if (r.gift) continue;
      const bid = r.bannerId || gkey;
      if (!banners.has(bid)) banners.set(bid, { id: bid, name: r.bannerName || r.poolName, start: r.time, end: r.time, pulls: 0, free: 0, paid: 0, entries: [], gotUp: false });
      const b = banners.get(bid);
      b.end = r.time;
      b.pulls++;
      const pk = pityKey(r);
      if (r.free) {
        b.free++;
        const last = b.entries[b.entries.length - 1];
        if (last && last.type === 'free' && r.time - last.time < 10 * 60 * 1000) { last.count++; last.time = r.time; } else b.entries.push({ type: 'free', count: 1, time: r.time });
      } else {
        b.paid++;
        pity.set(pk, (pity.get(pk) || 0) + 1);
      }
      if (r.tier === 'top') {
        const info = poolInfo[bid];
        let isUp = null;
        if (meta.limited) {
          if (info?.up6) isUp = info.up6 === r.name;
          else if (!isWeapon) isUp = !roster.has(r.name);
        }
        if (isUp !== null && !r.free) { upKnown++; if (isUp) upWins++; }
        if (isUp) b.gotUp = true;
        // 頭像一律用方形角色圖（官方 up6_avatar 是橫長的名牌圖，不能當頭像）
        b.entries.push({ type: 'top', name: r.name, icon: iconOf(icons, r.name), pity: r.free ? 0 : pity.get(pk) || 0, isUp, free: Boolean(r.free), time: r.time, nth: b.pulls, rarity: r.rarity });
        if (!r.free) pity.set(pk, 0);
      }
      b.pityAfter = pity.get(pk) || 0;
    }
    const ordered = [...banners.values()].sort((a, b) => b.end - a.end);
    // 每期最後還沒出貨的抽數 =「已墊」（帶到下一期）
    for (const b of ordered) {
      b.pad = b.pityAfter || 0;
      const info = poolInfo[b.id];
      b.upName = info?.up6 || null;
      b.upIcon = iconOf(icons, info?.up6);
      if (info?.name) b.name = info.name;
      b.entries = b.entries.reverse();
      b.tops = summarizeTops(b.entries);
    }
    const latest = ordered[0];
    if (latest) latest.current = true;
    const pityNow = isWeapon ? (latest?.pityAfter || 0) : (pity.get('all') || 0);
    groups.push({
      key: gkey,
      label: meta.label,
      order: meta.order,
      pityNow,
      pityMax: meta.pityMax,
      bigPity: meta.bigMax && latest ? { paid: latest.paid, max: meta.bigMax, remaining: Math.max(0, meta.bigMax - latest.paid), gotUp: latest.gotUp, name: latest.name } : null,
      pulls: list.filter((r) => !r.gift).length,
      free: list.filter((r) => r.free && !r.gift).length,
      banners: ordered,
    });
  }
  groups.sort((a, b) => a.order - b.order);
  const pulls = records.filter((r) => !r.gift);
  const free = pulls.filter((r) => r.free).length;
  const tops = pulls.filter((r) => r.tier === 'top').length;
  return {
    totals: { pulls: pulls.length - free, free, tops, topRate: pulls.length ? tops / pulls.length : 0, upWin: upKnown ? upWins / upKnown : null, upKnown, topLabel: '6★', source: 'records' },
    groups,
  };
}

/**
 * 把外部歷史摘要（離愁軒）補進終末地總覽：只補「比 ModHub 逐抽紀錄更早」的卡池。
 *   - 該類型完全沒有 ModHub 紀錄、或卡池結束日早於 ModHub 該類型第一筆紀錄 → 整期加入
 *   - 常駐 / 啟程這種跨很久的單一卡池：只把 ModHub 第一筆紀錄之前的 6★ 加成一期「（離愁軒，之前）」，抽數不明
 */
function mergeHistory(vis, history, records, icons = {}) {
  if (!history?.groups) return vis;
  const DAY = 86400000;
  const firstOf = {};
  for (const r of records) {
    const g = r.pool.startsWith('weapon:') ? 'weapon' : r.pool;
    if (firstOf[g] == null || r.time < firstOf[g]) firstOf[g] = r.time;
  }
  const label = history.source === 'lcx' ? '離愁軒' : '匯入';
  let addPulls = 0, addFree = 0, addTops = 0, addUpWin = 0, addUpKnown = 0;
  for (const [gkey, banners] of Object.entries(history.groups)) {
    const first = firstOf[gkey];
    // ModHub 第一筆紀錄的「當天」之前（摘要只有日期，同一天的算重複）
    const cutoff = first != null ? new Date(new Date(first).toDateString()).getTime() : Infinity;
    const out = [];
    for (const b of banners) {
      const whole = b.end < cutoff;
      const tops = b.entries.filter((e) => e.type === 'top' && e.time < cutoff);
      if (!whole && !tops.length) continue;
      const entries = (whole ? b.entries : tops).map((e) => (e.type === 'top' ? { ...e, icon: iconOf(icons, e.name), rarity: 6 } : e)).reverse();
      const t = entries.filter((e) => e.type === 'top');
      out.push({
        id: `hist|${gkey}|${b.name}|${b.start}`,
        name: whole ? b.name : `${b.name}（${label}，${fmtMd(cutoff - DAY)} 前）`,
        start: b.start,
        end: whole ? b.end : Math.min(b.end, cutoff - DAY),
        current: false,
        pulls: whole && b.total != null ? b.total + (b.free || 0) : null,
        free: whole ? b.free || 0 : 0,
        pad: whole ? b.pad || 0 : 0,
        upName: null,
        upIcon: null,
        entries,
        tops: summarizeTops(entries),
        history: label,
      });
      if (whole && b.total != null) { addPulls += b.total; addFree += b.free || 0; }
      addTops += t.length;
      for (const e of t) if (e.isUp != null) { addUpKnown++; if (e.isUp) addUpWin++; }
    }
    if (!out.length) continue;
    let g = vis.groups.find((x) => x.key === gkey);
    if (!g) {
      const meta = gkey === 'weapon' ? { label: '武器申領', order: 4, pityMax: 40 } : EF_CHAR[gkey.slice(5)] || { label: gkey, order: 9, pityMax: 80 };
      g = { key: gkey, label: meta.label, order: meta.order, pityNow: out[out.length - 1].pad || 0, pityMax: meta.pityMax, bigPity: null, pulls: 0, free: 0, banners: [] };
      vis.groups.push(g);
    }
    g.banners = [...g.banners, ...out.sort((a, b) => b.end - a.end)];
    g.pulls += out.reduce((s, b) => s + (b.pulls != null ? b.pulls : 0), 0);
    g.free += out.reduce((s, b) => s + (b.pulls != null ? b.free : 0), 0);
    g.history = label;
  }
  vis.groups.sort((a, b) => a.order - b.order);
  const T = vis.totals;
  const upWin = T.upWin != null ? T.upWin * T.upKnown : 0;
  const pulls = T.pulls + addPulls;
  const tops = T.tops + addTops;
  const known = T.upKnown + addUpKnown;
  vis.totals = { ...T, pulls, free: T.free + addFree, tops, topRate: pulls ? tops / (pulls + T.free + addFree) : 0, upWin: known ? (upWin + addUpWin) / known : null, upKnown: known, history: label };
  return vis;
}

// ---------------- 絕區零 ----------------
const ZZZ_TYPES = {
  GACHA_TYPE_CHARACTER_UP: { label: '獨家頻段', order: 1, pool: 'zzz:2', limited: true },
  GACHA_TYPE_CHARACTER_RETURN: { label: '獨家重映', order: 2, pool: 'zzz:2', limited: true },
  GACHA_TYPE_WEAPON_UP: { label: '音擎頻段', order: 3, pool: 'zzz:3', limited: true },
  GACHA_TYPE_WEAPON_RETURN: { label: '音擎回響', order: 4, pool: 'zzz:3', limited: true },
  GACHA_TYPE_PERMANENT: { label: '常駐頻段', order: 5, pool: 'zzz:1' },
  GACHA_TYPE_BANGBOO: { label: '邦布頻段', order: 6, pool: 'zzz:5' },
};
const ZZZ_FALLBACK = { 'zzz:2': '獨家頻段', 'zzz:3': '音擎頻段', 'zzz:1': '常駐頻段', 'zzz:5': '邦布頻段' };
const PITY_MAX = { 'zzz:2': 90, 'zzz:1': 90, 'zzz:3': 80, 'zzz:5': 80 };
const verKey = (v) => String(v || '').split('.').map((x) => String(x).padStart(3, '0')).join('.');

/** 有 HoYoLAB 官方統計時用官方資料（含 is_up、全部版本）；沒有就用紀錄推算 */
function buildZzz(records, official, icons = {}) {
  if (!official?.types) return buildZzzFromRecords(records, icons);
  const groups = [];
  let upCount = 0;
  let sCount = 0;
  for (const [type, t] of Object.entries(official.types)) {
    const meta = ZZZ_TYPES[type] || { label: type, order: 9 };
    const st = t.stat || {};
    const toBanner = (p, current) => {
      const recs = [...(p.cur_records || [])].sort((a, b) => Number(a.record_time) - Number(b.record_time));
      const entries = recs.map((x, i) => ({
        type: 'top', name: toTw(x.name), icon: x.icon || iconOf(icons, x.name), pity: Number(x.count) || 0,
        isUp: meta.limited ? Boolean(x.is_up) : null, free: false, time: Number(x.record_time) * 1000 || 0, nth: i + 1, rarity: 4,
      })).reverse();
      const ups = (p.cur_item_list || []).filter((x) => x.rarity === 'S' && x.name).map((x) => ({ ...x, name: toTw(x.name) }));
      const upNames = ups.length ? ups.map((x) => x.name) : [...new Set(recs.filter((x) => x.is_up && x.name).map((x) => toTw(x.name)))];
      return {
        id: `${type}|${p.version}|${p.start_ts || ''}|${upNames.join(',')}`,
        name: upNames.length && meta.limited ? upNames.join('、') : meta.label,
        version: p.version,
        start: Number(p.start_ts) * 1000 || entries[entries.length - 1]?.time || 0,
        end: Number(p.end_ts) * 1000 || entries[0]?.time || 0,
        current,
        pulls: null,
        free: 0,
        upName: upNames[0] || null,
        upIcon: ups[0]?.icon || iconOf(icons, upNames[0]),
        upList: ups.map((x) => ({ name: x.name, icon: x.icon })),
        entries,
        tops: summarizeTops(entries),
      };
    };
    const banners = [
      // 目前開放中的卡池；尚未開始的（前瞻）不列入
      ...(t.cur || []).filter((p) => !/NOT_START/.test(p.gacha_state || '')).map((p) => toBanner(p, true)),
      ...(t.hist || []).filter((p) => (p.cur_records || []).length).map((p) => toBanner(p, false)),
    ].sort((a, b) => verKey(b.version).localeCompare(verKey(a.version)) || (b.current - a.current) || b.end - a.end);
    if (meta.limited) { upCount += Number(st.up_count) || 0; sCount += Number(st.s_count) || 0; }
    groups.push({
      key: type,
      label: meta.label,
      order: meta.order,
      pool: meta.pool,
      pityNow: Number(st.next_s_cur_times) || 0,
      pityMax: PITY_MAX[meta.pool] || 90,
      worstPity: Number(st.new_s_max_times) || null, // 官方欄位：歷來最多幾抽才出 S
      pulls: Number(st.total_count) || 0,
      free: 0,
      sCount: Number(st.s_count) || 0,
      upCount: Number(st.up_count) || 0,
      avgUp: st.avr_up_count ? Number(st.avr_up_count) : null,
      banners,
    });
  }
  groups.sort((a, b) => a.order - b.order);
  const total = official.index?.total || groups.reduce((s, g) => s + g.pulls, 0);
  const s = official.index?.s || groups.reduce((x, g) => x + g.sCount, 0);
  return {
    totals: { pulls: total, free: 0, tops: s, topRate: total ? s / total : 0, upWin: sCount ? upCount / sCount : null, upKnown: sCount, topLabel: 'S', source: 'official' },
    groups: groups.filter((g) => g.pulls || g.banners.length),
  };
}

// 常駐 S（拿來判斷「歪」）：常駐頻段出過的 + 已知常駐代理人
const ZZZ_STANDARD_S = ['貓又', '「11號」', '11號', '珂蕾妲', '萊卡恩', '格莉絲', '麗娜', '鋼鐵肉墊', '硫磺石', '啜泣搖籃', '燃獄齒輪', '拘縛者', '加農轉子'];

/**
 * 沒有官方統計時，用逐抽紀錄推算「每期卡池」。
 * 逐抽紀錄沒有卡池 id（gacha_id 是空的），而且同一期常有兩個 UP 池共用保底，
 * 所以限定池依「抽卡時間」分期：相隔超過 PHASE_IDLE 沒抽、或一期超過 PHASE_SPAN，就算下一期；
 * 卡池名稱 = 該期出過的 UP（非常駐 S）。保底跨期累計，期末沒出的抽數 =「已墊」。常駐 / 邦布池不分期。
 */
const DAY = 86400000;
const PHASE_IDLE = 6 * DAY;
const PHASE_SPAN = 21 * DAY;

function zzzBannersFromRecords(pool, list, roster, icons) {
  const limited = pool === 'zzz:2' || pool === 'zzz:3';
  const label = ZZZ_FALLBACK[pool];
  const phases = [];
  for (const r of list) {
    const ph = phases[phases.length - 1];
    if (limited && ph && (r.time - ph.last > PHASE_IDLE || r.time - ph.first > PHASE_SPAN)) phases.push({ first: r.time, last: r.time, recs: [r] });
    else if (ph) { ph.recs.push(r); ph.last = r.time; } else phases.push({ first: r.time, last: r.time, recs: [r] });
  }
  let pity = 0;
  const banners = phases.map((ph) => {
    const entries = [];
    ph.recs.forEach((r, i) => {
      pity++;
      if (r.tier === 'top') {
        entries.push({ type: 'top', name: r.name, icon: iconOf(icons, r.name), pity, isUp: limited ? !roster.has(r.name) : null, free: false, time: r.time, nth: i + 1, rarity: r.rarity });
        pity = 0;
      }
    });
    const ups = [...new Set(entries.filter((e) => e.isUp).map((e) => e.name))];
    const rev = entries.reverse();
    return {
      id: `${pool}|${ph.recs[0].id}`,
      name: limited && ups.length ? ups.join('、') : limited ? `${label}（${fmtMd(ph.first)}）` : label,
      current: false,
      pulls: ph.recs.length,
      free: 0,
      start: ph.first,
      end: ph.last,
      upName: ups[0] || null,
      upIcon: iconOf(icons, ups[0]),
      upList: ups.map((n) => ({ name: n, icon: iconOf(icons, n) })),
      entries: rev,
      tops: summarizeTops(rev),
      pad: pity,
    };
  });
  // 最後一期：近 3 週內還有抽才算「進行中」
  const lastB = banners[banners.length - 1];
  if (lastB && Date.now() - lastB.end < PHASE_SPAN) lastB.current = true;
  return banners.reverse();
}

const fmtMd = (t) => { const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };

function buildZzzFromRecords(records, icons) {
  const roster = new Set([...ZZZ_STANDARD_S, ...records.filter((r) => r.pool === 'zzz:1' && r.tier === 'top').map((r) => r.name)]);
  const groups = [];
  for (const pool of ['zzz:2', 'zzz:3', 'zzz:1', 'zzz:5']) {
    const list = records.filter((r) => r.pool === pool);
    if (!list.length) continue;
    let pity = 0;
    for (const r of list) pity = r.tier === 'top' ? 0 : pity + 1;
    groups.push({
      key: pool, label: ZZZ_FALLBACK[pool], pool, pityNow: pity, pityMax: PITY_MAX[pool], pulls: list.length, free: 0,
      banners: zzzBannersFromRecords(pool, list, roster, icons),
    });
  }
  const tops = records.filter((r) => r.tier === 'top');
  const lim = tops.filter((r) => r.pool === 'zzz:2' || r.pool === 'zzz:3');
  return {
    totals: { pulls: records.length, free: 0, tops: tops.length, topRate: records.length ? tops.length / records.length : 0, upWin: lim.length ? lim.filter((r) => !roster.has(r.name)).length / lim.length : null, upKnown: lim.length, topLabel: 'S', source: 'records' },
    groups,
  };
}

/** 逐抽格子：T 編號、名稱、圖示、稀有度、計數（最高稀有度=保底抽數，其他=距上次同稀有度） */
function pullGrid(records, icons = {}, { pool, bannerId, isWeaponGroup } = {}) {
  const list = records.filter((r) => !r.gift && (isWeaponGroup ? r.pool.startsWith('weapon:') && (!bannerId || r.bannerId === bannerId) : r.pool === pool));
  const since = {};
  let pity = 0;
  const out = list.map((r, i) => {
    if (!r.free) pity++;
    for (const k of ['top', 'mid', 'low']) since[k] = (since[k] || 0) + 1;
    const n = r.tier === 'top' ? (r.free ? 0 : pity) : since[r.tier];
    since[r.tier] = 0;
    if (r.tier === 'top' && !r.free) pity = 0;
    return { t: i + 1, id: r.id, name: r.name, icon: iconOf(icons, r.name), tier: r.tier, rarity: r.rarity, rarityLabel: r.rarityLabel, n, time: r.time, free: Boolean(r.free), banner: r.bannerName || r.poolName, bannerId: r.bannerId };
  });
  const filtered = bannerId && !isWeaponGroup ? out.filter((x) => x.bannerId === bannerId) : out;
  return filtered.reverse();
}

module.exports = { mergeHistory, buildEndfield, buildZzz, buildZzzFromRecords, pullGrid, ZZZ_TYPES };
