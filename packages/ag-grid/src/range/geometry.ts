/**
 * Pure range maths for range selection, copy/paste and fill. All functions
 * are pure and operate on plain data so they're trivially unit-testable
 * without a real grid.
 */

export interface CellPos {
  rowIndex: number;
  colId: string;
}

export interface CellRange {
  anchor: CellPos;
  focus: CellPos;
}

export interface NormalizedRange {
  rowStart: number;
  rowEnd: number;
  /** Inclusive, ordered by display position. */
  colIds: string[];
}

export type ExtendDirection = "up" | "down" | "left" | "right";

/**
 * Normalizes a range to row bounds (inclusive) and an ordered list of
 * displayed column ids. Returns null when the anchor or focus column isn't
 * currently displayed.
 */
export function normalizeRange(range: CellRange, displayedColIds: string[]): NormalizedRange | null {
  const anchorIdx = displayedColIds.indexOf(range.anchor.colId);
  const focusIdx = displayedColIds.indexOf(range.focus.colId);
  if (anchorIdx === -1 || focusIdx === -1) return null;

  const colStart = Math.min(anchorIdx, focusIdx);
  const colEnd = Math.max(anchorIdx, focusIdx);
  const colIds = displayedColIds.slice(colStart, colEnd + 1);

  const rowStart = Math.min(range.anchor.rowIndex, range.focus.rowIndex);
  const rowEnd = Math.max(range.anchor.rowIndex, range.focus.rowIndex);

  return { rowStart, rowEnd, colIds };
}

/**
 * Moves the range's focus one step in `direction`, clamped to grid edges.
 * The anchor is left untouched (this is Shift+arrow behaviour).
 */
export function extendRange(
  range: CellRange,
  direction: ExtendDirection,
  displayedColIds: string[],
  rowCount: number,
): CellRange {
  const focusColIdx = displayedColIds.indexOf(range.focus.colId);
  let nextRowIndex = range.focus.rowIndex;
  let nextColIdx = focusColIdx === -1 ? 0 : focusColIdx;

  switch (direction) {
    case "up":
      nextRowIndex = Math.max(0, range.focus.rowIndex - 1);
      break;
    case "down":
      nextRowIndex = Math.min(Math.max(rowCount - 1, 0), range.focus.rowIndex + 1);
      break;
    case "left":
      nextColIdx = Math.max(0, nextColIdx - 1);
      break;
    case "right":
      nextColIdx = Math.min(displayedColIds.length - 1, nextColIdx + 1);
      break;
  }

  const nextColId = displayedColIds[nextColIdx] ?? range.focus.colId;

  return {
    anchor: range.anchor,
    focus: { rowIndex: nextRowIndex, colId: nextColId },
  };
}

/** Lists every cell position contained in a normalized range. */
export function rangeCells(n: NormalizedRange): CellPos[] {
  const cells: CellPos[] = [];
  for (let rowIndex = n.rowStart; rowIndex <= n.rowEnd; rowIndex++) {
    for (const colId of n.colIds) {
      cells.push({ rowIndex, colId });
    }
  }
  return cells;
}

function posKey(pos: CellPos): string {
  return `${pos.rowIndex}\u0000${pos.colId}`;
}

/** Returns the cells whose membership changed between two normalized ranges. */
export function rangeDiff(prev: NormalizedRange | null, next: NormalizedRange | null): CellPos[] {
  const prevCells = prev ? rangeCells(prev) : [];
  const nextCells = next ? rangeCells(next) : [];

  const prevKeys = new Set(prevCells.map(posKey));
  const nextKeys = new Set(nextCells.map(posKey));

  const diff: CellPos[] = [];
  for (const cell of prevCells) {
    if (!nextKeys.has(posKey(cell))) diff.push(cell);
  }
  for (const cell of nextCells) {
    if (!prevKeys.has(posKey(cell))) diff.push(cell);
  }
  return diff;
}

/** True when `pos` is a member of `n` (used for range-highlight class checks). */
export function rangeContains(n: NormalizedRange, pos: CellPos): boolean {
  if (pos.rowIndex < n.rowStart || pos.rowIndex > n.rowEnd) return false;
  return n.colIds.includes(pos.colId);
}

/** True when `pos` is the bottom-right cell of `n` (where the fill handle sits). */
export function isBottomRight(pos: CellPos, n: NormalizedRange): boolean {
  const lastColId = n.colIds[n.colIds.length - 1];
  return pos.rowIndex === n.rowEnd && pos.colId === lastColId;
}

export interface RangeEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/** Which sides of `pos` sit on the boundary of `n` (drives border classes). */
export function rangeEdges(n: NormalizedRange, pos: CellPos): RangeEdges {
  const colIdx = n.colIds.indexOf(pos.colId);
  return {
    top: pos.rowIndex === n.rowStart,
    bottom: pos.rowIndex === n.rowEnd,
    left: colIdx === 0,
    right: colIdx === n.colIds.length - 1,
  };
}

export interface RangeSize {
  rows: number;
  cols: number;
}

export function rangeSize(n: NormalizedRange): RangeSize {
  return { rows: n.rowEnd - n.rowStart + 1, cols: n.colIds.length };
}
