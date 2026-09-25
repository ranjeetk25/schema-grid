import type { LinkRef } from "../common/types";
import type { GridRow } from "../rows/types";

const TS = "2026-09-01T00:00:00.000Z";

function row(id: string, cells: Record<string, unknown>): GridRow {
  return { id, version: 1, updatedAt: TS, cells };
}

/**
 * Fixture rows (cells keyed by column key; `balance` is NOT materialised).
 * With FIXTURE_NOW in Asia/Kolkata, "yesterday" is 2026-09-24:
 * the spec §8 filter (status isNot paid AND callDate isWithin yesterday)
 * matches exactly r2 (Pending) and r3 (empty status).
 */
export function createFixtureRows(): GridRow[] {
  return [
    row("r1", {
      name: "Asha Verma",
      fee: 50000,
      paid: 20000,
      status: "paid",
      tags: ["scholar"],
      owner: { id: "u1", name: "Anil Admin" },
      callDate: "2026-09-24",
      calledAt: "2026-09-24T05:00:00.000Z",
      isActive: true,
      notes: "VIP applicant",
      stage: "applied",
      website: "https://asha.dev",
      email: "asha@example.com",
      phone: "+919876543210",
      programs: [{ id: "p1", label: "Full Stack" }],
    }),
    row("r2", {
      name: "Bhavesh Rao",
      fee: 60000,
      paid: 60000,
      status: "pending",
      tags: [],
      owner: { id: "u2", name: "Chandra Counsellor" },
      callDate: "2026-09-24",
      calledAt: "2026-09-24T12:15:00.000Z",
      isActive: false,
      notes: null,
      stage: "lead",
      website: null,
      email: "bhavesh@example.com",
      phone: null,
      programs: [],
    }),
    row("r3", {
      name: "Chitra Nair",
      fee: 45000,
      paid: null,
      status: null,
      tags: ["scholar", "referral"],
      owner: null,
      callDate: "2026-09-24",
      calledAt: "2026-09-23T18:30:00.000Z",
      isActive: true,
      notes: "Asked about EMI",
      stage: null,
      website: null,
      email: null,
      phone: "+14155550100",
      programs: [{ id: "p2", label: "Data Analytics" }],
    }),
    row("r4", {
      name: "Dev Patel",
      fee: null,
      paid: 0,
      status: "partial",
      tags: ["referral"],
      owner: { id: "u1", name: "Anil Admin" },
      callDate: "2026-09-20",
      calledAt: "2026-09-20T09:00:00.000Z",
      isActive: true,
      notes: null,
      stage: "lead",
      website: "https://dev.example.org",
      email: null,
      phone: null,
      programs: [],
    }),
    row("r5", {
      name: "Esha Singh",
      fee: 70000,
      paid: 10000,
      status: "paid",
      tags: ["vip"],
      owner: { id: "u2", name: "Chandra Counsellor" },
      callDate: null,
      calledAt: null,
      isActive: false,
      notes: null,
      stage: null,
      website: null,
      email: "esha@example.com",
      phone: null,
      programs: [
        { id: "p1", label: "Full Stack" },
        { id: "p2", label: "Data Analytics" },
      ],
    }),
  ];
}

export const fixtureRows: readonly GridRow[] = createFixtureRows();

/** Link targets for the `programs` link column, keyed by column id. */
export function createFixtureLinkTargets(): Record<string, LinkRef[]> {
  return {
    col_programs: [
      { id: "p1", label: "Full Stack" },
      { id: "p2", label: "Data Analytics" },
      { id: "p3", label: "Product Management" },
    ],
  };
}
