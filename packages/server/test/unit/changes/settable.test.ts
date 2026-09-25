/** v0.2 C1: `settable: false` columns cannot be written by applyChanges / createRows. */
import { describe, expect, it } from "vitest";
import { type CurrentRow, planChanges } from "../../../src/changes/plan-changes";
import { createRows } from "../../../src/changes/rows-crud";
import { RowValidationError } from "../../../src/errors";
import type { ChangeBatch } from "../../../src/internal/core";
import { createFakeMysql } from "../../helpers/fake-mysql";
import { col, makeCtx, tables } from "../../helpers/schemas";

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("aiVerified", "text", { settable: false }),
    col("score", "number", { settable: false, defaultValue: 7 }),
    col("secret", "text", { settable: false, permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } } }),
  ],
};
const NOW = new Date("2026-09-26T06:00:00.000Z");
const ctx = makeCtx(schema, { user: { id: "u1", roles: ["counsellor"] }, now: NOW });
const admin = makeCtx(schema, { user: { id: "a1", roles: ["admin"] }, now: NOW });

const current = (id: string): CurrentRow => ({ id, version: 1, updatedAt: "2026-09-24T00:00:00.000Z", cells: { name: "Old" } });
const rows = new Map<string, CurrentRow | undefined>([["r1", current("r1")]]);
const batch = (changes: ChangeBatch["changes"]): ChangeBatch => ({ id: "b1", changes, baseVersions: { r1: 1 }, source: "edit" });
const ch = (columnId: string, next: unknown) => ({ rowId: "r1", columnId, prev: null, next });

describe("planChanges: settable:false", () => {
  it("rejects a write to a settable:false column as read-only; other cells still plan", () => {
    const p = planChanges(batch([ch("name", "New"), ch("aiVerified", "yes")]), rows, ctx);
    expect(p.errors).toEqual([{ rowId: "r1", columnId: "aiVerified", message: "Column is read-only" }]);
    expect(p.rowPlans[0]?.sets.map((s) => s.column.id)).toEqual(["name"]);
  });

  it("rejects it even for a user whose permission is edit", () => {
    const p = planChanges(batch([ch("secret", "x"), ch("score", 3)]), rows, admin);
    expect(p.errors).toEqual([
      { rowId: "r1", columnId: "secret", message: "Column is read-only" },
      { rowId: "r1", columnId: "score", message: "Column is read-only" },
    ]);
    expect(p.rowPlans).toEqual([]);
  });

  it("a hidden settable:false column still reads as an unknown column (not detectable)", () => {
    const p = planChanges(batch([ch("secret", "x")]), rows, ctx);
    expect(p.errors).toEqual([{ rowId: "r1", columnId: "secret", message: "Unknown column" }]);
  });
});

describe("createRows: settable:false", () => {
  it("an explicit value for a settable:false column throws RowValidationError (read-only) before writing", async () => {
    const { db, calls } = createFakeMysql();
    const err = await createRows([{ cells: { name: "A", aiVerified: "yes" } }], admin, { db, tables, gridId: "grid1" }).catch((e) => e);
    expect(err).toBeInstanceOf(RowValidationError);
    expect(err.details).toMatchObject({ rowIndex: 0, columnId: "aiVerified", message: "Column is read-only" });
    expect(calls).toHaveLength(0);
  });

  it("defaults of settable:false columns are still written when no value is given", async () => {
    const { db } = createFakeMysql();
    const [created] = await createRows([{ cells: { name: "A" } }], admin, { db, tables, gridId: "grid1" }, { generateId: () => "n1" });
    expect(created?.cells).toMatchObject({ name: "A", score: 7 });
  });
});
