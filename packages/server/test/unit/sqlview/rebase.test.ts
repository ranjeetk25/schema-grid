import { eq, sql } from "drizzle-orm";
import { int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { rebaseColumns } from "../../../src/sqlview/rebase";
import { renderSql } from "../../helpers/sql";

const leads = mysqlTable("leads", { id: int("id").primaryKey(), first: varchar("first_name", { length: 50 }), last: varchar("last", { length: 50 }) });

describe("rebaseColumns", () => {
  it("re-points a bare column at the alias by its DB name", () => {
    expect(renderSql(rebaseColumns(leads.first, "sg_base")).sql).toBe("`sg_base`.`first_name`");
  });

  it("rewrites nested column references and keeps params", () => {
    const expr = sql`CONCAT(${leads.first}, ' ', ${sql`UPPER(${leads.last})`}) = ${"x"} AND ${eq(leads.id, 3)}`;
    const q = renderSql(rebaseColumns(expr, "b"));
    expect(q.sql).toBe("CONCAT(`b`.`first_name`, ' ', UPPER(`b`.`last`)) = ? AND `b`.`id` = ?");
    expect(q.params).toEqual(["x", 3]);
  });
});
