/**
 * Test double: core's real in-memory DataSource (`@masai/schema-grid-core/memory`)
 * wrapped with vi.fn spies and scripting helpers.
 */
import { createInMemoryDataSource as createCoreInMemory } from "@masai/schema-grid-core/memory";
import { vi } from "vitest";
import type {
  ChangeBatch,
  ChangeFeedEntry,
  ChangeResult,
  DataSource,
  FieldTypeRegistry,
  GridQuery,
  GridRow,
  GridSchema,
  GridUser,
  LinkRef,
  Option,
  QueryResult,
  RowPartial,
} from "../../src/internal/core";

export interface InMemoryOptions {
  registry?: FieldTypeRegistry;
  /** Acting user for permission-aware queries and `isMe`. Omit for full access. */
  user?: GridUser | { id: string };
  now?: Date;
  tz?: string;
  /** Link targets for `lookup`, keyed by column id. */
  links?: Record<string, LinkRef[]>;
  /** Artificial latency for every call. */
  delayMs?: number;
}

export interface InMemoryDataSource<Row extends GridRow = GridRow> extends Omit<Required<DataSource<Row>>, "applyChanges"> {
  /** Reports the new per-row `versions` (core `ChangeResult`, spec §4.5 addendum). */
  applyChanges(batch: ChangeBatch): Promise<ChangeResult>;
  /** Current server copy. */
  rows(): Row[];
  /** Simulate another user editing a cell (bumps version, enters feed). */
  remoteEdit(rowId: string, cells: Record<string, unknown>): Promise<Row>;
  remoteDelete(rowId: string): Promise<void>;
  /** Next applyChanges rejects with this error. */
  failNextApply(error: Error): void;
  /** Next applyChanges reports a per-cell error for this cell (instead of applying it). */
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

export function createInMemoryDataSource<Row extends GridRow = GridRow>(
  schema: GridSchema,
  initialRows: Row[],
  opts: InMemoryOptions = {},
): InMemoryDataSource<Row> {
  const hasRoles = !!opts.user && "roles" in opts.user;
  const user = opts.user ? { id: opts.user.id, roles: hasRoles ? (opts.user as GridUser).roles : [] } : undefined;
  const inner = createCoreInMemory<Row>({
    schema,
    rows: initialRows,
    ...(opts.registry ? { registry: opts.registry } : {}),
    ...(user ? { user } : {}),
    // A user given without roles only identifies "me"; it doesn't restrict columns.
    ...(user && !hasRoles ? { resolver: ({ column }: { column: { type: string } }) => (column.type === "formula" ? "read" : "edit") } : {}),
    ...(opts.now ? { now: () => opts.now as Date } : {}),
    ...(opts.tz ? { timeZone: opts.tz } : {}),
    ...(opts.links ? { linkTargets: opts.links } : {}),
    ...(user ? { actor: { id: user.id } } : {}),
  });
  let failNext: Error | null = null;
  const scriptedErrors: { rowId: string; columnId: string; message: string }[] = [];
  const wait = () => (opts.delayMs ? new Promise((r) => setTimeout(r, opts.delayMs)) : Promise.resolve());


  async function fetch(query: GridQuery): Promise<QueryResult<Row>> {
    await wait();
    return inner.fetch(query);
  }

  async function applyChanges(batch: ChangeBatch): Promise<ChangeResult> {
    await wait();
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
    const errors: ChangeResult["errors"] = [];
    const changes = batch.changes.filter((c) => {
      const idx = scriptedErrors.findIndex((e) => e.rowId === c.rowId && e.columnId === c.columnId);
      if (idx < 0) return true;
      const [e] = scriptedErrors.splice(idx, 1);
      if (e) errors.push(e);
      return false;
    });
    // core's in-memory applyChanges reports the new per-row `versions` itself.
    const result: ChangeResult = changes.length
      ? await inner.applyChanges({ ...batch, changes })
      : { applied: [], conflicts: [], errors: [] };
    return { ...result, errors: [...result.errors, ...errors] };
  }

  async function getChanges(since: string): Promise<ChangeFeedEntry<Row>> {
    await wait();
    return inner.getChanges ? inner.getChanges(since ?? "") : { cursor: "", rows: [], deletedRowIds: [], schemaVersion: schema.schemaVersion };
  }

  async function getOptions(columnId: string, search?: string): Promise<Option[]> {
    await wait();
    return inner.getOptions ? inner.getOptions(columnId, search) : [];
  }

  async function createOption(columnId: string, label: string): Promise<Option> {
    await wait();
    if (!inner.createOption) throw new Error("createOption unsupported");
    return inner.createOption(columnId, label);
  }

  async function lookup(columnId: string, search: string): Promise<LinkRef[]> {
    await wait();
    return inner.lookup ? inner.lookup(columnId, search) : [];
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
    createRows: (partials: RowPartial<Row>[]) => inner.createRows(partials),
    deleteRows: (ids: string[]) => inner.deleteRows(ids),
    getChanges: calls.getChanges,
    getOptions: calls.getOptions,
    createOption: calls.createOption,
    lookup: calls.lookup,
    calls,
    rows: () => inner.snapshot(),
    async remoteEdit(rowId, cells) {
      const current = inner.snapshot().find((r) => r.id === rowId);
      if (!current) throw new Error(`No row ${rowId}`);
      const byKey = new Map(schema.columns.map((c) => [c.key, c.id]));
      await inner.applyChanges({
        id: `remote-${rowId}-${current.version}`,
        source: "edit",
        baseVersions: { [rowId]: current.version },
        changes: Object.entries(cells).map(([key, next]) => ({
          rowId,
          columnId: byKey.get(key) ?? key,
          prev: current.cells[key] ?? null,
          next,
        })),
      });
      const updated = inner.snapshot().find((r) => r.id === rowId);
      if (!updated) throw new Error(`No row ${rowId}`);
      return updated;
    },
    async remoteDelete(rowId) {
      await inner.deleteRows([rowId]);
    },
    failNextApply(error) {
      failNext = error;
    },
    errorOn(rowId, columnId, message) {
      scriptedErrors.push({ rowId, columnId, message });
    },
    bumpSchemaVersion() {
      const s = inner.getSchema();
      inner.setSchema({ ...s, schemaVersion: s.schemaVersion + 1 });
    },
  };
}
