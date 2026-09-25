import { describe, expect, it } from "vitest";
import { createDefaultRegistry, matchesFilter } from "../../src/internal/core";
import { validateSchema } from "../../src/schema/validate-schema";
import {
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  PHYSICAL_COLUMN_NAMES,
  SECTION_8_CORE_EXPECTED_IDS,
  SECTION_8_EXPECTED_IDS,
  SECTION_8_FILTER,
  SECTION_8_NEXT_DAY_EXPECTED_IDS,
  createFixtureRows,
  createServerFixtureRows,
  createServerFixtureSchema,
  serverFixtureSchema,
} from "../fixtures/admissions";

describe("server admissions fixture (extends core's shared fixture)", () => {
  it("is a valid server schema", () => {
    const r = validateSchema(serverFixtureSchema, createDefaultRegistry(), {
      physicalColumns: [...PHYSICAL_COLUMN_NAMES],
    });
    expect(r.issues).toEqual([]);
  });

  const now = () => new Date(FIXTURE_NOW);
  const nextDay = () => new Date(new Date(FIXTURE_NOW).getTime() + 86_400_000);
  const registry = createDefaultRegistry();
  const runFilter = (rows: ReturnType<typeof createFixtureRows>, at: Date) =>
    rows
      .filter((r) => matchesFilter(SECTION_8_FILTER, r, { schema: serverFixtureSchema, registry, now: at, tz: FIXTURE_TIME_ZONE }))
      .map((r) => r.id);

  it("§8 over core's UNextended r1..r5 matches exactly r2 and r3", () => {
    expect(runFilter(createFixtureRows(), now())).toEqual(SECTION_8_CORE_EXPECTED_IDS);
    expect(SECTION_8_CORE_EXPECTED_IDS).toEqual(["r2", "r3"]);
  });

  it("§8 over the extended fixture rows matches the hardcoded expectations", () => {
    expect(runFilter(createServerFixtureRows(), now())).toEqual(SECTION_8_EXPECTED_IDS);
  });

  it("§8 24h later ('yesterday' shifts a day forward)", () => {
    expect(runFilter(createServerFixtureRows(), nextDay())).toEqual(SECTION_8_NEXT_DAY_EXPECTED_IDS);
  });

  it("createServerFixtureSchema marks fee indexed and keeps core's other columns intact", () => {
    const schema = createServerFixtureSchema();
    const fee = schema.columns.find((c) => c.key === "fee");
    expect(fee?.indexed).toBe(true);
    const contact = schema.columns.find((c) => c.key === "contact");
    expect(contact?.source).toEqual({ valueField: "email_addr" });
    const activeFee = schema.columns.find((c) => c.key === "active_fee");
    expect(activeFee?.formula).toBe("IF({isActive}, {fee}, 0)");
  });
});
