import {
  type GridDb,
  type GridTables,
  defineGridTables,
} from "@ranjeetk25/schema-grid-server/drizzle";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

export const DEFAULT_DATABASE_URL =
  "mysql://schema_grid:schema_grid@127.0.0.1:3307/schema_grid";

export interface TableNames {
  rowsTable: string;
  changeLogTable: string;
}

export const DEFAULT_TABLE_NAMES: TableNames = {
  rowsTable: "grid_rows",
  changeLogTable: "grid_change_log",
};

export interface Database {
  db: GridDb;
  close: () => Promise<void>;
}

/** mysql2 pool (UTC session clock) wrapped in drizzle. */
export function connect(url: string = DEFAULT_DATABASE_URL): Database {
  const pool = mysql.createPool({
    uri: url,
    timezone: "Z",
    connectionLimit: 10,
  });
  const db = drizzle(pool) as unknown as GridDb;
  return { db, close: () => pool.end() };
}

export function gridTables(
  names: TableNames = DEFAULT_TABLE_NAMES,
): GridTables {
  return defineGridTables({
    rowsTable: names.rowsTable,
    changeLogTable: names.changeLogTable,
  });
}

/** Runs a raw SQL string and returns the result rows. */
export async function rawQuery<T>(db: GridDb, text: string): Promise<T[]> {
  const result = (await db.execute(text as never)) as unknown as [T[], unknown];
  return result[0];
}
