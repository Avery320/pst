import { daysBetween } from '../domain/dates.ts';
import type { TimelineItem } from '../domain/document.ts';
import { calculateDragPreview, edgeScrollDelta, timelinePreviewSpan, visibleResizeEdges, type DragMode, type DragPreview } from '../domain/interaction.ts';
import './interaction.css';
import { createButton, createElement } from './dom.ts';
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export interface InteractionGeometry {
  left: number; top: number; width: number; height: number;
  clientLeft: number; clientTop: number;
  scrollLeft: number; dayWidth: number;
  rangeStart: string; rangeEnd: string; snapDays: 1 | 7;
}
export interface InteractionRect { left: number; top: number; width: number; height: number }
export interface TimelineInteractionHost {
  container: HTMLElement;
  getItems(): readonly TimelineItem[];
  getSelectedId(): string | undefined;
  getGeometry(): InteractionGeometry;
  getItemRect(index: number): InteractionRect | null;
  scrollBy(dx: number, dy?: number): boolean;
  beforeStart(): void;
  onSelect(id: string): void;
  onCommit(id: string, start: string, end: string): void;
  onStateChange(active: boolean): void;
  onError(message: string): void;
}
interface ActiveDrag {
  id: string; index: number; pointerId: number; target: HTMLElement; original: TimelineItem;
  mode: DragMode; originX: number; originLeft: number; originScroll: number;
  dayWidth: number; snapDays: 1 | 7; lastX: number; lastY: number;
  moved: boolean; preview: DragPreview;
}

/** Pointer gestures preview dates and commit exactly once on release. */
export class TimelineInteraction {
  private readonly host: TimelineInteractionHost;
  private readonly layer: HTMLDivElement;
  private readonly ghost: HTMLDivElement;
  private readonly highlight: HTMLDivElement;
  private readonly startGuide: HTMLDivElement;
  private readonly endGuide: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly targets = new Map<string, HTMLDivElement>();
  private active: ActiveDrag | undefined;
  private autoFrame = 0;
  private lastAutoTime = 0;
  private readonly abort = new AbortController();

  constructor(host: TimelineInteractionHost) {
    this.host = host;
    this.layer = createElement('div', 'pst-interaction-layer');
    this.highlight = createElement('div', 'pst-snap-range');
    this.ghost = createElement('div', 'pst-drag-ghost');
    this.startGuide = createElement('div', 'pst-snap-guide');
    this.endGuide = createElement('div', 'pst-snap-guide');
    this.layer.append(this.highlight, this.startGuide, this.endGuide, this.ghost);
    this.tooltip = createElement('div', 'pst-drag-tooltip');
    this.status = createElement('div', 'sr-only');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    host.container.append(this.layer, this.tooltip, this.status);
    const options = { signal: this.abort.signal };
    this.layer.addEventListener('pointerdown', this.pointerDown, options);
    this.layer.addEventListener('keydown', this.targetKeyDown, options);
    this.layer.addEventListener('wheel', this.wheel, { ...options, passive: false });
    window.addEventListener('pointermove', this.pointerMove, { ...options, capture: true, passive: false });
    window.addEventListener('pointerup', this.pointerUp, { ...options, capture: true });
    window.addEventListener('pointercancel', this.pointerCancel, { ...options, capture: true });
    this.layer.addEventListener('lostpointercapture', this.pointerCancel, options);
    window.addEventListener('keydown', this.escape, { ...options, capture: true });
    window.addEventListener('blur', this.cancel, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); }, options);
    this.hidePreview();
    this.refresh();
  }

  refresh(): void {
    const geometry = this.host.getGeometry();
    Object.assign(this.layer.style, { left: `${geometry.left}px`, top: `${geometry.top}px`,
      width: `${Math.max(0, geometry.width)}px`, height: `${Math.max(0, geometry.height)}px` });
    const present = new Set<string>();
    this.host.getItems().forEach((item, index) => {
      if (item.end < geometry.rangeStart || item.start > geometry.rangeEnd) return;
      const rect = this.host.getItemRect(index);
      if (!rect) return;
      const active = this.active?.id === item.id;
      if (!active && (rect.top + rect.height < geometry.top || rect.top > geometry.top + geometry.height
        || rect.left + rect.width < geometry.left || rect.left > geometry.left + geometry.width)) return;
      present.add(item.id);
      let target = this.targets.get(item.id);
      if (target && target.dataset.itemType !== item.type) {
        target.remove();
        this.targets.delete(item.id);
        target = undefined;
      }
      if (!target) {
        target = document.createElement('div');
        target.className = 'pst-item-target';
        target.dataset.itemId = item.id;
        target.dataset.itemType = item.type;
        const move = this.makeButton('move', '拖曳以移動日期');
        move.className = 'pst-move-control';
        target.append(move);
        if (item.type !== 'milestone') {
          const start = this.makeButton('resize-start', '拖曳以調整開始日期');
          const end = this.makeButton('resize-end', '拖曳以調整結束日期');
          start.className = 'pst-resize-control pst-resize-start';
          end.className = 'pst-resize-control pst-resize-end';
          target.append(start, end);
        }
        this.targets.set(item.id, target);
        this.layer.append(target);
      }
      const size = item.type === 'milestone' ? 22 : Math.max(12, rect.width);
      const height = item.type === 'milestone' ? 22 : rect.height;
      Object.assign(target.style, { left: `${rect.left - geometry.left - (size - rect.width) / 2}px`,
        top: `${rect.top - geometry.top - (height - rect.height) / 2}px`, width: `${size}px`, height: `${height}px`,
        '--item-color': item.color });
      target.classList.toggle('is-selected', item.id === this.host.getSelectedId());
      target.classList.toggle('is-origin', active);
      target.classList.toggle('is-milestone', item.type === 'milestone');
      const edges = visibleResizeEdges(item, geometry.rangeStart, geometry.rangeEnd);
      for (const button of target.querySelectorAll('button')) {
        button.hidden = button.dataset.mode === 'resize-start' ? !edges.start : button.dataset.mode === 'resize-end' ? !edges.end : false;
        button.title = `${item.name} · ${item.start} — ${item.end}`;
        button.setAttribute('aria-label', `${item.name}，${item.start} 至 ${item.end}，${button.dataset.mode === 'move' ? '移動' : button.dataset.mode === 'resize-start' ? '調整開始日期' : '調整結束日期'}`);
        button.tabIndex = item.id === this.host.getSelectedId() && button.dataset.mode === 'move' ? 0 : -1;
      }
    });
    for (const [id, target] of this.targets) if (!present.has(id) && id !== this.active?.id) {
      target.remove();
      this.targets.delete(id);
    }
    if (this.active) this.renderPreview();
  }

  cancel = (): void => {
    if (!this.active) return;
    this.finish(false);
    this.status.textContent = '已取消拖曳，原始日期保持不變。';
  };

  destroy(): void {
    this.cancel();
    this.abort.abort();
    this.layer.remove();
    this.tooltip.remove();
    this.status.remove();
  }

  private makeButton(mode: DragMode, label: string): HTMLButtonElement {
    const button = createButton(label);
    button.dataset.mode = mode;
    button.tabIndex = -1;
    return button;
  }

  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.active) return;
    const button = (event.target as Element).closest<HTMLElement>('[data-mode]');
    const id = button?.parentElement?.dataset.itemId;
    const index = this.host.getItems().findIndex(item => item.id === id);
    const item = this.host.getItems()[index];
    if (!button || !item) return;
    event.preventDefault();
    event.stopPropagation();
    this.host.beforeStart();
    this.host.onSelect(item.id);
    const geometry = this.host.getGeometry();
    this.active = { id: item.id, index, pointerId: event.pointerId, target: button,
      original: { ...item }, mode: button.dataset.mode as DragMode, originX: event.clientX,
      originLeft: geometry.clientLeft, originScroll: geometry.scrollLeft,
      dayWidth: geometry.dayWidth, snapDays: geometry.snapDays,
      lastX: event.clientX, lastY: event.clientY, moved: false,
      preview: { start: item.start, end: item.end, deltaDays: 0 } };
    try { button.setPointerCapture(event.pointerId); } catch { /* Window listeners also handle release outside the chart. */ }
    button.focus({ preventScroll: true });
    this.host.onStateChange(true);
    this.refresh();
    this.lastAutoTime = 0;
    this.autoFrame = requestAnimationFrame(this.autoScroll);
  };

  private pointerMove = (event: PointerEvent): void => {
    const drag = this.active;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (Math.abs(event.clientX - drag.originX) >= Math.min(3, drag.dayWidth / 2)) drag.moved = true;
    this.updatePreview();
  };

  private pointerUp = (event: PointerEvent): void => {
    if (!this.active || this.active.pointerId !== event.pointerId) return;
    this.pointerMove(event);
    this.finish(true);
  };

  private pointerCancel = (event: PointerEvent): void => {
    if (this.active?.pointerId === event.pointerId) this.cancel();
  };

  private escape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.active) {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    }
  };

  private targetKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
    if (target?.dataset.itemId) { event.preventDefault(); this.host.onSelect(target.dataset.itemId); }
  };

  private wheel = (event: WheelEvent): void => {
    if (this.active) { event.preventDefault(); return; }
    const moved = this.host.scrollBy(event.deltaX + (event.shiftKey ? event.deltaY : 0), event.shiftKey ? 0 : event.deltaY);
    if (moved) event.preventDefault();
  };

  private updatePreview(): void {
    const drag = this.active;
    if (!drag) return;
    const geometry = this.host.getGeometry();
    try {
      drag.preview = calculateDragPreview({ original: drag.original, mode: drag.mode,
        pointerDeltaPx: drag.lastX - drag.originX - (geometry.clientLeft - drag.originLeft),
        scrollDeltaPx: geometry.scrollLeft - drag.originScroll, dayWidth: drag.dayWidth, snapDays: drag.snapDays });
      this.renderPreview();
    } catch (error) {
      this.cancel();
      this.host.onError(error instanceof Error ? error.message : '無法計算拖曳日期。');
    }
  }

  private renderPreview(): void {
    const drag = this.active;
    if (!drag) return;
    const geometry = this.host.getGeometry();
    const rect = this.host.getItemRect(drag.index);
    if (!rect) return;
    const { start, end, deltaDays } = drag.preview;
    const span = timelinePreviewSpan({ rangeStart: geometry.rangeStart, start, end,
      type: drag.original.type, dayWidth: geometry.dayWidth, scrollLeft: geometry.scrollLeft });
    const { startX: x1, endX: x2 } = span;
    const milestone = drag.original.type === 'milestone';
    const left = milestone ? span.ghostLeft : clamp(x1, 0, geometry.width);
    const right = milestone ? left + span.ghostWidth : clamp(x2, 0, geometry.width);
    const y = rect.top - geometry.top + (milestone ? (rect.height - 14) / 2 : 0);
    Object.assign(this.ghost.style, { left: `${left}px`, top: `${y}px`, width: `${Math.max(1, right - left)}px`,
      height: `${milestone ? 14 : rect.height}px`, borderColor: drag.original.color,
      backgroundColor: `${drag.original.color}44` });
    this.ghost.classList.toggle('is-milestone', milestone);
    this.ghost.textContent = milestone ? '' : drag.original.name;
    this.ghost.hidden = right <= left || right < 0 || left > geometry.width;
    Object.assign(this.highlight.style, { left: `${clamp(x1, 0, geometry.width)}px`,
      width: `${Math.max(0, clamp(x2, 0, geometry.width) - clamp(x1, 0, geometry.width))}px` });
    this.highlight.hidden = false;
    this.startGuide.style.left = `${x1}px`;
    this.startGuide.hidden = x1 < 0 || x1 > geometry.width;
    this.endGuide.style.left = `${x2}px`;
    this.endGuide.hidden = milestone || x2 < 0 || x2 > geometry.width;
    const action = drag.mode === 'move' ? '移動' : drag.mode === 'resize-start' ? '調整開始' : '調整結束';
    const delta = `${deltaDays > 0 ? '+' : ''}${deltaDays} 天`;
    this.tooltip.textContent = `${action} · ${start} — ${end}\n${daysBetween(start, end) + 1} 天 · ${delta} · ${drag.snapDays} 日吸附 · Esc 取消`;
    this.tooltip.hidden = false;
    const containerRect = this.host.container.getBoundingClientRect();
    const tipWidth = Math.min(330, Math.max(180, this.host.container.clientWidth - 16));
    this.tooltip.style.maxWidth = `${tipWidth}px`;
    this.tooltip.style.left = `${clamp(drag.lastX - containerRect.left + 14, 8, Math.max(8, this.host.container.clientWidth - tipWidth - 8))}px`;
    this.tooltip.style.top = `${clamp(drag.lastY - containerRect.top - 66, 4, Math.max(4, this.host.container.clientHeight - 58))}px`;
  }

  private autoScroll = (time: number): void => {
    const drag = this.active;
    if (!drag) return;
    const elapsed = this.lastAutoTime ? time - this.lastAutoTime : 16;
    this.lastAutoTime = time;
    const geometry = this.host.getGeometry();
    if (drag.moved && drag.lastY >= geometry.clientTop - 32 && drag.lastY <= geometry.clientTop + geometry.height + 32) {
      const dx = edgeScrollDelta(drag.lastX, geometry.clientLeft, geometry.width, elapsed);
      if (dx && this.host.scrollBy(dx)) this.updatePreview();
    }
    this.autoFrame = requestAnimationFrame(this.autoScroll);
  };

  private finish(commit: boolean): void {
    const drag = this.active;
    if (!drag) return;
    this.active = undefined;
    if (this.autoFrame) cancelAnimationFrame(this.autoFrame);
    this.autoFrame = 0;
    try { if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId); } catch { /* Already released by the browser. */ }
    this.hidePreview();
    this.host.onStateChange(false);
    this.refresh();
    if (commit && drag.moved && (drag.preview.start !== drag.original.start || drag.preview.end !== drag.original.end)) {
      this.status.textContent = `${drag.original.name}：${drag.preview.start} 至 ${drag.preview.end}。`;
      this.host.onCommit(drag.id, drag.preview.start, drag.preview.end);
    }
  }

  private hidePreview(): void {
    for (const element of [this.ghost, this.highlight, this.startGuide, this.endGuide, this.tooltip]) element.hidden = true;
  }
}
