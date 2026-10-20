import { addDays, dateMilliseconds, daysBetween } from '../domain/dates.ts';
import { formatWeekdayZh, getISOWeek } from '../domain/calendar.ts';
import type { TimelineDocument, TimelineItem } from '../domain/document.ts';
import { timelinePreviewSpan } from '../domain/interaction.ts';
import { DESIGN_TOKENS as T, tokenNumber } from './design.ts';
import { createChartLayout, type ChartLayout } from './layout.ts';

export const HEADER_HEIGHT = tokenNumber('chart-header-height');
export const ROW_HEIGHT = tokenNumber('row-height');
/** The same calendar-day geometry drives the SVG and pointer hit areas. */
export function itemRect(doc: TimelineDocument, item: TimelineItem, index: number, dayWidth = doc.view.dayWidth) {
  const milestone = item.type === 'milestone';
  const height = milestone ? 14 : Math.min(24, ROW_HEIGHT - 12);
  const span = timelinePreviewSpan({ rangeStart: doc.view.start, ...item,
    dayWidth, scrollLeft: 0 });
  return {
    left: span.ghostLeft,
    top: index * ROW_HEIGHT + (ROW_HEIGHT - height) / 2,
    width: span.ghostWidth,
    height,
  };
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

function rect(x: number, y: number, width: number, height: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, color: string = T['color-border']): string {
  return `<path d="M${x1} ${y1}H${x2}V${y2}" fill="none" stroke="${color}" stroke-width="1"/>`;
}

function text(x: number, y: number, value: string, color: string = T['color-muted'], weight: string = T['weight-normal']): string {
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${tokenNumber('font-body')}" font-weight="${weight}" dominant-baseline="middle">${escapeXml(value)}</text>`;
}

export function svg(width: number, height: number, content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="${T['font-family']}" overflow="hidden">${content}</svg>`;
}

/** At most 731 dates; a single pass groups adjacent header cells. */
export function headerCells(doc: TimelineDocument, row: 0 | 1, dayWidth = doc.view.dayWidth): { start: number; days: number; label: string }[] {
  const { view } = doc;
  const count = daysBetween(view.start, view.end) + 1;
  const cells: { start: number; days: number; label: string }[] = [];
  let previousKey = '';
  for (let index = 0; index < count; index++) {
    const date = addDays(view.start, index);
    const weekday = new Date(dateMilliseconds(date)).getUTCDay();
    let key: string;
    let label: string;
    if (row === 0 || view.scale === 'month') {
      const yearOnly = row === 0 && view.scale === 'month';
      key = date.slice(0, yearOnly ? 4 : 7);
      label = yearOnly ? `${key} 年` : row === 0 ? `${date.slice(0, 4)} 年 ${Number(date.slice(5, 7))} 月` : `${Number(date.slice(5, 7))} 月`;
    } else if (view.scale === 'day') {
      key = date;
      label = dayWidth >= 28 ? `${Number(date.slice(8))} ${formatWeekdayZh(weekday)}` : String(Number(date.slice(8)));
    } else {
      // A Sunday-start cell can span two ISO weeks. Label it by its date instead.
      key = String(index - (weekday - view.weekStartsOn + 7) % 7);
      label = view.weekStartsOn === 1 ? `W${getISOWeek(date).week}` : `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
    }
    if (key === previousKey) cells[cells.length - 1].days++;
    else { cells.push({ start: index, days: 1, label }); previousKey = key; }
  }
  return cells;
}

export function renderTimelineHeader(doc: TimelineDocument, layout = createChartLayout(doc)): string {
  const { dayWidth, timelineWidth: width } = layout;
  let content = rect(0, 0, width, HEADER_HEIGHT, T['color-subtle']);
  const rowHeight = HEADER_HEIGHT / 2;
  for (const row of [0, 1] as const) {
    for (const cell of headerCells(doc, row, dayWidth)) {
      const x = cell.start * dayWidth;
      const cellWidth = cell.days * dayWidth;
      content += line(x, row * rowHeight, x, row * rowHeight + rowHeight);
      // Omit labels that cannot fit; never show a clipped week number.
      const estimatedWidth = [...cell.label].reduce((sum, char) => sum + tokenNumber('font-body') * (char.charCodeAt(0) > 255 ? 1 : 0.6), 0);
      if (estimatedWidth + 6 <= cellWidth) content += text(x + (cellWidth - estimatedWidth) / 2, row * rowHeight + rowHeight / 2, cell.label, T['color-muted'], T['weight-strong']);
    }
  }
  content += line(0, rowHeight, width, rowHeight) + line(0, HEADER_HEIGHT, width, HEADER_HEIGHT);
  return svg(width, HEADER_HEIGHT, content);
}

export function renderTimelineBody(doc: TimelineDocument, today: string, layout = createChartLayout(doc)): string {
  const { view, items } = doc;
  const { dayWidth, timelineWidth: width } = layout;
  const height = Math.max(1, items.length * ROW_HEIGHT);
  const count = daysBetween(view.start, view.end) + 1;
  let content = rect(0, 0, width, height, T['color-surface']);
  for (let index = 0; index < count; index++) {
    const date = addDays(view.start, index);
    const weekday = new Date(dateMilliseconds(date)).getUTCDay();
    const x = index * dayWidth;
    if (view.showWeekends && (weekday === 0 || weekday === 6)) content += rect(x, 0, dayWidth, height, T['color-weekend']);
    if (view.showGrid && (dayWidth >= 10 || weekday === view.weekStartsOn || date.endsWith('-01'))) content += line(x, 0, x, height);
  }
  for (const [index, item] of items.entries()) {
    content += `<g data-row-id="${escapeXml(item.id)}">`;
    content += `<rect class="pst-row-highlight" y="${index * ROW_HEIGHT}" width="${width}" height="${ROW_HEIGHT}" fill="${T['color-accent']}" opacity="0"/>`;
    if (view.showGrid) content += line(0, (index + 1) * ROW_HEIGHT, width, (index + 1) * ROW_HEIGHT);
    if (item.end >= view.start && item.start <= view.end) {
      const box = itemRect(doc, item, index, dayWidth);
      const centerY = box.top + box.height / 2;
      content += `<title>${escapeXml(`${item.name}: ${item.start} — ${item.end}`)}</title>`;
      if (item.type === 'milestone') {
        content += `<path d="M${box.left + 7} ${box.top}l7 7-7 7-7-7Z" fill="${item.color}"/>`;
        const label = text(box.left + 21, centerY, item.name, T['color-text']);
        content += label;
      } else {
        // Clip names to each bar without introducing identifier-dependent SVG ids.
        content += `<svg x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" overflow="hidden">`;
        content += `<rect width="100%" height="100%" rx="4" fill="${item.color}"/>`;
        content += text(Math.max(0, -box.left) + 8, box.height / 2, item.name, T['color-surface']) + '</svg>';
      }
    }
    content += '</g>';
  }
  const markers = [...doc.markers, ...(view.showToday ? [{ date: today, label: '今天', color: T['color-accent'] }] : [])];
  for (const marker of markers) {
    if (marker.date < view.start || marker.date > view.end) continue;
    const x = (daysBetween(view.start, marker.date) + 0.5) * dayWidth;
    const labelWidth = Math.min(220, width - 8, [...marker.label].length * tokenNumber('font-body') + 8);
    const labelX = Math.max(4, Math.min(x + 4, width - labelWidth - 4));
    content += `<path d="M${x} 0V${height}" stroke="${marker.color}" stroke-dasharray="4 4"/>`;
    content += `<svg x="${labelX}" y="0" width="${Math.max(0, labelWidth)}" height="20" overflow="hidden">`;
    content += rect(0, 1, Math.max(0, labelWidth), 18, T['color-surface']) + text(4, 10, marker.label, marker.color) + '</svg>';
  }
  return svg(width, height, content);
}

/** Full-size output reuses the exact timeline renderer used by the editor. */
export function renderDocumentSvg(doc: TimelineDocument, today: string, layout: ChartLayout = createChartLayout(doc)): { source: string; width: number; height: number } {
  const { columns, tableWidth } = layout;
  const width = tableWidth + layout.timelineWidth;
  const height = HEADER_HEIGHT + Math.max(1, doc.items.length * ROW_HEIGHT);
  let table = rect(0, 0, tableWidth, height, T['color-surface']);
  let x = 0;
  for (const column of columns) {
    table += rect(x, 0, column.width, HEADER_HEIGHT, T['color-subtle']);
    table += text(x + 8, HEADER_HEIGHT / 2, column.label, T['color-muted'], T['weight-strong']);
    for (const [index, item] of doc.items.entries()) {
      table += `<svg x="${x + 1}" y="${HEADER_HEIGHT + index * ROW_HEIGHT}" width="${column.width - 2}" height="${ROW_HEIGHT}" overflow="hidden">`;
      table += text(7, ROW_HEIGHT / 2, item[column.key].replace(/\s+/g, ' '), column.key === 'start' || column.key === 'end' ? T['color-muted'] : T['color-text']) + '</svg>';
    }
    x += column.width;
    table += line(x, 0, x, height);
  }
  for (let index = 0; index <= doc.items.length; index++) table += line(0, HEADER_HEIGHT + index * ROW_HEIGHT, tableWidth, HEADER_HEIGHT + index * ROW_HEIGHT);
  const timeline = `<g transform="translate(${tableWidth},0)">${renderTimelineHeader(doc, layout)}<g transform="translate(0,${HEADER_HEIGHT})">${renderTimelineBody(doc, today, layout)}</g></g>`;
  return { source: svg(width, height, table + timeline), width, height };
}
