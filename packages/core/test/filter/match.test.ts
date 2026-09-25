import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../../src/field-types/default-registry";
import { textFieldType } from "../../src/field-types/builtins/text";
import { SELECT_OPERATORS, findOperator } from "../../src/filter/operators";
import { type FilterMatchContext, matchesFilter } from "../../src/filter/match";
import type { FilterCondition, FilterGroup, FilterNode, FilterValue } from "../../src/filter/types";
import type { GridRow } from "../../src/rows/types";
import type { ColumnDef, GridSchema } from "../../src/schema/types";
import type { AnyFieldType } from "../../src/field-types/types";
import {
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  createFixtureSchema,
} from "../../src/testing/schema";
import { createFixtureRows } from "../../src/testing/rows";

const TS = "2026-09-01T00:00:00.000Z";

function formulaCol(id: string, key: string, resultType: string): ColumnDef {
  return {
    id,
    key,
    label: key,
    type: "formula",
    config: { resultType },
    formula: "1",
    order: 100,
    createdAt: TS,
    updatedAt: TS,
  };
}

function makeSchema(): GridSchema {
  const schema = createFixtureSchema();
  schema.columns.push(
    formulaCol("col_fText", "fText", "text"),
    formulaCol("col_fBool", "fBool", "boolean"),
    formulaCol("col_fDate", "fDate", "date"),
    {
      id: "col_rating",
      key: "rating",
      label: "Rating",
      type: "rating",
      config: {},
      order: 200,
      createdAt: TS,
      updatedAt: TS,
    },
  );
  return schema;
}

function makeCtx(overrides: Partial<FilterMatchContext> = {}): FilterMatchContext {
  const registry = createDefaultRegistry();
  const ratingOps = [
    findOperator(SELECT_OPERATORS, "is"),
    findOperator(SELECT_OPERATORS, "isNot"),
    findOperator(SELECT_OPERATORS, "isAnyOf"),
    findOperator(SELECT_OPERATORS, "isEmpty"),
    findOperator(SELECT_OPERATORS, "isNotEmpty"),
  ].filter((d) => d !== undefined);
  registry.register({ ...(textFieldType as AnyFieldType), id: "rating", operators: ratingOps });
  return {
    schema: makeSchema(),
    registry,
    now: new Date(FIXTURE_NOW),
    tz: FIXTURE_TIME_ZONE,
    userId: "u1",
    ...overrides,
  };
}

const ctx = makeCtx();

function rowWith(cells: Record<string, unknown>): GridRow {
  return { id: "x", version: 1, updatedAt: TS, cells };
}

function cond(columnId: string, operator: string, value?: FilterValue): FilterCondition {
  return value === undefined ? { columnId, operator } : { columnId, operator, value };
}

function m(node: FilterNode | null, cells: Record<string, unknown>, c: FilterMatchContext = ctx): boolean {
  return matchesFilter(node, rowWith(cells), c);
}

const EMPTIES: { label: string; value: unknown }[] = [
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: '""', value: "" },
  { label: "[]", value: [] },
];

describe("matchesFilter basics", () => {
  it("a null node matches every row", () => {
    expect(m(null, {})).toBe(true);
  });

  it("unknown column does not match and does not throw", () => {
    expect(() => m(cond("col_missing", "is", "a"), { name: "a" })).not.toThrow();
    expect(m(cond("col_missing", "is", "a"), { name: "a" })).toBe(false);
    expect(m(cond("col_missing", "isNot", "a"), {})).toBe(false);
  });

  it("operator not offered by the column type does not match and does not throw", () => {
    expect(m(cond(C.name, "gt", 3), { name: "zzz" })).toBe(false);
    expect(m(cond(C.name, "isNotMe"), { name: null })).toBe(false);
    expect(m(cond(C.name, "bogus"), { name: "a" })).toBe(false);
  });

  it("garbage filter values never throw", () => {
    const weird: FilterValue[] = [
      { from: null, to: null },
      { relative: "yesterday" },
      { me: true },
      [1, "a", null],
      "not-a-date",
    ];
    for (const v of weird) {
      for (const colId of Object.values(C)) {
        for (const op of ["is", "isNot", "contains", "eq", "between", "isBetween", "isWithin", "hasAllOf", "isAnyOf"]) {
          expect(() => m(cond(colId, op, v), createFixtureRows()[0]?.cells ?? {})).not.toThrow();
        }
      }
    }
  });
});

describe("negative operators match empty values", () => {
  const cases: { op: string; columnId: string; value?: FilterValue; empties: unknown[] }[] = [
    { op: "isNot", columnId: C.status, value: "paid", empties: [null, undefined, ""] },
    { op: "isNot", columnId: C.name, value: "x", empties: [null, undefined, "", "   "] },
    { op: "isNoneOf", columnId: C.status, value: ["paid"], empties: [null, undefined, ""] },
    { op: "notContains", columnId: C.name, value: "x", empties: [null, undefined, ""] },
    { op: "neq", columnId: C.fee, value: 5, empties: [null, undefined, ""] },
    { op: "hasNoneOf", columnId: C.tags, value: ["vip"], empties: [null, undefined, []] },
    { op: "isNotMe", columnId: C.owner, value: { me: true }, empties: [null, undefined, ""] },
  ];
  for (const c of cases) {
    for (const empty of c.empties) {
      it(`${c.op} on ${c.columnId} matches ${JSON.stringify(empty) ?? "undefined"}`, () => {
        const key = ctx.schema.columns.find((col) => col.id === c.columnId)?.key ?? "";
        expect(m(cond(c.columnId, c.op, c.value), { [key]: empty })).toBe(true);
      });
    }
  }

  it("isNotMe on an empty cell is true even without a userId", () => {
    expect(m(cond(C.owner, "isNotMe", { me: true }), { owner: null }, makeCtx({ userId: undefined }))).toBe(true);
  });
});

describe("positive operators do not match empty values", () => {
  const cases: { op: string; columnId: string; value?: FilterValue }[] = [
    { op: "is", columnId: C.status, value: "paid" },
    { op: "is", columnId: C.name, value: "" },
    { op: "isAnyOf", columnId: C.status, value: ["paid"] },
    { op: "contains", columnId: C.name, value: "" },
    { op: "startsWith", columnId: C.name, value: "" },
    { op: "eq", columnId: C.fee, value: 0 },
    { op: "lt", columnId: C.fee, value: 100 },
    { op: "hasAnyOf", columnId: C.tags, value: ["vip"] },
    { op: "hasAllOf", columnId: C.tags, value: [] },
    { op: "isMe", columnId: C.owner, value: { me: true } },
    { op: "isWithin", columnId: C.callDate, value: { relative: "yesterday" } },
    { op: "isWithin", columnId: C.calledAt, value: { relative: "yesterday" } },
    { op: "isTrue", columnId: C.isActive },
    { op: "isFalse", columnId: C.isActive },
    { op: "isNotEmpty", columnId: C.name },
  ];
  for (const c of cases) {
    for (const empty of EMPTIES) {
      it(`${c.op} on ${c.columnId} does not match ${empty.label}`, () => {
        const key = ctx.schema.columns.find((col) => col.id === c.columnId)?.key ?? "";
        expect(m(cond(c.columnId, c.op, c.value), { [key]: empty.value })).toBe(false);
      });
    }
  }

  it("isEmpty matches every empty shape and not a value", () => {
    for (const empty of EMPTIES) expect(m(cond(C.name, "isEmpty"), { name: empty.value })).toBe(true);
    expect(m(cond(C.name, "isEmpty"), { name: "a" })).toBe(false);
    expect(m(cond(C.name, "isNotEmpty"), { name: "a" })).toBe(true);
    expect(m(cond(C.paid, "isNotEmpty"), { paid: 0 })).toBe(true);
  });
});

describe("Kolkata isWithin yesterday", () => {
  // now = 2026-09-25T02:30+05:30, tz Asia/Kolkata
  const within = cond(C.calledAt, "isWithin", { relative: "yesterday" });
  const at = (s: string) => new Date(s).toISOString();

  it("datetime 2026-09-24T00:00+05:30 matches", () => {
    expect(m(within, { calledAt: at("2026-09-24T00:00:00+05:30") })).toBe(true);
  });
  it("datetime 2026-09-24T23:59:59+05:30 matches", () => {
    expect(m(within, { calledAt: at("2026-09-24T23:59:59+05:30") })).toBe(true);
  });
  it("datetime 2026-09-25T00:00+05:30 does not match (end exclusive)", () => {
    expect(m(within, { calledAt: at("2026-09-25T00:00:00+05:30") })).toBe(false);
  });
  it("datetime 2026-09-23T23:59+05:30 does not match", () => {
    expect(m(within, { calledAt: at("2026-09-23T23:59:00+05:30") })).toBe(false);
  });
  it('date column "2026-09-24" matches and "2026-09-25" does not', () => {
    const c = cond(C.callDate, "isWithin", { relative: "yesterday" });
    expect(m(c, { callDate: "2026-09-24" })).toBe(true);
    expect(m(c, { callDate: "2026-09-25" })).toBe(false);
    expect(m(c, { callDate: "2026-09-23" })).toBe(false);
  });
  it("invalid relative date does not match", () => {
    expect(m(cond(C.callDate, "isWithin", { relative: "lastNDays" }), { callDate: "2026-09-24" })).toBe(false);
  });
});

describe("spec §8 scenario", () => {
  const filter: FilterGroup = {
    op: "and",
    children: [
      cond(C.status, "isNot", "paid"),
      cond(C.callDate, "isWithin", { relative: "yesterday" }),
    ],
  };

  it("matches Pending and null status, not Paid", () => {
    expect(m(filter, { status: "paid", callDate: "2026-09-24" })).toBe(false);
    expect(m(filter, { status: "pending", callDate: "2026-09-24" })).toBe(true);
    expect(m(filter, { status: null, callDate: "2026-09-24" })).toBe(true);
  });

  it("over the fixture rows matches exactly r2 and r3", () => {
    const ids = createFixtureRows()
      .filter((r) => matchesFilter(filter, r, ctx))
      .map((r) => r.id);
    expect(ids).toEqual(["r2", "r3"]);
  });
});

describe("groups", () => {
  const yes = cond(C.name, "is", "a");
  const no = cond(C.name, "is", "b");
  const cells = { name: "a" };

  it("or matches when any child matches", () => {
    expect(m({ op: "or", children: [no, yes] }, cells)).toBe(true);
    expect(m({ op: "or", children: [no, no] }, cells)).toBe(false);
  });
  it("and needs all children", () => {
    expect(m({ op: "and", children: [yes, yes] }, cells)).toBe(true);
    expect(m({ op: "and", children: [yes, no] }, cells)).toBe(false);
  });
  it("empty and matches everything; empty or matches nothing", () => {
    expect(m({ op: "and", children: [] }, cells)).toBe(true);
    expect(m({ op: "or", children: [] }, cells)).toBe(false);
  });
  it("nested groups", () => {
    expect(m({ op: "and", children: [yes, { op: "or", children: [no, yes] }] }, cells)).toBe(true);
  });
});

describe("text", () => {
  it("contains is case-insensitive", () => {
    expect(m(cond(C.name, "contains", "VERMA"), { name: "Asha Verma" })).toBe(true);
    expect(m(cond(C.name, "contains", "zz"), { name: "Asha Verma" })).toBe(false);
    expect(m(cond(C.name, "notContains", "verma"), { name: "Asha VERMA" })).toBe(false);
    expect(m(cond(C.name, "notContains", "zz"), { name: "Asha VERMA" })).toBe(true);
  });
  it("startsWith and is are case-insensitive", () => {
    expect(m(cond(C.email, "startsWith", "ASHA"), { email: "asha@example.com" })).toBe(true);
    expect(m(cond(C.name, "is", " asha verma "), { name: "Asha Verma" })).toBe(true);
    expect(m(cond(C.name, "isNot", "asha verma"), { name: "Asha Verma" })).toBe(false);
  });
  it("formula text result uses text semantics", () => {
    expect(m(cond("col_fText", "contains", "ELL"), { fText: "hello" })).toBe(true);
  });
});

describe("number", () => {
  it("between is inclusive", () => {
    const c = cond(C.fee, "between", { from: 100, to: 200 });
    expect(m(c, { fee: 100 })).toBe(true);
    expect(m(c, { fee: 200 })).toBe(true);
    expect(m(c, { fee: 150 })).toBe(true);
    expect(m(c, { fee: 99 })).toBe(false);
    expect(m(c, { fee: 201 })).toBe(false);
  });
  it("between with a missing bound is open on that side", () => {
    expect(m(cond(C.fee, "between", { from: 100, to: null }), { fee: 1e9 })).toBe(true);
  });
  it("comparisons coerce numeric strings; NaN never matches", () => {
    expect(m(cond(C.fee, "eq", "100"), { fee: 100 })).toBe(true);
    expect(m(cond(C.fee, "gt", 99), { fee: 100 })).toBe(true);
    expect(m(cond(C.fee, "gte", 100), { fee: 100 })).toBe(true);
    expect(m(cond(C.fee, "lte", 99), { fee: 100 })).toBe(false);
    expect(m(cond(C.fee, "lt", "abc"), { fee: 100 })).toBe(false);
    expect(m(cond(C.paid, "eq", 0), { paid: 0 })).toBe(true);
    expect(m(cond(C.paid, "neq", 0), { paid: 5 })).toBe(true);
  });
  it("formula number result uses number semantics", () => {
    expect(m(cond(C.balance, "gt", 1000), { balance: 30000 })).toBe(true);
  });
});

describe("select / multiSelect", () => {
  it("select is compares option ids", () => {
    expect(m(cond(C.status, "is", "paid"), { status: "paid" })).toBe(true);
    expect(m(cond(C.status, "is", "Paid"), { status: "paid" })).toBe(false);
    expect(m(cond(C.status, "isAnyOf", ["pending", "paid"]), { status: "paid" })).toBe(true);
    expect(m(cond(C.status, "isNoneOf", ["pending", "paid"]), { status: "paid" })).toBe(false);
    expect(m(cond(C.stage, "is", "lead"), { stage: "lead" })).toBe(true);
  });
  it("hasAnyOf intersects", () => {
    expect(m(cond(C.tags, "hasAnyOf", ["vip", "scholar"]), { tags: ["scholar"] })).toBe(true);
    expect(m(cond(C.tags, "hasAnyOf", ["vip"]), { tags: ["scholar"] })).toBe(false);
  });
  it("hasAllOf needs every id", () => {
    expect(m(cond(C.tags, "hasAllOf", ["scholar", "referral"]), { tags: ["scholar", "referral", "vip"] })).toBe(true);
    expect(m(cond(C.tags, "hasAllOf", ["scholar", "referral"]), { tags: ["scholar"] })).toBe(false);
  });
  it("hasNoneOf means no intersection", () => {
    expect(m(cond(C.tags, "hasNoneOf", ["vip"]), { tags: ["scholar"] })).toBe(true);
    expect(m(cond(C.tags, "hasNoneOf", ["scholar"]), { tags: ["scholar"] })).toBe(false);
  });
});

describe("user / link", () => {
  it("isMe compares with ctx.userId", () => {
    expect(m(cond(C.owner, "isMe", { me: true }), { owner: { id: "u1" } })).toBe(true);
    expect(m(cond(C.owner, "isMe", { me: true }), { owner: { id: "u2" } })).toBe(false);
    expect(m(cond(C.owner, "isNotMe", { me: true }), { owner: { id: "u2" } })).toBe(true);
    expect(m(cond(C.owner, "isMe", { me: true }), { owner: "u1" })).toBe(true);
  });
  it("without userId, isMe is false and isNotMe is true", () => {
    const noUser = makeCtx({ userId: undefined });
    expect(m(cond(C.owner, "isMe", { me: true }), { owner: { id: "u1" } }, noUser)).toBe(false);
    expect(m(cond(C.owner, "isNotMe", { me: true }), { owner: { id: "u1" } }, noUser)).toBe(true);
  });
  it("user is/isAnyOf compare ids", () => {
    expect(m(cond(C.owner, "is", "u2"), { owner: { id: "u2", name: "C" } })).toBe(true);
    expect(m(cond(C.owner, "isNot", "u2"), { owner: { id: "u2" } })).toBe(false);
    expect(m(cond(C.owner, "isAnyOf", ["u1", "u2"]), { owner: { id: "u2" } })).toBe(true);
    expect(m(cond(C.owner, "isNoneOf", ["u1"]), { owner: { id: "u2" } })).toBe(true);
  });
  it("link is and isAnyOf match on LinkRef ids", () => {
    const cells = { programs: [{ id: "p1", label: "Full Stack" }, { id: "p2", label: "DA" }] };
    expect(m(cond(C.programs, "is", "p2"), cells)).toBe(true);
    expect(m(cond(C.programs, "is", "p3"), cells)).toBe(false);
    expect(m(cond(C.programs, "isAnyOf", ["p3", "p1"]), cells)).toBe(true);
    expect(m(cond(C.programs, "isAnyOf", ["p3"]), cells)).toBe(false);
  });
});

describe("boolean", () => {
  it("isTrue / isFalse compare strictly", () => {
    expect(m(cond(C.isActive, "isTrue"), { isActive: true })).toBe(true);
    expect(m(cond(C.isActive, "isTrue"), { isActive: false })).toBe(false);
    expect(m(cond(C.isActive, "isFalse"), { isActive: false })).toBe(true);
    expect(m(cond(C.isActive, "isTrue"), { isActive: "true" })).toBe(false);
  });
  it("isFalse does not match null (documented: isFalse is not a negative operator)", () => {
    expect(m(cond(C.isActive, "isFalse"), { isActive: null })).toBe(false);
    expect(m(cond(C.isActive, "isFalse"), {})).toBe(false);
  });
  it("formula boolean result uses boolean semantics", () => {
    expect(m(cond("col_fBool", "isTrue"), { fBool: true })).toBe(true);
  });
});

describe("date / datetime", () => {
  it("date is means the same calendar day in tz", () => {
    expect(m(cond(C.callDate, "is", "2026-09-24"), { callDate: "2026-09-24" })).toBe(true);
    expect(m(cond(C.callDate, "is", "2026-09-25"), { callDate: "2026-09-24" })).toBe(false);
    // 2026-09-23T18:30Z is 2026-09-24T00:00 in Kolkata
    expect(m(cond(C.calledAt, "is", "2026-09-24"), { calledAt: "2026-09-23T18:30:00.000Z" })).toBe(true);
    expect(m(cond(C.calledAt, "is", "2026-09-23"), { calledAt: "2026-09-23T18:30:00.000Z" })).toBe(false);
  });
  it("isBefore / isAfter are strict", () => {
    expect(m(cond(C.callDate, "isBefore", "2026-09-24"), { callDate: "2026-09-24" })).toBe(false);
    expect(m(cond(C.callDate, "isBefore", "2026-09-24"), { callDate: "2026-09-23" })).toBe(true);
    expect(m(cond(C.callDate, "isAfter", "2026-09-24"), { callDate: "2026-09-24" })).toBe(false);
    expect(m(cond(C.callDate, "isAfter", "2026-09-24"), { callDate: "2026-09-25" })).toBe(true);
    // late on the 24th in Kolkata is not after the 24th
    expect(m(cond(C.calledAt, "isAfter", "2026-09-24"), { calledAt: "2026-09-24T18:00:00.000Z" })).toBe(false);
    expect(m(cond(C.calledAt, "isAfter", "2026-09-24"), { calledAt: "2026-09-24T18:30:00.000Z" })).toBe(true);
    const t = "2026-09-24T12:00:00.000Z";
    expect(m(cond(C.calledAt, "isBefore", t), { calledAt: t })).toBe(false);
    expect(m(cond(C.calledAt, "isAfter", t), { calledAt: t })).toBe(false);
    expect(m(cond(C.calledAt, "isAfter", t), { calledAt: "2026-09-24T12:00:00.001Z" })).toBe(true);
  });
  it("isBetween is inclusive on both ends as the user sees it", () => {
    const c = cond(C.callDate, "isBetween", { from: "2026-09-20", to: "2026-09-24" });
    expect(m(c, { callDate: "2026-09-20" })).toBe(true);
    expect(m(c, { callDate: "2026-09-24" })).toBe(true);
    expect(m(c, { callDate: "2026-09-19" })).toBe(false);
    expect(m(c, { callDate: "2026-09-25" })).toBe(false);
    const d = cond(C.calledAt, "isBetween", { from: "2026-09-20", to: "2026-09-24" });
    expect(m(d, { calledAt: new Date("2026-09-24T23:59:59+05:30").toISOString() })).toBe(true);
    expect(m(d, { calledAt: new Date("2026-09-25T00:00:00+05:30").toISOString() })).toBe(false);
    const e = cond(C.calledAt, "isBetween", { from: "2026-09-20T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z" });
    expect(m(e, { calledAt: "2026-09-21T00:00:00.000Z" })).toBe(true);
    expect(m(e, { calledAt: "2026-09-21T00:00:00.001Z" })).toBe(false);
  });
  it("unparseable dates never match", () => {
    expect(m(cond(C.callDate, "is", "garbage"), { callDate: "2026-09-24" })).toBe(false);
    expect(m(cond(C.callDate, "isBefore", "2026-09-30"), { callDate: "garbage" })).toBe(false);
  });
  it("formula date result accepts both date and datetime shapes", () => {
    const c = cond("col_fDate", "isWithin", { relative: "yesterday" });
    expect(m(c, { fDate: "2026-09-24" })).toBe(true);
    expect(m(c, { fDate: "2026-09-24T10:00:00.000Z" })).toBe(true);
    expect(m(c, { fDate: "2026-09-25T10:00:00.000Z" })).toBe(false);
  });
});

describe("custom field types", () => {
  it("is / isNot / isAnyOf by strict-or-string equality; empties per the usual rules", () => {
    expect(m(cond("col_rating", "is", "5"), { rating: 5 })).toBe(true);
    expect(m(cond("col_rating", "is", "4"), { rating: 5 })).toBe(false);
    expect(m(cond("col_rating", "isNot", "4"), { rating: 5 })).toBe(true);
    expect(m(cond("col_rating", "isNot", "4"), { rating: null })).toBe(true);
    expect(m(cond("col_rating", "isAnyOf", ["4", "5"]), { rating: 5 })).toBe(true);
    expect(m(cond("col_rating", "isEmpty"), { rating: null })).toBe(true);
    expect(m(cond("col_rating", "isNotEmpty"), { rating: 5 })).toBe(true);
  });
});
