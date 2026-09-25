import type { MySqlDatabase, MySqlQueryResultHKT, PreparedQueryHKTBase } from "drizzle-orm/mysql-core";

/**
 * Any drizzle MySQL database or transaction (mysql2, planetscale, …).
 * Kept loose on the schema generic so consumers can pass their own typed db.
 */
// biome-ignore lint/suspicious/noExplicitAny: accepts any consumer schema / driver HKTs
export type GridDb = MySqlDatabase<MySqlQueryResultHKT, PreparedQueryHKTBase, any>;

export interface WriteDeps {
  db: GridDb;
  tables: import("../storage/tables").GridTables;
  gridId: string;
}

/**
 * Affected-row count from a write result: mysql2 `[ResultSetHeader, …]` / header
 * (`affectedRows`) or PlanetScale-style (`rowsAffected`). Unknown shapes throw —
 * treating them as 0 would turn successful writes into false conflicts.
 */
export function affectedRowsOf(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const h = header as { affectedRows?: unknown; rowsAffected?: unknown } | undefined;
  if (typeof h?.affectedRows === "number") return h.affectedRows;
  if (typeof h?.rowsAffected === "number") return h.rowsAffected;
  throw new Error("Cannot read affected rows from the database driver result");
}
