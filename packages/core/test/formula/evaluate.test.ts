import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/formula/evaluate";
import { parseFormula } from "../../src/formula/parser";
import type { FormulaEnv, FormulaNode } from "../../src/formula/types";
import { isFormulaError } from "../../src/formula/types";
import type { GridRow } from "../../src/rows/types";
import type { ColumnDef, GridSchema } from "../../src/schema/types";
import { createFixtureRows } from "../../src/testing/rows";
import { createFixtureSchema } from "../../src/testing/schema";

const schema = createFixtureSchema();
const env: FormulaEnv = { now: new Date("2026-09-24T21:00:00.000Z"), tz: "Asia/Kolkata" };

function ast(src: string): FormulaNode {
  const node = parseFormula(src);
  if (isFormulaError(node)) throw new Error(`parse failed: ${node.message}`);
  return node;
}

function row(cells: Record<string, unknown>): GridRow {
  return { id: "r", version: 1, updatedAt: "2026-09-01T00:00:00.000Z", cells };
}

function ev(src: string, cells: Record<string, unknown> = {}, s: GridSchema = schema, e: FormulaEnv = env): unknown {
  return evaluate(ast(src), row(cells), s, e);
}

function column(key: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef {
  return {
    id: `col_${key}`,
    key,
    label: key,
    type,
    config: {},
    order: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}

function schemaOf(...columns: ColumnDef[]): GridSchema {
  return { id: "s", schemaVersion: 1, columns };
}

const numSchema = schemaOf(column("a", "number"), column("b", "number"), column("t", "text"), column("ok", "boolean"));

describe("evaluate: plan cases", () => {
  it("{fee} - {paid} with fee 50000 and paid 20000 gives 30000", () => {
    expect(ev("{fee} - {paid}", { fee: 50000, paid: 20000 })).toBe(30000);
  });

  it("{fee} - {paid} with paid empty gives 50000", () => {
    expect(ev("{fee} - {paid}", { fee: 50000, paid: null })).toBe(50000);
    expect(ev("{fee} - {paid}", { fee: 50000 })).toBe(50000);
  });

  it('IF(IS_EMPTY({status}), "none", {status}) gives "none" or the option label', () => {
    const f = 'IF(IS_EMPTY({status}), "none", {status})';
    expect(ev(f, { status: null })).toBe("none");
    expect(ev(f, { status: "paid" })).toBe("Paid");
  });

  it("{a} / 0 gives null", () => {
    expect(ev("{a} / 0", { a: 10 }, numSchema)).toBeNull();
    expect(ev("{a} % 0", { a: 10 }, numSchema)).toBeNull();
  });

  it("TODAY() uses env.now and env.tz", () => {
    // 2026-09-24T21:00Z is 2026-09-25 02:30 in Kolkata, still 2026-09-24 in UTC.
    expect(ev("TODAY()")).toBe("2026-09-25");
    expect(ev("TODAY()", {}, schema, { now: env.now, tz: "UTC" })).toBe("2026-09-24");
  });

  it("YEAR({calledAt}) evaluates in env.tz across the new-year boundary", () => {
    expect(ev("YEAR({calledAt})", { calledAt: "2026-12-31T20:00:00.000Z" })).toBe(2027);
    expect(ev("YEAR({calledAt})", { calledAt: "2026-12-31T20:00:00.000Z" }, schema, { now: env.now, tz: "UTC" })).toBe(
      2026,
    );
  });

  it("AND({isActive}, {fee} > 0) gives a boolean", () => {
    expect(ev("AND({isActive}, {fee} > 0)", { isActive: true, fee: 100 })).toBe(true);
    expect(ev("AND({isActive}, {fee} > 0)", { isActive: false, fee: 100 })).toBe(false);
    expect(ev("AND({isActive}, {fee} > 0)", { isActive: true, fee: null })).toBe(false);
  });

  it("a ref to a column deleted from the schema gives an eval error instead of throwing", () => {
    const node = ast("{fee} + {paid}");
    const s = createFixtureSchema();
    s.columns = s.columns.filter((c) => c.key !== "paid");
    const r = evaluate(node, row({ fee: 1, paid: 2 }), s, env);
    expect(r).toMatchObject({ kind: "formulaError", code: "eval", columnKey: "paid" });
  });

  it("{balance} * 2 evaluates through the referenced formula", () => {
    expect(ev("{balance} * 2", { fee: 50000, paid: 20000 })).toBe(60000);
  });

  it("recomputes formula refs from source, ignoring stale materialised values", () => {
    expect(ev("{balance}", { fee: 50000, paid: 20000, balance: 999 })).toBe(30000);
  });

  it("works on the fixture rows", () => {
    const rows = createFixtureRows();
    const results = rows.map((r) => evaluate(ast("{balance}"), r, schema, env));
    expect(results).toEqual([30000, 0, 45000, 0, 60000]);
  });
});

describe("evaluate: ref normalisation", () => {
  it("select / creatableSelect give the option label, falling back to the raw id", () => {
    expect(ev("{status}", { status: "pending" })).toBe("Pending");
    expect(ev("{status}", { status: "ghost" })).toBe("ghost");
    expect(ev("{stage}", { stage: "lead" })).toBe("Lead");
    expect(ev("{stage}", { stage: "Waitlisted" })).toBe("Waitlisted");
  });

  it("multiSelect joins labels with ', '; empty arrays are null", () => {
    expect(ev("{tags}", { tags: ["scholar", "vip", "new"] })).toBe("Scholarship, VIP, new");
    expect(ev("{tags}", { tags: [] })).toBeNull();
  });

  it("user gives name, falling back to id", () => {
    expect(ev("{owner}", { owner: { id: "u1", name: "Anil" } })).toBe("Anil");
    expect(ev("{owner}", { owner: { id: "u9" } })).toBe("u9");
    expect(ev("{owner}", { owner: null })).toBeNull();
  });

  it("link joins labels", () => {
    expect(
      ev("{programs}", {
        programs: [
          { id: "p1", label: "Full Stack" },
          { id: "p2", label: "Data Analytics" },
        ],
      }),
    ).toBe("Full Stack, Data Analytics");
    expect(ev("{programs}", { programs: [] })).toBeNull();
  });

  it("date and datetime pass ISO strings through", () => {
    expect(ev("{callDate}", { callDate: "2026-09-24" })).toBe("2026-09-24");
    expect(ev("{calledAt}", { calledAt: "2026-09-24T05:00:00.000Z" })).toBe("2026-09-24T05:00:00.000Z");
  });

  it("numbers accept numeric strings; garbage becomes null", () => {
    expect(ev("{a} + 1", { a: "41" }, numSchema)).toBe(42);
    expect(ev("{a}", { a: "abc" }, numSchema)).toBeNull();
    expect(ev("{a}", { a: Number.NaN }, numSchema)).toBeNull();
  });

  it("booleans, text and missing cells", () => {
    expect(ev("{ok}", { ok: true }, numSchema)).toBe(true);
    expect(ev("{ok}", { ok: "yes" }, numSchema)).toBeNull();
    expect(ev("{t}", { t: "hi" }, numSchema)).toBe("hi");
    expect(ev("{t}", {}, numSchema)).toBeNull();
  });
});

describe("evaluate: operators", () => {
  it("arithmetic treats empty as 0 and rejects non-numbers", () => {
    expect(ev("{a} * {b}", { a: null, b: 5 }, numSchema)).toBe(0);
    expect(ev('{a} + ""', { a: 2 }, numSchema)).toBe(2);
    expect(ev("{t} + 1", { t: "x" }, numSchema)).toMatchObject({ code: "eval" });
    expect(ev('"a" + "b"')).toMatchObject({ code: "eval" });
    expect(ev("true + 1")).toMatchObject({ code: "eval" });
  });

  it("non-finite results become null", () => {
    expect(ev("{a} * {a}", { a: 1e200 }, numSchema)).toBeNull();
  });

  it("unary operators", () => {
    expect(ev("-{a}", { a: 3 }, numSchema)).toBe(-3);
    expect(ev("-{a}", { a: null }, numSchema)).toBe(0);
    expect(ev("!{ok}", { ok: null }, numSchema)).toBe(true);
    expect(ev("!{ok}", { ok: true }, numSchema)).toBe(false);
    expect(ev("-{t}", { t: "x" }, numSchema)).toMatchObject({ code: "eval" });
  });

  it("comparisons involving empty values are false, except = against empty", () => {
    expect(ev("{a} > 0", { a: null }, numSchema)).toBe(false);
    expect(ev("{a} < 0", { a: null }, numSchema)).toBe(false);
    expect(ev('{t} = ""', { t: null }, numSchema)).toBe(true);
    expect(ev('{t} != ""', { t: null }, numSchema)).toBe(false);
    expect(ev("{a} = 0", { a: null }, numSchema)).toBe(false);
    expect(ev("{a} != 0", { a: null }, numSchema)).toBe(false);
    expect(ev('{t} = "x"', { t: null }, numSchema)).toBe(false);
  });

  it("text comparison is case-insensitive", () => {
    expect(ev('{t} <= "A"', { t: "a" }, numSchema)).toBe(true);
    expect(ev('{t} >= "A"', { t: "a" }, numSchema)).toBe(true);
    expect(ev('{t} = "HELLO"', { t: "hello" }, numSchema)).toBe(true);
    expect(ev('{t} != "HELLO"', { t: "hello" }, numSchema)).toBe(false);
    expect(ev('{t} < "b"', { t: "a" }, numSchema)).toBe(true);
    expect(ev('{status} = "paid"', { status: "paid" })).toBe(true);
  });

  it("date comparisons compare instants in env.tz", () => {
    expect(ev('{callDate} >= "2026-09-01"', { callDate: "2026-09-24" })).toBe(true);
    expect(ev("{callDate} < TODAY()", { callDate: "2026-09-24" })).toBe(true);
    // 2026-09-23T18:30Z is midnight 2026-09-24 in Kolkata.
    expect(ev('{calledAt} = "2026-09-24"', { calledAt: "2026-09-23T18:30:00.000Z" })).toBe(true);
    expect(ev('{calledAt} > "2026-09-24"', { calledAt: "2026-09-23T18:00:00.000Z" })).toBe(false);
  });

  it("&& / || short-circuit and treat null as false", () => {
    expect(ev("{ok} && {t}", { ok: false, t: "x" }, numSchema)).toBe(false);
    expect(ev("{ok} || {t}", { ok: true, t: "x" }, numSchema)).toBe(true);
    expect(ev("{ok} || true", { ok: null }, numSchema)).toBe(true);
    expect(ev("{ok} && {t}", { ok: true, t: "x" }, numSchema)).toMatchObject({ code: "eval" });
  });
});

describe("evaluate: calls and errors", () => {
  it("unknown function and arity errors", () => {
    expect(ev("FOO(1)")).toMatchObject({ code: "unknownFunction" });
    expect(ev("NOT(true, false)")).toMatchObject({ code: "arity" });
  });

  it("propagates the first argument error", () => {
    expect(ev("SUM({t} + 1, 2)", { t: "x" }, numSchema)).toMatchObject({ code: "eval" });
  });

  it("detects formula cycles without throwing", () => {
    const s = schemaOf(
      column("a", "formula", { config: { resultType: "number" }, formula: "{b} + 1" }),
      column("b", "formula", { config: { resultType: "number" }, formula: "{a} + 1" }),
    );
    expect(ev("{a}", {}, s)).toMatchObject({ kind: "formulaError", code: "cycle" });
  });

  it("a referenced formula that fails to parse gives an eval error", () => {
    const s = schemaOf(column("f", "formula", { config: { resultType: "number" }, formula: "1 +" }));
    expect(ev("{f} * 2", {}, s)).toMatchObject({ code: "eval", columnKey: "f" });
  });

  it("never throws on a bad time zone or garbage AST", () => {
    expect(ev("TODAY()", {}, schema, { now: env.now, tz: "Not/AZone" })).toMatchObject({ kind: "formulaError" });
    const bad = { type: "weird" } as unknown as FormulaNode;
    expect(evaluate(bad, row({}), schema, env)).toMatchObject({ kind: "formulaError", code: "eval" });
  });
});

describe("evaluate performance", () => {
  it("memoises shared formula refs (diamond chains stay linear)", () => {
    const TS = "2026-09-01T00:00:00.000Z";
    const depth = 30;
    const columns = [
      { id: "id_base", key: "base", label: "base", type: "number", config: {}, order: 0, createdAt: TS, updatedAt: TS },
      ...Array.from({ length: depth }, (_, i) => ({
        id: `id_f${i}`,
        key: `f${i}`,
        label: `f${i}`,
        type: "formula",
        config: { resultType: "number" },
        formula: i === depth - 1 ? "{base} + {base}" : `{f${i + 1}} + {f${i + 1}}`,
        order: i + 1,
        createdAt: TS,
        updatedAt: TS,
      })),
    ];
    const schema = { id: "s", schemaVersion: 1, columns };
    const ast = parseFormula("{f0}");
    if (isFormulaError(ast)) throw new Error("parse");
    const started = Date.now();
    const out = evaluate(ast, { id: "r", version: 1, updatedAt: TS, cells: { base: 1 } }, schema, {
      now: new Date(TS),
      tz: "Asia/Kolkata",
    });
    expect(out).toBe(2 ** depth);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
