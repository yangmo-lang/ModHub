import React, { useEffect, useState } from 'react';
import { api, errText } from './common.jsx';

const YES = ['Yes', 'yes', 'Y', 'y'];
const valueOf = (def, v) => (v && v.type === def.type ? v : def.dflt);

/** 目前值下有子選項的 case（與 MaaEnd 相同：switch / select 一個，checkbox 可能多個） */
function activeCases(def, v) {
  const cases = def.cases || [];
  if (def.type === 'checkbox') return cases.filter((c) => v.caseNames.includes(c.name) && c.option?.length);
  if (def.type === 'switch') return cases.filter((c) => (v.value ? YES : ['No', 'no', 'N', 'n']).includes(c.name) && c.option?.length).slice(0, 1);
  if (def.type === 'select') return cases.filter((c) => c.name === v.caseName && c.option?.length).slice(0, 1);
  return [];
}

const short = (s) => String(s || '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim();

/** 一個選項（含子選項，遞迴） */
function OptionField({ k, ctx, depth = 0 }) {
  const def = ctx.options[k];
  const [draft, setDraft] = useState(null);
  if (!def) return null;
  if (def.controller && ctx.controller && !def.controller.includes(ctx.controller)) return null;
  if (def.resource && ctx.resource && !def.resource.includes(ctx.resource)) return null;
  const v = valueOf(def, ctx.values[k]);
  const set = (nv) => ctx.save(k, nv);
  const tip = short(def.description);
  let field;
  if (def.type === 'switch') {
    field = <label className="check me-opt-label" title={tip}><input type="checkbox" checked={v.value} disabled={ctx.busy} onChange={(e) => set({ type: 'switch', value: e.target.checked })} />{def.label}</label>;
  } else if (def.type === 'select') {
    field = (
      <label className="inline me-opt-label" title={tip}>{def.label}
        <select className="sel" value={v.caseName} disabled={ctx.busy} onChange={(e) => set({ type: 'select', caseName: e.target.value })}>
          {def.cases.map((c) => <option key={c.name} value={c.name} title={short(c.description)}>{c.label}</option>)}
        </select>
      </label>
    );
  } else if (def.type === 'checkbox') {
    const toggle = (name, on) => set({ type: 'checkbox', caseNames: def.cases.map((c) => c.name).filter((n) => (n === name ? on : v.caseNames.includes(n))) });
    field = (
      <div className="me-opt-multi" title={tip}>
        <span className="me-opt-label">{def.label}{def.max_count ? `（最多 ${def.max_count} 項）` : ''}</span>
        <div className="me-opt-cases">
          {def.cases.map((c) => (
            <label key={c.name} className="check" title={short(c.description)}>
              <input type="checkbox" checked={v.caseNames.includes(c.name)} disabled={ctx.busy} onChange={(e) => toggle(c.name, e.target.checked)} />{c.label}
            </label>
          ))}
        </div>
        <span className="me-opt-all">
          <button className="link" disabled={ctx.busy} onClick={() => set({ type: 'checkbox', caseNames: def.cases.map((c) => c.name).slice(0, def.max_count || undefined) })}>全選</button>
          <button className="link" disabled={ctx.busy} onClick={() => set({ type: 'checkbox', caseNames: [] })}>全不選</button>
        </span>
      </div>
    );
  } else if (def.type === 'input') {
    const values = draft || v.values;
    const commit = () => { if (draft && JSON.stringify(draft) !== JSON.stringify(v.values)) set({ type: 'input', values: draft }); setDraft(null); };
    field = (
      <div className="me-opt-inputs" title={tip}>
        {def.inputs.length > 1 && <span className="me-opt-label">{def.label}</span>}
        {def.inputs.map((i) => (
          <label key={i.name} className="inline me-opt-label" title={short(i.description) || tip}>
            {def.inputs.length > 1 ? i.label : def.label}
            {i.password
              ? <span className="card-meta">（密碼欄位請在 MaaEnd 裡設定）</span>
              : <input className={i.pipeline_type === 'int' ? 'me-num' : 'me-text'} value={values[i.name] ?? ''} disabled={ctx.busy}
                  placeholder={i.default} onChange={(e) => setDraft({ ...values, [i.name]: e.target.value })} onBlur={commit}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}
          </label>
        ))}
      </div>
    );
  } else {
    field = <span className="card-meta me-opt-label">{def.label}：請在 MaaEnd 裡設定</span>;
  }
  return (
    <div className={`me-opt ${depth ? 'nested' : ''}`}>
      {field}
      {activeCases(def, v).flatMap((c) => c.option).map((sub) => <OptionField key={sub} k={sub} ctx={ctx} depth={depth + 1} />)}
    </div>
  );
}

/**
 * 終末地 MaaEnd 的任務清單（讀寫 MaaEnd 的 config\mxu-MaaEnd.json）：勾選、排序、新增 / 移除任務、每個任務的選項
 * 啟動遊戲的前置任務與切換帳號不顯示
 */
export default function MaaEndTasks({ instanceId, instanceName }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState('');

  const load = (keepErr = false) => api.meTasks(instanceId).then((d) => { setData(d); if (!keepErr) setErr(''); }).catch((e) => setErr(errText(e)));
  useEffect(() => {
    setData(null);
    setOpen(null);
    if (!instanceId) return undefined;
    load();
    const onFocus = () => load(true); // 使用者可能剛在 MaaEnd 裡改過，或剛關掉 MaaEnd
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [instanceId]);

  if (!instanceId) return <span className="card-meta">MaaEnd 裡還沒有實例：請先打開 MaaEnd，建立實例（分頁）。</span>;
  if (!data) return err ? <div className="error-text">{err}</div> : <div className="card-meta">讀取 MaaEnd 任務…</div>;

  const act = async (fn, after) => {
    setBusy(true);
    try { setData(await fn()); setErr(''); after?.(); } catch (e) { setErr(errText(e)); load(true); } finally { setBusy(false); }
  };
  const saveList = (next) => {
    setData({ ...data, tasks: next });
    act(() => api.meSetTasks(instanceId, next.map((t) => ({ id: t.id, enabled: t.enabled }))));
  };
  const toggle = (i) => saveList(data.tasks.map((t, k) => (k === i ? { ...t, enabled: !t.enabled } : t)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= data.tasks.length) return;
    const next = [...data.tasks];
    [next[i], next[j]] = [next[j], next[i]];
    saveList(next);
  };
  const on = data.tasks.filter((t) => t.enabled).length;
  const groupLabel = Object.fromEntries((data.groups || []).map((g) => [g.name, g.label]));
  const byGroup = new Map();
  for (const a of data.available) {
    const g = groupLabel[a.group] || '其他';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(a);
  }

  return (
    <div className="od-tasks">
      <div className="od-tasks-head">
        <span>「{instanceName}」的任務（{on}/{data.tasks.length}）</span>
        <div className="spacer" />
        <button className="link" disabled={busy} onClick={() => load()}>重新讀取</button>
        <button className="link" onClick={() => api.meOpenConfigDir().catch((e) => setErr(errText(e)))}>開啟設定檔位置</button>
      </div>
      {data.running && <div className="error-text">MaaEnd 正在執行：要調整任務請先關閉 MaaEnd（它關閉時會用自己記憶體裡的設定蓋掉這裡的修改）。關閉後回到這個視窗會自動重新讀取。</div>}
      <div className="od-task-list">
        {data.tasks.map((t, i) => {
          const isOpen = open === t.id;
          const ctx = { options: data.options, values: t.values, controller: data.controller, resource: data.resource, busy: busy || data.running, save: (k, v) => act(() => api.meSetOption(instanceId, t.id, k, v)) };
          return (
            <React.Fragment key={t.id}>
              <div className={`od-task ${t.enabled ? 'on' : ''} ${isOpen ? 'open' : ''}`}>
                <label className="check" title={short(t.description) || t.name}>
                  <input type="checkbox" checked={t.enabled} disabled={busy || data.running} onChange={() => toggle(i)} />
                  {t.label}{!t.known && <small className="card-meta">（MaaEnd 已沒有這個任務）</small>}
                </label>
                <span className="od-move">
                  {t.option.length > 0 && <button className="link" onClick={() => setOpen(isOpen ? null : t.id)} title="這個任務的設定">⚙</button>}
                  <button className="link" disabled={busy || data.running || i === 0} onClick={() => move(i, -1)} title="往前">↑</button>
                  <button className="link" disabled={busy || data.running || i === data.tasks.length - 1} onClick={() => move(i, 1)} title="往後">↓</button>
                </span>
              </div>
              {isOpen && (
                <div className="od-task-detail me-detail">
                  {t.description && <div className="card-meta">{short(t.description)}</div>}
                  {t.option.map((k) => <OptionField key={k} k={k} ctx={ctx} />)}
                  <div className="row">
                    <button className="link danger" disabled={busy || data.running} onClick={() => act(() => api.meRemoveTask(instanceId, t.id), () => setOpen(null))}>從這個實例移除</button>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="row">
        <select className="sel" value={adding} disabled={busy || data.running} onChange={(e) => setAdding(e.target.value)}>
          <option value="">新增任務…</option>
          {[...byGroup].map(([g, list]) => (
            <optgroup key={g} label={g}>
              {list.map((a) => <option key={a.name} value={a.name}>{a.label}</option>)}
            </optgroup>
          ))}
        </select>
        <button className="btn small" disabled={!adding || busy || data.running} onClick={() => act(() => api.meAddTask(instanceId, adding), () => setAdding(''))}>新增</button>
      </div>
      {err && <div className="error-text">{err}</div>}
      <span className="card-meta">
        勾選、順序與 ⚙ 裡的選項直接寫回 MaaEnd 的設定（config\mxu-MaaEnd.json，第一次會先備份成 .modhub-bak）；沒改過的選項沿用 MaaEnd 的預設值。
        啟動遊戲的前置任務與切換帳號不在這裡顯示（ModHub 會先透過 XXMI 開遊戲）。
      </span>
    </div>
  );
}
