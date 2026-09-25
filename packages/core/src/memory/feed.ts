import { InMemoryQueryError } from "./types";

/**
 * Sequence-numbered change log backing `getChanges`. The cursor is the head
 * sequence number serialised as a string; "0" or "" means "from the beginning".
 */
export class ChangeLog {
  private head = 0;
  private readonly changed = new Map<string, number>();
  private readonly deleted = new Map<string, number>();

  get cursor(): string {
    return String(this.head);
  }

  /** Records that a row was created/updated (deleted = false) or deleted. */
  recordRow(rowId: string, deleted: boolean): void {
    this.head += 1;
    if (deleted) {
      this.changed.delete(rowId);
      this.deleted.set(rowId, this.head);
    } else {
      this.deleted.delete(rowId);
      this.changed.set(rowId, this.head);
    }
  }

  /** Records a schema change so pollers see a new head (and schemaVersion). */
  recordSchemaChange(): void {
    this.head += 1;
  }

  /** Parses a cursor; throws InMemoryQueryError("invalidCursor") when malformed or ahead of head. */
  parse(cursor: string): number {
    if (cursor === "" || cursor === undefined || cursor === null) return 0;
    if (typeof cursor !== "string" || !/^\d+$/.test(cursor)) {
      throw new InMemoryQueryError("invalidCursor", "Invalid change-feed cursor");
    }
    const n = Number(cursor);
    if (!Number.isSafeInteger(n) || n > this.head) {
      throw new InMemoryQueryError("invalidCursor", "Invalid change-feed cursor");
    }
    return n;
  }

  /** Row ids changed and deleted after `since`, each in sequence order. */
  since(since: number): { changedIds: string[]; deletedIds: string[] } {
    const after = (m: Map<string, number>) =>
      [...m.entries()]
        .filter(([, seq]) => seq > since)
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => id);
    return { changedIds: after(this.changed), deletedIds: after(this.deleted) };
  }
}
