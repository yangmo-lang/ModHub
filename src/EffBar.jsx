import React, { useEffect, useState } from 'react';
import { api, errText } from './common.jsx';
import { fmtSize } from './Online.jsx';

/** 版本比較：'2.0.18' > '2.0.17' */
function newer(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

const STEP = { downloading: '下載中', verifying: '比對 SHA-256', extracting: '解壓中', installing: '安裝中' };

/** 終末地 EFF：框架狀態、最新版、一鍵安裝 / 更新 */
export default function EffBar({ eff, showToast, onChanged, onSettings }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const load = (force) => api.effStatus({ checkLatest: true, force }).then(setInfo).catch(() => {});
  useEffect(() => { load(false); }, [eff?.version, eff?.installed]);
  useEffect(() => api.onEffProgress(setProgress), []);

  const st = info || eff;
  if (!st) return null;
  const latest = info?.latest;
  const canUpdate = st.installed && latest && newer(latest.version, st.version);

  const install = async () => {
    setBusy(true);
    try {
      const r = await api.effInstallFramework();
      if (!r.cancelled) {
        showToast(`已${st.installed ? '更新' : '安裝'} EFF v${r.installedVersion}${r.backedUp ? `（舊檔已備份 ${r.backedUp} 個）` : ''}，下次啟動遊戲生效`);
        setInfo(r);
        onChanged?.();
      }
    } catch (e) {
      showToast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eff-bar">
      {!st.gameFound ? (
        <span>找不到終末地的遊戲資料夾{st.gameDir ? `：${st.gameDir}` : ''}</span>
      ) : st.installed ? (
        <span>EFF <b>v{st.version || '?'}</b> 已安裝
          {latest && (canUpdate ? <span className="eff-new">　有新版 v{latest.version}</span> : <span className="muted">　已是最新</span>)}
        </span>
      ) : (
        <span>這個遊戲資料夾還沒安裝 EFF{latest ? `（最新 v${latest.version}）` : ''}</span>
      )}
      {progress && (
        <span className="muted">
          {STEP[progress.step] || progress.step}
          {progress.step === 'downloading' && progress.total ? ` ${Math.round(((progress.received || 0) / progress.total) * 100)}%（${fmtSize(progress.total)}）` : '…'}
        </span>
      )}
      <div className="spacer" />
      {!st.gameFound && <button className="btn small" onClick={onSettings}>設定遊戲資料夾</button>}
      {st.gameFound && (!st.installed || canUpdate) && (
        <button className="btn small primary" disabled={busy || !latest} onClick={install}
          title="從 GitHub 下載 EFF 的 DLL 套件並放進遊戲資料夾（會先詢問）">
          {busy ? '處理中…' : st.installed ? `更新到 v${latest?.version}` : '安裝 EFF'}
        </button>
      )}
      {st.gameFound && st.installed && !canUpdate && latest && (
        <button className="link" disabled={busy} onClick={() => load(true)} title="重新檢查 GitHub 上的最新版">檢查更新</button>
      )}
      {info?.latestError && !latest && <span className="error-text">讀不到最新版：{info.latestError}</span>}
      <button className="link" onClick={() => api.openExternal(st.pages?.github || 'https://github.com/ssice-a/EFF')}>EFF 說明</button>
      <button className="link" onClick={() => api.openExternal(st.pages?.gamebanana || 'https://gamebanana.com/tools/24565')}>GameBanana</button>
    </div>
  );
}
