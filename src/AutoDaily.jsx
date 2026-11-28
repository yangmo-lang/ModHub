import React, { useEffect, useState } from 'react';
import { api, errText } from './common.jsx';
import OneDragonTasks from './OneDragonTasks.jsx';
import ElevatedSettings from './Elevated.jsx';

/** 絕區零一條龍（第三方工具 OneDragon）：資料夾、跑完動作、帳號實例、定時；改了就直接存 */
const OD_AFTER = [['close', '關閉遊戲'], ['none', '不動作'], ['shutdown', '關閉遊戲並關機（60 秒後）'], ['sleep', '關閉遊戲並睡眠'], ['hibernate', '關閉遊戲並休眠']];
export function OneDragonSettings() {
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const refresh = () => api.odStatus().then(setSt).catch(() => {});
  useEffect(() => { refresh(); return api.onOdProgress(setProgress); }, []);
  const save = async (patch) => {
    setSt((s) => ({ ...s, ...patch }));
    await api.saveSettings(patch);
    refresh();
  };
  if (!st) return null;
  const download = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await api.odDownloadInstaller();
      if (!r.cancelled) setMsg(`已下載到 ${r.path}，請自己雙擊安裝（需要系統管理員權限），裝好後在上面選資料夾。`);
    } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="update-settings od-settings">
      <b>絕區零一條龍（OneDragon）</b>
      <span className="card-meta">
        由第三方工具 <button className="link" onClick={() => api.openExternal(st.pages.github)}>ZenlessZoneZero-OneDragon</button>（GPL-3.0）執行每日任務；
        ModHub 只負責啟動。它會模擬操作遊戲，可能違反遊戲條款，風險自負。在遊戲內面板（Alt+N）選絕區零就有「一條龍」按鈕。
      </span>
      <div className="row">
        <input value={st.odRoot} placeholder={st.found ? `自動找到：${st.found}` : 'OneDragon 資料夾（含 OneDragon-Launcher.exe）'} onChange={(e) => setSt({ ...st, odRoot: e.target.value })} onBlur={() => save({ odRoot: st.odRoot.trim() })} />
        <button className="btn" onClick={async () => { const p = await api.pickFolder(); if (p) save({ odRoot: p }); }}>瀏覽</button>
      </div>
      {st.found
        ? <span className="card-meta">✓ {st.exe}</span>
        : (
          <div className="row">
            <span className="card-meta">{st.configuredButMissing ? '這個資料夾裡找不到 OneDragon-Launcher.exe' : '還沒找到 OneDragon'}</span>
            <button className="btn small" disabled={busy} onClick={download}>{busy ? (progress?.total ? `下載中 ${Math.round((progress.received / progress.total) * 100)}%` : '下載中…') : '下載官方安裝程式'}</button>
            <button className="link" onClick={() => api.openExternal(st.pages.home)}>官方網站</button>
          </div>
        )}
      <div className="row">
        <label className="inline">跑完之後
          <select className="sel" value={st.odAfter} onChange={(e) => save({ odAfter: e.target.value })}>
            {OD_AFTER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="inline">開遊戲
          <select className="sel" value={st.odLaunchVia} onChange={(e) => save({ odLaunchVia: e.target.value })} title="Epic 版請選 XXMI：OneDragon 直接執行遊戲 exe 時少了 Epic 啟動參數，遊戲會自己關掉">
            <option value="xxmi">ModHub 先透過 XXMI 開（載入 MOD）</option>
            <option value="onedragon">交給 OneDragon 開</option>
          </select>
        </label>
        <label className="inline">帳號實例
          <input className="od-inst" value={st.odInstance} placeholder="全部" onChange={(e) => setSt({ ...st, odInstance: e.target.value })} onBlur={() => save({ odInstance: st.odInstance.trim() })} title="OneDragon 的帳號實例編號，多個用英文逗號分隔，例如 1,2；留空 = OneDragon 的預設" />
        </label>
      </div>
      <div className="row">
        <label className="check"><input type="checkbox" checked={Boolean(st.odScheduleEnabled)} onChange={(e) => save({ odScheduleEnabled: e.target.checked })} />每天定時執行</label>
        <input type="time" className="od-time" value={st.odScheduleTime} disabled={!st.odScheduleEnabled} onChange={(e) => save({ odScheduleTime: e.target.value })} />
        <span className="card-meta">ModHub 開著時（含縮在系統匣）到時間啟動一次；超過 30 分鐘才打開 ModHub 就不補跑{st.odLastRunDate ? ` · 上次執行 ${st.odLastRunDate}` : ''}</span>
      </div>
      {st.found && st.gamePath && (() => {
        const missing = st.gamePath.instances.filter((i) => !i.path);
        return (
          <div className="row od-zhtw">
            <b>遊戲路徑</b>
            {missing.length === 0
              ? <span className="card-meta">✓ {[...new Set(st.gamePath.instances.map((i) => i.path))].join('、')}</span>
              : st.gamePath.exe
                ? <span className="card-meta">OneDragon 還沒設定遊戲路徑（實例 {missing.map((i) => i.idx).join('、')}）；執行一條龍前 ModHub 會自動填入 {st.gamePath.exe}</span>
                : <span className="error-text">OneDragon 還沒設定遊戲路徑，ModHub 也找不到 ZenlessZoneZero.exe（請到「設定」確認 XXMI 資料夾，或在 OneDragon 的「帳戶管理 → 遊戲路徑」設定）</span>}
          </div>
        );
      })()}
      {st.found && st.gamePath && (() => {
        const { guess, labels, instances } = st.gamePath;
        const L = (r) => labels[r] || r;
        const unset = instances.filter((i) => i.region == null);
        const isCn = (r) => r === 'cn' || r === 'cn_b';
        // 已設定、但國服 / 國際服和遊戲本身不符（OneDragon 會找錯視窗標題）
        const wrong = guess.region ? instances.filter((i) => i.region != null && isCn(i.region || 'cn') !== isCn(guess.region)) : [];
        return (
          <div className="row od-zhtw">
            <b>遊戲區服</b>
            {unset.length > 0
              ? (guess.region
                ? <span className="card-meta">OneDragon 還沒設定區服（實例 {unset.map((i) => i.idx).join('、')}，它會當成國服而找不到國際服的遊戲視窗）；執行一條龍前 ModHub 會自動設為 {L(guess.region)}（依 {guess.source === 'config.ini' ? '遊戲的 config.ini' : guess.source === '預設' ? '遊戲是國際服，抽卡紀錄沒有 UID，預設港澳台服' : `遊戲是國際服，抽卡紀錄 ${guess.source}`}）</span>
                : <span className="error-text">OneDragon 還沒設定區服（會當成國服），ModHub 也判斷不出遊戲是國服還是國際服；國際服請在 OneDragon 的「帳戶管理」設定區服，否則它找不到遊戲視窗</span>)
              : <span className="card-meta">✓ {[...new Set(instances.map((i) => L(i.region)))].join('、')}</span>}
            {wrong.length > 0 && <span className="error-text">實例 {wrong.map((i) => i.idx).join('、')} 的區服是 {L(wrong[0].region)}，但遊戲是{isCn(guess.region) ? '國服' : '國際服'}：OneDragon 會找不到遊戲視窗，請在 OneDragon 的「帳戶管理」改成正確的區服</span>}
          </div>
        );
      })()}
      {st.found && (
        <div className="row od-zhtw">
          <b>繁體中文遊戲畫面</b>
          {st.zhtw?.installed
            ? <span className="card-meta">✓ 已安裝支援外掛{st.zhtw.outdated ? '（有新版）' : ''}；遊戲文字用繁體中文即可</span>
            : <span className="card-meta">OneDragon 只認簡體中文 / 英文畫面。遊戲文字是繁體中文時，安裝 ModHub 的支援外掛（把辨識到的繁體字轉成簡體再比對）</span>}
          {(!st.zhtw?.installed || st.zhtw.outdated) && (
            <button className="btn small" disabled={busy} onClick={async () => {
              setBusy(true);
              try { setSt(await api.odZhtwInstall()); setMsg('已安裝繁體中文支援，下次啟動 OneDragon 生效'); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
            }}>{st.zhtw?.installed ? '更新外掛' : '安裝外掛'}</button>
          )}
          {st.zhtw?.installed && (
            <button className="link" disabled={busy} onClick={async () => {
              setBusy(true);
              try { setSt(await api.odZhtwRemove()); setMsg('已把外掛移到資源回收筒，下次啟動 OneDragon 生效'); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
            }}>移除</button>
          )}
        </div>
      )}
      {st.found && <ElevatedSettings compact key={`${st.odAfter}|${st.odInstance}|${st.found}`} />}
      {msg && <div className="card-meta">{msg}</div>}
    </div>
  );
}


/** 錄像店 / 咖啡店：選傳送地點 */
function TransportEditor({ idx, appId }) {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.odAppConfig(idx, appId).then(setCfg).catch((e) => setErr(errText(e))); }, [idx, appId]);
  if (err) return <div className="error-text">{err}</div>;
  if (!cfg) return <div className="card-meta">讀取中…</div>;
  const pick = async (v) => {
    try { setCfg(await api.odSetAppConfig(idx, appId, { transport_point: v })); setErr(''); } catch (e) { setErr(errText(e)); }
  };
  return (
    <div className="od-detail">
      <label className="inline">前往地點
        <select className="sel" value={cfg.transport_point} onChange={(e) => pick(e.target.value)}>
          {cfg.options.map((o) => <option key={o} value={o}>{cfg.labels[o] || o}</option>)}
        </select>
      </label>
    </div>
  );
}

/** 每日簽到：選簽到地點（吼吼餅鋪 / 卦象集錄 / 刮刮卡） */
function SignEditor({ idx }) {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.odAppConfig(idx, 'daily_signin').then(setCfg).catch((e) => setErr(errText(e))); }, [idx]);
  if (err && !cfg) return <div className="error-text">{err}</div>;
  if (!cfg) return <div className="card-meta">讀取中…</div>;
  const pick = async (v) => {
    try { setCfg(await api.odSetAppConfig(idx, 'daily_signin', { selected_sign: v })); setErr(''); } catch (e) { setErr(errText(e)); }
  };
  return (
    <div className="od-detail">
      <label className="inline">簽到地點
        <select className="sel" value={cfg.selected_sign} onChange={(e) => pick(e.target.value)}>
          {cfg.options.map((o) => <option key={o} value={o}>{cfg.labels[o] || o}</option>)}
        </select>
      </label>
      {err && <div className="error-text">{err}</div>}
    </div>
  );
}

/** 體力刷本：副本計畫（依序執行；每筆可設次數） */
function ChargePlanEditor({ idx }) {
  const [cfg, setCfg] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ category: '', type: '', mission: '', times: 1 });
  useEffect(() => { api.odAppConfig(idx, 'charge_plan').then(setCfg).catch((e) => setErr(errText(e))); }, [idx]);
  if (err && !cfg) return <div className="error-text">{err}</div>;
  if (!cfg) return <div className="card-meta">讀取中…</div>;
  const L = (s) => (s ? cfg.labels[s] || s : '');
  // 掉落物（OneDragon 資料裡有標註的才顯示：區域巡防的驅動盤套裝、實戰模擬室的產出）
  const withDrop = (name, drop) => (drop ? `${L(name)}（${L(drop)}）` : L(name));
  const dropOf = (p) => {
    const t = cfg.compendium.find((c) => c.category === p.category_name)?.types.find((x) => x.name === p.mission_type_name);
    return (p.mission_name && t?.drops?.[p.mission_name]) || t?.drop || '';
  };
  const save = async (plan_list) => {
    setBusy(true);
    try { setCfg(await api.odSetAppConfig(idx, 'charge_plan', { plan_list })); setErr(''); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const plans = cfg.plan_list;
  const cat = cfg.compendium.find((c) => c.category === draft.category);
  const type = cat?.types.find((t) => t.name === draft.type);
  const canAdd = cat && type && (!type.missions.length || draft.mission);
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= plans.length) return; const n = [...plans]; [n[i], n[j]] = [n[j], n[i]]; save(n); };
  return (
    <div className="od-detail">
      {plans.length === 0 && <div className="card-meta">還沒有副本計畫：在下面選要刷的副本後按「新增」。</div>}
      {plans.map((p, i) => (
        <div key={p.plan_id || i} className="od-plan">
          <span className="od-plan-name">
            {[p.category_name, p.mission_type_name, p.mission_name].filter(Boolean).map(L).join(' / ')}
            {dropOf(p) && <small className="od-drop">掉落：{L(dropOf(p))}</small>}
          </span>
          <label className="inline">次數
            <input type="number" min="1" max="999" className="od-times" value={p.plan_times} disabled={busy}
              onChange={(e) => setCfg({ ...cfg, plan_list: plans.map((x, k) => (k === i ? { ...x, plan_times: e.target.value } : x)) })}
              onBlur={() => save(plans)} />
          </label>
          <span className="od-move">
            <button className="link" disabled={busy || i === 0} onClick={() => move(i, -1)} title="往前">↑</button>
            <button className="link" disabled={busy || i === plans.length - 1} onClick={() => move(i, 1)} title="往後">↓</button>
            <button className="link danger" disabled={busy} onClick={() => save(plans.filter((_, k) => k !== i))}>刪除</button>
          </span>
        </div>
      ))}
      <div className="od-plan add">
        <select className="sel" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value, type: '', mission: '' })}>
          <option value="">選分類…</option>
          {cfg.compendium.map((c) => <option key={c.category} value={c.category}>{L(c.category)}</option>)}
        </select>
        {cat && (
          <select className="sel" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value, mission: '' })}>
            <option value="">選{cat.category === '实战模拟室' ? '類型' : '目標'}…</option>
            {cat.types.map((t) => <option key={t.name} value={t.name}>{withDrop(t.name, t.drop)}</option>)}
          </select>
        )}
        {type?.missions.length > 0 && (
          <select className="sel" value={draft.mission} onChange={(e) => setDraft({ ...draft, mission: e.target.value })}>
            <option value="">選副本…</option>
            {type.missions.map((m) => <option key={m} value={m}>{withDrop(m, type.drops?.[m])}</option>)}
          </select>
        )}
        <label className="inline">次數 <input type="number" min="1" max="999" className="od-times" value={draft.times} onChange={(e) => setDraft({ ...draft, times: e.target.value })} /></label>
        <button className="btn small" disabled={!canAdd || busy} onClick={async () => {
          await save([...plans, { category_name: draft.category, mission_type_name: draft.type, mission_name: type.missions.length ? draft.mission : null, plan_times: Number(draft.times) || 1 }]);
          setDraft({ ...draft, mission: '', times: 1 });
        }}>新增</button>
      </div>
      {err && <div className="error-text">{err}</div>}
      <span className="card-meta">依序刷完每個計畫的次數後換下一個；配隊、卡片數等戰鬥設定沿用 OneDragon 的預設，需要時在 OneDragon 裡調整。</span>
    </div>
  );
}

const DETAIL = { random_play: TransportEditor, coffee: TransportEditor, daily_signin: SignEditor, charge_plan: ChargePlanEditor };

/** 主畫面「絕區零 → 自動每日」：OneDragon 設定、任務勾選與順序、各任務的設定 */
const STAGE = { launching: '透過 XXMI 開遊戲…', waiting: '等遊戲開好…', onedragon: '啟動 OneDragon…' };

export default function AutoDaily({ showToast }) {
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(null);
  useEffect(() => api.onOdStage((s) => setStage(s?.stage || null)), []);
  const run = async () => {
    setRunning(true);
    try { await api.odRun(); } catch { /* 錯誤由主視窗的 od:error 提示 */ } finally { setTimeout(() => setRunning(false), 3000); }
  };
  return (
    <div className="autodaily">
      <header className="toolbar">
        <b className="ad-title">自動每日（OneDragon 一條龍）</b>
        <div className="spacer" />
        {stage && <span className="card-meta">{STAGE[stage] || stage}</span>}
        <button className="btn primary" disabled={running || Boolean(stage)} onClick={run}>{running || stage ? '啟動中…' : '▶ 執行一條龍'}</button>
      </header>
      <div className="ad-body">
        <OneDragonSettings />
        <div className="update-settings">
          <OneDragonTasks detail={(t, idx) => {
            const D = DETAIL[t.id];
            return D ? <D idx={idx} appId={t.id} /> : null;
          }} />
        </div>
      </div>
    </div>
  );
}
