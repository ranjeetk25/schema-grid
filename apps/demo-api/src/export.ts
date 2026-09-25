import type {
  Access,
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

/**
 * Adapts io's `buildExportStream` to the server's `ExportWriter`: the server
 * hands over the exported ColumnDefs, RAW rows, registry and access, and io
 * types the cells itself (XLSX numbers/dates/hyperlinks, guarded CSV text).
 */
export function ioExportWriter(options: {
  tz: string;
  fileName: string;
}): ExportWriter {
  return (input) =>
    (async function* bytes(): AsyncIterable<Uint8Array> {
      const readable = await buildExportStream({
        ...input,
        tz: options.tz,
        fileName: options.fileName,
      });
      for await (const chunk of readable) {
        yield typeof chunk === "string"
          ? new TextEncoder().encode(chunk)
          : (chunk as Uint8Array);
      }
    })();
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
    writer: ioExportWriter({ tz: deps.tz, fileName }),
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
