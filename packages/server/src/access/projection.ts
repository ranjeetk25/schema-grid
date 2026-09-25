import { type SQL, sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { SchemaValidationError } from "../errors";
import type { GridRow, GridSchema } from "../internal/core";
import { assertSafeColumnKey, jsonPath } from "../storage/keys";
import type { GridTables } from "../storage/tables";
import { type AccessMap, isReadable } from "./query-access";

export type ProjectionSelect = {
  id: AnyMySqlColumn;
  version: AnyMySqlColumn;
  updatedAt: AnyMySqlColumn;
  updatedBy: AnyMySqlColumn;
  cells: SQL<Record<string, unknown>>;
} & Record<string, AnyMySqlColumn | SQL>;

/**
 * Select map that only ever reads readable, stored (non-formula, non-physical)
 * keys out of `cells` — via `JSON_OBJECT('k', JSON_EXTRACT(cells, '$.k'), …)` —
 * plus readable physical columns (keyed by their valueField).
 */
export function projectionSql(schema: GridSchema, access: AccessMap, tables: GridTables): ProjectionSelect {
  const pairs: SQL[] = [];
  const physical: Record<string, AnyMySqlColumn> = {};
  for (const column of schema.columns) {
    if (!isReadable(access, column.id) || column.type === "formula") continue;
    if (column.source) {
      const col = tables.physical[column.source.valueField];
      if (!col) {
        throw new SchemaValidationError([
          {
            code: "unknownValueField",
            columnId: column.id,
            path: ["source", "valueField"],
            message: `Physical column "${column.source.valueField}" is not defined on the rows table`,
          },
        ]);
      }
      physical[column.source.valueField] = col;
      continue;
    }
    const key = assertSafeColumnKey(column.key, column.id);
    pairs.push(sql`${sql.raw(`'${key}'`)}, JSON_EXTRACT(${sql.identifier("cells")}, ${sql.raw(`'${jsonPath(key)}'`)})`);
  }
  const cells = sql<Record<string, unknown>>`JSON_OBJECT(${sql.join(pairs, sql`, `)})`;
  return {
    id: tables.rows.id,
    version: tables.rows.version,
    updatedAt: tables.rows.updatedAt,
    updatedBy: tables.rows.updatedBy,
    ...physical,
    cells,
  };
}

/** Final JS guard: drops every cell whose column is not readable (or unknown). */
export function projectRow<Row extends GridRow>(row: Row, schema: GridSchema, access: AccessMap): Row {
  const readableKeys = new Set(schema.columns.filter((c) => isReadable(access, c.id)).map((c) => c.key));
  const cells: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row.cells)) if (readableKeys.has(k)) cells[k] = v;
  return { ...row, cells };
}
