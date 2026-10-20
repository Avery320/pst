import { daysBetween, localToday } from '../domain/dates.ts';
import type { TimelineDocument, TimelineItem } from '../domain/document.ts';
import { preserveCalendarScroll } from '../domain/interaction.ts';
import { HEADER_HEIGHT, ROW_HEIGHT, itemRect, renderTimelineBody, renderTimelineHeader } from '../presentation/render.ts';
import { createChartLayout, tableColumns, type ChartLayout } from '../presentation/layout.ts';
import { TimelineInteraction, type InteractionGeometry } from './interaction.ts';
import './chart.css';
import { createElement } from './dom.ts';
import { tokenNumber } from '../presentation/design.ts';
import { clampSplit, setupSplitter, splitBounds } from './splitter.ts';

export interface TimelineChartCallbacks {
  onSelect(id: string): void;
  onEdit(id: string, changes: Partial<TimelineItem>): void;
  onError(message: string): void;
  onDragStateChange(active: boolean): void;
}

/** Native table and SVG share calendar coordinates; the model owns all dates. */
export class TimelineChart {
  private readonly tablePane = createElement('div', 'pst-table-pane ui-scroll');
  private readonly timelinePane = createElement('div', 'pst-timeline-pane ui-scroll');
  private readonly divider = createElement('div', 'pst-chart-divider');
  private readonly header = createElement('div', 'pst-timeline-header');
  private readonly body = createElement('div', 'pst-timeline-body');
  private readonly interaction: TimelineInteraction;
  private readonly observer: ResizeObserver;
  private readonly abort = new AbortController();
  private readonly container: HTMLElement;
  private readonly callbacks: TimelineChartCallbacks;
  private document: TimelineDocument;
  private layout: ChartLayout;
  private selectedId = '';
  private tableWidth = 0;
  private editor: { input: HTMLInputElement | HTMLTextAreaElement; finish(save: boolean): void } | undefined;
  private readonly splitter: ReturnType<typeof setupSplitter>;

  constructor(container: HTMLElement, doc: TimelineDocument, callbacks: TimelineChartCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.document = structuredClone(doc);
    this.layout = createChartLayout(doc);
    container.classList.add('pst-chart');
    this.timelinePane.append(this.header, this.body);
    container.append(this.tablePane, this.divider, this.timelinePane);
    this.divider.setAttribute('aria-label', '調整表格與時間軸寬度');
    this.divider.title = '拖曳或使用左右方向鍵調整表格寬度';
    this.timelinePane.setAttribute('aria-label', '時間軸');
    this.timelinePane.tabIndex = 0;
    this.tablePane.tabIndex = 0;
    this.tablePane.setAttribute('role', 'region');
    this.tablePane.setAttribute('aria-label', '項目表格');
    this.timelinePane.setAttribute('role', 'region');
    this.render();
    this.interaction = new TimelineInteraction({
      container, getItems: () => this.document.items, getSelectedId: () => this.selectedId,
      getGeometry: () => this.geometry(),
      getItemRect: index => {
        const item = this.document.items[index];
        if (!item) return null;
        const box = itemRect(this.document, item, index, this.layout.dayWidth);
        return { ...box, left: box.left + this.timelinePane.offsetLeft - this.timelinePane.scrollLeft,
          top: box.top + HEADER_HEIGHT - this.timelinePane.scrollTop };
      },
      scrollBy: (dx, dy = 0) => {
        const { scrollLeft, scrollTop } = this.timelinePane;
        this.timelinePane.scrollLeft += dx;
        this.timelinePane.scrollTop += dy;
        this.synchronize(this.timelinePane, this.tablePane);
        return this.timelinePane.scrollLeft !== scrollLeft || this.timelinePane.scrollTop !== scrollTop;
      },
      beforeStart: () => this.finishEdit(),
      onSelect: callbacks.onSelect,
      onCommit: (id, start, end) => callbacks.onEdit(id, { start, end }),
      onStateChange: callbacks.onDragStateChange,
      onError: callbacks.onError,
    });
    const options = { signal: this.abort.signal };
    this.timelinePane.addEventListener('scroll', () => this.synchronize(this.timelinePane, this.tablePane), options);
    this.tablePane.addEventListener('scroll', () => this.synchronize(this.tablePane, this.timelinePane), options);
    for (const target of [this.tablePane, this.body]) target.addEventListener('click', event => {
      const row = (event.target as Element).closest('[data-row-id]');
      const id = row?.getAttribute('data-row-id');
      if (id) callbacks.onSelect(id);
    }, options);
    this.tablePane.addEventListener('dblclick', event => {
      const cell = (event.target as Element).closest<HTMLTableCellElement>('td[data-field]');
      const id = cell?.parentElement?.dataset.rowId;
      const field = cell?.dataset.field;
      const item = this.document.items.find(item => item.id === id);
      if (cell && item && (field === 'name' || field === 'note')) this.editCell(cell, item, field);
    }, options);
    this.splitter = setupSplitter({
      element: this.divider, getValue: () => this.tablePane.offsetWidth,
      getBounds: () => this.tableBounds(), initialValue: () => this.defaultTableWidth(),
      beforeStart: () => { this.interaction.cancel(); this.finishEdit(); },
      setValue: value => this.setTableWidth(value),
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  update(doc: TimelineDocument, selectedId = ''): void {
    this.selectedId = selectedId;
    this.redraw(structuredClone(doc));
  }

  selectItem(id: string): void {
    this.selectedId = this.document.items.some(item => item.id === id) ? id : '';
    this.paintSelection();
  }

  resize(): void {
    this.setTableWidth(this.tableWidth || this.defaultTableWidth());
  }

  async flushEdits(): Promise<void> {
    this.interaction.cancel();
    this.finishEdit();
    // Form commits update state synchronously; the next frame draws that state.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

  getRenderLayout(): ChartLayout { return this.layout; }

  scrollToDate(date: string): void {
    const x = (daysBetween(this.document.view.start, date) + 0.5) * this.layout.dayWidth;
    this.timelinePane.scrollLeft = Math.max(0, x - this.timelinePane.clientWidth / 2);
    this.synchronize(this.timelinePane, this.tablePane);
  }

  destroy(): void {
    this.finishEdit();
    this.splitter.destroy();
    this.abort.abort();
    this.observer.disconnect();
    this.interaction.destroy();
    this.container.replaceChildren();
  }

  private paintSelection(): void {
    for (const row of this.container.querySelectorAll('[data-row-id]')) {
      const selected = row.getAttribute('data-row-id') === this.selectedId;
      row.classList.toggle('is-selected', selected);
      row.setAttribute('aria-selected', String(selected));
      row.querySelector('.pst-row-highlight')?.setAttribute('opacity', selected ? '0.055' : '0');
    }
    this.interaction.refresh();
  }

  private render(): void {
    const table = document.createElement('table');
    table.className = 'pst-data-table';
    table.setAttribute('aria-label', '時程項目');
    const columns = this.layout.columns;
    table.style.width = `${this.layout.tableWidth}px`;
    const colgroup = document.createElement('colgroup');
    const head = table.createTHead().insertRow();
    for (const column of columns) {
      const col = document.createElement('col');
      col.style.width = `${column.width}px`;
      colgroup.append(col);
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = column.label;
      head.append(th);
    }
    table.prepend(colgroup);
    const body = table.createTBody();
    for (const item of this.document.items) {
      const row = body.insertRow();
      row.dataset.rowId = item.id;
      row.style.height = `${ROW_HEIGHT}px`;
      for (const column of columns) {
        const cell = row.insertCell();
        cell.dataset.field = column.key;
        cell.textContent = item[column.key];
        cell.title = item[column.key];
      }
    }
    this.tablePane.replaceChildren(table);
    // All document text is XML-escaped by the shared renderer.
    this.header.innerHTML = renderTimelineHeader(this.document, this.layout);
    this.body.innerHTML = renderTimelineBody(this.document, localToday(), this.layout);
  }

  private geometry(): InteractionGeometry {
    const rect = this.timelinePane.getBoundingClientRect();
    return { left: this.timelinePane.offsetLeft, top: HEADER_HEIGHT,
      width: Math.min(this.layout.timelineWidth, this.timelinePane.clientWidth),
      height: Math.max(0, Math.min(this.tablePane.clientHeight, this.timelinePane.clientHeight) - HEADER_HEIGHT),
      clientLeft: rect.left, clientTop: rect.top + HEADER_HEIGHT,
      scrollLeft: this.timelinePane.scrollLeft, dayWidth: this.layout.dayWidth,
      rangeStart: this.document.view.start,
      rangeEnd: this.document.view.end, snapDays: this.document.view.snapDays };
  }

  private synchronize(source: HTMLElement, target: HTMLElement): void {
    if (target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop;
    this.interaction.refresh();
  }

  private finishEdit(): void { this.editor?.finish(true); }

  private editCell(cell: HTMLTableCellElement, item: TimelineItem, field: 'name' | 'note'): void {
    if (this.editor?.input.parentElement === cell) return;
    this.finishEdit();
    const input = field === 'name' ? document.createElement('input') : document.createElement('textarea');
    input.value = item[field];
    input.maxLength = field === 'name' ? 160 : 1000;
    input.setAttribute('aria-label', field === 'name' ? '編輯項目名稱' : '編輯項目說明');
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.editor = undefined;
      const value = input.value;
      cell.textContent = save ? value : item[field];
      if (save && value !== item[field]) this.callbacks.onEdit(item.id, { [field]: value });
    };
    this.editor = { input, finish };
    input.addEventListener('blur', () => finish(true));
    input.onkeydown = event => {
      if (event.key === 'Escape' || (event.key === 'Enter' && (field === 'name' || event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        event.stopPropagation();
        finish(event.key !== 'Escape');
      }
    };
    cell.replaceChildren(input);
    input.focus();
    input.select();
  }

  private tableBounds() {
    const total = tableColumns(this.document).reduce((sum, column) => sum + column.width, 0);
    return splitBounds(this.container.clientWidth, tokenNumber('table-min'), total, tokenNumber('timeline-min'));
  }

  private defaultTableWidth(): number { return Math.floor(this.container.clientWidth * 0.45); }

  private setTableWidth(width: number): void {
    this.tableWidth = width;
    this.redraw();
  }

  private redraw(doc = this.document): void {
    this.interaction.cancel();
    this.finishEdit();
    const previousStart = this.document.view.start;
    const previousLayout = this.layout;
    const left = this.timelinePane.scrollLeft;
    const top = this.timelinePane.scrollTop;
    const tableLeft = this.tablePane.scrollLeft;
    this.document = doc;
    const actual = clampSplit(this.tableWidth || this.defaultTableWidth(), this.tableBounds());
    this.container.style.gridTemplateColumns = `${actual}px var(--ui-splitter-width) minmax(0,1fr)`;
    this.layout = createChartLayout(doc, this.tablePane.clientWidth, this.timelinePane.clientWidth);
    this.render();
    // Only the overflowing pane needs a horizontal bar. Reserve its height in
    // the other pane so both vertical scroll ranges still end on the same row.
    const viewportHeight = Math.min(this.tablePane.clientHeight, this.timelinePane.clientHeight);
    this.tablePane.style.paddingBottom = `${this.tablePane.clientHeight - viewportHeight}px`;
    this.timelinePane.style.paddingBottom = `${this.timelinePane.clientHeight - viewportHeight}px`;
    this.timelinePane.scrollLeft = previousLayout.timelineViewport ? preserveCalendarScroll({
      oldStart: previousStart, newStart: doc.view.start,
      oldDayWidth: previousLayout.dayWidth, newDayWidth: this.layout.dayWidth,
      oldLeft: left, oldViewport: Math.min(previousLayout.timelineViewport, previousLayout.timelineWidth),
      newViewport: this.layout.timelineViewport, totalWidth: this.layout.timelineWidth,
    }) : 0;
    this.timelinePane.scrollTop = top;
    this.tablePane.scrollLeft = tableLeft;
    this.tablePane.scrollTop = this.timelinePane.scrollTop;
    this.paintSelection();
    this.splitter.refresh();
  }
}
