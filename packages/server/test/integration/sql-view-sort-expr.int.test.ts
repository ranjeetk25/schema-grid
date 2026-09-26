/**
 * v0.3.1 item 9 on MySQL 8.4: a JSON column with a STORED generated column
 * mirroring `JSON_EXTRACT`, exposed through `sortExpr` / `filterExpr`. Keyset
 * pages come back in exactly the order the plain expression gives, and the
 * captured ORDER BY / WHERE name the generated column, not the JSON path.
 */
import { sql } from "drizzle-orm";
import { int, json, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { type ColumnDef, type GridQuery, type GridSchema, createRolePermissionResolver } from "../../src/internal/core";
import { type SqlViewDataSourceOptions, createSqlViewDataSource } from "../../src/sqlview/create-sql-view-data-source";
import { FIXTURE_NOW, FIXTURE_TIME_ZONE } from "../fixtures/admissions";
import { type StartedMysql, describeMysql, startMysql } from "./mysql";

const TABLE = "leads_json";
const t = mysqlTable(TABLE, {
  id: int("id").primaryKey(),
  meta: json("meta"),
  nameSort: varchar("name_sort", { length: 255 }),
  version: int("version").notNull().default(1),
});

const AT = "2026-09-01T00:00:00.000Z";
const col = (key: string, type: string): ColumnDef =>
  ({ id: key, key, label: key, type, config: {}, order: 0, createdAt: AT, updatedAt: AT }) as ColumnDef;
const schema: GridSchema = { id: TABLE, schemaVersion: 1, columns: [col("name", "text")] };

// Same collation as the generated column, so both forms compare / order identically.
const NAME_EXPR = sql`JSON_UNQUOTE(JSON_EXTRACT(${t.meta}, '$.name')) COLLATE utf8mb4_0900_as_ci`;

describeMysql("SQL view sortExpr / filterExpr over a generated column (MySQL 8.4)", () => {
  let mysql: StartedMysql;

  const make = (columns: SqlViewDataSourceOptions["columns"]) =>
    createSqlViewDataSource({
      db: mysql.db,
      schema,
      resolver: createRolePermissionResolver(),
      user: { id: "u1", roles: ["admin"] },
      tz: FIXTURE_TIME_ZONE,
      now: () => new Date(FIXTURE_NOW),
      baseQuery: (ctx) => ctx.db.select().from(t),
      columns,
      rowId: t.id,
      version: t.version,
    });
  const plain = () => make({ name: { expr: NAME_EXPR } });
  const indexed = () => make({ name: { expr: NAME_EXPR, sortExpr: t.nameSort, filterExpr: t.nameSort } });

  const walk = async (ds: ReturnType<typeof make>, query: Omit<GridQuery, "page">, limit: number) => {
    const seen: { id: string; name: unknown }[] = [];
    let page: GridQuery["page"] = { cursor: "", limit };
    for (let i = 0; i < 20; i++) {
      const res = await ds.fetch({ ...query, page });
      seen.push(...res.rows.map((r) => ({ id: r.id, name: r.cells.name })));
      if (!res.nextCursor) break;
      page = { cursor: res.nextCursor, limit };
    }
    return seen;
  };
  const selects = () => mysql.queries.filter((q) => /^select /i.test(q.sql) && / order by /i.test(q.sql));
  const orderByOf = (q: string) => q.slice(q.toLowerCase().lastIndexOf(" order by "));
  const whereOf = (q: string) => q.slice(q.toLowerCase().indexOf(" where "), q.toLowerCase().lastIndexOf(" order by "));

  beforeAll(async () => {
    mysql = await startMysql();
  }, 180_000);
  beforeEach(async () => {
    const exec = (s: string) => mysql.db.execute(s as never);
    await exec(`DROP TABLE IF EXISTS \`${TABLE}\``);
    await exec(
      `CREATE TABLE \`${TABLE}\` (
        id INT NOT NULL,
        meta JSON NULL,
        name_sort VARCHAR(255) AS (JSON_UNQUOTE(JSON_EXTRACT(meta, '$.name'))) STORED,
        version INT NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        INDEX idx_name_sort (name_sort)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci`,
    );
    // Duplicates (ci), a missing key and a NULL document: emptiness must agree between the two forms.
    await exec(
      `INSERT INTO \`${TABLE}\` (id, meta) VALUES
        (1, '{"name": "Chitra"}'),
        (2, '{"name": "asha"}'),
        (3, '{}'),
        (4, '{"name": "bhavesh"}'),
        (5, '{"name": "Asha"}'),
        (6, NULL),
        (7, '{"name": "Bhavesh"}'),
        (8, '{"name": "dev"}')`,
    );
    mysql.queries.length = 0;
  });
  afterAll(async () => {
    await mysql?.stop();
  });

  it("keyset pages over sortExpr equal the plain-expression order, and ORDER BY names the generated column", async () => {
    for (const dir of ["asc", "desc"] as const) {
      const query = { filter: null, sort: [{ columnId: "name", dir }] };
      const expected = await walk(plain(), query, 3);
      mysql.queries.length = 0;
      const actual = await walk(indexed(), query, 3);
      expect(actual).toEqual(expected);
      expect(actual.map((r) => r.id)).toHaveLength(8);
      // Empty rows (3, 6) last in both directions, ties by id.
      expect(actual.slice(-2).map((r) => r.id)).toEqual(["3", "6"]);

      const pages = selects();
      expect(pages.length).toBeGreaterThan(1);
      for (const q of pages) {
        expect(orderByOf(q.sql)).toContain("`sg_base`.`name_sort`");
        expect(orderByOf(q.sql)).not.toContain("JSON_EXTRACT");
        // The projection still reads `expr`.
        expect(q.sql).toContain("JSON_UNQUOTE(JSON_EXTRACT(`sg_base`.`meta`, '$.name'))");
      }
      // Keyset pages (after the first) compare the generated column too.
      const paged = pages.slice(1);
      expect(paged.length).toBeGreaterThan(0);
      for (const q of paged) expect(whereOf(q.sql)).not.toContain("JSON_EXTRACT");
    }
  });

  it("filters and search over filterExpr match the plain-expression rows, and WHERE names the generated column", async () => {
    const cases: Omit<GridQuery, "page">[] = [
      { filter: { columnId: "name", operator: "contains", value: "sha" }, sort: [] },
      { filter: { columnId: "name", operator: "isEmpty" }, sort: [] },
      { filter: { columnId: "name", operator: "notContains", value: "a" }, sort: [] },
      { filter: null, search: "BHAV", sort: [] },
    ];
    for (const query of cases) {
      const expected = await walk(plain(), query, 100);
      mysql.queries.length = 0;
      const actual = await walk(indexed(), query, 100);
      expect(actual).toEqual(expected);
      const q = selects()[0]?.sql ?? "";
      expect(whereOf(q)).toContain("`sg_base`.`name_sort`");
      expect(whereOf(q)).not.toContain("JSON_EXTRACT");
    }
  });
});
