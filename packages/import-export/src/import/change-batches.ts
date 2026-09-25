import {
  type AnyFieldType,
  type CellChange,
  type ChangeBatch,
  type ColumnDef,
  type FieldTypeRegistry,
  type GridRow,
  type GridSchema,
  columnsOf,
  getColumnFieldType,
} from "../internal/core";
import type {
  CellValidation,
  ImportMode,
  ImportPlan,
  ImportRowError,
  RowValidation,
  ValidationReport,
} from "./types";

export interface ToChangeBatchesOptions {
  schema: GridSchema | ColumnDef[];
  registry: FieldTypeRegistry;
  mode: ImportMode;
  keyColumnId?: string;
  /** Max distinct rows per update ChangeBatch. Default 500. */
  chunkSize?: number;
  /** Batch id generator. Default `globalThis.crypto.randomUUID()`. */
  idFactory?: () => string;
}

function fallbackString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Normalised identity of a key value: the field type's `format`, trimmed and
 * lowercased. The server job runner MUST build `existingRowsByKey` with this
 * same function, and must itself detect existing rows that collide on the same
 * key (two stored rows mapping to one key) rather than silently keeping one.
 * Unknown type or a throwing `format` falls back to the value's string form;
 * null/undefined give "".
 *
 * Only text, longText, email, phone and url columns may be keys (validateRows
 * enforces this): for other types the formatted value is lossy or
 * non-canonical (number/currency precision, datetime time zones, user names,
 * select labels, multiSelect/link lists).
 */
export function keyOf(
  value: unknown,
  column: ColumnDef,
  registry: FieldTypeRegistry,
): string {
  if (value === null || value === undefined) return "";
  const type = getColumnFieldType(column, registry);
  let s: string;
  try {
    const formatted = type ? type.format(value, column.config) : undefined;
    s = typeof formatted === "string" ? formatted : fallbackString(value);
  } catch {
    s = fallbackString(value);
  }
  return s.trim().toLowerCase();
}

/** Splits `items` into consecutive chunks of at most `size`. */
export function chunkRows<T>(items: readonly T[], size = 500): T[][] {
  if (!Number.isFinite(size) || size < 1) {
    throw new RangeError(`chunk size must be >= 1 (got ${size})`);
  }
  const n = Math.floor(size);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

function isEmpty(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual(ra[k], rb[k]));
}

function idOf(v: unknown): unknown {
  if (v && typeof v === "object" && "id" in v) {
    return (v as { id: unknown }).id;
  }
  return v;
}

/**
 * Per-type canonical form used only for no-op detection, so equivalent
 * spellings of the same value (e.g. "…Z" vs "….000Z") are not reported as
 * changes. Returns `undefined` for types without a special rule.
 */
function canonical(typeId: string, v: unknown): unknown {
  if (isEmpty(v)) return null;
  switch (typeId) {
    case "datetime": {
      if (typeof v === "string") {
        const t = Date.parse(v);
        if (!Number.isNaN(t)) return t;
      }
      return v;
    }
    case "number":
    case "currency": {
      if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return v;
    }
    case "user":
      return idOf(v);
    case "link":
      return Array.isArray(v) ? v.map(idOf) : idOf(v);
    case "multiSelect":
      return Array.isArray(v) ? v.map((x) => String(x)).sort() : v;
    default:
      return undefined;
  }
}

const CANONICAL_TYPES = new Set([
  "datetime",
  "number",
  "currency",
  "user",
  "link",
  "multiSelect",
]);

/** True when importing `next` over `prev` would not change the stored value. */
function sameValue(
  column: ColumnDef,
  type: AnyFieldType | undefined,
  prev: unknown,
  next: unknown,
): boolean {
  if (isEmpty(prev) && isEmpty(next)) return true;
  if (CANONICAL_TYPES.has(column.type)) {
    return deepEqual(canonical(column.type, prev), canonical(column.type, next));
  }
  return deepEqual(serialized(type, prev), serialized(type, next));
}

function serialized(type: AnyFieldType | undefined, v: unknown): unknown {
  if (!type || typeof type.serialize !== "function") return v;
  try {
    return type.serialize(v ?? null);
  } catch {
    return v;
  }
}

interface RowUpdate {
  row: GridRow;
  sourceRow: number;
  changes: CellChange[];
}

function rejectInvalid(row: RowValidation, rejected: ImportRowError[]): boolean {
  let bad = false;
  for (const [columnId, cell] of Object.entries(row.cells)) {
    if (cell.error !== undefined) {
      rejected.push({ sourceRow: row.sourceRow, columnId, message: cell.error });
      bad = true;
    }
  }
  if (row.rowError !== undefined) {
    rejected.push({ sourceRow: row.sourceRow, message: row.rowError });
    bad = true;
  }
  return bad;
}

/**
 * Turns a validation report into create payloads and update ChangeBatches for
 * the server job runner. Invalid rows are reported in `rejected`.
 */
export function toChangeBatches(
  report: ValidationReport,
  existingRowsByKey: ReadonlyMap<string, GridRow>,
  opts: ToChangeBatchesOptions,
): ImportPlan {
  const chunkSize = opts.chunkSize ?? 500;
  if (!Number.isFinite(chunkSize) || chunkSize < 1) {
    throw new RangeError(`chunkSize must be >= 1 (got ${chunkSize})`);
  }
  const idFactory = opts.idFactory ?? (() => globalThis.crypto.randomUUID());
  const byId = new Map(columnsOf(opts.schema).map((c) => [c.id, c]));
  const keyColumn =
    opts.mode === "create" || !opts.keyColumnId
      ? undefined
      : byId.get(opts.keyColumnId);

  const plan: ImportPlan = {
    creates: [],
    updates: [],
    rejected: [],
    createSourceRows: [],
    updateSourceRows: {},
    unchangedSourceRows: [],
  };
  const rowUpdates: RowUpdate[] = [];
  const claimed = new Set<string>();
  const requiredColumns = [...byId.values()].filter(
    (c) => c.required && c.type !== "formula",
  );
  const unmappedRequired = new Set(report.summary.unmappedRequired);

  /**
   * Required check for every create path (create mode, empty-key upsert and
   * upsert with an unknown key, whose empty cells validateRows marked skip).
   */
  const missingRequired = (row: RowValidation): string[] =>
    requiredColumns
      .filter((c) => {
        const cell = row.cells[c.id];
        if (cell) return cell.skip === true || isEmpty(cell.value);
        return unmappedRequired.has(c.id);
      })
      .map((c) => c.id);

  const pushCreate = (row: RowValidation) => {
    const missing = missingRequired(row);
    if (missing.length > 0) {
      for (const columnId of missing) {
        plan.rejected.push({ sourceRow: row.sourceRow, columnId, message: "Required" });
      }
      return;
    }
    const cells: Record<string, unknown> = {};
    for (const [columnId, cell] of Object.entries(row.cells)) {
      const column = byId.get(columnId);
      if (!column) continue;
      cells[column.key] = cell.skip ? null : (cell.value ?? null);
    }
    plan.creates.push({ cells });
    plan.createSourceRows.push(row.sourceRow);
  };

  for (const row of report.rows) {
    if (rejectInvalid(row, plan.rejected)) continue;

    if (!keyColumn) {
      pushCreate(row);
      continue;
    }

    const keyCell: CellValidation | undefined = row.cells[keyColumn.id];
    const key = keyCell ? keyOf(keyCell.value, keyColumn, opts.registry) : "";
    if (key === "") {
      if (opts.mode === "upsert") pushCreate(row);
      else
        plan.rejected.push({
          sourceRow: row.sourceRow,
          columnId: keyColumn.id,
          message: "Missing key",
        });
      continue;
    }

    const existing = existingRowsByKey.get(key);
    if (!existing) {
      if (opts.mode === "upsert") pushCreate(row);
      else
        plan.rejected.push({
          sourceRow: row.sourceRow,
          columnId: keyColumn.id,
          message: "No existing row for key",
        });
      continue;
    }
    if (claimed.has(existing.id)) {
      plan.rejected.push({
        sourceRow: row.sourceRow,
        columnId: keyColumn.id,
        message: "Duplicate key (matches the same existing row)",
      });
      continue;
    }
    claimed.add(existing.id);

    const changes: CellChange[] = [];
    for (const [columnId, cell] of Object.entries(row.cells)) {
      if (cell.skip || columnId === keyColumn.id) continue;
      const column = byId.get(columnId);
      if (!column) continue;
      const type = getColumnFieldType(column, opts.registry);
      const prev = existing.cells[column.key];
      const next = cell.value ?? null;
      if (sameValue(column, type, prev, next)) continue;
      changes.push({ rowId: existing.id, columnId, prev: prev ?? null, next });
    }
    if (changes.length === 0) {
      plan.unchangedSourceRows.push(row.sourceRow);
      continue;
    }
    rowUpdates.push({ row: existing, sourceRow: row.sourceRow, changes });
    plan.updateSourceRows[existing.id] = row.sourceRow;
  }

  for (const chunk of chunkRows(rowUpdates, chunkSize)) {
    const batch: ChangeBatch = {
      id: idFactory(),
      changes: chunk.flatMap((u) => u.changes),
      baseVersions: Object.fromEntries(chunk.map((u) => [u.row.id, u.row.version])),
      source: "import",
    };
    plan.updates.push(batch);
  }
  return plan;
}
