import React, { useState } from 'react';
import { Avatar } from './common.jsx';

/** 選角色：手動對應分類資料夾，或把未分類 MOD 移進去 */
export default function Picker({ picker, characters, categories, onClose, onMap, onMove }) {
  const [q, setQ] = useState('');
  const isMap = picker.mode === 'map';
  const title = isMap ? `「${picker.category.name}」對應哪個角色？` : `把「${picker.mod.name}」移到…`;
  const qq = q.trim().toLowerCase();
  const list = characters.filter((c) => !qq || `${c.name} ${c.nameTw} ${c.en}`.toLowerCase().includes(qq));
  const otherCats = isMap ? [] : categories.filter((c) => !c.character && (!qq || `${c.name} ${c.displayName}`.toLowerCase().includes(qq)));
  // 移動時標出 MOD 目前所在的分類
  const curCat = isMap ? null : categories.find((c) => c.name === picker.mod.category);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal picker" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input className="search" autoFocus placeholder="搜尋角色（中文 / 英文）" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pick-grid">
          {list.map((c) => {
            const current = isMap ? picker.category.character?.id === c.id : curCat?.character?.id === c.id;
            return (
              <button key={c.id} className={`pick ${current ? 'current' : ''}`} onClick={() => (isMap ? onMap(c.id) : onMove({ charId: c.id }, c.nameTw))}>
                <Avatar src={c.avatar} name={c.nameTw} className="pick-img" />
                <span>{c.nameTw}</span>
              </button>
            );
          })}
          {otherCats.map((c) => (
            <button key={c.name} className={`pick ${curCat?.name === c.name ? 'current' : ''}`} onClick={() => onMove({ categoryName: c.name }, c.displayName)}>
              <Avatar src={c.cover} name={c.displayName} className="pick-img" />
              <span>{c.displayName}</span>
            </button>
          ))}
        </div>
        <div className="row end">
          {isMap && picker.category.manual && <button className="btn" onClick={() => onMap(null)}>改回自動辨識</button>}
          {isMap && <button className="btn" onClick={() => onMap('__none__')}>不是角色（NPC / UI 等）</button>}
          <button className="btn ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
