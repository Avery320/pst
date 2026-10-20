import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserDocuments } from '../src/browser/storage.ts';
import { createDemoDocument, serializeDocument } from '../src/domain/document.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('browser persistence loads and saves documents without sharing references', () => {
  const storage = memoryStorage();
  const persistence = new BrowserDocuments(() => storage);
  const doc = createDemoDocument('2026-10-20');
  persistence.save(doc);
  const loaded = persistence.load();
  assert.deepEqual(loaded.document, doc);
  assert.equal(loaded.message, '');
  loaded.document.title = 'Changed';
  assert.equal(persistence.load().document.title, doc.title);
});

test('unreadable saved content is copied verbatim before it can be replaced', () => {
  for (const raw of ['{invalid', '']) {
    const storage = memoryStorage();
    storage.setItem('pst.document.v1', raw);
    const persistence = new BrowserDocuments(() => storage);
    const loaded = persistence.load();
    assert.equal(loaded.recoveryRaw, raw);
    assert.equal(storage.getItem('pst.recovery.v1'), raw);
    assert.ok(loaded.message);
    persistence.save(loaded.document);
    assert.equal(storage.getItem('pst.recovery.v1'), raw);
  }
});

test('failed recovery backup blocks autosave until the original has been downloaded', () => {
  const storage = memoryStorage();
  storage.setItem('pst.document.v1', 'broken original');
  const persistence = new BrowserDocuments(() => ({
    getItem: storage.getItem,
    setItem: (key, value) => {
      if (key === 'pst.recovery.v1') throw new Error('quota exceeded');
      storage.setItem(key, value);
    },
  }));
  const loaded = persistence.load();
  assert.equal(persistence.recoveryBlocked, true);
  assert.equal(loaded.recoveryRaw, 'broken original');
  assert.throws(() => persistence.save(loaded.document), /備份/);
  assert.equal(storage.getItem('pst.document.v1'), 'broken original');
  persistence.releaseRecovery();
  persistence.save(loaded.document);
  assert.equal(storage.getItem('pst.document.v1'), serializeDocument(loaded.document));
});

test('blocked browser storage returns an editable document and a useful error', () => {
  const persistence = new BrowserDocuments(() => { throw new Error('storage denied'); });
  const loaded = persistence.load();
  assert.ok(loaded.document.items.length > 0);
  assert.match(loaded.message, /無法自動保存/);
  assert.throws(() => persistence.save(loaded.document), /無法讀取/);
});

test('a valid saved document retains an older recovery copy and rejects invalid saves', () => {
  const storage = memoryStorage();
  const persistence = new BrowserDocuments(() => storage);
  const doc = createDemoDocument('2026-10-20');
  persistence.save(doc);
  storage.setItem('pst.recovery.v1', 'older backup');
  assert.equal(persistence.load().recoveryRaw, 'older backup');
  assert.throws(() => persistence.save({ ...doc, title: '' }));
  assert.equal(storage.getItem('pst.document.v1'), serializeDocument(doc));
});

test('a transient read failure cannot overwrite existing storage through a later successful write', () => {
  const storage = memoryStorage();
  storage.setItem('pst.document.v1', 'unread original');
  const persistence = new BrowserDocuments(() => ({
    getItem: () => { throw new Error('transient read failure'); },
    setItem: storage.setItem,
  }));
  const loaded = persistence.load();
  assert.throws(() => persistence.save(loaded.document), /無法讀取/);
  assert.equal(storage.getItem('pst.document.v1'), 'unread original');
});
