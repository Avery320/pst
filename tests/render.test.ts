import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoDocument, createEmptyDocument, parseDocument, validateDocument } from '../src/domain/document.ts';
import { daysBetween } from '../src/domain/dates.ts';
import { calculateDragPreview } from '../src/domain/interaction.ts';
import { createChartLayout } from '../src/presentation/layout.ts';
import { HEADER_HEIGHT, ROW_HEIGHT, headerCells, itemRect, renderDocumentSvg, renderTimelineBody, renderTimelineHeader } from '../src/presentation/render.ts';

test('headers cover each visible day once across partial weeks, months and years', () => {
  for (const scale of ['day', 'week', 'month'] as const) {
    for (const weekStartsOn of [0, 1] as const) {
      const doc = createEmptyDocument('2026-12-20');
      Object.assign(doc.view, { start: '2026-12-30', end: '2027-02-02', scale, weekStartsOn });
      for (const row of [0, 1] as const) {
        const cells = headerCells(doc, row);
        assert.equal(cells.reduce((sum, cell) => sum + cell.days, 0), 35);
        assert.equal(cells[0].start, 0);
        for (let index = 1; index < cells.length; index++) assert.equal(cells[index].start, cells[index - 1].start + cells[index - 1].days);
      }
    }
  }
});

test('Sunday-start weeks use date labels instead of misleading ISO week numbers', () => {
  const doc = createEmptyDocument('2026-10-20');
  Object.assign(doc.view, { start: '2026-10-18', end: '2026-10-31', scale: 'week', weekStartsOn: 0 });
  assert.deepEqual(headerCells(doc, 1).map(cell => cell.label), ['10/18', '10/25']);
  doc.view.weekStartsOn = 1;
  assert.deepEqual(headerCells(doc, 1).map(cell => cell.label), ['W42', 'W43', 'W44']);
});

test('narrow headers omit full labels instead of displaying truncated week numbers', () => {
  const doc = createEmptyDocument('2026-10-20');
  doc.view.scale = 'week';
  doc.view.dayWidth = 1;
  assert.doesNotMatch(renderTimelineHeader(doc), />W\d/);
  doc.view.dayWidth = 18;
  assert.match(renderTimelineHeader(doc), />W\d/);
});

test('item geometry is inclusive, uses one row height and retains clipped endpoints', () => {
  const doc = createDemoDocument('2026-10-20');
  doc.view.start = '2026-10-03';
  const item = doc.items[0];
  const task = itemRect(doc, item, 2);
  assert.equal(task.left, -doc.view.dayWidth);
  assert.equal(task.width, (daysBetween(item.start, item.end) + 1) * doc.view.dayWidth);
  assert.equal(task.top + task.height / 2, ROW_HEIGHT * 2.5);
  const milestone = itemRect(doc, doc.items[2], 2);
  assert.equal(milestone.left + milestone.width / 2, daysBetween(doc.view.start, doc.items[2].start) * doc.view.dayWidth);
});

test('full export includes every row and optional column independent of scrolling', () => {
  const doc = createDemoDocument('2026-10-20');
  doc.view.showNotes = true;
  const result = renderDocumentSvg(doc, '2026-10-20');
  assert.equal(result.width, 584 + 365 * doc.view.dayWidth);
  assert.equal(result.height, HEADER_HEIGHT + doc.items.length * ROW_HEIGHT);
  assert.match(result.source, /第一版發佈/);
  assert.match(result.source, /確認表格欄位、日期刻度與閱讀順序。/);
  assert.doesNotMatch(result.source, /opacity="0\.055"|pst-drag-ghost|pst-item-target/);
  assert.equal(renderDocumentSvg(createEmptyDocument('2026-10-20'), '2026-10-20').height, HEADER_HEIGHT + 1);
});

test('off-range bars and markers are omitted while the full table retains its rows', () => {
  const doc = createDemoDocument('2026-10-20');
  Object.assign(doc.view, { start: '2026-10-01', end: '2026-10-02', showToday: false });
  const body = renderTimelineBody(doc, '2026-10-01');
  assert.doesNotMatch(body, /<title>第一版發佈|>交付日<|>今天</);
  assert.match(body, /<title>需求與版面確認/);
  assert.match(renderDocumentSvg(doc, '2026-10-01').source, /第一版發佈/);
});

test('document text and identifiers are escaped in SVG attributes and text nodes', () => {
  const doc = createDemoDocument('2026-10-20');
  doc.items[0].name = '<script>alert("x")</script>&';
  doc.items[0].id = 'a"><script>';
  doc.markers[0].label = '<image href="evil"/>';
  const result = renderDocumentSvg(validateDocument(doc), '2026-10-20');
  assert.doesNotMatch(result.source, /<script|<image|data-row-id="a">/);
  assert.match(result.source, /&lt;script&gt;/);
  assert.match(result.source, /data-row-id="a&quot;&gt;&lt;script&gt;"/);
});

test('legacy row-height settings do not create a second geometry path', () => {
  const doc = createDemoDocument('2026-10-20');
  const imported = parseDocument(JSON.stringify({ ...doc, view: { ...doc.view, rowHeight: 60 } }));
  assert.deepEqual(imported, doc);
  assert.equal(renderDocumentSvg(imported, '2026-10-20').height, HEADER_HEIGHT + doc.items.length * 36);
});

test('table columns compress before scrolling and retain every field at their readable minimum', () => {
  const doc = createEmptyDocument('2026-10-20');
  for (const width of [248, 260, 320, 384, 450]) {
    const layout = createChartLayout(doc, width, 500);
    assert.ok(Math.abs(layout.tableWidth - width) < 0.000001);
    assert.deepEqual(layout.columns.map(column => column.key), ['name', 'start', 'end']);
    assert.ok(layout.columns[0].width >= 96);
    assert.ok(layout.columns[1].width >= 76 && layout.columns[2].width >= 76);
  }
  assert.equal(createChartLayout(doc, 200).tableWidth, 248);
  doc.view.showNotes = true;
  assert.equal(createChartLayout(doc, 260).tableWidth, 344);
  assert.equal(createChartLayout(doc, 400).tableWidth, 400);
});

test('responsive timeline fills the container and shares fractional day coordinates with dragging and export', () => {
  const doc = createDemoDocument('2026-10-20');
  Object.assign(doc.view, { start: '2026-10-01', end: '2026-11-11', dayWidth: 12 });
  const savedView = { ...doc.view };
  const layout = createChartLayout(doc, 260, 683);
  assert.equal(layout.timelineWidth, 683);
  assert.equal(layout.dayWidth, 683 / 42);
  assert.match(renderTimelineHeader(doc, layout), /^<svg[^>]*width="683"/);
  assert.match(renderTimelineBody(doc, '2026-10-20', layout), /^<svg[^>]*width="683"/);
  const item = doc.items[0];
  const originalBox = itemRect(doc, item, 0, layout.dayWidth);
  const preview = calculateDragPreview({ original: item, mode: 'move', pointerDeltaPx: layout.dayWidth * 3,
    scrollDeltaPx: 0, dayWidth: layout.dayWidth, snapDays: 1 });
  assert.equal(preview.start, '2026-10-05');
  const movedBox = itemRect(doc, { ...item, ...preview }, 0, layout.dayWidth);
  assert.ok(Math.abs(movedBox.left - originalBox.left - layout.dayWidth * 3) < 0.000001);
  assert.ok(Math.abs(movedBox.width - originalBox.width) < 0.000001);
  assert.equal(renderDocumentSvg(doc, '2026-10-20', layout).width, 943);
  assert.deepEqual(doc.view, savedView, 'viewport changes never modify the stored document');
});

test('the minimum daily width permits scrolling on narrow screens and zoomed-in timelines', () => {
  const annual = createEmptyDocument('2024-02-29');
  assert.equal(createChartLayout(annual, 260, 600).timelineWidth, 600);
  assert.equal(createChartLayout(annual, 200, 120).timelineWidth, 366);
  annual.view.dayWidth = 8;
  assert.equal(createChartLayout(annual, 260, 600).timelineWidth, 366 * 8);
  annual.view.end = annual.view.start;
  const single = createChartLayout(annual, 260, 600);
  assert.equal(single.timelineWidth, 600);
  assert.equal(headerCells(annual, 0, single.dayWidth).length, 1);
});
