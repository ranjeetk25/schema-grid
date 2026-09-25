/**
 * Server-mode export: pages through `dataSource.fetch` (offset paging, or
 * `nextCursor` in cursor mode) and hands the RAW rows + ColumnDefs to io's
 * browser-safe `buildExportBlob`, which types every cell itself (XLSX
 * numbers/dates/hyperlinks, CSV text).
 *
 * Paging never stops on a short page: a source may clamp `page.limit` to its
 * `maxPageSize`. Offset mode continues until an empty page or `total`;
 * cursor mode continues while `nextCursor` is returned. `maxRows` caps the
 * export (the source's `export.maxRows` capability).
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
import type { PageMode } from "../server/infiniteDatasource";

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
  /** "cursor" follows `nextCursor` after the first page. Default "offset". */
  pageMode?: PageMode;
  /** Stop after this many rows (the rest is not fetched). Default: no limit. */
  maxRows?: number;
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

  const maxRows = opts.maxRows !== undefined && opts.maxRows >= 0 ? opts.maxRows : Number.POSITIVE_INFINITY;
  const cursorMode = opts.pageMode === "cursor";

  const rows: GridRow[] = [];
  let offset = 0;
  let cursor: string | undefined;
  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const page: GridQuery["page"] = cursor !== undefined ? { cursor, limit } : { offset, limit };
    const result = await opts.dataSource.fetch({ ...opts.query, page, includeTotal: true });
    for (const row of result.rows.slice(0, maxRows - rows.length)) {
      if (!read) {
        rows.push(row);
        continue;
      }
      const cells: Record<string, unknown> = { ...row.cells };
      for (const column of columns) cells[column.key] = read(row, column);
      rows.push({ ...row, cells });
    }
    offset += result.rows.length;
    if (cursorMode) {
      // Cursor mode: the source says where the next page starts; no cursor = the end.
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
      continue;
    }
    // Offset mode: never stop on a short page (the source may clamp the limit).
    if (result.rows.length === 0) break;
    if (typeof result.total === "number" && offset >= result.total) break;
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
