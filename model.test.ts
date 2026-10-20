import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  cloneDocument,
  createDemoDocument,
  createEmptyDocument,
  daysBetween,
  DocumentHistory,
  formatShortDate,
  getDocumentBounds,
  isValidDate,
  makeId,
  parseDocument,
  serializeDocument,
  validateDocument,
  type TimelineDocument,
} from "./model.ts";

function fixture(): TimelineDocument {
  const doc = createEmptyDocument("2026-10-20");
  doc.items = [{
    id: "task-a", name: "版面設計", start: "2026-10-02", end: "2026-10-08",
    type: "task", color: "#5269E8", note: "第一行\n第二行",
  }];
  doc.markers = [{ id: "marker-a", date: "2026-10-15", label: "確認日", color: "#C17A2C" }];
  return doc;
}

test("calendar validation checks actual dates, leap-year rules and supported years", () => {
  for (const date of ["1900-01-01", "2000-02-29", "2024-02-29", "2100-12-31"]) {
    assert.equal(isValidDate(date), true, date);
  }
  for (const value of [
    "1900-02-29", "2100-02-29", "2023-02-29", "2024-04-31", "2026-00-01",
    "2026-13-01", "2026-01-00", "2026-1-01", "2026-01-1", "2026-01-01T00:00:00Z",
    "1899-12-31", "2101-01-01", " 2026-01-01", "", null, undefined, 20260101, {}, [], new Date(),
  ]) assert.equal(isValidDate(value), false, String(value));
});

test("calendar arithmetic remains independent of DST and the process timezone", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Europe/Berlin", "Asia/Taipei"]) {
      process.env.TZ = zone;
      assert.equal(addDays("2026-03-07", 2), "2026-03-09", zone);
      assert.equal(addDays("2026-10-31", 2), "2026-11-02", zone);
      assert.equal(addDays("2024-02-28", 1), "2024-02-29", zone);
      assert.equal(addDays("2024-03-01", -1), "2024-02-29", zone);
      assert.equal(addDays("2026-12-31", 1), "2027-01-01", zone);
      assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2, zone);
      assert.equal(daysBetween("2026-10-31", "2026-11-02"), 2, zone);
      assert.equal(daysBetween("2024-03-01", "2024-02-28"), -2, zone);
      assert.equal(daysBetween("2026-10-20", "2026-10-20"), 0, zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("date helpers reject invalid inputs and calendar overflow", () => {
  assert.throws(() => addDays("2023-02-29", 1), /有效.*日期/u);
  for (const value of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => addDays("2026-10-20", value), /整數/u);
  }
  assert.throws(() => addDays("1900-01-01", -1), /1900/u);
  assert.throws(() => addDays("2100-12-31", 1), /2100/u);
  assert.throws(() => daysBetween("2026-01-01", "bad"), /日期/u);
  assert.equal(formatShortDate("2026-01-02"), "01/02");
  assert.throws(() => formatShortDate("bad"), /日期/u);
});

test("empty and demo documents remain valid at both calendar boundaries", () => {
  const empty = createEmptyDocument("2024-02-29");
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.markers, []);
  assert.equal(empty.view.start, "2024-02-01");
  assert.equal(empty.view.end, "2024-02-29");
  for (const today of ["1900-01-01", "2026-10-20", "2100-12-31"]) {
    const demo = createDemoDocument(today);
    assert.equal(demo.items.length, 8);
    assert.equal(demo.items.filter((item) => item.type === "milestone").length, 2);
    assert.deepEqual(validateDocument(demo), demo);
    for (const item of demo.items) {
      assert.ok(item.start >= demo.view.start && item.end <= demo.view.end);
    }
  }
  assert.equal(createDemoDocument("2026-10-20").view.start, "2026-10-01");
  assert.throws(() => createEmptyDocument("wrong"), /日期/u);
});

test("JSON round trips all known document data and returns independent objects", () => {
  const doc = fixture();
  const imported = parseDocument(serializeDocument(doc));
  assert.deepEqual(imported, doc);
  assert.notEqual(imported, doc);
  assert.notEqual(imported.items, doc.items);
  assert.notEqual(imported.items[0], doc.items[0]);
  assert.notEqual(imported.view, doc.view);
  assert.deepEqual(parseDocument(`\uFEFF${serializeDocument(doc)}`), doc);
});

test("malformed JSON, wrong schemas and missing required fields fail explicitly", () => {
  for (const text of ["", "{", "{\"title\":}"]) assert.throws(() => parseDocument(text), /JSON 格式/u);
  for (const value of [null, [], "text", 1, new Date()]) assert.throws(() => validateDocument(value), /物件/u);
  for (const schemaVersion of [0, 2, "1", null]) {
    assert.throws(() => validateDocument({ ...fixture(), schemaVersion }), /版本/u);
  }
  const missing: Record<string, unknown> = { ...fixture() };
  delete missing.markers;
  assert.throws(() => validateDocument(missing), /markers/u);
  assert.throws(() => parseDocument(" ".repeat(1_000_001)), /過大/u);
});

test("invalid rows are rejected rather than silently removed", () => {
  const doc = fixture();
  const source = { ...doc, items: [doc.items[0], null] };
  assert.throws(() => validateDocument(source), /第 2 筆任務/u);
  const sparse = new Array(2);
  sparse[0] = doc.items[0];
  assert.throws(() => validateDocument({ ...doc, items: sparse }), /第 2 筆任務/u);
  assert.throws(() => validateDocument({ ...doc, markers: [null] }), /第 1 筆日期標記/u);
  assert.throws(() => validateDocument({ ...doc, items: {} }), /陣列/u);
});

test("IDs must be unique across both tasks and markers", () => {
  const doc = fixture();
  assert.throws(() => validateDocument({ ...doc, items: [doc.items[0], { ...doc.items[0] }] }), /重複/u);
  doc.markers[0].id = doc.items[0].id;
  assert.throws(() => validateDocument(doc), /重複/u);
  doc.markers[0].id = "marker with space";
  assert.throws(() => validateDocument(doc), /空白字元/u);
});

test("milestones normalize to their start date without accepting malformed dates", () => {
  const doc = fixture();
  doc.items[0].type = "milestone";
  const normalized = validateDocument(doc);
  assert.equal(normalized.items[0].end, normalized.items[0].start);
  assert.equal(doc.items[0].end, "2026-10-08", "input is not mutated");
  doc.items[0].end = "2026-02-30";
  assert.throws(() => validateDocument(doc), /結束日期/u);
});

test("date ordering, item types and color strings are validated", () => {
  const original = fixture();
  for (const patch of [
    { end: "2026-10-01" }, { start: "2026-02-30" }, { type: "unknown" },
    { color: "red" }, { color: "#abc" }, { color: "url(https://example.invalid)" },
  ]) {
    assert.throws(() => validateDocument({ ...original, items: [{ ...original.items[0], ...patch }] }));
  }
  assert.throws(() => validateDocument({ ...original, markers: [{ ...original.markers[0], color: "#000000ff" }] }), /色碼/u);
  assert.throws(() => validateDocument({ ...original, view: { ...original.view, end: "2026-09-30" } }), /早於/u);
});

test("document text limits and required display settings are enforced", () => {
  const original = fixture();
  assert.throws(() => validateDocument({ ...original, title: " " }), /不可空白/u);
  assert.throws(() => validateDocument({ ...original, title: "x".repeat(121) }), /120/u);
  assert.throws(() => validateDocument({ ...original, subtitle: "x".repeat(241) }), /240/u);
  for (const patch of [{ name: "x".repeat(161) }, { note: "x".repeat(1001) }, { note: "a\u0000b" }]) {
    assert.throws(() => validateDocument({ ...original, items: [{ ...original.items[0], ...patch }] }));
  }
  assert.throws(() => validateDocument({ ...original, markers: [{ ...original.markers[0], label: "x".repeat(121) }] }), /120/u);
  for (const patch of [
    { scale: "year" }, { dayWidth: 11 }, { dayWidth: 81 }, { dayWidth: NaN },
    { rowHeight: 31 }, { rowHeight: 65 }, { rowHeight: Infinity },
    { showNotes: "true" }, { showWeekends: 1 },
  ]) assert.throws(() => validateDocument({ ...original, view: { ...original.view, ...patch } }));
});

test("row, marker and viewport limits accept their boundary and reject overflow", () => {
  const doc = fixture();
  doc.items = Array.from({ length: 200 }, (_, index) => ({ ...doc.items[0], id: `task-${index}` }));
  doc.markers = Array.from({ length: 50 }, (_, index) => ({ ...doc.markers[0], id: `marker-${index}` }));
  doc.view.end = addDays(doc.view.start, 730);
  doc.view.dayWidth = 80;
  doc.view.rowHeight = 64;
  assert.deepEqual(validateDocument(doc), doc);
  assert.throws(() => validateDocument({ ...doc, items: [...doc.items, { ...doc.items[0], id: "overflow" }] }), /200/u);
  assert.throws(() => validateDocument({ ...doc, markers: [...doc.markers, { ...doc.markers[0], id: "overflow" }] }), /50/u);
  assert.throws(() => validateDocument({ ...doc, view: { ...doc.view, end: addDays(doc.view.start, 731) } }), /730/u);
});

test("unknown properties cannot pollute prototypes or enter normalized documents", () => {
  const json = JSON.stringify(fixture());
  const source = `${json.slice(0, -1)},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"extra":123}`;
  const doc = parseDocument(source);
  assert.equal(Object.hasOwn(doc, "__proto__"), false);
  assert.equal(Object.hasOwn(doc, "constructor"), false);
  assert.equal(Object.hasOwn(doc, "extra"), false);
  assert.equal(Object.getPrototypeOf(doc), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  const row = { ...fixture().items[0], extra: "ignored" };
  assert.equal(Object.hasOwn(validateDocument({ ...fixture(), items: [row] }).items[0], "extra"), false);
  const accessor = { ...fixture() };
  Object.defineProperty(accessor, "title", { get() { throw new Error("getter must not run"); } });
  assert.throws(() => validateDocument(accessor), /缺少有效/u);
});

test("content bounds include markers and fall back to the view when empty", () => {
  const doc = fixture();
  doc.markers = [
    { ...doc.markers[0], id: "early", date: "2026-09-25" },
    { ...doc.markers[0], id: "late", date: "2026-11-05" },
  ];
  assert.deepEqual(getDocumentBounds(doc), { start: "2026-09-25", end: "2026-11-05" });
  doc.markers = [];
  assert.deepEqual(getDocumentBounds(doc), { start: "2026-10-02", end: "2026-10-08" });
  doc.items = [];
  assert.deepEqual(getDocumentBounds(doc), { start: doc.view.start, end: doc.view.end });
});

test("clones isolate nested task, marker and view mutations", () => {
  const original = fixture();
  const copy = cloneDocument(original);
  copy.items[0].note = "changed";
  copy.markers[0].label = "changed";
  copy.view.dayWidth = 60;
  assert.equal(original.items[0].note, "第一行\n第二行");
  assert.equal(original.markers[0].label, "確認日");
  assert.equal(original.view.dayWidth, 18);
});

test("history supports undo, redo, unchanged commits and branching", () => {
  const doc = fixture();
  const history = new DocumentHistory(doc);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  history.commit({ ...doc, title: "第二版" });
  history.commit({ ...doc, title: "第三版" });
  assert.equal(history.undo().title, "第二版");
  assert.equal(history.canRedo, true);
  history.commit(history.current);
  assert.equal(history.canRedo, true, "unchanged commits preserve redo");
  assert.equal(history.redo().title, "第三版");
  history.undo();
  history.commit({ ...doc, title: "新的分支" });
  assert.equal(history.canRedo, false);
  assert.equal(history.redo().title, "新的分支");
  assert.equal(history.undo().title, "第二版");
  assert.equal(history.undo().title, doc.title);
  assert.equal(history.undo().title, doc.title);
});

test("history snapshots cannot be changed through input or returned references", () => {
  const original = fixture();
  const history = new DocumentHistory(original);
  original.items[0].name = "outside mutation";
  const next = history.current;
  next.title = "第二版";
  history.commit(next);
  next.items[0].name = "changed after commit";
  const exposed = history.current;
  exposed.items[0].name = "changed through getter";
  exposed.markers[0].label = "changed marker";
  exposed.view.dayWidth = 80;
  assert.equal(history.current.items[0].name, "版面設計");
  assert.equal(history.current.markers[0].label, "確認日");
  assert.equal(history.current.view.dayWidth, 18);
  const previous = history.undo();
  previous.title = "changed undo result";
  assert.equal(history.current.title, "未命名時程表");
  assert.equal(history.redo().title, "第二版");
  assert.throws(() => history.commit({ ...history.current, title: "" }), /不可空白/u);
  assert.equal(history.current.title, "第二版");
});

test("history limits discard oldest snapshots without breaking undo/redo", () => {
  const initial = fixture();
  const history = new DocumentHistory(initial, 3);
  for (const title of ["一", "二", "三", "四"]) history.commit({ ...initial, title });
  assert.equal(history.current.title, "四");
  assert.equal(history.undo().title, "三");
  assert.equal(history.undo().title, "二");
  assert.equal(history.canUndo, false);
  assert.equal(history.redo().title, "三");
  const single = new DocumentHistory(initial, 1);
  single.commit({ ...initial, title: "只有目前版本" });
  assert.equal(single.canUndo, false);
  assert.equal(single.current.title, "只有目前版本");
  for (const limit of [0, -1, 1.5, Infinity]) assert.throws(() => new DocumentHistory(initial, limit), /上限/u);
});

test("generated IDs are unique, bounded and safe as imported identifiers", () => {
  const ids = Array.from({ length: 250 }, () => makeId("task"));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("task-") && id.length <= 100));
  assert.match(makeId("    "), /^item-/u);
});
