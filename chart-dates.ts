import { addDays, daysBetween, isValidDate } from './model.ts';
import type { TimelineItem } from './model.ts';

/** Convert VTable's local civil dates without turning them into UTC timestamps. */
export function normalizeChartDate(value: unknown): string {
  let result: string | undefined;
  if (typeof value === 'string') {
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[ T])/.exec(value);
    if (match) result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  } else if (value instanceof Date && Number.isFinite(value.getTime())) {
    result = `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (!result || !isValidDate(result)) {
    throw new Error('無法讀取拖曳後的日期，請使用右側日期欄位調整。');
  }
  return result;
}

export interface ChartDateChange {
  original: Pick<TimelineItem, 'start' | 'end' | 'type'>;
  start: unknown;
  end: unknown;
  oldVisibleStart: unknown;
  isMove: boolean;
}

/**
 * A move translates the complete item by a calendar-day delta; a resize uses
 * its edited endpoint. VTable computes moves with clipped local-millisecond
 * durations, so trusting its new end can lose dates at DST or viewport edges.
 */
export function resolveChartDates(change: ChartDateChange): { start: string; end: string } {
  const displayedStart = normalizeChartDate(change.start);
  if (change.isMove) {
    const delta = daysBetween(normalizeChartDate(change.oldVisibleStart), displayedStart);
    const start = addDays(change.original.start, delta);
    const end = change.original.type === 'milestone' ? start : addDays(change.original.end, delta);
    return { start, end };
  }
  return {
    start: displayedStart,
    end: change.original.type === 'milestone' ? displayedStart : normalizeChartDate(change.end)
  };
}
