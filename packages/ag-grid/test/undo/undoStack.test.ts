import { describe, expect, it } from "vitest";
import { createUndoStack, invertChanges } from "../../src/undo/undoStack";
import type { CellChange, ChangeBatch } from "../../src/internal/core";

function batch(id: string, changes: CellChange[], source: ChangeBatch["source"] = "edit"): ChangeBatch {
  return { id, changes, baseVersions: {}, source };
}

function change(rowId: string, columnId: string, prev: unknown, next: unknown): CellChange {
  return { rowId, columnId, prev, next };
}

describe("invertChanges", () => {
  it("swaps prev and next for every change", () => {
    const changes = [change("r1", "a", 1, 2), change("r1", "b", "x", "y")];
    expect(invertChanges(changes)).toEqual([change("r1", "a", 2, 1), change("r1", "b", "y", "x")]);
  });
});

describe("createUndoStack", () => {
  it("undo and redo round-trip", () => {
    const stack = createUndoStack();
    const applied = [change("r1", "a", 1, 2)];
    stack.record(batch("b1", applied), applied);

    const undone = stack.undo();
    expect(undone).toEqual({ changes: [change("r1", "a", 2, 1)], source: "undo" });

    const redone = stack.redo();
    expect(redone).toEqual({ changes: [change("r1", "a", 1, 2)], source: "redo" });
  });

  it("undo/redo return null when there is nothing to do", () => {
    const stack = createUndoStack();
    expect(stack.undo()).toBeNull();
    expect(stack.redo()).toBeNull();
  });

  it("a new record clears redo", () => {
    const stack = createUndoStack();
    const applied1 = [change("r1", "a", 1, 2)];
    stack.record(batch("b1", applied1), applied1);
    stack.undo();
    expect(stack.canRedo()).toBe(true);

    const applied2 = [change("r2", "b", 3, 4)];
    stack.record(batch("b2", applied2), applied2);

    expect(stack.canRedo()).toBe(false);
    expect(stack.redo()).toBeNull();
  });

  it("the cap drops the oldest entry at 101", () => {
    const stack = createUndoStack();
    for (let i = 0; i < 101; i++) {
      const applied = [change(`r${i}`, "a", i, i + 1)];
      stack.record(batch(`b${i}`, applied), applied);
    }

    // Undo 100 times (the cap), the 101st undo should be null because the
    // oldest entry (b0) was dropped.
    for (let i = 0; i < 100; i++) {
      expect(stack.undo()).not.toBeNull();
    }
    expect(stack.undo()).toBeNull();
  });

  it("respects a custom cap", () => {
    const stack = createUndoStack({ cap: 2 });
    for (let i = 0; i < 3; i++) {
      const applied = [change(`r${i}`, "a", i, i + 1)];
      stack.record(batch(`b${i}`, applied), applied);
    }
    expect(stack.undo()).not.toBeNull();
    expect(stack.undo()).not.toBeNull();
    expect(stack.undo()).toBeNull();
  });

  it("a multi-cell batch undoes as one unit", () => {
    const stack = createUndoStack();
    const applied = [change("r1", "a", 1, 2), change("r1", "b", "x", "y"), change("r2", "a", 5, 6)];
    stack.record(batch("b1", applied), applied);

    const undone = stack.undo();
    expect(undone?.changes).toHaveLength(3);
    expect(undone?.source).toBe("undo");
    expect(stack.canUndo()).toBe(false);
  });

  it("an empty applied batch is not recorded", () => {
    const stack = createUndoStack();
    stack.record(batch("b1", []), []);
    expect(stack.canUndo()).toBe(false);
    expect(stack.undo()).toBeNull();
  });

  it("never records batches whose source is undo or redo", () => {
    const stack = createUndoStack();
    const undoApplied = [change("r1", "a", 2, 1)];
    stack.record(batch("b-undo", undoApplied, "undo"), undoApplied);
    expect(stack.canUndo()).toBe(false);

    const redoApplied = [change("r1", "a", 1, 2)];
    stack.record(batch("b-redo", redoApplied, "redo"), redoApplied);
    expect(stack.canUndo()).toBe(false);
  });

  it("clear empties both stacks", () => {
    const stack = createUndoStack();
    const applied = [change("r1", "a", 1, 2)];
    stack.record(batch("b1", applied), applied);
    stack.undo();
    expect(stack.canRedo()).toBe(true);

    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });
});
