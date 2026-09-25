/**
 * Shared fixture schema for every test (see plan "Shared test fixture schema").
 */
import type {
  Access,
  ColumnDef,
  GridRow,
  GridSchema,
} from "../../src/internal/core";

const TS = "2026-09-01T00:00:00.000Z";

function col(
  id: string,
  key: string,
  label: string,
  type: string,
  order: number,
  extra: Partial<ColumnDef> = {},
): ColumnDef {
  return {
    id,
    key,
    label,
    type,
    config: {},
    order,
    createdAt: TS,
    updatedAt: TS,
    ...extra,
  };
}

export const PAY_OPTIONS = [
  { id: "opt_paid", label: "Paid" },
  { id: "opt_pending", label: "Pending" },
];

export const TAG_OPTIONS = [
  { id: "tag_a", label: "A" },
  { id: "tag_b", label: "B" },
  { id: "tag_c", label: "C" },
];

export const STAGE_OPTIONS = [
  { id: "stage_new", label: "New" },
  { id: "stage_won", label: "Won" },
];

export function makeColumns(): ColumnDef[] {
  return [
    col("c_name", "name", "Name", "text", 0, { required: true, width: 140 }),
    col("c_email", "email", "Email", "email", 1),
    col("c_pay", "paymentStatus", "Payment Status", "select", 2, {
      config: { options: PAY_OPTIONS },
    }),
    col("c_tags", "tags", "Tags", "multiSelect", 3, {
      config: { options: TAG_OPTIONS },
    }),
    col("c_stage", "stage", "Stage", "creatableSelect", 4, {
      config: { options: STAGE_OPTIONS },
    }),
    col("c_amount", "amount", "Amount", "currency", 5, {
      config: { currencyCode: "INR", locale: "en-IN", precision: 2 },
    }),
    col("c_joined", "joinedOn", "Joined On", "date", 6, {
      config: { displayFormat: "iso", inputOrder: "DMY" },
    }),
    col("c_call", "lastCall", "Last Call", "datetime", 7, {
      config: { timeZone: "Asia/Kolkata", displayFormat: "iso" },
    }),
    col("c_active", "active", "Active", "boolean", 8),
    col("c_site", "website", "Website", "url", 9),
    col("c_owner", "owner", "Owner", "user", 10),
    col("c_score", "score", "Score", "formula", 11, {
      formula: "{amount} * 2",
      config: { resultType: "number" },
    }),
    col("c_secret", "secret", "Secret", "text", 12),
    col("c_note", "note", "Note", "text", 13),
  ];
}

export function makeSchema(): GridSchema {
  return { id: "leads", schemaVersion: 1, columns: makeColumns() };
}

/** Column by id from a fresh fixture schema (throws if absent). */
export function getColumn(id: string): ColumnDef {
  const c = makeColumns().find((x) => x.id === id);
  if (!c) throw new Error(`No fixture column ${id}`);
  return c;
}

/** Every column "edit" except c_secret ("hidden") and c_note ("read"). */
export function makeAccess(): Map<string, Access> {
  const m = new Map<string, Access>();
  for (const c of makeColumns()) m.set(c.id, "edit");
  m.set("c_secret", "hidden");
  m.set("c_note", "read");
  return m;
}

/** Columns that may be exported / shown (everything except hidden c_secret). */
export function visibleColumns(): ColumnDef[] {
  return makeColumns().filter((c) => c.id !== "c_secret");
}

let rowSeq = 0;
export function makeRow(
  cells: Record<string, unknown>,
  overrides: Partial<GridRow> = {},
): GridRow {
  rowSeq += 1;
  return {
    id: `r_${rowSeq}`,
    version: 1,
    updatedAt: TS,
    cells,
    ...overrides,
  };
}

/** One realistic value per visible column, keyed by column.key. */
export function sampleCells(i = 0): Record<string, unknown> {
  return {
    name: `Asha ${i}`,
    email: `asha${i}@example.com`,
    paymentStatus: i % 2 === 0 ? "opt_paid" : "opt_pending",
    tags: ["tag_a", "tag_c"],
    stage: "stage_new",
    amount: 1234.5 + i,
    joinedOn: "2026-09-25",
    lastCall: "2026-09-25T05:00:00.000Z",
    active: i % 2 === 0,
    website: "https://example.com/a",
    owner: { id: "u1", name: "Ravi" },
    score: 2469 + 2 * i,
    note: `note ${i}`,
  };
}
