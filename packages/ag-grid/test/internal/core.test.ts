/**
 * Tests for the local core stand-ins in src/internal/core.ts.
 * TODO(core): delete once the real core ships (core owns these semantics).
 */
import { describe, expect, it } from "vitest";
import {
  type FilterNode,
  createDefaultRegistry,
  createRolePermissionResolver,
  computeAggregate,
  dependencies,
  evaluate,
  isFormulaError,
  matchesFilter,
  parseFormula,
  resolveColumnAccess,
  resolveRelativeDate,
  sortRows,
  validateFilter,
} from "../../src/internal/core";
import { createInMemoryDataSource } from "../fixtures/dataSource";
import { ADMIN, AGENT, fixtureRows, fixtureSchema, row } from "../fixtures/schema";

const registry = createDefaultRegistry();
const now = new Date("2026-09-25T06:00:00.000Z"); // 11:30 IST, Friday
const ctx = { schema: fixtureSchema, registry, now, tz: "Asia/Kolkata", user: { id: "u-agent" } };
const ids = (node: FilterNode) => fixtureRows.filter((r) => matchesFilter(r, node, ctx)).map((r) => r.id);

describe("registry", () => {
  it("has all 16 built-ins", () => {
    expect(registry.list()).toHaveLength(16);
  });
  it("parse never throws and reports errors", () => {
    expect(registry.get("number")?.parse("1,234.5", {})).toEqual({ ok: true, value: 1234.5 });
    expect(registry.get("number")?.parse("abc", {}).ok).toBe(false);
    expect(registry.get("date")?.parse("25/09/2026", {})).toEqual({ ok: true, value: "2026-09-25" });
    expect(registry.get("boolean")?.parse("yes", {})).toEqual({ ok: true, value: true });
    expect(registry.get("select")?.parse("Paid", { options: [{ value: "paid", label: "Paid" }] })).toEqual({
      ok: true,
      value: "paid",
    });
  });
  it("fillSeries continues number and date series", () => {
    expect(registry.get("number")?.fillSeries?.([1, 2], 3)).toEqual([3, 4, 5]);
    expect(registry.get("date")?.fillSeries?.(["2026-09-01", "2026-09-03"], 2)).toEqual(["2026-09-05", "2026-09-07"]);
  });
});

describe("matchesFilter null semantics", () => {
  it("negative operators match empty, positive never do", () => {
    expect(ids({ columnId: "payment", operator: "isNot", value: "paid" })).toEqual(["r2", "r3", "r4"]);
    expect(ids({ columnId: "payment", operator: "is", value: "paid" })).toEqual(["r1"]);
    expect(ids({ columnId: "score", operator: "neq", value: 10 })).toEqual(["r2", "r3", "r4"]);
    expect(ids({ columnId: "score", operator: "lt", value: 100 })).toEqual(["r1", "r2", "r4"]);
    expect(ids({ columnId: "name", operator: "notContains", value: "a" })).toEqual(["r4"]);
    expect(ids({ columnId: "tags", operator: "hasNoneOf", value: ["hot"] })).toEqual(["r2", "r3", "r4"]);
    expect(ids({ columnId: "owner", operator: "isNotMe" })).toEqual(["r2", "r3"]);
  });
  it("isBetween / between are inclusive", () => {
    expect(ids({ columnId: "score", operator: "between", value: { from: 5, to: 10 } })).toEqual(["r1", "r2"]);
    expect(ids({ columnId: "callDate", operator: "isBetween", value: { from: "2026-09-23", to: "2026-09-24" } })).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
  });
  it("acceptance: payment is not Paid AND call date within yesterday (IST)", () => {
    const node: FilterNode = {
      op: "and",
      children: [
        { columnId: "payment", operator: "isNot", value: "paid" },
        { columnId: "callDate", operator: "isWithin", value: { relative: "yesterday" } },
      ],
    };
    // yesterday = 2026-09-24 → r1 (paid, excluded) and r3 (empty payment, included)
    expect(ids(node)).toEqual(["r3"]);
  });
});

describe("resolveRelativeDate", () => {
  it("is half-open in Asia/Kolkata", () => {
    expect(resolveRelativeDate({ relative: "today" }, now)).toEqual({
      from: "2026-09-24T18:30:00.000Z",
      to: "2026-09-25T18:30:00.000Z",
    });
  });
  it("weeks start Monday", () => {
    expect(resolveRelativeDate({ relative: "thisWeek" }, now).from).toBe("2026-09-20T18:30:00.000Z");
  });
  it("lastNDays includes today", () => {
    expect(resolveRelativeDate({ relative: "lastNDays", n: 3 }, now)).toEqual({
      from: "2026-09-22T18:30:00.000Z",
      to: "2026-09-25T18:30:00.000Z",
    });
  });
  it("lastMonth", () => {
    expect(resolveRelativeDate({ relative: "lastMonth" }, now)).toEqual({
      from: "2026-07-31T18:30:00.000Z",
      to: "2026-08-31T18:30:00.000Z",
    });
  });
});

describe("validateFilter", () => {
  const readable = ["name", "payment"];
  it("reports unknown and unreadable columns", () => {
    const errs = validateFilter(
      {
        op: "and",
        children: [
          { columnId: "nope", operator: "is" },
          { columnId: "salary", operator: "eq", value: 1 },
        ],
      },
      fixtureSchema,
      registry,
      readable,
    );
    expect(errs.map((e) => e.code)).toEqual(["unknownColumn", "unreadableColumn"]);
  });
  it("reports depth > 2", () => {
    const deep: FilterNode = {
      op: "and",
      children: [{ op: "or", children: [{ op: "and", children: [{ columnId: "name", operator: "isEmpty" }] }] }],
    };
    expect(validateFilter(deep, fixtureSchema, registry, readable).map((e) => e.code)).toEqual(["depthExceeded"]);
  });
});

describe("sortRows", () => {
  it("puts nulls last in both directions", () => {
    const opts = { schema: fixtureSchema, registry };
    expect(sortRows(fixtureRows, [{ columnId: "score", dir: "asc" }], opts).map((r) => r.id)).toEqual(["r2", "r1", "r4", "r3"]);
    expect(sortRows(fixtureRows, [{ columnId: "score", dir: "desc" }], opts).map((r) => r.id)).toEqual(["r4", "r1", "r2", "r3"]);
  });
});

describe("aggregate", () => {
  it("sums, averages, counts", () => {
    expect(computeAggregate([1, 2, null], "sum")).toBe(3);
    expect(computeAggregate([1, 2, null], "avg")).toBe(1.5);
    expect(computeAggregate([1, 2, null], "countEmpty")).toBe(1);
  });
});

describe("permissions", () => {
  it("role rule resolves hidden/read/edit", () => {
    const resolver = createRolePermissionResolver();
    const agent = resolveColumnAccess(fixtureSchema, resolver, AGENT);
    const admin = resolveColumnAccess(fixtureSchema, resolver, ADMIN);
    expect(agent.get("salary")).toBe("hidden");
    expect(agent.get("status")).toBe("read");
    expect(agent.get("name")).toBe("edit");
    expect(agent.get("total")).toBe("read");
    expect(admin.get("salary")).toBe("edit");
  });
});

describe("formula (minimal)", () => {
  it("parses refs and arithmetic", () => {
    const ast = parseFormula("{score} * 2 + {fee}");
    if (isFormulaError(ast)) throw ast;
    expect(dependencies(ast)).toEqual(["score", "fee"]);
    expect(evaluate(ast, row("x", { score: 3, fee: 4 }), fixtureSchema, { now, tz: "Asia/Kolkata" })).toBe(10);
  });
  it("supports IF and IS_EMPTY", () => {
    const ast = parseFormula('IF(IS_EMPTY({name}), "none", {name})');
    if (isFormulaError(ast)) throw ast;
    expect(evaluate(ast, row("x", {}), fixtureSchema, { now, tz: "Asia/Kolkata" })).toBe("none");
  });
  it("returns a FormulaError for bad syntax", () => {
    expect(isFormulaError(parseFormula("{score} *"))).toBe(true);
  });
  it.todo("DATEADD / DATEDIFF / YEAR / MONTH / DAY / LEFT / RIGHT (owned by core)");
  it.todo("cross-column cycle detection report (owned by core)");
  it.todo("inferResultType for every function (owned by core)");
});

describe("in-memory data source fixture", () => {
  it("applies with matching version and conflicts on mismatch without blocking other rows", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const result = await ds.applyChanges({
      id: "b1",
      source: "edit",
      baseVersions: { r1: 1, r2: 99 },
      changes: [
        { rowId: "r1", columnId: "name", prev: "Asha", next: "A" },
        { rowId: "r2", columnId: "name", prev: "Bala", next: "B" },
      ],
    });
    expect(result.applied.map((c) => c.rowId)).toEqual(["r1"]);
    expect(result.conflicts).toMatchObject([{ rowId: "r2", serverValue: "Bala", serverVersion: 1 }]);
    const feed = await ds.getChanges(null);
    expect(feed.rows.map((r) => [r.id, r.version])).toEqual([["r1", 2]]);
    const next = await ds.getChanges(feed.cursor);
    expect(next.rows).toEqual([]);
  });
  it("pages by offset and cursor", async () => {
    const ds = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const a = await ds.fetch({ filter: null, sort: [], page: { cursor: null, limit: 3 } });
    expect(a.rows).toHaveLength(3);
    expect(a.nextCursor).toBe("3");
    const b = await ds.fetch({ filter: null, sort: [], page: { cursor: "3", limit: 3 } });
    expect(b.rows.map((r) => r.id)).toEqual(["r4"]);
    expect(b.nextCursor).toBeUndefined();
  });
});
