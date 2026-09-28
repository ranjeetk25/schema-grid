import { TEXT_COLLATION } from "../sql/column-expr";
import { assertSafeColumnKey } from "../storage/keys";
import type { DdlStatement } from "./tables-ddl";

const ENGINE_CLAUSE = `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${TEXT_COLLATION}`;
/** Binary so row ids (stringified) match exactly. */
const KEY_TYPE = "VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin";

export interface CreateCellColorsTableDDLOptions {
  table: string;
}

/**
 * DDL for the table behind `createCellColorStore` (v0.4): the MANUAL cell
 * colors of a grid, one JSON map (column id → palette color) per
 * `(grid_id, row_id)`. Works for both data sources (`row_id` is the row id as a
 * string). `(grid_id, updated_at)` backs the SQL-view `updated_at` change feed.
 */
export function createCellColorsTableDDL(options: CreateCellColorsTableDDLOptions): DdlStatement {
  const table = assertSafeColumnKey(options.table);
  const idx = `idx_${table.slice(0, 64 - "idx__grid_updated".length)}_grid_updated`;
  const lines = [
    `CREATE TABLE IF NOT EXISTS \`${table}\` (`,
    `  \`grid_id\` ${KEY_TYPE} NOT NULL,`,
    `  \`row_id\` ${KEY_TYPE} NOT NULL,`,
    "  `colors` JSON NOT NULL,",
    "  `updated_at` DATETIME(3) NOT NULL,",
    "  `updated_by` VARCHAR(64) NULL,",
    "  PRIMARY KEY (`grid_id`, `row_id`),",
    `  KEY \`${idx}\` (\`grid_id\`, \`updated_at\`)`,
    `) ${ENGINE_CLAUSE}`,
  ];
  return { sql: lines.join("\n"), description: `Create cell colors table \`${table}\`` };
}
