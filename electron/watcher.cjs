// 監看目前遊戲的 Mods 資料夾：在檔案總管新增 / 刪除 / 改名 MOD 後自動通知介面重新掃描
const fs = require('node:fs');

// 只有「結構變動」才需要重新掃描；檔案內容修改（例如 MOD 的 .ini 被編輯）不影響清單
function createModsWatcher({ onChange, debounceMs = 800, watch = fs.watch } = {}) {
  let current = null; // { dir, key, w, timer }

  function stop() {
    if (!current) return;
    clearTimeout(current.timer);
    try { current.w.close(); } catch { /* 已關閉 */ }
    current = null;
  }

  // 同一個資料夾重複呼叫不會重建 watcher
  function set(key, dir) {
    if (current && current.dir === dir && current.key === key) return true;
    stop();
    if (!dir || !fs.existsSync(dir)) return false;
    let w;
    try {
      w = watch(dir, { recursive: true }, (event) => {
        if (event !== 'rename' || !current || current.w !== w) return;
        clearTimeout(current.timer);
        const k = current.key;
        current.timer = setTimeout(() => onChange(k), debounceMs);
      });
    } catch {
      return false;
    }
    // 資料夾被刪除或權限問題：停止監看，下次掃描時會再嘗試建立
    w.on('error', () => { if (current && current.w === w) stop(); });
    current = { dir, key, w, timer: null };
    return true;
  }

  return { set, stop, get watching() { return current ? { key: current.key, dir: current.dir } : null; } };
}

module.exports = { createModsWatcher };
