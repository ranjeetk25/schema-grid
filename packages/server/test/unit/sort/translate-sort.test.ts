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
      `"(CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN 1 ELSE 0 END) ASC, (CASE WHEN ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) IS NULL) THEN NULL ELSE (CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END) END) ASC, \`id\` ASC"`,
    );
  });

  it("a desc date sort keeps nulls last (nullFlag ASC precedes expr DESC)", () => {
    const { orderBy, keys } = translateSort([{ columnId: "callDate", dir: "desc" }], makeScope());
    const rendered = orderSql(orderBy).sql;
    expect(rendered.startsWith("(CASE WHEN")).toBe(true);
    expect(rendered).toContain(
      "THEN NULL ELSE CAST(IF(JSON_TYPE(JSON_EXTRACT(`cells`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(`cells`, '$.callDate')), NULL) AS DATE) END) DESC",
    );
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
      "(CASE WHEN (`email_addr` IS NULL OR REGEXP_LIKE(`email_addr`, '^[[:space:]]*$')) THEN 1 ELSE 0 END) ASC, " +
        "(CASE WHEN (`email_addr` IS NULL OR REGEXP_LIKE(`email_addr`, '^[[:space:]]*$')) THEN NULL ELSE `email_addr` END) ASC, `id` ASC",
    );
  });

  it("an indexed column sorts on gc_<key>", () => {
    const { orderBy } = translateSort([{ columnId: "indexedFee", dir: "asc" }], makeScope());
    expect(orderSql(orderBy).sql).toBe(
      "(CASE WHEN (`gc_indexedFee` IS NULL) THEN 1 ELSE 0 END) ASC, " +
        "(CASE WHEN (`gc_indexedFee` IS NULL) THEN NULL ELSE `gc_indexedFee` END) ASC, `id` ASC",
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

  it("the value term is NULL for empty rows (CASE WHEN <empty> THEN NULL ELSE <typed> END)", () => {
    const { keys } = translateSort([{ columnId: "fee", dir: "asc" }], makeScope());
    const rendered = renderSql(keys[0]!.expr).sql;
    expect(rendered).toMatch(/^\(CASE WHEN .+ THEN NULL ELSE .+ END\)$/);
    expect(rendered).toContain("THEN NULL ELSE");
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
