import { sql } from "drizzle-orm";
import { boolean, date, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { UnsupportedOperatorError } from "../../../src/errors";
import { translateFilter } from "../../../src/filter/translate-filter";
import { planFormulaColumns } from "../../../src/formula/formula-plan";
import { keysetPredicate } from "../../../src/pagination/keyset";
import { translateSearch } from "../../../src/search/translate-search";
import { translateSort } from "../../../src/sort/translate-sort";
import {
  type ColumnExprResolver,
  createJsonCellsResolver,
  createMappedColumnResolver,
  jsonCellsResolver,
  resolveColumnExpr,
} from "../../../src/sql/column-expr";
import type { SqlScope } from "../../../src/sql/scope";
import { col, makeCtx } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const leads = mysqlTable("leads", {
  id: int("id").primaryKey(),
  name: varchar("name", { length: 100 }),
  paymentStatus: varchar("payment_status", { length: 16 }),
  callDate: date("call_date", { mode: "string" }),
  aiVerified: boolean("ai_verified"),
});

const OPTIONS = { options: [{ id: "paid", label: "Paid" }, { id: "pending", label: "Pending" }] };
const schema = {
  id: "leads",
  schemaVersion: 1,
  columns: [
    col("name", "text"),
    col("paymentStatus", "select", { config: OPTIONS }),
    col("callDate", "date"),
    col("aiVerified", "boolean"),
    col("fee", "number"),
    col("note", "text"),
    col("double_fee", "formula", { formula: "{fee} * 2", config: { resultType: "number" } }),
  ],
};

const ext = createJsonCellsResolver({ cells: sql`${sql.identifier("sg_ext")}.${sql.identifier("cells")}`, physical: {}, generatedColumns: "ignore" });
const mapped = createMappedColumnResolver({
  columns: {
    name: { expr: leads.name },
    paymentStatus: { expr: leads.paymentStatus },
    callDate: { expr: leads.callDate },
    aiVerified: { expr: leads.aiVerified, searchable: false },
    fee: { expr: sql`${leads.id} * 100`, kind: "number" },
  },
  rowId: leads.id,
  fallback: ext,
});

function scopeWith(resolver: ColumnExprResolver): SqlScope {
  const base: SqlScope = { ctx: makeCtx(schema, { now: new Date("2026-09-25T00:30:00+05:30"), tz: "Asia/Kolkata" }), generatedColumns: "ignore", columnExprs: resolver };
  return { ...base, formulaPlans: planFormulaColumns(base) };
}
const scope = scopeWith(mapped);
const byId = (id: string) => {
  const c = schema.columns.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

describe("ColumnExprResolver seam", () => {
  it("mapped columns resolve to their expression (typed = raw), with IS NULL / blank-text emptiness", () => {
    const e = resolveColumnExpr(byId("name"), scope);
    expect(e.source).toBe("mapped");
    expect(e.kind).toBe("text");
    expect(renderSql(e.typed).sql).toBe("`leads`.`name`");
    expect(renderSql(e.empty).sql).toBe("(`leads`.`name` IS NULL OR REGEXP_LIKE(`leads`.`name`, '^[[:space:]]*$'))");
    expect(renderSql(resolveColumnExpr(byId("callDate"), scope).empty).sql).toBe("(`leads`.`call_date` IS NULL)");
    expect(resolveColumnExpr(byId("paymentStatus"), scope).kind).toBe("choice");
  });

  it("honours an explicit kind", () => {
    const e = resolveColumnExpr(byId("fee"), scope);
    expect(e.kind).toBe("number");
    expect(renderSql(e.typed).sql).toBe("`leads`.`id` * 100");
  });

  it("unmapped columns go to the fallback resolver (JSON over a joined cells expression)", () => {
    const e = resolveColumnExpr(byId("note"), scope);
    expect(e.source).toBe("json");
    expect(renderSql(e.raw).sql).toBe("JSON_EXTRACT(`sg_ext`.`cells`, '$.note')");
  });

  it("unmapped columns without a fallback are unsupported", () => {
    const noFallback = createMappedColumnResolver({ columns: {}, rowId: leads.id });
    expect(() => resolveColumnExpr(byId("note"), scopeWith(noFallback))).toThrow(UnsupportedOperatorError);
  });

  it("the default resolver is the JSON-cells one over the unqualified `id`", () => {
    expect(renderSql(jsonCellsResolver.rowId).sql).toBe("`id`");
  });

  it("filters translate over mapped expressions with the same operator semantics", () => {
    const where = translateFilter(
      {
        op: "and",
        children: [
          { columnId: "paymentStatus", operator: "isNot", value: "paid" },
          { columnId: "callDate", operator: "isWithin", value: { relative: "yesterday" } },
        ],
      },
      scope,
    );
    const q = renderSql(where as never);
    expect(q.sql).toContain("(`leads`.`payment_status` <> ? OR (`leads`.`payment_status` IS NULL");
    expect(q.sql).toContain("`leads`.`call_date` >= ?");
    expect(q.params).toEqual(["paid", "2026-09-24", "2026-09-25"]);
  });

  it("sort ends with the resolver's row id, and keyset compares it", () => {
    const { orderBy, keys } = translateSort([{ columnId: "name", dir: "asc" }], scope);
    expect(renderSql(orderBy.at(-1) as never).sql).toBe("`leads`.`id` ASC");
    const k = renderSql(keysetPredicate(keys, { keys: ["x"], id: "7" }, mapped.rowId));
    expect(k.sql).toContain("`leads`.`id` > ?");
    expect(k.params.at(-1)).toBe("7");
  });

  it("search honours the per-column searchable override", () => {
    const s = renderSql(translateSearch("ann", new Map(schema.columns.map((c) => [c.id, "read" as const])), scope) as never).sql;
    expect(s).toContain("`leads`.`name` LIKE");
    expect(s).toContain("`leads`.`payment_status` LIKE");
    expect(s).not.toContain("ai_verified");
    expect(s).toContain("JSON_EXTRACT(`sg_ext`.`cells`, '$.note')");
  });

  it("translatable formulas inline the mapped expressions", () => {
    const e = resolveColumnExpr(byId("double_fee"), scope);
    expect(e.source).toBe("formula");
    expect(renderSql(e.typed).sql).toContain("`leads`.`id` * 100");
  });
});
