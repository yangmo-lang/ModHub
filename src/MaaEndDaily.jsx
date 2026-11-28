import React, { useEffect, useState } from 'react';
import { api, errText } from './common.jsx';
import ElevatedSettings from './Elevated.jsx';
import MaaEndTasks from './MaaEndTasks.jsx';

// MaaEnd「啟動遊戲」前置任務的伺服器（名稱與 MaaEnd 的繁中介面相同）
const REGION_LABEL = { CN: '國服（官方啟動器）', Global: '國際服（官方啟動器）', Bilibili: 'B服', TapTap: 'TapTap', Steam: 'Steam', Epic: 'Epic' };

const STAGE = { launching: '透過 XXMI 開遊戲…', waiting: '等遊戲開好…', maaend: '啟動 MaaEnd…' };

/** 主畫面「終末地 → 自動每日」：第三方工具 MaaEnd 的資料夾、要執行的實例、定時；任務清單只讀（在 MaaEnd 裡設定） */
export default function MaaEndDaily({ showToast }) {
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [stage, setStage] = useState(null);
  const [running, setRunning] = useState(false);
  const refresh = () => api.meStatus().then(setSt).catch((e) => setMsg(errText(e)));
  useEffect(() => {
    refresh();
    const offP = api.onMeProgress(setProgress);
    const offS = api.onMeStage((s) => setStage(s?.stage || null));
    // 切回這個分頁時重讀（使用者可能剛在 MaaEnd 裡改了實例或任務）
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { offP(); offS(); window.removeEventListener('focus', onFocus); };
  }, []);
  if (!st) return null;
  const save = async (patch) => {
    setSt((s) => ({ ...s, ...patch }));
    await api.saveSettings(patch);
    refresh();
  };
  const run = async () => {
    setRunning(true);
    try { await api.meRun(); } catch { /* 錯誤由主視窗的 me:error 提示 */ } finally { setTimeout(() => setRunning(false), 3000); }
  };
  const download = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api.meDownloadPackage();
      if (!r.cancelled) setMsg(`已下載到 ${r.path}。請自己解壓縮到想放的資料夾（例如 C:\\MaaEnd），打開 MaaEnd 設定好任務，再回來選資料夾。`);
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const inst = st.instances.find((i) => i.name === st.instance);
  return (
    <div className="autodaily">
      <header className="toolbar">
        <b className="ad-title">自動每日（MaaEnd）</b>
        <div className="spacer" />
        {stage && <span className="card-meta">{STAGE[stage] || stage}</span>}
        <button className="btn primary" disabled={!st.found || !st.instance || running || Boolean(stage)} onClick={run}>{running || stage ? '啟動中…' : '▶ 執行 MaaEnd'}</button>
      </header>
      <div className="ad-body">
        <div className="update-settings od-settings">
          <b>終末地小助手（MaaEnd）</b>
          <span className="card-meta">
            由第三方工具 <button className="link" onClick={() => api.openExternal(st.pages.github)}>MaaEnd</button>（AGPL-3.0）執行；
            ModHub 只負責啟動（<code>MaaEnd.exe --autostart -i 實例</code>）並讀取它的設定。它會模擬操作遊戲，可能違反遊戲條款，風險自負。
            在遊戲內面板（Alt+N）選終末地就有「MaaEnd」按鈕。
          </span>
          <div className="row">
            <input value={st.meRoot} placeholder={st.found ? `自動找到：${st.found}` : 'MaaEnd 資料夾（含 MaaEnd.exe）'} onChange={(e) => setSt({ ...st, meRoot: e.target.value })} onBlur={() => save({ meRoot: st.meRoot.trim() })} />
            <button className="btn" onClick={async () => { const p = await api.pickFolder(); if (p) save({ meRoot: p }); }}>瀏覽</button>
          </div>
          {st.found
            ? <span className="card-meta">✓ {st.exe}</span>
            : (
              <div className="row">
                <span className="card-meta">{st.configuredButMissing ? '這個資料夾裡找不到 MaaEnd.exe' : '還沒找到 MaaEnd'}</span>
                <button className="btn small" disabled={busy} onClick={download}>{busy ? (progress?.total ? `下載中 ${Math.round((progress.received / progress.total) * 100)}%` : '下載中…') : '下載官方 Windows 版'}</button>
                <button className="link" onClick={() => api.openExternal(st.pages.home)}>官方網站</button>
              </div>
            )}
          {st.found && (
            <div className="row">
              <label className="inline">執行實例
                <select className="sel" value={st.instance} disabled={!st.instances.length} onChange={(e) => save({ meInstance: e.target.value })}>
                  {!st.instances.length && <option value="">（沒有實例）</option>}
                  {st.instances.map((i) => <option key={i.id || i.name} value={i.name}>{i.name}{i.name === st.defaultName ? '（MaaEnd 的自動執行實例）' : ''}</option>)}
                </select>
              </label>
              <label className="inline">開遊戲
                <select className="sel" value={st.meLaunchVia} onChange={(e) => save({ meLaunchVia: e.target.value })} title="選 XXMI 時 ModHub 先透過 XXMI 開終末地（會載入 MOD），遊戲開好後才啟動 MaaEnd">
                  <option value="xxmi">ModHub 先透過 XXMI 開（載入 MOD）</option>
                  <option value="maaend">交給 MaaEnd（實例裡的「啟動遊戲」）</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={Boolean(st.meQuit)} onChange={(e) => save({ meQuit: e.target.checked })} />跑完關閉 MaaEnd</label>
            </div>
          )}
          {st.found && st.meLaunchVia === 'maaend' && st.launch && (
            <div className="row">
              <label className="inline">伺服器
                <select className="sel" value={st.meRegion || ''} onChange={(e) => save({ meRegion: e.target.value })}>
                  <option value="">自動{st.launch.guess ? `（判斷為 ${REGION_LABEL[st.launch.guess]}）` : st.launch.pretask?.region ? `（沿用 MaaEnd：${REGION_LABEL[st.launch.pretask.region] || st.launch.pretask.region}）` : '（判斷不出來）'}</option>
                  {Object.entries(REGION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <span className="card-meta">
                執行時 ModHub 會打開「{st.instance}」的「啟動遊戲」前置任務，伺服器設為 {REGION_LABEL[st.launch.region] || '（不變）'}
                {st.launch.pretask && (!st.launch.pretask.enabled || (st.launch.region && st.launch.pretask.region !== st.launch.region))
                  ? `（目前 MaaEnd 裡是${st.launch.pretask.enabled ? '' : '關閉、'}${REGION_LABEL[st.launch.pretask.region] || st.launch.pretask.region || '未設定'}）` : ''}
                。自動判斷依終末地資料夾：{st.launch.gameDir || '（找不到，請到「設定」確認 XXMI 或終末地遊戲資料夾）'}
              </span>
            </div>
          )}
          <div className="row">
            <label className="check"><input type="checkbox" checked={Boolean(st.meScheduleEnabled)} onChange={(e) => save({ meScheduleEnabled: e.target.checked })} />每天定時執行</label>
            <input type="time" className="od-time" value={st.meScheduleTime} disabled={!st.meScheduleEnabled} onChange={(e) => save({ meScheduleTime: e.target.value })} />
            <span className="card-meta">ModHub 開著時（含縮在系統匣）到時間啟動一次；超過 30 分鐘才打開 ModHub 就不補跑{st.meLastRunDate ? ` · 上次執行 ${st.meLastRunDate}` : ''}</span>
          </div>
          {st.found && (
            <div className="row od-zhtw">
              <b>隱藏 UID 的 MOD</b>
              <label className="check">
                <input type="checkbox" checked={Boolean(st.meBypassModCheck)} disabled={busy} onChange={async (e) => {
                  const on = e.target.checked;
                  setBusy(true);
                  try { setSt(await api.meSetBypassModCheck(on)); setMsg(on ? '已繞過 MaaEnd 的 MOD 檢查' : '已還原 MaaEnd 的 MOD 檢查'); } catch (err) { setMsg(errText(err)); } finally { setBusy(false); }
                }} />
                繞過 MaaEnd 的 MOD 檢查
              </label>
              <span className="card-meta">
                {st.bypassState === 'bypassed' ? '✓ 已繞過；' : st.bypassState === 'unknown' ? '⚠ MaaEnd 的檢查格式變了，沒辦法自動繞過；' : ''}
                MaaEnd 每個任務開始前會辨識畫面左下角的 UID，看不到（例如用 Advanced HUD Control 隱藏 UID）就判定有 MOD 並中止。
                勾選後檢查不通過也繼續執行（只改它 nodes.json 裡這一個檢查的下一步，第一次會備份，取消勾選即還原）。
                隱藏 UID 的 MOD 若也遮住其他文字，相關任務仍可能辨識失敗。
              </span>
            </div>
          )}
          {st.found && <ElevatedSettings compact key={`${st.instance}|${st.meQuit}|${st.found}`} />}
          {msg && <div className="card-meta">{msg}</div>}
        </div>

        {st.found && (
          <div className="update-settings">
            {st.error
              ? <span className="card-meta">{st.error}</span>
              : <MaaEndTasks instanceId={inst?.id || ''} instanceName={inst?.name || ''} />}
            <span className="card-meta">MaaEnd 開著時再按執行不會自動開始，請先關閉 MaaEnd。</span>
          </div>
        )}
      </div>
    </div>
  );
}
