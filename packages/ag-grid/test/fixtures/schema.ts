import type { ColumnDef, FieldTypeId, GridRow, GridSchema, GridUser } from "../../src/internal/core";

const TS = "2026-09-01T00:00:00.000Z";

export function col(partial: Partial<ColumnDef> & { id: string; type: FieldTypeId }, order = 0): ColumnDef {
  return {
    key: partial.id,
    label: partial.id,
    config: {},
    order,
    createdAt: TS,
    updatedAt: TS,
    ...partial,
  };
}

export const PAYMENT_OPTIONS = [
  { id: "paid", label: "Paid" },
  { id: "pending", label: "Pending" },
  { id: "failed", label: "Failed" },
];

export const TAG_OPTIONS = [
  { id: "hot", label: "Hot" },
  { id: "warm", label: "Warm" },
  { id: "cold", label: "Cold" },
];

/** One column per built-in type, plus permission variants. Column id === key. */
export const fixtureColumns: ColumnDef[] = [
  col({ id: "name", type: "text", label: "Name" }, 0),
  col({ id: "notes", type: "longText", label: "Notes" }, 1),
  col({ id: "score", type: "number", label: "Score" }, 2),
  col({ id: "fee", type: "currency", label: "Fee", config: { currency: "INR", precision: 2 } }, 3),
  col({ id: "active", type: "boolean", label: "Active" }, 4),
  col({ id: "callDate", type: "date", label: "Call date" }, 5),
  col({ id: "createdAt", type: "datetime", label: "Created at" }, 6),
  col({ id: "payment", type: "select", label: "Payment status", config: { options: PAYMENT_OPTIONS } }, 7),
  col({ id: "tags", type: "multiSelect", label: "Tags", config: { options: TAG_OPTIONS } }, 8),
  col({ id: "source", type: "creatableSelect", label: "Source", config: { options: [] } }, 9),
  col({ id: "owner", type: "user", label: "Owner" }, 10),
  col({ id: "website", type: "url", label: "Website" }, 11),
  col({ id: "email", type: "email", label: "Email" }, 12),
  col({ id: "phone", type: "phone", label: "Phone" }, 13),
  col({ id: "program", type: "link", label: "Program" }, 14),
  col({ id: "total", type: "formula", label: "Total", formula: "{score} * 2", config: { resultType: "number" } }, 15),
  // Permission variants
  col(
    { id: "salary", type: "number", label: "Salary", permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } },
    16,
  ),
  col({ id: "status", type: "text", label: "Status", permissions: { read: "all", edit: { roles: ["admin"] } } }, 17),
];

export const fixtureSchema: GridSchema = {
  id: "leads",
  schemaVersion: 1,
  columns: fixtureColumns,
};

export const ADMIN: GridUser = { id: "u-admin", roles: ["admin"] };
export const AGENT: GridUser = { id: "u-agent", roles: ["agent"] };

export function row(id: string, cells: Record<string, unknown>, version = 1): GridRow {
  return { id, version, updatedAt: TS, cells };
}

export const fixtureRows: GridRow[] = [
  row("r1", {
    name: "Asha",
    score: 10,
    fee: 1000,
    active: true,
    callDate: "2026-09-24",
    payment: "paid",
    tags: ["hot"],
    owner: { id: "u-agent", name: "Agent" },
    email: "asha@example.com",
    salary: 50,
    status: "open",
  }),
  row("r2", {
    name: "Bala",
    score: 5,
    fee: 500,
    active: false,
    callDate: "2026-09-23",
    payment: "pending",
    tags: ["warm", "cold"],
    owner: { id: "u-admin", name: "Admin" },
    salary: 70,
    status: "closed",
  }),
  row("r3", { name: "Chitra", score: null, payment: null, callDate: "2026-09-24", tags: [], status: "open" }),
  row("r4", { name: "Dev", score: 20, payment: "failed", callDate: null, active: true, owner: { id: "u-agent", name: "Agent" } }),
];
