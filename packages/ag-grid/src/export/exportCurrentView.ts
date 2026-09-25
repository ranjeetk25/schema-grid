/**
 * Server-mode export: pages through `dataSource.fetch` (offset paging) and
 * hands the RAW rows + ColumnDefs to io's browser-safe `buildExportBlob`,
 * which types every cell itself (XLSX numbers/dates/hyperlinks, CSV text).
 *
 * io is an optional peer. Pass it explicitly (`io`, or the grid's `io` prop)
 * or let the default load `@ranjeetk25/schema-grid-io/export` through a literal
 * dynamic `import()` that bundlers can resolve and code-split.
 */
import {
  type Access,
  type ColumnDef,
  DEFAULT_TZ,
  type DataSource,
  type FieldTypeRegistry,
  type GridQuery,
  type GridRow,
  type IoExportModule,
} from "../internal/core";

const DEFAULT_PAGE_SIZE = 500;
const IO_EXPORT = "@ranjeetk25/schema-grid-io/export";

export interface ExportCurrentViewOptions<Row extends GridRow> {
  format: "csv" | "xlsx";
  dataSource: Pick<DataSource<Row>, "fetch">;
  query: Omit<GridQuery, "page">;
  /** Already visible + readable columns, in display order. */
  columns: ColumnDef[];
  registry: FieldTypeRegistry;
  pageSize?: number;
  /** Default `export.<format>`. */
  fileName?: string;
  /** Zone datetimes are written in. Default `DEFAULT_TZ`. */
  tz?: string;
  /**
   * Column access. Columns that are not "read"/"edit" here are never exported.
   * Default: every given column is readable.
   */
  access?: ReadonlyMap<string, Access>;
  /** io's export module. Default: `import("@ranjeetk25/schema-grid-io/export")`. */
  io?: IoExportModule;
  /** Override cell reads (e.g. computed formula values). */
  getCellValue?(row: Row, column: ColumnDef): unknown;
}

/** Loads the optional io peer; throws a clear error when it is not installed. */
export async function loadIoExport(): Promise<IoExportModule> {
  let mod: Partial<IoExportModule>;
  try {
    mod = (await import("@ranjeetk25/schema-grid-io/export")) as Partial<IoExportModule>;
  } catch {
    throw new Error(`XLSX/CSV file export requires the optional peer dependency "${IO_EXPORT}". Install it to enable exports.`);
  }
  if (typeof mod.buildExportBlob !== "function") {
    throw new Error(`"${IO_EXPORT}" does not export buildExportBlob.`);
  }
  return mod as IoExportModule;
}

function isReadable(access: ReadonlyMap<string, Access>, id: string): boolean {
  const a = access.get(id);
  return a === "read" || a === "edit";
}

/**
 * Pages through `dataSource.fetch` and delegates the file write to io's
 * `buildExportBlob`. Resolves to the Blob io produced.
 */
export async function exportCurrentView<Row extends GridRow>(opts: ExportCurrentViewOptions<Row>): Promise<Blob> {
  const access: ReadonlyMap<string, Access> =
    opts.access ?? new Map<string, Access>(opts.columns.map((c) => [c.id, "read"]));
  const columns = opts.columns.filter((c) => isReadable(access, c.id));
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const read = opts.getCellValue;

  const rows: GridRow[] = [];
  let offset = 0;
  for (;;) {
    const result = await opts.dataSource.fetch({
      ...opts.query,
      page: { offset, limit: pageSize },
      includeTotal: true,
    });
    for (const row of result.rows) {
      if (!read) {
        rows.push(row);
        continue;
      }
      const cells: Record<string, unknown> = { ...row.cells };
      for (const column of columns) cells[column.key] = read(row, column);
      rows.push({ ...row, cells });
    }
    offset += result.rows.length;
    const done = result.rows.length < pageSize || (result.total !== undefined && offset >= result.total);
    if (done) break;
  }

  const io = opts.io ?? (await loadIoExport());
  return io.buildExportBlob({
    columns,
    registry: opts.registry,
    rows,
    format: opts.format,
    tz: opts.tz ?? DEFAULT_TZ,
    fileName: opts.fileName ?? `export.${opts.format}`,
    access,
  });
}
