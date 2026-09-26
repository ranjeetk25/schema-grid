import { describe, expect, it } from "vitest";
import { type CurrentRow, planChanges } from "../../../src/changes/plan-changes";
import { createServerContext } from "../../../src/context";
import {
  type ChangeBatch,
  type PermissionResolver,
  createDefaultRegistry,
  createRolePermissionResolver,
} from "../../../src/internal/core";
import { OPTIONS, col, makeCtx } from "../../helpers/schemas";

const schema = {
  id: "g",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("fee", "number"),
    col("email", "email"),
    col("status", "select", { config: OPTIONS }),
    col("ro", "text", { permissions: { read: "all", edit: { roles: ["admin"] } } }),
    col("balance", "formula", { formula: "{fee} * 2", config: { resultType: "number" } }),
    col("req", "text", { required: true }),
  ],
};
const ctx = makeCtx(schema, { user: { id: "u1", roles: ["counsellor"] } });
const row = (id: string, extra: Partial<CurrentRow> = {}): CurrentRow => ({
  id,
  version: 1,
  updatedAt: "2026-09-24T00:00:00.000Z",
  cells: { name: "Old", fee: 10 },
  ...extra,
});
const rows = new Map<string, CurrentRow | undefined>([
  ["r1", row("r1")],
  ["r2", row("r2", { deletedAt: "2026-09-24T00:00:00.000Z" })],
  ["r3", row("r3")],
]);
const batch = (changes: ChangeBatch["changes"], baseVersions: Record<string, number> = { r1: 1, r2: 1, r3: 1 }): ChangeBatch => ({
  id: "b1",
  changes,
  baseVersions,
  source: "edit",
});
const ch = (rowId: string, columnId: string, next: unknown) => ({ rowId, columnId, prev: "client-prev", next });

describe("planChanges", () => {
  it("plans an editable valid change with the server prev", () => {
    const p = planChanges(batch([ch("r1", "name", "New")]), rows, ctx);
    expect(p.errors).toEqual([]);
    expect(p.rowPlans).toHaveLength(1);
    expect(p.rowPlans[0]).toMatchObject({ rowId: "r1", baseVersion: 1 });
    expect(p.rowPlans[0]?.sets[0]).toMatchObject({ next: "New", serialized: "New", prev: "Old", remove: false });
  });

  it("rejects formula, read-only, invalid values, missing base version, deleted and unknown rows", () => {
    const p = planChanges(
      batch(
        [
          ch("r1", "balance", 5),
          ch("r1", "ro", "x"),
          ch("r1", "email", "not-an-email"),
          ch("r1", "fee", "abc"),
          ch("r1", "status", "bogus"),
          ch("r1", "nope", 1),
          ch("r1", "req", ""),
          ch("r2", "name", "x"),
          ch("r9", "name", "x"),
          ch("r3", "name", "x"),
        ],
        { r1: 1, r2: 1 },
      ),
      rows,
      ctx,
    );
    expect(p.rowPlans).toEqual([]);
    const msgs = Object.fromEntries(p.errors.map((e) => [`${e.rowId}.${e.columnId}`, e.message]));
    expect(msgs["r1.balance"]).toMatch(/read-only/);
    expect(msgs["r1.ro"]).toMatch(/read-only/);
    expect(msgs["r1.email"]).toBeTruthy();
    expect(msgs["r1.fee"]).toBeTruthy();
    expect(msgs["r1.status"]).toMatch(/option/i);
    expect(msgs["r1.nope"]).toBe("Unknown column");
    expect(msgs["r1.req"]).toMatch(/required/);
    expect(msgs["r2.name"]).toBe("Row not found");
    expect(msgs["r9.name"]).toBe("Row not found");
    expect(msgs["r3.name"]).toMatch(/base version/);
  });

  it("a row-dependent resolver can deny one specific row", () => {
    const base = createRolePermissionResolver();
    const resolver: PermissionResolver = (pc) => (pc.row?.id === "r3" ? "read" : base(pc));
    const rctx = createServerContext({ schema, registry: createDefaultRegistry(), resolver, user: { id: "u", roles: [] } });
    const p = planChanges(batch([ch("r1", "name", "A"), ch("r3", "name", "B")]), rows, rctx);
    expect(p.rowPlans.map((r) => r.rowId)).toEqual(["r1"]);
    expect(p.errors).toEqual([{ rowId: "r3", columnId: "name", message: "Column is read-only" }]);
  });

  it("collapses multiple changes to one cell to the last", () => {
    const p = planChanges(batch([ch("r1", "name", "A"), ch("r1", "name", "B")]), rows, ctx);
    expect(p.rowPlans[0]?.sets.map((s) => s.next)).toEqual(["B"]);
  });

  it("one row with a valid and an invalid cell plans only the valid one", () => {
    const p = planChanges(batch([ch("r1", "name", "A"), ch("r1", "fee", "abc")]), rows, ctx);
    expect(p.rowPlans[0]?.sets.map((s) => s.column.id)).toEqual(["name"]);
    expect(p.errors.map((e) => e.columnId)).toEqual(["fee"]);
  });

  it("empty values are marked for removal", () => {
    const p = planChanges(batch([ch("r1", "name", ""), ch("r1", "fee", null)]), rows, ctx);
    expect(p.rowPlans[0]?.sets.map((s) => [s.column.id, s.remove, s.next])).toEqual([
      ["name", true, null],
      ["fee", true, null],
    ]);
  });
});

describe("planChanges: ColumnDef.validation (parity with core)", () => {
  const vschema = {
    id: "v",
    schemaVersion: 1,
    columns: [
      col("score", "number", { validation: { min: 0, max: 10, message: "0 to 10 please" } }),
      col("code", "text", { validation: { pattern: "^[A-Z]{3}$" } }),
    ],
  };
  const vctx = makeCtx(vschema);
  const vrows = new Map<string, CurrentRow | undefined>([["r1", row("r1")]]);
  it("limits are applied to valueSchema and the custom message is used", () => {
    const p = planChanges(batch([ch("r1", "score", 11)], { r1: 1 }), vrows, vctx);
    expect(p.errors).toEqual([{ rowId: "r1", columnId: "score", message: "0 to 10 please" }]);
    expect(planChanges(batch([ch("r1", "score", 7)], { r1: 1 }), vrows, vctx).errors).toEqual([]);
  });
  it("pattern is enforced", () => {
    expect(planChanges(batch([ch("r1", "code", "abc")], { r1: 1 }), vrows, vctx).errors[0]?.message).toMatch(/pattern/);
    expect(planChanges(batch([ch("r1", "code", "ABC")], { r1: 1 }), vrows, vctx).errors).toEqual([]);
  });
});

describe("planChanges: option rules and meta (v0.3)", () => {
  const restricted = {
    ...schema,
    columns: schema.columns.map((c) =>
      c.id === "status"
        ? { ...c, config: { options: [{ id: "paid", label: "Paid", settableBy: { roles: ["admin"] } }, { id: "pending", label: "Pending" }] } }
        : c,
    ),
  };
  const counsellor = makeCtx(restricted, { user: { id: "u1", roles: ["counsellor"] } });
  const admin = makeCtx(restricted, { user: { id: "a1", roles: ["admin"] } });

  it("rejects an option the user cannot set, with the option message; an allowed role passes", () => {
    const b = batch([{ rowId: "r1", columnId: "status", prev: null, next: "paid" }]);
    expect(planChanges(b, rows, counsellor).errors).toEqual([
      { rowId: "r1", columnId: "status", message: "Option “Paid” can only be set by Admin" },
    ]);
    expect(planChanges(b, rows, admin).rowPlans[0]?.sets[0]?.next).toBe("paid");
    expect(planChanges(batch([{ rowId: "r1", columnId: "status", prev: null, next: "pending" }]), rows, counsellor).errors).toEqual([]);
  });

  it("does not re-check an option the row already holds", () => {
    const holding = new Map<string, CurrentRow | undefined>([["r1", row("r1", { cells: { name: "Old", fee: 10, status: "paid" } })]]);
    const plan = planChanges(batch([{ rowId: "r1", columnId: "status", prev: "paid", next: "paid" }]), holding, counsellor);
    expect(plan.errors).toEqual([]);
  });

  it("carries change meta on the planned set and never validates it", () => {
    const plan = planChanges(
      batch([{ rowId: "r1", columnId: "name", prev: "Old", next: "New", meta: { decisionMessage: "why", nested: { a: 1 } } }]),
      rows,
      ctx,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rowPlans[0]?.sets[0]?.meta).toEqual({ decisionMessage: "why", nested: { a: 1 } });
    const noMeta = planChanges(batch([{ rowId: "r1", columnId: "name", prev: "Old", next: "New" }]), rows, ctx);
    expect(noMeta.rowPlans[0]?.sets[0]).not.toHaveProperty("meta");
  });
});
