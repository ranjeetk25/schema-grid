/** C3: hidden columns are never read by copy nor written by paste. */
import { describe, expect, it } from "vitest";
import { buildCopyMatrix } from "../../src/clipboard/copyPlan";
import { planPaste } from "../../src/clipboard/pastePlan";
import { type Access, createDefaultRegistry, type GridRow } from "../../src/internal/core";
import { fixtureColumns, row } from "../fixtures/schema";

const columnsById = new Map(fixtureColumns.map((c) => [c.id, c]));
const registry = createDefaultRegistry();

/** A row whose `cells` records every key read. */
function spyRow(id: string, cells: Record<string, unknown>, reads: Set<string>): GridRow {
  const base = row(id, cells);
  const proxied = new Proxy(base.cells, {
    get(target, key, receiver) {
      if (typeof key === "string") reads.add(key);
      return Reflect.get(target, key, receiver);
    },
  });
  return { ...base, cells: proxied };
}

describe("hidden columns (C3)", () => {
  it("copy never reads a hidden column's cells, even when the range names it", () => {
    const reads = new Set<string>();
    const rows = [spyRow("r1", { name: "Asha", salary: 50, status: "open" }, reads)];
    const access = new Map<string, Access>([
      ["name", "edit"],
      ["salary", "hidden"],
      // "status" is absent from the access map: not readable either.
    ]);
    const matrix = buildCopyMatrix(
      { rowStart: 0, rowEnd: 0, colIds: ["name", "salary", "status"] },
      (i) => rows[i],
      columnsById,
      registry,
      access,
    );
    expect(matrix).toEqual([["Asha"]]);
    expect(reads.has("salary")).toBe(false);
    expect(reads.has("status")).toBe(false);
  });

  it("copy through getCellValue is never asked for a hidden column", () => {
    const asked: string[] = [];
    const rows = [row("r1", { name: "Asha", salary: 50 })];
    buildCopyMatrix(
      { rowStart: 0, rowEnd: 0, colIds: ["name", "salary"] },
      (i) => rows[i],
      columnsById,
      registry,
      new Map<string, Access>([
        ["name", "read"],
        ["salary", "hidden"],
      ]),
      {
        getCellValue: (r, c) => {
          asked.push(c.id);
          return r.cells[c.key];
        },
      },
    );
    expect(asked).toEqual(["name"]);
  });

  it("paste never reads nor writes a column that isn't displayed", () => {
    const reads = new Set<string>();
    const rows = [spyRow("r1", { name: "Asha", salary: 50, status: "open" }, reads)];
    const asked: string[] = [];
    const plan = planPaste({
      matrix: [["X", "99", "Y"]],
      anchor: { rowIndex: 0, colId: "name" },
      selection: { rowStart: 0, rowEnd: 0, colIds: ["name", "salary", "status"] },
      // salary is hidden: not displayed.
      displayedColIds: ["name", "status"],
      rowCount: 1,
      getRowAt: (i) => rows[i],
      columnsById,
      registry,
      canEditCell: (_r, columnId) => {
        asked.push(columnId);
        return true;
      },
    });
    expect(plan.changes.map((c) => c.columnId)).toEqual(["name", "status"]);
    expect(plan.changes.find((c) => c.columnId === "salary")).toBeUndefined();
    expect(asked).not.toContain("salary");
    expect(reads.has("salary")).toBe(false);
  });
});
