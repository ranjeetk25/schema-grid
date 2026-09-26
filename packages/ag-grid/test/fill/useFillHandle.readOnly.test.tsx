/** C3: controller read-only rejections are folded into the fill report and announcement. */
import type { CellMouseOverEvent, Column, GridApi } from "ag-grid-community";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type MutableRefObject, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { type FillReport, useFillHandle } from "../../src/fill/useFillHandle";
import { READ_ONLY_MESSAGE, type SubmitOutcome } from "../../src/editing/editController";
import { createDefaultRegistry, type ChangeBatch, type GridRow } from "../../src/internal/core";
import { createRangeStore } from "../../src/state/rangeStore";
import { createFakeGridApi, type FakeColumnSpec } from "../fixtures/fakeGridApi";
import { fixtureSchema, row } from "../fixtures/schema";

const COLS: FakeColumnSpec[] = [{ colId: "name" }, { colId: "score" }, { colId: "status" }];
const ROWS: GridRow[] = [
  row("a", { name: "A", score: 1, status: "s1" }),
  row("b", { name: "B", score: 2, status: "s2" }),
  row("c", { name: "C", score: null, status: null }),
];

function setup(rejectColumn: string) {
  const fake = createFakeGridApi<GridRow>({ columns: COLS, rows: ROWS });
  const rangeStore = createRangeStore();
  const submit = vi.fn(async (changes: ChangeBatch["changes"], source: ChangeBatch["source"]): Promise<SubmitOutcome> => {
    const rejected = changes.filter((c) => c.columnId === rejectColumn);
    const sent = changes.filter((c) => c.columnId !== rejectColumn);
    const batch: ChangeBatch = { id: "b", changes: sent, baseVersions: {}, source };
    return {
      batch,
      vetoed: false,
      readOnly: rejected.map((c) => ({ rowId: c.rowId, columnId: c.columnId })),
      result: {
        applied: sent,
        conflicts: [],
        errors: rejected.map((c) => ({ rowId: c.rowId, columnId: c.columnId, message: READ_ONLY_MESSAGE })),
      },
    };
  });
  const announce = vi.fn();
  const onReport = vi.fn<(r: FillReport) => void>();
  const hook = renderHook(() => {
    const apiRef = useRef<GridApi<GridRow> | null>(fake.api) as MutableRefObject<GridApi<GridRow> | null>;
    return useFillHandle<GridRow>({
      apiRef,
      rangeStore,
      controller: { submit },
      schema: fixtureSchema,
      registry: createDefaultRegistry(),
      canEditCell: () => true,
      announce,
      onReport,
    });
  });
  return { fake, rangeStore, submit, announce, onReport, h: () => hook.result.current };
}

const column = (colId: string) => ({ getColId: () => colId, getId: () => colId }) as unknown as Column;
const over = (api: GridApi<GridRow>, rowIndex: number, colId: string) =>
  ({
    node: api.getDisplayedRowAtIndex(rowIndex),
    column: column(colId),
    event: new MouseEvent("mouseover", { buttons: 1 }),
    api,
  }) as unknown as CellMouseOverEvent<GridRow>;
const pointerDown = () => ({ button: 0, stopPropagation: vi.fn(), preventDefault: vi.fn() });

describe("useFillHandle: controller read-only rejections (C3)", () => {
  it("counts cells the controller rejected as read-only skips, not fills", async () => {
    const { fake, rangeStore, h, announce, onReport } = setup("status");
    act(() => rangeStore.setAnchor({ rowIndex: 0, colId: "score" }));
    act(() => rangeStore.setFocus({ rowIndex: 0, colId: "status" }));
    act(() => h().onFillHandlePointerDown(pointerDown(), { rowIndex: 0, colId: "status" }));
    act(() => h().onCellMouseOver(over(fake.api, 2, "status")));
    act(() => document.dispatchEvent(new Event("pointerup")));
    await waitFor(() =>
      expect(announce).toHaveBeenCalledWith("Fill: 2 cells filled, 2 read-only cells skipped, saved", "polite"),
    );
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith({ axis: "down", filledCells: 2, skippedReadOnly: 2, rejected: 0 });
  });
});
