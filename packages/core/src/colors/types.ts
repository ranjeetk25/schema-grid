import type { FilterNode } from "../filter/types";
import type { GridRow } from "../rows/types";

/**
 * v0.4: the fixed cell color palette (background fill only). Names, not hex:
 * each UI kit maps them to light / dark theme tokens.
 */
export type CellColor = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" | "gray";

/** Every `CellColor`, in palette order. */
export const CELL_COLORS: readonly CellColor[] = Object.freeze([
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "gray",
]);

const COLOR_SET: ReadonlySet<string> = new Set(CELL_COLORS);

/** True for a palette color name. Safe on untrusted input. */
export function isCellColor(v: unknown): v is CellColor {
  return typeof v === "string" && COLOR_SET.has(v);
}

/** What a color rule paints: the cells of some columns, or the whole row. */
export type ColorRuleTarget = { kind: "cells"; columnIds: string[] } | { kind: "row" };

/** A conditional color ("when <filter> then color <target>"), saved on a view. */
export interface ColorRule {
  id: string;
  color: CellColor;
  target: ColorRuleTarget;
  /** Same AST as filters; `null` never matches. */
  when: FilterNode | null;
  /** Default true. */
  enabled?: boolean;
}

/** One manual color write: `color: null` clears the cell's color. */
export interface CellColorChange {
  rowId: string;
  columnId: string;
  color: CellColor | null;
}

export interface CellColorBatch {
  id: string;
  changes: CellColorChange[];
}

export interface CellColorResult {
  applied: CellColorChange[];
  rejected: { rowId: string; columnId: string; message: string }[];
  /** Rows as they now are (optional; the client patches `colors` from `applied` otherwise). */
  rows?: GridRow[];
}
