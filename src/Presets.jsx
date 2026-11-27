import React, { useCallback, useEffect, useState } from 'react';

const api = window.modhub;
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const when = (t) => (t ? new Date(t).toLocaleString() : '');

/** 預覽清單：最多列 12 個，其餘收合 */
function KeyList({ title, keys, kind }) {
  const [open, setOpen] = useState(false);
  if (!keys.length) return null;
  const shown = open ? keys : keys.slice(0, 12);
  return (
    <div className={`ps-keys ${kind}`}>
      <b>{title}（{keys.length}）</b>
      <ul>{shown.map((k) => <li key={k}>{k}</li>)}</ul>
      {keys.length > 12 && <button className="link" onClick={() => setOpen((v) => !v)}>{open ? '收起' : `顯示全部 ${keys.length} 個`}</button>}
    </div>
  );
}

/** 預設組合：把目前「哪些 MOD 啟用」存起來，之後一鍵切換 */
export default function Presets({ gameId, gameName, enabledCount, onClose, onApplied, showToast }) {
  const [list, setList] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [confirm, setConfirm] = useState(null); // { preset, plan }

  const refresh = useCallback(() => api.presetList(gameId).then(setList).catch((e) => setErr(errText(e))), [gameId]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (fn) => {
    setBusy(true);
    setErr('');
    try { return await fn(); } catch (e) { setErr(errText(e)); return undefined; } finally { setBusy(false); refresh(); }
  };

  const create = () => run(async () => {
    const p = await api.presetCreate(gameId, name);
    setName('');
    showToast(`已儲存組合「${p.name}」（${p.count} 個啟用的 MOD）`);
  });
  const overwrite = (p) => {
    if (!window.confirm(`用目前的啟用狀態（${enabledCount} 個 MOD）覆蓋「${p.name}」？`)) return;
    run(async () => { await api.presetUpdate(gameId, p.id, { capture: true }); showToast(`已更新組合「${p.name}」`); });
  };
  const rename = () => run(async () => {
    await api.presetUpdate(gameId, renaming.id, { name: renaming.name });
    setRenaming(null);
  });
  const remove = (p) => {
    if (!window.confirm(`刪除組合「${p.name}」？（只刪除組合紀錄，不會動到 MOD 檔案）`)) return;
    run(() => api.presetRemove(gameId, p.id));
  };
  const preview = (p) => run(async () => setConfirm({ preset: p, plan: await api.presetPreview(gameId, p.id) }));
  const apply = () => run(async () => {
    const r = await api.presetApply(gameId, confirm.preset.id);
    setConfirm(null);
    onApplied(confirm.preset, r);
  });

  const nothingToDo = confirm && !confirm.plan.toEnable.length && !confirm.plan.toDisable.length;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal presets" onClick={(e) => e.stopPropagation()}>
        <h3>預設組合 · {gameName}</h3>
        {confirm ? (
          <>
            <p className="ps-hint">套用「{confirm.preset.name}」：組合裡的 MOD 會啟用，其他 MOD 會停用（只改資料夾名稱的 DISABLED_ 前綴，可以隨時切回）。</p>
            {nothingToDo ? (
              <div className="empty small">目前狀態已經和這個組合相同</div>
            ) : (
              <div className="ps-plan">
                <KeyList title="會啟用" keys={confirm.plan.toEnable} kind="on" />
                <KeyList title="會停用" keys={confirm.plan.toDisable} kind="off" />
              </div>
            )}
            <KeyList title="找不到（已刪除或改名，會略過）" keys={confirm.plan.missing} kind="missing" />
            {!nothingToDo && !confirm.preset.auto && <small className="card-meta">套用前會自動記下目前狀態，存成「套用前的狀態」。</small>}
            {err && <div className="error-text">{err}</div>}
            <div className="row end">
              <button className="btn ghost" onClick={() => setConfirm(null)} disabled={busy}>返回</button>
              {!nothingToDo && <button className="btn primary" onClick={apply} disabled={busy}>{busy ? '套用中…' : '套用'}</button>}
            </div>
          </>
        ) : (
          <>
            <p className="ps-hint">把目前「哪些 MOD 啟用」存成組合，之後一鍵切換。套用後到遊戲內按 F10 重新載入。</p>
            <div className="row">
              <input placeholder="組合名稱，例如：日常、拍照用" value={name} maxLength={60}
                onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !busy) create(); }} />
              <button className="btn primary" onClick={create} disabled={busy || !name.trim()}>儲存目前狀態（{enabledCount} 個啟用）</button>
            </div>
            {err && <div className="error-text">{err}</div>}
            <div className="ps-list">
              {list === null ? <div className="empty small">載入中…</div>
                : list.length === 0 ? <div className="empty small">還沒有組合</div>
                  : list.map((p) => (
                    <div key={p.id} className={`ps-item ${p.auto ? 'auto' : ''}`}>
                      <div className="ps-text">
                        {renaming?.id === p.id ? (
                          <div className="row">
                            <input autoFocus value={renaming.name} maxLength={60} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(null); }} />
                            <button className="btn small" onClick={rename} disabled={busy || !renaming.name.trim()}>確定</button>
                            <button className="link" onClick={() => setRenaming(null)}>取消</button>
                          </div>
                        ) : (
                          <b>{p.name}{p.auto && <span className="badge manual">自動</span>}</b>
                        )}
                        <small>{p.count} 個 MOD · {p.auto ? '上次套用組合前' : '更新於'} {when(p.updatedAt)}</small>
                      </div>
                      <div className="ps-actions">
                        <button className="btn small primary" onClick={() => preview(p)} disabled={busy}>套用…</button>
                        {!p.auto && <button className="link" onClick={() => overwrite(p)} disabled={busy} title="用目前的啟用狀態覆蓋這個組合">覆蓋</button>}
                        {!p.auto && <button className="link" onClick={() => setRenaming({ id: p.id, name: p.name })} disabled={busy}>改名</button>}
                        <button className="link danger" onClick={() => remove(p)} disabled={busy}>刪除</button>
                      </div>
                    </div>
                  ))}
            </div>
            <div className="row end">
              <button className="btn ghost" onClick={onClose}>關閉</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
