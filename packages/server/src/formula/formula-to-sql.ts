import { type SQL, sql } from "drizzle-orm";
import {
  type ColumnDef,
  type FormulaNode,
  type FormulaResultType,
  inferResultType,
  isFormulaError,
  parseFormula,
} from "../internal/core";
import { resolveColumnExpr } from "../sql/column-expr";
import type { SqlScope } from "../sql/scope";
import { storageKindOf } from "../sql/storage-kind";

export interface FormulaToSqlOptions {
  /**
   * Render literals into the SQL text instead of binding them as params.
   * Only for generated-column DDL (which cannot carry params). Numbers must be
   * finite; strings are single-quoted with `\` and `'` escaped.
   */
  inlineLiterals?: boolean;
  /** Keys of formula columns currently being inlined (cycle guard). */
  visiting?: Set<string>;
}

type Scope = Pick<SqlScope, "ctx" | "tables" | "storageOverrides">;

/** Storage kinds a non-formula `{ref}` may resolve to. */
const REF_KINDS = new Set(["number", "text", "choice"]);

const ARITH = new Set(["+", "-", "*", "/", "%"]);
const COMPARE: Readonly<Record<string, string>> = { "=": "=", "!=": "<>", "<": "<", "<=": "<=", ">": ">", ">=": ">=" };

/** MySQL single-quoted string literal (for DDL only). */
export function mysqlStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

class Untranslatable {}
const NO = new Untranslatable();

/**
 * Translate a formula AST to MySQL, or `null` when any part is outside the
 * SQL-translatable subset (other functions, text `+`, date/boolean/multi/ref
 * columns, unknown columns, formula cycles, …).
 *
 * Semantics chosen to match core `evaluate`:
 * - empty operands of arithmetic count as 0 → operands are `COALESCE(x, 0)`
 *   unless they can never be NULL;
 * - ÷0 and MOD(x, 0) yield NULL (MySQL does this natively);
 * - comparisons use the plain typed expression, so NULL never matches.
 */
export function formulaToSql(ast: FormulaNode, scope: Scope, options: FormulaToSqlOptions = {}): SQL | null {
  const inline = options.inlineLiterals === true;
  const visiting = options.visiting ?? new Set<string>();
  const schema = scope.ctx.schema;
  const byKey = new Map(schema.columns.map((c) => [c.key, c]));
  const exprScope: SqlScope = { ...scope, generatedColumns: "ignore" };

  const typeOf = (n: FormulaNode): FormulaResultType => {
    const t = inferResultType(n, schema);
    if (isFormulaError(t)) throw NO;
    return t;
  };

  const number = (value: number): SQL => {
    if (!Number.isFinite(value)) throw NO;
    return inline ? sql.raw(String(value)) : sql`${value}`;
  };
  const string = (value: string): SQL => (inline ? sql.raw(mysqlStringLiteral(value)) : sql`${value}`);

  const formulaRef = (column: ColumnDef): SQL => {
    if (!column.formula || visiting.has(column.key)) throw NO;
    const sub = parseFormula(column.formula);
    if (isFormulaError(sub)) throw NO;
    visiting.add(column.key);
    try {
      return sql`(${walk(sub)})`;
    } finally {
      visiting.delete(column.key);
    }
  };

  const ref = (key: string): SQL => {
    const column = byKey.get(key);
    if (!column) throw NO;
    if (column.type === "formula") return formulaRef(column);
    const kind = storageKindOf(column, scope.ctx.registry, scope.storageOverrides);
    if (!REF_KINDS.has(kind.kind) || kind.subPath) throw NO;
    return resolveColumnExpr(column, exprScope).typed;
  };

  /** Arithmetic operand: empty counts as 0 unless the node can never be NULL. */
  const operand = (n: FormulaNode): SQL => {
    if (typeOf(n) !== "number") throw NO;
    const out = walk(n);
    const neverNull =
      n.type === "number" ||
      (n.type === "unary" && n.op === "-") ||
      (n.type === "binary" && (n.op === "+" || n.op === "-" || n.op === "*"));
    return neverNull ? out : sql`COALESCE(${out}, 0)`;
  };

  const condition = (n: FormulaNode): SQL => {
    const t = typeOf(n);
    if (t !== "boolean" && t !== "number") throw NO;
    return walk(n);
  };

  const call = (name: string, args: FormulaNode[]): SQL => {
    switch (name) {
      case "IF": {
        const [c, a, b] = args;
        if (!c || !a || args.length > 3) throw NO;
        const otherwise = b ? walk(b) : sql`NULL`;
        return sql`(CASE WHEN ${condition(c)} THEN ${walk(a)} ELSE ${otherwise} END)`;
      }
      case "COALESCE": {
        if (args.length === 0) throw NO;
        return sql`COALESCE(${sql.join(
          args.map((a) => walk(a)),
          sql`, `,
        )})`;
      }
      case "IS_EMPTY": {
        const [x] = args;
        if (!x || args.length !== 1) throw NO;
        if (x.type === "ref") {
          const column = byKey.get(x.key);
          if (column && column.type !== "formula") {
            ref(x.key); // validates the ref is translatable
            return resolveColumnExpr(column, exprScope).empty;
          }
        }
        const inner = walk(x);
        return typeOf(x) === "text" ? sql`(${inner} IS NULL OR ${inner} = '')` : sql`(${inner} IS NULL)`;
      }
      default:
        throw NO;
    }
  };

  const walk = (n: FormulaNode): SQL => {
    switch (n.type) {
      case "number":
        return number(n.value);
      case "string":
        return string(n.value);
      case "boolean":
        return sql.raw(n.value ? "TRUE" : "FALSE");
      case "ref":
        return ref(n.key);
      case "unary":
        if (n.op === "-") return sql`(-${operand(n.operand)})`;
        // core: `!v` is true for empty values → NOT COALESCE(v, FALSE)
        return sql`(NOT COALESCE(${condition(n.operand)}, FALSE))`;
      case "binary": {
        if (ARITH.has(n.op)) {
          const l = operand(n.left);
          const r = operand(n.right);
          if (n.op === "%") return sql`MOD(${l}, ${r})`;
          return sql`(${l} ${sql.raw(n.op)} ${r})`;
        }
        if (n.op === "&&" || n.op === "||") {
          return sql`(${condition(n.left)} ${sql.raw(n.op === "&&" ? "AND" : "OR")} ${condition(n.right)})`;
        }
        const cmp = COMPARE[n.op];
        if (!cmp) throw NO;
        const lt = typeOf(n.left);
        const rt = typeOf(n.right);
        if (lt !== rt || lt === "date") throw NO;
        return sql`(${walk(n.left)} ${sql.raw(cmp)} ${walk(n.right)})`;
      }
      case "call":
        return call(n.name, n.args);
      default:
        throw NO;
    }
  };

  try {
    return walk(ast);
  } catch (e) {
    if (e === NO) return null;
    throw e;
  }
}
