import { createDefaultRegistry } from "../field-types/default-registry";
import { DEFAULT_TIME_ZONE } from "../time/zoned";
import { resolveColumnAccess } from "../permissions/column-access";
import { createRolePermissionResolver } from "../permissions/role-resolver";
import type { Access } from "../permissions/types";
import type { GridQuery, QueryResult } from "../query/types";
import type { LinkRef, Option } from "../common/types";
import type { ChangeBatch, ChangeFeedEntry, ChangeResult, GridRow } from "../rows/types";
import { getColumnById } from "../schema/lookup";
import type { ColumnDef } from "../schema/types";
import { ChangeLog } from "./feed";
import type { RowPartial } from "../datasource/types";
import type { GridSchema } from "../schema/types";
import { materializeFormulas, projectRow } from "./materialize";
import { applyChangeBatch, createStoreRows, deleteStoreRows, type MutationDeps } from "./mutations";
import { type MemoryQueryContext, runQuery } from "./query";
import { type InMemoryDataSource, type InMemoryDataSourceOptions, InMemoryQueryError } from "./types";

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
  const log = new ChangeLog();

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

  let seq = 0;
  const generateId = options.generateId ?? (() => `row_${++seq}`);

  function mutationDeps(): MutationDeps<Row> {
    return {
      schema,
      registry,
      store,
      access: accessMap(),
      env: env(),
      generateId,
      onRowChanged: (rowId, deleted) => log.recordRow(rowId, deleted),
      ...(options.actor ? { actor: options.actor } : {}),
    };
  }

  function readableKeys(): Set<string> {
    const access = accessMap();
    return new Set(
      schema.columns
        .filter((c) => access.get(c.id) === "read" || access.get(c.id) === "edit")
        .map((c) => c.key),
    );
  }

  function requireColumn(columnId: string, need: "read" | "edit"): ColumnDef {
    const column = getColumnById(schema, columnId);
    const access = column ? accessMap().get(column.id) : undefined;
    const ok = need === "edit" ? access === "edit" : access === "read" || access === "edit";
    if (!column || !ok) {
      throw new InMemoryQueryError(
        column ? "unreadableColumn" : "unknownColumn",
        column ? "You cannot access this column" : "Unknown column",
      );
    }
    return column;
  }

  function columnOptions(column: ColumnDef): Option[] {
    const options = (column.config as { options?: unknown } | null)?.options;
    return Array.isArray(options)
      ? options.filter(
          (o): o is Option =>
            typeof o === "object" && o !== null && typeof o.id === "string" && typeof o.label === "string",
        )
      : [];
  }

  let optionSeq = 0;

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
    async applyChanges(batch: ChangeBatch): Promise<ChangeResult> {
      return applyChangeBatch(batch, mutationDeps());
    },
    async createRows(partials: RowPartial<Row>[]): Promise<Row[]> {
      const keys = readableKeys();
      return createStoreRows(partials, mutationDeps()).map((r) => projectRow(r, keys));
    },
    async deleteRows(ids: string[]): Promise<void> {
      deleteStoreRows(ids, mutationDeps());
    },
    async getChanges(since: string): Promise<ChangeFeedEntry<Row>> {
      const from = log.parse(since);
      const { changedIds, deletedIds } = log.since(from);
      const keys = readableKeys();
      const e = env();
      const rows = changedIds.flatMap((id) => {
        const stored = store.get(id);
        if (!stored) return [];
        const copy = structuredClone(stored);
        materializeFormulas(copy, schema, e);
        return [projectRow(copy, keys)];
      });
      return { cursor: log.cursor, rows, deletedRowIds: deletedIds, schemaVersion: schema.schemaVersion };
    },
    async getOptions(columnId: string, search?: string): Promise<Option[]> {
      const column = requireColumn(columnId, "read");
      const needle = search?.trim().toLowerCase() ?? "";
      return columnOptions(column)
        .filter((o) => o.label.toLowerCase().includes(needle))
        .map((o) => ({ ...o }));
    },
    async createOption(columnId: string, label: string): Promise<Option> {
      const column = requireColumn(columnId, "edit");
      const allowCreate =
        column.type === "creatableSelect" ||
        (column.type === "multiSelect" && (column.config as { allowCreate?: unknown } | null)?.allowCreate === true);
      if (!allowCreate) throw new Error("This column does not allow creating options");
      const text = typeof label === "string" ? label.trim() : "";
      if (text === "") throw new Error("Option label must not be empty");
      const options = columnOptions(column);
      const existing = options.find((o) => o.label.trim().toLowerCase() === text.toLowerCase());
      if (existing) return { ...existing };
      const ids = new Set(options.map((o) => o.id));
      let id = "";
      do id = `opt_${++optionSeq}`;
      while (ids.has(id));
      const option: Option = { id, label: text };
      schema = {
        ...schema,
        schemaVersion: schema.schemaVersion + 1,
        columns: schema.columns.map((c) =>
          c.id === column.id
            ? { ...c, config: { ...(c.config as object), options: [...options, option] } }
            : c,
        ),
      };
      log.recordSchemaChange();
      return { ...option };
    },
    async lookup(columnId: string, search: string): Promise<LinkRef[]> {
      const column = requireColumn(columnId, "read");
      if (column.type !== "link") throw new Error("lookup is only available on link columns");
      const needle = typeof search === "string" ? search.trim().toLowerCase() : "";
      return (options.linkTargets?.[column.id] ?? [])
        .filter((ref) => ref.label.toLowerCase().includes(needle))
        .map((ref) => ({ ...ref }));
    },
    getSchema: () => structuredClone(schema),
    setSchema(next: GridSchema) {
      schema = structuredClone(next);
      log.recordSchemaChange();
    },
    snapshot: () => [...store.values()].map((r) => structuredClone(r)),
  };
}
