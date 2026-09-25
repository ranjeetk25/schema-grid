import { type FieldTypeRegistry, type GridRow, type GridSchema, type SortSpec, isEmptyValue } from "../internal/core";

/**
 * In-memory row comparator for the formula fallback, mirroring core's in-memory
 * `sortRows` (not exported by core): field-type `compare`, empties last in both
 * directions, final id tie-break in code-unit (binary) order.
 */
export function compareRows(a: GridRow, b: GridRow, sort: SortSpec[], schema: GridSchema, registry: FieldTypeRegistry): number {
  for (const spec of sort) {
    const column = schema.columns.find((c) => c.id === spec.columnId);
    if (!column) continue;
    const va = a.cells[column.key];
    const vb = b.cells[column.key];
    const ea = isEmptyValue(va);
    const eb = isEmptyValue(vb);
    if (ea || eb) {
      if (ea && eb) continue;
      return ea ? 1 : -1;
    }
    const type = registry.get(column.type);
    let c = 0;
    try {
      c = type ? type.compare(va, vb, column.config) : String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
    } catch {
      c = 0;
    }
    if (c !== 0) return spec.dir === "desc" ? -c : c;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
