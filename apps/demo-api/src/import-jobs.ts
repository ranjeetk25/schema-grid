import type {
  Access,
  DataSource,
  FieldTypeRegistry,
  GridRow,
  GridSchema,
} from "@ranjeetk25/schema-grid-core";
import {
  type ParsedTable,
  autoMapColumns,
  buildErrorReportCsv,
  parseFile,
} from "@ranjeetk25/schema-grid-io/import";
import {
  type ImportJobReport,
  type ImportJobStore,
  PermissionError,
  runImportJob,
} from "@ranjeetk25/schema-grid-server";
import { HttpError } from "./http-error";

/** Mirrors ui-mantine's `ImportJobStatus` (plus the final report). */
export interface ImportJobStatus {
  state: "queued" | "running" | "done" | "failed";
  processed: number;
  total: number;
  errorCount: number;
  errorReportUrl?: string;
  report?: ImportJobReport;
  error?: { name: string; message: string };
}

interface JobRecord {
  status: ImportJobStatus;
  parsed: ParsedTable;
}

/** Minimum `autoMapColumns` confidence kept when the client sends no mapping. */
const AUTO_MAP_MIN_CONFIDENCE = 0.9;

/** In-memory `ImportJobStore` + status registry for background import jobs. */
export class ImportJobs implements ImportJobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly reports = new Map<string, ImportJobReport>();
  private seq = 0;

  async save(jobId: string, report: ImportJobReport): Promise<void> {
    this.reports.set(jobId, report);
  }

  async load(jobId: string): Promise<ImportJobReport | undefined> {
    return this.reports.get(jobId);
  }

  status(jobId: string): ImportJobStatus | undefined {
    return this.jobs.get(jobId)?.status;
  }

  /** CSV of failed rows (io's error report format), or undefined for an unknown job. */
  errorCsv(jobId: string): string | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    const failed = job.status.report?.failed ?? [];
    const headerRow = job.parsed.headerRow ?? 1;
    return buildErrorReportCsv(
      {
        total: job.status.total,
        processed: job.status.processed,
        failed: new Set(failed.map((f) => f.rowIndex)).size,
        errors: failed.map((f) => ({
          sourceRow: f.rowIndex >= 0 ? f.rowIndex + headerRow + 1 : 0,
          ...(f.columnId ? { columnId: f.columnId } : {}),
          message: f.message,
        })),
      },
      job.parsed,
    );
  }

  /** Test helper: resolves once the job leaves queued/running. */
  async waitFor(
    jobId: string,
    timeoutMs = 10_000,
  ): Promise<ImportJobStatus | undefined> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const s = this.status(jobId);
      if (
        !s ||
        s.state === "done" ||
        s.state === "failed" ||
        Date.now() > until
      )
        return s;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  nextId(): string {
    this.seq += 1;
    return `imp_${Date.now().toString(36)}_${this.seq}`;
  }

  register(jobId: string, parsed: ParsedTable): ImportJobStatus {
    const status: ImportJobStatus = {
      state: "queued",
      processed: 0,
      total: parsed.rows.length,
      errorCount: 0,
    };
    this.jobs.set(jobId, { status, parsed });
    return status;
  }
}

export interface StartImportInput {
  file: File;
  mappingJson?: string | undefined;
  mode?: string | undefined;
  keyColumnId?: string | undefined;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: ReadonlyMap<string, Access>;
  dataSource: DataSource<GridRow>;
  tz: string;
  /** Used to build `errorReportUrl`. */
  basePath?: string;
}

function parseMapping(json: string): Record<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new HttpError(400, "InputValidationError", "mapping must be JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(
      400,
      "InputValidationError",
      "mapping must be a JSON object of sourceHeader -> columnId",
    );
  }
  const out: Record<string, string> = {};
  for (const [header, columnId] of Object.entries(value)) {
    if (columnId === null || columnId === "") continue;
    if (typeof columnId !== "string")
      throw new HttpError(
        400,
        "InputValidationError",
        `mapping["${header}"] must be a column id`,
      );
    out[header] = columnId;
  }
  return out;
}

/**
 * Parses the file, resolves + checks the mapping synchronously (so bad input
 * is a 4xx, not a failed job), then runs `runImportJob` in the background.
 */
export async function startImport(
  jobs: ImportJobs,
  input: StartImportInput,
): Promise<string> {
  const mode = input.mode ?? "create";
  if (mode !== "create" && mode !== "upsert")
    throw new HttpError(
      400,
      "InputValidationError",
      `mode must be "create" or "upsert"`,
    );
  if (mode === "upsert" && !input.keyColumnId)
    throw new HttpError(
      400,
      "InputValidationError",
      "upsert requires keyColumnId",
    );

  const parsed = await parseFile(input.file, { tz: input.tz });
  let mapping: Record<string, string>;
  if (input.mappingJson) {
    mapping = parseMapping(input.mappingJson);
  } else {
    mapping = {};
    for (const m of autoMapColumns(
      parsed.headers,
      input.schema,
      input.access,
    )) {
      if (m.columnId && m.confidence >= AUTO_MAP_MIN_CONFIDENCE)
        mapping[m.header] = m.columnId;
    }
  }
  const known = new Set(input.schema.columns.map((c) => c.id));
  const headers = new Set(parsed.headers);
  for (const [header, columnId] of Object.entries(mapping)) {
    if (!headers.has(header))
      throw new HttpError(
        400,
        "InputValidationError",
        `mapping header "${header}" is not in the file`,
      );
    if (!known.has(columnId))
      throw new HttpError(
        400,
        "InputValidationError",
        `mapping target "${columnId}" is not a column`,
      );
  }
  if (Object.keys(mapping).length === 0)
    throw new HttpError(400, "InputValidationError", "No columns mapped");
  const notEditable = [...new Set(Object.values(mapping))].filter(
    (id) => input.access.get(id) !== "edit",
  );
  if (notEditable.length > 0) throw new PermissionError(notEditable, "edit");
  if (input.keyColumnId && !known.has(input.keyColumnId)) {
    throw new HttpError(
      400,
      "InputValidationError",
      `keyColumnId "${input.keyColumnId}" is not a column`,
    );
  }

  const jobId = jobs.nextId();
  const status = jobs.register(jobId, parsed);

  async function* rows(): AsyncIterable<Record<string, string>> {
    for (const cells of parsed.rows) {
      const record: Record<string, string> = {};
      parsed.headers.forEach((h, i) => {
        record[h] = cells[i] ?? "";
      });
      yield record;
    }
  }

  const run = async () => {
    status.state = "running";
    try {
      const report = await runImportJob({
        jobId,
        rows: rows(),
        mapping,
        dataSource: input.dataSource,
        schema: input.schema,
        registry: input.registry,
        access: input.access,
        mode,
        ...(input.keyColumnId ? { keyColumnId: input.keyColumnId } : {}),
        store: jobs,
        onProgress: (p) => {
          status.processed = p.processed;
          status.errorCount = p.failed;
        },
      });
      status.processed = status.total;
      status.report = report;
      status.errorCount = report.failed.length;
      status.state = "done";
    } catch (err) {
      status.state = "failed";
      status.error = {
        name: err instanceof Error ? err.name : "Error",
        message: err instanceof Error ? err.message : String(err),
      };
      const partial = await jobs.load(jobId);
      if (partial) {
        status.report = partial;
        status.errorCount = partial.failed.length;
      }
    }
    if (status.errorCount > 0)
      status.errorReportUrl = `${input.basePath ?? ""}/import/${jobId}/errors.csv`;
  };
  setTimeout(() => void run(), 0);
  return jobId;
}
