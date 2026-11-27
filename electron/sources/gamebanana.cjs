// GameBanana（apiv11，公開 API，不需登入）
const { fetchJson } = require('../net.cjs');

const API = 'https://gamebanana.com/apiv11';
const GAME_IDS = { SRMI: 18366, WWMI: 20357, ZZMI: 19567, EFMI: 21842 };
const SORTS = { new: 'new', updated: 'updated', popular: 'default' };

function imageUrl(img, size = '530') {
  if (!img) return null;
  const f = img[`_sFile${size}`] || img._sFile;
  return f ? `${img._sBaseUrl}/${f}` : null;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalize(r) {
  const imgs = r._aPreviewMedia?._aImages || [];
  return {
    source: 'gamebanana',
    id: String(r._idRow),
    name: r._sName,
    author: r._aSubmitter?._sName || '',
    thumb: imageUrl(imgs[0], '530') || imageUrl(imgs[0], '220'),
    url: r._sProfileUrl,
    updatedAt: (r._tsDateModified || r._tsDateAdded || 0) * 1000,
    likes: r._nLikeCount || 0,
    views: r._nViewCount || 0,
    adult: Boolean(r._bHasContentRatings) || r._sInitialVisibility === 'hide',
    category: r._aSubCategory?._sName || r._aRootCategory?._sName || '',
    rootCategory: r._aRootCategory?._sName || '',
    version: r._sVersion || '',
  };
}

async function list(gameId, { sort = 'new', page = 1, search = '' } = {}) {
  const gid = GAME_IDS[gameId];
  if (!gid) throw new Error('GameBanana 沒有這個遊戲');
  let url;
  if (search.trim()) {
    url = `${API}/Util/Search/Results?_sModelName=Mod&_sOrder=best_match&_idGameRow=${gid}&_sSearchString=${encodeURIComponent(search.trim())}&_nPage=${page}`;
  } else {
    url = `${API}/Game/${gid}/Subfeed?_nPage=${page}&_sSort=${SORTS[sort] || 'new'}&_csvModelInclusions=Mod`;
  }
  const r = await fetchJson(url);
  const items = (r._aRecords || []).filter((x) => !x._sModelName || x._sModelName === 'Mod').map(normalize);
  return { items, hasMore: r._aMetadata ? !r._aMetadata._bIsComplete : items.length > 0, total: r._aMetadata?._nRecordCount ?? null };
}

async function details(modId) {
  const p = await fetchJson(`${API}/Mod/${encodeURIComponent(modId)}/ProfilePage`);
  const base = normalize({ ...p, _aSubCategory: p._aCategory, _aRootCategory: p._aSuperCategory });
  return {
    ...base,
    adult: base.adult || Boolean(p._aContentRatings && Object.keys(p._aContentRatings).length),
    contentRatings: p._aContentRatings ? Object.values(p._aContentRatings) : [],
    images: (p._aPreviewMedia?._aImages || []).map((i) => imageUrl(i, '800') || imageUrl(i, '530')).filter(Boolean),
    description: stripHtml(p._sText),
    downloads: p._nDownloadCount || 0,
    files: (p._aFiles || []).map((f) => ({
      id: String(f._idRow),
      name: f._sFile,
      size: f._nFilesize || 0,
      date: (f._tsDateAdded || 0) * 1000,
      description: f._sDescription || '',
      version: f._sVersion || '',
      md5: f._sMd5Checksum || '',
      scan: f._sAvResult || '',
      downloadUrl: f._sDownloadUrl,
    })),
  };
}

module.exports = { GAME_IDS, list, details, stripHtml };
