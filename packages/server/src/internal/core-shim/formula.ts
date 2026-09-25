/**
 * TEMPORARY minimal formula front-end (core plan Tasks 19–24). Parses the
 * full grammar (so the server's SQL translator can decide what is
 * translatable), infers result types for a small subset, and evaluates only
 * the SQL-translatable subset (literals, refs, arithmetic, comparisons,
 * &&/||/!, IF, COALESCE, IS_EMPTY). Everything else evaluates to an "eval"
 * FormulaError. This is NOT the real engine.
 * TODO(core): replace every export with @masai/schema-grid-core formula API.
 */
import { isEmptyValue } from "./empty";
import type {
  BinaryOp,
  ColumnDef,
  FormulaEnv,
  FormulaError,
  FormulaNode,
  FormulaResultType,
  FormulaValue,
  GridRow,
  GridSchema,
} from "./types";

export function isFormulaError(x: unknown): x is FormulaError {
  return typeof x === "object" && x !== null && (x as { kind?: unknown }).kind === "formulaError";
}
const err = (code: FormulaError["code"], message: string, extra: Partial<FormulaError> = {}): FormulaError => ({
  kind: "formulaError",
  code,
  message,
  ...extra,
});

// ---- tokenizer --------------------------------------------------------------
type Tok =
  | { kind: "number"; value: number; start: number; end: number }
  | { kind: "string"; value: string; start: number; end: number }
  | { kind: "boolean"; value: boolean; start: number; end: number }
  | { kind: "ref" | "ident" | "op"; value: string; start: number; end: number }
  | { kind: "lparen" | "rparen" | "comma" | "eof"; value: string; start: number; end: number };

function tokenize(src: string): Tok[] | FormulaError {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) return err("syntax", `Unexpected "${c}"`, { start });
      i += m[0].length;
      out.push({ kind: "number", value: Number(m[0]), start, end: i });
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < src.length) i++;
        s += src[i];
        i++;
      }
      if (i >= src.length) return err("syntax", "Unterminated string", { start });
      i++;
      out.push({ kind: "string", value: s, start, end: i });
      continue;
    }
    if (c === "{") {
      const close = src.indexOf("}", i);
      if (close < 0) return err("syntax", "Unterminated column reference", { start });
      const key = src.slice(i + 1, close).trim();
      if (!key) return err("syntax", "Empty column reference", { start });
      i = close + 1;
      out.push({ kind: "ref", value: key, start, end: i });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray;
      i += m[0].length;
      const up = m[0].toUpperCase();
      if (up === "TRUE" || up === "FALSE") out.push({ kind: "boolean", value: up === "TRUE", start, end: i });
      else out.push({ kind: "ident", value: up, start, end: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    const norm: Record<string, string> = { "==": "=", "<>": "!=", "!=": "!=", "<=": "<=", ">=": ">=", "&&": "&&", "||": "||" };
    if (norm[two]) {
      i += 2;
      out.push({ kind: "op", value: norm[two] as string, start, end: i });
      continue;
    }
    if ("+-*/%=<>!".includes(c)) {
      i++;
      out.push({ kind: "op", value: c, start, end: i });
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      i++;
      out.push({ kind: c === "(" ? "lparen" : c === ")" ? "rparen" : "comma", value: c, start, end: i });
      continue;
    }
    return err("syntax", `Unexpected "${c}"`, { start, end: start + 1 });
  }
  out.push({ kind: "eof", value: "", start: src.length, end: src.length });
  return out;
}

// ---- parser (Pratt) --------------------------------------------------------
const BP: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "=": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

class ParseFail {
  constructor(readonly error: FormulaError) {}
}

export function parseFormula(src: string): FormulaNode | FormulaError {
  const toks = tokenize(src);
  if (isFormulaError(toks)) return toks;
  let pos = 0;
  const peek = () => toks[pos] as Tok;
  const next = () => toks[pos++] as Tok;
  const fail = (t: Tok, msg: string): never => {
    throw new ParseFail(err("syntax", msg, { start: t.start, end: t.end }));
  };
  const primary = (): FormulaNode => {
    const t = next();
    switch (t.kind) {
      case "number":
        return { type: "NumberLiteral", value: t.value, start: t.start, end: t.end };
      case "string":
        return { type: "StringLiteral", value: t.value, start: t.start, end: t.end };
      case "boolean":
        return { type: "BooleanLiteral", value: t.value, start: t.start, end: t.end };
      case "ref":
        return { type: "ColumnRef", key: t.value, start: t.start, end: t.end };
      case "lparen": {
        const e = expr(0);
        if (peek().kind !== "rparen") fail(peek(), "Expected )");
        next();
        return e;
      }
      case "op":
        if (t.value === "-" || t.value === "!") {
          const operand = expr(7);
          return { type: "UnaryExpr", op: t.value, operand, start: t.start, end: operand.end };
        }
        return fail(t, `Unexpected "${t.value}"`);
      case "ident": {
        if (peek().kind !== "lparen") return fail(t, `Unknown identifier ${t.value}`);
        next();
        const args: FormulaNode[] = [];
        if (peek().kind !== "rparen") {
          for (;;) {
            args.push(expr(0));
            if (peek().kind === "comma") {
              next();
              continue;
            }
            break;
          }
        }
        const close = peek();
        if (close.kind !== "rparen") fail(close, "Expected )");
        next();
        return { type: "CallExpr", name: t.value, args, start: t.start, end: close.end };
      }
      default:
        return fail(t, "Unexpected end of formula");
    }
  };
  const expr = (minBp: number): FormulaNode => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (t.kind !== "op") break;
      const bp = BP[t.value];
      if (bp === undefined || bp <= minBp) break;
      next();
      const right = expr(bp);
      left = { type: "BinaryExpr", op: t.value as BinaryOp, left, right, start: left.start, end: right.end };
    }
    return left;
  };
  try {
    const ast = expr(0);
    if (peek().kind !== "eof") fail(peek(), "Unexpected token");
    return ast;
  } catch (e) {
    if (e instanceof ParseFail) return e.error;
    throw e;
  }
}

// ---- dependencies / cycles --------------------------------------------------
export function dependencies(ast: FormulaNode): string[] {
  const out: string[] = [];
  const walk = (n: FormulaNode) => {
    switch (n.type) {
      case "ColumnRef":
        if (!out.includes(n.key)) out.push(n.key);
        return;
      case "UnaryExpr":
        return walk(n.operand);
      case "BinaryExpr":
        walk(n.left);
        return walk(n.right);
      case "CallExpr":
        for (const a of n.args) walk(a);
        return;
      default:
        return;
    }
  };
  walk(ast);
  return out;
}

export function detectFormulaCycles(schema: GridSchema): string[][] {
  const deps = new Map<string, string[]>();
  for (const c of schema.columns) {
    if (c.type !== "formula" || !c.formula) continue;
    const ast = parseFormula(c.formula);
    deps.set(c.key, isFormulaError(ast) ? [] : dependencies(ast));
  }
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (k: string) => {
    if (state.get(k) === "done") return;
    if (state.get(k) === "visiting") {
      const cyc = stack.slice(stack.indexOf(k));
      const sig = [...cyc].sort().join(",");
      if (!seen.has(sig)) {
        seen.add(sig);
        cycles.push(cyc);
      }
      return;
    }
    state.set(k, "visiting");
    stack.push(k);
    for (const d of deps.get(k) ?? []) if (deps.has(d)) visit(d);
    stack.pop();
    state.set(k, "done");
  };
  for (const k of deps.keys()) visit(k);
  return cycles;
}

// ---- inference (subset) -----------------------------------------------------
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
    case "formula":
      return ((column.config as { resultType?: FormulaResultType } | null)?.resultType ?? "text") as FormulaResultType;
    default:
      return "text";
  }
}

const FN_RETURNS: Record<string, FormulaResultType | "arg"> = {
  IF: "arg",
  COALESCE: "arg",
  AND: "boolean",
  OR: "boolean",
  NOT: "boolean",
  IS_EMPTY: "boolean",
  SUM: "number",
  AVG: "number",
  MIN: "number",
  MAX: "number",
  ROUND: "number",
  ABS: "number",
  LEN: "number",
  YEAR: "number",
  MONTH: "number",
  DAY: "number",
  DATEDIFF: "number",
  CONCAT: "text",
  UPPER: "text",
  LOWER: "text",
  TRIM: "text",
  LEFT: "text",
  RIGHT: "text",
  TODAY: "date",
  NOW: "date",
  DATEADD: "date",
};

export function inferResultType(ast: FormulaNode, schema: GridSchema): FormulaResultType | FormulaError {
  const byKey = new Map(schema.columns.map((c) => [c.key, c]));
  const walk = (n: FormulaNode): FormulaResultType | FormulaError => {
    switch (n.type) {
      case "NumberLiteral":
        return "number";
      case "StringLiteral":
        return "text";
      case "BooleanLiteral":
        return "boolean";
      case "ColumnRef": {
        const c = byKey.get(n.key);
        return c ? columnTypeToFormulaType(c) : err("unknownColumn", `Unknown column ${n.key}`, { columnKey: n.key });
      }
      case "UnaryExpr": {
        const t = walk(n.operand);
        return isFormulaError(t) ? t : n.op === "!" ? "boolean" : "number";
      }
      case "BinaryExpr": {
        const l = walk(n.left);
        if (isFormulaError(l)) return l;
        const r = walk(n.right);
        if (isFormulaError(r)) return r;
        if (["+", "-", "*", "/", "%"].includes(n.op)) {
          return l === "number" && r === "number" ? "number" : err("type", "Arithmetic needs numbers", { start: n.start, end: n.end });
        }
        return "boolean";
      }
      case "CallExpr": {
        const ret = FN_RETURNS[n.name];
        if (!ret) return err("unknownFunction", `Unknown function ${n.name}`);
        for (const a of n.args) {
          const t = walk(a);
          if (isFormulaError(t)) return t;
        }
        if (ret !== "arg") return ret;
        const arg = n.name === "IF" ? n.args[1] : n.args[0];
        return arg ? walk(arg) : "text";
      }
    }
  };
  return walk(ast);
}

// ---- evaluate (translatable subset only) ------------------------------------
export function evaluate(
  ast: FormulaNode,
  row: GridRow,
  schema: GridSchema,
  env: FormulaEnv,
  depth = 0,
): FormulaValue | FormulaError {
  if (depth > 32) return err("eval", "Formula nesting too deep");
  const byKey = new Map(schema.columns.map((c) => [c.key, c]));
  const num = (v: FormulaValue): number => (isEmptyValue(v) ? 0 : Number(v));
  const walk = (n: FormulaNode): FormulaValue | FormulaError => {
    switch (n.type) {
      case "NumberLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
        return n.value;
      case "ColumnRef": {
        const c = byKey.get(n.key);
        if (!c) return err("eval", `Unknown column ${n.key}`, { columnKey: n.key });
        if (c.type === "formula" && c.formula) {
          const sub = parseFormula(c.formula);
          return isFormulaError(sub) ? sub : evaluate(sub, row, schema, env, depth + 1);
        }
        const v = row.cells[n.key];
        return v === undefined ? null : (v as FormulaValue);
      }
      case "UnaryExpr": {
        const v = walk(n.operand);
        if (isFormulaError(v)) return v;
        return n.op === "!" ? !v : -num(v);
      }
      case "BinaryExpr": {
        const l = walk(n.left);
        if (isFormulaError(l)) return l;
        const r = walk(n.right);
        if (isFormulaError(r)) return r;
        switch (n.op) {
          case "+":
            return num(l) + num(r);
          case "-":
            return num(l) - num(r);
          case "*":
            return num(l) * num(r);
          case "/":
            return num(r) === 0 ? null : num(l) / num(r);
          case "%":
            return num(r) === 0 ? null : num(l) % num(r);
          case "&&":
            return Boolean(l) && Boolean(r);
          case "||":
            return Boolean(l) || Boolean(r);
          default: {
            if (isEmptyValue(l) || isEmptyValue(r)) return n.op === "=" ? l === r : false;
            const a = typeof l === "number" ? l : String(l);
            const b = typeof r === "number" ? r : String(r);
            switch (n.op) {
              case "=":
                return a === b;
              case "!=":
                return a !== b;
              case "<":
                return a < b;
              case "<=":
                return a <= b;
              case ">":
                return a > b;
              case ">=":
                return a >= b;
            }
          }
        }
        return err("eval", `Unsupported operator ${n.op}`);
      }
      case "CallExpr": {
        if (n.name === "IF") {
          const c = n.args[0] ? walk(n.args[0]) : null;
          if (isFormulaError(c)) return c;
          const branch = c ? n.args[1] : n.args[2];
          return branch ? walk(branch) : null;
        }
        if (n.name === "COALESCE") {
          for (const a of n.args) {
            const v = walk(a);
            if (isFormulaError(v)) return v;
            if (!isEmptyValue(v)) return v;
          }
          return null;
        }
        if (n.name === "IS_EMPTY") {
          const v = n.args[0] ? walk(n.args[0]) : null;
          return isFormulaError(v) ? v : isEmptyValue(v);
        }
        return err("eval", `${n.name} is not available in the server's temporary evaluator (TODO(core))`);
      }
    }
  };
  return walk(ast);
}
