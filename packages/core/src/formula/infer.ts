import { isPlainObject } from "../field-types/builtins/config";
import { getColumnByKey } from "../schema/lookup";
import type { ColumnDef, GridSchema } from "../schema/types";
import { parseDateValue } from "./date-values";
import { getFormulaFunction } from "./functions";
import { parseFormula } from "./parser";
import type { BinaryExpr, FormulaError, FormulaErrorCode, FormulaNode, FormulaResultType } from "./types";
import { isFormulaError } from "./types";

const RESULT_TYPES: ReadonlySet<string> = new Set<FormulaResultType>(["number", "text", "boolean", "date"]);

function isResultType(x: unknown): x is FormulaResultType {
  return typeof x === "string" && RESULT_TYPES.has(x);
}

/**
 * Static formula type of a column's values. Formula columns use
 * `config.resultType` ("text" when missing or invalid); unknown/custom types are "text".
 */
export function columnTypeToFormulaType(column: ColumnDef): FormulaResultType {
  switch (column.type) {
    case "number":
    case "currency":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
    case "datetime":
      return "date";
    case "formula": {
      const rt = isPlainObject(column.config) ? column.config.resultType : undefined;
      return isResultType(rt) ? rt : "text";
    }
    default:
      return "text";
  }
}

interface Span {
  start: number;
  end: number;
}

function err(code: FormulaErrorCode, message: string, span: Span, columnKey?: string): FormulaError {
  const e: FormulaError = { kind: "formulaError", code, message, start: span.start, end: span.end };
  if (columnKey !== undefined) e.columnKey = columnKey;
  return e;
}

interface Ctx {
  schema: GridSchema;
  /** Formula column keys currently being inferred (cycle guard). */
  visiting: Set<string>;
  /** Resolved result types of formula columns within this call. */
  memo: Map<string, FormulaResultType>;
}

/** A string literal that parses as a date/datetime value may stand in for a date in comparisons. */
function isDateLiteral(node: FormulaNode): boolean {
  return node.type === "string" && parseDateValue(node.value) !== null;
}

function inferRef(key: string, span: Span, ctx: Ctx): FormulaResultType | FormulaError {
  const column = getColumnByKey(ctx.schema, key);
  if (!column) return err("unknownColumn", `Unknown column {${key}}`, span, key);
  if (column.type !== "formula") return columnTypeToFormulaType(column);

  const cached = ctx.memo.get(key);
  if (cached !== undefined) return cached;
  if (ctx.visiting.has(key)) return err("cycle", `Circular reference through {${key}}`, span, key);

  const fallback = columnTypeToFormulaType(column);
  if (typeof column.formula !== "string") return fallback;
  const parsed = parseFormula(column.formula);
  if (isFormulaError(parsed)) return fallback;

  ctx.visiting.add(key);
  const result = inferNode(parsed, ctx);
  ctx.visiting.delete(key);

  if (isFormulaError(result)) {
    // Cycles are reported at the reference in the formula being checked.
    if (result.code === "cycle") return { ...result, start: span.start, end: span.end };
    // Any other error belongs to the referenced column's own formula: trust its declared type.
    return fallback;
  }
  ctx.memo.set(key, result);
  return result;
}

function inferBinary(node: BinaryExpr, ctx: Ctx): FormulaResultType | FormulaError {
  const left = inferNode(node.left, ctx);
  if (isFormulaError(left)) return left;
  const right = inferNode(node.right, ctx);
  if (isFormulaError(right)) return right;

  switch (node.op) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
      if (left !== "number") return err("type", `'${node.op}' needs numbers, got ${left}`, node.left);
      if (right !== "number") return err("type", `'${node.op}' needs numbers, got ${right}`, node.right);
      return "number";
    case "&&":
    case "||":
      if (left !== "boolean") return err("type", `'${node.op}' needs booleans, got ${left}`, node.left);
      if (right !== "boolean") return err("type", `'${node.op}' needs booleans, got ${right}`, node.right);
      return "boolean";
    case "=":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const relational = node.op !== "=" && node.op !== "!=";
      if (relational && left === "boolean") {
        return err("type", `'${node.op}' cannot compare booleans`, node.left);
      }
      if (left === right) return "boolean";
      if (left === "date" && right === "text" && isDateLiteral(node.right)) return "boolean";
      if (right === "date" && left === "text" && isDateLiteral(node.left)) return "boolean";
      return err("type", `'${node.op}' needs both sides of the same type, got ${left} and ${right}`, node.right);
    }
    default:
      return err("type", `Unknown operator '${String((node as { op?: unknown }).op)}'`, node);
  }
}

function inferNode(node: FormulaNode, ctx: Ctx): FormulaResultType | FormulaError {
  switch (node.type) {
    case "number":
      return "number";
    case "string":
      return "text";
    case "boolean":
      return "boolean";
    case "ref":
      return inferRef(node.key, node, ctx);
    case "unary": {
      const t = inferNode(node.operand, ctx);
      if (isFormulaError(t)) return t;
      const need: FormulaResultType = node.op === "-" ? "number" : "boolean";
      if (t !== need) return err("type", `'${node.op}' needs a ${need}, got ${t}`, node.operand);
      return need;
    }
    case "binary":
      return inferBinary(node, ctx);
    case "call": {
      const fn = getFormulaFunction(node.name);
      if (!fn) return err("unknownFunction", `Unknown function ${node.name}`, node);
      if (node.args.length < fn.minArgs || node.args.length > fn.maxArgs) {
        const range =
          fn.maxArgs === Number.POSITIVE_INFINITY
            ? `at least ${fn.minArgs}`
            : fn.minArgs === fn.maxArgs
              ? `${fn.minArgs}`
              : `${fn.minArgs}-${fn.maxArgs}`;
        return err("arity", `${fn.name} takes ${range} argument(s), got ${node.args.length}`, node);
      }
      const argTypes: FormulaResultType[] = [];
      for (const arg of node.args) {
        const t = inferNode(arg, ctx);
        if (isFormulaError(t)) return t;
        argTypes.push(t);
      }
      const ret = fn.inferReturn(argTypes);
      return isFormulaError(ret) ? { ...ret, start: node.start, end: node.end } : ret;
    }
    default:
      return err("syntax", "Malformed formula node", { start: 0, end: 0 });
  }
}

/**
 * Statically type-checks a parsed formula against `schema`. Errors carry the
 * source span of the offending node. References to other formula columns are
 * inferred from their formula source (falling back to `config.resultType` when
 * the source is missing, unparseable or itself invalid); cycles give "cycle".
 * Never throws.
 */
export function inferResultType(ast: FormulaNode, schema: GridSchema): FormulaResultType | FormulaError {
  try {
    return inferNode(ast, { schema, visiting: new Set(), memo: new Map() });
  } catch (e) {
    return {
      kind: "formulaError",
      code: "eval",
      message: e instanceof Error ? e.message : "Failed to infer formula type",
    };
  }
}
