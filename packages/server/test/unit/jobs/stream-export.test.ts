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

interface Captured {
  input?: ExportWriterInput;
  columns?: ColumnDef[];
  rows: GridRow[];
}

function capturingWriter(): { writer: ExportWriter; captured: Captured } {
  const captured: Captured = { rows: [] };
  const writer: ExportWriter = async function* (input) {
    captured.input = input;
    captured.columns = input.columns;
    for await (const r of input.rows) captured.rows.push(r);
    yield new Uint8Array([1]);
  };
  return { writer, captured };
}

async function drain(it: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const chunk of it) out.push(chunk);
  return out;
}

const registry = createDefaultRegistry();

const schema: GridSchema = {
  id: "g1",
  schemaVersion: 1,
  columns: [
    col("name", "text", { order: 0, label: "Name" }),
    col("secret", "text", { order: 1, label: "Secret", hidden: true }),
    col("fee", "currency", { order: 2, label: "Fee" }),
    col("joined", "date", { order: 3, label: "Joined" }),
    col("called", "datetime", { order: 4, label: "Called" }),
  ],
};

const access: ReadonlyMap<string, Access> = new Map([
  ["name", "read"],
  ["secret", "hidden"],
  ["fee", "edit"],
  ["joined", "read"],
  ["called", "read"],
]);

const ids = (cols: ColumnDef[] | undefined) => (cols ?? []).map((c) => c.id);

describe("streamExport", () => {
  it("never hands a hidden column to the writer (schema order, no view given)", async () => {
    const { writer, captured } = capturingWriter();
    const rows = [row("1", { name: "Amy", secret: "shh", fee: 100 })];

    const chunks = await drain(streamExport({ pages: toPages([rows]), schema, registry, access, format: "csv", writer }));

    expect(ids(captured.columns)).toEqual(["name", "fee", "joined", "called"]);
    // Full ColumnDefs (type + config) so io can type the cells.
    expect(captured.columns?.[1]).toEqual(schema.columns[2]);
    expect(chunks).toHaveLength(1);
  });

  it("hands RAW cell values (numbers, dates, datetimes) to the writer, un-stringified", async () => {
    const { writer, captured } = capturingWriter();
    const rows = [
      row("1", { name: "Amy", fee: 50000, joined: "2026-09-24", called: "2026-09-24T05:00:00.000Z" }),
    ];

    await drain(streamExport({ pages: toPages([rows]), schema, registry, access, format: "xlsx", writer }));

    const cells = captured.rows[0]?.cells ?? {};
    expect(cells.fee).toBe(50000);
    expect(typeof cells.fee).toBe("number");
    expect(cells.joined).toBe("2026-09-24");
    expect(cells.called).toBe("2026-09-24T05:00:00.000Z");
    expect(captured.rows[0]?.id).toBe("1");
  });

  it("gives the writer the registry, format and an access map covering exactly the exported columns", async () => {
    const { writer, captured } = capturingWriter();

    await drain(streamExport({ pages: toPages([[row("1", { name: "Amy" })]]), schema, registry, access, format: "xlsx", writer }));

    expect(captured.input?.registry).toBe(registry);
    expect(captured.input?.format).toBe("xlsx");
    expect([...(captured.input?.access.keys() ?? [])]).toEqual(["name", "fee", "joined", "called"]);
    for (const a of captured.input?.access.values() ?? []) expect(["read", "edit"]).toContain(a);
  });

  it("strips cells of non-exported columns from the rows handed to the writer", async () => {
    const { writer, captured } = capturingWriter();
    const rows = [row("1", { name: "Amy", secret: "shh", fee: 100, stray: "x" })];

    await drain(streamExport({ pages: toPages([rows]), schema, registry, access, format: "csv", writer }));

    expect(captured.rows[0]?.cells).not.toHaveProperty("secret");
    expect(captured.rows[0]?.cells).not.toHaveProperty("stray");
    expect(captured.rows[0]?.cells.fee).toBe(100);
  });

  it("respects the view's column order and hidden flags over schema order", async () => {
    const { writer, captured } = capturingWriter();
    const rows = [row("1", { name: "Amy", fee: 100 })];
    const columnState: ColumnState[] = [
      { id: "fee", hidden: false, width: 120, pinned: null, order: 0 },
      { id: "name", hidden: true, width: 120, pinned: null, order: 1 },
    ];

    await drain(
      streamExport({ pages: toPages([rows]), schema, registry, access, format: "csv", writer, columns: columnState }),
    );

    expect(ids(captured.columns)).toEqual(["fee"]);
    expect(captured.rows[0]?.cells).toEqual({ fee: 100 });
  });

  it("excludes a view column that permissions mark hidden even though the view shows it", async () => {
    const { writer, captured } = capturingWriter();
    const rows = [row("1", { name: "Amy", secret: "shh", fee: 100 })];
    const columnState: ColumnState[] = [
      { id: "secret", hidden: false, width: 120, pinned: null, order: 0 },
      { id: "fee", hidden: false, width: 120, pinned: null, order: 1 },
    ];

    await drain(
      streamExport({ pages: toPages([rows]), schema, registry, access, format: "csv", writer, columns: columnState }),
    );

    expect(ids(captured.columns)).toEqual(["fee"]);
    expect(captured.input?.access.has("secret")).toBe(false);
  });

  it("streams rows page by page, in page order", async () => {
    const { writer, captured } = capturingWriter();
    const page1 = [row("1", { name: "A", fee: 1 })];
    const page2 = [row("2", { name: "B", fee: 2 })];

    await drain(streamExport({ pages: toPages([page1, page2]), schema, registry, access, format: "csv", writer }));

    expect(captured.rows.map((r) => r.cells.name)).toEqual(["A", "B"]);
  });
});
