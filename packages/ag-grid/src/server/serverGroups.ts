/**
 * Server-mode grouping (plan Deviation 4). AG Grid's infinite row model can't
 * insert group rows, so while server mode has a `groupBy` the grid runs the
 * client-side row model over the flat display rows this controller builds:
 *
 * - `load()` fetches the top-level groups (`QueryResult.groups`) with the
 *   full `groupBy`, following `nextCursor` when the source pages the groups
 *   themselves (the Drizzle server does; core's in-memory source doesn't).
 * - Groups start collapsed. Expanding a non-leaf group shows its sub-groups:
 *   core's nested `children` when the server sent them, otherwise one query
 *   pinned to the group with `groupBy` sliced to the remaining levels.
 * - Expanding a leaf group fetches its rows, offset-paged (`pageSize`), with
 *   filter = AND(view filter, `groupKeyToCondition` for every ancestor). A
 *   load-more row follows a partially loaded group; `loadMore` appends a page.
 * - Expansion survives `load()` (a query change / refetch): groups that still
 *   exist are re-expanded and refetched.
 *
 * `useServerGroups` wires a controller to the query/row stores for
 * `useSchemaGrid`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { combineFilters } from "../client/combineFilters";
import type { DisplayRow, GroupDisplayRow, GroupPathEntry, LoadMoreDisplayRow } from "../grouping/clientGroups";
import { groupKeyToCondition } from "../grouping/groupCondition";
import {
  type ColumnDef,
  type DataSource,
  effectiveFieldType,
  type FieldTypeRegistry,
  type FilterNode,
  type GridQuery,
  type GridRow,
  type GridSchema,
  type GroupResult,
  type GroupSpec,
  isEmptyValue,
} from "../internal/core";
import type { QueryStore } from "../state/queryStore";
import type { RowStore } from "../state/rowStore";

export type ServerGroupsQuery = Omit<GridQuery, "page">;

export interface ServerGroupsControllerOptions<Row extends GridRow = GridRow> {
  dataSource: Pick<DataSource<Row>, "fetch">;
  /** The effective query (filter, sort, search, groupBy); read at every fetch. */
  getQuery(): ServerGroupsQuery;
  /** Rows per child page. */
  pageSize: number;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  /** Maps a fetched row to its latest local copy (e.g. the row store's). Default: identity. */
  resolveRow?(row: Row): Row;
  /** Every fetched page of child rows. */
  onRows?(rows: Row[]): void;
  onError?(error: unknown): void;
  /** True while any fetch is in flight. */
  onLoadingChange?(loading: boolean): void;
}

export interface ServerGroupsController<Row extends GridRow = GridRow> {
  /** (Re)loads the top-level groups; previously expanded groups are re-expanded. */
  load(): Promise<void>;
  toggle(groupId: string): Promise<void>;
  setExpanded(groupId: string, expanded: boolean): Promise<void>;
  isExpanded(groupId: string): boolean;
  /** Next page of a leaf group; takes the group id or its load-more row id. */
  loadMore(id: string): Promise<void>;
  getDisplayRows(): DisplayRow<Row>[];
  subscribe(listener: () => void): () => void;
  /** Stops notifying and ignores in-flight results. */
  dispose(): void;
}

const EMPTY_LABEL = "(empty)";
/** Safety cap on group pages followed through `nextCursor`. */
const MAX_GROUP_PAGES = 100;
const LOAD_MORE_PREFIX = "__sg_loadmore:";

interface GroupNode<Row> {
  id: string;
  level: number;
  columnId: string;
  value: unknown;
  label: string;
  count: number;
  aggregates: Record<string, unknown>;
  groupPath: GroupPathEntry[];
  idPath: [string, string][];
  /** Non-leaf: sub-groups once known. */
  subgroups?: GroupNode<Row>[];
  /** Leaf: rows loaded so far. */
  rows: Row[];
  total: number;
  childrenLoaded: boolean;
  inflight?: Promise<void>;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function serverGroupId(idPath: readonly [string, string][]): string {
  return `__sg_sgroup:${JSON.stringify(idPath)}`;
}

export function loadMoreRowId(groupId: string): string {
  return `${LOAD_MORE_PREFIX}${groupId}`;
}

function groupLabel(column: ColumnDef | undefined, value: unknown, registry: FieldTypeRegistry): string {
  if (isEmptyValue(value)) return EMPTY_LABEL;
  if (!column) return String(value);
  const fieldType = effectiveFieldType(registry, column);
  if (!fieldType) return String(value);
  const config = column.type === "formula" ? fieldType.defaultConfig : (column.config ?? fieldType.defaultConfig);
  try {
    return fieldType.format(value, config);
  } catch {
    return String(value);
  }
}

export function createServerGroupsController<Row extends GridRow = GridRow>(
  options: ServerGroupsControllerOptions<Row>,
): ServerGroupsController<Row> {
  const { dataSource, getQuery, pageSize, schema, registry } = options;
  const columnsById = new Map(schema.columns.map((c) => [c.id, c]));
  const listeners = new Set<() => void>();
  const expanded = new Set<string>();
  let roots: GroupNode<Row>[] = [];
  let byId = new Map<string, GroupNode<Row>>();
  let generation = 0;
  let inflightCount = 0;
  let disposed = false;
  const shellCache = new Map<string, GroupDisplayRow>();
  const loadMoreCache = new Map<string, LoadMoreDisplayRow>();

  const notify = () => {
    if (disposed) return;
    for (const l of [...listeners]) l();
  };

  const track = async <T>(work: Promise<T>): Promise<T> => {
    inflightCount += 1;
    if (inflightCount === 1) options.onLoadingChange?.(true);
    try {
      return await work;
    } finally {
      inflightCount -= 1;
      if (inflightCount === 0 && !disposed) options.onLoadingChange?.(false);
    }
  };

  const groupByOf = (query: ServerGroupsQuery): GroupSpec[] => query.groupBy ?? [];

  const makeNodes = (groups: readonly GroupResult[], parent: GroupNode<Row> | null): GroupNode<Row>[] =>
    groups.map((g) => {
      const level = parent ? parent.level + 1 : 0;
      const idPath: [string, string][] = [...(parent?.idPath ?? []), [g.columnId, g.key]];
      const groupPath: GroupPathEntry[] = [...(parent?.groupPath ?? []), { columnId: g.columnId, key: g.value }];
      const aggregates: Record<string, unknown> = {};
      for (const a of g.aggregates) aggregates[`${a.columnId}:${a.agg}`] = a.value;
      const node: GroupNode<Row> = {
        id: serverGroupId(idPath),
        level,
        columnId: g.columnId,
        value: g.value,
        label: groupLabel(columnsById.get(g.columnId), g.value, registry),
        count: g.count,
        aggregates,
        groupPath,
        idPath,
        rows: [],
        total: g.count,
        childrenLoaded: false,
      };
      if (g.children) {
        node.subgroups = makeNodes(g.children, node);
        node.childrenLoaded = true;
      }
      return node;
    });

  const index = (nodes: readonly GroupNode<Row>[]) => {
    for (const n of nodes) {
      byId.set(n.id, n);
      if (n.subgroups) index(n.subgroups);
    }
  };

  const pinnedFilter = (node: GroupNode<Row>, base: FilterNode | null): FilterNode | null => {
    const pins: FilterNode[] = [];
    for (const entry of node.groupPath) {
      const column = columnsById.get(entry.columnId);
      if (column) pins.push(groupKeyToCondition(column, entry.key, registry));
    }
    return combineFilters(base, ...pins);
  };

  /**
   * Every group of a grouping query. core's in-memory source returns all
   * groups and pages `rows`; `@ranjeetk25/schema-grid-server` pages the groups
   * themselves (`rows: []`, `nextCursor` while more exist), so a one-row page
   * would show only the first group. Follow `nextCursor` for that shape only.
   */
  const fetchGroups = async (query: ServerGroupsQuery): Promise<GroupResult[]> => {
    const groups: GroupResult[] = [];
    let page: GridQuery["page"] = { offset: 0, limit: pageSize };
    for (let i = 0; i < MAX_GROUP_PAGES; i++) {
      const result = await dataSource.fetch({ ...query, page });
      const batch = result.groups ?? [];
      groups.push(...batch);
      if (result.rows.length > 0 || batch.length === 0 || !result.nextCursor) break;
      page = { cursor: result.nextCursor, limit: pageSize };
    }
    return groups;
  };

  const isLeaf = (node: GroupNode<Row>, groupBy: readonly GroupSpec[]) => node.level >= groupBy.length - 1;

  /** Fetches the node's next children (sub-groups, or the next page of rows). */
  const fetchChildren = (node: GroupNode<Row>): Promise<void> => {
    if (node.inflight) return node.inflight;
    const gen = generation;
    const base = getQuery();
    const groupBy = groupByOf(base);
    const { groupBy: _drop, ...rest } = base;
    const filter = pinnedFilter(node, base.filter);
    let work: Promise<void>;
    if (!isLeaf(node, groupBy)) {
      if (node.childrenLoaded) return Promise.resolve();
      const query: ServerGroupsQuery = { ...rest, filter, groupBy: groupBy.slice(node.level + 1) };
      work = fetchGroups(query).then((groups) => {
        if (gen !== generation || disposed) return;
        node.subgroups = makeNodes(groups, node);
        node.childrenLoaded = true;
        index(node.subgroups);
      });
    } else {
      const offset = node.rows.length;
      if (node.childrenLoaded && offset >= node.total) return Promise.resolve();
      const query: GridQuery = { ...rest, filter, page: { offset, limit: pageSize }, includeTotal: true };
      work = dataSource.fetch(query).then((result) => {
        if (gen !== generation || disposed) return;
        options.onRows?.(result.rows);
        const seen = new Set(node.rows.map((r) => r.id));
        node.rows = [...node.rows, ...result.rows.filter((r) => !seen.has(r.id))];
        if (typeof result.total === "number") node.total = result.total;
        // An empty page means the group is exhausted whatever the counts say.
        // A short page does not: the source may clamp `limit` to its maxPageSize.
        if (result.rows.length === 0) node.total = node.rows.length;
        node.childrenLoaded = true;
      });
    }
    const tracked = track(work)
      .catch((error: unknown) => {
        if (gen === generation && !disposed) options.onError?.(error);
      })
      .finally(() => {
        node.inflight = undefined;
        if (gen === generation) notify();
      });
    node.inflight = tracked;
    return tracked;
  };

  /** Re-expands (and refetches) expanded groups below `nodes`. */
  const restore = async (nodes: readonly GroupNode<Row>[], gen: number): Promise<void> => {
    await Promise.all(
      nodes
        .filter((n) => expanded.has(n.id))
        .map(async (n) => {
          await fetchChildren(n);
          if (gen === generation && n.subgroups) await restore(n.subgroups, gen);
        }),
    );
  };

  const load = async (): Promise<void> => {
    const gen = ++generation;
    const base = getQuery();
    if (groupByOf(base).length === 0) {
      roots = [];
      byId = new Map();
      notify();
      return;
    }
    try {
      const groups = await track(fetchGroups(base));
      if (gen !== generation || disposed) return;
      roots = makeNodes(groups, null);
      byId = new Map();
      index(roots);
      for (const id of [...expanded]) if (!byId.has(id)) expanded.delete(id);
      notify();
      await restore(roots, gen);
    } catch (error) {
      if (gen === generation && !disposed) options.onError?.(error);
    }
  };

  const setExpanded = async (groupId: string, next: boolean): Promise<void> => {
    const node = byId.get(groupId);
    if (!node) return;
    if (expanded.has(groupId) === next) return;
    if (next) expanded.add(groupId);
    else expanded.delete(groupId);
    notify();
    if (next) {
      await fetchChildren(node);
      if (node.subgroups) await restore(node.subgroups, generation);
    }
  };

  const loadMore = async (id: string): Promise<void> => {
    const groupId = id.startsWith(LOAD_MORE_PREFIX) ? id.slice(LOAD_MORE_PREFIX.length) : id;
    const node = byId.get(groupId);
    if (!node || !node.childrenLoaded) return;
    await fetchChildren(node);
  };

  const shell = (node: GroupNode<Row>): GroupDisplayRow => {
    const next: GroupDisplayRow = {
      __sg: "group",
      id: node.id,
      level: node.level,
      columnId: node.columnId,
      key: node.value,
      label: node.label,
      count: node.count,
      aggregates: node.aggregates,
      expanded: expanded.has(node.id),
      groupPath: node.groupPath,
    };
    const prev = shellCache.get(node.id);
    return prev && json(prev) === json(next) ? prev : next;
  };

  const loadMoreRow = (node: GroupNode<Row>): LoadMoreDisplayRow => {
    const id = loadMoreRowId(node.id);
    const prev = loadMoreCache.get(id);
    if (prev && prev.loaded === node.rows.length && prev.total === node.total) return prev;
    return { __sg: "loadMore", id, groupPath: node.groupPath, loaded: node.rows.length, total: node.total };
  };

  const getDisplayRows = (): DisplayRow<Row>[] => {
    const out: DisplayRow<Row>[] = [];
    const nextShells = new Map<string, GroupDisplayRow>();
    const nextLoadMore = new Map<string, LoadMoreDisplayRow>();
    const resolve = options.resolveRow;
    const walk = (nodes: readonly GroupNode<Row>[]) => {
      for (const node of nodes) {
        const s = shell(node);
        nextShells.set(node.id, s);
        out.push(s);
        if (!expanded.has(node.id)) continue;
        if (node.subgroups) {
          walk(node.subgroups);
          continue;
        }
        for (const r of node.rows) out.push(resolve ? resolve(r) : r);
        if (node.childrenLoaded && node.rows.length < node.total) {
          const lm = loadMoreRow(node);
          nextLoadMore.set(lm.id, lm);
          out.push(lm);
        }
      }
    };
    walk(roots);
    shellCache.clear();
    for (const [k, v] of nextShells) shellCache.set(k, v);
    loadMoreCache.clear();
    for (const [k, v] of nextLoadMore) loadMoreCache.set(k, v);
    return out;
  };

  return {
    load,
    toggle: (groupId) => setExpanded(groupId, !expanded.has(groupId)),
    setExpanded,
    isExpanded: (groupId) => expanded.has(groupId),
    loadMore,
    getDisplayRows,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      generation += 1;
      listeners.clear();
    },
  };
}

// ---- React wiring ------------------------------------------------------------------

export interface UseServerGroupsOptions<Row extends GridRow = GridRow> {
  /** False outside server mode: the hook stays inert. */
  enabled: boolean;
  queryStore: QueryStore;
  rowStore: RowStore<Row>;
  /** Effective query (readable-pruned groupBy included); `groupBy` non-empty activates grouping. */
  getQuery(): ServerGroupsQuery;
  /** Stable getter for the latest data source. */
  getDataSource(): Pick<DataSource<Row>, "fetch">;
  /** Changing it reloads the groups. */
  dataSource: unknown;
  pageSize: number;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  /** Returns false to skip fetching (e.g. an invalid external filter). */
  canFetch?(): boolean;
  onRows?(rows: Row[]): void;
  onError?(error: unknown): void;
  onLoadingChange?(loading: boolean): void;
}

export interface ServerGroupsHandle<Row extends GridRow = GridRow> {
  /** Server mode with a non-empty groupBy: the grid must use the client-side row model. */
  active: boolean;
  /** Display rows for `rowData` while active. */
  rows: DisplayRow<Row>[];
  /** Display order by row id (for `postSortRows`). */
  getOrderIndex(): ReadonlyMap<string, number>;
  toggle(groupId: string): void;
  loadMore(id: string): void;
  refetch(): Promise<void>;
}

const NO_ROWS: never[] = [];

export function useServerGroups<Row extends GridRow = GridRow>(options: UseServerGroupsOptions<Row>): ServerGroupsHandle<Row> {
  const latest = useRef(options);
  latest.current = options;
  const { enabled, queryStore, rowStore, schema, registry, pageSize, dataSource } = options;

  const active = useSyncExternalStore(queryStore.subscribe, () =>
    enabled ? (latest.current.getQuery().groupBy?.length ?? 0) > 0 : false,
  );

  const controller = useMemo(
    () =>
      active
        ? createServerGroupsController<Row>({
            dataSource: { fetch: (q) => latest.current.getDataSource().fetch(q) },
            getQuery: () => latest.current.getQuery(),
            pageSize,
            schema,
            registry,
            resolveRow: (r) => rowStore.getRow(r.id) ?? r,
            onRows: (rows) => latest.current.onRows?.(rows),
            onError: (e) => latest.current.onError?.(e),
            onLoadingChange: (l) => latest.current.onLoadingChange?.(l),
          })
        : null,
    [active, pageSize, schema, registry, rowStore],
  );

  const [rows, setRows] = useState<DisplayRow<Row>[]>(NO_ROWS);
  const orderIndex = useRef<ReadonlyMap<string, number>>(new Map());

  useEffect(() => () => controller?.dispose(), [controller]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: dataSource isn't read directly (getDataSource() reads it via `latest.current`); it's kept as a dep so a new data source forces a fresh effect run (re-subscribe + reload), matching the "dataSource: a new data source reloads through a fresh effect run" contract below.
  useEffect(() => {
    if (!controller) {
      setRows(NO_ROWS);
      return;
    }
    const publish = () => {
      const display = controller.getDisplayRows();
      orderIndex.current = new Map(display.map((r, i) => [(r as { id: string }).id, i]));
      setRows(display);
    };
    const offController = controller.subscribe(publish);
    const offRows = rowStore.subscribe(publish);
    let lastKey: string | undefined;
    const reloadIfChanged = () => {
      if (latest.current.canFetch && !latest.current.canFetch()) return;
      const key = json(latest.current.getQuery());
      if (key === lastKey) return;
      lastKey = key;
      void controller.load();
    };
    const offQuery = queryStore.subscribe(reloadIfChanged);
    reloadIfChanged();
    return () => {
      offController();
      offRows();
      offQuery();
    };
    // dataSource: a new data source reloads through a fresh effect run.
  }, [controller, queryStore, rowStore, dataSource]);

  const toggle = useCallback((id: string) => void controller?.toggle(id), [controller]);
  const loadMore = useCallback((id: string) => void controller?.loadMore(id), [controller]);
  const refetch = useCallback(async () => controller?.load(), [controller]);
  const getOrderIndex = useCallback(() => orderIndex.current, []);

  return {
    active,
    rows: active ? rows : NO_ROWS,
    getOrderIndex,
    toggle,
    loadMore,
    refetch,
  };
}
