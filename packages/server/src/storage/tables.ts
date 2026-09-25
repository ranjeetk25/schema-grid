import { type AnyMySqlColumn, bigint, datetime, int, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import type { MySqlColumnBuilderBase } from "drizzle-orm/mysql-core";
import { assertSafeColumnKey } from "./keys";

const RESERVED = new Set(["id", "gridId", "version", "updatedAt", "updatedBy", "deletedAt", "cells"]);

function rowsTableFor(name: string) {
  return mysqlTable(name, {
    id: varchar("id", { length: 36 }).primaryKey(),
    gridId: varchar("grid_id", { length: 64 }).notNull(),
    version: int("version").notNull().default(1),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
    updatedBy: varchar("updated_by", { length: 64 }),
    deletedAt: datetime("deleted_at", { mode: "date", fsp: 3 }),
    cells: json("cells").$type<Record<string, unknown>>().notNull(),
  });
}

function changeLogTableFor(name: string) {
  return mysqlTable(name, {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    gridId: varchar("grid_id", { length: 64 }).notNull(),
    rowId: varchar("row_id", { length: 36 }).notNull(),
    columnId: varchar("column_id", { length: 64 }),
    kind: varchar("kind", { length: 16, enum: ["cell", "create", "delete"] }).notNull(),
    prev: json("prev"),
    next: json("next"),
    actor: varchar("actor", { length: 64 }).notNull(),
    at: datetime("at", { mode: "date", fsp: 3 }).notNull(),
    batchId: varchar("batch_id", { length: 64 }),
  });
}

export type RowsTable = ReturnType<typeof rowsTableFor>;
export type ChangeLogTable = ReturnType<typeof changeLogTableFor>;

export interface GridTables {
  rows: RowsTable;
  changeLog: ChangeLogTable;
  /** Caller-supplied physical columns on the rows table, keyed by `source.valueField`. */
  physical: Readonly<Record<string, AnyMySqlColumn>>;
  rowsTableName: string;
  changeLogTableName: string;
}

export interface DefineGridTablesOptions {
  rowsTable: string;
  changeLogTable: string;
  /**
   * Extra physical columns on the rows table (targets for `ColumnDef.source.valueField`).
   * The record key is the valueField name.
   */
  physicalColumns?: Record<string, MySqlColumnBuilderBase>;
}

/** Drizzle definitions for the grid rows table and its change_log. */
export function defineGridTables(options: DefineGridTablesOptions): GridTables {
  assertSafeColumnKey(options.rowsTable);
  assertSafeColumnKey(options.changeLogTable);
  const physicalBuilders = options.physicalColumns ?? {};
  for (const name of Object.keys(physicalBuilders)) {
    assertSafeColumnKey(name);
    if (RESERVED.has(name)) throw new Error(`Physical column "${name}" collides with a reserved rows column`);
  }
  const base = rowsTableFor(options.rowsTable);
  let rows: RowsTable = base;
  if (Object.keys(physicalBuilders).length > 0) {
    const withPhysical = mysqlTable(options.rowsTable, {
      id: varchar("id", { length: 36 }).primaryKey(),
      gridId: varchar("grid_id", { length: 64 }).notNull(),
      version: int("version").notNull().default(1),
      updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
      updatedBy: varchar("updated_by", { length: 64 }),
      deletedAt: datetime("deleted_at", { mode: "date", fsp: 3 }),
      cells: json("cells").$type<Record<string, unknown>>().notNull(),
      ...physicalBuilders,
    });
    rows = withPhysical as unknown as RowsTable;
  }
  const all = rows as unknown as Record<string, AnyMySqlColumn>;
  const physical: Record<string, AnyMySqlColumn> = {};
  for (const name of Object.keys(physicalBuilders)) {
    const col = all[name];
    if (col) physical[name] = col;
  }
  return Object.freeze({
    rows,
    changeLog: changeLogTableFor(options.changeLogTable),
    physical: Object.freeze(physical),
    rowsTableName: options.rowsTable,
    changeLogTableName: options.changeLogTable,
  });
}
