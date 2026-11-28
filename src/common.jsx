import React from 'react';

// App / Picker / Settings 共用的小工具
export const api = window.modhub;
export const img = (p) => (p ? `modimg://img/?p=${encodeURIComponent(p)}` : null);
export const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function metaLine(meta) {
  if (!meta) return '';
  return [meta.rarity ? `${meta.rarity}★` : null, meta.element, meta.role, meta.weapon].filter(Boolean).join(' · ');
}

export function Avatar({ src, name, className = 'cat-cover' }) {
  return src ? <img className={className} src={img(src)} alt="" loading="lazy" /> : <div className={className}>{(name || '?').slice(0, 1)}</div>;
}
