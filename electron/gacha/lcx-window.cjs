// 從離愁軒（wiki.lcx.cab）讀取終末地抽卡摘要：使用者在 ModHub 開的視窗裡自己登入離愁軒，
// 按「讀取」時從頁面上讀出各卡池卡片（和使用者看到的內容相同），整理後交給 lcx.parse。
// 不呼叫離愁軒的 API、不經手帳號密碼；登入狀態存在獨立的 persist:modhub-lcx 分區。
const PAGE = 'https://wiki.lcx.cab/zmd/gacha_tracker.php';
const PARTITION = 'persist:modhub-lcx';
const HOST_RE = /^([a-z0-9-]+\.)*lcx\.cab$/i;

function isLcxUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && HOST_RE.test(u.hostname);
  } catch { return false; }
}

/**
 * 在離愁軒頁面裡執行（序列化後用 executeJavaScript）：讀出五種卡池的卡片
 * 回傳 { loggedIn, uid, kinds: { limited|weapon|standard|newbie|joint: [{ head, items: [{ six, pull, date, stamps, fives }] }] } }
 */
function scrapePage() {
  const KINDS = ['limited', 'weapon', 'standard', 'newbie', 'joint'];
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const uidMatch = /UID[:：]\s*(\d{5,})/.exec(document.body ? document.body.innerText : '');
  const kinds = {};
  let found = false;
  for (const kind of KINDS) {
    const pane = document.querySelector(`#content-${kind}`);
    if (!pane) continue;
    found = true;
    kinds[kind] = [...pane.querySelectorAll('.card-custom')].map((card) => {
      const headEl = card.querySelector(':scope > .p-3') || card.firstElementChild;
      const items = [...card.querySelectorAll('.list-group-item')].map((li) => {
        const six = (li.querySelector('.rarity-6 img[alt]') || { getAttribute: () => '' }).getAttribute('alt') || '';
        const m = /(\d+)\s*抽/.exec(text(li.querySelector('.flex-grow-1')) || text(li));
        const stamps = [...li.querySelectorAll('div, span')].filter((e) => !e.children.length).map(text)
          .filter((t) => /^(暂未出货|暫未出貨|歪|免)$/.test(t));
        const fives = [];
        for (const f of li.querySelectorAll('.rarity-5[title]')) {
          const n = Number(text(f.querySelector('span'))) || 1;
          for (let i = 0; i < Math.min(n, 50); i++) fives.push(f.getAttribute('title'));
        }
        return { six, pull: m ? Number(m[1]) : 0, date: text(li.querySelector('.font-monospace')), stamps: [...new Set(stamps)], fives };
      });
      return { head: text(headEl), items };
    });
  }
  return { loggedIn: found, uid: uidMatch ? uidMatch[1] : '', kinds };
}

const str = (v, max = 80) => String(v ?? '').slice(0, max);

/** 頁面回傳的資料不完全可信：只留需要的欄位、限制長度與數量 */
function sanitize(raw) {
  const kinds = {};
  let cards = 0;
  for (const kind of ['limited', 'weapon', 'standard', 'newbie', 'joint']) {
    const list = Array.isArray(raw?.kinds?.[kind]) ? raw.kinds[kind].slice(0, 300) : [];
    kinds[kind] = list.map((c) => ({
      head: str(c?.head, 200),
      items: (Array.isArray(c?.items) ? c.items.slice(0, 1000) : []).map((it) => ({
        six: str(it?.six, 40),
        pull: Math.max(0, Math.min(10000, Number(it?.pull) || 0)),
        date: /^\d{1,2}-\d{1,2}$/.test(String(it?.date || '')) ? String(it.date) : '',
        stamps: (Array.isArray(it?.stamps) ? it.stamps : []).map((s) => str(s, 10)).filter((s) => ['暂未出货', '暫未出貨', '歪', '免'].includes(s)),
        fives: (Array.isArray(it?.fives) ? it.fives.slice(0, 200) : []).map((f) => str(f, 40)).filter(Boolean),
      })),
    }));
    cards += kinds[kind].length;
  }
  return { loggedIn: Boolean(raw?.loggedIn), uid: /^\d{5,20}$/.test(String(raw?.uid || '')) ? String(raw.uid) : '', kinds, cards };
}

/**
 * @param ctx { BrowserWindow, shell, parent? }
 * @returns { open(), read(), close(), isOpen() }
 */
function createLcxWindow(ctx) {
  let win = null;

  function open() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
    win = new ctx.BrowserWindow({
      width: 1100,
      height: 860,
      parent: ctx.parent?.() || undefined,
      title: '離愁軒 - 登入後回到 ModHub 按「讀取並匯入」',
      autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // 登入可能經過其他網站（例如微信授權），https 都在這個視窗裡開；只有讀取時才要求回到離愁軒的紀錄頁
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:/i.test(url)) win.loadURL(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (ev, url) => {
      if (!/^https:/i.test(url)) ev.preventDefault();
    });
    win.on('closed', () => { win = null; });
    win.loadURL(PAGE);
  }

  async function read() {
    if (!win || win.isDestroyed()) throw new Error('離愁軒視窗已關閉，請重新開啟');
    const url = win.webContents.getURL();
    if (!isLcxUrl(url) || !url.startsWith(PAGE)) {
      await win.loadURL(PAGE);
    } else if (win.webContents.isLoading()) {
      await new Promise((r) => win.webContents.once('did-stop-loading', r));
    }
    const raw = await win.webContents.executeJavaScript(`(${scrapePage.toString()})()`, true);
    const data = sanitize(raw);
    if (!data.loggedIn) throw new Error('讀不到抽卡紀錄：請先在離愁軒視窗登入，並確認頁面已顯示各卡池');
    if (!data.cards) throw new Error('離愁軒頁面上沒有卡池紀錄（可能還沒在離愁軒匯入過抽卡紀錄）');
    return data;
  }

  function close() { if (win && !win.isDestroyed()) win.close(); win = null; }

  return { open, read, close, isOpen: () => Boolean(win && !win.isDestroyed()) };
}

module.exports = { createLcxWindow, scrapePage, sanitize, isLcxUrl, PAGE, PARTITION };
