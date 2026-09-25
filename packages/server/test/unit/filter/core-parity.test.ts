import { describe, expect, it } from "vitest";
import { translateFilter } from "../../../src/filter/translate-filter";
import {
  type FilterNode,
  type FilterValue,
  createDefaultRegistry,
  isNegativeOperator,
  matchesFilter,
} from "../../../src/internal/core";
import { resolveColumnExpr } from "../../../src/sql/column-expr";
import { allTypesSchema, column, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

/**
 * Parity between the SQL translator and core's reference matcher
 * (`matchesFilter`, packages/core/src/filter/match.ts), checked STATICALLY:
 *
 * 1. Constant cases — the translator must emit a constant comparison
 *    (`FALSE` for unusable values / empty lists, `TRUE` for fully open ranges)
 *    and core must agree on every sample cell.
 * 2. Evaluable cases — the emitted comparison is a conjunction of simple
 *    `expr <op> ?` / `IN` / `JSON_OVERLAPS` / `JSON_CONTAINS` / `LIKE` terms; a tiny
 *    JS evaluator runs it over typed sample cells and must agree with core.
 * 3. The null rule — empty cells match iff the operator is negative, in both.
 *
 * Real SQL-execution parity (collations, casts, REGEXP) is covered by the gated
 * MySQL integration suite.
 */

const schema = allTypesSchema();
const USER = "u1";
const NOW = new Date("2026-09-25T00:30:00+05:30");
const TZ = "Asia/Kolkata";
const scope = makeScope(makeCtx(schema, { user: { id: USER, roles: ["admin"] }, now: NOW, tz: TZ }));
const coreCtx = { schema, registry: createDefaultRegistry(), now: NOW, tz: TZ, userId: USER };

const ABSENT = Symbol("absent");
type Cell = unknown;

/** Non-empty and empty sample cells per column (well-typed storage). */
const SAMPLES: Record<string, { nonEmpty: Cell[]; empty: Cell[] }> = {
  name: { nonEmpty: ["abc", "ABC ", " abc", "x y", "5", "true", "a%b"], empty: [null, ABSENT, "", "  ", " \t\n"] },
  fee: { nonEmpty: [0, 5, -1.5, 100, 5.25], empty: [null, ABSENT] },
  paymentStatus: { nonEmpty: ["paid", "pending", "7"], empty: [null, ABSENT, "", "  "] },
  owner: { nonEmpty: [{ id: "u1" }, { id: "u7" }], empty: [null, ABSENT] },
  tags: { nonEmpty: [["a"], ["a", "b"], ["2"], ["c"]], empty: [null, ABSENT, []] },
  links: { nonEmpty: [[{ id: "rec_1" }], [{ id: "rec_2" }, { id: "rec_3" }]], empty: [null, ABSENT, []] },
  callDate: { nonEmpty: ["2026-08-31", "2026-09-01", "2026-09-23", "2026-09-24", "2026-09-25", "2026-10-01"], empty: [null, ABSENT] },
  calledAt: {
    nonEmpty: [
      "2026-08-31T18:29:59.999Z",
      "2026-08-31T18:30:00.000Z",
      "2026-09-23T18:29:59.999Z",
      "2026-09-23T18:30:00.000Z",
      "2026-09-24T06:30:00.000Z",
      "2026-09-24T12:00:00.000Z",
      "2026-09-24T18:29:59.999Z",
      "2026-09-24T18:30:00.000Z",
      "2026-09-24T20:00:00.000Z",
      "2026-09-30T18:30:00.000Z",
    ],
    empty: [null, ABSENT],
  },
};

function coreMatch(node: FilterNode, cell: Cell): boolean {
  const colKey = (node as { columnId: string }).columnId;
  const cells = cell === ABSENT ? {} : { [colKey]: cell };
  return matchesFilter(node, { id: "r1", version: 1, cells } as never, coreCtx);
}

function translate(node: FilterNode) {
  const out = translateFilter(node, scope);
  if (!out) throw new Error("expected SQL");
  return renderSql(out);
}

function emptySql(columnId: string): string {
  return renderSql(resolveColumnExpr(column(schema, columnId), scope).empty).sql;
}

/** Splits `(<cmp> AND NOT <empty>)` / `(<cmp> OR <empty>)` and checks the wrapper matches the operator polarity. */
function splitWrapper(node: FilterNode, sqlText: string): string {
  const { columnId, operator } = node as { columnId: string; operator: string };
  const empty = emptySql(columnId);
  const negative = isNegativeOperator(operator);
  const suffix = negative ? ` OR ${empty})` : ` AND NOT ${empty})`;
  expect(sqlText.startsWith("(")).toBe(true);
  expect(sqlText.endsWith(suffix)).toBe(true);
  return sqlText.slice(1, sqlText.length - suffix.length);
}

// ---------------------------------------------------------------- typed cell values (what `typed` evaluates to)

function mysqlUtc(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").replace("Z", "");
}

function typedOf(columnId: string, cell: Cell): unknown {
  switch (columnId) {
    case "owner":
      return (cell as { id: string }).id;
    case "tags":
      return (cell as unknown[]).map(String);
    case "links":
      return (cell as { id: string }[]).map((l) => l.id);
    case "calledAt":
      return mysqlUtc(cell as string);
    default:
      return cell;
  }
}

// ---------------------------------------------------------------- mini evaluator for the emitted comparison

/** ai_ci-ish comparison of strings for the ascii samples: case-insensitive. */
const ci = (x: unknown) => String(x).toLowerCase();
const spaceTrim = (s: string) => s.replace(/^ +| +$/g, "");

function likeMatch(value: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "!") {
      re += (pattern[++i] as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is").test(value);
}

function cmpScalar(a: unknown, op: string, b: unknown): boolean {
  const [x, y] =
    typeof a === "number" ? [a, Number(b)] : typeof a === "string" ? [ci(a), ci(b)] : [a as number, b as number];
  switch (op) {
    case "=":
      return x === y;
    case "<>":
      return x !== y;
    case "<":
      return x < y;
    case "<=":
      return x <= y;
    case ">":
      return x > y;
    case ">=":
      return x >= y;
    default:
      throw new Error(`op ${op}`);
  }
}

/** Evaluates the comparison part for one typed, non-empty cell value. */
function evalCmp(cmp: string, params: unknown[], typed: unknown): boolean {
  if (cmp === "FALSE") return false;
  if (cmp === "TRUE") return true;
  if (/^(NOT )?JSON_(OVERLAPS|CONTAINS)\(/.test(cmp)) {
    const have = typed as string[];
    const want = JSON.parse(params[0] as string) as string[];
    const r = cmp.includes("JSON_CONTAINS(") ? want.every((w) => have.includes(w)) : want.some((w) => have.includes(w));
    return cmp.startsWith("NOT ") ? !r : r;
  }
  if (/ (NOT )?IN \(\?/.test(cmp)) {
    const r = params.some((p) => ci(p) === ci(typed));
    return / NOT IN \(\?/.test(cmp) ? !r : r;
  }
  if (/ (NOT )?LIKE \? ESCAPE '!'$/.test(cmp)) {
    const r = likeMatch(String(typed), params[0] as string);
    return / NOT LIKE /.test(cmp) ? !r : r;
  }
  const trimmed = cmp.startsWith("TRIM(");
  const value = trimmed ? spaceTrim(String(typed)) : typed;
  const ops = [...cmp.matchAll(/ (>=|<=|<>|=|<|>) \?/g)].map((m) => m[1] as string);
  expect(ops.length).toBe(params.length);
  return ops.every((op, i) => cmpScalar(value, op, params[i]));
}

// ---------------------------------------------------------------- cases

type Case = [columnId: string, operator: string, value: FilterValue | undefined];
const v = (x: unknown) => x as FilterValue;

/** Unusable values / empty lists → constant FALSE; core never matches a non-empty cell. */
const FALSE_CASES: Case[] = [
  // text
  ["name", "contains", v({ a: 1 })],
  ["name", "is", null],
  ["name", "is", v([])],
  ["name", "isNot", v({ a: 1 })],
  ["name", "notContains", v(["x"])],
  // number
  ["fee", "neq", "abc"],
  ["fee", "neq", ""],
  ["fee", "gt", "0x10"],
  ["fee", "eq", "Infinity"],
  ["fee", "eq", "1e400"],
  ["fee", "lt", true],
  ["fee", "between", v({ from: "abc", to: 1 })],
  ["fee", "between", 5],
  // select
  ["paymentStatus", "is", true],
  ["paymentStatus", "isNot", v(["paid"])],
  ["paymentStatus", "isAnyOf", v([])],
  ["paymentStatus", "isAnyOf", "paid"],
  ["paymentStatus", "isAnyOf", v([null])],
  ["paymentStatus", "isNoneOf", v([])],
  ["paymentStatus", "isNoneOf", v([true])],
  ["paymentStatus", "isNoneOf", v([null])],
  // user
  ["owner", "is", v({ x: 1 })],
  ["owner", "isNot", true],
  ["owner", "isAnyOf", v([])],
  ["owner", "isNoneOf", v([])],
  // multiSelect
  ["tags", "hasAnyOf", v([])],
  ["tags", "hasAllOf", v([])],
  ["tags", "hasAllOf", "a"],
  ["tags", "hasNoneOf", v([])],
  ["tags", "hasNoneOf", "a"],
  // link
  ["links", "is", true],
  ["links", "isAnyOf", v([])],
  // date / datetime
  ["callDate", "is", "2026-02-30"],
  ["callDate", "is", "yesterday"],
  ["callDate", "isBefore", 20260924],
  ["callDate", "isAfter", "2026-09-24T10:00:00"],
  ["callDate", "isBetween", "2026-09-01"],
  ["callDate", "isBetween", v({ from: "nope", to: null })],
  ["callDate", "isWithin", "yesterday"],
  ["callDate", "isWithin", v({ relative: "lastNDays" })],
  ["calledAt", "is", "2026-09-24T10:00:00"],
  ["calledAt", "isBefore", "2026-13-01"],
  ["calledAt", "isBetween", v({ from: "2026-09-01", to: "later" })],
  ["calledAt", "isWithin", v({ relative: "nope" })],
];

/** Fully open ranges → constant TRUE; core matches every non-empty cell. */
const TRUE_CASES: Case[] = [
  ["fee", "between", v({ from: null, to: "" })],
  ["fee", "between", v({ from: "  ", to: null })],
  ["callDate", "isBetween", v({ from: null, to: null })],
  ["calledAt", "isBetween", v({ from: " ", to: null })],
];

/** Non-constant comparisons, evaluated by the mini evaluator over the samples. */
const EVAL_CASES: Case[] = [
  // text
  ["name", "is", "abc"],
  ["name", "is", "  ABC "],
  ["name", "is", 5],
  ["name", "is", true],
  ["name", "isNot", " abc"],
  ["name", "contains", "b"],
  ["name", "contains", " a"],
  ["name", "contains", "%"],
  ["name", "notContains", "B"],
  ["name", "startsWith", "ab"],
  ["name", "startsWith", " "],
  // number
  ["fee", "eq", "5"],
  ["fee", "eq", " 5.25 "],
  ["fee", "neq", 5],
  ["fee", "gt", " 0 "],
  ["fee", "lte", -1.5],
  ["fee", "gte", ".5e1"],
  ["fee", "between", v({ from: 0, to: 5 })],
  ["fee", "between", v({ from: "1", to: null })],
  ["fee", "between", v({ from: null, to: 5 })],
  // select
  ["paymentStatus", "is", "paid"],
  ["paymentStatus", "is", 7],
  ["paymentStatus", "is", v({ id: "pending" })],
  ["paymentStatus", "isNot", "paid"],
  ["paymentStatus", "isAnyOf", v(["paid", 7])],
  ["paymentStatus", "isNoneOf", v(["paid"])],
  ["paymentStatus", "isNoneOf", v(["paid", true])],
  // user
  ["owner", "is", "u7"],
  ["owner", "isNot", v({ id: "u7" })],
  ["owner", "isAnyOf", v(["u1", "zz"])],
  ["owner", "isNoneOf", v(["u1"])],
  ["owner", "isMe", v({ me: true })],
  ["owner", "isNotMe", v({ me: true })],
  // multiSelect
  ["tags", "hasAnyOf", v(["b", 2])],
  ["tags", "hasAllOf", v(["a", "b"])],
  ["tags", "hasAllOf", v(["a", null])],
  ["tags", "hasNoneOf", v(["a"])],
  ["tags", "hasNoneOf", v([{ id: "a" }])],
  // link
  ["links", "is", "rec_2"],
  ["links", "is", v({ id: "rec_1" })],
  ["links", "isAnyOf", v(["rec_1", "rec_3"])],
  // date column
  ["callDate", "is", "2026-09-24"],
  ["callDate", "is", " 2026-09-24 "],
  ["callDate", "is", "2026-09-24T20:00:00Z"],
  ["callDate", "isBefore", "2026-09-24"],
  ["callDate", "isBefore", "2026-09-24T12:00:00+05:30"],
  ["callDate", "isBefore", "2026-09-24T00:00:00+05:30"],
  ["callDate", "isAfter", "2026-09-24"],
  ["callDate", "isAfter", "2026-09-24T12:00:00+05:30"],
  ["callDate", "isAfter", "2026-09-23T18:30:00Z"],
  ["callDate", "isAfter", "2026-09-23T18:29:59.999Z"],
  ["callDate", "isBetween", v({ from: "2026-09-01", to: "2026-09-24" })],
  ["callDate", "isBetween", v({ from: "2026-09-01T12:00:00+05:30", to: "2026-09-24T00:00:00+05:30" })],
  ["callDate", "isBetween", v({ from: null, to: "2026-09-24T23:00:00+05:30" })],
  ["callDate", "isBetween", v({ from: "2026-09-24", to: "" })],
  ["callDate", "isWithin", v({ relative: "yesterday" })],
  ["callDate", "isWithin", v({ relative: "today" })],
  ["callDate", "isWithin", v({ relative: "lastNDays", n: 7 })],
  ["callDate", "isWithin", v({ relative: "thisMonth" })],
  // datetime column
  ["calledAt", "is", "2026-09-24"],
  ["calledAt", "is", "2026-09-24T10:00:00.000+05:30"],
  ["calledAt", "is", "2026-09-24T20:00:00Z"],
  ["calledAt", "isBefore", "2026-09-24"],
  ["calledAt", "isBefore", "2026-09-24T12:00:00Z"],
  ["calledAt", "isBefore", "2026-09-24T12:00:00.000999Z"],
  ["calledAt", "isAfter", "2026-09-24"],
  ["calledAt", "isAfter", "2026-09-24T12:00:00Z"],
  ["calledAt", "isBetween", v({ from: "2026-09-01", to: "2026-09-24" })],
  ["calledAt", "isBetween", v({ from: "2026-09-24T06:30:00Z", to: "2026-09-24T18:30:00Z" })],
  ["calledAt", "isBetween", v({ from: null, to: "2026-09-24" })],
  ["calledAt", "isWithin", v({ relative: "yesterday" })],
  ["calledAt", "isWithin", v({ relative: "today" })],
  ["calledAt", "isWithin", v({ relative: "lastNDays", n: 7 })],
];

const label = ([c, o, val]: Case) => `${c} ${o} ${JSON.stringify(val)}`;
const node = ([columnId, operator, value]: Case): FilterNode =>
  (value === undefined ? { columnId, operator } : { columnId, operator, value }) as FilterNode;

function expectNullRule(c: Case): void {
  const n = node(c);
  const negative = isNegativeOperator(c[1]);
  for (const cell of SAMPLES[c[0]]?.empty ?? []) {
    expect(coreMatch(n, cell), `core on empty ${String(cell)}`).toBe(negative);
  }
}

describe("core parity: unusable values and empty lists → constant FALSE", () => {
  it.each(FALSE_CASES.map((c) => [label(c), c] as const))("%s", (_l, c) => {
    const n = node(c);
    const out = translate(n);
    expect(splitWrapper(n, out.sql)).toBe("FALSE");
    expect(out.params).toEqual([]);
    for (const cell of SAMPLES[c[0]]?.nonEmpty ?? []) expect(coreMatch(n, cell), JSON.stringify(cell)).toBe(false);
    expectNullRule(c);
  });
});

describe("core parity: fully open ranges → constant TRUE (any non-empty cell)", () => {
  it.each(TRUE_CASES.map((c) => [label(c), c] as const))("%s", (_l, c) => {
    const n = node(c);
    const out = translate(n);
    expect(splitWrapper(n, out.sql)).toBe("TRUE");
    for (const cell of SAMPLES[c[0]]?.nonEmpty ?? []) expect(coreMatch(n, cell), JSON.stringify(cell)).toBe(true);
    expectNullRule(c);
  });
});

describe("core parity: evaluated comparisons agree with matchesFilter on every sample", () => {
  it.each(EVAL_CASES.map((c) => [label(c), c] as const))("%s", (_l, c) => {
    const n = node(c);
    const out = translate(n);
    const cmp = splitWrapper(n, out.sql);
    expect(cmp).not.toBe("FALSE");
    for (const cell of SAMPLES[c[0]]?.nonEmpty ?? []) {
      // isMe binds ctx.user.id as its (only) param.
      const sqlResult = evalCmp(cmp, out.params, typedOf(c[0], cell));
      expect(sqlResult, `cell ${JSON.stringify(cell)}; sql ${cmp}; params ${JSON.stringify(out.params)}`).toBe(
        coreMatch(n, cell),
      );
    }
    expectNullRule(c);
  });
});

describe("core parity: isEmpty / isNotEmpty", () => {
  it.each(Object.keys(SAMPLES))("%s", (columnId) => {
    const samples = SAMPLES[columnId] as { nonEmpty: Cell[]; empty: Cell[] };
    const isEmpty = { columnId, operator: "isEmpty" } as FilterNode;
    for (const cell of samples.empty) expect(coreMatch(isEmpty, cell)).toBe(true);
    for (const cell of samples.nonEmpty) expect(coreMatch(isEmpty, cell)).toBe(false);
    expect(translate(isEmpty).sql).toBe(emptySql(columnId));
    expect(translate({ columnId, operator: "isNotEmpty" } as FilterNode).sql).toBe(`NOT ${emptySql(columnId)}`);
  });

  it("text-like empties are whitespace-aware (REGEXP), matching core isEmptyValue", () => {
    for (const id of ["name", "paymentStatus", "owner"]) expect(emptySql(id)).toContain("REGEXP_LIKE(");
  });
});
