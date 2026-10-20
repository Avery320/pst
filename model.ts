/** Calendar dates are YYYY-MM-DD values, never local-time timestamps. */
export interface TimelineItem {
  id: string;
  name: string;
  start: string;
  end: string;
  type: "task" | "milestone";
  color: string;
  note: string;
}

export interface DateMarker {
  id: string;
  date: string;
  label: string;
  color: string;
}

/** Normalized view settings. Older schema-1 documents receive the new defaults. */
export interface TimelineView {
  start: string;
  end: string;
  scale: "day" | "week" | "month";
  dayWidth: number;
  rowHeight: number;
  showNotes: boolean;
  showWeekends: boolean;
  weekStartsOn: 0 | 1;
  showToday: boolean;
  snapDays: 1 | 7;
  showGrid: boolean;
}

export interface TimelineDocument {
  schemaVersion: 1;
  title: string;
  subtitle: string;
  items: TimelineItem[];
  markers: DateMarker[];
  view: TimelineView;
}

const DAY_MS = 86_400_000;
const MIN_DATE = "1900-01-01";
const MAX_DATE = "2100-12-31";
const MAX_JSON_LENGTH = 1_000_000;
const TEXT_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

/** True only for real calendar dates in the supported year range. */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateMilliseconds(value: unknown, label = "日期"): number {
  if (!isValidDate(value)) {
    throw new Error(`${label}必須是 1900 至 2100 年之間有效的 YYYY-MM-DD 日期。`);
  }
  return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
}

/** Add whole calendar days; UTC arithmetic avoids daylight-saving offsets. */
export function addDays(iso: string, days: number): string {
  const start = dateMilliseconds(iso);
  if (!Number.isSafeInteger(days)) throw new Error("增減天數必須是有效的整數。");
  const date = new Date(start + days * DAY_MS);
  if (!Number.isFinite(date.getTime())) throw new Error("計算後的日期超出支援範圍。");
  const result = date.toISOString().slice(0, 10);
  if (!isValidDate(result)) throw new Error("計算後的日期必須介於 1900-01-01 與 2100-12-31。");
  return result;
}

/** Signed elapsed days: equal dates return 0, and reversed dates return a negative value. */
export function daysBetween(start: string, end: string): number {
  return (dateMilliseconds(end, "結束日期") - dateMilliseconds(start, "開始日期")) / DAY_MS;
}

export function formatShortDate(iso: string): string {
  dateMilliseconds(iso);
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

type RecordValue = Record<string, unknown>;

function record(value: unknown, label: string): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}必須是物件。`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label}必須是一般資料物件。`);
  }
  return value as RecordValue;
}

/** Only own data properties are read; accessors and inherited data are not accepted. */
function field(object: RecordValue, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !("value" in descriptor)) throw new Error(`${label}缺少有效的「${key}」欄位。`);
  return descriptor.value;
}

/** A missing field may migrate; an explicit undefined/accessor must still fail. */
function optionalField(object: RecordValue, key: string, fallback: unknown): unknown {
  if (!Object.hasOwn(object, key)) return fallback;
  return field(object, key, "顯示設定");
}

function textField(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${label}必須是文字。`);
  if (!allowEmpty && value.trim().length === 0) throw new Error(`${label}不可空白。`);
  if (value.length > maxLength) throw new Error(`${label}最多可輸入 ${maxLength} 個字元。`);
  if (TEXT_CONTROL_CHARACTERS.test(value)) throw new Error(`${label}包含不支援的控制字元。`);
  return value;
}

function dateField(value: unknown, label: string): string {
  dateMilliseconds(value, label);
  return value as string;
}

function colorField(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${label}必須是 #RRGGBB 格式的六位十六進位色碼。`);
  }
  return value;
}

function numberField(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label}必須是 ${minimum} 至 ${maximum} 之間的數值。`);
  }
  return value;
}

function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}必須是布林值。`);
  return value;
}

function arrayField(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必須是陣列。`);
  if (value.length > maximum) throw new Error(`${label}最多可有 ${maximum} 筆。`);
  return value;
}

/**
 * Validate every row and return a fresh document containing known fields only.
 * Milestones use their start date for both endpoints; both input dates must be valid.
 */
export function validateDocument(value: unknown): TimelineDocument {
  const source = record(value, "時程文件");
  if (field(source, "schemaVersion", "時程文件") !== 1) {
    throw new Error("不支援這個時程檔案版本；目前僅支援 schemaVersion 1。");
  }
  const title = textField(field(source, "title", "時程文件"), "圖表標題", 120);
  const subtitle = textField(field(source, "subtitle", "時程文件"), "圖表副標題", 240, true);
  const itemValues = arrayField(field(source, "items", "時程文件"), "任務資料", 200);
  const markerValues = arrayField(field(source, "markers", "時程文件"), "日期標記", 50);
  const ids = new Set<string>();
  const readId = (row: RecordValue, label: string): string => {
    const id = textField(field(row, "id", label), `${label}的識別碼`, 100);
    if (/\s/u.test(id)) throw new Error(`${label}的識別碼不可包含空白字元。`);
    if (ids.has(id)) throw new Error(`${label}的識別碼「${id}」重複，任務與標記必須使用不同識別碼。`);
    ids.add(id);
    return id;
  };

  // Array.from visits sparse entries too: an invalid row must never silently disappear.
  const items = Array.from(itemValues, (value, index): TimelineItem => {
    const label = `第 ${index + 1} 筆任務`;
    const row = record(value, label);
    const id = readId(row, label);
    const name = textField(field(row, "name", label), `${label}的名稱`, 160);
    const type = field(row, "type", label);
    if (type !== "task" && type !== "milestone") throw new Error(`${label}的類型必須是 task 或 milestone。`);
    const start = dateField(field(row, "start", label), `${label}的開始日期`);
    const suppliedEnd = dateField(field(row, "end", label), `${label}的結束日期`);
    if (type === "task" && start > suppliedEnd) throw new Error(`${label}的結束日期不可早於開始日期。`);
    const end = type === "milestone" ? start : suppliedEnd;
    const color = colorField(field(row, "color", label), `${label}的顏色`);
    const note = textField(field(row, "note", label), `${label}的備註`, 1000, true);
    return { id, name, start, end, type, color, note };
  });

  const markers = Array.from(markerValues, (value, index): DateMarker => {
    const rowLabel = `第 ${index + 1} 筆日期標記`;
    const row = record(value, rowLabel);
    const id = readId(row, rowLabel);
    const date = dateField(field(row, "date", rowLabel), `${rowLabel}的日期`);
    const label = textField(field(row, "label", rowLabel), `${rowLabel}的文字`, 120);
    const color = colorField(field(row, "color", rowLabel), `${rowLabel}的顏色`);
    return { id, date, label, color };
  });

  const sourceView = record(field(source, "view", "時程文件"), "顯示設定");
  const start = dateField(field(sourceView, "start", "顯示設定"), "顯示開始日期");
  const end = dateField(field(sourceView, "end", "顯示設定"), "顯示結束日期");
  if (start > end) throw new Error("顯示結束日期不可早於顯示開始日期。");
  if (daysBetween(start, end) > 730) throw new Error("時間軸的顯示範圍不可超過 730 天。");
  const scale = field(sourceView, "scale", "顯示設定");
  if (scale !== "day" && scale !== "week" && scale !== "month") {
    throw new Error("時間刻度必須是 day、week 或 month。");
  }
  const dayWidth = numberField(field(sourceView, "dayWidth", "顯示設定"), "每日寬度", 1, 80);
  const rowHeight = numberField(field(sourceView, "rowHeight", "顯示設定"), "資料列高度", 32, 64);
  const showNotes = booleanField(field(sourceView, "showNotes", "顯示設定"), "顯示備註設定");
  const showWeekends = booleanField(field(sourceView, "showWeekends", "顯示設定"), "顯示週末設定");
  const weekStartsOn = optionalField(sourceView, "weekStartsOn", 1);
  if (weekStartsOn !== 0 && weekStartsOn !== 1) throw new Error("每週起始日必須是 0（週日）或 1（週一）。");
  const showToday = booleanField(optionalField(sourceView, "showToday", true), "顯示今日線設定");
  const snapDays = optionalField(sourceView, "snapDays", 1);
  if (snapDays !== 1 && snapDays !== 7) throw new Error("拖曳對齊天數必須是 1 或 7。");
  const showGrid = booleanField(optionalField(sourceView, "showGrid", true), "顯示格線設定");

  return {
    schemaVersion: 1,
    title,
    subtitle,
    items,
    markers,
    view: { start, end, scale, dayWidth, rowHeight, showNotes, showWeekends, weekStartsOn, showToday, snapDays, showGrid },
  };
}

export function parseDocument(text: string): TimelineDocument {
  if (typeof text !== "string") throw new Error("匯入內容必須是 JSON 文字。");
  if (text.length > MAX_JSON_LENGTH) throw new Error("匯入檔案過大，請使用小於 100 萬字元的時程檔案。");
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch {
    throw new Error("JSON 格式不正確，請選擇有效的 pst 時程檔案。");
  }
  return validateDocument(value);
}

export function serializeDocument(doc: TimelineDocument): string {
  return `${JSON.stringify(validateDocument(doc), null, 2)}\n`;
}

export function cloneDocument(doc: TimelineDocument): TimelineDocument {
  return validateDocument(doc);
}

/** Content bounds ignore the current viewport; an empty document falls back to its view. */
export function getDocumentBounds(doc: TimelineDocument): { start: string; end: string } {
  let start: string | undefined;
  let end: string | undefined;
  const include = (date: string) => {
    if (start === undefined || date < start) start = date;
    if (end === undefined || date > end) end = date;
  };
  for (const item of doc.items) {
    include(item.start);
    include(item.end);
  }
  for (const marker of doc.markers) include(marker.date);
  return { start: start ?? doc.view.start, end: end ?? doc.view.end };
}

let fallbackIdCounter = 0;

export function makeId(prefix = "item"): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "item";
  const randomId = globalThis.crypto?.randomUUID?.();
  const suffix = randomId ?? `${Date.now().toString(36)}-${(++fallbackIdCounter).toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${safePrefix}-${suffix}`;
}

function todayCalendarDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function createEmptyDocument(today = todayCalendarDate()): TimelineDocument {
  dateMilliseconds(today);
  const start = `${today.slice(0, 7)}-01`;
  const lastDay = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0));
  const end = lastDay.toISOString().slice(0, 10);
  return {
    schemaVersion: 1,
    title: "未命名時程表",
    subtitle: "",
    items: [],
    markers: [],
    view: {
      start, end, scale: "week", dayWidth: 18, rowHeight: 48,
      showNotes: false, showWeekends: true, weekStartsOn: 1, showToday: true, snapDays: 1, showGrid: true,
    },
  };
}

export function createDemoDocument(today = todayCalendarDate()): TimelineDocument {
  const doc = createEmptyDocument(today);
  const latestStart = addDays(MAX_DATE, -41);
  const start = doc.view.start > latestStart ? latestStart : doc.view.start;
  const rows: Array<[string, number, number, TimelineItem["type"], string, string]> = [
    ["需求與版面確認", 1, 5, "task", "#5269E8", "確認表格欄位、日期刻度與閱讀順序。"],
    ["資料欄位整理", 4, 9, "task", "#6B7A90", "整理任務名稱、日期與說明文字。"],
    ["版面定稿", 10, 10, "milestone", "#E6A23C", "確認第一版圖表樣式。"],
    ["時間軸互動製作", 11, 20, "task", "#5269E8", "完成拖曳、縮放與日期對齊。"],
    ["標記與表格編輯", 15, 24, "task", "#20A292", "加入色彩、備註與日期標記。"],
    ["出圖與版面檢查", 25, 30, "task", "#9B6BD3", "檢查文字、表格及時間軸的輸出效果。"],
    ["操作驗證與調整", 29, 35, "task", "#ED8C4A", "以實際時程驗證編輯、存檔與復原操作。"],
    ["第一版發佈", 37, 37, "milestone", "#D5617D", "交付可編輯資料與完成的時程圖。"],
  ];
  doc.title = "產品上線時程";
  doc.subtitle = "從需求整理到正式發佈，讓每個階段一目了然。";
  doc.items = rows.map(([name, from, to, type, color, note]) => ({
    id: makeId("task"), name, start: addDays(start, from), end: addDays(start, to), type, color, note,
  }));
  doc.markers = [
    { id: makeId("marker"), date: addDays(start, 10), label: "設計檢視", color: "#B7791F" },
    { id: makeId("marker"), date: addDays(start, 37), label: "交付日", color: "#B34E6C" },
  ];
  doc.view.start = start < MIN_DATE ? MIN_DATE : start;
  doc.view.end = addDays(start, 41);
  return validateDocument(doc);
}

/** Bounded snapshots; the limit includes the current document. */
export class DocumentHistory {
  #snapshots: TimelineDocument[];
  #index = 0;
  #limit: number;

  constructor(initial: TimelineDocument, limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("歷史紀錄上限必須是大於零的整數。");
    this.#limit = limit;
    this.#snapshots = [cloneDocument(initial)];
  }

  get current(): TimelineDocument {
    return cloneDocument(this.#snapshots[this.#index]);
  }

  get canUndo(): boolean {
    return this.#index > 0;
  }

  get canRedo(): boolean {
    return this.#index < this.#snapshots.length - 1;
  }

  commit(next: TimelineDocument): void {
    const snapshot = cloneDocument(next);
    if (JSON.stringify(snapshot) === JSON.stringify(this.#snapshots[this.#index])) return;
    this.#snapshots = this.#snapshots.slice(0, this.#index + 1);
    this.#snapshots.push(snapshot);
    if (this.#snapshots.length > this.#limit) {
      this.#snapshots.splice(0, this.#snapshots.length - this.#limit);
    }
    this.#index = this.#snapshots.length - 1;
  }

  undo(): TimelineDocument {
    if (this.canUndo) this.#index--;
    return this.current;
  }

  redo(): TimelineDocument {
    if (this.canRedo) this.#index++;
    return this.current;
  }
}
