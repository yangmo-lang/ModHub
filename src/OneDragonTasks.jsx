import React, { useEffect, useState } from 'react';
import { api, errText } from './common.jsx';

/**
 * 絕區零一條龍的任務清單（讀寫 OneDragon 的 one_dragon\_group.yml）：勾選要跑的任務、調整順序
 * detail(task, idx) → 該任務的設定元件（有的話顯示 ⚙ 展開）；compact = 精簡（不顯示排序按鈕）
 */
export default function OneDragonTasks({ compact = false, detail = null }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // 展開設定的任務 id

  const load = (idx) => api.odTasks(idx).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(errText(e)));
  useEffect(() => { load(); }, []);

  if (!data) return err ? <div className="error-text">{err}</div> : <div className="card-meta">讀取一條龍任務…</div>;
  if (!data.found) return <div className="card-meta">找不到 OneDragon，請在上方指定 OneDragon 資料夾。</div>;
  if (data.idx == null) return <div className="card-meta">{data.note || '還沒有帳號實例'}</div>;

  const save = async (next) => {
    const prev = data.tasks;
    setData({ ...data, tasks: next });
    setBusy(true);
    try {
      const r = await api.odSetTasks(data.idx, next.map((t) => ({ id: t.id, enabled: t.enabled })));
      setData((d) => ({ ...d, ...r }));
      setErr('');
    } catch (e) {
      setData((d) => ({ ...d, tasks: prev }));
      setErr(errText(e));
    } finally { setBusy(false); }
  };
  const toggle = (i) => save(data.tasks.map((t, k) => (k === i ? { ...t, enabled: !t.enabled } : t)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= data.tasks.length) return;
    const next = [...data.tasks];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const on = data.tasks.filter((t) => t.enabled).length;

  return (
    <div className={`od-tasks ${compact ? 'compact' : ''}`}>
      <div className="od-tasks-head">
        <span>一條龍任務（{on}/{data.tasks.length}）</span>
        {data.instances.length > 1 && (
          <select className="sel" value={data.idx} disabled={busy} onChange={(e) => load(Number(e.target.value))} title="OneDragon 的帳號實例">
            {data.instances.map((i) => <option key={i.idx} value={i.idx}>{i.name}</option>)}
          </select>
        )}
      </div>
      <div className="od-task-list">
        {data.tasks.map((t, i) => {
          const extra = detail && open === t.id ? detail(t, data.idx) : null;
          const hasDetail = Boolean(detail && detail(t, data.idx));
          return (
          <React.Fragment key={t.id}>
          <div className={`od-task ${t.enabled ? 'on' : ''} ${open === t.id ? 'open' : ''}`}>
            <label className="check" title={t.id}>
              <input type="checkbox" checked={t.enabled} disabled={busy} onChange={() => toggle(i)} />
              {t.name}
            </label>
            {!compact && (
              <span className="od-move">
                {hasDetail && <button className="link" onClick={() => setOpen(open === t.id ? null : t.id)} title="這個任務的設定">⚙</button>}
                <button className="link" disabled={busy || i === 0} onClick={() => move(i, -1)} title="往前">↑</button>
                <button className="link" disabled={busy || i === data.tasks.length - 1} onClick={() => move(i, 1)} title="往後">↓</button>
              </span>
            )}
          </div>
          {extra && <div className="od-task-detail">{extra}</div>}
          </React.Fragment>
          );
        })}
      </div>
      {!data.exists && (
        <span className="card-meta">{data.migrated ? '已從 OneDragon 舊版設定讀出；' : '這個帳號實例還沒有一條龍設定；'}勾選或調整順序後 ModHub 會自動建立。</span>
      )}
      {err && <div className="error-text">{err}</div>}
      {!compact && <span className="card-meta">勾選與順序直接寫回 OneDragon 的設定（{'config\\<實例>\\one_dragon\\_group.yml'}，第一次會先備份）。每日簽到、錄像店、咖啡店、體力刷本可按 ⚙ 調整；其他任務的細節設定仍在 OneDragon 裡。</span>}
    </div>
  );
}
