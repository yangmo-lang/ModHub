import React, { useCallback, useEffect, useState } from 'react';

const api = window.modhub;
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
export const fmtSize = (n) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString() : '');
const SOURCES = [['gamebanana', 'GameBanana'], ['nexus', 'Nexus Mods']];
const AUTO_TR_KEY = 'modhub.autoTranslate';
const LANG_NAME = { en: '英文', ja: '日文', ko: '韓文', ru: '俄文', es: '西班牙文', pt: '葡萄牙文', fr: '法文', de: '德文', vi: '越南文', th: '泰文', id: '印尼文' };
const SORTS = [['new', '最新上傳'], ['updated', '最近更新'], ['popular', '熱門']];

export default function Online({ gameId, characters, showAdult, setShowAdult, showToast, seed }) {
  const [source, setSource] = useState('gamebanana');
  const [sort, setSort] = useState('new');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [charId, setCharId] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null); // { id, data?, loading, error }

  const load = useCallback(async (p, append) => {
    setLoading(true);
    setError('');
    try {
      const r = await api.onlineList(gameId, source, { sort, page: p, search: query });
      setItems((prev) => (append ? [...prev, ...r.items.filter((x) => !prev.some((y) => y.id === x.id))] : r.items));
      setHasMore(r.hasMore);
      setTotal(r.total);
      setPage(p);
    } catch (e) {
      setError(errText(e));
      if (!append) setItems([]);
    } finally {
      setLoading(false);
    }
  }, [gameId, source, sort, query]);

  useEffect(() => { load(1, false); }, [load]);
  useEffect(() => {
    // 從圖鑑「找 MOD」過來：直接帶入搜尋字
    if (seed && Date.now() - seed.n < 3000) { setSearch(seed.term); setQuery(seed.term); setCharId(''); return; }
    setSearch(''); setQuery(''); setCharId('');
  }, [gameId, seed]);

  const pickChar = (id) => {
    setCharId(id);
    const c = characters.find((x) => x.id === id);
    const term = c ? (c.en || c.name) : '';
    setSearch(term);
    setQuery(term);
  };

  const openDetail = async (it) => {
    setDetail({ id: it.id, item: it, loading: true });
    try {
      const d = await api.onlineDetails(gameId, source, it.id);
      setDetail((cur) => (cur && cur.id === it.id ? { id: it.id, item: it, data: d } : cur));
    } catch (e) {
      setDetail((cur) => (cur && cur.id === it.id ? { ...cur, loading: false, error: errText(e) } : cur));
    }
  };

  const download = async (d, f) => {
    try {
      const r = await api.onlineDownload(gameId, source, d.id, f.id);
      if (r.needsBrowser) {
        setDetail((cur) => ({ ...cur, nexusHint: { ...r, fileName: f.name } }));
        return;
      }
      showToast(`開始下載：${f.name}`);
    } catch (e) {
      showToast(`下載失敗：${errText(e)}`, 'error');
    }
  };

  const visible = showAdult ? items : items.filter((x) => !x.adult);
  const hidden = items.length - visible.length;

  return (
    <div className="online">
      <header className="toolbar">
        <div className="seg">
          {SOURCES.map(([k, l]) => <button key={k} className={source === k ? 'active' : ''} onClick={() => setSource(k)}>{l}</button>)}
        </div>
        <form className="search-form" onSubmit={(e) => { e.preventDefault(); setCharId(''); setQuery(search); }}>
          <input className="search" placeholder="搜尋（英文名效果較好），Enter 送出" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <select className="sel" value={charId} onChange={(e) => pickChar(e.target.value)} title="依角色搜尋">
          <option value="">全部角色</option>
          {characters.map((c) => <option key={c.id} value={c.id}>{c.nameTw}{c.en ? `（${c.en}）` : ''}</option>)}
        </select>
        <select className="sel" value={sort} onChange={(e) => setSort(e.target.value)} disabled={Boolean(query) && source === 'gamebanana'} title={query && source === 'gamebanana' ? '搜尋時依相關度排序' : '排序'}>
          {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={showAdult} onChange={(e) => setShowAdult(e.target.checked)} />顯示成人內容</label>
      </header>

      <div className="online-body">
        {error && <div className="empty">讀取失敗：{error}</div>}
        {!error && (
          <>
            <div className="online-meta">
              {total != null && <span>共 {total} 個</span>}
              {hidden > 0 && <span>（已隱藏 {hidden} 個成人內容）</span>}
            </div>
            <div className="grid">
              {visible.map((it) => (
                <article key={it.id} className="card online-card" onClick={() => openDetail(it)}>
                  <div className="thumb">
                    {it.thumb ? <img src={it.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="noimg">無預覽圖</div>}
                    {it.suggest && <span className="chip">{it.suggest.nameTw}</span>}
                    {it.installed && <span className={`chip state ${it.hasUpdate ? 'update' : ''}`}>{it.hasUpdate ? '有更新' : '已安裝'}</span>}
                    {it.adult && <span className="chip adult">18+</span>}
                  </div>
                  <div className="card-body">
                    <div className="card-title" title={it.name}>{it.name}</div>
                    <div className="card-meta">{it.author} · {fmtDate(it.updatedAt)}</div>
                    <div className="card-meta">♥ {it.likes}{it.downloads ? ` · ⬇ ${it.downloads}` : ''}{it.category ? ` · ${it.category}` : ''}</div>
                  </div>
                </article>
              ))}
            </div>
            {loading && <div className="empty small">載入中…</div>}
            {!loading && hasMore && <div className="more"><button className="btn" onClick={() => load(page + 1, true)}>載入更多</button></div>}
            {!loading && !items.length && <div className="empty">沒有結果</div>}
          </>
        )}
      </div>

      {detail && (
        <Detail gameId={gameId} detail={detail} source={source} onClose={() => setDetail(null)} onDownload={download} />
      )}
    </div>
  );
}

/** 說明與檔案說明翻譯成繁體中文（預設自動翻譯，可切回原文） */
function useTranslation(gameId, d) {
  const [auto, setAutoState] = useState(() => localStorage.getItem(AUTO_TR_KEY) !== '0');
  const [tr, setTr] = useState(null); // { loading, error, desc, files, engine, lang }
  const [showOriginal, setShowOriginal] = useState(false);
  const setAuto = (v) => { setAutoState(v); localStorage.setItem(AUTO_TR_KEY, v ? '1' : '0'); };
  const run = useCallback(async () => {
    if (!d) return;
    const files = (d.files || []).filter((f) => f.description);
    const texts = [d.description || '', ...files.map((f) => f.description)];
    if (!texts.some((t) => t.trim())) return;
    setTr({ loading: true });
    setShowOriginal(false);
    try {
      const r = await api.onlineTranslate(gameId, texts, { charId: d.suggest?.charId ?? null });
      const google = r.find((x) => x.engine === 'google');
      setTr({
        desc: r[0].text,
        files: Object.fromEntries(files.map((f, i) => [f.id, r[i + 1].text])),
        engine: google ? 'google' : 'opencc',
        lang: google?.lang || '',
      });
    } catch (e) {
      setTr({ error: errText(e) });
    }
  }, [gameId, d]);
  useEffect(() => { setTr(null); if (d && auto) run(); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = tr && !tr.loading && !tr.error && !showOriginal;
  return { auto, setAuto, tr, run, showOriginal, setShowOriginal, active };
}

function TranslateBar({ t, hasText }) {
  if (!hasText) return null;
  const { tr } = t;
  return (
    <div className="tr-bar">
      {!tr && <button className="link" onClick={t.run}>譯為繁體中文</button>}
      {tr?.loading && <span>翻譯中…</span>}
      {tr?.error && <><span className="error-text">翻譯失敗：{tr.error}</span><button className="link" onClick={t.run}>重試</button></>}
      {tr && !tr.loading && !tr.error && (
        <>
          <span>{t.showOriginal ? '原文' : tr.engine === 'google' ? `Google 翻譯${LANG_NAME[tr.lang] ? `（原文：${LANG_NAME[tr.lang]}）` : ''}` : '已轉為繁體中文'}</span>
          <button className="link" onClick={() => t.setShowOriginal((v) => !v)}>{t.showOriginal ? '顯示譯文' : '顯示原文'}</button>
        </>
      )}
      <label className="check" title="開啟 MOD 時自動翻譯說明"><input type="checkbox" checked={t.auto} onChange={(e) => t.setAuto(e.target.checked)} />自動翻譯</label>
    </div>
  );
}

function Detail({ gameId, detail, source, onClose, onDownload }) {
  const d = detail.data;
  const [img, setImg] = useState(0);
  const t = useTranslation(gameId, d);
  const it = d || detail.item;
  const images = d?.images?.length ? d.images : [it.thumb].filter(Boolean);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal detail" onClick={(e) => e.stopPropagation()}>
        <div className="detail-head">
          <div>
            <h3>{it.name}</h3>
            <div className="card-meta">
              {it.author} · 更新 {fmtDate(it.updatedAt)} · ♥ {it.likes}{d?.downloads ? ` · ⬇ ${d.downloads}` : ''}{it.category ? ` · ${it.category}` : ''}
              {it.suggest && <> · 角色：<b>{it.suggest.nameTw}</b></>}
            </div>
            {it.installed && (
              <div className={`installed-note ${it.hasUpdate ? 'update' : ''}`}>
                {it.hasUpdate ? '⬆ 網站上有較新版本，下載後可選擇取代舊版' : '✓ 已安裝'}：{it.installed.category} / {it.installed.name}
              </div>
            )}
            {d?.contentRatings?.length > 0 && <div className="card-meta">內容分級：{d.contentRatings.join('、')}</div>}
          </div>
          <div className="row">
            <button className="btn" onClick={() => api.openExternal(it.url)}>在網站開啟</button>
            <button className="btn ghost" onClick={onClose}>關閉</button>
          </div>
        </div>
        <div className="detail-body">
          <div className="gallery">
            {images[img] && <img className="gallery-main" src={images[img]} alt="" referrerPolicy="no-referrer" />}
            {images.length > 1 && (
              <div className="gallery-strip">
                {images.slice(0, 12).map((u, i) => <img key={u} src={u} alt="" className={i === img ? 'active' : ''} onClick={() => setImg(i)} referrerPolicy="no-referrer" />)}
              </div>
            )}
          </div>
          <div className="detail-side">
            <h4>檔案</h4>
            {detail.loading && !d && <div className="card-meta">讀取中…</div>}
            {detail.error && <div className="error-text">{detail.error}</div>}
            {d?.files?.length === 0 && <div className="card-meta">沒有可下載的檔案</div>}
            {d?.files?.map((f) => (
              <div key={f.id} className="file-row">
                <div className="file-info">
                  <b title={f.name}>{f.name}</b>
                  <small>
                    {fmtSize(f.size)} · {fmtDate(f.date)}{f.version ? ` · v${f.version}` : ''}{f.category ? ` · ${f.category}` : ''}
                    {f.scan && <span className={f.scan === 'clean' ? 'ok' : 'warn-text'}> · 掃毒 {f.scan === 'clean' ? '安全' : f.scan}</span>}
                  </small>
                  {f.description && <small className="file-desc">{t.active && t.tr.files?.[f.id] ? t.tr.files[f.id] : f.description}</small>}
                </div>
                <button className="btn primary" onClick={() => onDownload(d, f)}>下載安裝</button>
              </div>
            ))}
            {detail.nexusHint && (
              <div className="nexus-hint">
                {!detail.nexusHint.hasKey ? (
                  <p>Nexus 下載需要 API 金鑰。請到「⚙ 設定」貼上你的 Nexus API 金鑰。</p>
                ) : (
                  <p>Nexus 規定免費會員要從網頁下載。請在開啟的頁面按 <b>Mod Manager Download</b>
                    {detail.nexusHint.nxmRegistered ? '，ModHub 會自動接手下載。' : '。（先到「⚙ 設定」開啟「處理 nxm:// 連結」，ModHub 才能自動接手；或下載後把壓縮檔拖進 ModHub。）'}
                  </p>
                )}
                <button className="btn" onClick={() => api.openExternal(detail.nexusHint.pageUrl)}>開啟 Nexus 下載頁</button>
              </div>
            )}
            {d?.description && (
              <>
                <h4>說明</h4>
                <TranslateBar t={t} hasText />
                <div className="desc">{t.active ? t.tr.desc : d.description}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
