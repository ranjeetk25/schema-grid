/**
 * ACCEPTANCE: export → parseFile → autoMapColumns → field-type parse must
 * reproduce what the grid showed, for every importable column type, via both
 * XLSX and CSV.
 */
import { describe, expect, it } from "vitest";
import { buildCsvBlob, buildCsvStream } from "../src/export/csv";
import type { ExportOptions } from "../src/export/types";
import { buildXlsxStream } from "../src/export/xlsx-stream";
import { autoMapColumns } from "../src/import/auto-map";
import { parseFile } from "../src/import/parse-file";
import type { ParsedTable } from "../src/import/types";
import { type ColumnDef, type GridRow, unwrapParse } from "../src/internal/core";
import { makeRegistry } from "./helpers/registry";
import { makeAccess, makeRow, sampleCells, visibleColumns } from "./helpers/schema";
import { collectNodeStream, toArrayBuffer } from "./helpers/streams";

const registry = makeRegistry();
const TZ = "Asia/Kolkata";
const TS = "2026-09-01T00:00:00.000Z";

/** Ad-hoc plain number column (the fixture only has currency). */
const COUNT: ColumnDef = {
  id: "c_count",
  key: "count",
  label: "Count",
  type: "number",
  // No precision: format shows every digit, so XLSX rounding cannot hide.
  config: { locale: "en-IN" },
  order: 14,
  createdAt: TS,
  updatedAt: TS,
};

const COLUMNS: ColumnDef[] = [...visibleColumns(), COUNT];

function access(): Map<string, "hidden" | "read" | "edit"> {
  const a = makeAccess();
  a.set(COUNT.id, "edit");
  return a;
}

/** Columns that are not importable: formula (c_score) and read-only (c_note). */
const NOT_IMPORTABLE = new Set(["c_score", "c_note"]);
/** Importable but lossy by design: a user ref exports as its name (asserted separately). */
const LOSSY = new Set(["c_owner"]);

const MULTILINE = "line one\nline two, with a comma";
const FORMULA_TEXT = "=SUM(A1:A2)";

/** `negativeCurrency` adds a row with a negative currency amount. */
function makeRows(negativeCurrency = true): GridRow[] {
  const rows = [0, 1, 2].map((i) =>
    makeRow({ ...sampleCells(i), count: [0, 1234567.891, 0.5][i] }),
  );
  rows.push(
    makeRow({
      ...sampleCells(3),
      name: MULTILINE,
      amount: 1_000_000,
      tags: ["tag_b"],
      lastCall: "2026-01-01T18:45:00.000Z",
      count: 42,
    }),
  );
  rows.push(makeRow({ ...sampleCells(4), name: FORMULA_TEXT, tags: [], count: 7.25 }));
  rows.push(
    makeRow({ ...sampleCells(5), amount: negativeCurrency ? -250.75 : 250.75, count: -3.5 }),
  );
  rows.push(
    makeRow({
      ...sampleCells(6),
      joinedOn: "2026-02-05",
      lastCall: "2026-02-05T23:59:58.123Z",
      count: 1.0000001,
    }),
  );
  // Every importable cell empty (name kept so the row is not blank).
  rows.push(
    makeRow({
      name: "Empty",
      email: null,
      paymentStatus: null,
      tags: [],
      stage: null,
      amount: null,
      joinedOn: null,
      lastCall: null,
      active: null,
      website: null,
      owner: null,
      count: null,
    }),
  );
  return rows;
}

function exportOptions(rows: GridRow[], format: "csv" | "xlsx"): ExportOptions {
  return {
    columns: COLUMNS,
    registry,
    rows,
    format,
    tz: TZ,
    fileName: `leads.${format}`,
    access: access(),
  };
}

async function exportXlsx(rows: GridRow[]): Promise<ParsedTable> {
  const bytes = await collectNodeStream(await buildXlsxStream(exportOptions(rows, "xlsx")));
  return parseFile(toArrayBuffer(bytes), { tz: TZ });
}

async function exportCsv(rows: GridRow[]): Promise<ParsedTable> {
  const blob = await buildCsvBlob(exportOptions(rows, "csv"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return parseFile(new File([bytes], "x.csv"), { tz: TZ });
}

async function exportCsvStream(rows: GridRow[]): Promise<ParsedTable> {
  const bytes = await collectNodeStream(await buildCsvStream(exportOptions(rows, "csv")));
  return parseFile(toArrayBuffer(bytes), { type: "csv", tz: TZ });
}

function formatOf(column: ColumnDef, value: unknown): string {
  const type = registry.get(column.type);
  if (!type) throw new Error(`no field type ${column.type}`);
  return type.format(value, column.config);
}

function reparse(column: ColumnDef, raw: string): unknown {
  const type = registry.get(column.type);
  if (!type) throw new Error(`no field type ${column.type}`);
  const result = unwrapParse(type.parse(raw, column.config));
  if (!result.ok) throw new Error(`${column.id}: parse(${JSON.stringify(raw)}) failed: ${result.error}`);
  return result.value;
}

function assertHeadersMap(table: ParsedTable): void {
  expect(table.headers).toEqual(COLUMNS.map((c) => c.label));
  const mapping = autoMapColumns(table.headers, COLUMNS, access());
  for (const [i, column] of COLUMNS.entries()) {
    const m = mapping[i];
    if (NOT_IMPORTABLE.has(column.id)) {
      expect(m, column.id).toMatchObject({ columnId: null, confidence: 0 });
    } else {
      expect(m, column.id).toMatchObject({ header: column.label, columnId: column.id, confidence: 1 });
    }
  }
}

/**
 * format(parse(exported string)) === format(original) for every importable
 * cell, except the special text cells, which the caller asserts separately.
 */
function assertTypedRoundTrip(
  table: ParsedTable,
  rows: GridRow[],
  columns: ColumnDef[] = COLUMNS,
): void {
  expect(table.rows).toHaveLength(rows.length);
  // Locate cells through the auto-mapping, as the import wizard does.
  const mapping = autoMapColumns(table.headers, columns, access());
  const headerOf = new Map(
    mapping.filter((m) => m.columnId !== null).map((m) => [m.columnId, m.headerIndex]),
  );
  let checked = 0;
  for (const [r, row] of rows.entries()) {
    for (const column of columns) {
      if (NOT_IMPORTABLE.has(column.id) || LOSSY.has(column.id)) continue;
      const original = row.cells[column.key];
      if (column.id === "c_name" && (original === MULTILINE || original === FORMULA_TEXT)) continue;
      const c = headerOf.get(column.id);
      expect(c, `${column.id} mapped`).toBeTypeOf("number");
      const raw = table.rows[r]?.[c as number] ?? "";
      checked += 1;
      const empty = original === null || original === undefined || (Array.isArray(original) && original.length === 0);
      if (empty) {
        // Empty exports as an empty cell; import skips parse for empty cells.
        expect(raw, `row ${r} ${column.id}`).toBe("");
        continue;
      }
      expect(formatOf(column, reparse(column, raw)), `row ${r} ${column.id} raw=${JSON.stringify(raw)}`).toBe(
        formatOf(column, original),
      );
    }
  }
  expect(checked).toBeGreaterThan(rows.length * 10);
}

const nameIndex = COLUMNS.findIndex((c) => c.id === "c_name");

describe("round trip: XLSX export → parseFile → autoMap → parse", () => {
  it("maps every exported header back to its own column", async () => {
    assertHeadersMap(await exportXlsx(makeRows()));
  });

  it("reproduces every importable cell's formatted value", async () => {
    const rows = makeRows();
    assertTypedRoundTrip(await exportXlsx(rows), rows);
  });

  it("keeps multi-line and formula-looking text exactly", async () => {
    const table = await exportXlsx(makeRows());
    expect(table.rows[3]?.[nameIndex]).toBe(MULTILINE);
    // XLSX text cells are never formulas, so no guard prefix is added.
    expect(table.rows[4]?.[nameIndex]).toBe(FORMULA_TEXT);
    const name = COLUMNS[nameIndex] as ColumnDef;
    expect(formatOf(name, reparse(name, FORMULA_TEXT))).toBe(FORMULA_TEXT);
  });

  it("keeps exact numeric values (not just their formatted text)", async () => {
    const rows = makeRows();
    const table = await exportXlsx(rows);
    for (const id of ["c_count", "c_amount"]) {
      const column = COLUMNS.find((c) => c.id === id) as ColumnDef;
      const i = table.headers.indexOf(column.label);
      for (const [r, row] of rows.entries()) {
        const original = row.cells[column.key];
        if (typeof original !== "number") continue;
        expect(Number(table.rows[r]?.[i]), `${id} row ${r}`).toBe(original);
      }
    }
  });

  it("round-trips datetimes as the same instant in the export tz", async () => {
    const rows = makeRows();
    const table = await exportXlsx(rows);
    const callIndex = COLUMNS.findIndex((c) => c.id === "c_call");
    expect(table.rows[0]?.[callIndex]).toBe("2026-09-25T05:00:00.000Z");
    expect(table.rows[3]?.[callIndex]).toBe("2026-01-01T18:45:00.000Z");
  });
});

describe("round trip: CSV export → parseFile → autoMap → parse", () => {
  it("maps every exported header back to its own column", async () => {
    assertHeadersMap(await exportCsv(makeRows()));
  });

  it("reproduces every importable cell's formatted value", async () => {
    const rows = makeRows(false);
    assertTypedRoundTrip(await exportCsv(rows), rows);
  });

  // CSV writes negative INR as "-₹250.75"; the currency parse must accept a
  // sign before the symbol.
  it("round-trips a negative currency amount", async () => {
    const rows = makeRows(true);
    assertTypedRoundTrip(await exportCsv(rows), rows);
  });

  it("keeps multi-line text exactly and guards formula-looking text with a leading apostrophe", async () => {
    const table = await exportCsv(makeRows());
    expect(table.rows[3]?.[nameIndex]).toBe(MULTILINE);
    // Documented CSV injection guard (sanitizeCsvText): a leading "'" is added
    // on export and is NOT stripped on import.
    expect(table.rows[4]?.[nameIndex]).toBe(`'${FORMULA_TEXT}`);
  });
});

describe("round trip: extra coverage", () => {
  it("CSV stream output round-trips the same as the Blob", async () => {
    const rows = makeRows();
    assertTypedRoundTrip(await exportCsvStream(rows), rows);
  });

  it("user refs come back as their display name (documented loss)", async () => {
    const owner = COLUMNS.find((c) => c.id === "c_owner") as ColumnDef;
    for (const table of [await exportXlsx(makeRows()), await exportCsv(makeRows())]) {
      const i = table.headers.indexOf(owner.label);
      expect(reparse(owner, table.rows[0]?.[i] ?? "")).toEqual({ id: "Ravi" });
    }
  });

  for (const displayFormat of ["dmy", "mdy", "long"] as const) {
    it(`dates survive CSV and XLSX with displayFormat ${displayFormat}`, async () => {
      const columns = COLUMNS.map((c) =>
        c.id === "c_joined" || c.id === "c_call"
          ? { ...c, config: { ...(c.config as object), displayFormat } }
          : c,
      );
      const rows = makeRows();
      const opts = (format: "csv" | "xlsx") => ({ ...exportOptions(rows, format), columns });
      const csv = await buildCsvBlob(opts("csv"));
      const csvTable = await parseFile(new File([await csv.arrayBuffer()], "x.csv"), { tz: TZ });
      const xlsx = await collectNodeStream(await buildXlsxStream(opts("xlsx")));
      const xlsxTable = await parseFile(toArrayBuffer(xlsx), { tz: TZ });
      for (const table of [csvTable, xlsxTable]) {
        const j = table.headers.indexOf("Joined On");
        const k = table.headers.indexOf("Last Call");
        expect(table.rows[6]?.[j]).toBe("2026-02-05");
        // XLSX stores wall-clock minutes precision in the number format but
        // the full value; CSV writes the exact UTC instant.
        expect(new Date(table.rows[6]?.[k] ?? "").toISOString().slice(0, 16)).toBe(
          "2026-02-05T23:59",
        );
      }
      expect(csvTable.rows[6]?.[csvTable.headers.indexOf("Last Call")]).toBe(
        "2026-02-05T23:59:58.123Z",
      );
    });
  }
});
