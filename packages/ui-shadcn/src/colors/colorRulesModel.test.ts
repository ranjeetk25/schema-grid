import { describe, expect, it } from "vitest";
import { readableColumnIds } from "../internal/access";
import type { ColorRule } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import {
  addColorRule,
  moveColorRule,
  removeColorRule,
  ruleIssueMessages,
  updateColorRule,
  validateColorRulesDraft,
} from "./colorRulesModel";

const rule = (id: string, over: Partial<ColorRule> = {}): ColorRule => ({ id, color: "red", target: { kind: "row" }, when: null, ...over });
const schema = buildFixtureSchema();
const registry = buildFixtureRegistry();
const readable = readableColumnIds(schema, buildFixtureAccess(schema));

describe("color rules draft model", () => {
  it("adds an enabled whole-row rule with a fresh id and the first unused color", () => {
    const rules = addColorRule([rule("a"), rule("b", { color: "orange" })]);
    expect(rules).toHaveLength(3);
    const added = rules[2];
    expect(added).toMatchObject({ color: "yellow", target: { kind: "row" }, when: null, enabled: true });
    expect(added?.id).not.toMatch(/^(a|b)$/);
    expect(new Set(addColorRule(addColorRule([])).map((r) => r.id)).size).toBe(2);
  });

  it("moves up / down within bounds (no-op returns the same list)", () => {
    const list = [rule("a"), rule("b"), rule("c")];
    expect(moveColorRule(list, 2, -1).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(moveColorRule(list, 0, 1).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(moveColorRule(list, 0, -1)).toBe(list);
    expect(moveColorRule(list, 2, 1)).toBe(list);
  });

  it("updates and removes by index", () => {
    const list = [rule("a"), rule("b")];
    expect(updateColorRule(list, 1, { enabled: false })[1]).toEqual(rule("b", { enabled: false }));
    expect(removeColorRule(list, 0).map((r) => r.id)).toEqual(["b"]);
  });

  it("validates with core and groups issues per rule index", () => {
    const rules = [
      rule("ok", { target: { kind: "cells", columnIds: [FIXTURE_IDS.payment] } }),
      rule("empty", { target: { kind: "cells", columnIds: [] } }),
      rule("colorWhen", { when: { columnId: FIXTURE_IDS.payment, operator: "colorIs", value: ["red"] } }),
    ];
    const result = validateColorRulesDraft(rules, schema, registry, readable);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const byRule = ruleIssueMessages(result.issues);
    expect(byRule.get(0)).toBeUndefined();
    expect(byRule.get(1)).toEqual(["A cells rule needs at least one column"]);
    expect(byRule.get(2)?.length).toBe(1);
  });

  it("returns clean rules when valid", () => {
    const rules = [rule("a", { when: { columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" }, enabled: false })];
    const result = validateColorRulesDraft(rules, schema, registry, readable);
    expect(result).toEqual({ ok: true, rules });
  });
});
