import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { UnsupportedOperatorError } from "../../../src/errors";
import { translateSort } from "../../../src/sort/translate-sort";
import { allTypesSchema, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema = allTypesSchema();

function orderSql(orderBy: import("drizzle-orm").SQL[]) {
  return renderSql(sql.join(orderBy, sql`, `));
}

describe("translateSort", () => {
  it("empty sort gives ORDER BY id ASC only", () => {
    const { orderBy, keys } = translateSort([], makeScope());
    expect(keys).toEqual([]);
    expect(orderSql(orderBy).sql).toBe("`id` ASC");
  });

  it("a number sort uses the DECIMAL cast", () => {
    const { orderBy } = translateSort([{ columnId: "fee", dir: "asc" }], makeScope());
    expect(orderSql(orderBy).sql).toMatchInlineSnapshot(
      `"(CASE WHEN (JSON_EXTRACT(\`cells\`, '$.fee') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) = 'NULL') THEN 1 ELSE 0 END) ASC, CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) ASC, \`id\` ASC"`,
    );
  });

  it("a desc date sort keeps nulls last (nullFlag ASC precedes expr DESC)", () => {
    const { orderBy, keys } = translateSort([{ columnId: "callDate", dir: "desc" }], makeScope());
    const rendered = orderSql(orderBy).sql;
    expect(rendered.startsWith("(CASE WHEN")).toBe(true);
    expect(rendered).toContain("ASC, CAST(JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.callDate')) AS DATE) DESC");
    expect(rendered.endsWith("`id` ASC")).toBe(true);
    expect(keys[0]?.dir).toBe("desc");
  });

  it("every order list ends with id ASC", () => {
    const cases = [
      [{ columnId: "name", dir: "asc" as const }],
      [
        { columnId: "fee", dir: "desc" as const },
        { columnId: "name", dir: "asc" as const },
      ],
    ];
    for (const spec of cases) {
      const { orderBy } = translateSort(spec, makeScope());
      expect(orderSql(orderBy).sql.endsWith("`id` ASC")).toBe(true);
    }
  });

  it("a physical-source column sorts on the table column", () => {
    const { orderBy } = translateSort([{ columnId: "contactEmail", dir: "asc" }], makeScope());
    expect(orderSql(orderBy).sql).toBe(
      "(CASE WHEN (`email_addr` IS NULL OR `email_addr` = '') THEN 1 ELSE 0 END) ASC, `email_addr` ASC, `id` ASC",
    );
  });

  it("an indexed column sorts on gc_<key>", () => {
    const { orderBy } = translateSort([{ columnId: "indexedFee", dir: "asc" }], makeScope());
    expect(orderSql(orderBy).sql).toBe(
      "(CASE WHEN (`gc_indexedFee` IS NULL) THEN 1 ELSE 0 END) ASC, `gc_indexedFee` ASC, `id` ASC",
    );
  });

  it("a multiSelect sort throws UnsupportedOperatorError", () => {
    expect(() => translateSort([{ columnId: "tags", dir: "asc" }], makeScope())).toThrow(UnsupportedOperatorError);
  });

  it("a json-kind sort throws UnsupportedOperatorError", () => {
    const scope = makeScope(makeCtx(schema), { storageOverrides: { text: { kind: "json" } } });
    expect(() => translateSort([{ columnId: "name", dir: "asc" }], scope)).toThrow(UnsupportedOperatorError);
  });

  it("an unknown column id throws UnsupportedOperatorError", () => {
    expect(() => translateSort([{ columnId: "nope", dir: "asc" }], makeScope())).toThrow(UnsupportedOperatorError);
  });

  it("SortKey carries columnId, dir, expr and nullFlag", () => {
    const { keys } = translateSort([{ columnId: "name", dir: "asc" }], makeScope());
    expect(keys).toHaveLength(1);
    expect(keys[0]?.columnId).toBe("name");
    expect(keys[0]?.dir).toBe("asc");
    expect(renderSql(keys[0]!.expr).sql).toContain("$.name");
    expect(renderSql(keys[0]!.nullFlag).sql).toContain("CASE WHEN");
  });
});
