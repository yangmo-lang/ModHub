import React, { useEffect, useRef, useState } from 'react';
import { api } from './common.jsx';

/**
 * 內嵌互動地圖（<webview>，主程序限制只能載入地圖網域、獨立登入分區）
 * 主視窗與疊加介面共用；compact = 疊加介面用的精簡工具列
 */
export default function MapView({ gameId, compact = false }) {
  const [maps, setMaps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');
  const ref = useRef(null);
  const map = maps?.[gameId];

  useEffect(() => { api.mapsList().then(setMaps).catch(() => setMaps({})); }, []);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return undefined;
    const onStart = () => { setLoading(true); setFailed(''); };
    const onStop = () => setLoading(false);
    // -3 = 被取消（換頁），不算失敗
    const onFail = (e) => { if (e.isMainFrame && e.errorCode !== -3) setFailed(e.errorDescription || `錯誤 ${e.errorCode}`); };
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-fail-load', onFail);
    return () => {
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-fail-load', onFail);
    };
  }, [map]);

  if (!maps) return <div className="empty">讀取中…</div>;
  if (!map) return <div className="empty">這個遊戲還沒有互動地圖</div>;

  const wv = () => ref.current;
  return (
    <div className={`mapview ${compact ? 'compact' : ''}`}>
      <div className="map-bar">
        <button className="btn small" onClick={() => wv()?.canGoBack() && wv().goBack()} title="上一頁">←</button>
        <button className="btn small" onClick={() => wv()?.reload()} title="重新整理">↻</button>
        <button className="btn small" onClick={() => wv()?.loadURL(map.url)} title="回到地圖首頁">⌂</button>
        {!compact && <span className="map-title">{map.name}</span>}
        {loading && <span className="map-status">載入中…</span>}
        {failed && <span className="map-status error">載入失敗：{failed}</span>}
        <div className="spacer" />
        <span className="map-credit">資料與地圖來自 {map.site}</span>
        <button className="link" onClick={() => api.openExternal(map.url)}>在瀏覽器開啟</button>
      </div>
      <webview ref={ref} className="map-frame" src={map.url} partition="persist:zmdmap" />
    </div>
  );
}
