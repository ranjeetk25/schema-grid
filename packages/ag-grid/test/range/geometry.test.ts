import { describe, expect, it } from "vitest";
import {
  extendRange,
  isBottomRight,
  normalizeRange,
  rangeCells,
  rangeContains,
  rangeDiff,
  rangeEdges,
  rangeSize,
} from "../../src/range/geometry";
import type { CellPos, CellRange } from "../../src/range/geometry";

const COLS = ["a", "b", "c", "d"];

describe("normalizeRange", () => {
  it("anchor below or right of focus normalizes correctly", () => {
    const range: CellRange = { anchor: { rowIndex: 3, colId: "c" }, focus: { rowIndex: 1, colId: "a" } };
    const normalized = normalizeRange(range, COLS);
    expect(normalized).toEqual({ rowStart: 1, rowEnd: 3, colIds: ["a", "b", "c"] });
  });

  it("a single-cell range is valid", () => {
    const range: CellRange = { anchor: { rowIndex: 2, colId: "b" }, focus: { rowIndex: 2, colId: "b" } };
    expect(normalizeRange(range, COLS)).toEqual({ rowStart: 2, rowEnd: 2, colIds: ["b"] });
  });

  it("hidden columns are excluded from colIds", () => {
    const range: CellRange = { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "d" } };
    const displayed = ["a", "c", "d"]; // "b" hidden
    expect(normalizeRange(range, displayed)).toEqual({ rowStart: 0, rowEnd: 0, colIds: ["a", "c", "d"] });
  });

  it("returns null if the anchor column isn't displayed", () => {
    const range: CellRange = { anchor: { rowIndex: 0, colId: "z" }, focus: { rowIndex: 0, colId: "a" } };
    expect(normalizeRange(range, COLS)).toBeNull();
  });

  it("returns null if the focus column isn't displayed", () => {
    const range: CellRange = { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "z" } };
    expect(normalizeRange(range, COLS)).toBeNull();
  });
});

describe("extendRange", () => {
  const base: CellRange = { anchor: { rowIndex: 2, colId: "b" }, focus: { rowIndex: 2, colId: "b" } };

  it("moves focus down", () => {
    const next = extendRange(base, "down", COLS, 5);
    expect(next).toEqual({ anchor: { rowIndex: 2, colId: "b" }, focus: { rowIndex: 3, colId: "b" } });
  });

  it("moves focus right", () => {
    const next = extendRange(base, "right", COLS, 5);
    expect(next.focus).toEqual({ rowIndex: 2, colId: "c" });
  });

  it("moves focus left", () => {
    const next = extendRange(base, "left", COLS, 5);
    expect(next.focus).toEqual({ rowIndex: 2, colId: "a" });
  });

  it("moves focus up", () => {
    const next = extendRange(base, "up", COLS, 5);
    expect(next.focus).toEqual({ rowIndex: 1, colId: "b" });
  });

  it("clamps at grid edges (top/left)", () => {
    const topLeft: CellRange = { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "a" } };
    expect(extendRange(topLeft, "up", COLS, 5).focus).toEqual({ rowIndex: 0, colId: "a" });
    expect(extendRange(topLeft, "left", COLS, 5).focus).toEqual({ rowIndex: 0, colId: "a" });
  });

  it("clamps at grid edges (bottom/right)", () => {
    const bottomRight: CellRange = { anchor: { rowIndex: 4, colId: "d" }, focus: { rowIndex: 4, colId: "d" } };
    expect(extendRange(bottomRight, "down", COLS, 5).focus).toEqual({ rowIndex: 4, colId: "d" });
    expect(extendRange(bottomRight, "right", COLS, 5).focus).toEqual({ rowIndex: 4, colId: "d" });
  });

  it("keeps anchor unchanged", () => {
    const next = extendRange(base, "down", COLS, 5);
    expect(next.anchor).toEqual(base.anchor);
  });
});

describe("rangeCells", () => {
  it("lists every cell in the normalized range", () => {
    const n = normalizeRange(
      { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 1, colId: "b" } },
      COLS,
    );
    expect(n).not.toBeNull();
    const cells = rangeCells(n!);
    expect(cells).toEqual([
      { rowIndex: 0, colId: "a" },
      { rowIndex: 0, colId: "b" },
      { rowIndex: 1, colId: "a" },
      { rowIndex: 1, colId: "b" },
    ]);
  });
});

describe("rangeDiff", () => {
  it("returns only cells that entered or left", () => {
    const prev = normalizeRange(
      { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "b" } },
      COLS,
    );
    const next = normalizeRange(
      { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "c" } },
      COLS,
    );
    const diff = rangeDiff(prev, next);
    // range grew from [a,b] to [a,b,c]: "a" and "b" stayed, only "c" entered
    expect(diff).toEqual([{ rowIndex: 0, colId: "c" }]);
  });

  it("returns all cells when prev is null", () => {
    const next = normalizeRange(
      { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "a" } },
      COLS,
    );
    expect(rangeDiff(null, next)).toEqual([{ rowIndex: 0, colId: "a" }]);
  });

  it("returns all cells when next is null", () => {
    const prev = normalizeRange(
      { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 0, colId: "a" } },
      COLS,
    );
    expect(rangeDiff(prev, null)).toEqual([{ rowIndex: 0, colId: "a" }]);
  });

  it("returns [] when both are null", () => {
    expect(rangeDiff(null, null)).toEqual([]);
  });
});

describe("isBottomRight / rangeContains / rangeEdges / rangeSize", () => {
  const n = normalizeRange(
    { anchor: { rowIndex: 0, colId: "a" }, focus: { rowIndex: 2, colId: "c" } },
    COLS,
  );

  it("isBottomRight identifies the bottom-right cell only", () => {
    expect(n).not.toBeNull();
    const bottomRight: CellPos = { rowIndex: 2, colId: "c" };
    expect(isBottomRight(bottomRight, n!)).toBe(true);
    expect(isBottomRight({ rowIndex: 0, colId: "a" }, n!)).toBe(false);
  });

  it("rangeContains checks membership", () => {
    expect(rangeContains(n!, { rowIndex: 1, colId: "b" })).toBe(true);
    expect(rangeContains(n!, { rowIndex: 1, colId: "d" })).toBe(false);
    expect(rangeContains(n!, { rowIndex: 5, colId: "a" })).toBe(false);
  });

  it("rangeEdges reports border sides for a cell", () => {
    expect(rangeEdges(n!, { rowIndex: 0, colId: "a" })).toEqual({ top: true, right: false, bottom: false, left: true });
    expect(rangeEdges(n!, { rowIndex: 1, colId: "b" })).toEqual({ top: false, right: false, bottom: false, left: false });
    expect(rangeEdges(n!, { rowIndex: 2, colId: "c" })).toEqual({ top: false, right: true, bottom: true, left: false });
  });

  it("rangeSize reports rows and cols", () => {
    expect(rangeSize(n!)).toEqual({ rows: 3, cols: 3 });
  });
});
