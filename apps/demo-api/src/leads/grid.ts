import { type ColumnDef, createRolePermissionResolver, type GridSchema } from "@ranjeetk25/schema-grid-core";
import { createSqlViewDataSource, type ExtensionCellStore, type GridDb } from "@ranjeetk25/schema-grid-server/drizzle";
import { defineGrid, type SchemaStore } from "@ranjeetk25/schema-grid-server/http";
import { eq, sql } from "drizzle-orm";
import type { GridRequestContext } from "../context";
import type { LeadsTable } from "./table";

const at = "2026-09-01T00:00:00.000Z";
const col = (order: number, key: string, label: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef =>
  ({ id: key, key, label, type, config: {}, order, createdAt: at, updatedAt: at, ...extra });
const options = ["Paid", "Pending", "Failed"].map((label) => ({ id: label.toLowerCase(), label }));

export const leadsSchema: GridSchema = { id: "leads", schemaVersion: 1, columns: [
  col(0, "name", "Name", "text"),
  col(1, "email", "Email", "email"),
  col(2, "paymentStatus", "Payment status", "select", { config: { options } }),
  col(3, "callDate", "Call date", "date", { config: { displayFormat: "dmy", inputOrder: "DMY" } }),
  col(4, "aiVerified", "AI verified", "boolean", { settable: false, sortable: false }), // AI pipeline only; unindexed
  col(5, "contact", "Contact", "text", { settable: false, sortable: false }), // computed below: read-only, unfilterable
] };

type Deps = { db: GridDb; table: LeadsTable; tz: string; schemaStore: SchemaStore; extension: ExtensionCellStore };

/** The existing `leads` table as a grid; "+" columns live in `extension`. Only admins may change the schema. */
export const leadsGrid = ({ db, table: t, tz, schemaStore, extension }: Deps) => defineGrid<GridRequestContext>({
  id: "leads", schema: leadsSchema, schemaStore,
  permission: (ctx, op) => op !== "updateSchema" || ctx.user.roles.includes("admin"),
  source: (ctx, { schema }) => createSqlViewDataSource({
    db, schema, resolver: createRolePermissionResolver(), user: ctx.user, tz, now: ctx.now, extension,
    baseQuery: () => sql`select * from ${t}`, rowId: t.id, updatedAt: t.updatedAt,
    columns: { name: { expr: t.name, searchable: true }, email: { expr: t.email, searchable: true },
      paymentStatus: { expr: t.paymentStatus }, callDate: { expr: t.callDate }, aiVerified: { expr: t.aiVerified },
      contact: { compute: (row) => `${row.cells.name ?? ""} <${row.cells.email ?? ""}>` } },
    defaultCapabilities: { maxPageSize: 200 },
    write: { update: async (view, { rowId, changes }) => { // `view.db` is the batch transaction
      await view.db.update(t).set(Object.fromEntries(changes.map((c) => [c.columnId, c.next]))).where(eq(t.id, Number(rowId)));
      return { applied: changes, version: 0 }; // no version column: the source re-reads the row hash
    } },
  }),
});
