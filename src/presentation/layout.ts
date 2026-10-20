import { daysBetween } from '../domain/dates.ts';
import type { TimelineDocument, TimelineItem } from '../domain/document.ts';

const TABLE_COLUMNS = [
  { key: 'name', label: '項目', width: 200, minWidth: 96 },
  { key: 'start', label: '開始日期', width: 92, minWidth: 76 },
  { key: 'end', label: '結束日期', width: 92, minWidth: 76 },
  { key: 'note', label: '備註', width: 200, minWidth: 96 },
] as const;

export interface TableColumn {
  key: keyof Pick<TimelineItem, 'name' | 'start' | 'end' | 'note'>;
  label: string;
  width: number;
}

export interface ChartLayout {
  columns: readonly TableColumn[];
  tableWidth: number;
  dayWidth: number;
  timelineWidth: number;
  timelineViewport: number;
}

/** Shrink columns together to readable minima, then allow horizontal scrolling. */
export function tableColumns(doc: TimelineDocument, availableWidth?: number): TableColumn[] {
  const columns: readonly (TableColumn & { minWidth: number })[] = doc.view.showNotes ? TABLE_COLUMNS : TABLE_COLUMNS.slice(0, 3);
  const natural = columns.reduce((sum, column) => sum + column.width, 0);
  const minimum = columns.reduce((sum, column) => sum + column.minWidth, 0);
  const target = Math.max(minimum, availableWidth ?? natural);
  const ratio = Math.min(1, (target - minimum) / (natural - minimum));
  return columns.map(column => ({ key: column.key, label: column.label,
    width: column.minWidth + (column.width - column.minWidth) * ratio
      + (column.key === 'name' ? Math.max(0, target - natural) : 0),
  }));
}

/** A single layout drives the SVG, hit areas, scrolling and PNG output. */
export function createChartLayout(doc: TimelineDocument, tableViewport?: number, timelineViewport = 0): ChartLayout {
  const columns = tableColumns(doc, tableViewport);
  const days = daysBetween(doc.view.start, doc.view.end) + 1;
  const dayWidth = Math.max(doc.view.dayWidth, timelineViewport / days);
  return { columns, tableWidth: columns.reduce((sum, column) => sum + column.width, 0),
    dayWidth, timelineWidth: days * dayWidth, timelineViewport };
}
