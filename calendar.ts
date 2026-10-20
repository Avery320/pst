import { addDays, daysBetween, isValidDate } from './model.ts';

export type WeekStartsOn = 0 | 1;
export type RangeUnit = 'day' | 'week' | 'month';
export interface DateRange { start: string; end: string }
export interface CalendarCell {
  /** Null only where the 42-cell grid crosses the supported calendar bounds. */
  date: string | null;
  day: number | null;
  weekday: number;
  inMonth: boolean;
  isWeekend: boolean;
  isToday: boolean;
}

export const MIN_CALENDAR_DATE = '1900-01-01';
export const MAX_CALENDAR_DATE = '2100-12-31';
const DAY_MS = 86_400_000;
const MIN_TIME = Date.UTC(1900, 0, 1);
const MAX_TIME = Date.UTC(2100, 11, 31);
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function utcDate(iso: string): Date {
  if (!isValidDate(iso)) throw new Error('日期必須是 1900 至 2100 年之間有效的 YYYY-MM-DD 日期。');
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
}

function wholeNumber(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}必須是有效的整數。`);
}

function validWeekStart(value: WeekStartsOn): void {
  if (value !== 0 && value !== 1) throw new Error('每週起始日必須是 0（週日）或 1（週一）。');
}

function boundedDate(time: number): string {
  return new Date(Math.max(MIN_TIME, Math.min(MAX_TIME, time))).toISOString().slice(0, 10);
}

/** The user's local calendar day, deliberately not the UTC day of a timestamp. */
export function localToday(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error('目前日期無效。');
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (!isValidDate(iso)) throw new Error('目前日期必須介於 1900 年與 2100 年。');
  return iso;
}

/** Gregorian month length; month is 1–12. Century years are leap years only if divisible by 400. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || year < 1900 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('年月必須介於 1900 至 2100 年，月份必須是 1 至 12。');
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Preserve the day of month where possible; e.g. Jan 31 + 1 month is Feb 28/29. */
export function addMonths(iso: string, months: number): string {
  const date = utcDate(iso);
  wholeNumber(months, '增減月數');
  const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12 + 1;
  if (year < 1900 || year > 2100) throw new Error('計算後的日期必須介於 1900-01-01 與 2100-12-31。');
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function startOfMonth(iso: string): string {
  utcDate(iso);
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const date = utcDate(iso);
  return `${iso.slice(0, 7)}-${daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)}`;
}

/** Week endpoints are clipped at 1900-01-01 and 2100-12-31. */
export function startOfWeek(iso: string, weekStartsOn: WeekStartsOn = 1): string {
  const date = utcDate(iso);
  validWeekStart(weekStartsOn);
  const offset = (date.getUTCDay() - weekStartsOn + 7) % 7;
  return boundedDate(date.getTime() - offset * DAY_MS);
}

export function endOfWeek(iso: string, weekStartsOn: WeekStartsOn = 1): string {
  const date = utcDate(iso);
  validWeekStart(weekStartsOn);
  const offset = (date.getUTCDay() - weekStartsOn + 7) % 7;
  return boundedDate(date.getTime() + (6 - offset) * DAY_MS);
}

/** ISO-8601 weeks always start on Monday and belong to the year containing Thursday. */
export function getISOWeek(iso: string): { year: number; week: number } {
  const thursday = utcDate(iso);
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  return { year, week: Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1 };
}

/** A stable 6 × 7 month grid, including adjacent months and blank boundary cells. */
export function enumerateMonthGrid(iso: string, weekStartsOn: WeekStartsOn = 1, today = localToday()): CalendarCell[][] {
  const first = utcDate(startOfMonth(iso));
  validWeekStart(weekStartsOn);
  utcDate(today);
  const offset = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const gridStart = first.getTime() - offset * DAY_MS;
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, column) => {
    const time = gridStart + (week * 7 + column) * DAY_MS;
    const date = new Date(time);
    const supported = time >= MIN_TIME && time <= MAX_TIME;
    const value = supported ? date.toISOString().slice(0, 10) : null;
    return {
      date: value,
      day: supported ? date.getUTCDate() : null,
      weekday: date.getUTCDay(),
      inMonth: supported && date.getUTCFullYear() === first.getUTCFullYear() && date.getUTCMonth() === first.getUTCMonth(),
      isWeekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
      isToday: value === today,
    };
  }));
}

export function formatWeekdayZh(dateOrDay: string | number, style: 'short' | 'long' = 'short'): string {
  const weekday = typeof dateOrDay === 'string' ? utcDate(dateOrDay).getUTCDay() : dateOrDay;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('星期必須是 0 至 6。');
  return `${style === 'long' ? '星期' : '週'}${WEEKDAYS[weekday]}`;
}

export function formatDateZh(iso: string): string {
  const date = utcDate(iso);
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日（${formatWeekdayZh(iso)}）`;
}

/** Count Monday–Friday inclusively. This makes no assumption about public holidays. */
export function countWeekdays(start: string, end: string): number {
  const elapsed = daysBetween(start, end);
  if (elapsed < 0) throw new Error('結束日期不可早於開始日期。');
  const count = elapsed + 1;
  let weekdays = Math.floor(count / 7) * 5;
  const weekday = utcDate(start).getUTCDay();
  for (let offset = 0; offset < count % 7; offset++) {
    const day = (weekday + offset) % 7;
    if (day !== 0 && day !== 6) weekdays++;
  }
  return weekdays;
}

/**
 * Move a viewport by calendar days/weeks/months while preserving its elapsed-day span.
 * Monthly moves anchor its start to the same (clamped) day in the target month.
 * The complete range stops at the supported edges; it is never truncated or >730 days.
 */
export function shiftRange(range: DateRange, unit: RangeUnit, amount: number): DateRange {
  const duration = daysBetween(range.start, range.end);
  if (duration < 0) throw new Error('顯示結束日期不可早於顯示開始日期。');
  if (duration > 730) throw new Error('時間軸的顯示範圍不可超過 730 天。');
  wholeNumber(amount, '平移次數');
  const start = utcDate(range.start);
  let proposed: number;
  if (unit === 'day' || unit === 'week') {
    proposed = start.getTime() + amount * (unit === 'week' ? 7 : 1) * DAY_MS;
  } else if (unit === 'month') {
    const monthIndex = (start.getUTCFullYear() - 1900) * 12 + start.getUTCMonth() + amount;
    proposed = monthIndex < 0 ? -Infinity : monthIndex > 2411 ? Infinity : utcDate(addMonths(range.start, amount)).getTime();
  } else {
    throw new Error('平移單位必須是 day、week 或 month。');
  }
  const newStart = boundedDate(Math.max(MIN_TIME, Math.min(MAX_TIME - duration * DAY_MS, proposed)));
  return { start: newStart, end: addDays(newStart, duration) };
}
