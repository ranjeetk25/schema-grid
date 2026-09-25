/**
 * Shared admissions fixture (plan Task 24).
 *
 * TODO(core): core plans to export this from `@masai/schema-grid-core/testing`
 * together with its in-memory DataSource. Until it does, this is a local copy
 * shaped after core plan `test/fixtures/schema.ts` + the server plan's T24
 * requirements (payment_status select with empty rows, call_date on both the
 * IST-yesterday and UTC-yesterday days, an indexed column, a physical-source
 * column, a hidden column, one SQL-translatable and one non-translatable formula).
 */
import type { ColumnDef, GridSchema, RowPartial } from "../../src/internal/core";

/** 2026-09-25T00:30+05:30 == 2026-09-24T19:00Z: IST "yesterday" is 09-24, UTC "yesterday" is 09-23. */
export const FIXTURE_NOW = new Date("2026-09-25T00:30:00+05:30");
export const FIXTURE_TZ = "Asia/Kolkata";
export const FIXTURE_GRID_ID = "admissions";

const T = "2026-09-01T00:00:00.000Z";
const c = (id: string, type: string, order: number, extra: Partial<ColumnDef> = {}): ColumnDef => ({
  id,
  key: id,
  label: id.replace(/_/g, " "),
  type,
  config: {},
  order,
  createdAt: T,
  updatedAt: T,
  ...extra,
});

export const PAYMENT_OPTIONS = {
  options: [
    { id: "paid", label: "Paid" },
    { id: "pending", label: "Pending" },
    { id: "failed", label: "Failed" },
  ],
};
export const TAG_OPTIONS = {
  options: [
    { id: "hot", label: "Hot" },
    { id: "cold", label: "Cold" },
    { id: "vip", label: "VIP" },
  ],
};

export const ADMIN_ONLY = { read: { roles: ["admin"] }, edit: { roles: ["admin"] } };

export const admissionsSchema: GridSchema = {
  id: "admissions",
  schemaVersion: 1,
  columns: [
    c("name", "text", 0),
    c("email", "email", 1, { source: { valueField: "email_addr" } }),
    c("fee", "currency", 2, { indexed: true }),
    c("paid", "number", 3),
    c("payment_status", "select", 4, { config: PAYMENT_OPTIONS }),
    c("call_date", "date", 5),
    c("called_at", "datetime", 6),
    c("is_active", "boolean", 7),
    c("tags", "multiSelect", 8, { config: TAG_OPTIONS }),
    c("owner", "user", 9),
    c("salary", "number", 10, { permissions: ADMIN_ONLY }),
    // SQL-translatable (inline / generated)
    c("balance", "formula", 11, { formula: "{fee} - {paid}", config: { resultType: "number" } }),
    // NOT SQL-translatable (boolean ref) → in-memory fallback
    c("active_fee", "formula", 12, { formula: "IF({is_active}, {fee}, 0)", config: { resultType: "number" } }),
  ],
};

/** Physical columns on the rows table (`source.valueField` targets). */
export const PHYSICAL_COLUMN_NAMES = ["email_addr"] as const;

type Cells = Record<string, unknown>;
const row = (id: string, cells: Cells): RowPartial => ({ id, cells });

export const admissionsRows: RowPartial[] = [
  row("r01", { name: "Asha", email: "asha@x.in", fee: 50000, paid: 50000, payment_status: "paid", call_date: "2026-09-24", called_at: "2026-09-24T04:30:00.000Z", is_active: true, tags: ["hot"], owner: { id: "u1", name: "Uma" }, salary: 10 }),
  row("r02", { name: "Bala", email: "bala@x.in", fee: 40000, paid: 10000, payment_status: "pending", call_date: "2026-09-24", called_at: "2026-09-23T19:00:00.000Z", is_active: true, tags: ["cold", "vip"], owner: { id: "u2" }, salary: 20 }),
  row("r03", { name: "Chitra", fee: 45000, paid: 0, call_date: "2026-09-24", called_at: "2026-09-24T18:29:59.000Z", is_active: false, owner: { id: "u1" } }),
  row("r04", { name: "Dev", email: "dev@x.in", fee: 30000, paid: 5000, payment_status: "failed", call_date: "2026-09-23", called_at: "2026-09-23T18:29:59.000Z", is_active: true, tags: ["hot"] }),
  row("r05", { name: "esha", fee: 30000, payment_status: "pending", call_date: "2026-09-23", is_active: false }),
  row("r06", { name: "Farid", fee: 60000, paid: 60000, call_date: "2026-09-25", called_at: "2026-09-24T18:30:00.000Z", tags: ["vip"] }),
  row("r07", { name: "Gita", fee: 50000, paid: 20000, payment_status: "paid", call_date: "2026-09-23", owner: { id: "u2" } }),
  row("r08", { name: "Hari", paid: 1000, payment_status: "pending", is_active: true, tags: ["hot", "cold"] }),
  row("r09", { name: "Ira", email: "ira@x.in", fee: 35000, paid: 35000, payment_status: "failed", call_date: "2026-09-24", is_active: true, owner: { id: "u3" } }),
  row("r10", { name: "Jai", fee: 25000 }),
];

/** Spec §8: payment_status isNot "paid" AND call_date isWithin yesterday (IST 2026-09-24). */
export const SECTION_8_FILTER = {
  op: "and" as const,
  children: [
    { columnId: "payment_status", operator: "isNot", value: "paid" },
    { columnId: "call_date", operator: "isWithin", value: { relative: "yesterday" as const } },
  ],
};
export const SECTION_8_EXPECTED_IDS = ["r02", "r03", "r09"];
/** Same view reopened 24h later: "yesterday" is 2026-09-25. */
export const SECTION_8_NEXT_DAY_EXPECTED_IDS = ["r06"];
