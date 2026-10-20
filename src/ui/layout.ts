import { tokenNumber } from '../presentation/design.ts';
import { element } from './dom.ts';
import { clampSplit, setupSplitter, splitBounds } from './splitter.ts';

const STORAGE_KEY = 'pst.layout.v1';
interface LayoutPreferences { version: 1; inspectorWidth: number; inspectorCollapsed: boolean }

function readPreferences(): LayoutPreferences {
  const defaults: LayoutPreferences = { version: 1, inspectorWidth: tokenNumber('inspector-width'), inspectorCollapsed: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 500) return defaults;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults;
    const value = saved as Record<string, unknown>;
    if (value.version !== 1) return defaults;
    if (typeof value.inspectorWidth === 'number' && Number.isFinite(value.inspectorWidth)) {
      defaults.inspectorWidth = clampSplit(value.inspectorWidth, { min: tokenNumber('inspector-min'), max: tokenNumber('inspector-max') });
    }
    if (typeof value.inspectorCollapsed === 'boolean') defaults.inspectorCollapsed = value.inspectorCollapsed;
  } catch { /* Optional layout preferences must not block the document. */ }
  return defaults;
}

/** CSS owns responsive layout; this controller owns only panel preferences. */
export function setupWorkspaceLayout(): void {
  const layout = element('editor-layout');
  const inspector = element('inspector');
  const separator = element('inspector-resize');
  const toggle = element('toggle-inspector');
  const toggleLabel = element('inspector-toggle-label');
  const status = element('layout-status');
  const preferences = readPreferences();
  let displayedWidth = preferences.inspectorWidth;

  const bounds = () => splitBounds(layout.clientWidth, tokenNumber('inspector-min'), tokenNumber('inspector-max'), tokenNumber('canvas-min'));
  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
    catch { /* Resizing also works when persistence is unavailable. */ }
  };
  function apply(): void {
    displayedWidth = clampSplit(preferences.inspectorWidth, bounds());
    layout.style.setProperty('--inspector-width', `${displayedWidth}px`);
    layout.classList.toggle('is-inspector-collapsed', preferences.inspectorCollapsed);
    inspector.hidden = preferences.inspectorCollapsed;
    separator.hidden = preferences.inspectorCollapsed;
    toggle.setAttribute('aria-expanded', String(!preferences.inspectorCollapsed));
    const label = preferences.inspectorCollapsed ? '展開面板' : '收合面板';
    toggle.title = label;
    toggleLabel.textContent = label;
  }
  apply();
  const splitter = setupSplitter({
    element: separator, direction: -1, getValue: () => displayedWidth, getBounds: bounds,
    initialValue: () => tokenNumber('inspector-width'),
    setValue: value => { preferences.inspectorWidth = value; apply(); },
    onCommit: () => { save(); status.textContent = `編輯面板寬度 ${displayedWidth} 像素`; },
  });
  toggle.addEventListener('click', () => {
    splitter.cancel();
    preferences.inspectorCollapsed = !preferences.inspectorCollapsed;
    if (preferences.inspectorCollapsed && inspector.contains(document.activeElement)) toggle.focus();
    apply();
    save();
    status.textContent = preferences.inspectorCollapsed ? '編輯面板已收合' : '編輯面板已展開';
  });
  // This observer also catches breakpoint changes. Chart observes its own container.
  new ResizeObserver(() => {
    splitter.cancel();
    apply();
    splitter.refresh();
    if (getComputedStyle(separator).display === 'none' && document.activeElement === separator) toggle.focus({ preventScroll: true });
  }).observe(layout);
}
