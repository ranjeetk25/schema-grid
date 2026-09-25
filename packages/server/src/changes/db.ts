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

/** `affectedRows` from a mysql2 / drizzle write result (`[ResultSetHeader, …]` or a header). */
export function affectedRowsOf(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const n = (header as { affectedRows?: unknown } | undefined)?.affectedRows;
  return typeof n === "number" ? n : 0;
}
