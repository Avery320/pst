import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChartDate, resolveChartDates } from './chart-dates.ts';

function inNewYork(run: () => void): void {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try { run(); }
  finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('normalizes local chart dates without converting them to a UTC calendar day', () => {
  assert.equal(normalizeChartDate('2026/3/8'), '2026-03-08');
  assert.equal(normalizeChartDate('2026-03-08'), '2026-03-08');
  assert.equal(normalizeChartDate('2026/03/08 23:59:59'), '2026-03-08');
  inNewYork(() => {
    const lateLocalTime = new Date(2026, 2, 8, 23, 30);
    assert.equal(lateLocalTime.toISOString().slice(0, 10), '2026-03-09');
    assert.equal(normalizeChartDate(lateLocalTime), '2026-03-08');
  });
});

test('rejects unreadable dates instead of producing an invalid document value', () => {
  for (const value of [undefined, null, {}, '', 'not-a-date', new Date(Number.NaN)]) {
    assert.throws(() => normalizeChartDate(value));
  }
});

test('moving a task away from spring DST preserves all calendar days', () => {
  inNewYork(() => {
    const oldStart = new Date(2026, 2, 7);
    const oldEnd = new Date(2026, 2, 9);
    const newStart = new Date(2026, 2, 14);
    // Reproduce the pinned upstream move calculation, which preserves elapsed
    // milliseconds. This interval crosses the 23-hour spring-forward day.
    const upstreamEnd = new Date(newStart.getTime() + oldEnd.getTime() - oldStart.getTime());
    assert.equal((oldEnd.getTime() - oldStart.getTime()) / 3_600_000, 47);
    assert.equal(normalizeChartDate(upstreamEnd), '2026-03-15');
    assert.deepEqual(resolveChartDates({
      original: { start: '2026-03-07', end: '2026-03-09', type: 'task' },
      start: newStart, end: upstreamEnd, oldVisibleStart: oldStart, isMove: true,
    }), { start: '2026-03-14', end: '2026-03-16' });
  });
});

test('moving a task into fall DST preserves all calendar days', () => {
  inNewYork(() => {
    const oldStart = new Date(2026, 9, 24);
    const oldEnd = new Date(2026, 9, 26);
    const newStart = new Date(2026, 9, 31);
    // The destination includes the 25-hour fall-back day. Forty-eight elapsed
    // hours reaches Nov 1 at 23:00; the three-day task must end on Nov 2.
    const upstreamEnd = new Date(newStart.getTime() + oldEnd.getTime() - oldStart.getTime());
    assert.equal(normalizeChartDate(upstreamEnd), '2026-11-01');
    assert.deepEqual(resolveChartDates({
      original: { start: '2026-10-24', end: '2026-10-26', type: 'task' },
      start: newStart, end: upstreamEnd, oldVisibleStart: oldStart, isMove: true,
    }), { start: '2026-10-31', end: '2026-11-02' });
  });
});

test('moving a clipped bar shifts the original complete interval', () => {
  assert.deepEqual(resolveChartDates({
    original: { start: '2026-03-30', end: '2026-04-20', type: 'task' },
    oldVisibleStart: '2026/04/05', start: '2026/04/07', end: '2026/04/12', isMove: true,
  }), { start: '2026-04-01', end: '2026-04-22' });
});

test('moving left across a year boundary preserves the original interval', () => {
  assert.deepEqual(resolveChartDates({
    original: { start: '2026-01-02', end: '2026-01-05', type: 'task' },
    oldVisibleStart: '2026/01/02', start: '2025/12/30', end: '2026/01/02', isMove: true,
  }), { start: '2025-12-30', end: '2026-01-02' });
});

test('resizing uses the newly chosen endpoints instead of preserving duration', () => {
  assert.deepEqual(resolveChartDates({
    original: { start: '2026-03-07', end: '2026-03-09', type: 'task' },
    oldVisibleStart: '2026/03/07', start: '2026/03/08', end: '2026/03/09', isMove: false,
  }), { start: '2026-03-08', end: '2026-03-09' });
  assert.deepEqual(resolveChartDates({
    original: { start: '2026-03-07', end: '2026-03-09', type: 'task' },
    oldVisibleStart: '2026/03/07', start: '2026/03/07', end: '2026/03/15', isMove: false,
  }), { start: '2026-03-07', end: '2026-03-15' });
});

test('milestones stay a single calendar date after a move', () => {
  assert.deepEqual(resolveChartDates({
    original: { start: '2026-03-07', end: '2026-03-07', type: 'milestone' },
    oldVisibleStart: '2026/03/07', start: '2026/03/09', end: '2026/03/10', isMove: true,
  }), { start: '2026-03-09', end: '2026-03-09' });
});

test('moving past the supported calendar fails instead of silently truncating an item', () => {
  assert.throws(() => resolveChartDates({
    original: { start: '2100-12-25', end: '2100-12-31', type: 'task' },
    oldVisibleStart: '2100/12/25', start: '2100/12/26', end: '2101/01/01', isMove: true,
  }));
});
