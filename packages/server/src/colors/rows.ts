import { type CellColor, type GridRow, isCellColor } from "../internal/core";

/**
 * A stored colors document (JSON object or its string form, as drivers return
 * it) → the palette colors it holds, or undefined when none remain (rows carry
 * no `colors` rather than `{}`). Anything else is ignored, never thrown on.
 */
export function parseCellColors(raw: unknown): Record<string, CellColor> | undefined {
  let doc = raw;
  if (typeof doc === "string") {
    try {
      doc = JSON.parse(doc) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return undefined;
  const out: Record<string, CellColor> = {};
  for (const [columnId, color] of Object.entries(doc)) if (isCellColor(color)) out[columnId] = color;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `row` with `colors` from a stored document (the key is left out when there are none). */
export function withCellColors<Row extends GridRow>(row: Row, raw: unknown): Row {
  const colors = parseCellColors(raw);
  if (!colors) {
    if (!("colors" in row)) return row;
    const { colors: _drop, ...rest } = row;
    return rest as Row;
  }
  return { ...row, colors };
}
