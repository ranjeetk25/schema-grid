import { describe, expect, it } from "vitest";
import { createCellColorsTableDDL } from "../../../src/ddl/cell-colors-ddl";
import { SchemaValidationError } from "../../../src/errors";

describe("createCellColorsTableDDL", () => {
  it("creates (grid_id, row_id)-keyed JSON colors with updated_at / updated_by", () => {
    expect(createCellColorsTableDDL({ table: "grid_cell_colors" }).sql).toMatchInlineSnapshot(`
      "CREATE TABLE IF NOT EXISTS \`grid_cell_colors\` (
        \`grid_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`row_id\` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`colors\` JSON NOT NULL,
        \`updated_at\` DATETIME(3) NOT NULL,
        \`updated_by\` VARCHAR(64) NULL,
        PRIMARY KEY (\`grid_id\`, \`row_id\`),
        KEY \`idx_grid_cell_colors_grid_updated\` (\`grid_id\`, \`updated_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci"
    `);
    expect(createCellColorsTableDDL({ table: "grid_cell_colors" }).description).toBe(
      "Create cell colors table `grid_cell_colors`",
    );
  });

  it("keeps the index name within 64 chars and rejects unsafe names", () => {
    const long = `t${"x".repeat(47)}`;
    const ddl = createCellColorsTableDDL({ table: long }).sql;
    const idx = /KEY `([^`]+)`/.exec(ddl)?.[1] ?? "";
    expect(idx.length).toBeLessThanOrEqual(64);
    expect(() => createCellColorsTableDDL({ table: "bad-name" })).toThrow(SchemaValidationError);
  });
});
