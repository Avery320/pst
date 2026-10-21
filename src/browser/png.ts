import type { TimelineDocument } from '../domain/document.ts';
import { localToday } from '../domain/dates.ts';
import { renderDocumentSvg } from '../presentation/render.ts';
import { DESIGN_TOKENS as T, tokenNumber } from '../presentation/design.ts';
import type { ChartLayout } from '../presentation/layout.ts';

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && context.measureText(line + char).width > width) { lines.push(line); line = char; }
      else line += char;
    }
    lines.push(line);
  }
  return lines;
}

export async function exportDocumentPng(snapshot: TimelineDocument, scale: 1 | 2, withTitle: boolean, layout: ChartLayout): Promise<Blob> {
  const drawing = renderDocumentSvg(snapshot, localToday(), layout);
  const padding = withTitle ? tokenNumber('space-4') * scale : 0;
  const gap = tokenNumber('space-2') * scale;
  const titleSize = tokenNumber('font-title') * scale;
  const bodySize = tokenNumber('font-body') * scale;
  const titleLine = titleSize * 1.4;
  const bodyLine = bodySize * 1.5;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此瀏覽器無法產生圖片。');
  const width = Math.ceil(drawing.width * scale + padding * 2);
  context.font = `${T['weight-strong']} ${titleSize}px ${T['font-family']}`;
  const titleLines = withTitle ? wrapCanvasText(context, snapshot.title, drawing.width * scale) : [];
  context.font = `${bodySize}px ${T['font-family']}`;
  const subtitleLines = withTitle && snapshot.subtitle ? wrapCanvasText(context, snapshot.subtitle, drawing.width * scale) : [];
  const header = withTitle ? padding + titleLines.length * titleLine + subtitleLines.length * bodyLine + gap * 2 + bodyLine : 0;
  const height = Math.ceil(drawing.height * scale + header + padding);
  if (width > 16384 || height > 16384 || width * height > 32_000_000) {
    throw new Error('圖片尺寸較大。請改用 1 倍解析度、縮小日期範圍或刻度寬度後再匯出。');
  }
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = T['color-surface'];
  context.fillRect(0, 0, width, height);
  if (withTitle) {
    let y = padding;
    context.textBaseline = 'top';
    context.fillStyle = T['color-text'];
    context.font = `${T['weight-strong']} ${titleSize}px ${T['font-family']}`;
    for (const line of titleLines) { context.fillText(line, padding, y); y += titleLine; }
    context.fillStyle = T['color-muted'];
    context.font = `${bodySize}px ${T['font-family']}`;
    for (const line of subtitleLines) { context.fillText(line, padding, y); y += bodyLine; }
    context.fillText(`${snapshot.view.start}  —  ${snapshot.view.end}   ·   ${snapshot.items.length} 個項目`, padding, y + gap);
  }
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawing.source)}`;
  await image.decode();
  context.drawImage(image, padding, header, drawing.width * scale, drawing.height * scale);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('圖片轉換失敗，請降低解析度後重試。')), 'image/png');
  });
}
