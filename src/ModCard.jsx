import React from 'react';
import { img } from './common.jsx';

/** 本機 MOD 卡片：預覽圖、啟用開關、移動 / 開啟 / 刪除 */
export default function ModCard({ m, busy, uncategorized, suggestedName, onToggle, onMoveSuggested, onPick, onOpen, onTrash, onKeys }) {
  return (
    <article className={`card ${m.enabled ? 'on' : 'off'}`}>
      <div className="thumb" onDoubleClick={onToggle}>
        {m.preview ? <img src={img(m.preview)} alt="" loading="lazy" /> : <div className="noimg">無預覽圖</div>}
        <span className="chip">{m.categoryTw}</span>
        {m.suggestedCategory && (
          <button className="chip suggest" disabled={busy} title={`移入「${m.suggestedCategory}」角色資料夾`} onClick={onMoveSuggested}>
            移入 {suggestedName}
          </button>
        )}
      </div>
      <div className="card-body">
        <div className="card-title" title={m.folderName}>{m.name}</div>
        <div className="card-meta">
          {m.loader === 'eff' ? `EFF${m.effFormat ? ` 格式 ${m.effFormat}` : ''}${m.effId ? ` · id ${m.effId}` : ''}` : `${m.iniCount} 個 ini`} · {new Date(m.mtime).toLocaleDateString()}
        </div>
        <div className="card-actions">
          <label className="switch" title={m.enabled ? '點擊停用' : '點擊啟用'}>
            <input type="checkbox" checked={m.enabled} onChange={onToggle} disabled={busy} />
            <span />
          </label>
          {onPick && <button className="link" onClick={onPick} disabled={busy} title="移到其他角色或分類資料夾">{uncategorized ? '移入…' : '移動…'}</button>}
          {(m.keyCount > 0 || m.controlCount > 0) && onKeys && (
            <button className="link keys-btn" onClick={onKeys} title={m.controlCount ? '查看這個 MOD 的按鍵與滑桿' : '查看這個 MOD 的按鍵設定'}>
              {m.keyCount > 0 && `⌨ ${m.keyCount}`}{m.keyCount > 0 && m.controlCount > 0 ? ' ' : ''}{m.controlCount > 0 && `🎚 ${m.controlCount}`}
            </button>
          )}
          <button className="link" onClick={onOpen} title="在檔案總管開啟">開啟</button>
          <button className="link danger" onClick={onTrash} disabled={busy} title="移到資源回收筒（可從資源回收筒還原）">刪除</button>
        </div>
      </div>
    </article>
  );
}
