/**
 * TODO(lane-b): DELETE this file at merge and import `createSqlViewDataSource`
 * from "@ranjeetk25/schema-grid-server/drizzle" instead (spec C4).
 *
 * A thin stand-in with the spec's option shape so the leads grid file already
 * reads like the final code. It is NOT the real thing: every request loads the
 * whole view (`SELECT <columns> FROM <baseQuery>`) and answers
 * filter/sort/search/paging/grouping with core's in-memory data source. Writes
 * go through `write.update`; versions are a hash of the row's cells.
 */
import type {
  CellChange,
  ChangeConflict,
  ChangeResult,
  DataSource,
  FieldTypeRegistry,
  GridQuery,
  GridRow,
  GridSchema,
  PermissionResolver,
  PermissionUser,
} from "@ranjeetk25/schema-grid-core";
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import type { GridDb } from "@ranjeetk25/schema-grid-server/drizzle";
import { type AnyColumn, type SQL, sql } from "drizzle-orm";

export interface SqlViewContext {
  user: PermissionUser;
  now: () => Date;
}

export interface SqlViewColumn {
  expr: SQL | AnyColumn;
  searchable?: boolean;
}

export interface SqlViewDataSourceOptions {
  db: GridDb;
  schema: GridSchema;
  registry?: FieldTypeRegistry;
  resolver: PermissionResolver;
  user: PermissionUser;
  tz?: string;
  now?: () => Date;
  /** FROM/JOIN/WHERE base (no ORDER/LIMIT), e.g. sql`${leads}`. */
  baseQuery: (ctx: SqlViewContext) => SQL;
  /** Keyed by ColumnDef.key. */
  columns: Record<string, SqlViewColumn>;
  rowId: SQL | AnyColumn;
  updatedAt?: SQL | AnyColumn;
  write?: {
    update?: (
      ctx: SqlViewContext,
      input: { rowId: string; changes: CellChange[]; baseVersion: number },
    ) => Promise<{ applied: CellChange[]; version: number } | { conflict: ChangeConflict }>;
  };
}

/** Positive 31-bit FNV-1a hash of the row's cells: the optimistic version. */
function hashVersion(cells: Record<string, unknown>): number {
  const text = JSON.stringify(Object.keys(cells).sort().map((k) => [k, cells[k]]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) + 1;
}

function toCell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" || typeof value === "bigint") return Number(value);
  return value ?? null;
}

export function createSqlViewDataSource(options: SqlViewDataSourceOptions): DataSource<GridRow> {
  const ctx: SqlViewContext = { user: options.user, now: options.now ?? (() => new Date()) };
  const keys = Object.keys(options.columns);
  const booleanKeys = new Set(options.schema.columns.filter((c) => c.type === "boolean").map((c) => c.key));

  async function load(): Promise<GridRow[]> {
    const select = sql.join(
      [
        sql`${options.rowId} as \`__id\``,
        ...(options.updatedAt ? [sql`${options.updatedAt} as \`__updated_at\``] : []),
        ...keys.map((k) => sql`${(options.columns[k] as SqlViewColumn).expr} as ${sql.identifier(k)}`),
      ],
      sql`, `,
    );
    const result = (await options.db.execute(sql`select ${select} from ${options.baseQuery(ctx)}`)) as unknown as [
      Record<string, unknown>[],
    ];
    return result[0].map((raw) => {
      const cells: Record<string, unknown> = {};
      for (const k of keys) {
        const v = toCell(raw[k]);
        cells[k] = booleanKeys.has(k) && v !== null ? Boolean(v) : v;
      }
      const updated = raw.__updated_at;
      return {
        id: String(raw.__id),
        version: hashVersion(cells),
        updatedAt: updated instanceof Date ? updated.toISOString() : new Date(String(updated ?? 0)).toISOString(),
        cells,
      };
    });
  }

  async function memory() {
    return createInMemoryDataSource({
      schema: options.schema,
      rows: await load(),
      user: options.user,
      resolver: options.resolver,
      ...(options.registry ? { registry: options.registry } : {}),
      ...(options.tz ? { timeZone: options.tz } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  const readOnly = async (): Promise<never> => {
    throw Object.assign(new Error("This grid is read-only"), { code: "UNSUPPORTED_OPERATION" });
  };

  return {
    async fetch(query: GridQuery) {
      // The in-memory source has no "first page" cursor; the SQL sources use "".
      const page = "cursor" in query.page && query.page.cursor === "" ? { offset: 0, limit: query.page.limit } : query.page;
      return (await memory()).fetch({ ...query, page });
    },
    async applyChanges(batch): Promise<ChangeResult> {
      const update = options.write?.update;
      if (!update) {
        return {
          applied: [],
          conflicts: [],
          errors: batch.changes.map((c) => ({ rowId: c.rowId, columnId: c.columnId, message: "Read-only" })),
        };
      }
      // Validation, permissions and version checks by the in-memory source; persistence by `write.update`.
      const checked = await (await memory()).applyChanges(batch);
      const result: ChangeResult = { applied: [], conflicts: checked.conflicts, errors: checked.errors, versions: {} };
      const keyOf = new Map(options.schema.columns.map((c) => [c.id, c.key]));
      for (const rowId of Object.keys(checked.versions ?? {})) {
        const changes = checked.applied.filter((c) => c.rowId === rowId);
        const byKey = changes.map((c) => ({ ...c, columnId: keyOf.get(c.columnId) ?? c.columnId }));
        const out = await update(ctx, { rowId, changes: byKey, baseVersion: batch.baseVersions[rowId] ?? 0 });
        if ("conflict" in out) {
          result.conflicts.push(out.conflict);
          continue;
        }
        result.applied.push(...changes);
      }
      const fresh = new Map((await load()).map((r) => [r.id, r.version]));
      for (const c of result.applied) (result.versions as Record<string, number>)[c.rowId] = fresh.get(c.rowId) ?? 0;
      return result;
    },
    createRows: readOnly,
    deleteRows: readOnly,
    async getOptions(columnId, search) {
      return (await memory()).getOptions?.(columnId, search) ?? [];
    },
  };
}
