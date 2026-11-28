import React, { useEffect, useMemo, useState } from 'react';
import { fmtSize } from './Online.jsx';

const api = window.modhub;
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const STATUS = {
  queued: '等待中', downloading: '下載中', verifying: '校驗中', extracting: '解壓中', ready: '待安裝',
  installing: '安裝中', done: '已安裝', error: '失敗', cancelled: '已取消',
};
const SOURCE = { gamebanana: 'GameBanana', nexus: 'Nexus', local: '本機檔案' };

/** 下載 / 安裝佇列（右下角） */
export function JobsPanel({ jobs, onInstall, onDismiss, gameNames }) {
  const [open, setOpen] = useState(true);
  if (!jobs.length) return null;
  const active = jobs.filter((j) => !['done', 'cancelled'].includes(j.status)).length;
  return (
    <div className={`jobs ${open ? 'open' : ''}`}>
      <button className="jobs-head" onClick={() => setOpen((v) => !v)}>
        下載 / 安裝 {active ? `（${active}）` : ''} <span>{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="jobs-list">
          {jobs.map((j) => {
            const pct = j.total ? Math.min(100, Math.round((j.received / j.total) * 100)) : 0;
            return (
              <div key={j.id} className={`job ${j.status}`}>
                <div className="job-title" title={j.title}>{j.title}</div>
                <div className="job-sub">
                  {gameNames[j.gameId]} · {SOURCE[j.source]} · {STATUS[j.status]}
                  {j.status === 'downloading' && ` ${pct}%（${fmtSize(j.received)} / ${fmtSize(j.total || 0)}）`}
                </div>
                {j.status === 'downloading' && <div className="bar"><span style={{ width: `${pct}%` }} /></div>}
                {j.error && <div className="error-text">{j.error}</div>}
                <div className="job-actions">
                  {j.status === 'ready' && <button className="link" onClick={() => onInstall(j)}>安裝…</button>}
                  {j.status === 'done' && <button className="link" onClick={() => api.openPath(j.installedLoader === 'eff' ? 'EFF' : j.gameId, j.installedPath)}>開啟資料夾</button>}
                  <button className="link" onClick={() => onDismiss(j)}>
                    {['downloading', 'verifying', 'queued'].includes(j.status) ? '取消' : '移除'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 安裝確認：選角色分類、資料夾名稱、安全選項 */
export function InstallDialog({ job, characters, categories, onClose, onDone }) {
  const a = job.analysis;
  const sortedChars = useMemo(() => [...characters].sort((x, y) => x.nameTw.localeCompare(y.nameTw, 'zh-Hant')), [characters]);
  const otherCats = categories.filter((c) => !c.character && !c.virtual);
  const [target, setTarget] = useState(job.suggest ? `char:${job.suggest.charId}` : '');
  const [folderName, setFolderName] = useState(a.rootName && !/^[0-9a-f-]{36}$/i.test(a.rootName) ? a.rootName : job.title);
  const [excludeExec, setExcludeExec] = useState(true);
  const [replace, setReplace] = useState(Boolean(job.replacePath));
  const [disableOthers, setDisableOthers] = useState(false);
  // 終末地的 EFF MOD：每次問要裝到 EFF 還是 XXMI（取代既有版本時預設沿用原本的位置）
  const askLoader = job.gameId === 'EFMI' && a.effMod;
  const [loader, setLoader] = useState(askLoader ? (job.replaceLoader === 'eff' ? 'eff' : '') : 'xxmi');
  const toEff = loader === 'eff';
  const replaceMatches = Boolean(job.replacePath) && (job.replaceLoader === 'eff') === toEff;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => setErr(''), [target]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    const opts = { folderName, excludeExecutables: excludeExec, replace: replace && replaceMatches, disableOthers: disableOthers && !toEff };
    if (toEff) opts.loader = 'eff';
    else if (target.startsWith('char:')) opts.charId = target.slice(5);
    else if (target.startsWith('cat:')) opts.categoryName = target.slice(4);
    try {
      const p = await api.installJob(job.id, opts);
      onDone(p);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal install" onClick={(e) => e.stopPropagation()}>
        <h3>安裝：{job.title}</h3>
        <div className="analysis">
          <span>{a.fileCount} 個檔案 · {fmtSize(a.totalSize)} · {a.iniCount} 個 ini</span>
          {a.effFramework && <div className="warn-box">這是 EFF 框架本體（plugin/eff.dll），不是 MOD。請到終末地「本機 MOD → EFF」按「安裝 EFF / 更新」。</div>}
          {a.iniCount === 0 && !a.effMod && <div className="warn-box">找不到任何 .ini，這可能不是 3DMigoto MOD（或需要再解壓一層）。</div>}
          {a.nestedArchives.length > 0 && <div className="warn-box">裡面還有壓縮檔：{a.nestedArchives.slice(0, 4).join('、')}{a.nestedArchives.length > 4 ? '…' : ''}。可能是多個版本，需要自己解壓挑選。</div>}
          {a.variants.length > 1 && <div className="info-box">包含 {a.variants.length} 個子 MOD：{a.variants.slice(0, 6).join('、')}{a.variants.length > 6 ? '…' : ''}（會一起安裝，可再用「只用這個」挑選）。</div>}
          {a.executables.length > 0 && (
            <div className="warn-box">
              含有 {a.executables.length} 個可執行檔：{a.executables.slice(0, 4).join('、')}{a.executables.length > 4 ? '…' : ''}
              <label className="check"><input type="checkbox" checked={excludeExec} onChange={(e) => setExcludeExec(e.target.checked)} />不安裝這些檔案（建議）</label>
            </div>
          )}
        </div>

        {askLoader && (
          <div className="loader-pick">
            <div className="info-box">這是 EFF（Endfield Framework）格式的 MOD（mod.ini 有 [Mod] format=、*.effres），要裝到哪裡？</div>
            <label className="check"><input type="radio" name="loader" checked={loader === 'eff'} onChange={() => setLoader('eff')} />EFF：遊戲資料夾的 plugin\mods（需要已安裝 EFF）</label>
            <label className="check"><input type="radio" name="loader" checked={loader === 'xxmi'} onChange={() => setLoader('xxmi')} />XXMI：EFMI\Mods（一般 3DMigoto MOD 的位置）</label>
          </div>
        )}
        {!toEff && <label>放到哪個分類
          <select className="sel wide" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">不分類（直接放在 Mods）</option>
            <optgroup label="角色">
              {sortedChars.map((c) => <option key={c.id} value={`char:${c.id}`}>{c.nameTw}{c.en ? `（${c.en}）` : ''}{job.suggest?.charId === c.id ? '　← 建議' : ''}</option>)}
            </optgroup>
            {otherCats.length > 0 && (
              <optgroup label="其他分類">
                {otherCats.map((c) => <option key={c.name} value={`cat:${c.name}`}>{c.displayName}</option>)}
              </optgroup>
            )}
          </select>
        </label>}
        {toEff && <div className="card-meta">EFF 依 MOD 內容判斷角色，直接放在 plugin\mods\&lt;資料夾名稱&gt;。</div>}
        <label>MOD 資料夾名稱
          <input className="search" value={folderName} onChange={(e) => setFolderName(e.target.value)} />
        </label>
        {replaceMatches && (
          <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />取代已安裝的舊版本（舊版會備份，不會直接刪除）</label>
        )}
        {target && !toEff && (
          <label className="check"><input type="checkbox" checked={disableOthers} onChange={(e) => setDisableOthers(e.target.checked)} />停用同分類的其他 MOD（一角一皮）</label>
        )}
        {err && <div className="error-text">{err}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose} disabled={busy}>稍後</button>
          <button className="btn primary" onClick={submit} disabled={busy || !folderName.trim() || !loader || a.effFramework}>{busy ? '安裝中…' : '安裝'}</button>
        </div>
      </div>
    </div>
  );
}
