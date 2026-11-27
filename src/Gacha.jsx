import React, { useEffect, useMemo, useState } from 'react';

const api = window.modhub;
const UIGF_GAMES = new Set(['SRMI', 'ZZMI']);
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const pad2 = (n) => String(n).padStart(2, '0');
const fmtShort = (t) => {
  if (!t) return '';
  const d = new Date(t);
  return `${String(d.getFullYear()).slice(2)}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const fmtDay = (t) => {
  if (!t) return '';
  const d = new Date(t);
  return `${String(d.getFullYear()).slice(2)}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
};
const fmtFull = (t) => (t ? new Date(t).toLocaleString() : '');
const HOYO = (g) => g === 'ZZMI' || g === 'SRMI';
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`);

const GAME_TEXT = {
  SRMI: { page: '躍遷紀錄', where: '遊戲內「躍遷」→「查看詳情」→「紀錄」', top: '5★', mid: '4★', low: '3★', token: 'authkey', freeText: '免費', bigText: 'UP', noAccount: true },
  EFMI: { page: '尋訪紀錄', where: '遊戲內「尋訪」頁面 →「尋訪紀錄」', top: '6★', mid: '5★', low: '4★', token: 'u8_token', freeText: '加急尋訪', bigText: '當期信物' },
  ZZMI: { page: '調頻紀錄', where: '遊戲內「調頻」→「調頻紀錄」', top: 'S', mid: 'A', low: 'B', token: 'authkey', freeText: '免費', bigText: 'UP' },
};

function luck(pity, max) {
  if (!pity) return 'free';
  const r = pity / (max || 80);
  return r <= 0.5 ? 'good' : r <= 0.8 ? 'mid' : 'bad';
}

function Avatar({ src, name, size = 52, className = '' }) {
  return src
    ? <img className={`g-ava ${className}`} src={src} alt="" style={{ width: size, height: size }} loading="lazy" referrerPolicy="no-referrer" />
    : <div className={`g-ava ph ${className}`} style={{ width: size, height: size }}>{(name || '?').slice(0, 1)}</div>;
}

export default function Gacha({ gameId, gameName, showToast }) {
  const [supported, setSupported] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [vis, setVis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [pasting, setPasting] = useState(false);
  const [groupKey, setGroupKey] = useState('');
  const [detail, setDetail] = useState(null); // { group, banner }
  const [logins, setLogins] = useState(null);
  const [loginBusy, setLoginBusy] = useState('');
  const T = GAME_TEXT[gameId];
  const loggedIn = (logins || []).some((l) => l.loggedIn);

  useEffect(() => { api.gachaSupported().then(setSupported); }, []);
  useEffect(() => api.onGachaProgress((p) => p.gameId === gameId && setProgress(p)), [gameId]);

  const loadVisual = async (id) => {
    setAccountId(id);
    setDetail(null);
    if (!id) { setVis(null); return; }
    const v = await api.gachaVisual(gameId, id);
    setVis(v);
    setGroupKey((k) => (v?.groups.some((g) => g.key === k) ? k : v?.groups[0]?.key || ''));
  };
  const loadAccounts = async (preferId) => {
    const list = await api.gachaAccounts(gameId);
    setAccounts(list);
    await loadVisual(preferId || list[0]?.id || '');
  };
  const refreshLogins = async () => {
    const g = gameId;
    setLogins(null);
    try { const s = await api.gachaLoginStatus(g); if (g === gameId) setLogins(s); } catch { setLogins([]); }
  };

  useEffect(() => {
    setVis(null); setAccounts([]); setAccountId(''); setError(''); setDetail(null); setGroupKey('');
    if (GAME_TEXT[gameId]) { loadAccounts(); refreshLogins(); }
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (url, mode) => {
    setBusy(true);
    setError('');
    setProgress({ stage: mode === 'account' ? '登入帳號' : '讀取連結' });
    try {
      const r = await api.gachaUpdate(gameId, mode ? { mode } : url ? { url } : {});
      showToast(`${r.accounts > 1 ? `已更新 ${r.accounts} 個角色，` : ''}${r.added ? `新增 ${r.added} 筆紀錄` : '已是最新，沒有新紀錄'}`);
      await loadAccounts(r.account.id);
      setPasting(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const doLogin = async (provider) => {
    setLoginBusy(provider);
    try {
      const s = await api.gachaLogin(gameId, provider);
      showToast(s.loggedIn ? `已登入 ${s.label}` : '登入視窗已關閉，尚未登入', s.loggedIn ? 'info' : 'error');
      await refreshLogins();
    } catch (e) { showToast(errText(e), 'error'); } finally { setLoginBusy(''); }
  };
  const doLogout = async (provider) => {
    setLoginBusy(provider);
    try { await api.gachaLogout(gameId, provider); showToast('已登出'); await refreshLogins(); } finally { setLoginBusy(''); }
  };

  if (supported && !supported.includes(gameId)) {
    return <div className="gacha"><div className="empty">{gameName}的抽卡紀錄還不支援（目前支援星鐵、絕區零、終末地）</div></div>;
  }
  if (!T) return null;
  const group = vis?.groups.find((g) => g.key === groupKey) || vis?.groups[0];

  return (
    <div className="gacha">
      <header className="toolbar">
        {accounts.length > 0 && (
          <select className="sel" value={accountId} onChange={(e) => loadVisual(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.uid || a.id}{a.server ? ` · ${a.server}` : ''}</option>)}
          </select>
        )}
        {loggedIn && !T.noAccount && <button className="btn primary" onClick={() => update(null, 'account')} disabled={busy}>{busy ? '更新中…' : '↻ 用帳號更新'}</button>}
        <button className={`btn ${loggedIn && !T.noAccount ? '' : 'primary'}`} onClick={() => update()} disabled={busy}>{busy && (!loggedIn || T.noAccount) ? '更新中…' : '從遊戲更新'}</button>
        <button className="btn" onClick={() => setPasting(true)} disabled={busy}>貼上網址</button>
        <div className="spacer" />
        {progress && <span className="codex-src">{progress.stage}{progress.count != null ? ` · 已讀 ${progress.count} 筆` : ''}</span>}
        <button className="btn" title={UIGF_GAMES.has(gameId) ? '支援 ModHub JSON、UIGF v4 與 SRGF' : 'ModHub JSON'} onClick={async () => {
          try {
            const v = await api.gachaImport(gameId);
            if (!v) return;
            const im = v.imported;
            showToast(im ? `已匯入 UIGF：${im.accounts} 個帳號、新增 ${im.added} 筆${im.skipped ? `（${im.skipped} 筆格式不符略過）` : ''}` : '已匯入');
            loadAccounts(v.account.id);
          } catch (e) { showToast(errText(e), 'error'); }
        }}>匯入</button>
        {vis && <button className="btn" onClick={async () => { try { const p = await api.gachaExport(gameId, accountId); if (p) showToast(`已匯出到 ${p}`); } catch (e) { showToast(errText(e), 'error'); } }}>匯出</button>}
        {vis && UIGF_GAMES.has(gameId) && <button className="btn" title="UIGF v4.0 標準格式，可匯入其他支援 UIGF 的抽卡分析工具" onClick={async () => { try { const p = await api.gachaExport(gameId, accountId, 'uigf'); if (p) showToast(`已匯出 UIGF 到 ${p}`); } catch (e) { showToast(errText(e), 'error'); } }}>匯出 UIGF</button>}
        {HOYO(gameId) && <button className="btn" onClick={() => api.gachaOfficial(gameId)} title={`HoYoLAB 官方${T.page}`}>官方頁面</button>}
      </header>

      <div className="account-bar">
        <b>官方帳號</b>
        {logins === null && <span className="card-meta">檢查登入狀態…</span>}
        {(logins || []).map((l) => (
          <div key={l.provider} className={`acct ${l.loggedIn ? 'on' : ''}`}>
            <span className="acct-name">{l.label}</span>
            {l.loggedIn
              ? <span className="card-meta">已登入{l.roles?.length ? `：${l.roles.map((r) => `${r.name || r.uid}${r.server ? `（${r.server}）` : ''}`).join('、')}` : '（沒有角色）'}</span>
              : <span className="card-meta">未登入</span>}
            {l.loggedIn
              ? <button className="link" disabled={!!loginBusy} onClick={() => doLogout(l.provider)}>登出</button>
              : <button className="btn small" disabled={!!loginBusy} onClick={() => doLogin(l.provider)}>{loginBusy === l.provider ? '登入視窗已開啟…' : '登入'}</button>}
          </div>
        ))}
        <span className="card-meta acct-note" title="帳號密碼只輸入在官方網頁上；ModHub 不保存密碼或 token">🔒 帳密只在官方頁面輸入</span>
      </div>

      <div className="gacha-body g-light">
        {error && (
          <div className="warn-box big">
            {error}
            <div className="steps"><b>怎麼取得：</b>{T.noAccount ? '' : '登入上方官方帳號後按「用帳號更新」；或'}開啟{gameName} → {T.where}，等頁面載入後回到 ModHub 按「從遊戲更新」。</div>
          </div>
        )}

        {!vis && !error && <Intro gameId={gameId} gameName={gameName} T={T} />}

        {vis && !detail && (
          <>
            <div className="g-title">
              <h1>{vis.account.name || '我'} 的抽卡數據統計</h1>
              <div className="g-sub">
                {group?.label || ''} — 更新於 {fmtFull(vis.updatedAt)}
                {vis.totals.source === 'official' && <span className="g-src">含 HoYoLAB 官方統計（全部版本）</span>}
                {vis.totals.history && <span className="g-src">含{vis.totals.history}補充的早期卡池（只有出貨摘要）</span>}
              </div>
            </div>

            <div className="g-stats">
              <div className="g-stat"><b>{vis.totals.pulls.toLocaleString()}{vis.totals.free ? <em>+{vis.totals.free}</em> : null}</b><span>總累計抽數</span></div>
              <div className="g-stat"><b>{pct(vis.totals.topRate)}</b><span>{T.top} 出率（含保底）</span></div>
              <div className="g-stat"><b>{pct(vis.totals.upWin)}</b><span>UP 不歪率</span></div>
            </div>

            <div className="g-tabs">
              {vis.groups.map((g) => (
                <button key={g.key} className={g.key === group?.key ? 'active' : ''} onClick={() => setGroupKey(g.key)}>
                  {g.label}<small>{g.pulls ? g.pulls.toLocaleString() : ''}</small>
                </button>
              ))}
            </div>

            {group && <GroupView group={group} T={T} onOpen={(banner) => setDetail({ group, banner })} />}

            {vis.totals.source === 'records' && HOYO(gameId) && (
              <p className="card-meta center">{gameId === 'ZZMI' ? '提示：登入 HoYoLAB 後按「用帳號更新」，可取得官方統計（全部版本、UP 判定與每期卡池）。' : '提示：'}逐抽紀錄 API 只保留約 6 個月，請定期更新。</p>
            )}
          </>
        )}

        {vis && detail && (
          <BannerDetail gameId={gameId} accountId={accountId} vis={vis} group={detail.group} banner={detail.banner} T={T} onBack={() => setDetail(null)} />
        )}
      </div>

      {pasting && <PasteDialog gameId={gameId} busy={busy} onClose={() => setPasting(false)} onSubmit={update} error={error} T={T} />}
    </div>
  );
}

function Intro({ gameId, gameName, T }) {
  return (
    <div className="gacha-intro">
      <h3>{gameName}{T.page}</h3>
      {!T.noAccount && (
        <>
          <p><b>方法一：登入官方帳號（不用開遊戲）</b></p>
          <ol>
            <li>在上方「官方帳號」按「登入」，會開啟{gameId === 'EFMI' ? '鷹角通行證' : 'HoYoLAB'}官方登入頁，在官方頁面輸入帳號密碼。</li>
            <li>登入後按「↻ 用帳號更新」，帳號底下的每個角色都會自動下載紀錄。</li>
          </ol>
        </>
      )}
      <p><b>{T.noAccount ? '從遊戲讀取' : '方法二：從遊戲讀取'}</b></p>
      <ol>
        <li>開啟遊戲，進入 {T.where}，等紀錄頁面載入完成。</li>
        <li>回到 ModHub 按「從遊戲更新」。</li>
      </ol>
      {T.noAccount && (
        <p className="card-meta">官方不接受 HoYoLAB 登入產生的{T.page}憑證，所以只能從遊戲讀取，或用「貼上網址」貼上遊戲內紀錄頁的網址。上方的 HoYoLAB 登入仍可用於「養成計算」同步。</p>
      )}
      <p className="card-meta">紀錄存在本機，之後只下載新的；token / 連結本身不會被保存。</p>
    </div>
  );
}

/** 一種卡池類型：最近幾期大欄位 + 過往卡池速覽 */
function GroupView({ group, T, onOpen }) {
  const main = group.banners.slice(0, 3);
  const past = group.banners.slice(3);
  return (
    <>
      <div className="g-cols">
        {main.map((b, i) => (
          <div key={b.id} className="g-col">
            <div className="g-col-head" onClick={() => onOpen(b)} role="button" title="查看這期的逐抽紀錄">
              <b>{b.name}{b.version ? <small> {b.version}</small> : null}</b>
              <span>
                {b.pulls != null ? <>總計 <b>{b.pulls - (b.free || 0)}</b>{b.free ? <> + <em>{b.free}</em></> : null} 抽</> : `${b.tops.reduce((s, t) => s + t.count, 0)} 個 ${T.top}`}
                {b.current ? <span className="g-live">進行中</span> : null}
                {b.history ? <span className="g-src" title={b.note || ''}>{b.history}{b.note ? ' ⚠' : ''}</span> : <span className="g-more">逐抽 ›</span>}
              </span>
            </div>

            {i === 0 && b.current && (
              <div className="g-next">
                <div className="g-q">?</div>
                <div>
                  <small>距下一次 {T.top}</small>
                  <b>剩餘 {Math.max(0, group.pityMax - group.pityNow)} 抽必得</b>
                  {group.bigPity && (
                    <small className="g-big">
                      {group.bigPity.gotUp ? `本期已獲得 UP` : `本期已付費 ${group.bigPity.paid} 抽，剩餘 ${group.bigPity.remaining} 抽可獲得${T.bigText}`}
                    </small>
                  )}
                  <small>目前已墊 {group.pityNow} 抽</small>
                </div>
              </div>
            )}
            {!(i === 0 && b.current) && b.pad > 0 && (
              <div className="g-pad"><span>已墊 {b.pad} 抽</span><small>{fmtShort(b.end)}</small></div>
            )}

            {b.entries.map((e, k) => (e.type === 'top' ? (
              <div key={k} className={`g-hit ${e.isUp === false ? 'off' : ''}`}>
                <Avatar src={e.icon} name={e.name} />
                <div className="g-hit-name">
                  <b>{e.name}</b>
                  {e.isUp === false && <span className="g-wai">歪</span>}
                  {e.free && <span className="g-freetag">{T.freeText}</span>}
                </div>
                <div className="g-hit-num">
                  <b className={luck(e.pity, group.pityMax)}>{e.free ? '—' : e.pity}</b>
                  {e.nth && b.pulls != null ? <small>該池第 {e.nth} 抽</small> : null}
                  <small>{fmtShort(e.time)}</small>
                </div>
              </div>
            ) : e.type === 'free' ? (
              <div key={k} className="g-freebar"><span>已使用 {e.count} 抽{T.freeText}</span><small>{fmtShort(e.time)}</small></div>
            ) : null))}

            {!b.entries.some((e) => e.type === 'top') && <div className="g-empty">這期還沒有出 {T.top}</div>}
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <>
          <h3 className="g-h3">過往卡池速覽</h3>
          <div className="g-past">
            {past.map((b) => (
              <div key={b.id} className="g-past-card" onClick={() => onOpen(b)} role="button">
                <div className="g-past-head">
                  <b>{b.name}{b.history ? <span className="g-src" title={b.note || ''}>{b.history}{b.note ? ' ⚠' : ''}</span> : null}</b>
                  <small>{b.version ? `v${b.version} · ` : ''}{b.pulls != null ? `總計 ${b.pulls - (b.free || 0)}${b.free ? ` + ${b.free}` : ''} 抽` : ''}</small>
                </div>
                <div className="g-past-tops">
                  {b.tops.length ? b.tops.map((t, k) => (
                    <span key={k} className="g-past-top" title={t.name}>
                      <Avatar src={t.icon} name={t.name} size={38} />
                      {t.isUp === false && <i className="g-wai mini">歪</i>}
                      <small>x{t.count}</small>
                    </span>
                  )) : <span className="card-meta">沒有 {T.top}</span>}
                </div>
                <small className="g-past-date">{fmtDay(b.end || b.start)}</small>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** 單一卡池：出貨紀錄 + 逐抽格子 */
function BannerDetail({ gameId, accountId, vis, group, banner, T, onBack }) {
  const [grid, setGrid] = useState(null);
  const [tier, setTier] = useState('');
  useEffect(() => {
    let alive = true;
    if (banner.history) { setGrid([]); return () => {}; }
    const opts = gameId === 'EFMI'
      ? (group.key === 'weapon' ? { isWeaponGroup: true, bannerId: banner.id } : { pool: group.key, bannerId: banner.id })
      : gameId === 'SRMI' ? { pool: group.key, bannerId: banner.bannerId || undefined }
        : { pool: group.pool || group.key };
    api.gachaGrid(gameId, accountId, opts).then((g) => {
      if (!alive) return;
      // 絕區零：官方卡池沒有 id 對應，依時間區間篩選（有時間的話）
      let list = g;
      if (gameId === 'ZZMI' && banner.start && banner.end && banner.start < banner.end) list = g.filter((x) => x.time >= banner.start - 3600000 && x.time <= banner.end + 3600000);
      setGrid(list);
    });
    return () => { alive = false; };
  }, [gameId, accountId, group, banner]);
  const shown = useMemo(() => (grid || []).filter((x) => !tier || x.tier === tier), [grid, tier]);
  const tops = banner.entries.filter((e) => e.type === 'top');

  return (
    <div className="g-detail">
      <button className="btn" onClick={onBack}>‹ 返回總覽</button>
      <div className="g-title">
        <h1>{banner.name}{banner.version ? <small> v{banner.version}</small> : null}</h1>
        <div className="g-sub">{group.label} · {fmtDay(banner.start)}{banner.end ? ` – ${fmtDay(banner.end)}` : ''}</div>
      </div>
      <div className="g-stats">
        <div className="g-stat"><b>{banner.pulls != null ? <>{banner.pulls - (banner.free || 0)}{banner.free ? <em>+{banner.free}</em> : null}</> : '—'}</b><span>當期總抽數</span></div>
        <div className="g-stat"><b>{tops.length}</b><span>{T.top} 數量</span></div>
        <div className="g-stat"><b>{tops.filter((t) => t.isUp !== null).length ? pct(tops.filter((t) => t.isUp).length / tops.filter((t) => t.isUp !== null).length) : '—'}</b><span>本期 UP 不歪率</span></div>
      </div>

      {banner.upList?.length > 0 && (
        <div className="g-uplist">
          <span>本期 UP</span>
          {banner.upList.map((u) => <span key={u.name} className="g-up"><Avatar src={u.icon} name={u.name} size={34} />{u.name}</span>)}
        </div>
      )}

      {tops.length > 0 && (
        <div className="g-hitrow">
          {tops.map((e, k) => (
            <div key={k} className={`g-hit small ${e.isUp === false ? 'off' : ''}`}>
              <Avatar src={e.icon} name={e.name} size={44} />
              <div className="g-hit-name"><b>{e.name}</b>{e.isUp === false && <span className="g-wai">歪</span>}</div>
              <div className="g-hit-num"><b className={luck(e.pity, group.pityMax)}>{e.free ? '—' : e.pity}</b><small>{fmtShort(e.time)}</small></div>
            </div>
          ))}
        </div>
      )}

      <div className="g-grid-head">
        <b>逐抽紀錄</b>
        <span className="card-meta">{grid ? `${shown.length} 抽` : '讀取中…'}</span>
        <div className="seg small">
          {[['', '全部'], ['top', T.top], ['mid', T.mid], ['low', T.low]].map(([k, l]) => <button key={k} className={tier === k ? 'active' : ''} onClick={() => setTier(k)}>{l}</button>)}
        </div>
        {HOYO(gameId) && <span className="card-meta">（官方逐抽紀錄只保留約 6 個月）</span>}
      </div>
      {grid && !shown.length && <div className="g-empty">{banner.history ? `這期來自${banner.history}，只有出貨摘要，沒有逐抽紀錄` : "沒有可顯示的逐抽紀錄"}</div>}
      <div className="g-grid">
        {shown.map((x) => (
          <div key={x.id} className={`g-cell g-${x.tier}`} title={`${x.banner || ''} ${fmtFull(x.time)}`}>
            <Avatar src={x.icon} name={x.name} size={46} />
            <div className="g-cell-text">
              <b>{x.name}</b>
              <small>{fmtDay(x.time)}</small>
            </div>
            <div className="g-cell-num">
              <b>{x.free ? '免' : x.n}</b>
              <small>T{x.t}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PasteDialog({ busy, onClose, onSubmit, error, T }) {
  const [url, setUrl] = useState('');
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>貼上紀錄網址</h3>
        <p className="card-meta">貼上含 {T.token}=… 的{T.page}網址。網址只用來這次下載，不會被保存。請勿把網址分享給別人。</p>
        <textarea className="paste" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        {error && <div className="error-text">{error}</div>}
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy || !url.trim()} onClick={() => onSubmit(url.trim())}>{busy ? '下載中…' : '下載紀錄'}</button>
        </div>
      </div>
    </div>
  );
}
