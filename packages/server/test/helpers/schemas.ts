import { varchar } from "drizzle-orm/mysql-core";
import { createServerContext, type ServerContext } from "../../src/context";
import {
  type ColumnDef,
  type GridSchema,
  type PermissionUser,
  createDefaultRegistry,
  createRolePermissionResolver,
} from "../../src/internal/core";
import type { SqlScope } from "../../src/sql/scope";
import { defineGridTables } from "../../src/storage/tables";

export function col(id: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef {
  return {
    id,
    key: id,
    label: id,
    type,
    config: {},
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

export const OPTIONS = {
  options: [
    { id: "paid", label: "Paid" },
    { id: "pending", label: "Pending" },
    { id: "failed", label: "Failed" },
  ],
};

/** One column per built-in field type (column id === key). */
export function allTypesSchema(extra: ColumnDef[] = []): GridSchema {
  return {
    id: "grid_all",
    schemaVersion: 1,
    columns: [
      col("name", "text"),
      col("notes", "longText"),
      col("site", "url"),
      col("email", "email"),
      col("phone", "phone"),
      col("fee", "currency"),
      col("paid", "number"),
      col("isActive", "boolean"),
      col("callDate", "date"),
      col("calledAt", "datetime"),
      col("paymentStatus", "select", { config: OPTIONS }),
      col("source", "creatableSelect", { config: OPTIONS }),
      col("tags", "multiSelect", { config: OPTIONS }),
      col("owner", "user"),
      col("links", "link", { config: { target: "x", multiple: true } }),
      col("balance", "formula", { formula: "{fee} - {paid}", config: { resultType: "number" } }),
      col("indexedFee", "number", { indexed: true }),
      col("contactEmail", "email", { source: { valueField: "email_addr" } }),
      ...extra,
    ],
  };
}

export const tables = defineGridTables({
  rowsTable: "grid_rows",
  changeLogTable: "grid_change_log",
  physicalColumns: { email_addr: varchar("email_addr", { length: 191 }) },
});

export function makeCtx(
  schema: GridSchema = allTypesSchema(),
  opts: { user?: PermissionUser; now?: Date; tz?: string } = {},
): ServerContext {
  return createServerContext({
    schema,
    registry: createDefaultRegistry(),
    resolver: createRolePermissionResolver(),
    user: opts.user ?? { id: "u1", roles: ["admin"] },
    ...(opts.now ? { now: () => opts.now as Date } : {}),
    ...(opts.tz ? { tz: opts.tz } : {}),
  });
}

export function makeScope(ctx: ServerContext = makeCtx(), extra: Partial<SqlScope> = {}): SqlScope {
  return { ctx, tables, generatedColumns: "assumePresent", ...extra };
}

export function column(schema: GridSchema, id: string): ColumnDef {
  const c = schema.columns.find((x) => x.id === id);
  if (!c) throw new Error(`no column ${id}`);
  return c;
}
