import { describe, expect, it } from "vitest";
import { CursorError, GroupingError, PermissionError } from "../../../src/errors";
import { buildGroupQuery, executeGroupQuery } from "../../../src/grouping/translate-grouping";
import type { GridQuery, GroupResult } from "../../../src/internal/core";
import { decodeCursor, encodeCursor, queryFingerprint } from "../../../src/pagination/cursor";
import { createFakeMysql } from "../../helpers/fake-mysql";
import { allTypesSchema, col, makeCtx, makeScope } from "../../helpers/schemas";
import { mockDb, renderQuery } from "../../helpers/sql";

const ADMIN_ONLY = { read: { roles: ["admin"] }, edit: { roles: ["admin"] } };
const schema = allTypesSchema([col("salary", "number", { permissions: ADMIN_ONLY })]);
const COUNSELLOR = { id: "c1", roles: ["counsellor"] };

const scopeFor = (user = { id: "u1", roles: ["admin"] }) => ({ ...makeScope(makeCtx(schema, { user })), gridId: "grid_all" });

const grouped = (groupBy: GridQuery["groupBy"], extra: Partial<GridQuery> = {}): GridQuery => ({
  filter: null,
  sort: [],
  groupBy,
  page: { offset: 0, limit: 50 },
  ...extra,
});

const BY_STATUS = grouped([
  {
    columnId: "paymentStatus",
    aggregations: [
      { columnId: "fee", agg: "count" },
      { columnId: "fee", agg: "sum" },
      { columnId: "callDate", agg: "countEmpty" },
    ],
  },
]);

describe("buildGroupQuery", () => {
  it("groups by payment status with count, sum(fee) and countEmpty(callDate)", () => {
    const built = buildGroupQuery(BY_STATUS, scopeFor(), mockDb());
    const q = renderQuery(built.select);
    expect(q.sql).toMatchInlineSnapshot(`"select (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci = '') THEN NULL ELSE IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci END) as \`sg_group_key\`, MAX(CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci = '') THEN 1 ELSE 0 END) as \`sg_group_empty\`, COUNT(*) as \`sg_count\`, COUNT(*) as \`sg_agg_0\`, SUM((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END)) as \`sg_agg_1\`, SUM(CASE WHEN (CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE) IS NULL) THEN 1 ELSE 0 END) as \`sg_agg_2\` from \`grid_rows\` where (\`grid_rows\`.\`grid_id\` = ? and \`grid_rows\`.\`deleted_at\` is null) group by \`sg_group_key\` order by \`sg_group_empty\` ASC, \`sg_group_key\` ASC limit ?"`);
    expect(q.params).toEqual(["grid_all", 51]);
    expect(built.count).toBeUndefined();
    expect(built.fingerprint).toBe(queryFingerprint(BY_STATUS, schema.schemaVersion));
    expect(built.limit).toBe(50);
    expect(built.offset).toBe(0);
  });

  it("applies filter/search in WHERE, orders DESC when sorted desc on the group column, and pages by offset", () => {
    const query = grouped([{ columnId: "fee", aggregations: [{ columnId: "callDate", agg: "max" }] }], {
      filter: { columnId: "paymentStatus", operator: "is", value: "paid" },
      sort: [{ columnId: "fee", dir: "desc" }],
      page: { offset: 20, limit: 10 },
    });
    const q = renderQuery(buildGroupQuery(query, scopeFor(), mockDb()).select);
    expect(q.params).toEqual(["grid_all", "paid", 11, 20]);
    expect(q.sql).toContain("`grid_rows`.`grid_id` = ?");
    expect(q.sql).toContain("`grid_rows`.`deleted_at` is null");
    expect(q.sql).toContain("DATE_FORMAT(MAX(");
    expect(q.sql).toContain("group by `sg_group_key`");
    expect(q.sql.endsWith("order by `sg_group_empty` ASC, `sg_group_key` DESC limit ? offset ?")).toBe(true);
  });

  it("includeTotal counts groups (distinct non-empty keys + one empty group)", () => {
    const built = buildGroupQuery({ ...BY_STATUS, includeTotal: true }, scopeFor(), mockDb());
    const count = renderQuery(built.count as NonNullable<typeof built.count>);
    expect(count.sql).toMatchInlineSnapshot(`"select COUNT(DISTINCT (CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci = '') THEN NULL ELSE IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci END)) + COALESCE(MAX(CASE WHEN (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci IS NULL OR IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus'))) COLLATE utf8mb4_0900_ai_ci = '') THEN 1 ELSE 0 END), 0) from \`grid_rows\` where (\`grid_rows\`.\`grid_id\` = ? and \`grid_rows\`.\`deleted_at\` is null)"`);
    expect(count.params).toEqual(["grid_all"]);
  });

  it("date group keys are formatted as YYYY-MM-DD", () => {
    const q = renderQuery(buildGroupQuery(grouped([{ columnId: "callDate" }]), scopeFor(), mockDb()).select);
    expect(q.sql).toContain("DATE_FORMAT((CASE WHEN");
  });

  it("accepts text, choice, ref, number, boolean and date group columns", () => {
    for (const id of ["name", "email", "paymentStatus", "source", "owner", "fee", "paid", "isActive", "callDate", "indexedFee", "contactEmail"]) {
      expect(() => buildGroupQuery(grouped([{ columnId: id }]), scopeFor(), mockDb())).not.toThrow();
    }
  });

  it("rejects multi / link / datetime / longText group columns with GroupingError", () => {
    for (const id of ["tags", "links", "calledAt", "notes"]) {
      expect(() => buildGroupQuery(grouped([{ columnId: id }]), scopeFor(), mockDb())).toThrow(GroupingError);
    }
  });

  it("rejects aggregations the field type does not allow", () => {
    const bad = [
      { columnId: "name", agg: "sum" },
      { columnId: "callDate", agg: "sum" },
      { columnId: "callDate", agg: "avg" },
      { columnId: "paymentStatus", agg: "max" },
    ] as const;
    for (const a of bad) {
      expect(() =>
        buildGroupQuery(grouped([{ columnId: "paymentStatus", aggregations: [{ ...a }] }]), scopeFor(), mockDb()),
      ).toThrow(GroupingError);
    }
    // Universal aggregations are allowed on any type.
    expect(() =>
      buildGroupQuery(
        grouped([{ columnId: "paymentStatus", aggregations: [{ columnId: "tags", agg: "countFilled" }] }]),
        scopeFor(),
        mockDb(),
      ),
    ).not.toThrow();
  });

  it("rejects a missing groupBy with GroupingError", () => {
    expect(() => buildGroupQuery(grouped([]), scopeFor(), mockDb())).toThrow(GroupingError);
    expect(() => buildGroupQuery(grouped(undefined), scopeFor(), mockDb())).toThrow(GroupingError);
  });

  it("grouping by or aggregating a hidden column throws PermissionError", () => {
    const scope = scopeFor(COUNSELLOR);
    try {
      buildGroupQuery(grouped([{ columnId: "salary" }]), scope, mockDb());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PermissionError);
      expect((e as PermissionError).details).toEqual({ columnIds: ["salary"], usage: "groupBy" });
    }
    try {
      buildGroupQuery(grouped([{ columnId: "paymentStatus", aggregations: [{ columnId: "salary", agg: "sum" }] }]), scope, mockDb());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PermissionError);
      expect((e as PermissionError).details).toEqual({ columnIds: ["salary"], usage: "aggregate" });
    }
  });

  it("offset cursors must match the query fingerprint; keyset cursors are rejected", () => {
    const fp = queryFingerprint(BY_STATUS, schema.schemaVersion);
    const ok = encodeCursor({ v: 1, mode: "offset", fp, offset: 50 });
    const q = renderQuery(buildGroupQuery({ ...BY_STATUS, page: { cursor: ok, limit: 50 } }, scopeFor(), mockDb()).select);
    expect(q.params).toEqual(["grid_all", 51, 50]);
    const stale = encodeCursor({ v: 1, mode: "offset", fp: "nope", offset: 50 });
    expect(() => buildGroupQuery({ ...BY_STATUS, page: { cursor: stale, limit: 50 } }, scopeFor(), mockDb())).toThrow(CursorError);
    const keyset = encodeCursor({ v: 1, mode: "keyset", fp, keys: [], id: "r1" });
    expect(() => buildGroupQuery({ ...BY_STATUS, page: { cursor: keyset, limit: 50 } }, scopeFor(), mockDb())).toThrow(CursorError);
  });
});

describe("executeGroupQuery", () => {
  function fake(groupRows: unknown[][], total?: number) {
    return createFakeMysql((call) => {
      if (!call.rowsAsArray) return undefined;
      if (call.sql.includes("COUNT(DISTINCT")) return [[total ?? 0]];
      return groupRows;
    });
  }

  it("shapes GroupResult[] with numeric conversion, empty group last, nextCursor and total", async () => {
    // Field order: key, empty flag, count, then one column per aggregation.
    const { db, statements } = fake(
      [
        ["failed", 0, 2, "2", "150.0000000000", "1"],
        ["paid", 0, 3, 3, "1500.5000000000", "0"],
        [null, 1, 1, 1, null, "1"],
      ],
      3,
    );
    const scope = scopeFor();
    const built = buildGroupQuery({ ...BY_STATUS, includeTotal: true, page: { offset: 0, limit: 2 } }, scope, db);
    const res = await executeGroupQuery(built, scope);
    expect(statements()).toHaveLength(2);
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(3);
    expect(res.groups).toEqual<GroupResult[]>([
      {
        columnId: "paymentStatus",
        value: "failed",
        key: '"failed"',
        count: 2,
        aggregates: [
          { columnId: "fee", agg: "count", value: 2 },
          { columnId: "fee", agg: "sum", value: 150 },
          { columnId: "callDate", agg: "countEmpty", value: 1 },
        ],
      },
      {
        columnId: "paymentStatus",
        value: "paid",
        key: '"paid"',
        count: 3,
        aggregates: [
          { columnId: "fee", agg: "count", value: 3 },
          { columnId: "fee", agg: "sum", value: 1500.5 },
          { columnId: "callDate", agg: "countEmpty", value: 0 },
        ],
      },
    ]);
    expect(res.nextCursor).toBeDefined();
    expect(decodeCursor(res.nextCursor as string)).toEqual({ v: 1, mode: "offset", fp: built.fingerprint, offset: 2 });
  });

  it("returns the empty group last with value null and no nextCursor on the last page", async () => {
    const { db } = fake([
      ["paid", 0, 3, 3, "10", "0"],
      [null, 1, 1, 1, null, "1"],
    ]);
    const scope = scopeFor();
    const res = await executeGroupQuery(buildGroupQuery(BY_STATUS, scope, db), scope);
    expect(res.nextCursor).toBeUndefined();
    expect(res.total).toBeUndefined();
    expect(res.groups?.at(-1)).toEqual<GroupResult>({
      columnId: "paymentStatus",
      value: null,
      key: "null",
      count: 1,
      aggregates: [
        { columnId: "fee", agg: "count", value: 1 },
        { columnId: "fee", agg: "sum", value: null },
        { columnId: "callDate", agg: "countEmpty", value: 1 },
      ],
    });
  });

  it("converts boolean, number and date group values and date min/max", async () => {
    const scope = scopeFor();
    const bool = fake([
      [0, 0, 4],
      ["1", 0, 2],
    ]);
    const b = await executeGroupQuery(buildGroupQuery(grouped([{ columnId: "isActive" }]), scope, bool.db), scope);
    expect(b.groups?.map((g) => [g.value, g.key])).toEqual([
      [false, "false"],
      [true, "true"],
    ]);

    const num = fake([["100.0000000000", 0, 1, "2026-09-01"]]);
    const n = await executeGroupQuery(
      buildGroupQuery(grouped([{ columnId: "fee", aggregations: [{ columnId: "callDate", agg: "min" }] }]), scope, num.db),
      scope,
    );
    expect(n.groups?.[0]).toMatchObject({ value: 100, key: "100", aggregates: [{ columnId: "callDate", agg: "min", value: "2026-09-01" }] });

    const date = fake([["2026-09-24", 0, 5]]);
    const d = await executeGroupQuery(buildGroupQuery(grouped([{ columnId: "callDate" }]), scope, date.db), scope);
    expect(d.groups?.[0]).toMatchObject({ columnId: "callDate", value: "2026-09-24", key: '"2026-09-24"', count: 5 });
  });
});
