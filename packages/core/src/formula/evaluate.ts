import { isPlainObject } from "../field-types/builtins/config";
import type { GridRow } from "../rows/types";
import { getColumnByKey } from "../schema/lookup";
import type { ColumnDef, GridSchema } from "../schema/types";
import { parseDateValue, toInstant } from "./date-values";
import { getFormulaFunction } from "./functions";
import { parseFormula } from "./parser";
import type {
  BinaryExpr,
  FormulaEnv,
  FormulaError,
  FormulaErrorCode,
  FormulaNode,
  FormulaValue,
} from "./types";
import { isFormulaError } from "./types";

/** Maximum nesting of formula-column references before giving up. */
const MAX_REF_DEPTH = 32;

type Result = FormulaValue | FormulaError;

interface Span {
  start?: number;
  end?: number;
}

interface Ctx {
  row: GridRow;
  schema: GridSchema;
  env: FormulaEnv;
  /** Formula column keys on the current evaluation path (cycle guard). */
  stack: string[];
  /** Results of formula-column refs already evaluated for this row. */
  memo: Map<string, Result>;
}

function err(code: FormulaErrorCode, message: string, span?: Span, columnKey?: string): FormulaError {
  const e: FormulaError = { kind: "formulaError", code, message };
  if (span?.start !== undefined) e.start = span.start;
  if (span?.end !== undefined) e.end = span.end;
  if (columnKey !== undefined) e.columnKey = columnKey;
  return e;
}

/** Adds `node`'s span to an error that has none. */
function withSpan(e: FormulaError, node: FormulaNode): FormulaError {
  return e.start === undefined ? { ...e, start: node.start, end: node.end } : e;
}

function isBlank(v: FormulaValue): v is null | "" {
  return v === null || v === "";
}

function finiteOrNull(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return n === 0 ? 0 : n;
}

function normalizeResult(v: unknown): Result {
  if (isFormulaError(v)) return v;
  if (typeof v === "number") return finiteOrNull(v);
  if (typeof v === "string" || typeof v === "boolean" || v === null) return v;
  return null;
}

// ---- ref normalisation ------------------------------------------------------------------

function optionLabels(config: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const options = isPlainObject(config) ? config.options : undefined;
  if (!Array.isArray(options)) return out;
  for (const o of options) {
    if (isPlainObject(o) && typeof o.id === "string" && typeof o.label === "string") out.set(o.id, o.label);
  }
  return out;
}

function nonEmpty(s: string): string | null {
  return s === "" ? null : s;
}

function joinTexts(parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => p !== null && p !== "");
  return kept.length === 0 ? null : kept.join(", ");
}

/** Best-effort text for arbitrary values (text-like and custom types). */
function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return nonEmpty(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return joinTexts(v.map(toText));
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (isPlainObject(v)) {
    for (const k of ["label", "name", "id"]) {
      const x = v[k];
      if (typeof x === "string" && x !== "") return x;
    }
  }
  return null;
}

function selectText(v: unknown, labels: Map<string, string>): string | null {
  if (typeof v === "string") return nonEmpty(labels.get(v) ?? v);
  return toText(v);
}

function normalizeCell(column: ColumnDef, v: unknown): FormulaValue {
  if (v === null || v === undefined) return null;
  switch (column.type) {
    case "number":
    case "currency": {
      if (typeof v === "number") return finiteOrNull(v);
      if (typeof v === "string" && v.trim() !== "") return finiteOrNull(Number(v));
      return null;
    }
    case "boolean":
      return typeof v === "boolean" ? v : null;
    case "date":
    case "datetime":
      if (typeof v === "string") return nonEmpty(v);
      if (v instanceof Date && !Number.isNaN(v.getTime())) {
        // Stored values are ISO strings; a Date is treated as an instant.
        return v.toISOString();
      }
      return null;
    case "select":
    case "creatableSelect":
      return selectText(v, optionLabels(column.config));
    case "multiSelect": {
      const labels = optionLabels(column.config);
      return Array.isArray(v) ? joinTexts(v.map((x) => selectText(x, labels))) : selectText(v, labels);
    }
    case "user":
      if (isPlainObject(v)) {
        if (typeof v.name === "string" && v.name !== "") return v.name;
        return typeof v.id === "string" ? nonEmpty(v.id) : null;
      }
      return toText(v);
    case "link":
      return toText(v);
    default:
      return toText(v);
  }
}

// ---- formula-column refs ----------------------------------------------------------------

const parseCache = new WeakMap<ColumnDef, { source: string; ast: FormulaNode | FormulaError }>();

function parseColumnFormula(column: ColumnDef, source: string): FormulaNode | FormulaError {
  const hit = parseCache.get(column);
  if (hit && hit.source === source) return hit.ast;
  const ast = parseFormula(source);
  parseCache.set(column, { source, ast });
  return ast;
}

function evalRef(key: string, node: FormulaNode, ctx: Ctx): Result {
  const column = getColumnByKey(ctx.schema, key);
  if (!column) return err("eval", `Column {${key}} does not exist`, node, key);
  if (column.type !== "formula") return normalizeCell(column, ctx.row.cells[key]);

  // Formula refs are always recomputed from source: a materialised value in
  // row.cells may be stale relative to its inputs.
  const cached = ctx.memo.get(key);
  if (cached !== undefined) {
    return isFormulaError(cached) ? { ...cached, start: node.start, end: node.end } : cached;
  }
  if (ctx.stack.includes(key)) return err("cycle", `Circular reference through {${key}}`, node, key);
  if (ctx.stack.length >= MAX_REF_DEPTH) {
    return err("eval", `Formula references nested deeper than ${MAX_REF_DEPTH} levels`, node, key);
  }
  if (typeof column.formula !== "string") return err("eval", `Column {${key}} has no formula`, node, key);
  const ast = parseColumnFormula(column, column.formula);
  if (isFormulaError(ast)) return err("eval", `Formula of {${key}} is invalid: ${ast.message}`, node, key);

  ctx.stack.push(key);
  const result = evalNode(ast, ctx);
  ctx.stack.pop();
  // Errors inside the referenced formula are reported at this reference.
  const out = isFormulaError(result)
    ? { ...result, start: node.start, end: node.end, columnKey: result.columnKey ?? key }
    : result;
  ctx.memo.set(key, out);
  return out;
}

// ---- operators --------------------------------------------------------------------------

function arithmeticOperand(v: FormulaValue, op: string, node: FormulaNode): number | FormulaError {
  if (isBlank(v)) return 0;
  if (typeof v === "number") return v;
  return err("eval", `'${op}' needs numbers, got ${JSON.stringify(v)}`, node);
}

function arithmetic(op: string, a: number, b: number): number | null {
  switch (op) {
    case "+":
      return finiteOrNull(a + b);
    case "-":
      return finiteOrNull(a - b);
    case "*":
      return finiteOrNull(a * b);
    case "/":
      return b === 0 ? null : finiteOrNull(a / b);
    default:
      return b === 0 ? null : finiteOrNull(a % b);
  }
}

/**
 * Orders two non-empty values: -1/0/1, or null when they are not comparable.
 * Two strings that both parse as date values compare as instants in env.tz
 * (date-only = start of that day in env.tz). Text comparison is
 * case-insensitive (lower-cased code-unit order).
 */
function compareValues(
  a: string | number | boolean,
  b: string | number | boolean,
  equality: boolean,
  tz: string,
): number | null {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return equality ? (a === b ? 0 : 1) : null;
  if (typeof a === "string" && typeof b === "string") {
    const da = parseDateValue(a);
    const db = parseDateValue(b);
    if (da && db) {
      const ta = toInstant(da, tz).getTime();
      const tb = toInstant(db, tz).getTime();
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    }
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  }
  return null;
}

function compare(op: string, a: FormulaValue, b: FormulaValue, node: BinaryExpr, tz: string): Result {
  const equality = op === "=" || op === "!=";
  if (isBlank(a) || isBlank(b)) {
    // Any comparison with an empty side is false, except "=" between two
    // empties (null and "" are the same empty value).
    return op === "=" && isBlank(a) && isBlank(b);
  }
  const c = compareValues(a, b, equality, tz);
  if (c === null) {
    if (equality) return op === "!=";
    return err("eval", `'${op}' cannot compare ${JSON.stringify(a)} and ${JSON.stringify(b)}`, node);
  }
  switch (op) {
    case "=":
      return c === 0;
    case "!=":
      return c !== 0;
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    default:
      return c >= 0;
  }
}

function booleanOperand(v: FormulaValue, op: string, node: FormulaNode): boolean | FormulaError {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  return err("eval", `'${op}' needs booleans, got ${JSON.stringify(v)}`, node);
}

function evalBinary(node: BinaryExpr, ctx: Ctx): Result {
  const { op } = node;
  if (op === "&&" || op === "||") {
    const l = evalNode(node.left, ctx);
    if (isFormulaError(l)) return l;
    const lb = booleanOperand(l, op, node.left);
    if (isFormulaError(lb)) return lb;
    if (op === "&&" ? !lb : lb) return lb;
    const r = evalNode(node.right, ctx);
    if (isFormulaError(r)) return r;
    return booleanOperand(r, op, node.right);
  }

  const l = evalNode(node.left, ctx);
  if (isFormulaError(l)) return l;
  const r = evalNode(node.right, ctx);
  if (isFormulaError(r)) return r;

  switch (op) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%": {
      const a = arithmeticOperand(l, op, node.left);
      if (isFormulaError(a)) return a;
      const b = arithmeticOperand(r, op, node.right);
      if (isFormulaError(b)) return b;
      return arithmetic(op, a, b);
    }
    case "=":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compare(op, l, r, node, ctx.env.tz);
    default:
      return err("eval", `Unknown operator '${String(op)}'`, node);
  }
}

function evalCall(node: FormulaNode & { type: "call" }, ctx: Ctx): Result {
  const fn = getFormulaFunction(node.name);
  if (!fn) return err("unknownFunction", `Unknown function ${node.name}`, node);
  if (node.args.length < fn.minArgs || node.args.length > fn.maxArgs) {
    return err("arity", `${fn.name}: wrong number of arguments (${node.args.length})`, node);
  }

  // IF is lazy: only the chosen branch is evaluated.
  if (fn.name === "IF") {
    const [condNode, thenNode, elseNode] = node.args;
    const cond = condNode ? evalNode(condNode, ctx) : null;
    if (isFormulaError(cond)) return cond;
    if (cond !== null && typeof cond !== "boolean") {
      return err("eval", `IF: condition must be a boolean, got ${JSON.stringify(cond)}`, condNode ?? node);
    }
    const branch = cond ? thenNode : elseNode;
    return branch ? evalNode(branch, ctx) : null;
  }

  const args: FormulaValue[] = [];
  for (const a of node.args) {
    const v = evalNode(a, ctx);
    if (isFormulaError(v)) return v;
    args.push(v);
  }
  const out = normalizeResult(fn.impl(args, ctx.env));
  return isFormulaError(out) ? withSpan(out, node) : out;
}

function evalNode(node: FormulaNode, ctx: Ctx): Result {
  switch (node.type) {
    case "number":
      return finiteOrNull(node.value);
    case "string":
      return node.value;
    case "boolean":
      return node.value;
    case "ref":
      return evalRef(node.key, node, ctx);
    case "unary": {
      const v = evalNode(node.operand, ctx);
      if (isFormulaError(v)) return v;
      if (node.op === "!") {
        const b = booleanOperand(v, "!", node.operand);
        return isFormulaError(b) ? b : !b;
      }
      if (isBlank(v)) return 0; // empty operands count as 0 in arithmetic
      if (typeof v !== "number") return err("eval", `'-' needs a number, got ${JSON.stringify(v)}`, node.operand);
      return finiteOrNull(-v);
    }
    case "binary":
      return evalBinary(node, ctx);
    case "call":
      return evalCall(node, ctx);
    default:
      return err("eval", "Malformed formula node");
  }
}

/**
 * Evaluates a parsed formula against `row`. Never throws.
 *
 * - Refs read `row.cells[key]` normalised by column type: select/creatableSelect →
 *   option label (raw id fallback); multiSelect/link → labels joined ", "; user →
 *   name ?? id; date/datetime → ISO strings; number/currency → number (numeric
 *   strings coerced, otherwise null); boolean → boolean; everything else → text.
 *   Missing cells and empty arrays are null.
 * - Formula-column refs are always recomputed from their source (materialised
 *   values may be stale); cycles give "cycle", nesting > 32 gives "eval".
 * - A ref to a key missing from the schema gives an "eval" error with columnKey.
 * - Arithmetic: empty (null / "") operands count as 0; ÷0, %0 and non-finite
 *   results give null; `+` never concatenates.
 * - Comparisons with an empty side are false, except "=" where both sides are
 *   empty (null / ""). Text comparisons are case-insensitive. Two strings that
 *   both parse as dates compare as instants in env.tz.
 * - Errors use code "eval", or the more specific "cycle", "unknownFunction" and
 *   "arity" where they apply.
 */
export function evaluate(ast: FormulaNode, row: GridRow, schema: GridSchema, env: FormulaEnv): FormulaValue | FormulaError {
  try {
    return evalNode(ast, { row, schema, env, stack: [], memo: new Map() });
  } catch (e) {
    return err("eval", e instanceof Error ? e.message : "Failed to evaluate formula");
  }
}
