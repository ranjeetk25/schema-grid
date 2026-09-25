import { getColumnFieldType } from "../internal/core";
import type { Access, ColumnDef, ColumnState, FieldTypeRegistry, GridRow, GridSchema, QueryResult } from "../internal/core";

export interface ExportColumn {
  id: string;
  key: string;
  label: string;
  type: string;
}

export interface ExportWriterInput {
  columns: ExportColumn[];
  rows: AsyncIterable<string[]>;
  format: "csv" | "xlsx";
}

/**
 * Injected generator that turns columns + formatted row cells into bytes.
 * The real implementation lives in `@masai/schema-grid-io`; this package
 * never imports it, so callers must always supply one.
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

function toExportColumn(column: ColumnDef): ExportColumn {
  return { id: column.id, key: column.key, label: column.label, type: column.type };
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
): ExportColumn[] {
  const byId = new Map(schema.columns.map((c) => [c.id, c]));
  if (columnState) {
    return columnState
      .filter((s) => !s.hidden)
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => byId.get(s.id))
      .filter((c): c is ColumnDef => c !== undefined && isReadable(access, c.id))
      .map(toExportColumn);
  }
  return schema.columns
    .filter((c) => !c.hidden && isReadable(access, c.id))
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(toExportColumn);
}

/**
 * Streams a query result set to bytes via an injected `writer` (the io
 * package's format generator). Hidden columns — hidden by permissions, by
 * the schema, or by the current view's column state — are never handed to
 * the writer. Cell values are formatted through each column's field type
 * `format(value, config)`. Rows are streamed page by page as `pages` yields
 * them, so the whole result set never has to be held in memory at once.
 */
export function streamExport<Row extends GridRow = GridRow>(
  options: StreamExportOptions<Row>,
): AsyncIterable<Uint8Array> {
  const { schema, registry, access, pages, format, writer, columns } = options;
  const exportColumns = resolveExportColumns(schema, access, columns);
  const columnById = new Map(schema.columns.map((c) => [c.id, c]));

  async function* rows(): AsyncIterable<string[]> {
    for await (const page of pages) {
      for (const row of page.rows) {
        yield exportColumns.map((exportColumn) => {
          const column = columnById.get(exportColumn.id);
          if (!column) return "";
          const value = row.cells[column.key] ?? null;
          const fieldType = getColumnFieldType(column, registry);
          if (!fieldType) return value === null || value === undefined ? "" : String(value);
          return fieldType.format(value, column.config);
        });
      }
    }
  }

  return writer({ columns: exportColumns, rows: rows(), format });
}
