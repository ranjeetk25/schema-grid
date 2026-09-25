import { describe, expect, it } from "vitest";
import { parseFormula } from "../../src/formula/parser";
import {
  isFormulaError,
  type FormulaError,
  type FormulaNode,
} from "../../src/formula/types";

function parseOk(src: string): FormulaNode {
  const r = parseFormula(src);
  if (isFormulaError(r)) {
    throw new Error(`expected AST, got error: ${r.message}`);
  }
  return r;
}

function parseErr(src: string): FormulaError {
  const r = parseFormula(src);
  if (!isFormulaError(r)) {
    throw new Error(`expected error, got AST for ${src}`);
  }
  return r;
}

/** Compact s-expression rendering of an AST for structural assertions. */
function show(n: FormulaNode): string {
  switch (n.type) {
    case "number":
      return String(n.value);
    case "string":
      return JSON.stringify(n.value);
    case "boolean":
      return n.value ? "TRUE" : "FALSE";
    case "ref":
      return n.key;
    case "unary":
      return `(${n.op}${show(n.operand)})`;
    case "binary":
      return `(${show(n.left)} ${n.op} ${show(n.right)})`;
    case "call":
      return `${n.name}(${n.args.map(show).join(", ")})`;
  }
}

function children(n: FormulaNode): FormulaNode[] {
  switch (n.type) {
    case "unary":
      return [n.operand];
    case "binary":
      return [n.left, n.right];
    case "call":
      return n.args;
    default:
      return [];
  }
}

/** Walks the AST asserting every child span lies within its parent's span. */
function assertNested(n: FormulaNode, src: string): void {
  expect(n.start).toBeGreaterThanOrEqual(0);
  expect(n.end).toBeLessThanOrEqual(src.length);
  expect(n.start).toBeLessThan(n.end);
  for (const c of children(n)) {
    expect(c.start).toBeGreaterThanOrEqual(n.start);
    expect(c.end).toBeLessThanOrEqual(n.end);
    assertNested(c, src);
  }
}

describe("parseFormula", () => {
  it("1 + 2 * 3 parses as 1 + (2 * 3)", () => {
    expect(show(parseOk("1 + 2 * 3"))).toBe("(1 + (2 * 3))");
  });

  it("(1 + 2) * 3 respects the parentheses", () => {
    expect(show(parseOk("(1 + 2) * 3"))).toBe("((1 + 2) * 3)");
  });

  it("-{a} * 2 parses as (-a) * 2", () => {
    expect(show(parseOk("-{a} * 2"))).toBe("((-a) * 2)");
  });

  it("!{x} && {y} || {z} parses as ((!x) && y) || z", () => {
    expect(show(parseOk("!{x} && {y} || {z}"))).toBe("(((!x) && y) || z)");
  });

  it("{a} < {b} = TRUE parses as (a < b) = TRUE", () => {
    expect(show(parseOk("{a} < {b} = TRUE"))).toBe("((a < b) = TRUE)");
  });

  it("binary operators are left-associative", () => {
    expect(show(parseOk("1 - 2 - 3"))).toBe("((1 - 2) - 3)");
    expect(show(parseOk("8 / 4 % 3"))).toBe("((8 / 4) % 3)");
  });

  it("IF(IS_EMPTY({status}), \"none\", {status}) gives IF with 3 args, first IS_EMPTY", () => {
    const n = parseOk('IF(IS_EMPTY({status}), "none", {status})');
    expect(n.type).toBe("call");
    if (n.type !== "call") return;
    expect(n.name).toBe("IF");
    expect(n.args).toHaveLength(3);
    const first = n.args[0];
    expect(first?.type).toBe("call");
    if (first?.type !== "call") return;
    expect(first.name).toBe("IS_EMPTY");
    expect(show(n)).toBe('IF(IS_EMPTY(status), "none", status)');
  });

  it("function names are case-insensitive: if(...) gives IF", () => {
    const n = parseOk("if(TRUE, 1, 2)");
    expect(n.type === "call" && n.name).toBe("IF");
  });

  it("zero-argument calls parse: TODAY()", () => {
    const n = parseOk("TODAY()");
    expect(n).toEqual({ type: "call", name: "TODAY", args: [], start: 0, end: 7 });
  });

  it("a trailing operator (1 +) gives a syntax error", () => {
    const e = parseErr("1 +");
    expect(e.code).toBe("syntax");
    expect(e.start).toBe(3);
  });

  it("an unbalanced paren gives a syntax error", () => {
    expect(parseErr("(1 + 2").code).toBe("syntax");
    expect(parseErr("1 + 2)").code).toBe("syntax");
    expect(parseErr("IF(1, 2").code).toBe("syntax");
  });

  it("1 2 (missing operator) gives a syntax error", () => {
    const e = parseErr("1 2");
    expect(e.code).toBe("syntax");
    expect(e.start).toBe(2);
    expect(e.end).toBe(3);
  });

  it("an empty source gives a syntax error", () => {
    expect(parseErr("").code).toBe("syntax");
    expect(parseErr("   ").code).toBe("syntax");
  });

  it("a bare identifier that isn't a call (foo) gives a syntax error", () => {
    const e = parseErr("foo");
    expect(e.code).toBe("syntax");
    expect(e.start).toBe(0);
    expect(e.end).toBe(3);
  });

  it("a trailing comma in a call gives a syntax error", () => {
    expect(parseErr("IF(1, 2,)").code).toBe("syntax");
    expect(parseErr("MAX(,1)").code).toBe("syntax");
  });

  it("propagates tokenizer errors", () => {
    const e = parseErr("1 & 2");
    expect(e.code).toBe("syntax");
    expect(e.start).toBe(2);
  });

  it("returns a syntax error instead of overflowing on pathological nesting", () => {
    const deepParens = `${"(".repeat(10000)}1${")".repeat(10000)}`;
    expect(parseErr(deepParens).code).toBe("syntax");
    expect(parseErr(`${"-".repeat(10000)}1`).code).toBe("syntax");
    expect(parseErr(`${"F(".repeat(10000)}1${")".repeat(10000)}`).code).toBe("syntax");
    // moderate nesting is fine
    expect(show(parseOk(`${"(".repeat(50)}1${")".repeat(50)}`))).toBe("1");
  });

  it("every node's start and end cover its source span", () => {
    const src = '  IF(-{a} + 2 * {b} >= 10, "big", LOWER("X"))  ';
    const n = parseOk(src);
    assertNested(n, src);
    const slice = (x: FormulaNode) => src.slice(x.start, x.end);
    expect(slice(n)).toBe('IF(-{a} + 2 * {b} >= 10, "big", LOWER("X"))');
    if (n.type !== "call") throw new Error("expected call");
    const [cond, big, lower] = n.args as [FormulaNode, FormulaNode, FormulaNode];
    expect(slice(cond)).toBe("-{a} + 2 * {b} >= 10");
    expect(slice(big)).toBe('"big"');
    expect(slice(lower)).toBe('LOWER("X")');
    if (cond.type !== "binary" || cond.left.type !== "binary") {
      throw new Error("expected binary");
    }
    const sum = cond.left;
    expect(slice(sum)).toBe("-{a} + 2 * {b}");
    expect(slice(sum.left)).toBe("-{a}");
    expect(slice(sum.right)).toBe("2 * {b}");
    expect(slice(cond.right)).toBe("10");
  });

  it("a parenthesised expression returns the inner node with its span widened to the parens", () => {
    const src = "((1 + 2)) * 3";
    const n = parseOk(src);
    assertNested(n, src);
    if (n.type !== "binary") throw new Error("expected binary");
    expect(src.slice(n.left.start, n.left.end)).toBe("((1 + 2))");
    expect(src.slice(n.start, n.end)).toBe("((1 + 2)) * 3");
  });
});
