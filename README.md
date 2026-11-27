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
- 「刪除」：確認後把 MOD 資料夾移到資源回收筒（可還原）；同角色多個 MOD 同時啟用時分類旁顯示警告
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

### 圖鑑 / 前瞻

- 「圖鑑 / 前瞻」分頁，資料快取在 `%APPDATA%\modhub\codex\`（6 小時，可按「↻ 更新」）
- 星鐵 / 鳴潮 / 絕區零（nanoka.cc）：角色、光錐 / 武器 / 音擎、邦布；點開才抓中文詳細資料（`/<game>/<ver>/zh/<kind>/<id>.json`）
  - 前瞻 = 最新資料版本（測試服）有、正式服版本沒有的項目；星鐵角色另看實裝日期
  - 鳴潮目前 nanoka 沒有測試服資料，所以沒有前瞻
- 終末地（森空島 wiki）：干員、武器、裝扮；前瞻 = wiki 的「前瞻」標記，另列目前 UP 卡池（含剩餘時間）與活動
  - 「官方情報」只有在 wiki 頁面互動後才會載入，抓不到時就不顯示
- 角色詳細頁可跳到本機該角色的 MOD，或「找 MOD」直接帶入線上搜尋

### 養成計算

- 「養成計算」分頁：加入角色 / 光錐・武器・音擎，設定目前 → 目標的等級、突破、技能、行跡／節點，預設全滿
- 右側資源彙總：所需材料、填入背包數量後顯示缺口；經驗會先扣背包裡的經驗道具，再換算成要刷的數量；點材料可反查是哪些目標在用
- 計畫存在 `%APPDATA%\modhub\planner\plans.json`（每個遊戲一份）
- 資料來源
  - 星鐵 / 鳴潮 / 絕區零：nanoka 的 `/<game>/<ver>/zh/<kind>/<id>.json`（突破、技能、行跡材料）與 `item.json`（材料名稱圖示）
  - 終末地：akedata（data.akedata.wiki）遊戲資料表，下載後整理成 `planner/endfield-<版本>.json`；材料圖示用森空島 wiki 對應名稱
  - 經驗曲線與經驗道具數值：`electron/planner/exp-constants.json`（由星鐵 / 鳴潮公開遊戲設定表與絕區零道具說明整理）
- 參考 CEP 終末地規劃器（end.canmoe.com）的功能設計；CEP 為 AGPL-3.0，ModHub 沒有複製其程式或資料
- 已知限制：星鐵、鳴潮、絕區零角色升級時消耗的貨幣未計入（遊戲資料未提供）
- **從 HoYoLAB 同步**（需先在「抽卡紀錄 → 官方帳號」登入 HoYoLAB）
  - 星鐵：HoYoLAB 遊戲工具 `event/rpgcultivate`（`avatar/list`、`calc/avatar/detail`、`calc/compute`）
    → 等級、技能、已點亮行跡、裝備光錐等級；**背包**：`calc/compute` 回傳的 `user_owns_materials`（相關材料的實際持有數）
  - 絕區零：HoYoLAB 戰績 `game_record_zzz`（`avatar/basic`、`avatar/info`）→ 等級、技能（含核心技）、裝備音擎等級；國際服沒有背包資料
  - 突破階段依等級推算最低值（官方沒提供）；同步只更新「目前」，原本的目標保留（低於目前時拉高）

### 抽卡紀錄（星鐵 / 終末地 / 絕區零）

- 「抽卡紀錄」分頁：在遊戲內開啟紀錄頁面後按「↻ 從遊戲更新」，或「貼上網址」
  - 終末地：讀 `%USERPROFILE%\AppData\LocalLow\{Gryphline|Hypergryph}\Endfield\sdklogs\HGWebview.log` 裡最新的
    `ef-webview…/page/gacha_*?u8_token=…` 網址，呼叫 `/api/record/char`、`/api/record/weapon`（做法參考 bhaoo/endfield-gacha，MIT）
    - 新版遊戲已不再把含 token 的網址寫進日誌；日誌沒有連結或連結過期時，若已登入鷹角帳號會自動改用帳號更新
  - 絕區零：讀遊戲 `ZenlessZoneZero_Data\webCaches\<版本>\Cache\Cache_Data\data_2` 裡 `auth_appid=webview_gacha` 的 authkey，
    呼叫官方 `getGachaLog`；另有按鈕開啟 HoYoLAB 官方調頻紀錄頁
  - 星鐵：讀 `StarRail_Data\webCaches\<版本>\Cache\Cache_Data\data_2` 裡的躍遷紀錄 authkey（與 starrailstation.com 匯入說明相同的來源；
    遊戲資料夾來自 XXMI 設定或 `LocalLow\Cognosphere\Star Rail\Player.log`），
    呼叫 `public-operation-hkrpg-sg.hoyoverse.com` 的 `getGachaLog`（角色 / 光錐活動、群星、始發）與 `getLdGachaLog`（聯動角色 / 光錐，gacha_type 21 / 22）
- token / authkey 只在記憶體中使用，不寫入檔案；連結有效時間很短，開完紀錄頁要馬上更新
- **官方帳號登入（不用開遊戲）**：「官方帳號」列按「登入」會開啟官方登入頁（帳密只輸入在官方網頁上）
  - 終末地：鷹角通行證（國際服 user.gryphline.com / 國服 user.hypergryph.com）→ `cookie_store/account_token`
    → `as.*/user/oauth2/v2/grant` → `binding_list`（找出所有終末地角色）→ `u8_token_by_uid` → 紀錄 API
  - 絕區零：HoYoLAB 登入 → `getUserGameRolesByCookieToken` → `genAuthKeyByCookieToken`（auth_appid=webview_gacha）→ `getGachaLog`
    （與 HoYoLAB 官方調頻查詢工具相同的取得 authkey 方式）
  - 星鐵**不支援**帳號更新：HoYoLAB 登入產生的 `hkrpg_global` authkey 會被 `getGachaLog` 拒絕（-100 authkey error），
    HoYoLAB 官方躍遷紀錄工具（`sg-act-public-api.hoyolab.com/event/rpg_gacha_record`）也回「請從遊戲內打開」（2026-11 實測）。
    星鐵只能「從遊戲更新」或「貼上網址」；HoYoLAB 登入仍用於養成計算同步
  - 登入狀態留在獨立、持久的瀏覽器分區（`persist:modhub-*`，Chromium 加密保存），ModHub 檔案不存密碼或 token；「登出」會清除該分區
- 紀錄存在 `%APPDATA%\modhub\gacha\<遊戲>\<帳號>.json`，之後只下載新紀錄；可匯出 / 匯入 JSON
- 統計：各池總抽數、距上次最高稀有度、限定池本期大保底（終末地 120 / 武器 80）、各稀有度數量、平均出貨抽數、出貨歷史
  - 終末地的免費抽（加急招募）不累計保底，免費抽出的 6★ 也不重置保底；`gift_*` 獎勵不算抽數
- **圖像化總覽**（亮色報表風格）：總抽數、最高稀有度出率、UP 不歪率；依卡池類型分頁，
  最近 3 期大欄位（出貨頭像、歪標記、出貨抽數、加急 / 已墊、距保底）、過往卡池速覽；點卡池進入單期頁（逐抽格子，T 編號）
  - 終末地：UP 角色與立繪來自公開的 `ef-webview…/api/content`（近期卡池）；查不到的舊卡池用常駐池 6★ 名單判斷歪
  - 絕區零：登入 HoYoLAB 時另抓官方調頻查詢工具的統計（`/api/zzz/index`、`hist_pool_stat`、`cur_pool_stat`），
    含全部版本、官方 is_up 與圖示；逐抽紀錄 API 只保留約 6 個月
  - 「從遊戲更新」時若 HoYoLAB 已登入同一個 uid，也會一併更新官方統計
  - 星鐵：逐抽紀錄有 `gacha_id`，限定池直接依卡池 id 分期，卡池名稱 = 該期出的 UP；常駐 5★（姬子、瓦爾特、布洛妮婭、傑帕德、
    克拉拉、彥卿、白露與 7 把常駐光錐，加上群星躍遷出過的）判定為歪；保底跨期累計
  - 沒有官方統計時，限定池依抽卡時間分期（6 天沒抽或超過 21 天算下一期），卡池名稱 = 該期出的 UP；保底跨期累計
- 登入 cookie 在登入後、呼叫官方 API 後與關閉程式前立即寫回磁碟（Chromium 預設延遲寫入，太快關閉會遺失登入）
- 尚未支援：UIGF 標準格式匯入匯出

### 終末地 AIC 藍圖

- 選終末地時多一個「藍圖」分頁：依國服 / 亞服 / 歐美服列出畢業藍圖碼，按「複製」後在遊戲 AIC 藍圖介面貼上；另列教學影片與基地一圖流圖片
- 資料來源：[終末地一圖流](https://ef.yituliu.cn/aic/blueprint)，內容採 CC BY-NC 4.0（前端程式碼 GPL-3.0）。
  ModHub **不內建也不複製**這些內容：執行時讀取他們公開 repo（`Arknights-yituliu/ef-frontend-v1`）的
  `app/pages/aic/blueprint.vue`，以純文字解析出藍圖碼（不執行任何程式碼），快取在 `%APPDATA%\modhub\blueprints\`（6 小時）；
  畫面上標示來源、授權與變更（名稱轉繁體，藍圖碼不改）。讀取失敗時顯示上次的快取

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

## 授權

ModHub 以 [MIT 授權](LICENSE) 釋出。

- 打包的第三方套件各自依其授權：React、node-unrar-js、7zip-bin（MIT）、opencc-js（MIT 與 Apache-2.0）；
  7zip-bin 內含的 `7za.exe` 屬於 7-Zip（GNU LGPL 與 unRAR 授權限制）
- 遊戲名稱、角色名稱與圖片屬於各自的權利人（HoYoverse、庫洛、鷹角網路等）；ModHub 是非官方工具，與上述公司無關
- 圖鑑、卡池等資料於執行時從 nanoka.cc、森空島 wiki、akedata 與官方 API 讀取，不隨程式散布
