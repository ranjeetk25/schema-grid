import { describe, expect, it } from "vitest";
import { generatedColumnDDL, dropGeneratedColumnDDL, formulaSqlHook } from "../../../src/ddl/generated-columns";
import { SchemaValidationError } from "../../../src/errors";
import { typedJsonExpr } from "../../../src/sql/column-expr";
import { allTypesSchema, col, column, makeCtx, makeScope } from "../../helpers/schemas";
import { renderSql } from "../../helpers/sql";

const schema = allTypesSchema();
const TABLE = "grid_rows";

describe("generatedColumnDDL", () => {
  it("emits the ALTER for a text column", () => {
    const stmt = generatedColumnDDL(TABLE, column(schema, "name"));
    expect(stmt.sql).toMatchInlineSnapshot(
      `"ALTER TABLE \`grid_rows\` ADD COLUMN \`gc_name\` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci GENERATED ALWAYS AS (IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.name')) = 'NULL', NULL, JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.name'))) COLLATE utf8mb4_0900_as_ci) VIRTUAL, ADD INDEX \`idx_gc_name\` (\`gc_name\`)"`,
    );
  });

  it("emits the ALTER for a number column", () => {
    const stmt = generatedColumnDDL(TABLE, column(schema, "fee"));
    expect(stmt.sql).toMatchInlineSnapshot(
      `"ALTER TABLE \`grid_rows\` ADD COLUMN \`gc_fee\` DECIMAL(38,10) GENERATED ALWAYS AS ((CASE WHEN JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.fee')) IN ('INTEGER', 'UNSIGNED INTEGER', 'DOUBLE', 'DECIMAL') THEN CAST(JSON_EXTRACT(\`cells\`, '$.fee') AS DECIMAL(38,10)) END)) VIRTUAL, ADD INDEX \`idx_gc_fee\` (\`gc_fee\`)"`,
    );
  });

  it("emits the ALTER for a date column", () => {
    const stmt = generatedColumnDDL(TABLE, column(schema, "callDate"));
    expect(stmt.sql).toMatchInlineSnapshot(
      `"ALTER TABLE \`grid_rows\` ADD COLUMN \`gc_callDate\` DATE GENERATED ALWAYS AS (CAST(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.callDate')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.callDate')), NULL) AS DATE)) VIRTUAL, ADD INDEX \`idx_gc_callDate\` (\`gc_callDate\`)"`,
    );
  });

  it("emits the ALTER for a datetime column", () => {
    const stmt = generatedColumnDDL(TABLE, column(schema, "calledAt"));
    expect(stmt.sql).toMatchInlineSnapshot(
      `"ALTER TABLE \`grid_rows\` ADD COLUMN \`gc_calledAt\` DATETIME(3) GENERATED ALWAYS AS (CAST(REPLACE(REPLACE(IF(JSON_TYPE(JSON_EXTRACT(\`cells\`, '$.calledAt')) = 'STRING', JSON_UNQUOTE(JSON_EXTRACT(\`cells\`, '$.calledAt')), NULL), 'T', ' '), 'Z', '') AS DATETIME(3))) VIRTUAL, ADD INDEX \`idx_gc_calledAt\` (\`gc_calledAt\`)"`,
    );
  });

  it("uses exactly the same typed JSON expression as T5 for each kind", () => {
    for (const id of ["name", "fee", "callDate", "calledAt", "paymentStatus", "owner"]) {
      const c = column(schema, id);
      const stmt = generatedColumnDDL(TABLE, c);
      const kind =
        id === "name"
          ? "text"
          : id === "fee"
            ? "number"
            : id === "callDate"
              ? "date"
              : id === "calledAt"
                ? "datetime"
                : id === "paymentStatus"
                  ? "choice"
                  : "ref";
      const subPath = id === "owner" ? "id" : undefined;
      const expected = renderSql(typedJsonExpr(c.key, kind as never, subPath)).sql;
      expect(stmt.sql).toContain(expected);
    }
  });

  it("rejects a multiSelect column", () => {
    expect(() => generatedColumnDDL(TABLE, column(schema, "tags"))).toThrow(SchemaValidationError);
    try {
      generatedColumnDDL(TABLE, column(schema, "tags"));
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError);
      expect((e as SchemaValidationError).issues[0]).toMatchObject({ code: "notIndexable", columnId: "tags" });
    }
  });

  it("rejects a link column (also a multi kind)", () => {
    expect(() => generatedColumnDDL(TABLE, column(schema, "links"))).toThrow(SchemaValidationError);
  });

  it("rejects a longText column", () => {
    expect(() => generatedColumnDDL(TABLE, column(schema, "notes"))).toThrow(SchemaValidationError);
    try {
      generatedColumnDDL(TABLE, column(schema, "notes"));
    } catch (e) {
      expect((e as SchemaValidationError).issues[0]).toMatchObject({ code: "notIndexable", columnId: "notes" });
    }
  });

  it("rejects a physical-source column", () => {
    expect(() => generatedColumnDDL(TABLE, column(schema, "contactEmail"))).toThrow(SchemaValidationError);
  });

  it("rejects an unknown/custom-typed column (json kind)", () => {
    const custom = col("rating", "rating");
    expect(() => generatedColumnDDL(TABLE, custom)).toThrow(SchemaValidationError);
  });

  describe("formula columns", () => {
    const formulaSchema = allTypesSchema([
      col("feeDouble", "formula", { formula: "{fee} * 2", config: { resultType: "number" }, indexed: true }),
    ]);
    const formulaColumn = column(formulaSchema, "feeDouble");
    const scope = makeScope(makeCtx(formulaSchema));

    it("produces a DECIMAL(38,10) DDL with zero bound params when a translatable hook is given", () => {
      const stmt = generatedColumnDDL(TABLE, formulaColumn, { formulaSql: formulaSqlHook(scope) });
      expect(stmt.sql).toContain("`gc_feeDouble` DECIMAL(38,10) GENERATED ALWAYS AS");
      expect(stmt.sql).not.toContain("?");
    });

    it("throws formulaNotTranslatable without the hook", () => {
      expect(() => generatedColumnDDL(TABLE, formulaColumn)).toThrow(SchemaValidationError);
      try {
        generatedColumnDDL(TABLE, formulaColumn);
      } catch (e) {
        expect((e as SchemaValidationError).issues[0]).toMatchObject({
          code: "formulaNotTranslatable",
          columnId: "feeDouble",
        });
      }
    });

    it("throws formulaNotTranslatable when the hook returns null", () => {
      expect(() => generatedColumnDDL(TABLE, formulaColumn, { formulaSql: () => null })).toThrow(SchemaValidationError);
    });
  });
});

describe("dropGeneratedColumnDDL", () => {
  it("drops the index before the column", () => {
    const stmt = dropGeneratedColumnDDL(TABLE, "name");
    expect(stmt.sql).toMatchInlineSnapshot(
      `"ALTER TABLE \`grid_rows\` DROP INDEX \`idx_gc_name\`, DROP COLUMN \`gc_name\`"`,
    );
  });
});
