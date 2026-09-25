import { describe, expect, it } from "vitest";
import { createDefaultRegistry, type GridRow } from "../../src/internal/core";
import { buildClientGroups, isDataRow, isGroupRow } from "../../src/grouping/clientGroups";
import { createExpansionStore } from "../../src/state/expansionStore";
import { fixtureRows, fixtureSchema, row } from "../fixtures/schema";

const registry = createDefaultRegistry();
const ctx = { schema: fixtureSchema, registry };

describe("buildClientGroups", () => {
  it("returns the rows unchanged when groupBy is empty", () => {
    const expansion = createExpansionStore();
    const out = buildClientGroups(fixtureRows, [], expansion, ctx);
    expect(out).toEqual(fixtureRows);
  });

  it("groups one level by a select column, in first-appearance order", () => {
    const expansion = createExpansionStore();
    const out = buildClientGroups(fixtureRows, [{ columnId: "payment" }], expansion, ctx);

    const groups = out.filter(isGroupRow);
    // first appearance order: r1=paid, r2=pending, r3=null(empty), r4=failed
    expect(groups.map((g) => g.label)).toEqual(["Paid", "Pending", "(empty)", "Failed"]);
    expect(groups.map((g) => g.key)).toEqual(["paid", "pending", null, "failed"]);
    expect(groups.every((g) => g.level === 0)).toBe(true);
    expect(groups.every((g) => g.count === 1)).toBe(true);

    // each group (expanded by default) is followed by its one data row
    const paidIdx = out.indexOf(groups[0]!);
    expect(isDataRow(out[paidIdx + 1]!) && (out[paidIdx + 1] as GridRow).id === "r1").toBe(true);
  });

  it("groups two levels and computes count/sum/avg aggregates", () => {
    const expansion = createExpansionStore();
    const out = buildClientGroups(
      fixtureRows,
      [
        { columnId: "active", aggregations: [{ columnId: "score", agg: "sum" }, { columnId: "score", agg: "avg" }] },
        { columnId: "payment" },
      ],
      expansion,
      ctx,
    );

    const topGroups = out.filter(isGroupRow).filter((g) => g.level === 0);
    // active: true (r1, r4), false (r2), empty (r3)
    expect(topGroups.map((g) => g.key)).toEqual([true, false, null]);
    expect(topGroups.map((g) => g.count)).toEqual([2, 1, 1]);

    const trueGroup = topGroups[0]!;
    expect(trueGroup.aggregates["score:sum"]).toBe(30); // 10 + 20
    expect(trueGroup.aggregates["score:avg"]).toBe(15);

    const level1Groups = out.filter(isGroupRow).filter((g) => g.level === 1);
    // nested under active=true: payment paid (r1), payment failed (r4)
    expect(level1Groups.filter((g) => g.groupPath[0]!.key === true).map((g) => g.key)).toEqual(["paid", "failed"]);
  });

  it("puts empty values into a null-key '(empty)' bucket", () => {
    const expansion = createExpansionStore();
    const out = buildClientGroups(fixtureRows, [{ columnId: "payment" }], expansion, ctx);
    const emptyGroup = out.filter(isGroupRow).find((g) => g.key === null);
    expect(emptyGroup).toBeDefined();
    expect(emptyGroup!.label).toBe("(empty)");
    expect(emptyGroup!.count).toBe(1);
  });

  it("hides descendants of a collapsed group", () => {
    const expansion = createExpansionStore();
    const out = buildClientGroups(fixtureRows, [{ columnId: "payment" }], expansion, ctx);
    const paidGroup = out.find((g) => isGroupRow(g) && g.key === "paid")!;
    expansion.setExpanded((paidGroup as { id: string }).id, false);

    const collapsedOut = buildClientGroups(fixtureRows, [{ columnId: "payment" }], expansion, ctx);
    const idx = collapsedOut.findIndex((g) => isGroupRow(g) && g.key === "paid");
    expect(collapsedOut[idx + 1] && isGroupRow(collapsedOut[idx + 1]!)).toBe(true); // next is the "pending" group, not r1
    expect(collapsedOut.some((r) => isDataRow(r) && (r as GridRow).id === "r1")).toBe(false);
    // the group row itself is still present and reports expanded: false
    const group = collapsedOut[idx] as { expanded: boolean; count: number };
    expect(group.expanded).toBe(false);
    expect(group.count).toBe(1);
  });

  it("produces stable group ids across rebuilds", () => {
    const expansion = createExpansionStore();
    const out1 = buildClientGroups(fixtureRows, [{ columnId: "payment" }], expansion, ctx);
    const out2 = buildClientGroups([...fixtureRows], [{ columnId: "payment" }], expansion, ctx);
    const ids1 = out1.filter(isGroupRow).map((g) => g.id);
    const ids2 = out2.filter(isGroupRow).map((g) => g.id);
    expect(ids1).toEqual(ids2);
    expect(new Set(ids1).size).toBe(ids1.length); // unique
  });

  it("group ids never collide with data row ids", () => {
    const expansion = createExpansionStore();
    const out = buildClientGroups(fixtureRows, [{ columnId: "payment" }], expansion, ctx);
    const dataIds = new Set(fixtureRows.map((r) => r.id));
    for (const g of out.filter(isGroupRow)) {
      expect(dataIds.has(g.id)).toBe(false);
    }
  });

  it("groups multiSelect by the formatted joined label", () => {
    const expansion = createExpansionStore();
    const out = buildClientGroups(fixtureRows, [{ columnId: "tags" }], expansion, ctx);
    const groups = out.filter(isGroupRow);
    const labels = groups.map((g) => g.label);
    expect(labels).toContain("Hot");
    expect(labels).toContain("Warm, Cold");
    expect(labels).toContain("(empty)"); // r3 has [], r4 has undefined tags
    const emptyGroup = groups.find((g) => g.label === "(empty)")!;
    expect(emptyGroup.count).toBe(2);
  });

  it("groups user (UserRef) cells by id with the name as label", () => {
    const rows = [
      row("a", { owner: { id: "u-1", name: "Asha" } }),
      row("b", { owner: { id: "u-2", name: "Ravi" } }),
      row("c", { owner: { id: "u-1", name: "Asha" } }),
    ];
    const out = buildClientGroups(rows, [{ columnId: "owner" }], createExpansionStore(), ctx);
    const groups = out.filter(isGroupRow);
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ["Asha", 2],
      ["Ravi", 1],
    ]);
    expect(groups[0]!.key).toEqual({ id: "u-1", name: "Asha" });
  });

  it("groups link (LinkRef[]) cells by their joined ids", () => {
    const p1 = { id: "p-1", label: "Data" };
    const p2 = { id: "p-2", label: "Web" };
    const rows = [row("a", { program: [p1] }), row("b", { program: [p1, p2] }), row("c", { program: [{ ...p1 }] })];
    const out = buildClientGroups(rows, [{ columnId: "program" }], createExpansionStore(), ctx);
    const groups = out.filter(isGroupRow);
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ["Data", 2],
      ["Data, Web", 1],
    ]);
  });
});
