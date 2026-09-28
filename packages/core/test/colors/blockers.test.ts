import { describe, expect, it } from "vitest";
import {
  type ColorRule,
  colorFilterBlockedMessage,
  colorFilterBlockers,
  colorRuleUnfilterableColumn,
  sqlFilterablePredicate,
  unfilterableColorRuleReason,
  validateColorRules,
} from "../../src/colors/index";
import { mergeCapabilities, normalizeCapabilities } from "../../src/datasource/capabilities";
import { createDefaultRegistry } from "../../src/field-types/default-registry";
import type { GridSchema } from "../../src/schema/types";
import { FIXTURE_COLUMN_IDS as C, createFixtureSchema } from "../../src/testing/schema";

const registry = createDefaultRegistry();
const base = createFixtureSchema();
/** `website` is `filterable: false` (like a SQL-view computed column). */
const schema: GridSchema = {
  ...base,
  columns: base.columns.map((c) => (c.id === C.website ? { ...c, filterable: false } : c)),
};
const all = new Set(schema.columns.map((c) => c.id));
const filterable = sqlFilterablePredicate(schema);

const onWebsite: ColorRule = {
  id: "web",
  color: "red",
  target: { kind: "cells", columnIds: [C.website] },
  when: { columnId: C.website, operator: "isEmpty" },
};
const paidOnStatus: ColorRule = {
  id: "paid",
  color: "green",
  target: { kind: "cells", columnIds: [C.status] },
  when: { columnId: C.status, operator: "is", value: "paid" },
};
const rowOnWebsite: ColorRule = {
  id: "row",
  color: "yellow",
  target: { kind: "row" },
  when: { op: "and", children: [{ columnId: C.fee, operator: "gt", value: 1 }, { columnId: C.website, operator: "isEmpty" }] },
};

describe("validateColorRules and unfilterable columns", () => {
  it("accepts filterable:false columns inside `when` (rules render client-side)", () => {
    expect(validateColorRules([onWebsite, rowOnWebsite], schema, registry, all)).toEqual({
      ok: true,
      rules: [onWebsite, rowOnWebsite],
    });
  });

  it("still checks operators and values on them", () => {
    const res = validateColorRules(
      [{ ...onWebsite, when: { columnId: C.website, operator: "gt", value: 1 } }],
      schema,
      registry,
      all,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues[0]).toMatchObject({ code: "unknownOperator", columnId: C.website });
  });
});

describe("sqlFilterablePredicate", () => {
  it("defaults to `filterable !== false`; unknown columns are not filterable", () => {
    expect(filterable(C.name)).toBe(true);
    expect(filterable(C.website)).toBe(false);
    expect(filterable("col_nope")).toBe(false);
  });

  it("respects the capabilities `filter` scope", () => {
    const caps = normalizeCapabilities({ filter: { columnIds: [C.name, C.website] } });
    const p = sqlFilterablePredicate(schema, caps);
    expect(p(C.name)).toBe(true);
    expect(p(C.fee)).toBe(false);
    expect(p(C.website)).toBe(false);
  });

  it("respects effective capabilities (per-column `filterable`)", () => {
    const eff = mergeCapabilities(base, normalizeCapabilities({ filter: { columnIds: [C.name] } }));
    const p = sqlFilterablePredicate(base, eff);
    expect(p(C.name)).toBe(true);
    expect(p(C.fee)).toBe(false);
  });
});

describe("colorFilterBlockers", () => {
  it("returns the enabled rules that can color the column and test an unfilterable one", () => {
    const rules = [paidOnStatus, onWebsite, rowOnWebsite];
    expect(colorFilterBlockers(C.website, rules, schema, filterable)).toEqual([onWebsite, rowOnWebsite]);
    // `onWebsite` targets another column: only the row rule can color `status`.
    expect(colorFilterBlockers(C.status, rules, schema, filterable)).toEqual([rowOnWebsite]);
  });

  it("ignores disabled rules, `when: null` and rules on filterable columns only", () => {
    expect(colorFilterBlockers(C.website, [{ ...onWebsite, enabled: false }], schema, filterable)).toEqual([]);
    expect(colorFilterBlockers(C.website, [{ ...onWebsite, when: null }], schema, filterable)).toEqual([]);
    expect(colorFilterBlockers(C.status, [paidOnStatus], schema, filterable)).toEqual([]);
    expect(colorFilterBlockers(C.status, undefined, schema, filterable)).toEqual([]);
  });

  it("uses the given predicate", () => {
    expect(colorFilterBlockers(C.status, [paidOnStatus], schema, (id) => id !== C.status)).toEqual([paidOnStatus]);
  });
});

describe("messages", () => {
  it("colorRuleUnfilterableColumn finds the first offending column in `when` order", () => {
    expect(colorRuleUnfilterableColumn(rowOnWebsite, schema, filterable)?.id).toBe(C.website);
    expect(colorRuleUnfilterableColumn(paidOnStatus, schema, filterable)).toBeUndefined();
  });

  it("builds the reason and the server's 400 message", () => {
    expect(unfilterableColorRuleReason("Verdict")).toBe(
      'a color rule on it uses "Verdict", which can\'t be filtered on the server',
    );
    expect(colorFilterBlockedMessage("Status", "Verdict")).toBe(
      'Can\'t filter "Status" by color: a color rule on it uses "Verdict", which can\'t be filtered on the server',
    );
  });
});
