import React, { useEffect, useMemo, useState } from 'react';

const api = window.modhub;
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const fmtDate = (t) => (t ? new Date(t).toLocaleDateString() : '');
// 卡池 / 活動：月/日 時:分（本機時區）
const fmtTime = (t) => (t ? new Date(t).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
function poolStatus(p, now = Date.now()) {
  if (p.unannounced) return { cls: 'soon', text: '時間未公布' };
  if (p.start && p.start > now) return { cls: 'soon', text: '即將開始' };
  if (p.end && p.end <= now) return { cls: 'ended', text: '已結束' };
  return { cls: 'live', text: '進行中' };
}
const PREVIEW = '__preview__';

function rarityText(it) {
  if (it.rarityLabel) return `${it.rarityLabel} 級`;
  return it.rarity ? '★'.repeat(Math.min(it.rarity, 6)) : '';
}
function metaText(it) {
  return [it.element, it.role, ...(it.extraTags || [])].filter(Boolean).join(' · ');
}
function timeLeft(start, end) {
  const now = Date.now();
  if (start && start > now) return `${Math.ceil((start - now) / 86400000)} 天後開始`;
  if (end && end > now) {
    const d = Math.floor((end - now) / 86400000);
    const h = Math.floor(((end - now) % 86400000) / 3600000);
    return d > 0 ? `剩 ${d} 天 ${h} 小時` : `剩 ${h} 小時`;
  }
  return end ? '已結束' : '';
}

export default function Codex({ gameId, gameName, categories, onShowLocal, onFindMods }) {
  const [codex, setCodex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(PREVIEW);
  const [q, setQ] = useState('');
  const [facet, setFacet] = useState({ rarity: '', element: '', role: '' });
  const [selected, setSelected] = useState(null);
  const gameRef = React.useRef(gameId);
  gameRef.current = gameId;

  const load = async (force = false) => {
    const g = gameId;
    setLoading(true);
    setError('');
    try {
      const d = await api.codexGet(g, force);
      if (g === gameRef.current) setCodex(d);
    } catch (e) {
      if (g === gameRef.current) setError(errText(e));
    } finally {
      if (g === gameRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setCodex(null);
    setTab(PREVIEW);
    setQ('');
    setFacet({ rarity: '', element: '', role: '' });
    load(false);
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  const modCount = useMemo(() => {
    const m = new Map();
    for (const c of categories || []) if (c.character) m.set(c.character.id, { total: c.total, name: c.name });
    return m;
  }, [categories]);

  const section = codex?.sections.find((s) => s.kind === tab);
  const options = useMemo(() => {
    const items = section?.items || [];
    const uniq = (f) => [...new Set(items.map(f).filter(Boolean))];
    return { rarity: uniq((i) => (i.rarityLabel ? i.rarityLabel : i.rarity ? String(i.rarity) : null)).sort().reverse(), element: uniq((i) => i.element), role: uniq((i) => i.role) };
  }, [section]);

  const visible = useMemo(() => {
    if (!section) return [];
    const qq = q.trim().toLowerCase();
    return section.items.filter((i) =>
      (!qq || `${i.name} ${i.zh} ${i.en}`.toLowerCase().includes(qq))
      && (!facet.rarity || (i.rarityLabel || String(i.rarity)) === facet.rarity)
      && (!facet.element || i.element === facet.element)
      && (!facet.role || i.role === facet.role));
  }, [section, q, facet]);

  const previewCount = codex ? codex.preview.groups.reduce((n, g) => n + g.items.length, 0) : 0;

  return (
    <div className="codex">
      <header className="toolbar codex-bar">
        <div className="seg scroll">
          <button className={tab === PREVIEW ? 'active' : ''} onClick={() => setTab(PREVIEW)}>
            前瞻{previewCount ? `（${previewCount}）` : ''}
          </button>
          {codex?.sections.map((s) => (
            <button key={s.kind} className={tab === s.kind ? 'active' : ''} onClick={() => { setTab(s.kind); setFacet({ rarity: '', element: '', role: '' }); }}>
              {s.label}（{s.items.length}）
            </button>
          ))}
        </div>
        {tab !== PREVIEW && (
          <>
            <input className="search" placeholder="搜尋名稱（中 / 英）" value={q} onChange={(e) => setQ(e.target.value)} />
            {options.rarity.length > 1 && (
              <select className="sel" value={facet.rarity} onChange={(e) => setFacet((f) => ({ ...f, rarity: e.target.value }))}>
                <option value="">全部稀有度</option>
                {options.rarity.map((r) => <option key={r} value={r}>{/^\d$/.test(r) ? `${r}★` : `${r} 級`}</option>)}
              </select>
            )}
            {options.element.length > 1 && (
              <select className="sel" value={facet.element} onChange={(e) => setFacet((f) => ({ ...f, element: e.target.value }))}>
                <option value="">全部屬性</option>
                {options.element.map((x) => <option key={x}>{x}</option>)}
              </select>
            )}
            {options.role.length > 1 && (
              <select className="sel" value={facet.role} onChange={(e) => setFacet((f) => ({ ...f, role: e.target.value }))}>
                <option value="">全部類型</option>
                {options.role.map((x) => <option key={x}>{x}</option>)}
              </select>
            )}
          </>
        )}
        <div className="spacer" />
        {codex && (
          <span className="codex-src" title={`更新於 ${new Date(codex.fetchedAt).toLocaleString()}`}>
            {codex.source === 'nanoka.cc' ? 'nanoka.cc' : '森空島 wiki'}
            {codex.versions ? ` · 正式服 ${codex.versions.live}${codex.versions.hasBeta ? ` / 前瞻 ${codex.versions.latest}` : ''}` : ''}
          </span>
        )}
        <button className="btn" onClick={() => load(true)} disabled={loading}>{loading ? '更新中…' : '↻ 更新'}</button>
        {codex && <button className="btn" onClick={() => api.openExternal(codex.siteUrl)}>網站</button>}
      </header>

      <div className="codex-body">
        {error && <div className="empty">讀取圖鑑失敗：{error}</div>}
        {!codex && !error && <div className="empty">{loading ? `正在讀取${gameName}圖鑑…` : ''}</div>}

        {codex && tab === PREVIEW && (
          <PreviewPage codex={codex} modCount={modCount} onSelect={setSelected} />
        )}

        {codex && tab !== PREVIEW && (
          <div className="codex-grid">
            {visible.map((it) => <ItemCard key={it.id} it={it} mods={modCount.get(it.id)} onClick={() => setSelected(it)} />)}
            {!visible.length && <div className="empty">沒有符合條件的項目</div>}
          </div>
        )}
      </div>

      {selected && (
        <ItemDetail
          gameId={gameId}
          it={selected}
          mods={modCount.get(selected.id)}
          onClose={() => setSelected(null)}
          onShowLocal={(name) => { setSelected(null); onShowLocal(name); }}
          onFindMods={(term) => { setSelected(null); onFindMods(term); }}
        />
      )}
    </div>
  );
}

function ItemCard({ it, mods, onClick }) {
  return (
    <button className={`codex-card r${it.rarity || 0}`} onClick={onClick}>
      <div className="codex-icon">
        {it.icon ? <img src={it.icon} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{it.name.slice(0, 1)}</span>}
        {it.preview && <span className="badge preview abs">前瞻</span>}
        {it.up && <span className="badge up abs">UP</span>}
        {mods?.total > 0 && <span className="badge mods" title="本機 MOD 數">{mods.total}</span>}
      </div>
      <div className="codex-name" title={it.name}>{it.name}</div>
      <div className="codex-rarity">{rarityText(it)}</div>
      <div className="codex-meta">{metaText(it)}</div>
    </button>
  );
}

function PreviewPage({ codex, modCount, onSelect }) {
  const p = codex.preview;
  const nothing = !p.groups.length && !p.pools.length && !p.activities.length && !p.news.length;
  const itemById = useMemo(() => {
    const m = new Map();
    for (const s of codex.sections) for (const it of s.items) m.set(`${it.kind}:${it.id}`, it);
    return m;
  }, [codex]);
  return (
    <div className="preview-page">
      <p className="preview-note">{p.note}</p>
      {nothing && <div className="empty">目前沒有前瞻內容</div>}

      {p.groups.map((g) => (
        <section key={g.kind} className="pv-section">
          <h3>{g.label}<span>{g.items.length}</span></h3>
          <div className="codex-grid">
            {g.items.map((it) => <ItemCard key={it.id} it={it} mods={modCount.get(it.id)} onClick={() => onSelect(it)} />)}
          </div>
        </section>
      ))}

      {p.pools.length > 0 && (
        <section className="pv-section">
          <h3>{codex.gameId === 'EFMI' ? '目前卡池' : '近期與未來卡池'}<span>{p.pools.length}</span></h3>
          <div className="pool-list">
            {p.pools.map((pool, i) => {
              const st = poolStatus(pool);
              return (
                <div key={i} className={`pool ${st.cls}`}>
                  <div className="pool-head">
                    <b>{pool.name}</b>
                    <span className={`pool-status ${st.cls}`}>{st.text}</span>
                    <small>
                      {pool.type}
                      {!pool.unannounced && <> · {fmtTime(pool.start)} – {fmtTime(pool.end)}{pool.projected ? '（預估）' : ''} · {timeLeft(pool.start, pool.end)}</>}
                    </small>
                  </div>
                  <div className="pool-items">
                    {pool.items.map((x, j) => {
                      const ref = x.id && itemById.get(`${x.kind}:${x.id}`);
                      return (
                        <button key={j} className="pool-item" onClick={() => (ref ? onSelect(ref) : x.url && api.openExternal(x.url))} title={x.name}>
                          {x.icon && <img src={x.icon} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                          <span>{x.name}{x.up ? ' · UP' : ''}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {p.activities.length > 0 && (
        <section className="pv-section">
          <h3>活動<span>{p.activities.length}</span></h3>
          <div className="activity-list">
            {p.activities.map((a, i) => (
              <button key={i} className="activity" onClick={() => a.url && api.openExternal(a.url)}>
                {a.pic && <img src={a.pic} alt="" referrerPolicy="no-referrer" />}
                <div>
                  <b>{a.name}</b>
                  <small>{a.type} · {fmtTime(a.start)} – {fmtTime(a.end)} · {timeLeft(a.start, a.end)}</small>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {p.news.length > 0 && (
        <section className="pv-section">
          <h3>官方情報<span>{p.news.length}</span></h3>
          <div className="news-list">
            {p.news.map((n, i) => (
              <button key={i} className="news" onClick={() => api.openExternal(n.url)}>
                {n.pic && <img src={n.pic} alt="" referrerPolicy="no-referrer" />}
                <div><b>{n.name}</b><small>{fmtDate(n.date)}</small></div>
              </button>
            ))}
          </div>
        </section>
      )}

      {(p.scheduleSources?.length > 0 || p.scheduleErrors?.length > 0) && (
        <p className="preview-sources">
          {p.scheduleSources?.length > 0 && <>卡池與活動時間來源：{p.scheduleSources.map((s, i) => (
            <React.Fragment key={s.url}>{i > 0 && '、'}<button className="link" onClick={() => api.openExternal(s.url)}>{s.name}</button></React.Fragment>
          ))}（社群整理，時間以遊戲內公告為準）</>}
          {p.scheduleErrors?.map((e) => <span key={e} className="error-text"> 讀取失敗：{e}</span>)}
        </p>
      )}
    </div>
  );
}

function ItemDetail({ gameId, it, mods, onClose, onShowLocal, onFindMods }) {
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    api.codexDetail(gameId, it.kind, it.id).then((d) => alive && setDetail(d || {})).catch((e) => alive && setErr(errText(e)));
    return () => { alive = false; };
  }, [gameId, it]);
  const desc = detail?.desc || it.desc || (detail ? it.descEn : '');
  const isChar = it.kind === 'character';
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal codex-detail" onClick={(e) => e.stopPropagation()}>
        <div className="cd-portrait">
          {it.portrait ? <img src={it.portrait} alt="" referrerPolicy="no-referrer" /> : <div className="noimg">無圖片</div>}
        </div>
        <div className="cd-info">
          <div className="cd-head">
            <div>
              <h3>{it.name}{it.preview && <span className="badge preview">前瞻</span>}{it.up && <span className="badge up">UP</span>}</h3>
              <div className="card-meta">{[it.en, it.zh !== it.name ? it.zh : ''].filter(Boolean).join(' · ')}</div>
            </div>
            <button className="btn ghost" onClick={onClose}>關閉</button>
          </div>
          <div className="cd-chips">
            {rarityText(it) && <span className="chip-s">{rarityText(it)}</span>}
            {it.element && <span className="chip-s">{it.element}</span>}
            {it.role && <span className="chip-s">{it.role}</span>}
            {(it.extraTags || []).map((t) => <span key={t} className="chip-s">{t}</span>)}
            {it.release && <span className="chip-s">實裝 {fmtDate(it.release)}</span>}
          </div>
          {detail?.facts?.length > 0 && (
            <dl className="facts">
              {detail.facts.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
            </dl>
          )}
          {!detail && !err && <div className="card-meta">讀取中文資料…</div>}
          {err && <div className="error-text">{err}</div>}
          {detail?.effect && (
            <div className="effect">
              <b>{detail.effect.name}</b>
              <p>{detail.effect.desc}</p>
            </div>
          )}
          {desc && <div className="desc">{desc}</div>}
          {it.skins?.length > 0 && (
            <>
              <h4>外觀</h4>
              <div className="skins">
                {it.skins.map((s) => (
                  <div key={s.id} className="skin" title={s.desc}>
                    {s.image && <img src={s.image} alt="" referrerPolicy="no-referrer" />}
                    <span>{s.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="row cd-actions">
            {isChar && mods && <button className="btn" onClick={() => onShowLocal(mods.name)}>本機 MOD（{mods.total}）</button>}
            {isChar && <button className="btn primary" onClick={() => onFindMods(it.en || it.zh || it.name)}>找 MOD</button>}
            {it.url && <button className="btn" onClick={() => api.openExternal(it.url)}>在網站查看</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
