import type { ServerContext } from "../context";
import type { GridTables } from "../storage/tables";
import type { StorageOverrides } from "./storage-kind";
import type { SQL } from "drizzle-orm";

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
  tables: GridTables;
  /** Whether `gc_<key>` generated columns exist for `indexed: true` columns. */
  generatedColumns: "assumePresent" | "ignore";
  storageOverrides?: StorageOverrides;
  formulaPlans?: ReadonlyMap<string, FormulaPlan>;
}
