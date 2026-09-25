/**
 * In-memory DataSource test double implementing spec §4.6.
 * TODO(core): replace with core's `createInMemoryDataSource` once it ships;
 * keep the spy/scripting wrapper.
 */
import { vi } from "vitest";
import {
  type CellChange,
  type ChangeBatch,
  type ChangeFeedEntry,
  type ChangeResult,
  type DataSource,
  type FieldTypeRegistry,
  type GridQuery,
  type GridRow,
  type GridSchema,
  type GroupResult,
  type LinkRef,
  type Option,
  type QueryResult,
  computeAggregate,
  createDefaultRegistry,
  matchesFilter,
  searchRows,
  sortRows,
} from "../../src/internal/core";

export interface InMemoryOptions {
  registry?: FieldTypeRegistry;
  user?: { id: string };
  now?: Date;
  tz?: string;
  options?: Record<string, Option[]>;
  links?: Record<string, LinkRef[]>;
  /** Artificial latency for every call. */
  delayMs?: number;
}

export interface InMemoryDataSource<Row extends GridRow = GridRow> extends Required<DataSource<Row>> {
  /** Current server copy (clones). */
  rows(): Row[];
  /** Simulate another user editing a cell (bumps version, enters feed). */
  remoteEdit(rowId: string, cells: Record<string, unknown>, by?: string): Row;
  remoteDelete(rowId: string): void;
  /** Next applyChanges rejects with this error. */
  failNextApply(error: Error): void;
  /** Next applyChanges reports a per-cell error for this cell. */
  errorOn(rowId: string, columnId: string, message: string): void;
  /** Bump schemaVersion as reported in the change feed. */
  bumpSchemaVersion(): void;
  calls: {
    fetch: ReturnType<typeof vi.fn>;
    applyChanges: ReturnType<typeof vi.fn>;
    getChanges: ReturnType<typeof vi.fn>;
    getOptions: ReturnType<typeof vi.fn>;
    createOption: ReturnType<typeof vi.fn>;
    lookup: ReturnType<typeof vi.fn>;
  };
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

export function createInMemoryDataSource<Row extends GridRow = GridRow>(
  schema: GridSchema,
  initialRows: Row[],
  opts: InMemoryOptions = {},
): InMemoryDataSource<Row> {
  const registry = opts.registry ?? createDefaultRegistry();
  const store = new Map<string, Row>(initialRows.map((r) => [r.id, clone(r)]));
  const order: string[] = initialRows.map((r) => r.id);
  const feed: { seq: number; rowId: string; deleted: boolean }[] = [];
  const options: Record<string, Option[]> = clone(opts.options ?? {});
  let seq = 0;
  let schemaVersion = schema.schemaVersion;
  let failNext: Error | null = null;
  const scriptedErrors: { rowId: string; columnId: string; message: string }[] = [];
  let idCounter = 0;

  const wait = () => (opts.delayMs ? new Promise((r) => setTimeout(r, opts.delayMs)) : Promise.resolve());
  const keyOf = (columnId: string) => schema.columns.find((c) => c.id === columnId)?.key ?? columnId;
  const ordered = () => order.map((id) => store.get(id)).filter((r): r is Row => !!r);
  const record = (rowId: string, deleted = false) => {
    seq += 1;
    feed.push({ seq, rowId, deleted });
  };
  const ctx = () => ({ schema, registry, user: opts.user, now: opts.now ?? new Date(), tz: opts.tz });

  async function fetch(query: GridQuery): Promise<QueryResult<Row>> {
    await wait();
    let rows = ordered().filter((r) => matchesFilter(r, query.filter, ctx()));
    rows = searchRows(rows, query.search, { schema, registry });
    rows = sortRows(rows, query.sort, { schema, registry });
    const total = rows.length;
    let groups: GroupResult[] | undefined;
    const g = query.groupBy?.[0];
    if (g) {
      const column = schema.columns.find((c) => c.id === g.columnId);
      if (column) {
        const buckets = new Map<string, { key: unknown; rows: Row[] }>();
        for (const r of rows) {
          const key = r.cells[column.key] ?? null;
          const id = JSON.stringify(key);
          const b = buckets.get(id) ?? { key, rows: [] };
          b.rows.push(r);
          buckets.set(id, b);
        }
        groups = [...buckets.values()].map((b) => {
          const aggregates: Record<string, unknown> = {};
          for (const a of g.aggregations ?? []) {
            const k = keyOf(a.columnId);
            aggregates[`${a.columnId}:${a.agg}`] = computeAggregate(
              b.rows.map((r) => r.cells[k]),
              a.agg,
            );
          }
          return { columnId: column.id, key: b.key, count: b.rows.length, aggregates };
        });
      }
    }
    const page = query.page;
    const offset = "offset" in page ? page.offset : page.cursor ? Number(page.cursor) : 0;
    const slice = rows.slice(offset, offset + page.limit).map(clone);
    const end = offset + slice.length;
    const result: QueryResult<Row> = { rows: slice };
    if (query.includeTotal || "offset" in page) result.total = total;
    if (!("offset" in page) && end < total) result.nextCursor = String(end);
    if (groups) result.groups = groups;
    return result;
  }

  async function applyChanges(batch: ChangeBatch): Promise<ChangeResult> {
    await wait();
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
    const result: ChangeResult = { applied: [], conflicts: [], errors: [] };
    const byRow = new Map<string, CellChange[]>();
    for (const c of batch.changes) {
      const list = byRow.get(c.rowId) ?? [];
      list.push(c);
      byRow.set(c.rowId, list);
    }
    for (const [rowId, changes] of byRow) {
      const current = store.get(rowId);
      if (!current) {
        for (const c of changes) result.errors.push({ rowId, columnId: c.columnId, message: "Row not found" });
        continue;
      }
      const base = batch.baseVersions[rowId];
      if (base !== undefined && base !== current.version) {
        for (const c of changes) {
          result.conflicts.push({
            rowId,
            columnId: c.columnId,
            serverValue: clone(current.cells[keyOf(c.columnId)] ?? null),
            serverVersion: current.version,
            updatedBy: current.updatedBy,
            updatedAt: current.updatedAt,
          });
        }
        continue;
      }
      const ok: CellChange[] = [];
      for (const c of changes) {
        const idx = scriptedErrors.findIndex((e) => e.rowId === rowId && e.columnId === c.columnId);
        if (idx >= 0) {
          const [e] = scriptedErrors.splice(idx, 1);
          if (e) result.errors.push(e);
        } else ok.push(c);
      }
      if (ok.length) {
        const cells = { ...current.cells };
        for (const c of ok) cells[keyOf(c.columnId)] = clone(c.next);
        store.set(rowId, {
          ...current,
          cells,
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: opts.user ? { id: opts.user.id } : current.updatedBy,
        });
        record(rowId);
        result.applied.push(...ok);
        result.versions = { ...(result.versions ?? {}), [rowId]: current.version + 1 };
      }
    }
    return result;
  }

  async function createRows(partials: Partial<Row>[]): Promise<Row[]> {
    await wait();
    return partials.map((p) => {
      idCounter += 1;
      const r = {
        id: p.id ?? `new-${idCounter}`,
        version: 1,
        updatedAt: new Date().toISOString(),
        cells: {},
        ...p,
      } as Row;
      store.set(r.id, clone(r));
      order.push(r.id);
      record(r.id);
      return clone(r);
    });
  }

  async function deleteRows(ids: string[]): Promise<void> {
    await wait();
    for (const id of ids) {
      if (store.delete(id)) {
        order.splice(order.indexOf(id), 1);
        record(id, true);
      }
    }
  }

  async function getChanges(since: string | null): Promise<ChangeFeedEntry<Row>> {
    await wait();
    const from = since ? Number(since) : 0;
    const entries = feed.filter((f) => f.seq > from);
    const latest = new Map<string, boolean>();
    for (const e of entries) latest.set(e.rowId, e.deleted);
    const rows: Row[] = [];
    const deletedRowIds: string[] = [];
    for (const [id, deleted] of latest) {
      const r = store.get(id);
      if (deleted || !r) deletedRowIds.push(id);
      else rows.push(clone(r));
    }
    return { cursor: String(seq), rows, deletedRowIds, schemaVersion };
  }

  async function getOptions(columnId: string, search?: string): Promise<Option[]> {
    await wait();
    const column = schema.columns.find((c) => c.id === columnId);
    const fromConfig = ((column?.config as { options?: Option[] } | undefined)?.options ?? []) as Option[];
    const list = [...fromConfig, ...(options[columnId] ?? [])];
    const s = (search ?? "").toLowerCase();
    return clone(s ? list.filter((o) => o.label.toLowerCase().includes(s)) : list);
  }

  async function createOption(columnId: string, label: string): Promise<Option> {
    await wait();
    const option: Option = { value: label.toLowerCase().replace(/\s+/g, "-"), label };
    options[columnId] = [...(options[columnId] ?? []), option];
    return clone(option);
  }

  async function lookup(columnId: string, search: string): Promise<LinkRef[]> {
    await wait();
    const s = search.toLowerCase();
    return clone((opts.links?.[columnId] ?? []).filter((l) => l.label.toLowerCase().includes(s)));
  }

  const calls = {
    fetch: vi.fn(fetch),
    applyChanges: vi.fn(applyChanges),
    getChanges: vi.fn(getChanges),
    getOptions: vi.fn(getOptions),
    createOption: vi.fn(createOption),
    lookup: vi.fn(lookup),
  };

  return {
    fetch: calls.fetch,
    applyChanges: calls.applyChanges,
    createRows,
    deleteRows,
    getChanges: calls.getChanges,
    getOptions: calls.getOptions,
    createOption: calls.createOption,
    lookup: calls.lookup,
    calls,
    rows: () => ordered().map(clone),
    remoteEdit(rowId, cells, by = "someone-else") {
      const current = store.get(rowId);
      if (!current) throw new Error(`No row ${rowId}`);
      const next = {
        ...current,
        cells: { ...current.cells, ...clone(cells) },
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: { id: by },
      };
      store.set(rowId, next);
      record(rowId);
      return clone(next);
    },
    remoteDelete(rowId) {
      if (store.delete(rowId)) {
        order.splice(order.indexOf(rowId), 1);
        record(rowId, true);
      }
    },
    failNextApply(error) {
      failNext = error;
    },
    errorOn(rowId, columnId, message) {
      scriptedErrors.push({ rowId, columnId, message });
    },
    bumpSchemaVersion() {
      schemaVersion += 1;
      seq += 1;
    },
  };
}
