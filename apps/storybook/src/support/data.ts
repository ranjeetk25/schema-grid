/**
 * Shared story data: the core admissions fixture (all 16 field types), a
 * larger generated dataset for range/fill/virtualisation stories, and an
 * instrumented in-memory data source whose calls Playwright can inspect via
 * `window.__sg`.
 */
import {
  type DataSource,
  type GridRow,
  type GridSchema,
  type PermissionUser,
  createRolePermissionResolver,
} from "@masai/schema-grid-core";
import { createDefaultRegistry } from "@masai/schema-grid-core/field-types";
import {
  type InMemoryDataSource,
  createInMemoryDataSource,
} from "@masai/schema-grid-core/memory";
import {
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
  createFixtureLinkTargets,
  createFixtureRows,
  createFixtureSchema,
} from "@masai/schema-grid-core/testing";

export {
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
  createFixtureSchema,
  createFixtureRows,
};

export const registry = createDefaultRegistry();
export const resolver = createRolePermissionResolver();

export type UserKey = "admin" | "counsellor" | "viewer";

export const USERS: Record<UserKey, PermissionUser> = {
  admin: { id: FIXTURE_USERS.admin.id, roles: [...FIXTURE_USERS.admin.roles] },
  counsellor: {
    id: FIXTURE_USERS.counsellor.id,
    roles: [...FIXTURE_USERS.counsellor.roles],
  },
  viewer: { id: "u3", roles: ["viewer"] },
};

/**
 * Fixture schema with every column restricted to admin/counsellor edit, so a
 * `viewer` gets a genuinely read-only grid (the fixture leaves most columns
 * editable by everyone).
 */
export function createPermissionMatrixSchema(): GridSchema {
  const schema = createFixtureSchema();
  return {
    ...schema,
    columns: schema.columns.map((c) =>
      c.permissions
        ? c
        : {
            ...c,
            permissions: {
              read: "all",
              edit: { roles: ["admin", "counsellor"] },
            },
          },
    ),
  };
}

/**
 * The fixture schema laid out for stories: compact widths and `name` pinned
 * left (so range selection can cross the pin boundary).
 */
export function createStorySchema(): GridSchema {
  const schema = createFixtureSchema();
  return {
    ...schema,
    columns: schema.columns.map((c) =>
      c.key === "name"
        ? { ...c, width: 170, pinned: "left" as const }
        : { ...c, width: c.type === "user" ? 190 : 140 },
    ),
  };
}

const FIRST = [
  "Aarav",
  "Bina",
  "Chetan",
  "Diya",
  "Eshan",
  "Farah",
  "Gopal",
  "Hina",
  "Ishaan",
  "Jaya",
];
const LAST = [
  "Shah",
  "Iyer",
  "Khan",
  "Menon",
  "Gill",
  "Das",
  "Roy",
  "Bose",
  "Nair",
  "Sen",
];
const STATUSES = ["paid", "pending", "partial", null] as const;

/** Fixture r1..r5 followed by `extra` generated rows x001..xNNN (deterministic; ids sort after r*). */
export function createLargeRows(extra = 60): GridRow[] {
  const rows = createFixtureRows();
  for (let i = 1; i <= extra; i++) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    rows.push({
      id: `x${String(i).padStart(3, "0")}`,
      version: 1,
      updatedAt: "2026-09-01T00:00:00.000Z",
      cells: {
        name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]} ${i}`,
        fee: 40000 + (i % 5) * 5000,
        paid: i * 100,
        status: STATUSES[i % STATUSES.length],
        tags: i % 3 === 0 ? ["referral"] : [],
        owner:
          i % 2 === 0
            ? { id: "u1", name: "Anil Admin" }
            : { id: "u2", name: "Chandra Counsellor" },
        callDate: `2026-09-${day}`,
        calledAt: null,
        isActive: i % 2 === 0,
        notes: null,
        stage: i % 4 === 0 ? "applied" : "lead",
        website: null,
        email: `student${i}@example.com`,
        phone: null,
        programs: [],
      },
    });
  }
  return rows;
}

export interface CallRecord {
  op: string;
  arg: unknown;
  at: number;
}

interface SgWindow {
  __sg?: { calls: CallRecord[]; stories: Record<string, unknown> };
}

function sgGlobal(): NonNullable<SgWindow["__sg"]> {
  const w = globalThis as unknown as SgWindow;
  if (!w.__sg) w.__sg = { calls: [], stories: {} };
  return w.__sg;
}

/** Exposes a story-scoped value to Playwright (`window.__sg.stories[name]`). */
export function exposeToTests(name: string, value: unknown): void {
  sgGlobal().stories[name] = value;
}

/** Wraps every DataSource method so calls are recorded in `window.__sg.calls`. */
export function instrument<Row extends GridRow, D extends DataSource<Row>>(
  ds: D,
): D {
  const calls = sgGlobal().calls;
  return new Proxy(ds, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") return value;
      return (...args: unknown[]) => {
        calls.push({ op: prop, arg: args[0], at: Date.now() });
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

export interface MemoryOptions {
  schema?: GridSchema;
  rows?: GridRow[];
  user?: PermissionUser;
  actorName?: string;
}

/** In-memory data source over the fixture, clock pinned to FIXTURE_NOW (Asia/Kolkata). */
export function createMemoryDataSource(
  options: MemoryOptions = {},
): InMemoryDataSource {
  const user = options.user ?? USERS.admin;
  return createInMemoryDataSource({
    schema: options.schema ?? createFixtureSchema(),
    rows: options.rows ?? createFixtureRows(),
    registry,
    resolver,
    user,
    now: () => new Date(FIXTURE_NOW),
    timeZone: FIXTURE_TIME_ZONE,
    linkTargets: createFixtureLinkTargets(),
    actor: { id: user.id, name: options.actorName ?? user.id },
  });
}
