import { describe, expect, it } from "vitest";
import {
  alterChangeLogTableMetaDDL,
  alterRowsTableIdCollationDDL,
  createChangeLogTableDDL,
  createRowsTableDDL,
} from "../../../src/ddl/tables-ddl";

describe("createRowsTableDDL", () => {
  it("emits the fixed rows table DDL", () => {
    const stmt = createRowsTableDDL({ table: "grid_rows" });
    expect(stmt.description).toMatchInlineSnapshot(`"Create rows table \`grid_rows\`"`);
    expect(stmt.sql).toMatchInlineSnapshot(`
      "CREATE TABLE IF NOT EXISTS \`grid_rows\` (
        \`id\` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`grid_id\` VARCHAR(64) NOT NULL,
        \`version\` INT NOT NULL DEFAULT 1,
        \`updated_at\` DATETIME(3) NOT NULL,
        \`updated_by\` VARCHAR(64) NULL,
        \`deleted_at\` DATETIME(3) NULL,
        \`cells\` JSON NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_grid_rows_grid_deleted_id\` (\`grid_id\`, \`deleted_at\`, \`id\`),
        KEY \`idx_grid_rows_grid_updated\` (\`grid_id\`, \`updated_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci"
    `);
  });

  it("contains DEFAULT 1 for version and cells JSON NOT NULL", () => {
    const stmt = createRowsTableDDL({ table: "grid_rows" });
    expect(stmt.sql).toContain("DEFAULT 1");
    expect(stmt.sql).toContain("`cells` JSON NOT NULL");
  });

  it("appends physical columns (nullable by default)", () => {
    const stmt = createRowsTableDDL({
      table: "grid_rows",
      physicalColumns: [
        { name: "email_addr", sqlType: "VARCHAR(191)" },
        { name: "amount", sqlType: "DECIMAL(10,2)", nullable: false },
      ],
    });
    expect(stmt.sql).toMatchInlineSnapshot(`
      "CREATE TABLE IF NOT EXISTS \`grid_rows\` (
        \`id\` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`grid_id\` VARCHAR(64) NOT NULL,
        \`version\` INT NOT NULL DEFAULT 1,
        \`updated_at\` DATETIME(3) NOT NULL,
        \`updated_by\` VARCHAR(64) NULL,
        \`deleted_at\` DATETIME(3) NULL,
        \`cells\` JSON NOT NULL,
        \`email_addr\` VARCHAR(191) NULL,
        \`amount\` DECIMAL(10,2) NOT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_grid_rows_grid_deleted_id\` (\`grid_id\`, \`deleted_at\`, \`id\`),
        KEY \`idx_grid_rows_grid_updated\` (\`grid_id\`, \`updated_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci"
    `);
  });

  it("truncates long index names deterministically to stay within 64 chars", () => {
    const longName = "grid_rows_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 48 chars, the max valid table key
    const stmt = createRowsTableDDL({ table: longName });
    const indexNames = [...stmt.sql.matchAll(/KEY `([^`]+)`/g)].map((m) => m[1] ?? "");
    for (const name of indexNames) {
      expect(name.length).toBeLessThanOrEqual(64);
    }
    expect(indexNames).toMatchInlineSnapshot(`
      [
        "idx_grid_rows_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_grid_deleted_id",
        "idx_grid_rows_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_grid_updated",
      ]
    `);
  });

  it("rejects an unsafe table name", () => {
    expect(() => createRowsTableDDL({ table: "a;b" })).toThrow();
  });

  it("rejects an unsafe physical column name", () => {
    expect(() =>
      createRowsTableDDL({ table: "grid_rows", physicalColumns: [{ name: "a;b", sqlType: "VARCHAR(191)" }] }),
    ).toThrow();
  });

  it("rejects an unsafe sqlType", () => {
    expect(() =>
      createRowsTableDDL({
        table: "grid_rows",
        physicalColumns: [{ name: "amount", sqlType: "VARCHAR(191); DROP TABLE x" }],
      }),
    ).toThrow();
  });
});

describe("createChangeLogTableDDL", () => {
  it("emits the change_log table DDL", () => {
    const stmt = createChangeLogTableDDL({ table: "grid_change_log" });
    expect(stmt.description).toMatchInlineSnapshot(`"Create change log table \`grid_change_log\`"`);
    expect(stmt.sql).toMatchInlineSnapshot(`
      "CREATE TABLE IF NOT EXISTS \`grid_change_log\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`grid_id\` VARCHAR(64) NOT NULL,
        \`row_id\` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        \`column_id\` VARCHAR(64) NULL,
        \`kind\` VARCHAR(16) NOT NULL,
        \`prev\` JSON NULL,
        \`next\` JSON NULL,
        \`actor\` VARCHAR(64) NOT NULL,
        \`at\` DATETIME(3) NOT NULL,
        \`batch_id\` VARCHAR(64) NULL,
        \`meta\` JSON NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_grid_change_log_grid_id\` (\`grid_id\`, \`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci"
    `);
  });

  it("rejects an unsafe table name", () => {
    expect(() => createChangeLogTableDDL({ table: "a;b" })).toThrow();
  });
});

describe("alterChangeLogTableMetaDDL", () => {
  it("adds the nullable meta JSON column (v0.3 upgrade for existing tables)", () => {
    const stmt = alterChangeLogTableMetaDDL({ table: "grid_change_log" });
    expect(stmt.sql).toBe("ALTER TABLE `grid_change_log` ADD COLUMN `meta` JSON NULL");
    expect(stmt.description).toContain("meta");
    expect(() => alterChangeLogTableMetaDDL({ table: "a b" })).toThrow();
  });
});

describe("row id collation", () => {
  it("rows.id and change_log.row_id are binary-collated so id order / id > ? are code-point order", () => {
    const bin = "VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL";
    expect(createRowsTableDDL({ table: "grid_rows" }).sql).toContain(`\`id\` ${bin},`);
    expect(createChangeLogTableDDL({ table: "grid_change_log" }).sql).toContain(`\`row_id\` ${bin},`);
  });
});

describe("alterRowsTableIdCollationDDL", () => {
  it("modifies `id` in place to the binary-collation type createRowsTableDDL uses", () => {
    const stmt = alterRowsTableIdCollationDDL({ table: "grid_rows" });
    expect(stmt.sql).toMatchInlineSnapshot(
      `"ALTER TABLE \`grid_rows\` MODIFY \`id\` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL"`,
    );
    expect(stmt.description).toMatchInlineSnapshot(`"Convert \`grid_rows\`.\`id\` to binary collation (utf8mb4_bin)"`);
    // Same column definition as a fresh install.
    const createIdLine = createRowsTableDDL({ table: "grid_rows" }).sql.split("\n")[1]?.trim().replace(/,$/, "");
    expect(stmt.sql.endsWith(createIdLine ?? "<missing>")).toBe(true);
  });

  it("rejects unsafe table names", () => {
    expect(() => alterRowsTableIdCollationDDL({ table: "grid_rows; DROP TABLE x" })).toThrow();
  });
});
