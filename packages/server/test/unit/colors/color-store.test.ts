import { describe, expect, it } from "vitest";
import { projectRow } from "../../../src/access/project-row";
import type { GridDb } from "../../../src/changes/db";
import { createCellColorStore } from "../../../src/colors/color-store";
import { parseCellColors } from "../../../src/colors/rows";
import { SchemaValidationError } from "../../../src/errors";
import { queryFingerprint } from "../../../src/pagination/cursor";
import type { ColorRule, GridRow } from "../../../src/internal/core";
import { createFakeMysql } from "../../helpers/fake-mysql";
import { allTypesSchema } from "../../helpers/schemas";

describe("createCellColorStore", () => {
  it("validates the table name and exposes the drizzle table", () => {
    const { db } = createFakeMysql();
    const store = createCellColorStore({ db: db as unknown as GridDb, table: "grid_cell_colors" });
    expect(store.tableName).toBe("grid_cell_colors");
    expect(Object.keys(store.table)).toEqual(expect.arrayContaining(["gridId", "rowId", "colors", "updatedAt", "updatedBy"]));
    expect(() => createCellColorStore({ db: db as unknown as GridDb, table: "bad name" })).toThrow(SchemaValidationError);
  });

  it("available(): false while the table is missing (re-probed), true once it exists (cached)", async () => {
    let exists = false;
    const fake = createFakeMysql(() => {
      if (!exists) throw Object.assign(new Error("Table 'db.grid_cell_colors' doesn't exist"), { errno: 1146 });
      return [];
    });
    const store = createCellColorStore({ db: fake.db as unknown as GridDb, table: "grid_cell_colors" });
    await expect(store.available()).resolves.toBe(false);
    exists = true;
    await expect(store.available()).resolves.toBe(true);
    exists = false;
    await expect(store.available()).resolves.toBe(true);
    expect(fake.calls[0]?.sql).toBe("select 1 from `grid_cell_colors` limit 0");
  });

  it("available(): other errors reject", async () => {
    const fake = createFakeMysql(() => {
      throw new Error("connection lost");
    });
    const store = createCellColorStore({ db: fake.db as unknown as GridDb, table: "grid_cell_colors" });
    await expect(store.available()).rejects.toThrow(/connection lost|Failed query/);
  });
});

describe("parseCellColors / projectRow", () => {
  it("keeps palette colors only, from an object or a JSON string; nothing left → undefined", () => {
    expect(parseCellColors({ a: "red", b: "nope", c: 1 })).toEqual({ a: "red" });
    expect(parseCellColors('{"a":"teal"}')).toEqual({ a: "teal" });
    expect(parseCellColors("{bad json")).toBeUndefined();
    expect(parseCellColors(null)).toBeUndefined();
    expect(parseCellColors(["red"])).toBeUndefined();
    expect(parseCellColors({})).toBeUndefined();
  });

  it("projectRow drops colors of unreadable / unknown columns and an empty map", () => {
    const schema = allTypesSchema();
    const access = new Map(schema.columns.map((c) => [c.id, c.id === "notes" ? ("hidden" as const) : ("read" as const)]));
    const row: GridRow = { id: "r", version: 1, updatedAt: "x", cells: {}, colors: { name: "red", notes: "blue", ghost: "green" } };
    expect(projectRow(row, schema, access).colors).toEqual({ name: "red" });
    const only = projectRow({ ...row, colors: { notes: "blue" } }, schema, access);
    expect(only).not.toHaveProperty("colors");
    expect(projectRow({ id: "r", version: 1, updatedAt: "x", cells: {} }, schema, access)).not.toHaveProperty("colors");
  });
});

describe("queryFingerprint and color rules", () => {
  const rules: ColorRule[] = [{ id: "r", color: "red", target: { kind: "row" }, when: null }];
  const base = { filter: null, sort: [], search: "", groupBy: [] };
  it("rules only count when the filter has a color condition (plain cursors stay valid)", () => {
    expect(queryFingerprint({ ...base, colorRules: rules })).toBe(queryFingerprint(base));
    const colorFilter = { columnId: "a", operator: "colorIsNone" };
    expect(queryFingerprint({ ...base, filter: colorFilter, colorRules: rules })).not.toBe(
      queryFingerprint({ ...base, filter: colorFilter }),
    );
  });
});
