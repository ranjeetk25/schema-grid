import type { Access, ColumnDef, ColumnState, FieldTypeRegistry, GridRow, GridSchema, QueryResult } from "../internal/core";

/**
 * What the writer receives. It is shaped like `@ranjeetk25/schema-grid-io`'s
 * `ExportOptions` minus `tz` / `fileName`, so a writer can hand it straight to
 * io's `buildExportStream({ ...input, tz, fileName })`, which types every cell
 * itself (XLSX numbers, dates, hyperlinks; CSV text).
 */
export interface ExportWriterInput {
  /** Readable, non-hidden columns in export order (full `ColumnDef`s). */
  columns: ColumnDef[];
  /**
   * Rows with RAW (un-formatted) cell values, streamed page by page. Each
   * row's `cells` holds only the exported columns' keys: values of hidden
   * columns never reach the writer.
   */
  rows: AsyncIterable<GridRow>;
  registry: FieldTypeRegistry;
  /** Access for exactly the exported columns (each "read" or "edit"). */
  access: ReadonlyMap<string, Access>;
  format: "csv" | "xlsx";
}

/**
 * Injected generator that turns columns + raw rows into bytes. The real
 * implementation lives in `@ranjeetk25/schema-grid-io`; this package never imports
 * it, so callers must always supply one.
 */
export type ExportWriter = (input: ExportWriterInput) => AsyncIterable<Uint8Array>;

export interface StreamExportOptions<Row extends GridRow = GridRow> {
  pages: AsyncIterable<QueryResult<Row>>;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: ReadonlyMap<string, Access>;
  format: "csv" | "xlsx";
  writer: ExportWriter;
  /** Current view's column state. When given, only its non-hidden columns are exported, in its order. */
  columns?: ColumnState[];
}

function isReadable(access: ReadonlyMap<string, Access>, columnId: string): boolean {
  const a = access.get(columnId);
  return a === "read" || a === "edit";
}

/**
 * Readable, non-hidden export columns. When `columnState` (the current
 * view's state) is given, only its `hidden: false` entries are used, in the
 * view's `order`; a column hidden by permissions is still excluded even if
 * the view marks it visible.
 */
function resolveExportColumns(
  schema: GridSchema,
  access: ReadonlyMap<string, Access>,
  columnState?: ColumnState[],
): ColumnDef[] {
  const byId = new Map(schema.columns.map((c) => [c.id, c]));
  if (columnState) {
    return columnState
      .filter((s) => !s.hidden)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => byId.get(s.id))
      .filter((c): c is ColumnDef => c !== undefined && isReadable(access, c.id));
  }
  return schema.columns
    .filter((c) => !c.hidden && isReadable(access, c.id))
    .slice()
    .sort((a, b) => a.order - b.order);
}

/**
 * Streams a query result set to bytes via an injected `writer` (the io
 * package's format generator). Hidden columns — hidden by permissions, by
 * the schema, or by the current view's column state — are never handed to
 * the writer, and their cell values are stripped from every row. Cell values
 * are passed RAW (io formats and types them). Rows are streamed page by page
 * as `pages` yields them, so the whole result set is never held in memory.
 */
export function streamExport<Row extends GridRow = GridRow>(
  options: StreamExportOptions<Row>,
): AsyncIterable<Uint8Array> {
  const { schema, registry, access, pages, format, writer, columns } = options;
  const exportColumns = resolveExportColumns(schema, access, columns);
  const exportAccess = new Map<string, Access>(exportColumns.map((c) => [c.id, access.get(c.id) as Access]));

  async function* rows(): AsyncIterable<GridRow> {
    for await (const page of pages) {
      for (const row of page.rows) {
        const cells: Record<string, unknown> = {};
        for (const column of exportColumns) {
          if (Object.hasOwn(row.cells, column.key)) cells[column.key] = row.cells[column.key];
        }
        yield { ...row, cells };
      }
    }
  }

  return writer({ columns: exportColumns, rows: rows(), registry, access: exportAccess, format });
}
