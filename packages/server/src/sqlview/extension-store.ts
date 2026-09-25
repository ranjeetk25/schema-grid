import { datetime, int, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import type { GridDb } from "../changes/db";
import { assertSafeColumnKey } from "../storage/keys";

function extensionCellsTableFor(name: string) {
  return mysqlTable(name, {
    gridId: varchar("grid_id", { length: 64 }).notNull(),
    rowId: varchar("row_id", { length: 64 }).notNull(),
    cells: json("cells").$type<Record<string, unknown>>().notNull(),
    version: int("version").notNull().default(1),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
    updatedBy: varchar("updated_by", { length: 64 }),
  });
}

export type ExtensionCellsTable = ReturnType<typeof extensionCellsTableFor>;

export interface ExtensionCellStoreOptions {
  db: GridDb;
  /** Table created by `createExtensionCellsTableDDL({ table })`. */
  table: string;
}

/**
 * Extension cells beside an existing table (spec §C7): schema columns that the
 * SQL view does not map are stored here, keyed by `(grid_id, row_id)`, and
 * LEFT JOINed onto the view for filter / sort / search / grouping. Pass it as
 * `createSqlViewDataSource({ extension })`.
 */
export interface ExtensionCellStore {
  readonly db: GridDb;
  readonly tableName: string;
  readonly table: ExtensionCellsTable;
}

export function createExtensionCellStore(options: ExtensionCellStoreOptions): ExtensionCellStore {
  const tableName = assertSafeColumnKey(options.table);
  return Object.freeze({ db: options.db, tableName, table: extensionCellsTableFor(tableName) });
}
