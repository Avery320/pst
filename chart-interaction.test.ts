import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDragPreview, edgeScrollDelta, preserveCalendarScroll, scrollRatioToLeft,
  snapDayDelta, timelinePreviewSpan, visibleResizeEdges } from './chart-interaction.ts';
import type { DragCalculation } from './chart-interaction.ts';

const base: DragCalculation = {
  original: { type: 'task', start: '2026-03-07', end: '2026-03-09' },
  mode: 'move', pointerDeltaPx: 0, scrollDeltaPx: 0, dayWidth: 20, snapDays: 1
};

test('daily and weekly snapping are symmetric at positive and negative half steps', () => {
  assert.equal(snapDayDelta(0.49, 1), 0);
  assert.equal(snapDayDelta(0.5, 1), 1);
  assert.equal(snapDayDelta(-0.5, 1), -1);
  assert.equal(snapDayDelta(3.49, 7), 0);
  assert.equal(snapDayDelta(3.5, 7), 7);
  assert.equal(snapDayDelta(-3.5, 7), -7);
  assert.equal(snapDayDelta(-0.01, 1), 0);
});

test('moves calculate from the fixed original item rather than accumulating rounded movement', () => {
  const original = { ...base.original };
  const first = calculateDragPreview({ ...base, original, pointerDeltaPx: 12 });
  const farther = calculateDragPreview({ ...base, original, pointerDeltaPx: 49 });
  const back = calculateDragPreview({ ...base, original, pointerDeltaPx: 12 });
  assert.deepEqual(first, { start: '2026-03-08', end: '2026-03-10', deltaDays: 1 });
  assert.deepEqual(farther, { start: '2026-03-09', end: '2026-03-11', deltaDays: 2 });
  assert.deepEqual(back, first);
  assert.deepEqual(original, base.original);
});

test('scroll distance shares the pointerdown origin and contributes whole calendar days', () => {
  assert.deepEqual(calculateDragPreview({ ...base, pointerDeltaPx: -10, scrollDeltaPx: 50 }),
    { start: '2026-03-09', end: '2026-03-11', deltaDays: 2 });
  assert.deepEqual(calculateDragPreview({ ...base, pointerDeltaPx: 50, scrollDeltaPx: -50 }),
    { start: base.original.start, end: base.original.end, deltaDays: 0 });
});

test('one-pixel calendar days remain usable at the smallest overview zoom', () => {
  assert.deepEqual(calculateDragPreview({ ...base, dayWidth: 1, pointerDeltaPx: 1 }),
    { start: '2026-03-08', end: '2026-03-10', deltaDays: 1 });
  assert.deepEqual(calculateDragPreview({ ...base, dayWidth: 1, pointerDeltaPx: -1 }),
    { start: '2026-03-06', end: '2026-03-08', deltaDays: -1 });
});

test('whole-bar moves preserve spring and fall DST calendar durations', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.deepEqual(calculateDragPreview({ ...base, pointerDeltaPx: 140 }),
      { start: '2026-03-14', end: '2026-03-16', deltaDays: 7 });
    assert.deepEqual(calculateDragPreview({ ...base,
      original: { type: 'task', start: '2026-10-31', end: '2026-11-02' }, pointerDeltaPx: -140 }),
    { start: '2026-10-24', end: '2026-10-26', deltaDays: -7 });
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('moving a partially visible task retains its complete interval', () => {
  const original = { type: 'task' as const, start: '2026-01-01', end: '2026-02-28' };
  const result = calculateDragPreview({ ...base, original, pointerDeltaPx: 40 });
  assert.deepEqual(result, { start: '2026-01-03', end: '2026-03-02', deltaDays: 2 });
  assert.deepEqual(visibleResizeEdges(original, '2026-01-10', '2026-02-10'), { start: false, end: false });
});

test('resize modes retain the opposite endpoint and stop at one inclusive day', () => {
  assert.deepEqual(calculateDragPreview({ ...base, mode: 'resize-start', pointerDeltaPx: 200 }),
    { start: '2026-03-09', end: '2026-03-09', deltaDays: 2 });
  assert.deepEqual(calculateDragPreview({ ...base, mode: 'resize-end', pointerDeltaPx: -200 }),
    { start: '2026-03-07', end: '2026-03-07', deltaDays: -2 });
  assert.deepEqual(calculateDragPreview({ ...base, mode: 'resize-end', pointerDeltaPx: 40 }),
    { start: '2026-03-07', end: '2026-03-11', deltaDays: 2 });
});

test('seven-day snapping is relative to the original endpoint and preserves its weekday', () => {
  assert.deepEqual(calculateDragPreview({ ...base, snapDays: 7, pointerDeltaPx: 69 }),
    { start: '2026-03-07', end: '2026-03-09', deltaDays: 0 });
  assert.deepEqual(calculateDragPreview({ ...base, snapDays: 7, pointerDeltaPx: 70 }),
    { start: '2026-03-14', end: '2026-03-16', deltaDays: 7 });
  assert.deepEqual(calculateDragPreview({ ...base, snapDays: 7, mode: 'resize-end', pointerDeltaPx: 70 }),
    { start: '2026-03-07', end: '2026-03-16', deltaDays: 7 });
});

test('calendar-boundary clamping translates both ends together without losing duration', () => {
  assert.deepEqual(calculateDragPreview({ ...base, snapDays: 7,
    original: { type: 'task', start: '2100-12-25', end: '2100-12-28' }, pointerDeltaPx: 140 }),
  { start: '2100-12-28', end: '2100-12-31', deltaDays: 3 });
  assert.deepEqual(calculateDragPreview({ ...base,
    original: { type: 'task', start: '1900-01-03', end: '1900-01-05' }, pointerDeltaPx: -140 }),
  { start: '1900-01-01', end: '1900-01-03', deltaDays: -2 });
});

test('milestones keep a single date even when an invalid resize mode is supplied', () => {
  assert.deepEqual(calculateDragPreview({ ...base,
    original: { type: 'milestone', start: '2026-03-07', end: '2026-03-07' },
    mode: 'resize-end', pointerDeltaPx: 40 }),
  { start: '2026-03-09', end: '2026-03-09', deltaDays: 2 });
});

test('cropped interval edges never expose handles for invisible original endpoints', () => {
  assert.deepEqual(visibleResizeEdges(base.original, '2026-03-08', '2026-03-20'), { start: false, end: true });
  assert.deepEqual(visibleResizeEdges(base.original, '2026-03-01', '2026-03-08'), { start: true, end: false });
  assert.deepEqual(visibleResizeEdges(base.original, '2026-03-07', '2026-03-09'), { start: true, end: true });
  assert.deepEqual(visibleResizeEdges({ ...base.original, type: 'milestone' }, '2026-03-01', '2026-03-20'), { start: false, end: false });
});

test('milestone ghost center stays at the native day-start boundary when partially clipped', () => {
  const firstDay = timelinePreviewSpan({ rangeStart: '2026-03-07', start: '2026-03-07', end: '2026-03-07',
    type: 'milestone', dayWidth: 20, scrollLeft: 0 });
  assert.equal(firstDay.ghostLeft, -7);
  assert.equal(firstDay.ghostLeft + firstDay.ghostWidth / 2, 0);
  const scrolled = timelinePreviewSpan({ rangeStart: '2026-03-07', start: '2026-03-09', end: '2026-03-09',
    type: 'milestone', dayWidth: 20, scrollLeft: 13 });
  assert.equal(scrolled.ghostLeft + scrolled.ghostWidth / 2, 27);
});

test('preview task widths use inclusive calendar days, independent of partial clipping', () => {
  assert.deepEqual(timelinePreviewSpan({ rangeStart: '2026-03-08', start: '2026-03-07', end: '2026-03-09',
    type: 'task', dayWidth: 20, scrollLeft: 0 }),
  { startX: -20, endX: 40, ghostLeft: -20, ghostWidth: 60 });
});

test('zoom preserves the center calendar date while clamping valid scroll bounds', () => {
  assert.equal(preserveCalendarScroll({ oldStart: '2026-01-01', newStart: '2026-01-01',
    oldDayWidth: 20, newDayWidth: 40, oldLeft: 200, oldViewport: 400, newViewport: 400, totalWidth: 1240 }), 600);
  assert.equal(preserveCalendarScroll({ oldStart: '2026-01-01', newStart: '2026-02-01',
    oldDayWidth: 20, newDayWidth: 20, oldLeft: 200, oldViewport: 400, newViewport: 400, totalWidth: 560 }), 0);
  assert.equal(preserveCalendarScroll({ oldStart: '2026-01-01', newStart: '2026-01-01',
    oldDayWidth: 1, newDayWidth: 30, oldLeft: 0, oldViewport: 30, newViewport: 600, totalWidth: 900 }), 150);
});

test('overview scroll ratios clamp correctly for fitting and overflowing timelines', () => {
  assert.equal(scrollRatioToLeft(0.5, 800), 400);
  assert.equal(scrollRatioToLeft(-1, 800), 0);
  assert.equal(scrollRatioToLeft(3, 800), 800);
  assert.equal(scrollRatioToLeft(0.5, 0), 0);
  assert.equal(scrollRatioToLeft(Number.NaN, 800), 0);
});

test('edge autoscroll has directional, elapsed-time-based speed and bounded long frames', () => {
  assert.equal(edgeScrollDelta(400, 100, 600, 16), 0);
  assert.ok(edgeScrollDelta(100, 100, 600, 16) < 0);
  assert.ok(edgeScrollDelta(700, 100, 600, 16) > 0);
  assert.equal(edgeScrollDelta(700, 100, 600, 32), 2 * edgeScrollDelta(700, 100, 600, 16));
  assert.equal(edgeScrollDelta(900, 100, 600, 1000), 22.4);
  assert.equal(edgeScrollDelta(10, 0, 0, 16), 0);
});

test('nonfinite movement and invalid geometry fail before any document commit', () => {
  assert.throws(() => calculateDragPreview({ ...base, pointerDeltaPx: Number.NaN }), /參數無效/);
  assert.throws(() => calculateDragPreview({ ...base, dayWidth: 0 }), /至少/);
  assert.throws(() => calculateDragPreview({ ...base,
    original: { type: 'task', start: '2026-03-09', end: '2026-03-07' } }), /不可早於/);
});
