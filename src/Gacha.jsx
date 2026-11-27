import React, { useEffect, useMemo, useState } from 'react';

const api = window.modhub;
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const fmtTime = (t) => (t ? new Date(t).toLocaleString() : '');
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString() : '');
const PAGE = 100;

const GAME_TEXT = {
  EFMI: { page: '尋訪紀錄', where: '遊戲內「尋訪」頁面 →「尋訪紀錄」', top: '6★', mid: '5★', low: '4★' },
  ZZMI: { page: '調頻紀錄', where: '遊戲內「調頻」→「調頻紀錄」', top: 'S', mid: 'A', low: 'B' },
};

function rarityText(gameId, r) {
  if (gameId === 'ZZMI') return r.rarityLabel || ({ 4: 'S', 3: 'A', 2: 'B' }[r.rarity] || '');
  return r.rarity ? `${r.rarity}★` : '';
}

function luckClass(pity, max) {
  if (!pity) return 'free';
  const ratio = pity / (max || 80);
  return ratio <= 0.4 ? 'good' : ratio <= 0.8 ? 'mid' : 'bad';
}

export default function Gacha({ gameId, gameName, showToast }) {
  const [supported, setSupported] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [pasting, setPasting] = useState(false);
  const [poolFilter, setPoolFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [page, setPage] = useState(0);
  const T = GAME_TEXT[gameId];

  useEffect(() => { api.gachaSupported().then(setSupported); }, []);
  useEffect(() => api.onGachaProgress((p) => p.gameId === gameId && setProgress(p)), [gameId]);

  const loadAccounts = async (preferId) => {
    const list = await api.gachaAccounts(gameId);
    setAccounts(list);
    const id = preferId || list[0]?.id || '';
    setAccountId(id);
    setData(id ? await api.gachaGet(gameId, id) : null);
  };

  useEffect(() => {
    setData(null); setAccounts([]); setAccountId(''); setError(''); setPoolFilter(''); setTierFilter(''); setPage(0);
    if (GAME_TEXT[gameId]) loadAccounts();
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (url) => {
    setBusy(true);
    setError('');
    setProgress({ stage: '讀取連結' });
    try {
      const r = await api.gachaUpdate(gameId, url ? { url } : {});
      showToast(r.added ? `新增 ${r.added} 筆紀錄` : '已是最新，沒有新紀錄');
      await loadAccounts(r.account.id);
      setPasting(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const switchAccount = async (id) => {
    setAccountId(id);
    setData(await api.gachaGet(gameId, id));
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    return [...data.records].reverse().filter((r) => (!poolFilter || r.pool === poolFilter) && (!tierFilter || r.tier === tierFilter));
  }, [data, poolFilter, tierFilter]);
  useEffect(() => setPage(0), [poolFilter, tierFilter, data]);

  if (supported && !supported.includes(gameId)) {
    return <div className="gacha"><div className="empty">{gameName}的抽卡紀錄還不支援（目前支援終末地、絕區零）</div></div>;
  }
  if (!T) return null;
  const s = data?.summary;

  return (
    <div className="gacha">
      <header className="toolbar">
        {accounts.length > 0 && (
          <select className="sel" value={accountId} onChange={(e) => switchAccount(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.uid || a.id}{a.server ? ` · ${a.server}` : ''}（{a.count} 筆）</option>)}
          </select>
        )}
        <button className="btn primary" onClick={() => update()} disabled={busy}>{busy ? '更新中…' : '↻ 從遊戲更新'}</button>
        <button className="btn" onClick={() => setPasting(true)} disabled={busy}>貼上網址</button>
        <div className="spacer" />
        {progress && <span className="codex-src">{progress.stage}{progress.count != null ? ` · 已讀 ${progress.count} 筆` : ''}</span>}
        {data && <span className="codex-src">更新於 {fmtTime(data.updatedAt)}</span>}
        <button className="btn" onClick={async () => { try { const v = await api.gachaImport(gameId); if (v) { showToast('已匯入'); loadAccounts(v.account.id); } } catch (e) { showToast(errText(e), 'error'); } }}>匯入</button>
        {data && <button className="btn" onClick={async () => { const p = await api.gachaExport(gameId, accountId); if (p) showToast(`已匯出到 ${p}`); }}>匯出</button>}
        {gameId === 'ZZMI' && <button className="btn" onClick={() => api.gachaOfficial(gameId)} title="HoYoLAB 官方調頻紀錄（需登入 HoYoLAB）">官方頁面</button>}
      </header>

      <div className="gacha-body">
        {error && (
          <div className="warn-box big">
            {error}
            <div className="steps">
              <b>怎麼取得：</b>開啟{gameName} → {T.where}，等頁面載入後回到 ModHub 按「從遊戲更新」。連結有效時間很短，請開完馬上更新。
            </div>
          </div>
        )}

        {!data && !error && (
          <div className="gacha-intro">
            <h3>{gameName}{T.page}</h3>
            <ol>
              <li>開啟遊戲，進入 {T.where}，等紀錄頁面載入完成。</li>
              <li>回到 ModHub 按「↻ 從遊戲更新」。ModHub 會從遊戲的{gameId === 'EFMI' ? '日誌' : '網頁快取'}讀取臨時連結，下載所有紀錄。</li>
              <li>之後每次更新只會下載新的紀錄；紀錄存在本機，連結本身不會被保存。</li>
            </ol>
            <p className="card-meta">讀不到的話，也可以用「貼上網址」貼入含 {gameId === 'EFMI' ? 'u8_token' : 'authkey'} 的紀錄網址。</p>
          </div>
        )}

        {s && (
          <>
            <div className="gacha-overview">
              <div><b>{s.total.toLocaleString()}</b><small>總抽數</small></div>
              <div><b>{s.tops}</b><small>{T.top} 數量</small></div>
              <div><b>{s.tops ? Math.round(s.total / s.tops) : '—'}</b><small>平均每個 {T.top}（含所有池）</small></div>
              <div><b>{fmtDate(s.first)} – {fmtDate(s.last)}</b><small>紀錄期間</small></div>
            </div>

            <div className="pool-cards">
              {s.pools.map((p) => (
                <div key={p.pool} className="pool-card">
                  <div className="pc-head">
                    <b>{p.label}</b>
                    <span>{p.total} 抽{p.free ? `（含免費 ${p.free}）` : ''}</span>
                  </div>
                  {p.pityMax && (
                    <div className="pity">
                      <div className="pity-label"><span>距上次 {T.top}</span><b>{p.pity} / {p.pityMax}</b></div>
                      <div className="bar"><span style={{ width: `${Math.min(100, (p.pity / p.pityMax) * 100)}%` }} /></div>
                    </div>
                  )}
                  {p.banner && (
                    <div className="pity">
                      <div className="pity-label"><span>本期 {p.banner.name || ''} 付費抽數（大保底）</span><b>{p.banner.paid} / {p.banner.max}</b></div>
                      <div className="bar alt"><span style={{ width: `${Math.min(100, (p.banner.paid / p.banner.max) * 100)}%` }} /></div>
                    </div>
                  )}
                  <div className="pc-counts">
                    <span className="t-top">{T.top} {p.counts.top}</span>
                    <span className="t-mid">{T.mid} {p.counts.mid}</span>
                    <span className="t-low">{T.low} {p.counts.low}</span>
                    {p.avgTopPity != null && <span>平均 {p.avgTopPity} 抽出 {T.top}</span>}
                  </div>
                  {p.tops.length > 0 && (
                    <div className="tops">
                      {p.tops.map((t) => (
                        <span key={t.id} className={`top-chip ${luckClass(t.pity, p.pityMax)}`} title={`${fmtTime(t.time)}${t.bannerName ? ` · ${t.bannerName}` : ''}${t.free ? ' · 免費抽' : ''}`}>
                          {t.name}<b>{t.free ? '免費' : t.pity}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="records">
              <div className="records-bar">
                <b>全部紀錄</b>
                <select className="sel" value={poolFilter} onChange={(e) => setPoolFilter(e.target.value)}>
                  <option value="">全部卡池</option>
                  {s.pools.map((p) => <option key={p.pool} value={p.pool}>{p.label}</option>)}
                </select>
                <select className="sel" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
                  <option value="">全部稀有度</option>
                  <option value="top">{T.top}</option>
                  <option value="mid">{T.mid}</option>
                  <option value="low">{T.low}</option>
                </select>
                <span className="card-meta">{filtered.length} 筆</span>
              </div>
              <table className="rec-table">
                <thead><tr><th>時間</th><th>名稱</th><th>稀有度</th><th>卡池</th></tr></thead>
                <tbody>
                  {filtered.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                    <tr key={r.id} className={`tier-${r.tier}`}>
                      <td>{r.timeText || fmtTime(r.time)}</td>
                      <td>{r.name}{r.free ? <span className="badge manual">免費</span> : null}{r.gift ? <span className="badge up">獎勵</span> : null}</td>
                      <td>{rarityText(gameId, r)}</td>
                      <td>{r.bannerName || r.poolName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > PAGE && (
                <div className="row pager">
                  <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>上一頁</button>
                  <span className="card-meta">{page + 1} / {Math.ceil(filtered.length / PAGE)}</span>
                  <button className="btn small" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>下一頁</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {pasting && <PasteDialog gameId={gameId} busy={busy} onClose={() => setPasting(false)} onSubmit={update} error={error} />}
    </div>
  );
}

function PasteDialog({ gameId, busy, onClose, onSubmit, error }) {
  const [url, setUrl] = useState('');
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>貼上紀錄網址</h3>
        <p className="card-meta">
          {gameId === 'EFMI'
            ? '貼上 https://ef-webview.…/page/gacha_char?…&u8_token=… 這種網址。'
            : '貼上含 authkey=… 的調頻紀錄網址（auth_appid=webview_gacha）。'}
          網址只用來這次下載，不會被保存。請勿把網址分享給別人。
        </p>
        <textarea className="paste" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        {error && <div className="error-text">{error}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy || !url.trim()} onClick={() => onSubmit(url.trim())}>{busy ? '下載中…' : '下載紀錄'}</button>
        </div>
      </div>
    </div>
  );
}
