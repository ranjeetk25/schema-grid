/**
 * v0.3.1 item 9 on the SQL view: `columns[key].sortExpr` / `filterExpr` are
 * rebased onto `sg_base`, UTC-wrapped for datetimes, and used for ORDER BY /
 * WHERE / search while the projection keeps reading `expr`. Without them the
 * generated SQL is byte-identical to before (pinned snapshot).
 */
import { sql } from "drizzle-orm";
import { datetime, decimal, int, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import type { GridDb } from "../../../src/changes/db";
import { type GridSchema, createRolePermissionResolver } from "../../../src/internal/core";
import { type SqlViewDataSourceOptions, createSqlViewDataSource } from "../../../src/sqlview/create-sql-view-data-source";
import { createFakeMysql } from "../../helpers/fake-mysql";
import { col } from "../../helpers/schemas";

const leads = mysqlTable("leads", {
  id: int("id").primaryKey(),
  meta: json("meta"),
  nameSort: varchar("name_sort", { length: 255 }),
  nameFilter: varchar("name_filter", { length: 255 }),
  calledAt: datetime("called_at", { fsp: 3 }),
  calledAtSort: datetime("called_at_sort", { fsp: 3 }),
  fee: decimal("fee", { precision: 10, scale: 2 }),
  version: int("version"),
});

const schema: GridSchema = {
  id: "leads",
  schemaVersion: 1,
  columns: [col("name", "text"), col("calledAt", "datetime"), col("fee", "number")],
};

const NAME_EXPR = sql`JSON_UNQUOTE(JSON_EXTRACT(${leads.meta}, '$.name'))`;
const PLAIN: SqlViewDataSourceOptions["columns"] = {
  name: { expr: NAME_EXPR },
  calledAt: { expr: leads.calledAt },
  fee: { expr: leads.fee },
};
const INDEXED: SqlViewDataSourceOptions["columns"] = {
  name: { expr: NAME_EXPR, sortExpr: leads.nameSort, filterExpr: leads.nameFilter },
  calledAt: { expr: leads.calledAt, sortExpr: leads.calledAtSort },
  fee: { expr: leads.fee },
};

function make(extra: Partial<SqlViewDataSourceOptions> = {}) {
  const fake = createFakeMysql((c) => (c.rowsAsArray ? [] : undefined));
  const ds = createSqlViewDataSource({
    db: fake.db as unknown as GridDb,
    schema,
    resolver: createRolePermissionResolver(),
    user: { id: "u1", roles: ["admin"] },
    tz: "Asia/Kolkata",
    baseQuery: () => sql`SELECT * FROM leads`,
    columns: INDEXED,
    rowId: leads.id,
    version: leads.version,
    ...extra,
  });
  return { ds, statements: fake.statements };
}

const page = { offset: 0, limit: 10 } as const;
const orderByOf = (q: string) => q.slice(q.toLowerCase().lastIndexOf(" order by "));
const selectOf = (q: string) => q.slice(0, q.toLowerCase().indexOf(" from "));
const whereOf = (q: string) => q.slice(q.toLowerCase().indexOf(" where "), q.toLowerCase().lastIndexOf(" order by "));

describe("SQL view sortExpr / filterExpr", () => {
  it("ORDER BY names the rebased sortExpr while the projection still selects expr", async () => {
    const { ds, statements } = make();
    await ds.fetch({ filter: null, sort: [{ columnId: "name", dir: "asc" }], page });
    const q = statements()[0]?.sql ?? "";
    // Projection order: id, version, m_name, … (then the keyset sort-key aliases, which DO use sortExpr).
    expect(selectOf(q).startsWith("select `sg_base`.`id`, `sg_base`.`version`, JSON_UNQUOTE(JSON_EXTRACT(`sg_base`.`meta`, '$.name')),")).toBe(true);
    expect(orderByOf(q)).toContain("`sg_base`.`name_sort`");
    expect(orderByOf(q)).not.toContain("JSON_EXTRACT");
    expect(orderByOf(q)).not.toContain("`leads`.");
  });

  it("WHERE and search compare the rebased filterExpr", async () => {
    const { ds, statements } = make();
    await ds.fetch({ filter: { columnId: "name", operator: "contains", value: "as" }, search: "bh", sort: [], page });
    const q = statements()[0]?.sql ?? "";
    const where = whereOf(q);
    expect(where).toContain("`sg_base`.`name_filter` LIKE ?");
    expect(where).not.toContain("JSON_EXTRACT");
    expect(where).not.toContain("name_sort");
    expect(statements()[0]?.params).toEqual(expect.arrayContaining(["%as%", "%bh%"]));
  });

  it("a datetime sortExpr is still compared in UTC (CONVERT_TZ) and the projection reads expr", async () => {
    const { ds, statements } = make();
    await ds.fetch({ filter: null, sort: [{ columnId: "calledAt", dir: "desc" }], page });
    const q = statements()[0]?.sql ?? "";
    expect(orderByOf(q)).toContain("CONVERT_TZ(`sg_base`.`called_at_sort`, ?, '+00:00')");
    expect(orderByOf(q)).not.toContain("`sg_base`.`called_at`,");
    expect(selectOf(q)).toContain("DATE_FORMAT(`sg_base`.`called_at`, '%Y-%m-%d %H:%i:%s.%f')");
    expect(statements()[0]?.params).toContain("+05:30");
  });

  it("a column without overrides keeps sorting / filtering on expr", async () => {
    const { ds, statements } = make();
    await ds.fetch({ filter: { columnId: "fee", operator: "gt", value: 1 }, sort: [{ columnId: "fee", dir: "asc" }], page });
    const q = statements()[0]?.sql ?? "";
    expect(orderByOf(q)).toContain("`sg_base`.`fee`");
    expect(whereOf(q)).toContain("`sg_base`.`fee` > ?");
  });

  it("without overrides the generated SQL is unchanged (regression)", async () => {
    const { ds, statements } = make({ columns: PLAIN });
    await ds.fetch({
      filter: { columnId: "name", operator: "contains", value: "as" },
      search: "bh",
      sort: [
        { columnId: "calledAt", dir: "desc" },
        { columnId: "name", dir: "asc" },
      ],
      page,
    });
    expect(statements()[0]?.sql).toMatchInlineSnapshot(`"select \`sg_base\`.\`id\`, \`sg_base\`.\`version\`, JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')), DATE_FORMAT(\`sg_base\`.\`called_at\`, '%Y-%m-%d %H:%i:%s.%f'), \`sg_base\`.\`fee\`, (CASE WHEN (CONVERT_TZ(\`sg_base\`.\`called_at\`, ?, '+00:00') IS NULL) THEN NULL ELSE CONVERT_TZ(\`sg_base\`.\`called_at\`, ?, '+00:00') END), (CASE WHEN (CONVERT_TZ(\`sg_base\`.\`called_at\`, ?, '+00:00') IS NULL) THEN 1 ELSE 0 END), (CASE WHEN (JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')) IS NULL OR REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')), '^[[:space:]]*$')) THEN NULL ELSE JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')) END), (CASE WHEN (JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')) IS NULL OR REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')), '^[[:space:]]*$')) THEN 1 ELSE 0 END) from (SELECT * FROM leads) AS \`sg_base\` where ((JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')) LIKE ? ESCAPE '!' AND NOT (JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')) IS NULL OR REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')), '^[[:space:]]*$'))) and (JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')) LIKE ? ESCAPE '!')) order by (CASE WHEN (CONVERT_TZ(\`sg_base\`.\`called_at\`, ?, '+00:00') IS NULL) THEN 1 ELSE 0 END) ASC, (CASE WHEN (CONVERT_TZ(\`sg_base\`.\`called_at\`, ?, '+00:00') IS NULL) THEN NULL ELSE CONVERT_TZ(\`sg_base\`.\`called_at\`, ?, '+00:00') END) DESC, (CASE WHEN (JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')) IS NULL OR REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')), '^[[:space:]]*$')) THEN 1 ELSE 0 END) ASC, (CASE WHEN (JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')) IS NULL OR REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')), '^[[:space:]]*$')) THEN NULL ELSE JSON_UNQUOTE(JSON_EXTRACT(\`sg_base\`.\`meta\`, '$.name')) END) ASC, \`sg_base\`.\`id\` ASC limit ?"`);
  });
});
