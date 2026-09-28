import type { SQL } from "drizzle-orm";
import type { ServerContext } from "../context";
import type { ColorRule } from "../internal/core";
import type { GridTables } from "../storage/tables";
import type { ColumnExprResolver } from "./column-expr";
import type { StorageOverrides } from "./storage-kind";

/** How a formula column is filtered/sorted (see T15 `planFormulaColumns`). */
export interface FormulaPlan {
  mode: "generated" | "inline" | "fallback";
  /** Result-typed SQL for generated/inline modes. */
  sql?: SQL;
  resultKind: import("./storage-kind").StorageKind;
}

/** Everything a SQL translator needs. */
export interface SqlScope {
  ctx: ServerContext;
  /**
   * The JSON-cells grid tables. Required by the default resolver / row source
   * (`jsonCellsResolver`, `gridRowsSource`); absent for sources over existing
   * tables (`createSqlViewDataSource`), which supply `columnExprs` + `rowSource`.
   */
  tables?: GridTables;
  /** Whether `gc_<key>` generated columns exist for `indexed: true` columns. */
  generatedColumns: "assumePresent" | "ignore";
  storageOverrides?: StorageOverrides;
  formulaPlans?: ReadonlyMap<string, FormulaPlan>;
  /** Where stored column values live in SQL. Default: `jsonCellsResolver`. */
  columnExprs?: ColumnExprResolver;
  /** What row/group/count queries select FROM. Default: the grid rows table (`gridRowsSource`). */
  rowSource?: import("../query/row-source").RowSource;
  /** v0.4: what `colorIs` / `colorIsNone` conditions compile against (see `ColorSqlScope`). */
  colors?: ColorSqlScope;
}

/**
 * v0.4 cell colors for the filter translator. Absent / empty: no manual
 * colors and no rules, so `colorIs` matches nothing and `colorIsNone` everything.
 */
export interface ColorSqlScope {
  /** The row's manual colors document (JSON map column id → color); absent = no color store. */
  manual?: SQL;
  /** The query's validated color rules (`GridQuery.colorRules`), in order. */
  rules?: readonly ColorRule[];
  /** Set while compiling a rule's own `when`: color conditions there never match (no recursion). */
  inRule?: boolean;
}
