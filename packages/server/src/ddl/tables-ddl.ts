import { SchemaValidationError } from "../errors";
import { assertSafeColumnKey } from "../storage/keys";

export interface DdlStatement {
  sql: string;
  description: string;
}

export interface PhysicalColumnDDL {
  name: string;
  /** Raw SQL type, e.g. "VARCHAR(191)", "DECIMAL(10,2)", "INT UNSIGNED". */
  sqlType: string;
  nullable?: boolean;
}

/** Conservative allow-list for a raw SQL type string (no injection surface). */
const SAFE_SQL_TYPE = /^[A-Z]+(\(\d+(,\d+)?\))?( UNSIGNED)?$/i;

function assertSafeSqlType(sqlType: string, name: string): string {
  if (!SAFE_SQL_TYPE.test(sqlType)) {
    throw new SchemaValidationError([
      {
        code: "unsafeSqlType",
        path: ["sqlType"],
        message: `Physical column "${name}" has an unsafe sqlType "${sqlType}"; expected to match ${SAFE_SQL_TYPE.source}`,
      },
    ]);
  }
  return sqlType;
}

function quoteIdent(name: string): string {
  return `\`${name}\``;
}

function physicalColumnLine(col: PhysicalColumnDDL): string {
  assertSafeColumnKey(col.name);
  assertSafeSqlType(col.sqlType, col.name);
  const nullability = col.nullable === false ? "NOT NULL" : "NULL";
  return `  ${quoteIdent(col.name)} ${col.sqlType} ${nullability},`;
}

/**
 * Builds an index name of the form `idx_<table><suffix>`, truncating the table
 * segment deterministically so the full identifier stays within `maxLen`
 * (MySQL's 64-char identifier limit).
 */
function boundedIndexName(table: string, suffix: string, maxLen = 64): string {
  const prefix = "idx_";
  const available = maxLen - prefix.length - suffix.length;
  const tablePart = table.length > available ? table.slice(0, Math.max(available, 0)) : table;
  return `${prefix}${tablePart}${suffix}`;
}

/**
 * Row ids use a binary collation so `ORDER BY id` / `id > ?` (the final sort
 * tie-break and keyset cursor) follow code-point order, like core's in-memory
 * sort, instead of the case/accent-insensitive table default.
 */
const ID_TYPE = "VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin";

const ENGINE_CLAUSE = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci";

export interface CreateRowsTableDDLOptions {
  table: string;
  physicalColumns?: PhysicalColumnDDL[];
}

export function createRowsTableDDL(options: CreateRowsTableDDLOptions): DdlStatement {
  const table = assertSafeColumnKey(options.table);
  const physicalColumns = options.physicalColumns ?? [];

  const fixedLines = [
    `  \`id\` ${ID_TYPE} NOT NULL,`,
    "  `grid_id` VARCHAR(64) NOT NULL,",
    "  `version` INT NOT NULL DEFAULT 1,",
    "  `updated_at` DATETIME(3) NOT NULL,",
    "  `updated_by` VARCHAR(64) NULL,",
    "  `deleted_at` DATETIME(3) NULL,",
    "  `cells` JSON NOT NULL,",
  ];
  const physicalLines = physicalColumns.map(physicalColumnLine);

  const idxGridDeletedId = boundedIndexName(table, "_grid_deleted_id");
  const idxGridUpdated = boundedIndexName(table, "_grid_updated");

  const lines = [
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (`,
    ...fixedLines,
    ...physicalLines,
    "  PRIMARY KEY (`id`),",
    `  KEY ${quoteIdent(idxGridDeletedId)} (\`grid_id\`, \`deleted_at\`, \`id\`),`,
    `  KEY ${quoteIdent(idxGridUpdated)} (\`grid_id\`, \`updated_at\`)`,
    `) ${ENGINE_CLAUSE}`,
  ];

  return {
    sql: lines.join("\n"),
    description: `Create rows table \`${table}\``,
  };
}

export interface CreateChangeLogTableDDLOptions {
  table: string;
}

export function createChangeLogTableDDL(options: CreateChangeLogTableDDLOptions): DdlStatement {
  const table = assertSafeColumnKey(options.table);

  const idxGridId = boundedIndexName(table, "_grid_id");

  const lines = [
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (`,
    "  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,",
    "  `grid_id` VARCHAR(64) NOT NULL,",
    `  \`row_id\` ${ID_TYPE} NOT NULL,`,
    "  `column_id` VARCHAR(64) NULL,",
    "  `kind` VARCHAR(16) NOT NULL,",
    "  `prev` JSON NULL,",
    "  `next` JSON NULL,",
    "  `actor` VARCHAR(64) NOT NULL,",
    "  `at` DATETIME(3) NOT NULL,",
    "  `batch_id` VARCHAR(64) NULL,",
    "  PRIMARY KEY (`id`),",
    `  KEY ${quoteIdent(idxGridId)} (\`grid_id\`, \`id\`)`,
    `) ${ENGINE_CLAUSE}`,
  ];

  return {
    sql: lines.join("\n"),
    description: `Create change log table \`${table}\``,
  };
}
