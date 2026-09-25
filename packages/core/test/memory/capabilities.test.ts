import { describe, expect, it } from "vitest";
import { DEFAULT_CAPABILITIES } from "../../src/datasource/capabilities";
import { createInMemoryDataSource } from "../../src/memory/data-source";
import type { GridRow } from "../../src/rows/types";
import type { GridSchema } from "../../src/schema/types";
import { createFixtureRows } from "../../src/testing/rows";
import { createFixtureSchema, FIXTURE_COLUMN_IDS as C, FIXTURE_NOW } from "../../src/testing/schema";

function rows(n: number): GridRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${String(i).padStart(5, "0")}`,
    version: 1,
    updatedAt: FIXTURE_NOW,
    cells: { name: `Row ${i}` },
  }));
}

describe("in-memory capabilities", () => {
  it("reports the defaults when none are configured", async () => {
    const ds = createInMemoryDataSource({ schema: createFixtureSchema(), rows: createFixtureRows() });
    expect(await ds.capabilities?.()).toEqual(DEFAULT_CAPABILITIES);
  });

  it("reports configured capabilities and clamps page.limit to maxPageSize", async () => {
    const ds = createInMemoryDataSource({
      schema: createFixtureSchema(),
      rows: rows(450),
      capabilities: { maxPageSize: 200, groupBy: false },
    });
    expect(await ds.capabilities?.()).toMatchObject({ maxPageSize: 200, groupBy: false, search: true });
    const page = await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 500 }, includeTotal: true });
    expect(page.rows).toHaveLength(200);
    expect(page.total).toBe(450);
    expect(page.nextCursor).toBeDefined();
  });

  it("rejects sorting by a sortable:false column", async () => {
    const base = createFixtureSchema();
    const schema: GridSchema = {
      ...base,
      columns: base.columns.map((c) => (c.id === C.name ? { ...c, sortable: false } : c)),
    };
    const ds = createInMemoryDataSource({ schema, rows: createFixtureRows() });
    await expect(
      ds.fetch({ filter: null, sort: [{ columnId: C.name, dir: "asc" }], page: { offset: 0, limit: 10 } }),
    ).rejects.toMatchObject({ code: "unsortableColumn" });
  });

  it("rejects writes to a settable:false column as read-only", async () => {
    const base = createFixtureSchema();
    const schema: GridSchema = {
      ...base,
      columns: base.columns.map((c) => (c.id === C.name ? { ...c, settable: false } : c)),
    };
    const ds = createInMemoryDataSource({ schema, rows: createFixtureRows() });
    const result = await ds.applyChanges({
      id: "b1",
      changes: [{ rowId: "r1", columnId: C.name, prev: null, next: "X" }],
      baseVersions: { r1: 1 },
      source: "edit",
    });
    expect(result.applied).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});
