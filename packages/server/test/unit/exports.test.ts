import { readFileSync } from "node:fs";
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
        "SQL_VIEW_BASE_ALIAS",
        "SQL_VIEW_EXTENSION_ALIAS",
        "applyChanges",
        "buildGroupQuery",
        "buildQuery",
        "buildRowUpdate",
        "createDrizzleDataSource",
        "createDrizzleSchemaStore",
        "createExtensionCellStore",
        "createJsonCellsResolver",
        "createMappedColumnResolver",
        "createRows",
        "createSqlViewDataSource",
        "dateOnlyFromDriver",
        "defineGridTables",
        "deleteRows",
        "evaluateFormulaCells",
        "executeGroupQuery",
        "executeQuery",
        "formulaTranslatability",
        "getChanges",
        "gridRowsSource",
        "hydrateRow",
        "isEmptyExpr",
        "isoToNaiveDatetime",
        "jsonCellsResolver",
        "keysetPredicate",
        "mapSourceRows",
        "naiveDatetimeToIso",
        "offsetClause",
        "planFormulaColumns",
        "rebaseColumns",
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
        "alterRowsTableIdCollationDDL",
        "createChangeLogTableDDL",
        "createExtensionCellsTableDDL",
        "createGridSchemasTableDDL",
        "createRowsTableDDL",
        "diffIndexedColumns",
        "dropGeneratedColumnDDL",
        "formulaSqlHook",
        "generatedColumnDDL",
      ]
    `);
  });

  it("`./http` exposes exactly the documented runtime names", async () => {
    const mod = await import("../../src/http/index");
    expect(Object.keys(mod).sort()).toMatchInlineSnapshot(`
      [
        "createGridRegistry",
        "createGridRouterAdapter",
        "createMemorySchemaStore",
        "defineGrid",
        "isGridRegistry",
        "isNullInputOperation",
        "normalizeRequestBody",
        "parseJsonBody",
        "toExpressHandler",
        "toExpressRouter",
        "toFetchHandler",
        "toHttpResponse",
        "toLambdaHandler",
        "toWireFailure",
      ]
    `);
  });

  it("`./http` does not import drizzle-orm at runtime", async () => {
    vi.resetModules();
    vi.doMock("drizzle-orm", () => {
      throw new Error("drizzle-orm must not be imported by the http entry");
    });
    vi.doMock("drizzle-orm/mysql-core", () => {
      throw new Error("drizzle-orm/mysql-core must not be imported by the http entry");
    });
    const mod = await import("../../src/http/index");
    expect(typeof mod.createGridRouterAdapter).toBe("function");
    vi.doUnmock("drizzle-orm");
    vi.doUnmock("drizzle-orm/mysql-core");
    vi.resetModules();
  });

  it("package.json maps ./http like the other subpaths", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports["./http"]).toEqual({
      development: "./src/http/index.ts",
      types: "./dist/http/index.d.ts",
      import: "./dist/http/index.js",
      require: "./dist/http/index.cjs",
    });
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

describe("SCHEMA_GRID_SERVER_VERSION", () => {
  it("equals the package.json version (injected via tsup/vitest `define`)", async () => {
    const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    const mod = await import("../../src/index");
    expect(mod.SCHEMA_GRID_SERVER_VERSION).toBe(version);
  });
});
