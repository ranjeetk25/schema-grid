import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../../src/internal/core";
import { groupKeyToCondition } from "../../src/grouping/groupCondition";
import { fixtureColumns, PAYMENT_OPTIONS } from "../fixtures/schema";

const registry = createDefaultRegistry();
const byId = new Map(fixtureColumns.map((c) => [c.id, c]));

function getColumn(id: string) {
  const column = byId.get(id);
  if (!column) throw new Error(`expected fixture column "${id}"`);
  return column;
}

describe("groupKeyToCondition", () => {
  it("select/creatableSelect/user/text-like/date use 'is'", () => {
    const payment = getColumn("payment");
    expect(groupKeyToCondition(payment, "paid", registry)).toEqual({ columnId: "payment", operator: "is", value: "paid" });

    const callDate = getColumn("callDate");
    expect(groupKeyToCondition(callDate, "2026-09-24", registry)).toEqual({
      columnId: "callDate",
      operator: "is",
      value: "2026-09-24",
    });

    const name = getColumn("name");
    expect(groupKeyToCondition(name, "Asha", registry)).toEqual({ columnId: "name", operator: "is", value: "Asha" });
  });

  it("link (LinkRef[]) uses 'is' with the id for one link, 'isAnyOf' with the ids for several", () => {
    const program = getColumn("program");
    expect(groupKeyToCondition(program, [{ id: "prog-1", label: "Program 1" }], registry)).toEqual({
      columnId: "program",
      operator: "is",
      value: "prog-1",
    });
    expect(
      groupKeyToCondition(
        program,
        [
          { id: "prog-1", label: "Program 1" },
          { id: "prog-2", label: "Program 2" },
        ],
        registry,
      ),
    ).toEqual({ columnId: "program", operator: "isAnyOf", value: ["prog-1", "prog-2"] });
  });

  it("user (UserRef) uses 'is' with the user id", () => {
    const owner = getColumn("owner");
    expect(groupKeyToCondition(owner, { id: "u-agent", name: "Agent" }, registry)).toEqual({
      columnId: "owner",
      operator: "is",
      value: "u-agent",
    });
  });

  it("number/currency use 'eq'", () => {
    const score = getColumn("score");
    expect(groupKeyToCondition(score, 10, registry)).toEqual({ columnId: "score", operator: "eq", value: 10 });

    const fee = getColumn("fee");
    expect(groupKeyToCondition(fee, 1000, registry)).toEqual({ columnId: "fee", operator: "eq", value: 1000 });
  });

  it("boolean uses isTrue/isFalse", () => {
    const active = getColumn("active");
    expect(groupKeyToCondition(active, true, registry)).toEqual({ columnId: "active", operator: "isTrue" });
    expect(groupKeyToCondition(active, false, registry)).toEqual({ columnId: "active", operator: "isFalse" });
  });

  it("multiSelect uses hasAllOf with the array", () => {
    const tags = getColumn("tags");
    expect(groupKeyToCondition(tags, ["hot", "warm"], registry)).toEqual({
      columnId: "tags",
      operator: "hasAllOf",
      value: ["hot", "warm"],
    });
  });

  it("empty keys map to isEmpty regardless of type", () => {
    const payment = getColumn("payment");
    expect(groupKeyToCondition(payment, null, registry)).toEqual({ columnId: "payment", operator: "isEmpty" });

    const tags = getColumn("tags");
    expect(groupKeyToCondition(tags, [], registry)).toEqual({ columnId: "tags", operator: "isEmpty" });

    const name = getColumn("name");
    expect(groupKeyToCondition(name, "", registry)).toEqual({ columnId: "name", operator: "isEmpty" });
  });

  it("formula columns use the result type's operator", () => {
    const total = getColumn("total"); // resultType: number
    expect(groupKeyToCondition(total, 20, registry)).toEqual({ columnId: "total", operator: "eq", value: 20 });
  });

  it("uses PAYMENT_OPTIONS values as-is (no label translation)", () => {
    const payment = getColumn("payment");
    for (const opt of PAYMENT_OPTIONS) {
      expect(groupKeyToCondition(payment, opt.id, registry)).toEqual({
        columnId: "payment",
        operator: "is",
        value: opt.id,
      });
    }
  });
});
