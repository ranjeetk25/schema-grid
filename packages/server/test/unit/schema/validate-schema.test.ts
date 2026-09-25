import { formulaTranslatability } from "../../../src/formula/formula-plan";
import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../../../src/errors";
import { assertValidSchema, validateSchema } from "../../../src/schema/validate-schema";
import { createDefaultRegistry, type GridSchema } from "../../../src/internal/core";
import { allTypesSchema, col } from "../../helpers/schemas";

const registry = createDefaultRegistry();

function schemaOf(columns: ReturnType<typeof col>[], extra: Partial<GridSchema> = {}): GridSchema {
  return { id: "grid_test", schemaVersion: 1, columns, ...extra };
}

function codes(result: ReturnType<typeof validateSchema>): string[] {
  return result.issues.map((i) => i.code);
}

describe("validateSchema", () => {
  it("accepts the all-types fixture with its physical column declared", () => {
    const result = validateSchema(allTypesSchema(), registry, { physicalColumns: ["email_addr"] });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects a non-integer schemaVersion", () => {
    const schema = schemaOf([col("name", "text")], { schemaVersion: 1.5 });
    const result = validateSchema(schema, registry);
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("invalidSchemaVersion");
  });

  it("rejects a negative schemaVersion", () => {
    const schema = schemaOf([col("name", "text")], { schemaVersion: -1 });
    const result = validateSchema(schema, registry);
    expect(codes(result)).toContain("invalidSchemaVersion");
  });

  it("flags a duplicate column id", () => {
    const schema = schemaOf([col("dup", "text"), col("dup", "number", { key: "other" })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "duplicateId");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("dup");
  });

  it("flags a duplicate column key", () => {
    const schema = schemaOf([col("a", "text", { key: "dupKey" }), col("b", "number", { key: "dupKey" })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "duplicateKey");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("b");
  });

  it("flags an unsafe column key", () => {
    const schema = schemaOf([col("a", "text", { key: "bad-key" })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "unsafeKey");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("a");
  });

  it("flags an unregistered field type", () => {
    const schema = schemaOf([col("a", "mystery")]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "unknownType");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("a");
  });

  it("flags config that fails the type's configSchema", () => {
    const schema = schemaOf([col("status", "select", { config: { options: "not-an-array" } })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "invalidConfig");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("status");
    expect(issue?.message).toBeTruthy();
  });

  it("flags a formula string on a non-formula column", () => {
    const schema = schemaOf([col("a", "number"), col("b", "text", { formula: "{a}" })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "unexpectedFormula");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("b");
  });

  it("flags a formula column missing its formula", () => {
    const schema = schemaOf([col("a", "number"), col("b", "formula", { config: { resultType: "number" } })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "missingFormula");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("b");
  });

  it("flags a formula that fails to parse", () => {
    const schema = schemaOf([
      col("a", "number"),
      col("b", "formula", { formula: "{a} +", config: { resultType: "number" } }),
    ]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "formulaSyntax");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("b");
  });

  it("flags a formula referencing an unknown column", () => {
    const schema = schemaOf([col("a", "number"), col("b", "formula", { formula: "{missing} + 1", config: { resultType: "number" } })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "formulaUnknownRef");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("b");
  });

  it("flags every column in a formula cycle", () => {
    const schema = schemaOf([
      col("cycA", "formula", { formula: "{cycB} + 1", config: { resultType: "number" } }),
      col("cycB", "formula", { formula: "{cycA} + 1", config: { resultType: "number" } }),
    ]);
    const result = validateSchema(schema, registry);
    const cycleIssues = result.issues.filter((i) => i.code === "formulaCycle");
    expect(cycleIssues.map((i) => i.columnId).sort()).toEqual(["cycA", "cycB"]);
  });

  it("flags a formula column that declares a source", () => {
    const schema = schemaOf([
      col("a", "number"),
      col("b", "formula", {
        formula: "{a} + 1",
        config: { resultType: "number" },
        source: { valueField: "phys" },
      }),
    ]);
    const result = validateSchema(schema, registry, { physicalColumns: ["phys"] });
    const issue = result.issues.find((i) => i.code === "invalidSource");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("b");
  });

  it("flags a source.valueField that isn't a declared physical column", () => {
    const schema = schemaOf([col("a", "email", { source: { valueField: "email_addr" } })]);
    const result = validateSchema(schema, registry, { physicalColumns: ["other_col"] });
    const issue = result.issues.find((i) => i.code === "unknownValueField");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("a");
  });

  it("flags any source.valueField when no physical columns are declared", () => {
    const schema = schemaOf([col("a", "email", { source: { valueField: "email_addr" } })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "unknownValueField");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("a");
  });

  it("flags two columns sharing the same source.valueField", () => {
    const schema = schemaOf([
      col("a", "email", { source: { valueField: "shared" } }),
      col("b", "text", { source: { valueField: "shared" } }),
    ]);
    const result = validateSchema(schema, registry, { physicalColumns: ["shared"] });
    const issue = result.issues.find((i) => i.code === "duplicateValueField");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("b");
  });

  it("flags an indexed longText column", () => {
    const schema = schemaOf([col("notes", "longText", { indexed: true })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "notIndexable");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("notes");
  });

  it("flags an indexed formula that is not SQL-translatable", () => {
    const schema = schemaOf([
      col("name", "text"),
      col("label", "formula", {
        formula: 'CONCAT({name}, "!")',
        indexed: true,
        config: { resultType: "text" },
      }),
    ]);
    // without the drizzle-side hook the check is skipped (root entry stays drizzle-free)
    expect(validateSchema(schema, registry).issues.some((i) => i.code === "formulaNotTranslatable")).toBe(false);
    const result = validateSchema(schema, registry, { isFormulaTranslatable: formulaTranslatability() });
    const issue = result.issues.find((i) => i.code === "formulaNotTranslatable");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("label");
  });

  it("does not flag an indexed formula that is SQL-translatable", () => {
    const schema = schemaOf([
      col("fee", "number"),
      col("discount", "number"),
      col("net", "formula", {
        formula: "{fee} - {discount}",
        indexed: true,
        config: { resultType: "number" },
      }),
    ]);
    const result = validateSchema(schema, registry, { isFormulaTranslatable: formulaTranslatability() });
    expect(result.issues.filter((i) => i.columnId === "net")).toEqual([]);
  });

  it("flags a defaultValue that fails the type's valueSchema", () => {
    const schema = schemaOf([col("count", "number", { defaultValue: "not-a-number" })]);
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "invalidDefault");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("count");
  });

  it("flags a view sort referencing a missing column", () => {
    const schema = schemaOf([col("name", "text")], {
      views: [
        {
          id: "v1",
          name: "View 1",
          filter: null,
          sort: [{ columnId: "missing", dir: "asc" }],
          columnState: [],
          groupBy: [],
          pageSize: 25,
        },
      ],
    });
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "viewUnknownColumn");
    expect(issue).toBeDefined();
    expect(issue?.columnId).toBe("missing");
    expect(issue?.path[0]).toBe("views");
  });

  it("flags a view groupBy aggregation referencing a missing column", () => {
    const schema = schemaOf([col("name", "text")], {
      views: [
        {
          id: "v1",
          name: "View 1",
          filter: null,
          sort: [],
          columnState: [],
          groupBy: [{ columnId: "name", aggregations: [{ columnId: "missing", agg: "count" }] }],
          pageSize: 25,
        },
      ],
    });
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "viewUnknownColumn" && i.columnId === "missing");
    expect(issue).toBeDefined();
  });

  it("flags a view filter that fails validateFilter with all columns readable", () => {
    const schema = schemaOf([col("name", "text")], {
      views: [
        {
          id: "v1",
          name: "View 1",
          filter: { columnId: "name", operator: "eq" },
          sort: [],
          columnState: [],
          groupBy: [],
          pageSize: 25,
        },
      ],
    });
    const result = validateSchema(schema, registry);
    const issue = result.issues.find((i) => i.code === "viewInvalidFilter");
    expect(issue).toBeDefined();
    expect(issue?.path[0]).toBe("views");
  });

  it("reports several unrelated issues together instead of stopping at the first", () => {
    const schema = schemaOf(
      [
        col("a", "text", { key: "bad-key" }),
        col("b", "mystery"),
        col("c", "number", { defaultValue: "nope" }),
      ],
      { schemaVersion: -1 },
    );
    const result = validateSchema(schema, registry);
    const found = new Set(codes(result));
    expect(found.has("invalidSchemaVersion")).toBe(true);
    expect(found.has("unsafeKey")).toBe(true);
    expect(found.has("unknownType")).toBe(true);
    expect(found.has("invalidDefault")).toBe(true);
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
  });

  it("assertValidSchema throws SchemaValidationError carrying all issues", () => {
    const schema = schemaOf([col("a", "mystery")]);
    expect(() => assertValidSchema(schema, registry)).toThrow(SchemaValidationError);
    try {
      assertValidSchema(schema, registry);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError);
      const err = e as SchemaValidationError;
      expect(err.issues.some((i) => i.code === "unknownType")).toBe(true);
    }
  });

  it("assertValidSchema does not throw for a valid schema", () => {
    const schema = schemaOf([col("name", "text")]);
    expect(() => assertValidSchema(schema, registry)).not.toThrow();
  });
});
