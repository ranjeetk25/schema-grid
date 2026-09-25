import { describe, expect, it } from "vitest";
import { UnsupportedOperatorError } from "../../../src/errors";
import { datetimeCast, isEmptyExpr, resolveColumnExpr, typedJsonExpr } from "../../../src/sql/column-expr";
import { storageKindOf } from "../../../src/sql/storage-kind";
import { sql } from "drizzle-orm";
import { allTypesSchema, column, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema = allTypesSchema();
const scope = makeScope(makeCtx(schema));
const typed = (id: string) => renderSql(resolveColumnExpr(column(schema, id), scope).typed);

describe("storageKindOf", () => {
  it("maps built-ins", () => {
    const kinds = Object.fromEntries(schema.columns.map((c) => [c.id, storageKindOf(c).kind]));
    expect(kinds).toMatchObject({
      name: "text",
      notes: "text",
      site: "text",
      email: "text",
      phone: "text",
      fee: "number",
      paid: "number",
      isActive: "boolean",
      callDate: "date",
      calledAt: "datetime",
      paymentStatus: "choice",
      source: "choice",
      tags: "multi",
      owner: "ref",
      links: "multi",
      balance: "number",
    });
    expect(storageKindOf({ ...column(schema, "name"), type: "rating" }).kind).toBe("json");
    expect(storageKindOf({ ...column(schema, "name"), type: "rating" }, undefined, { rating: { kind: "number" } }).kind).toBe(
      "number",
    );
  });
});

describe("resolveColumnExpr", () => {
  it("typed JSON expression per kind", () => {
    expect({
      text: typed("name").sql,
      number: typed("fee").sql,
      date: typed("callDate").sql,
      datetime: typed("calledAt").sql,
      boolean: typed("isActive").sql,
      choice: typed("paymentStatus").sql,
      ref: typed("owner").sql,
      multi: typed("tags").sql,
      link: typed("links").sql,
    }).toMatchInlineSnapshot(`
      {
        "boolean": "(JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.isActive')) = 'true')",
        "choice": "JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.paymentStatus')) COLLATE utf8mb4_0900_ai_ci",
        "date": "CAST(JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')) AS DATE)",
        "datetime": "CAST(REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.calledAt')), 'T', ' '), 'Z', '') AS DATETIME(3))",
        "link": "JSON_EXTRACT(\`cells\`, '$.links[*].id')",
        "multi": "JSON_EXTRACT(\`cells\`, '$.tags')",
        "number": "CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10))",
        "ref": "JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.owner.id')) COLLATE utf8mb4_0900_ai_ci",
        "text": "JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name')) COLLATE utf8mb4_0900_ai_ci",
      }
    `);
    expect(typed("name").params).toEqual([]);
  });

  it("physical source resolves to the table column", () => {
    const e = resolveColumnExpr(column(schema, "contactEmail"), scope);
    expect(e.source).toBe("physical");
    expect(renderSql(e.typed).sql).toBe("`email_addr`");
    expect(renderSql(e.empty).sql).toBe("(`email_addr` IS NULL OR `email_addr` = '')");
  });

  it("indexed column resolves to gc_<key>, or JSON when generated columns are ignored", () => {
    const e = resolveColumnExpr(column(schema, "indexedFee"), scope);
    expect(e.source).toBe("generated");
    expect(renderSql(e.typed).sql).toBe("`gc_indexedFee`");
    const j = resolveColumnExpr(column(schema, "indexedFee"), makeScope(makeCtx(schema), { generatedColumns: "ignore" }));
    expect(j.source).toBe("json");
    expect(renderSql(j.typed).sql).toBe("CAST(JSON_EXTRACT(`cells`, '$.indexedFee') AS DECIMAL(38,10))");
  });

  it("datetime cast is the shared constant used by generated columns", () => {
    const shared = renderSql(datetimeCast(sql`JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.calledAt'))`)).sql;
    expect(typed("calledAt").sql).toBe(shared);
    expect(renderSql(typedJsonExpr("calledAt", "datetime")).sql).toBe(shared);
  });

  it("isEmptyExpr covers absent, JSON null, '' and []", () => {
    expect(renderSql(isEmptyExpr(column(schema, "tags"), scope)).sql).toMatchInlineSnapshot(
      `"(JSON_EXTRACT(\`cells\`, '$.tags') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.tags')) = 'NULL' OR JSON_LENGTH(JSON_EXTRACT(\`cells\`, '$.tags')) = 0)"`,
    );
    expect(renderSql(isEmptyExpr(column(schema, "name"), scope)).sql).toMatchInlineSnapshot(
      `"(JSON_EXTRACT(\`cells\`, '$.name') IS NULL OR JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL' OR JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name')) COLLATE utf8mb4_0900_ai_ci = '')"`,
    );
    expect(renderSql(isEmptyExpr(column(schema, "fee"), scope)).sql).not.toContain("= ''");
  });

  it("formula columns without a plan are not translatable", () => {
    expect(() => resolveColumnExpr(column(schema, "balance"), scope)).toThrow(UnsupportedOperatorError);
  });
});
