import { tokenNumber } from '../presentation/design.ts';

export interface SplitBounds { min: number; max: number }

export function splitBounds(width: number, primaryMin: number, primaryMax: number, secondaryMin: number): SplitBounds {
  const available = Math.max(0, width - tokenNumber('splitter-width'));
  const min = Math.min(primaryMin, available / 2);
  return { min, max: Math.max(min, Math.min(primaryMax, available - secondaryMin)) };
}

export function clampSplit(value: number, bounds: SplitBounds): number {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)));
}

export function splitKeyValue(value: number, key: string, shift: boolean, direction: 1 | -1, bounds: SplitBounds, initial: number): number | undefined {
  const step = shift ? 48 : 12;
  if (key === 'Home') return bounds.min;
  if (key === 'End') return bounds.max;
  if (key === 'Enter') return clampSplit(initial, bounds);
  if (key === 'ArrowLeft' || key === 'ArrowRight') return clampSplit(value + (key === 'ArrowRight' ? 1 : -1) * step * direction, bounds);
  return undefined;
}

interface SplitterOptions {
  element: HTMLElement;
  getValue(): number;
  getBounds(): SplitBounds;
  initialValue(): number;
  setValue(value: number): void;
  direction?: 1 | -1;
  beforeStart?(): void;
  onCommit?(): void;
}

/** Shared horizontal split interaction. The caller owns the width and persistence. */
export function setupSplitter(options: SplitterOptions) {
  const { element } = options;
  const direction = options.direction ?? 1;
  const abort = new AbortController();
  const events = { signal: abort.signal };
  let gesture: { pointerId: number; x: number; value: number } | undefined;
  element.classList.add('ui-splitter');
  element.tabIndex = 0;
  element.setAttribute('role', 'separator');
  element.setAttribute('aria-orientation', 'vertical');

  function refresh(): void {
    const { min, max } = options.getBounds();
    for (const [name, value] of Object.entries({ min, max, now: options.getValue() })) element.setAttribute(`aria-value${name}`, String(Math.round(value)));
    element.setAttribute('aria-valuetext', `${Math.round(options.getValue())} 像素`);
  }
  function change(value: number): void {
    options.setValue(clampSplit(value, options.getBounds()));
    refresh();
  }
  function finish(commit: boolean): void {
    const previous = gesture;
    gesture = undefined;
    if (!previous) return;
    document.body.classList.remove('is-resizing');
    if (!commit) change(previous.value);
    if (element.hasPointerCapture(previous.pointerId)) element.releasePointerCapture(previous.pointerId);
    if (commit) options.onCommit?.();
  }
  element.addEventListener('pointerdown', event => {
    if (gesture || event.button !== 0) return;
    event.preventDefault();
    options.beforeStart?.();
    element.focus({ preventScroll: true });
    gesture = { pointerId: event.pointerId, x: event.clientX, value: options.getValue() };
    element.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing');
  }, events);
  element.addEventListener('pointermove', event => {
    if (gesture?.pointerId === event.pointerId) change(gesture.value + (event.clientX - gesture.x) * direction);
  }, events);
  element.addEventListener('pointerup', event => { if (gesture?.pointerId === event.pointerId) finish(true); }, events);
  for (const name of ['pointercancel', 'lostpointercapture'] as const) element.addEventListener(name, event => {
    if (gesture?.pointerId === event.pointerId) finish(false);
  }, events);
  window.addEventListener('blur', () => finish(false), events);
  window.addEventListener('keydown', event => {
    if (gesture && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
  }, { ...events, capture: true });
  element.addEventListener('keydown', event => {
    if (gesture) return;
    const next = splitKeyValue(options.getValue(), event.key, event.shiftKey, direction, options.getBounds(), options.initialValue());
    if (next === undefined) return;
    event.preventDefault();
    options.beforeStart?.();
    change(next);
    options.onCommit?.();
  }, events);
  element.addEventListener('dblclick', () => {
    finish(false);
    options.beforeStart?.();
    change(options.initialValue());
    options.onCommit?.();
  }, events);
  refresh();
  return { refresh, cancel: () => finish(false), destroy() { finish(false); abort.abort(); } };
}
