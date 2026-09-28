import { canColorCell } from "../colors/access";
import { type CellColorBatch, type CellColorChange, type CellColorResult, isCellColor } from "../colors/types";
import { normalizeCapabilities } from "../datasource/capabilities";
import { createDefaultRegistry } from "../field-types/default-registry";
import { DEFAULT_TIME_ZONE } from "../time/zoned";
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
import { cleanColors, materialized, projectRow, stripFormulas, withColors } from "./materialize";
import { applyChangeBatch, createStoreRows, deleteStoreRows, type MutationDeps } from "./mutations";
import { type MemoryQueryContext, resolveMemoryAccess } from "./context";
import { runQuery } from "./query";
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
  // Cell colors (v0.4) are fully supported unless the caller says otherwise.
  const caps = normalizeCapabilities({
    ...options.capabilities,
    cellColors: { read: true, write: true, filter: true, ...options.capabilities?.cellColors },
  });

  for (const row of options.rows ?? []) {
    if (store.has(row.id)) throw new Error(`Duplicate initial row id "${row.id}"`);
    const copy = withColors(structuredClone(row), cleanColors(row.colors));
    if (!Number.isInteger(copy.version) || copy.version < 1) copy.version = 1;
    if (typeof copy.cells !== "object" || copy.cells === null) copy.cells = {};
    stripFormulas(copy, schema);
    store.set(copy.id, copy);
  }

  function accessMap(): Map<string, Access> {
    return resolveMemoryAccess(schema, resolver, options.user);
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
      ...(options.user ? { user: options.user } : {}),
    };
  }

  /** Readable column keys (cells) and ids (colors) for projecting rows. */
  function readable(): { keys: Set<string>; ids: Set<string> } {
    const access = accessMap();
    const columns = schema.columns.filter((c) => access.get(c.id) === "read" || access.get(c.id) === "edit");
    return { keys: new Set(columns.map((c) => c.key)), ids: new Set(columns.map((c) => c.id)) };
  }

  function requireColumn(columnId: string, need: "read" | "edit"): ColumnDef {
    const column = getColumnById(schema, columnId);
    const access = column ? accessMap().get(column.id) : undefined;
    const ok = need === "edit" ? access === "edit" : access === "read" || access === "edit";
    if (!column || access === "hidden" || access === undefined) {
      throw new InMemoryQueryError(column ? "unreadableColumn" : "unknownColumn", "Unknown column");
    }
    if (!ok) throw new InMemoryQueryError("notEditable", "Column is read-only for you");
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

  /** The current state of `ids` (existing ones, in order), formulas materialised and projected for the user. */
  function readRows(ids: string[]): Row[] {
    const r = readable();
    const e = env();
    return ids.flatMap((id) => {
      const stored = store.get(id);
      return stored ? [projectRow(materialized(stored, schema, e), r.keys, r.ids)] : [];
    });
  }

  /**
   * Manual colors (v0.4): last write wins, no version / updatedAt bump, one
   * feed entry per changed row. A cell is paintable when `canColorCell` says
   * so; hidden columns answer like unknown ones.
   */
  function applyCellColors(batch: CellColorBatch): CellColorResult {
    const applied: CellColorChange[] = [];
    const rejected: CellColorResult["rejected"] = [];
    const access = accessMap();
    const changedRows = new Set<string>();
    for (const change of Array.isArray(batch?.changes) ? batch.changes : []) {
      const { rowId, columnId, color } = change;
      const reject = (message: string) => rejected.push({ rowId, columnId, message });
      const row = store.get(rowId);
      const column = getColumnById(schema, columnId);
      const a = column ? access.get(column.id) : undefined;
      if (!row) reject("Row not found");
      else if (!column || (a !== "read" && a !== "edit")) reject("Column not found");
      else if (!canColorCell(row, column, options.user, resolver) || a !== "edit") reject("Read-only");
      else if (color !== null && !isCellColor(color)) reject("Invalid color");
      else {
        const colors = cleanColors(row.colors, (id) => id !== column.id) ?? {};
        if (color !== null) colors[column.id] = color;
        store.set(rowId, withColors(row, Object.keys(colors).length > 0 ? colors : undefined));
        applied.push({ rowId, columnId, color });
        changedRows.add(rowId);
      }
    }
    for (const rowId of changedRows) log.recordRow(rowId, false);
    return { applied, rejected, rows: readRows([...changedRows]) };
  }

  return {
    async fetch(query: GridQuery): Promise<QueryResult<Row>> {
      const ctx = queryContext();
      const e = { now: ctx.now, tz };
      const limit = query.page?.limit;
      const clamped =
        typeof limit === "number" && limit > caps.maxPageSize ? { ...query, page: { ...query.page, limit: caps.maxPageSize } as GridQuery["page"] } : query;
      return runQuery([...store.values()].map((r) => materialized(r, schema, e)), clamped, ctx);
    },
    capabilities: () => structuredClone(caps),
    async applyChanges(batch: ChangeBatch): Promise<ChangeResult> {
      const result = applyChangeBatch(batch, mutationDeps());
      const ids = [...new Set((Array.isArray(batch?.changes) ? batch.changes : []).map((c) => c.rowId))];
      return { ...result, rows: readRows(ids) };
    },
    async getRows(ids: string[]): Promise<Row[]> {
      return readRows(ids);
    },
    async setCellColors(batch: CellColorBatch): Promise<CellColorResult> {
      return applyCellColors(batch);
    },
    async createRows(partials: RowPartial<Row>[]): Promise<Row[]> {
      const r = readable();
      const e = env();
      return createStoreRows(partials, mutationDeps()).map((row) => projectRow(materialized(row, schema, e), r.keys, r.ids));
    },
    async deleteRows(ids: string[]): Promise<void> {
      deleteStoreRows(ids, mutationDeps());
    },
    async getChanges(since: string): Promise<ChangeFeedEntry<Row>> {
      const from = log.parse(since);
      const { changedIds, deletedIds } = log.since(from);
      const rows = readRows(changedIds);
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
      if (!allowCreate) {
        throw new InMemoryQueryError("unsupportedColumnType", "This column does not allow creating options");
      }
      const text = typeof label === "string" ? label.trim() : "";
      if (text === "") throw new InMemoryQueryError("invalidValue", "Option label must not be empty");
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
        columns: schema.columns.map((c) => {
          if (c.id !== column.id) return c;
          const raw = (c.config as { options?: unknown } | null)?.options;
          return { ...c, config: { ...(c.config as object), options: [...(Array.isArray(raw) ? raw : []), option] } };
        }),
      };
      log.recordSchemaChange();
      return { ...option };
    },
    async lookup(columnId: string, search: string): Promise<LinkRef[]> {
      const column = requireColumn(columnId, "read");
      if (column.type !== "link") {
        throw new InMemoryQueryError("unsupportedColumnType", "lookup is only available on link columns");
      }
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
    snapshot() {
      const e = env();
      return [...store.values()].map((r) => materialized(r, schema, e));
    },
  };
}
