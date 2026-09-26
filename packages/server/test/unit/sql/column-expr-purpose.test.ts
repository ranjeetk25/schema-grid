/**
 * v0.3.1 item 9: `MappedColumn.sortExpr` / `filterExpr` — index-backed
 * equivalents of `expr` that the translators pick through the `purpose`
 * argument of `resolveColumnExpr` (sort + keyset + group → `sortExpr`,
 * filter + search → `filterExpr`, everything else → `expr`).
 */
import { sql } from "drizzle-orm";
import { int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { translateFilter } from "../../../src/filter/translate-filter";
import { keysetPredicate } from "../../../src/pagination/keyset";
import { translateSearch } from "../../../src/search/translate-search";
import { translateSort } from "../../../src/sort/translate-sort";
import { createMappedColumnResolver, jsonCellsResolver, resolveColumnExpr } from "../../../src/sql/column-expr";
import type { SqlScope } from "../../../src/sql/scope";
import { allTypesSchema, col, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const leads = mysqlTable("leads", {
  id: int("id").primaryKey(),
  meta: varchar("meta", { length: 4000 }),
  nameSort: varchar("name_sort", { length: 255 }),
  nameFilter: varchar("name_filter", { length: 255 }),
  citySort: varchar("city_sort", { length: 255 }),
});

const schema = {
  id: "leads",
  schemaVersion: 1,
  columns: [col("name", "text"), col("city", "text"), col("note", "text")],
};
const NAME = sql`JSON_UNQUOTE(JSON_EXTRACT(${leads.meta}, '$.name'))`;
const CITY = sql`JSON_UNQUOTE(JSON_EXTRACT(${leads.meta}, '$.city'))`;
const NOTE = sql`JSON_UNQUOTE(JSON_EXTRACT(${leads.meta}, '$.note'))`;

const resolver = createMappedColumnResolver({
  columns: {
    name: { expr: NAME, sortExpr: leads.nameSort, filterExpr: leads.nameFilter },
    city: { expr: CITY, sortExpr: leads.citySort },
    note: { expr: NOTE },
  },
  rowId: leads.id,
});
const scope: SqlScope = { ctx: makeCtx(schema), generatedColumns: "ignore", columnExprs: resolver };
const byId = (id: string) => {
  const c = schema.columns.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const readAll = new Map(schema.columns.map((c) => [c.id, "read" as const]));

const EXPR = "JSON_UNQUOTE(JSON_EXTRACT(`leads`.`meta`, '$.name'))";

describe("resolveColumnExpr purpose → sortExpr / filterExpr", () => {
  it("no purpose (and `select`) resolve to `expr`", () => {
    for (const purpose of [undefined, "select"] as const) {
      const e = resolveColumnExpr(byId("name"), scope, purpose);
      expect(e.source).toBe("mapped");
      expect(renderSql(e.typed).sql).toBe(EXPR);
      expect(renderSql(e.raw).sql).toBe(EXPR);
      expect(renderSql(e.empty).sql).toBe(`(${EXPR} IS NULL OR REGEXP_LIKE(${EXPR}, '^[[:space:]]*$'))`);
    }
  });

  it("`sort` and `group` resolve typed / raw / empty from sortExpr", () => {
    for (const purpose of ["sort", "group"] as const) {
      const e = resolveColumnExpr(byId("name"), scope, purpose);
      expect(renderSql(e.typed).sql).toBe("`leads`.`name_sort`");
      expect(renderSql(e.raw).sql).toBe("`leads`.`name_sort`");
      expect(renderSql(e.empty).sql).toBe("(`leads`.`name_sort` IS NULL OR REGEXP_LIKE(`leads`.`name_sort`, '^[[:space:]]*$'))");
    }
  });

  it("`filter` and `search` resolve from filterExpr", () => {
    for (const purpose of ["filter", "search"] as const) {
      const e = resolveColumnExpr(byId("name"), scope, purpose);
      expect(renderSql(e.typed).sql).toBe("`leads`.`name_filter`");
      expect(renderSql(e.empty).sql).toContain("`leads`.`name_filter` IS NULL");
    }
  });

  it("a missing override falls back to `expr` for that purpose only", () => {
    expect(renderSql(resolveColumnExpr(byId("city"), scope, "sort").typed).sql).toBe("`leads`.`city_sort`");
    expect(renderSql(resolveColumnExpr(byId("city"), scope, "filter").typed).sql).toBe(
      "JSON_UNQUOTE(JSON_EXTRACT(`leads`.`meta`, '$.city'))",
    );
    expect(renderSql(resolveColumnExpr(byId("note"), scope, "sort").typed).sql).toBe(
      "JSON_UNQUOTE(JSON_EXTRACT(`leads`.`meta`, '$.note'))",
    );
  });

  it("translateSort orders by sortExpr and the keyset keys / predicate reuse it", () => {
    const { orderBy, keys } = translateSort([{ columnId: "name", dir: "asc" }], scope);
    const order = renderSql(sql.join(orderBy, sql`, `)).sql;
    expect(order).toBe(
      "(CASE WHEN (`leads`.`name_sort` IS NULL OR REGEXP_LIKE(`leads`.`name_sort`, '^[[:space:]]*$')) THEN 1 ELSE 0 END) ASC, " +
        "(CASE WHEN (`leads`.`name_sort` IS NULL OR REGEXP_LIKE(`leads`.`name_sort`, '^[[:space:]]*$')) THEN NULL ELSE `leads`.`name_sort` END) ASC, `leads`.`id` ASC",
    );
    expect(order).not.toContain("JSON_EXTRACT");
    expect(renderSql(keys[0]?.expr as never).sql).toContain("`leads`.`name_sort`");
    const k = renderSql(keysetPredicate(keys, { keys: ["Asha"], id: "7" }, resolver.rowId));
    expect(k.sql).toContain("ELSE `leads`.`name_sort` END) > ?");
    expect(k.sql).toContain("`leads`.`id` > ?");
    expect(k.sql).not.toContain("JSON_EXTRACT");
  });

  it("translateFilter compares filterExpr (emptiness included)", () => {
    const where = translateFilter({ columnId: "name", operator: "contains", value: "as" }, scope);
    const q = renderSql(where as never);
    expect(q.sql).toContain("`leads`.`name_filter` LIKE ?");
    expect(q.sql).toContain("`leads`.`name_filter` IS NULL");
    expect(q.sql).not.toContain("JSON_EXTRACT");
    const empty = renderSql(translateFilter({ columnId: "name", operator: "isEmpty" }, scope) as never);
    expect(empty.sql).toBe("(`leads`.`name_filter` IS NULL OR REGEXP_LIKE(`leads`.`name_filter`, '^[[:space:]]*$'))");
  });

  it("translateSearch matches on filterExpr when present, else expr", () => {
    const s = renderSql(translateSearch("as", readAll, scope) as never).sql;
    expect(s).toContain("`leads`.`name_filter` LIKE ?");
    expect(s).not.toContain("`leads`.`name_sort`");
    expect(s).not.toContain("$.name");
    expect(s).toContain("JSON_UNQUOTE(JSON_EXTRACT(`leads`.`meta`, '$.city')) LIKE ?");
    expect(s).toContain("JSON_UNQUOTE(JSON_EXTRACT(`leads`.`meta`, '$.note')) LIKE ?");
  });

  it("the JSON-cells resolver ignores the purpose", () => {
    const base = makeScope(makeCtx(allTypesSchema()));
    const column = base.ctx.schema.columns.find((c) => c.id === "name");
    if (!column) throw new Error("name");
    const plain = renderSql(jsonCellsResolver.resolve(column, base).typed).sql;
    for (const purpose of ["sort", "filter", "search", "group", "select"] as const) {
      expect(renderSql(jsonCellsResolver.resolve(column, base, purpose).typed).sql).toBe(plain);
      expect(renderSql(resolveColumnExpr(column, base, purpose).typed).sql).toBe(plain);
    }
  });
});
