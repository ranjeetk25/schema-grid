import { describe, expect, it } from "vitest";
import type { ColorRule } from "../../src/colors/types";
import { createDefaultRegistry } from "../../src/field-types/default-registry";
import { COLOR_OPERATORS, hasColorCondition } from "../../src/filter/operators";
import { type FilterMatchContext, matchesFilter } from "../../src/filter/match";
import type { FilterNode } from "../../src/filter/types";
import { validateFilter } from "../../src/filter/validate";
import type { GridRow } from "../../src/rows/types";
import type { GridSchema } from "../../src/schema/types";
import { FIXTURE_COLUMN_IDS as C, FIXTURE_NOW, FIXTURE_TIME_ZONE, createFixtureSchema } from "../../src/testing/schema";

const registry = createDefaultRegistry();
const base = createFixtureSchema();
const schema: GridSchema = {
  ...base,
  columns: base.columns.map((c) => (c.id === C.website ? { ...c, filterable: false } : c)),
};
const all = new Set(schema.columns.map((c) => c.id));
const validate = (node: FilterNode | null, readable: ReadonlySet<string> = all) =>
  validateFilter(node, schema, registry, readable);
const cond = (columnId: string, operator: string, value?: unknown): FilterNode =>
  (value === undefined ? { columnId, operator } : { columnId, operator, value }) as FilterNode;

describe("COLOR_OPERATORS", () => {
  it("defines colorIs (multi) and colorIsNone (none)", () => {
    expect(COLOR_OPERATORS).toEqual([
      { id: "colorIs", label: "color is", valueKind: "multi" },
      { id: "colorIsNone", label: "has no color", valueKind: "none" },
    ]);
  });

  it("hasColorCondition finds a color operator anywhere in the tree", () => {
    expect(hasColorCondition(null)).toBe(false);
    expect(hasColorCondition(cond(C.name, "is", "x"))).toBe(false);
    expect(hasColorCondition(cond(C.name, "colorIsNone"))).toBe(true);
    expect(
      hasColorCondition({ op: "and", children: [cond(C.name, "is", "x"), { op: "or", children: [cond(C.fee, "colorIs", ["red"])] }] }),
    ).toBe(true);
  });
});

describe("validateFilter with color operators", () => {
  it("accepts them on every readable column, including filterable:false and formula columns", () => {
    for (const id of [C.name, C.website, C.balance, C.programs]) {
      expect(validate(cond(id, "colorIs", ["red", "blue"]))).toEqual([]);
      expect(validate(cond(id, "colorIsNone"))).toEqual([]);
    }
    // Value operators still reject the unfilterable column.
    expect(validate(cond(C.website, "isEmpty"))[0]?.code).toBe("unfilterableColumn");
  });

  it("rejects unknown and unreadable columns", () => {
    expect(validate(cond("col_x", "colorIs", ["red"]))[0]?.code).toBe("unknownColumn");
    const readable = new Set([...all].filter((id) => id !== C.notes));
    expect(validate(cond(C.notes, "colorIsNone"), readable)[0]?.code).toBe("unreadableColumn");
  });

  it("validates the values as palette colors", () => {
    for (const bad of [[], ["red", "magenta"], "red", [1], undefined]) {
      expect(validate(cond(C.name, "colorIs", bad))[0]?.code).toBe("valueKindMismatch");
    }
    expect(validate(cond(C.name, "colorIsNone", ["red"]))[0]?.code).toBe("valueKindMismatch");
  });
});

describe("matchesFilter with color operators", () => {
  const ctxBase: FilterMatchContext = { schema, registry, now: new Date(FIXTURE_NOW), tz: FIXTURE_TIME_ZONE };
  const rules: ColorRule[] = [
    { id: "a", color: "green", target: { kind: "cells", columnIds: [C.status] }, when: cond(C.status, "is", "paid") },
    { id: "b", color: "yellow", target: { kind: "row" }, when: cond(C.fee, "gt", 55000) },
  ];
  const ctx: FilterMatchContext = { ...ctxBase, colorRules: rules };
  const mk = (id: string, cells: Record<string, unknown>, colors?: GridRow["colors"]): GridRow => ({
    id,
    version: 1,
    updatedAt: FIXTURE_NOW,
    cells,
    ...(colors ? { colors } : {}),
  });
  const manual = mk("m", { status: "paid", fee: 60000 }, { [C.status]: "red" });
  const cellRule = mk("c", { status: "paid", fee: 1 });
  const rowRule = mk("r", { status: "pending", fee: 60000 });
  const none = mk("n", { status: "pending", fee: 1 });

  it("colorIs matches the shown color (manual > cells rule > row rule)", () => {
    const red = cond(C.status, "colorIs", ["red"]);
    const green = cond(C.status, "colorIs", ["green"]);
    const yellow = cond(C.status, "colorIs", ["yellow", "blue"]);
    expect([manual, cellRule, rowRule, none].map((r) => matchesFilter(red, r, ctx))).toEqual([true, false, false, false]);
    expect([manual, cellRule, rowRule, none].map((r) => matchesFilter(green, r, ctx))).toEqual([false, true, false, false]);
    expect([manual, cellRule, rowRule, none].map((r) => matchesFilter(yellow, r, ctx))).toEqual([false, false, true, false]);
  });

  it("colorIsNone matches rows with no shown color", () => {
    const n = cond(C.status, "colorIsNone");
    expect([manual, cellRule, rowRule, none].map((r) => matchesFilter(n, r, ctx))).toEqual([false, false, false, true]);
  });

  it("without colorRules only manual colors count", () => {
    expect(matchesFilter(cond(C.status, "colorIs", ["green"]), cellRule, ctxBase)).toBe(false);
    expect(matchesFilter(cond(C.status, "colorIs", ["red"]), manual, ctxBase)).toBe(true);
    expect(matchesFilter(cond(C.status, "colorIsNone"), cellRule, ctxBase)).toBe(true);
  });

  it("works on filterable:false columns and never matches unknown columns or bad values", () => {
    const painted = mk("w", {}, { [C.website]: "blue" });
    expect(matchesFilter(cond(C.website, "colorIs", ["blue"]), painted, ctxBase)).toBe(true);
    expect(matchesFilter(cond("col_x", "colorIsNone"), painted, ctxBase)).toBe(false);
    expect(matchesFilter(cond(C.website, "colorIs", "blue"), painted, ctxBase)).toBe(false);
    expect(matchesFilter(cond(C.website, "colorIs", []), painted, ctxBase)).toBe(false);
  });

  it("combines with value conditions", () => {
    const f: FilterNode = { op: "and", children: [cond(C.status, "colorIsNone"), cond(C.status, "is", "pending")] };
    expect([manual, cellRule, rowRule, none].map((r) => matchesFilter(f, r, ctx))).toEqual([false, false, false, true]);
    const g: FilterNode = { op: "or", children: [cond(C.status, "colorIs", ["red"]), cond(C.fee, "lt", 10)] };
    expect([manual, cellRule, rowRule, none].map((r) => matchesFilter(g, r, ctx))).toEqual([true, true, false, true]);
  });
});
