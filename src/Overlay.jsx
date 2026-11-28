import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, errText, img } from './common.jsx';
import MapView from './MapView.jsx';
import KeysDialog from './KeysDialog.jsx';

const VIEW_KEY = 'modhub.overlayView';
const MODE_KEY = 'modhub.overlayMode';
const HAS_MAP = new Set(['EFMI']); // 有內嵌互動地圖的遊戲

/**
 * 遊戲內疊加介面（快捷鍵叫出的置頂小面板）
 * 只做遊戲中最常用的事：搜尋、開關 MOD、切換預設組合；改完在遊戲內按 F10 重新載入
 */
export default function Overlay() {
  const [games, setGames] = useState([]);
  const [gameId, setGameId] = useState(null);
  const [running, setRunning] = useState(null); // 叫出時偵測到正在執行的遊戲
  const [data, setData] = useState(null);
  const [presetList, setPresetList] = useState([]);
  const [presetId, setPresetId] = useState('');
  const [query, setQuery] = useState('');
  const [onlyOn, setOnlyOn] = useState(false);
  const [view, setViewState] = useState(() => localStorage.getItem(VIEW_KEY) || 'grid'); // grid = 圖片、list = 清單
  const setView = (v) => { setViewState(v); localStorage.setItem(VIEW_KEY, v); };
  const [mode, setModeState] = useState(() => localStorage.getItem(MODE_KEY) || 'mods'); // mods | map
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setMode = (m) => { setModeState(m); localStorage.setItem(MODE_KEY, m); };
  const [busy, setBusy] = useState(false);
  const [keysFor, setKeysFor] = useState(null); // 顯示按鍵設定的 MOD
  const keysRef = useRef(null);
  keysRef.current = keysFor;
  const [msg, setMsg] = useState(null); // { text, kind }
  const [hotkey, setHotkey] = useState('');
  const searchRef = useRef(null);
  const gameRef = useRef(null);
  gameRef.current = gameId;

  const load = useCallback(async (g) => {
    if (!g) return;
    try {
      const [d, ps] = await Promise.all([api.scan(g), api.presetList(g).catch(() => [])]);
      if (g !== gameRef.current) return;
      setData(d);
      setPresetList(ps);
    } catch (e) {
      setMsg({ text: errText(e), kind: 'error' });
    }
  }, []);

  useEffect(() => {
    api.getState().then((s) => setGames(s.games)).catch(() => {});
    api.overlayGetHotkey().then((h) => setHotkey(h.hotkey || '')).catch(() => {});
    const off = api.onOverlayShow(({ gameId: g, detected: det }) => {
      setRunning(det ? g : null);
      setMsg(null);
      setQuery('');
      setKeysFor(null);
      setGameId(g);
      load(g);
      api.overlaySetWide(HAS_MAP.has(g) && modeRef.current === 'map').catch(() => {});
      api.overlayGetHotkey().then((h) => setHotkey(h.hotkey || '')).catch(() => {});
      setTimeout(() => searchRef.current?.focus(), 50);
    });
    const offChanged = api.onModsChanged(({ gameId: g }) => { if (g === gameRef.current) load(g); });
    // Esc：先關按鍵視窗，再按一次才收起面板
    const onKey = (e) => { if (e.key !== 'Escape') return; if (keysRef.current) setKeysFor(null); else api.overlayHide(); };
    window.addEventListener('keydown', onKey);
    return () => { off(); offChanged(); window.removeEventListener('keydown', onKey); };
  }, [load]);

  const switchGame = (g) => {
    api.overlaySetWide(HAS_MAP.has(g) && mode === 'map').catch(() => {});
    setGameId(g);
    setData(null);
    setPresetId('');
    load(g);
  };

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { setMsg({ text: errText(e), kind: 'error' }); } finally { setBusy(false); load(gameRef.current); }
  };

  const toggle = (m) => run(async () => {
    await api.setEnabled(gameId, m.path, !m.enabled);
    setMsg({ text: `已${m.enabled ? '停用' : '啟用'}「${m.name}」，回遊戲按 F10 重新載入`, kind: 'info' });
  });

  const applyPreset = () => run(async () => {
    const p = presetList.find((x) => x.id === presetId);
    if (!p) return;
    const r = await api.presetApply(gameId, p.id);
    const changed = (r.enabled || 0) + (r.disabled || 0);
    setMsg({
      text: changed ? `已套用「${p.name}」：啟用 ${r.enabled}、停用 ${r.disabled}，回遊戲按 F10 重新載入` : `「${p.name}」和目前狀態相同`,
      kind: r.errors?.length ? 'error' : 'info',
    });
  });

  const groups = useMemo(() => {
    if (!data?.mods) return [];
    const q = query.trim().toLowerCase();
    const byCat = new Map();
    const catInfo = new Map((data.categories || []).map((c) => [c.name, c]));
    for (const m of data.mods) {
      if (onlyOn && !m.enabled) continue;
      if (q && !`${m.name} ${m.category} ${m.categoryTw}`.toLowerCase().includes(q)) continue;
      if (!byCat.has(m.category)) byCat.set(m.category, { name: m.categoryTw || m.category, cover: catInfo.get(m.category)?.cover || null, mods: [] });
      byCat.get(m.category).mods.push(m);
    }
    return [...byCat.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  }, [data, query, onlyOn]);

  // 絕區零一條龍：啟動第三方工具 OneDragon（設定裡選資料夾與跑完動作）
  const runOneDragon = () => {
    // 遊戲沒開時 ModHub 會先透過 XXMI 開遊戲，要等一陣子；先收起面板，結果顯示在主視窗
    setMsg({ text: '一條龍準備中（遊戲沒開會先透過 XXMI 開遊戲），面板即將收起', kind: 'info' });
    api.odRun().catch((e) => setMsg({ text: errText(e), kind: 'error' }));
    setTimeout(() => api.overlayHide(), 1500);
  };

  // 終末地：啟動第三方工具 MaaEnd（主畫面「終末地 → 自動每日」設定實例）
  const runMaaEnd = () => {
    setMsg({ text: 'MaaEnd 準備中（遊戲沒開會先透過 XXMI 開遊戲），面板即將收起', kind: 'info' });
    api.meRun().catch((e) => setMsg({ text: errText(e), kind: 'error' }));
    setTimeout(() => api.overlayHide(), 1500);
  };

  const pickMode = (m) => { setMode(m); api.overlaySetWide(m === 'map').catch(() => {}); };
  const showMap = HAS_MAP.has(gameId) && mode === 'map';

  const game = games.find((g) => g.id === gameId);
  const total = data?.mods?.length || 0;
  const enabled = data?.mods?.filter((m) => m.enabled).length || 0;

  return (
    <div className="ov">
      <header className="ov-head">
        {/* 不用原生下拉選單：它的彈出視窗會讓面板失去焦點而收起 */}
        <div className="ov-games">
          {games.map((g) => (
            <button key={g.id} className={g.id === gameId ? 'active' : ''} onClick={() => g.id !== gameId && switchGame(g.id)} title={g.name}>{g.short || g.name}</button>
          ))}
        </div>
        {running === gameId && <span className="ov-badge" title="依正在執行的遊戲程序判斷">遊戲中</span>}
        {HAS_MAP.has(gameId) && (
          <div className="ov-games">
            <button className={!showMap ? 'active' : ''} onClick={() => pickMode('mods')}>MOD</button>
            <button className={showMap ? 'active' : ''} onClick={() => pickMode('map')}>地圖</button>
          </div>
        )}
        {!showMap && <span className="ov-count">{enabled}/{total} 啟用</span>}
        {gameId === 'ZZMI' && (
          <button className="ov-od" disabled={busy} onClick={runOneDragon} title="用 OneDragon 執行絕區零一條龍（自動每日）；任務與設定在主畫面「絕區零 → 自動每日」">▶ 一條龍</button>
        )}
        {gameId === 'EFMI' && (
          <button className="ov-od" disabled={busy} onClick={runMaaEnd} title="用 MaaEnd 執行終末地自動每日；實例與設定在主畫面「終末地 → 自動每日」">▶ MaaEnd</button>
        )}
        <div className="spacer" />
        <button className="link" onClick={() => api.overlayOpenMain()} title="開啟 ModHub 主視窗">主視窗</button>
        <button className="ov-close" onClick={() => api.overlayHide()} title="收起（Esc）">✕</button>
      </header>

      {showMap ? <>
        <MapView gameId={gameId} compact />
        <footer className="ov-foot">地圖模式點回遊戲不會收起 · 按 {hotkey ? <kbd>{hotkey}</kbd> : null}{hotkey ? ' 或 ' : ''}右上角 ✕ 收起</footer>
      </> : <>
      <div className="ov-tools">
        <input ref={searchRef} className="search" placeholder="搜尋角色或 MOD…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} />只看啟用</label>
        <div className="ov-view">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title="圖片">▦</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title="清單">☰</button>
        </div>
      </div>

      {presetList.length > 0 && (
        <div className="ov-presets">
          <span>預設組合</span>
          {presetList.map((p) => (
            <button key={p.id} className={`ov-chip ${p.id === presetId ? 'active' : ''}`} onClick={() => setPresetId(p.id === presetId ? '' : p.id)} title={`${p.count} 個啟用的 MOD`}>{p.name}</button>
          ))}
          {presetId && <button className="btn small primary" disabled={busy} onClick={applyPreset}>套用</button>}
        </div>
      )}

      {msg && <div className={`ov-msg ${msg.kind}`}>{msg.text}</div>}

      <div className="ov-list">
        {!data && <div className="empty">讀取中…</div>}
        {data?.missing && <div className="empty">找不到 Mods 資料夾</div>}
        {data && !data.missing && groups.length === 0 && <div className="empty">沒有符合條件的 MOD</div>}
        {groups.map((g) => (
          <section key={g.name} className="ov-group">
            <h4>
              {g.cover ? <img className="ov-avatar" src={img(g.cover)} alt="" /> : <span className="ov-avatar">{g.name.slice(0, 1)}</span>}
              <b>{g.name}</b>
              <span>{g.mods.filter((m) => m.enabled).length}/{g.mods.length}</span>
            </h4>
            {view === 'grid' ? (
              <div className="ov-grid">
                {g.mods.map((m) => (
                  <button key={m.id} className={`ov-card ${m.enabled ? 'on' : 'off'}`} disabled={busy} onClick={() => toggle(m)}
                    title={`${m.folderName}（點一下${m.enabled ? '停用' : '啟用'}）`}>
                    {m.preview ? <img src={img(m.preview)} alt="" loading="lazy" /> : <div className="ov-noimg">無預覽圖</div>}
                    <span className="ov-state">{m.enabled ? '啟用' : '停用'}</span>
                    {m.keyCount > 0 && <KeysBadge m={m} onOpen={setKeysFor} />}
                    <span className="ov-card-name">{m.name}</span>
                  </button>
                ))}
              </div>
            ) : g.mods.map((m) => (
              <label key={m.id} className={`ov-mod ${m.enabled ? 'on' : 'off'}`} title={m.folderName}>
                {m.preview ? <img className="ov-thumb" src={img(m.preview)} alt="" loading="lazy" /> : <span className="ov-thumb" />}
                <span className="ov-name">{m.name}</span>
                {m.keyCount > 0 && <KeysBadge m={m} onOpen={setKeysFor} />}
                <span className="switch">
                  <input type="checkbox" checked={m.enabled} disabled={busy} onChange={() => toggle(m)} />
                  <span />
                </span>
              </label>
            ))}
          </section>
        ))}
      </div>

      {keysFor && <KeysDialog gameId={gameId} mod={keysFor} compact onClose={() => setKeysFor(null)} />}

      <footer className="ov-foot">
        改完回遊戲按 <kbd>F10</kbd> 重新載入 · <kbd>Esc</kbd>{hotkey ? <> 或 <kbd>{hotkey}</kbd></> : null} 收起
        {game && !running && <span className="ov-hint">　沒偵測到執行中的遊戲，顯示 {game.short || game.name}</span>}
      </footer>
      </>}
    </div>
  );
}

/** 卡片 / 清單上的「⌨ 按鍵數」：點了看按鍵，不會切換 MOD */
function KeysBadge({ m, onOpen }) {
  const open = (e) => { e.preventDefault(); e.stopPropagation(); onOpen(m); };
  return (
    <span className="ov-keys" role="button" tabIndex={0} title="查看按鍵設定" onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }}>⌨ {m.keyCount}</span>
  );
}
