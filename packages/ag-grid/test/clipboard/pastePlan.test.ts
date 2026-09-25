import { describe, expect, it } from "vitest";
import { createDefaultRegistry, type GridRow } from "../../src/internal/core";
import { planPaste } from "../../src/clipboard/pastePlan";
import type { GroupDisplayRow } from "../../src/grouping/clientGroups";
import { fixtureColumns, row } from "../fixtures/schema";

const columnsById = new Map(fixtureColumns.map((c) => [c.id, c]));
const registry = createDefaultRegistry();
const alwaysEditable = () => true;

function makeRows(count: number): GridRow[] {
  return Array.from({ length: count }, (_, i) =>
    row(`r${i}`, { name: `n${i}`, notes: `note${i}`, status: `s${i}`, source: `src${i}`, score: i }),
  );
}

function getRowAtFrom(rows: GridRow[]) {
  return (rowIndex: number) => rows[rowIndex];
}

const TEXT_COLS = ["name", "notes", "status", "source"];

describe("planPaste", () => {
  it("a 1x1 block fills a 3x3 selection", () => {
    const rows = makeRows(3);
    const plan = planPaste({
      matrix: [["X"]],
      anchor: { rowIndex: 0, colId: "name" },
      selection: { rowStart: 0, rowEnd: 2, colIds: TEXT_COLS.slice(0, 3) },
      displayedColIds: TEXT_COLS,
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.targetRange).toEqual({ rowStart: 0, rowEnd: 2, colIds: TEXT_COLS.slice(0, 3) });
    expect(plan.changes).toHaveLength(9);
    expect(plan.changes.every((c) => c.next === "X")).toBe(true);
    expect(plan.errors).toHaveLength(0);
    expect(plan.skippedReadOnly).toBe(0);
  });

  it("a 2x2 block tiles a 4x4 selection", () => {
    const rows = makeRows(4);
    const matrix = [
      ["a1", "b1"],
      ["a2", "b2"],
    ];
    const plan = planPaste({
      matrix,
      anchor: { rowIndex: 0, colId: "name" },
      selection: { rowStart: 0, rowEnd: 3, colIds: TEXT_COLS },
      displayedColIds: TEXT_COLS,
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.changes).toHaveLength(16);
    // row 0 tiles matrix row 0, cols cycle a1,b1,a1,b1
    const row0Changes = plan.changes.filter((c) => c.rowId === "r0");
    expect(row0Changes.map((c) => c.next)).toEqual(["a1", "b1", "a1", "b1"]);
    // row 2 tiles matrix row 0 again (2 % 2 === 0)
    const row2Changes = plan.changes.filter((c) => c.rowId === "r2");
    expect(row2Changes.map((c) => c.next)).toEqual(["a1", "b1", "a1", "b1"]);
    // row 1 tiles matrix row 1
    const row1Changes = plan.changes.filter((c) => c.rowId === "r1");
    expect(row1Changes.map((c) => c.next)).toEqual(["a2", "b2", "a2", "b2"]);
  });

  it("a partial tile when the selection isn't a multiple of the block", () => {
    const rows = makeRows(3);
    const matrix = [
      ["a1", "b1"],
      ["a2", "b2"],
    ];
    const plan = planPaste({
      matrix,
      anchor: { rowIndex: 0, colId: "name" },
      selection: { rowStart: 0, rowEnd: 2, colIds: TEXT_COLS.slice(0, 3) },
      displayedColIds: TEXT_COLS,
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.changes).toHaveLength(9);
    const row2Changes = plan.changes.filter((c) => c.rowId === "r2");
    // row 2 % 2 === 0 -> matrix row 0; col cycle a1,b1,a1 (3 cols, block width 2)
    expect(row2Changes.map((c) => c.next)).toEqual(["a1", "b1", "a1"]);
  });

  it("a parse failure goes to errors while other cells still go into changes", () => {
    const rows = makeRows(1);
    const plan = planPaste({
      matrix: [["not-a-number", "ok"]],
      anchor: { rowIndex: 0, colId: "score" },
      displayedColIds: ["score", "name"],
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.errors).toEqual([{ rowId: "r0", columnId: "score", message: "Not a number" }]);
    expect(plan.changes).toEqual([{ rowId: "r0", columnId: "name", prev: "n0", next: "ok" }]);
  });

  it("read-only cells are counted as skipped, including formula columns", () => {
    const rows = makeRows(1);
    const plan = planPaste({
      matrix: [["50", "999"]],
      anchor: { rowIndex: 0, colId: "salary" },
      displayedColIds: ["salary", "total"],
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: (_row, columnId) => columnId !== "salary",
    });

    expect(plan.changes).toHaveLength(0);
    expect(plan.skippedReadOnly).toBe(2);
  });

  it("hidden columns (not in displayedColIds) are never targeted", () => {
    const rows = makeRows(1);
    const plan = planPaste({
      matrix: [["X", "Y"]],
      anchor: { rowIndex: 0, colId: "name" },
      displayedColIds: ["name"], // "notes" is hidden/not displayed
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.targetRange.colIds).toEqual(["name"]);
    expect(plan.changes).toEqual([{ rowId: "r0", columnId: "name", prev: "n0", next: "X" }]);
  });

  it("a stale selection never tiles into hidden columns", () => {
    const rows = makeRows(2);
    const plan = planPaste({
      matrix: [["X"]],
      anchor: { rowIndex: 0, colId: "name" },
      selection: { rowStart: 0, rowEnd: 1, colIds: ["name", "notes"] },
      displayedColIds: ["name"],
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.targetRange.colIds).toEqual(["name"]);
    expect(plan.changes.map((c) => c.columnId)).toEqual(["name", "name"]);
  });

  it("an anchor on a non-displayed column pastes nothing", () => {
    const rows = makeRows(1);
    const plan = planPaste({
      matrix: [["X"]],
      anchor: { rowIndex: 0, colId: "notes" },
      displayedColIds: ["name"],
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.changes).toEqual([]);
  });

  it("overflow is clipped at the last row", () => {
    const rows = makeRows(2);
    const plan = planPaste({
      matrix: [["a"], ["b"], ["c"], ["d"]],
      anchor: { rowIndex: 1, colId: "name" },
      displayedColIds: ["name"],
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.targetRange).toEqual({ rowStart: 1, rowEnd: 1, colIds: ["name"] });
    expect(plan.changes).toEqual([{ rowId: "r1", columnId: "name", prev: "n1", next: "a" }]);
  });

  it("skips group and load-more display rows", () => {
    const groupRow: GroupDisplayRow = {
      __sg: "group",
      id: "g1",
      level: 0,
      columnId: "payment",
      key: "paid",
      label: "Paid",
      count: 1,
      aggregates: {},
      expanded: true,
      groupPath: [],
    };
    const rows = [groupRow, ...makeRows(1)];
    const plan = planPaste({
      matrix: [["X"], ["Y"]],
      anchor: { rowIndex: 0, colId: "name" },
      displayedColIds: ["name"],
      rowCount: rows.length,
      getRowAt: (i) => rows[i] as GridRow,
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });

    expect(plan.changes).toEqual([{ rowId: "r0", columnId: "name", prev: "n0", next: "Y" }]);
  });
});
