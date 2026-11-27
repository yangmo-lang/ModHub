import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const api = window.modhub;
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const fmt = (n) => Number(n || 0).toLocaleString();
const KIND = { character: '角色', weapon: '武器' };
const WEAPON_LABEL = { SRMI: '光錐', WWMI: '武器', ZZMI: '音擎', EFMI: '武器' };
const STAGE_LABEL = { SRMI: '晉階', WWMI: '突破', ZZMI: '突破', EFMI: '精英化 / 突破' };

function Icon({ src, name, size = 40, className = '' }) {
  return src
    ? <img className={`pl-icon ${className}`} src={src} alt="" style={{ width: size, height: size }} loading="lazy" referrerPolicy="no-referrer" />
    : <div className={`pl-icon ph ${className}`} style={{ width: size, height: size }}>{(name || '?').slice(0, 1)}</div>;
}

function NumberBox({ value, min, max, onChange }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = value;
    n = Math.min(max, Math.max(min, Math.round(n)));
    setV(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <input className="num" type="number" value={v} min={min} max={max}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  );
}

export default function Planner({ gameId, gameName, showToast }) {
  const [plan, setPlan] = useState({ entries: [], inventory: {} });
  const [loaded, setLoaded] = useState(false);
  const [entities, setEntities] = useState(null);
  const [entErr, setEntErr] = useState('');
  const [progress, setProgress] = useState(null);
  const [models, setModels] = useState({});
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [picker, setPicker] = useState(null); // 'character' | 'weapon'
  const [summaryTab, setSummaryTab] = useState('short');
  const [openMat, setOpenMat] = useState(null);
  const gameRef = useRef(gameId);
  gameRef.current = gameId;
  const planRef = useRef(plan);
  planRef.current = plan;

  // 換遊戲：讀存檔與清單
  useEffect(() => {
    let alive = true;
    setLoaded(false); setPlan({ entries: [], inventory: {} }); setEntities(null); setEntErr(''); setModels({}); setSelected(null); setResult(null); setProgress(null);
    api.plannerGet(gameId).then((p) => { if (alive) { setPlan(p); setSelected(p.entries[0]?.key || null); setLoaded(true); } });
    api.plannerEntities(gameId).then((e) => alive && setEntities(e)).catch((e) => alive && setEntErr(errText(e)));
    const off = api.onPlannerProgress((p) => p.gameId === gameRef.current && setProgress(p.done >= p.total ? null : p));
    return () => { alive = false; off(); };
  }, [gameId]);

  // 讀取目標的模型
  useEffect(() => {
    for (const e of plan.entries) {
      const k = `${e.kind}:${e.id}`;
      if (models[k]) continue;
      setModels((m) => ({ ...m, [k]: 'loading' }));
      api.plannerModel(gameId, e.kind, e.id)
        .then((m) => setModels((s) => ({ ...s, [k]: m })))
        .catch((err) => setModels((s) => ({ ...s, [k]: { error: errText(err) } })));
    }
  }, [plan.entries, gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 存檔 + 重新計算（延遲合併）
  useEffect(() => {
    if (!loaded) return;
    const g = gameId;
    const t = setTimeout(async () => {
      api.plannerSave(g, plan);
      try {
        const r = await api.plannerCalc(g, plan);
        if (g !== gameRef.current) return;
        setResult(r);
        // 把整理過的設定（等級 / 突破一致、目標不低於目前）寫回，只在結果對應目前的計畫時
        if (planRef.current === plan) {
          const norm = new Map(r.perEntry.map((x) => [x.key, x.cfg]));
          const strip = (c) => JSON.stringify({ cur: c.cur, tgt: c.tgt });
          if (plan.entries.some((e) => norm.has(e.key) && strip(norm.get(e.key)) !== strip(e))) {
            setPlan((p) => (p === plan ? { ...p, entries: p.entries.map((e) => (norm.has(e.key) ? { ...e, cur: norm.get(e.key).cur, tgt: norm.get(e.key).tgt } : e)) } : p));
          }
        }
      } catch (e) {
        if (g === gameRef.current) showToast(`計算失敗：${errText(e)}`, 'error');
      }
    }, 250);
    return () => clearTimeout(t);
  }, [plan, loaded, gameId, showToast]);

  const updateEntry = useCallback((key, fn) => {
    setPlan((p) => ({ ...p, entries: p.entries.map((e) => (e.key === key ? fn(e) : e)) }));
  }, []);

  const addEntity = async (ent) => {
    try {
      const cfg = await api.plannerDefault(gameId, ent.kind, ent.id);
      setPlan((p) => ({ ...p, entries: [...p.entries, cfg] }));
      setSelected(cfg.key);
      setPicker(null);
    } catch (e) {
      showToast(`無法加入：${errText(e)}`, 'error');
    }
  };
  const removeEntry = (key) => {
    setPlan((p) => ({ ...p, entries: p.entries.filter((e) => e.key !== key) }));
    if (selected === key) setSelected(null);
  };
  const setInventory = (id, n) => setPlan((p) => ({ ...p, inventory: { ...p.inventory, [id]: Math.max(0, Number(n) || 0) } }));

  const entityMap = useMemo(() => new Map((entities || []).map((e) => [`${e.kind}:${e.id}`, e])), [entities]);
  const sel = plan.entries.find((e) => e.key === selected) || null;
  const selModel = sel ? models[`${sel.kind}:${sel.id}`] : null;
  const perEntry = result?.perEntry.find((p) => p.key === selected);

  return (
    <div className="planner">
      {/* 左：養成目標 */}
      <aside className="pl-targets">
        <div className="pl-head">
          <b>養成目標</b>
          <div className="row">
            <button className="btn small" disabled={!entities} onClick={() => setPicker('character')}>＋ 角色</button>
            <button className="btn small" disabled={!entities} onClick={() => setPicker('weapon')}>＋ {WEAPON_LABEL[gameId]}</button>
          </div>
        </div>
        {entErr && <div className="error-text pad">{entErr}</div>}
        {!entities && !entErr && <div className="card-meta pad">{progress ? `下載遊戲資料 ${progress.done}/${progress.total}（${progress.table || ''}）…` : `讀取${gameName}資料中…`}</div>}
        {loaded && !plan.entries.length && <div className="card-meta pad">還沒有目標。按上面的按鈕加入角色或{WEAPON_LABEL[gameId]}，預設會算到全滿。</div>}
        <div className="pl-list">
          {plan.entries.map((e) => {
            const ent = entityMap.get(`${e.kind}:${e.id}`);
            const m = models[`${e.kind}:${e.id}`];
            return (
              <div key={e.key} className={`pl-entry ${selected === e.key ? 'active' : ''}`} onClick={() => setSelected(e.key)} role="button">
                <Icon src={ent?.icon || m?.icon} name={ent?.name || m?.name} />
                <div className="pl-entry-text">
                  <b>{ent?.name || m?.name || e.id}</b>
                  <small>{KIND[e.kind] === '武器' ? WEAPON_LABEL[gameId] : '角色'} · Lv.{e.cur.level}→{e.tgt.level}</small>
                </div>
                <button className="x" title="移除" onClick={(ev) => { ev.stopPropagation(); removeEntry(e.key); }}>×</button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* 中：編輯 */}
      <section className="pl-editor">
        {!sel && <div className="empty">選一個養成目標來設定目前與目標進度</div>}
        {sel && selModel === 'loading' && <div className="empty">讀取養成資料…</div>}
        {sel && selModel?.error && <div className="empty">讀取失敗：{selModel.error}</div>}
        {sel && selModel && selModel !== 'loading' && !selModel.error && (
          <Editor key={sel.key} gameId={gameId} model={selModel} cfg={sel} onChange={(fn) => updateEntry(sel.key, fn)} perEntry={perEntry} />
        )}
      </section>

      {/* 右：資源彙總 */}
      <aside className="pl-summary">
        <div className="pl-head">
          <b>資源彙總</b>
          <div className="seg small">
            <button className={summaryTab === 'short' ? 'active' : ''} onClick={() => setSummaryTab('short')}>缺口</button>
            <button className={summaryTab === 'all' ? 'active' : ''} onClick={() => setSummaryTab('all')}>全部</button>
          </div>
        </div>
        {!result && <div className="card-meta pad">加入目標後會在這裡顯示所需材料</div>}
        {result && (
          <div className="pl-sum-body">
            {result.exp.map((x) => (
              <div key={x.pool} className="exp-box">
                <div className="exp-title"><b>{x.label}</b><span>{fmt(x.need)} EXP</span></div>
                <div className="exp-items">
                  {x.items.map((it) => (
                    <label key={it.id} className="exp-item" title={`${it.name}：每個 ${fmt(it.exp)} EXP`}>
                      <Icon src={it.icon} name={it.name} size={28} />
                      <span className="exp-name">{it.name}</span>
                      <input className="num small" type="number" min="0" value={plan.inventory[it.id] ?? ''} placeholder="持有"
                        onChange={(e) => setInventory(it.id, e.target.value)} />
                    </label>
                  ))}
                </div>
                <div className={`exp-short ${x.shortExp > 0 ? 'bad' : 'ok'}`}>
                  {x.shortExp > 0
                    ? <>還差 {fmt(x.shortExp)} EXP ≈ {x.buy.map((b) => `${b.name}×${fmt(b.count)}`).join(' + ')}</>
                    : '經驗道具足夠 ✓'}
                </div>
              </div>
            ))}
            <div className="mat-list">
              {result.materials
                .filter((m) => !result.expItemIds.includes(m.id))
                .filter((m) => summaryTab === 'all' || m.short > 0)
                .map((m) => (
                  <div key={m.id} className={`mat ${m.short > 0 ? 'short' : 'done'}`}>
                    <div className="mat-row" onClick={() => setOpenMat(openMat === m.id ? null : m.id)} role="button" title="點擊查看用途">
                      <Icon src={m.icon} name={m.name} size={34} className={`r${m.rarity || 0}`} />
                      <div className="mat-text">
                        <b>{m.name}</b>
                        <small>需要 {fmt(m.need)}{m.short > 0 ? <> · <span className="bad">缺 {fmt(m.short)}</span></> : ' · 足夠 ✓'}</small>
                      </div>
                      <input className="num small" type="number" min="0" value={plan.inventory[m.id] ?? ''} placeholder="持有"
                        onClick={(e) => e.stopPropagation()} onChange={(e) => setInventory(m.id, e.target.value)} />
                    </div>
                    {openMat === m.id && (
                      <div className="mat-used">
                        {m.usedBy.map((u, i) => (
                          <div key={i} className="used-row" onClick={() => u.key && !u.key.startsWith('exp:') && setSelected(u.key)} role="button">
                            <span>{u.name}</span><span>{fmt(u.count)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              {summaryTab === 'short' && result.materials.filter((m) => !result.expItemIds.includes(m.id)).every((m) => m.short === 0) && result.materials.length > 0 && (
                <div className="card-meta pad">材料都夠了 🎉（切到「全部」可看總需求）</div>
              )}
            </div>
            {result.notes.length > 0 && <div className="pl-notes">{result.notes.map((n) => <div key={n}>※ {n}</div>)}</div>}
          </div>
        )}
      </aside>

      {picker && (
        <EntityPicker
          kind={picker}
          gameId={gameId}
          entities={(entities || []).filter((e) => e.kind === picker)}
          taken={new Set(plan.entries.map((e) => `${e.kind}:${e.id}`))}
          onPick={addEntity}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

function Editor({ gameId, model, cfg, onChange, perEntry }) {
  const maxStage = model.stages.reduce((m, s) => Math.max(m, s.stage), 0);
  const capOf = (stage) => model.stages.find((s) => s.stage === stage + 1)?.level ?? model.maxLevel;
  const set = (side, patch) => onChange((e) => ({ ...e, [side]: { ...e[side], ...patch } }));
  const setSkill = (side, id, lvl) => onChange((e) => ({ ...e, [side]: { ...e[side], skills: { ...e[side].skills, [id]: lvl } } }));
  const toggleNode = (side, id) => onChange((e) => {
    const has = e[side].nodes.includes(id);
    return { ...e, [side]: { ...e[side], nodes: has ? e[side].nodes.filter((x) => x !== id) : [...e[side].nodes, id] } };
  });
  const maxAll = () => onChange((e) => ({ ...e, tgt: { level: model.maxLevel, stage: maxStage, skills: Object.fromEntries(model.skills.map((s) => [s.id, s.maxLevel])), nodes: model.nodes.map((n) => n.id) } }));
  const tgtEqCur = () => onChange((e) => ({ ...e, tgt: JSON.parse(JSON.stringify(e.cur)) }));
  const groups = useMemo(() => {
    const g = new Map();
    for (const n of model.nodes) { if (!g.has(n.group)) g.set(n.group, []); g.get(n.group).push(n); }
    return [...g.entries()];
  }, [model]);
  // 畫面上顯示的是後端整理過的設定（perEntry.cfg），避免輸入不合法的組合
  const c = perEntry?.cfg || cfg;

  return (
    <div className="editor">
      <div className="ed-head">
        <Icon src={model.icon} name={model.name} size={56} />
        <div>
          <h3>{model.name}</h3>
          <div className="card-meta">{model.kind === 'character' ? '角色' : WEAPON_LABEL[gameId]}{model.rarity ? ` · ${model.rarity}★` : ''} · 最高 Lv.{model.maxLevel}</div>
        </div>
        <div className="spacer" />
        <button className="btn small" onClick={tgtEqCur}>目標＝目前</button>
        <button className="btn small primary" onClick={maxAll}>目標全滿</button>
      </div>

      <table className="ed-table">
        <thead><tr><th></th><th>目前</th><th></th><th>目標</th></tr></thead>
        <tbody>
          <tr>
            <td>等級</td>
            <td><NumberBox value={c.cur.level} min={1} max={model.maxLevel} onChange={(n) => set('cur', { level: n })} /></td>
            <td>→</td>
            <td><NumberBox value={c.tgt.level} min={1} max={model.maxLevel} onChange={(n) => set('tgt', { level: n })} /></td>
          </tr>
          {maxStage > 0 && (
            <tr>
              <td>{STAGE_LABEL[gameId]}</td>
              <td>
                <select className="sel" value={c.cur.stage} onChange={(e) => set('cur', { stage: Number(e.target.value) })}>
                  {Array.from({ length: maxStage + 1 }, (_, s) => <option key={s} value={s}>{s} 階（上限 {capOf(s)}）</option>)}
                </select>
              </td>
              <td>→</td>
              <td>
                <select className="sel" value={c.tgt.stage} onChange={(e) => set('tgt', { stage: Number(e.target.value) })}>
                  {Array.from({ length: maxStage + 1 }, (_, s) => <option key={s} value={s}>{s} 階（上限 {capOf(s)}）</option>)}
                </select>
              </td>
            </tr>
          )}
          {model.skills.map((s) => (
            <tr key={s.id}>
              <td title={s.typeName || ''}>{s.name}{s.typeName && s.typeName !== s.name ? <small className="muted"> · {s.typeName}</small> : null}</td>
              <td><NumberBox value={c.cur.skills[s.id] ?? s.minLevel} min={s.minLevel} max={s.maxLevel} onChange={(n) => setSkill('cur', s.id, n)} /></td>
              <td>→</td>
              <td><NumberBox value={c.tgt.skills[s.id] ?? s.maxLevel} min={s.minLevel} max={s.maxLevel} onChange={(n) => setSkill('tgt', s.id, n)} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {groups.map(([group, nodes]) => (
        <div key={group} className="ed-nodes">
          <div className="ed-group">
            <b>{group}</b>
            <button className="link" onClick={() => onChange((e) => ({ ...e, tgt: { ...e.tgt, nodes: [...new Set([...e.tgt.nodes, ...nodes.map((n) => n.id)])] } }))}>目標全選</button>
            <button className="link" onClick={() => onChange((e) => ({ ...e, cur: { ...e.cur, nodes: e.cur.nodes.filter((x) => !nodes.some((n) => n.id === x)) } }))}>已有全清</button>
          </div>
          <div className="node-grid">
            {nodes.map((n) => {
              const have = c.cur.nodes.includes(n.id);
              const want = c.tgt.nodes.includes(n.id);
              return (
                <div key={n.id} className={`node ${have ? 'have' : want ? 'want' : ''}`}>
                  <span className="node-name" title={n.stage ? `需要第 ${n.stage} 階` : ''}>{n.name}</span>
                  <label title="已經解鎖"><input type="checkbox" checked={have} onChange={() => toggleNode('cur', n.id)} />已有</label>
                  <label title="要算進目標"><input type="checkbox" checked={want || have} disabled={have} onChange={() => toggleNode('tgt', n.id)} />目標</label>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {perEntry && (
        <div className="ed-cost">
          <b>這個目標需要</b>
          <div className="ed-cost-list">
            {Object.entries(perEntry.exp).map(([pool, n]) => <span key={pool} className="chip-s">{fmt(n)} EXP</span>)}
            {perEntry.materials.map((m) => (
              <span key={m.id} className="cost-chip" title={m.name}><Icon src={m.icon} name={m.name} size={22} />{m.name} ×{fmt(m.count)}</span>
            ))}
            {!perEntry.materials.length && !Object.keys(perEntry.exp).length && <span className="card-meta">已達成目標</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function EntityPicker({ kind, gameId, entities, taken, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [rarity, setRarity] = useState('');
  const rarities = [...new Set(entities.map((e) => e.rarityLabel || (e.rarity ? String(e.rarity) : '')).filter(Boolean))].sort().reverse();
  const list = entities.filter((e) => {
    const qq = q.trim().toLowerCase();
    return (!qq || `${e.name} ${e.en || ''}`.toLowerCase().includes(qq)) && (!rarity || (e.rarityLabel || String(e.rarity)) === rarity);
  });
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal picker" onClick={(e) => e.stopPropagation()}>
        <h3>加入{kind === 'character' ? '角色' : WEAPON_LABEL[gameId]}</h3>
        <div className="row">
          <input className="search" autoFocus placeholder="搜尋名稱（中 / 英）" value={q} onChange={(e) => setQ(e.target.value)} />
          {rarities.length > 1 && (
            <select className="sel" value={rarity} onChange={(e) => setRarity(e.target.value)}>
              <option value="">全部稀有度</option>
              {rarities.map((r) => <option key={r} value={r}>{/^\d$/.test(r) ? `${r}★` : `${r} 級`}</option>)}
            </select>
          )}
        </div>
        <div className="pick-grid">
          {list.map((e) => {
            const added = taken.has(`${e.kind}:${e.id}`);
            return (
              <button key={e.id} className={`pick ${added ? 'current' : ''}`} onClick={() => onPick(e)} title={added ? '已在清單中（可再加一份不同目標）' : e.en || ''}>
                <Icon src={e.icon} name={e.name} size={56} className="pick-img" />
                <span>{e.name}</span>
                {e.preview && <span className="badge preview">前瞻</span>}
              </button>
            );
          })}
          {!list.length && <div className="card-meta">沒有符合的項目</div>}
        </div>
        <div className="row end"><button className="btn ghost" onClick={onClose}>關閉</button></div>
      </div>
    </div>
  );
}
