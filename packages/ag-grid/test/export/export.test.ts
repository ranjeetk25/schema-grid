import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultUiRegistry } from "../../src/compile/uiRegistry";
import { exportCsv } from "../../src/export/csv";
import { exportCurrentView } from "../../src/export/exportCurrentView";
import type { Access, GridRow, IoModule, IoWriteInput } from "../../src/internal/core";
import { createDefaultRegistry } from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { createFakeGridApi } from "../fixtures/fakeGridApi";
import { ADMIN, fixtureRows, fixtureSchema, row } from "../fixtures/schema";

const registry = createDefaultRegistry();
const uiRegistry = createDefaultUiRegistry<GridRow>();

function accessAll(): Map<string, Access> {
  const access = new Map<string, Access>();
  for (const c of fixtureSchema.columns) access.set(c.id, "read");
  return access;
}

describe("exportCsv", () => {
  it("columnKeys exclude hidden and unknown-access columns", () => {
    const access = accessAll();
    access.set("salary", "hidden");
    access.delete("status");

    const { api, spies } = createFakeGridApi<GridRow>({
      columns: fixtureSchema.columns.map((c) => ({ colId: c.id, hide: false })),
      rows: fixtureRows,
    });

    exportCsv(api, { schema: fixtureSchema, access, registry, uiRegistry });

    expect(spies.exportDataAsCsv).toHaveBeenCalledTimes(1);
    const params = spies.exportDataAsCsv!.mock.calls[0]![0];
    expect(params.columnKeys).not.toContain("salary");
    expect(params.columnKeys).not.toContain("status");
    expect(params.columnKeys).toContain("name");
    expect(params.columnKeys).toContain("score");
  });

  it("columnKeys never include columns hidden in the grid (not displayed)", () => {
    const access = accessAll();
    const { api, spies } = createFakeGridApi<GridRow>({
      columns: fixtureSchema.columns.map((c) => ({ colId: c.id, hide: c.id === "name" })),
      rows: fixtureRows,
    });

    exportCsv(api, { schema: fixtureSchema, access, registry, uiRegistry });

    const params = spies.exportDataAsCsv!.mock.calls[0]![0];
    expect(params.columnKeys).not.toContain("name");
  });

  it("passes fileName, skipColumnGroupHeaders and a shouldRowBeSkipped that drops group rows", () => {
    const access = accessAll();
    const { api, spies } = createFakeGridApi<GridRow>({
      columns: fixtureSchema.columns.map((c) => ({ colId: c.id })),
      rows: fixtureRows,
    });

    exportCsv(api, { schema: fixtureSchema, access, registry, uiRegistry, fileName: "leads.csv" });

    const params = spies.exportDataAsCsv!.mock.calls[0]![0];
    expect(params.fileName).toBe("leads.csv");
    expect(params.skipColumnGroupHeaders).toBe(true);

    const dataNode = { data: fixtureRows[0] };
    expect(params.shouldRowBeSkipped({ node: dataNode })).toBe(false);

    const groupNode = { data: { __sg: "group", id: "g1" } };
    expect(params.shouldRowBeSkipped({ node: groupNode })).toBe(true);

    const loadMoreNode = { data: { __sg: "loadMore", id: "lm1" } };
    expect(params.shouldRowBeSkipped({ node: loadMoreNode })).toBe(true);
  });

  it("processCellCallback uses the field type's format (via uiRegistry exportFormat)", () => {
    const access = accessAll();
    const { api, spies } = createFakeGridApi<GridRow>({
      columns: fixtureSchema.columns.map((c) => ({ colId: c.id })),
      rows: fixtureRows,
    });

    exportCsv(api, { schema: fixtureSchema, access, registry, uiRegistry });

    const params = spies.exportDataAsCsv!.mock.calls[0]![0];
    const activeColumn = fixtureSchema.columns.find((c) => c.id === "active");
    const fieldType = registry.get("boolean");
    const expected = fieldType?.format(true as never, activeColumn?.config as never);

    const result = params.processCellCallback({
      value: true,
      column: { getColId: () => "active" },
      node: { data: fixtureRows[0] },
    });
    expect(result).toBe(expected);
  });

  it("uses getCellValue override when provided (e.g. formula columns)", () => {
    const access = accessAll();
    const { api, spies } = createFakeGridApi<GridRow>({
      columns: fixtureSchema.columns.map((c) => ({ colId: c.id })),
      rows: fixtureRows,
    });
    const getCellValue = vi.fn(() => 42);

    exportCsv(api, { schema: fixtureSchema, access, registry, uiRegistry, getCellValue });

    const params = spies.exportDataAsCsv!.mock.calls[0]![0];
    const result = params.processCellCallback({
      value: 999,
      column: { getColId: () => "score" },
      node: { data: fixtureRows[0] },
    });
    expect(getCellValue).toHaveBeenCalledWith(fixtureRows[0], expect.objectContaining({ id: "score" }));
    expect(result).toBe("42");
  });

  it("falls back to String(value) for an unknown column id", () => {
    const access = accessAll();
    const { api, spies } = createFakeGridApi<GridRow>({
      columns: fixtureSchema.columns.map((c) => ({ colId: c.id })),
      rows: fixtureRows,
    });

    exportCsv(api, { schema: fixtureSchema, access, registry, uiRegistry });

    const params = spies.exportDataAsCsv!.mock.calls[0]![0];
    const result = params.processCellCallback({
      value: "hi",
      column: { getColId: () => "not-a-real-column" },
      node: { data: fixtureRows[0] },
    });
    expect(result).toBe("hi");
  });
});

describe("exportCurrentView", () => {
  const columns = fixtureSchema.columns.filter((c) => c.type !== "formula");

  it("pages through dataSource.fetch until a short page and hands rows + columns to io", async () => {
    const manyRows = Array.from({ length: 12 }, (_, i) => row(`p${i}`, { name: `Row ${i}`, score: i }));
    const dataSource = createInMemoryDataSource(fixtureSchema, manyRows, { user: ADMIN });

    const writeCsv = vi.fn((_input: IoWriteInput) => "csv-content");
    const io: IoModule = { writeCsv, writeXlsx: vi.fn() };

    const result = await exportCurrentView({
      format: "csv",
      dataSource,
      query: { filter: null, sort: [] },
      columns,
      registry,
      uiRegistry,
      pageSize: 5,
      loadIo: async () => io,
    });

    expect(result).toBe("csv-content");
    expect(dataSource.calls.fetch).toHaveBeenCalledTimes(3); // 5 + 5 + 2
    expect(writeCsv).toHaveBeenCalledTimes(1);
    const input = writeCsv.mock.calls[0]![0];
    expect(input.rows).toHaveLength(12);
    expect(input.columns.map((c: { id: string }) => c.id)).toEqual(columns.map((c) => c.id));
  });

  it("stops on an exact-size final page using total, without an extra empty fetch", async () => {
    const tenRows = Array.from({ length: 10 }, (_, i) => row(`e${i}`, { name: `Row ${i}` }));
    const dataSource = createInMemoryDataSource(fixtureSchema, tenRows, { user: ADMIN });
    const writeCsv = vi.fn(() => "ok");

    await exportCurrentView({
      format: "csv",
      dataSource,
      query: { filter: null, sort: [] },
      columns,
      registry,
      uiRegistry,
      pageSize: 5,
      loadIo: async () => ({ writeCsv, writeXlsx: vi.fn() }),
    });

    expect(dataSource.calls.fetch).toHaveBeenCalledTimes(2);
  });

  it("calls writeXlsx for xlsx format", async () => {
    const dataSource = createInMemoryDataSource(fixtureSchema, [row("x1", { name: "X" })], { user: ADMIN });
    const writeXlsx = vi.fn(() => new Uint8Array([1, 2, 3]));

    const result = await exportCurrentView({
      format: "xlsx",
      dataSource,
      query: { filter: null, sort: [] },
      columns,
      registry,
      uiRegistry,
      loadIo: async () => ({ writeCsv: vi.fn(), writeXlsx }),
    });

    expect(writeXlsx).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("filters out columns not in the optional access map", async () => {
    const dataSource = createInMemoryDataSource(fixtureSchema, [row("a1", { name: "A", salary: 99 })], { user: ADMIN });
    const writeCsv = vi.fn((_input: IoWriteInput) => "ok");
    const access = new Map<string, Access>(columns.map((c) => [c.id, "read" as Access]));
    access.set("salary", "hidden");

    await exportCurrentView({
      format: "csv",
      dataSource,
      query: { filter: null, sort: [] },
      columns,
      registry,
      uiRegistry,
      access,
      loadIo: async () => ({ writeCsv, writeXlsx: vi.fn() }),
    });

    const input = writeCsv.mock.calls[0]![0];
    expect(input.columns.map((c: { id: string }) => c.id)).not.toContain("salary");
  });

  it("respects getCellValue overrides when formatting rows", async () => {
    const dataSource = createInMemoryDataSource(fixtureSchema, [row("f1", { name: "F", score: 3 })], { user: ADMIN });
    const writeCsv = vi.fn((_input: IoWriteInput) => "ok");
    const nameColumns = fixtureSchema.columns.filter((c) => c.id === "name");

    await exportCurrentView({
      format: "csv",
      dataSource,
      query: { filter: null, sort: [] },
      columns: nameColumns,
      registry,
      uiRegistry,
      getCellValue: () => "OVERRIDDEN",
      loadIo: async () => ({ writeCsv, writeXlsx: vi.fn() }),
    });

    const input = writeCsv.mock.calls[0]![0];
    expect(input.rows[0]).toEqual(["OVERRIDDEN"]);
  });

  it("a missing io package surfaces a clear error message", async () => {
    await expect(
      exportCurrentView({
        format: "csv",
        dataSource: createInMemoryDataSource(fixtureSchema, [], { user: ADMIN }),
        query: { filter: null, sort: [] },
        columns,
        registry,
        uiRegistry,
        // no loadIo override: uses core's real loadIoModule, which resolves
        // the workspace `@masai/schema-grid-io` package but finds it lacks
        // writeCsv/writeXlsx.
      }),
    ).rejects.toThrow(/does not export writeCsv\/writeXlsx yet/);
  });
});

describe("no exceljs import in src/", () => {
  function collectFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) out.push(...collectFiles(full));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("no file under src/ references exceljs", () => {
    const srcDir = join(__dirname, "..", "..", "src");
    const files = collectFiles(srcDir);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (/from\s+["']exceljs["']|import\(["']exceljs["']\)|require\(["']exceljs["']\)/.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
