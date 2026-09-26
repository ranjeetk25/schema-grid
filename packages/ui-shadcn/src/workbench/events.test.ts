import type { SchemaGridEvents } from "@ranjeetk25/schema-grid-ag-grid";
import type { ChangeBatch, ChangeResult } from "@ranjeetk25/schema-grid-core";
import { describe, expect, it, vi } from "vitest";
import { combineHostEvents, mergeWorkbenchEvents } from "./events";

const batch: ChangeBatch = {
  id: "b1",
  changes: [
    { rowId: "r1", columnId: "c1", prev: 1, next: 2 },
    { rowId: "r1", columnId: "c2", prev: "a", next: "b" },
  ],
  baseVersions: { r1: 1 },
  source: "edit",
};
const result: ChangeResult = { applied: [], conflicts: [], errors: [] };

describe("mergeWorkbenchEvents", () => {
  it("returns the internal events untouched without a host", () => {
    const internal: SchemaGridEvents = { onCellsChange: vi.fn() };
    expect(mergeWorkbenchEvents(undefined, internal)).toBe(internal);
  });

  it("fans out to the host first, then the internal handler", () => {
    const order: string[] = [];
    const merged = mergeWorkbenchEvents(
      { onCellsChange: () => order.push("host"), onViewChange: () => order.push("host-view") },
      { onCellsChange: () => order.push("internal") },
    );
    merged.onCellsChange?.(result, batch);
    merged.onViewChange?.({ id: "v", name: "V", filter: null, sort: [], columnState: [], groupBy: [], pageSize: 50 });
    expect(order).toEqual(["host", "internal", "host-view"]);
  });

  it("a throwing host handler does not stop the internal one and is reported", () => {
    const internal = vi.fn();
    const onHostError = vi.fn();
    const merged = mergeWorkbenchEvents(
      {
        onCellsChange: () => {
          throw new Error("boom");
        },
      },
      { onCellsChange: internal },
      { onHostError },
    );
    merged.onCellsChange?.(result, batch);
    expect(internal).toHaveBeenCalledWith(result, batch);
    expect(onHostError).toHaveBeenCalledWith(expect.any(Error), "onCellsChange");
  });

  it("chains beforeCellsChange host → internal, preserving a reduced batch and its meta", async () => {
    const internalBefore = vi.fn(async (b: ChangeBatch) => b);
    const merged = mergeWorkbenchEvents(
      {
        beforeCellsChange: (b) => ({
          ...b,
          changes: [{ ...(b.changes[0] as ChangeBatch["changes"][number]), meta: { decisionMessage: "why" } }],
          meta: { reuploadDeadline: "2026-10-01" },
        }),
      },
      { beforeCellsChange: internalBefore },
    );
    const decided = await merged.beforeCellsChange?.(batch);
    expect(internalBefore).toHaveBeenCalledTimes(1);
    expect(decided).toMatchObject({
      meta: { reuploadDeadline: "2026-10-01" },
      changes: [{ columnId: "c1", meta: { decisionMessage: "why" } }],
    });
    expect((decided as ChangeBatch).changes).toHaveLength(1);
  });

  it("a host veto short-circuits: the internal hook never runs", async () => {
    const internalBefore = vi.fn(async (b: ChangeBatch) => b);
    const merged = mergeWorkbenchEvents({ beforeCellsChange: () => false }, { beforeCellsChange: internalBefore });
    expect(await merged.beforeCellsChange?.(batch)).toBe(false);
    expect(internalBefore).not.toHaveBeenCalled();
  });

  it("a host hook returning undefined passes the original batch on", async () => {
    const merged = mergeWorkbenchEvents({ beforeCellsChange: () => undefined as never }, {});
    expect(await merged.beforeCellsChange?.(batch)).toBe(batch);
  });
});

describe("combineHostEvents", () => {
  it("lets the events prop win over gridProps.events per handler", () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const combined = combineHostEvents({ onCellsChange: a }, { onCellsChange: b, onViewChange: c });
    expect(combined?.onCellsChange).toBe(a);
    expect(combined?.onViewChange).toBe(c);
    expect(combineHostEvents(undefined, { onViewChange: c })?.onViewChange).toBe(c);
    expect(combineHostEvents(undefined, undefined)).toBeUndefined();
  });
});
