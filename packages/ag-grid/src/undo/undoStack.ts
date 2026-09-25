/**
 * Batch-level undo/redo.
 *
 * Deviation from the plan's `undo(getVersion)`/`redo(getVersion)` signature:
 * `getVersion` is dropped here. The plan itself notes the version is filled
 * in later by the edit controller's `buildBatch` — this stack only needs to
 * hand back the inverted `CellChange[]`; it's the caller (editController)
 * that turns those into a `ChangeBatch` with fresh `baseVersions` looked up
 * from the row store at apply time. Undo/redo therefore take no arguments.
 */
import type { CellChange, ChangeBatch } from "../internal/core";

export interface UndoRedoResult {
  changes: CellChange[];
  source: "undo" | "redo";
}

export interface UndoStack {
  /** Record a batch that was actually applied. Batches sourced from undo/redo, or with no applied changes, are ignored. */
  record(batch: ChangeBatch, applied: CellChange[]): void;
  undo(): UndoRedoResult | null;
  redo(): UndoRedoResult | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export interface UndoStackOptions {
  cap?: number;
}

interface Entry {
  applied: CellChange[];
}

export function invertChanges(changes: readonly CellChange[]): CellChange[] {
  return changes.map((c) => ({ rowId: c.rowId, columnId: c.columnId, prev: c.next, next: c.prev }));
}

export function createUndoStack(options: UndoStackOptions = {}): UndoStack {
  const cap = options.cap ?? 100;
  let undoEntries: Entry[] = [];
  let redoEntries: Entry[] = [];

  const record = (batch: ChangeBatch, applied: CellChange[]): void => {
    if (batch.source === "undo" || batch.source === "redo") return;
    if (applied.length === 0) return;
    undoEntries.push({ applied });
    if (undoEntries.length > cap) undoEntries = undoEntries.slice(undoEntries.length - cap);
    redoEntries = [];
  };

  const undo = (): UndoRedoResult | null => {
    const entry = undoEntries.pop();
    if (!entry) return null;
    redoEntries.push(entry);
    return { changes: invertChanges(entry.applied), source: "undo" };
  };

  const redo = (): UndoRedoResult | null => {
    const entry = redoEntries.pop();
    if (!entry) return null;
    undoEntries.push(entry);
    if (undoEntries.length > cap) undoEntries = undoEntries.slice(undoEntries.length - cap);
    return { changes: entry.applied.slice(), source: "redo" };
  };

  const canUndo = (): boolean => undoEntries.length > 0;
  const canRedo = (): boolean => redoEntries.length > 0;

  const clear = (): void => {
    undoEntries = [];
    redoEntries = [];
  };

  return { record, undo, redo, canUndo, canRedo, clear };
}
