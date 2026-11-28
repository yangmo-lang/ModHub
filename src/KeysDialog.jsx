import React, { useEffect, useMemo, useState } from 'react';
import { api, errText } from './common.jsx';

/** 一個 MOD 的按鍵設定（ini 的 [Key…] 區段）：哪個鍵會切換什麼 */
export default function KeysDialog({ gameId, mod, onClose, compact = false }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [showPad, setShowPad] = useState(false);

  useEffect(() => {
    api.modKeys(gameId, mod.path).then(setList).catch((e) => { setErr(errText(e)); setList([]); });
  }, [gameId, mod.path]);

  // EFF 的滑桿（[ControlN]）另外列
  const controls = useMemo(() => (list || []).filter((b) => b.kind === 'control'), [list]);
  // 依 ini 檔分組；只有一個檔時不顯示檔名
  const groups = useMemo(() => {
    const m = new Map();
    for (const b of (list || []).filter((x) => x.kind !== 'control')) {
      if (!m.has(b.file)) m.set(b.file, []);
      m.get(b.file).push(b);
    }
    return [...m.entries()];
  }, [list]);
  const hasPad = (list || []).some((b) => b.keys?.some((k) => k.gamepad));
  const fmt = (v) => (v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(2));

  const keyChips = (keys) => keys
    .filter((k) => showPad || !k.gamepad || keys.every((x) => x.gamepad))
    .map((k, i) => <kbd key={i} className={k.gamepad ? 'pad' : ''} title={k.raw}>{k.text}</kbd>);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal keys-modal ${compact ? 'compact' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h3>{controls.length && !groups.length ? '滑桿設定' : '按鍵設定'}：{mod.name}</h3>
        <p className="card-meta">
          從 MOD 的 ini 讀出（[Key…] 區段）。在遊戲裡按下對應按鍵切換；{mod.enabled ? '' : '這個 MOD 目前停用中，啟用並按 F10 後才有作用；'}
          有「條件」的按鍵只在條件成立時有效（例如角色在畫面上）。
        </p>
        {hasPad && <label className="check"><input type="checkbox" checked={showPad} onChange={(e) => setShowPad(e.target.checked)} />顯示手把按鍵</label>}
        {err && <div className="error-text">{err}</div>}
        {!list && <div className="empty">讀取中…</div>}
        {list && !list.length && !err && <div className="empty">這個 MOD 沒有設定按鍵或滑桿</div>}
        <div className="keys-list">
          {controls.length > 0 && (
            <section className="ctl-section">
              <h4 className="ctl-title">滑桿（EFF：遊戲內按 Insert 開面板調整，數值存在 state.ini）</h4>
              {controls.map((c) => {
                const v = c.value ?? c.default;
                const pct = v === null || c.max === c.min ? 0 : Math.max(0, Math.min(100, ((v - c.min) / (c.max - c.min)) * 100));
                return (
                  <div key={c.section} className="ctl-row" title={`${c.section} · ${c.variable}`}>
                    <div className="ctl-head">
                      <b>{c.label}</b>
                      <code>{c.variable.replace(/^\$/, '')}</code>
                      <span className="ctl-val">{fmt(v)}{c.value === null && c.default !== null ? '（預設）' : ''}</span>
                    </div>
                    <div className="ctl-bar"><span style={{ width: `${pct}%` }} /></div>
                    <div className="ctl-range"><span>{fmt(c.min)}</span><span>{fmt(c.max)}</span></div>
                  </div>
                );
              })}
            </section>
          )}
          {groups.map(([file, binds]) => (
            <section key={file}>
              {groups.length > 1 && <h4 title={file}>{file}</h4>}
              {compact ? binds.map((b) => (
                // 疊加介面（窄）：一個按鍵一張小卡
                <div key={`${b.section}:${b.line}`} className="keys-item">
                  <div className="keys-cell">
                    {keyChips(b.keys)}
                    {b.back.length > 0 && <span className="keys-back">反向 {keyChips(b.back)}</span>}
                  </div>
                  <div><b>{b.label}</b> <small className="muted">{b.typeLabel}</small></div>
                  {b.vars.map((v) => (
                    <div key={v.name} className="keys-vals"><code>{v.name.replace(/^\$/, '')}</code>{v.values.length ? `：${v.values.join(' → ')}` : ''}</div>
                  ))}
                  {b.condition && <div className="keys-cond" title={b.condition}>條件：{b.condition}</div>}
                </div>
              )) : (
              <table className="keys-table">
                <thead><tr><th>按鍵</th><th>功能</th><th>方式</th><th>切換的值</th></tr></thead>
                <tbody>
                  {binds.map((b) => (
                    <tr key={`${b.section}:${b.line}`}>
                      <td className="keys-cell">
                        {keyChips(b.keys)}
                        {b.back.length > 0 && <span className="keys-back">反向 {keyChips(b.back)}</span>}
                      </td>
                      <td>
                        <b>{b.label}</b>
                        {b.label !== b.section && <small className="muted"> [{b.section}]</small>}
                        {b.condition && <div className="keys-cond" title={b.condition}>條件：{b.condition}</div>}
                      </td>
                      <td className="nowrap">{b.typeLabel}</td>
                      <td>
                        {b.vars.map((v) => (
                          <div key={v.name} title={v.name}>
                            <code>{v.name.replace(/^\$/, '')}</code>{v.values.length ? `：${v.values.join(' → ')}${v.values.length > 1 && b.type === 'cycle' ? ' ↺' : ''}` : ''}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </section>
          ))}
        </div>
        <div className="row end">
          <button className="btn" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}
