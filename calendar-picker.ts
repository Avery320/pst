import './calendar.css';
import { isValidDate } from './model.ts';
import {
  daysInMonth, endOfMonth, endOfWeek, enumerateMonthGrid, formatDateZh, formatWeekdayZh,
  localToday, MAX_CALENDAR_DATE, MIN_CALENDAR_DATE, shiftRange, startOfMonth, startOfWeek,
  type WeekStartsOn,
} from './calendar.ts';

export interface DatePickerOptions {
  weekStartsOn?: WeekStartsOn;
  /** Read at render time so changes to the document's calendar settings apply immediately. */
  getWeekStartsOn?: () => WeekStartsOn;
}

export interface DatePickerHandle {
  /** Enhance newly added date fields and synchronize current values/disabled states. */
  refresh(): void;
  close(): void;
  destroy(): void;
}

interface DateControl {
  input: HTMLInputElement;
  wrapper: HTMLSpanElement;
  trigger: HTMLButtonElement;
  dispose(): void;
}

const INPUT_SELECTOR = '#view-start, #view-end, #item-start, #item-end, #marker-date, input[data-date-picker]';
const RANGE_PAIRS: Record<string, readonly [string, string]> = {
  'view-start': ['view-start', 'view-end'],
  'view-end': ['view-start', 'view-end'],
  'item-start': ['item-start', 'item-end'],
  'item-end': ['item-start', 'item-end'],
};
let pickerSequence = 0;

/**
 * Add one custom, keyboard-operable calendar dialog to the existing date inputs.
 * The original type=date inputs and their labels remain intact for typed/native entry.
 * Selection emits the same bubbling change event that the application already handles.
 */
export function attachDatePickers(root: HTMLElement = document.body, options: DatePickerOptions = {}): DatePickerHandle {
  const owner = root.ownerDocument;
  const win = owner.defaultView;
  const sequence = ++pickerSequence;
  const controls = new Map<HTMLInputElement, DateControl>();
  const lifecycle = new AbortController();
  const eventOptions = { signal: lifecycle.signal };
  let active: DateControl | null = null;
  let displayMonth = startOfMonth(localToday());
  let focusedDate = localToday();
  let destroyed = false;

  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
    const node = owner.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (label: string, text: string, className = ''): HTMLButtonElement => {
    const node = create('button', className, text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    node.title = label;
    return node;
  };

  const dialog = create('dialog', 'pst-calendar-popup');
  dialog.id = `pst-calendar-${sequence}`;
  dialog.setAttribute('aria-labelledby', `${dialog.id}-heading`);
  dialog.setAttribute('aria-describedby', `${dialog.id}-help`);
  const header = create('div', 'pst-calendar-heading');
  const heading = create('h2');
  heading.id = `${dialog.id}-heading`;
  const closeButton = button('關閉月曆', '×', 'pst-calendar-close');
  header.append(heading, closeButton);
  const navigation = create('div', 'pst-calendar-navigation');
  const previous = button('上一個月', '‹', 'pst-calendar-nav');
  const next = button('下一個月', '›', 'pst-calendar-nav');
  const monthSelect = create('select', 'pst-calendar-month');
  monthSelect.setAttribute('aria-label', '月份');
  for (let month = 1; month <= 12; month++) {
    const option = create('option', '', `${month} 月`);
    option.value = String(month);
    monthSelect.append(option);
  }
  const yearSelect = create('select', 'pst-calendar-year');
  yearSelect.setAttribute('aria-label', '年份');
  for (let year = 1900; year <= 2100; year++) {
    const option = create('option', '', `${year} 年`);
    option.value = String(year);
    yearSelect.append(option);
  }
  navigation.append(previous, yearSelect, monthSelect, next);
  const announcement = create('p', 'pst-calendar-sr-only');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  const table = create('table', 'pst-calendar-grid');
  table.setAttribute('role', 'grid');
  const tableHead = create('thead');
  const tableBody = create('tbody');
  table.append(tableHead, tableBody);
  const footer = create('div', 'pst-calendar-footer');
  const todayButton = button('選擇今天', '今天', 'pst-calendar-today');
  const selectedSummary = create('span', 'pst-calendar-selection');
  footer.append(todayButton, selectedSummary);
  const help = create('p', 'pst-calendar-help', '方向鍵移動日期，Home／End 跳至週首尾；Page Up／Down 換月，按住 Shift 換年。Enter 選取，Esc 關閉。');
  help.id = `${dialog.id}-help`;
  dialog.append(header, navigation, announcement, table, footer, help);
  owner.body.append(dialog);

  function weekStart(): WeekStartsOn {
    const value = options.getWeekStartsOn?.() ?? options.weekStartsOn ?? 1;
    return value === 0 ? 0 : 1;
  }

  function bounds(input: HTMLInputElement): { min: string; max: string } {
    return {
      min: isValidDate(input.min) ? input.min : MIN_CALENDAR_DATE,
      max: isValidDate(input.max) ? input.max : MAX_CALENDAR_DATE,
    };
  }

  function clamp(iso: string, input: HTMLInputElement): string {
    const { min, max } = bounds(input);
    return iso < min ? min : iso > max ? max : iso;
  }

  function labelFor(input: HTMLInputElement): string {
    return input.getAttribute('aria-label')?.trim() || input.labels?.[0]?.textContent?.trim() || '日期';
  }

  function inputRange(input: HTMLInputElement): { start: string; end: string } | null {
    const pair = RANGE_PAIRS[input.id];
    if (!pair) return null;
    const startInput = owner.getElementById(pair[0]);
    const endInput = owner.getElementById(pair[1]);
    if (!(startInput instanceof HTMLInputElement) || !(endInput instanceof HTMLInputElement)) return null;
    const start = startInput.value;
    const end = endInput.value;
    return isValidDate(start) && isValidDate(end) && start <= end ? { start, end } : null;
  }

  function syncControl(control: DateControl): void {
    const { input, trigger } = control;
    trigger.disabled = input.disabled || input.readOnly || bounds(input).min > bounds(input).max;
    trigger.setAttribute('aria-label', `開啟${labelFor(input)}月曆`);
    trigger.title = `選擇${labelFor(input)}（也可直接輸入日期）`;
  }

  function positionDialog(): void {
    if (!dialog.open || !active || !win) return;
    const viewport = win.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? win.innerWidth;
    const viewportHeight = viewport?.height ?? win.innerHeight;
    const anchor = active.wrapper.getBoundingClientRect();
    const box = dialog.getBoundingClientRect();
    const gap = 8;
    const minLeft = leftEdge + gap;
    const maxLeft = Math.max(minLeft, leftEdge + viewportWidth - box.width - gap);
    const minTop = topEdge + gap;
    const maxTop = Math.max(minTop, topEdge + viewportHeight - box.height - gap);
    let top = anchor.bottom + gap;
    if (top + box.height > topEdge + viewportHeight - gap) top = anchor.top - box.height - gap;
    dialog.style.left = `${Math.max(minLeft, Math.min(maxLeft, anchor.left))}px`;
    dialog.style.top = `${Math.max(minTop, Math.min(maxTop, top))}px`;
  }

  function renderCalendar(focusDay = false): void {
    if (!active) return;
    const restoreGridFocus = focusDay || tableBody.contains(owner.activeElement);
    const { input } = active;
    const { min, max } = bounds(input);
    if (min > max || input.disabled || input.readOnly || !input.isConnected) {
      close();
      return;
    }
    focusedDate = clamp(focusedDate, input);
    const firstMonth = startOfMonth(min);
    const lastMonth = startOfMonth(max);
    displayMonth = displayMonth < firstMonth ? firstMonth : displayMonth > lastMonth ? lastMonth : displayMonth;
    const year = Number(displayMonth.slice(0, 4));
    const month = Number(displayMonth.slice(5, 7));
    const today = localToday();
    const selected = isValidDate(input.value) ? input.value : null;
    const range = inputRange(input);
    const startsOn = weekStart();
    heading.textContent = `選擇${labelFor(input)}`;
    table.setAttribute('aria-label', `${year} 年 ${month} 月`);
    announcement.textContent = `${year} 年 ${month} 月`;
    yearSelect.value = String(year);
    monthSelect.value = String(month);
    for (const option of yearSelect.options) {
      option.disabled = Number(option.value) < Number(min.slice(0, 4)) || Number(option.value) > Number(max.slice(0, 4));
    }
    for (const option of monthSelect.options) {
      const first = `${year}-${option.value.padStart(2, '0')}-01`;
      option.disabled = first > max || endOfMonth(first) < min;
    }
    previous.disabled = displayMonth <= firstMonth;
    next.disabled = displayMonth >= lastMonth;
    todayButton.disabled = today < min || today > max;
    selectedSummary.textContent = selected ? `${Number(selected.slice(5, 7))}/${Number(selected.slice(8, 10))} ${formatWeekdayZh(selected)}` : '尚未選擇';

    const weekdayRow = create('tr');
    for (let offset = 0; offset < 7; offset++) {
      const weekday = (startsOn + offset) % 7;
      const cell = create('th', weekday === 0 || weekday === 6 ? 'is-weekend' : '', formatWeekdayZh(weekday));
      cell.scope = 'col';
      weekdayRow.append(cell);
    }
    tableHead.replaceChildren(weekdayRow);
    const weeks = enumerateMonthGrid(displayMonth, startsOn, today);
    const candidates = weeks.flat().filter((cell) => cell.date !== null && cell.date >= min && cell.date <= max);
    if (!candidates.some((cell) => cell.date === focusedDate)) {
      focusedDate = candidates.find((cell) => cell.inMonth)?.date ?? candidates[0]?.date ?? min;
    }
    const rows = weeks.map((week) => {
      const row = create('tr');
      for (const cell of week) {
        const gridCell = create('td');
        gridCell.setAttribute('role', 'gridcell');
        if (cell.date === null) {
          gridCell.className = 'pst-calendar-blank';
          row.append(gridCell);
          continue;
        }
        const date = cell.date;
        const day = button(formatDateZh(date), String(cell.day), 'pst-calendar-day');
        day.dataset.date = date;
        day.disabled = date < min || date > max;
        day.tabIndex = date === focusedDate && !day.disabled ? 0 : -1;
        day.classList.toggle('is-adjacent', !cell.inMonth);
        day.classList.toggle('is-weekend', cell.isWeekend);
        day.classList.toggle('is-today', cell.isToday);
        day.classList.toggle('is-selected', date === selected);
        day.classList.toggle('is-in-range', !!range && date >= range.start && date <= range.end);
        if (cell.isToday) day.setAttribute('aria-current', 'date');
        gridCell.setAttribute('aria-selected', String(date === selected));
        gridCell.append(day);
        row.append(gridCell);
      }
      return row;
    });
    tableBody.replaceChildren(...rows);
    positionDialog();
    if (restoreGridFocus) tableBody.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus({ preventScroll: true });
  }

  function close(restoreFocus = true): void {
    const previousControl = active;
    active = null;
    previousControl?.trigger.setAttribute('aria-expanded', 'false');
    if (dialog.open) dialog.close();
    if (restoreFocus && previousControl?.trigger.isConnected && !previousControl.trigger.disabled) {
      previousControl.trigger.focus({ preventScroll: true });
    }
  }

  function open(control: DateControl): void {
    if (destroyed) return;
    syncControl(control);
    if (control.trigger.disabled) return;
    if (active === control && dialog.open) {
      close();
      return;
    }
    close(false);
    active = control;
    focusedDate = clamp(isValidDate(control.input.value) ? control.input.value : localToday(), control.input);
    displayMonth = startOfMonth(focusedDate);
    control.trigger.setAttribute('aria-expanded', 'true');
    renderCalendar();
    dialog.showModal();
    positionDialog();
    tableBody.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus({ preventScroll: true });
  }

  function choose(date: string): void {
    if (!active || !isValidDate(date)) return;
    const { input } = active;
    const { min, max } = bounds(input);
    if (input.disabled || input.readOnly || date < min || date > max) return;
    input.value = date;
    close();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function navigateMonth(amount: number): void {
    if (!active) return;
    const shifted = shiftRange({ start: focusedDate, end: focusedDate }, 'month', amount).start;
    focusedDate = clamp(shifted, active.input);
    displayMonth = startOfMonth(focusedDate);
    renderCalendar();
  }

  function chooseMonth(): void {
    if (!active) return;
    const year = Number(yearSelect.value);
    const month = Number(monthSelect.value);
    const day = Math.min(Number(focusedDate.slice(8, 10)), daysInMonth(year, month));
    focusedDate = clamp(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, active.input);
    displayMonth = startOfMonth(focusedDate);
    renderCalendar();
  }

  closeButton.addEventListener('click', () => close(), eventOptions);
  previous.addEventListener('click', () => navigateMonth(-1), eventOptions);
  next.addEventListener('click', () => navigateMonth(1), eventOptions);
  yearSelect.addEventListener('change', chooseMonth, eventOptions);
  monthSelect.addEventListener('change', chooseMonth, eventOptions);
  todayButton.addEventListener('click', () => choose(localToday()), eventOptions);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); }, eventOptions);
  dialog.addEventListener('close', () => {
    if (active && !dialog.open) close();
  }, eventOptions);
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  }, eventOptions);
  tableBody.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-date]') : null;
    if (target?.dataset.date && !target.disabled) choose(target.dataset.date);
  }, eventOptions);
  tableBody.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target instanceof HTMLButtonElement && target.dataset.date) focusedDate = target.dataset.date;
  }, eventOptions);
  tableBody.addEventListener('keydown', (event) => {
    if (!active || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.date) return;
    let nextDate: string | undefined;
    const dayOffsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (Object.hasOwn(dayOffsets, event.key)) {
      nextDate = shiftRange({ start: focusedDate, end: focusedDate }, 'day', dayOffsets[event.key]).start;
    } else if (event.key === 'Home') {
      nextDate = startOfWeek(focusedDate, weekStart());
    } else if (event.key === 'End') {
      nextDate = endOfWeek(focusedDate, weekStart());
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const amount = (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1);
      nextDate = shiftRange({ start: focusedDate, end: focusedDate }, 'month', amount).start;
    }
    if (nextDate) {
      event.preventDefault();
      event.stopPropagation();
      focusedDate = clamp(nextDate, active.input);
      displayMonth = startOfMonth(focusedDate);
      renderCalendar(true);
    }
    // Enter/Space retain native button activation; Escape is handled by dialog.cancel.
  }, eventOptions);
  win?.addEventListener('resize', positionDialog, eventOptions);
  win?.visualViewport?.addEventListener('resize', positionDialog, eventOptions);
  win?.visualViewport?.addEventListener('scroll', positionDialog, eventOptions);

  function refresh(): void {
    if (destroyed) return;
    const inputs = [...root.querySelectorAll<HTMLInputElement>(INPUT_SELECTOR)];
    if (root.matches(INPUT_SELECTOR) && root instanceof HTMLInputElement) inputs.unshift(root);
    for (const input of inputs) {
      if (input.type !== 'date' || controls.has(input)) continue;
      const wrapper = create('span', 'pst-date-field');
      const trigger = button(`開啟${labelFor(input)}月曆`, '', 'pst-calendar-trigger');
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', dialog.id);
      trigger.setAttribute('aria-expanded', 'false');
      // This fixed SVG contains no document/imported text.
      trigger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M7.5 3v5M16.5 3v5M3.5 10.5h17M7 14h3M14 14h3M7 17h3"/></svg>';
      input.before(wrapper);
      wrapper.append(input, trigger);
      const onClick = () => open(control);
      const onKeydown = (event: KeyboardEvent) => {
        if (event.altKey && event.key === 'ArrowDown') {
          event.preventDefault();
          open(control);
        }
      };
      const onChange = () => {
        syncControl(control);
        if (active === control) {
          if (isValidDate(input.value)) focusedDate = clamp(input.value, input);
          displayMonth = startOfMonth(focusedDate);
          renderCalendar();
        }
      };
      const control: DateControl = {
        input, wrapper, trigger,
        dispose() {
          trigger.removeEventListener('click', onClick);
          input.removeEventListener('keydown', onKeydown);
          input.removeEventListener('change', onChange);
          if (wrapper.parentNode && input.parentNode === wrapper) wrapper.replaceWith(input);
          else trigger.remove();
        },
      };
      trigger.addEventListener('click', onClick);
      input.addEventListener('keydown', onKeydown);
      input.addEventListener('change', onChange);
      controls.set(input, control);
    }
    for (const [input, control] of controls) {
      if (!input.isConnected) {
        if (active === control) close(false);
        control.dispose();
        controls.delete(input);
      } else syncControl(control);
    }
    if (active) renderCalendar();
  }

  const observer = new MutationObserver((changes) => {
    // Ignore our buttons/options: their disabled attributes also change while rendering.
    if (changes.some(({ target }) => target instanceof HTMLInputElement && controls.has(target))) refresh();
  });
  // Values are synchronized by refresh(); attributes catch programmatic disabled/min/max changes.
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly', 'min', 'max'] });
  refresh();
  return {
    refresh,
    close: () => close(),
    destroy() {
      if (destroyed) return;
      close(false);
      destroyed = true;
      observer.disconnect();
      lifecycle.abort();
      for (const control of controls.values()) control.dispose();
      controls.clear();
      dialog.remove();
    },
  };
}
