/**
 * v0.4: how `MantineHeaderMenu` reaches "Filter by color". The header menu
 * only gets ag-grid's `HeaderMenuProps` (no filter access), so whoever owns
 * the filter (the workbench) provides this context around `<SchemaGrid>`;
 * AG Grid renders header components through React portals, so the context
 * reaches them. No provider → no "Filter by color" submenu. Provide it only
 * when the source filters by color (`canFilterByColor(capabilities)`).
 */
import { type ReactNode, createContext, useContext } from "react";
import type { ColumnColorFilter } from "../cell-colors/colorFilter";

export interface CellColorFilterValue {
  /** Sets the column's color condition: colors (`colorIs`), "none" (`colorIsNone`) or null (clear). */
  filterByColor(columnId: string, colors: ColumnColorFilter): void;
  /** The column's current color condition (checks in the submenu, "Clear color filter"). */
  activeColors(columnId: string): ColumnColorFilter;
}

const CellColorFilterContext = createContext<CellColorFilterValue | null>(null);

export function CellColorFilterProvider({
  value,
  children,
}: { value: CellColorFilterValue | null; children: ReactNode }) {
  return (
    <CellColorFilterContext.Provider value={value}>
      {children}
    </CellColorFilterContext.Provider>
  );
}

/** The nearest provider's value, or null (filter by color unavailable). */
export function useCellColorFilter(): CellColorFilterValue | null {
  return useContext(CellColorFilterContext);
}
