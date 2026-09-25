import { describe, expect, it } from "vitest";
import { createDefaultRegistry, matchesFilter } from "../../src/internal/core";
import { validateSchema } from "../../src/schema/validate-schema";
import {
  FIXTURE_NOW,
  FIXTURE_TZ,
  PHYSICAL_COLUMN_NAMES,
  SECTION_8_EXPECTED_IDS,
  SECTION_8_FILTER,
  SECTION_8_NEXT_DAY_EXPECTED_IDS,
  admissionsRows,
  admissionsSchema,
} from "../fixtures/admissions";

describe("admissions fixture", () => {
  it("is a valid server schema", () => {
    const r = validateSchema(admissionsSchema, createDefaultRegistry(), { physicalColumns: [...PHYSICAL_COLUMN_NAMES] });
    expect(r.issues).toEqual([]);
  });

  it("§8 expectations agree with the (temporary) core reference matcher", () => {
    const registry = createDefaultRegistry();
    const rows = admissionsRows.map((p) => ({ id: p.id as string, version: 1, updatedAt: "", cells: p.cells ?? {} }));
    const run = (now: Date) =>
      rows.filter((r) => matchesFilter(SECTION_8_FILTER, r, { schema: admissionsSchema, registry, now, tz: FIXTURE_TZ })).map((r) => r.id);
    expect(run(FIXTURE_NOW)).toEqual(SECTION_8_EXPECTED_IDS);
    expect(run(new Date(FIXTURE_NOW.getTime() + 86_400_000))).toEqual(SECTION_8_NEXT_DAY_EXPECTED_IDS);
  });
});
