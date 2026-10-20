import type { DateMarker, TimelineDocument, TimelineItem } from '../domain/document.ts';
import { makeId } from '../domain/document.ts';
import { daysBetween, isValidDate } from '../domain/dates.ts';
import { countWeekdays, formatDateZh, formatWeekdayZh } from '../domain/calendar.ts';
import { createButton, createElement, element, icon } from './dom.ts';

export const COLORS = ['#176b61', '#5269e8', '#e5913a', '#9b6bd3', '#d5617d', '#6b7a90'];
const COLOR_NAMES = ['松綠', '靛藍', '暖橘', '紫藤', '玫瑰', '石灰藍'];

interface InspectorOptions {
  getDocument(): TimelineDocument;
  getSelectedId(): string;
  onSelect(id: string): void;
  editDocument(edit: (draft: TimelineDocument) => void, message?: string): boolean;
  updateItem(id: string, changes: Partial<TimelineItem>): void;
}

export function setupInspector(options: InspectorOptions) {
  const { editDocument, updateItem, onSelect: selectItem, getDocument, getSelectedId } = options;
  let editingMarkerId: string | null = null;
  function currentItem() { return getDocument().items.find(item => item.id === getSelectedId()); }

  function setTab(tab: 'item' | 'markers' | 'settings', focus = false): void {
    for (const name of ['item', 'markers', 'settings']) {
      const button = element(`tab-${name}`);
      const active = name === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      element(`pane-${name}`).hidden = !active;
      if (active && focus) button.focus();
    }
  }

  function renderItem(): void {
    const state = getDocument();
    const selectedId = getSelectedId();
    const select = element<HTMLSelectElement>('selected-item');
    select.replaceChildren();
    for (const [index, item] of state.items.entries()) {
      const option = createElement('option', '', `${String(index + 1).padStart(2, '0')}  ${item.name}`);
      option.value = item.id;
      select.append(option);
    }
    select.value = selectedId;
    select.disabled = state.items.length === 0;
    const item = currentItem();
    element('item-fields').hidden = !item;
    element('no-selection').hidden = Boolean(item);
    element('item-kind-badge').hidden = !item;
    if (!item) return;
    element('item-kind-badge').textContent = item.type === 'milestone' ? '里程碑' : '時段';
    element<HTMLInputElement>('item-name').value = item.name;
    element<HTMLSelectElement>('item-type').value = item.type;
    element<HTMLInputElement>('item-start').value = item.start;
    const end = element<HTMLInputElement>('item-end');
    end.value = item.end;
    end.disabled = item.type === 'milestone';
    element('item-duration').textContent = item.type === 'milestone'
      ? formatDateZh(item.start)
      : `共 ${daysBetween(item.start, item.end) + 1} 天 · 週一至週五 ${countWeekdays(item.start, item.end)} 天`;
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
  }

  function renderMarkers(): void {
    const state = getDocument();
    element('marker-count').textContent = String(state.markers.length);
    const list = element('marker-list');
    list.replaceChildren();
    if (!state.markers.length) {
      list.append(createElement('p', 'ui-muted', '還沒有日期標記。試著標出一個重要日期。'));
    }
    for (const marker of state.markers) {
      const row = createElement('div', `marker-card ui-row${editingMarkerId === marker.id ? ' active' : ''}`);
      const line = createElement('span', 'marker-line');
      line.style.backgroundColor = marker.color;
      const edit = createButton(`編輯標記：${marker.label}，${marker.date}`, '', 'marker-edit ui-stack');
      edit.append(createElement('strong', '', marker.label),
        createElement('small', 'ui-muted', `${marker.date.replaceAll('-', '.')} ${formatWeekdayZh(marker.date)}`));
      edit.addEventListener('click', () => fillMarkerEditor(marker));
      const remove = createButton(`刪除標記：${marker.label}`, '', 'icon-button danger-button');
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
    element<HTMLInputElement>('marker-date').value = getDocument().view.start;
    element('marker-form-heading').textContent = '新增標記';
    element('save-marker-label').textContent = '新增標記';
    element('cancel-marker').hidden = true;
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
    element('marker-label').focus();
  }

  for (const [index, color] of COLORS.entries()) {
    const swatch = createButton(COLOR_NAMES[index], '', 'swatch');
    swatch.dataset.color = color;
    swatch.style.backgroundColor = color;
    swatch.addEventListener('click', () => updateItem(getSelectedId(), { color }));
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

  element('selected-item').addEventListener('change', () => selectItem(element<HTMLSelectElement>('selected-item').value));
  element('item-name').addEventListener('change', () => updateItem(getSelectedId(), { name: element<HTMLInputElement>('item-name').value.trim() }));
  element('item-note').addEventListener('change', () => updateItem(getSelectedId(), { note: element<HTMLTextAreaElement>('item-note').value }));
  element('item-color').addEventListener('change', () => updateItem(getSelectedId(), { color: element<HTMLInputElement>('item-color').value }));
  element('item-type').addEventListener('change', () => updateItem(getSelectedId(), { type: element<HTMLSelectElement>('item-type').value as TimelineItem['type'] }));
  element('item-start').addEventListener('change', () => {
    const item = currentItem();
    const start = element<HTMLInputElement>('item-start').value;
    if (item) updateItem(getSelectedId(), { start, end: isValidDate(start) && start > item.end ? start : item.end });
  });
  element('item-end').addEventListener('change', () => {
    const item = currentItem();
    const end = element<HTMLInputElement>('item-end').value;
    if (item) updateItem(getSelectedId(), { start: isValidDate(end) && end < item.start ? end : item.start, end });
  });
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
  return {
    setTab,
    resetMarkerEditor,
    render() {
      if (editingMarkerId && !getDocument().markers.some(marker => marker.id === editingMarkerId)) resetMarkerEditor();
      renderItem();
      renderMarkers();
    },
  };
}
