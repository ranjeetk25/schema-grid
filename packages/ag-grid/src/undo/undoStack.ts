/**
 * Batch-level undo/redo.
 *
 * Deviation from the plan's `undo(getVersion)`/`redo(getVersion)` signature:
 * `getVersion` is dropped here. The plan itself notes the version is filled
 * in later by the edit controller's `buildBatch` — this stack only needs to
 * hand back the inverted `CellChange[]`; it's the caller (editController)
 * that turns those into a `ChangeBatch` with fresh `baseVersions` looked up
 * from the row store at apply time. Undo/redo therefore take no arguments.
 *
 * v0.4: a paint (manual cell colors) is ONE entry too (`recordColors`). Its
 * undo / redo step carries `colors` (the colors to write back through
 * `setCellColors`) and an empty `changes`.
 */
import type { CellChange, CellColor, CellColorChange, ChangeBatch } from "../internal/core";

export interface UndoRedoResult {
  changes: CellChange[];
  source: "undo" | "redo";
  /** v0.4: set for a paint entry — the colors to write (`changes` is then empty). */
  colors?: CellColorChange[];
}

/** v0.4: one painted cell as recorded for undo: its color before and after the paint. */
export interface ColorUndoChange {
  rowId: string;
  columnId: string;
  prev: CellColor | null;
  next: CellColor | null;
}

export interface UndoStack {
  /** Record a batch that was actually applied. Batches sourced from undo/redo, or with no applied changes, are ignored. */
  record(batch: ChangeBatch, applied: CellChange[]): void;
  /** v0.4: record one applied paint (manual colors). Empty lists are ignored. */
  recordColors(applied: ColorUndoChange[]): void;
  undo(): UndoRedoResult | null;
  redo(): UndoRedoResult | null;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export interface UndoStackOptions {
  cap?: number;
}

type Entry = { applied: CellChange[] } | { colors: ColorUndoChange[] };

export function invertChanges(changes: readonly CellChange[]): CellChange[] {
  return changes.map((c) => ({ rowId: c.rowId, columnId: c.columnId, prev: c.next, next: c.prev }));
}

function colorsOf(changes: readonly ColorUndoChange[], side: "prev" | "next"): CellColorChange[] {
  return changes.map((c) => ({ rowId: c.rowId, columnId: c.columnId, color: c[side] }));
}

export function createUndoStack(options: UndoStackOptions = {}): UndoStack {
  const cap = options.cap ?? 100;
  let undoEntries: Entry[] = [];
  let redoEntries: Entry[] = [];

  const push = (entry: Entry): void => {
    undoEntries.push(entry);
    if (undoEntries.length > cap) undoEntries = undoEntries.slice(undoEntries.length - cap);
    redoEntries = [];
  };

  const record = (batch: ChangeBatch, applied: CellChange[]): void => {
    if (batch.source === "undo" || batch.source === "redo") return;
    if (applied.length === 0) return;
    push({ applied });
  };

  const recordColors = (applied: ColorUndoChange[]): void => {
    if (applied.length === 0) return;
    push({ colors: applied.slice() });
  };

  const undo = (): UndoRedoResult | null => {
    const entry = undoEntries.pop();
    if (!entry) return null;
    redoEntries.push(entry);
    if ("colors" in entry) return { changes: [], colors: colorsOf(entry.colors, "prev"), source: "undo" };
    return { changes: invertChanges(entry.applied), source: "undo" };
  };

  const redo = (): UndoRedoResult | null => {
    const entry = redoEntries.pop();
    if (!entry) return null;
    undoEntries.push(entry);
    if (undoEntries.length > cap) undoEntries = undoEntries.slice(undoEntries.length - cap);
    if ("colors" in entry) return { changes: [], colors: colorsOf(entry.colors, "next"), source: "redo" };
    return { changes: entry.applied.slice(), source: "redo" };
  };

  const canUndo = (): boolean => undoEntries.length > 0;
  const canRedo = (): boolean => redoEntries.length > 0;

  const clear = (): void => {
    undoEntries = [];
    redoEntries = [];
  };

  return { record, recordColors, undo, redo, canUndo, canRedo, clear };
}
