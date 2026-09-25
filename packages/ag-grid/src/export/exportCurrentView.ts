/**
 * Server-mode export: pages through `dataSource.fetch` (offset paging),
 * formats every cell the same way the CSV export does, and hands the result
 * to the optional io package's `writeCsv`/`writeXlsx`.
 */
import { resolveExportFormat, type UiFieldTypeRegistry } from "../compile/uiRegistry";
import {
  type Access,
  type ColumnDef,
  type DataSource,
  type FieldTypeRegistry,
  type GridQuery,
  type GridRow,
  type IoExportColumn,
  type IoModule,
  loadIoModule,
} from "../internal/core";

const DEFAULT_PAGE_SIZE = 500;

export interface ExportCurrentViewOptions<Row extends GridRow> {
  format: "csv" | "xlsx";
  dataSource: Pick<DataSource<Row>, "fetch">;
  query: Omit<GridQuery, "page">;
  /** Already visible + readable columns, in display order. */
  columns: ColumnDef[];
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry<Row>;
  pageSize?: number;
  fileName?: string;
  /** Defensive: any column not in this map (when given) is never exported. */
  access?: Map<string, Access>;
  loadIo?: () => Promise<IoModule>;
  /** Override cell reads (e.g. computed formula values). */
  getCellValue?(row: Row, column: ColumnDef): unknown;
}

function formatRow<Row extends GridRow>(
  row: Row,
  columns: ColumnDef[],
  registry: FieldTypeRegistry,
  uiRegistry: UiFieldTypeRegistry<Row>,
  getCellValue?: (row: Row, column: ColumnDef) => unknown,
): string[] {
  return columns.map((column) => {
    const fieldType = registry.get(column.type);
    const entry = uiRegistry.get(column.type);
    const value = getCellValue ? getCellValue(row, column) : row.cells[column.key];
    return resolveExportFormat(entry, value, column, fieldType);
  });
}

/**
 * Pages through `dataSource.fetch`, formats every cell, and delegates the
 * write to `@masai/schema-grid-io` (via `loadIo`, default `loadIoModule`).
 * Resolves to whatever the io module's writer returns.
 */
export async function exportCurrentView<Row extends GridRow>(
  opts: ExportCurrentViewOptions<Row>,
): Promise<Blob | string | ArrayBuffer | Uint8Array> {
  const columns = opts.access ? opts.columns.filter((c) => opts.access?.get(c.id) === "read" || opts.access?.get(c.id) === "edit") : opts.columns;
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;

  const rows: string[][] = [];
  let offset = 0;
  for (;;) {
    const result = await opts.dataSource.fetch({
      ...opts.query,
      page: { offset, limit: pageSize },
      includeTotal: true,
    });
    for (const row of result.rows) {
      rows.push(formatRow(row, columns, opts.registry, opts.uiRegistry, opts.getCellValue));
    }
    offset += result.rows.length;
    const done = result.rows.length < pageSize || (result.total !== undefined && offset >= result.total);
    if (done) break;
  }

  const ioColumns: IoExportColumn[] = columns.map((c) => ({ id: c.id, key: c.key, label: c.label, type: c.type }));
  const load = opts.loadIo ?? loadIoModule;
  const io = await load();

  return opts.format === "csv"
    ? io.writeCsv({ columns: ioColumns, rows, fileName: opts.fileName })
    : io.writeXlsx({ columns: ioColumns, rows, fileName: opts.fileName });
}
