import { sql } from "drizzle-orm";
import { datetime, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import type { GridDb } from "../changes/db";
import { isNoSuchTableError } from "../errors";
import { assertSafeColumnKey } from "../storage/keys";

function cellColorsTableFor(name: string) {
  return mysqlTable(name, {
    gridId: varchar("grid_id", { length: 64 }).notNull(),
    rowId: varchar("row_id", { length: 64 }).notNull(),
    colors: json("colors").$type<Record<string, string>>().notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
    updatedBy: varchar("updated_by", { length: 64 }),
  });
}

export type CellColorsTable = ReturnType<typeof cellColorsTableFor>;

export interface CellColorStoreOptions {
  /** The database the store's table lives in (the data source's db: writes join its transactions). */
  db: GridDb;
  /** Table created by `createCellColorsTableDDL({ table })`. */
  table: string;
}

/**
 * Manual cell colors (v0.4), shared by every user: one JSON map per
 * `(grid_id, row_id)`, read beside the rows (LEFT JOIN / keyed lookup) and
 * written by `setCellColors`. Pass it as `colors` to `createDrizzleDataSource`
 * or `createSqlViewDataSource`; one table can serve many grids.
 */
export interface CellColorStore {
  readonly db: GridDb;
  readonly tableName: string;
  readonly table: CellColorsTable;
  /**
   * Whether the table exists: false (instead of a `MISSING_TABLE` error) while
   * it does not; `true` is cached for the store's lifetime, `false` re-probed.
   * A connection error rejects and is not cached.
   */
  available(): Promise<boolean>;
}

export function createCellColorStore(options: CellColorStoreOptions): CellColorStore {
  const tableName = assertSafeColumnKey(options.table);
  const table = cellColorsTableFor(tableName);
  const { db } = options;
  let confirmed = false;
  let probe: Promise<boolean> | undefined;
  const probeTable = async (): Promise<boolean> => {
    try {
      await db.execute(sql`select 1 from ${table} limit 0`);
      confirmed = true;
      return true;
    } catch (err) {
      if (isNoSuchTableError(err)) return false;
      throw err;
    }
  };
  return Object.freeze({
    db,
    tableName,
    table,
    async available() {
      if (confirmed) return true;
      if (!probe) {
        probe = probeTable().finally(() => {
          probe = undefined;
        });
      }
      return probe;
    },
  });
}
