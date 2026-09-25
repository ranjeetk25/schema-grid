/**
 * Applies a `RemotePatchPlan` (from `planRemotePatch`) to the grid (T28).
 *
 * `applyRemotePatch(api, plan, mode, stores, opts)`:
 *  - client mode: the ROW STORE is the only update path — `rowData` is
 *    derived from it, so we `upsert(updates + adds)` and `remove(removes)`
 *    and never call `applyTransaction`. `adds` already match the view (the
 *    planner filters them).
 *  - server (infinite) mode: loaded nodes get `setData(row)` directly (rows
 *    that aren't loaded have no node and are skipped), then the row store is
 *    upserted. Infinite blocks can't insert rows, so `adds` are ignored (the
 *    next refetch shows them); `removes` leave the store and trigger
 *    `refreshInfiniteCache()`.
 *  - `notInViewRowIds` get the row store's `notInView` flag (the row keeps
 *    its place and gets `sg-row-not-in-view` via `rowClassRules`); updated
 *    rows that match the view again lose a stale flag. All flags are cleared
 *    by the next refetch (`useSchemaGrid`'s `loadAll` / `refetch`).
 *  - `remoteChangedCells` are marked in the cell status store (the
 *    `sg-cell-remote-changed` class comes from the status cell class rules).
 *  - `flashCells` targets exactly `changedCells`: one call per row with that
 *    row's columns (a single call would flash the rows × columns product).
 *    In client mode the flash runs through `opts.afterGridUpdate` so it
 *    happens after AG Grid has the re-derived `rowData`; default: now.
 *  - deferred rows are merged into `opts.deferred` (`mergeDeferred`,
 *    last-write-wins) and NOT applied; `applyDeferredRows` re-plans them
 *    later (after editing stops / pending clears) so a row is only applied
 *    while it is still newer than the local copy.
 *  - emits `events.onRemoteChanges(entry)` and, when `plan.schemaChanged`,
 *    `events.onSchemaChanged(entry.schemaVersion)`.
 *
 * `useRemoteSync` wires this into `useSchemaGrid`: it polls via
 * `usePollingSync` (enabled = `poll.enabled ?? documentVisible`, and only
 * when the data source has `getChanges`), starting from the "" cursor. The
 * first poll therefore replays everything since the start of the feed;
 * that's safe, because rows whose version is not newer than the local copy
 * are ignored by `planRemotePatch` and only rows matching the view are
 * added. A later local commit on a cell that changed remotely (deferred or
 * not yet polled) is sent with the stale base version, so the server
 * reports a conflict and the edit controller routes it to `onConflict`.
 *
 * Caveat: when `beforeCellsChange` is async, a commit's cells become
 * pending only after it settles; a deferred flush in that window applies the
 * remote row first and the commit then silently overwrites it (no conflict).
 */
import type { GridApi, IRowNode } from "ag-grid-community";
import { useCallback, useEffect, useRef } from "react";
import { deriveClientRows } from "../client/deriveClientRows";
import {
  type ChangeFeedEntry,
  type ColumnDef,
  type DataSource,
  type FieldTypeRegistry,
  type FilterNode,
  type FilterValidationError,
  type GridRow,
  type GridSchema,
  matchesFilter,
  type SchemaGridEvents,
} from "../internal/core";
import type { CellRef, CellStatusStore } from "../state/cellStatusStore";
import type { QueryState } from "../state/queryStore";
import type { RowStore } from "../state/rowStore";
import { mergeDeferred, planRemotePatch, type RemotePatchPlan } from "./planRemotePatch";
import { useDocumentVisible } from "./useDocumentVisible";
import { usePollingSync } from "./usePollingSync";

export type RemotePatchMode = "client" | "server";

export interface RemotePatchStores<Row extends GridRow = GridRow> {
  rows: RowStore<Row>;
  cellStatus: CellStatusStore;
}

/** Mutable holder of rows withheld because a changed cell was being edited or pending. */
export interface DeferredRowsRef<Row extends GridRow = GridRow> {
  current: ReadonlyMap<string, Row>;
}

export interface ApplyRemotePatchOptions<Row extends GridRow = GridRow> {
  /** The feed entry the plan came from; required for the events. */
  entry?: ChangeFeedEntry<Row>;
  events?: SchemaGridEvents<Row>;
  deferred?: DeferredRowsRef<Row>;
  /** Client mode: runs `fn` once AG Grid has the new rowData. Default: runs it now. */
  afterGridUpdate?(fn: () => void): void;
}

function flashExactCells<Row extends GridRow>(api: GridApi<Row> | null, cells: readonly CellRef[]): void {
  if (!api || cells.length === 0) return;
  const byRow = new Map<string, string[]>();
  for (const c of cells) {
    const cols = byRow.get(c.rowId);
    if (cols) {
      if (!cols.includes(c.columnId)) cols.push(c.columnId);
    } else byRow.set(c.rowId, [c.columnId]);
  }
  for (const [rowId, columns] of byRow) {
    const node = api.getRowNode(rowId);
    if (node) api.flashCells({ rowNodes: [node], columns });
  }
}

export function applyRemotePatch<Row extends GridRow>(
  api: GridApi<Row> | null,
  plan: RemotePatchPlan<Row>,
  mode: RemotePatchMode,
  stores: RemotePatchStores<Row>,
  opts: ApplyRemotePatchOptions<Row> = {},
): void {
  const { rows, cellStatus } = stores;

  if (opts.deferred) {
    let next = mergeDeferred(opts.deferred.current, plan.deferred);
    if (plan.removes.some((id) => next.has(id))) {
      next = new Map(next);
      for (const id of plan.removes) next.delete(id);
    }
    opts.deferred.current = next;
  }
  for (const cell of plan.remoteChangedCells) cellStatus.markRemoteChanged(cell);

  const notInView = new Set(plan.notInViewRowIds);
  const backInView = plan.updates.filter((r) => !notInView.has(r.id) && rows.isNotInView(r.id)).map((r) => r.id);

  if (mode === "client") {
    rows.upsert([...plan.updates, ...plan.adds]);
    rows.remove(plan.removes);
  } else {
    for (const r of plan.updates) {
      const node: IRowNode<Row> | undefined = api?.getRowNode(r.id);
      node?.setData(r);
    }
    rows.upsert(plan.updates);
    if (plan.removes.length > 0) {
      rows.remove(plan.removes);
      api?.refreshInfiniteCache();
    }
  }
  rows.setNotInView(plan.notInViewRowIds, true);
  rows.setNotInView(backInView, false);

  if (plan.changedCells.length > 0) {
    const flash = (): void => flashExactCells(api, plan.changedCells);
    if (mode === "client" && opts.afterGridUpdate) opts.afterGridUpdate(flash);
    else flash();
  }

  if (opts.entry) {
    opts.events?.onRemoteChanges?.(opts.entry);
    if (plan.schemaChanged) opts.events?.onSchemaChanged?.(opts.entry.schemaVersion);
  }
}

export interface ApplyDeferredRowsOptions<Row extends GridRow = GridRow> {
  deferred: DeferredRowsRef<Row>;
  schema: GridSchema;
  editingCell: CellRef | null;
  pendingCells: ReadonlySet<string> | ((cell: CellRef) => boolean);
  matchesView(row: Row): boolean;
  schemaVersion: number;
  afterGridUpdate?(fn: () => void): void;
}

/**
 * Re-plans the deferred rows against the CURRENT local state: rows whose
 * changed cells are still edited/pending stay deferred, rows no newer than
 * the local copy are dropped, rows no longer in the store are dropped (never
 * resurrected), the rest are applied (flashed, remote-changed marks cleared).
 * Emits no events (they fired when the entry arrived).
 */
export function applyDeferredRows<Row extends GridRow>(
  api: GridApi<Row> | null,
  mode: RemotePatchMode,
  stores: RemotePatchStores<Row>,
  opts: ApplyDeferredRowsOptions<Row>,
): void {
  const pending = [...opts.deferred.current.values()];
  if (pending.length === 0) return;
  opts.deferred.current = new Map();
  const plan = planRemotePatch<Row>({
    entry: { cursor: "", rows: pending, deletedRowIds: [], schemaVersion: opts.schemaVersion },
    rowStore: stores.rows,
    schema: opts.schema,
    editingCell: opts.editingCell,
    pendingCells: opts.pendingCells,
    matchesView: opts.matchesView,
    currentSchemaVersion: opts.schemaVersion,
  });
  applyRemotePatch(api, { ...plan, adds: [] }, mode, stores, {
    deferred: opts.deferred,
    ...(opts.afterGridUpdate ? { afterGridUpdate: opts.afterGridUpdate } : {}),
  });
  for (const cell of plan.changedCells) {
    if (stores.cellStatus.get(cell.rowId, cell.columnId).remoteChanged) stores.cellStatus.clearRemoteChanged(cell);
  }
}

// ---- View predicate ------------------------------------------------------------------

export interface ViewMatchConfig {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  readable: ReadonlySet<string>;
  externalFilter: FilterNode | null;
  externalErrors: readonly FilterValidationError[];
  getCellValue(row: GridRow, column: ColumnDef): unknown;
  tz: string;
  stableUser: { id: string };
}

/**
 * The same predicate the client derivation applies: the trusted external
 * filter (fail closed when invalid), then the user's filter + search on
 * readable columns (an invalid user filter is not applied).
 */
export function rowMatchesView<Row extends GridRow>(
  row: Row,
  c: ViewMatchConfig,
  query: Pick<QueryState, "filter" | "search">,
): boolean {
  if (c.externalErrors.length > 0) return false;
  const user = { id: c.stableUser.id };
  if (c.externalFilter) {
    const ctx = { schema: c.schema, registry: c.registry, user, tz: c.tz, getCellValue: c.getCellValue };
    if (!matchesFilter(row, c.externalFilter, ctx)) return false;
  }
  const derived = deriveClientRows(
    [row],
    { filter: query.filter, sort: [], search: query.search },
    { schema: c.schema, registry: c.registry, readableColumnIds: c.readable, user, tz: c.tz, getCellValue: c.getCellValue },
  );
  return derived.rows.length === 1;
}

// ---- Hook ----------------------------------------------------------------------------

export interface UseRemoteSyncOptions<Row extends GridRow = GridRow> {
  api(): GridApi<Row> | null;
  mode: RemotePatchMode;
  stores: RemotePatchStores<Row>;
  dataSource: Pick<DataSource<Row>, "getChanges">;
  poll?: { intervalMs?: number; enabled?: boolean };
  schema: GridSchema;
  events(): SchemaGridEvents<Row> | undefined;
  matchesView(row: Row): boolean;
}

export interface UseRemoteSyncResult {
  /** Grid `onCellEditingStopped`: re-plans deferred rows. Stable. */
  onCellEditingStopped(): void;
  /** Call once AG Grid has applied new client rowData (runs queued flashes). Stable. */
  flushAfterGridUpdate(): void;
  pollNow(): Promise<void>;
}

function editingCellOf<Row extends GridRow>(api: GridApi<Row> | null): CellRef | null {
  if (!api) return null;
  const editing = api.getEditingCells()[0];
  if (!editing?.column) return null;
  const rowId = (api.getDisplayedRowAtIndex(editing.rowIndex)?.data as Row | undefined)?.id;
  return rowId === undefined ? null : { rowId, columnId: editing.column.getColId() };
}

export function useRemoteSync<Row extends GridRow>(options: UseRemoteSyncOptions<Row>): UseRemoteSyncResult {
  const latest = useRef(options);
  latest.current = options;
  const visible = useDocumentVisible();
  const enabled = (options.poll?.enabled ?? visible) && !!options.dataSource.getChanges;

  const deferred = useRef<ReadonlyMap<string, Row>>(new Map());
  const afterUpdate = useRef<(() => void)[]>([]);
  const schemaVersion = useRef(options.schema.schemaVersion);
  const lastSchemaProp = useRef(options.schema.schemaVersion);
  if (lastSchemaProp.current !== options.schema.schemaVersion) {
    lastSchemaProp.current = options.schema.schemaVersion;
    schemaVersion.current = options.schema.schemaVersion;
  }

  const afterGridUpdate = useCallback((fn: () => void) => {
    afterUpdate.current.push(fn);
  }, []);
  const flushAfterGridUpdate = useCallback(() => {
    const queued = afterUpdate.current;
    afterUpdate.current = [];
    for (const fn of queued) fn();
  }, []);

  const pendingCells = useCallback(
    (c: CellRef) => latest.current.stores.cellStatus.get(c.rowId, c.columnId).pending,
    [],
  );

  const onEntry = useCallback(
    (entry: ChangeFeedEntry<Row>) => {
      const o = latest.current;
      const api = o.api();
      const plan = planRemotePatch<Row>({
        entry,
        rowStore: o.stores.rows,
        schema: o.schema,
        editingCell: editingCellOf(api),
        pendingCells,
        matchesView: o.matchesView,
        currentSchemaVersion: schemaVersion.current,
      });
      if (plan.schemaChanged) schemaVersion.current = entry.schemaVersion;
      applyRemotePatch(api, plan, o.mode, o.stores, {
        entry,
        events: o.events(),
        deferred,
        afterGridUpdate,
      });
    },
    [pendingCells, afterGridUpdate],
  );

  const flushScheduled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const scheduleDeferredFlush = useCallback(() => {
    if (flushScheduled.current || deferred.current.size === 0) return;
    flushScheduled.current = true;
    queueMicrotask(() => {
      flushScheduled.current = false;
      if (!mounted.current) return;
      const o = latest.current;
      const api = o.api();
      applyDeferredRows(api, o.mode, o.stores, {
        deferred,
        schema: o.schema,
        editingCell: editingCellOf(api),
        pendingCells,
        matchesView: o.matchesView,
        schemaVersion: schemaVersion.current,
        afterGridUpdate,
      });
    });
  }, [pendingCells, afterGridUpdate]);

  // Pending writes settling may release deferred rows.
  const { cellStatus } = options.stores;
  useEffect(() => cellStatus.subscribeChanges(scheduleDeferredFlush), [cellStatus, scheduleDeferredFlush]);

  const { pollNow } = usePollingSync<Row>({
    dataSource: options.dataSource,
    ...(options.poll?.intervalMs !== undefined ? { intervalMs: options.poll.intervalMs } : {}),
    enabled,
    initialCursor: null,
    onEntry,
  });

  return { onCellEditingStopped: scheduleDeferredFlush, flushAfterGridUpdate, pollNow };
}
