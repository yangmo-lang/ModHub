import React, { useEffect, useState } from 'react';

const api = window.modhub;
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const fmtFull = (t) => (t ? new Date(t).toLocaleString() : '');
const SERVER_KEY = 'modhub.blueprint.server';

/** 終末地 AIC 藍圖：執行時讀取「終末地一圖流」的公開資料，ModHub 不內建內容 */
export default function Blueprint({ showToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState(() => localStorage.getItem(SERVER_KEY) || 'cn');
  const [copied, setCopied] = useState('');

  const load = async (force) => {
    setBusy(true);
    setError('');
    try { setData(await api.blueprintGet(force)); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  useEffect(() => { load(false); }, []);

  const pick = (k) => { setServer(k); localStorage.setItem(SERVER_KEY, k); };
  const copy = async (code, label) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      showToast(`已複製「${label}」的藍圖碼`);
      setTimeout(() => setCopied((c) => (c === code ? '' : c)), 1500);
    } catch (e) { showToast(`複製失敗：${errText(e)}`, 'error'); }
  };

  const region = data?.regions.find((r) => r.key === server) || data?.regions[0];
  const src = data?.source;

  return (
    <div className="blueprint">
      <header className="toolbar">
        {data && (
          <div className="seg">
            {data.regions.map((r) => (
              <button key={r.key} className={r.key === region?.key ? 'active' : ''} onClick={() => pick(r.key)}>
                {r.title.replace(/藍圖碼$/, '')}
              </button>
            ))}
          </div>
        )}
        <div className="spacer" />
        {data && <span className="codex-src">更新於 {fmtFull(data.fetchedAt)}{data.stale ? '（離線，顯示上次的資料）' : ''}</span>}
        <button className="btn" onClick={() => load(true)} disabled={busy}>{busy ? '讀取中…' : '↻ 更新'}</button>
        <button className="btn" onClick={() => api.openExternal(src?.page || 'https://ef.yituliu.cn/aic/blueprint')}>原網頁</button>
      </header>

      <div className="blueprint-body">
        {error && <div className="warn-box">{error}</div>}
        {data?.stale && data.error && (
          <div className="warn-box">讀不到最新的藍圖（{data.error}），先顯示 {fmtFull(data.fetchedAt)} 的資料。最新內容請按「原網頁」查看。</div>
        )}
        {data?.source?.relocated && (
          <div className="card-meta">一圖流的藍圖原始檔已搬到 <code>{data.source.file.replace(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\//, '')}</code>，ModHub 已自動改讀新位置。</div>
        )}
        {!data && !error && <div className="empty">讀取藍圖中…</div>}

        {data && (
          <>
            <h2 className="bp-title">{data.title || '終末地 AIC 藍圖'}</h2>
            <p className="card-meta">在遊戲內 AIC 的藍圖介面貼上藍圖碼即可匯入。請選擇你的伺服器：國服、亞服、歐美服的藍圖碼不通用。</p>

            {region && (
              <div className="bp-list">
                {region.entries.map((e, i) => (e.type === 'section'
                  ? <h3 key={i} className="bp-section">{e.title}</h3>
                  : (
                    <div key={i} className="bp-item">
                      <span className="bp-label">{e.label}</span>
                      <code className="bp-code">{e.code}</code>
                      <button className={`btn small ${copied === e.code ? 'primary' : ''}`} onClick={() => copy(e.code, e.label)}>{copied === e.code ? '已複製' : '複製'}</button>
                    </div>
                  )))}
              </div>
            )}

            {data.videos?.length > 0 && (
              <>
                <h3 className="bp-section">教學影片</h3>
                <div className="bp-links">
                  {data.videos.map((u) => <button key={u} className="link" onClick={() => api.openExternal(u)}>{u.replace(/^https:\/\/(www\.)?/, '')}</button>)}
                </div>
              </>
            )}

            {data.images?.length > 0 && (
              <>
                <h3 className="bp-section">基地一圖流</h3>
                <div className="bp-images">
                  {data.images.map((u) => (
                    <button key={u} className="bp-img" onClick={() => api.openExternal(u)} title="在瀏覽器開啟原圖">
                      <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="bp-credit">
              資料來源：<button className="link" onClick={() => api.openExternal(src.page)}>終末地一圖流（ef.yituliu.cn/aic/blueprint）</button>，
              依 <button className="link" onClick={() => api.openExternal(src.license.url)}>{src.license.name}</button> 授權，禁止商業使用。
              ModHub 不內建這些內容，只在執行時讀取一圖流公開的
              <button className="link" onClick={() => api.openExternal(src.repo)}>原始碼頁面</button>
              並顯示；變更：標題與名稱轉為繁體中文，藍圖碼未修改。遊戲相關內容版權屬上海鷹角網路。
            </div>
          </>
        )}
      </div>
    </div>
  );
}
