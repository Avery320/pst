const DAY_MS = 86_400_000;
export const MIN_DATE = "1900-01-01";
export const MAX_DATE = "2100-12-31";

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

export function dateMilliseconds(value: unknown, label = "日期"): number {
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

/** The user's local calendar day, deliberately not the UTC day of a timestamp. */
export function localToday(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error('目前日期無效。');
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (!isValidDate(iso)) throw new Error('目前日期必須介於 1900 年與 2100 年。');
  return iso;
}
