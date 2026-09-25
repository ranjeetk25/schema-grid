import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { SchemaGrid, type SchemaGridHandle } from "../../src/grid/SchemaGrid";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import type { ValueGetterParams } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";
import { compileColumns } from "../../src/compile/compileColumns";
import {
  ADD_COLUMN_ID,
  DRAFT_COLUMN_ID,
  type DraftColumn,
  ghostTargetIndex,
  isSyntheticColumnId,
  resolveInsertIndex,
} from "../../src/compile/syntheticColumns";
import { createDefaultUiRegistry } from "../../src/compile/uiRegistry";
import { captureViewState } from "../../src/views/viewState";
import { createQueryStore } from "../../src/state/queryStore";
import { type Access, createDefaultRegistry, type GridRow, type ViewDef } from "../../src/internal/core";
import { createFakeGridApi } from "../fixtures/fakeGridApi";
import { ADMIN, col, fixtureRows, fixtureSchema, row } from "../fixtures/schema";
import { renderGrid, TEST_GRID_OPTIONS } from "../renderGrid";

const registry = createDefaultRegistry();
const ui = createDefaultUiRegistry();
const allEdit = new Map<string, Access>(fixtureSchema.columns.map((c) => [c.id, "edit"]));
const ids = (defs: { colId?: string }[]) => defs.map((d) => d.colId);
const value = (def: { valueGetter?: unknown }, data: GridRow) =>
  (def.valueGetter as (p: ValueGetterParams<GridRow>) => unknown)({ data } as ValueGetterParams<GridRow>);

function draft(overrides: Partial<DraftColumn> = {}, column: Partial<Parameters<typeof col>[0]> = {}): DraftColumn {
  return { mode: "create", column: col({ id: "tmp", type: "text", label: "Priority", ...column }), ...overrides };
}

describe("resolveInsertIndex", () => {
  const list = ["a", "b", "c"];
  it("handles numbers (clamped), after/before ids and the default end", () => {
    expect(resolveInsertIndex(list, undefined)).toBe(3);
    expect(resolveInsertIndex(list, 1)).toBe(1);
    expect(resolveInsertIndex(list, -4)).toBe(0);
    expect(resolveInsertIndex(list, 99)).toBe(3);
    expect(resolveInsertIndex(list, { afterColumnId: "a" })).toBe(1);
    expect(resolveInsertIndex(list, { beforeColumnId: "c" })).toBe(2);
    expect(resolveInsertIndex(list, { afterColumnId: "zzz" })).toBe(3);
  });
});

describe("ghostTargetIndex", () => {
  const all = ["a", "hiddenB", "c", ADD_COLUMN_ID];
  const shown = ["a", "c"];
  it("places after/before ids, at the n-th displayed column, and defaults to just before the + column", () => {
    expect(ghostTargetIndex(all, shown, undefined)).toBe(3);
    expect(ghostTargetIndex(["a", "c"], shown, undefined)).toBe(2);
    expect(ghostTargetIndex(all, shown, { afterColumnId: "a" })).toBe(1);
    expect(ghostTargetIndex(all, shown, { beforeColumnId: "c" })).toBe(2);
    expect(ghostTargetIndex(all, shown, 1)).toBe(2);
    expect(ghostTargetIndex(all, shown, 9)).toBe(3);
  });
});

describe("compileColumns draft + add column", () => {
  it("inserts a read-only ghost column at the insertion point, before the + column", () => {
    const base = ids(compileColumns(fixtureSchema, allEdit, registry, ui));
    const defs = compileColumns(fixtureSchema, allEdit, registry, ui, {
      draft: draft({ insertAt: { afterColumnId: "name" } }),
      addColumn: true,
    });
    const at = base.indexOf("name") + 1;
    expect(ids(defs)[at]).toBe(DRAFT_COLUMN_ID);
    expect(ids(defs).at(-1)).toBe(ADD_COLUMN_ID);
    const ghost = defs[at];
    expect(ghost?.headerName).toBe("Priority");
    expect(ghost?.editable).toBe(false);
    expect(ghost?.headerClass).toBe("sg-header-ghost");
    expect(ghost?.cellClass).toBe("sg-cell-ghost");
    expect(ghost?.suppressNavigable).toBe(true);
    const end = compileColumns(fixtureSchema, allEdit, registry, ui, { draft: draft() });
    expect(ids(end).at(-1)).toBe(DRAFT_COLUMN_ID);
    expect(ids(compileColumns(fixtureSchema, allEdit, registry, ui, { draft: draft({ insertAt: 0 }) }))[0]).toBe(DRAFT_COLUMN_ID);
  });

  it("labels an unnamed ghost 'New column' and shows the default value or the live formula result", () => {
    const blank = compileColumns(fixtureSchema, allEdit, registry, ui, {
      draft: draft({}, { label: "  ", defaultValue: "High" }),
    }).find((d) => d.colId === DRAFT_COLUMN_ID);
    expect(blank?.headerName).toBe("New column");
    expect(value(blank ?? {}, row("r1", {}))).toBe("High");

    const formula = compileColumns(fixtureSchema, allEdit, registry, ui, {
      draft: draft({}, { type: "formula", formula: "{score} * 10", config: { resultType: "number" } }),
    }).find((d) => d.colId === DRAFT_COLUMN_ID);
    expect(value(formula ?? {}, row("r1", { score: 4 }))).toBe(40);
  });

  it("edit mode renders the real column with the draft's label/config (same id, no ghost)", () => {
    const edited = { ...col({ id: "name", type: "text", label: "Full name" }) };
    const defs = compileColumns(fixtureSchema, allEdit, registry, ui, { draft: { mode: "edit", column: edited } });
    expect(ids(defs)).not.toContain(DRAFT_COLUMN_ID);
    expect(defs.find((d) => d.colId === "name")?.headerName).toBe("Full name");

    const formulaEdit = compileColumns(fixtureSchema, allEdit, registry, ui, {
      draft: { mode: "edit", column: col({ id: "total", type: "formula", label: "Total", formula: "{score} * 3", config: { resultType: "number" } }) },
    }).find((d) => d.colId === "total");
    expect(value(formulaEdit ?? {}, row("r1", { score: 2 }))).toBe(6);
  });

  it("adds the + column only when asked", () => {
    expect(ids(compileColumns(fixtureSchema, allEdit, registry, ui))).not.toContain(ADD_COLUMN_ID);
    const add = compileColumns(fixtureSchema, allEdit, registry, ui, { addColumn: true }).at(-1);
    expect(add?.colId).toBe(ADD_COLUMN_ID);
    expect(add?.width).toBe(44);
    expect(add?.suppressNavigable).toBe(true);
  });
});

describe("synthetic columns are never captured into views", () => {
  it("captureViewState skips __sg_draft__ and __sg_add__", () => {
    const { api } = createFakeGridApi({
      columns: [{ colId: "name" }, { colId: DRAFT_COLUMN_ID }, { colId: ADD_COLUMN_ID }],
    });
    const base: ViewDef = { id: "v", name: "v", filter: null, sort: [], columnState: [], groupBy: [], pageSize: 50 };
    const view = captureViewState(api, { query: createQueryStore() }, base);
    expect(view.columnState.map((c) => c.id)).toEqual(["name"]);
    expect(isSyntheticColumnId(DRAFT_COLUMN_ID) && isSyntheticColumnId(ADD_COLUMN_ID)).toBe(true);
    expect(isSyntheticColumnId("name")).toBe(false);
  });
});

describe("mounted grid", () => {
  it("renders the ghost header, the + button calls onAddColumn, and captureView ignores both", async () => {
    const onAddColumn = vi.fn();
    const { container, handle, settle } = renderGrid({
      props: { draftColumn: draft({ insertAt: { afterColumnId: "name" } }), onAddColumn },
    });
    await waitFor(() => expect(container.querySelector(`.ag-header-cell[col-id="${DRAFT_COLUMN_ID}"]`)).not.toBeNull());
    await settle();
    const texts = [...container.querySelectorAll(".ag-header-cell-text")].map((e) => e.textContent);
    expect(texts).toContain("Priority");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add column at end" }));
    });
    expect(onAddColumn).toHaveBeenCalledTimes(1);
    const position = onAddColumn.mock.calls[0]?.[0] as { index: number; afterColumnId?: string };
    expect(position.afterColumnId).toBeDefined();
    expect(isSyntheticColumnId(position.afterColumnId)).toBe(false);
    const view = handle.current?.captureView();
    expect(view?.columnState.some((c) => isSyntheticColumnId(c.id))).toBe(false);
  });

  it("moves the ghost to its insertion point despite maintainColumnOrder (and follows insertAt changes)", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const handle = createRef<SchemaGridHandle<GridRow>>();
    const el = (d: DraftColumn) => (
      <div style={{ width: 1600, height: 800 }}>
        <SchemaGrid<GridRow> ref={handle} schema={fixtureSchema} dataSource={ds} user={ADMIN} draftColumn={d} gridOptions={TEST_GRID_OPTIONS} />
      </div>
    );
    const order = () => (handle.current?.api()?.getAllGridColumns() ?? []).map((c) => c.getColId());
    const { rerender } = render(el(draft({ insertAt: { afterColumnId: "name" } })));
    await waitFor(() => {
      const ids = order();
      expect(ids[ids.indexOf("name") + 1]).toBe(DRAFT_COLUMN_ID);
    });
    rerender(el(draft({ insertAt: { afterColumnId: "score" } })));
    await waitFor(() => {
      const ids = order();
      expect(ids[ids.indexOf("score") + 1]).toBe(DRAFT_COLUMN_ID);
    });
  });
});
