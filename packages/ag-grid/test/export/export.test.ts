import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultUiRegistry } from "../../src/compile/uiRegistry";
import { exportCsv } from "../../src/export/csv";
import { exportCurrentView } from "../../src/export/exportCurrentView";
import type { Access, GridRow, IoExportOptions } from "../../src/internal/core";
import { createDefaultRegistry, DEFAULT_TZ } from "../../src/internal/core";
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

/** Grabs the first argument of the first call to the fake grid api's `exportDataAsCsv` spy. */
function exportCsvParams(spies: Record<string, ReturnType<typeof vi.fn>>) {
  const spy = spies.exportDataAsCsv;
  if (!spy) throw new Error("expected an exportDataAsCsv spy");
  const call = spy.mock.calls[0];
  if (!call) throw new Error("expected exportDataAsCsv to have been called");
  return call[0];
}

/** Grabs the first argument of the first call to a `buildExportBlob` mock. */
function firstExportInput(buildExportBlob: { mock: { calls: unknown[][] } }): IoExportOptions {
  const call = buildExportBlob.mock.calls[0];
  if (!call) throw new Error("expected buildExportBlob to have been called");
  return call[0] as IoExportOptions;
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
    const params = exportCsvParams(spies);
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

    const params = exportCsvParams(spies);
    expect(params.columnKeys).not.toContain("name");
  });

  it("passes fileName, skipColumnGroupHeaders and a shouldRowBeSkipped that drops group rows", () => {
    const access = accessAll();
    const { api, spies } = createFakeGridApi<GridRow>({
      columns: fixtureSchema.columns.map((c) => ({ colId: c.id })),
      rows: fixtureRows,
    });

    exportCsv(api, { schema: fixtureSchema, access, registry, uiRegistry, fileName: "leads.csv" });

    const params = exportCsvParams(spies);
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

    const params = exportCsvParams(spies);
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

    const params = exportCsvParams(spies);
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

    const params = exportCsvParams(spies);
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
  const fakeIo = () => {
    const buildExportBlob = vi.fn(async (_opts: IoExportOptions) => new Blob(["ok"]));
    return { io: { buildExportBlob }, buildExportBlob };
  };

  it("pages through dataSource.fetch until a short page and hands RAW rows + ColumnDefs to io.buildExportBlob", async () => {
    const manyRows = Array.from({ length: 12 }, (_, i) => row(`p${i}`, { name: `Row ${i}`, score: i }));
    const dataSource = createInMemoryDataSource(fixtureSchema, manyRows, { user: ADMIN });
    const { io, buildExportBlob } = fakeIo();

    const result = await exportCurrentView({
      format: "csv",
      dataSource,
      query: { filter: null, sort: [] },
      columns,
      registry,
      pageSize: 5,
      tz: "Asia/Kolkata",
      fileName: "leads.csv",
      io,
    });

    expect(result).toBeInstanceOf(Blob);
    expect(dataSource.calls.fetch).toHaveBeenCalledTimes(3); // 5 + 5 + 2
    expect(buildExportBlob).toHaveBeenCalledTimes(1);
    const input = firstExportInput(buildExportBlob);
    expect(input.format).toBe("csv");
    expect(input.tz).toBe("Asia/Kolkata");
    expect(input.fileName).toBe("leads.csv");
    expect(input.registry).toBe(registry);
    expect(input.columns).toEqual(columns);
    expect(input.rows).toHaveLength(12);
    // Raw values, not pre-formatted strings: io types the cells itself.
    expect((input.rows as GridRow[]).find((r) => r.id === "p3")?.cells.score).toBe(3);
    for (const c of columns) expect(input.access.get(c.id)).toBe("read");
  });

  it("stops on an exact-size final page using total, without an extra empty fetch", async () => {
    const tenRows = Array.from({ length: 10 }, (_, i) => row(`e${i}`, { name: `Row ${i}` }));
    const dataSource = createInMemoryDataSource(fixtureSchema, tenRows, { user: ADMIN });

    await exportCurrentView({
      format: "csv",
      dataSource,
      query: { filter: null, sort: [] },
      columns,
      registry,
      pageSize: 5,
      io: fakeIo().io,
    });

    expect(dataSource.calls.fetch).toHaveBeenCalledTimes(2);
  });

  it("passes format xlsx through, with default tz and file name", async () => {
    const dataSource = createInMemoryDataSource(fixtureSchema, [row("x1", { name: "X" })], { user: ADMIN });
    const { io, buildExportBlob } = fakeIo();

    await exportCurrentView({ format: "xlsx", dataSource, query: { filter: null, sort: [] }, columns, registry, io });

    const input = firstExportInput(buildExportBlob);
    expect(input.format).toBe("xlsx");
    expect(input.tz).toBe(DEFAULT_TZ);
    expect(input.fileName).toBe("export.xlsx");
  });

  it("filters out columns not readable in the optional access map and forwards that map", async () => {
    const dataSource = createInMemoryDataSource(fixtureSchema, [row("a1", { name: "A", salary: 99 })], { user: ADMIN });
    const { io, buildExportBlob } = fakeIo();
    const access = new Map<string, Access>(columns.map((c) => [c.id, "read" as Access]));
    access.set("salary", "hidden");

    await exportCurrentView({ format: "csv", dataSource, query: { filter: null, sort: [] }, columns, registry, access, io });

    const input = firstExportInput(buildExportBlob);
    expect(input.columns.map((c) => c.id)).not.toContain("salary");
    expect(input.access).toBe(access);
  });

  it("respects getCellValue overrides (e.g. computed formula values)", async () => {
    const dataSource = createInMemoryDataSource(fixtureSchema, [row("f1", { name: "F", score: 3 })], { user: ADMIN });
    const { io, buildExportBlob } = fakeIo();
    const nameColumns = fixtureSchema.columns.filter((c) => c.id === "name");

    await exportCurrentView({
      format: "csv",
      dataSource,
      query: { filter: null, sort: [] },
      columns: nameColumns,
      registry,
      getCellValue: () => "OVERRIDDEN",
      io,
    });

    const input = firstExportInput(buildExportBlob);
    const first = (input.rows as GridRow[])[0];
    expect(first?.cells[nameColumns[0]?.key ?? ""]).toBe("OVERRIDDEN");
  });

  it("without an injected io, loads the real @ranjeetk25/schema-grid-io/export and returns a CSV Blob", async () => {
    const dataSource = createInMemoryDataSource(fixtureSchema, [row("c1", { name: "Csv Row", score: 7 })], { user: ADMIN });
    const nameAndScore = fixtureSchema.columns.filter((c) => c.id === "name" || c.id === "score");

    const blob = await exportCurrentView({
      format: "csv",
      dataSource,
      query: { filter: null, sort: [] },
      columns: nameAndScore,
      registry,
    });

    expect(blob).toBeInstanceOf(Blob);
    // jsdom's Blob has no .text(); read it the browser way.
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(text).toContain("Csv Row");
    expect(text).toContain("7");
  });

  it("loads io through a LITERAL import specifier bundlers can resolve", () => {
    const src = readFileSync(join(__dirname, "..", "..", "src", "export", "exportCurrentView.ts"), "utf8");
    expect(src).toMatch(/import\(\s*["']@ranjeetk25\/schema-grid-io\/export["']\s*\)/);
    const core = readFileSync(join(__dirname, "..", "..", "src", "internal", "core.ts"), "utf8");
    expect(core).not.toMatch(/import\(\s*\/\*\s*@vite-ignore/);
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
