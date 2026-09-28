import { describe, expect, it } from "vitest";
import {
  CELL_COLORS,
  type ColorRule,
  canColorCell,
  isCellColor,
  resolveCellColor,
  resolveRowColor,
  validateColorRules,
} from "../../src/colors/index";
import { createDefaultRegistry } from "../../src/field-types/default-registry";
import type { FilterMatchContext } from "../../src/filter/match";
import { createRolePermissionResolver } from "../../src/permissions/role-resolver";
import type { GridRow } from "../../src/rows/types";
import type { GridSchema } from "../../src/schema/types";
import {
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
  createFixtureSchema,
} from "../../src/testing/schema";

const registry = createDefaultRegistry();
const schema: GridSchema = createFixtureSchema();
const all = new Set(schema.columns.map((c) => c.id));
const ctx: FilterMatchContext = { schema, registry, now: new Date(FIXTURE_NOW), tz: FIXTURE_TIME_ZONE };

const row = (cells: Record<string, unknown>, colors?: GridRow["colors"]): GridRow => ({
  id: "r1",
  version: 1,
  updatedAt: FIXTURE_NOW,
  cells,
  ...(colors ? { colors } : {}),
});

const paidRule: ColorRule = {
  id: "paid",
  color: "green",
  target: { kind: "cells", columnIds: [C.status, C.paid] },
  when: { columnId: C.status, operator: "is", value: "paid" },
};
const bigFeeRow: ColorRule = {
  id: "big",
  color: "yellow",
  target: { kind: "row" },
  when: { columnId: C.fee, operator: "gt", value: 10000 },
};

describe("palette", () => {
  it("lists the nine colors in palette order", () => {
    expect(CELL_COLORS).toEqual(["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray"]);
    expect(Object.isFrozen(CELL_COLORS)).toBe(true);
  });

  it("isCellColor only accepts palette names", () => {
    for (const c of CELL_COLORS) expect(isCellColor(c)).toBe(true);
    for (const v of ["Red", "#ff0000", "", null, undefined, 1, {}, ["red"]]) expect(isCellColor(v)).toBe(false);
  });
});

describe("resolveCellColor", () => {
  const r = row({ status: "paid", fee: 50000, paid: 20000 });

  it("returns null without manual colors or rules", () => {
    expect(resolveCellColor(r, C.status, undefined, ctx)).toBeNull();
    expect(resolveCellColor(r, C.status, [], ctx)).toBeNull();
  });

  it("applies precedence manual > cells rule > row rule", () => {
    const rules = [bigFeeRow, paidRule];
    expect(resolveCellColor(r, C.status, rules, ctx)).toBe("green"); // cells rule beats the earlier row rule
    expect(resolveCellColor(r, C.name, rules, ctx)).toBe("yellow"); // only the row rule targets name
    const manual = row({ status: "paid", fee: 50000 }, { [C.status]: "red" });
    expect(resolveCellColor(manual, C.status, rules, ctx)).toBe("red");
  });

  it("uses the first matching rule within a tier", () => {
    const blue: ColorRule = { ...paidRule, id: "blue", color: "blue" };
    expect(resolveCellColor(r, C.status, [paidRule, blue], ctx)).toBe("green");
    expect(resolveCellColor(r, C.status, [blue, paidRule], ctx)).toBe("blue");
  });

  it("skips disabled rules, null conditions and non-targeted columns", () => {
    expect(resolveCellColor(r, C.status, [{ ...paidRule, enabled: false }], ctx)).toBeNull();
    expect(resolveCellColor(r, C.status, [{ ...paidRule, when: null }], ctx)).toBeNull();
    expect(resolveCellColor(r, C.fee, [paidRule], ctx)).toBeNull();
    expect(resolveCellColor(row({ status: "pending" }), C.status, [paidRule], ctx)).toBeNull();
  });

  it("ignores invalid manual colors", () => {
    const bad = row({}, { [C.status]: "magenta" as never });
    expect(resolveCellColor(bad, C.status, [], ctx)).toBeNull();
  });

  it("never matches a color condition inside a rule's own condition (no recursion)", () => {
    const loop: ColorRule = {
      id: "loop",
      color: "red",
      target: { kind: "row" },
      when: { columnId: C.name, operator: "colorIsNone" },
    };
    expect(resolveCellColor(r, C.name, [loop], { ...ctx, colorRules: [loop] })).toBeNull();
  });
});

describe("resolveRowColor", () => {
  it("returns the first matching enabled row rule, ignoring cell rules and manual colors", () => {
    const r = row({ status: "paid", fee: 50000 }, { [C.name]: "red" });
    expect(resolveRowColor(r, [paidRule, bigFeeRow], ctx)).toBe("yellow");
    expect(resolveRowColor(r, [paidRule], ctx)).toBeNull();
    expect(resolveRowColor(r, [{ ...bigFeeRow, enabled: false }], ctx)).toBeNull();
    expect(resolveRowColor(r, undefined, ctx)).toBeNull();
  });
});

describe("validateColorRules", () => {
  const validate = (rules: unknown, readable: ReadonlySet<string> = all) =>
    validateColorRules(rules, schema, registry, readable);

  it("accepts valid rules (and undefined / null as no rules) and returns clean copies", () => {
    expect(validate(undefined)).toEqual({ ok: true, rules: [] });
    expect(validate(null)).toEqual({ ok: true, rules: [] });
    const res = validate([paidRule, { ...bigFeeRow, enabled: false, extra: 1 }]);
    expect(res).toEqual({ ok: true, rules: [paidRule, { ...bigFeeRow, enabled: false }] });
    if (res.ok) expect(res.rules[0]).not.toBe(paidRule);
  });

  it("rejects a non-array", () => {
    const res = validate({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0]).toMatchObject({ code: "invalidColorRule", path: [] });
  });

  it("rejects malformed rules with the rule index", () => {
    const res = validate([
      paidRule,
      { ...paidRule, id: "" },
      { ...paidRule, id: "c", color: "magenta" },
      { ...paidRule, id: "d", target: { kind: "cells", columnIds: [] } },
      { ...paidRule, id: "e", target: { kind: "column" } },
      { ...paidRule, id: "f", enabled: "yes" },
      { ...paidRule, id: "paid" },
      "nope",
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.map((i) => [i.ruleIndex, i.code])).toEqual([
      [1, "invalidColorRule"],
      [2, "invalidColorRule"],
      [3, "invalidColorRule"],
      [4, "invalidColorRule"],
      [5, "invalidColorRule"],
      [6, "invalidColorRule"],
      [7, "invalidColorRule"],
    ]);
  });

  it("rejects unknown and unreadable target columns", () => {
    const readable = new Set([...all].filter((id) => id !== C.notes));
    const res = validate(
      [
        { ...paidRule, target: { kind: "cells", columnIds: ["col_nope"] } },
        { ...paidRule, id: "b", target: { kind: "cells", columnIds: [C.notes] } },
      ],
      readable,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => [i.ruleIndex, i.code, i.columnId])).toEqual([
        [0, "unknownColumn", "col_nope"],
        [1, "unreadableColumn", C.notes],
      ]);
      expect(res.issues[1]?.message).not.toContain("Internal notes");
    }
  });

  it("validates `when` like a filter (unreadable columns, bad operators, depth)", () => {
    const readable = new Set([...all].filter((id) => id !== C.notes));
    const res = validate(
      [
        { ...bigFeeRow, when: { columnId: C.notes, operator: "isEmpty" } },
        { ...bigFeeRow, id: "b", when: { columnId: C.fee, operator: "contains", value: "x" } },
      ],
      readable,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map((i) => [i.ruleIndex, i.code, i.path])).toEqual([
        [0, "unreadableColumn", []],
        [1, "unknownOperator", []],
      ]);
    }
  });

  it("rejects color operators inside a rule condition (colorInRule)", () => {
    const res = validate([
      {
        ...bigFeeRow,
        when: { op: "and", children: [{ columnId: C.name, operator: "colorIs", value: ["red"] }] },
      },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0]).toMatchObject({ ruleIndex: 0, code: "colorInRule", path: [0] });
  });
});

describe("canColorCell", () => {
  const resolver = createRolePermissionResolver();
  const r = row({});
  const col = (id: string) => {
    const column = schema.columns.find((c) => c.id === id);
    if (!column) throw new Error(`fixture column ${id}`);
    return column;
  };
  const counsellor = { id: FIXTURE_USERS.counsellor.id, roles: [...FIXTURE_USERS.counsellor.roles] };
  const admin = { id: FIXTURE_USERS.admin.id, roles: [...FIXTURE_USERS.admin.roles] };

  it("is true exactly when the effective access is edit", () => {
    expect(canColorCell(r, col(C.name), counsellor, resolver)).toBe(true);
    expect(canColorCell(r, col(C.fee), counsellor, resolver)).toBe(false); // read-only
    expect(canColorCell(r, col(C.notes), counsellor, resolver)).toBe(false); // hidden
    expect(canColorCell(r, col(C.fee), admin, resolver)).toBe(true);
    expect(canColorCell(r, col(C.balance), admin, resolver)).toBe(false); // formula
    expect(canColorCell(r, { ...col(C.name), settable: false }, admin, resolver)).toBe(false);
  });

  it("passes the row to the resolver", () => {
    const seen: unknown[] = [];
    canColorCell(r, col(C.name), admin, (p) => {
      seen.push(p.row);
      return "edit";
    });
    expect(seen).toEqual([r]);
  });

  it("without a user only formulas and settable:false columns are unpaintable", () => {
    expect(canColorCell(r, col(C.notes), undefined, resolver)).toBe(true);
    expect(canColorCell(r, col(C.balance), undefined, resolver)).toBe(false);
  });
});
