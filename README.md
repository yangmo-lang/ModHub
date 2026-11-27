# ModHub

一體式 3DMigoto / XXMI MOD 管理器（崩壞：星穹鐵道 / 鳴潮 / 絕區零 / 終末地）。

## 執行

```powershell
npm install
npm start        # 打包前端後啟動
npm run dev      # 開發模式（Vite 熱更新）
npm test         # 掃描/切換邏輯單元測試
```

> npm 11 預設不執行套件的安裝腳本，若 `node_modules\electron\dist\electron.exe` 不存在，
> 執行 `npm install-scripts approve electron esbuild` 後重新 `npm install`。

## 目前功能（v0.1 本機管理）

- 讀取 `%APPDATA%\XXMI Launcher\<SRMI|WWMI|ZZMI|EFMI>\Mods`
- 與 QAQ Manager 相同的目錄慣例：`Mods\<角色>\<MOD>`，角色封面 `_cover.*`
- 有安裝 QAQ Manager 時，讀取它的角色名單來辨識分類（唯讀）
- 啟用/停用 = 資料夾加/去 `DISABLED_` 前綴（3DMigoto 會略過），遊戲內按 F10 重新載入
- 「只用這個」：同角色只保留一個 MOD 啟用；多個同時啟用時分類旁顯示警告
- 搜尋、啟用狀態篩選、預覽圖、在檔案總管開啟

### 角色圖鑑

- 星鐵 / 鳴潮 / 絕區零：nanoka.cc，`static.nanoka.cc/manifest.json` → `static.nanoka.cc/<hsr|ww|zzz>/<版本>/character.json`（最新版本，含前瞻角色）
- 終末地：森空島 wiki（wiki.skland.com/endfield）。API 需網頁簽名，所以用隱藏視窗載入頁面讀取干員目錄（`electron/skland.cjs`）
- 首次開啟自動同步，之後可按「↻ 同步」更新
- 繁體中文顯示（opencc-js），資料夾名稱維持簡體與 QAQ 相容；搜尋繁簡皆可
- 星級 / 屬性 / 命途・武器・特性・職業 篩選，依實裝、星級、名稱、MOD 數排序；前瞻角色標「前瞻」（星鐵依實裝日期、終末地依 wiki 標記）
- ✎ 手動對應角色資料夾（存在設定 `manualMap`），或標記「不是角色」
- 未分類 MOD 可「移入」建議角色或任意分類資料夾
- 絕區零頭像用 `IconRoleSelect`（`IconRoleCircle` 部分編號是舊資源，洛克茜會錯）
- 快取：`%APPDATA%\modhub\characters\<遊戲>\`（角色清單＋頭像，離線可用）
- 角色資料夾比對：簡中名、英文名、QAQ 命名（`丹恒-饮月`、`刃-千治`、`男主/女主`…），忽略 `•·-` 與 `「」`
- 沒有 `_cover` 的角色資料夾自動顯示圖鑑頭像；「補 N 個封面」可把頭像寫成 `_cover`（QAQ 也看得到）
- 「尚未建立資料夾的角色」清單，按 ＋ 建立資料夾並放入頭像
- 未分類的 MOD 會依名稱建議角色（例如 `baizhi_23a73 → 白芷`）

## 結構

- `electron/scanner.cjs` 掃描與切換（純 Node，有測試）
- `electron/config.cjs` 遊戲定義、設定檔（存在 Electron userData）
- `electron/main.cjs` 視窗、IPC、`modimg://` 圖片協定（只允許 Mods 目錄內）
- `src/` React 介面

### 線上下載（GameBanana / Nexus Mods）

- 「線上下載」分頁：最新 / 最近更新 / 熱門、關鍵字或依角色搜尋，預設隱藏成人內容
- GameBanana（apiv11，遊戲 ID 星鐵 18366、鳴潮 20357、絕區零 19567、終末地 21842）：直接下載，**校驗 MD5**，顯示掃毒結果
- Nexus Mods（v2 GraphQL 瀏覽；v1 下載）：
  - 需要使用者自己的 API 金鑰（設定裡貼上，以 Windows DPAPI 加密存放）
  - Premium 會員可直接下載；免費會員依 Nexus 規定從網頁按「Mod Manager Download」，
    開啟「讓 ModHub 處理 nxm:// 連結」後 ModHub 會自動接手
- 也可以把 zip / 7z / rar 拖進視窗，或按「📦 從壓縮檔安裝」
- 安裝流程：下載 → 解壓到暫存區（清理 `..`／磁碟路徑、移除符號連結）→ 分析（ini 數、可執行檔、內含壓縮檔）→ 確認對話框選角色分類 → 搬進 Mods
  - 預設不安裝 .exe / .dll / .bat 等可執行檔；ModHub 不會執行壓縮檔裡的任何東西
  - MOD 資料夾寫入 `.modhub.json` 記錄來源，線上列表會標「已安裝 / 有更新」
  - 更新時舊版移到 `%APPDATA%\modhub\backups\`，保留原本的啟用 / 停用狀態

## 待辦

- 預設組合、透過 XXMI 啟動遊戲
- 終末地新角色的英文名（`ENDFIELD_EN`）需要手動補
