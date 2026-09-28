import { describe, expect, it } from "vitest";
import type { GridDb } from "../../../src/changes/db";
import { createCellColorStore } from "../../../src/colors/color-store";
import { createDrizzleDataSource, type DrizzleDataSourceOptions } from "../../../src/datasource/create-drizzle-data-source";
import { FilterValidationError, SchemaGridServerError } from "../../../src/errors";
import { type ColorRule, createDefaultRegistry, createRolePermissionResolver } from "../../../src/internal/core";
import { type FakeCall, asRows, createFakeMysql } from "../../helpers/fake-mysql";
import { tables } from "../../helpers/schemas";
import { FIXTURE_COLUMN_IDS, FIXTURE_NOW, serverFixtureSchema } from "../../fixtures/admissions";

const ROW_ORDER = ["id", "gridId", "version", "updatedAt", "updatedBy", "deletedAt", "cells", "email_addr"];
const FETCH_ORDER = ["id", "version", "updatedAt", "updatedBy", "email_addr", "cells", "sg_colors"];
const C = FIXTURE_COLUMN_IDS;
const key = (id: string) => serverFixtureSchema.columns.find((c) => c.id === id)?.key as string;

type State = { rows: Record<string, Record<string, unknown>>; colors: Record<string, unknown> };
const dbRow = (id: string, cells: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  gridId: "admissions",
  version: 1,
  updatedAt: "2026-09-24 10:00:00.000",
  updatedBy: "u9",
  deletedAt: null,
  cells,
  email_addr: null,
  ...extra,
});
const freshState = (): State => ({
  rows: {
    r1: dbRow("r1", { name: "Asha", fee: 100, paid: 40 }),
    r2: dbRow("r2", { name: "Bhavesh", fee: 300, paid: 0 }),
    r9: dbRow("r9", { name: "Deleted" }, { deletedAt: "2026-09-24 11:00:00.000" }),
  },
  colors: {
    r1: { [C.name]: "red", [C.notes]: "blue", [C.fee]: "not-a-color" },
    r2: JSON.stringify({ [C.fee]: "green" }),
  },
});

/** Selects answer from `state` (rows table, the colors table and the row query with its colors subquery). */
const script = (state: State) => (c: FakeCall) => {
  if (!c.rowsAsArray || !c.sql.startsWith("select")) return undefined;
  if (c.sql.startsWith("select `row_id`, `colors` from `grid_cell_colors`")) {
    const ids = c.params.filter((p): p is string => typeof p === "string" && p in state.colors);
    return ids.map((id) => [id, state.colors[id]]);
  }
  const ids = c.params.filter((p): p is string => typeof p === "string" && p in state.rows);
  if (c.sql.includes("`sg_colors`")) {
    return asRows(
      Object.values(state.rows)
        .filter((r) => !r.deletedAt)
        .map((r) => ({ ...r, sg_colors: state.colors[r.id as string] ?? null })),
      FETCH_ORDER,
    );
  }
  return asRows(ids.map((id) => state.rows[id] as Record<string, unknown>), ROW_ORDER);
};

function make(extra: Partial<DrizzleDataSourceOptions> = {}, roles = ["counsellor"], withStore = true) {
  const state = freshState();
  const fake = createFakeMysql(script(state));
  const db = fake.db as unknown as GridDb;
  const colors = createCellColorStore({ db, table: "grid_cell_colors" });
  const ds = createDrizzleDataSource({
    db,
    gridId: "admissions",
    schema: serverFixtureSchema,
    registry: createDefaultRegistry(),
    resolver: createRolePermissionResolver(),
    user: { id: "u1", roles },
    now: () => new Date(FIXTURE_NOW),
    tables,
    ...(withStore ? { colors } : {}),
    ...extra,
  });
  return { ds, state, ...fake };
}

describe("createDrizzleDataSource: cell colors (v0.4)", () => {
  it("capabilities: filter always; read / write and setCellColors only with a store", async () => {
    const bare = make({}, ["counsellor"], false).ds;
    expect(await bare.capabilities?.()).toMatchObject({ cellColors: { read: false, write: false, filter: true } });
    expect(bare.setCellColors).toBeUndefined();
    const { ds } = make();
    expect(await ds.capabilities?.()).toMatchObject({ cellColors: { read: true, write: true, filter: true } });
    expect(typeof ds.setCellColors).toBe("function");
  });

  it("fetch reads colors through a correlated lookup and hydrates readable, valid ones only", async () => {
    const { ds, statements } = make();
    const res = await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 10 } });
    expect(statements()[0]?.sql).toContain(
      "(select `sg_colors`.`colors` from `grid_cell_colors` as `sg_colors` where `sg_colors`.`grid_id` = ? and `sg_colors`.`row_id` = CONVERT(`grid_rows`.`id` USING utf8mb4) COLLATE utf8mb4_bin)",
    );
    const [r1, r2] = res.rows;
    // notes is hidden from counsellors; "not-a-color" is dropped; a JSON string document parses.
    expect(r1?.colors).toEqual({ [C.name]: "red" });
    expect(r2?.colors).toEqual({ [C.fee]: "green" });
    const admin = await make({}, ["admin"]).ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 10 } });
    expect(admin.rows[0]?.colors).toEqual({ [C.name]: "red", [C.notes]: "blue" });
  });

  it("rows without colors carry no `colors` key; without a store nothing is selected", async () => {
    const { ds, state, statements } = make({}, ["counsellor"], false);
    state.colors = {};
    const res = await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 10 } });
    expect(statements()[0]?.sql).not.toContain("grid_cell_colors");
    expect(res.rows.every((r) => !("colors" in r))).toBe(true);
  });

  it("colorIs compiles the shown color; color rules are validated only when a color condition is present", async () => {
    const { ds, statements } = make();
    const rules: ColorRule[] = [
      { id: "r1", color: "green", target: { kind: "cells", columnIds: [C.name] }, when: { columnId: C.status, operator: "is", value: "paid" } },
    ];
    await ds.fetch({ filter: { columnId: C.name, operator: "colorIs", value: ["green"] }, sort: [], page: { offset: 0, limit: 10 }, colorRules: rules });
    const q = statements()[0] as FakeCall;
    expect(q.sql).toContain("COALESCE(JSON_UNQUOTE(JSON_EXTRACT((select `sg_colors`.`colors`");
    expect(q.sql).toContain("THEN 'green' END)");
    expect(q.params).toContain(`$."${C.name}"`);

    const bad = [{ id: "x", color: "red", target: { kind: "cells", columnIds: [C.notes] }, when: null }] as ColorRule[];
    // Ignored without a color condition…
    await expect(ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 10 }, colorRules: bad })).resolves.toBeDefined();
    const before = statements().length;
    // …rejected (400 INVALID_FILTER) before any SQL with one: notes is unreadable for counsellors.
    const err = await ds
      .fetch({ filter: { columnId: C.name, operator: "colorIsNone" }, sort: [], page: { offset: 0, limit: 10 }, colorRules: bad })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FilterValidationError);
    expect((err as FilterValidationError).errors[0]).toMatchObject({ code: "unreadableColumn", ruleIndex: 0 });
    expect(statements()).toHaveLength(before);
  });

  it("setCellColors: per-change checks like the in-memory source, one upsert per row, one transaction", async () => {
    const { ds, calls, statements } = make();
    const res = await ds.setCellColors?.({
      id: "p1",
      changes: [
        { rowId: "r1", columnId: C.name, color: "yellow" },
        { rowId: "r1", columnId: C.phone, color: null },
        { rowId: "r1", columnId: C.fee, color: "red" }, // counsellors cannot edit fee
        { rowId: "r1", columnId: C.balance, color: "red" }, // formula
        { rowId: "r1", columnId: C.notes, color: "red" }, // hidden → like unknown
        { rowId: "r1", columnId: "nope", color: "red" },
        { rowId: "r2", columnId: C.name, color: "magenta" as never },
        { rowId: "r9", columnId: C.name, color: "red" }, // soft-deleted
        { rowId: "zz", columnId: C.name, color: "red" },
      ],
    });
    expect(res?.applied).toEqual([
      { rowId: "r1", columnId: C.name, color: "yellow" },
      { rowId: "r1", columnId: C.phone, color: null },
    ]);
    expect(res?.rejected).toEqual([
      { rowId: "r1", columnId: C.fee, message: "Read-only" },
      { rowId: "r1", columnId: C.balance, message: "Read-only" },
      { rowId: "r1", columnId: C.notes, message: "Column not found" },
      { rowId: "r1", columnId: "nope", message: "Column not found" },
      { rowId: "r2", columnId: C.name, message: "Invalid color" },
      { rowId: "r9", columnId: C.name, message: "Row not found" },
      { rowId: "zz", columnId: C.name, message: "Row not found" },
    ]);
    const sqls = calls.map((c) => c.sql.toLowerCase());
    expect(sqls[0]).toBe("begin");
    expect(sqls.at(-1)).toBe("commit");
    const upserts = statements().filter((s) => s.sql.startsWith("insert into `grid_cell_colors`"));
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.sql).toContain(
      "on duplicate key update `colors` = JSON_REMOVE(JSON_SET(COALESCE(`colors`, JSON_OBJECT()), ?, ?), ?), `updated_at` = ?, `updated_by` = ?",
    );
    expect(upserts[0]?.params).toEqual(
      expect.arrayContaining(["admissions", "r1", JSON.stringify({ [C.name]: "yellow" }), `$."${C.name}"`, "yellow", `$."${C.phone}"`, "u1"]),
    );
    // The change feed learns about it through change_log (kind "color"), rows keep their version.
    const log = statements().find((s) => s.sql.startsWith("insert into `grid_change_log`"));
    expect(log?.params).toEqual(expect.arrayContaining(["r1", C.name, "color", '"yellow"', C.phone]));
    expect(statements().some((s) => s.sql.startsWith("update `grid_rows`"))).toBe(false);
    expect(res?.rows?.map((r) => r.id)).toEqual(["r1"]);
    expect(res?.rows?.[0]?.version).toBe(1);
  });

  it("setCellColors: nothing applicable → no writes; a bad batch id → INVALID_BATCH", async () => {
    const { ds, statements } = make();
    const res = await ds.setCellColors?.({ id: "p2", changes: [{ rowId: "zz", columnId: C.name, color: "red" }] });
    expect(res).toEqual({ applied: [], rejected: [{ rowId: "zz", columnId: C.name, message: "Row not found" }], rows: [] });
    expect(statements().some((s) => s.sql.startsWith("insert"))).toBe(false);
    await expect(ds.setCellColors?.({ id: "", changes: [] })).rejects.toMatchObject({ code: "INVALID_BATCH" });
    await expect(ds.setCellColors?.({ id: "", changes: [] })).rejects.toBeInstanceOf(SchemaGridServerError);
  });

  it("getRows / applyChanges rows carry colors (one extra lookup); deleteRows removes the color entries", async () => {
    const { ds, statements } = make();
    const rows = await ds.getRows?.(["r2", "r1"]);
    expect(rows?.map((r) => r.colors)).toEqual([{ [C.fee]: "green" }, { [C.name]: "red" }]);
    expect(statements()[1]?.sql).toBe(
      "select `row_id`, `colors` from `grid_cell_colors` where (`grid_cell_colors`.`grid_id` = ? and `grid_cell_colors`.`row_id` in (?, ?))",
    );
    await ds.deleteRows(["r1"]);
    const del = statements().find((s) => s.sql.startsWith("delete from `grid_cell_colors`"));
    expect(del?.sql).toBe(
      "delete from `grid_cell_colors` where (`grid_cell_colors`.`grid_id` = ? and `grid_cell_colors`.`row_id` in (?))",
    );
    expect(del?.params).toEqual(["admissions", "r1"]);
    expect(key(C.name)).toBe("name");
  });
});
