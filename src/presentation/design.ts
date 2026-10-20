/** One vocabulary for DOM styles, SVG and PNG. Values are CSS-compatible. */
export const DESIGN_TOKENS = {
  'font-family': '-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans TC, sans-serif',
  'font-body': '12px',
  'font-heading': '14px',
  'font-title': '20px',
  'weight-normal': '400',
  'weight-strong': '600',
  'color-text': '#273a45',
  'color-muted': '#65786e',
  'color-accent': '#176b61',
  'color-inverse': '#ffffff',
  'color-surface': '#ffffff',
  'color-background': '#f5f6f4',
  'color-subtle': '#f8faf8',
  'color-border': '#e1e7e1',
  'color-hover': '#f2f7f5',
  'color-selected': '#eaf3ed',
  'color-weekend': '#f5f7f5',
  'color-danger': '#a34e3f',
  'color-tooltip': '#214c3f',
  'color-overlay': '#18382e46',
  'color-shadow': '#193a3230',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'control-height': '28px',
  'icon-size': '16px',
  'radius': '6px',
  'panel-radius': '10px',
  'row-height': '36px',
  'chart-header-height': '56px',
  'splitter-width': '8px',
  'inspector-width': '304px',
  'inspector-min': '248px',
  'inspector-max': '480px',
  'canvas-min': '360px',
  'table-min': '140px',
  'timeline-min': '120px',
} as const;

type SizeToken = { [K in keyof typeof DESIGN_TOKENS]: typeof DESIGN_TOKENS[K] extends `${number}px` ? K : never }[keyof typeof DESIGN_TOKENS];

export function tokenNumber(key: SizeToken): number {
  return Number.parseFloat(DESIGN_TOKENS[key]);
}

export function applyDesignTokens(root: HTMLElement): void {
  for (const [name, value] of Object.entries(DESIGN_TOKENS)) root.style.setProperty(`--ui-${name}`, value);
}
