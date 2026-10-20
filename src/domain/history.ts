import { validateDocument, type TimelineDocument } from "./document.ts";

/** Bounded snapshots; the limit includes the current document. */
export class DocumentHistory {
  #snapshots: TimelineDocument[];
  #index = 0;
  #limit: number;

  constructor(initial: TimelineDocument, limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("歷史紀錄上限必須是大於零的整數。");
    this.#limit = limit;
    this.#snapshots = [validateDocument(initial)];
  }

  get current(): TimelineDocument {
    return structuredClone(this.#snapshots[this.#index]);
  }

  get canUndo(): boolean {
    return this.#index > 0;
  }

  get canRedo(): boolean {
    return this.#index < this.#snapshots.length - 1;
  }

  commit(next: TimelineDocument): void {
    const snapshot = validateDocument(next);
    if (JSON.stringify(snapshot) === JSON.stringify(this.#snapshots[this.#index])) return;
    this.#snapshots = this.#snapshots.slice(0, this.#index + 1);
    this.#snapshots.push(snapshot);
    if (this.#snapshots.length > this.#limit) {
      this.#snapshots.splice(0, this.#snapshots.length - this.#limit);
    }
    this.#index = this.#snapshots.length - 1;
  }

  undo(): TimelineDocument {
    if (this.canUndo) this.#index--;
    return this.current;
  }

  redo(): TimelineDocument {
    if (this.canRedo) this.#index++;
    return this.current;
  }
}
