import type {
  Access,
  ColumnDef,
  ColumnState,
  DataSource,
  FieldTypeRegistry,
  GridQuery,
  GridRow,
  GridSchema,
  QueryResult,
} from "@masai/schema-grid-core";
import {
  buildExportStream,
  exportFileName,
  exportMimeType,
} from "@masai/schema-grid-io/export";
import {
  type ExportWriter,
  iterateQuery,
  streamExport,
} from "@masai/schema-grid-server";

const EPOCH = "1970-01-01T00:00:00.000Z";

/**
 * Adapts io's `buildExportStream` (which takes typed `GridRow`s + `ColumnDef`s)
 * to the server's `ExportWriter` (formatted `string[]` rows): every exported
 * column becomes a `text` column holding the already-formatted value, so the
 * cells are written verbatim (CSV still gets io's formula-injection guard).
 * Trade-off: XLSX cells are text, not typed numbers/dates.
 */
export function ioExportWriter(options: {
  schema: GridSchema;
  tz: string;
  fileName: string;
  registry: FieldTypeRegistry;
}): ExportWriter {
  const widthById = new Map(options.schema.columns.map((c) => [c.id, c.width]));
  return ({ columns, rows, format }) => {
    const textColumns: ColumnDef[] = columns.map((c, order) => {
      const width = widthById.get(c.id);
      return {
        id: c.id,
        key: c.key,
        label: c.label,
        type: "text",
        config: {},
        order,
        createdAt: EPOCH,
        updatedAt: EPOCH,
        ...(width === undefined ? {} : { width }),
      };
    });
    const access = new Map<string, Access>(
      textColumns.map((c) => [c.id, "read"]),
    );
    async function* gridRows(): AsyncIterable<GridRow> {
      let i = 0;
      for await (const values of rows) {
        const cells: Record<string, unknown> = {};
        columns.forEach((c, j) => {
          cells[c.key] = values[j] ?? "";
        });
        i += 1;
        yield { id: String(i), version: 1, updatedAt: EPOCH, cells };
      }
    }
    return (async function* bytes(): AsyncIterable<Uint8Array> {
      const readable = await buildExportStream({
        columns: textColumns,
        registry: options.registry,
        rows: gridRows(),
        format,
        tz: options.tz,
        fileName: options.fileName,
        access,
      });
      for await (const chunk of readable) {
        yield typeof chunk === "string"
          ? new TextEncoder().encode(chunk)
          : (chunk as Uint8Array);
      }
    })();
  };
}

export interface ExportRequest {
  format: "csv" | "xlsx";
  query: Omit<GridQuery, "page">;
  columns?: ColumnState[];
  fileName: string;
}

export interface ExportResponse {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  fileName: string;
}

/**
 * Streams an export. The first page is fetched eagerly so permission / filter
 * errors surface as a proper 4xx before any bytes are sent.
 */
export async function buildExportResponse(
  req: ExportRequest,
  deps: {
    dataSource: DataSource<GridRow>;
    schema: GridSchema;
    registry: FieldTypeRegistry;
    access: ReadonlyMap<string, Access>;
    tz: string;
  },
): Promise<ExportResponse> {
  const iterator = iterateQuery(deps.dataSource, {
    ...req.query,
    page: { cursor: "", limit: 500 },
  })[Symbol.asyncIterator]();
  const first = await iterator.next();
  async function* pages(): AsyncIterable<QueryResult<GridRow>> {
    if (first.done) return;
    yield first.value;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  const fileName = exportFileName(req.fileName, req.format);
  const bytes = streamExport({
    pages: pages(),
    schema: deps.schema,
    registry: deps.registry,
    access: deps.access,
    format: req.format,
    writer: ioExportWriter({
      schema: deps.schema,
      tz: deps.tz,
      fileName,
      registry: deps.registry,
    }),
    ...(req.columns ? { columns: req.columns } : {}),
  })[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await bytes.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await bytes.return?.();
    },
  });
  return { body, contentType: exportMimeType(req.format), fileName };
}
