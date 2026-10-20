import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, localToday } from '../src/domain/dates.ts';
import {
  addMonths, countWeekdays, daysInMonth, endOfMonth, endOfWeek,
  formatDateZh, formatWeekdayZh, getISOWeek, shiftRange, startOfMonth, startOfWeek,
} from '../src/domain/calendar.ts';

test('Gregorian century leap rules and month-end clamping are exact', () => {
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.equal(addMonths('2000-01-31', 1), '2000-02-29');
  assert.equal(addMonths('1900-01-31', 1), '1900-02-28');
  assert.equal(addMonths('2100-03-31', -1), '2100-02-28');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonths('2026-12-30', 2), '2027-02-28');
  assert.equal(addMonths('2026-10-20', 0), '2026-10-20');
  assert.equal(startOfMonth('2000-02-29'), '2000-02-01');
  assert.equal(endOfMonth('2000-02-01'), '2000-02-29');
  for (const [year, month] of [[1899, 12], [2101, 1], [2026, 0], [2026, 13], [2026.5, 1]]) {
    assert.throws(() => daysInMonth(year, month), /年月/u);
  }
  assert.throws(() => addMonths('1900-01-01', -1), /1900/u);
  assert.throws(() => addMonths('2100-12-31', 1), /2100/u);
  assert.throws(() => addMonths('2026-01-01', 0.5), /整數/u);
});

test('week endpoints honor Sunday/Monday start and clip only at calendar bounds', () => {
  assert.equal(startOfWeek('2026-10-18', 1), '2026-10-12');
  assert.equal(endOfWeek('2026-10-18', 1), '2026-10-18');
  assert.equal(startOfWeek('2026-10-18', 0), '2026-10-18');
  assert.equal(endOfWeek('2026-10-18', 0), '2026-10-24');
  assert.equal(startOfWeek('2026-10-20'), '2026-10-19');
  assert.equal(startOfWeek('1900-01-01', 0), '1900-01-01');
  assert.equal(endOfWeek('1900-01-01', 0), '1900-01-06');
  assert.equal(endOfWeek('1900-01-01', 1), '1900-01-07');
  assert.equal(startOfWeek('2100-12-31', 1), '2100-12-27');
  assert.equal(endOfWeek('2100-12-31', 1), '2100-12-31');
  assert.throws(() => startOfWeek('2026-10-20', 2 as 1), /起始日/u);
});

test('ISO weeks keep their ISO year over Gregorian new year boundaries', () => {
  for (const [date, year, week] of [
    ['1900-01-01', 1900, 1], ['2015-12-31', 2015, 53], ['2016-01-01', 2015, 53],
    ['2016-01-04', 2016, 1], ['2021-01-03', 2020, 53], ['2021-01-04', 2021, 1],
    ['2024-12-30', 2025, 1], ['2026-10-18', 2026, 42], ['2100-01-01', 2099, 53],
  ] as const) assert.deepEqual(getISOWeek(date), { year, week }, date);
});

test('range shifts preserve length, clamp complete ranges and enforce viewport limits', () => {
  const range = { start: '2026-01-31', end: '2026-02-13' };
  assert.deepEqual(shiftRange(range, 'month', 1), { start: '2026-02-28', end: '2026-03-13' });
  assert.deepEqual(shiftRange(range, 'week', -1), { start: '2026-01-24', end: '2026-02-06' });
  assert.deepEqual(shiftRange(range, 'day', 1), { start: '2026-02-01', end: '2026-02-14' });
  for (const unit of ['day', 'week', 'month'] as const) {
    const early = shiftRange({ start: '1900-01-02', end: '1900-01-15' }, unit, -1);
    assert.deepEqual(early, { start: '1900-01-01', end: '1900-01-14' });
    const late = shiftRange({ start: '2100-12-16', end: '2100-12-29' }, unit, 5);
    assert.deepEqual(late, { start: '2100-12-18', end: '2100-12-31' });
    assert.equal(daysBetween(late.start, late.end), 13);
    assert.equal(shiftRange(range, unit, -Number.MAX_SAFE_INTEGER).start, '1900-01-01');
    assert.equal(shiftRange(range, unit, Number.MAX_SAFE_INTEGER).end, '2100-12-31');
  }
  const longest = { start: '2024-02-29', end: addDays('2024-02-29', 730) };
  const moved = shiftRange(longest, 'month', 1);
  assert.equal(daysBetween(moved.start, moved.end), 730);
  assert.deepEqual(shiftRange(range, 'month', 0), range);
  assert.throws(() => shiftRange({ start: range.end, end: range.start }, 'day', 1), /早於/u);
  assert.throws(() => shiftRange({ start: range.start, end: addDays(range.start, 731) }, 'week', 1), /730/u);
  assert.throws(() => shiftRange(range, 'day', NaN), /整數/u);
  assert.throws(() => shiftRange(range, 'year' as 'day', 1), /單位/u);
});

test('weekday counts are inclusive Monday–Friday counts, with no holiday inference', () => {
  assert.equal(countWeekdays('2026-10-19', '2026-10-19'), 1);
  assert.equal(countWeekdays('2026-10-18', '2026-10-18'), 0);
  assert.equal(countWeekdays('2026-10-17', '2026-10-18'), 0);
  assert.equal(countWeekdays('2026-10-16', '2026-10-19'), 2);
  assert.equal(countWeekdays('2026-10-19', '2026-11-01'), 10);
  assert.equal(countWeekdays('2026-01-01', '2026-01-01'), 1, 'public holidays are not excluded');
  assert.throws(() => countWeekdays('2026-10-20', '2026-10-19'), /早於/u);
});

test('calendar calculations use UTC while today follows the user local timezone', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Europe/Berlin', 'Asia/Taipei']) {
      process.env.TZ = zone;
      assert.equal(addMonths('2026-03-31', -1), '2026-02-28', zone);
      assert.equal(startOfWeek('2026-03-08', 1), '2026-03-02', zone);
      assert.deepEqual(getISOWeek('2026-11-01'), { year: 2026, week: 44 }, zone);
      assert.equal(formatWeekdayZh('2026-10-20'), '週二', zone);
      assert.equal(formatDateZh('2026-10-20'), '2026 年 10 月 20 日（週二）', zone);
      assert.equal(countWeekdays('2026-03-06', '2026-03-10'), 3, zone);
    }
    const instant = new Date('2026-10-20T00:30:00.000Z');
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(localToday(instant), '2026-10-19');
    process.env.TZ = 'Asia/Taipei';
    assert.equal(localToday(instant), '2026-10-20');
    assert.equal(formatWeekdayZh(0), '週日');
    assert.throws(() => formatWeekdayZh(7), /星期/u);
    assert.throws(() => localToday(new Date(NaN)), /無效/u);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
