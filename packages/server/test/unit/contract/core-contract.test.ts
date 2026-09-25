import { describe, expect, expectTypeOf, it } from "vitest";
import * as core from "../../../src/internal/core";
import type {
  Access,
  ActorRef,
  AggregationId,
  CellChange,
  ChangeBatch,
  ChangeFeedEntry,
  ChangeResult,
  ColumnDef,
  ColumnPermissions,
  DataSource,
  FieldType,
  FieldTypeId,
  FieldTypeRegistry,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperatorDef,
  FilterValue,
  GridQuery,
  GridRow,
  GridSchema,
  GroupResult,
  GroupSpec,
  LinkRef,
  Option,
  PermissionContext,
  PermissionResolver,
  QueryResult,
  RelativeDate,
  SortSpec,
  ViewDef,
} from "../../../src/internal/core";
import { SCHEMA_GRID_SERVER_VERSION } from "../../../src/index";

describe("core contract (via src/internal/core.ts)", () => {
  it("loads the package source under the development condition", () => {
    expect(SCHEMA_GRID_SERVER_VERSION).toBe("0.0.1");
    expect(typeof core.resolveRelativeDate).toBe("function");
  });

  it("exposes the §4 type names with the agreed shapes", () => {
    expectTypeOf<GridRow["id"]>().toEqualTypeOf<string>();
    expectTypeOf<GridRow["version"]>().toEqualTypeOf<number>();
    expectTypeOf<{ offset: 0; limit: 10 }>().toMatchTypeOf<GridQuery["page"]>();
    expectTypeOf<{ cursor: "x"; limit: 10 }>().toMatchTypeOf<GridQuery["page"]>();
    expectTypeOf<ColumnPermissions["read"]>().toEqualTypeOf<"all" | { roles: string[] }>();
    expectTypeOf<Access>().toEqualTypeOf<"hidden" | "read" | "edit">();
    expectTypeOf<RelativeDate>().toMatchTypeOf<FilterValue>();
    expectTypeOf<{ me: true }>().toMatchTypeOf<FilterValue>();
    expectTypeOf<FilterGroup>().toMatchTypeOf<FilterNode>();
    expectTypeOf<FilterCondition>().toMatchTypeOf<FilterNode>();
    expectTypeOf<AggregationId>().toMatchTypeOf<string>();
    expectTypeOf<ChangeResult["conflicts"][number]["serverVersion"]>().toEqualTypeOf<number>();
    expectTypeOf<ChangeFeedEntry["deletedRowIds"]>().toEqualTypeOf<string[]>();
    expectTypeOf<QueryResult<GridRow>["groups"]>().toEqualTypeOf<GroupResult[] | undefined>();
    expectTypeOf<DataSource<GridRow>["fetch"]>().parameter(0).toEqualTypeOf<GridQuery>();
    expectTypeOf<PermissionResolver>().parameter(0).toEqualTypeOf<PermissionContext>();
    expectTypeOf<FilterOperatorDef["negative"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<"text">().toMatchTypeOf<FieldTypeId>();
    expectTypeOf<FieldTypeRegistry["get"]>().returns.toMatchTypeOf<FieldType | undefined>();
    expectTypeOf<ColumnDef["source"]>().toEqualTypeOf<{ valueField: string } | undefined>();
    expectTypeOf<ViewDef["sort"]>().toEqualTypeOf<SortSpec[]>();
    expectTypeOf<GroupSpec["columnId"]>().toEqualTypeOf<string>();
    expectTypeOf<ChangeBatch["changes"]>().toEqualTypeOf<CellChange[]>();
    expectTypeOf<ActorRef["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Option["label"]>().toEqualTypeOf<string>();
    expectTypeOf<LinkRef["label"]>().toEqualTypeOf<string>();
    expectTypeOf<GridSchema["columns"]>().toEqualTypeOf<ColumnDef[]>();
  });

  it("temporary shim: negative operators are flagged per spec §4.3", () => {
    const reg = core.createDefaultRegistry();
    const negatives = new Set<string>();
    for (const t of reg.list()) for (const o of t.operators) if (o.negative) negatives.add(o.id);
    expect([...negatives].sort()).toEqual(["hasNoneOf", "isNoneOf", "isNot", "isNotMe", "neq", "notContains"]);
  });

  it("temporary shim: resolveRelativeDate yesterday in Asia/Kolkata", () => {
    const r = core.resolveRelativeDate({ relative: "yesterday" }, new Date("2026-09-25T00:30:00+05:30"), "Asia/Kolkata");
    expect(r).toEqual({ from: "2026-09-23T18:30:00.000Z", to: "2026-09-24T18:30:00.000Z" });
    const w = core.resolveRelativeDate({ relative: "thisWeek" }, new Date("2026-09-27T12:00:00+05:30"), "Asia/Kolkata");
    expect(w).toEqual({ from: "2026-09-20T18:30:00.000Z", to: "2026-09-27T18:30:00.000Z" });
    const n = core.resolveRelativeDate({ relative: "lastNDays", n: 7 }, new Date("2026-09-25T02:30:00+05:30"), "Asia/Kolkata");
    expect(n).toEqual({ from: "2026-09-18T18:30:00.000Z", to: "2026-09-25T18:30:00.000Z" });
    const ny = core.resolveRelativeDate({ relative: "today" }, new Date("2026-11-01T12:00:00-05:00"), "America/New_York");
    expect(ny).toEqual({ from: "2026-11-01T04:00:00.000Z", to: "2026-11-02T05:00:00.000Z" });
  });

  it("temporary shim: parseFormula precedence", () => {
    const ast = core.parseFormula("1 + 2 * 3");
    expect(core.isFormulaError(ast)).toBe(false);
    expect(ast).toMatchObject({ type: "BinaryExpr", op: "+", right: { type: "BinaryExpr", op: "*" } });
    expect(core.isFormulaError(core.parseFormula("1 +"))).toBe(true);
  });
});
