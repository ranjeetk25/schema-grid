import { SchemaValidationError } from "../errors";

/** Column keys become JSON paths and `gc_<key>` / `idx_gc_<key>` identifiers (≤ 64 chars). */
export const SAFE_COLUMN_KEY = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

export function isSafeColumnKey(key: string): boolean {
  return SAFE_COLUMN_KEY.test(key);
}

export function assertSafeColumnKey(key: string, columnId?: string): string {
  if (!isSafeColumnKey(key)) {
    throw new SchemaValidationError([
      {
        code: "unsafeKey",
        path: ["key"],
        message: `Column key "${key}" must match ${SAFE_COLUMN_KEY.source}`,
        ...(columnId ? { columnId } : {}),
      },
    ]);
  }
  return key;
}

const SAFE_SUB_PATH = /^(\[\*\])?(\.?[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * `$.key`, `$.key.id` (subPath "id" or ".id") or `$.key[*].id` (subPath "[*].id").
 * The key is validated; the result is safe to inline as a JSON path literal.
 */
export function jsonPath(key: string, subPath?: string): string {
  assertSafeColumnKey(key);
  if (!subPath) return `$.${key}`;
  if (!SAFE_SUB_PATH.test(subPath)) throw new Error(`Unsafe JSON sub-path "${subPath}"`);
  const sp = subPath.startsWith("[") || subPath.startsWith(".") ? subPath : `.${subPath}`;
  return `$.${key}${sp}`;
}

export function generatedColumnName(key: string): string {
  return `gc_${assertSafeColumnKey(key)}`;
}

export function generatedIndexName(key: string): string {
  return `idx_gc_${assertSafeColumnKey(key)}`;
}
