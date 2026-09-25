import { describe, expect, it } from "vitest";
import { createDefaultRegistry, type GridRow } from "../../src/internal/core";
import { planFill } from "../../src/fill/fillPlan";
import { fixtureColumns, row } from "../fixtures/schema";

const columnsById = new Map(fixtureColumns.map((c) => [c.id, c]));
const registry = createDefaultRegistry();
const alwaysEditable = () => true;

function getRowAtFrom(rows: GridRow[]) {
  return (rowIndex: number) => rows[rowIndex];
}

describe("planFill", () => {
  it("number 1,2 fills down to 3,4,5", () => {
    const rows = [
      row("r0", { score: 1 }),
      row("r1", { score: 2 }),
      row("r2", { score: null }),
      row("r3", { score: null }),
      row("r4", { score: null }),
    ];
    const plan = planFill({
      source: { rowStart: 0, rowEnd: 1, colIds: ["score"] },
      target: { rowStart: 0, rowEnd: 4, colIds: ["score"] },
      axis: "down",
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.changes.map((c) => c.next)).toEqual([3, 4, 5]);
    expect(plan.changes.map((c) => c.rowId)).toEqual(["r2", "r3", "r4"]);
    expect(plan.skippedReadOnly).toBe(0);
  });

  it("a date series continues", () => {
    const rows = [
      row("r0", { callDate: "2026-09-01" }),
      row("r1", { callDate: "2026-09-02" }),
      row("r2", { callDate: null }),
      row("r3", { callDate: null }),
    ];
    const plan = planFill({
      source: { rowStart: 0, rowEnd: 1, colIds: ["callDate"] },
      target: { rowStart: 0, rowEnd: 3, colIds: ["callDate"] },
      axis: "down",
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.changes.map((c) => c.next)).toEqual(["2026-09-03", "2026-09-04"]);
  });

  it("a single source cell repeats", () => {
    const rows = [row("r0", { score: 7 }), row("r1", { score: null }), row("r2", { score: null })];
    const plan = planFill({
      source: { rowStart: 0, rowEnd: 0, colIds: ["score"] },
      target: { rowStart: 0, rowEnd: 2, colIds: ["score"] },
      axis: "down",
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.changes.map((c) => c.next)).toEqual([7, 7]);
  });

  it("text repeats a pattern cyclically", () => {
    const rows = [
      row("r0", { name: "A" }),
      row("r1", { name: "B" }),
      row("r2", { name: null }),
      row("r3", { name: null }),
      row("r4", { name: null }),
    ];
    const plan = planFill({
      source: { rowStart: 0, rowEnd: 1, colIds: ["name"] },
      target: { rowStart: 0, rowEnd: 4, colIds: ["name"] },
      axis: "down",
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.changes.map((c) => c.next)).toEqual(["A", "B", "A"]);
  });

  it("read-only target cells are skipped", () => {
    const rows = [row("r0", { score: 1 }), row("r1", { score: 2 }), row("r2", { score: null })];
    const plan = planFill({
      source: { rowStart: 0, rowEnd: 1, colIds: ["score"] },
      target: { rowStart: 0, rowEnd: 2, colIds: ["score"] },
      axis: "down",
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: () => false,
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.skippedReadOnly).toBe(1);
  });

  it("formula target columns are always skipped as read-only", () => {
    const rows = [row("r0", { total: 2 }), row("r1", { total: null })];
    const plan = planFill({
      source: { rowStart: 0, rowEnd: 0, colIds: ["total"] },
      target: { rowStart: 0, rowEnd: 1, colIds: ["total"] },
      axis: "down",
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.skippedReadOnly).toBe(1);
  });

  it("filling right runs per row", () => {
    const rows = [
      row("r0", { name: "hello", notes: null, status: null }),
      row("r1", { name: "world", notes: null, status: null }),
    ];
    const plan = planFill({
      source: { rowStart: 0, rowEnd: 1, colIds: ["name"] },
      target: { rowStart: 0, rowEnd: 1, colIds: ["name", "notes", "status"] },
      axis: "right",
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    const r0 = plan.changes.filter((c) => c.rowId === "r0");
    expect(r0.map((c) => c.columnId)).toEqual(["notes", "status"]);
    expect(r0.map((c) => c.next)).toEqual(["hello", "hello"]);
    const r1 = plan.changes.filter((c) => c.rowId === "r1");
    expect(r1.map((c) => c.next)).toEqual(["world", "world"]);
  });

  it("the output never includes source cells", () => {
    const rows = [row("r0", { score: 1 }), row("r1", { score: 2 }), row("r2", { score: null })];
    const plan = planFill({
      source: { rowStart: 0, rowEnd: 1, colIds: ["score"] },
      target: { rowStart: 0, rowEnd: 2, colIds: ["score"] },
      axis: "down",
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.changes.some((c) => c.rowId === "r0" || c.rowId === "r1")).toBe(false);
  });
});
