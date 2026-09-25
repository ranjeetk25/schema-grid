export type FormulaResultType = "number" | "text" | "boolean" | "date";

export type FormulaErrorCode =
  | "syntax"
  | "unknownFunction"
  | "arity"
  | "type"
  | "unknownColumn"
  | "cycle"
  | "eval";

export interface FormulaError {
  kind: "formulaError";
  code: FormulaErrorCode;
  message: string;
  start?: number;
  end?: number;
  columnKey?: string;
}

export function isFormulaError(x: unknown): x is FormulaError {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as { kind?: unknown }).kind === "formulaError"
  );
}

export type TokenKind =
  | "number"
  | "string"
  | "boolean"
  | "ref"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

export interface Token {
  kind: TokenKind;
  value: string;
  /** 0-based char offset, inclusive. */
  start: number;
  /** 0-based char offset, exclusive. */
  end: number;
}

export interface NumberLiteral {
  type: "number";
  value: number;
  start: number;
  end: number;
}

export interface StringLiteral {
  type: "string";
  value: string;
  start: number;
  end: number;
}

export interface BooleanLiteral {
  type: "boolean";
  value: boolean;
  start: number;
  end: number;
}

export interface ColumnRef {
  type: "ref";
  key: string;
  start: number;
  end: number;
}

export type UnaryOp = "-" | "!";

export interface UnaryExpr {
  type: "unary";
  op: UnaryOp;
  operand: FormulaNode;
  start: number;
  end: number;
}

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||";

export interface BinaryExpr {
  type: "binary";
  op: BinaryOp;
  left: FormulaNode;
  right: FormulaNode;
  start: number;
  end: number;
}

export interface CallExpr {
  type: "call";
  name: string;
  args: FormulaNode[];
  start: number;
  end: number;
}

export type FormulaNode =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | ColumnRef
  | UnaryExpr
  | BinaryExpr
  | CallExpr;

export type FormulaValue = number | string | boolean | null;

export interface FormulaEnv {
  now: Date;
  tz: string;
}
