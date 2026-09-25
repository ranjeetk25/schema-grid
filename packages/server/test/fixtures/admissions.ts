/**
 * Server fixture, built on top of core's shared fixture
 * (`@masai/schema-grid-core/testing`). Core owns the canonical admissions-style
 * schema + r1..r5 rows (all 16 built-in field types, permission split between
 * `FIXTURE_USERS.admin`/`counsellor`, and the §8 IST/UTC "yesterday" boundary).
 *
 * This module only *extends* that fixture with the bits the server-specific
 * test suite needs that core's fixture intentionally leaves out:
 *  - `fee` marked `indexed: true` (drizzle-kit DDL / generated-column tests);
 *  - a physical-source column (`contact`, `source.valueField: "email_addr"`)
 *    for the `physicalColumns` validate-schema / drizzle-table-defs path;
 *  - a non-SQL-translatable formula (`active_fee` = `IF({isActive}, {fee}, 0)`).
 *    Boolean column refs are outside `formulaToSql`'s translatable subset
 *    (see `src/formula/formula-to-sql.ts`'s `REF_KINDS`), so `planFormulaColumns`
 *    plans it as `"fallback"` (in-memory), while core's `balance` formula
 *    (`{fee} - {paid}`, both numeric) plans as `"inline"` (not indexed here);
 *  - two extra rows (r6, r7) appended after core's r1..r5, used to prove §8's
 *    IST-vs-UTC "yesterday" handling: r6's `callDate`/`calledAt` sit on the
 *    UTC-yesterday day (2026-09-23) without landing on the IST-yesterday day,
 *    and r7's `callDate` lands on the *next* IST-yesterday window (+24h).
 *
 * Core's own r1..r5 / createFixtureSchema output are never mutated here, only
 * appended to or shallow-copied with additions.
 */
import type { ColumnDef, GridRow, GridSchema, RowPartial } from "../../src/internal/core";
import {
  FIXTURE_COLUMN_IDS,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
  createFixtureLinkTargets,
  createFixtureRows,
  createFixtureSchema,
  fixtureRows,
  fixtureSchema,
} from "@masai/schema-grid-core/testing";

export {
  FIXTURE_COLUMN_IDS,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
  createFixtureLinkTargets,
  createFixtureRows,
  createFixtureSchema,
  fixtureRows,
  fixtureSchema,
};

/** ids for the columns this module adds on top of `FIXTURE_COLUMN_IDS`. */
export const SERVER_FIXTURE_COLUMN_IDS = {
  contact: "col_contact",
  activeFee: "col_activeFee",
} as const;

/** Physical columns backing `source.valueField` targets (DDL / drizzle table defs). */
export const PHYSICAL_COLUMN_NAMES = ["email_addr"] as const;

/** Grid id used across the server test suite (matches `serverFixtureSchema.id`). */
export const FIXTURE_GRID_ID = "admissions";

const T = "2026-09-01T00:00:00.000Z";

/** Core's admissions schema + the server-only additions described above. */
export function createServerFixtureSchema(): GridSchema {
  const schema = createFixtureSchema();
  const columns: ColumnDef[] = schema.columns.map((column): ColumnDef =>
    column.key === "fee" ? { ...column, indexed: true } : column,
  );
  columns.push(
    {
      id: SERVER_FIXTURE_COLUMN_IDS.contact,
      key: "contact",
      label: "Contact email",
      type: "email",
      config: {},
      order: columns.length,
      createdAt: T,
      updatedAt: T,
      source: { valueField: "email_addr" },
    },
    {
      id: SERVER_FIXTURE_COLUMN_IDS.activeFee,
      key: "active_fee",
      label: "Active fee",
      type: "formula",
      config: { resultType: "number" },
      formula: "IF({isActive}, {fee}, 0)",
      order: columns.length + 1,
      createdAt: T,
      updatedAt: T,
    },
  );
  return { ...schema, columns };
}

export const serverFixtureSchema: GridSchema = createServerFixtureSchema();

function row(id: string, cells: Record<string, unknown>): GridRow {
  return { id, version: 1, updatedAt: T, cells };
}

/**
 * Core's r1..r5, unchanged, plus:
 *  - r6: callDate "2026-09-23" / calledAt "2026-09-23T19:00:00.000Z" — the
 *    UTC-yesterday day relative to FIXTURE_NOW, but converting `calledAt` to
 *    Asia/Kolkata lands it on 2026-09-24 (IST-yesterday). Non-paid status, so
 *    if §8's `callDate isWithin yesterday` were ever computed against UTC
 *    calendar days instead of `FIXTURE_TIME_ZONE`, this row would wrongly
 *    appear in the result.
 *  - r7: callDate "2026-09-25" (IST-"today" at FIXTURE_NOW) — becomes
 *    IST-yesterday exactly 24h later, so it proves the saved-view-reopened-
 *    next-day case is a genuinely different, non-empty result.
 */
export function createServerFixtureRows(): GridRow[] {
  return [
    ...createFixtureRows(),
    row("r6", {
      name: "Farhan Iqbal",
      fee: 55000,
      paid: 55000,
      status: "pending",
      tags: [],
      owner: null,
      callDate: "2026-09-23",
      calledAt: "2026-09-23T19:00:00.000Z",
      isActive: true,
      notes: null,
      stage: "lead",
      website: null,
      email: null,
      phone: null,
      programs: [],
      contact: "farhan@example.com",
    }),
    row("r7", {
      name: "Gauri Kapoor",
      fee: 48000,
      paid: 12000,
      status: "pending",
      tags: ["vip"],
      owner: { id: "u1", name: "Anil Admin" },
      callDate: "2026-09-25",
      calledAt: "2026-09-25T04:00:00.000Z",
      isActive: false,
      notes: "Follow up",
      stage: "applied",
      website: null,
      email: null,
      phone: null,
      programs: [],
      contact: null,
    }),
  ];
}

export const serverFixtureRows: readonly GridRow[] = createServerFixtureRows();

/** `createServerFixtureRows()` projected down to `{ id, cells }`, for `createRows`/`setupGrid`. */
export function createServerFixtureRowPartials(): RowPartial[] {
  return createServerFixtureRows().map((r) => ({ id: r.id, cells: r.cells }));
}

/** Spec §8: status isNot "paid" AND callDate isWithin yesterday (Asia/Kolkata). */
export const SECTION_8_FILTER = {
  op: "and" as const,
  children: [
    { columnId: FIXTURE_COLUMN_IDS.status, operator: "isNot", value: "paid" },
    { columnId: FIXTURE_COLUMN_IDS.callDate, operator: "isWithin", value: { relative: "yesterday" as const } },
  ],
};

/** §8 over core's UNextended r1..r5 at FIXTURE_NOW: matches exactly r2 and r3. */
export const SECTION_8_CORE_EXPECTED_IDS = ["r2", "r3"];

/** §8 over `createServerFixtureRows()` at FIXTURE_NOW; verified against core's `matchesFilter` in fixture.test.ts. */
export const SECTION_8_EXPECTED_IDS = ["r2", "r3"];
/** Same view reopened 24h later ("yesterday" shifts to 2026-09-25). */
export const SECTION_8_NEXT_DAY_EXPECTED_IDS = ["r7"];
