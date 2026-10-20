import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCloseRequestHandler, createFilePlatform, installCloseHandler, isDesktop,
  MAX_IMPORT_BYTES, MAX_NATIVE_JSON_BYTES, MAX_NATIVE_PNG_BYTES,
} from './platform.ts';
import type { FilePlatformAdapters } from './platform.ts';

function fixture(desktop: boolean, invoke: FilePlatformAdapters['invoke'] = async () => true) {
  const downloads: { blob: Blob; filename: string }[] = [];
  const calls: { command: string; args: Record<string, unknown> | undefined }[] = [];
  const platform = createFilePlatform({
    isDesktop: () => desktop,
    async invoke(command, args) { calls.push({ command, args }); return invoke(command, args); },
    download(blob, filename) { downloads.push({ blob, filename }); },
  });
  return { ...platform, downloads, calls };
}

test('platform can load in Node without a window or document', () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof document, 'undefined');
  assert.equal(isDesktop(), false);
});

test('web operations preserve the original Blob download and never invoke native commands', async () => {
  const platform = fixture(false);
  const blob = new Blob(['{"title":"圖表"}'], { type: 'application/json;charset=utf-8' });
  assert.equal(await platform.openDocument(), null);
  assert.equal(await platform.saveBlob(blob, '我的圖表.json', 'json'), true);
  assert.equal(platform.downloads[0].blob, blob);
  assert.equal(platform.downloads[0].filename, '我的圖表.json');
  assert.deepEqual(platform.calls, []);
});

test('native open preserves source text and the app retains responsibility for parsing', async () => {
  const original = { name: '尚未修復.json', content: '\uFEFF{ "title": "未完成的圖表",\r\n' };
  const platform = fixture(true, async () => original);
  assert.deepEqual(await platform.openDocument(), original);
  assert.deepEqual(platform.calls, [{ command: 'open_document', args: undefined }]);
  assert.deepEqual(platform.downloads, []);
});

test('native open enforces the same UTF-8 byte limit as browser file import', async () => {
  const content = '圖'.repeat(333_333) + 'x';
  assert.equal(new TextEncoder().encode(content).byteLength, MAX_IMPORT_BYTES);
  const withinLimit = fixture(true, async () => ({ name: 'edge.json', content }));
  assert.equal((await withinLimit.openDocument())?.content, content);
  const tooLarge = fixture(true, async () => ({ name: 'large.json', content: content + 'x' }));
  await assert.rejects(tooLarge.openDocument(), /檔案超過 1 MB/);
});

test('dialog cancellation returns null or false without triggering browser fallback', async () => {
  const platform = fixture(true, async command => command === 'open_document' ? null : false);
  assert.equal(await platform.openDocument(), null);
  assert.equal(await platform.saveBlob(new Blob(['original']), 'backup.json', 'json'), false);
  assert.deepEqual(platform.downloads, []);
});

test('native JSON save preserves malformed recovery text, Unicode, BOM and line endings as bytes', async () => {
  const content = '\uFEFF{ "原始備份": "不完整的內容",\r\n';
  const platform = fixture(true);
  assert.equal(await platform.saveBlob(new Blob([content]), 'pst-recovery.json', 'json'), true);
  assert.deepEqual(platform.calls, [{ command: 'save_file', args: {
    filename: 'pst-recovery.json', kind: 'json', bytes: Array.from(new TextEncoder().encode(content)),
  } }]);
  assert.deepEqual(platform.downloads, []);
});

test('saving recovery contents is not restricted to the smaller import limit', async () => {
  const platform = fixture(true);
  const blob = new Blob(['x'.repeat(MAX_IMPORT_BYTES + 1)]);
  assert.equal(await platform.saveBlob(blob, 'pst-recovery.json', 'json'), true);
  assert.equal((platform.calls[0].args?.bytes as number[]).length, MAX_IMPORT_BYTES + 1);
});

test('empty recovery contents can be saved without a JSON parser rejecting them', async () => {
  const platform = fixture(true);
  assert.equal(await platform.saveBlob(new Blob([]), 'empty-recovery.json', 'json'), true);
  assert.deepEqual(platform.calls[0].args?.bytes, []);
});

test('native PNG save retains exact binary bytes including zero and high-byte values', async () => {
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128];
  const platform = fixture(true);
  assert.equal(await platform.saveBlob(new Blob([new Uint8Array(bytes)]), '圖表.png', 'png'), true);
  assert.deepEqual(platform.calls[0], { command: 'save_file', args: { filename: '圖表.png', kind: 'png', bytes } });
});

test('native size limits reject before allocating or sending large IPC byte arrays', async () => {
  for (const [kind, maximum, message] of [
    ['json', MAX_NATIVE_JSON_BYTES, /16 MiB/],
    ['png', MAX_NATIVE_PNG_BYTES, /128 MiB/],
  ] as const) {
    const platform = fixture(true);
    const blob = {
      size: maximum + 1,
      arrayBuffer() { assert.fail('oversized Blob must not be read'); },
    } as unknown as Blob;
    await assert.rejects(platform.saveBlob(blob, `large.${kind}`, kind), message);
    assert.deepEqual(platform.calls, []);
    assert.deepEqual(platform.downloads, []);
  }
});

test('native-specific limits do not change browser download behavior', async () => {
  const platform = fixture(false);
  const blob = { size: MAX_NATIVE_JSON_BYTES + 1 } as Blob;
  assert.equal(await platform.saveBlob(blob, 'large.json', 'json'), true);
  assert.equal(platform.downloads[0].blob, blob);
  assert.deepEqual(platform.calls, []);
});

test('string command failures become meaningful Error instances and never fall back to web', async () => {
  const platform = fixture(true, async () => { throw '檔案無法寫入，請選擇其他位置。'; });
  await assert.rejects(platform.saveBlob(new Blob(['{}']), 'chart.json', 'json'), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, '檔案無法寫入，請選擇其他位置。');
    return true;
  });
  await assert.rejects(platform.openDocument(), /檔案無法寫入/);
  assert.deepEqual(platform.downloads, []);
});

test('existing Error instances survive while opaque failures get an actionable fallback', async () => {
  const original = new Error('磁碟空間不足。');
  const known = fixture(true, async () => { throw original; });
  await assert.rejects(known.saveBlob(new Blob(['{}']), 'chart.json', 'json'), error => error === original);
  const opaque = fixture(true, async () => { throw { unexpected: true }; });
  await assert.rejects(opaque.openDocument(), /無法開啟 JSON 檔案/);
});

test('malformed native replies are errors, never mistaken for successful saves or cancellation', async () => {
  for (const value of [undefined, {}, { name: 'x', content: 1 }, true]) {
    const platform = fixture(true, async () => value);
    await assert.rejects(platform.openDocument(), /回傳的檔案內容格式不正確/);
  }
  for (const value of [undefined, null, 'true', 1]) {
    const platform = fixture(true, async () => value);
    await assert.rejects(platform.saveBlob(new Blob(['{}']), 'chart.json', 'json'), /未能確認檔案是否已儲存/);
    assert.deepEqual(platform.downloads, []);
  }
});

test('browser close setup is a no-op without loading a native window', async () => {
  const dispose = await installCloseHandler(
    async () => { assert.fail('browser must retain its existing pagehide behavior'); },
    () => { assert.fail('browser needs no native close callback'); },
  );
  dispose();
});

test('native close prevents synchronously, waits for edits, and ignores repeated close requests', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const steps: string[] = [];
  let prevented = 0;
  const handler = createCloseRequestHandler(
    async () => { steps.push('flush'); await pending; steps.push('persisted'); },
    async () => { steps.push('destroy'); },
    error => { throw error; },
  );
  const first = handler({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 1);
  assert.deepEqual(steps, ['flush']);
  await handler({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 2);
  assert.deepEqual(steps, ['flush']);
  release();
  await first;
  assert.deepEqual(steps, ['flush', 'persisted', 'destroy']);
  await handler({ preventDefault() { prevented += 1; } });
  assert.equal(prevented, 3);
  assert.deepEqual(steps, ['flush', 'persisted', 'destroy']);
});

test('a failed close flush keeps the window open and allows a successful retry', async () => {
  let attempts = 0;
  let destroyed = 0;
  const errors: Error[] = [];
  const handler = createCloseRequestHandler(
    async () => { if (++attempts === 1) throw '自動保存失敗，請先另存 JSON。'; },
    async () => { destroyed += 1; },
    error => { errors.push(error); },
  );
  await handler({ preventDefault() {} });
  assert.equal(destroyed, 0);
  assert.ok(errors[0] instanceof Error);
  assert.equal(errors[0].message, '自動保存失敗，請先另存 JSON。');
  await handler({ preventDefault() {} });
  assert.equal(destroyed, 1);
  assert.equal(attempts, 2);
});

test('native destroy failures remain visible and can be retried without bypassing persistence', async () => {
  let flushes = 0;
  let destroys = 0;
  const errors: Error[] = [];
  const handler = createCloseRequestHandler(
    async () => { flushes += 1; },
    async () => { if (++destroys === 1) throw 'window.destroy denied'; },
    error => { errors.push(error); },
  );
  await handler({ preventDefault() {} });
  assert.equal(errors[0].message, 'window.destroy denied');
  await handler({ preventDefault() {} });
  assert.equal(flushes, 2);
  assert.equal(destroys, 2);
});
