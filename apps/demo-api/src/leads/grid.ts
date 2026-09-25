import { type ColumnDef, createRolePermissionResolver, type GridSchema } from "@ranjeetk25/schema-grid-core";
import type { GridDb } from "@ranjeetk25/schema-grid-server/drizzle";
import { defineGrid, type SchemaStore } from "@ranjeetk25/schema-grid-server/http";
import { eq, sql } from "drizzle-orm";
import type { GridRequestContext } from "../context";
import { createSqlViewDataSource } from "../sqlview-stub"; // TODO(lane-b): from "@ranjeetk25/schema-grid-server/drizzle"
import type { LeadsTable } from "./table";

const at = "2026-09-01T00:00:00.000Z";
const col = (order: number, key: string, label: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef =>
  ({ id: key, key, label, type, config: {}, order, createdAt: at, updatedAt: at, ...extra });
const options = ["Paid", "Pending", "Failed"].map((label) => ({ id: label.toLowerCase(), label }));
const readOnly: Partial<ColumnDef> = { permissions: { read: "all", edit: { roles: [] } } }; // TODO(lane-a): settable: false

export const leadsSchema: GridSchema = { id: "leads", schemaVersion: 1, columns: [
  col(0, "name", "Name", "text"),
  col(1, "email", "Email", "email"),
  col(2, "paymentStatus", "Payment status", "select", { config: { options } }),
  col(3, "callDate", "Call date", "date", { config: { displayFormat: "dmy", inputOrder: "DMY" } }),
  col(4, "aiVerified", "AI verified", "boolean", readOnly),
] };

type Deps = { db: GridDb; table: LeadsTable; tz: string; schemaStore?: SchemaStore };

/** The existing `leads` table as a grid. Anyone may read/edit rows; only admins may change the schema. */
export const leadsGrid = ({ db, table: t, tz, schemaStore }: Deps) => defineGrid<GridRequestContext>({
  id: "leads", schema: leadsSchema, schemaStore,
  permission: (ctx, op) => op !== "updateSchema" || ctx.user.roles.includes("admin"),
  source: (ctx, { schema }) => createSqlViewDataSource({
    db, schema, resolver: createRolePermissionResolver(), user: ctx.user, tz, now: ctx.now,
    baseQuery: () => sql`${t}`, rowId: t.id, updatedAt: t.updatedAt,
    columns: { name: { expr: t.name, searchable: true }, email: { expr: t.email, searchable: true },
      paymentStatus: { expr: t.paymentStatus }, callDate: { expr: t.callDate }, aiVerified: { expr: t.aiVerified } },
    write: { update: async (_ctx, { rowId, changes }) => {
      await db.update(t).set(Object.fromEntries(changes.map((c) => [c.columnId, c.next]))).where(eq(t.id, Number(rowId)));
      return { applied: changes, version: 0 }; // no version column: the source re-hashes the row
    } },
  }),
});
