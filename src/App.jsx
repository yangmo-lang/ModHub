import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Online from './Online.jsx';
import Codex from './Codex.jsx';
import Blueprint from './Blueprint.jsx';
import Planner from './Planner.jsx';
import Gacha from './Gacha.jsx';
import Presets from './Presets.jsx';
import { JobsPanel, InstallDialog } from './Jobs.jsx';
import Picker from './Picker.jsx';
import ModCard from './ModCard.jsx';
import Settings, { useUpdate, UpdateBar } from './Settings.jsx';
import { api, img, errText, metaLine, Avatar } from './common.jsx';

const ALL = '__all__';
const UNCAT = '未分類';
const SOURCE_LABEL = { 'nanoka.cc': 'nanoka', 'wiki.skland.com': '森空島 wiki' };

function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, kind = 'info') => setToast({ msg, kind, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, show];
}

const SORTS = [
  ['release', '實裝（新→舊）'],
  ['rarity', '星級'],
  ['name', '名稱'],
  ['mods', 'MOD 數量'],
];

function sortChars(list, sort, getMeta, getName, getCount) {
  const arr = [...list];
  const byName = (a, b) => getName(a).localeCompare(getName(b), 'zh-Hant');
  const order = (x) => getMeta(x)?.order ?? 0;
  if (sort === 'name') arr.sort(byName);
  else if (sort === 'rarity') arr.sort((a, b) => (getMeta(b)?.rarity || 0) - (getMeta(a)?.rarity || 0) || order(b) - order(a));
  else if (sort === 'mods') arr.sort((a, b) => getCount(b) - getCount(a) || byName(a, b));
  else arr.sort((a, b) => order(b) - order(a) || byName(a, b));
  return arr;
}

export default function App() {
  const [state, setState] = useState(null);
  const [gameId, setGameId] = useState(null);
  const [data, setData] = useState({ categories: [], mods: [] });
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [xxmiOk, setXxmiOk] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [sort, setSort] = useState('release');
  const [facet, setFacet] = useState({ element: '', role: '', rarity: '', hasMods: false });
  const [picker, setPicker] = useState(null); // { mode: 'map', category } | { mode: 'move', mod }
  const [view, setView] = useState('local'); // 'local' | 'online' | 'codex'
  const [onlineSeed, setOnlineSeed] = useState(null); // 從圖鑑「找 MOD」帶過去的搜尋字
  const [jobs, setJobs] = useState([]);
  const [installing, setInstalling] = useState(null); // job
  const [dragOver, setDragOver] = useState(false);
  const [showAdult, setShowAdultState] = useState(false);
  const [toast, showToast] = useToast();
  const update = useUpdate();
  const [updateHidden, setUpdateHidden] = useState(false);

  // 下載 / 安裝佇列
  const openInstall = (j) => {
    if (j.gameId !== gameRef.current) setGameId(j.gameId);
    setInstalling(j);
  };
  const installingRef = useRef(null);
  installingRef.current = installing;
  useEffect(() => {
    api.listJobs().then(setJobs);
    const offU = api.onJobUpdate((j) => {
      setJobs((prev) => {
        const i = prev.findIndex((x) => x.id === j.id);
        const was = i >= 0 ? prev[i].status : null;
        // 剛解壓完 → 自動跳出安裝確認
        if (j.status === 'ready' && was !== 'ready' && !installingRef.current && !j.error) setTimeout(() => openInstall(j), 0);
        if (j.status === 'error' && was !== 'error') showToast(`${j.title}：${j.error}`, 'error');
        return i >= 0 ? prev.map((x) => (x.id === j.id ? j : x)) : [j, ...prev];
      });
    });
    const offR = api.onJobRemoved((id) => setJobs((prev) => prev.filter((x) => x.id !== id)));
    const offF = api.onJobFocus(() => setView('online'));
    return () => { offU(); offR(); offF(); };
  }, [showToast]);

  const setShowAdult = (v) => {
    setShowAdultState(v);
    api.saveSettings({ showAdult: v });
  };
  const autoSynced = useRef(new Set());
  const gameRef = useRef(null);
  gameRef.current = gameId;

  useEffect(
    () => api.onCharProgress((p) => {
      // 只更新由介面發起、仍在進行中的同步
      setSyncing((s) => (s && s.gameId === p.gameId && p.gameId === gameRef.current ? { gameId: p.gameId, done: p.done, total: p.total } : s));
    }),
    [],
  );

  const loadState = useCallback(async () => {
    const s = await api.getState();
    setState(s);
    api.xxmiAvailable().then(setXxmiOk).catch(() => setXxmiOk(false));
    setShowAdultState(Boolean(s.settings.showAdult));
    setGameId((cur) => cur || s.settings.lastGame || s.games[0].id);
  }, []);
  useEffect(() => { loadState(); }, [loadState]);

  // 一律掃描「目前」選中的遊戲；切換遊戲後才回來的舊結果直接丟掉
  // silent：資料夾自動監看觸發的掃描，不顯示「掃描中」也不跳錯誤提示
  const rescan = useCallback(async (opts) => {
    const g = gameRef.current;
    if (!g) return;
    const silent = opts?.silent === true;
    if (!silent) setBusy(true);
    try {
      const d = await api.scan(g);
      if (g === gameRef.current) setData({ ...d, gameId: g });
    } catch (e) {
      if (g === gameRef.current && !silent) showToast(errText(e), 'error');
    } finally {
      if (g === gameRef.current && !silent) setBusy(false);
    }
  }, [showToast]);

  // 在檔案總管新增 / 刪除 / 改名 MOD 後自動更新清單
  useEffect(
    () => api.onModsChanged(({ gameId: g }) => { if (g === gameRef.current) rescan({ silent: true }); }),
    [rescan],
  );

  useEffect(() => {
    setCategory(ALL);
    setQuery('');
    setSyncing(null);
    setBusy(false);
    setFacet({ element: '', role: '', rarity: '', hasMods: false });
    setData({ categories: [], mods: [] });
    setShowPresets(false);
    rescan();
    if (gameId) api.saveSettings({ lastGame: gameId });
    if (gameId && gameId !== 'EFMI') setView((v) => (v === 'blueprint' ? 'local' : v));
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncChars = useCallback(async (silent = false) => {
    const g = gameRef.current;
    setSyncing({ gameId: g, done: 0, total: 0 });
    try {
      const r = await api.syncCharacters(g);
      if (!silent || r.failed) showToast(`已同步圖鑑（${r.version}）：${r.count} 位角色${r.failed ? `，${r.failed} 張頭像下載失敗` : ''}`, r.failed ? 'error' : 'info');
    } catch (e) {
      showToast(`同步圖鑑失敗：${errText(e)}`, 'error');
    } finally {
      setSyncing((s) => (s && s.gameId === g ? null : s));
      if (g === gameRef.current) rescan();
    }
  }, [rescan, showToast]);

  // 第一次打開某遊戲且沒有圖鑑快取時，自動同步一次
  useEffect(() => {
    if (!gameId || busy || syncing || data.missing || data.gameId !== gameId) return;
    if (data.charDbSupported && !data.charDb && !autoSynced.current.has(gameId) && data.modsDir) {
      autoSynced.current.add(gameId);
      syncChars(true);
    }
  }, [data, gameId, busy, syncing, syncChars]);

  const game = state?.games.find((g) => g.id === gameId);
  const q = query.trim().toLowerCase();
  const facetActive = Boolean(facet.element || facet.role || facet.rarity);

  // 篩選選項（從圖鑑資料產生）
  const facetOptions = useMemo(() => {
    const chars = data.allCharacters || [];
    const uniq = (k) => [...new Set(chars.map((c) => c.meta?.[k]).filter(Boolean))];
    return {
      element: uniq('element'),
      role: uniq('role'),
      rarity: uniq('rarity').sort((a, b) => b - a),
    };
  }, [data.allCharacters]);

  const passFacet = useCallback((meta) => {
    if (!facetActive) return true;
    if (!meta) return false;
    if (facet.element && meta.element !== facet.element) return false;
    if (facet.role && meta.role !== facet.role) return false;
    if (facet.rarity && String(meta.rarity) !== facet.rarity) return false;
    return true;
  }, [facet, facetActive]);

  const catMatchesQuery = useCallback(
    (c) => !q || `${c.name} ${c.displayName} ${c.character?.en || ''}`.toLowerCase().includes(q)
      || data.mods.some((m) => m.category === c.name && m.name.toLowerCase().includes(q)),
    [q, data.mods],
  );

  const { charCats, otherCats } = useMemo(() => {
    const real = data.categories.filter((c) => !c.virtual);
    let charCats = real.filter((c) => c.character && passFacet(c.character.meta) && catMatchesQuery(c));
    if (facet.hasMods) charCats = charCats.filter((c) => c.total > 0);
    charCats = sortChars(charCats, sort, (c) => c.character.meta, (c) => c.displayName, (c) => c.total);
    const otherCats = facetActive ? [] : data.categories.filter((c) => (!c.character || c.virtual) && catMatchesQuery(c) && (!facet.hasMods || c.total > 0));
    return { charCats, otherCats };
  }, [data, sort, facet.hasMods, facetActive, passFacet, catMatchesQuery]);

  const missingChars = useMemo(() => {
    if (facet.hasMods) return [];
    const list = (data.missingCharacters || []).filter(
      (c) => passFacet(c.meta) && (!q || `${c.name} ${c.nameTw} ${c.en}`.toLowerCase().includes(q)),
    );
    return sortChars(list, sort === 'mods' ? 'release' : sort, (c) => c.meta, (c) => c.nameTw, () => 0);
  }, [data.missingCharacters, sort, facet.hasMods, passFacet, q]);

  const visibleCatNames = useMemo(() => new Set([...charCats, ...otherCats].map((c) => c.name)), [charCats, otherCats]);

  const visibleMods = useMemo(() => data.mods.filter((m) => {
    if (category !== ALL && m.category !== category) return false;
    if (category === ALL && (facetActive || facet.hasMods) && !visibleCatNames.has(m.category)) return false;
    if (filter === 'on' && !m.enabled) return false;
    if (filter === 'off' && m.enabled) return false;
    if (q && !(`${m.name} ${m.category} ${m.categoryTw}`.toLowerCase().includes(q))) return false;
    return true;
  }), [data.mods, category, filter, q, facetActive, facet.hasMods, visibleCatNames]);

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) showToast(okMsg);
    } catch (e) {
      showToast(errText(e), 'error');
    } finally {
      await rescan();
    }
  };

  const toggle = (m) => act(() => api.setEnabled(gameId, m.path, !m.enabled), `${m.enabled ? '已停用' : '已啟用'}：${m.name}（遊戲內按 F10 重新載入）`);
  // 刪除 = 移到資源回收筒（主程序會先跳確認視窗）；按取消就不顯示訊息
  const trash = async (m) => {
    let ok = false;
    await act(async () => { ok = await api.trashMod(gameId, m.path); });
    if (ok) showToast(`已將「${m.name}」移到資源回收筒`);
  };
  const createCat = (c) => act(() => api.createCategory(gameId, c.id), `已建立角色資料夾：${c.nameTw}`);
  const fillCovers = () => act(async () => {
    const n = await api.fillCovers(gameId);
    showToast(n ? `已為 ${n} 個角色資料夾補上 _cover 頭像` : '所有角色資料夾都已有封面');
  });

  const applyMapping = (cat, charId) => act(
    () => api.setMapping(gameId, cat.name, charId),
    charId === null ? `「${cat.name}」改回自動辨識` : charId === '__none__' ? `「${cat.name}」標記為非角色分類` : `「${cat.name}」已手動對應角色`,
  );
  const moveMod = (mod, target, label) => act(() => api.moveToCategory(gameId, mod.path, target), `已將 ${mod.name} 移入「${label}」`);

  const coversToFill = data.categories.filter((c) => !c.hasOwnCover && c.character?.avatar).length;
  const roleLabel = data.charDb?.roleLabel || '類型';

  const installFiles = async (paths) => {
    if (!paths.length) return;
    try {
      const r = await api.installFromPaths(gameId, paths);
      showToast(`準備安裝 ${r.length} 個壓縮檔到「${game?.name}」`);
    } catch (e) {
      showToast(errText(e), 'error');
    }
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    installFiles([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean));
  };
  const dismissJob = (j) => api.cancelJob(j.id);
  const launchGame = async (gui) => {
    setLaunching(true);
    try {
      await api.xxmiLaunch(gameId, { gui });
      showToast(gui ? `已開啟 XXMI Launcher（${game?.short}）` : `正在透過 XXMI 啟動「${game?.name}」…`);
    } catch (e) {
      showToast(errText(e), 'error');
    } finally {
      setTimeout(() => setLaunching(false), 3000); // 避免連點重複啟動
    }
  };
  const gameNames = Object.fromEntries((state?.games || []).map((g) => [g.id, g.short]));

  if (!state) return <div className="loading">載入中…</div>;
  const totalOn = data.mods.filter((m) => m.enabled).length;

  const CatRow = ({ c }) => (
    <div className={`cat ${category === c.name ? 'active' : ''}`} onClick={() => setCategory(c.name)} role="button">
      <Avatar src={c.cover} name={c.displayName} />
      <div className="cat-text">
        <b title={c.name !== c.displayName ? `資料夾：${c.name}` : c.name}>
          {c.displayName}
          {c.character?.meta?.preview && <span className="badge preview">前瞻</span>}
          {c.manual && <span className="badge manual" title="手動對應">手動</span>}
        </b>
        <small>{c.enabled}/{c.total}{c.character ? ` · ${metaLine(c.character.meta) || c.character.en}` : ''}</small>
      </div>
      {c.enabled > 1 && c.character && <span className="warn" title="同一角色啟用了多個 MOD，可能互相衝突">!</span>}
      {!c.virtual && data.charDb && (
        <button className="edit" title="手動對應角色" onClick={(e) => { e.stopPropagation(); setPicker({ mode: 'map', category: c }); }}>✎</button>
      )}
    </div>
  );

  return (
    <div
      className={`app ${dragOver ? 'drag' : ''} ${view === 'planner' || view === 'gacha' || view === 'blueprint' ? 'no-cats' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.relatedTarget) setDragOver(false); }}
      onDrop={onDrop}
    >
      {dragOver && <div className="drop-hint">放開以安裝到「{game?.name}」（zip / 7z / rar）</div>}
      <nav className="games">
        <div className="brand">Mod<span>Hub</span></div>
        {state.games.map((g) => (
          <button key={g.id} className={`game ${g.id === gameId ? 'active' : ''} ${g.available ? '' : 'missing'}`}
            onClick={() => setGameId(g.id)} title={`${g.name}${g.available ? '' : `（找不到 ${g.modsDir}）`}`}>
            {g.logo
              ? <img className="game-logo" src={img(g.logo)} alt={g.name} draggable="false" />
              : <span className={`game-logo game-badge badge-${g.id.toLowerCase()}`} title="找不到 XXMI Launcher 的遊戲圖塊，請在設定確認 XXMI 資料夾">{g.short}</span>}
            <span className="game-id">{g.short}</span>
          </button>
        ))}
        <div className="spacer" />
        <button className="game settings-btn" onClick={() => setShowSettings(true)}>⚙ 設定</button>
      </nav>

      <aside className="cats">
        <div className="cats-head">
          <h2>{game?.name}</h2>
          <p>{data.mods.length} 個 MOD · {totalOn} 個啟用</p>
          {data.charDbSupported && (
            <div className="chardb">
              <span title={data.charDb ? `同步於 ${new Date(data.charDb.syncedAt).toLocaleString()}` : ''}>
                {syncing
                  ? `同步圖鑑中… ${syncing.total ? `${syncing.done}/${syncing.total}` : ''}`
                  : data.charDb
                    ? `${SOURCE_LABEL[data.charDb.source] || data.charDb.source} 圖鑑 ${data.charDb.version} · ${data.charDb.count} 位`
                    : '尚未同步角色圖鑑'}
              </span>
              <div className="chardb-actions">
                <button className="link" onClick={() => syncChars(false)} disabled={!!syncing}>↻ 同步</button>
                {coversToFill > 0 && (
                  <button className="link" onClick={fillCovers} disabled={busy} title="把圖鑑頭像存成角色資料夾的 _cover（QAQ 也看得到）">補 {coversToFill} 個封面</button>
                )}
              </div>
            </div>
          )}
          {data.charDb && (
            <div className="facets">
              <select value={sort} onChange={(e) => setSort(e.target.value)} title="排序">
                {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <select value={facet.rarity} onChange={(e) => setFacet((f) => ({ ...f, rarity: e.target.value }))}>
                <option value="">全部星級</option>
                {facetOptions.rarity.map((r) => <option key={r} value={String(r)}>{r}★</option>)}
              </select>
              <select value={facet.element} onChange={(e) => setFacet((f) => ({ ...f, element: e.target.value }))}>
                <option value="">全部屬性</option>
                {facetOptions.element.map((x) => <option key={x}>{x}</option>)}
              </select>
              <select value={facet.role} onChange={(e) => setFacet((f) => ({ ...f, role: e.target.value }))}>
                <option value="">全部{roleLabel}</option>
                {facetOptions.role.map((x) => <option key={x}>{x}</option>)}
              </select>
              <label className="check"><input type="checkbox" checked={facet.hasMods} onChange={(e) => setFacet((f) => ({ ...f, hasMods: e.target.checked }))} />只看有 MOD</label>
              {(facetActive || facet.hasMods) && <button className="link" onClick={() => setFacet({ element: '', role: '', rarity: '', hasMods: false })}>清除</button>}
            </div>
          )}
        </div>
        <div className="cat-list">
          <div className={`cat ${category === ALL ? 'active' : ''}`} onClick={() => setCategory(ALL)} role="button">
            <div className="cat-cover all">全</div>
            <div className="cat-text"><b>全部</b><small>{visibleMods.length}</small></div>
          </div>
          {charCats.map((c) => <CatRow key={c.name} c={c} />)}
          {otherCats.length > 0 && charCats.length > 0 && <div className="section-label">其他分類</div>}
          {otherCats.map((c) => <CatRow key={c.name} c={c} />)}
          {missingChars.length > 0 && (
            <button className="missing-toggle" onClick={() => setShowMissing((v) => !v)}>
              {showMissing ? '▾' : '▸'} 尚未建立資料夾的角色（{missingChars.length}）
            </button>
          )}
          {showMissing && missingChars.map((c) => (
            <div key={c.id} className="cat ghost">
              <Avatar src={c.avatar} name={c.nameTw} />
              <div className="cat-text">
                <b>{c.nameTw}{c.meta?.preview && <span className="badge preview">前瞻</span>}</b>
                <small>{metaLine(c.meta) || c.en}</small>
              </div>
              <button className="add" onClick={() => createCat(c)} disabled={busy} title={`在 Mods 建立「${c.name}」資料夾並放入頭像`}>＋</button>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="viewtabs">
          <button className={view === 'local' ? 'active' : ''} onClick={() => setView('local')}>本機 MOD</button>
          <button className={view === 'online' ? 'active' : ''} onClick={() => setView('online')}>線上下載</button>
          <button className={view === 'codex' ? 'active' : ''} onClick={() => setView('codex')}>圖鑑 / 前瞻</button>
          <button className={view === 'planner' ? 'active' : ''} onClick={() => setView('planner')}>養成計算</button>
          <button className={view === 'gacha' ? 'active' : ''} onClick={() => setView('gacha')}>抽卡紀錄</button>
          {gameId === 'EFMI' && <button className={view === 'blueprint' ? 'active' : ''} onClick={() => setView('blueprint')}>藍圖</button>}
          <div className="spacer" />
          <button className="btn small" onClick={async () => { const r = await api.pickArchives(gameId); if (r.length) showToast(`準備安裝 ${r.length} 個壓縮檔`); }}>📦 從壓縮檔安裝</button>
          {xxmiOk && (
            <span className="launch-group">
              <button className="btn small primary" onClick={() => launchGame(false)} disabled={launching}
                title="與 XXMI 的 Quick Start 捷徑相同：載入 MOD 並啟動遊戲">{launching ? '啟動中…' : `▶ 啟動${game?.short || ''}`}</button>
              <button className="btn small" onClick={() => launchGame(true)} disabled={launching} title="開啟 XXMI Launcher 視窗">XXMI</button>
            </span>
          )}
        </div>
        {view === 'blueprint' && gameId === 'EFMI' ? (
          <Blueprint showToast={showToast} />
        ) : view === 'gacha' ? (
          <Gacha gameId={gameId} gameName={game?.name || ''} showToast={showToast} />
        ) : view === 'planner' ? (
          <Planner gameId={gameId} gameName={game?.name || ''} showToast={showToast} />
        ) : view === 'codex' ? (
          <Codex
            gameId={gameId}
            gameName={game?.name || ''}
            categories={data.categories}
            onShowLocal={(name) => { setView('local'); setCategory(name); }}
            onFindMods={(term) => { setOnlineSeed({ term, n: Date.now() }); setView('online'); }}
          />
        ) : view === 'online' ? (
          <Online gameId={gameId} characters={data.allCharacters || []} showAdult={showAdult} setShowAdult={setShowAdult} showToast={showToast} seed={onlineSeed} />
        ) : (
        <>
        <header className="toolbar">
          <input className="search" placeholder="搜尋角色或 MOD 名稱（繁簡皆可）…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="seg">
            {[['all', '全部'], ['on', '已啟用'], ['off', '已停用']].map(([k, label]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
          <button className="btn" onClick={rescan} disabled={busy}>{busy ? '掃描中…' : '↻ 重新掃描'}</button>
          {!data.missing && data.modsDir && <button className="btn" onClick={() => setShowPresets(true)} disabled={busy} title="儲存或切換一組 MOD 的啟用狀態">🗂 預設組合</button>}
          {data.modsDir && <button className="btn" onClick={() => api.openPath(gameId, data.modsDir)}>📂 Mods 資料夾</button>}
        </header>

        {data.missing ? (
          <div className="empty">找不到 Mods 資料夾：<code>{data.modsDir}</code><br />請到「設定」確認 XXMI Launcher 路徑。</div>
        ) : visibleMods.length === 0 ? (
          <div className="empty">{busy ? '掃描中…' : '沒有符合條件的 MOD'}</div>
        ) : (
          <div className="grid">
            {visibleMods.map((m) => (
              <ModCard key={m.id} m={m} busy={busy} uncategorized={m.category === UNCAT}
                suggestedName={m.suggestedCategory && (data.allCharacters?.find((c) => c.id === m.suggestedCharId)?.nameTw || m.suggestedCategory)}
                onToggle={() => toggle(m)}
                onMoveSuggested={() => moveMod(m, { charId: m.suggestedCharId }, m.suggestedCategory)}
                onPick={() => setPicker({ mode: 'move', mod: m })}
                onOpen={() => api.openPath(gameId, m.path)}
                onTrash={() => trash(m)} />
            ))}
          </div>
        )}
        </>
        )}
      </main>

      <JobsPanel jobs={jobs} gameNames={gameNames} onInstall={openInstall} onDismiss={dismissJob} />

      {installing && (
        <InstallDialog
          key={installing.id}
          job={installing}
          characters={installing.gameId === data.gameId ? data.allCharacters || [] : []}
          categories={installing.gameId === data.gameId ? data.categories : []}
          onClose={() => setInstalling(null)}
          onDone={(p) => {
            setInstalling(null);
            showToast(`已安裝到 ${p}（遊戲內按 F10 重新載入）`);
            if (installing.gameId === gameId) rescan();
          }}
        />
      )}

      {picker && (
        <Picker
          picker={picker}
          characters={data.allCharacters || []}
          categories={data.categories.filter((c) => !c.virtual)}
          onClose={() => setPicker(null)}
          onMap={(charId) => { applyMapping(picker.category, charId); setPicker(null); }}
          onMove={(target, label) => { moveMod(picker.mod, target, label); setPicker(null); }}
        />
      )}

      {showPresets && (
        <Presets
          gameId={gameId}
          gameName={game?.name || ''}
          enabledCount={totalOn}
          showToast={showToast}
          onClose={() => setShowPresets(false)}
          onApplied={(p, r) => {
            setShowPresets(false);
            const parts = [`啟用 ${r.enabled}`, `停用 ${r.disabled}`];
            if (r.missing.length) parts.push(`${r.missing.length} 個找不到`);
            if (r.errors.length) showToast(`已套用「${p.name}」，但有 ${r.errors.length} 個 MOD 失敗：${r.errors[0]}`, 'error');
            else showToast(`已套用「${p.name}」：${parts.join('、')}（遊戲內按 F10 重新載入）`);
            rescan();
          }}
        />
      )}

      {showSettings && (
        <Settings settings={state.settings} onClose={() => setShowSettings(false)}
          onSave={async (patch) => { await api.saveSettings(patch); await loadState(); setShowSettings(false); rescan(); }} />
      )}

      {!updateHidden && <UpdateBar update={update} onHide={() => setUpdateHidden(true)} />}

      {toast && <div key={toast.id} className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
