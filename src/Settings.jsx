import React, { useEffect, useState } from 'react';
import { api, errText } from './common.jsx';

function NexusSettings() {
  const [st, setSt] = useState(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => api.nexusStatus().then(setSt);
  useEffect(() => { refresh(); }, []);
  const run = async (fn) => {
    setBusy(true);
    setMsg('');
    try { await fn(); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); refresh(); }
  };
  if (!st) return null;
  return (
    <div className="nexus-settings">
      <div className="ns-title">Nexus Mods</div>
      {st.hasKey ? (
        <div className="row">
          <span className="ns-status">已連結：{st.user || '（未知）'} · {st.premium ? 'Premium（可直接下載）' : '免費會員（需從網頁按 Mod Manager Download）'}</span>
          <button className="btn" disabled={busy} onClick={() => run(() => api.nexusClearKey())}>移除金鑰</button>
        </div>
      ) : (
        <>
          <div className="row">
            <input type="password" placeholder="貼上你的 Nexus API 金鑰" value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn primary" disabled={busy || !key.trim()} onClick={() => run(async () => { await api.nexusSetKey(key); setKey(''); })}>驗證並儲存</button>
          </div>
          <small>到 Nexus 帳號的 API Keys 頁面取得個人金鑰（<button className="link" onClick={() => api.openExternal('https://next.nexusmods.com/settings/api-keys')}>開啟</button>）。金鑰會用 Windows 加密存在本機。</small>
        </>
      )}
      <div className="row">
        <span className="ns-status">nxm:// 連結：{st.nxmRegistered ? '由 ModHub 處理' : '未設定'}</span>
        <button className="btn" disabled={busy} onClick={() => run(() => (st.nxmRegistered ? api.nxmUnregister() : api.nxmRegister()))}>
          {st.nxmRegistered ? '取消處理' : '讓 ModHub 處理 nxm:// 連結'}
        </button>
      </div>
      <small>免費會員在 Nexus 網頁按「Mod Manager Download」時，會用 nxm:// 連結交給 ModHub 下載。開啟後會取代 Vortex / MO2 的同一設定。</small>
      {msg && <div className="error-text">{msg}</div>}
    </div>
  );
}

// KeyboardEvent → Electron accelerator 的按鍵名稱
function keyName(e) {
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F\d{1,2}$/.test(c)) return c;
  if (/^Numpad\d$/.test(c)) return `num${c.slice(6)}`;
  const map = {
    Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Enter: 'Enter',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[',
    BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  };
  return map[c] || null;
}

/** 遊戲內疊加介面的快捷鍵：點輸入框後直接按組合鍵 */
function OverlaySettings() {
  const [info, setInfo] = useState(null);
  const [recording, setRecording] = useState(false);
  const [err, setErr] = useState('');
  const refresh = () => api.overlayGetHotkey().then((h) => { setInfo(h); if (h.error) setErr(h.error); }).catch(() => {});
  useEffect(() => { refresh(); }, []);
  useEffect(() => () => { api.overlaySuspend(false); }, []);

  const apply = async (key) => {
    setErr('');
    try { await api.overlaySetHotkey(key); } catch (e) { setErr(errText(e)); }
    setRecording(false);
    refresh();
  };
  const start = () => { setErr(''); setRecording(true); api.overlaySuspend(true); };
  const stop = () => { setRecording(false); api.overlaySuspend(false); };
  const onKeyDown = (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.shiftKey) { stop(); return; }
    const k = keyName(e);
    if (!k) return; // 只按了修飾鍵，繼續等
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    apply([...mods, k].join('+'));
  };

  if (!info) return null;
  return (
    <div className="update-settings">
      <b>遊戲內疊加介面</b>
      <span className="card-meta">在遊戲中按快捷鍵叫出 MOD 開關面板（遊戲需為視窗化或無邊框全螢幕）</span>
      <div className="row">
        <input
          className={`hotkey-input ${recording ? 'recording' : ''}`}
          readOnly
          value={recording ? '請按下組合鍵…（Esc 取消）' : info.hotkey || '（已停用）'}
          onClick={start}
          onBlur={() => recording && stop()}
          onKeyDown={onKeyDown}
          title="點一下後按下新的組合鍵"
        />
        <button className="btn small" onClick={() => apply(info.default)} disabled={info.hotkey === info.default}>恢復預設（{info.default}）</button>
        <button className="btn small" onClick={() => apply('')} disabled={!info.hotkey}>停用</button>
      </div>
      {err && <div className="error-text">{err}</div>}
    </div>
  );
}

export default function Settings({ settings, onClose, onSave }) {
  const [xxmiRoot, setXxmiRoot] = useState(settings.xxmiRoot);
  const [qaqRoot, setQaqRoot] = useState(settings.qaqRoot);
  const [trayOnMinimize, setTrayOnMinimize] = useState(settings.trayOnMinimize ?? true);
  const [trayOnClose, setTrayOnClose] = useState(settings.trayOnClose ?? true);
  const [effGameDir, setEffGameDir] = useState(settings.effGameDir || '');
  const [effAuto, setEffAuto] = useState('');
  useEffect(() => { api.effStatus().then((s) => setEffAuto(settings.effGameDir ? '' : s.gameDir || '')).catch(() => {}); }, [settings.effGameDir]);
  const pick = async (set) => {
    const p = await api.pickFolder();
    if (p) set(p);
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>設定</h3>
        <label>XXMI Launcher 資料夾
          <div className="row"><input value={xxmiRoot} onChange={(e) => setXxmiRoot(e.target.value)} /><button className="btn" onClick={() => pick(setXxmiRoot)}>瀏覽</button></div>
        </label>
        <label>QAQ Manager 安裝資料夾（選填，用來辨識角色分類）
          <div className="row"><input value={qaqRoot} onChange={(e) => setQaqRoot(e.target.value)} /><button className="btn" onClick={() => pick(setQaqRoot)}>瀏覽</button></div>
        </label>
        <label>終末地遊戲資料夾（EFF 用，Endfield.exe 所在處；留空 = 使用 XXMI 的設定）
          <div className="row">
            <input value={effGameDir} placeholder={effAuto ? `自動：${effAuto}` : '例如 D:\\Hypergryph Launcher\\games\\Endfield Game'} onChange={(e) => setEffGameDir(e.target.value)} />
            <button className="btn" onClick={() => pick(setEffGameDir)}>瀏覽</button>
          </div>
        </label>
        <OverlaySettings />
        <div className="update-settings">
          <b>系統匣</b>
          <label className="check"><input type="checkbox" checked={trayOnMinimize} onChange={(e) => setTrayOnMinimize(e.target.checked)} />最小化時縮到系統匣</label>
          <label className="check"><input type="checkbox" checked={trayOnClose} onChange={(e) => setTrayOnClose(e.target.checked)} />按 ✕ 關閉時縮到系統匣（右鍵系統匣圖示 →「結束 ModHub」才會真的結束）</label>
          <span className="card-meta">縮到系統匣時，遊戲內面板的快捷鍵仍然有效</span>
        </div>
        <div className="update-settings"><b>絕區零一條龍（自動每日）</b><span className="card-meta">設定移到主畫面：選絕區零 →「自動每日」分頁。</span></div>
        <NexusSettings />
        <UpdateSettings />
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={() => onSave({ xxmiRoot, qaqRoot, trayOnMinimize, trayOnClose, effGameDir: effGameDir.trim() })}>儲存</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 自動更新 ----------------
export function useUpdate() {
  const [s, setS] = useState(null);
  useEffect(() => {
    api.updateState().then(setS).catch(() => {});
    return api.onUpdateStatus(setS);
  }, []);
  return s;
}

/** 有新版時畫面右下角的提示 */
export function UpdateBar({ update, onHide }) {
  if (!update || !['available', 'downloading', 'downloaded'].includes(update.status)) return null;
  const portable = update.mode === 'portable';
  return (
    <div className="update-bar">
      {update.status === 'available' && (
        <>
          <span>ModHub 有新版本 <b>v{update.latest}</b>（目前 v{update.version}）</span>
          <button className="btn small primary" onClick={() => api.updateDownload()}>{portable ? '到下載頁面' : '下載更新'}</button>
          <button className="link" onClick={onHide}>稍後</button>
        </>
      )}
      {update.status === 'downloading' && <span>正在下載 v{update.latest}… {update.percent || 0}%</span>}
      {update.status === 'downloaded' && (
        <>
          <span>v{update.latest} 已下載完成</span>
          <button className="btn small primary" onClick={() => api.updateInstall()}>重新啟動並更新</button>
          <button className="link" onClick={onHide} title="下次關閉 ModHub 時自動安裝">稍後</button>
        </>
      )}
    </div>
  );
}

const UPDATE_TEXT = {
  idle: '', checking: '檢查中…', latest: '已是最新版本', dev: '開發模式不檢查更新',
  available: '有新版本', downloading: '下載中…', downloaded: '已下載，重新啟動即可更新', error: '檢查失敗',
};

/** 設定視窗裡的版本與「檢查更新」 */
function UpdateSettings() {
  const s = useUpdate();
  // 打開設定時，上次檢查太舊就自動重查（例如開著很久，期間有新版發布）
  useEffect(() => { api.updateCheckIfStale().catch(() => {}); }, []);
  if (!s) return null;
  const checked = s.checkedAt ? new Date(s.checkedAt) : null;
  const checkedText = checked
    ? (checked.toDateString() === new Date().toDateString()
      ? checked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : checked.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
    : '';
  return (
    <div className="update-settings">
      <b>版本</b>
      <span>ModHub v{s.version}{s.mode === 'portable' ? '（免安裝版：有新版時請到下載頁面更新）' : s.mode === 'dev' ? '（開發模式）' : ''}</span>
      <span className="card-meta">
        {UPDATE_TEXT[s.status] || ''}
        {s.latest && s.status !== 'latest' ? ` v${s.latest}` : ''}
        {s.status === 'latest' && s.latest ? `（GitHub 最新為 v${s.latest}）` : ''}
        {s.status === 'downloading' ? ` ${s.percent || 0}%` : ''}
        {s.status === 'error' && s.error ? `：${s.error}` : ''}
        {checkedText && s.status !== 'checking' ? ` · 上次檢查 ${checkedText}` : ''}
      </span>
      <div className="row">
        <button className="btn small" disabled={s.mode === 'dev' || s.status === 'checking' || s.status === 'downloading'} onClick={() => api.updateCheck()}>檢查更新</button>
        {s.status === 'available' && <button className="btn small primary" onClick={() => api.updateDownload()}>{s.mode === 'portable' ? '到下載頁面' : '下載更新'}</button>}
        {s.status === 'downloaded' && <button className="btn small primary" onClick={() => api.updateInstall()}>重新啟動並更新</button>}
        <button className="link" onClick={() => api.updateOpenReleases()}>更新紀錄</button>
      </div>
    </div>
  );
}
