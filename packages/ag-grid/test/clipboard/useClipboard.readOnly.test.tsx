/** C3: read-only enforcement for paste (settable:false, permissions, controller rejections). */
import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ClipboardReport } from "../../src/clipboard/types";
import { pasteOutcomeCounts } from "../../src/clipboard/useClipboard";
import { READ_ONLY_MESSAGE, type SubmitOutcome } from "../../src/editing/editController";
import type { ChangeBatch, GridSchema } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { AGENT, fixtureRows, fixtureSchema } from "../fixtures/schema";
import { renderGrid, type RenderGridResult } from "../renderGrid";

type Clip = { readText: ReturnType<typeof vi.fn> };
const clip = (): Clip => navigator.clipboard as unknown as Clip;
const ctrl = (key: string) => ({ key, ctrlKey: true, metaKey: true });

function root(g: RenderGridResult): HTMLElement {
  const el = g.container.querySelector(".sg-root");
  if (!el) throw new Error("no .sg-root");
  return el as HTMLElement;
}

function select(g: RenderGridResult, rowIndex: number, colId: string): void {
  const stores = g.handle.current?.stores;
  if (!stores) throw new Error("no stores");
  act(() => {
    stores.range.setAnchor({ rowIndex, colId });
    stores.range.setFocus({ rowIndex, colId });
  });
}

function batches(g: RenderGridResult): ChangeBatch[] {
  return g.ds.calls.applyChanges.mock.calls.map((c) => c[0] as ChangeBatch);
}

const notesUnsettable: GridSchema = {
  ...fixtureSchema,
  columns: fixtureSchema.columns.map((c) => (c.id === "notes" ? { ...c, settable: false } : c)),
};

describe("paste read-only enforcement (C3)", () => {
  it("paste over a settable:false column skips it and counts it as skippedReadOnly", async () => {
    const onClipboardReport = vi.fn<(r: ClipboardReport) => void>();
    const ds = createInMemoryDataSource(notesUnsettable, fixtureRows);
    const g = renderGrid({ ds, props: { schema: notesUnsettable, onClipboardReport } });
    await g.waitForRows();
    clip().readText.mockResolvedValue("X\tn1\t42");
    select(g, 0, "name");
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    expect(onClipboardReport).toHaveBeenCalledWith({ pastedCells: 2, skippedReadOnly: 1, conflicts: 0, errors: [], rejected: 0 });
    expect(batches(g)).toHaveLength(1);
    expect(batches(g)[0]?.changes.map((c) => c.columnId)).toEqual(["name", "score"]);
    expect(ds.rows().find((r) => r.id === "r1")?.cells.notes).not.toBe("n1");
  });

  it("paste over a permission read-only column (agent → status) is skipped, editable neighbours pasted", async () => {
    const onClipboardReport = vi.fn<(r: ClipboardReport) => void>();
    const g = renderGrid({ user: AGENT, props: { onClipboardReport } });
    await g.waitForRows();
    // AGENT displayed tail: …, program, total (formula), status (read-only); salary is hidden.
    clip().readText.mockResolvedValue("x\t1\tY");
    select(g, 0, "total");
    fireEvent.keyDown(root(g), ctrl("v"));
    await waitFor(() => expect(onClipboardReport).toHaveBeenCalledTimes(1));
    const report = onClipboardReport.mock.calls[0]?.[0];
    expect(report?.skippedReadOnly).toBe(2);
    expect(batches(g).flatMap((b) => b.changes.map((c) => c.columnId))).not.toContain("status");
    expect(batches(g).flatMap((b) => b.changes.map((c) => c.columnId))).not.toContain("salary");
  });
});

describe("pasteOutcomeCounts", () => {
  const outcome = (o: Partial<SubmitOutcome> & Pick<SubmitOutcome, "result">): SubmitOutcome => ({
    batch: { id: "b", changes: [], baseVersions: {}, source: "paste" },
    vetoed: false,
    ...o,
  });

  it("moves controller read-only rejections into skippedReadOnly, not errors", () => {
    const counts = pasteOutcomeCounts(
      outcome({
        result: {
          applied: [{ rowId: "r1", columnId: "name", prev: "a", next: "b" }],
          conflicts: [],
          errors: [
            { rowId: "r1", columnId: "status", message: READ_ONLY_MESSAGE },
            { rowId: "r1", columnId: "score", message: "Too big" },
          ],
        },
        readOnly: [{ rowId: "r1", columnId: "status" }],
      }),
    );
    expect(counts).toEqual({
      pastedCells: 1,
      conflicts: 0,
      skippedReadOnly: 1,
      errors: [{ rowId: "r1", columnId: "score", message: "Too big" }],
      rejected: 0,
    });
  });

  it("a server error that happens to say 'Read-only' stays an error when the controller didn't reject it", () => {
    const counts = pasteOutcomeCounts(
      outcome({ result: { applied: [], conflicts: [], errors: [{ rowId: "r1", columnId: "x", message: "Read-only" }] } }),
    );
    expect(counts.skippedReadOnly).toBe(0);
    expect(counts.errors).toHaveLength(1);
  });

  it("a veto pastes nothing but still counts read-only rejections", () => {
    const counts = pasteOutcomeCounts(
      outcome({
        vetoed: true,
        result: { applied: [], conflicts: [], errors: [{ rowId: "r1", columnId: "status", message: "Read-only" }] },
        readOnly: [{ rowId: "r1", columnId: "status" }],
      }),
    );
    expect(counts).toEqual({ pastedCells: 0, conflicts: 0, skippedReadOnly: 1, errors: [], rejected: 0 });
  });

  it("v0.3: silently rejected cells are counted apart from errors and read-only skips", () => {
    const counts = pasteOutcomeCounts(
      outcome({
        vetoed: false,
        result: {
          applied: [{ rowId: "r1", columnId: "name", prev: "a", next: "b" }],
          conflicts: [],
          errors: [],
          rejected: [
            { rowId: "r2", columnId: "name", prev: "a", next: "b" },
            { rowId: "r2", columnId: "name", prev: "b", next: "c" },
            { rowId: "r3", columnId: "name", prev: "a", next: "b" },
          ],
        },
        readOnly: [],
      }),
    );
    expect(counts).toEqual({ pastedCells: 1, conflicts: 0, skippedReadOnly: 0, errors: [], rejected: 2 });
  });
});
