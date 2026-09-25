import { describe, expect, it } from "vitest";
import { createServerContext, type ServerWarning } from "../../../src/context";
import { FormulaQueryLimitError, PermissionError } from "../../../src/errors";
import { splitFilterForPushdown } from "../../../src/formula/fallback";
import { planFormulaColumns } from "../../../src/formula/formula-plan";
import {
  type FilterNode,
  type GridQuery,
  createDefaultRegistry,
  createRolePermissionResolver,
} from "../../../src/internal/core";
import { runRowQuery } from "../../../src/query/run-query";
import { type FakeCall, asRows, createFakeMysql } from "../../helpers/fake-mysql";
import { col, tables } from "../../helpers/schemas";

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("fee", "number"),
    col("isActive", "boolean"),
    col("salary", "number", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
    // boolean refs are not SQL-translatable → fallback; the temporary shim evaluator handles IF + refs
    col("activeFee", "formula", { formula: "IF({isActive}, {fee}, 0)", config: { resultType: "number" } }),
    col("balance", "formula", { formula: "{fee} * 2", config: { resultType: "number" } }),
  ],
};
const PROJ_ORDER = ["id", "version", "updatedAt", "updatedBy", "cells"];
const dbRows = [
  { id: "a", version: 1, updatedAt: "2026-09-24 00:00:00.000", updatedBy: null, cells: { name: "A", fee: 10, isActive: true } },
  { id: "b", version: 1, updatedAt: "2026-09-24 00:00:00.000", updatedBy: null, cells: { name: "B", fee: 30, isActive: true } },
  { id: "c", version: 1, updatedAt: "2026-09-24 00:00:00.000", updatedBy: null, cells: { name: "C", fee: 50, isActive: false } },
];

function setup(opts: { cap?: number; roles?: string[] } = {}) {
  const warnings: ServerWarning[] = [];
  const ctx = createServerContext({
    schema,
    registry: createDefaultRegistry(),
    resolver: createRolePermissionResolver(),
    user: { id: "u", roles: opts.roles ?? ["admin"] },
    onWarning: (w) => warnings.push(w),
    ...(opts.cap ? { formulaFallbackRowCap: opts.cap } : {}),
  });
  const { db, statements } = createFakeMysql((c) => (c.rowsAsArray ? asRows(dbRows, PROJ_ORDER) : undefined));
  const scope = { ctx, tables, generatedColumns: "assumePresent" as const, gridId: "grid1" };
  return { ctx, db, statements, scope, warnings };
}
const q = (partial: Partial<GridQuery>): GridQuery => ({ filter: null, sort: [], page: { offset: 0, limit: 10 }, ...partial });

describe("splitFilterForPushdown", () => {
  const { scope } = setup();
  const plans = planFormulaColumns(scope);
  const onFormula: FilterNode = { columnId: "activeFee", operator: "gt", value: 5 };
  const onName: FilterNode = { columnId: "name", operator: "contains", value: "a" };
  it("root AND pushes down the non-formula children", () => {
    expect(plans.get("activeFee")?.mode).toBe("fallback");
    expect(splitFilterForPushdown({ op: "and", children: [onName, onFormula] }, plans)).toEqual({
      sqlPart: { op: "and", children: [onName] },
      memoryPart: onFormula,
    });
  });
  it("OR keeps everything in memory", () => {
    const f: FilterNode = { op: "or", children: [onName, onFormula] };
    expect(splitFilterForPushdown(f, plans)).toEqual({ sqlPart: null, memoryPart: f });
  });
  it("filters without fallback formulas stay in SQL", () => {
    expect(splitFilterForPushdown(onName, plans)).toEqual({ sqlPart: onName, memoryPart: null });
  });
});

describe("runRowQuery fallback path", () => {
  it("AND: pushes the sibling to SQL, filters the formula in memory, warns once", async () => {
    const { db, statements, scope, warnings } = setup();
    const res = await runRowQuery(
      q({
        filter: {
          op: "and",
          children: [
            { columnId: "name", operator: "isNotEmpty" },
            { columnId: "activeFee", operator: "gt", value: 15 },
          ],
        },
        sort: [{ columnId: "activeFee", dir: "desc" }],
        includeTotal: true,
      }),
      scope,
      db,
    );
    const sel = statements()[0] as FakeCall;
    expect(sel.sql).toContain("'$.name'");
    expect(sel.sql).not.toContain("activeFee");
    expect(sel.params.at(-1)).toBe(5001);
    expect(res.rows.map((r) => [r.id, r.cells.activeFee])).toEqual([["b", 30]]);
    expect(res.total).toBe(1);
    expect(warnings).toEqual([{ code: "FORMULA_FALLBACK", columnIds: ["activeFee"], rowCap: 5000 }]);
  });

  it("OR: nothing is pushed down", async () => {
    const { db, statements, scope } = setup();
    await runRowQuery(
      q({ filter: { op: "or", children: [{ columnId: "name", operator: "is", value: "A" }, { columnId: "activeFee", operator: "lt", value: 1 }] } }),
      scope,
      db,
    );
    expect((statements()[0] as FakeCall).sql).not.toContain("'$.name')) COLLATE");
  });

  it("more candidates than the cap throws FormulaQueryLimitError", async () => {
    const { db, scope } = setup({ cap: 2 });
    await expect(runRowQuery(q({ sort: [{ columnId: "activeFee", dir: "asc" }] }), scope, db)).rejects.toBeInstanceOf(
      FormulaQueryLimitError,
    );
  });

  it("pages in memory with an offset cursor", async () => {
    const { db, scope } = setup();
    const first = await runRowQuery(q({ sort: [{ columnId: "activeFee", dir: "asc" }], page: { offset: 0, limit: 2 } }), scope, db);
    expect(first.rows.map((r) => r.id)).toEqual(["c", "a"]);
    expect(first.nextCursor).toBeTruthy();
    const second = await runRowQuery(
      q({ sort: [{ columnId: "activeFee", dir: "asc" }], page: { cursor: first.nextCursor as string, limit: 2 } }),
      scope,
      db,
    );
    expect(second.rows.map((r) => r.id)).toEqual(["b"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("permission is checked before the fallback runs", async () => {
    const { db, scope, warnings, statements } = setup({ roles: ["counsellor"] });
    await expect(runRowQuery(q({ sort: [{ columnId: "salary", dir: "asc" }, { columnId: "activeFee", dir: "asc" }] }), scope, db)).rejects.toBeInstanceOf(
      PermissionError,
    );
    expect(warnings).toEqual([]);
    expect(statements()).toHaveLength(0);
  });

  it("a sort on an inline formula uses SQL: no fallback, no warning, formula values on rows", async () => {
    const { db, statements, scope, warnings } = setup();
    const res = await runRowQuery(q({ sort: [{ columnId: "balance", dir: "desc" }] }), scope, db);
    expect((statements()[0] as FakeCall).sql).toContain("order by");
    expect((statements()[0] as FakeCall).sql).toContain("DECIMAL(38,10)");
    expect(warnings).toEqual([]);
    expect(res.rows[0]?.cells.balance).toBe(20);
  });
});
