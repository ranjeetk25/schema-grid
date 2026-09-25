import { describe, expect, it } from "vitest";
import { FORMULA_FUNCTIONS, getFormulaFunction } from "../../src/formula/functions";
import type { FormulaEnv, FormulaResultType, FormulaValue } from "../../src/formula/types";
import { isFormulaError } from "../../src/formula/types";

const env: FormulaEnv = { now: new Date("2026-09-24T20:00:00.000Z"), tz: "Asia/Kolkata" };

function call(name: string, ...args: FormulaValue[]): unknown {
  const fn = getFormulaFunction(name);
  if (!fn) throw new Error(`missing ${name}`);
  return fn.impl(args, env);
}

function infer(name: string, ...types: FormulaResultType[]): unknown {
  const fn = getFormulaFunction(name);
  if (!fn) throw new Error(`missing ${name}`);
  return fn.inferReturn(types);
}

function expectErr(x: unknown, code: string): void {
  expect(isFormulaError(x)).toBe(true);
  expect(x).toMatchObject({ kind: "formulaError", code });
}

const NAMES = [
  "IF", "AND", "OR", "NOT", "SUM", "AVG", "MIN", "MAX", "ROUND", "ABS", "CONCAT", "UPPER", "LOWER",
  "TRIM", "LEN", "LEFT", "RIGHT", "TODAY", "NOW", "DATEADD", "DATEDIFF", "YEAR", "MONTH", "DAY",
  "IS_EMPTY", "COALESCE",
];

describe("formula function library", () => {
  it("has all 26 names from spec 4.8 and no others", () => {
    expect(NAMES).toHaveLength(26);
    expect([...FORMULA_FUNCTIONS.keys()].sort()).toEqual([...NAMES].sort());
    for (const [k, def] of FORMULA_FUNCTIONS) expect(def.name).toBe(k);
  });

  it("looks up case-insensitively", () => {
    expect(getFormulaFunction("round")?.name).toBe("ROUND");
    expect(getFormulaFunction("nope")).toBeUndefined();
  });

  it("ROUND(2.345, 2) = 2.35 and ROUND(-2.5) = -3", () => {
    expect(call("ROUND", 2.345, 2)).toBe(2.35);
    expect(call("ROUND", -2.5)).toBe(-3);
    expect(call("ROUND", 1.005, 2)).toBe(1.01);
    expect(call("ROUND", 2.5)).toBe(3);
    expect(call("ROUND", null)).toBeNull();
  });

  it("SUM(1, null, 2) = 3; AVG of only empties is null", () => {
    expect(call("SUM", 1, null, 2)).toBe(3);
    expect(call("SUM")).toBe(0);
    expect(call("AVG", null, "")).toBeNull();
    expect(call("AVG", 1, 2, null)).toBe(1.5);
    expect(call("MIN", 3, null, 1)).toBe(1);
    expect(call("MAX", null)).toBeNull();
    expectErr(call("SUM", 1, "x"), "eval");
  });

  it('LEFT("Masai", 2) = "Ma"; LEN("") = 0', () => {
    expect(call("LEFT", "Masai", 2)).toBe("Ma");
    expect(call("RIGHT", "Masai", 2)).toBe("ai");
    expect(call("LEN", "")).toBe(0);
    expect(call("LEN", null)).toBe(0);
    expect(call("LEFT", null, 2)).toBeNull();
    expectErr(call("LEFT", "Masai", -1), "eval");
    expect(call("UPPER", "ab")).toBe("AB");
    expect(call("TRIM", "  a ")).toBe("a");
    expect(call("CONCAT", "a", null, 1, true)).toBe("a1true");
  });

  it("TODAY with now 2026-09-24T20:00Z in Kolkata is 2026-09-25; NOW is ISO", () => {
    expect(call("TODAY")).toBe("2026-09-25");
    expect(call("NOW")).toBe("2026-09-24T20:00:00.000Z");
  });

  it('DATEADD("2026-01-31", 1, "months") = "2026-02-28"', () => {
    expect(call("DATEADD", "2026-01-31", 1, "months")).toBe("2026-02-28");
    expect(call("DATEADD", "2026-01-31", 1, "Day")).toBe("2026-02-01");
    expect(call("DATEADD", "2024-02-29", 1, "years")).toBe("2025-02-28");
    expect(call("DATEADD", "2026-09-25", 2, "hours")).toBe("2026-09-24T20:30:00.000Z");
    expect(call("DATEADD", "2026-09-24T20:00:00.000Z", 1, "months")).toBe("2026-10-24T20:00:00.000Z");
    expect(call("DATEADD", "2026-09-24T20:00:00.000Z", 30, "minutes")).toBe("2026-09-24T20:30:00.000Z");
    expect(call("DATEADD", null, 1, "days")).toBeNull();
  });

  it('DATEDIFF("2026-09-01","2026-09-25","days") = 24', () => {
    expect(call("DATEDIFF", "2026-09-01", "2026-09-25", "days")).toBe(24);
    expect(call("DATEDIFF", "2026-09-25", "2026-09-01", "weeks")).toBe(-3);
    expect(call("DATEDIFF", "2026-01-31", "2026-02-28", "months")).toBe(0);
    expect(call("DATEDIFF", "2026-01-15", "2027-01-15", "years")).toBe(1);
    expect(call("DATEDIFF", "2026-09-24T20:00:00.000Z", "2026-09-24T22:30:00.000Z", "hours")).toBe(2);
    expect(call("DATEDIFF", null, "2026-09-01", "days")).toBeNull();
  });

  it('YEAR("2026-09-25") = 2026, datetimes evaluated in env.tz', () => {
    expect(call("YEAR", "2026-09-25")).toBe(2026);
    expect(call("MONTH", "2026-09-25")).toBe(9);
    expect(call("DAY", "2026-09-25")).toBe(25);
    expect(call("YEAR", "2026-12-31T20:00:00.000Z")).toBe(2027);
    expect(call("YEAR", null)).toBeNull();
  });

  it('IS_EMPTY("") is true; IS_EMPTY(0) is false', () => {
    expect(call("IS_EMPTY", "")).toBe(true);
    expect(call("IS_EMPTY", "  ")).toBe(true);
    expect(call("IS_EMPTY", null)).toBe(true);
    expect(call("IS_EMPTY", 0)).toBe(false);
    expect(call("IS_EMPTY", false)).toBe(false);
  });

  it('COALESCE(null, "", "x") = "x"', () => {
    expect(call("COALESCE", null, "", "x")).toBe("x");
    expect(call("COALESCE", null, "")).toBeNull();
  });

  it("IF, AND, OR, NOT runtime behaviour", () => {
    expect(call("IF", true, 1, 2)).toBe(1);
    expect(call("IF", false, 1)).toBeNull();
    expect(call("AND", true, null)).toBe(false);
    expect(call("OR", null, true)).toBe(true);
    expect(call("NOT", null)).toBe(true);
    expectErr(call("AND", 1), "eval");
  });

  it("inferReturn: IF with number and text branches is a type error", () => {
    expectErr(infer("IF", "boolean", "number", "text"), "type");
    expect(infer("IF", "boolean", "number", "number")).toBe("number");
    expect(infer("IF", "boolean", "date")).toBe("date");
  });

  it("inferReturn: LEFT with a number first argument is a type error", () => {
    expectErr(infer("LEFT", "number", "number"), "type");
    expect(infer("LEFT", "text", "number")).toBe("text");
  });

  it("DATEADD with an unknown unit is an eval error (checked at eval time)", () => {
    expect(infer("DATEADD", "date", "number", "text")).toBe("date");
    expectErr(call("DATEADD", "2026-01-31", 1, "fortnights"), "eval");
    expectErr(call("DATEDIFF", "2026-01-31", "2026-02-01", "fortnights"), "eval");
  });

  it("other inferReturn rules", () => {
    expectErr(infer("SUM", "number", "text"), "type");
    expect(infer("CONCAT", "number", "date")).toBe("text");
    expectErr(infer("COALESCE", "text", "number"), "type");
    expect(infer("COALESCE", "date", "date")).toBe("date");
    expect(infer("IS_EMPTY", "date")).toBe("boolean");
    expect(infer("DATEDIFF", "date", "date", "text")).toBe("number");
  });

  it("exposes arity limits: NOT is 1..1", () => {
    const not = getFormulaFunction("NOT");
    expect(not?.minArgs).toBe(1);
    expect(not?.maxArgs).toBe(1);
    expect(getFormulaFunction("SUM")?.maxArgs).toBe(Number.POSITIVE_INFINITY);
  });

  it("impl does not crash on missing args", () => {
    for (const def of FORMULA_FUNCTIONS.values()) {
      expect(() => def.impl([], env)).not.toThrow();
    }
  });
});
