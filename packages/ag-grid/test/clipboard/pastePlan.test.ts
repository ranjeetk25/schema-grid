import { describe, expect, it } from "vitest";
import { createDefaultRegistry, type GridRow } from "../../src/internal/core";
import { buildCopyText } from "../../src/clipboard/copyPlan";
import { planPaste } from "../../src/clipboard/pastePlan";
import { parseTsv } from "../../src/clipboard/tsv";
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

const GROUP_ROW: GroupDisplayRow = {
  __sg: "group",
  id: "g-shared",
  level: 0,
  columnId: "payment",
  key: "paid",
  label: "Paid",
  count: 1,
  aggregates: {},
  expanded: true,
  groupPath: [],
};

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

    const coreError = registry.get("number")!.parse("not-a-number", {});
    expect(coreError.ok).toBe(false);
    const message = coreError.ok ? "" : coreError.error;
    expect(plan.errors).toEqual([{ rowId: "r0", columnId: "score", message }]);
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

    // Group rows don't consume a source row (symmetric with copy, which skips them).
    expect(plan.changes).toEqual([{ rowId: "r0", columnId: "name", prev: "n0", next: "X" }]);
  });

  it("a block pasted across a group row lands on the data rows below it, in order", () => {
    const rows = [makeRows(1)[0] as GridRow, GROUP_ROW as unknown as GridRow, row("r1", { name: "n1" })];
    const plan = planPaste({
      matrix: [["A"], ["B"]],
      anchor: { rowIndex: 0, colId: "name" },
      displayedColIds: ["name"],
      rowCount: rows.length,
      getRowAt: (i) => rows[i],
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.changes.map((c) => [c.rowId, c.next])).toEqual([
      ["r0", "A"],
      ["r1", "B"],
    ]);
    expect(plan.targetRange).toEqual({ rowStart: 0, rowEnd: 2, colIds: ["name"] });
  });

  it("copy → paste round-trips across group rows", () => {
    const source = [row("a", { name: "one" }), GROUP_ROW as unknown as GridRow, row("b", { name: "two" })];
    const text = buildCopyText<GridRow>(
      { rowStart: 0, rowEnd: 2, colIds: ["name"] },
      (i) => source[i],
      columnsById,
      registry,
      new Map([["name", "edit" as const]]),
    );
    const target = [row("x", { name: "" }), GROUP_ROW as unknown as GridRow, row("y", { name: "" })];
    const plan = planPaste({
      matrix: parseTsv(text),
      anchor: { rowIndex: 0, colId: "name" },
      displayedColIds: ["name"],
      rowCount: target.length,
      getRowAt: (i) => target[i],
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.changes.map((c) => [c.rowId, c.next])).toEqual([
      ["x", "one"],
      ["y", "two"],
    ]);
  });

  it("tiling over a selection skips group rows without advancing the source row", () => {
    const rows = [row("r0", { name: "" }), GROUP_ROW as unknown as GridRow, row("r1", { name: "" }), row("r2", { name: "" })];
    const plan = planPaste({
      matrix: [["a"], ["b"]],
      anchor: { rowIndex: 0, colId: "name" },
      selection: { rowStart: 0, rowEnd: 3, colIds: ["name"] },
      displayedColIds: ["name"],
      rowCount: rows.length,
      getRowAt: (i) => rows[i],
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.changes.map((c) => [c.rowId, c.next])).toEqual([
      ["r0", "a"],
      ["r1", "b"],
      ["r2", "a"],
    ]);
  });

  it("drops no-op changes (next deep-equals prev)", () => {
    const rows = [row("r0", { name: "same", tags: ["hot"] })];
    const plan = planPaste({
      matrix: [["same", "Hot"]],
      anchor: { rowIndex: 0, colId: "name" },
      displayedColIds: ["name", "tags"],
      rowCount: rows.length,
      getRowAt: (i) => rows[i],
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.changes).toEqual([]);
    expect(plan.errors).toEqual([]);
    expect(plan.skippedReadOnly).toBe(0);
  });

  it("ignores displayed columns that aren't schema columns", () => {
    const rows = makeRows(1);
    const plan = planPaste({
      matrix: [["a", "b"]],
      anchor: { rowIndex: 0, colId: "name" },
      displayedColIds: ["name", "ag-Grid-SelectionColumn", "notes"],
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.targetRange.colIds).toEqual(["name", "notes"]);
    expect(plan.changes.map((c) => [c.columnId, c.next])).toEqual([
      ["name", "a"],
      ["notes", "b"],
    ]);
    expect(plan.skippedReadOnly).toBe(0);
  });

  it("handles very tall matrices (no argument-spread limits)", () => {
    const rows = makeRows(1);
    const tall = Array.from({ length: 500_000 }, () => ["w"]);
    const plan = planPaste({
      matrix: [["a"], ...tall.slice(1)],
      anchor: { rowIndex: 0, colId: "name" },
      displayedColIds: ["name"],
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.changes).toEqual([{ rowId: "r0", columnId: "name", prev: "n0", next: "a" }]);
  });

  it("parses into core value shapes: user → UserRef, link → LinkRef[], multiSelect labels → ids", () => {
    const rows = makeRows(1);
    const plan = planPaste({
      matrix: [["u-9", "p-1, p-2", "Hot, Cold"]],
      anchor: { rowIndex: 0, colId: "owner" },
      displayedColIds: ["owner", "program", "tags"],
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.changes.map((c) => c.next)).toEqual([
      { id: "u-9" },
      [
        { id: "p-1", label: "p-1" },
        { id: "p-2", label: "p-2" },
      ],
      ["hot", "cold"],
    ]);
  });

  it("reports creatableSelect labels that need a new option in pendingOptions", () => {
    const rows = makeRows(1);
    const plan = planPaste({
      matrix: [["Newsletter"]],
      anchor: { rowIndex: 0, colId: "source" },
      displayedColIds: ["source"],
      rowCount: rows.length,
      getRowAt: getRowAtFrom(rows),
      columnsById,
      registry,
      canEditCell: alwaysEditable,
    });
    expect(plan.changes).toEqual([{ rowId: "r0", columnId: "source", prev: "src0", next: "Newsletter" }]);
    expect(plan.pendingOptions).toEqual([{ rowId: "r0", columnId: "source", labels: ["Newsletter"] }]);
  });
});
