import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cellColorJsonPath, shownColorExpr } from "../../../src/colors/color-sql";
import { translateFilter } from "../../../src/filter/translate-filter";
import type { ColorRule, FilterNode } from "../../../src/internal/core";
import type { SqlScope } from "../../../src/sql/scope";
import { allTypesSchema, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const ctx = makeCtx(allTypesSchema());
const DOC = sql`\`sg_colors\`.\`colors\``;
const withColors = (rules: ColorRule[] | undefined, manual = true): SqlScope =>
  makeScope(ctx, { colors: { ...(manual ? { manual: DOC } : {}), ...(rules ? { rules } : {}) } });
const t = (node: FilterNode, scope: SqlScope) => {
  const out = translateFilter(node, scope);
  if (!out) throw new Error("expected SQL");
  return renderSql(out);
};
/** The rendered SQL of a rule condition, exactly as `translateFilter` renders it on its own. */
const when = (node: FilterNode) => t(node, makeScope(ctx));

const paid: FilterNode = { columnId: "paymentStatus", operator: "is", value: "paid" };
const bigFee: FilterNode = { columnId: "fee", operator: "gt", value: 100 };
const MANUAL = "JSON_UNQUOTE(JSON_EXTRACT(`sg_colors`.`colors`, ?))";

describe("cellColorJsonPath", () => {
  it("quotes the column id as a JSON member (escaping quotes and backslashes)", () => {
    expect(cellColorJsonPath("col_fee")).toBe('$."col_fee"');
    expect(cellColorJsonPath('a"b\\c')).toBe('$."a\\"b\\\\c"');
  });
});

describe("colorIs / colorIsNone → SQL of the SHOWN color", () => {
  it("manual only (no rules): the stored color, path bound as a parameter", () => {
    const r = t({ columnId: "name", operator: "colorIs", value: ["red", "blue"] }, withColors(undefined));
    const shown = MANUAL;
    expect(r.sql).toBe(`(${shown} IS NOT NULL AND ${shown} IN ('red', 'blue'))`);
    expect(r.params).toEqual(['$."name"', '$."name"']);
    const none = t({ columnId: "name", operator: "colorIsNone" }, withColors(undefined));
    expect(none.sql).toBe(`(${shown} IS NULL)`);
    expect(none.params).toEqual(['$."name"']);
  });

  it("COALESCE(manual, CASE <cells rules for the column>, CASE <row rules>), rule `when` compiled by translateFilter", () => {
    const rules: ColorRule[] = [
      { id: "row1", color: "gray", target: { kind: "row" }, when: bigFee },
      { id: "c1", color: "green", target: { kind: "cells", columnIds: ["name", "fee"] }, when: paid },
      { id: "c2", color: "red", target: { kind: "cells", columnIds: ["fee"] }, when: bigFee }, // other column
      { id: "off", color: "pink", target: { kind: "cells", columnIds: ["name"] }, when: paid, enabled: false },
      { id: "never", color: "teal", target: { kind: "cells", columnIds: ["name"] }, when: null },
      { id: "c3", color: "yellow", target: { kind: "cells", columnIds: ["name"] }, when: bigFee },
    ];
    const r = t({ columnId: "name", operator: "colorIs", value: ["green"] }, withColors(rules));
    const w1 = when(paid);
    const w3 = when(bigFee);
    const manual = "JSON_UNQUOTE(JSON_EXTRACT(`sg_colors`.`colors`, ?))";
    const shown = `COALESCE(${manual}, CASE WHEN ${w1.sql} THEN 'green' WHEN ${w3.sql} THEN 'yellow' END, CASE WHEN ${w3.sql} THEN 'gray' END)`;
    expect(r.sql).toBe(`(${shown} IS NOT NULL AND ${shown} IN ('green'))`);
    const once = ['$."name"', ...w1.params, ...w3.params, ...w3.params];
    expect(r.params).toEqual([...once, ...once]);
  });

  it("without a store the manual part is left out (rules-only); nothing at all → constant", () => {
    const rules: ColorRule[] = [{ id: "r", color: "blue", target: { kind: "row" }, when: paid }];
    const r = t({ columnId: "fee", operator: "colorIsNone" }, withColors(rules, false));
    expect(r.sql).toBe(`(CASE WHEN ${when(paid).sql} THEN 'blue' END IS NULL)`);
    expect(t({ columnId: "fee", operator: "colorIs", value: ["red"] }, makeScope(ctx)).sql).toBe("FALSE");
    expect(t({ columnId: "fee", operator: "colorIsNone" }, makeScope(ctx)).sql).toBe("TRUE");
  });

  it("an empty AND `when` matches every row (TRUE); only palette colors are ever inlined", () => {
    const rules = [
      { id: "all", color: "purple", target: { kind: "row" }, when: { op: "and", children: [] } },
      { id: "bad", color: "'; DROP TABLE x; --", target: { kind: "row" }, when: paid },
    ] as unknown as ColorRule[];
    const r = t({ columnId: "fee", operator: "colorIs", value: ["purple", "nope' OR 1=1"] as never }, withColors(rules, false));
    expect(r.sql).toBe("(CASE WHEN TRUE THEN 'purple' END IS NOT NULL AND CASE WHEN TRUE THEN 'purple' END IN ('purple'))");
    const none = t({ columnId: "fee", operator: "colorIs", value: ["nope"] as never }, withColors(rules, false));
    expect(none.sql).toBe("FALSE");
  });

  it("composes with other conditions and stays inside groups", () => {
    const r = t(
      { op: "or", children: [paid, { columnId: "fee", operator: "colorIsNone" }] },
      withColors(undefined),
    );
    expect(r.sql).toBe(`(${when(paid).sql} OR (JSON_UNQUOTE(JSON_EXTRACT(\`sg_colors\`.\`colors\`, ?)) IS NULL))`);
  });

  it("a color condition inside a rule's own `when` never matches (no recursion)", () => {
    const rules = [
      { id: "loop", color: "red", target: { kind: "row" }, when: { columnId: "name", operator: "colorIs", value: ["red"] } },
    ] as ColorRule[];
    const r = t({ columnId: "fee", operator: "colorIs", value: ["red"] }, withColors(rules, false));
    expect(r.sql).toBe("(CASE WHEN FALSE THEN 'red' END IS NOT NULL AND CASE WHEN FALSE THEN 'red' END IN ('red'))");
  });

  it("shownColorExpr is exposed for other translators", () => {
    const expr = shownColorExpr("name", withColors(undefined), translateFilter);
    if (!expr) throw new Error("expected SQL");
    expect(renderSql(expr).sql).toBe("JSON_UNQUOTE(JSON_EXTRACT(`sg_colors`.`colors`, ?))");
    expect(shownColorExpr("name", makeScope(ctx), translateFilter)).toBeUndefined();
  });
});
