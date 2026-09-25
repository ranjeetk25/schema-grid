import type { ColumnDef, GridSchema } from "../schema/types";
import { dependencies } from "./dependencies";
import { inferResultType } from "./infer";
import { parseFormula } from "./parser";
import { type FormulaError, type FormulaNode, isFormulaError } from "./types";

function formulaColumns(schema: GridSchema): ColumnDef[] {
  return schema.columns.filter((c) => c.type === "formula");
}

function parseColumn(column: ColumnDef): FormulaNode | FormulaError {
  if (typeof column.formula !== "string" || column.formula.trim() === "") {
    return {
      kind: "formulaError",
      code: "syntax",
      message: "Formula column has no formula",
      columnKey: column.key,
    };
  }
  return parseFormula(column.formula);
}

/** Edges key → referenced formula-column keys (parse failures have no edges). */
function buildGraph(schema: GridSchema): { keys: string[]; edges: Map<string, string[]> } {
  const cols = formulaColumns(schema);
  const keys = cols.map((c) => c.key);
  const formulaKeys = new Set(keys);
  const edges = new Map<string, string[]>();
  for (const col of cols) {
    const ast = parseColumn(col);
    edges.set(
      col.key,
      isFormulaError(ast) ? [] : dependencies(ast).filter((k) => formulaKeys.has(k)),
    );
  }
  return { keys, edges };
}

/** Tarjan's strongly connected components, in discovery order. */
function stronglyConnected(keys: string[], edges: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];

  const visit = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, idx.get(w) ?? 0));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };

  for (const k of keys) if (!idx.has(k)) visit(k);
  return out;
}

/** Orders an SCC as a walk along its edges starting from its first key in schema order. */
function orderCycle(comp: string[], keys: string[], edges: Map<string, string[]>): string[] {
  const members = new Set(comp);
  const start = keys.find((k) => members.has(k)) ?? comp[0] ?? "";
  const path = [start];
  const seen = new Set(path);
  let cur = start;
  for (;;) {
    const next = (edges.get(cur) ?? []).find((k) => members.has(k) && !seen.has(k));
    if (next === undefined) break;
    path.push(next);
    seen.add(next);
    cur = next;
  }
  // Append any members the simple walk missed (complex SCCs), in schema order.
  for (const k of keys) if (members.has(k) && !seen.has(k)) path.push(k);
  return path;
}

/** Returns each formula-column cycle once, as an ordered list of column keys. */
export function detectFormulaCycles(schema: GridSchema): string[][] {
  const { keys, edges } = buildGraph(schema);
  return stronglyConnected(keys, edges)
    .filter((comp) => {
      const only = comp[0];
      return comp.length > 1 || (only !== undefined && (edges.get(only) ?? []).includes(only));
    })
    .map((comp) => orderCycle(comp, keys, edges));
}

/**
 * Formula column keys in dependency order (dependencies first; ties keep schema
 * order). Returns a "cycle" FormulaError if any cycle exists.
 */
export function getFormulaEvaluationOrder(schema: GridSchema): string[] | FormulaError {
  const cycles = detectFormulaCycles(schema);
  const first = cycles[0];
  if (first) {
    return {
      kind: "formulaError",
      code: "cycle",
      message: `Formula columns form a cycle: ${[...first, first[0]].join(" → ")}`,
      columnKey: first[0],
    };
  }
  const { keys, edges } = buildGraph(schema);
  const order: string[] = [];
  const done = new Set<string>();
  const visit = (k: string): void => {
    if (done.has(k)) return;
    done.add(k);
    for (const d of edges.get(k) ?? []) visit(d);
    order.push(k);
  };
  for (const k of keys) visit(k);
  return order;
}

/**
 * Validates every formula column: missing/unparseable formulas, cycles,
 * unknown columns, arity and type errors. Keyed by column id.
 */
export function validateFormulaColumns(schema: GridSchema): Map<string, FormulaError> {
  const errors = new Map<string, FormulaError>();
  const inCycle = new Map<string, string[]>();
  for (const cycle of detectFormulaCycles(schema)) {
    for (const k of cycle) inCycle.set(k, cycle);
  }
  for (const col of formulaColumns(schema)) {
    const ast = parseColumn(col);
    if (isFormulaError(ast)) {
      errors.set(col.id, { ...ast, columnKey: ast.columnKey ?? col.key });
      continue;
    }
    const cycle = inCycle.get(col.key);
    if (cycle) {
      const first = cycle[0];
      errors.set(col.id, {
        kind: "formulaError",
        code: "cycle",
        message: `Formula column "${col.key}" is part of a cycle: ${[...cycle, first].join(" → ")}`,
        columnKey: col.key,
      });
      continue;
    }
    const result = inferResultType(ast, schema);
    if (isFormulaError(result)) errors.set(col.id, result);
  }
  return errors;
}
