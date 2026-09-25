/**
 * Core shim: the ONLY file in this package allowed to depend on
 * `@masai/schema-grid-core`. Everything else imports core types/helpers from
 * here. Only TYPES are imported from core, so runtime bundles (notably
 * `./clipboard`) never pull core code in.
 */

export type {
  Access,
  ActorRef,
  AnyFieldType,
  BuiltinFieldTypeId,
  CellChange,
  ChangeBatch,
  ChangeConflict,
  ChangeResult,
  ChangeSource,
  ColumnDef,
  ColumnPermissions,
  FieldType,
  FieldTypeId,
  FieldTypeRegistry,
  GridRow,
  GridSchema,
  Option,
  ParseResult,
  RoleRule,
} from "@masai/schema-grid-core";
import type {
  AnyFieldType,
  ColumnDef,
  FieldTypeRegistry,
  GridSchema,
} from "@masai/schema-grid-core";

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
