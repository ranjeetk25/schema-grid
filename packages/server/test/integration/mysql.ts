/**
 * Real-MySQL integration harness (plan Task 24). Everything here is skipped
 * unless `SCHEMA_GRID_MYSQL_IT=1` (requires Docker for @testcontainers/mysql).
 */
import { boolean, date, datetime, decimal, int, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { describe } from "vitest";
import type { GridDb } from "../../src/changes/db";
import { createRows } from "../../src/changes/rows-crud";
import { createServerContext } from "../../src/context";
import { formulaSqlHook } from "../../src/ddl/generated-columns";
import { diffIndexedColumns } from "../../src/ddl/diff-indexes";
import { createExtensionCellsTableDDL } from "../../src/ddl/extension-ddl";
import { createChangeLogTableDDL, createRowsTableDDL } from "../../src/ddl/tables-ddl";
import {
  type GridRow,
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

// ---- plain existing table (SQL-view reference, spec v0.2 §C4) ---------------

/** A plain `leads` table — no `cells` JSON — as an app would already have it. */
export const leadsTable = mysqlTable("leads", {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  email: varchar("email", { length: 191 }),
  paymentStatus: mysqlEnum("payment_status", ["paid", "pending", "partial"]),
  callDate: date("call_date", { mode: "string" }),
  aiVerified: boolean("ai_verified"),
  fee: decimal("fee", { precision: 12, scale: 2 }),
  version: int("version").notNull().default(1),
  updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
});

export const IT_EXTENSION_TABLE = "grid_extension_cells";

export interface LeadSeed {
  id: number;
  name?: string | null;
  email?: string | null;
  paymentStatus?: "paid" | "pending" | "partial" | null;
  callDate?: string | null;
  aiVerified?: boolean | null;
  fee?: number | null;
  updatedAt: Date;
}

/** Fixture row `rN` → lead N (name/email/status/callDate/isActive/fee). */
export function leadSeedFromFixture(row: GridRow, updatedAt: Date): LeadSeed {
  const c = row.cells as Record<string, unknown>;
  return {
    id: Number(row.id.replace(/^r/, "")),
    name: (c.name as string | null | undefined) ?? null,
    email: (c.email as string | null | undefined) ?? null,
    paymentStatus: (c.status as LeadSeed["paymentStatus"]) ?? null,
    callDate: (c.callDate as string | null | undefined) ?? null,
    aiVerified: (c.isActive as boolean | null | undefined) ?? null,
    fee: (c.fee as number | null | undefined) ?? null,
    updatedAt,
  };
}

/** (Re)creates `leads` + the extension cells table and seeds `rows`. */
export async function setupLeadsTable(db: GridDb, rows: LeadSeed[]): Promise<void> {
  const exec = (s: string) => db.execute(s as never);
  await exec("DROP TABLE IF EXISTS `leads`");
  await exec(`DROP TABLE IF EXISTS \`${IT_EXTENSION_TABLE}\``);
  await exec(
    [
      "CREATE TABLE `leads` (",
      "  `id` INT NOT NULL,",
      "  `name` VARCHAR(100) NULL,",
      "  `email` VARCHAR(191) NULL,",
      "  `payment_status` ENUM('paid','pending','partial') NULL,",
      "  `call_date` DATE NULL,",
      "  `ai_verified` BOOLEAN NULL,",
      "  `fee` DECIMAL(12,2) NULL,",
      "  `version` INT NOT NULL DEFAULT 1,",
      "  `updated_at` DATETIME(3) NOT NULL,",
      "  PRIMARY KEY (`id`)",
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci",
    ].join("\n"),
  );
  await exec(createExtensionCellsTableDDL({ table: IT_EXTENSION_TABLE }).sql);
  if (rows.length > 0) {
    await db.insert(leadsTable).values(
      rows.map((r) => ({
        id: r.id,
        name: r.name ?? null,
        email: r.email ?? null,
        paymentStatus: r.paymentStatus ?? null,
        callDate: r.callDate ?? null,
        aiVerified: r.aiVerified ?? null,
        fee: r.fee === null || r.fee === undefined ? null : String(r.fee),
        version: 1,
        updatedAt: r.updatedAt,
      })),
    );
  }
}
