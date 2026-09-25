import { type AnyColumn, Column, SQL, is, sql } from "drizzle-orm";

function rebaseChunk(chunk: unknown, alias: string): unknown {
  if (is(chunk, Column)) return sql`${sql.identifier(alias)}.${sql.identifier(chunk.name)}`;
  if (is(chunk, SQL)) return rebaseSql(chunk, alias);
  if (Array.isArray(chunk)) return chunk.map((c) => rebaseChunk(c, alias));
  return chunk;
}

function rebaseSql(expr: SQL, alias: string): SQL {
  const out = new SQL(expr.queryChunks.map((c) => rebaseChunk(c, alias)) as SQL["queryChunks"]);
  return out;
}

/**
 * Re-points every drizzle column reference in `expr` at the derived table
 * `alias` (`\`leads\`.\`name\`` → `\`sg_base\`.\`name\``). SQL-view expressions
 * are written against the consumer's tables but evaluated over the base query,
 * which is wrapped as `(<base>) AS sg_base`; its output columns carry the
 * column names (drizzle selects never alias plain columns).
 */
export function rebaseColumns(expr: SQL | AnyColumn, alias: string): SQL {
  if (is(expr, Column)) return rebaseChunk(expr, alias) as SQL;
  return rebaseSql(expr as SQL, alias);
}
