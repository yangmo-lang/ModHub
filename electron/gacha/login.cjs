// 官方帳號登入（抽卡紀錄用）
//
// 做法：開一個獨立的瀏覽器視窗載入「官方登入頁」，由使用者自己輸入帳密 / 驗證碼。
// ModHub 不碰帳號密碼，也不把 token 寫進自己的檔案：登入狀態留在獨立、持久的瀏覽器分區（Chromium 會加密保存 cookie），
// 需要時再用該分區的 cookie 呼叫官方 API 換取臨時憑證。「登出」= 清除該分區。
const { BrowserWindow, session } = require('electron');
const { UA } = require('../net.cjs');

const PROVIDERS = {
  // 終末地（鷹角通行證）
  gryphline: {
    label: '鷹角通行證（國際服）',
    partition: 'persist:modhub-gryphline',
    loginUrl: 'https://user.gryphline.com/',
    tokenUrl: 'https://web-api.gryphline.com/cookie_store/account_token',
    appCode: '3dacefa138426cfe',
  },
  hypergryph: {
    label: '鷹角網路通行證（國服）',
    partition: 'persist:modhub-hypergryph',
    loginUrl: 'https://user.hypergryph.com/',
    tokenUrl: 'https://web-api.hypergryph.com/account/info/hg',
    appCode: 'be36d44aa36bfb5b',
  },
  // 絕區零（HoYoLAB）
  hoyolab: {
    label: 'HoYoLAB',
    partition: 'persist:modhub-hoyolab',
    loginUrl: 'https://www.hoyolab.com/home',
    bindingBases: ['https://api-account-os.hoyolab.com', 'https://api-account-os.hoyoverse.com'],
  },
};

const ses = (provider) => session.fromPartition(PROVIDERS[provider].partition);

async function sfetchJson(provider, url, init = {}) {
  const r = await ses(provider).fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------------- 鷹角：帳號 token → OAuth → 綁定角色 → u8_token ----------------

/** 從登入分區讀帳號 token（沒登入回傳 null） */
async function hgAccountToken(provider) {
  try {
    const j = await sfetchJson(provider, PROVIDERS[provider].tokenUrl);
    const t = j?.data?.content || j?.data?.token;
    return (j.code === 0 || j.status === 0) && t ? t : null;
  } catch { return null; }
}

async function hgOAuth(provider, accountToken) {
  const j = await postJson(`https://as.${provider}.com/user/oauth2/v2/grant`, { token: accountToken, appCode: PROVIDERS[provider].appCode, type: 1 });
  if (j.status !== 0 || !j.data?.token) throw new Error('鷹角帳號授權失敗，請重新登入');
  return j.data.token;
}

/** 登入帳號底下的終末地角色 */
async function hgRoles(provider) {
  const acc = await hgAccountToken(provider);
  if (!acc) return null;
  const oauth = await hgOAuth(provider, acc);
  const q = new URLSearchParams({ token: oauth, appCode: 'endfield' });
  const r = await fetch(`https://binding-api-account-prod.${provider}.com/account/binding/v1/binding_list?${q}`, { headers: { 'User-Agent': UA } });
  const j = await r.json();
  if (j.status !== 0) throw new Error('讀取終末地角色失敗');
  const app = (j.data?.list || []).find((x) => x.appCode === 'endfield') || j.data?.list?.[0];
  const roles = [];
  for (const b of app?.bindingList || []) {
    for (const role of b.roles || []) {
      roles.push({ uid: String(b.uid), roleId: String(role.roleId), name: role.nickName || '', serverId: String(role.serverId), server: role.serverName || '', level: role.level });
    }
  }
  return { oauth, roles };
}

/** 換取某個角色的 u8_token（給 ef-webview 紀錄 API 用） */
async function hgU8Token(provider, uid, oauth) {
  const j = await postJson(`https://binding-api-account-prod.${provider}.com/account/binding/v1/u8_token_by_uid`, { uid, token: oauth });
  if (!j?.data?.token) throw new Error('換取遊戲憑證失敗，請重新登入');
  return j.data.token;
}

// ---------------- HoYoLAB：登入 cookie → 角色 → 產生調頻紀錄 authkey ----------------

async function hoyoRoles() {
  for (const base of PROVIDERS.hoyolab.bindingBases) {
    try {
      const j = await sfetchJson('hoyolab', `${base}/account/binding/api/getUserGameRolesByCookieToken?game_biz=nap_global`);
      if (j.retcode === 0) {
        return (j.data?.list || []).map((r) => ({ uid: String(r.game_uid), name: r.nickname || '', region: r.region, server: r.region_name || r.region, level: r.level, base }));
      }
      if (j.retcode === -100 || /login|登入|登录/i.test(j.message || '')) return null;
    } catch {}
  }
  return null;
}

async function hoyoAuthKey(role) {
  const j = await sfetchJson('hoyolab', `${role.base}/account/binding/api/genAuthKeyByCookieToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game_biz: 'nap_global', region: role.region, game_uid: role.uid, auth_appid: 'webview_gacha' }),
  });
  if (j.retcode !== 0 || !j.data?.authkey) throw new Error(`產生調頻紀錄憑證失敗（${j.retcode}：${j.message || ''}）`);
  return { authkey: j.data.authkey, authkey_ver: String(j.data.authkey_ver || 1), sign_type: String(j.data.sign_type || 2) };
}

/**
 * HoYoLAB 官方「調頻查詢工具」的統計資料（所有版本，不受 6 個月紀錄限制）
 *   index          → 各類型總抽數、S 數、目前保底、有資料的版本
 *   hist_pool_stat → 每個版本每期卡池的 S 紀錄（含 is_up、出貨抽數、圖示）
 *   cur_pool_stat  → 目前開放的卡池（UP 項目、起訖時間）
 */
async function hoyoOfficial(role) {
  const base = 'https://sg-act-public-api.hoyolab.com/event/nap_gacha_record/api/zzz';
  const key = await hoyoAuthKey(role);
  const q0 = { authkey: key.authkey, authkey_ver: key.authkey_ver, sign_type: key.sign_type, lang: 'zh-tw', region: role.region, game_biz: 'nap_global', uid: role.uid };
  const get = async (ep, extra = {}) => {
    const j = await sfetchJson('hoyolab', `${base}/${ep}?${new URLSearchParams({ ...q0, ...extra })}`);
    if (j.retcode !== 0) throw new Error(`HoYoLAB ${ep}：${j.retcode} ${j.message || ''}`);
    return j.data || {};
  };
  const index = await get('index');
  const types = {};
  for (const t of index.type_stats || []) {
    const hist = [];
    const vers = t.has_data_vers || [];
    for (let i = 0; i < vers.length; i += 8) {
      const d = await get('hist_pool_stat', { gacha_type: t.gacha_type, vers: vers.slice(i, i + 8).join(',') });
      hist.push(...(d.list || []));
    }
    const cur = (await get('cur_pool_stat', { gacha_type: t.gacha_type }).catch(() => ({}))).list || [];
    types[t.gacha_type] = { stat: t, hist, cur };
  }
  return { fetchedAt: Date.now(), index: { total: Number(index.total_gacha_count) || 0, s: Number(index.total_s_count) || 0, curVer: index.cur_ver, tickets: index.cur_tickets || [] }, types };
}

// ---------------- 登入視窗 / 狀態 ----------------

async function status(provider) {
  try {
    if (provider === 'hoyolab') {
      const roles = await hoyoRoles();
      return roles ? { loggedIn: true, roles } : { loggedIn: false };
    }
    const r = await hgRoles(provider);
    return r ? { loggedIn: true, roles: r.roles } : { loggedIn: false };
  } catch (e) {
    return { loggedIn: false, error: e.message };
  }
}

/** 開官方登入頁，登入成功（或使用者關閉視窗）後結束 */
function openLogin(provider, parent) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('不支援的帳號類型');
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520, height: 760, parent, modal: false, autoHideMenuBar: true,
      title: `登入 ${p.label}（官方頁面）`,
      webPreferences: { partition: p.partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      if (!win.isDestroyed()) win.close();
      resolve(ok);
    };
    // 只允許官方網域與第三方登入（Google / Apple / Facebook / X）的彈出視窗，同樣留在這個獨立分區
    const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(gryphline|hypergryph|hoyolab|hoyoverse|mihoyo|google|apple|facebook|twitter|x)\.com\//i;
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!ALLOWED.test(url)) return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: win, width: 520, height: 700, autoHideMenuBar: true,
          webPreferences: { partition: p.partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    });
    win.loadURL(p.loginUrl);
    // 輪詢是否已登入：鷹角只查帳號 token（1 個請求），HoYoLAB 查角色列表
    const timer = setInterval(async () => {
      if (win.isDestroyed()) return finish(false);
      const ok = provider === 'hoyolab' ? Boolean(await hoyoRoles()) : Boolean(await hgAccountToken(provider));
      if (ok) finish(true);
    }, 2000);
    win.on('closed', () => finish(false));
  });
}

async function logout(provider) {
  await ses(provider).clearStorageData();
  return true;
}

module.exports = { PROVIDERS, status, openLogin, logout, hgRoles, hgU8Token, hoyoRoles, hoyoAuthKey, hoyoOfficial };
