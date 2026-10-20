# 共用樣式與排版 API

本階段維持原生 HTML／CSS，不增加 UI 框架。新增功能使用以下 API；尺寸、文字與顏色的唯一來源為 `src/presentation/design.ts`。

## 設計值

`DESIGN_TOKENS` 同時供 CSS、SVG 與 PNG 使用。`src/app.ts` 啟動時呼叫一次 `applyDesignTokens(document.documentElement)`，將它們設為 `--ui-*` CSS 變數。修改設計值後重新建置／載入，避免個別元件覆寫尺寸。

| 類別 | 標準 |
| --- | --- |
| 文字 | 內文與控制項 12px；區塊標題 14px；文件／對話框標題 20px。 |
| 字重 | 一般 400；標題、選取狀態及強調 600。 |
| 文字顏色 | `color-text`、`color-muted`、`color-accent`；錯誤用 `color-danger`。 |
| 間距 | `space-1`／`space-2`／`space-3`／`space-4`：4／8／12／16px。 |
| 尺寸 | 控制項 28px，圖示 16px，圖表資料列 36px，兩層表頭合計 56px。 |
| 背景與邊框 | 使用 `color-surface`、`color-subtle`、`color-border` 和狀態色；項目自訂色保留在文件中。 |

CSS 使用 `var(--ui-font-body)`、`var(--ui-color-muted)` 等變數；需要 SVG／Canvas 數值時使用 `tokenNumber('font-body')`。此函式的型別只接受 px 尺寸值。

## 排版類別

| API | 用途 |
| --- | --- |
| `ui-stack` | 垂直排列，統一 8px 間距。 |
| `ui-row`、`ui-between`、`ui-grow` | 水平排列、兩端對齊、填滿剩餘寬度。 |
| `ui-grid`、`data-columns="2"` | 單欄或兩個可縮小的等寬欄位。 |
| `ui-field` | 標籤與控制項，統一 4px 間距和控制項寬度。 |
| `ui-section` | 以一條邊框及 8px 上間距區分功能區塊。 |
| `ui-toggle` | 文字與勾選框對齊的一列設定。 |
| `ui-title`、`ui-heading`、`ui-muted` | 文件標題、區塊標題與次要文字。 |
| `ui-scroll` | 可縮小的獨立捲動區，共用捲軸外觀與鍵盤焦點樣式。 |

例如，項目的名稱／類型、起訖日期，以及圖面的週首／吸附設定，均使用同一組兩欄 API：

```html
<div class="ui-grid" data-columns="2">
  <div class="ui-field"><label for="first">第一欄</label><input id="first" /></div>
  <div class="ui-field"><label for="second">第二欄</label><select id="second"></select></div>
</div>
```

按鈕共用基本尺寸，使用 `button-primary`、`button-secondary`、`button-tinted` 或 `button-quiet` 表達層級；圖示按鈕使用 `icon-button`。動態 DOM 使用 `createElement`、`createButton` 及 `icon`；側欄與拖曳圖層共用建立函式。

輸入框聚焦時只改變既有邊框顏色，不增加外框、陰影或尺寸；捲動區使用內側焦點線，分隔區保留鍵盤焦點提示。色票的選取也只改原邊框。自訂顏色輸入框共用 28 × 28px 方形，內外均不使用圓角。

日期欄位直接使用 `input[type="date"]`，透過 `value`、`min`、`max` 與 `change` 串接文件；不再建立額外包裝、對話框或月曆狀態。月曆呈現與週首依瀏覽器語系；文件的週首設定仍供時間軸及範圍導覽使用。

## 工作區與捲動

桌面工作區使用視窗剩餘高度，不因視窗高度較小而改成 620px 固定面板。980px 以下改為上下堆疊，圖表與側欄各有受限高度及自己的捲動區。

表格與時間軸都使用 `ui-scroll`，提供可聚焦的原生捲動區，只有超出容器才捲動。垂直捲動以同一個 `synchronize` 方法保持列對齊，水平捲動各自獨立；文件重新繪圖時保留表格的水平位置。只有一側出現水平捲軸時，另一側補上相同底部空間，讓兩側垂直捲動到底仍能對齊。

`src/presentation/layout.ts` 的 `createChartLayout` 是圖表尺寸的共用入口：

- 表格以自然欄寬為起點，按各欄可縮空間等比例縮小。名稱／說明最小 96px，日期最小 76px；三欄合計最小 248px，含說明則最小 344px，容器再窄才水平捲動。大於自然欄寬的空間交給名稱欄。
- 時間軸實際日寬取「文件設定值」與「可用寬度 ÷ 日期數」的較大值，保留小數精度，讓表頭、格線與圖形填滿容器。文件值至少 1px；「符合寬度」將它設回 1，後續隨容器自適應。
- 實際日寬同時用於 SVG、拖曳命中範圍、預覽、日期定位、捲動中心與 PNG；不以 CSS 拉伸圖形，也不把容器尺寸寫回文件或歷史。

新建文件與範例的範圍為當年 1 月至 12 月，預設月份表頭和 1px 最小日寬。讀取既有文件時保留其日期、縮放與刻度設定。

兩條分隔線只使用 `src/ui/splitter.ts` 的 `setupSplitter`。呼叫端提供目前寬度、界限及寫入函式；共用實作處理拖曳、Escape／失焦取消、方向鍵、Shift 步幅、Home／End、Enter／雙擊重設及 ARIA 值。右側面板使用 `direction: -1`，不再複製一套反向拖曳程式。

表格與時間軸之間的分隔區維持 8px 透明命中範圍，沒有背景線、邊框或中央握柄。可直接在該處拖曳，鍵盤操作仍可使用。

`splitBounds` 會先保留分隔線寬度，再限制兩側最小可用範圍。偏好寬度與當下可顯示寬度分開處理，縮小後重新放大視窗時可以恢復原本寬度。

## 驗證界限

共用分隔線的界限、方向及鍵盤計算，以及欄位縮小、全年／閏年範圍、時間軸填滿、分數日寬的拖曳與匯出幾何都有自動測試。另以終端核對設計變數、樣式引用、UI ID、TypeScript 與正式建置。遵照使用者要求，本輪沒有操作或擷取已開啟的網頁，最終外觀及指標互動仍需人工驗收。
