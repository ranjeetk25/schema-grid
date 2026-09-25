/** True for a non-null, non-array object (i.e. a plausible config record). */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merges a possibly partial/garbage runtime `config` onto `defaultConfig`.
 * Persisted config JSON may be stale or incomplete (fields added after a
 * column was created) or outright malformed, so every `FieldType` method
 * should resolve its config through this before reading any field from it.
 */
export function resolveConfig<T extends object>(defaultConfig: T, config: unknown): T {
  return { ...defaultConfig, ...(isPlainObject(config) ? config : {}) } as T;
}
