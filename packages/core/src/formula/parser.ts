import { tokenize } from "./tokenizer";
import type {
  BinaryOp,
  FormulaError,
  FormulaNode,
  Token,
} from "./types";

/** Maximum nesting of parentheses / unary operators / calls before bailing out. */
const MAX_DEPTH = 200;

/** Binding power per binary operator (higher binds tighter). All left-associative. */
const BINARY_PRECEDENCE: Record<BinaryOp, number> = {
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

function isBinaryOp(value: string): value is BinaryOp {
  return Object.prototype.hasOwnProperty.call(BINARY_PRECEDENCE, value);
}

class ParseFailure {
  constructor(readonly error: FormulaError) {}
}

function fail(message: string, start: number, end: number): never {
  throw new ParseFailure({ kind: "formulaError", code: "syntax", message, start, end });
}

function describe(tok: Token): string {
  return tok.kind === "eof" ? "end of formula" : `'${tok.value}'`;
}

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    // tokenize always appends an eof token, so the last token is a safe fallback.
    return (this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]) as Token;
  }

  private next(): Token {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private enter(tok: Token): void {
    this.depth++;
    if (this.depth > MAX_DEPTH) {
      fail("Formula is nested too deeply", tok.start, tok.end);
    }
  }

  private leave(): void {
    this.depth--;
  }

  parseFormula(): FormulaNode {
    const first = this.peek();
    if (first.kind === "eof") fail("Formula is empty", first.start, first.end);
    const node = this.parseExpr(0);
    const tok = this.peek();
    if (tok.kind !== "eof") {
      fail(`Unexpected ${describe(tok)}; expected an operator`, tok.start, tok.end);
    }
    return node;
  }

  /** Pratt loop: parses binary operators binding tighter than `minPrec`. */
  private parseExpr(minPrec: number): FormulaNode {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      if (tok.kind !== "op" || !isBinaryOp(tok.value)) break;
      const prec = BINARY_PRECEDENCE[tok.value];
      if (prec <= minPrec) break;
      this.next();
      const right = this.parseExpr(prec);
      left = { type: "binary", op: tok.value, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  private parseUnary(): FormulaNode {
    const tok = this.peek();
    if (tok.kind === "op" && (tok.value === "-" || tok.value === "!")) {
      this.next();
      this.enter(tok);
      const operand = this.parseUnary();
      this.leave();
      return { type: "unary", op: tok.value, operand, start: tok.start, end: operand.end };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode {
    const tok = this.next();
    switch (tok.kind) {
      case "number": {
        const value = Number(tok.value);
        if (!Number.isFinite(value)) fail(`Invalid number '${tok.value}'`, tok.start, tok.end);
        return { type: "number", value, start: tok.start, end: tok.end };
      }
      case "string":
        return { type: "string", value: tok.value, start: tok.start, end: tok.end };
      case "boolean":
        return { type: "boolean", value: tok.value === "true", start: tok.start, end: tok.end };
      case "ref":
        return { type: "ref", key: tok.value, start: tok.start, end: tok.end };
      case "lparen": {
        // Parentheses only group: the inner node is returned with its span
        // widened to include the parentheses, so spans always stay balanced.
        this.enter(tok);
        const inner = this.parseExpr(0);
        this.leave();
        const close = this.expectRparen(tok);
        return { ...inner, start: tok.start, end: close.end };
      }
      case "ident":
        return this.parseCall(tok);
      default:
        fail(`Unexpected ${describe(tok)}; expected a value`, tok.start, tok.end);
    }
  }

  private parseCall(name: Token): FormulaNode {
    const lparen = this.peek();
    if (lparen.kind !== "lparen") {
      fail(
        `Unknown identifier '${name.value}'; use {${name.value}} for a column or ${name.value}(...) for a function`,
        name.start,
        name.end,
      );
    }
    this.next();
    this.enter(lparen);
    const args: FormulaNode[] = [];
    if (this.peek().kind !== "rparen") {
      for (;;) {
        args.push(this.parseExpr(0));
        if (this.peek().kind !== "comma") break;
        this.next();
      }
    }
    this.leave();
    const rparen = this.expectRparen(lparen);
    return {
      type: "call",
      name: name.value.toUpperCase(),
      args,
      start: name.start,
      end: rparen.end,
    };
  }

  private expectRparen(open: Token): Token {
    const tok = this.peek();
    if (tok.kind !== "rparen") {
      if (tok.kind === "eof") {
        fail("Missing closing parenthesis", open.start, tok.end);
      }
      fail(`Unexpected ${describe(tok)}; expected ')'`, tok.start, tok.end);
    }
    return this.next();
  }
}

/**
 * Parses a formula source string into a FormulaNode AST. Never throws: tokenizer
 * and parse failures are returned as a FormulaError with code "syntax" and the
 * offending source span. Parenthesised expressions yield their inner node with
 * its span widened to include the parentheses. Nesting deeper than 200 levels of
 * parentheses/unary operators/calls is rejected as a syntax error.
 */
export function parseFormula(src: string): FormulaNode | FormulaError {
  const tokens = tokenize(src);
  if (!Array.isArray(tokens)) return tokens;
  try {
    return new Parser(tokens).parseFormula();
  } catch (e) {
    if (e instanceof ParseFailure) return e.error;
    const message = e instanceof Error ? e.message : "Failed to parse formula";
    return { kind: "formulaError", code: "syntax", message, start: 0, end: src.length };
  }
}
