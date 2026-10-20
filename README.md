# pst

**把時間，畫清楚。**

pst 是以出圖為核心的輕量時程編輯器，提供網頁版與 Windows／macOS 桌面版。左側表格與右側時間軸逐列對齊，讓你呈現項目、日期、特定時段與重要節點，再將完整圖表匯出成 PNG，放進簡報或報告。

目前版本：**v0.3.0**。沿用 VTable-Gantt 的表格、時間軸與整圖匯出，以及 v0.2 的日曆、格點拖曳和可調整工作區，新增 **Rust／Tauri 2 桌面程式**。網頁與 App 共用同一套編輯器；桌面 App 內含完整前端資源，可離線編輯與匯出，使用原生檔案對話框開啟及保存文件。

## 下載桌面版

到 [GitHub Releases](https://github.com/Avery320/pst/releases) 下載安裝檔。GitHub Actions 直接在 Windows 與 macOS 雲端執行器編譯並發布，不需要使用者安裝 Node.js、Rust 或自行打包。

| 平台 | 安裝檔 | 架構與需求 |
| --- | --- | --- |
| Windows | `.exe`，NSIS 安裝程式 | x64；Windows 10／11，使用 WebView2。系統缺少 WebView2 時，安裝程式會下載安裝。 |
| macOS | `.dmg`，開啟後把 pst 拖到 Applications | Universal，包含 Apple Silicon 與 Intel；最低版本設定為 macOS 13。 |
| 完整性核對 | `SHA256SUMS.txt` | 對應同一 Release 的安裝檔雜湊。 |

v0.3.0 的 Windows 安裝檔尚未設定發行者程式簽章；macOS 使用 ad-hoc 簽章，尚未經 Apple 公證。首次開啟可能受到 SmartScreen 或 Gatekeeper 提示或阻擋。發行者簽章和 Apple 公證需要另外配置相應憑證；本版沒有內建、索取或上傳個人憑證。請依作業系統提供的驗證流程確認來源；公司管理的設備也可能受安裝政策限制。

### 桌面文件操作

- **開啟 JSON**：使用系統檔案視窗選擇既有 pst JSON；取消不會更動目前文件。
- **儲存 JSON**：選擇儲存位置，保留可再次編輯的資料；`Ctrl / ⌘ + S` 也可使用。
- **匯出圖片**：產生完整 PNG 後，選擇儲存位置；取消另存仍保留匯出設定。
- **自動保存**：目前文件保存在這台電腦的 pst App 資料空間。網頁版與桌面版各自保存，可透過 JSON 在兩者間搬移文件。
- **關閉視窗**：先提交正在編輯的文字與表格欄位，再關閉桌面視窗；檔案對話操作尚未完成時會保留視窗。

桌面版沿用既有 schema-1 JSON，v0.1／v0.2 文件可繼續開啟。安裝後不需要網路來繪圖、標記日期或輸出檔案；本版沒有雲端同步或自動更新服務。

**[直接開啟 pst 網站](https://avery320.github.io/pst/)** — 不需安裝開發工具或登入帳號。

## 功能

| 區域 | 已實作內容 |
| --- | --- |
| 項目與表格 | 新增時段或里程碑；編輯名稱、日期、顏色與說明；複製、刪除與上下移動資料列。名稱與說明可在表格雙擊編輯，也可使用側邊表單。 |
| 日曆日期 | 年月日曆與手動輸入；星期、ISO 週次、閏年與跨年日期；今天、本週、本月、今年；星期一／日為週首。 |
| 時間軸與拖曳 | 移動時段、調整起訖邊界；1 天／7 天吸附、落點預覽、對齊線、日期與位移提示；Escape 取消；日／週／月表頭、今天線、週末底色。 |
| 工作區 | 可拖曳的表格／時間軸分界與側邊面板分隔線；面板收合、獨立捲動；時間軸位置滑桿、縮放與符合寬度；窄螢幕堆疊。 |
| 日期標記 | 新增、編輯與刪除垂直日期標線，設定文字與顏色。 |
| 文件 | 復原／重做；瀏覽器／桌面 App 各自自動保存；匯入／匯出可再次編輯的 JSON。 |
| PNG 出圖 | 匯出完整表格、時間軸與標記，包含捲動畫面之外的列與欄；提供 1 倍／2 倍解析度，可加入標題、副標題與日期範圍。 |
| 範例 | 內建一份有八個項目、里程碑與日期標記的時間表；也提供 example.pst.json。 |

圖表著重任務／項目的視覺呈現。帳號、任務指派、完成率、資源分配與多人協作不在此版本範圍。

## 使用方式

1. 開啟應用後，可直接編輯內建範例，或按「新圖表」開始。
2. 按「新增時段」或菱形按鈕新增里程碑；在右側修改名稱、日期與顏色。
3. 拖曳時間條移動日期，拖曳兩端改變長度。拖動時檢查預覽和日期提示，放開才套用；按 Escape 取消。也可用日期欄位或其月曆按鈕精確編輯。
4. 在「日期標記」加入重要日期，在「圖面」調整週首、吸附間距、日期格線、今天、週末底色、欄位與副標題。
5. 使用「儲存 JSON」保留可編輯資料，使用「匯出圖片」產生 PNG。

PNG 依目前選定的日期範圍與欄位出圖。若內容超出範圍，按「顯示全部」調整；日期範圍外的部分不會自動延伸到圖片中。週末底色只改變樣式，所有日曆日期都會保留。

### 日曆與範圍

日期欄位旁的月曆按鈕可開啟完整月份，透過年份、月份選單快速跳轉。原日期輸入欄仍可直接輸入；相鄰月份、已選範圍與今天有不同樣式。

- 「今天」定位到今天；今天超出顯示範圍時，平移目前範圍並保留天數。
- 「本週」「本月」「今年」設定對應的日曆範圍並配合可見寬度縮放。
- 左右導覽依目前日／週／月刻度平移顯示範圍，保留原區間天數，並停在支援的日期邊界。
- 開始日期晚於結束日期時，另一端會先移到同一天，方便繼續選取；每次變更均可復原。
- 每週起始日可設定為星期一或星期日；ISO 週次始終依 ISO 規則，以星期一為週首。
- 這是西曆日期系統，支援 1900–2100 年。天數包含起訖日；「週一至週五」是星期計數，沒有自動扣除國定假日，也沒有農曆或地區假日資料。

### 拖曳與格點

拖曳由按下當刻的日期計算位移，不累加滑鼠事件造成的誤差。半透明長條、日期格底色、起訖對齊線和浮動提示會顯示吸附後的結果；放開只產生一次文件變更，可用一次復原撤銷。移動整段保持日曆天數，調整兩端不會反轉起訖日期。

「每週 · 7 天」表示以原始日期為基準，每次移動 7 天，保留原本的星期；不是強制改成週一。靠近時間軸左右邊緣時會自動捲動。Escape、視窗失焦或 pointer cancel 會取消拖曳；更新版面、載入文件與匯出前也會結束尚未提交的預覽。滑動時間軸不會改變資料列。

### 版面與滑軌

桌面可拖曳圖表與側邊面板之間的分隔線，或按「收合面板」擴大畫布。面板寬度和收合偏好保存在目前瀏覽器；窄螢幕改成上下堆疊。表格與時間軸之間的分界也能拖曳。

底部「時間軸位置」滑桿可水平瀏覽，並顯示目前可見日期；刻度寬度支援 1–80 px／天，「符合寬度」會依顯示範圍調整。改變縮放時盡量保留目前視窗中央的日期。範圍比畫面寬時仍可使用捲軸或位置滑桿。

### 快捷鍵

- `Ctrl / ⌘ + S`：網頁版下載 JSON；桌面版開啟另存新檔對話框。
- `Ctrl / ⌘ + Z`：復原圖表操作。
- `Ctrl / ⌘ + Shift + Z` 或 `Ctrl + Y`：重做。
- 拖曳時按 `Escape`：取消這次拖動。
- 月曆：方向鍵移動日期，`Home / End` 跳至週首尾，`Page Up / Down` 換月，搭配 `Shift` 換年，`Enter` 選取，`Escape` 關閉。
- 側邊面板分隔線：左右方向鍵調寬、`Shift` 加大步幅、`Home / End` 到最小／最大、`Enter` 或雙擊還原預設。
- 正在文字欄位輸入時保留原本的復原行為；月曆與匯出對話框開啟時不執行文件快捷鍵。

所有項目也能透過「選取項目」選單與表單編輯，不必只依靠 Canvas 拖曳。

## 開發與建置

需要 **Node.js 24 以上**（本次驗證環境為 Node.js 24.19.0）。

```bash
npm ci
npm run dev
```

其他指令：

```bash
npm run check   # TypeScript 型別檢查
npm test        # 文件、日曆、拖曳、捲動與歷史紀錄的自動化測試
npm run build  # 型別檢查與正式建置，輸出至 dist/
npm run preview
```

`dist/` 是可部署的靜態網站，包含打包後的依賴及授權聲明，無需後端服務。`base: './'` 允許放在子路徑。建置產物應透過 HTTP(S) 提供；來源目錄的 index.html 需經 Vite 處理。

### 桌面開發與建置

一般使用者直接下載安裝檔即可。開發者需另安裝 [Tauri 官方列出的平台建置工具](https://v2.tauri.app/start/prerequisites/)；Rust 版本由 `rust-toolchain.toml` 固定，JavaScript 與 Rust 相依版本分別由 `package-lock.json`、`src-tauri/Cargo.lock` 鎖定。

```bash
npm ci
npm run desktop:dev
```

`desktop:dev` 會先蒐集目前平台的 Rust 授權與必要來源資源；首次執行需要下載鎖定的 Rust 依賴。接著使用僅綁定本機的 Vite 開發服務，固定在 `127.0.0.1:1420`。正式 App 使用隨安裝包內附的 `dist/`。

原生安裝檔應在對應作業系統建置。先產生該目標的第三方授權文字，再使用鎖定相依版本打包：

```bash
# Windows x64，在 Windows 執行
node scripts/desktop-licenses.mjs --target x86_64-pc-windows-msvc --features custom-protocol
npm run tauri -- build --ci --target x86_64-pc-windows-msvc --bundles nsis -- --locked

# macOS Universal，在 macOS 執行
rustup target add aarch64-apple-darwin x86_64-apple-darwin
node scripts/desktop-licenses.mjs --target aarch64-apple-darwin --target x86_64-apple-darwin --features custom-protocol
npm run tauri -- build --ci --target universal-apple-darwin --bundles dmg -- --locked
```

### 直接由 GitHub 打包與發布

[桌面發布工作流程](.github/workflows/desktop.yml) 與 Pages 部署各自執行。更新網站不會每次都重新打包桌面 App。

1. 把完整更新合併至 `main`，同步修改 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 的應用版本。
2. 在 **Actions → Build desktop installers and publish release → Run workflow** 選擇 `main`。也可推送與應用版本完全一致的 `v*` tag 觸發。
3. GitHub 分別使用 `windows-2025` 與 `macos-15` 編譯，執行前端與 Rust 測試，並檢查 macOS 二進位同時含有 `arm64`／`x86_64`。
4. 兩個平台全部通過後，才建立該版本的 GitHub Release，附上安裝檔、授權說明、需要提供的第三方來源檔與 `SHA256SUMS.txt`。Actions 中的建置附件保留 30 天；Release 另存下載檔。

發布流程會核對來源 commit、版本與兩份 lockfile，並在發布前重算檔案 SHA-256。已發布版本不會被後續重跑覆寫；需要更新時提高版本號。建置工作只取得讀取權限，僅最後的發布工作能寫入 Release。

## 網站部署

正式網址：<https://avery320.github.io/pst/>

[部署工作流程](.github/workflows/deploy.yml) 會在 `main` 更新時自動執行，也可在 GitHub 的 Actions 頁面手動啟動。流程使用 Node.js 24，依序執行 `npm ci`、`npm test` 與 `npm run build`，成功後才將 `dist/` 發布到 GitHub Pages；測試或建置失敗時保留原本的線上版本。

Pages 的發布來源為 GitHub Actions，使用預設 HTTPS 網址。建置與發布分成兩個工作，僅發布工作取得 Pages 部署權限；官方 Actions 固定到已核對的 commit，並依序執行部署以避免互相中斷。

## 技術與開源底座

- **TypeScript + Vite**：使用原生 DOM 製作操作介面。
- **Rust + [Tauri 2](https://v2.tauri.app/)**：桌面視窗、原生檔案選擇與保存、Windows／macOS 安裝包。
- **[@visactor/vtable-gantt 1.26.8](https://github.com/VisActor/VTable/tree/v1.26.8/packages/vtable-gantt)**：表格與時間軸、里程碑、標記線及整圖匯出底座。
- **@visactor/vtable-editors 1.26.8**：表格文字與多行說明編輯器。
- **@visactor/vtable-plugins 1.26.8**：透過 gantt-extensions 入口延後載入官方 ExportGanttPlugin。
- **localStorage**：在網頁來源或桌面 App 資料空間保存目前文件；JSON 檔作為可攜式備份。

VTable 的核心採 [MIT 授權](https://github.com/VisActor/VTable/blob/v1.26.8/LICENSE)，允許商用與修改，須保留相應著作權與授權聲明。實際瀏覽器產物中還包含其他 MIT／BSD／ISC 授權元件及建置輔助碼，已整理於 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 和 [LICENSE-THIRD-PARTY.txt](./LICENSE-THIRD-PARTY.txt)，建置時也會複製到 dist/。

第三方授權與 pst 自有程式碼的對外授權分別處理；後者目前由專案擁有者保留決定。

桌面版的 Tauri 與相關 Rust 元件保留各自授權聲明。`scripts/desktop-licenses.mjs` 依鎖定版本及目標架構蒐集相依套件的原始授權文字，打包為 `THIRD_PARTY_RUST.txt`，Release 也會提供各平台對應的副本。

少量間接依賴採 MPL-2.0。專案會將這些未修改套件的完整原始 `.crate` 檔與來源說明放入桌面安裝資源及 Release，保留其授權與取得來源的方式；這些元件的授權不代表 pst 全部自有程式碼改採 MPL。授權蒐集器也保留上游精確版本的原文及來源紀錄，缺少資料時會停止打包。

## 程式結構

| 檔案 | 職責 |
| --- | --- |
| index.html、styles.css | 編輯器版面、響應式樣式與無障礙標籤。 |
| app.ts | 表單、文件操作、復原／重做、自動保存、JSON 與 PNG 下載。 |
| platform.ts | 網頁下載／桌面原生檔案操作切換、取消與錯誤處理、關閉視窗前提交編輯。 |
| src-tauri/ | Rust 主程式、檔案讀寫邊界、權限與跨平台打包設定。 |
| rust-toolchain.toml | 固定 Rust 建置工具鏈版本。 |
| chart.ts | VTable-Gantt 的整合層；將元件的可變資料與文件模型隔離。 |
| model.ts | 文件格式、驗證、日曆日期運算、範例及歷史快照。 |
| calendar.ts、calendar-picker.ts、calendar.css | 西曆運算、週次、日期範圍與可鍵盤操作的月曆。 |
| chart-dates.ts | 繪圖元件的日期轉換與舊有日期整合回歸。 |
| chart-interaction.ts、chart-interaction.css | 指標捕捉、拖曳吸附、預覽、取消與邊緣捲動。 |
| layout.ts | 面板拖曳、鍵盤調整、收合與版面偏好。 |
| *.test.ts | 文件、日曆、日期界限、拖曳與捲動的回歸測試。 |
| vite.config.ts | 靜態建置與第三方授權檔打包。 |
| .github/workflows/deploy.yml | GitHub Actions 測試、建置與 Pages 自動發布。 |
| .github/workflows/desktop.yml | Windows／macOS 安裝檔編譯、測試、核對與 GitHub Release 發布。 |
| scripts/desktop-release.mjs、scripts/desktop-licenses.mjs | 發布版本檢查、雜湊校驗、附件發布與 Rust 授權文字蒐集。 |

日期儲存為 YYYY-MM-DD 的日曆日期，模型使用 UTC 做天數運算；繪圖層轉為元件使用的本地日期格式，避免將 UTC 時間戳誤當成日曆日期。升級 VTable 時，應重新驗證跨時區拖曳、里程碑與標記標籤的整合行為。

## 保存與資料範圍

- 不需要帳號，文件資料不會由應用傳送到伺服器。
- 自動保存僅限目前瀏覽器來源或目前電腦的 pst App；清除網站／App 資料、切換裝置或使用無痕模式時，仍需依靠另存的 JSON。
- 如果環境禁止儲存或空間不足，介面會顯示提示；請另存 JSON 保留內容。
- 匯入文件會驗證每一列，不會默默刪除格式錯誤的項目。無法讀取的既有儲存內容會保留原始備份供下載。
- v0.1 的 schemaVersion 1 文件和自動保存內容可直接開啟；缺少的新日曆與拖曳設定會補上預設，原項目與日期保留。
- 目前支援 1900–2100 年、最多 200 個項目、50 條日期標記；顯示起訖日期相差不超過 730 天，匯入 JSON 不超過 1,000,000 bytes。
- PNG 單邊上限為 16,384 像素，總像素上限為 3,200 萬；超過時會提示縮小範圍或倍率，不會靜默裁切。

## 驗證狀態與目前界限

v0.3.0 的前端自動化測試共 72 項，包含 v0.2 的文件、日期、格點與歷史紀錄回歸，以及新增的原生檔案取消、錯誤、大小界線、原始備份保存和非同步關閉次序。桌面發布另執行 Rust 檔案處理測試、版本與附件校驗測試、TypeScript 檢查、兩個平台的正式編譯與 macOS Universal 架構／ad-hoc 簽章核對。

已在正式網站完成桌面瀏覽器互動抽查：日曆方向鍵與 Enter 選日、本週／全年範圍、1 天和 7 天吸附、整段移動保留天數、拖動右端調整日期、單次復原、時間軸滑桿、縮小後符合寬度、兩條分隔線拖曳、面板收合／還原，以及 JSON 下載。2 倍 PNG 已實際下載並目視確認，範例輸出為 2056 × 1178 像素，包含全部 8 個項目與日期標記。

上面的圖表互動與 PNG 目視紀錄來自 v0.2 正式網站。桌面安裝包的編譯和自動化測試不等同於在所有 Windows／macOS 設備上逐項人工驗收；原生對話框、系統縮放與首次安裝提示仍需在實際使用設備確認。觸控、窄螢幕、跨瀏覽器、長時間邊緣捲動與極端長寬圖片尚未做完整相容性驗收。

此版本提供固定的項目、起日、迄日與說明欄位，以及日期標線和里程碑。任意新增欄位、合併儲存格、自由文字框、箭頭塗鴉、SVG／PDF 輸出與跨裝置同步尚未實作。

日期標記的標籤有固定最大寬度，過長文字會省略；日期很接近時，標籤可能重疊。這部分尚未提供自動避讓排版。

此版加入可離線使用的桌面程式與自動打包發布；跨裝置協作與進階自由繪圖仍留待後續版本。
