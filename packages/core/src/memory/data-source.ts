import { createDefaultRegistry } from "../field-types/default-registry";
import { DEFAULT_TIME_ZONE } from "../time/zoned";
import { resolveColumnAccess } from "../permissions/column-access";
import { createRolePermissionResolver } from "../permissions/role-resolver";
import type { Access } from "../permissions/types";
import type { GridQuery, QueryResult } from "../query/types";
import type { GridRow } from "../rows/types";
import type { GridSchema } from "../schema/types";
import { materializeFormulas } from "./materialize";
import { type MemoryQueryContext, runQuery } from "./query";
import type { InMemoryDataSource, InMemoryDataSourceOptions } from "./types";

/**
 * Creates the reference in-memory DataSource. Its behaviour is the executable
 * definition of schema-grid semantics (filters, sort, paging, permissions,
 * formulas, versions) that other adapters are tested against.
 */
export function createInMemoryDataSource<Row extends GridRow = GridRow>(
  options: InMemoryDataSourceOptions<Row>,
): InMemoryDataSource<Row> {
  const registry = options.registry ?? createDefaultRegistry();
  const resolver = options.resolver ?? createRolePermissionResolver();
  const now = options.now ?? (() => new Date());
  const tz = options.timeZone ?? DEFAULT_TIME_ZONE;
  let schema: GridSchema = structuredClone(options.schema);
  const store = new Map<string, Row>();

  const env = () => ({ now: now(), tz });

  for (const row of options.rows ?? []) {
    const copy = structuredClone(row);
    materializeFormulas(copy, schema, env());
    store.set(copy.id, copy);
  }

  function accessMap(): Map<string, Access> {
    if (!options.user) return new Map(schema.columns.map((c) => [c.id, "edit" as Access]));
    return resolveColumnAccess(schema, resolver, options.user);
  }

  function queryContext(): MemoryQueryContext {
    return {
      schema,
      registry,
      access: accessMap(),
      now: now(),
      tz,
      ...(options.user ? { userId: options.user.id } : {}),
    };
  }

  const notImplemented = (name: string) => () =>
    Promise.reject(new Error(`${name} is not implemented`));

  return {
    async fetch(query: GridQuery): Promise<QueryResult<Row>> {
      const ctx = queryContext();
      const e = { now: ctx.now, tz };
      const rows = [...store.values()].map((r) => {
        const copy = structuredClone(r);
        materializeFormulas(copy, schema, e);
        return copy;
      });
      return runQuery(rows, query, ctx);
    },
    applyChanges: notImplemented("applyChanges"),
    createRows: notImplemented("createRows"),
    deleteRows: notImplemented("deleteRows"),
    getSchema: () => structuredClone(schema),
    setSchema(next: GridSchema) {
      schema = structuredClone(next);
    },
    snapshot: () => [...store.values()].map((r) => structuredClone(r)),
  };
}
