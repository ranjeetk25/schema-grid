import { describe, expect, it } from "vitest";
import { executeQuery } from "../../../src/query/execute-query";
import { buildQuery } from "../../../src/query/build-query";
import { type RowSource, gridRowsSource } from "../../../src/query/row-source";
import type { GridSqlScope } from "../../../src/query/build-query";
import { type GridRow, createRolePermissionResolver } from "../../../src/internal/core";
import { createServerContext } from "../../../src/context";
import { createDefaultRegistry } from "../../../src/internal/core";
import { asRows, createFakeMysql } from "../../helpers/fake-mysql";
import { col, tables } from "../../helpers/schemas";

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [
    col("fileKey", "text", { permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
    col("url", "text"),
  ],
};

describe("RowSource.mapRows", () => {
  it("runs after hydration and before projection: it may read a hidden cell to fill a visible one", async () => {
    const ctx = createServerContext({
      schema,
      registry: createDefaultRegistry(),
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["counsellor"] },
    });
    const fake = createFakeMysql((c) =>
      c.rowsAsArray
        ? asRows(
            [{ id: "r1", version: 1, updatedAt: "2026-09-24 00:00:00.000", updatedBy: null, cells: '{"fileKey":"k/1.pdf"}' }],
            ["id", "version", "updatedAt", "updatedBy", "cells"],
          )
        : undefined,
    );
    const seen: string[][] = [];
    const base: GridSqlScope = { ctx, tables, generatedColumns: "ignore", gridId: "g" };
    const source: RowSource = {
      ...gridRowsSource(base),
      // All columns are selected for the hidden-cell check below; the fake returns them regardless of access.
      projection: () => ({ id: tables.rows.id, version: tables.rows.version, updatedAt: tables.rows.updatedAt, updatedBy: tables.rows.updatedBy, cells: tables.rows.cells }),
      async mapRows(rows: GridRow[]) {
        seen.push(rows.map((r) => Object.keys(r.cells).join(",")));
        return rows.map((r) => ({ ...r, cells: { ...r.cells, url: `https://signed/${String(r.cells.fileKey)}` } }));
      },
    };
    const scope: GridSqlScope = { ...base, rowSource: source };
    const built = buildQuery({ filter: null, sort: [], page: { offset: 0, limit: 10 } }, scope, fake.db);
    const res = await executeQuery(built, scope);
    expect(seen).toEqual([["fileKey"]]);
    expect(res.rows).toEqual([expect.objectContaining({ id: "r1", cells: { url: "https://signed/k/1.pdf" } })]);
  });
});
