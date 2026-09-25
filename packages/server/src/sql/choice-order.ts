import { type SQL, sql } from "drizzle-orm";
import type { ColumnDef } from "../internal/core";

/** Byte-wise (code point) collation — the SQL counterpart of JS `<` on option ids. */
export const BINARY_COLLATION = "utf8mb4_bin";

/**
 * Option ids of a `choice` column in config order. Mirrors core's `safeOptions`:
 * malformed entries are skipped; with duplicate ids the FIRST occurrence wins
 * (core's `findIndex`).
 */
export function choiceOptionIds(column: ColumnDef): string[] {
  const options = (column.config as { options?: unknown } | null | undefined)?.options;
  if (!Array.isArray(options)) return [];
  const ids: string[] = [];
  for (const o of options) {
    if (typeof o !== "object" || o === null) continue;
    const { id, label } = o as { id?: unknown; label?: unknown };
    if (typeof id !== "string" || typeof label !== "string" || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

/** `value` re-collated byte-wise (converted to utf8mb4 first, so physical columns in another charset work). */
export function binaryText(value: SQL): SQL {
  return sql`CONVERT(${value} USING utf8mb4) COLLATE ${sql.raw(BINARY_COLLATION)}`;
}

/**
 * Rank of a choice value in the column's option order — core `compareByOptionOrder`:
 * option i ranks i (exact, case-sensitive id match), unknown ids (and NULL) rank
 * `options.length`. Callers order by `rank, binaryText(value)` so unknown ids
 * tie-break by code point, like core's `a < b`.
 */
export function choiceRank(value: SQL, column: ColumnDef): SQL {
  const ids = choiceOptionIds(column);
  if (ids.length === 0) return sql`0`;
  const bin = binaryText(value);
  const whens = ids.map((id, i) => sql`WHEN ${bin} = ${id} THEN ${sql.raw(String(i))}`);
  return sql`(CASE ${sql.join(whens, sql` `)} ELSE ${sql.raw(String(ids.length))} END)`;
}
