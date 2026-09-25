import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../../../src/errors";
import { createGridSchemasTableDDL } from "../../../src/ddl/schema-store-ddl";

describe("createGridSchemasTableDDL", () => {
  it("emits the grid schemas table DDL", () => {
    const stmt = createGridSchemasTableDDL({ table: "grid_schemas" });
    expect(stmt.description).toMatchInlineSnapshot(`"Create grid schemas table \`grid_schemas\`"`);
    expect(stmt.sql).toMatchInlineSnapshot(`
      "CREATE TABLE IF NOT EXISTS \`grid_schemas\` (
        \`grid_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`schema\` JSON NOT NULL,
        \`schema_version\` INT NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        PRIMARY KEY (\`grid_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci"
    `);
  });

  it("rejects an unsafe table name", () => {
    expect(() => createGridSchemasTableDDL({ table: "grid`; DROP TABLE x; --" })).toThrow(SchemaValidationError);
    expect(() => createGridSchemasTableDDL({ table: "" })).toThrow(SchemaValidationError);
  });
});
