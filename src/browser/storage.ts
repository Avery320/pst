import { createDemoDocument, parseDocument, serializeDocument, type TimelineDocument } from '../domain/document.ts';

const STORAGE_KEY = 'pst.document.v1';
const RECOVERY_KEY = 'pst.recovery.v1';
type DocumentStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Storage failures cannot invalidate edits or overwrite the last unreadable file. */
export class BrowserDocuments {
  recoveryBlocked = false;
  private readFailed = false;
  private readonly storage: () => DocumentStorage;

  constructor(storage: () => DocumentStorage = () => localStorage) { this.storage = storage; }

  load(): { document: TimelineDocument; message: string; recoveryRaw: string | null } {
    let saved: string | null;
    let recoveryRaw: string | null;
    try {
      saved = this.storage().getItem(STORAGE_KEY);
      recoveryRaw = this.storage().getItem(RECOVERY_KEY);
    } catch {
      this.readFailed = true;
      return { document: createDemoDocument(), message: '此瀏覽器目前無法自動保存。編輯完成後，請下載 JSON 保留內容。', recoveryRaw: null };
    }
    if (saved !== null) {
      try { return { document: parseDocument(saved), message: '', recoveryRaw }; }
      catch {
        try { this.storage().setItem(RECOVERY_KEY, saved); }
        catch { this.recoveryBlocked = true; }
        return {
          document: createDemoDocument(), recoveryRaw: saved,
          message: '上次的儲存內容無法讀取，已保留原始內容。可到「圖面」下載備份；目前先開啟範例。',
        };
      }
    }
    return { document: createDemoDocument(), message: '', recoveryRaw };
  }

  save(doc: TimelineDocument): void {
    if (this.readFailed) throw new Error('無法讀取原有儲存內容，請下載 JSON 保留編輯。');
    if (this.recoveryBlocked) throw new Error('請先下載原始備份，再繼續保存。');
    this.storage().setItem(STORAGE_KEY, serializeDocument(doc));
  }

  releaseRecovery(): void { this.recoveryBlocked = false; }
}
