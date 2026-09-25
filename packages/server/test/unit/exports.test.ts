import { describe, expect, it, vi } from "vitest";

describe("public entry points", () => {
  it("`.` exposes exactly the documented runtime names", async () => {
    const mod = await import("../../src/index");
    expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
      [
        "CursorError",
        "DEFAULT_FORMULA_FALLBACK_ROW_CAP",
        "FilterValidationError",
        "FormulaQueryLimitError",
        "GroupingError",
        "PermissionError",
        "RowValidationError",
        "SCHEMA_GRID_SERVER_VERSION",
        "SchemaGridServerError",
        "SchemaValidationError",
        "UnsupportedOperatorError",
        "assertQueryAccess",
        "assertValidSchema",
        "createServerContext",
        "decodeCursor",
        "encodeCursor",
        "isReadable",
        "iterateQuery",
        "pinGroupFilter",
        "projectRow",
        "queryFingerprint",
        "resolveAccess",
        "runImportJob",
        "streamExport",
        "validateSchema",
      ]
    `);
  });

  it("`./drizzle` exposes exactly the documented runtime names", async () => {
    const mod = await import("../../src/drizzle/index");
    expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
      [
        "MAX_PAGE_LIMIT",
        "applyChanges",
        "buildGroupQuery",
        "buildQuery",
        "buildRowUpdate",
        "createDrizzleDataSource",
        "createRows",
        "defineGridTables",
        "deleteRows",
        "evaluateFormulaCells",
        "executeGroupQuery",
        "executeQuery",
        "formulaTranslatability",
        "getChanges",
        "isEmptyExpr",
        "keysetPredicate",
        "offsetClause",
        "planFormulaColumns",
        "registerOperatorTranslator",
        "resolveColumnExpr",
        "runRowQuery",
        "translateFilter",
        "translateSearch",
        "translateSort",
      ]
    `);
  });

  it("`./ddl` exposes exactly the documented runtime names", async () => {
    const mod = await import("../../src/ddl/index");
    expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
      [
        "createChangeLogTableDDL",
        "createRowsTableDDL",
        "diffIndexedColumns",
        "dropGeneratedColumnDDL",
        "formulaSqlHook",
        "generatedColumnDDL",
      ]
    `);
  });

  it("`.` does not import drizzle-orm at runtime", async () => {
    vi.resetModules();
    vi.doMock("drizzle-orm", () => {
      throw new Error("drizzle-orm must not be imported by the root entry");
    });
    vi.doMock("drizzle-orm/mysql-core", () => {
      throw new Error("drizzle-orm/mysql-core must not be imported by the root entry");
    });
    const mod = await import("../../src/index");
    expect(typeof mod.validateSchema).toBe("function");
    // sanity: the mock really does trip a drizzle import
    await expect(import("../../src/drizzle/index")).rejects.toThrow();
    vi.doUnmock("drizzle-orm");
    vi.doUnmock("drizzle-orm/mysql-core");
    vi.resetModules();
  });
});
