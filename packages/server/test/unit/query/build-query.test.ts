import { describe, expect, it, vi } from "vitest";
import { CursorError, FilterValidationError, PermissionError } from "../../../src/errors";
import type { GridQuery } from "../../../src/internal/core";
import { encodeCursor, queryFingerprint } from "../../../src/pagination/cursor";
import { buildQuery } from "../../../src/query/build-query";
import { allTypesSchema, col, makeCtx, makeScope } from "../../helpers/schemas";
import { mockDb, renderQuery } from "../../helpers/sql";

const NOW = new Date("2026-09-25T00:30:00+05:30");
const TZ = "Asia/Kolkata";
const ADMIN_ONLY = { read: { roles: ["admin"] }, edit: { roles: ["admin"] } };
const schema = allTypesSchema([col("salary", "number", { permissions: ADMIN_ONLY })]);
const COUNSELLOR = { id: "c1", roles: ["counsellor"] };

const scopeFor = (user = { id: "u1", roles: ["admin"] }) => ({
  ...makeScope(makeCtx(schema, { now: NOW, tz: TZ, user })),
  gridId: "grid_all",
});

const SECTION_8: GridQuery = {
  filter: {
    op: "and",
    children: [
      { columnId: "paymentStatus", operator: "isNot", value: "paid" },
      { columnId: "callDate", operator: "isWithin", value: { relative: "yesterday" } },
    ],
  },
  sort: [],
  page: { offset: 0, limit: 10 },
};

describe("buildQuery", () => {
  it("§8 filter with offset paging", () => {
    const built = buildQuery(SECTION_8, scopeFor(), mockDb());
    const q = renderQuery(built.select);
    expect(q.sql).toMatchInlineSnapshot(`"select \`id\`, \`version\`, \`updated_at\`, \`updated_by\`, \`email_addr\`, JSON_OBJECT('name', JSON_EXTRACT(\`cells\`, '$.name'), 'notes', JSON_EXTRACT(\`cells\`, '$.notes'), 'site', JSON_EXTRACT(\`cells\`, '$.site'), 'email', JSON_EXTRACT(\`cells\`, '$.email'), 'phone', JSON_EXTRACT(\`cells\`, '$.phone'), 'fee', JSON_EXTRACT(\`cells\`, '$.fee'), 'paid', JSON_EXTRACT(\`cells\`, '$.paid'), 'isActive', JSON_EXTRACT(\`cells\`, '$.isActive'), 'callDate', JSON_EXTRACT(\`cells\`, '$.callDate'), 'calledAt', JSON_EXTRACT(\`cells\`, '$.calledAt'), 'paymentStatus', JSON_EXTRACT(\`cells\`, '$.paymentStatus'), 'source', JSON_EXTRACT(\`cells\`, '$.source'), 'tags', JSON_EXTRACT(\`cells\`, '$.tags'), 'owner', JSON_EXTRACT(\`cells\`, '$.owner'), 'links', JSON_EXTRACT(\`cells\`, '$.links'), 'indexedFee', JSON_EXTRACT(\`cells\`, '$.indexedFee'), 'salary', JSON_EXTRACT(\`cells\`, '$.salary')) from \`grid_rows\` where (\`grid_rows\`.\`grid_id\` = ? and \`grid_rows\`.\`deleted_at\` is null and ((IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci <> ? OR (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci = '')) AND (CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) >= ? AND CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) < ? AND NOT (CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) IS NULL)))) order by \`id\` ASC limit ?"`);
    // drizzle omits `offset` when it is 0: params are grid id, filter params, limit + 1.
    expect(q.params).toEqual(["grid_all", "paid", "2026-09-24", "2026-09-25", 11]);
    expect(q.sql).toContain("<> ? OR");
    const page3 = renderQuery(buildQuery({ ...SECTION_8, page: { offset: 20, limit: 10 } }, scopeFor(), mockDb()).select);
    expect(page3.params).toEqual(["grid_all", "paid", "2026-09-24", "2026-09-25", 11, 20]);
    expect(page3.sql.endsWith("limit ? offset ?")).toBe(true);
    expect(built.pageMode).toBe("offset");
    expect(built.limit).toBe(10);
    expect(built.offset).toBe(0);
    expect(built.count).toBeUndefined();
    expect(built.fingerprint).toBe(queryFingerprint(SECTION_8, schema.schemaVersion));
  });

  it("search + sort + keyset cursor", () => {
    const base: GridQuery = {
      filter: null,
      sort: [
        { columnId: "fee", dir: "desc" },
        { columnId: "name", dir: "asc" },
      ],
      search: "ann",
      page: { offset: 0, limit: 25 },
    };
    const scope = scopeFor();
    const first = buildQuery(base, scope, mockDb());
    const cursor = encodeCursor({ v: 1, mode: "keyset", fp: first.fingerprint, keys: [500, "Anna"], id: "r9" });

    const built = buildQuery({ ...base, page: { cursor, limit: 25 } }, scope, mockDb());
    const q = renderQuery(built.select);
    expect(q.sql).toMatchInlineSnapshot(`"select \`id\`, \`version\`, \`updated_at\`, \`updated_by\`, \`email_addr\`, JSON_OBJECT('name', JSON_EXTRACT(\`cells\`, '$.name'), 'notes', JSON_EXTRACT(\`cells\`, '$.notes'), 'site', JSON_EXTRACT(\`cells\`, '$.site'), 'email', JSON_EXTRACT(\`cells\`, '$.email'), 'phone', JSON_EXTRACT(\`cells\`, '$.phone'), 'fee', JSON_EXTRACT(\`cells\`, '$.fee'), 'paid', JSON_EXTRACT(\`cells\`, '$.paid'), 'isActive', JSON_EXTRACT(\`cells\`, '$.isActive'), 'callDate', JSON_EXTRACT(\`cells\`, '$.callDate'), 'calledAt', JSON_EXTRACT(\`cells\`, '$.calledAt'), 'paymentStatus', JSON_EXTRACT(\`cells\`, '$.paymentStatus'), 'source', JSON_EXTRACT(\`cells\`, '$.source'), 'tags', JSON_EXTRACT(\`cells\`, '$.tags'), 'owner', JSON_EXTRACT(\`cells\`, '$.owner'), 'links', JSON_EXTRACT(\`cells\`, '$.links'), 'indexedFee', JSON_EXTRACT(\`cells\`, '$.indexedFee'), 'salary', JSON_EXTRACT(\`cells\`, '$.salary')), (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN NULL ELSE (CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) END), (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END), (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci = '') THEN NULL ELSE IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci END), (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci = '') THEN 1 ELSE 0 END) from \`grid_rows\` where (\`grid_rows\`.\`grid_id\` = ? and \`grid_rows\`.\`deleted_at\` is null and (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci LIKE ? ESCAPE '!' OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.notes')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.notes'))) COLLATE utf8mb4_0900_ai_ci LIKE ? ESCAPE '!' OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.site')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.site'))) COLLATE utf8mb4_0900_ai_ci LIKE ? ESCAPE '!' OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.email')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.email'))) COLLATE utf8mb4_0900_ai_ci LIKE ? ESCAPE '!' OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.phone')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.phone'))) COLLATE utf8mb4_0900_ai_ci LIKE ? ESCAPE '!' OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci LIKE ? ESCAPE '!' OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.source')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.source'))) COLLATE utf8mb4_0900_ai_ci LIKE ? ESCAPE '!' OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.owner.id')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.owner.id'))) COLLATE utf8mb4_0900_ai_ci LIKE ? ESCAPE '!' OR \`email_addr\` LIKE ? ESCAPE '!') and ((((CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END) = 1 OR (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN NULL ELSE (CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) END) < ?)) OR (((CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END) = 0 AND (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN NULL ELSE (CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) END) = ?) AND ((CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci = '') THEN 1 ELSE 0 END) = 1 OR (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci = '') THEN NULL ELSE IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci END) > ?)) OR (((CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END) = 0 AND (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN NULL ELSE (CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) END) = ?) AND ((CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci = '') THEN 1 ELSE 0 END) = 0 AND (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci = '') THEN NULL ELSE IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci END) = ?) AND \`id\` > ?))) order by (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END) ASC, (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN NULL ELSE (CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) END) DESC, (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci = '') THEN 1 ELSE 0 END) ASC, (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci = '') THEN NULL ELSE IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_ai_ci END) ASC, \`id\` ASC limit ?"`);
    expect(q.params).toMatchInlineSnapshot(`
      [
        "grid_all",
        "%ann%",
        "%ann%",
        "%ann%",
        "%ann%",
        "%ann%",
        "%ann%",
        "%ann%",
        "%ann%",
        "%ann%",
        500,
        500,
        "Anna",
        500,
        "Anna",
        "r9",
        26,
      ]
    `);
    expect(q.params[0]).toBe("grid_all");
    expect(q.params).toContain("r9");
    expect(q.params).toContain(500);
    expect(q.params).toContain("Anna");
    expect(q.params.at(-1)).toBe(26);
    expect(q.sql).not.toContain("offset");
    expect(built.pageMode).toBe("keyset");
    expect(built.sortKeys.map((k) => k.columnId)).toEqual(["fee", "name"]);
  });

  it("an offset-mode cursor resumes at its offset", () => {
    const query: GridQuery = { ...SECTION_8, page: { offset: 0, limit: 10 } };
    const cursor = encodeCursor({ v: 1, mode: "offset", fp: queryFingerprint(query, schema.schemaVersion), offset: 30 });
    const built = buildQuery({ ...query, page: { cursor, limit: 10 } }, scopeFor(), mockDb());
    expect(built.pageMode).toBe("offset");
    expect(built.offset).toBe(30);
    expect(renderQuery(built.select).params.slice(-2)).toEqual([11, 30]);
  });

  it("includeTotal builds a count statement with no ORDER BY / LIMIT", () => {
    const built = buildQuery({ ...SECTION_8, sort: [{ columnId: "name", dir: "asc" }], includeTotal: true }, scopeFor(), mockDb());
    expect(built.count).toBeDefined();
    const c = renderQuery(built.count as NonNullable<typeof built.count>);
    expect(c.sql).toMatchInlineSnapshot(`"select COUNT(*) from \`grid_rows\` where (\`grid_rows\`.\`grid_id\` = ? and \`grid_rows\`.\`deleted_at\` is null and ((IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci <> ? OR (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci = '')) AND (CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) >= ? AND CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) < ? AND NOT (CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) IS NULL))))"`);
    expect(c.params).toEqual(["grid_all", "paid", "2026-09-24", "2026-09-25"]);
    expect(c.sql).not.toMatch(/order by|limit/i);
  });

  it("count omits the keyset predicate", () => {
    const base: GridQuery = { filter: null, sort: [{ columnId: "name", dir: "asc" }], page: { offset: 0, limit: 5 } };
    const cursor = encodeCursor({ v: 1, mode: "keyset", fp: queryFingerprint(base, schema.schemaVersion), keys: ["Z"], id: "r1" });
    const built = buildQuery({ ...base, page: { cursor, limit: 5 }, includeTotal: true }, scopeFor(), mockDb());
    const c = renderQuery(built.count as NonNullable<typeof built.count>);
    expect(c.params).toEqual(["grid_all"]);
  });

  it("WHERE always contains grid_id and deleted_at is null", () => {
    const built = buildQuery({ filter: null, sort: [], page: { offset: 0, limit: 10 } }, scopeFor(), mockDb());
    const q = renderQuery(built.select);
    expect(q.sql).toContain("`grid_id` = ?");
    expect(q.sql).toContain("`deleted_at` is null");
    expect(q.params).toEqual(["grid_all", 11]);
  });

  it("projection contains no hidden key", () => {
    const built = buildQuery({ filter: null, sort: [], page: { offset: 0, limit: 10 } }, scopeFor(COUNSELLOR), mockDb());
    expect(renderQuery(built.select).sql).not.toContain("salary");
    const admin = buildQuery({ filter: null, sort: [], page: { offset: 0, limit: 10 } }, scopeFor(), mockDb());
    expect(renderQuery(admin.select).sql).toContain("'salary'");
  });

  it("a hidden sort column throws PermissionError before any SQL is built", () => {
    const db = mockDb();
    const spy = vi.spyOn(db, "select");
    const query: GridQuery = { filter: null, sort: [{ columnId: "salary", dir: "asc" }], page: { offset: 0, limit: 10 } };
    expect(() => buildQuery(query, scopeFor(COUNSELLOR), db)).toThrow(PermissionError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a hidden filter or groupBy column throws PermissionError", () => {
    const db = mockDb();
    const spy = vi.spyOn(db, "select");
    const filter: GridQuery = {
      filter: { columnId: "salary", operator: "gt", value: 1 },
      sort: [],
      page: { offset: 0, limit: 10 },
    };
    expect(() => buildQuery(filter, scopeFor(COUNSELLOR), db)).toThrow(PermissionError);
    const grouped: GridQuery = { filter: null, sort: [], groupBy: [{ columnId: "salary" }], page: { offset: 0, limit: 10 } };
    expect(() => buildQuery(grouped, scopeFor(COUNSELLOR), db)).toThrow(PermissionError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("an invalid filter throws FilterValidationError", () => {
    const query: GridQuery = {
      filter: { columnId: "name", operator: "nope", value: 1 },
      sort: [],
      page: { offset: 0, limit: 10 },
    };
    expect(() => buildQuery(query, scopeFor(), mockDb())).toThrow(FilterValidationError);
  });

  it("a cursor from a different query throws CursorError", () => {
    const a: GridQuery = { filter: null, sort: [{ columnId: "name", dir: "asc" }], page: { offset: 0, limit: 10 } };
    const cursor = encodeCursor({ v: 1, mode: "keyset", fp: queryFingerprint(a, schema.schemaVersion), keys: ["x"], id: "r1" });
    const b: GridQuery = { filter: null, sort: [{ columnId: "name", dir: "desc" }], page: { cursor, limit: 10 } };
    expect(() => buildQuery(b, scopeFor(), mockDb())).toThrow(CursorError);
  });

  it("a keyset cursor without an id throws CursorError", () => {
    const a: GridQuery = { filter: null, sort: [], page: { offset: 0, limit: 10 } };
    const cursor = encodeCursor({ v: 1, mode: "keyset", fp: queryFingerprint(a, schema.schemaVersion), keys: [] });
    expect(() => buildQuery({ ...a, page: { cursor, limit: 10 } }, scopeFor(), mockDb())).toThrow(CursorError);
  });

  it("clamps the limit", () => {
    const built = buildQuery({ filter: null, sort: [], page: { offset: -5, limit: 5000 } }, scopeFor(), mockDb());
    expect(built.limit).toBe(1000);
    expect(built.offset).toBe(0);
  });
});

describe("buildQuery: empty cursor starts keyset paging", () => {
  it("page { cursor: '' } → keyset mode, no predicate, no offset", async () => {
    const { buildQuery } = await import("../../../src/query/build-query");
    const { makeCtx, makeScope, allTypesSchema } = await import("../../helpers/schemas");
    const { mockDb } = await import("../../helpers/sql");
    const ctx = makeCtx(allTypesSchema());
    const built = buildQuery(
      { filter: null, sort: [{ columnId: "fee", dir: "asc" }], page: { cursor: "", limit: 5 } },
      { ...makeScope(ctx), gridId: "g" },
      mockDb(),
    );
    expect(built.pageMode).toBe("keyset");
    const q = built.select.toSQL();
    expect(q.sql).not.toContain("offset");
    expect(q.params).toEqual(["g", 6]);
  });
});
