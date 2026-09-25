import {
  DEFAULT_TZ,
  dependencies,
  evaluate,
  FormulaError,
  isFormulaError,
  parseFormula,
  type ColumnDef,
  type FormulaAst,
  type FormulaEnv,
  type GridRow,
  type GridSchema,
} from "../internal/core";

export interface CompiledFormulas<Row extends GridRow = GridRow> {
  /** columnId → value getter. Never throws: errors are returned as `FormulaError` values. */
  getters: Map<string, (row: Row) => unknown>;
  /** referenced column key → formula column ids depending on it (transitively). */
  dependents: Map<string, string[]>;
  /** columnId → parse error, for formula columns whose formula failed to parse. */
  errors: Map<string, FormulaError>;
}

function defaultEnv(): FormulaEnv {
  return { now: new Date(), tz: DEFAULT_TZ };
}

/**
 * Builds a getter for one formula column from an already-parsed AST (or a
 * parse error). Memoises per row object, so a replaced row recomputes.
 */
export function formulaValueGetter<Row extends GridRow>(
  parsed: FormulaAst | FormulaError,
  schema: GridSchema,
  env: FormulaEnv = defaultEnv(),
): (row: Row) => unknown {
  if (isFormulaError(parsed)) return () => parsed;
  const cache = new WeakMap<Row, unknown>();
  return (row) => {
    if (cache.has(row)) return cache.get(row);
    let value: unknown;
    try {
      value = evaluate(parsed, row, schema, env);
    } catch (e) {
      value = e instanceof FormulaError ? e : new FormulaError(e instanceof Error ? e.message : String(e));
    }
    cache.set(row, value);
    return value;
  };
}

function isFormulaColumn(column: ColumnDef): boolean {
  return column.type === "formula";
}

/** Parses every formula column once and derives getters + the dependents index. */
export function compileFormulaColumns<Row extends GridRow = GridRow>(
  schema: GridSchema,
  env?: FormulaEnv,
): CompiledFormulas<Row> {
  const resolvedEnv = env ?? defaultEnv();
  const getters = new Map<string, (row: Row) => unknown>();
  const errors = new Map<string, FormulaError>();
  const direct = new Map<string, string[]>(); // key → formula column ids referencing it directly
  const keyToFormulaId = new Map<string, string>();

  for (const column of schema.columns) {
    if (!isFormulaColumn(column)) continue;
    keyToFormulaId.set(column.key, column.id);
    const parsed = parseFormula(column.formula ?? "");
    getters.set(column.id, formulaValueGetter<Row>(parsed, schema, resolvedEnv));
    if (isFormulaError(parsed)) {
      errors.set(column.id, parsed);
      continue;
    }
    for (const key of dependencies(parsed)) {
      const list = direct.get(key) ?? [];
      if (!list.includes(column.id)) list.push(column.id);
      direct.set(key, list);
    }
  }

  const idToKey = new Map<string, string>();
  for (const [key, id] of keyToFormulaId) idToKey.set(id, key);

  const dependents = new Map<string, string[]>();
  for (const key of direct.keys()) {
    const out: string[] = [];
    const seen = new Set<string>();
    const queue = [...(direct.get(key) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      const ownKey = idToKey.get(id);
      if (ownKey !== undefined) queue.push(...(direct.get(ownKey) ?? []));
    }
    dependents.set(key, out);
  }

  return { getters, dependents, errors };
}
