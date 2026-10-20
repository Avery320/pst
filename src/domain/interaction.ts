import { addDays, daysBetween, MIN_DATE, MAX_DATE } from './dates.ts';
import type { TimelineItem } from './document.ts';

export type DragMode = 'move' | 'resize-start' | 'resize-end';
export interface DragPreview { start: string; end: string; deltaDays: number }
export interface DragCalculation {
  original: Pick<TimelineItem, 'start' | 'end' | 'type'>;
  mode: DragMode;
  pointerDeltaPx: number;
  scrollDeltaPx: number;
  dayWidth: number;
  snapDays: 1 | 7;
}
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Symmetric rounding: -0.5 snaps to -1, matching +0.5 snapping to +1. */
export function snapDayDelta(value: number, step: 1 | 7): number {
  if (!Number.isFinite(value) || (step !== 1 && step !== 7)) throw new Error('日期吸附參數無效。');
  return (Math.sign(value) * Math.round(Math.abs(value) / step) * step) || 0;
}

/** Always calculate from pointerdown, never from the previous move event. */
export function calculateDragPreview(args: DragCalculation): DragPreview {
  if (!Number.isFinite(args.dayWidth) || args.dayWidth < 1) throw new Error('時間軸日寬必須至少為 1 像素。');
  const { original } = args;
  let deltaDays = snapDayDelta((args.pointerDeltaPx + args.scrollDeltaPx) / args.dayWidth, args.snapDays);
  const span = daysBetween(original.start, original.end);
  if (span < 0) throw new Error('結束日期不可早於開始日期。');
  if (args.mode === 'move' || original.type === 'milestone') {
    deltaDays = clamp(deltaDays, daysBetween(original.start, MIN_DATE), daysBetween(original.end, MAX_DATE));
    const start = addDays(original.start, deltaDays);
    return { start, end: original.type === 'milestone' ? start : addDays(original.end, deltaDays), deltaDays };
  }
  if (args.mode === 'resize-start') {
    deltaDays = clamp(deltaDays, daysBetween(original.start, MIN_DATE), span);
    return { start: addDays(original.start, deltaDays), end: original.end, deltaDays };
  }
  deltaDays = clamp(deltaDays, -span, daysBetween(original.end, MAX_DATE));
  return { start: original.start, end: addDays(original.end, deltaDays), deltaDays };
}

/** Cropped visual edges are not the original item's editable endpoints. */
export function visibleResizeEdges(item: Pick<TimelineItem, 'start' | 'end' | 'type'>, rangeStart: string, rangeEnd: string): { start: boolean; end: boolean } {
  return { start: item.type !== 'milestone' && item.start >= rangeStart && item.start <= rangeEnd,
    end: item.type !== 'milestone' && item.end >= rangeStart && item.end <= rangeEnd };
}

export function timelinePreviewSpan(args: { rangeStart: string; start: string; end: string;
  type: 'task' | 'milestone'; dayWidth: number; scrollLeft: number }): {
    startX: number; endX: number; ghostLeft: number; ghostWidth: number;
  } {
  const startX = daysBetween(args.rangeStart, args.start) * args.dayWidth - args.scrollLeft;
  const endX = (daysBetween(args.rangeStart, args.end) + 1) * args.dayWidth - args.scrollLeft;
  return { startX, endX, ghostLeft: args.type === 'milestone' ? startX - 7 : startX,
    ghostWidth: args.type === 'milestone' ? 14 : endX - startX };
}

/** Preserve the calendar position at the viewport center across zoom/range changes. */
export function preserveCalendarScroll(args: {
  oldStart: string; newStart: string; oldDayWidth: number; newDayWidth: number;
  oldLeft: number; oldViewport: number; newViewport: number; totalWidth: number;
}): number {
  if (args.oldDayWidth < 1 || args.newDayWidth < 1) throw new Error('時間軸日寬必須至少為 1 像素。');
  const oldCenterDays = (args.oldLeft + args.oldViewport / 2) / args.oldDayWidth;
  const newCenterDays = daysBetween(args.newStart, args.oldStart) + oldCenterDays;
  return clamp(newCenterDays * args.newDayWidth - args.newViewport / 2, 0, Math.max(0, args.totalWidth - args.newViewport));
}

/** Edge scrolling is proportional to elapsed time, with a capped frame interval. */
export function edgeScrollDelta(pointerX: number, left: number, width: number, elapsedMs: number): number {
  if (![pointerX, left, width, elapsedMs].every(Number.isFinite) || width <= 0) return 0;
  const edge = Math.min(36, width / 4);
  const position = pointerX - left;
  const strength = position < edge ? -clamp((edge - position) / edge, 0, 1)
    : position > width - edge ? clamp((position - width + edge) / edge, 0, 1) : 0;
  return strength * 560 * clamp(elapsedMs, 0, 40) / 1000;
}
