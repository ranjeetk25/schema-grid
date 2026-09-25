import { PermissionError } from "../errors";
import { getColumnFieldType } from "../internal/core";
import type { Access, CellChange, ColumnDef, DataSource, FieldTypeRegistry, GridRow, GridSchema } from "../internal/core";

export interface ImportFailure {
  rowIndex: number;
  columnId?: string;
  message: string;
}

export interface ImportJobReport {
  created: number;
  updated: number;
  failed: ImportFailure[];
}

/** Consumer-provided persistence for job progress; the server itself keeps no job state. */
export interface ImportJobStore {
  save(jobId: string, report: ImportJobReport): Promise<void>;
  load(jobId: string): Promise<ImportJobReport | undefined>;
}

export interface ImportProgress {
  processed: number;
  created: number;
  updated: number;
  failed: number;
}

export interface RunImportJobOptions<Row extends GridRow = GridRow> {
  jobId?: string;
  /** Parsed source rows, keyed by source header (parsing the file itself is the io package's job). */
  rows: AsyncIterable<Record<string, unknown>>;
  /** sourceHeader -> target columnId */
  mapping: Record<string, string>;
  dataSource: DataSource<Row>;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  access: ReadonlyMap<string, Access>;
  /** Rows per write batch. Default 500. */
  batchSize?: number;
  mode: "create" | "upsert";
  /** Required when `mode` is "upsert": the column used to find existing rows. */
  keyColumnId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
  store?: ImportJobStore;
}

interface PendingRow {
  rowIndex: number;
  /** Cells keyed by column KEY (the shape `DataSource.createRows` expects). */
  cells: Record<string, unknown>;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function generateBatchId(jobId: string | undefined): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  const id = `imp_${jobId ?? "job"}_${Date.now().toString(36)}_${suffix}`;
  return id.slice(0, 64);
}

type KeyLookupMode = "isAnyOf" | "is" | "eq";

function chooseKeyLookupMode(keyColumn: ColumnDef, registry: FieldTypeRegistry): KeyLookupMode {
  const ops = new Set((getColumnFieldType(keyColumn, registry)?.operators ?? []).map((o) => o.id));
  if (ops.has("isAnyOf")) return "isAnyOf";
  if (ops.has("is")) return "is";
  return "eq";
}

/** Looks up existing rows by the key column's value, batched via `isAnyOf` when the type supports it, one fetch per key otherwise. */
async function fetchExistingByKey<Row extends GridRow>(
  dataSource: DataSource<Row>,
  keyColumnId: string,
  keyColumnKey: string,
  mode: KeyLookupMode,
  keyValues: string[],
): Promise<Map<string, Row>> {
  const found = new Map<string, Row>();
  if (keyValues.length === 0) return found;

  if (mode === "isAnyOf") {
    const result = await dataSource.fetch({
      filter: { columnId: keyColumnId, operator: "isAnyOf", value: keyValues },
      sort: [],
      page: { offset: 0, limit: Math.max(keyValues.length, 1) },
    });
    for (const row of result.rows) {
      found.set(String((row.cells as Record<string, unknown>)[keyColumnKey]), row);
    }
    return found;
  }

  for (const value of keyValues) {
    const result = await dataSource.fetch({
      filter: { columnId: keyColumnId, operator: mode, value },
      sort: [],
      page: { offset: 0, limit: 1 },
    });
    const row = result.rows[0];
    if (row) found.set(value, row);
  }
  return found;
}

/**
 * Streams parsed rows into a `DataSource`, batched writes, capped progress
 * reporting, and an `create` | `upsert` mode.
 *
 * Up front, every mapped target column must exist and be editable
 * (`access.get(id) === "edit"`); otherwise this throws `PermissionError`
 * before consuming `rows` or writing anything.
 *
 * Each value is parsed with the target column's field type `parse`, then
 * checked with `valueSchema(config).safeParse`. A row with any invalid cell
 * is skipped entirely; each invalid cell is recorded in `failed` with its
 * 0-based `rowIndex` and `columnId`.
 */
export async function runImportJob<Row extends GridRow = GridRow>(
  options: RunImportJobOptions<Row>,
): Promise<ImportJobReport> {
  const {
    jobId,
    rows,
    mapping,
    dataSource,
    schema,
    registry,
    access,
    batchSize = 500,
    mode,
    keyColumnId,
    signal,
    onProgress,
    store,
  } = options;

  if (mode === "upsert" && !keyColumnId) {
    throw new Error("runImportJob: upsert mode requires keyColumnId");
  }

  const columnById = new Map(schema.columns.map((c) => [c.id, c]));
  const keyByColumnId = new Map(schema.columns.map((c) => [c.id, c.key]));
  const columnIdByKey = new Map(schema.columns.map((c) => [c.key, c.id]));

  const targetColumnIds = unique(Object.values(mapping));
  const notEditable = targetColumnIds.filter((id) => access.get(id) !== "edit");
  if (notEditable.length > 0) {
    throw new PermissionError(notEditable, "edit");
  }

  let keyColumn: ColumnDef | undefined;
  let keyLookupMode: KeyLookupMode = "eq";
  if (mode === "upsert") {
    keyColumn = columnById.get(keyColumnId as string);
    if (!keyColumn) throw new Error(`runImportJob: unknown keyColumnId "${keyColumnId}"`);
    keyLookupMode = chooseKeyLookupMode(keyColumn, registry);
  }

  const report: ImportJobReport = { created: 0, updated: 0, failed: [] };
  let processed = 0;
  let batch: PendingRow[] = [];

  const reportProgressAndSave = async (): Promise<void> => {
    onProgress?.({ processed, created: report.created, updated: report.updated, failed: report.failed.length });
    if (store && jobId) {
      await store.save(jobId, { created: report.created, updated: report.updated, failed: [...report.failed] });
    }
  };

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const currentBatch = batch;
    batch = [];

    if (mode === "create") {
      const created = await dataSource.createRows(currentBatch.map((r) => ({ cells: r.cells as Row["cells"] })));
      report.created += created.length;
    } else {
      const keyColKey = (keyColumn as ColumnDef).key;
      const keyValues = unique(currentBatch.map((r) => String(r.cells[keyColKey])));
      const existingByKey = await fetchExistingByKey(
        dataSource,
        keyColumnId as string,
        keyColKey,
        keyLookupMode,
        keyValues,
      );

      const toCreate: PendingRow[] = [];
      const changes: CellChange[] = [];
      const baseVersions: Record<string, number> = {};
      const rowIndexByRowId = new Map<string, number>();

      for (const r of currentBatch) {
        const existingRow = existingByKey.get(String(r.cells[keyColKey]));
        if (!existingRow) {
          toCreate.push(r);
          continue;
        }
        baseVersions[existingRow.id] = existingRow.version;
        rowIndexByRowId.set(existingRow.id, r.rowIndex);
        const prevCells = existingRow.cells as Record<string, unknown>;
        for (const [key, next] of Object.entries(r.cells)) {
          const columnId = columnIdByKey.get(key);
          if (!columnId) continue;
          changes.push({ rowId: existingRow.id, columnId, prev: prevCells[key], next });
        }
      }

      if (toCreate.length > 0) {
        const created = await dataSource.createRows(toCreate.map((r) => ({ cells: r.cells as Row["cells"] })));
        report.created += created.length;
      }

      if (changes.length > 0) {
        const result = await dataSource.applyChanges({
          id: generateBatchId(jobId),
          changes,
          baseVersions,
          source: "import",
        });
        const failedRowIds = new Set<string>();
        for (const conflict of result.conflicts) {
          failedRowIds.add(conflict.rowId);
          report.failed.push({
            rowIndex: rowIndexByRowId.get(conflict.rowId) ?? -1,
            columnId: conflict.columnId,
            message: `Conflict: row was updated to version ${conflict.serverVersion} by someone else`,
          });
        }
        for (const error of result.errors) {
          failedRowIds.add(error.rowId);
          report.failed.push({
            rowIndex: rowIndexByRowId.get(error.rowId) ?? -1,
            columnId: error.columnId,
            message: error.message,
          });
        }
        for (const rowId of Object.keys(baseVersions)) {
          if (!failedRowIds.has(rowId)) report.updated += 1;
        }
      }
    }

    await reportProgressAndSave();
  };

  for await (const raw of rows) {
    const rowIndex = processed;
    processed += 1;
    if (signal?.aborted) break;

    const cells: Record<string, unknown> = {};
    const failuresForRow: ImportFailure[] = [];

    for (const [sourceHeader, columnId] of Object.entries(mapping)) {
      const column = columnById.get(columnId);
      if (!column) continue;
      const fieldType = getColumnFieldType(column, registry);
      if (!fieldType) {
        failuresForRow.push({ rowIndex, columnId, message: "No field type registered for column" });
        continue;
      }
      const parsed = fieldType.parse(raw[sourceHeader], column.config);
      if (!parsed.ok) {
        failuresForRow.push({ rowIndex, columnId, message: parsed.error });
        continue;
      }
      const validated = fieldType.valueSchema(column.config).safeParse(parsed.value);
      if (!validated.success) {
        failuresForRow.push({
          rowIndex,
          columnId,
          message: validated.error.issues[0]?.message ?? "Invalid value",
        });
        continue;
      }
      cells[keyByColumnId.get(columnId) as string] = validated.data;
    }

    if (failuresForRow.length > 0) {
      report.failed.push(...failuresForRow);
    } else {
      batch.push({ rowIndex, cells });
    }

    if (batch.length >= batchSize) {
      await flush();
      if (signal?.aborted) break;
    }
  }

  await flush();

  return report;
}
