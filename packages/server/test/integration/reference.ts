/**
 * In-memory reference semantics for parity tests.
 * TODO(core): replace with core's `createInMemoryDataSource` over the shared fixture.
 */
import { resolveAccess } from "../../src/access/query-access";
import { createServerContext } from "../../src/context";
import { evaluateFormulaCells } from "../../src/formula/evaluate-rows";
import {
  type FilterNode,
  type GridRow,
  type GridSchema,
  type RowPartial,
  type SortSpec,
  compareRows,
  createDefaultRegistry,
  createRolePermissionResolver,
  matchesFilter,
} from "../../src/internal/core";

export function referenceIds(
  schema: GridSchema,
  partials: RowPartial[],
  query: { filter: FilterNode | null; sort: SortSpec[] },
  env: { now: Date; tz: string; userId: string },
): string[] {
  const registry = createDefaultRegistry();
  const ctx = createServerContext({
    schema,
    registry,
    resolver: createRolePermissionResolver({ superRoles: ["ref"] }),
    user: { id: env.userId, roles: ["ref"] },
    now: () => env.now,
    tz: env.tz,
  });
  const rows: GridRow[] = partials.map((p) => ({ id: p.id as string, version: 1, updatedAt: "", cells: { ...(p.cells ?? {}) } }));
  const evaluated = evaluateFormulaCells(rows, resolveAccess(ctx), ctx);
  const mctx = { schema, registry, now: env.now, tz: env.tz, userId: env.userId };
  return evaluated
    .filter((r) => matchesFilter(query.filter, r, mctx))
    .sort((a, b) => compareRows(a, b, query.sort, schema, registry))
    .map((r) => r.id);
}
