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
- 自動監看 Mods 資料夾：在檔案總管新增 / 刪除 / 改名 MOD 後清單自動更新（`electron/watcher.cjs`）
- 按鍵設定：讀出 MOD 各 ini 的 `[Key…]` 區段（`key`、`back`、`type`、`condition`、`$變數 = 值`，區段上方的 `;` 註解當說明），
  卡片顯示「⌨ 按鍵數」，點開列出每個按鍵會切換什麼（遊戲內疊加介面的卡片 / 清單也有，Esc 先關按鍵視窗）；略過 DISABLED 開頭的 ini，依檔案修改時間快取（`electron/keybinds.cjs`）
- 程式更新：啟動後檢查一次 GitHub Releases，之後每 4 小時重查；打開「設定」時上次檢查超過 30 分鐘也會重查，並顯示上次檢查時間

### 透過 XXMI 啟動遊戲

- 分頁列右邊的「▶ 啟動<遊戲>」：與 XXMI 的「Quick Start」捷徑相同（`XXMI Launcher.exe --nogui --xxmi <SRMI|WWMI|ZZMI|EFMI>`），載入 MOD 並啟動遊戲
- 「XXMI」按鈕：開啟 XXMI Launcher 視窗並切到該遊戲；找不到 `<XXMI 資料夾>ResourcesBinXXMI Launcher.exe` 時不顯示這兩個按鈕
- XXMI Launcher 要求系統管理員權限，所以 ModHub 透過 Windows Shell 啟動它（和雙擊捷徑一樣），每次都會跳出 UAC 詢問；按「否」會顯示提示

### 遊戲內疊加介面

- 在遊戲中按 **Alt+N**（可在「設定」改成其他組合鍵或停用）叫出置頂的小面板：搜尋、開關 MOD、切換預設組合；改完回遊戲按 F10 重新載入
- 面板預設以圖片顯示（MOD 預覽圖、角色頭像，點卡片切換啟用），也可切成清單
- 自動判斷正在執行的遊戲（StarRail.exe、ZenlessZoneZero.exe、Client-Win64-Shipping.exe、Endfield.exe），沒有就用 ModHub 目前的遊戲
- 再按一次快捷鍵、按 Esc 或點回遊戲就收起
- 終末地多一個「地圖」模式：面板加寬顯示互動地圖；這個模式點回遊戲不會收起，用快捷鍵或 ✕ 收起
- 不注入遊戲，只是一般的置頂視窗：遊戲要設為「視窗化」或「無邊框全螢幕」，獨占全螢幕時看不到
- `ModHub.exe --toggle-overlay` 也能叫出 / 收起（可綁到搖桿或其他快捷鍵工具）

### 絕區零一條龍（自動每日）

- 由第三方工具 [ZenlessZoneZero-OneDragon](https://github.com/OneDragon-Anything/ZenlessZoneZero-OneDragon)（GPL-3.0）執行；
  ModHub **不含**它的程式碼，只用它公開的命令列參數啟動：`OneDragon-Launcher.exe -o [-c] [-s 60 | --sleep | --hibernate] [-i 實例]`
  （經 Windows Shell 啟動，需要系統管理員權限時會跳 UAC）。`electron/onedragon.cjs`、`electron/onedragon-main.cjs`
- 主畫面選絕區零多一個「**自動每日**」分頁（`src/AutoDaily.jsx`）：OneDragon 資料夾、跑完動作、帳號實例、定時、任務清單與各任務設定都在這裡；
  遊戲內疊加介面選絕區零時只有「▶ 一條龍」執行按鈕
- **開遊戲**：預設由 ModHub 先透過 XXMI 開絕區零（和「▶ 啟動」相同、會載入 MOD），偵測到 `ZenlessZoneZero.exe` 後再等 20 秒才啟動 OneDragon，
  OneDragon 看到遊戲已開就不會自己執行 exe。Epic 版直接執行 exe 會缺少 Epic 啟動參數（`epic_check_launch_param: launch param not exists`）
  而在載入時自行結束，所以需要這樣做；也可選「交給 OneDragon 開」
- **遊戲路徑**（`electron/onedragon-game.cjs`）：OneDragon 不會自己找遊戲，`config\<實例>\game_account.yml` 的 `game_path` 沒設定時「打開遊戲」會失敗。
  ModHub 從 XXMI 設定的絕區零資料夾（或遊戲的 `Player.log`）找到 `ZenlessZoneZero.exe`，每次執行一條龍前替 `game_path` 是空的實例補上這一行
  （這個檔案也存帳號密碼：只改這一行、其他內容原樣保留、不讀出也不顯示；已設定的路徑不覆蓋；OneDragon 開著時不寫）。「自動每日」顯示各實例的路徑狀態
- **遊戲區服**：OneDragon 依 `game_region` 決定要找的視窗標題（國服 / B 服找「绝区零」、其他找「ZenlessZoneZero」），沒設定時當成國服，
  國際服的遊戲開著也找不到、會一直重開遊戲。ModHub 依遊戲資料夾的 `config.ini`（`uapc` 的 `nap_global` / `nap_cn`、`cps` 含 bilibili）分國服 / B 服 / 國際服，
  國際服再用 ModHub 抽卡紀錄的絕區零 UID 開頭分區（10 美服、13 亞服、15 歐服、17 港澳台服；沒有紀錄預設港澳台服，細分只影響 OneDragon 用帳密登入時選伺服器），
  只在 `game_region` 這一行不存在（從沒設定過）時補上；已設定但國服 / 國際服和遊戲不符時只在畫面上提醒
- **任務設定**（任務旁的 ⚙，`electron/onedragon-apps.cjs`，寫 `config\<idx>\one_dragon\<app_id>.yml`）：
  每日簽到選簽到地點（吼吼餅鋪 / 卦象集錄 / 刮刮卡，讀自 `daily_signin_setting_flyout.py`）；錄像店營業、咖啡店選傳送地點（選項讀自安裝目錄 `*_config.py` 的 `TransportPoint`）；
  體力刷本新增 / 刪除 / 排序副本計畫與次數（選項讀自 `assets\game_data\compendium_data.yml` 的「训练」分頁：实战模拟室、区域巡防、专业挑战室、恶名狩猎），
  選單與計畫標註掉落物（資料裡的 `mission_type_name_display` / `mission_name_display`：區域巡防的驅動盤套裝、實戰模擬室的產出；專業挑戰室、惡名狩獵沒有資料就不標），
  新計畫用 OneDragon 的預設戰鬥設定，既有計畫的配隊等設定保留；只改這些欄位，第一次覆寫前備份
- **任務清單**（設定與疊加介面）：讀寫 OneDragon 自己的設定 `config\one_dragon.yml`（帳號實例 `instance_list`）與
  `config\<idx 兩位數>\one_dragon\_group.yml`（`app_list: [{ app_id, enabled }]`，順序 = 執行順序），勾選每日簽到、錄像店營業、咖啡店、
  體力刷本、活躍度獎勵、麗都城募、麗都周紀等任務並調整順序（`electron/onedragon-tasks.cjs`，用 js-yaml）。
  任務名稱與一條龍預設任務從安裝目錄的 `src\zzz_odpplication\**\*_const.py`（`APP_ID`、`APP_NAME`、`DEFAULT_GROUP`）以文字讀取，讀不到用內建名單。
  沒有 `_group.yml` 時 ModHub 自己建立（有舊版 `one_dragon_app.yml` 就先遷移），不必先打開 OneDragon；
  只改 `app_list`、保留其他欄位與清單外的項目，第一次覆寫前備份成 `.modhub-bak`；OneDragon 執行中不寫入。各任務的細節設定仍在 OneDragon 裡
- 「自動每日」分頁：OneDragon 資料夾（沒設定時在各磁碟根目錄與使用者資料夾找名稱含 OneDragon 的資料夾）、跑完之後（預設關閉遊戲；可選不動作 / 關機 / 睡眠 / 休眠）、
  帳號實例、每天定時執行（ModHub 開著時含系統匣，到時間後 30 分鐘內啟動一次，每天最多一次；失敗也不重試以免一直跳 UAC）
- 沒裝時可「下載官方安裝程式」：從 GitHub 最新版下載 `*-Installer.exe` 到「下載」資料夾並比對 SHA-256，ModHub 不執行，使用者自己雙擊安裝
- **繁體中文遊戲畫面**：OneDragon 只支援遊戲文字為简体中文 / English（用 OCR 比對簡體字，例如「训练」）。
  「自動每日」可安裝 ModHub 自己寫的外掛 `<OneDragon>\plugins\modhub_zh_tw\`（`electron/onedragon-plugin/`、`electron/onedragon-zhtw.cjs`）：
  OneDragon 載入外掛時把 OCR 模型（`onnxocr.onnx_paddleocr.ONNXPaddleOcr.ocr`）輸出的文字逐字繁轉簡，
  對照表 `t2s.json` 安裝時用 opencc-js 產生（OpenCC 字典，Apache-2.0）。外掛是 `INTERNAL_APP`，不會出現在一條龍任務；
  `plugins\` 在 OneDragon 的 .gitignore 裡，不會被它啟動時的程式更新（`force_update`）蓋掉，也不修改 OneDragon 本身的檔案。移除 = 移到資源回收筒
- OneDragon 會模擬操作遊戲，可能違反遊戲條款，風險自負

### 終末地自動每日（MaaEnd）

- 由第三方工具 [MaaEnd](https://github.com/MaaEnd/MaaEnd)（AGPL-3.0，介面是 [MXU](https://github.com/MistEO/MXU)）執行；
  ModHub **不含**它的程式碼，只用 MXU 公開的命令列參數啟動：`MaaEnd.exe --autostart -i <實例> [-q]`
  （`-i` 指定要自動執行的實例 = MaaEnd 的分頁，`-q` 執行完自動關閉 MaaEnd）。`electron/maaend.cjs`、`electron/maaend-main.cjs`、`src/MaaEndDaily.jsx`
- 選終末地時多一個「**自動每日**」分頁：MaaEnd 資料夾（沒設定時在各磁碟根目錄與使用者資料夾找名稱含 MaaEnd 的資料夾）、要執行的實例、
  開遊戲方式、跑完關閉 MaaEnd、每天定時執行（與一條龍相同：ModHub 開著時到時間後 30 分鐘內啟動一次）；遊戲內疊加介面選終末地時有「▶ MaaEnd」
- **任務清單與任務設定**（`electron/maaend-tasks.cjs`、`src/MaaEndTasks.jsx`）：讀寫 MaaEnd 的 `config\mxu-MaaEnd.json`（`instances[].tasks[]`），
  可勾選、調整順序、新增 / 移除任務，任務旁的 ⚙ 展開該任務的所有選項（開關、下拉、多選、數值 / 文字輸入，含選到某個選項後才出現的子選項）
  - 定義讀自安裝目錄的 `interface.json`（JSONC）與它 import 的 `tasks\*.json`（`task[]`、`option{}`），名稱與說明用 `locales\interface\zh_tw.json`；依實例的控制器 / 資源過濾
  - 值的格式與 MaaEnd 相同（`{type:'select',caseName}`、`{type:'checkbox',caseNames}`、`{type:'switch',value}`、`{type:'input',values}`）；只寫改過的值，
    沒改的沿用 MaaEnd 的預設值（`default_case`、`input.default`）；輸入值依定義的 `verify` 正規式檢查，錯誤訊息用 MaaEnd 的 `pattern_msg`；熱鍵與密碼欄位留在 MaaEnd 裡設定
  - 勾選同時更新 `enabled` 與 `enabledByController[控制器]`；新任務的 id 為 7 碼隨機英數、選項用預設值
  - 啟動遊戲的前置任務（`__MXU_PRETASK__*`）與切換帳號（`AccountSwitch`）不顯示也不能改（ModHub 自己透過 XXMI 開遊戲）
  - 只改 `instances[].tasks`，其他欄位原樣保留；第一次寫入前備份成 `mxu-MaaEnd.json.modhub-bak`；MaaEnd 執行中不寫入
    （它把設定放在記憶體裡、關閉時會蓋回去，所以要先關閉 MaaEnd）
- **繁體中文遊戲畫面**：MaaEnd 原生支援（比對文字裡繁、簡、日、韓、英都有列，輔助程式也有 zh_tw 資料），不需要像絕區零那樣裝外掛。
  曾試過把 OCR 字典繁轉簡，但兩岸用詞不同（「按下任意位置繼續」與「点击任意位置继续」）反而兩邊都比對不到，已停用；
  看到舊版留下的 `keys.txt.modhub-bak` 會自動還原（`electron/maaend-zhtw.cjs`）
- **繞過隱藏 UID 的 MOD 檢查**（`electron/maaend-bypass.cjs`）：MaaEnd 每個任務開始前用 OCR 看畫面左下角的 UID（`__SceneImageCheckMod`），
  看不到（例如 Advanced HUD Control 的 `$hide_uid`）就跳提示並中止。勾選後把這個節點的 `next` 從 `[…Success, …FailedFinish]` 改成 `[…Success, EmptyNode]`
  （MaaEnd 自己的空節點，與它的 Windows 浮水印檢查相同寫法），檢查不通過也繼續；只改 `resource*\pipeline\nodes.json` 這一行，
  第一次備份 `nodes.json.modhub-bak`，取消勾選精確改回；格式和預期不同時不改。同樣每次執行前重新套用
- **交給 MaaEnd 開遊戲**時：MaaEnd 的「啟動遊戲（PC）」前置任務（`__MXU_PRETASK__LaunchGamePC`，會自己從登錄檔找官方啟動器、Epic 版用 Epic 連結，不需要路徑）
  必須打開且伺服器正確（預設國服）。這個前置任務在 ModHub 的任務清單不顯示，所以執行前 ModHub 自動打開它並設定伺服器 `LaunchGamePCRegion`：
  手動指定 → 依終末地資料夾判斷（`Epic Games` → Epic、`steamapps` → Steam、Gryphline / GRYPHLINK → 國際服、Hypergryph → 國服、bilibili / TapTap）→ 沿用 MaaEnd 原本的設定；
  已經是想要的設定就不寫檔。預設的「ModHub 先透過 XXMI 開」時 MaaEnd 用視窗名稱抓已開的遊戲，不需要這些
- **開遊戲**：預設由 ModHub 先透過 XXMI 開終末地（載入 MOD），偵測到 `Endfield.exe` 後等 20 秒再啟動 MaaEnd；也可交給 MaaEnd 的「啟動遊戲」
- MaaEnd 的 Win32 控制器需要系統管理員權限，ModHub 以 `runas` 啟動（跳 UAC），或用下面的「免確認啟動」
- MaaEnd 只允許開一個，已經開著時再啟動只會叫出舊視窗、不會自動執行，所以 ModHub 會先檢查並提示關閉
- 沒裝時可「下載官方 Windows 版」：GitHub 最新版的 `MaaEnd-win-x86_64-v*.zip`（ARM 版選 aarch64）存到「下載」並比對 SHA-256，ModHub 不解壓縮也不執行
- MaaEnd 會模擬操作遊戲，可能違反遊戲條款，風險自負

### 免確認啟動（工作排程）

- XXMI Launcher、OneDragon、MaaEnd 都需要系統管理員權限，平常每次啟動都會跳 UAC。「設定 → 免確認啟動」會在 Windows 工作排程器的
  `\ModHub\` 資料夾建立「以最高權限執行」（`RunLevel=HighestAvailable`、`LogonType=InteractiveToken`）、沒有觸發條件的工作，
  之後 ModHub 用 `schtasks /run` 啟動，不再跳 UAC（MaaEnd 自己的開機自動啟動也是同樣做法）。`electron/elevated.cjs`、`electron/elevated-main.cjs`、`src/Elevated.jsx`
- 工作：`XXMI-<SRMI|WWMI|ZZMI|EFMI>`（`--nogui --xxmi`，即「▶ 啟動」、系統匣、一條龍 / MaaEnd 先開遊戲）、`OneDragon`（目前的一條龍參數）、`MaaEnd`（目前的實例）。
  「XXMI」按鈕（只開視窗）不走工作排程
- 建立 / 更新 / 移除時用 `Start-Process -Verb RunAs` 開一個系統管理員 PowerShell（跳一次 UAC）執行 `Register-ScheduledTask` / `Unregister-ScheduledTask`；
  腳本以 `-EncodedCommand` 傳遞，不寫暫存檔。工作的優先順序設為一般（4），避免工作排程預設的「低於標準」連帶影響遊戲
- 每次啟動前讀工作排程（`Get-ScheduledTask`，不需權限）比對執行檔與參數；設定改過（例如一條龍跑完動作、MaaEnd 實例）而不一致時顯示「需要更新」，
  更新前改回原本會跳 UAC 的啟動方式
- 代價：之後這些 exe 不經確認就以系統管理員權限執行；若其他程式換掉這些 exe（例如 `%APPDATA%\XXMI Launcher` 底下的），也會被以系統管理員權限執行

### 系統匣

- 最小化或按 ✕ 時縮到系統匣（可在「設定」分別關掉），遊戲內面板的快捷鍵仍然有效
- 點系統匣圖示開回主視窗；右鍵選單：開啟 ModHub、啟動遊戲、遊戲內面板、結束 ModHub
- 「啟動遊戲」子選單：直接透過 XXMI 載入 MOD 並啟動四個遊戲之一，或只開啟 XXMI Launcher；
  啟動失敗（找不到 XXMI、UAC 按了「否」）用系統匣通知顯示原因

### 預設組合

- 「🗂 預設組合」：把目前「哪些 MOD 啟用」存成組合（例如日常、拍照用），之後一鍵切換；可覆蓋、改名、刪除
- 套用 = 組合裡的 MOD 啟用、其他 MOD 停用（只改 `DISABLED_` 前綴，可還原）；套用前會先列出要啟用 / 停用的 MOD 與找不到的 MOD
- 每次套用前自動把當時狀態存成「套用前的狀態」，套錯了可以切回來
- MOD 以「相對 Mods 的路徑、去掉 `DISABLED_`」辨識（例如 `流萤/SkinA`）；MOD 改名或移動到其他分類後，組合裡的舊項目會列為找不到
- 組合存在 `%APPDATA%\modhub\presets.json`（每個遊戲分開）

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
- `electron/presets.cjs` 預設組合（純 Node，有測試）
- `electron/launcher.cjs` 透過 XXMI Launcher 啟動遊戲
- `electron/gacha/uigf.cjs` UIGF / SRGF 轉換（有測試）
- `electron/config.cjs` 遊戲定義、設定檔（存在 Electron userData）
- `electron/main.cjs` 視窗、IPC、`modimg://` 圖片協定（只允許 Mods 目錄內）
- `electron/schedule.cjs` 卡池時間表 / 活動排程（有測試）
- `electron/watcher.cjs` 監看 Mods 資料夾（有測試）
- `electron/overlay.cjs` 遊戲內疊加介面與全域快捷鍵（有測試）
- `electron/tray.cjs` 系統匣（有測試）；圖示在 `electron/assets/`
- `electron/elevated.cjs` 免確認啟動（工作排程，有測試）
- `electron/onedragon*.cjs` 絕區零一條龍、`electron/maaend*.cjs` 終末地 MaaEnd（有測試）
- `scripts/release.cjs` 發布流程（見下方）
- `src/` React 介面（`App.jsx` 主畫面；`ModCard`、`Picker`、`Settings` 各自一個檔案，共用工具在 `common.jsx`）

### 圖鑑 / 前瞻

- 「圖鑑 / 前瞻」分頁，資料快取在 `%APPDATA%\modhub\codex\`（6 小時，可按「↻ 更新」）
- 星鐵 / 鳴潮 / 絕區零（nanoka.cc）：角色、光錐 / 武器 / 音擎、邦布；點開才抓中文詳細資料（`/<game>/<ver>/zh/<kind>/<id>.json`）
  - 前瞻 = 最新資料版本（測試服）有、正式服版本沒有的項目；星鐵角色另看實裝日期
  - 鳴潮目前 nanoka 沒有測試服資料，所以沒有前瞻
- 終末地（森空島 wiki）：干員、武器、裝扮；前瞻 = wiki 的「前瞻」標記，另列目前 UP 卡池（含剩餘時間）與活動
  - 「官方情報」只有在 wiki 頁面互動後才會載入，抓不到時就不顯示
- 星鐵 / 鳴潮 / 絕區零的前瞻另列「近期與未來卡池」（`electron/schedule.cjs`）：
  - 卡池時間來自 [BannerHistory](https://bannerhistory.app/tw)：結束不到兩週、進行中、即將開始與時間未公布的卡池，標示進行中 / 即將開始 / 剩餘時間
  - 星鐵另從 [BWiki 首頁](https://wiki.biligame.com/sr/%E9%A6%96%E9%A1%B5)讀本期限時活動與光錐卡池（國服時間）
  - 卡池角色會對應到圖鑑，點了開詳細頁；來源讀不到時只顯示錯誤，不影響圖鑑其他部分
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
- **從 HoYoLAB 同步**（需先在該遊戲的「抽卡紀錄 → 官方帳號」登入 HoYoLAB；星鐵與絕區零分開登入，
  分別存在 `persist:modhub-hoyolab-sr` 與 `persist:modhub-hoyolab`，可以是不同的 HoYoLAB 帳號）
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
- **從離愁軒補紀錄**（終末地）：補上 ModHub 開始記錄之前的卡池。按鈕開啟 [離愁軒](https://wiki.lcx.cab/zmd/gacha_tracker.php) 視窗
  （獨立的 `persist:modhub-lcx` 分區），使用者自己登入後按「讀取並匯入」，ModHub 從頁面上讀出各卡池卡片
  （卡池名稱、日期、合計、已墊、6★ 與抽數、歪、加急、5★），清理後補到同 UID 的帳號（`electron/gacha/lcx-window.cjs`）；
  不呼叫離愁軒 API、不保存離愁軒帳號。離愁軒只有出貨摘要，這些卡池標示「離愁軒」、沒有逐抽紀錄
- 統計：各池總抽數、距上次最高稀有度、限定池本期大保底（終末地 120 / 武器 80）、各稀有度數量、平均出貨抽數、出貨歷史
  - 終末地的免費抽（加急招募）不累計保底，免費抽出的 6★ 也不重置保底；`gift_*` 獎勵不算抽數
- **圖像化總覽**（亮色報表風格）：總抽數、最高稀有度出率、UP 不歪率；依卡池類型分頁，
  最近 3 期大欄位（出貨頭像、歪標記、出貨抽數、加急 / 已墊、距保底）、過往卡池速覽；點卡池進入單期頁（逐抽格子，T 編號）
  - 終末地：UP 角色與立繪來自公開的 `ef-webview…/api/content`（近期卡池）；查不到的舊卡池（含離愁軒補充的）由
    `refineEndfieldUps` 推斷：常駐 6★ 與以前卡池的 UP 算歪；其餘候選中實裝順序（圖鑑 `meta.order`）比之前所有 UP 都新的才是本期 UP，
    取最新的一個，其他算歪（歪出以前的限定角色也算）；判斷不了標成未知
  - 平均 UP 抽數：花掉的抽數 ÷ UP 數（免費抽出的不算）。知道總抽數的卡池用付費抽數、最後扣掉目前已墊；
    只有出貨抽數的（絕區零官方統計、離愁軒「之前」那段）用出貨抽數加總。總覽分「限定角色」與「限定武器 / 光錐 / 音擎」，各卡池頁也有
  - 絕區零：登入 HoYoLAB 時另抓官方調頻查詢工具的統計（`/api/zzz/index`、`hist_pool_stat`、`cur_pool_stat`），
    含全部版本、官方 is_up 與圖示；逐抽紀錄 API 只保留約 6 個月
  - 「從遊戲更新」時若 HoYoLAB 已登入同一個 uid，也會一併更新官方統計
  - 星鐵：逐抽紀錄有 `gacha_id`，限定池直接依卡池 id 分期，卡池名稱 = 該期出的 UP；常駐 5★（姬子、瓦爾特、布洛妮婭、傑帕德、
    克拉拉、彥卿、白露與 7 把常駐光錐）判定為歪；保底跨期累計
    - 角色池優先對照 [bannerhistory](https://bannerhistory.app/tw/hsr-pickup-history) 的卡池歷史（執行時讀取，快取 12 小時於 `gacha\<遊戲>\_meta\bannerhistory.json`）：
      每個 gacha_id 找出期間開放中的 UP，該池抽到的 UP 名字中出最多次的是本池 UP，其他都算歪
      （3.2 起「星緣相邀」選的角色如刃、符玄、希兒，4.2 起雲璃、銀枝、銀狼，歪出來都會正確算歪）。
      名稱比對：完全相同，或遊戲名稱包含 UP 名稱（「星神★阿哈」對「阿哈」，「刃」不會對到「千冶•刃」）。
      絕區零沒有官方統計時也用同樣方式（自選調頻的候選算歪）
    - 讀不到 bannerhistory 或光錐池時，後來加入常駐的（例如刃）從紀錄學習：同一個限定池出了兩個以上非常駐的名字時，出最多次的是 UP、其他是常駐；
      群星躍遷出過的也算常駐。都只從「第一次確定是常駐」的時間起算歪，它自己的限定池仍算 UP（`learnStandardSince`）
  - 沒有官方統計時，限定池依抽卡時間分期（6 天沒抽或超過 21 天算下一期），卡池名稱 = 該期出的 UP；保底跨期累計
- 登入 cookie 在登入後、呼叫官方 API 後與關閉程式前立即寫回磁碟（Chromium 預設延遲寫入，太快關閉會遺失登入）
- **UIGF**（星鐵 / 絕區零）：「匯出 UIGF」輸出 [UIGF v4.0](https://uigf.org) 標準格式；「匯入」可讀 UIGF v4（含多個 uid，各自合併到對應帳號）與舊的 SRGF v1，
  時間依檔案的 timezone 換算；格式不符的紀錄會略過並顯示筆數。終末地不在 UIGF 範圍內，仍用 ModHub JSON

### 終末地 AIC 藍圖

- 選終末地時多一個「藍圖」分頁：依國服 / 亞服 / 歐美服列出畢業藍圖碼，按「複製」後在遊戲 AIC 藍圖介面貼上；另列教學影片與基地一圖流圖片
- 資料來源：[終末地一圖流](https://ef.yituliu.cn/aic/blueprint)，內容採 CC BY-NC 4.0（前端程式碼 GPL-3.0）。
  ModHub **不內建也不複製**這些內容：執行時讀取他們公開 repo（`Arknights-yituliu/ef-frontend-v1`）的
  `app/pages/aic/blueprint.vue`，以純文字解析出藍圖碼（不執行任何程式碼），快取在 `%APPDATA%\modhub\blueprints\`（6 小時）；
  畫面上標示來源、授權與變更（名稱轉繁體，藍圖碼不改）。讀取失敗時顯示上次的快取，並在畫面上說明原因
- 一圖流改版的因應：解析不依賴固定排版（欄位順序、型別註記、陣列寫法改變都能讀）；預設位置讀不到時，
  先試上次成功的位置，再列出 repo 檔案樹找含 `blueprint` 的檔案（`aic/` 優先），找到就改讀新位置並在畫面上標示

### 終末地 EFF（Endfield Framework）

[EFF](https://github.com/ssice-a/EFF)（[GameBanana](https://gamebanana.com/tools/24565)）是終末地另一套 MOD 載入框架，
裝在遊戲資料夾（`Endfield.exe` 旁），MOD 放在 `plugin\mods\<MOD>\`（`mod.ini` 有 `[Mod] format=`、`*.effres`），和 XXMI 分開管理。

- 終末地「本機 MOD」左上角切換 **XXMI / EFF**；EFF 沿用同一套卡片、搜尋、啟用 / 停用、刪除到資源回收筒
- 角色分組依 MOD 內容判斷（`mod.ini` 裡替換目標 `target.path=…/actor/<類型>/<代號>/`，例如 `laevat` → 萊萬汀）
- 停用：EFF 會讀取 `plugin\mods` 底下所有資料夾、不認 `DISABLED_` 前綴，所以停用是把整個 MOD 資料夾移到
  `plugin\mods_disabled\`（相對路徑與 `state.ini` 一起移動），啟用再移回來；遊戲內按 F10 重新載入
- 按鍵與滑桿：EFF 也支援舊式 `[Key…]`（同樣列出）；Ins 面板的滑桿 `[ControlN]`（`variable`、`label`、`min`、`max`）
  卡片顯示「🎚 數量」，視窗裡列出範圍與 `state.ini` 裡目前的值（沒調整過顯示 `[Constants]` 的預設值）；只讀不改
- 遊戲資料夾：預設讀 XXMI 設定裡終末地的 `game_folder`，可在「設定」另外指定
- 安裝 / 更新 EFF 本體：從 GitHub Releases 下載 `EFF_v<版本>_dll.zip`，比對 GitHub 提供的 SHA-256，
  檢查內容只有 `d3dcompiler_47.dll`、`vulkan-1.dll` 與 `plugin\`，遊戲執行中會拒絕；
  被覆蓋的舊檔先備份到 `%APPDATA%\modhub\backups\eff\`，保留使用者的 `plugin\eff.ini` 與所有 MOD。版本從 `eff.dll` 的版本資源讀取
- 從壓縮檔 / 線上下載安裝時偵測到 EFF MOD，安裝視窗會問要裝到 EFF（`plugin\mods`）還是 XXMI；
  若壓縮檔其實是 EFF 本體會提示改用「安裝 EFF」
- EFF 為 AGPL-3.0：ModHub 不內含也不複製它的程式碼，只依公開文件與檔案結構相容，框架本體在使用者要求時才從官方 Releases 下載

### 終末地互動地圖

- 選終末地時多一個「互動地圖」分頁（疊加介面也有「地圖」模式），內嵌 [zmdmap.com](https://www.zmdmap.com/) 的網頁；ModHub 不內建地圖內容
- 用 Electron `<webview>`（網站禁止 iframe 內嵌），獨立的 `persist:zmdmap` 分區、沙箱、無 preload，
  只能瀏覽 zmdmap.com；點到其他網站的連結改用系統瀏覽器開啟，網站要求的權限（定位、通知等）一律拒絕
- 切到其他分頁時保留地圖狀態，不會重新載入

### 線上下載（GameBanana / Nexus Mods）

- 「線上下載」分頁：最新 / 最近更新 / 熱門、關鍵字或依角色搜尋，預設隱藏成人內容
- **說明翻譯成繁體中文**：點開 MOD 時自動翻譯說明與檔案說明（可取消「自動翻譯」改成手動按，也可「顯示原文」）
  - 簡體中文：本機用 opencc 轉繁體，不連網
  - 其他語言：送到 Google 翻譯公開端點（`translate.googleapis.com`，免金鑰），只送 MOD 網站上公開的說明文字；
    翻譯前先把圖鑑裡的角色英文名換成中文名（例如 Firefly → 流螢）；同一段文字在程式開著時不重複翻譯（`electron/translate.cjs`）
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

## 發布

```powershell
npm version <版本> --no-git-tag-version   # 之後 commit、push
npm run release -- --notes changes.md            # 測試、建置、掃描 app.asar、產生發布說明（不上傳）
npm run release -- --notes changes.md --publish  # 另外建立 GitHub Release、上傳四個檔案並下載回來比對
```

- `changes.md` 只寫這版的變更條列；下載表與 SHA-256 由腳本加上，輸出在 `release/v<版本>/release-notes.md`
- 個人資料掃描的樣式在執行時從這台電腦取得（帳號名稱、家目錄、git email），不寫進 repo

## 待辦

- 終末地新角色的英文名（`ENDFIELD_EN`）需要手動補

## 授權

ModHub 以 [MIT 授權](LICENSE) 釋出。

- OneDragon（GPL-3.0）、MaaEnd / MXU（AGPL-3.0）、EFF（AGPL-3.0）都是使用者自己安裝的獨立程式，ModHub 只啟動它們、讀取它們的設定檔，不包含也不散布它們的程式碼
- 打包的第三方套件各自依其授權：React、node-unrar-js、7zip-bin（MIT）、opencc-js（MIT 與 Apache-2.0）；
  7zip-bin 內含的 `7za.exe` 屬於 7-Zip（GNU LGPL 與 unRAR 授權限制）
- 遊戲名稱、角色名稱與圖片屬於各自的權利人（HoYoverse、庫洛、鷹角網路等）；ModHub 是非官方工具，與上述公司無關
- 圖鑑、卡池等資料於執行時從 nanoka.cc、森空島 wiki、BannerHistory、BWiki、akedata 與官方 API 讀取；互動地圖是內嵌 zmdmap.com 的網頁，不隨程式散布
