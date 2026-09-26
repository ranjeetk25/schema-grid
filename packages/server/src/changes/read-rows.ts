import { and, eq, inArray } from "drizzle-orm";
import { projectRow } from "../access/projection";
import { resolveAccess } from "../access/query-access";
import type { ServerContext } from "../context";
import { evaluateFormulaCells } from "../formula/evaluate-rows";
import type { GridRow } from "../internal/core";
import { type DbRow, hydrateRow } from "../storage/hydrate";
import type { GridDb, WriteDeps } from "./db";

/** Read-side options shared by every "rows by id" path of the JSON-cells source. */
export interface ReadRowsOptions {
  /** Post-read hook (see `RowSource.mapRows`): after formula evaluation, before projection. */
  mapRows?: (rows: GridRow[]) => Promise<GridRow[]> | GridRow[];
  /** Zone of naive DATETIME wall times in physical `datetime` columns. Default UTC. */
  naiveDatetimeZone?: string;
}

/**
 * The current state of `ids` as the caller sees it: one `SELECT … WHERE id IN (…)`
 * on `db` (a transaction during writes), soft-deleted and unknown ids skipped,
 * then hydrate → formula evaluation → `mapRows` → `projectRow`. Order follows
 * `ids` (a repeated id yields the row again). Backs `ChangeResult.rows`,
 * `DataSource.getRows` and the change feed.
 */
export async function readRowsById(
  db: GridDb,
  deps: WriteDeps,
  ctx: ServerContext,
  ids: readonly string[],
  options: ReadRowsOptions = {},
): Promise<GridRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { rows } = deps.tables;
  const found = (await db
    .select()
    .from(rows)
    .where(and(eq(rows.gridId, deps.gridId), inArray(rows.id, unique)))) as unknown as DbRow[];
  const hydrateOptions = options.naiveDatetimeZone ? { naiveDatetimeZone: options.naiveDatetimeZone } : {};
  const live = new Map<string, GridRow>();
  for (const dbRow of found) {
    if (dbRow.deletedAt) continue;
    live.set(dbRow.id, hydrateRow(dbRow, ctx.schema, ctx.registry, hydrateOptions));
  }
  const ordered = ids.flatMap((id) => {
    const row = live.get(id);
    return row ? [row] : [];
  });
  if (ordered.length === 0) return [];
  const access = resolveAccess(ctx);
  const evaluated = evaluateFormulaCells(ordered, access, ctx);
  const mapped = options.mapRows ? await options.mapRows(evaluated) : evaluated;
  return mapped.map((row) => projectRow(row, ctx.schema, access));
}
