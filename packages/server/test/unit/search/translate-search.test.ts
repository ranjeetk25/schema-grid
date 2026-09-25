import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Access } from "../../../src/internal/core";
import { translateSearch } from "../../../src/search/translate-search";
import { allTypesSchema, col, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

function accessAllReadable(schema = allTypesSchema()): Map<string, Access> {
  return new Map(schema.columns.map((c) => [c.id, "read" as Access]));
}

describe("translateSearch", () => {
  it("returns undefined for a blank term", () => {
    const scope = makeScope();
    expect(translateSearch(undefined, accessAllReadable(), scope)).toBeUndefined();
    expect(translateSearch("", accessAllReadable(), scope)).toBeUndefined();
    expect(translateSearch("   \t  ", accessAllReadable(), scope)).toBeUndefined();
  });

  it("excludes hidden columns", () => {
    const schema = allTypesSchema();
    const scope = makeScope(makeCtx(schema));
    const access = accessAllReadable(schema);
    access.set("name", "hidden");
    const withHidden = renderSql(translateSearch("abc", access, scope)!).sql;
    const allReadable = renderSql(translateSearch("abc", accessAllReadable(schema), scope)!).sql;
    expect(withHidden).not.toContain("`cells`, '$.name'");
    expect(allReadable).toContain("`cells`, '$.name'");
  });

  it("excludes number, date and datetime columns", () => {
    const schema = allTypesSchema();
    const scope = makeScope(makeCtx(schema));
    const rendered = renderSql(translateSearch("abc", accessAllReadable(schema), scope)!).sql;
    expect(rendered).not.toContain("$.fee");
    expect(rendered).not.toContain("$.paid");
    expect(rendered).not.toContain("$.indexedFee");
    expect(rendered).not.toContain("$.callDate");
    expect(rendered).not.toContain("$.calledAt");
  });

  it("escapes LIKE wildcards", () => {
    const schema = allTypesSchema([]);
    const single = { id: "grid_one", schemaVersion: 1, columns: [col("name", "text")] };
    const scope = makeScope(makeCtx(single));
    const { sql: rendered, params } = renderSql(translateSearch("50%", accessAllReadable(single), scope)!);
    expect(rendered).toContain("LIKE");
    expect(params).toEqual(["%50\\%%"]);
  });

  it("returns undefined when nothing is searchable", () => {
    const single = { id: "grid_num", schemaVersion: 1, columns: [col("fee", "number")] };
    const scope = makeScope(makeCtx(single));
    expect(translateSearch("abc", accessAllReadable(single), scope)).toBeUndefined();
  });

  it("snapshot: three text-like columns give three OR branches sharing the same param", () => {
    const schema = {
      id: "grid_three",
      schemaVersion: 1,
      columns: [col("name", "text"), col("status", "select"), col("owner", "user")],
    };
    const scope = makeScope(makeCtx(schema));
    const { sql: rendered, params } = renderSql(translateSearch("bob", accessAllReadable(schema), scope)!);
    expect(rendered).toMatchInlineSnapshot(
      `"(JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name')) COLLATE utf8mb4_0900_ai_ci LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.status')) COLLATE utf8mb4_0900_ai_ci LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.owner.id')) COLLATE utf8mb4_0900_ai_ci LIKE ?)"`,
    );
    expect(params).toEqual(["%bob%", "%bob%", "%bob%"]);
  });

  it("includes a formula column only when its plan is inline/generated with text result", () => {
    const schema = {
      id: "grid_formula",
      schemaVersion: 1,
      columns: [col("full", "formula", { formula: "{name}", config: { resultType: "text" } })],
    };
    const access = accessAllReadable(schema);
    const scopeNoPlan = makeScope(makeCtx(schema));
    expect(translateSearch("abc", access, scopeNoPlan)).toBeUndefined();

    const scopeFallback = makeScope(makeCtx(schema), {
      formulaPlans: new Map([["full", { mode: "fallback" as const, resultKind: "text" as const }]]),
    });
    expect(translateSearch("abc", access, scopeFallback)).toBeUndefined();

    const scopeInline = makeScope(makeCtx(schema), {
      formulaPlans: new Map([
        [
          "full",
          {
            mode: "inline" as const,
            resultKind: "text" as const,
            sql: sql`JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))`,
          },
        ],
      ]),
    });
    const rendered = renderSql(translateSearch("abc", access, scopeInline)!).sql;
    expect(rendered).toContain("LIKE");
  });
});
