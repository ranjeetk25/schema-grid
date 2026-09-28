/**
 * Cell colors (v0.4) against real MySQL, on BOTH data sources: hydration
 * (unreadable columns dropped), paint permissions, `colorIs` / `colorIsNone`
 * over manual + cells-rule + row-rule precedence (parity with core's in-memory
 * source), the change feed and delete cleanup.
 */
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { affectedRowsOf } from "../../src/changes/db";
import { type CellColorStore, createCellColorStore } from "../../src/colors/color-store";
import { createDrizzleDataSource } from "../../src/datasource/create-drizzle-data-source";
import { createCellColorsTableDDL } from "../../src/ddl/cell-colors-ddl";
import { FilterValidationError } from "../../src/errors";
import {
  type CellColor,
  type ColorRule,
  type ColumnDef,
  type DataSource,
  type FilterNode,
  type GridRow,
  type GridSchema,
  createRolePermissionResolver,
} from "../../src/internal/core";
import { createDefaultRegistry } from "../../src/internal/core";
import { createSqlViewDataSource } from "../../src/sqlview/create-sql-view-data-source";
import type { GridTables } from "../../src/storage/tables";
import {
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_GRID_ID,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  createServerFixtureRowPartials,
  createServerFixtureRows,
  serverFixtureSchema,
} from "../fixtures/admissions";
import { type StartedMysql, describeMysql, leadSeedFromFixture, leadsTable, setupGrid, setupLeadsTable, startMysql } from "./mysql";

const NOW = new Date(FIXTURE_NOW);
const TZ = FIXTURE_TIME_ZONE;
const COLORS_TABLE = "grid_cell_colors";
const ADMIN = { id: "u1", roles: ["admin"] };
const COUNSELLOR = { id: "u2", roles: ["counsellor"] };
type User = typeof ADMIN;

/** Manual colors painted in every scenario, by fixture row id. */
const PAINT: { row: string; columnId: string; color: CellColor }[] = [
  { row: "r1", columnId: C.name, color: "red" },
  { row: "r2", columnId: C.name, color: "green" },
  { row: "r3", columnId: C.fee, color: "gray" },
  { row: "r4", columnId: C.status, color: "blue" },
];
/** name: green when paid (cells rule); whole row gray when fee > 55000 (row rule). */
const RULES: ColorRule[] = [
  { id: "paid", color: "green", target: { kind: "cells", columnIds: [C.name] }, when: { columnId: C.status, operator: "is", value: "paid" } },
  { id: "off", color: "pink", target: { kind: "cells", columnIds: [C.name] }, when: null },
  { id: "big", color: "gray", target: { kind: "row" }, when: { columnId: C.fee, operator: "gt", value: 55000 } },
];
const COLOR_FILTERS: [string, FilterNode][] = [
  ["name is green (manual, or the paid rule where no manual color)", { columnId: C.name, operator: "colorIs", value: ["green"] }],
  ["name is red", { columnId: C.name, operator: "colorIs", value: ["red"] }],
  ["name is gray (row rule only where no manual / cells rule)", { columnId: C.name, operator: "colorIs", value: ["gray"] }],
  ["fee is gray (manual r3 or row rule)", { columnId: C.fee, operator: "colorIs", value: ["gray", "blue"] }],
  ["status has no color", { columnId: C.status, operator: "colorIsNone" }],
  ["name has no color", { columnId: C.name, operator: "colorIsNone" }],
  [
    "color OR value",
    { op: "or", children: [{ columnId: C.status, operator: "colorIs", value: ["blue"] }, { columnId: C.name, operator: "contains", value: "esha" }] },
  ],
];

interface Subject {
  label: string;
  /** Fixture row id → the source's row id. */
  id: (fixtureId: string) => string;
  schema: GridSchema;
  /** The rows as stored (in-memory reference, before painting). */
  referenceRows: () => GridRow[];
  setup: () => Promise<void>;
  source: (user: User) => DataSource<GridRow>;
  /** A column the counsellor cannot read, when the schema has one. */
  hiddenColumn?: string;
}

describeMysql("cell colors on both data sources (MySQL 8.4)", () => {
  let mysql: StartedMysql;
  let store: CellColorStore;
  let tables: GridTables;

  const resetColors = async () => {
    await mysql.db.execute(sql.raw(`DROP TABLE IF EXISTS \`${COLORS_TABLE}\``));
    await mysql.db.execute(sql.raw(createCellColorsTableDDL({ table: COLORS_TABLE }).sql));
  };

  // ---- the JSON-cells grid table (createDrizzleDataSource) ------------------------------------
  const drizzleSubject: Subject = {
    label: "createDrizzleDataSource",
    id: (id) => id,
    schema: serverFixtureSchema,
    referenceRows: () => createServerFixtureRows(),
    setup: async () => {
      tables = await setupGrid(mysql.db, serverFixtureSchema, createServerFixtureRowPartials(), { gridId: FIXTURE_GRID_ID, now: NOW });
    },
    source: (user) =>
      createDrizzleDataSource({
        db: mysql.db,
        gridId: FIXTURE_GRID_ID,
        schema: serverFixtureSchema,
        registry: createDefaultRegistry(),
        resolver: createRolePermissionResolver(),
        user,
        tz: TZ,
        now: () => NOW,
        tables,
        colors: store,
      }),
    hiddenColumn: C.notes,
  };

  // ---- a plain existing table (createSqlViewDataSource) -----------------------------------------
  const KEYS = ["name", "email", "status", "callDate", "isActive", "fee"];
  const leadsSchema: GridSchema = {
    id: "leads",
    schemaVersion: 1,
    columns: serverFixtureSchema.columns.filter((c) => KEYS.includes(c.key)).map((c): ColumnDef => (c.key === "isActive" ? { ...c, settable: false } : c)),
  };
  const leads = leadsTable;
  const DB_COLUMN: Record<string, string> = { name: "name", email: "email", status: "paymentStatus", callDate: "callDate", fee: "fee" };
  const sqlViewSubject: Subject = {
    label: "createSqlViewDataSource",
    id: (id) => id.replace(/^r/, ""),
    schema: leadsSchema,
    referenceRows: () =>
      createServerFixtureRows().map((r) => ({
        id: r.id.replace(/^r/, ""),
        version: 1,
        updatedAt: r.updatedAt,
        cells: Object.fromEntries(KEYS.filter((k) => r.cells[k] !== undefined).map((k) => [k, r.cells[k]])),
      })),
    setup: async () => {
      const seeds = createServerFixtureRows().map((r, i) => leadSeedFromFixture(r, new Date(Date.parse("2026-09-20T00:00:00.000Z") + i * 1000)));
      await setupLeadsTable(mysql.db, seeds);
    },
    source: (user) =>
      createSqlViewDataSource({
        db: mysql.db,
        schema: leadsSchema,
        resolver: createRolePermissionResolver(),
        user,
        tz: TZ,
        now: () => NOW,
        baseQuery: (ctx) => ctx.db.select().from(leads),
        columns: {
          name: { expr: leads.name },
          email: { expr: leads.email },
          status: { expr: leads.paymentStatus },
          callDate: { expr: leads.callDate },
          isActive: { expr: leads.aiVerified },
          fee: { expr: leads.fee },
        },
        rowId: leads.id,
        version: leads.version,
        updatedAt: leads.updatedAt,
        colors: store,
        write: {
          async update(ctx, { rowId, changes, baseVersion }) {
            const set: Record<string, unknown> = { version: sql`${leads.version} + 1`, updatedAt: sql`NOW(3)` };
            for (const c of changes) {
              const key = ctx.schema.columns.find((x) => x.id === c.columnId)?.key ?? "";
              set[DB_COLUMN[key] as string] = c.next === null ? null : key === "fee" ? String(c.next) : c.next;
            }
            const res = await ctx.db
              .update(leads)
              .set(set as never)
              .where(and(eq(leads.id, Number(rowId)), eq(leads.version, baseVersion)));
            return affectedRowsOf(res) === 0 ? { applied: [] } : { applied: changes, version: baseVersion + 1 };
          },
          async delete(ctx, ids) {
            for (const id of ids) await ctx.db.delete(leads).where(eq(leads.id, Number(id)));
          },
        },
      }),
  };

  beforeAll(async () => {
    mysql = await startMysql();
    store = createCellColorStore({ db: mysql.db, table: COLORS_TABLE });
  }, 180_000);
  afterAll(async () => {
    await mysql?.stop();
  });

  for (const subject of [drizzleSubject, sqlViewSubject]) {
    describe(subject.label, () => {
      const rid = subject.id;
      const all = async (ds: DataSource<GridRow>, filter: FilterNode | null = null, colorRules?: ColorRule[]) =>
        (await ds.fetch({ filter, sort: [], page: { offset: 0, limit: 1000 }, ...(colorRules ? { colorRules } : {}) })).rows;
      const paint = (ds: DataSource<GridRow>) =>
        ds.setCellColors?.({ id: "paint", changes: PAINT.map((p) => ({ rowId: rid(p.row), columnId: p.columnId, color: p.color })) });
      /** The in-memory reference over the same stored rows + manual colors. */
      const referenceIds = async (filter: FilterNode, rules: ColorRule[]) => {
        const rows = subject.referenceRows().map((r) => {
          const colors = Object.fromEntries(PAINT.filter((p) => rid(p.row) === r.id).map((p) => [p.columnId, p.color]));
          return Object.keys(colors).length > 0 ? { ...r, colors } : r;
        });
        const ref = createInMemoryDataSource<GridRow>({
          schema: subject.schema,
          rows,
          resolver: createRolePermissionResolver(),
          user: ADMIN,
          now: () => NOW,
          timeZone: TZ,
        });
        return (await ref.fetch({ filter, sort: [], page: { offset: 0, limit: 1000 }, colorRules: rules })).rows.map((r) => r.id).sort();
      };

      beforeEach(async () => {
        await subject.setup();
        await resetColors();
      });

      it("paints, hydrates colors (readable columns only) and never bumps versions", async () => {
        const admin = subject.source(ADMIN);
        const before = await all(admin);
        const res = await paint(admin);
        expect(res?.rejected).toEqual([]);
        expect(res?.applied).toHaveLength(PAINT.length);
        expect(res?.rows?.find((r) => r.id === rid("r1"))?.colors).toEqual({ [C.name]: "red" });
        const after = await all(admin);
        for (const r of after) expect(r.version).toBe(before.find((b) => b.id === r.id)?.version);
        expect(after.find((r) => r.id === rid("r4"))?.colors).toEqual({ [C.status]: "blue" });
        expect(after.find((r) => r.id === rid("r5"))).not.toHaveProperty("colors");
        expect((await admin.getRows?.([rid("r3")]))?.[0]?.colors).toEqual({ [C.fee]: "gray" });

        if (subject.hiddenColumn) {
          await admin.setCellColors?.({ id: "h", changes: [{ rowId: rid("r1"), columnId: subject.hiddenColumn, color: "purple" }] });
          const counsellorRow = (await all(subject.source(COUNSELLOR))).find((r) => r.id === rid("r1"));
          expect(counsellorRow?.colors).toEqual({ [C.name]: "red" });
          expect((await all(admin)).find((r) => r.id === rid("r1"))?.colors).toEqual({ [C.name]: "red", [subject.hiddenColumn]: "purple" });
        }

        // Clearing the last color leaves no `colors` key.
        await admin.setCellColors?.({ id: "clr", changes: [{ rowId: rid("r4"), columnId: C.status, color: null }] });
        expect((await all(admin)).find((r) => r.id === rid("r4"))).not.toHaveProperty("colors");
      });

      it("paint permissions follow edit access (fee is admin-only)", async () => {
        const counsellor = subject.source(COUNSELLOR);
        const res = await counsellor.setCellColors?.({
          id: "c",
          changes: [
            { rowId: rid("r2"), columnId: C.fee, color: "red" },
            { rowId: rid("r2"), columnId: C.status, color: "teal" },
            { rowId: rid("r99"), columnId: C.status, color: "teal" },
          ],
        });
        expect(res?.applied).toEqual([{ rowId: rid("r2"), columnId: C.status, color: "teal" }]);
        expect(res?.rejected).toEqual([
          { rowId: rid("r2"), columnId: C.fee, message: "Read-only" },
          { rowId: rid("r99"), columnId: C.status, message: "Row not found" },
        ]);
      });

      it.each(COLOR_FILTERS)("colorIs / colorIsNone parity with core: %s", async (_name, filter) => {
        const admin = subject.source(ADMIN);
        await paint(admin);
        const got = (await all(admin, filter, RULES)).map((r) => r.id).sort();
        expect(got).toEqual(await referenceIds(filter, RULES));
      });

      it("precedence spelled out: manual > cells rule > row rule", async () => {
        const admin = subject.source(ADMIN);
        await paint(admin);
        const nameIs = async (color: CellColor) =>
          (await all(admin, { columnId: C.name, operator: "colorIs", value: [color] }, RULES)).map((r) => r.id).sort();
        expect(await nameIs("red")).toEqual([rid("r1")]); // manual beats the "paid" rule on r1
        expect(await nameIs("green")).toEqual([rid("r2"), rid("r5")].sort()); // manual r2 + rule r5 (paid; beats row rule)
        expect(await nameIs("gray")).toEqual([]); // r2 / r5 are gray rows but their name shows something else
        // Rules-only when the view has no rules → manual colors only.
        expect((await all(admin, { columnId: C.name, operator: "colorIs", value: ["green"] })).map((r) => r.id)).toEqual([rid("r2")]);
      });

      it("invalid rules are a 400 filter error, only when a color condition is present", async () => {
        const counsellor = subject.source(COUNSELLOR);
        const bad = [{ id: "x", color: "red", target: { kind: "cells", columnIds: ["nope"] }, when: null }] as ColorRule[];
        await expect(all(counsellor, null, bad)).resolves.toBeDefined();
        await expect(all(counsellor, { columnId: C.name, operator: "colorIsNone" }, bad)).rejects.toBeInstanceOf(FilterValidationError);
      });

      it("the change feed picks up color-only writes, once per row", async () => {
        const admin = subject.source(ADMIN);
        const start = (await admin.getChanges?.(""))?.cursor as string;
        // A tick later than any seeded updated_at (the SQL view feed is time-based).
        await new Promise((resolve) => setTimeout(resolve, 5));
        await admin.setCellColors?.({
          id: "f",
          changes: [
            { rowId: rid("r6"), columnId: C.name, color: "orange" },
            { rowId: rid("r6"), columnId: C.status, color: "yellow" },
          ],
        });
        const feed = await admin.getChanges?.(start);
        const r6 = feed?.rows.filter((r) => r.id === rid("r6")) ?? [];
        expect(r6).toHaveLength(1);
        expect(r6[0]?.colors).toEqual({ [C.name]: "orange", [C.status]: "yellow" });
        expect(feed?.cursor).not.toBe(start);
        expect((await admin.getChanges?.(feed?.cursor as string))?.rows.map((r) => r.id)).not.toContain(rid("r6"));
      });

      it("deleting a row deletes its color entry", async () => {
        const admin = subject.source(ADMIN);
        await paint(admin);
        await admin.deleteRows([rid("r1")]);
        const [rows] = (await mysql.db.execute(
          sql`SELECT row_id FROM ${sql.raw(`\`${COLORS_TABLE}\``)} WHERE row_id IN (${rid("r1")}, ${rid("r2")})`,
        )) as unknown as [{ row_id: string }[]];
        expect(rows.map((r) => r.row_id)).toEqual([rid("r2")]);
      });
    });
  }
});
