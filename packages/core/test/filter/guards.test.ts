import { describe, expect, it } from "vitest";
import { isFilterCondition, isFilterGroup } from "../../src/filter/index";

describe("filter node type guards", () => {
  it("isFilterGroup: an object with a children array", () => {
    expect(isFilterGroup({ op: "and", children: [] })).toBe(true);
    expect(isFilterGroup({ op: "or", children: [{ columnId: "a", operator: "isEmpty" }] })).toBe(true);
    expect(isFilterGroup({ columnId: "x", operator: "is" })).toBe(false);
    expect(isFilterGroup({ op: "and", children: "nope" })).toBe(false);
    for (const junk of [null, undefined, 1, "and", [], [{ children: [] }]]) expect(isFilterGroup(junk)).toBe(false);
  });

  it("isFilterCondition: string columnId + operator, never a group", () => {
    expect(isFilterCondition({ columnId: "x", operator: "is", value: "a" })).toBe(true);
    expect(isFilterCondition({ columnId: "x", operator: "isEmpty" })).toBe(true);
    expect(isFilterCondition({ op: "and", children: [] })).toBe(false);
    expect(isFilterCondition({ columnId: 1, operator: "is" })).toBe(false);
    expect(isFilterCondition({ columnId: "x" })).toBe(false);
    for (const junk of [null, undefined, "x", [], [{ columnId: "x", operator: "is" }]]) {
      expect(isFilterCondition(junk)).toBe(false);
    }
  });
});
