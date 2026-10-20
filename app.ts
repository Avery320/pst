import './styles.css';
import { TimelineChart } from './chart.ts';
import {
  countWeekdays, endOfMonth, endOfWeek, formatDateZh, formatWeekdayZh,
  getISOWeek, localToday, shiftRange, startOfMonth, startOfWeek,
} from './calendar.ts';
import { attachDatePickers } from './calendar-picker.ts';
import { setupWorkspaceLayout } from './layout.ts';
import { isDesktop, openDocument, saveBlob, MAX_IMPORT_BYTES, installCloseHandler } from './platform.ts';
import packageInfo from './package.json';
import {
  DocumentHistory, addDays, cloneDocument, createDemoDocument, createEmptyDocument,
  daysBetween, getDocumentBounds, isValidDate, makeId, parseDocument,
  serializeDocument, validateDocument,
} from './model.ts';
import type { DateMarker, TimelineDocument, TimelineItem } from './model.ts';

const STORAGE_KEY = 'pst.document.v1';
const RECOVERY_KEY = 'pst.recovery.v1';
const DESKTOP = isDesktop();
const EXPORT_ACTION_LABEL = DESKTOP ? '儲存 PNG 圖片' : '下載 PNG 圖片';
const COLORS = ['#176b61', '#5269e8', '#e5913a', '#9b6bd3', '#d5617d', '#6b7a90'];
const COLOR_NAMES = ['松綠', '靛藍', '暖橘', '紫藤', '玫瑰', '石灰藍'];
const ICONS: Record<string, string> = {
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M12 12v6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 8l5-5 5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  timeline: '<path d="M4 4v16M8 5h7M11 11h9M8 17h5"/><path d="M3 5h2M3 11h2M3 17h2"/>',
  undo: '<path d="M3 9h11a6 6 0 0 1 0 12M3 9l5-5M3 9l5 5"/>',
  redo: '<path d="M21 9H10a6 6 0 0 0 0 12M21 9l-5-5M21 9l-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  diamond: '<path d="m12 3 9 9-9 9-9-9z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
  pointer: '<path d="m4 3 7 18 3-7 7-3z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  lightbulb: '<path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 10h6M9 12h6M17 16h6"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  fileImage: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M7 18l3-4 3 3 2-2 3 3"/><circle cx="9" cy="10" r="1"/>',
};

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
}

function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.info}</svg>`;
}

for (const target of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  target.innerHTML = icon(target.dataset.icon!); // Icons are fixed, trusted application markup.
}
element('app-version').textContent = `pst v${packageInfo.version}${DESKTOP ? ' 桌面版' : ''}`;
element('footer-storage').textContent = DESKTOP ? '資料保存在這台電腦' : '資料保存在你的瀏覽器';
element('storage-description').textContent = DESKTOP
  ? '編輯會自動保存在這台電腦的 pst App。另存 JSON，可備份或在網頁版接續編輯。'
  : '編輯會自動保存在目前瀏覽器。下載 JSON，可在另一台裝置接續編輯。';
element('settings-save-label').textContent = DESKTOP ? '另存可編輯的 JSON' : '下載可編輯的 JSON';
element('export-button-label').textContent = EXPORT_ACTION_LABEL;

let startupMessage = '';
let recoveryRaw: string | null = null;
let autosaveAllowed = true;
let initialDocument: TimelineDocument;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  recoveryRaw = localStorage.getItem(RECOVERY_KEY);
  if (saved) {
    try {
      initialDocument = parseDocument(saved);
    } catch {
      recoveryRaw = saved;
      try { localStorage.setItem(RECOVERY_KEY, saved); } catch { autosaveAllowed = false; }
      initialDocument = createDemoDocument();
      startupMessage = '上次的儲存內容無法讀取，已保留原始內容。可到「圖面」另存備份；目前先開啟範例。';
    }
  } else {
    initialDocument = createDemoDocument();
  }
} catch {
  initialDocument = createDemoDocument();
  startupMessage = '目前無法自動保存。編輯完成後，請另存 JSON 保留內容。';
}

const history = new DocumentHistory(initialDocument);
let state = history.current;
let selectedId = state.items[0]?.id ?? '';
let editingMarkerId: string | null = null;
let chart: TimelineChart | null = null;
let chartFrame = 0;
let toastTimer = 0;
let exporting = false;
let fileOperationPending = false;
let dragging = false;
let pendingScrollDate: string | null = null;
let datePickers: ReturnType<typeof attachDatePickers> | null = null;
const exportDialog = element<HTMLDialogElement>('export-dialog');

function renderTimelineScroll(metrics = chart?.getScrollMetrics()): void {
  const rail = element<HTMLInputElement>('timeline-scroll');
  if (!metrics) { rail.disabled = true; return; }
  rail.disabled = metrics.max <= 0;
  rail.value = String(metrics.max > 0 ? Math.round(metrics.left / metrics.max * 1000) : 0);
  const totalDays = daysBetween(state.view.start, state.view.end) + 1;
  const startOffset = Math.min(totalDays - 1, Math.max(0, Math.floor(metrics.left / state.view.dayWidth)));
  const endOffset = Math.min(totalDays - 1, Math.max(startOffset, Math.ceil((metrics.left + metrics.viewport) / state.view.dayWidth) - 1));
  const start = addDays(state.view.start, startOffset);
  const end = addDays(state.view.start, endOffset);
  const label = `${start} — ${end}`;
  element('timeline-scroll-label').textContent = label;
  rail.setAttribute('aria-valuetext', `目前可見 ${label}`);
}

function toast(message: string, error = false): void {
  const target = element('toast');
  window.clearTimeout(toastTimer);
  target.textContent = message;
  target.classList.toggle('error', error);
  target.setAttribute('role', error ? 'alert' : 'status');
  target.hidden = false;
  toastTimer = window.setTimeout(() => { target.hidden = true; }, error ? 8000 : 4000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作無法完成，請稍後再試。';
}

function saveLocally(): void {
  const status = element('save-status');
  const text = document.createElement('span');
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  let failed = false;
  try {
    if (!autosaveAllowed) throw new Error('recovery pending');
    localStorage.setItem(STORAGE_KEY, serializeDocument(state));
    text.textContent = DESKTOP ? '已儲存在這台電腦' : '已儲存在此瀏覽器';
  } catch {
    failed = true;
    text.textContent = autosaveAllowed ? '自動保存不可用，請另存 JSON' : '請先另存原始備份，再繼續保存';
  }
  status.replaceChildren(dot, text);
  status.classList.toggle('error', failed);
}

function scheduleChart(): void {
  window.cancelAnimationFrame(chartFrame);
  chartFrame = window.requestAnimationFrame(() => {
    try {
      if (chart) {
        chart.update(state, selectedId);
      } else {
        chart = new TimelineChart(element('chart'), state, {
          onSelect: selectItem,
          onDatesChange: (id, start, end) => updateItem(id, { start, end }),
          onNameChange: (id, name) => updateItem(id, { name }),
          onNoteChange: (id, note) => updateItem(id, { note }),
          onError: message => { toast(message, true); scheduleChart(); },
          onScrollChange: renderTimelineScroll,
          onDragStateChange: active => {
            dragging = active;
            element('drag-status').textContent = active
              ? `對齊 ${state.view.snapDays} 天格點 · 放開套用 · Esc 取消`
              : `對齊 ${state.view.snapDays} 天格點 · 拖動時預覽落點`;
          },
        });
        if (selectedId) chart.selectItem(selectedId);
      }
      if (pendingScrollDate) {
        chart.scrollToDate(pendingScrollDate);
        pendingScrollDate = null;
      }
      renderTimelineScroll();
      element('chart-error').hidden = true;
    } catch (error) {
      element('chart-error').hidden = false;
      element('chart-error-message').textContent = `${errorMessage(error)} 你仍可下載 JSON 保留資料。`;
      element('empty-chart').hidden = true;
      console.error('pst chart could not render', error);
    }
  });
}

/** A single path for edits keeps history, persistence, forms and chart in sync. */
function commitDocument(next: TimelineDocument, message?: string): boolean {
  try {
    history.commit(validateDocument(next));
    state = history.current;
    render();
    saveLocally();
    if (message) toast(message);
    return true;
  } catch (error) {
    toast(errorMessage(error), true);
    render();
    return false;
  }
}

function editDocument(edit: (draft: TimelineDocument) => void, message?: string): boolean {
  try {
    const draft = cloneDocument(state);
    edit(draft);
    return commitDocument(draft, message);
  } catch (error) {
    toast(errorMessage(error), true);
    render();
    return false;
  }
}

function updateItem(id: string, changes: Partial<TimelineItem>): void {
  editDocument(draft => {
    const item = draft.items.find(candidate => candidate.id === id);
    if (!item) return;
    Object.assign(item, changes);
    if (item.type === 'milestone') item.end = item.start;
  });
}

function currentItem(): TimelineItem | undefined {
  return state.items.find(item => item.id === selectedId);
}

function setTab(tab: 'item' | 'markers' | 'settings', focus = false): void {
  datePickers?.close();
  for (const name of ['item', 'markers', 'settings']) {
    const button = element(`tab-${name}`);
    const active = name === tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    element(`pane-${name}`).hidden = !active;
    if (active && focus) button.focus();
  }
}

function selectItem(id: string): void {
  if (!state.items.some(item => item.id === id)) return;
  selectedId = id;
  setTab('item');
  renderItem();
  chart?.selectItem(id);
}

function renderItem(): void {
  if (!state.items.some(item => item.id === selectedId)) selectedId = state.items[0]?.id ?? '';
  const select = element<HTMLSelectElement>('selected-item');
  select.replaceChildren();
  for (const [index, item] of state.items.entries()) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${String(index + 1).padStart(2, '0')}  ${item.name}`;
    select.append(option);
  }
  select.value = selectedId;
  select.disabled = state.items.length === 0;
  const item = currentItem();
  element('item-fields').hidden = !item;
  element('no-selection').hidden = Boolean(item);
  element('item-kind-badge').hidden = !item;
  if (!item) { datePickers?.refresh(); return; }
  element('item-kind-badge').textContent = item.type === 'milestone' ? '里程碑' : '時段';
  element<HTMLInputElement>('item-name').value = item.name;
  element<HTMLSelectElement>('item-type').value = item.type;
  element<HTMLInputElement>('item-start').value = item.start;
  const end = element<HTMLInputElement>('item-end');
  end.value = item.end;
  end.disabled = item.type === 'milestone';
  element('item-duration').textContent = item.type === 'milestone'
    ? formatDateZh(item.start)
    : `${formatWeekdayZh(item.start)} → ${formatWeekdayZh(item.end)} · 共 ${daysBetween(item.start, item.end) + 1} 天 · 週一至週五 ${countWeekdays(item.start, item.end)} 天`;
  element<HTMLInputElement>('item-start').title = formatDateZh(item.start);
  end.title = formatDateZh(item.end);
  element<HTMLInputElement>('item-color').value = item.color;
  element<HTMLTextAreaElement>('item-note').value = item.note;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-color]')) {
    button.setAttribute('aria-pressed', String(button.dataset.color === item.color.toLowerCase()));
  }
  const index = state.items.findIndex(row => row.id === selectedId);
  element<HTMLButtonElement>('move-up').disabled = index === 0;
  element<HTMLButtonElement>('move-down').disabled = index === state.items.length - 1;
  element<HTMLButtonElement>('duplicate-item').disabled = state.items.length >= 200;
  datePickers?.refresh();
}

function renderMarkers(): void {
  element('marker-count').textContent = String(state.markers.length);
  const list = element('marker-list');
  list.replaceChildren();
  if (!state.markers.length) {
    const empty = document.createElement('p');
    empty.className = 'pane-description';
    empty.textContent = '還沒有日期標記。試著標出一個重要日期。';
    list.append(empty);
  }
  for (const marker of state.markers) {
    const row = document.createElement('div');
    row.className = `marker-card${editingMarkerId === marker.id ? ' active' : ''}`;
    const line = document.createElement('span');
    line.className = 'marker-line';
    line.style.backgroundColor = marker.color;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'marker-edit';
    const label = document.createElement('strong');
    label.textContent = marker.label;
    const date = document.createElement('small');
    date.textContent = `${marker.date.replaceAll('-', '.')} ${formatWeekdayZh(marker.date)}`;
    edit.append(label, date);
    edit.setAttribute('aria-label', `編輯標記：${marker.label}，${marker.date}`);
    edit.addEventListener('click', () => fillMarkerEditor(marker));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-button danger-button';
    remove.setAttribute('aria-label', `刪除標記：${marker.label}`);
    remove.innerHTML = icon('trash');
    remove.addEventListener('click', () => {
      if (editingMarkerId === marker.id) resetMarkerEditor();
      editDocument(draft => { draft.markers = draft.markers.filter(value => value.id !== marker.id); }, '日期標記已刪除，可使用復原還原。');
    });
    row.append(line, edit, remove);
    list.append(row);
  }
}

function resetMarkerEditor(): void {
  editingMarkerId = null;
  element<HTMLFormElement>('marker-form').reset();
  element<HTMLInputElement>('marker-date').value = state.view.start;
  element('marker-form-heading').textContent = '新增標記';
  element('save-marker-label').textContent = '新增標記';
  element('cancel-marker').hidden = true;
  datePickers?.refresh();
}

function fillMarkerEditor(marker: DateMarker): void {
  editingMarkerId = marker.id;
  element<HTMLInputElement>('marker-label').value = marker.label;
  element<HTMLInputElement>('marker-date').value = marker.date;
  element<HTMLInputElement>('marker-color').value = marker.color;
  element('marker-form-heading').textContent = '編輯標記';
  element('save-marker-label').textContent = '儲存標記';
  element('cancel-marker').hidden = false;
  renderMarkers();
  datePickers?.refresh();
  element('marker-label').focus();
}

function render(): void {
  element<HTMLInputElement>('document-title').value = state.title;
  element('document-subtitle').textContent = state.subtitle || '編輯項目與日期，製作你的下一張時間圖。';
  document.title = `${state.title} · pst`;
  const milestoneCount = state.items.filter(item => item.type === 'milestone').length;
  element('document-stats').textContent = `${state.items.length - milestoneCount} 個時段 · ${milestoneCount} 個節點 · ${state.markers.length} 條標記`;
  element<HTMLInputElement>('view-start').value = state.view.start;
  element<HTMLInputElement>('view-end').value = state.view.end;
  element<HTMLInputElement>('zoom').value = String(state.view.dayWidth);
  element<HTMLOutputElement>('zoom-value').value = `${state.view.dayWidth}px`;
  element<HTMLButtonElement>('zoom-out').disabled = state.view.dayWidth <= 1;
  element<HTMLButtonElement>('zoom-in').disabled = state.view.dayWidth >= 80;
  element<HTMLButtonElement>('undo').disabled = !history.canUndo;
  element<HTMLButtonElement>('redo').disabled = !history.canRedo;
  element<HTMLButtonElement>('add-task').disabled = state.items.length >= 200;
  element<HTMLButtonElement>('add-milestone').disabled = state.items.length >= 200;
  element<HTMLButtonElement>('open-export').disabled = state.items.length === 0;
  element<HTMLTextAreaElement>('subtitle').value = state.subtitle;
  const rowHeight = element<HTMLSelectElement>('row-height');
  const customHeight = rowHeight.querySelector('option[data-custom]');
  customHeight?.remove();
  if (![36, 48, 60].includes(state.view.rowHeight)) {
    const option = document.createElement('option');
    option.value = String(state.view.rowHeight);
    option.textContent = `自訂 · ${state.view.rowHeight} px`;
    option.dataset.custom = 'true';
    rowHeight.append(option);
  }
  rowHeight.value = String(state.view.rowHeight);
  element<HTMLInputElement>('show-notes').checked = state.view.showNotes;
  element<HTMLInputElement>('show-weekends').checked = state.view.showWeekends;
  element<HTMLSelectElement>('week-start').value = String(state.view.weekStartsOn);
  element<HTMLInputElement>('show-today').checked = state.view.showToday;
  element<HTMLInputElement>('show-grid').checked = state.view.showGrid;
  element<HTMLSelectElement>('snap-days').value = String(state.view.snapDays);
  element('drag-status').textContent = `對齊 ${state.view.snapDays} 天格點 · 拖動時預覽落點`;
  const isoWeek = getISOWeek(state.view.start);
  element('calendar-summary').textContent = `${formatWeekdayZh(state.view.start)} — ${formatWeekdayZh(state.view.end)} · ${daysBetween(state.view.start, state.view.end) + 1} 天 · ${state.view.weekStartsOn === 1 ? '週一' : '週日'}起算`;
  element('calendar-summary').title = `${formatDateZh(state.view.start)} 至 ${formatDateZh(state.view.end)}；起日為 ISO ${isoWeek.year}-W${String(isoWeek.week).padStart(2, '0')}`;
  element<HTMLInputElement>('view-start').title = formatDateZh(state.view.start);
  element<HTMLInputElement>('view-end').title = formatDateZh(state.view.end);
  for (const [id, amount] of [['range-prev', -1], ['range-next', 1]] as const) {
    const next = shiftRange(state.view, state.view.scale, amount);
    const button = element<HTMLButtonElement>(id);
    const label = `${amount < 0 ? '往前' : '往後'}一${{ day: '天', week: '週', month: '月' }[state.view.scale]}`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.disabled = next.start === state.view.start && next.end === state.view.end;
  }
  element('empty-chart').hidden = state.items.length > 0;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scale]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scale === state.view.scale));
  }
  const outside = state.items.filter(item => item.start < state.view.start || item.end > state.view.end).length;
  const outsideMarkers = state.markers.filter(marker => marker.date < state.view.start || marker.date > state.view.end).length;
  element('range-notice').textContent = outside || outsideMarkers ? `${outside + outsideMarkers} 個項目或標記超出顯示範圍` : '';
  if (editingMarkerId && !state.markers.some(marker => marker.id === editingMarkerId)) resetMarkerEditor();
  renderItem();
  renderMarkers();
  datePickers?.refresh();
  scheduleChart();
}

function addItem(type: TimelineItem['type']): void {
  const today = localToday();
  const start = today >= state.view.start && today <= state.view.end ? today : state.view.start;
  let end = start;
  if (type === 'task') {
    try { end = addDays(start, Math.min(4, daysBetween(start, state.view.end))); } catch { end = start; }
  }
  const id = makeId('item');
  const previousId = selectedId;
  selectedId = id;
  const added = editDocument(draft => {
    draft.items.push({ id, name: type === 'task' ? '新時段' : '新里程碑', start, end, type, color: COLORS[draft.items.length % COLORS.length], note: '' });
  });
  if (!added) selectedId = previousId;
  setTab('item');
  if (added) {
    element<HTMLInputElement>('item-name').focus();
    element<HTMLInputElement>('item-name').select();
  }
}

function restoreHistory(direction: 'undo' | 'redo'): void {
  if (exporting || dragging) return;
  state = direction === 'undo' ? history.undo() : history.redo();
  resetMarkerEditor();
  render();
  saveLocally();
}

function replaceDocument(next: TimelineDocument, message: string): void {
  selectedId = next.items[0]?.id ?? '';
  if (commitDocument(next, message)) {
    resetMarkerEditor();
    setTab('item');
  }
}

function safeFilename(title: string, extension: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/[. ]+$/g, '').slice(0, 90) || 'pst-timeline';
  return `${name}.${extension}`;
}

function flushTextInput(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

async function downloadDocument(): Promise<void> {
  if (fileOperationPending || exporting) return;
  fileOperationPending = true;
  try {
    flushTextInput();
    // VTable editors commit separately from normal form blur events.
    await chart?.flushEdits();
    const saved = await saveBlob(new Blob([serializeDocument(state)], { type: 'application/json;charset=utf-8' }), safeFilename(state.title, 'json'), 'json');
    if (saved) toast(`${DESKTOP ? '已儲存' : '已下載'} JSON；下次可用「開啟 JSON」繼續編輯。`);
  } catch (error) { toast(errorMessage(error), true); }
  finally { fileOperationPending = false; }
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && context.measureText(line + char).width > width) {
        lines.push(line);
        line = char;
      } else line += char;
    }
    lines.push(line);
  }
  return lines;
}

async function prepareExportImage(dataUrl: string, snapshot: TimelineDocument, scale: 1 | 2, withTitle: boolean): Promise<Blob> {
  if (!dataUrl.startsWith('data:image/png')) throw new Error('圖片輸出格式不正確，請重新匯出。');
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const padding = withTitle ? 28 * scale : 0;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('目前無法產生圖片。');
  const width = image.naturalWidth + padding * 2;
  const textWidth = Math.max(100, width - padding * 2);
  const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.font = `600 ${24 * scale}px ${font}`;
  const titleLines = withTitle ? wrapCanvasText(context, snapshot.title, textWidth) : [];
  context.font = `${12 * scale}px ${font}`;
  const subtitleLines = withTitle && snapshot.subtitle ? wrapCanvasText(context, snapshot.subtitle, textWidth) : [];
  const header = withTitle ? padding + titleLines.length * 33 * scale + subtitleLines.length * 19 * scale + 39 * scale : 0;
  const height = image.naturalHeight + header + padding;
  if (width > 16384 || height > 16384 || width * height > 32_000_000) {
    throw new Error('圖片尺寸較大。請改用 1 倍解析度、縮小日期範圍或刻度寬度後再匯出。');
  }
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  if (withTitle) {
    let y = padding;
    context.textBaseline = 'top';
    context.fillStyle = '#243a42';
    context.font = `600 ${24 * scale}px ${font}`;
    for (const line of titleLines) { context.fillText(line, padding, y); y += 33 * scale; }
    context.fillStyle = '#758578';
    context.font = `${12 * scale}px ${font}`;
    for (const line of subtitleLines) { context.fillText(line, padding, y); y += 19 * scale; }
    y += 8 * scale;
    context.font = `${10 * scale}px ${font}`;
    context.fillStyle = '#8d998c';
    context.fillText(`${snapshot.view.start}  —  ${snapshot.view.end}   ·   ${snapshot.items.length} 個項目`, padding, y);
  }
  context.drawImage(image, padding, header);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('圖片轉換失敗，請降低解析度後重試。')), 'image/png');
  });
}

for (const [index, color] of COLORS.entries()) {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'swatch';
  swatch.dataset.color = color;
  swatch.style.backgroundColor = color;
  swatch.setAttribute('aria-label', COLOR_NAMES[index]);
  swatch.title = COLOR_NAMES[index];
  swatch.addEventListener('click', () => updateItem(selectedId, { color }));
  element('color-swatches').append(swatch);
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  tab.addEventListener('click', () => setTab(tab.dataset.tab as 'item' | 'markers' | 'settings'));
  tab.addEventListener('keydown', event => {
    const tabs = ['item', 'markers', 'settings'] as const;
    const index = tabs.indexOf(tab.dataset.tab as typeof tabs[number]);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setTab(tabs[next], true);
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scale]')) {
  button.addEventListener('click', () => {
    const scale = button.dataset.scale as TimelineDocument['view']['scale'];
    editDocument(draft => { draft.view.scale = scale; draft.view.dayWidth = { day: 30, week: 14, month: 4 }[scale]; });
  });
}

function fittedDayWidth(start: string, end: string): number {
  const available = chart?.getScrollMetrics().viewport || Math.max(120, element('chart').clientWidth - 420);
  return Math.max(1, Math.min(80, Math.floor(available / (daysBetween(start, end) + 1))));
}

function showRange(start: string, end: string, scale?: TimelineDocument['view']['scale'], fit = false, focusDate = start): void {
  if (dragging) return;
  if (editDocument(draft => {
    draft.view.start = start;
    draft.view.end = end;
    if (scale) draft.view.scale = scale;
    if (fit) draft.view.dayWidth = fittedDayWidth(start, end);
  })) pendingScrollDate = focusDate;
}

for (const [id, amount] of [['range-prev', -1], ['range-next', 1]] as const) {
  element(id).addEventListener('click', () => {
    const range = shiftRange(state.view, state.view.scale, amount);
    showRange(range.start, range.end);
  });
}
element('range-today').addEventListener('click', () => {
  if (dragging) return;
  const today = localToday();
  if (today >= state.view.start && today <= state.view.end) {
    chart?.scrollToDate(today);
    return;
  }
  const shift = daysBetween(state.view.start, today) - Math.floor(daysBetween(state.view.start, state.view.end) / 2);
  const range = shiftRange(state.view, 'day', shift);
  showRange(range.start, range.end, undefined, false, today);
});
element('range-week').addEventListener('click', () => {
  const today = localToday();
  showRange(startOfWeek(today, state.view.weekStartsOn), endOfWeek(today, state.view.weekStartsOn), 'day', true);
});
element('range-month').addEventListener('click', () => {
  const today = localToday();
  showRange(startOfMonth(today), endOfMonth(today), 'day', true);
});
element('range-year').addEventListener('click', () => {
  const year = localToday().slice(0, 4);
  showRange(`${year}-01-01`, `${year}-12-31`, 'month', true);
});

element('document-title').addEventListener('change', () => editDocument(draft => { draft.title = element<HTMLInputElement>('document-title').value.trim(); }));
element('subtitle').addEventListener('change', () => editDocument(draft => { draft.subtitle = element<HTMLTextAreaElement>('subtitle').value; }));
for (const id of ['view-start', 'view-end']) {
  element(id).addEventListener('change', () => editDocument(draft => {
    draft.view.start = element<HTMLInputElement>('view-start').value;
    draft.view.end = element<HTMLInputElement>('view-end').value;
    if (isValidDate(draft.view.start) && isValidDate(draft.view.end) && draft.view.start > draft.view.end) {
      if (id === 'view-start') draft.view.end = draft.view.start;
      else draft.view.start = draft.view.end;
    }
  }));
}
element('fit-range').addEventListener('click', () => editDocument(draft => {
  const bounds = getDocumentBounds(draft);
  let start = bounds.start;
  let end = bounds.end;
  try { start = addDays(start, -2); } catch { /* Supported calendar boundary. */ }
  try { end = addDays(end, 2); } catch { /* Supported calendar boundary. */ }
  if (daysBetween(start, end) > 730 && daysBetween(bounds.start, bounds.end) <= 730) {
    start = bounds.start; end = bounds.end;
  }
  draft.view.start = start;
  draft.view.end = end;
  draft.view.dayWidth = fittedDayWidth(start, end);
}));
element('zoom').addEventListener('input', () => { element<HTMLOutputElement>('zoom-value').value = `${element<HTMLInputElement>('zoom').value}px`; });
element('zoom').addEventListener('change', () => editDocument(draft => { draft.view.dayWidth = Number(element<HTMLInputElement>('zoom').value); }));
for (const [id, delta] of [['zoom-out', -1], ['zoom-in', 1]] as const) {
  element(id).addEventListener('click', () => editDocument(draft => {
    const step = draft.view.dayWidth < 10 ? 1 : 4;
    draft.view.dayWidth = Math.max(1, Math.min(80, draft.view.dayWidth + delta * step));
  }));
}
element('fit-width').addEventListener('click', () => {
  editDocument(draft => { draft.view.dayWidth = fittedDayWidth(draft.view.start, draft.view.end); });
});
element('timeline-scroll').addEventListener('input', () => {
  chart?.setHorizontalScroll(Number(element<HTMLInputElement>('timeline-scroll').value) / 1000);
});
element('row-height').addEventListener('change', () => editDocument(draft => { draft.view.rowHeight = Number(element<HTMLSelectElement>('row-height').value); }));
element('show-notes').addEventListener('change', () => editDocument(draft => { draft.view.showNotes = element<HTMLInputElement>('show-notes').checked; }));
element('show-weekends').addEventListener('change', () => editDocument(draft => { draft.view.showWeekends = element<HTMLInputElement>('show-weekends').checked; }));
element('week-start').addEventListener('change', () => editDocument(draft => { draft.view.weekStartsOn = Number(element<HTMLSelectElement>('week-start').value) as 0 | 1; }));
element('snap-days').addEventListener('change', () => editDocument(draft => { draft.view.snapDays = Number(element<HTMLSelectElement>('snap-days').value) as 1 | 7; }));
element('show-today').addEventListener('change', () => editDocument(draft => { draft.view.showToday = element<HTMLInputElement>('show-today').checked; }));
element('show-grid').addEventListener('change', () => editDocument(draft => { draft.view.showGrid = element<HTMLInputElement>('show-grid').checked; }));
element('undo').addEventListener('click', () => restoreHistory('undo'));
element('redo').addEventListener('click', () => restoreHistory('redo'));
element('add-task').addEventListener('click', () => addItem('task'));
element('empty-add-task').addEventListener('click', () => addItem('task'));
element('add-milestone').addEventListener('click', () => addItem('milestone'));
element('selected-item').addEventListener('change', () => selectItem(element<HTMLSelectElement>('selected-item').value));
element('item-name').addEventListener('change', () => updateItem(selectedId, { name: element<HTMLInputElement>('item-name').value.trim() }));
element('item-note').addEventListener('change', () => updateItem(selectedId, { note: element<HTMLTextAreaElement>('item-note').value }));
element('item-color').addEventListener('change', () => updateItem(selectedId, { color: element<HTMLInputElement>('item-color').value }));
element('item-type').addEventListener('change', () => updateItem(selectedId, { type: element<HTMLSelectElement>('item-type').value as TimelineItem['type'] }));
element('item-start').addEventListener('change', () => {
  const item = currentItem();
  const start = element<HTMLInputElement>('item-start').value;
  if (item) updateItem(selectedId, { start, end: isValidDate(start) && start > item.end ? start : item.end });
});
element('item-end').addEventListener('change', () => {
  const item = currentItem();
  const end = element<HTMLInputElement>('item-end').value;
  if (item) updateItem(selectedId, { start: isValidDate(end) && end < item.start ? end : item.start, end });
});
for (const [id, direction] of [['move-up', -1], ['move-down', 1]] as const) {
  element(id).addEventListener('click', () => editDocument(draft => {
    const index = draft.items.findIndex(item => item.id === selectedId);
    const next = index + direction;
    if (index >= 0 && next >= 0 && next < draft.items.length) [draft.items[index], draft.items[next]] = [draft.items[next], draft.items[index]];
  }));
}
element('duplicate-item').addEventListener('click', () => {
  const originalId = selectedId;
  const nextId = makeId('item');
  selectedId = nextId;
  if (!editDocument(draft => {
    const index = draft.items.findIndex(item => item.id === originalId);
    if (index >= 0) draft.items.splice(index + 1, 0, { ...draft.items[index], id: nextId, name: `${draft.items[index].name.slice(0, 150)}（副本）` });
  }, '已複製項目。')) selectedId = originalId;
});
element('delete-item').addEventListener('click', () => editDocument(draft => {
  draft.items = draft.items.filter(item => item.id !== selectedId);
}, '項目已刪除，可使用復原還原。'));
element('marker-form').addEventListener('submit', event => {
  event.preventDefault();
  const marker: DateMarker = {
    id: editingMarkerId ?? makeId('marker'),
    date: element<HTMLInputElement>('marker-date').value,
    label: element<HTMLInputElement>('marker-label').value.trim(),
    color: element<HTMLInputElement>('marker-color').value,
  };
  if (editDocument(draft => {
    const index = draft.markers.findIndex(item => item.id === marker.id);
    if (index < 0) draft.markers.push(marker); else draft.markers[index] = marker;
  }, editingMarkerId ? '日期標記已更新。' : '日期標記已加入。')) {
    resetMarkerEditor();
    renderMarkers();
  }
});
element('cancel-marker').addEventListener('click', () => { resetMarkerEditor(); renderMarkers(); });
element('new-document').addEventListener('click', () => replaceDocument(createEmptyDocument(), '已建立空白圖表；可使用復原回到上一份。'));
for (const id of ['load-demo', 'empty-demo']) {
  element(id).addEventListener('click', () => replaceDocument(createDemoDocument(), '已載入範例；可使用復原回到上一份。'));
}
for (const id of ['save-document', 'settings-save']) element(id).addEventListener('click', downloadDocument);
element('import-document').addEventListener('click', async () => {
  if (fileOperationPending || exporting) return;
  if (!DESKTOP) {
    element<HTMLInputElement>('import-file').click();
    return;
  }
  fileOperationPending = true;
  try {
    flushTextInput();
    await chart?.flushEdits();
    const file = await openDocument();
    if (file) replaceDocument(parseDocument(file.content), '已開啟 JSON 圖表；原本的內容可透過復原還原。');
  } catch (error) { toast(errorMessage(error), true); }
  finally { fileOperationPending = false; }
});
element('import-file').addEventListener('change', async () => {
  const input = element<HTMLInputElement>('import-file');
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('檔案超過 1 MB，請選擇較小的 pst JSON 檔案。');
    const next = parseDocument(await file.text());
    replaceDocument(next, '已開啟 JSON 圖表；原本的內容可透過復原還原。');
  } catch (error) { toast(errorMessage(error), true); }
  finally { input.value = ''; }
});

element('open-export').addEventListener('click', async () => {
  if (exportDialog.open) return;
  try {
    flushTextInput();
    await chart?.flushEdits();
    element('export-filename').textContent = safeFilename(state.title, 'png');
    element('export-error').hidden = true;
    if (!exportDialog.open) exportDialog.showModal();
  } catch (error) { toast(errorMessage(error), true); }
});
element('close-export').addEventListener('click', () => { if (!exporting) exportDialog.close(); });
exportDialog.addEventListener('cancel', event => { if (exporting) event.preventDefault(); });
element('export-png').addEventListener('click', async () => {
  if (!chart || exporting || fileOperationPending) return;
  exporting = true;
  fileOperationPending = true;
  const button = element<HTMLButtonElement>('export-png');
  button.disabled = true;
  element<HTMLButtonElement>('close-export').disabled = true;
  element('export-button-label').textContent = '正在產生完整圖片…';
  element('export-error').hidden = true;
  try {
    const scale = Number(element<HTMLSelectElement>('export-scale').value) as 1 | 2;
    const withTitle = element<HTMLInputElement>('export-title').checked;
    await document.fonts.ready;
    const image = await chart.exportPng(scale);
    const snapshot = cloneDocument(state);
    const blob = await prepareExportImage(image, snapshot, scale, withTitle);
    element('export-button-label').textContent = DESKTOP ? '請選擇儲存位置…' : '正在下載圖片…';
    const saved = await saveBlob(blob, safeFilename(snapshot.title, 'png'), 'png');
    if (saved) {
      exportDialog.close();
      toast(`PNG 已${DESKTOP ? '儲存' : '下載'}，包含完整表格與目前日期範圍。`);
    }
  } catch (error) {
    element('export-error').textContent = errorMessage(error);
    element('export-error').hidden = false;
  } finally {
    exporting = false;
    fileOperationPending = false;
    button.disabled = false;
    element<HTMLButtonElement>('close-export').disabled = false;
    element('export-button-label').textContent = EXPORT_ACTION_LABEL;
  }
});

element('retry-chart').addEventListener('click', () => {
  chart?.destroy(); chart = null;
  element('chart').replaceChildren();
  scheduleChart();
});

document.addEventListener('keydown', event => {
  if (fileOperationPending || document.querySelector('dialog[open]') || !(event.metaKey || event.ctrlKey)) return;
  if (event.key.toLowerCase() === 's') {
    event.preventDefault(); downloadDocument(); return;
  }
  const target = event.target;
  if (target instanceof HTMLElement && (target.closest('input,textarea,select,[contenteditable="true"]'))) return;
  if (event.key.toLowerCase() === 'z') {
    event.preventDefault(); restoreHistory(event.shiftKey ? 'redo' : 'undo');
  } else if (event.key.toLowerCase() === 'y') {
    event.preventDefault(); restoreHistory('redo');
  }
});

if (recoveryRaw) {
  const recovery = document.createElement('button');
  recovery.type = 'button';
  recovery.className = 'button button-secondary full-width';
  recovery.style.marginTop = '10px';
  recovery.textContent = '另存上次無法讀取的原始備份';
  recovery.addEventListener('click', async () => {
    if (fileOperationPending || exporting) return;
    fileOperationPending = true;
    recovery.disabled = true;
    try {
      const saved = await saveBlob(new Blob([recoveryRaw!], { type: 'application/json;charset=utf-8' }), 'pst-recovery.json', 'json');
      if (!saved) return;
      autosaveAllowed = true;
      saveLocally();
      toast(`原始備份已${DESKTOP ? '儲存' : '下載'}。`);
    } catch (error) { toast(errorMessage(error), true); }
    finally { fileOperationPending = false; recovery.disabled = false; }
  });
  element('settings-save').after(recovery);
}

// Capture the final in-progress field before the page is hidden or left.
// Do not destroy the chart in pagehide: its deferred editor callback still needs
// a microtask to persist, and the browser can retain this page in its back cache.
function preservePendingEdits(): void {
  flushTextInput();
  void chart?.flushEdits().catch(error => { console.error('pst could not finish an edit', error); });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') preservePendingEdits();
});
window.addEventListener('pagehide', preservePendingEdits);

document.addEventListener('input', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (['document-title', 'subtitle', 'item-name', 'item-note'].includes(target.id) || element('chart').contains(target)) {
    const status = element('save-status');
    status.textContent = '編輯中，離開欄位即保存';
    status.classList.remove('error');
  }
});

datePickers = attachDatePickers(document.body, { getWeekStartsOn: () => state.view.weekStartsOn });
setupWorkspaceLayout(() => chart?.resize());
resetMarkerEditor();
render();
saveLocally();
void installCloseHandler(async () => {
  if (fileOperationPending || exporting) throw new Error('請先完成或取消目前的檔案操作，再關閉 App。');
  flushTextInput();
  await chart?.flushEdits();
  saveLocally();
}, error => toast(error.message, true)).catch(error => toast(errorMessage(error), true));
if (startupMessage) toast(startupMessage, true);
