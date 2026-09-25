import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as fieldTypes from "../src/field-types/index";
import * as filter from "../src/filter/index";
import * as formula from "../src/formula/index";
import * as root from "../src/index";
import * as memory from "../src/memory/index";
import * as testing from "../src/testing/index";
import * as wire from "../src/wire/index";

const keys = (m: object) => Object.keys(m).sort();

describe("public entry points", () => {
  it("root exposes exactly its documented runtime names", () => {
    expect(keys(root)).toMatchInlineSnapshot(`
      [
        "BOOLEAN_OPERATORS",
        "BUILTIN_FIELD_TYPE_IDS",
        "DATE_OPERATORS",
        "DEFAULT_CAPABILITIES",
        "DEFAULT_TIME_ZONE",
        "FORMULA_FUNCTIONS",
        "LINK_OPERATORS",
        "MAX_FILTER_DEPTH",
        "MULTI_SELECT_OPERATORS",
        "NEGATIVE_OPERATOR_IDS",
        "NUMBER_OPERATORS",
        "RELATIVE_DATE_PRESETS",
        "SELECT_OPERATORS",
        "SchemaMigrationError",
        "TEXT_OPERATORS",
        "UNIVERSAL_AGGREGATIONS",
        "USER_OPERATORS",
        "applyEffectiveCapabilities",
        "columnTypeToFormulaType",
        "computeAggregate",
        "createRolePermissionResolver",
        "dependencies",
        "detectFormulaCycles",
        "editableColumnIds",
        "evaluate",
        "findOperator",
        "getColumnById",
        "getColumnByKey",
        "getDataSourceCapabilities",
        "getFormulaEvaluationOrder",
        "getFormulaFunction",
        "indexColumns",
        "inferCapabilities",
        "inferResultType",
        "isAggregationAllowed",
        "isFilterCondition",
        "isFilterGroup",
        "isFormulaError",
        "isNegativeOperator",
        "matchesFilter",
        "mergeCapabilities",
        "migrateSchema",
        "normalizeCapabilities",
        "parseFormula",
        "readableColumnIds",
        "resolveColumnAccess",
        "resolveRelativeDate",
        "tokenize",
        "validateFilter",
        "validateFormulaColumns",
      ]
    `);
  });

  it("./field-types exposes exactly its documented runtime names", () => {
    expect(keys(fieldTypes)).toMatchInlineSnapshot(`
      [
        "booleanFieldType",
        "builtinFieldTypes",
        "compareWithEmptyLast",
        "creatableSelectFieldType",
        "createDefaultRegistry",
        "createFieldTypeRegistry",
        "currencyFieldType",
        "dateFieldType",
        "datetimeFieldType",
        "emailFieldType",
        "formulaFieldType",
        "getColumnAggregations",
        "getColumnFieldType",
        "getColumnOperators",
        "getColumnValueFieldType",
        "isEmptyValue",
        "linkFieldType",
        "longTextFieldType",
        "multiSelectFieldType",
        "numberFieldType",
        "phoneFieldType",
        "resolveFormulaOperandTypeId",
        "selectFieldType",
        "textFieldType",
        "urlFieldType",
        "userFieldType",
      ]
    `);
  });

  it("./filter exposes exactly its documented runtime names", () => {
    expect(keys(filter)).toMatchInlineSnapshot(`
      [
        "BOOLEAN_OPERATORS",
        "DATE_OPERATORS",
        "LINK_OPERATORS",
        "MAX_FILTER_DEPTH",
        "MULTI_SELECT_OPERATORS",
        "NEGATIVE_OPERATOR_IDS",
        "NUMBER_OPERATORS",
        "RELATIVE_DATE_PRESETS",
        "SELECT_OPERATORS",
        "TEXT_OPERATORS",
        "USER_OPERATORS",
        "findOperator",
        "isFilterCondition",
        "isFilterGroup",
        "isNegativeOperator",
        "matchesFilter",
        "resolveRelativeDate",
        "validateFilter",
      ]
    `);
  });

  it("./formula exposes exactly its documented runtime names", () => {
    expect(keys(formula)).toMatchInlineSnapshot(`
      [
        "FORMULA_FUNCTIONS",
        "columnTypeToFormulaType",
        "dependencies",
        "detectFormulaCycles",
        "evaluate",
        "getFormulaEvaluationOrder",
        "getFormulaFunction",
        "inferResultType",
        "isFormulaError",
        "parseFormula",
        "tokenize",
        "validateFormulaColumns",
      ]
    `);
  });

  it("./memory exposes exactly its documented runtime names", () => {
    expect(keys(memory)).toMatchInlineSnapshot(`
      [
        "InMemoryMutationError",
        "InMemoryQueryError",
        "createInMemoryDataSource",
      ]
    `);
  });

  it("./testing exposes exactly its documented runtime names", () => {
    expect(keys(testing)).toMatchInlineSnapshot(`
      [
        "FIXTURE_COLUMN_IDS",
        "FIXTURE_NOW",
        "FIXTURE_TIME_ZONE",
        "FIXTURE_USERS",
        "createFixtureLinkTargets",
        "createFixtureRows",
        "createFixtureSchema",
        "fixtureRows",
        "fixtureSchema",
      ]
    `);
  });

  it("./wire exposes exactly its documented runtime names", () => {
    expect(keys(wire)).toMatchInlineSnapshot(`
      [
        "GRID_OPERATIONS",
        "GRID_SCHEMA_OPERATIONS",
        "OPTIONAL_GRID_OPERATIONS",
        "RemoteDataSourceError",
        "WIRE_ERROR_STATUS",
        "createDataSourceHandler",
        "createRemoteDataSource",
        "filterNodeSchema",
        "gridQuerySchema",
        "gridRowSchema",
        "gridSchemaSchema",
        "httpStatusFor",
        "isGridOperation",
        "isGridSchemaOperation",
        "isWireError",
        "isWireErrorCode",
        "toWireError",
        "unwrapWireResult",
        "wireSchemas",
      ]
    `);
  });

  it("the root entry does not pull in the wire module", () => {
    expect(keys(root)).not.toContain("createDataSourceHandler");
    expect(keys(root)).not.toContain("wireSchemas");
  });

  it("spec §4 binding names are importable from their entries", () => {
    for (const fn of [
      root.migrateSchema,
      fieldTypes.createDefaultRegistry,
      filter.validateFilter,
      filter.resolveRelativeDate,
      filter.matchesFilter,
      root.createRolePermissionResolver,
      root.resolveColumnAccess,
      root.computeAggregate,
      formula.parseFormula,
      formula.inferResultType,
      formula.evaluate,
      formula.dependencies,
      memory.createInMemoryDataSource,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("the root entry does not pull in the memory module", () => {
    expect(keys(root)).not.toContain("createInMemoryDataSource");
    expect(keys(root)).not.toContain("InMemoryQueryError");
  });

  it("package.json is side-effect free and every export has types/import/require", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      sideEffects: boolean;
      exports: Record<string, string | Record<string, string>>;
    };
    expect(pkg.sideEffects).toBe(false);
    const entries = [".", "./field-types", "./formula", "./filter", "./memory", "./testing", "./wire"];
    for (const key of entries) {
      const target = pkg.exports[key];
      expect(typeof target).toBe("object");
      if (typeof target !== "object") continue;
      expect(Object.keys(target)).toEqual(["development", "types", "import", "require"]);
      const base = key === "." ? "index" : `${key.slice(2)}/index`;
      expect(target).toEqual({
        development: `./src/${base}.ts`,
        types: `./dist/${base}.d.ts`,
        import: `./dist/${base}.js`,
        require: `./dist/${base}.cjs`,
      });
    }
  });
});
