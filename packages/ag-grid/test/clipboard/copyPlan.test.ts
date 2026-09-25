import { describe, expect, it } from "vitest";
import { createDefaultRegistry, type Access, type GridRow } from "../../src/internal/core";
import { buildCopyMatrix, buildCopyText } from "../../src/clipboard/copyPlan";
import type { GroupDisplayRow } from "../../src/grouping/clientGroups";
import { fixtureColumns, fixtureRows, row } from "../fixtures/schema";

const columnsById = new Map(fixtureColumns.map((c) => [c.id, c]));
const registry = createDefaultRegistry();

function accessAllEdit(hiddenIds: string[] = []): Map<string, Access> {
  const access = new Map<string, Access>();
  for (const c of fixtureColumns) access.set(c.id, hiddenIds.includes(c.id) ? "hidden" : "edit");
  return access;
}

function getRowAt(rows: GridRow[]) {
  return (rowIndex: number) => rows[rowIndex];
}

describe("buildCopyMatrix / buildCopyText", () => {
  it("formats values using fieldType.format", () => {
    const range = { rowStart: 0, rowEnd: 1, colIds: ["name", "score"] };
    const matrix = buildCopyMatrix(range, getRowAt(fixtureRows), columnsById, registry, accessAllEdit());
    expect(matrix).toEqual([
      ["Asha", "10"],
      ["Bala", "5"],
    ]);
  });

  it("skips columns with hidden access", () => {
    const range = { rowStart: 0, rowEnd: 0, colIds: ["name", "score"] };
    const matrix = buildCopyMatrix(range, getRowAt(fixtureRows), columnsById, registry, accessAllEdit(["score"]));
    expect(matrix).toEqual([["Asha"]]);
  });

  it("skips columns not present in the access map", () => {
    const range = { rowStart: 0, rowEnd: 0, colIds: ["name", "score"] };
    const access = new Map<string, Access>([["name", "edit"]]);
    const matrix = buildCopyMatrix(range, getRowAt(fixtureRows), columnsById, registry, access);
    expect(matrix).toEqual([["Asha"]]);
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
    const firstFixtureRow = fixtureRows[0];
    if (!firstFixtureRow) throw new Error("expected at least one fixture row");
    const rows = [groupRow, firstFixtureRow];
    const range = { rowStart: 0, rowEnd: 1, colIds: ["name"] };
    const matrix = buildCopyMatrix(range, getRowAt(rows as GridRow[]), columnsById, registry, accessAllEdit());
    expect(matrix).toEqual([["Asha"]]);
  });

  it("uses getCellValue for formula columns", () => {
    const range = { rowStart: 0, rowEnd: 0, colIds: ["total"] };
    const matrix = buildCopyMatrix(range, getRowAt(fixtureRows), columnsById, registry, accessAllEdit(), {
      getCellValue: (r) => (r.cells.score as number) * 2,
    });
    expect(matrix).toEqual([["20"]]);
  });

  it("buildCopyText serializes to TSV", () => {
    const range = { rowStart: 0, rowEnd: 1, colIds: ["name", "score"] };
    const text = buildCopyText(range, getRowAt(fixtureRows), columnsById, registry, accessAllEdit());
    expect(text).toBe("Asha\t10\nBala\t5");
  });

  it("undefined rows (past the end) are skipped", () => {
    const range = { rowStart: 0, rowEnd: 5, colIds: ["name"] };
    const rows = [row("only", { name: "Only" })];
    const matrix = buildCopyMatrix(range, getRowAt(rows), columnsById, registry, accessAllEdit());
    expect(matrix).toEqual([["Only"]]);
  });
});
