/**
 * v0.4 "Filter by color" for the header menu. ag-grid's `HeaderMenuActions`
 * can't set a filter, so whoever owns the filter (the workbench, or a host
 * around `<SchemaGrid>`) provides these callbacks through React context;
 * `ShadcnHeaderMenu` renders the submenu only inside a provider. AG Grid
 * renders header components in the grid's React tree, so the context
 * reaches them. Provide it only when the source can filter by color
 * (`canFilterByColor(handle.effectiveCapabilities)`).
 */
import { type ReactNode, createContext, useContext } from "react";
import type { ColumnColorFilter } from "../filter-builder/model";

export interface CellColorFilterValue {
  /** The column's current color filter (`columnColorFilter(filter, columnId)`). */
  activeColors(columnId: string): ColumnColorFilter;
  /** Sets (`CellColor[]` → `colorIs`, `"none"` → `colorIsNone`) or clears (`null`) the column's color condition (`setColumnColorFilter`). */
  filterByColor(columnId: string, colors: ColumnColorFilter): void;
}

const CellColorFilterContext = createContext<CellColorFilterValue | null>(null);

export function CellColorFilterProvider({ value, children }: { value: CellColorFilterValue | null; children: ReactNode }) {
  return <CellColorFilterContext.Provider value={value}>{children}</CellColorFilterContext.Provider>;
}

/** The nearest provider's callbacks, or `null` (no "Filter by color"). */
export function useCellColorFilter(): CellColorFilterValue | null {
  return useContext(CellColorFilterContext);
}
