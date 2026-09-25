import { describe, expect, it, vi } from "vitest";
import type { GridQuery, GridRow } from "../../../src/internal/core";
import { decodeCursor, encodeCursor } from "../../../src/pagination/cursor";
import { buildQuery } from "../../../src/query/build-query";
import { executeQuery } from "../../../src/query/execute-query";
import { asRows, createFakeMysql } from "../../helpers/fake-mysql";
import { allTypesSchema, col, makeCtx, makeScope } from "../../helpers/schemas";

const ADMIN_ONLY = { read: { roles: ["admin"] }, edit: { roles: ["admin"] } };
const schema = allTypesSchema([col("salary", "number", { permissions: ADMIN_ONLY })]);
const COUNSELLOR = { id: "c1", roles: ["counsellor"] };
const FIELDS = ["id", "version", "updatedAt", "updatedBy", "email_addr", "cells", "__sk0", "__sn0"];

const scopeFor = (user = { id: "u1", roles: ["admin"] }) => ({ ...makeScope(makeCtx(schema, { user })), gridId: "grid_all" });

function dbRow(id: string, cells: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id,
    version: 2,
    updatedAt: "2026-09-24 10:00:00.000",
    updatedBy: "u9",
    email_addr: null,
    cells: JSON.stringify(cells),
    ...extra,
  };
}

function fakeWith(rows: Record<string, unknown>[], total?: number) {
  return createFakeMysql((call) => {
    if (!call.rowsAsArray) return undefined;
    if (/count\(\*\)/i.test(call.sql)) return [[total ?? 0]];
    return asRows(rows, FIELDS);
  });
}

const sorted = (limit: number, extra: Partial<GridQuery> = {}): GridQuery => ({
  filter: null,
  sort: [{ columnId: "fee", dir: "desc" }],
  page: { offset: 0, limit },
  ...extra,
});

describe("executeQuery", () => {
  it("hydrates and projects rows; no nextCursor when at most `limit` rows came back", async () => {
    const { db, statements } = fakeWith([
      dbRow("r1", { name: "Ann", fee: 900, callDate: "2026-09-24" }, { email_addr: "a@x.io" }),
      dbRow("r2", { name: "Bob", fee: 100 }),
    ]);
    const scope = scopeFor();
    const res = await executeQuery(buildQuery(sorted(2), scope, db), scope);
    expect(statements()).toHaveLength(1);
    expect(res.nextCursor).toBeUndefined();
    expect(res.total).toBeUndefined();
    expect(res.rows).toEqual<GridRow[]>([
      {
        id: "r1",
        version: 2,
        updatedAt: "2026-09-24T10:00:00.000Z",
        updatedBy: { id: "u9" },
        cells: { name: "Ann", fee: 900, callDate: "2026-09-24", contactEmail: "a@x.io" },
      },
      { id: "r2", version: 2, updatedAt: "2026-09-24T10:00:00.000Z", updatedBy: { id: "u9" }, cells: { name: "Bob", fee: 100 } },
    ]);
  });

  it("returns a keyset nextCursor from the last kept row when limit + 1 rows came back", async () => {
    const { db } = fakeWith([
      dbRow("r1", { fee: 900 }, { __sk0: 900, __sn0: 0 }),
      dbRow("r2", { fee: 500 }, { __sk0: 500, __sn0: 0 }),
      dbRow("r3", { fee: 100 }, { __sk0: 100, __sn0: 0 }),
    ]);
    const scope = scopeFor();
    const fp = buildQuery(sorted(2), scope, db).fingerprint;
    const cursor = encodeCursor({ v: 1, mode: "keyset", fp, keys: [1000], id: "r0" });
    const built = buildQuery(sorted(2, { page: { cursor, limit: 2 } }), scope, db);
    expect(built.pageMode).toBe("keyset");
    const res = await executeQuery(built, scope);
    expect(res.rows.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(res.nextCursor).toBeDefined();
    expect(decodeCursor(res.nextCursor as string)).toEqual({ v: 1, mode: "keyset", fp: built.fingerprint, keys: [500], id: "r2" });
  });

  it("a keyset nextCursor carries the RAW DB decimal string, and a null key when __sn0 is 1", async () => {
    const { db } = fakeWith([
      dbRow("r1", { fee: 900 }, { __sk0: "900", __sn0: 0 }),
      dbRow("r2", { fee: 1.23456789012345 }, { __sk0: "1.2345678901", __sn0: 0 }),
      dbRow("r3", {}, { __sk0: null, __sn0: 1 }),
    ]);
    const scope = scopeFor();
    const built = buildQuery(sorted(2, { page: { cursor: "", limit: 2 } }), scope, db);
    expect(built.pageMode).toBe("keyset");
    const res = await executeQuery(built, scope);
    // last kept row (limit=2) is r2: the raw DECIMAL string is preserved exactly, not parsed to a float.
    expect(decodeCursor(res.nextCursor as string)).toEqual({
      v: 1,
      mode: "keyset",
      fp: built.fingerprint,
      keys: ["1.2345678901"],
      id: "r2",
    });

    const { db: db2 } = fakeWith([dbRow("r1", { fee: 900 }, { __sk0: null, __sn0: 1 }), dbRow("r2", {}, { __sk0: null, __sn0: 1 })]);
    const built2 = buildQuery(sorted(1, { page: { cursor: "", limit: 1 } }), scope, db2);
    const res2 = await executeQuery(built2, scope);
    expect(decodeCursor(res2.nextCursor as string)).toEqual({ v: 1, mode: "keyset", fp: built2.fingerprint, keys: [null], id: "r1" });
  });

  it("returns an offset nextCursor for offset paging", async () => {
    const { db } = fakeWith([dbRow("r1", {}), dbRow("r2", {}), dbRow("r3", {})]);
    const scope = scopeFor();
    const built = buildQuery(sorted(2, { page: { offset: 10, limit: 2 } }), scope, db);
    const res = await executeQuery(built, scope);
    expect(res.rows).toHaveLength(2);
    expect(decodeCursor(res.nextCursor as string)).toEqual({ v: 1, mode: "offset", fp: built.fingerprint, offset: 12 });
  });

  it("returns an offset nextCursor in offset mode (resumed from an offset cursor)", async () => {
    const { db } = fakeWith([dbRow("r1", {}), dbRow("r2", {}), dbRow("r3", {})]);
    const scope = scopeFor();
    const first = buildQuery(sorted(2), scope, db);
    const cursor = encodeCursor({ v: 1, mode: "offset", fp: first.fingerprint, offset: 4 });
    const built = buildQuery(sorted(2, { page: { cursor, limit: 2 } }), scope, db);
    const res = await executeQuery(built, scope);
    expect(decodeCursor(res.nextCursor as string)).toEqual({ v: 1, mode: "offset", fp: built.fingerprint, offset: 6 });
  });

  it("returns total when includeTotal", async () => {
    const { db, statements } = fakeWith([dbRow("r1", { fee: 1 })], 42);
    const scope = scopeFor();
    const res = await executeQuery(buildQuery(sorted(10, { includeTotal: true }), scope, db), scope);
    expect(res.total).toBe(42);
    expect(statements()).toHaveLength(2);
  });

  it("strips hidden keys even if the DB returned them", async () => {
    const { db } = fakeWith([dbRow("r1", { name: "Ann", salary: 99999, stray: 1 })]);
    const scope = scopeFor(COUNSELLOR);
    const res = await executeQuery(buildQuery(sorted(10), scope, db), scope);
    expect(res.rows[0]?.cells).toEqual({ name: "Ann" });
  });

  it("applies transformRows before projection (formula hook point)", async () => {
    const { db } = fakeWith([dbRow("r1", { fee: 10, paid: 4 })]);
    const scope = scopeFor(COUNSELLOR);
    const transformRows = vi.fn((rows: GridRow[]) =>
      rows.map((r) => ({ ...r, cells: { ...r.cells, balance: 6, salary: 1 } })),
    );
    const res = await executeQuery(buildQuery(sorted(10), scope, db), scope, { transformRows });
    expect(transformRows).toHaveBeenCalledOnce();
    expect(res.rows[0]?.cells).toEqual({ fee: 10, paid: 4, balance: 6 });
  });
});
