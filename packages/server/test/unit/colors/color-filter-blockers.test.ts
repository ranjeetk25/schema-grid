/**
 * v0.4.1 F2: a color rule whose `when` tests a column the server can't filter
 * on (a SQL-view computed column, `filterable: false`) makes `colorIs` on the
 * columns it colors impossible to compile. The server answers a clear 400
 * `FILTER_INVALID` instead of a misleading "cannot be filtered".
 */
import { sql } from "drizzle-orm";
import { int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import type { GridDb } from "../../../src/changes/db";
import { withServerErrorMapping } from "../../../src/http/adapter";
import {
  type ColorRule,
  type GridSchema,
  createDataSourceHandler,
  createRolePermissionResolver,
} from "../../../src/internal/core";
import { createSqlViewDataSource } from "../../../src/sqlview/create-sql-view-data-source";
import { createFakeMysql } from "../../helpers/fake-mysql";
import { col } from "../../helpers/schemas";

const leads = mysqlTable("leads", {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  notes: varchar("notes", { length: 100 }),
});

const schema: GridSchema = {
  id: "leads",
  schemaVersion: 1,
  columns: [
    col("name", "text", { label: "Name" }),
    col("notes", "text", { label: "Notes", filterable: false }),
    col("verdict", "text", { label: "Verdict" }),
  ],
};

function make() {
  const fake = createFakeMysql((c) => (c.rowsAsArray ? [] : undefined));
  const ds = createSqlViewDataSource({
    db: fake.db as unknown as GridDb,
    schema,
    resolver: createRolePermissionResolver(),
    user: { id: "u1", roles: ["admin"] },
    baseQuery: () => sql`SELECT * FROM leads`,
    columns: {
      name: { expr: leads.name },
      notes: { expr: leads.notes },
      verdict: { compute: (row) => (row.cells.name ? "pass" : "fail") },
    },
    rowId: leads.id,
  });
  return { ds, handle: createDataSourceHandler(ds, withServerErrorMapping()), statements: fake.statements };
}

const page = { offset: 0, limit: 10 } as const;
const cells = (id: string, target: string, when: ColorRule["when"]): ColorRule => ({
  id,
  color: "red",
  target: { kind: "cells", columnIds: [target] },
  when,
});

describe("colorIs through rules the server can't evaluate (F2)", () => {
  it("a cells rule on the computed `verdict` testing `verdict` → 400 FILTER_INVALID naming both labels", async () => {
    const { handle, statements } = make();
    const res = await handle("fetch", {
      filter: { columnId: "verdict", operator: "colorIs", value: ["red"] },
      sort: [],
      page,
      colorRules: [cells("r1", "verdict", { columnId: "verdict", operator: "is", value: "pass" })],
    });
    expect(res).toEqual({
      ok: false,
      status: 400,
      error: expect.objectContaining({
        code: "FILTER_INVALID",
        message: `Can't filter "Verdict" by color: a color rule on it uses "Verdict", which can't be filtered on the server`,
      }),
    });
    expect(statements()).toHaveLength(0);
  });

  it("a row rule testing a filterable:false column blocks every column; the first offending column is named", async () => {
    const { handle } = make();
    const res = await handle("fetch", {
      filter: { columnId: "name", operator: "colorIsNone" },
      sort: [],
      page,
      colorRules: [
        {
          id: "r1",
          color: "blue",
          target: { kind: "row" },
          when: { op: "and", children: [{ columnId: "notes", operator: "isNotEmpty" }, { columnId: "verdict", operator: "isEmpty" }] },
        },
      ],
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.message).toBe(
      `Can't filter "Name" by color: a color rule on it uses "Notes", which can't be filtered on the server`,
    );
  });

  it("rules that can't color the filtered column are ignored; a rule on a filterable column compiles", async () => {
    const { handle, statements } = make();
    const res = await handle("fetch", {
      filter: { columnId: "name", operator: "colorIs", value: ["red"] },
      sort: [],
      page,
      colorRules: [
        cells("r1", "verdict", { columnId: "verdict", operator: "is", value: "pass" }),
        { ...cells("r2", "name", { columnId: "verdict", operator: "is", value: "x" }), enabled: false },
        cells("r3", "name", { columnId: "name", operator: "is", value: "Asha" }),
      ],
    });
    expect(res.ok).toBe(true);
    const q = statements()[0]?.sql ?? "";
    expect(q).toContain("COALESCE(CASE WHEN");
    expect(q).toContain("THEN 'red' END IN ('red'), FALSE)");
  });

  it("without a color condition the rules are ignored (not even validated)", async () => {
    const { handle } = make();
    const res = await handle("fetch", {
      filter: null,
      sort: [],
      page,
      colorRules: [cells("r1", "verdict", { columnId: "verdict", operator: "is", value: "pass" })],
    });
    expect(res.ok).toBe(true);
  });
});
