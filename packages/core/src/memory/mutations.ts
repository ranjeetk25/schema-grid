import type { ActorRef } from "../common/types";
import type { RowPartial } from "../datasource/types";
import { isEmptyValue } from "../field-types/empty";
import type { FieldTypeRegistry } from "../field-types/registry";
import type { FormulaEnv } from "../formula/types";
import { optionRuleViolation } from "../permissions/option-rules";
import type { Access, PermissionUser } from "../permissions/types";
import type {
  CellChange,
  ChangeBatch,
  ChangeConflict,
  ChangeError,
  ChangeResult,
  GridRow,
} from "../rows/types";
import { getColumnById } from "../schema/lookup";
import type { ColumnDef, GridSchema } from "../schema/types";

export interface MutationDeps<Row extends GridRow> {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  store: Map<string, Row>;
  access: ReadonlyMap<string, Access>;
  env: FormulaEnv;
  actor?: ActorRef;
  /** The acting user, for per-option `settableBy` rules. Absent → every option is settable. */
  user?: PermissionUser;
  generateId: () => string;
  /** Called once per row that changed (created, updated or deleted). */
  onRowChanged?: (rowId: string, deleted: boolean) => void;
}

/** What `validateCellValue` needs beyond the value for user-aware rules. */
export interface ValidateCellContext {
  /** The acting user; enables `Option.settableBy` checks. */
  user?: PermissionUser;
  /** The cell's current value: option ids already present are never re-checked. */
  prev?: unknown;
}

/**
 * Validates a value for a column: required, field-type valueSchema,
 * ColumnDef.validation and (with `ctx.user`) per-option `settableBy` rules.
 */
export function validateCellValue(
  column: ColumnDef,
  value: unknown,
  registry: FieldTypeRegistry,
  ctx: ValidateCellContext = {},
): string | null {
  if (column.required && isEmptyValue(value)) return "A value is required";
  const type = registry.get(column.type);
  if (!type) return `Unknown field type "${column.type}"`;
  const v = column.validation;
  const config =
    v && typeof column.config === "object" && column.config !== null
      ? { ...(column.config as Record<string, unknown>), ...pickLimits(v) }
      : v
        ? pickLimits(v)
        : column.config;
  let result: { success: boolean; error?: { issues?: { message: string }[] } };
  try {
    result = type.valueSchema(config).safeParse(value);
  } catch {
    return "Invalid value";
  }
  if (!result.success) return v?.message ?? result.error?.issues?.[0]?.message ?? "Invalid value";
  if (v?.pattern && typeof value === "string" && value !== "") {
    try {
      if (!new RegExp(v.pattern).test(value)) return v.message ?? "Value does not match the required pattern";
    } catch {
      // An invalid pattern in the schema is ignored rather than blocking edits.
    }
  }
  return optionRuleViolation(column, value, ctx.user, { prev: ctx.prev });
}

function pickLimits(v: NonNullable<ColumnDef["validation"]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of ["min", "max", "minLength", "maxLength"] as const) {
    const n = v[k];
    if (typeof n === "number") out[k] = n;
  }
  return out;
}

function editProblem(column: ColumnDef, access: Access | undefined): string | null {
  // Hidden first, so hidden columns (formula or not) are indistinguishable from missing ones.
  if (access !== "read" && access !== "edit") return "Column not found";
  if (column.type === "formula") return "Formula columns are read-only";
  if (access === "read") return "Column is read-only for you";
  return null;
}

/**
 * Applies a change batch with optimistic version checks:
 * - per-change problems (missing row/column, not editable, invalid value,
 *   rowId missing from baseVersions) become `errors`;
 * - a row whose base version differs from the server's turns every change on
 *   it into a `conflict` (other rows still apply);
 * - each changed row's version bumps exactly once per batch and formulas
 *   are re-materialised; `versions` reports each written row's new version.
 */
export function applyChangeBatch<Row extends GridRow>(batch: ChangeBatch, deps: MutationDeps<Row>): ChangeResult {
  const applied: CellChange[] = [];
  const conflicts: ChangeConflict[] = [];
  const errors: ChangeError[] = [];
  const versions: Record<string, number> = {};
  const byRow = new Map<string, CellChange[]>();
  for (const change of Array.isArray(batch?.changes) ? batch.changes : []) {
    const list = byRow.get(change.rowId);
    if (list) list.push(change);
    else byRow.set(change.rowId, [change]);
  }
  const baseVersions = batch?.baseVersions ?? {};

  for (const [rowId, changes] of byRow) {
    const row = deps.store.get(rowId);
    const fail = (change: CellChange, message: string) =>
      errors.push({ rowId, columnId: change.columnId, message });
    if (!row) {
      for (const c of changes) fail(c, "Row not found");
      continue;
    }
    const base = Object.hasOwn(baseVersions, rowId) ? baseVersions[rowId] : undefined;

    const valid: { change: CellChange; column: ColumnDef }[] = [];
    for (const change of changes) {
      const column = getColumnById(deps.schema, change.columnId);
      if (!column) {
        fail(change, "Column not found");
        continue;
      }
      const problem = editProblem(column, deps.access.get(column.id));
      if (problem) {
        fail(change, problem);
        continue;
      }
      if (base === undefined) {
        fail(change, "Missing base version for row");
        continue;
      }
      const invalid = validateCellValue(column, change.next, deps.registry, {
        ...(deps.user ? { user: deps.user } : {}),
        prev: row.cells[column.key],
      });
      if (invalid) {
        fail(change, invalid);
        continue;
      }
      valid.push({ change, column });
    }
    if (valid.length === 0) continue;

    if (base !== row.version) {
      for (const { change, column } of valid) {
        const conflict: ChangeConflict = {
          rowId,
          columnId: change.columnId,
          serverValue: structuredClone(row.cells[column.key] ?? null),
          serverVersion: row.version,
          updatedAt: row.updatedAt,
        };
        if (row.updatedBy) conflict.updatedBy = structuredClone(row.updatedBy);
        if (change.meta) conflict.meta = structuredClone(change.meta);
        conflicts.push(conflict);
      }
      continue;
    }

    for (const { change, column } of valid) {
      const prev = structuredClone(row.cells[column.key] ?? null);
      const next = structuredClone(change.next ?? null);
      row.cells[column.key] = next;
      applied.push({
        rowId,
        columnId: change.columnId,
        prev,
        next: structuredClone(next),
        ...(change.meta ? { meta: structuredClone(change.meta) } : {}),
      });
    }
    row.version += 1;
    versions[rowId] = row.version;
    row.updatedAt = deps.env.now.toISOString();
    if (deps.actor) row.updatedBy = structuredClone(deps.actor);
    deps.onRowChanged?.(rowId, false);
  }
  return { applied, conflicts, errors, versions };
}

/** Error thrown (as a rejection) when createRows receives an invalid partial. */
export class InMemoryMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InMemoryMutationError";
  }
}

/**
 * Creates rows: type default → ColumnDef.defaultValue → partial value.
 * Throws InMemoryMutationError (nothing is inserted) if any partial is invalid.
 */
export function createStoreRows<Row extends GridRow>(partials: RowPartial<Row>[], deps: MutationDeps<Row>): Row[] {
  const byKey = new Map(deps.schema.columns.map((c) => [c.key, c]));
  const pendingIds = new Set<string>();
  const created: Row[] = [];
  for (const [i, partial] of (Array.isArray(partials) ? partials : []).entries()) {
    const id = partial?.id ?? nextFreeId(deps, pendingIds);
    if (typeof id !== "string" || id === "" || deps.store.has(id) || pendingIds.has(id)) {
      throw new InMemoryMutationError(`Row ${i}: id "${String(id)}" is invalid or already exists`);
    }
    pendingIds.add(id);
    const provided = (partial?.cells ?? {}) as Record<string, unknown>;
    const cells: Record<string, unknown> = {};
    for (const column of deps.schema.columns) {
      if (column.type === "formula") continue;
      const type = deps.registry.get(column.type);
      let value: unknown = type ? type.defaultValue(column.config) : null;
      if (column.defaultValue !== undefined) value = structuredClone(column.defaultValue);
      const access = deps.access.get(column.id);
      if (Object.hasOwn(provided, column.key)) {
        const problem = editProblem(column, access);
        if (problem) throw new InMemoryMutationError(`Row ${i}, column "${column.key}": ${problem}`);
        value = structuredClone(provided[column.key]);
      }
      // Only editable columns are validated: the user can't supply values for
      // the others, and errors must not reveal hidden columns.
      if (access === "edit") {
        const invalid = validateCellValue(column, value, deps.registry, deps.user ? { user: deps.user } : {});
        if (invalid) throw new InMemoryMutationError(`Row ${i}, column "${column.key}": ${invalid}`);
      }
      cells[column.key] = value ?? null;
    }
    for (const key of Object.keys(provided)) {
      const column = byKey.get(key);
      const problem = column ? editProblem(column, deps.access.get(column.id)) : "Column not found";
      if (problem) throw new InMemoryMutationError(`Row ${i}, column "${key}": ${problem}`);
    }
    const row = {
      id,
      version: 1,
      updatedAt: deps.env.now.toISOString(),
      ...(deps.actor ? { updatedBy: structuredClone(deps.actor) } : {}),
      cells,
    } as unknown as Row;
    created.push(row);
  }
  for (const row of created) {
    deps.store.set(row.id, row);
    deps.onRowChanged?.(row.id, false);
  }
  return created;
}

function nextFreeId<Row extends GridRow>(deps: MutationDeps<Row>, pending: Set<string>): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = deps.generateId();
    if (!deps.store.has(id) && !pending.has(id)) return id;
  }
  throw new InMemoryMutationError("generateId keeps returning ids that already exist");
}

/** Removes rows; unknown ids are ignored. */
export function deleteStoreRows<Row extends GridRow>(ids: string[], deps: MutationDeps<Row>): void {
  for (const id of Array.isArray(ids) ? ids : []) {
    if (deps.store.delete(id)) deps.onRowChanged?.(id, true);
  }
}
