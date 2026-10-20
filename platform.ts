import { isTauri } from '@tauri-apps/api/core';

export type SaveFileKind = 'json' | 'png';
export interface OpenedDocument { name: string; content: string }

// Import remains identical to the browser's existing decimal 1 MB limit.
// Saving allows larger raw recovery contents without requiring valid JSON.
export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_NATIVE_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_NATIVE_PNG_BYTES = 128 * 1024 * 1024;

export interface FilePlatformAdapters {
  isDesktop(): boolean;
  invoke(command: 'open_document' | 'save_file', args?: Record<string, unknown>): Promise<unknown>;
  download(blob: Blob, filename: string): void;
}

function platformError(error: unknown, fallback: string): Error {
  if (error instanceof Error && error.message.trim()) return error;
  if (typeof error === 'string' && error.trim()) return new Error(error);
  return new Error(fallback);
}

function openedDocument(value: unknown): OpenedDocument | null {
  if (value === null) return null;
  if (typeof value !== 'object' || !value || !('name' in value) || !('content' in value)
    || typeof value.name !== 'string' || typeof value.content !== 'string') {
    throw new Error('桌面版回傳的檔案內容格式不正確，請再試一次。');
  }
  if (new TextEncoder().encode(value.content).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('檔案超過 1 MB，請選擇較小的 pst JSON 檔案。');
  }
  // The app owns JSON/schema validation; this boundary preserves the source text.
  return { name: value.name, content: value.content };
}

/** Injected adapters keep file boundaries testable without a DOM or native host. */
export function createFilePlatform(adapters: FilePlatformAdapters): {
  openDocument(): Promise<OpenedDocument | null>;
  saveBlob(blob: Blob, filename: string, kind: SaveFileKind): Promise<boolean>;
} {
  return {
    async openDocument() {
      if (!adapters.isDesktop()) return null;
      try {
        return openedDocument(await adapters.invoke('open_document'));
      } catch (error) {
        throw platformError(error, '無法開啟 JSON 檔案，請再試一次。');
      }
    },
    async saveBlob(blob, filename, kind) {
      try {
        if (!adapters.isDesktop()) {
          // true means the browser download was initiated, not that its dialog
          // or disk write completed: browsers do not expose that result here.
          adapters.download(blob, filename);
          return true;
        }
        const maximum = kind === 'json' ? MAX_NATIVE_JSON_BYTES : MAX_NATIVE_PNG_BYTES;
        if (blob.size > maximum) {
          throw new Error(kind === 'json'
            ? 'JSON 備份超過 16 MiB，無法儲存。'
            : 'PNG 圖片超過 128 MiB，請縮小日期範圍、減少項目或改用 1× 匯出。');
        }
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        const saved = await adapters.invoke('save_file', { filename, kind, bytes });
        if (typeof saved !== 'boolean') {
          throw new Error('桌面版未能確認檔案是否已儲存，請再試一次。');
        }
        return saved;
      } catch (error) {
        // A native failure must remain visible; never silently start a browser
        // download or tell the caller a cancelled dialog saved its recovery data.
        throw platformError(error, '無法儲存檔案，請再試一次。');
      }
    },
  };
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && isTauri();
}

function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const platform = createFilePlatform({
  isDesktop,
  async invoke(command, args) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<unknown>(command, args);
  },
  download: browserDownload,
});

/** Web callers continue to open their existing file input; native cancel is null. */
export const openDocument = platform.openDocument;
/** Native cancel is false; only successful native writes or browser starts are true. */
export const saveBlob = platform.saveBlob;

/** A close request stays cancelled until pending edits have actually persisted. */
export function createCloseRequestHandler(
  onBeforeClose: () => Promise<void>,
  destroy: () => Promise<void>,
  onError: (error: Error) => void,
): (event: { preventDefault(): void }) => Promise<void> {
  let closing = false;
  return async event => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      await onBeforeClose();
      await destroy();
    } catch (error) {
      closing = false;
      onError(platformError(error, '關閉前無法完成保存，視窗已保持開啟。請先儲存 JSON 備份。'));
    }
  };
}

/** Registration failures reject; failures during close are sent to onError. */
export async function installCloseHandler(
  onBeforeClose: () => Promise<void>,
  onError: (error: Error) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const current = getCurrentWindow();
    return await current.onCloseRequested(createCloseRequestHandler(onBeforeClose, () => current.destroy(), onError));
  } catch (error) {
    throw platformError(error, '無法啟用關閉前保存，關閉視窗前請先儲存 JSON 備份。');
  }
}
