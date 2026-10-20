import { Gantt, TYPES, VRender, VTable, TABLE_EVENT_TYPE } from '@visactor/vtable-gantt';
import type { ColumnsDefine, GanttConstructorOptions } from '@visactor/vtable-gantt';
import { InputEditor, TextAreaEditor } from '@visactor/vtable-editors';
import { normalizeChartDate } from './chart-dates.ts';
import { daysBetween, isValidDate } from './model.ts';
import { formatWeekdayZh, getISOWeek, localToday } from './calendar.ts';
import { TimelineInteraction, preserveCalendarScroll, scrollRatioToLeft } from './chart-interaction.ts';
import type { InteractionGeometry } from './chart-interaction.ts';
import type { TimelineDocument, TimelineItem } from './model.ts';
import './chart-interaction.css';

export interface ScrollMetrics { left: number; max: number; viewport: number; total: number }

export interface TimelineChartCallbacks {
  onSelect(id: string): void;
  onDatesChange(id: string, start: string, end: string): void;
  onNameChange(id: string, name: string): void;
  onNoteChange(id: string, note: string): void;
  onError(message: string): void;
  onScrollChange?(metrics: ScrollMetrics): void;
  onDragStateChange?(active: boolean): void;
}

type ChartRecord = TimelineItem & { _ganttStart: string; _ganttEnd: string };
const FONT = '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
const INK = '#273a45';
const BORDER = '#e5e9ec';
const MILESTONE_SIZE = 14;
const MAX_EXPORT_EDGE = 16_384;
const MAX_EXPORT_PIXELS = 32_000_000;
let editorsRegistered = false;

// VTable parses task dates as local civil dates. ISO date-only strings are UTC
// in JavaScript and shift a day west of UTC, so only the adapter uses slashes.
const toChartDate = (date: string): string => date.replaceAll('-', '/');
const headerCalendarDate = (date: Date): string => date.getFullYear() < 1900 ? '1900-01-01'
  : date.getFullYear() > 2100 ? '2100-12-31' : normalizeChartDate(date);

// Native header cells clip their children. Choose a complete label using its
// rendered width before applying the cell limit; a clipped week number is wrong.
const fitHeaderLabel = (label: VRender.Text, choices: (string | string[])[], width: number): VRender.Text | undefined => {
  for (const text of choices) {
    label.setAttributes({ text });
    if (label.AABBBounds.width() + 1 <= width) {
      label.setAttributes({ maxLineWidth: width, ellipsis: false });
      return label;
    }
  }
  return undefined;
};

/** The only layer that knows VTable's mutable records and rendering APIs. */
export class TimelineChart {
  private readonly container: HTMLElement;
  private readonly callbacks: TimelineChartCallbacks;
  private readonly gantt: Gantt;
  private document: TimelineDocument;
  private selectedId: string | undefined;
  private observer: ResizeObserver | undefined;
  private paneObserver: ResizeObserver | undefined;
  private interaction: TimelineInteraction | undefined;
  private readonly abort = new AbortController();
  private resizeFrame = 0;
  private overlayFrame = 0;
  private lastWidth = 0;
  private lastHeight = 0;
  private destroyed = false;
  private exporting = false;
  private updateAfterExport = false;
  private tableWidthOverride: number | undefined;
  private dividerDragging = false;
  private readonly markerLabelJobs = new WeakSet<Gantt>();

  constructor(container: HTMLElement, doc: TimelineDocument, callbacks: TimelineChartCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.document = structuredClone(doc);
    if (!editorsRegistered) {
      VTable.register.editor('pst-name', new InputEditor());
      VTable.register.editor('pst-note', new TextAreaEditor());
      editorsRegistered = true;
    }
    this.gantt = new Gantt(container, this.makeOptions());
    this.gantt.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.bindEvents();
    this.interaction = new TimelineInteraction({
      container, getItems: () => this.document.items, getSelectedId: () => this.selectedId,
      getGeometry: () => this.getInteractionGeometry(),
      getItemRect: index => this.gantt.getTaskBarRelativeRect(index),
      scrollBy: (dx, dy = 0) => {
        const before = { left: this.gantt.scrollLeft, top: this.gantt.scrollTop };
        this.gantt.scrollLeft = before.left + dx;
        this.gantt.scrollTop = before.top + dy;
        this.interaction?.refresh();
        this.notifyScroll();
        return before.left !== this.gantt.scrollLeft || before.top !== this.gantt.scrollTop;
      },
      beforeStart: () => this.gantt.taskListTableInstance?.completeEditCell(),
      onSelect: id => { this.selectItem(id); this.callbacks.onSelect(id); },
      onCommit: (id, start, end) => this.defer(() => this.callbacks.onDatesChange(id, start, end)),
      onStateChange: active => this.callbacks.onDragStateChange?.(active),
      onError: message => this.callbacks.onError(message)
    });
    this.bindDivider();
    this.paneObserver = new ResizeObserver(() => {
      if (this.destroyed || this.overlayFrame) return;
      this.overlayFrame = requestAnimationFrame(() => {
        this.overlayFrame = 0;
        if (this.destroyed) return;
        if (this.dividerDragging) this.tableWidthOverride = this.gantt.taskTableWidth;
        this.interaction?.refresh();
        this.updateDividerAria();
        this.notifyScroll();
      });
    });
    this.paneObserver.observe(this.gantt.getElement());
    this.lastWidth = container.clientWidth;
    this.lastHeight = container.clientHeight;
    this.observer = new ResizeObserver(() => {
      if (this.destroyed || this.resizeFrame) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0;
        if (container.clientWidth !== this.lastWidth || container.clientHeight !== this.lastHeight) this.resize();
      });
    });
    this.observer.observe(container);
    queueMicrotask(() => { if (!this.destroyed) this.notifyScroll(); });
  }

  update(doc: TimelineDocument, selectedId?: string): void {
    if (this.destroyed) return;
    this.interaction?.cancel();
    const oldView = { ...this.document.view };
    const oldMetrics = this.getScrollMetrics();
    this.document = structuredClone(doc);
    if (selectedId !== undefined) this.selectedId = selectedId;
    if (!this.document.items.some(item => item.id === this.selectedId)) this.selectedId = undefined;
    if (this.exporting) {
      this.updateAfterExport = true;
      return;
    }
    this.rebuild({ start: oldView.start, dayWidth: oldView.dayWidth,
      left: oldMetrics.left, viewport: Math.min(oldMetrics.viewport, oldMetrics.total) });
  }

  selectItem(id: string): void {
    if (this.destroyed || this.selectedId === id) return;
    this.selectedId = this.document.items.some(item => item.id === id) ? id : undefined;
    this.paintSelection(true);
  }

  resize(): void {
    if (this.destroyed || !this.container.clientWidth || !this.container.clientHeight) return;
    this.interaction?.cancel();
    if (this.exporting) {
      this.updateAfterExport = true;
      return;
    }
    this.lastWidth = this.container.clientWidth;
    this.lastHeight = this.container.clientHeight;
    // updateOption also recalculates the responsive split between table and chart.
    // Complete an active edit before rebuilding, so resizing cannot discard text.
    this.gantt.taskListTableInstance?.completeEditCell();
    this.rebuild();
  }

  async flushEdits(): Promise<void> {
    if (this.destroyed) return;
    this.interaction?.cancel();
    this.gantt.taskListTableInstance?.completeEditCell();
    await Promise.resolve();
    // The app batches validated model changes into an animation-frame render.
    // Register after the change callback, so JSON and image exports see that render.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }

  getScrollMetrics(): ScrollMetrics {
    const total = Math.max(0, this.gantt.getAllDateColsWidth());
    // Gantt.tableNoFrameWidth is itself capped to the date width upstream. The
    // public viewport must expose available pane space so "fit width" can grow.
    const viewport = Math.max(0, this.gantt.getElement().clientWidth - 12 - this.gantt.tableX);
    const max = Math.max(0, total - viewport);
    return { left: Math.max(0, Math.min(max, this.gantt.scrollLeft)), max, viewport, total };
  }

  setHorizontalScroll(ratio: number): void {
    if (this.destroyed) return;
    this.gantt.scrollLeft = scrollRatioToLeft(ratio, this.getScrollMetrics().max);
    this.interaction?.refresh();
    this.notifyScroll();
  }

  scrollToDate(date: string): void {
    if (this.destroyed) return;
    if (!isValidDate(date)) throw new Error('要定位的日期無效。');
    const metrics = this.getScrollMetrics();
    const x = (daysBetween(this.document.view.start, date) + 0.5) * this.document.view.dayWidth;
    this.gantt.scrollLeft = Math.max(0, Math.min(metrics.max, x - metrics.viewport / 2));
    this.interaction?.refresh();
    this.notifyScroll();
  }

  async exportPng(scale: 1 | 2): Promise<string> {
    if (this.destroyed) throw new Error('時程圖已關閉，請重新開啟後匯出。');
    if (this.exporting) throw new Error('圖片正在產生中，請稍候。');
    await this.flushEdits();
    if (document.fonts) await document.fonts.ready;
    const { ExportGanttPlugin } = await import('@visactor/vtable-plugins/gantt-extensions');
    if (this.destroyed) throw new Error('時程圖已關閉，請重新開啟後匯出。');
    if (this.exporting) throw new Error('圖片正在產生中，請稍候。');
    const table = this.gantt.taskListTableInstance;
    if (!table) throw new Error('表格尚未準備完成，請稍後重試。');
    const width = Math.ceil((table.getAllColsWidth() + this.gantt.getAllDateColsWidth()) * scale);
    const height = Math.ceil(this.gantt.getAllRowsHeight() * scale);
    if (width <= 0 || height <= 0 || !Number.isFinite(width * height)) {
      throw new Error('目前沒有可匯出的圖表範圍。');
    }
    if (width > MAX_EXPORT_EDGE || height > MAX_EXPORT_EDGE || width * height > MAX_EXPORT_PIXELS) {
      throw new Error(`圖片尺寸為 ${width.toLocaleString()} × ${height.toLocaleString()} 像素，超過匯出上限（單邊 16,384 像素、總計 3,200 萬像素）。請縮短日期範圍、調低時間軸寬度或輸出倍率，或減少項目列數。`);
    }
    const plugin = new ExportGanttPlugin();
    plugin.run(this.gantt);
    this.exporting = true;
    const interactiveScrollStyle = this.gantt.options.scrollStyle;
    // The original's parsed scroll style is independent (verified in 1.26.8).
    // Only the full-size clone receives hidden, non-reserving rails.
    this.gantt.options.scrollStyle = { ...interactiveScrollStyle, visible: 'none', hoverOn: true };
    try {
      // The official plugin clones all columns, all rows and the full date range.
      // It creates a fresh table selection; the grid callback also excludes clones.
      const data = await plugin.exportToImage({ type: 'png', scale, backgroundColor: '#ffffff', download: false });
      if (!data || !data.startsWith('data:image/png;base64,') || data.length < 100) {
        throw new Error('瀏覽器未能產生完整圖片，請縮短日期範圍或降低輸出倍率後重試。');
      }
      return data;
    } catch (error) {
      throw new Error(`PNG 匯出失敗：${error instanceof Error ? error.message : '請稍後重試。'}`);
    } finally {
      plugin.release();
      this.gantt.options.scrollStyle = interactiveScrollStyle;
      this.exporting = false;
      if (this.updateAfterExport && !this.destroyed) {
        this.updateAfterExport = false;
        this.rebuild();
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.interaction?.destroy();
    this.abort.abort();
    this.observer?.disconnect();
    this.paneObserver?.disconnect();
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    if (this.overlayFrame) cancelAnimationFrame(this.overlayFrame);
    this.gantt.release();
  }

  private defer(action: () => void): void {
    queueMicrotask(() => {
      if (this.destroyed) return;
      try { action(); } catch (error) {
        if (!this.exporting) this.rebuild();
        this.callbacks.onError(error instanceof Error ? error.message : '無法更新時程圖。');
      }
    });
  }

  private bindEvents(): void {
    this.gantt.on(TYPES.GANTT_EVENT_TYPE.SCROLL, () => {
      this.interaction?.refresh();
      this.notifyScroll();
    });
    this.gantt.on(TYPES.GANTT_EVENT_TYPE.CLICK_TASK_BAR, ({ record }) => {
      const id = String(record.id);
      this.defer(() => { this.selectItem(id); this.callbacks.onSelect(id); });
    });
    const table = this.gantt.taskListTableInstance;
    table?.on(TABLE_EVENT_TYPE.CLICK_CELL, ({ col, row }) => {
      if (table.isHeader(col, row)) return;
      const record = table.getCellOriginRecord(col, row) as ChartRecord | undefined;
      if (!record?.id) return;
      this.defer(() => {
        // Keep the clicked cell intact, including a second click that opens its editor.
        this.selectedId = record.id;
        this.paintSelection(false);
        this.callbacks.onSelect(record.id);
      });
    });
    table?.on(TABLE_EVENT_TYPE.CHANGE_CELL_VALUE, ({ col, row, changedValue }) => {
      const record = table.getCellOriginRecord(col, row) as ChartRecord | undefined;
      if (!record?.id) return;
      const field = col === 0 ? 'name' : this.document.view.showNotes && col === 3 ? 'note' : undefined;
      if (!field) return;
      const value = String(changedValue ?? '');
      this.defer(() => {
        if (field === 'name') this.callbacks.onNameChange(record.id, value);
        else this.callbacks.onNoteChange(record.id, value);
      });
    });
  }

  private rebuild(anchor?: { start: string; dayWidth: number; left: number; viewport: number }): void {
    const metrics = this.getScrollMetrics();
    const previous = anchor ?? { start: this.document.view.start, dayWidth: this.document.view.dayWidth,
      left: this.gantt.scrollLeft, viewport: Math.min(metrics.viewport, metrics.total) };
    const top = this.gantt.scrollTop;
    const tableLeft = this.gantt.taskListTableInstance?.scrollLeft ?? 0;
    this.gantt.updateOption(this.makeOptions());
    this.gantt.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.gantt.scrollLeft = preserveCalendarScroll({ oldStart: previous.start, newStart: this.document.view.start,
      oldDayWidth: previous.dayWidth, newDayWidth: this.document.view.dayWidth,
      oldLeft: previous.left, oldViewport: previous.viewport,
      newViewport: this.getScrollMetrics().viewport, totalWidth: this.gantt.getAllDateColsWidth() });
    this.gantt.scrollTop = top;
    if (this.gantt.taskListTableInstance) this.gantt.taskListTableInstance.scrollLeft = tableLeft;
    this.paintSelection(true);
    this.updateDividerAria();
    this.notifyScroll();
  }

  private paintSelection(selectTableCell: boolean): void {
    const table = this.gantt.taskListTableInstance;
    const index = this.document.items.findIndex(item => item.id === this.selectedId);
    if (selectTableCell && table) {
      if (index < 0) table.clearSelected();
      else table.selectCell(0, table.columnHeaderLevelCount + index, false, false, false);
    }
    // Refresh just the grid. Recreating task bars during selection can interrupt
    // dragging or duplicate milestone labels in the pinned upstream release.
    this.gantt.scenegraph.grid.refresh();
    this.gantt.scenegraph.grid.setX(-this.gantt.scrollLeft);
    this.gantt.scenegraph.grid.setY(-this.gantt.scrollTop);
    this.gantt.scenegraph.updateNextFrame();
    this.interaction?.refresh();
  }

  private notifyScroll(): void {
    if (!this.destroyed) this.callbacks.onScrollChange?.(this.getScrollMetrics());
  }

  private getInteractionGeometry(): InteractionGeometry {
    const chartRect = this.container.getBoundingClientRect();
    const canvasRect = this.gantt.canvas.getBoundingClientRect();
    const left = canvasRect.left - chartRect.left + this.gantt.tableX;
    const top = canvasRect.top - chartRect.top + this.gantt.tableY + this.gantt.getAllHeaderRowsHeight();
    const metrics = this.getScrollMetrics();
    return { left, top, width: Math.min(metrics.viewport, metrics.total),
      height: Math.max(0, this.gantt.tableNoFrameHeight - this.gantt.getAllHeaderRowsHeight()),
      clientLeft: chartRect.left + left, clientTop: chartRect.top + top,
      scrollLeft: this.gantt.scrollLeft, dayWidth: this.document.view.dayWidth,
      rowHeight: this.document.view.rowHeight, rangeStart: this.document.view.start,
      rangeEnd: this.document.view.end, snapDays: this.document.view.snapDays };
  }

  private bindDivider(): void {
    const divider = this.gantt.verticalSplitResizeLine;
    divider.classList.add('pst-chart-divider');
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-label', '調整表格與時間軸寬度');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.title = '拖曳調整表格與時間軸寬度；方向鍵可微調';
    divider.tabIndex = 0;
    const options = { signal: this.abort.signal };
    divider.addEventListener('pointerdown', () => {
      this.interaction?.cancel();
      this.gantt.taskListTableInstance?.completeEditCell();
      this.dividerDragging = true;
    }, options);
    window.addEventListener('pointerup', () => {
      if (!this.dividerDragging) return;
      this.dividerDragging = false;
      this.tableWidthOverride = this.gantt.taskTableWidth;
      this.interaction?.refresh();
      this.updateDividerAria();
      this.notifyScroll();
    }, options);
    divider.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      this.interaction?.cancel();
      this.tableWidthOverride = this.gantt.taskTableWidth + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 12);
      this.rebuild();
    }, options);
    this.updateDividerAria();
  }

  private updateDividerAria(): void {
    const divider = this.gantt.verticalSplitResizeLine;
    divider.setAttribute('aria-valuenow', String(Math.round(this.gantt.taskTableWidth)));
    divider.setAttribute('aria-valuemin', String(this.gantt.options.taskListTable?.minTableWidth ?? 140));
    divider.setAttribute('aria-valuemax', String(this.gantt.options.taskListTable?.maxTableWidth ?? 584));
    divider.setAttribute('aria-valuetext', `表格寬度 ${Math.round(this.gantt.taskTableWidth)} 像素`);
  }

  private scheduleMarkerLabels(instance: Gantt): void {
    if (this.markerLabelJobs.has(instance)) return;
    this.markerLabelJobs.add(instance);
    queueMicrotask(() => {
      this.markerLabelJobs.delete(instance);
      const scene = instance.scenegraph;
      if (!scene) return;
      const timelineWidth = instance.getAllDateColsWidth();
      // 1.26.8 limits native mark-line text to one day column. This small, pinned
      // scenegraph adjustment keeps normal labels readable without changing the
      // export plugin. The header customLayout runs for its export clone too.
      scene.markLine.markLIneContainer.forEachChildren(node => {
        const group = node as unknown as VRender.Group;
        const content = group.getChildByName('mark-line-content') as unknown as VRender.Group | undefined;
        const label = content?.firstChild as unknown as VRender.Text | undefined;
        if (!content || !label || label.type !== 'text') return;
        const maxWidth = Math.max(8, Math.min(220, timelineWidth - 8));
        label.setAttributes({ maxLineWidth: maxWidth, fontFamily: FONT, ellipsis: '…' });
        const labelWidth = Math.min(maxWidth, label.AABBBounds.width());
        const groupX = Number(group.attribute.x ?? 0);
        const dateX = groupX + scene.markLine.markLineContainerWidth / 2;
        const labelX = Math.max(4, Math.min(dateX + 4, timelineWidth - labelWidth - 4));
        content.setAttributes({ x: labelX - groupX, y: 2 });
      });
      scene.stage.render();
    });
  }

  private makeOptions(): GanttConstructorOptions {
    const { view, items, markers } = this.document;
    const records: ChartRecord[] = items.map(item => {
      const visible = item.end >= view.start && item.start <= view.end;
      // Empty chart dates skip fully off-range bars. The visible table retains
      // original dates; upstream otherwise clamps milestones/tasks to an edge.
      return { ...item, _ganttStart: visible ? toChartDate(item.start) : '',
        _ganttEnd: visible ? toChartDate(item.end) : '' };
    });
    const columns: ColumnsDefine = [
      { field: 'name', title: '項目', width: 200, sort: false, editor: 'pst-name', style: { fontWeight: 500 } },
      { field: 'start', title: '開始日期', width: 92, sort: false, style: { fontSize: 11, color: '#76858b', textAlign: 'center' } },
      { field: 'end', title: '結束日期', width: 92, sort: false, style: { fontSize: 11, color: '#76858b', textAlign: 'center' } }
    ];
    if (view.showNotes) columns.push({
      field: 'note', title: '備註', width: 200, sort: false, editor: 'pst-note',
      style: { fontSize: 11, color: '#76858b', autoWrapText: true, lineClamp: 2 }
    });
    const totalTableWidth = view.showNotes ? 584 : 384;
    const containerWidth = this.container.clientWidth || 1100;
    const minTableWidth = Math.min(140, Math.max(80, Math.floor(containerWidth * 0.35)));
    const maxTableWidth = Math.max(minTableWidth, Math.min(totalTableWidth, containerWidth - 120));
    const tableWidth = Math.max(minTableWidth, Math.min(maxTableWidth,
      this.tableWidthOverride ?? Math.floor(containerWidth * 0.48)));
    const headerStyle: TYPES.ITimelineHeaderStyle = {
      fontSize: 11, fontWeight: '500', color: '#667c72', textAlign: 'center', padding: [0, 7, 0, 7]
    };
    const month: TYPES.ITimelineScale = {
      unit: 'month', step: 1, rowHeight: 29, style: headerStyle,
      format: ({ startDate }) => `${startDate.getFullYear()} 年 ${startDate.getMonth() + 1} 月`
    };
    const day: TYPES.ITimelineScale = {
      unit: 'day', step: 1, rowHeight: 36, style: { ...headerStyle, fontSize: 10 },
      format: ({ startDate }) => `${startDate.getDate()} ${formatWeekdayZh(headerCalendarDate(startDate))}`,
      customLayout: ({ width, height, startDate }) => {
        const rootContainer = new VRender.Group({ width, height, pickable: false });
        const weekday = formatWeekdayZh(headerCalendarDate(startDate));
        const dayNumber = String(startDate.getDate());
        const choices: string[][] = [];
        if (width >= 28) choices.push([dayNumber, weekday]);
        if (width >= 14) choices.push([dayNumber, weekday.replace('週', '')]);
        choices.push([dayNumber]);
        const label = fitHeaderLabel(new VRender.Text({ x: width / 2, y: height / 2, text: '',
          fontFamily: FONT, fontSize: 9, lineHeight: 13, textAlign: 'center', textBaseline: 'middle',
          fill: [0, 6].includes(startDate.getDay()) ? '#aa8069' : '#65786e'
        }), choices, Math.max(0, width - 2));
        if (label) rootContainer.appendChild(label);
        return { rootContainer, renderDefaultText: false };
      }
    };
    // Hidden day scales preserve calendar-day geometry and drag precision in all views.
    const scales: TYPES.ITimelineScale[] = view.scale === 'day' ? [month, day]
      : view.scale === 'week' ? [month, {
        unit: 'week', step: 1, startOfWeek: view.weekStartsOn === 0 ? 'sunday' : 'monday',
        rowHeight: 29, style: headerStyle,
        customLayout: ({ width, height, startDate, endDate }) => {
          const rootContainer = new VRender.Group({ width, height, pickable: false });
          const first = getISOWeek(headerCalendarDate(startDate));
          const last = getISOWeek(headerCalendarDate(endDate));
          // A Sunday–Saturday range spans two ISO (Monday-based) weeks.
          const week = first.week === last.week && first.year === last.year
            ? `W${first.week}` : `W${first.week}–${last.week}`;
          const label = fitHeaderLabel(new VRender.Text({ x: 5, y: height / 2, text: '',
            fontFamily: FONT, fontSize: 10, fill: '#65786e', textAlign: 'left', textBaseline: 'middle'
          }), [`${startDate.getMonth() + 1}/${startDate.getDate()} · ${week}`, week], Math.max(0, width - 8));
          if (label) rootContainer.appendChild(label);
          return { rootContainer, renderDefaultText: false };
        }
      }, { ...day, visible: false }]
        : [{ unit: 'year', step: 1, rowHeight: 29, style: headerStyle,
          format: ({ startDate }) => `${startDate.getFullYear()} 年` },
        { ...month, format: ({ startDate }) => `${startDate.getMonth() + 1} 月` },
        { ...day, visible: false }];
    scales[0] = { ...scales[0], customLayout: ({ ganttInstance }) => {
      this.scheduleMarkerLabels(ganttInstance);
      return { rootContainer: new VRender.Group({ pickable: false }), renderDefaultText: true };
    } };

    return {
      records, taskKeyField: 'id', dateFormat: 'yyyy/mm/dd',
      minDate: toChartDate(view.start), maxDate: toChartDate(view.end),
      rowHeight: view.rowHeight, headerRowHeight: 29,
      tasksShowMode: TYPES.TasksShowMode.Tasks_Separate,
      underlayBackgroundColor: '#ffffff', overscrollBehavior: 'none',
      // Keeps the full-size export clone's initial canvas allocation bounded;
      // ExportGanttPlugin sets its requested ratio before taking the final image.
      pixelRatio: 1,
      taskListTable: {
        columns, tableWidth, minTableWidth, maxTableWidth, editCellTrigger: 'doubleclick',
        dragHeaderMode: 'none', columnResizeMode: 'none',
        autoWrapText: false,
        select: { highlightMode: 'row', disableHeaderSelect: true, disableDragSelect: true,
          outsideClickDeselect: false },
        hover: { highlightMode: 'row' },
        theme: {
          headerStyle: { bgColor: '#f8faf8', color: '#65786e', fontSize: 11, fontFamily: FONT,
            fontWeight: 500, borderColor: BORDER, borderLineWidth: 1, padding: [0, 12, 0, 12] },
          bodyStyle: { bgColor: '#ffffff', color: INK, fontSize: 12, fontFamily: FONT,
            borderColor: BORDER, borderLineWidth: [0, 1, 1, 0], padding: [0, 12, 0, 12],
            hover: { cellBgColor: '#f7faf8', inlineRowBgColor: '#f7faf8' } },
          selectionStyle: { cellBorderColor: '#719d89', cellBorderLineWidth: 1,
            cellBgColor: 'rgba(35,115,92,0.05)', inlineRowBgColor: 'rgba(35,115,92,0.05)',
            selectionFillMode: 'overlay' },
          frameStyle: { borderLineWidth: 0 }
        }
      },
      timelineHeader: { colWidth: view.dayWidth, hideWeekend: false, scales,
        backgroundColor: '#f8faf8', horizontalLine: { lineColor: BORDER, lineWidth: 1 },
        verticalLine: { lineColor: '#edf0ed', lineWidth: 1 } },
      grid: {
        backgroundColor: '#ffffff',
        weekendBackgroundColor: view.showWeekends ? '#f5f7f5' : '#ffffff',
        horizontalLine: view.showGrid ? { lineColor: BORDER, lineWidth: 1 } : undefined,
        verticalLine: view.showGrid ? ({ date }) => {
          const next = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1) : undefined;
          const major = next?.getDate() === 1;
          const week = next?.getDay() === view.weekStartsOn;
          return { lineColor: major ? '#cad7cf' : week ? '#dce5de' : '#edf0ed',
            lineWidth: major || (week && view.dayWidth >= 2) || view.dayWidth >= 10 ? 1 : 0 };
        } : undefined,
        verticalLineDependenceOnTimeScale: 'day',
        horizontalBackgroundColor: ({ index, ganttInstance }) =>
          ganttInstance === this.gantt && items[index]?.id === this.selectedId ? 'rgba(35,115,92,0.055)' : 'transparent'
      },
      taskBar: {
        startDateField: '_ganttStart', endDateField: '_ganttEnd',
        // Pointer transactions live in TimelineInteraction: preview/cancel first,
        // then one validated model commit. Native rendering remains unchanged.
        moveable: false, resizable: false,
        progressAdjustable: false, scheduleCreatable: false, dragOrder: false,
        moveToExtendDateRange: false, selectable: true, locateIcon: false,
        labelText: '{name}',
        labelTextStyle: { fontFamily: FONT, fontSize: 11, color: '#ffffff', textAlign: 'left',
          textBaseline: 'middle', padding: [0, 8, 0, 8], textOverflow: 'ellipsis' },
        barStyle: ({ taskRecord }) => ({ barColor: taskRecord.color,
          completedBarColor: taskRecord.color, width: Math.min(24, view.rowHeight - 12),
          cornerRadius: 4, borderLineWidth: 0, minSize: 2 }),
        milestoneStyle: { width: MILESTONE_SIZE, fillColor: '#b3a063', borderLineWidth: 0,
          labelText: '{name}', textOrient: 'right', labelTextStyle: {
            fontFamily: FONT, fontSize: 11, color: INK, padding: 9 } },
        // milestoneStyle is static upstream; a custom diamond preserves each item's color.
        customLayout: ({ taskRecord }) => {
          if (taskRecord.type !== 'milestone') return { renderDefaultBar: true, renderDefaultText: true };
          const rootContainer = new VRender.Group({ width: MILESTONE_SIZE, height: MILESTONE_SIZE, pickable: false });
          rootContainer.appendChild(new VRender.Rect({ x: 0, y: 0, width: MILESTONE_SIZE,
            height: MILESTONE_SIZE, fill: taskRecord.color, pickable: false }));
          return { rootContainer, renderDefaultBar: false, renderDefaultText: true };
        },
        hoverBarStyle: { barOverlayColor: 'rgba(39,58,69,0.07)' },
        selectedBarStyle: { borderColor: 'transparent', borderLineWidth: 0,
          shadowColor: 'transparent', shadowBlur: 0 }
      },
      markLine: [...markers.map(marker => ({ date: toChartDate(marker.date), content: marker.label,
        position: 'middle' as const, scrollToMarkLine: false,
        style: { lineColor: marker.color, lineWidth: 1, lineDash: [4, 4] },
        contentStyle: { color: marker.color, fontSize: 10, fontWeight: '500', lineHeight: 18,
          backgroundColor: '#ffffff', cornerRadius: 3 } })), ...(view.showToday ? [{
        date: toChartDate(localToday()), content: '今天', position: 'middle' as const, scrollToMarkLine: false,
        style: { lineColor: '#237f68', lineWidth: 1.5, lineDash: [3, 3] },
        contentStyle: { color: '#237f68', fontSize: 10, fontWeight: '600', lineHeight: 18,
          backgroundColor: '#f2faf5', cornerRadius: 3 }
      }] : [])],
      markLineCreateOptions: { markLineCreatable: false },
      frame: { outerFrameStyle: { borderColor: BORDER, borderLineWidth: 0 },
        verticalSplitLine: { lineColor: '#cbd8cf', lineWidth: 2 },
        verticalSplitLineHighlight: { lineColor: '#62977d', lineWidth: 4 },
        horizontalSplitLine: { lineColor: BORDER, lineWidth: 1 }, verticalSplitLineMoveable: true },
      scrollStyle: { visible: 'always', width: 12, hoverOn: false, barToSide: true,
        scrollRailColor: '#edf2ee', scrollSliderColor: '#a6beb0', scrollSliderCornerRadius: 5 }
    };
  }
}
