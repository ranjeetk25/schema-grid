import { describe, expect, it } from "vitest";
import { createExtensionCellsTableDDL } from "../../../src/ddl/extension-ddl";
import { SchemaValidationError } from "../../../src/errors";

describe("createExtensionCellsTableDDL", () => {
  it("creates (grid_id, row_id)-keyed JSON cells with version + updated_at", () => {
    expect(createExtensionCellsTableDDL({ table: "grid_extension_cells" }).sql).toMatchInlineSnapshot(`
      "CREATE TABLE IF NOT EXISTS \`grid_extension_cells\` (
        \`grid_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`row_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`cells\` JSON NOT NULL,
        \`version\` INT NOT NULL DEFAULT 1,
        \`updated_at\` DATETIME(3) NOT NULL,
        \`updated_by\` VARCHAR(64) NULL,
        PRIMARY KEY (\`grid_id\`, \`row_id\`),
        KEY \`idx_grid_extension_cells_grid_updated\` (\`grid_id\`, \`updated_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci"
    `);
  });

  it("keeps the index name within 64 chars and rejects unsafe names", () => {
    const long = `t${"x".repeat(47)}`;
    const ddl = createExtensionCellsTableDDL({ table: long }).sql;
    const idx = /KEY `([^`]+)`/.exec(ddl)?.[1] ?? "";
    expect(idx.length).toBeLessThanOrEqual(64);
    expect(() => createExtensionCellsTableDDL({ table: "bad-name" })).toThrow(SchemaValidationError);
  });
});
