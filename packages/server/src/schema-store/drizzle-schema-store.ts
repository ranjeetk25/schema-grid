import { eq } from "drizzle-orm";
import { datetime, int, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import type { GridDb } from "../changes/db";
import { SchemaGridServerError } from "../errors";
import type { GridSchema, SchemaStore } from "../internal/core";
import { assertSafeColumnKey } from "../storage/keys";

/** Matches `grid_id VARCHAR(64)` in `createGridSchemasTableDDL`. */
const MAX_GRID_ID_LENGTH = 64;

function gridSchemasTableFor(name: string) {
  return mysqlTable(name, {
    gridId: varchar("grid_id", { length: MAX_GRID_ID_LENGTH }).primaryKey(),
    schema: json("schema").$type<GridSchema>().notNull(),
    schemaVersion: int("schema_version").notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull(),
  });
}

export interface DrizzleSchemaStoreOptions {
  db: GridDb;
  /** Table created by `createGridSchemasTableDDL({ table })`. */
  table: string;
  /** Clock for `updated_at` (defaults to `new Date()`). */
  now?: () => Date;
}

function assertGridId(gridId: string): void {
  // VARCHAR length counts characters (code points), not UTF-16 units.
  const length = typeof gridId === "string" ? Array.from(gridId).length : 0;
  if (length === 0 || length > MAX_GRID_ID_LENGTH) {
    throw new SchemaGridServerError(
      "INVALID_GRID_ID",
      `Grid id must be a non-empty string of at most ${MAX_GRID_ID_LENGTH} characters`,
      { maxLength: MAX_GRID_ID_LENGTH },
    );
  }
}

/** mysql2 returns JSON columns parsed; other drivers / casts may return the raw string. */
function parseSchema(value: unknown): GridSchema {
  return (typeof value === "string" ? JSON.parse(value) : value) as GridSchema;
}

/**
 * `SchemaStore` over a MySQL table (see `createGridSchemasTableDDL`). `put` is a
 * single `INSERT … ON DUPLICATE KEY UPDATE`, so concurrent writers are safe and
 * the last write wins. Schema contents are not validated here (`defineGrid`
 * validates before calling `put`); grid ids must be 1–64 characters
 * (`INVALID_GRID_ID` otherwise).
 */
export function createDrizzleSchemaStore(options: DrizzleSchemaStoreOptions): SchemaStore {
  assertSafeColumnKey(options.table);
  const table = gridSchemasTableFor(options.table);
  const { db } = options;
  const now = options.now ?? (() => new Date());

  return {
    async get(gridId) {
      assertGridId(gridId);
      const rows = await db.select({ schema: table.schema }).from(table).where(eq(table.gridId, gridId)).limit(1);
      const row = rows[0];
      return row ? parseSchema(row.schema) : null;
    },

    async put(gridId, schema) {
      assertGridId(gridId);
      const values = { schema, schemaVersion: schema.schemaVersion, updatedAt: now() };
      await db
        .insert(table)
        .values({ gridId, ...values })
        .onDuplicateKeyUpdate({ set: values });
    },
  };
}
