import type { ColumnDef, GridSchema } from "../schema/types";

const TS = "2026-09-01T00:00:00.000Z";

/** Column ids of the shared fixture schema (filters/sort/changes use ids). */
export const FIXTURE_COLUMN_IDS = {
  name: "col_name",
  fee: "col_fee",
  paid: "col_paid",
  status: "col_status",
  tags: "col_tags",
  owner: "col_owner",
  callDate: "col_callDate",
  calledAt: "col_calledAt",
  isActive: "col_isActive",
  balance: "col_balance",
  notes: "col_notes",
  stage: "col_stage",
  website: "col_website",
  email: "col_email",
  phone: "col_phone",
  programs: "col_programs",
} as const;

/** Instant the fixture rows are designed around: 2026-09-25T02:30+05:30. */
export const FIXTURE_NOW = "2026-09-24T21:00:00.000Z";
export const FIXTURE_TIME_ZONE = "Asia/Kolkata";

/** Users for permission-aware tests. `notes` is hidden and `fee` read-only for the counsellor. */
export const FIXTURE_USERS = {
  admin: { id: "u1", roles: ["admin"] },
  counsellor: { id: "u2", roles: ["counsellor"] },
} as const;

function col(
  order: number,
  key: keyof typeof FIXTURE_COLUMN_IDS,
  label: string,
  type: string,
  config: unknown,
  extra: Partial<ColumnDef> = {},
): ColumnDef {
  return {
    id: FIXTURE_COLUMN_IDS[key],
    key,
    label,
    type,
    config,
    order,
    createdAt: TS,
    updatedAt: TS,
    ...extra,
  };
}

/** Admissions-style schema covering all 16 built-in field types. Returns a fresh deep copy. */
export function createFixtureSchema(): GridSchema {
  return {
    id: "admissions",
    schemaVersion: 1,
    columns: [
      col(0, "name", "Name", "text", {}),
      col(
        1,
        "fee",
        "Fee",
        "currency",
        { currencyCode: "INR", locale: "en-IN", precision: 2 },
        { permissions: { read: "all", edit: { roles: ["admin"] } } },
      ),
      col(2, "paid", "Paid", "number", {
        precision: 0,
        useGrouping: true,
        locale: "en-IN",
      }),
      col(3, "status", "Payment status", "select", {
        options: [
          { id: "paid", label: "Paid", color: "green" },
          { id: "pending", label: "Pending", color: "yellow" },
          { id: "partial", label: "Partial", color: "orange" },
        ],
      }),
      col(4, "tags", "Tags", "multiSelect", {
        options: [
          { id: "scholar", label: "Scholarship" },
          { id: "referral", label: "Referral" },
          { id: "vip", label: "VIP" },
        ],
        allowCreate: true,
      }),
      col(5, "owner", "Owner", "user", {}),
      col(6, "callDate", "Call date", "date", {
        displayFormat: "dmy",
        inputOrder: "DMY",
      }),
      col(7, "calledAt", "Called at", "datetime", {
        timeZone: "Asia/Kolkata",
        displayFormat: "dmy",
        hour12: true,
        inputOrder: "DMY",
      }),
      col(8, "isActive", "Active", "boolean", {}),
      col(
        9,
        "balance",
        "Balance",
        "formula",
        { resultType: "number", precision: 0 },
        { formula: "{fee} - {paid}" },
      ),
      col(
        10,
        "notes",
        "Internal notes",
        "longText",
        {},
        {
          permissions: {
            read: { roles: ["admin"] },
            edit: { roles: ["admin"] },
          },
        },
      ),
      col(11, "stage", "Stage", "creatableSelect", {
        options: [
          { id: "lead", label: "Lead" },
          { id: "applied", label: "Applied" },
        ],
      }),
      col(12, "website", "Website", "url", {}),
      col(13, "email", "Email", "email", {}),
      col(14, "phone", "Phone", "phone", { defaultCountryCode: "+91" }),
      col(15, "programs", "Programs", "link", {
        target: "programs",
        multiple: true,
      }),
    ],
  };
}

export const fixtureSchema: GridSchema = createFixtureSchema();
