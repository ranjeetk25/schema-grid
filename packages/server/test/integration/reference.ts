/**
 * In-memory reference semantics for parity tests, built on core's
 * `createInMemoryDataSource` (the executable definition of schema-grid
 * semantics that adapters like `createDrizzleDataSource` are tested against).
 */
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import {
  type FilterNode,
  type GridRow,
  type GridSchema,
  type GroupResult,
  type SortSpec,
  createRolePermissionResolver,
} from "../../src/internal/core";

export async function referenceIds(
  schema: GridSchema,
  rows: readonly GridRow[],
  query: { filter: FilterNode | null; sort: SortSpec[] },
  env: { now: Date; tz: string; userId: string },
): Promise<string[]> {
  const ds = createInMemoryDataSource<GridRow>({
    schema,
    rows: structuredClone(rows as GridRow[]),
    resolver: createRolePermissionResolver({ superRoles: ["ref"] }),
    user: { id: env.userId, roles: ["ref"] },
    now: () => env.now,
    timeZone: env.tz,
  });
  const res = await ds.fetch({ filter: query.filter, sort: query.sort, page: { offset: 0, limit: 1000 } });
  return res.rows.map((r) => r.id);
}

export async function referenceGroups(
  schema: GridSchema,
  rows: readonly GridRow[],
  columnId: string,
  aggregations: { columnId: string; agg: "sum" }[],
  env: { now: Date; tz: string; userId: string },
): Promise<GroupResult[]> {
  const ds = createInMemoryDataSource<GridRow>({
    schema,
    rows: structuredClone(rows as GridRow[]),
    resolver: createRolePermissionResolver({ superRoles: ["ref"] }),
    user: { id: env.userId, roles: ["ref"] },
    now: () => env.now,
    timeZone: env.tz,
  });
  const res = await ds.fetch({
    filter: null,
    sort: [],
    groupBy: [{ columnId, aggregations }],
    page: { offset: 0, limit: 50 },
  });
  return res.groups ?? [];
}
