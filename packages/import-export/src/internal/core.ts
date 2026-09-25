/**
 * Core shim: the ONLY file in this package allowed to depend on
 * `@masai/schema-grid-core`. Everything else imports core types/helpers from here.
 *
 * Core is being built concurrently and currently exposes only a placeholder, so
 * every contract below is a local alias matching spec §4 (and the core plan).
 * Each alias carries a `TODO(core)` marker; when core ships the export, replace
 * the local declaration with a re-export from `@masai/schema-grid-core`.
 */

// ---------------------------------------------------------------------------
// Field type ids
// ---------------------------------------------------------------------------

// TODO(core): replace with @masai/schema-grid-core export (BuiltinFieldTypeId)
export type BuiltinFieldTypeId =
  | "text"
  | "longText"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "multiSelect"
  | "creatableSelect"
  | "user"
  | "url"
  | "email"
  | "phone"
  | "link"
  | "formula";

// TODO(core): replace with @masai/schema-grid-core export (FieldTypeId)
export type FieldTypeId = BuiltinFieldTypeId | (string & {});

// ---------------------------------------------------------------------------
// Schema (spec §4.1)
// ---------------------------------------------------------------------------

// TODO(core): replace with @masai/schema-grid-core export (ActorRef)
export interface ActorRef {
  id: string;
  name?: string;
}

// TODO(core): replace with @masai/schema-grid-core export (Option)
export interface Option {
  id: string;
  label: string;
  color?: string;
}

// TODO(core): replace with @masai/schema-grid-core export (RoleRule)
export type RoleRule = "all" | { roles: string[] };

// TODO(core): replace with @masai/schema-grid-core export (ColumnPermissions)
export interface ColumnPermissions {
  read: RoleRule;
  edit: RoleRule;
}

// TODO(core): replace with @masai/schema-grid-core export (ColumnDef)
export interface ColumnDef {
  id: string;
  key: string;
  label: string;
  type: FieldTypeId;
  /** Validated by the field type's configSchema. */
  config: unknown;
  required?: boolean;
  defaultValue?: unknown;
  validation?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    message?: string;
  };
  permissions?: ColumnPermissions;
  width?: number;
  pinned?: "left" | "right" | null;
  hidden?: boolean;
  order: number;
  indexed?: boolean;
  formula?: string;
  source?: { valueField: string };
  createdAt: string;
  updatedAt: string;
}

// TODO(core): replace with @masai/schema-grid-core export (GridSchema)
export interface GridSchema {
  id: string;
  schemaVersion: number;
  columns: ColumnDef[];
  views?: unknown[];
}

// ---------------------------------------------------------------------------
// Rows and changes (spec §4.5)
// ---------------------------------------------------------------------------

// TODO(core): replace with @masai/schema-grid-core export (GridRow)
export interface GridRow {
  id: string;
  version: number;
  updatedAt: string;
  updatedBy?: ActorRef;
  /** Keyed by ColumnDef.key. */
  cells: Record<string, unknown>;
}

// TODO(core): replace with @masai/schema-grid-core export (CellChange)
export interface CellChange {
  rowId: string;
  columnId: string;
  prev: unknown;
  next: unknown;
}

// TODO(core): replace with @masai/schema-grid-core export (ChangeSource)
export type ChangeSource =
  | "edit"
  | "paste"
  | "fill"
  | "undo"
  | "redo"
  | "import";

// TODO(core): replace with @masai/schema-grid-core export (ChangeBatch)
export interface ChangeBatch {
  id: string;
  changes: CellChange[];
  baseVersions: Record<string, number>;
  source: ChangeSource;
}

// TODO(core): replace with @masai/schema-grid-core export (ChangeConflict)
export interface ChangeConflict {
  rowId: string;
  columnId: string;
  serverValue: unknown;
  serverVersion: number;
  updatedBy?: ActorRef;
  updatedAt: string;
}

// TODO(core): replace with @masai/schema-grid-core export (ChangeResult)
export interface ChangeResult {
  applied: CellChange[];
  conflicts: ChangeConflict[];
  errors: { rowId: string; columnId: string; message: string }[];
}

// ---------------------------------------------------------------------------
// Field types (spec §4.2) — only the members this package relies on are typed
// precisely; the rest are optional so a real core FieldType is assignable.
// ---------------------------------------------------------------------------

// TODO(core): replace with @masai/schema-grid-core export (ParseResult)
export type ParseResult<T> =
  | { ok: true; value: T; pendingOptions?: string[]; warnings?: string[] }
  | { ok: false; error: string };

// TODO(core): replace with @masai/schema-grid-core export (FieldType)
export interface FieldType<TValue = unknown, TConfig = unknown> {
  id: FieldTypeId;
  label: string;
  defaultConfig: TConfig;
  /** Never throws. */
  parse(input: unknown, config: TConfig): ParseResult<TValue | null>;
  format(value: TValue | null | undefined, config: TConfig): string;
  serialize(value: TValue | null): unknown;
  deserialize(raw: unknown): TValue | null;
  compare(a: TValue | null, b: TValue | null, config: TConfig): number;
  defaultValue(config: TConfig): TValue | null;
  // biome-ignore lint/suspicious/noExplicitAny: zod schema types are core's concern
  configSchema?: any;
  // biome-ignore lint/suspicious/noExplicitAny: zod schema types are core's concern
  valueSchema?: (config: TConfig) => any;
  operators?: unknown[];
  aggregations?: string[];
}

// TODO(core): replace with @masai/schema-grid-core export (AnyFieldType)
// biome-ignore lint/suspicious/noExplicitAny: erased field type, as in core
export type AnyFieldType = FieldType<any, any>;

// TODO(core): replace with @masai/schema-grid-core export (FieldTypeRegistry)
export interface FieldTypeRegistry {
  register(type: AnyFieldType): void;
  /** Returns undefined for an unknown id. */
  get(id: string): AnyFieldType | undefined;
  list(): AnyFieldType[];
  has(id: string): boolean;
}

// ---------------------------------------------------------------------------
// Permissions (spec §4.7)
// ---------------------------------------------------------------------------

// TODO(core): replace with @masai/schema-grid-core export (Access)
export type Access = "hidden" | "read" | "edit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type UnwrappedParse =
  | { ok: true; value: unknown; pendingOptions?: string[] }
  | { ok: false; error: string };

function messageOf(err: unknown): string {
  if (typeof err === "string" && err.length > 0) return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return "Invalid value";
}

/**
 * Normalises whatever a field type's `parse` returned into a stable shape, so
 * callers don't depend on core's exact ParseResult spelling.
 */
export function unwrapParse(result: unknown): UnwrappedParse {
  if (!result || typeof result !== "object") {
    return { ok: false, error: "Invalid value" };
  }
  const r = result as Record<string, unknown>;
  const ok = r.ok ?? r.success;
  if (ok === true) {
    const value = "value" in r ? r.value : r.data;
    const pending = Array.isArray(r.pendingOptions)
      ? r.pendingOptions.filter((p): p is string => typeof p === "string")
      : undefined;
    return pending && pending.length > 0
      ? { ok: true, value: value ?? null, pendingOptions: pending }
      : { ok: true, value: value ?? null };
  }
  return { ok: false, error: messageOf(r.error) };
}

/** Look up a column's field type, or undefined for an unknown type id. */
export function getColumnFieldType(
  column: ColumnDef,
  registry: FieldTypeRegistry,
): AnyFieldType | undefined {
  return registry.get(column.type);
}

export interface SelectOption {
  /** Option id (the stored value). */
  value: string;
  label: string;
}

/**
 * Reads `config.options` defensively. Accepts `{ id, label }` (core shape),
 * `{ value, label }`, or bare strings.
 */
// TODO(core): replace with a core option accessor once one is exported
export function getSelectOptions(column: ColumnDef): SelectOption[] {
  const config = column.config;
  if (!config || typeof config !== "object") return [];
  const options = (config as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  const out: SelectOption[] = [];
  for (const o of options) {
    if (typeof o === "string") {
      out.push({ value: o, label: o });
      continue;
    }
    if (!o || typeof o !== "object") continue;
    const rec = o as Record<string, unknown>;
    const id = rec.id ?? rec.value;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const label = typeof rec.label === "string" ? rec.label : String(id);
    out.push({ value: String(id), label });
  }
  return out;
}

export interface NumericFormatConfig {
  /** Digits after the decimal point, when configured. */
  precision?: number;
  /** ISO 4217 code for currency columns. */
  currencyCode?: string;
}

/**
 * Reads number/currency formatting config defensively
 * (core plan: number `{ precision }`, currency `{ currencyCode, precision }`).
 */
// TODO(core): replace once core's number/currency config types are exported
export function getNumericConfig(column: ColumnDef): NumericFormatConfig {
  const config = column.config;
  if (!config || typeof config !== "object") return {};
  const rec = config as Record<string, unknown>;
  const out: NumericFormatConfig = {};
  const p = rec.precision ?? rec.decimals;
  if (typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 10) {
    out.precision = p;
  }
  const c = rec.currencyCode ?? rec.currency;
  if (typeof c === "string" && c.length > 0) out.currencyCode = c;
  return out;
}

/** Normalises `GridSchema | ColumnDef[]` to a column list. */
export function columnsOf(schema: GridSchema | ColumnDef[]): ColumnDef[] {
  return Array.isArray(schema) ? schema : schema.columns;
}
