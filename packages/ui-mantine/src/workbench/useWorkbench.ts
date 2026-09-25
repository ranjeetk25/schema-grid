/**
 * Headless state behind `<SchemaGridWorkbench>`: schema loading/persistence,
 * capabilities → features, saved views, filter / group / search, the column
 * panel, import / export, counters and error banners. No UI kit imports, so
 * the ui-shadcn mirror copies this file verbatim and only re-skins it.
 */
import type {
  ClipboardReport,
  SchemaGridEvents,
  SchemaGridHandle,
  SchemaGridPollOptions,
} from "@ranjeetk25/schema-grid-ag-grid";
import {
  type Access,
  type ChangeConflict,
  type ChangeFeedEntry,
  type ColumnDef,
  DEFAULT_TIME_ZONE,
  type DataSource,
  type FieldTypeRegistry,
  type FilterNode,
  type GridRow,
  type GridSchema,
  type GroupSpec,
  type Option,
  type PermissionResolver,
  type ViewDef,
  createRolePermissionResolver,
  resolveColumnAccess,
} from "@ranjeetk25/schema-grid-core";
import { createDefaultRegistry } from "@ranjeetk25/schema-grid-core/field-types";
import { buildExportBlob, exportFileName } from "@ranjeetk25/schema-grid-io/export";
import { toChangeBatches, validateRows } from "@ranjeetk25/schema-grid-io/import";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WORKBENCH_DEFAULT_CAPABILITIES, deriveWorkbenchFeatures, loadCapabilities } from "./capabilities";
import { tapDataSource, toWorkbenchError } from "./errors";
import { collectRows } from "./exportRows";
import { type WorkbenchInsertPosition, addOptions, removeColumn, rolesOf, upsertColumn } from "./schemaOps";
import type {
  SchemaGridWorkbenchProps,
  WorkbenchCapabilities,
  WorkbenchError,
  WorkbenchErrorKind,
  WorkbenchFeatures,
  WorkbenchSlot,
  WorkbenchSlotContext,
} from "./types";
import { ALL_ROWS_VIEW, comparableView, createLocalStorageViewStore } from "./viewStore";

/** Structural mirror of the kits' import-wizard plan (both kits share this shape). */
export interface WorkbenchImportPlan {
  parsed: Parameters<typeof validateRows>[0];
  mapping: Parameters<typeof validateRows>[1];
  mode: Parameters<typeof validateRows>[4]["mode"];
  keyColumnId: string | null;
  unknownOptions: Parameters<typeof validateRows>[4]["unknownOptions"];
}

export interface WorkbenchImportJob {
  state: "queued" | "running" | "done" | "failed";
  processed: number;
  total: number;
  errorCount: number;
}

export type WorkbenchExportScope = "view" | "all" | "selected";

/** A banner the kit renders between the toolbar and the grid. */
export interface WorkbenchBanner {
  kind: WorkbenchErrorKind | "read-only";
  message: string;
  /** "Retry" / "Reload" — absent for informational banners. */
  action?: { label: string; run(): void };
  dismiss(): void;
}

export interface UseWorkbenchOptions {
  props: SchemaGridWorkbenchProps;
  /** The kit's conflict prompt (`useMantineConflictPrompt().onConflict`). */
  onConflict: NonNullable<SchemaGridEvents["onConflict"]>;
}

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_BANNER_KINDS: WorkbenchErrorKind[] = ["network", "permission-denied"];

/** "3 pasted, 1 skipped, 1 error" — the human side of a clipboard report. */
export function clipboardSummary(r: ClipboardReport): string {
  const parts = [`${r.pastedCells} pasted`];
  if (r.skippedReadOnly) parts.push(`${r.skippedReadOnly} skipped`);
  if (r.conflicts) parts.push(`${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"}`);
  const errors = r.errors.length;
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  return `Paste: ${parts.join(", ")}`;
}

function importJobLine(job: WorkbenchImportJob | undefined): string | null {
  if (!job) return null;
  if (job.state === "running" || job.state === "queued") return `Importing ${job.processed}/${job.total}…`;
  if (job.state === "failed") return "Import failed";
  return `Imported ${job.total - job.errorCount} of ${job.total} rows${job.errorCount ? ` · ${job.errorCount} rejected` : ""}`;
}

function download(blob: Blob, name: string) {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function renderSlot(slot: WorkbenchSlot | undefined, ctx: WorkbenchSlotContext) {
  return typeof slot === "function" ? slot(ctx) : (slot ?? null);
}

export function useWorkbench({ props, onConflict }: UseWorkbenchOptions) {
  const { client, user, features: featureOverrides, onError } = props;
  const direct = client ? null : props;
  const registry: FieldTypeRegistry = useMemo(() => props.registry ?? createDefaultRegistry(), [props.registry]);
  const baseResolver: PermissionResolver = useMemo(
    () => props.resolver ?? createRolePermissionResolver(),
    [props.resolver],
  );
  const mode = props.mode ?? (client ? "server" : "client");
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // ---- handle ----------------------------------------------------------
  const handleRef = useRef<SchemaGridHandle | null>(null);
  const [, forceRender] = useState(0);
  const onHandleRef = useRef(props.onHandle);
  onHandleRef.current = props.onHandle;
  const setHandle = useCallback((h: SchemaGridHandle | null) => {
    if (handleRef.current === h) return;
    handleRef.current = h;
    onHandleRef.current?.(h);
    if (h) forceRender((n) => n + 1);
  }, []);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  // ---- errors / banners -------------------------------------------------
  const [errors, setErrors] = useState<Partial<Record<WorkbenchErrorKind, WorkbenchError>>>({});
  const report = useCallback((error: WorkbenchError) => {
    setErrors((prev) => (prev[error.kind]?.message === error.message ? prev : { ...prev, [error.kind]: error }));
    onErrorRef.current?.(error);
  }, []);
  const clearKinds = useCallback((kinds: WorkbenchErrorKind[]) => {
    setErrors((prev) => {
      if (!kinds.some((k) => prev[k])) return prev;
      const next = { ...prev };
      for (const k of kinds) delete next[k];
      return next;
    });
  }, []);

  // ---- data source (tapped for banners) -----------------------------------
  const rawDataSource: DataSource = client ? client.dataSource : (direct as { dataSource: DataSource }).dataSource;
  const dataSource = useMemo(
    () =>
      tapDataSource(rawDataSource, {
        onError: report,
        onReadOk: (op) => {
          // A successful read proves we're back online / allowed again. Permission errors on writes stay.
          clearKinds(op === "fetch" ? SEARCH_BANNER_KINDS : ["network"]);
        },
      }),
    [rawDataSource, report, clearKinds],
  );

  // ---- schema --------------------------------------------------------------
  const [schema, setSchema] = useState<GridSchema | null>(() => (direct ? (direct.schema as GridSchema) : null));
  const directSchema = direct?.schema;
  useEffect(() => {
    if (directSchema) setSchema(directSchema);
  }, [directSchema]);
  const [schemaLoading, setSchemaLoading] = useState(!!client);
  const loadSchema = useCallback(async () => {
    if (!client) return;
    setSchemaLoading(true);
    try {
      const next = await client.getSchema();
      setSchema(next);
      clearKinds(["schema-changed", "network", "permission-denied"]);
    } catch (error) {
      report(toWorkbenchError("getSchema", error));
    } finally {
      setSchemaLoading(false);
    }
  }, [client, report, clearKinds]);
  useEffect(() => {
    void loadSchema();
  }, [loadSchema]);

  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const onSchemaChangeRef = useRef(direct?.onSchemaChange);
  onSchemaChangeRef.current = direct?.onSchemaChange;
  const commitSchema = useCallback(
    async (next: GridSchema): Promise<boolean> => {
      try {
        const persisted = client?.updateSchema
          ? await client.updateSchema(next)
          : onSchemaChangeRef.current
            ? await onSchemaChangeRef.current(next)
            : next;
        setSchema(persisted);
        return true;
      } catch (error) {
        report(toWorkbenchError("updateSchema", error));
        return false;
      }
    },
    [client, report],
  );

  // ---- capabilities → features ------------------------------------------
  const [capabilities, setCapabilities] = useState<WorkbenchCapabilities>(WORKBENCH_DEFAULT_CAPABILITIES);
  const schemaVersion = schema?.schemaVersion;
  useEffect(() => {
    let live = true;
    // Re-read after a schema change: column-level capabilities can move with it.
    void schemaVersion;
    void loadCapabilities(client, rawDataSource).then((c) => live && setCapabilities(c));
    return () => {
      live = false;
    };
  }, [client, rawDataSource, schemaVersion]);
  const features: WorkbenchFeatures = useMemo(
    () =>
      deriveWorkbenchFeatures({
        capabilities,
        ...(featureOverrides ? { features: featureOverrides } : {}),
        hasChangeFeed: typeof rawDataSource.getChanges === "function",
        canChangeSchema: client ? typeof client.updateSchema === "function" : true,
      }),
    [capabilities, featureOverrides, rawDataSource, client],
  );

  // TODO(lane-a): useSchemaGrid makes cells read-only for write.cells:false and
  // settable:false columns itself; until then the resolver downgrades edit → read.
  const resolver: PermissionResolver = useMemo(() => {
    const writable = capabilities.write.cells;
    return (ctx) => {
      const access = baseResolver(ctx);
      if (access !== "edit") return access;
      if (!writable) return "read";
      if ((ctx.column as ColumnDef & { settable?: boolean }).settable === false) return "read";
      return access;
    };
  }, [baseResolver, capabilities.write.cells]);

  const access: Map<string, Access> = useMemo(
    () => (schema ? resolveColumnAccess(schema, resolver, user) : new Map()),
    [schema, resolver, user],
  );

  // ---- views ---------------------------------------------------------------
  const gridId = props.gridId ?? client?.gridId ?? schema?.id ?? "grid";
  const defaultStore = useMemo(() => createLocalStorageViewStore(), []);
  const viewStore = props.viewStore ?? defaultStore;
  const controlledViews = props.views;
  const initialViews = (): ViewDef[] => {
    const fallback = props.defaultViews ?? (schema?.views?.length ? schema.views : null) ?? [ALL_ROWS_VIEW];
    if (controlledViews) return controlledViews;
    const loaded = schema ? viewStore.load(gridId) : null;
    return loaded && !(loaded instanceof Promise) ? loaded : fallback;
  };
  const [ownViews, setOwnViews] = useState<ViewDef[]>(initialViews);
  const views = controlledViews ?? ownViews;
  const viewsLoadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (controlledViews || !schema || viewsLoadedFor.current === gridId) return;
    viewsLoadedFor.current = gridId;
    const loaded = viewStore.load(gridId);
    const apply = (v: ViewDef[] | null) => {
      if (v?.length) setOwnViews(v);
      else if (!props.defaultViews && schema.views?.length) setOwnViews(schema.views);
    };
    if (loaded instanceof Promise) void loaded.then(apply, () => undefined);
    else apply(loaded);
  }, [controlledViews, schema, gridId, viewStore, props.defaultViews]);
  const onViewsChangeRef = useRef(props.onViewsChange);
  onViewsChangeRef.current = props.onViewsChange;
  const setViews = useCallback(
    (update: (prev: ViewDef[]) => ViewDef[]) => {
      if (controlledViews) {
        onViewsChangeRef.current?.(update(controlledViews));
        return;
      }
      setOwnViews((prev) => {
        const next = update(prev);
        onViewsChangeRef.current?.(next);
        void Promise.resolve(viewStore.save(gridId, next)).catch(() => undefined);
        return next;
      });
    },
    [controlledViews, viewStore, gridId],
  );

  const [activeViewId, setActiveViewId] = useState<string | null>(() => views[0]?.id ?? null);
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  useEffect(() => {
    if (activeViewId === null && views[0]) setActiveViewId(views[0].id);
  }, [activeViewId, views]);
  const [liveView, setLiveView] = useState<ViewDef | null>(activeView);
  const [filter, setFilter] = useState<FilterNode | null>(activeView?.filter ?? null);
  const [groupBy, setGroupBy] = useState<GroupSpec[]>(activeView?.groupBy ?? []);
  const [search, setSearchText] = useState<string>(activeView?.search ?? "");

  const onViewChange = useCallback((view: ViewDef) => {
    setLiveView(view);
    setFilter(view.filter);
    setGroupBy(view.groupBy);
  }, []);
  const applyFilter = useCallback((node: FilterNode | null) => {
    setFilter(node);
    handleRef.current?.stores.query.setFilter(node);
  }, []);
  const applyGroupBy = useCallback((next: GroupSpec[]) => {
    setGroupBy(next);
    handleRef.current?.stores.query.setGroupBy(next);
  }, []);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setSearch = useCallback((text: string) => {
    setSearchText(text);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => handleRef.current?.stores.query.setSearch(text.trim() ? text : undefined),
      SEARCH_DEBOUNCE_MS,
    );
  }, []);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const groupByRef = useRef(groupBy);
  groupByRef.current = groupBy;
  const onGroupByColumn = useCallback(
    (colId: string) => {
      const current = groupByRef.current;
      if (!current.some((g) => g.columnId === colId)) applyGroupBy([...current, { columnId: colId }]);
    },
    [applyGroupBy],
  );

  const viewActions = {
    select(id: string) {
      const v = views.find((x) => x.id === id);
      setActiveViewId(id);
      if (v) {
        setFilter(v.filter);
        setGroupBy(v.groupBy);
        setSearchText(v.search ?? "");
        setLiveView(v);
      }
    },
    create(name: string) {
      const captured = handleRef.current?.captureView() ?? liveView ?? ALL_ROWS_VIEW;
      const view: ViewDef = { ...captured, id: `view_${Date.now().toString(36)}`, name };
      setViews((vs) => [...vs, view]);
      setActiveViewId(view.id);
      setLiveView(view);
    },
    rename(id: string, name: string) {
      setViews((vs) => vs.map((v) => (v.id === id ? { ...v, name } : v)));
    },
    remove(id: string) {
      setViews((vs) => vs.filter((v) => v.id !== id));
      if (id === activeViewId) setActiveViewId(null);
    },
    saveCurrent() {
      const captured = handleRef.current?.captureView();
      if (!captured || !activeViewId) return;
      setViews((vs) => vs.map((v) => (v.id === activeViewId ? { ...captured, id: v.id, name: v.name } : v)));
    },
  };
  const viewDirty = comparableView(liveView) !== comparableView(activeView);

  // ---- column panel --------------------------------------------------------
  const [panelOpen, setPanelOpen] = useState(false);
  const [editColumn, setEditColumn] = useState<ColumnDef | null>(null);
  const [insertAt, setInsertAt] = useState<WorkbenchInsertPosition | null>(null);
  const [draft, setDraft] = useState<ColumnDef | null>(null);
  const [sampleRows, setSampleRows] = useState<GridRow[]>([]);
  const openPanel = useCallback((column: ColumnDef | null, at: WorkbenchInsertPosition | null = null) => {
    const api = handleRef.current?.api();
    const rows: GridRow[] = [];
    for (let i = 0; api && i < 3; i++) {
      const data = api.getDisplayedRowAtIndex(i)?.data as GridRow | undefined;
      if (data && "cells" in data) rows.push(data);
    }
    setSampleRows(rows);
    setEditColumn(column);
    setInsertAt(at);
    setPanelOpen(true);
  }, []);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setEditColumn(null);
    setInsertAt(null);
    setDraft(null);
  }, []);
  const onEditColumn = useCallback(
    (colId: string) => openPanel(schemaRef.current?.columns.find((c) => c.id === colId) ?? null),
    [openPanel],
  );
  const onInsertColumn = useCallback(
    (colId: string, side: "left" | "right") =>
      openPanel(null, side === "left" ? { beforeColumnId: colId } : { afterColumnId: colId }),
    [openPanel],
  );
  const onAddColumn = useCallback(() => openPanel(null), [openPanel]);
  const saveColumn = useCallback(
    async (column: ColumnDef) => {
      const current = schemaRef.current;
      if (!current) return;
      if (await commitSchema(upsertColumn(current, column, insertAt))) closePanel();
    },
    [commitSchema, insertAt, closePanel],
  );
  const deleteColumn = useCallback(
    async (columnId: string) => {
      const current = schemaRef.current;
      if (!current) return;
      if (await commitSchema(removeColumn(current, columnId))) closePanel();
    },
    [commitSchema, closePanel],
  );
  const draftColumn = useMemo(
    () =>
      draft && panelOpen
        ? {
            column: draft,
            mode: editColumn ? ("edit" as const) : ("create" as const),
            ...(insertAt !== null && typeof insertAt === "object" ? { insertAt } : {}),
          }
        : null,
    [draft, panelOpen, editColumn, insertAt],
  );
  const roles = useMemo(() => props.roles ?? (schema ? rolesOf(schema, user) : user.roles), [props.roles, schema, user]);

  // ---- counters, clipboard, feed ---------------------------------------------
  const [clipboard, setClipboard] = useState<ClipboardReport | null>(null);
  const [feedCount, setFeedCount] = useState(0);
  const [saved, setSaved] = useState(0);
  const onRemoteChangesRef = useRef(props.onRemoteChanges);
  onRemoteChangesRef.current = props.onRemoteChanges;
  const flagSchemaVersion = useCallback(
    (version: number) => {
      const current = schemaRef.current;
      if (current && version > current.schemaVersion) {
        report({
          kind: "schema-changed",
          op: "getChanges",
          error: null,
          message: "The columns were changed elsewhere.",
        });
      }
    },
    [report],
  );
  const events: SchemaGridEvents = useMemo(
    () => ({
      onConflict,
      onCellsChange: () => {
        setSaved((n) => n + 1);
        bump();
      },
      onOptionCreate: (columnId: string, option: Option) => {
        setSchema((s) => (s ? addOptions(s, columnId, [option]) : s));
      },
      onRemoteChanges: (entry: ChangeFeedEntry<GridRow>) => {
        if (entry.rows.length > 0 || entry.deletedRowIds.length > 0) setFeedCount((n) => n + 1);
        flagSchemaVersion(entry.schemaVersion);
        onRemoteChangesRef.current?.(entry);
      },
      onSchemaChanged: flagSchemaVersion,
    }),
    [onConflict, bump, flagSchemaVersion],
  );
  const onClipboardReport = useCallback((r: ClipboardReport) => setClipboard(r), []);

  // ---- offline / online -----------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const offline = () =>
      report({ kind: "network", op: "fetch", error: null, message: "You're offline. Changes will sync when you reconnect." });
    const online = () => {
      clearKinds(["network"]);
      void handleRef.current?.refetch();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [report, clearKinds]);

  const refetch = useCallback(async () => {
    try {
      await handleRef.current?.refetch();
    } catch {
      // Reported through the tapped data source.
    }
  }, []);
  const retry = useCallback(() => {
    clearKinds(["network", "permission-denied"]);
    if (!schemaRef.current) void loadSchema();
    else void refetch();
  }, [clearKinds, loadSchema, refetch]);
  const reloadSchema = useCallback(async () => {
    clearKinds(["schema-changed"]);
    if (client) await loadSchema();
    await refetch();
  }, [clearKinds, client, loadSchema, refetch]);

  const [readOnlyDismissed, setReadOnlyDismissed] = useState(false);
  const banners: WorkbenchBanner[] = [];
  const dismiss = (kind: WorkbenchErrorKind) => () => clearKinds([kind]);
  if (errors["schema-changed"])
    banners.push({
      kind: "schema-changed",
      message: errors["schema-changed"].message,
      action: { label: "Reload", run: () => void reloadSchema() },
      dismiss: dismiss("schema-changed"),
    });
  if (errors.network)
    banners.push({ kind: "network", message: errors.network.message, action: { label: "Retry", run: retry }, dismiss: dismiss("network") });
  if (errors["permission-denied"])
    banners.push({
      kind: "permission-denied",
      message: errors["permission-denied"].message,
      action: { label: "Retry", run: retry },
      dismiss: dismiss("permission-denied"),
    });
  if (errors["capability-denied"])
    banners.push({
      kind: "capability-denied",
      message: errors["capability-denied"].message,
      dismiss: dismiss("capability-denied"),
    });
  if (!capabilities.write.cells && !readOnlyDismissed)
    banners.push({
      kind: "read-only",
      message: "Read-only. This data source doesn't accept edits.",
      dismiss: () => setReadOnlyDismissed(true),
    });

  // ---- import / export ------------------------------------------------------
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importJob, setImportJob] = useState<WorkbenchImportJob | undefined>(undefined);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const tz = props.gridProps?.tz ?? DEFAULT_TIME_ZONE;

  const visibleColumns = useCallback((): ColumnDef[] => {
    const current = schemaRef.current;
    if (!current) return [];
    const readable = (c: ColumnDef | undefined): c is ColumnDef =>
      c !== undefined && (access.get(c.id) === "read" || access.get(c.id) === "edit");
    const state = handleRef.current?.api()?.getColumnState() ?? [];
    const byId = new Map(current.columns.map((c) => [c.id, c]));
    if (state.length === 0) return [...current.columns].sort((a, b) => a.order - b.order).filter((c) => !c.hidden && readable(c));
    return state
      .filter((s) => !s.hide)
      .map((s) => byId.get(s.colId))
      .filter(readable);
  }, [access]);

  const runExport = useCallback(
    async ({ scope, format }: { scope: WorkbenchExportScope; format: "csv" | "xlsx" }) => {
      const columns = visibleColumns();
      let rows: GridRow[];
      if (scope === "selected") {
        rows = (handleRef.current?.api()?.getSelectedRows() ?? []) as GridRow[];
      } else {
        const q = handleRef.current?.stores.query.getState();
        rows = await collectRows(dataSource, {
          filter: scope === "view" ? (q?.filter ?? null) : null,
          sort: scope === "view" ? (q?.sort ?? []) : [],
          ...(scope === "view" && q?.search ? { search: q.search } : {}),
          pageSize: Math.min(capabilities.maxPageSize, 1000),
          ...(capabilities.export.maxRows ? { maxRows: capabilities.export.maxRows } : {}),
        });
      }
      const base = (schemaRef.current?.id ?? "export").replace(/[^\w-]+/g, "-");
      const fileName = exportFileName(base, format);
      const blob = await buildExportBlob({ columns, registry, rows, format, tz, fileName, access });
      setLastExport(`${fileName}: ${rows.length} rows, ${columns.length} columns`);
      download(blob, fileName);
    },
    [visibleColumns, dataSource, capabilities, registry, tz, access],
  );
  const exportCsv = useCallback(() => handleRef.current?.exportCsv("schema-grid.csv"), []);

  const commitImport = useCallback(
    async (plan: WorkbenchImportPlan) => {
      const current = schemaRef.current;
      if (!current) return;
      const report = validateRows(plan.parsed, plan.mapping, current, registry, {
        mode: plan.mode,
        unknownOptions: plan.unknownOptions,
        access,
        ...(plan.keyColumnId ? { keyColumnId: plan.keyColumnId } : {}),
      });
      const total = plan.parsed.rows.length;
      setImportJob({ state: "running", processed: 0, total, errorCount: 0 });
      try {
        const importPlan = toChangeBatches(report, new Map(), {
          schema: current,
          registry,
          mode: plan.mode,
          ...(plan.keyColumnId ? { keyColumnId: plan.keyColumnId } : {}),
        });
        let next = current;
        for (const [columnId, labels] of Object.entries(report.summary.newOptions ?? {})) {
          for (const label of labels as string[]) {
            const created = await dataSource.createOption?.(columnId, label).catch(() => undefined);
            if (created) next = addOptions(next, columnId, [created]);
          }
        }
        if (next !== current) setSchema(next);
        if (importPlan.creates.length > 0)
          await dataSource.createRows(importPlan.creates.map((c) => ({ cells: c.cells ?? {} })));
        for (const batch of importPlan.updates) await dataSource.applyChanges(batch);
        setImportJob({ state: "done", processed: total, total, errorCount: importPlan.rejected.length });
        await refetch();
      } catch (error) {
        setImportJob({ state: "failed", processed: 0, total, errorCount: total });
        throw error;
      }
    },
    [registry, access, dataSource, refetch],
  );

  const poll: SchemaGridPollOptions = features.polling
    ? { ...(props.pollIntervalMs ? { intervalMs: props.pollIntervalMs } : {}) }
    : { enabled: false };

  const handle = handleRef.current;
  const slotContext: WorkbenchSlotContext | null = schema
    ? {
        schema,
        user,
        features,
        capabilities,
        handle,
        openImport: () => setImportOpen(true),
        openExport: () => setExportOpen(true),
        openAddColumn: onAddColumn,
        refetch,
      }
    : null;

  const status: string[] = [
    saved > 0 ? `${saved} saved` : null,
    feedCount > 0 ? `${feedCount} remote update${feedCount === 1 ? "" : "s"}` : null,
    clipboard ? clipboardSummary(clipboard) : null,
    lastExport ? `Exported ${lastExport}` : null,
    importJobLine(importJob),
  ].filter((s): s is string => s !== null);

  return {
    // data
    schema,
    schemaLoading,
    dataSource,
    registry,
    resolver,
    access,
    user,
    mode,
    capabilities,
    features,
    roles,
    poll,
    events,
    // grid handle
    setHandle,
    handle,
    canUndo: handle?.canUndo() ?? false,
    canRedo: handle?.canRedo() ?? false,
    undo: () => void handle?.undo().then(bump),
    redo: () => void handle?.redo().then(bump),
    exportCsv,
    refetch,
    // views / query
    views,
    activeViewId,
    activeView,
    viewDirty,
    viewActions,
    onViewChange,
    filter,
    applyFilter,
    groupBy,
    applyGroupBy,
    onGroupByColumn,
    search,
    setSearch,
    // column panel
    panel: {
      opened: panelOpen,
      column: editColumn,
      insertAt,
      sampleRows,
      draftColumn,
      setDraft,
      open: openPanel,
      close: closePanel,
      save: saveColumn,
      remove: deleteColumn,
    },
    onEditColumn,
    onInsertColumn,
    onAddColumn,
    // import / export
    importDialog: {
      opened: importOpen,
      open: () => setImportOpen(true),
      close: () => {
        setImportOpen(false);
        setImportJob(undefined);
      },
      job: importJob,
      commit: commitImport,
    },
    exportDialog: {
      opened: exportOpen,
      open: () => setExportOpen(true),
      close: () => setExportOpen(false),
      run: runExport,
      visibleColumnCount: () => visibleColumns().length,
      selectedRowCount: () => handle?.api()?.getSelectedRows().length ?? 0,
      lastExport,
    },
    // status
    clipboard,
    onClipboardReport,
    saved,
    feedCount,
    status,
    banners,
    errors,
    slotContext,
  };
}

export type WorkbenchController = ReturnType<typeof useWorkbench>;
export type { ChangeConflict };
