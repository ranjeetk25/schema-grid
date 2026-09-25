import { describe, expect, it } from "vitest";
import type { FilterNode } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, fixtureColumn } from "../test/fixtures";
import {
  type DraftCondition,
  type DraftGroup,
  addCondition,
  addGroup,
  canAddGroup,
  defaultValueFor,
  filterableColumns,
  fromDraft,
  isDraftComplete,
  operatorsFor,
  removeNode,
  setGroupOp,
  toDraft,
  updateCondition,
} from "./model";

const schema = buildFixtureSchema();
const registry = buildFixtureRegistry();
const ctx = { schema, registry };

const S8: FilterNode = {
  op: "and",
  children: [
    { columnId: FIXTURE_IDS.payment, operator: "isNot", value: "paid" },
    { columnId: FIXTURE_IDS.call, operator: "isWithin", value: { relative: "yesterday" } },
  ],
};

const firstCondition = (g: DraftGroup) => g.children.find((c): c is DraftCondition => c.kind === "condition");
const firstGroup = (g: DraftGroup) => g.children.find((c): c is DraftGroup => c.kind === "group");

describe("filter draft model", () => {
  it("round-trips toDraft → fromDraft byte-exact", () => {
    const out = fromDraft(toDraft(S8), ctx);
    expect(out).toStrictEqual(S8);
    expect(JSON.stringify(out)).toBe(JSON.stringify(S8));
  });

  it("round-trips nested groups and none-kind operators without a value key", () => {
    const node: FilterNode = {
      op: "or",
      children: [
        { columnId: FIXTURE_IDS.notes, operator: "isEmpty" },
        { op: "and", children: [{ columnId: FIXTURE_IDS.amount, operator: "between", value: { from: 1, to: 5 } }] },
      ],
    };
    const out = fromDraft(toDraft(node), ctx);
    expect(JSON.stringify(out)).toBe(JSON.stringify(node));
  });

  it("wraps a bare condition in a root group and maps null to an empty root", () => {
    const d = toDraft({ columnId: FIXTURE_IDS.notes, operator: "isEmpty" });
    expect(d.kind).toBe("group");
    expect(d.op).toBe("and");
    expect(d.children).toHaveLength(1);
    const empty = toDraft(null);
    expect(empty.children).toHaveLength(0);
    expect(fromDraft(empty, ctx)).toBeNull();
  });

  it("drops empty nested groups; a root with only empty groups is null", () => {
    let d = toDraft(null);
    d = addGroup(d, d.id, 2);
    expect(d.children).toHaveLength(1);
    expect(fromDraft(d, ctx)).toBeNull();
  });

  it("omits the value key for none-kind operators even if a value lingers", () => {
    const d = toDraft(null);
    const withCond = addCondition(d, d.id);
    const cond = firstCondition(withCond) as DraftCondition;
    const set = updateCondition(withCond, cond.id, { columnId: FIXTURE_IDS.notes }, ctx);
    const c2 = firstCondition(set) as DraftCondition;
    const none = updateCondition(set, c2.id, { operator: "isEmpty" }, ctx);
    const out = fromDraft(none, ctx);
    expect(JSON.stringify(out)).toBe(JSON.stringify({ op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] }));
  });

  it("filterableColumns omits the hidden secret column", () => {
    const ids = filterableColumns(schema, buildFixtureAccess(schema)).map((c) => c.id);
    expect(ids).not.toContain(FIXTURE_IDS.secret);
    expect(ids).toContain(FIXTURE_IDS.payment);
  });

  it("filterableColumns fails closed on a missing access entry", () => {
    expect(filterableColumns(schema, new Map())).toEqual([]);
  });

  it("operators for select are exactly the option set; date includes isWithin", () => {
    expect(operatorsFor(fixtureColumn(FIXTURE_IDS.payment), registry).map((o) => o.id)).toEqual([
      "is",
      "isNot",
      "isAnyOf",
      "isNoneOf",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(operatorsFor(fixtureColumn(FIXTURE_IDS.call), registry).map((o) => o.id)).toContain("isWithin");
  });

  it("formula columns use their config.resultType's operators", () => {
    expect(operatorsFor(fixtureColumn(FIXTURE_IDS.total), registry).map((o) => o.id)).toContain("between");
  });

  it("defaultValueFor each valueKind", () => {
    expect(defaultValueFor("none")).toBeUndefined();
    expect(defaultValueFor("single")).toBeNull();
    expect(defaultValueFor("multi")).toEqual([]);
    expect(defaultValueFor("range")).toEqual({ from: null, to: null });
    expect(defaultValueFor("relativeDate")).toEqual({ relative: "today" });
    expect(defaultValueFor("me")).toEqual({ me: true });
  });

  it("canAddGroup: root (depth 1) yes, nested (depth 2) no", () => {
    let d = toDraft(null);
    expect(canAddGroup(d, d.id, 2)).toBe(true);
    d = addGroup(d, d.id, 2);
    const nested = firstGroup(d) as DraftGroup;
    expect(canAddGroup(d, nested.id, 2)).toBe(false);
    expect(addGroup(d, nested.id, 2)).toBe(d);
    expect(canAddGroup(d, nested.id, 3)).toBe(true);
  });

  it("changing the column from select to date resets operator and value", () => {
    let d = addCondition(toDraft(null), "missing");
    expect(d.children).toHaveLength(0);
    d = toDraft(null);
    d = addCondition(d, d.id);
    const id = (firstCondition(d) as DraftCondition).id;
    d = updateCondition(d, id, { columnId: FIXTURE_IDS.payment }, ctx);
    expect(firstCondition(d)).toMatchObject({ columnId: FIXTURE_IDS.payment, operator: "is", value: null });
    d = updateCondition(d, id, { operator: "isNot", value: "paid" }, ctx);
    d = updateCondition(d, id, { columnId: FIXTURE_IDS.call }, ctx);
    const c = firstCondition(d) as DraftCondition;
    expect(c.operator).toBe("is");
    expect(operatorsFor(fixtureColumn(FIXTURE_IDS.call), registry).map((o) => o.id)).toContain(c.operator);
    expect(c.value).toBeNull();
  });

  it("changing operator resets value only when the valueKind changes", () => {
    let d = toDraft({ op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" }] });
    const id = (firstCondition(d) as DraftCondition).id;
    d = updateCondition(d, id, { operator: "isNot" }, ctx);
    expect((firstCondition(d) as DraftCondition).value).toBe("paid");
    d = updateCondition(d, id, { operator: "isAnyOf" }, ctx);
    expect((firstCondition(d) as DraftCondition).value).toEqual([]);
  });

  it("removeNode, setGroupOp, isDraftComplete", () => {
    let d = toDraft(S8);
    expect(isDraftComplete(d)).toBe(true);
    d = setGroupOp(d, d.id, "or");
    expect((fromDraft(d, ctx) as { op: string }).op).toBe("or");
    const first = firstCondition(d) as DraftCondition;
    d = removeNode(d, first.id);
    expect(fromDraft(d, ctx)).toStrictEqual({
      op: "or",
      children: [{ columnId: FIXTURE_IDS.call, operator: "isWithin", value: { relative: "yesterday" } }],
    });
    d = addCondition(d, d.id);
    expect(isDraftComplete(d)).toBe(false);
    expect(removeNode(d, d.id)).toBe(d);
  });
});
