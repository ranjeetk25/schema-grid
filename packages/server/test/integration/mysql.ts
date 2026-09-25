/**
 * Real-MySQL integration harness (plan Task 24). Everything here is skipped
 * unless `SCHEMA_GRID_MYSQL_IT=1` (requires Docker for @testcontainers/mysql).
 */
import { varchar } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { describe } from "vitest";
import type { GridDb } from "../../src/changes/db";
import { createRows } from "../../src/changes/rows-crud";
import { createServerContext } from "../../src/context";
import { formulaSqlHook } from "../../src/ddl/generated-columns";
import { diffIndexedColumns } from "../../src/ddl/diff-indexes";
import { createChangeLogTableDDL, createRowsTableDDL } from "../../src/ddl/tables-ddl";
import {
  type GridSchema,
  type RowPartial,
  createDefaultRegistry,
  createRolePermissionResolver,
} from "../../src/internal/core";
import { type GridTables, defineGridTables } from "../../src/storage/tables";

export const MYSQL_IT_ENABLED = process.env.SCHEMA_GRID_MYSQL_IT === "1";

/** `describe` that only runs when SCHEMA_GRID_MYSQL_IT=1. */
export const describeMysql = (name: string, fn: () => void) => describe.skipIf(!MYSQL_IT_ENABLED)(name, fn);

export interface CapturedQuery {
  sql: string;
  params: unknown[];
}

export interface StartedMysql {
  db: GridDb;
  uri: string;
  /** Every statement drizzle ran, in order (clear it with `queries.length = 0`). */
  queries: CapturedQuery[];
  stop: () => Promise<void>;
}

export async function startMysql(): Promise<StartedMysql> {
  const { MySqlContainer } = await import("@testcontainers/mysql");
  const mysql = await import("mysql2/promise");
  const container = await new MySqlContainer("mysql:8.4").start();
  const uri = container.getConnectionUri();
  const pool = mysql.createPool({ uri, timezone: "Z", connectionLimit: 5 });
  const queries: CapturedQuery[] = [];
  const db = drizzle(pool, { logger: { logQuery: (q, params) => void queries.push({ sql: q, params }) } }) as unknown as GridDb;
  return {
    db,
    uri,
    queries,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

export const IT_ROWS_TABLE = "grid_rows";
export const IT_LOG_TABLE = "grid_change_log";

export function integrationTables(): GridTables {
  return defineGridTables({
    rowsTable: IT_ROWS_TABLE,
    changeLogTable: IT_LOG_TABLE,
    physicalColumns: { email_addr: varchar("email_addr", { length: 191 }) },
  });
}

/** Applies table DDL + generated-column DDL for `schema`, then seeds `rows` through `createRows`. */
export async function setupGrid(
  db: GridDb,
  schema: GridSchema,
  rows: RowPartial[],
  opts: { gridId: string; now: Date },
): Promise<GridTables> {
  const tables = integrationTables();
  const exec = (s: string) => db.execute(s as never);
  await exec(`DROP TABLE IF EXISTS \`${IT_ROWS_TABLE}\``);
  await exec(`DROP TABLE IF EXISTS \`${IT_LOG_TABLE}\``);
  await exec(createRowsTableDDL({ table: IT_ROWS_TABLE, physicalColumns: [{ name: "email_addr", sqlType: "VARCHAR(191)" }] }).sql);
  await exec(createChangeLogTableDDL({ table: IT_LOG_TABLE }).sql);
  const ctx = createServerContext({
    schema,
    registry: createDefaultRegistry(),
    resolver: createRolePermissionResolver({ superRoles: ["seed"] }),
    user: { id: "seed", roles: ["seed"] },
    now: () => opts.now,
  });
  const hook = formulaSqlHook({ ctx, tables, generatedColumns: "ignore" });
  for (const stmt of diffIndexedColumns(null, schema, IT_ROWS_TABLE, { formulaSql: hook })) await exec(stmt.sql);
  await createRows(rows, ctx, { db, tables, gridId: opts.gridId });
  return tables;
}

/** Seeds `rows` into an already set-up grid table under another `gridId` (same schema). */
export async function seedRows(
  db: GridDb,
  tables: GridTables,
  schema: GridSchema,
  rows: RowPartial[],
  opts: { gridId: string; now: Date },
): Promise<void> {
  const ctx = createServerContext({
    schema,
    registry: createDefaultRegistry(),
    resolver: createRolePermissionResolver({ superRoles: ["seed"] }),
    user: { id: "seed", roles: ["seed"] },
    now: () => opts.now,
  });
  await createRows(rows, ctx, { db, tables, gridId: opts.gridId });
}
