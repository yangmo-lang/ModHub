import React, { useEffect, useState } from 'react';
import { api, errText } from './common.jsx';

const STATE = { ok: '✓ 免確認', outdated: '需要更新（設定改過）', missing: '未設定', unknown: '?' };

/** 設定 →「免確認啟動」：用工作排程以最高權限執行 XXMI Launcher / OneDragon / MaaEnd，之後啟動不再跳 UAC */
export default function ElevatedSettings({ compact = false }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const refresh = () => api.elevStatus().then(setSt).catch((e) => setMsg(errText(e)));
  useEffect(() => { refresh(); }, []);
  const act = async (fn, done) => {
    setBusy(true);
    setMsg('');
    try { setSt(await fn()); setMsg(done); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  if (!st) return compact ? null : <div className="update-settings"><b>免確認啟動</b><span className="card-meta">讀取工作排程中…</span></div>;
  const pending = st.items.filter((i) => i.state !== 'ok');
  if (compact) {
    // 自動每日頁面：只在還沒設定或需要更新時提示
    if (!pending.length && !st.extra.length) return <span className="card-meta">✓ 已設定免確認啟動，啟動時不會跳出系統管理員權限詢問</span>;
    return (
      <div className="row">
        <span className="card-meta">{st.any ? '免確認啟動需要更新（設定改過），更新前啟動仍會跳出系統管理員權限詢問' : '每次啟動都會跳出系統管理員權限詢問；可以設定免確認啟動'}</span>
        <button className="btn small" disabled={busy || !st.items.length} onClick={() => act(api.elevSetup, '已設定免確認啟動')}>{busy ? '設定中…' : st.any ? '更新' : '設定免確認啟動'}</button>
        {msg && <span className="card-meta">{msg}</span>}
      </div>
    );
  }
  return (
    <div className="update-settings">
      <b>免確認啟動</b>
      <span className="card-meta">
        XXMI Launcher、OneDragon、MaaEnd 需要系統管理員權限，每次啟動都會跳出詢問。設定後 ModHub 會在 Windows「工作排程器」的 \ModHub\ 資料夾
        建立以最高權限執行的工作（只有手動執行、沒有排程時間），之後 ModHub 透過工作排程啟動，不再詢問。設定與移除各需要按一次「是」。
      </span>
      <span className="card-meta">
        注意：之後這些程式不經確認就會以系統管理員權限執行；若電腦上的其他程式換掉了這些 exe，也會被以系統管理員權限執行。
        只透過 XXMI 載入 MOD 並啟動遊戲（▶ 啟動）會用到；「XXMI」按鈕（開啟視窗）仍然照常詢問。
      </span>
      {st.error && <div className="error-text">{st.error}</div>}
      {st.entryError && <div className="error-text">{st.entryError}</div>}
      {st.items.length === 0
        ? <span className="card-meta">找不到 XXMI Launcher、OneDragon 或 MaaEnd，沒有可以設定的程式。</span>
        : (
          <ul className="elev-list">
            {st.items.map((i) => (
              <li key={i.name}>
                <span>{i.label}</span>
                <span className={`card-meta elev-${i.state}`}>{STATE[i.state] || i.state}</span>
              </li>
            ))}
            {st.extra.map((n) => <li key={n}><span>{n}</span><span className="card-meta">已不需要，更新時移除</span></li>)}
          </ul>
        )}
      <div className="row">
        {st.items.length > 0 && (pending.length > 0 || st.extra.length > 0) && (
          <button className="btn small" disabled={busy} onClick={() => act(api.elevSetup, '已設定免確認啟動')}>{busy ? '設定中…' : st.any ? '更新' : '設定免確認啟動'}</button>
        )}
        {st.any && <button className="link danger" disabled={busy} onClick={() => act(api.elevRemove, '已移除免確認啟動，之後啟動會照常詢問')}>移除</button>}
        <button className="link" disabled={busy} onClick={() => { setMsg(''); refresh(); }}>重新檢查</button>
      </div>
      <span className="card-meta">OneDragon 的跑完動作、帳號實例，或 MaaEnd 的實例改了之後要按「更新」；更新前會改回跳出詢問的方式啟動。</span>
      {msg && <div className="card-meta">{msg}</div>}
    </div>
  );
}
