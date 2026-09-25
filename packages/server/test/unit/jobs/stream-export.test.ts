import { describe, expect, it } from "vitest";
import type { Access, ColumnDef, ColumnState, GridRow, GridSchema, QueryResult } from "../../../src/internal/core";
import { createDefaultRegistry } from "../../../src/internal/core";
import type { ExportWriter, ExportWriterInput } from "../../../src/jobs/stream-export";
import { streamExport } from "../../../src/jobs/stream-export";

function col(id: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef {
  return {
    id,
    key: id,
    label: id,
    type,
    config: {},
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function row(id: string, cells: Record<string, unknown>): GridRow {
  return { id, version: 1, updatedAt: "2026-01-01T00:00:00.000Z", cells };
}

async function* toPages(pages: GridRow[][]): AsyncIterable<QueryResult<GridRow>> {
  for (const rows of pages) yield { rows };
}

function capturingWriter(): { writer: ExportWriter; captured: { columns?: ExportWriterInput["columns"]; rows: string[][] } } {
  const captured: { columns?: ExportWriterInput["columns"]; rows: string[][] } = { rows: [] };
  const writer: ExportWriter = async function* (input) {
    captured.columns = input.columns;
    for await (const r of input.rows) captured.rows.push(r);
    yield new Uint8Array([1]);
  };
  return { writer, captured };
}

const registry = createDefaultRegistry();

const schema: GridSchema = {
  id: "g1",
  schemaVersion: 1,
  columns: [
    col("name", "text", { order: 0, label: "Name" }),
    col("secret", "text", { order: 1, label: "Secret", hidden: true }),
    col("fee", "currency", { order: 2, label: "Fee" }),
  ],
};

const access: ReadonlyMap<string, Access> = new Map([
  ["name", "read"],
  ["secret", "hidden"],
  ["fee", "edit"],
]);

describe("streamExport", () => {
  it("never hands a hidden column to the writer (schema order, no view given)", async () => {
    const { writer, captured } = capturingWriter();
    const rows = [row("1", { name: "Amy", secret: "shh", fee: 100 })];

    const chunks: Uint8Array[] = [];
    for await (const chunk of streamExport({ pages: toPages([rows]), schema, registry, access, format: "csv", writer })) {
      chunks.push(chunk);
    }

    expect(captured.columns).toEqual([
      { id: "name", key: "name", label: "Name", type: "text" },
      { id: "fee", key: "fee", label: "Fee", type: "currency" },
    ]);
    expect(captured.columns?.some((c) => c.id === "secret")).toBe(false);
    expect(chunks).toHaveLength(1);
  });

  it("formats cell values with the column's field type format()", async () => {
    const { writer, captured } = capturingWriter();
    const rows = [row("1", { name: "Amy", fee: 100 })];

    for await (const _ of streamExport({ pages: toPages([rows]), schema, registry, access, format: "csv", writer })) {
      // drain
    }

    const feeFormatted = registry.get("currency")?.format(100, {});
    expect(captured.rows).toEqual([["Amy", feeFormatted]]);
  });

  it("respects the view's column order and hidden flags over schema order", async () => {
    const { writer, captured } = capturingWriter();
    const rows = [row("1", { name: "Amy", fee: 100 })];
    const columnState: ColumnState[] = [
      { id: "fee", hidden: false, width: 120, pinned: null, order: 0 },
      { id: "name", hidden: true, width: 120, pinned: null, order: 1 },
    ];

    for await (const _ of streamExport({
      pages: toPages([rows]),
      schema,
      registry,
      access,
      format: "csv",
      writer,
      columns: columnState,
    })) {
      // drain
    }

    expect(captured.columns).toEqual([{ id: "fee", key: "fee", label: "Fee", type: "currency" }]);
    expect(captured.rows).toEqual([[registry.get("currency")?.format(100, {})]]);
  });

  it("excludes a view column that permissions mark hidden even though the view shows it", async () => {
    const { writer, captured } = capturingWriter();
    const rows = [row("1", { name: "Amy", secret: "shh", fee: 100 })];
    const columnState: ColumnState[] = [
      { id: "secret", hidden: false, width: 120, pinned: null, order: 0 },
      { id: "fee", hidden: false, width: 120, pinned: null, order: 1 },
    ];

    for await (const _ of streamExport({
      pages: toPages([rows]),
      schema,
      registry,
      access,
      format: "csv",
      writer,
      columns: columnState,
    })) {
      // drain
    }

    expect(captured.columns).toEqual([{ id: "fee", key: "fee", label: "Fee", type: "currency" }]);
  });

  it("streams rows page by page, in page order", async () => {
    const { writer, captured } = capturingWriter();
    const page1 = [row("1", { name: "A", fee: 1 })];
    const page2 = [row("2", { name: "B", fee: 2 })];

    for await (const _ of streamExport({
      pages: toPages([page1, page2]),
      schema,
      registry,
      access,
      format: "csv",
      writer,
    })) {
      // drain
    }

    expect(captured.rows.map((r) => r[0])).toEqual(["A", "B"]);
  });
});
