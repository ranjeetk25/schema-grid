import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolvePopupParent, type SchemaGridProps, useSchemaGrid } from "../../src/grid/useSchemaGrid";
import type { GridRow } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { ADMIN, fixtureRows, fixtureSchema } from "../fixtures/schema";

function props(overrides: Partial<SchemaGridProps<GridRow>> = {}): SchemaGridProps<GridRow> {
  return { schema: fixtureSchema, dataSource: createInMemoryDataSource(fixtureSchema, fixtureRows), user: ADMIN, ...overrides };
}

describe("column filter popups", () => {
  it("filter changes never recompile columnDefs (AG Grid would rebuild the open filter)", () => {
    const p = props();
    const { result } = renderHook(() => useSchemaGrid(p));
    const before = result.current.gridProps.columnDefs;
    act(() => {
      result.current.stores.query.setFilter({ columnId: "payment", operator: "isAnyOf", value: ["paid"] });
    });
    expect(result.current.gridProps.columnDefs).toBe(before);
  });
});

describe("popupParent", () => {
  it("resolves undefined → document.body, null → AG Grid's default, element → itself", () => {
    const el = document.createElement("div");
    expect(resolvePopupParent(undefined)).toBe(document.body);
    expect(resolvePopupParent(null)).toBeUndefined();
    expect(resolvePopupParent(el)).toBe(el);
  });

  it("defaults gridProps.popupParent to document.body so popups are never cropped", () => {
    const p = props();
    const { result } = renderHook(() => useSchemaGrid(p));
    expect(result.current.gridProps.popupParent).toBe(document.body);
  });

  it("honours the popupParent prop, null, and a gridOptions.popupParent (which wins)", () => {
    const mine = document.createElement("div");
    const theirs = document.createElement("section");
    const a = props({ popupParent: mine });
    expect(renderHook(() => useSchemaGrid(a)).result.current.gridProps.popupParent).toBe(mine);
    const b = props({ popupParent: null });
    expect(renderHook(() => useSchemaGrid(b)).result.current.gridProps.popupParent).toBeUndefined();
    const c = props({ popupParent: mine, gridOptions: { popupParent: theirs } });
    expect(renderHook(() => useSchemaGrid(c)).result.current.gridProps.popupParent).toBe(theirs);
  });
});
