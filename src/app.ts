import './styles.css';
import { applyDesignTokens } from './presentation/design.ts';
import { TimelineChart } from './ui/chart.ts';
import { endOfMonth, endOfWeek, formatDateZh, formatWeekdayZh, getISOWeek, shiftRange, startOfMonth, startOfWeek } from './domain/calendar.ts';
import { addDays, daysBetween, isValidDate, localToday } from './domain/dates.ts';
import { createDemoDocument, createEmptyDocument, getDocumentBounds, makeId, parseDocument, serializeDocument, type TimelineDocument, type TimelineItem } from './domain/document.ts';
import { DocumentHistory } from './domain/history.ts';
import { setupWorkspaceLayout } from './ui/layout.ts';
import { setupInspector, COLORS } from './ui/inspector.ts';
import { element, icon } from './ui/dom.ts';
import { BrowserDocuments } from './browser/storage.ts';
import { downloadBlob, safeFilename } from './browser/files.ts';
import { exportDocumentPng } from './browser/png.ts';

applyDesignTokens(document.documentElement);

const MAX_IMPORT_BYTES = 1_000_000;
for (const target of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  target.innerHTML = icon(target.dataset.icon!); // Icons are fixed, trusted application markup.
}

const persistence = new BrowserDocuments();
const { document: initialDocument, message: startupMessage, recoveryRaw } = persistence.load();

const history = new DocumentHistory(initialDocument);
let state = history.current;
let selectedId = state.items[0]?.id ?? '';
let chart: TimelineChart | null = null;
let chartFrame = 0;
let toastTimer = 0;
let exporting = false;
let dragging = false;
let pendingScrollDate: string | null = null;
const exportDialog = element<HTMLDialogElement>('export-dialog');

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
    persistence.save(state);
    text.textContent = '已儲存在此瀏覽器';
  } catch {
    failed = true;
    text.textContent = persistence.recoveryBlocked ? '請先下載原始備份，再繼續保存' : '自動保存不可用，請下載 JSON';
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
          onEdit: updateItem,
          onError: message => { toast(message, true); scheduleChart(); },
          onDragStateChange: active => { dragging = active; },
        });
        if (selectedId) chart.selectItem(selectedId);
      }
      if (pendingScrollDate) {
        chart.scrollToDate(pendingScrollDate);
        pendingScrollDate = null;
      }
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
function editDocument(edit: (draft: TimelineDocument) => void, message?: string): boolean {
  try {
    const draft = structuredClone(state);
    edit(draft);
    history.commit(draft);
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

function updateItem(id: string, changes: Partial<TimelineItem>): void {
  editDocument(draft => {
    const item = draft.items.find(candidate => candidate.id === id);
    if (!item) return;
    Object.assign(item, changes);
    if (item.type === 'milestone') item.end = item.start;
  });
}

function selectItem(id: string): void {
  if (!state.items.some(item => item.id === id)) return;
  selectedId = id;
  inspector.setTab('item');
  inspector.render();
  chart?.selectItem(id);
}

function render(): void {
  element<HTMLInputElement>('document-title').value = state.title;
  element('document-subtitle').textContent = state.subtitle;
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
  element<HTMLInputElement>('show-notes').checked = state.view.showNotes;
  element<HTMLInputElement>('show-weekends').checked = state.view.showWeekends;
  element<HTMLSelectElement>('week-start').value = String(state.view.weekStartsOn);
  element<HTMLInputElement>('show-today').checked = state.view.showToday;
  element<HTMLInputElement>('show-grid').checked = state.view.showGrid;
  element<HTMLSelectElement>('snap-days').value = String(state.view.snapDays);
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
  if (!state.items.some(item => item.id === selectedId)) selectedId = state.items[0]?.id ?? '';
  inspector.render();
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
  inspector.setTab('item');
  if (added) {
    element<HTMLInputElement>('item-name').focus();
    element<HTMLInputElement>('item-name').select();
  }
}

function restoreHistory(direction: 'undo' | 'redo'): void {
  if (exporting || dragging) return;
  state = direction === 'undo' ? history.undo() : history.redo();
  inspector.resetMarkerEditor();
  render();
  saveLocally();
}

function replaceDocument(next: TimelineDocument, message: string): void {
  selectedId = next.items[0]?.id ?? '';
  if (editDocument(draft => Object.assign(draft, next), message)) {
    inspector.resetMarkerEditor();
    inspector.setTab('item');
  }
}

function flushTextInput(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

async function downloadDocument(): Promise<void> {
  try {
    flushTextInput();
    await chart?.flushEdits();
    downloadBlob(new Blob([serializeDocument(state)], { type: 'application/json;charset=utf-8' }), safeFilename(state.title, 'json'));
    toast('已下載 JSON；下次可用「開啟 JSON」繼續編輯。');
  } catch (error) { toast(errorMessage(error), true); }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scale]')) {
  button.addEventListener('click', () => {
    const scale = button.dataset.scale as TimelineDocument['view']['scale'];
    editDocument(draft => { draft.view.scale = scale; draft.view.dayWidth = { day: 30, week: 14, month: 4 }[scale]; });
  });
}

function showRange(start: string, end: string, scale?: TimelineDocument['view']['scale'], fit = false, focusDate = start): void {
  if (dragging) return;
  if (editDocument(draft => {
    draft.view.start = start;
    draft.view.end = end;
    if (scale) draft.view.scale = scale;
    if (fit) draft.view.dayWidth = 1;
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
  draft.view.dayWidth = 1;
}));
element('zoom').addEventListener('input', () => { element<HTMLOutputElement>('zoom-value').value = `${element<HTMLInputElement>('zoom').value}px`; });
element('zoom').addEventListener('change', () => editDocument(draft => { draft.view.dayWidth = Number(element<HTMLInputElement>('zoom').value); }));
for (const [id, delta] of [['zoom-out', -1], ['zoom-in', 1]] as const) {
  element(id).addEventListener('click', () => editDocument(draft => {
    const width = chart?.getRenderLayout().dayWidth ?? draft.view.dayWidth;
    const step = width < 10 ? 1 : 4;
    draft.view.dayWidth = Math.max(1, Math.min(80, Math.round(width + delta * step)));
  }));
}
element('fit-width').addEventListener('click', () => {
  editDocument(draft => { draft.view.dayWidth = 1; });
});
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
element('new-document').addEventListener('click', () => replaceDocument(createEmptyDocument(), '已建立空白圖表；可使用復原回到上一份。'));
for (const id of ['load-demo', 'empty-demo']) {
  element(id).addEventListener('click', () => replaceDocument(createDemoDocument(), '已載入範例；可使用復原回到上一份。'));
}
for (const id of ['save-document', 'settings-save']) element(id).addEventListener('click', downloadDocument);
element('import-document').addEventListener('click', () => element<HTMLInputElement>('import-file').click());
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
  if (!chart || exporting) return;
  exporting = true;
  const button = element<HTMLButtonElement>('export-png');
  button.disabled = true;
  element<HTMLButtonElement>('close-export').disabled = true;
  element('export-button-label').textContent = '正在產生完整圖片…';
  element('export-error').hidden = true;
  try {
    const scale = Number(element<HTMLSelectElement>('export-scale').value) as 1 | 2;
    const withTitle = element<HTMLInputElement>('export-title').checked;
    await document.fonts.ready;
    await chart.flushEdits();
    const snapshot = structuredClone(state);
    const blob = await exportDocumentPng(snapshot, scale, withTitle, chart.getRenderLayout());
    downloadBlob(blob, safeFilename(snapshot.title, 'png'));
    exportDialog.close();
    toast('PNG 已下載，包含完整表格與目前日期範圍。');
  } catch (error) {
    element('export-error').textContent = errorMessage(error);
    element('export-error').hidden = false;
  } finally {
    exporting = false;
    button.disabled = false;
    element<HTMLButtonElement>('close-export').disabled = false;
    element('export-button-label').textContent = '下載 PNG 圖片';
  }
});

element('retry-chart').addEventListener('click', () => {
  chart?.destroy(); chart = null;
  element('chart').replaceChildren();
  scheduleChart();
});

document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || !(event.metaKey || event.ctrlKey)) return;
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

if (recoveryRaw !== null) {
  const recovery = document.createElement('button');
  recovery.type = 'button';
  recovery.className = 'button button-secondary full-width';
  recovery.style.marginTop = '10px';
  recovery.textContent = '下載上次無法讀取的原始備份';
  recovery.addEventListener('click', () => {
    downloadBlob(new Blob([recoveryRaw!], { type: 'application/json;charset=utf-8' }), 'pst-recovery.json');
    persistence.releaseRecovery();
    saveLocally();
    toast('原始備份已下載。');
  });
  element('settings-save').after(recovery);
}

// Capture the final in-progress field before the page is hidden or left.
// Keep the chart alive when the browser retains this page in its back cache.
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

const inspector = setupInspector({
  getDocument: () => state, getSelectedId: () => selectedId,
  onSelect: selectItem, editDocument, updateItem,
});
setupWorkspaceLayout();
inspector.resetMarkerEditor();
render();
saveLocally();
if (startupMessage) toast(startupMessage, true);
