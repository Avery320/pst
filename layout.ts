const STORAGE_KEY = 'pst.layout.v1';
const DEFAULT_WIDTH = 292;
const MIN_WIDTH = 248;
const MAX_WIDTH = 520;
const MIN_CANVAS_WIDTH = 400;
const SEPARATOR_WIDTH = 12;
const DESKTOP_QUERY = '(min-width: 981px)';

interface LayoutPreferences {
  version: 1;
  inspectorWidth: number;
  inspectorCollapsed: boolean;
}

interface ResizeGesture {
  pointerId: number;
  startX: number;
  startWidth: number;
  previousWidth: number;
}

function readPreferences(): LayoutPreferences {
  const defaults: LayoutPreferences = {
    version: 1, inspectorWidth: DEFAULT_WIDTH, inspectorCollapsed: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 500) return defaults;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
    const value = saved as Record<string, unknown>;
    if (value.version !== 1) return defaults;
    if (typeof value.inspectorWidth === 'number' && Number.isFinite(value.inspectorWidth)) {
      defaults.inspectorWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value.inspectorWidth)));
    }
    if (typeof value.inspectorCollapsed === 'boolean') defaults.inspectorCollapsed = value.inspectorCollapsed;
  } catch { /* Layout preferences are optional; the document is stored separately. */ }
  return defaults;
}

/** Responsive panel sizing, independent of the document and chart library. */
export function setupWorkspaceLayout(onResize?: () => void): { destroy(): void; refresh(): void } {
  const layout = document.getElementById('editor-layout');
  const inspector = document.getElementById('inspector');
  const separator = document.getElementById('inspector-resize');
  const toggle = document.getElementById('toggle-inspector');
  const toggleLabel = document.getElementById('inspector-toggle-label');
  const status = document.getElementById('layout-status');
  if (!layout || !inspector || !separator || !toggle || !toggleLabel || !status) {
    throw new Error('工作區面板尚未準備完成。');
  }

  const preferences = readPreferences();
  const desktop = window.matchMedia(DESKTOP_QUERY);
  const removers: Array<() => void> = [];
  let gesture: ResizeGesture | undefined;
  let resizeFrame = 0;
  let destroyed = false;
  let lastContainerWidth = -1;
  let lastContainerHeight = -1;
  let displayedWidth = DEFAULT_WIDTH;

  function listen<T extends Event>(target: EventTarget, name: string, callback: (event: T) => void): void {
    const handler = callback as EventListener;
    target.addEventListener(name, handler);
    removers.push(() => target.removeEventListener(name, handler));
  }

  function savePreferences(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
    catch { /* A blocked or full store must not prevent resizing the workbench. */ }
  }

  function widthLimits(): { min: number; max: number } {
    const available = layout!.clientWidth || Math.max(0, window.innerWidth - 48);
    return { min: MIN_WIDTH, max: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, available - MIN_CANVAS_WIDTH - SEPARATOR_WIDTH)) };
  }

  function queueResize(): void {
    if (destroyed || resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!destroyed) onResize?.();
    });
  }

  function announce(message: string): void {
    status!.textContent = message;
  }

  function refresh(): void {
    if (destroyed) return;
    const { min, max } = widthLimits();
    displayedWidth = Math.round(Math.max(min, Math.min(max, preferences.inspectorWidth)));
    const widthValue = `${displayedWidth}px`;
    if (layout!.style.getPropertyValue('--inspector-width') !== widthValue) {
      layout!.style.setProperty('--inspector-width', widthValue);
    }
    layout!.classList.toggle('is-inspector-collapsed', preferences.inspectorCollapsed);
    inspector!.hidden = preferences.inspectorCollapsed;
    separator!.hidden = preferences.inspectorCollapsed || !desktop.matches;
    separator!.setAttribute('aria-valuemin', String(min));
    separator!.setAttribute('aria-valuemax', String(Math.round(max)));
    separator!.setAttribute('aria-valuenow', String(displayedWidth));
    separator!.setAttribute('aria-valuetext', `編輯面板寬度 ${displayedWidth} 像素`);
    toggle!.setAttribute('aria-expanded', String(!preferences.inspectorCollapsed));
    toggle!.title = preferences.inspectorCollapsed ? '展開編輯面板' : '收合編輯面板';
    toggleLabel!.textContent = preferences.inspectorCollapsed ? '展開面板' : '收合面板';
    queueResize();
  }

  function endGesture(commit: boolean): void {
    if (!gesture) return;
    const finished = gesture;
    gesture = undefined;
    document.body.classList.remove('is-resizing-inspector');
    if (separator!.hasPointerCapture(finished.pointerId)) separator!.releasePointerCapture(finished.pointerId);
    if (!commit) preferences.inspectorWidth = finished.previousWidth;
    refresh();
    if (commit) savePreferences();
    if (!destroyed) announce(commit ? `編輯面板寬度 ${displayedWidth} 像素` : '已取消面板寬度調整');
  }

  listen<PointerEvent>(separator, 'pointerdown', event => {
    if (destroyed || gesture || !desktop.matches || preferences.inspectorCollapsed || event.button !== 0) return;
    event.preventDefault();
    separator.focus({ preventScroll: true });
    gesture = { pointerId: event.pointerId, startX: event.clientX, startWidth: displayedWidth,
      previousWidth: preferences.inspectorWidth };
    separator.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-inspector');
  });

  listen<PointerEvent>(separator, 'pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const { min, max } = widthLimits();
    // The inspector sits on the right: moving the divider left makes it wider.
    preferences.inspectorWidth = Math.round(Math.max(min, Math.min(max,
      gesture.startWidth + gesture.startX - event.clientX)));
    refresh();
  });
  listen<PointerEvent>(separator, 'pointerup', event => {
    if (gesture?.pointerId === event.pointerId) endGesture(true);
  });
  listen<PointerEvent>(separator, 'pointercancel', event => {
    if (gesture?.pointerId === event.pointerId) endGesture(false);
  });
  listen<PointerEvent>(separator, 'lostpointercapture', event => {
    if (gesture?.pointerId === event.pointerId) endGesture(false);
  });
  listen<KeyboardEvent>(window, 'keydown', event => {
    if (!gesture || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    endGesture(false);
  });

  function resetWidth(): void {
    if (gesture) endGesture(false);
    preferences.inspectorWidth = DEFAULT_WIDTH;
    refresh();
    savePreferences();
    announce(`已還原面板寬度 ${displayedWidth} 像素`);
  }

  listen<MouseEvent>(separator, 'dblclick', resetWidth);
  listen<KeyboardEvent>(separator, 'keydown', event => {
    if (gesture || !desktop.matches || preferences.inspectorCollapsed) return;
    const { min, max } = widthLimits();
    const step = event.shiftKey ? 48 : 16;
    let next = displayedWidth;
    if (event.key === 'ArrowLeft') next += step;
    else if (event.key === 'ArrowRight') next -= step;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    else if (event.key === 'Enter') { event.preventDefault(); resetWidth(); return; }
    else return;
    event.preventDefault();
    preferences.inspectorWidth = Math.round(Math.max(min, Math.min(max, next)));
    refresh();
    savePreferences();
    announce(`編輯面板寬度 ${displayedWidth} 像素`);
  });

  listen<MouseEvent>(toggle, 'click', () => {
    if (gesture) endGesture(false);
    preferences.inspectorCollapsed = !preferences.inspectorCollapsed;
    if (preferences.inspectorCollapsed && inspector.contains(document.activeElement)) toggle.focus();
    refresh();
    savePreferences();
    announce(preferences.inspectorCollapsed ? '編輯面板已收合，時間圖表已展開' : '編輯面板已展開');
  });

  listen<MediaQueryListEvent>(desktop, 'change', () => {
    if (gesture) endGesture(false);
    if (!desktop.matches && document.activeElement === separator) toggle.focus({ preventScroll: true });
    refresh();
  });
  listen<Event>(window, 'resize', refresh);
  const observer = new ResizeObserver(() => {
    const width = layout.clientWidth;
    const height = layout.clientHeight;
    if (width !== lastContainerWidth || height !== lastContainerHeight) {
      lastContainerWidth = width;
      lastContainerHeight = height;
      refresh();
    }
  });
  observer.observe(layout);
  refresh();

  return {
    refresh,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      endGesture(false);
      observer.disconnect();
      removers.forEach(remove => remove());
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
      document.body.classList.remove('is-resizing-inspector');
    },
  };
}
