/**
 * `useSchemaGrid`: the headless integration hub. It owns the stores, the edit
 * controller and the undo stack, and assembles `AgGridReactProps` from props.
 *
 * Data flow
 * - The query store is the single source of truth for the USER's filter/sort/
 *   search/groupBy. Header sort (`onSortChanged`) and column filters
 *   (`onFilterChanged`) write INTO it; changes in it are pushed back to the
 *   grid (column sort state / filter model), guarded by value equality so the
 *   two never ping-pong.
 * - Unreadable columns never drive sort, search, grouping or aggregation: an
 *   initial view is pruned, groupBy/sort are pruned before use, and a user
 *   filter that fails validation against the readable columns is dropped
 *   (errors in `filterErrors.user`).
 * - `externalFilter` is TRUSTED host input, kept apart from the user filter:
 *   validated against ALL schema columns; when invalid the grid fails closed
 *   (zero rows, no fetch, `filterErrors.external`, `loadState: "error"`).
 *   client mode: sent to `dataSource.fetch` and applied with core
 *   `matchesFilter` BEFORE the user filter/search/sort. server mode: AND-ed
 *   into `GridQuery.filter` — the server MUST enforce the real restriction
 *   itself; the client can't make that guarantee.
 * - client mode: every row is fetched (offset pages of `pageSize`,
 *   `includeTotal`) into the row store. Offset paging needs a stable server
 *   order; we send no sort and rely on the data source's default order (core's
 *   in-memory source tie-breaks by id; other servers must be stable too).
 *   `rowData` is derived from row store + query store (`deriveClientRows`),
 *   grouped by `buildClientGroups` when `groupBy` is set. Re-derivation is
 *   coalesced to one microtask, so a query change never refetches.
 *   Rows flagged `notInView` (T28) stay at their previous position.
 * - server mode: AG Grid's infinite row model. Each effective query gets its
 *   own datasource object (set via the `datasource` grid option, then
 *   `ensureIndexVisible(0)`); pages from an older datasource never reach the
 *   row store. Before each block request, the grid's current sort/filter
 *   model is synced into the query store so a header sort never fetches with a
 *   stale query. `refetch()` purges the cache of the current datasource.
 * - Loads never roll back local state: `rowStore.upsert` skips older
 *   versions, and cells with a pending write keep their local value. A
 *   conflict (`onRowStale`) refetches everything with the same guards (the
 *   data source has no fetch-by-id).
 * - Edits: `readOnlyEdit` + `onCellEditRequest` → edit controller →
 *   optimistic row-store patch → (client) re-derive / (server) `setData` on
 *   the loaded node. Cell status changes refresh the changed cells in one
 *   `refreshCells` call per notification.
 * - Views: column state is applied only through `applyViewState` (grid ready
 *   and `view.id` changes; `maintainColumnOrder` keeps it across column def
 *   updates).
 *
 * Seams for later tasks: `UseSchemaGridSeams` (renderer wrapping for the
 * range/fill `CellShell`, extra cell/row class rules, full-width group
 * renderers, announcer, `onApplied` after a successful batch), `rowModelKey`
 * (T27 switches server + groupBy to the client-side model; `<SchemaGrid>` keys `AgGridReact` on it).
 * - Polling (T28): `useRemoteSync` polls `getChanges` (`poll.enabled` defaults
 *   to document visibility) and applies patches through the row store (client)
 *   or `setData` (server); see `sync/applyRemotePatch.ts`. Flashes queued by it
 *   run after new client `rowData` lands; deferred rows are re-planned on
 *   `onCellEditingStopped` and whenever pending cells settle.
 * - Range selection (T23): `useRangeSelection` handles cell mouse/focus events
 *   and registers Shift+Arrow on the `keyboard` registry, whose
 *   `suppressKeyboardEvent` is composed onto every column (`grid/keyboard.ts`).
 *   Highlight rules and the `CellShell` fill handle come in via the seams.
 * - Fill handle (T25): `useFillHandle` installs `context.onFillHandlePointerDown`,
 *   chains onto `onCellMouseOver` (range mousedown is skipped while filling)
 *   and submits ONE "fill" batch through the controller.
 *
 * `schema`, `dataSource`, `resolver`, `registry`, `uiRegistry` and `theme` are
 * compared by reference: pass stable instances. `user` and `externalFilter`
 * are compared by value. `mode` must not change after mount.
 */
import type {
  CellClassParams,
  CellClassRules,
  CellMouseDownEvent,
  CellMouseOverEvent,
  ColumnMovedEvent,
  ColumnPinnedEvent,
  ColumnResizedEvent,
  ColumnState,
  ColumnVisibleEvent,
  FilterChangedEvent,
  GridApi,
  GridOptions,
  GridReadyEvent,
  IDatasource,
  IGetRowsParams,
  IRowNode,
  IsFullWidthRowParams,
  RowClassParams,
  RowClassRules,
  SortChangedEvent,
  Theme,
} from "ag-grid-community";
import type { AgGridReactProps, CustomCellRendererProps } from "ag-grid-react";
import { type ComponentType, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SCHEMA_GRID_CLIENT_MODULES, SCHEMA_GRID_INFINITE_MODULES } from "../agModules";
import { withEditAnnouncements } from "../a11y/editAnnouncements";
import { combineFilters } from "../client/combineFilters";
import { deriveClientRows, makePostSortRows } from "../client/deriveClientRows";
import type { ClipboardReport } from "../clipboard/types";
import { type ClipboardHandlers, useClipboard } from "../clipboard/useClipboard";
import { createCellAccess } from "../compile/cellAccess";
import { compileColumns } from "../compile/compileColumns";
import { compileFormulaColumns } from "../compile/formulaColumns";
import { createDefaultUiRegistry, type UiFieldTypeRegistry } from "../compile/uiRegistry";
import { type AppliedInfo, createEditController, type EditController } from "../editing/editController";
import { createEditRequestHandler } from "../editing/editEntry";
import { exportCsv as exportGridCsv } from "../export/csv";
import { exportCurrentView as exportViewThroughIo } from "../export/exportCurrentView";
import { astToFilterModel, type ColumnFilterModel, filterModelToAst } from "../filters/filterModel";
import { buildClientGroups, type DisplayRow, type GroupDisplayRow, isGroupRow, isLoadMoreRow } from "../grouping/clientGroups";
import {
  type Access,
  type ColumnDef,
  createDefaultRegistry,
  createRolePermissionResolver,
  DEFAULT_TZ,
  type DataSource,
  type FieldTypeRegistry,
  type FilterNode,
  type FilterValidationError,
  type GridQuery,
  type GridRow,
  type GridSchema,
  type GridUser,
  type GroupSpec,
  isFilterGroup,
  isFormulaError,
  matchesFilter,
  type PermissionResolver,
  resolveColumnAccess,
  type SchemaGridEvents,
  type SortSpec,
  validateFilter,
  type ViewDef,
} from "../internal/core";
import { createInfiniteDatasource, INFINITE_DEFAULTS, type PageMode } from "../server/infiniteDatasource";
import { type ServerGroupsHandle, useServerGroups } from "../server/serverGroups";
import { type CellRef, type CellStatusStore, createCellStatusStore, parseCellKey } from "../state/cellStatusStore";
import { createExpansionStore } from "../state/expansionStore";
import { createQueryStore, type QueryState } from "../state/queryStore";
import { createRangeStore } from "../state/rangeStore";
import { useRangeSelection } from "../range/useRangeSelection";
import { useFillHandle } from "../fill/useFillHandle";
import { createRowStore, type RowStore } from "../state/rowStore";
import { rowMatchesView, useRemoteSync } from "../sync/applyRemotePatch";
import { SG_CLASSES } from "../theme/classNames";
import { createSchemaGridTheme } from "../theme/theme";
import { createUndoStack } from "../undo/undoStack";
import { useUndoKeybindings } from "../undo/useUndoKeybindings";
import { applyViewState, captureViewState } from "../views/viewState";
import type { SchemaGridHookContext, SchemaGridStores } from "./gridContext";
import { createKeyboardRegistry, type KeyboardRegistry, withSuppressKeyboardEvent } from "./keyboard";

export type { ClipboardReport } from "../clipboard/types";

export type SchemaGridMode = "client" | "server";

export interface SchemaGridPollOptions {
  intervalMs?: number;
  /** Defaults to document visibility (T28). */
  enabled?: boolean;
}

export interface SchemaGridProps<Row extends GridRow = GridRow> {
  schema: GridSchema;
  dataSource: DataSource<Row>;
  user: GridUser;
  /** Default: `createRolePermissionResolver()`. */
  resolver?: PermissionResolver<Row>;
  /** Default: `createDefaultRegistry()`. */
  registry?: FieldTypeRegistry;
  /** Default: `createDefaultUiRegistry()`. */
  uiRegistry?: UiFieldTypeRegistry<Row>;
  /** Applied on grid ready and whenever `view.id` changes. */
  view?: ViewDef | null;
  /** Fired after sort/filter/search/groupBy/column changes; identical consecutive views are deduped. */
  onViewChange?(view: ViewDef): void;
  events?: SchemaGridEvents<Row>;
  /** Default "client". Must not change after mount. */
  mode?: SchemaGridMode;
  /** Default `DEFAULT_TZ`. */
  tz?: string;
  /** Default 100 (client fetch page size and server block size). */
  pageSize?: number;
  /** Server mode paging. Default "offset". */
  pageMode?: PageMode;
  /**
   * Trusted host restriction, validated against ALL schema columns (it may
   * use columns hidden from the user). Invalid → the grid fails closed. Never
   * shown in column filters or captured into views. In server mode it is only
   * AND-ed into the query: enforce it on the server.
   */
  externalFilter?: FilterNode | null;
  onClipboardReport?(report: ClipboardReport): void;
  /** Change-feed polling (needs `dataSource.getChanges`). Default interval 7s; enabled defaults to document visibility. */
  poll?: SchemaGridPollOptions;
  /** Default `createSchemaGridTheme()`. */
  theme?: Theme;
  /**
   * Escape hatch, merged last. It can NEVER override `readOnlyEdit`,
   * `onCellEditRequest`, `rowModelType`, `modules`, `context`, `getRowId`,
   * `rowData`, `datasource`, `postSortRows` or `maintainColumnOrder`. Event
   * handlers we also set (`onGridReady`, `onGridPreDestroyed`,
   * `onSortChanged`, `onFilterChanged`, `onColumnMoved`/`Resized`/`Visible`/
   * `Pinned`) are chained: ours run first, then yours. Anything else here
   * (e.g. `domLayout`) wins.
   */
  gridOptions?: Partial<GridOptions<Row>>;
}

/** Internal extension points for later tasks. Every value must be referentially stable. */
export interface UseSchemaGridSeams<Row extends GridRow = GridRow> {
  /** Wraps every column renderer (range/fill `CellShell`). Must cache per input renderer. */
  wrapRenderer?(renderer: ComponentType<CustomCellRendererProps<Row>>): ComponentType<CustomCellRendererProps<Row>>;
  /** Extra cell class rules (range highlighting), merged with the status rules. */
  cellClassRules?: CellClassRules<Row>;
  /** Extra row class rules, merged with the notInView rule. */
  rowClassRules?: RowClassRules<Row>;
  /** Group / load-more full-width renderer (T27). Full-width rows are only enabled when given. */
  fullWidthCellRenderer?: ComponentType<CustomCellRendererProps<Row>>;
  /** Live-region announcer (T21/T30). */
  announce?(message: string, politeness?: "polite" | "assertive"): void;
  /**
   * Called after the edit controller applied a batch (after undo recording),
   * e.g. `<SchemaGrid>` announces "Saved N cells". Read through a ref, so it
   * need not be stable.
   */
  onApplied?(info: AppliedInfo<Row>): void;
}

export interface SchemaGridUndo {
  undo(): Promise<void>;
  redo(): Promise<void>;
  canUndo(): boolean;
  canRedo(): boolean;
}

export type ExportFormat = "csv" | "xlsx";

export type SchemaGridLoadState = "idle" | "loading" | "error";

/** The AG Grid row model in effect; `<SchemaGrid>` keys `AgGridReact` on it (T27 adds server+groupBy → "clientSide"). */
export type RowModelKey = "clientSide" | "infinite";

export interface SchemaGridFilterErrors {
  /** The user's filter failed validation against the readable columns; it is NOT applied. */
  user: FilterValidationError[];
  /** `externalFilter` failed validation against all columns; the grid shows zero rows. */
  external: FilterValidationError[];
}

export interface UseSchemaGridResult<Row extends GridRow = GridRow> {
  gridProps: AgGridReactProps<Row>;
  api(): GridApi<Row> | null;
  stores: SchemaGridStores<Row>;
  controller: EditController<Row>;
  undo: SchemaGridUndo;
  /** Client mode: AG Grid CSV of the displayed rows. Server mode: full current query through io, downloaded. */
  exportCsv(fileName?: string): void;
  /** Pages the full current query through `dataSource.fetch` and hands it to io's writer. */
  exportCurrentView(format: ExportFormat, fileName?: string): Promise<Blob | string | ArrayBuffer | Uint8Array>;
  captureView(): ViewDef | null;
  refetch(): Promise<void>;
  access: Map<string, Access>;
  loadState: SchemaGridLoadState;
  lastError: unknown;
  filterErrors: SchemaGridFilterErrors;
  rowModelKey: RowModelKey;
  /** Announcer seam (T21/T30); undefined until one is provided. */
  announce?(message: string, politeness?: "polite" | "assertive"): void;
  /** The `poll` prop as given. */
  poll: SchemaGridPollOptions | undefined;
  /** Cell/root key handler registry (see `grid/keyboard.ts`); `<SchemaGrid>` wires `handleRootKeyDown` on `.sg-root`. */
  keyboard: KeyboardRegistry<Row>;
  /** Clipboard (T24); `<SchemaGrid>` wires `onCopy`/`onPaste` on `.sg-root`. */
  clipboard: ClipboardHandlers;
}

const DEFAULT_PAGE_SIZE = 100;

const EVENT_KEYS_WE_CHAIN = [
  "onGridReady",
  "onGridPreDestroyed",
  "onSortChanged",
  "onFilterChanged",
  "onColumnMoved",
  "onColumnResized",
  "onColumnVisible",
  "onColumnPinned",
  "onCellEditingStopped",
  "onCellMouseDown",
  "onCellMouseOver",
  "onCellFocused",
  "onModelUpdated",
  "onDisplayedColumnsChanged",
] as const;

const LOCKED_KEYS = [
  "readOnlyEdit",
  "onCellEditRequest",
  "rowModelType",
  "modules",
  "context",
  "getRowId",
  "rowData",
  "datasource",
  "postSortRows",
  "maintainColumnOrder",
] as const;

const NO_FILTER_ERRORS: SchemaGridFilterErrors = { user: [], external: [] };

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function rowIdOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function hookContextOf<Row extends GridRow>(ctx: unknown): SchemaGridHookContext<Row> | undefined {
  if (!ctx || typeof ctx !== "object" || !("stores" in ctx)) return undefined;
  return ctx as SchemaGridHookContext<Row>;
}

function cellStatusOf<Row extends GridRow>(p: CellClassParams<Row>) {
  const ctx = hookContextOf<Row>(p.context);
  const rowId = rowIdOf(p.data);
  const colId = p.colDef.colId;
  if (!ctx || rowId === undefined || colId === undefined) return undefined;
  return ctx.stores.cellStatus.get(rowId, colId);
}

/** Pure status rules: read `params.context.stores.cellStatus`. */
export function createStatusCellClassRules<Row extends GridRow = GridRow>(): CellClassRules<Row> {
  return {
    [SG_CLASSES.pending]: (p: CellClassParams<Row>) => cellStatusOf(p)?.pending === true,
    [SG_CLASSES.error]: (p: CellClassParams<Row>) => cellStatusOf(p)?.error !== undefined,
    [SG_CLASSES.remoteChanged]: (p: CellClassParams<Row>) => cellStatusOf(p)?.remoteChanged === true,
  };
}

/** Pure row rules: `notInView` from `params.context.stores.rows`. */
export function createStatusRowClassRules<Row extends GridRow = GridRow>(): RowClassRules<Row> {
  return {
    [SG_CLASSES.notInView]: (p: RowClassParams<Row>) => {
      const ctx = hookContextOf<Row>(p.context);
      const rowId = rowIdOf(p.data);
      return !!ctx && rowId !== undefined && ctx.stores.rows.isNotInView(rowId);
    },
  };
}

/** Sort as recorded in AG Grid column state, ordered by sortIndex. */
function sortFromColumnState(state: ColumnState[]): SortSpec[] {
  return state
    .filter((s) => s.sort === "asc" || s.sort === "desc")
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map((s) => ({ columnId: s.colId, dir: s.sort as SortSpec["dir"] }));
}

function sameModel(a: ColumnFilterModel, b: ColumnFilterModel): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => k in b && json(a[k]) === json(b[k]));
}

/** Drops conditions on columns outside `readable`; empty groups collapse to null. */
export function pruneFilterToReadable(node: FilterNode | null, readable: ReadonlySet<string>): FilterNode | null {
  if (!node) return null;
  if (isFilterGroup(node)) {
    const children = node.children
      .map((c) => pruneFilterToReadable(c, readable))
      .filter((c): c is FilterNode => c !== null);
    return children.length === 0 ? null : { op: node.op, children };
  }
  return readable.has(node.columnId) ? node : null;
}

export function pruneSortToReadable(sort: readonly SortSpec[], readable: ReadonlySet<string>): SortSpec[] {
  return sort.filter((s) => readable.has(s.columnId));
}

/** Drops group levels and aggregations on unreadable columns. */
export function pruneGroupByToReadable(groupBy: readonly GroupSpec[], readable: ReadonlySet<string>): GroupSpec[] {
  return groupBy
    .filter((g) => readable.has(g.columnId))
    .map((g) => (g.aggregations ? { ...g, aggregations: g.aggregations.filter((a) => readable.has(a.columnId)) } : g));
}

function readableIds(access: Map<string, Access>): Set<string> {
  return new Set([...access].filter(([, a]) => a !== "hidden").map(([id]) => id));
}

function download(content: Blob | string | ArrayBuffer | Uint8Array, fileName: string, type: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
  const blob = content instanceof Blob ? content : new Blob([content as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function initialQuery(view: ViewDef | null | undefined, readable: ReadonlySet<string>): Partial<QueryState> | undefined {
  if (!view) return undefined;
  return {
    filter: pruneFilterToReadable(view.filter, readable),
    sort: pruneSortToReadable(view.sort, readable),
    groupBy: pruneGroupByToReadable(view.groupBy, readable),
    ...(view.search !== undefined ? { search: view.search } : {}),
  };
}

/**
 * Incoming (fetched) rows with pending local writes keep their local cell
 * values; everything else is the server's. Version rollback is handled by
 * `rowStore.upsert` itself.
 */
function preservePending<Row extends GridRow>(
  rows: readonly Row[],
  schema: GridSchema,
  rowStore: RowStore<Row>,
  cellStatus: CellStatusStore,
): Row[] {
  return rows.map((incoming) => {
    const local = rowStore.getRow(incoming.id);
    if (!local) return incoming;
    let cells: Record<string, unknown> | undefined;
    for (const column of schema.columns) {
      if (!cellStatus.get(incoming.id, column.id).pending) continue;
      cells ??= { ...incoming.cells };
      cells[column.key] = local.cells[column.key];
    }
    return cells ? { ...incoming, cells } : incoming;
  });
}

export function useSchemaGrid<Row extends GridRow = GridRow>(
  props: SchemaGridProps<Row>,
  seams: UseSchemaGridSeams<Row> = {},
): UseSchemaGridResult<Row> {
  const latest = useRef(props);
  latest.current = props;
  const latestSeams = useRef(seams);
  latestSeams.current = seams;

  const { schema, dataSource, user } = props;
  const mode: SchemaGridMode = props.mode ?? "client";
  const pageSize = props.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageMode: PageMode = props.pageMode ?? "offset";
  const tz = props.tz ?? DEFAULT_TZ;

  // ---- Derived configuration -----------------------------------------------------
  const resolver = useMemo(() => props.resolver ?? createRolePermissionResolver(), [props.resolver]);
  const registry = useMemo(() => props.registry ?? createDefaultRegistry(), [props.registry]);
  const uiRegistry = useMemo(() => props.uiRegistry ?? createDefaultUiRegistry<Row>(), [props.uiRegistry]);
  const theme = useMemo(() => props.theme ?? createSchemaGridTheme(), [props.theme]);
  const userKey = json([user.id, user.roles]);
  const externalKey = json(props.externalFilter);

  // biome-ignore lint/correctness/useExhaustiveDependencies: user compared by value (userKey).
  const stableUser = useMemo(() => user, [userKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: externalFilter compared by value (externalKey).
  const externalFilter = useMemo(() => props.externalFilter ?? null, [externalKey]);
  const access = useMemo(() => resolveColumnAccess(schema, resolver, stableUser), [schema, resolver, stableUser]);
  const readable = useMemo(() => readableIds(access), [access]);
  const allColumnIds = useMemo(() => new Set(schema.columns.map((c) => c.id)), [schema]);
  const externalErrors = useMemo(
    () => (externalFilter ? validateFilter(externalFilter, schema, registry, allColumnIds) : []),
    [externalFilter, schema, registry, allColumnIds],
  );
  const formulas = useMemo(() => compileFormulaColumns<Row>(schema, { now: new Date(), tz }), [schema, tz]);
  const getCellValue = useCallback(
    (row: GridRow, column: ColumnDef): unknown => {
      if (column.type !== "formula") return row.cells[column.key];
      const value = formulas.getters.get(column.id)?.(row as Row);
      return isFormulaError(value) ? null : value;
    },
    [formulas],
  );
  const canEditCell = useMemo(
    () => createCellAccess<Row>(schema, access, resolver, stableUser),
    [schema, access, resolver, stableUser],
  );

  /** Everything the imperative (non-React) paths read; refreshed every render. */
  const cfg = useRef({ schema, registry, readable, externalFilter, externalErrors, getCellValue, tz, stableUser });
  cfg.current = { schema, registry, readable, externalFilter, externalErrors, getCellValue, tz, stableUser };

  // ---- Stable per-instance state -------------------------------------------------
  const [stores] = useState<SchemaGridStores<Row>>(() => ({
    rows: createRowStore<Row>(),
    cellStatus: createCellStatusStore(),
    range: createRangeStore(),
    query: createQueryStore(initialQuery(props.view, readable)),
    expansion: createExpansionStore(),
  }));
  const [undoStack] = useState(() => createUndoStack());
  const apiRef = useRef<GridApi<Row> | null>(null);
  // Keyboard registry (grid/keyboard.ts) + range selection (T23).
  const [keyboard] = useState(() => createKeyboardRegistry<Row>({ getApi: () => apiRef.current }));
  const rangeSelection = useRangeSelection<Row>(apiRef, stores.range, {
    keyboard,
    announce: (message, politeness) => latestSeams.current.announce?.(message, politeness),
  });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      apiRef.current = null;
    };
  }, []);

  const [loadState, setLoadStateRaw] = useState<SchemaGridLoadState>(() =>
    externalErrors.length > 0 ? "error" : mode === "client" ? "loading" : "idle",
  );
  const [lastError, setLastErrorRaw] = useState<unknown>(undefined);
  const setLoadState = useCallback((s: SchemaGridLoadState) => {
    if (mountedRef.current) setLoadStateRaw(s);
  }, []);
  const setLastError = useCallback((e: unknown) => {
    if (mountedRef.current) setLastErrorRaw(e);
  }, []);
  const [filterErrors, setFilterErrorsRaw] = useState<SchemaGridFilterErrors>(() =>
    externalErrors.length > 0 ? { user: [], external: externalErrors } : NO_FILTER_ERRORS,
  );
  const setFilterErrors = useCallback((next: SchemaGridFilterErrors) => {
    if (!mountedRef.current) return;
    setFilterErrorsRaw((prev) => (json(prev) === json(next) ? prev : next));
  }, []);
  const computeFilterErrors = useCallback((): SchemaGridFilterErrors => {
    const c = cfg.current;
    const user = validateFilter(stores.query.getState().filter, c.schema, c.registry, c.readable);
    return { user, external: c.externalErrors };
  }, [stores]);

  // ---- Context (stable object; fields refreshed in a layout effect) ---------------
  const advancedCache = useRef<{ filter: FilterNode | null | undefined; ids: ReadonlySet<string> }>({
    filter: undefined,
    ids: new Set(),
  });
  const advancedColumnIds = useCallback((): ReadonlySet<string> => {
    const filter = stores.query.getState().filter;
    if (advancedCache.current.filter !== filter) {
      advancedCache.current = { filter, ids: new Set(astToFilterModel(filter).advancedColumnIds) };
    }
    return advancedCache.current.ids;
  }, [stores]);
  const getEvents = useCallback((): SchemaGridEvents<Row> | undefined => latest.current.events, []);
  // T27: group toggle / load-more for the full-width renderers (`context.grouping`).
  const serverGroupsRef = useRef<ServerGroupsHandle<Row> | null>(null);
  const [grouping] = useState(() => ({
    toggle: (id: string) => (serverGroupsRef.current?.active ? serverGroupsRef.current.toggle(id) : stores.expansion.toggle(id)),
    loadMore: (id: string) => serverGroupsRef.current?.loadMore(id),
  }));
  const contextFields = {
    grouping,
    dataSource,
    events: getEvents,
    stores,
    schema,
    registry,
    access,
    advancedColumnIds,
    canEditCell,
    user: stableUser,
    mode,
  };
  const [context] = useState<SchemaGridHookContext<Row>>(() => ({ ...contextFields }));
  useLayoutEffect(() => {
    Object.assign(context, contextFields);
  });

  // ---- Cell refreshes --------------------------------------------------------------
  const pendingRefresh = useRef<CellRef[]>([]);
  /** One `refreshCells` call for the given cells (rows × columns they touch). */
  const refreshCells = useCallback((cells: readonly CellRef[]) => {
    const api = apiRef.current;
    if (!api || cells.length === 0) return;
    const nodes: IRowNode<Row>[] = [];
    const seenRows = new Set<string>();
    const columns: string[] = [];
    for (const c of cells) {
      if (!columns.includes(c.columnId)) columns.push(c.columnId);
      if (seenRows.has(c.rowId)) continue;
      seenRows.add(c.rowId);
      const node = api.getRowNode(c.rowId);
      if (node) nodes.push(node);
    }
    if (nodes.length > 0) api.refreshCells({ rowNodes: nodes, columns, force: true });
  }, []);
  const flushPendingRefresh = useCallback(() => {
    const cells = pendingRefresh.current;
    pendingRefresh.current = [];
    refreshCells(cells);
  }, [refreshCells]);

  // ---- Client-mode derivation ----------------------------------------------------
  const [rowData, setRowData] = useState<DisplayRow<Row>[]>([]);
  const orderIndexRef = useRef<ReadonlyMap<string, number>>(new Map());
  /** Data-row order of the previous derivation (for keeping notInView rows in place). */
  const prevDataOrder = useRef<ReadonlyMap<string, number>>(new Map());
  const groupShells = useRef<Map<string, GroupDisplayRow>>(new Map());
  const deriveRef = useRef<() => void>(() => {});
  deriveRef.current = () => {
    const c = cfg.current;
    const state = stores.query.getState();
    const errors: SchemaGridFilterErrors = { user: [], external: c.externalErrors };

    // 1. Trusted external restriction, against all columns. Invalid → fail closed.
    let base: Row[] = [];
    if (c.externalErrors.length === 0) {
      const all = stores.rows.all();
      const external = c.externalFilter;
      const matchCtx = { schema: c.schema, registry: c.registry, user: { id: c.stableUser.id }, tz: c.tz, getCellValue: c.getCellValue };
      base = external ? all.filter((r) => matchesFilter(r, external, matchCtx)) : all;
    }

    // 2. The user's filter/search/sort, readable columns only.
    const derived = deriveClientRows(
      base,
      { filter: state.filter, sort: state.sort, search: state.search },
      {
        schema: c.schema,
        registry: c.registry,
        readableColumnIds: c.readable,
        user: { id: c.stableUser.id },
        tz: c.tz,
        getCellValue: c.getCellValue,
      },
    );
    errors.user = derived.errors;

    // 3. Rows flagged notInView (remote patches) stay where they were.
    let rows = derived.rows;
    const present = new Set(rows.map((r) => r.id));
    const lingering = base
      .filter((r) => !present.has(r.id) && stores.rows.isNotInView(r.id))
      .map((r) => ({ r, at: prevDataOrder.current.get(r.id) }))
      .filter((x): x is { r: Row; at: number } => x.at !== undefined)
      .sort((a, b) => a.at - b.at);
    if (lingering.length > 0) {
      rows = [...rows];
      for (const { r, at } of lingering) rows.splice(Math.min(at, rows.length), 0, r);
    }
    prevDataOrder.current = new Map(rows.map((r, i) => [r.id, i]));

    // 4. Grouping on readable columns only; reuse unchanged group shells.
    const groupBy = pruneGroupByToReadable(state.groupBy, c.readable);
    let display: DisplayRow<Row>[] = rows;
    if (groupBy.length > 0) {
      const nextShells = new Map<string, GroupDisplayRow>();
      display = buildClientGroups(rows, groupBy, stores.expansion, {
        schema: c.schema,
        registry: c.registry,
        getCellValue: c.getCellValue,
      }).map((r) => {
        if (!isGroupRow(r)) return r;
        const prev = groupShells.current.get(r.id);
        const shell = prev && json(prev) === json(r) ? prev : r;
        nextShells.set(r.id, shell);
        return shell;
      });
      groupShells.current = nextShells;
    } else {
      groupShells.current = new Map();
    }

    const index = new Map<string, number>();
    display.forEach((r, i) => {
      const id = rowIdOf(r);
      if (id !== undefined) index.set(id, i);
    });
    orderIndexRef.current = index;
    setRowData(display);
    setFilterErrors(errors);
  };

  // ---- Server-mode: push row-store patches into loaded nodes ----------------------
  const syncServerNodesRef = useRef<() => void>(() => {});
  syncServerNodesRef.current = () => {
    const api = apiRef.current;
    if (!api) return;
    api.forEachNode((node: IRowNode<Row>) => {
      const id = rowIdOf(node.data);
      if (id === undefined) return;
      const next = stores.rows.getRow(id);
      if (next && next !== node.data) node.setData(next);
    });
    flushPendingRefresh();
  };

  const scheduled = useRef(false);
  const scheduleRowSync = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    queueMicrotask(() => {
      scheduled.current = false;
      if (!mountedRef.current) return;
      if ((latest.current.mode ?? "client") === "client") deriveRef.current();
      else syncServerNodesRef.current();
    });
  }, []);

  // ---- Remote changes (T28) --------------------------------------------------------------
  const remote = useRemoteSync<Row>({
    api: () => apiRef.current,
    mode,
    stores,
    dataSource,
    ...(props.poll ? { poll: props.poll } : {}),
    schema,
    events: getEvents,
    matchesView: (row) => rowMatchesView(row, cfg.current, stores.query.getState()),
  });
  const { flushAfterGridUpdate, onCellEditingStopped } = remote;

  useEffect(() => {
    if (mode !== "client") return;
    flushPendingRefresh();
    flushAfterGridUpdate();
  }, [rowData, mode, flushPendingRefresh, flushAfterGridUpdate]);

  // Re-derive when anything the derivation reads changes.
  useEffect(() => {
    if (mode === "client") scheduleRowSync();
  }, [mode, schema, registry, readable, tz, getCellValue, externalFilter, externalErrors, scheduleRowSync]);

  useEffect(() => {
    const offRows = stores.rows.subscribe(scheduleRowSync);
    const offExpansion = stores.expansion.subscribe(() => {
      if ((latest.current.mode ?? "client") === "client") scheduleRowSync();
    });
    return () => {
      offRows();
      offExpansion();
    };
  }, [stores, scheduleRowSync]);

  // ---- Incoming rows (both modes) -----------------------------------------------------
  const upsertIncoming = useCallback(
    (rows: readonly Row[]) => {
      stores.rows.upsert(preservePending(rows, cfg.current.schema, stores.rows, stores.cellStatus));
    },
    [stores],
  );

  // ---- Grid → query store ---------------------------------------------------------------
  /** Nesting counter: > 0 while the query store is being updated FROM the grid's own state. */
  const syncingFromGrid = useRef(0);
  const lastPushedModel = useRef<ColumnFilterModel | undefined>(undefined);
  const syncSortFromGrid = useCallback(
    (api: GridApi<Row>) => {
      const sort = sortFromColumnState(api.getColumnState());
      if (json(sort) !== json(stores.query.getState().sort)) stores.query.setSort(sort);
    },
    [stores],
  );
  const syncFilterFromGrid = useCallback(
    (api: GridApi<Row>) => {
      const model = (api.getFilterModel() ?? {}) as ColumnFilterModel;
      const pushed = lastPushedModel.current;
      if (pushed && sameModel(model, pushed)) return;
      lastPushedModel.current = undefined;
      const current = stores.query.getState().filter;
      const split = astToFilterModel(current);
      if (sameModel(model, split.model)) return;
      const next = filterModelToAst(model, split.residual);
      if (json(next) !== json(current)) stores.query.setFilter(next);
    },
    [stores],
  );

  // ---- Server datasource -------------------------------------------------------------
  const getServerQuery = useCallback((): Omit<GridQuery, "page"> => {
    const c = cfg.current;
    const state = stores.query.getState();
    const userErrors = validateFilter(state.filter, c.schema, c.registry, c.readable);
    const userFilter = userErrors.length === 0 ? state.filter : null;
    // NOTE: externalFilter is AND-ed in, but the server must enforce the real restriction.
    const query: Omit<GridQuery, "page"> = {
      filter: combineFilters(c.externalFilter, userFilter),
      sort: pruneSortToReadable(state.sort, c.readable),
    };
    if (state.search !== undefined && state.search !== "") query.search = state.search;
    const groupBy = pruneGroupByToReadable(state.groupBy, c.readable);
    if (groupBy.length > 0) query.groupBy = groupBy;
    return query;
  }, [stores]);

  /** Key of the query the current datasource last fetched with (undefined: nothing fetched yet). */
  const lastServerQueryKey = useRef<string | undefined>(undefined);
  const serverGeneration = useRef(0);
  const currentInner = useRef<{ reset(): void } | null>(null);
  const makeServerDatasource = useCallback((): IDatasource => {
    const generation = ++serverGeneration.current;
    const isCurrent = () => generation === serverGeneration.current && mountedRef.current;
    const inner = createInfiniteDatasource<Row>({
      dataSource: { fetch: (q) => latest.current.dataSource.fetch(q) },
      getQuery: getServerQuery,
      pageMode: latest.current.pageMode ?? "offset",
      blockSize: latest.current.pageSize ?? DEFAULT_PAGE_SIZE,
      onRows: (rows) => {
        if (isCurrent()) upsertIncoming(rows);
      },
      onError: (error) => {
        if (!isCurrent()) return;
        setLastError(error);
        setLoadState("error");
      },
    });
    currentInner.current = inner;
    return {
      getRows(params: IGetRowsParams) {
        if (!isCurrent()) {
          params.failCallback();
          return;
        }
        // Pull the grid's own sort/filter into the store first (never fetch with a stale query).
        syncingFromGrid.current += 1;
        try {
          syncSortFromGrid(params.api);
          syncFilterFromGrid(params.api);
        } finally {
          syncingFromGrid.current -= 1;
        }
        if (cfg.current.externalErrors.length > 0) {
          params.successCallback([], 0);
          return;
        }
        lastServerQueryKey.current = json(getServerQuery());
        setLoadState("loading");
        inner.getRows({
          ...params,
          successCallback: (rows: Row[], lastRow?: number) => {
            if (isCurrent()) setLoadState("idle");
            params.successCallback(rows, lastRow);
          },
        });
      },
    };
  }, [getServerQuery, upsertIncoming, setLastError, setLoadState, syncSortFromGrid, syncFilterFromGrid]);

  const [serverDatasource, setServerDatasource] = useState<IDatasource | undefined>(() =>
    mode === "server" ? makeServerDatasource() : undefined,
  );
  const replaceServerDatasource = useCallback(() => {
    if ((latest.current.mode ?? "client") !== "server") return;
    lastServerQueryKey.current = undefined;
    setServerDatasource(makeServerDatasource());
  }, [makeServerDatasource]);
  // A new datasource starts at the top.
  const firstDatasource = useRef(true);
  useEffect(() => {
    if (!serverDatasource) return;
    if (firstDatasource.current) {
      firstDatasource.current = false;
      return;
    }
    apiRef.current?.ensureIndexVisible(0);
  }, [serverDatasource]);
  // Block size / page mode changes need a fresh datasource.
  const pagingKey = `${pageMode}:${pageSize}`;
  const firstPaging = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on pagingKey on purpose.
  useEffect(() => {
    if (firstPaging.current) {
      firstPaging.current = false;
      return;
    }
    replaceServerDatasource();
  }, [pagingKey]);

  /** Server mode: a changed effective query gets a fresh datasource. */
  const syncServerQuery = useCallback(() => {
    if ((latest.current.mode ?? "client") !== "server") return;
    if (lastServerQueryKey.current === undefined) return; // nothing fetched yet; the first getRows reads the latest query
    if (json(getServerQuery()) === lastServerQueryKey.current) return;
    replaceServerDatasource();
  }, [getServerQuery, replaceServerDatasource]);

  // T27 (Deviation 4): server mode + groupBy → lazy groups on the client-side row model.
  const serverGroups = useServerGroups<Row>({
    enabled: mode === "server",
    queryStore: stores.query,
    rowStore: stores.rows,
    getQuery: getServerQuery,
    getDataSource: () => latest.current.dataSource,
    dataSource,
    pageSize,
    schema,
    registry,
    canFetch: () => cfg.current.externalErrors.length === 0,
    onRows: upsertIncoming,
    onError: (error) => {
      setLastError(error);
      setLoadState("error");
    },
    onLoadingChange: (loading) => setLoadState(loading ? "loading" : "idle"),
  });
  serverGroupsRef.current = serverGroups;
  const serverGroupsPostSort = useMemo(() => makePostSortRows<Row>(serverGroups.getOrderIndex), [serverGroups.getOrderIndex]);

  // ---- Client loading ----------------------------------------------------------------
  const loadGeneration = useRef(0);
  const loadAll = useCallback(async (): Promise<void> => {
    const generation = ++loadGeneration.current;
    const c = cfg.current;
    if (c.externalErrors.length > 0) {
      setLoadState("error");
      return;
    }
    const ds = latest.current.dataSource;
    const external = c.externalFilter;
    const presentAtStart = new Set(stores.rows.all().map((r) => r.id));
    const seen = new Set<string>();
    setLoadState("loading");
    try {
      let offset = 0;
      for (;;) {
        const result = await ds.fetch({ filter: external, sort: [], page: { offset, limit: pageSize }, includeTotal: true });
        if (generation !== loadGeneration.current || !mountedRef.current) return;
        upsertIncoming(result.rows);
        for (const r of result.rows) seen.add(r.id);
        offset += result.rows.length;
        const done =
          result.rows.length === 0 ||
          result.rows.length < pageSize ||
          (typeof result.total === "number" && offset >= result.total);
        if (done) break;
      }
    } catch (error) {
      if (generation === loadGeneration.current) {
        setLastError(error);
        setLoadState("error");
      }
      throw error;
    }
    // Only rows that existed when this load started can have "disappeared";
    // rows added meanwhile (local creates, sync) are kept.
    stores.rows.remove([...presentAtStart].filter((id) => !seen.has(id)));
    stores.rows.clearNotInView();
    setLastError(undefined);
    setLoadState("idle");
  }, [pageSize, stores, upsertIncoming, setLoadState, setLastError]);

  const refetch = useCallback(async (): Promise<void> => {
    if ((latest.current.mode ?? "client") === "client") {
      await loadAll();
      return;
    }
    stores.rows.clearNotInView();
    if (serverGroupsRef.current?.active) {
      await serverGroupsRef.current.refetch();
      return;
    }
    currentInner.current?.reset();
    apiRef.current?.purgeInfiniteCache();
  }, [loadAll, stores]);

  // Client: (re)load on mount, data source change and external filter change.
  useEffect(() => {
    if (mode !== "client") return;
    loadAll().catch(() => {
      // Surfaced through loadState/lastError.
    });
  }, [mode, dataSource, externalFilter, externalErrors, loadAll]);
  // Server: external filter change → fresh datasource (if anything was fetched).
  const firstExternal = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the external filter value.
  useEffect(() => {
    if (firstExternal.current) {
      firstExternal.current = false;
      return;
    }
    if (mode !== "server") return;
    setFilterErrors(computeFilterErrors());
    if (externalErrors.length > 0) setLoadState("error");
    replaceServerDatasource();
  }, [externalFilter, externalErrors]);

  // ---- Edit controller + undo ----------------------------------------------------------
  const controller = useMemo(
    () =>
      // T30: veto / conflict / rejected-edit outcomes are announced (assertive) through the announce seam.
      withEditAnnouncements<Row>(createEditController<Row>({
        dataSource: { applyChanges: (batch) => latest.current.dataSource.applyChanges(batch) },
        schema,
        rowStore: stores.rows,
        cellStatus: stores.cellStatus,
        events: getEvents,
        formulas,
        onApplied: (info: AppliedInfo<Row>) => {
          undoStack.record(info.batch, info.result.applied);
          if (info.formulaDependents.length > 0) {
            pendingRefresh.current.push(...info.formulaDependents);
            scheduleRowSync();
          }
          latestSeams.current.onApplied?.(info);
        },
        // No fetch-by-id on DataSource: refetch everything under the version/pending guards.
        onRowStale: () => {
          void refetch().catch(() => {});
        },
      }), {
        getSchema: () => schema,
        announce: (message, politeness) => latestSeams.current.announce?.(message, politeness),
      }),
    [schema, stores, getEvents, formulas, undoStack, scheduleRowSync, refetch],
  );
  const onCellEditRequest = useMemo(
    () =>
      createEditRequestHandler<Row>(controller, {
        schema,
        registry,
        cellStatus: stores.cellStatus,
        rowStore: stores.rows,
      }),
    [controller, schema, registry, stores],
  );
  // T25: fill handle.
  const fill = useFillHandle<Row>({
    apiRef,
    rangeStore: stores.range,
    controller,
    schema,
    registry,
    canEditCell,
    getCellValue,
    keyboard,
    announce: (message, politeness) => latestSeams.current.announce?.(message, politeness),
  });
  context.onFillHandlePointerDown = fill.onFillHandlePointerDown;
  const onCellMouseDownWithFill = useCallback(
    (e: CellMouseDownEvent<Row>) => {
      if (!fill.isFilling()) rangeSelection.onCellMouseDown(e);
    },
    [fill, rangeSelection],
  );
  const onCellMouseOverWithFill = useCallback(
    (e: CellMouseOverEvent<Row>) => {
      rangeSelection.onCellMouseOver(e);
      fill.onCellMouseOver(e);
    },
    [fill, rangeSelection],
  );
  const undo = useMemo<SchemaGridUndo>(
    () => ({
      undo: async () => {
        const step = undoStack.undo();
        if (step) await controller.submit(step.changes, step.source);
      },
      redo: async () => {
        const step = undoStack.redo();
        if (step) await controller.submit(step.changes, step.source);
      },
      canUndo: () => undoStack.canUndo(),
      canRedo: () => undoStack.canRedo(),
    }),
    [undoStack, controller],
  );

  // ---- Undo/redo keybindings (T26): Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl+Y on the root keyboard registry.
  useUndoKeybindings<Row>({
    apiRef,
    keyboard,
    undo,
    announce: (message, politeness) => latestSeams.current.announce?.(message, politeness),
  });

  // ---- Clipboard (T24): Ctrl/Cmd+C/V on the root keyboard registry + root copy/paste listeners.
  const clipboard = useClipboard<Row>({
    apiRef,
    rangeStore: stores.range,
    controller,
    keyboard,
    cellStatus: stores.cellStatus,
    schema,
    registry,
    access,
    canEditCell,
    getCellValue,
    dataSource,
    events: getEvents,
    onClipboardReport: (report) => latest.current.onClipboardReport?.(report),
    announce: (message, politeness) => latestSeams.current.announce?.(message, politeness),
  });

  // ---- Cell status → one targeted refresh per notification ---------------------------
  useEffect(
    () => stores.cellStatus.subscribeChanges((keys) => refreshCells(keys.map(parseCellKey))),
    [stores, refreshCells],
  );

  // ---- Views ---------------------------------------------------------------------------
  const baseView = useCallback((): ViewDef => {
    const view = latest.current.view;
    if (view) return view;
    return {
      id: "default",
      name: "Default",
      filter: null,
      sort: [],
      columnState: [],
      groupBy: [],
      pageSize: latest.current.pageSize ?? DEFAULT_PAGE_SIZE,
    };
  }, []);
  const captureView = useCallback((): ViewDef | null => {
    const api = apiRef.current;
    if (!api) return null;
    return captureViewState(api, stores, baseView());
  }, [stores, baseView]);
  const lastViewJson = useRef<string | undefined>(undefined);
  const applyingView = useRef(false);
  const emitView = useCallback(() => {
    if (applyingView.current) return;
    const view = captureView();
    if (!view) return;
    const key = json(view);
    if (key === lastViewJson.current) return;
    lastViewJson.current = key;
    latest.current.onViewChange?.(view);
    latest.current.events?.onViewChange?.(view);
  }, [captureView]);
  const seedView = useCallback(() => {
    const view = captureView();
    lastViewJson.current = view ? json(view) : undefined;
  }, [captureView]);

  // ---- Query store → grid (sort indicators, filter model) --------------------------
  /** Returns true when it changed the grid's sort or filter model. */
  const pushQueryToGrid = useCallback((): boolean => {
    const api = apiRef.current;
    if (!api) return false;
    let changed = false;
    const state = stores.query.getState();
    if (json(sortFromColumnState(api.getColumnState())) !== json(state.sort)) {
      api.applyColumnState({
        state: state.sort.map((s, i) => ({ colId: s.columnId, sort: s.dir, sortIndex: i })),
        defaultState: { sort: null },
      });
      changed = true;
    }
    const target = astToFilterModel(state.filter).model;
    const current = (api.getFilterModel() ?? {}) as ColumnFilterModel;
    if (!sameModel(current, target)) {
      lastPushedModel.current = target;
      api.setFilterModel(target);
      changed = true;
    }
    return changed;
  }, [stores]);

  useEffect(
    () =>
      stores.query.subscribe(() => {
        const fromGrid = syncingFromGrid.current > 0;
        const gridChanged = fromGrid ? false : pushQueryToGrid();
        if ((latest.current.mode ?? "client") === "client") {
          scheduleRowSync();
        } else {
          setFilterErrors(computeFilterErrors());
          // A grid sort/filter change makes the infinite model re-request blocks
          // itself (and getRows syncs + records the query), so only other
          // changes (search, groupBy, residual filters) need a fresh datasource.
          if (!fromGrid && !gridChanged) syncServerQuery();
        }
        emitView();
      }),
    [stores, pushQueryToGrid, scheduleRowSync, syncServerQuery, emitView, setFilterErrors, computeFilterErrors],
  );

  const applyView = useCallback(
    (api: GridApi<Row>, view: ViewDef) => {
      applyingView.current = true;
      try {
        applyViewState(api, view, stores, { access: context.access });
      } finally {
        applyingView.current = false;
      }
      pushQueryToGrid();
      seedView();
    },
    [stores, context, pushQueryToGrid, seedView],
  );
  const appliedViewId = useRef<string | undefined>(undefined);
  const viewId = props.view?.id;
  useEffect(() => {
    const api = apiRef.current;
    const view = latest.current.view;
    if (!api || !view || appliedViewId.current === view.id) return;
    appliedViewId.current = view.id;
    applyView(api, view);
  }, [viewId, applyView]);

  // ---- Grid event handlers -------------------------------------------------------------
  const carriedColumnState = useRef<ColumnState[] | null>(null);
  const onGridReady = useCallback(
    (event: GridReadyEvent<Row>) => {
      apiRef.current = event.api;
      const view = latest.current.view;
      // A row-model switch (T27) remounts the grid: keep the live query and column state, don't re-apply the view.
      const carried = carriedColumnState.current;
      carriedColumnState.current = null;
      if (view && carried && appliedViewId.current === view.id) {
        event.api.applyColumnState({ state: carried, applyOrder: true });
        pushQueryToGrid();
        seedView();
      } else if (view) {
        appliedViewId.current = view.id;
        applyView(event.api, view);
      } else {
        pushQueryToGrid();
        seedView();
      }
    },
    [applyView, pushQueryToGrid, seedView],
  );
  const onGridPreDestroyed = useCallback(() => {
    rangeSelection.reset();
    const api = apiRef.current;
    carriedColumnState.current = api && !api.isDestroyed() ? api.getColumnState() : null;
    apiRef.current = null;
  }, [rangeSelection]);

  const onSortChanged = useCallback(
    (event: SortChangedEvent<Row>) => {
      rangeSelection.reset();
      syncingFromGrid.current += 1;
      try {
        syncSortFromGrid(event.api);
      } finally {
        syncingFromGrid.current -= 1;
      }
    },
    [syncSortFromGrid, rangeSelection],
  );
  const onFilterChanged = useCallback(
    (event: FilterChangedEvent<Row>) => {
      rangeSelection.reset();
      syncingFromGrid.current += 1;
      try {
        syncFilterFromGrid(event.api);
      } finally {
        syncingFromGrid.current -= 1;
      }
    },
    [syncFilterFromGrid, rangeSelection],
  );

  const onColumnMoved = useCallback((e: ColumnMovedEvent<Row>) => e.finished && emitView(), [emitView]);
  const onColumnResized = useCallback((e: ColumnResizedEvent<Row>) => e.finished && emitView(), [emitView]);
  const onColumnVisible = useCallback((_e: ColumnVisibleEvent<Row>) => emitView(), [emitView]);
  const onColumnPinned = useCallback((_e: ColumnPinnedEvent<Row>) => emitView(), [emitView]);

  // ---- Column defs ----------------------------------------------------------------------
  const cellClassRules = useMemo<CellClassRules<Row>>(
    () => ({ ...createStatusCellClassRules<Row>(), ...(seams.cellClassRules ?? {}) }),
    [seams.cellClassRules],
  );
  const rowClassRules = useMemo<RowClassRules<Row>>(
    () => ({ ...createStatusRowClassRules<Row>(), ...(seams.rowClassRules ?? {}) }),
    [seams.rowClassRules],
  );
  // The view only seeds initial* values for first paint; later view column
  // state goes through applyViewState, so the view is not a dependency.
  const columnDefs = useMemo(
    () =>
      withSuppressKeyboardEvent<Row>(
        compileColumns<Row>(schema, access, registry, uiRegistry, {
          view: latest.current.view ?? null,
          cellClassRules,
          canEditCell,
          formulas,
          ...(seams.wrapRenderer ? { wrapRenderer: seams.wrapRenderer } : {}),
        }),
        keyboard.suppressKeyboardEvent,
      ),
    [schema, access, registry, uiRegistry, cellClassRules, canEditCell, formulas, seams.wrapRenderer, keyboard],
  );

  const postSortRows = useMemo(() => makePostSortRows<Row>(() => orderIndexRef.current), []);
  const getRowId = useCallback((p: { data: Row }) => p.data.id, []);
  const rowModelKey: RowModelKey = mode === "server" && !serverGroups.active ? "infinite" : "clientSide";
  const modules = useMemo(
    () => (rowModelKey === "infinite" ? [...SCHEMA_GRID_INFINITE_MODULES] : [...SCHEMA_GRID_CLIENT_MODULES]),
    [rowModelKey],
  );
  const fullWidthCellRenderer = seams.fullWidthCellRenderer;
  const isFullWidthRow = useCallback((p: IsFullWidthRowParams<Row>) => {
    const data = p.rowNode.data as DisplayRow<Row> | undefined;
    return !!data && (isGroupRow(data) || isLoadMoreRow(data));
  }, []);

  // ---- Exports --------------------------------------------------------------------------
  const exportColumns = useCallback((): ColumnDef[] => {
    const byId = new Map(schema.columns.map((c) => [c.id, c]));
    const api = apiRef.current;
    const ids = api
      ? api.getAllDisplayedColumns().map((c) => c.getColId())
      : schema.columns.filter((c) => !c.hidden).map((c) => c.id);
    return ids
      .map((id) => byId.get(id))
      .filter((c): c is ColumnDef => !!c && (access.get(c.id) === "read" || access.get(c.id) === "edit"));
  }, [schema, access]);

  const exportCurrentView = useCallback(
    (format: ExportFormat, fileName?: string) => {
      if (cfg.current.externalErrors.length > 0) return Promise.reject(new Error("Invalid externalFilter: nothing to export."));
      return exportViewThroughIo<Row>({
        format,
        dataSource: latest.current.dataSource,
        query: getServerQuery(),
        columns: exportColumns(),
        registry,
        uiRegistry,
        access,
        getCellValue,
        ...(fileName !== undefined ? { fileName } : {}),
      });
    },
    [getServerQuery, exportColumns, registry, uiRegistry, access, getCellValue],
  );

  const exportCsv = useCallback(
    (fileName?: string) => {
      const api = apiRef.current;
      if (mode === "server") {
        const name = fileName ?? "export.csv";
        exportCurrentView("csv", name)
          .then((content) => download(content, name, "text/csv"))
          .catch(() => {});
        return;
      }
      if (!api) return;
      exportGridCsv<Row>(api, {
        schema,
        access,
        registry,
        uiRegistry,
        getCellValue,
        ...(fileName !== undefined ? { fileName } : {}),
      });
    },
    [mode, exportCurrentView, schema, access, registry, uiRegistry, getCellValue],
  );

  // ---- gridProps --------------------------------------------------------------------------
  const userOptions = props.gridOptions;
  const gridProps = useMemo<AgGridReactProps<Row>>(() => {
    const ours: AgGridReactProps<Row> = {
      theme,
      columnDefs,
      rowClassRules,
      onGridReady,
      onGridPreDestroyed,
      onSortChanged,
      onFilterChanged,
      onColumnMoved,
      onColumnResized,
      onColumnVisible,
      onColumnPinned,
      onCellEditingStopped,
      onCellMouseDown: onCellMouseDownWithFill,
      onCellMouseOver: onCellMouseOverWithFill,
      onCellFocused: rangeSelection.onCellFocused,
      onModelUpdated: rangeSelection.onModelUpdated,
      onDisplayedColumnsChanged: rangeSelection.onDisplayedColumnsChanged,
      enterNavigatesVertically: true,
      enterNavigatesVerticallyAfterEdit: true,
      stopEditingWhenCellsLoseFocus: true,
      ...(fullWidthCellRenderer ? { isFullWidthRow, fullWidthCellRenderer } : {}),
      ...(rowModelKey === "infinite" ? INFINITE_DEFAULTS(pageMode, pageSize) : {}),
    };

    const merged: AgGridReactProps<Row> = { ...ours };
    const mergedRecord = merged as Record<string, unknown>;
    if (userOptions) {
      for (const [key, value] of Object.entries(userOptions)) {
        if ((LOCKED_KEYS as readonly string[]).includes(key)) continue;
        const ourHandler = (ours as Record<string, unknown>)[key];
        if (
          (EVENT_KEYS_WE_CHAIN as readonly string[]).includes(key) &&
          typeof value === "function" &&
          typeof ourHandler === "function"
        ) {
          mergedRecord[key] = (event: unknown) => {
            (ourHandler as (e: unknown) => void)(event);
            (value as (e: unknown) => void)(event);
          };
          continue;
        }
        mergedRecord[key] = value;
      }
    }
    // Locked: always ours.
    merged.readOnlyEdit = true;
    merged.onCellEditRequest = onCellEditRequest;
    merged.rowModelType = rowModelKey;
    merged.modules = modules;
    merged.context = context;
    merged.getRowId = getRowId;
    merged.maintainColumnOrder = true;
    if (rowModelKey === "infinite") {
      merged.datasource = serverDatasource;
    } else if (mode === "server") {
      merged.rowData = serverGroups.rows as Row[];
      merged.postSortRows = serverGroupsPostSort;
    } else {
      merged.rowData = rowData as Row[];
      merged.postSortRows = postSortRows;
    }
    return merged;
  }, [
    theme,
    columnDefs,
    getRowId,
    rowClassRules,
    onGridReady,
    onGridPreDestroyed,
    onSortChanged,
    onFilterChanged,
    onColumnMoved,
    onColumnResized,
    onColumnVisible,
    onColumnPinned,
    onCellEditingStopped,
    rangeSelection,
    onCellMouseDownWithFill,
    onCellMouseOverWithFill,
    fullWidthCellRenderer,
    isFullWidthRow,
    mode,
    serverDatasource,
    pageMode,
    pageSize,
    rowData,
    postSortRows,
    serverGroups.rows,
    serverGroupsPostSort,
    userOptions,
    onCellEditRequest,
    modules,
    context,
    rowModelKey,
  ]);

  const api = useCallback(() => apiRef.current, []);

  return {
    gridProps,
    api,
    stores,
    controller,
    undo,
    exportCsv,
    exportCurrentView,
    captureView,
    refetch,
    access,
    loadState,
    lastError,
    filterErrors,
    rowModelKey,
    ...(seams.announce ? { announce: seams.announce } : {}),
    poll: props.poll,
    keyboard,
    clipboard,
  };
}
