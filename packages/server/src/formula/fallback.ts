import { compareRows } from "./compare-rows";
import { type SQL, and } from "drizzle-orm";
import { projectRow } from "../access/projection";
import { type AccessMap, assertQueryAccess, resolveAccess } from "../access/query-access";
import { CursorError, FormulaQueryLimitError } from "../errors";
import { translateFilter } from "../filter/translate-filter";
import { type FilterNode, type GridQuery, type GridRow, type QueryResult, matchesFilter } from "../internal/core";
import { assertCursorMatches, decodeCursor, encodeCursor, queryFingerprint } from "../pagination/cursor";
import { offsetClause } from "../pagination/offset";
import type { GridSqlScope, SelectCapableDb } from "../query/build-query";
import { rowSourceOf } from "../query/row-source";
import { translateSearch } from "../search/translate-search";
import type { FormulaPlan } from "../sql/scope";
import { evaluateFormulaCells } from "./evaluate-rows";
import { planFormulaColumns } from "./formula-plan";

type Plans = ReadonlyMap<string, FormulaPlan>;

function isGroup(n: FilterNode): n is Extract<FilterNode, { op: "and" | "or" }> {
  return "op" in n;
}

function referencesFallback(node: FilterNode, plans: Plans): boolean {
  if (isGroup(node)) return node.children.some((c) => referencesFallback(c, plans));
  return plans.get(node.columnId)?.mode === "fallback";
}

/** Formula columns in `fallback` mode that the query filters or sorts on. */
export function fallbackColumnIds(query: Pick<GridQuery, "filter" | "sort">, plans: Plans): string[] {
  const out = new Set<string>();
  const walk = (n: FilterNode | null) => {
    if (!n) return;
    if (isGroup(n)) n.children.forEach(walk);
    else if (plans.get(n.columnId)?.mode === "fallback") out.add(n.columnId);
  };
  walk(query.filter);
  for (const s of query.sort ?? []) if (plans.get(s.columnId)?.mode === "fallback") out.add(s.columnId);
  return [...out];
}

/**
 * Splits a filter into the part MySQL can evaluate and the part that needs
 * in-memory formula evaluation. Only a root AND is split (its non-formula
 * children are pushed down); any other shape stays entirely in memory.
 */
export function splitFilterForPushdown(
  filter: FilterNode | null,
  plans: Plans,
): { sqlPart: FilterNode | null; memoryPart: FilterNode | null } {
  if (!filter || !referencesFallback(filter, plans)) return { sqlPart: filter, memoryPart: null };
  if (!isGroup(filter) || filter.op !== "and") return { sqlPart: null, memoryPart: filter };
  const sqlChildren = filter.children.filter((c) => !referencesFallback(c, plans));
  const memChildren = filter.children.filter((c) => referencesFallback(c, plans));
  return {
    sqlPart: sqlChildren.length > 0 ? { op: "and", children: sqlChildren } : null,
    memoryPart: memChildren.length === 1 ? (memChildren[0] as FilterNode) : { op: "and", children: memChildren },
  };
}

/**
 * Fetch-then-filter path for queries that filter/sort on formula columns that
 * are not SQL-translatable. Pushes down what it can, fetches at most
 * `ctx.formulaFallbackRowCap` candidates (default 5000; more → `FormulaQueryLimitError`),
 * evaluates formulas, filters/sorts/pages in memory with core semantics, and
 * always emits one `FORMULA_FALLBACK` warning. Cursors are offset-mode.
 */
export async function executeFallbackQuery(
  query: GridQuery,
  scope: GridSqlScope,
  db: SelectCapableDb,
  access: AccessMap = resolveAccess(scope.ctx),
): Promise<QueryResult<GridRow>> {
  const ctx = scope.ctx;
  assertQueryAccess(query, ctx, access);
  const plans = scope.formulaPlans ?? planFormulaColumns(scope);
  const planned: GridSqlScope = { ...scope, formulaPlans: plans };
  const columnIds = fallbackColumnIds(query, plans);
  const cap = ctx.formulaFallbackRowCap;

  const fingerprint = queryFingerprint(query, ctx.schema.schemaVersion);
  let offset = 0;
  let limit: number;
  if (typeof query.page.cursor === "string" && query.page.cursor !== "") {
    const payload = decodeCursor(query.page.cursor);
    assertCursorMatches(payload, fingerprint);
    if (payload.mode !== "offset") throw new CursorError("Formula fallback queries page with offset cursors only");
    ({ limit, offset } = offsetClause({ limit: query.page.limit, offset: payload.offset ?? 0 }));
  } else {
    ({ limit, offset } = offsetClause({ limit: query.page.limit, offset: query.page.offset ?? 0 }));
  }

  ctx.onWarning?.({ code: "FORMULA_FALLBACK", columnIds, rowCap: cap });

  const { sqlPart, memoryPart } = splitFilterForPushdown(query.filter, plans);
  const source = rowSourceOf(planned);
  const where: (SQL | undefined)[] = [
    ...source.where,
    translateFilter(sqlPart, planned),
    translateSearch(query.search, access, planned),
  ];
  const candidates = (await db
    .select(source.projection(access))
    .from(source.from)
    .where(and(...where))
    .limit(cap + 1)) as Record<string, unknown>[];
  if (candidates.length > cap) throw new FormulaQueryLimitError(columnIds, cap);

  const hydrated = candidates.map((r) => source.hydrate(r));
  const evaluated = evaluateFormulaCells(hydrated, access, ctx);
  const matchCtx = { schema: ctx.schema, registry: ctx.registry, now: ctx.now(), tz: ctx.tz, userId: ctx.user.id };
  const filtered = memoryPart ? evaluated.filter((r) => matchesFilter(memoryPart, r, matchCtx)) : evaluated;
  filtered.sort((a, b) => compareRows(a, b, query.sort ?? [], ctx.schema, ctx.registry));

  const page = filtered.slice(offset, offset + limit).map((r) => projectRow(r, ctx.schema, access));
  const result: QueryResult<GridRow> = { rows: page };
  if (offset + limit < filtered.length) {
    result.nextCursor = encodeCursor({ v: 1, mode: "offset", fp: fingerprint, offset: offset + limit });
  }
  if (query.includeTotal) result.total = filtered.length;
  return result;
}
