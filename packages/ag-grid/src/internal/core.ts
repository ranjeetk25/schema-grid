/**
 * The ONLY place `@masai/schema-grid-core` is consumed from.
 *
 * Mostly straight re-exports of the real core. A few thin adapters keep this
 * package's call sites stable; each is marked `ADAPTER` with the reason.
 * Genuinely local pieces (not in core) are marked `LOCAL`.
 *
 * Sections:
 *   1. Types (§4.1, §4.4–§4.7)
 *   2. Field types + registry (§4.2)
 *   3. Filter AST, validation, relative dates, matching (§4.3)
 *   4. Sort / search / aggregate
 *   5. Permissions (§4.7)
 *   6. Formula engine (§4.8)
 *   7. Events (§4.9)
 *   8. IO bridge (import-export package)
 */

import {
  type AnyFieldType,
  type ChangeResult as CoreChangeResult,
  type ColumnDef,
  type FieldTypeRegistry,
  type FilterNode,
  type FilterOperatorDef,
  type FilterValidationError,
  type FormulaError,
  type FormulaErrorCode,
  type GridEvents,
  type GridRow,
  type GridSchema,
  type PermissionUser,
  type ChangeBatch,
  type ChangeConflict,
  type ChangeFeedEntry,
  type Option,
  type ViewDef,
  DEFAULT_TIME_ZONE,
  matchesFilter as coreMatchesFilter,
  validateFilter as coreValidateFilter,
} from "@masai/schema-grid-core";
import {
  compareWithEmptyLast,
  createDefaultRegistry,
  getColumnValueFieldType,
  isEmptyValue,
  resolveFormulaOperandTypeId,
} from "@masai/schema-grid-core/field-types";

// ============================================================================
// 1. Types
// ============================================================================

export {
  SCHEMA_GRID_CORE_VERSION,
  BUILTIN_FIELD_TYPE_IDS,
  BUILTIN_FIELD_TYPE_IDS as BUILT_IN_FIELD_TYPE_IDS,
} from "@masai/schema-grid-core";

export type {
  ActorRef,
  AggregationId,
  BuiltinFieldTypeId,
  BuiltinFieldTypeId as BuiltInFieldTypeId,
  CellChange,
  ChangeBatch,
  ChangeConflict,
  ChangeConflict as CellConflict,
  ChangeError,
  ChangeError as CellError,
  ChangeFeedEntry,
  ChangeSource,
  ColumnDef,
  ColumnPermissions,
  ColumnState,
  ColumnState as ViewColumnState,
  DataSource,
  FieldTypeId,
  GridQuery,
  GridRow,
  GridSchema,
  GroupAggregateValue,
  GroupResult,
  GroupSpec,
  LinkRef,
  Option,
  PageRequest,
  QueryResult,
  RoleRule,
  RowPartial,
  SortSpec,
  UserRef,
  ViewDef,
} from "@masai/schema-grid-core";

/**
 * ADAPTER: core's ChangeResult plus an optional per-row version map.
 * TODO(core): propose `versions` for spec §4.5 — when absent the edit
 * controller assumes `baseVersion + 1` per applyChanges call.
 */
export interface ChangeResult extends CoreChangeResult {
  versions?: Record<string, number>;
}

export type Pinned = "left" | "right" | null;

// ============================================================================
// 2. Field types
// ============================================================================

export type { AnyFieldType, FieldTypeRegistry, ParseResult } from "@masai/schema-grid-core";
export type { FieldType } from "@masai/schema-grid-core";
export {
  builtinFieldTypes,
  compareWithEmptyLast,
  createDefaultRegistry,
  createFieldTypeRegistry,
  getColumnAggregations,
  getColumnFieldType,
  getColumnOperators,
  getColumnValueFieldType,
  isEmptyValue,
  resolveFormulaOperandTypeId,
  type CurrencyConfig,
  type FormulaConfig,
  type NumberConfig,
  type SelectConfig,
} from "@masai/schema-grid-core/field-types";

/** Module-level registry used where only the built-ins are needed. */
let builtinRegistry: FieldTypeRegistry | undefined;
function builtins(): FieldTypeRegistry {
  builtinRegistry ??= createDefaultRegistry();
  return builtinRegistry;
}

/**
 * ADAPTER: operators for a column given its (possibly formula) field type.
 * Formula columns use their `config.resultType`'s operators.
 */
export function operatorsFor(fieldType: AnyFieldType, column: ColumnDef): readonly FilterOperatorDef[] {
  if (column.type === "formula") {
    const rt = (column.config as { resultType?: string } | null | undefined)?.resultType;
    return builtins().get(resolveFormulaOperandTypeId(rt))?.operators ?? [];
  }
  return fieldType.operators;
}

/** ADAPTER: the field type governing a column's values (formula → result type). */
export function effectiveFieldType(registry: FieldTypeRegistry, column: ColumnDef): AnyFieldType | undefined {
  return getColumnValueFieldType(column, registry);
}

// ============================================================================
// 3. Filter AST
// ============================================================================

export type {
  DateRange,
  FilterCondition,
  FilterGroup,
  FilterMeValue,
  FilterNode,
  FilterOperatorDef,
  FilterPrimitive,
  FilterRangeValue,
  FilterValidationError,
  FilterValidationErrorCode,
  FilterValue,
  FilterValueKind,
  FilterValueKind as ValueKind,
  RelativeDate,
  RelativeDateKind,
  RelativeDateResult,
} from "@masai/schema-grid-core";
export {
  BOOLEAN_OPERATORS,
  DATE_OPERATORS,
  LINK_OPERATORS,
  MAX_FILTER_DEPTH,
  MULTI_SELECT_OPERATORS,
  NEGATIVE_OPERATOR_IDS,
  NUMBER_OPERATORS,
  SELECT_OPERATORS,
  TEXT_OPERATORS,
  USER_OPERATORS,
  findOperator,
  isFilterCondition,
  isFilterGroup,
  isNegativeOperator,
  resolveRelativeDate,
} from "@masai/schema-grid-core";

export const DEFAULT_TZ = DEFAULT_TIME_ZONE;
export { DEFAULT_TIME_ZONE };

/** ADAPTER: accepts an array or a set of readable column ids. */
export function validateFilter(
  node: FilterNode | null,
  schema: GridSchema,
  registry: FieldTypeRegistry,
  readableColumnIds: ReadonlySet<string> | readonly string[],
): FilterValidationError[] {
  const readable = readableColumnIds instanceof Set ? readableColumnIds : new Set(readableColumnIds as readonly string[]);
  return coreValidateFilter(node, schema, registry, readable);
}

export interface MatchContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  user?: { id: string };
  now?: Date;
  tz?: string;
  /** Override cell reads (e.g. to supply computed formula values). */
  getCellValue?(row: GridRow, column: ColumnDef): unknown;
}

/** LOCAL: read a cell, honouring an override (formula values). */
export function readCell(row: GridRow, column: ColumnDef, ctx?: Pick<MatchContext, "getCellValue">): unknown {
  return ctx?.getCellValue ? ctx.getCellValue(row, column) : row.cells[column.key];
}

/**
 * ADAPTER over core `matchesFilter(node, row, ctx)`: keeps this package's
 * `(row, node, ctx)` argument order, optional now/tz, and lets callers supply
 * computed formula values (core reads `row.cells` directly).
 */
export function matchesFilter(row: GridRow, node: FilterNode | null, ctx: MatchContext): boolean {
  if (!node) return true;
  let target = row;
  if (ctx.getCellValue) {
    const formulaCols = ctx.schema.columns.filter((c) => c.type === "formula");
    if (formulaCols.length > 0) {
      const cells = { ...row.cells };
      for (const c of formulaCols) cells[c.key] = ctx.getCellValue(row, c);
      target = { ...row, cells };
    }
  }
  return coreMatchesFilter(node, target, {
    schema: ctx.schema,
    registry: ctx.registry,
    now: ctx.now ?? new Date(),
    tz: ctx.tz ?? DEFAULT_TIME_ZONE,
    ...(ctx.user ? { userId: ctx.user.id } : {}),
  });
}

// ============================================================================
// 4. Sort / search / aggregate
// ============================================================================

export { computeAggregate, isAggregationAllowed, UNIVERSAL_AGGREGATIONS } from "@masai/schema-grid-core";

export interface SortContext {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  getCellValue?(row: GridRow, column: ColumnDef): unknown;
}

/** LOCAL (core has no public sortRows): compare two cells, empties last in both directions. */
export function compareCells(
  a: unknown,
  b: unknown,
  column: ColumnDef,
  registry: FieldTypeRegistry,
  dir: "asc" | "desc" = "asc",
): number {
  const ft = registry.get(column.type);
  const sign = dir === "desc" ? -1 : 1;
  const ea = isEmptyValue(a);
  const eb = isEmptyValue(b);
  if (ea || eb) return compareWithEmptyLast(a, b, () => 0);
  let c = 0;
  try {
    c = ft ? ft.compare(a, b, column.config) : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  } catch {
    c = 0;
  }
  return c * sign;
}

/**
 * LOCAL: stable multi-key sort matching core's in-memory data source — empties
 * last in both directions, row id (code-unit order) as the final tie-break,
 * so an empty sort orders rows by id.
 */
export function sortRows<Row extends GridRow>(rows: readonly Row[], sort: readonly { columnId: string; dir: "asc" | "desc" }[], ctx: SortContext): Row[] {
  const keys = sort
    .map((s) => ({ dir: s.dir, column: ctx.schema.columns.find((c) => c.id === s.columnId) }))
    .filter((k): k is { dir: "asc" | "desc"; column: ColumnDef } => !!k.column);
  return [...rows].sort((a, b) => {
    for (const { dir, column } of keys) {
      const c = compareCells(readCell(a, column, ctx), readCell(b, column, ctx), column, ctx.registry, dir);
      if (c !== 0) return c;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** LOCAL: case-insensitive search over formatted readable values (core in-memory semantics). */
export function searchRows<Row extends GridRow>(
  rows: readonly Row[],
  search: string | undefined,
  ctx: SortContext & { readableColumnIds?: ReadonlySet<string> },
): Row[] {
  const needle = (search ?? "").trim().toLowerCase();
  if (!needle) return [...rows];
  const cols = ctx.schema.columns.filter((c) => !ctx.readableColumnIds || ctx.readableColumnIds.has(c.id));
  return rows.filter((row) =>
    cols.some((col) => {
      const v = readCell(row, col, ctx);
      if (isEmptyValue(v)) return false;
      const ft = ctx.registry.get(col.type);
      let text: string;
      try {
        text = ft ? ft.format(v, col.config) : String(v);
      } catch {
        text = String(v);
      }
      return text.toLowerCase().includes(needle);
    }),
  );
}

// ============================================================================
// 5. Permissions
// ============================================================================

export type { Access, PermissionUser } from "@masai/schema-grid-core";
export {
  createRolePermissionResolver,
  editableColumnIds,
  readableColumnIds,
  resolveColumnAccess,
  type RolePermissionResolverOptions,
} from "@masai/schema-grid-core";

/** Alias kept for this package's call sites. */
export type GridUser = PermissionUser;

/**
 * ADAPTER: core's PermissionContext/Resolver are not generic; the `Row`
 * parameter is kept (unused) so call sites can stay generic.
 */
export type PermissionContext<_Row extends GridRow = GridRow> = import("@masai/schema-grid-core").PermissionContext;
export type PermissionResolver<_Row extends GridRow = GridRow> = import("@masai/schema-grid-core").PermissionResolver;

// ============================================================================
// 6. Formula engine
// ============================================================================

export type {
  FormulaEnv,
  FormulaError,
  FormulaErrorCode,
  FormulaNode,
  FormulaNode as FormulaAst,
  FormulaResultType,
  FormulaValue,
} from "@masai/schema-grid-core";
export {
  dependencies,
  detectFormulaCycles,
  evaluate,
  getFormulaEvaluationOrder,
  inferResultType,
  isFormulaError,
  parseFormula,
  validateFormulaColumns,
} from "@masai/schema-grid-core";

/** LOCAL: build a core-shaped FormulaError value (core's is a plain object). */
export function formulaError(message: string, code: FormulaErrorCode = "eval"): FormulaError {
  return { kind: "formulaError", code, message };
}

// ============================================================================
// 7. Events
// ============================================================================

export type { GridEventName, GridEvents } from "@masai/schema-grid-core";

export type ConflictResolution = "keepTheirs" | "overwrite";

/**
 * LOCAL extension of core `GridEvents` (§4.9). Differences, by design:
 * - `beforeCellsChange` may also return synchronously.
 * - `onCellsChange` also receives the batch.
 * - `onConflict` is called once per conflicting cell with a `resolve`
 *   callback (core's shape is `onConflict(conflicts[])` with no resolution).
 * - `onSchemaChanged` is emitted when the change feed reports a new schema version.
 */
export interface SchemaGridEvents<Row extends GridRow = GridRow>
  extends Omit<GridEvents<Row>, "beforeCellsChange" | "onCellsChange" | "onConflict" | "onOptionCreate" | "onViewChange" | "onRemoteChanges"> {
  beforeCellsChange?(batch: ChangeBatch): ChangeBatch | false | Promise<ChangeBatch | false>;
  onCellsChange?(result: ChangeResult, batch: ChangeBatch): void;
  onOptionCreate?(columnId: string, option: Option): void;
  onViewChange?(view: ViewDef): void;
  onConflict?(conflict: ChangeConflict, resolve: (resolution: ConflictResolution) => Promise<void>): void;
  onRemoteChanges?(entry: ChangeFeedEntry<Row>): void;
  onSchemaChanged?(schemaVersion: number): void;
}

// ============================================================================
// 8. IO bridge — TODO(io): replace with @masai/schema-grid-io exports once the
//    import-export plan ships `writeCsv` / `writeXlsx`.
// ============================================================================

export interface IoExportColumn {
  id: string;
  key: string;
  label: string;
  type: string;
}

export interface IoWriteInput {
  columns: IoExportColumn[];
  /** Already-formatted text cells, one array per row, in `columns` order. */
  rows: string[][];
  fileName?: string;
}

export interface IoModule {
  writeCsv(input: IoWriteInput): Blob | string | Promise<Blob | string>;
  writeXlsx(input: IoWriteInput): Blob | ArrayBuffer | Uint8Array | Promise<Blob | ArrayBuffer | Uint8Array>;
}

const IO_PACKAGE = "@masai/schema-grid-io";

/** Dynamically loads the optional io package; throws a clear error when absent. */
export async function loadIoModule(): Promise<IoModule> {
  let mod: Partial<IoModule>;
  try {
    mod = (await import(/* @vite-ignore */ IO_PACKAGE)) as Partial<IoModule>;
  } catch {
    throw new Error(`XLSX/CSV file export requires the optional peer dependency "${IO_PACKAGE}". Install it to enable exports.`);
  }
  if (typeof mod.writeCsv !== "function" || typeof mod.writeXlsx !== "function") {
    throw new Error(`"${IO_PACKAGE}" is installed but does not export writeCsv/writeXlsx yet.`);
  }
  return mod as IoModule;
}
