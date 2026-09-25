import { describe, expect, it } from "vitest";
import { isFormulaError } from "../../src/formula/types";
import { tokenize } from "../../src/formula/tokenizer";

describe("tokenize", () => {
  it("tokenizes {fee} - {paid} as ref, op, ref, eof with correct positions", () => {
    const src = "{fee} - {paid}";
    const result = tokenize(src);
    expect(isFormulaError(result)).toBe(false);
    if (isFormulaError(result)) return;
    expect(result.map((t) => t.kind)).toEqual(["ref", "op", "ref", "eof"]);
    expect(result[0]).toMatchObject({ kind: "ref", value: "fee", start: 0, end: 5 });
    expect(result[1]).toMatchObject({ kind: "op", value: "-", start: 6, end: 7 });
    expect(result[2]).toMatchObject({ kind: "ref", value: "paid", start: 8, end: 14 });
    expect(result[3]).toMatchObject({ kind: "eof", start: 14, end: 14 });
  });

  it("supports double-quoted string literals", () => {
    const result = tokenize('"hello"');
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "string", value: "hello", start: 0, end: 7 });
  });

  it("supports single-quoted string literals", () => {
    const result = tokenize("'hello'");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "string", value: "hello", start: 0, end: 7 });
  });

  it("supports backslash escapes in strings", () => {
    const result = tokenize('"a\\"b"');
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "string", value: 'a"b' });
  });

  it("supports backslash-escaped backslash", () => {
    const result = tokenize('"a\\\\b"');
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "string", value: "a\\b" });
  });

  it("supports decimal numbers", () => {
    const result = tokenize("3.14");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "number", value: "3.14" });
  });

  it("supports leading-dot numbers", () => {
    const result = tokenize(".5");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "number", value: ".5" });
  });

  it("TRUE and false are booleans, case-insensitive", () => {
    const r1 = tokenize("TRUE");
    const r2 = tokenize("false");
    if (isFormulaError(r1) || isFormulaError(r2)) throw new Error("unexpected error");
    expect(r1[0]).toMatchObject({ kind: "boolean", value: "true" });
    expect(r2[0]).toMatchObject({ kind: "boolean", value: "false" });
  });

  it("normalises == to =", () => {
    const result = tokenize("==");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "op", value: "=" });
  });

  it("normalises <> to !=", () => {
    const result = tokenize("<>");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "op", value: "!=" });
  });

  it("keeps != as !=", () => {
    const result = tokenize("!=");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "op", value: "!=" });
  });

  it("&&, || and ! are ops", () => {
    const result = tokenize("&& || !");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result.map((t) => t.kind)).toEqual(["op", "op", "op", "eof"]);
    expect(result.map((t) => t.value)).toEqual(["&&", "||", "!", ""]);
  });

  it("a lone & is a syntax error", () => {
    const result = tokenize("&");
    expect(isFormulaError(result)).toBe(true);
    if (!isFormulaError(result)) return;
    expect(result.code).toBe("syntax");
  });

  it("a lone | is a syntax error", () => {
    const result = tokenize("|");
    expect(isFormulaError(result)).toBe(true);
    if (!isFormulaError(result)) return;
    expect(result.code).toBe("syntax");
  });

  it("an unterminated string gives a syntax error with its start position", () => {
    const result = tokenize('"abc');
    expect(isFormulaError(result)).toBe(true);
    if (!isFormulaError(result)) return;
    expect(result.code).toBe("syntax");
    expect(result.start).toBe(0);
  });

  it("an unterminated {fee gives a syntax error", () => {
    const result = tokenize("{fee");
    expect(isFormulaError(result)).toBe(true);
    if (!isFormulaError(result)) return;
    expect(result.code).toBe("syntax");
    expect(result.start).toBe(0);
  });

  it("an empty {} gives a syntax error", () => {
    const result = tokenize("{}");
    expect(isFormulaError(result)).toBe(true);
    if (!isFormulaError(result)) return;
    expect(result.code).toBe("syntax");
  });

  it("trims whitespace inside ref braces", () => {
    const result = tokenize("{ fee }");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result[0]).toMatchObject({ kind: "ref", value: "fee" });
  });

  it("an unexpected character # gives a syntax error with its position", () => {
    const result = tokenize("1 + #");
    expect(isFormulaError(result)).toBe(true);
    if (!isFormulaError(result)) return;
    expect(result.code).toBe("syntax");
    expect(result.start).toBe(4);
  });

  it("tokenizes idents for function names", () => {
    const result = tokenize("SUM(1, 2)");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result.map((t) => t.kind)).toEqual([
      "ident",
      "lparen",
      "number",
      "comma",
      "number",
      "rparen",
      "eof",
    ]);
    expect(result[0]).toMatchObject({ value: "SUM" });
  });

  it("recognises single-char ops + - * / %", () => {
    const result = tokenize("+ - * / %");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result.map((t) => t.kind)).toEqual(["op", "op", "op", "op", "op", "eof"]);
    expect(result.map((t) => t.value)).toEqual(["+", "-", "*", "/", "%", ""]);
  });

  it("recognises comparison ops < <= > >=", () => {
    const result = tokenize("< <= > >=");
    if (isFormulaError(result)) throw new Error("unexpected error");
    expect(result.map((t) => t.value)).toEqual(["<", "<=", ">", ">=", ""]);
  });
});
