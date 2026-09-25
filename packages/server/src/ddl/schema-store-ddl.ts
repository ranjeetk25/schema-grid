import { TEXT_COLLATION } from "../sql/column-expr";
import { assertSafeColumnKey } from "../storage/keys";
import type { DdlStatement } from "./tables-ddl";

/** Same table defaults as `tables-ddl.ts`. */
const ENGINE_CLAUSE = `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${TEXT_COLLATION}`;

export interface CreateGridSchemasTableDDLOptions {
  table: string;
}

/**
 * DDL for the table behind `createDrizzleSchemaStore`: one row per grid holding
 * its schema JSON. `grid_id` uses a binary collation so grid ids are matched
 * exactly (case-sensitive), like row ids. `schema_version` mirrors
 * `schema.schemaVersion` for inspection; the JSON is the source of truth.
 */
export function createGridSchemasTableDDL(options: CreateGridSchemasTableDDLOptions): DdlStatement {
  const table = assertSafeColumnKey(options.table);

  const lines = [
    `CREATE TABLE IF NOT EXISTS \`${table}\` (`,
    "  `grid_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,",
    "  `schema` JSON NOT NULL,",
    "  `schema_version` INT NOT NULL,",
    "  `updated_at` DATETIME(3) NOT NULL,",
    "  PRIMARY KEY (`grid_id`)",
    `) ${ENGINE_CLAUSE}`,
  ];

  return {
    sql: lines.join("\n"),
    description: `Create grid schemas table \`${table}\``,
  };
}
