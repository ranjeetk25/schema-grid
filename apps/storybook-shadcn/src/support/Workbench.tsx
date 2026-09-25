/**
 * A full host around `<SchemaGrid>` built only from ui-shadcn: ViewSwitcher,
 * FilterButton + FilterChips, the Group popover, the ColumnPanel (right-side
 * column builder), undo/redo/export ghost icon buttons, the conflict prompt
 * and toasts. Test hooks (filter AST, counters, clipboard report) live in a
 * hidden element so no debug values show in the UI.
 */
import {
  type ClipboardReport,
  SchemaGrid,
  type SchemaGridHandle,
  type SchemaGridPollOptions,
  type SchemaGridProps,
} from "@ranjeetk25/schema-grid-ag-grid";
import type {
  ChangeFeedEntry,
  ColumnDef,
  DataSource,
  FilterNode,
  GridRow,
  GridSchema,
  GroupSpec,
  PermissionUser,
  ViewDef,
} from "@ranjeetk25/schema-grid-core";
import { resolveColumnAccess } from "@ranjeetk25/schema-grid-core";
import {
  Button,
  ColumnPanel,
  ConflictPopover,
  FilterButton,
  FilterChips,
  GroupByBar,
  Separator,
  ShadcnHeaderMenu,
  Tooltip,
  ViewSwitcher,
  notifyClipboardReport,
  useGridThemeFromShadcn,
  useShadcnConflictPrompt,
} from "@ranjeetk25/schema-grid-ui-shadcn";
import { createShadcnUiRegistry } from "@ranjeetk25/schema-grid-ui-shadcn/editors";
import { DownloadIcon, PlusIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { registry, resolver } from "./shared";

export const uiRegistry = createShadcnUiRegistry({ fieldTypes: registry });

const ALL_ROWS_VIEW: ViewDef = {
  id: "view_all",
  name: "All rows",
  filter: null,
  sort: [],
  columnState: [],
  groupBy: [],
  pageSize: 100,
};

/** Every column stays in the DOM so tests (and screenshots) can reach any cell. */
export const GRID_OPTIONS = { suppressColumnVirtualisation: true } as const;

const comparable = (v: ViewDef | null | undefined) =>
  v ? JSON.stringify({ f: v.filter, s: v.sort, q: v.search ?? "", g: v.groupBy }) : "";

type InsertAt = NonNullable<SchemaGridProps["draftColumn"]>["insertAt"];

const MOD = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform) ? "⌘" : "Ctrl+";

export interface WorkbenchProps {
  dataSource: DataSource;
  schema: GridSchema;
  user: PermissionUser;
  mode?: "client" | "server";
  onSchemaChange?(next: GridSchema): Promise<GridSchema> | GridSchema;
  poll?: SchemaGridPollOptions;
  height?: number;
  initialViews?: ViewDef[];
  /** Extra toolbar content (right side). */
  toolbar?: (handle: SchemaGridHandle | null) => ReactNode;
  /** Extra status-line content (bottom bar). */
  status?: ReactNode;
  onRemoteChanges?(entry: ChangeFeedEntry): void;
  pageSize?: number;
  testId?: string;
  persistViewsKey?: string;
}

function loadViews(key: string | undefined): ViewDef[] | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as ViewDef[]) : null;
  } catch {
    return null;
  }
}

/** Places a new column by `insertAt` (header menu "Insert left/right"), else at the end; renumbers `order`. */
function insertColumn(columns: ColumnDef[], column: ColumnDef, at: InsertAt | undefined): ColumnDef[] {
  const sorted = [...columns].sort((a, b) => a.order - b.order);
  let index = sorted.length;
  if (typeof at === "number") index = Math.max(0, Math.min(sorted.length, at));
  else if (at?.afterColumnId) index = sorted.findIndex((c) => c.id === at.afterColumnId) + 1 || sorted.length;
  else if (at?.beforeColumnId) {
    const i = sorted.findIndex((c) => c.id === at.beforeColumnId);
    if (i >= 0) index = i;
  }
  sorted.splice(index, 0, column);
  return sorted.map((c, order) => ({ ...c, order }));
}

/** A 32px ghost icon button with a Linear-style tooltip. */
export function IconAction({
  label,
  shortcut,
  onClick,
  disabled,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick(): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <Button variant="subtle" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function Workbench({
  dataSource,
  schema: initialSchema,
  user,
  mode = "client",
  onSchemaChange,
  poll,
  height = 420,
  initialViews,
  toolbar,
  status,
  onRemoteChanges,
  pageSize,
  testId = "workbench",
  persistViewsKey,
}: WorkbenchProps) {
  const [schema, setSchema] = useState(initialSchema);
  useEffect(() => setSchema(initialSchema), [initialSchema]);
  const handleRef = useRef<SchemaGridHandle | null>(null);
  const [, forceRender] = useState(0);
  const setHandle = useCallback((h: SchemaGridHandle | null) => {
    if (handleRef.current === h) return;
    handleRef.current = h;
    if (h) forceRender((n) => n + 1);
  }, []);
  const access = useMemo(() => resolveColumnAccess(schema, resolver, user), [schema, user]);
  const { theme } = useGridThemeFromShadcn();

  const [views, setViews] = useState<ViewDef[]>(() => loadViews(persistViewsKey) ?? initialViews ?? [ALL_ROWS_VIEW]);
  useEffect(() => {
    if (!persistViewsKey) return;
    try {
      localStorage.setItem(persistViewsKey, JSON.stringify(views));
    } catch {
      // Storage unavailable: views stay in memory.
    }
  }, [persistViewsKey, views]);
  const [activeViewId, setActiveViewId] = useState<string | null>(views[0]?.id ?? null);
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const [liveView, setLiveView] = useState<ViewDef | null>(activeView);
  const [filter, setFilter] = useState<FilterNode | null>(activeView?.filter ?? null);
  const [filterDraft, setFilterDraft] = useState<{ draft: FilterNode | null; dirty: boolean }>({ draft: null, dirty: false });
  const [groupBy, setGroupBy] = useState<GroupSpec[]>(activeView?.groupBy ?? []);
  const [clipboard, setClipboard] = useState<ClipboardReport | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editColumn, setEditColumn] = useState<ColumnDef | null>(null);
  const [insertAt, setInsertAt] = useState<InsertAt | undefined>(undefined);
  const [draftColumn, setDraftColumn] = useState<SchemaGridProps["draftColumn"]>(null);
  const [sampleRows, setSampleRows] = useState<GridRow[]>([]);
  const [feedCount, setFeedCount] = useState(0);
  const [saved, setSaved] = useState(0);
  const prompt = useShadcnConflictPrompt();

  const onViewChange = useCallback((view: ViewDef) => {
    setLiveView(view);
    setFilter(view.filter);
    setGroupBy(view.groupBy);
  }, []);

  const applyFilter = (node: FilterNode | null) => {
    setFilter(node);
    handleRef.current?.stores.query.setFilter(node);
  };
  const applyGroupBy = (next: GroupSpec[]) => {
    setGroupBy(next);
    handleRef.current?.stores.query.setGroupBy(next);
  };

  const openPanel = (column: ColumnDef | null, at?: InsertAt) => {
    setEditColumn(column);
    setInsertAt(at);
    setPanelOpen(true);
    dataSource
      .fetch({ filter: null, sort: [], page: { offset: 0, limit: 3 } })
      .then((r) => setSampleRows(r.rows))
      .catch(() => setSampleRows([]));
  };

  const commitSchema = async (next: GridSchema) => {
    const persisted = onSchemaChange ? await onSchemaChange(next) : next;
    setSchema(persisted);
  };

  const saveColumn = async (column: ColumnDef) => {
    const exists = schema.columns.some((c) => c.id === column.id);
    const columns = exists ? schema.columns.map((c) => (c.id === column.id ? column : c)) : insertColumn(schema.columns, column, insertAt);
    await commitSchema({ ...schema, schemaVersion: schema.schemaVersion + 1, columns });
    setPanelOpen(false);
    setEditColumn(null);
  };

  const deleteColumn = async (columnId: string) => {
    await commitSchema({
      ...schema,
      schemaVersion: schema.schemaVersion + 1,
      columns: schema.columns.filter((c) => c.id !== columnId),
    });
    setPanelOpen(false);
    setEditColumn(null);
  };

  const events = useMemo(
    () => ({
      onConflict: prompt.onConflict,
      onCellsChange: () => setSaved((n) => n + 1),
      onOptionCreate: (columnId: string, option: { id: string; label: string }) => {
        setSchema((s) => ({
          ...s,
          schemaVersion: s.schemaVersion + 1,
          columns: s.columns.map((c) => {
            if (c.id !== columnId) return c;
            const cfg = (c.config ?? {}) as { options?: { id: string; label: string }[] };
            const options = cfg.options ?? [];
            return options.some((o) => o.id === option.id) ? c : { ...c, config: { ...cfg, options: [...options, option] } };
          }),
        }));
      },
      onRemoteChanges: (entry: ChangeFeedEntry<GridRow>) => {
        if (entry.rows.length > 0 || entry.deletedRowIds.length > 0) setFeedCount((n) => n + 1);
        onRemoteChanges?.(entry);
      },
    }),
    [prompt.onConflict, onRemoteChanges],
  );

  const conflict = prompt.conflict;
  const conflictColumn = conflict ? schema.columns.find((c) => c.id === conflict.columnId) : undefined;
  const conflictCell =
    conflict && typeof document !== "undefined"
      ? document.querySelector<HTMLElement>(
          `[data-testid="${testId}"] .ag-row[row-id="${CSS.escape(conflict.rowId)}"] .ag-cell[col-id="${CSS.escape(conflict.columnId)}"]`,
        )
      : null;
  const canEditSchema = user.roles.includes("admin");

  return (
    <div className="sg-ui sg:flex sg:flex-col sg:gap-2" data-testid={testId}>
      <div className="sg:flex sg:flex-wrap sg:items-center sg:gap-1.5">
        <ViewSwitcher
          views={views}
          activeViewId={activeViewId}
          dirty={comparable(liveView) !== comparable(activeView)}
          onSelect={(id) => {
            const v = views.find((x) => x.id === id);
            setActiveViewId(id);
            if (v) {
              setFilter(v.filter);
              setGroupBy(v.groupBy);
              setLiveView(v);
            }
          }}
          onCreate={(name) => {
            const captured = handleRef.current?.captureView() ?? liveView ?? ALL_ROWS_VIEW;
            const view: ViewDef = { ...captured, id: `view_${Date.now().toString(36)}`, name };
            setViews((vs) => [...vs, view]);
            setActiveViewId(view.id);
            setLiveView(view);
          }}
          onRename={(id, name) => setViews((vs) => vs.map((v) => (v.id === id ? { ...v, name } : v)))}
          onDelete={(id) => {
            setViews((vs) => vs.filter((v) => v.id !== id));
            if (id === activeViewId) setActiveViewId(null);
          }}
          onSaveCurrent={() => {
            const captured = handleRef.current?.captureView();
            if (!captured || !activeViewId) return;
            setViews((vs) => vs.map((v) => (v.id === activeViewId ? { ...captured, id: v.id, name: v.name } : v)));
          }}
        />
        <Separator orientation="vertical" className="sg:mx-1 sg:h-5" />
        <FilterButton
          schema={schema}
          registry={registry}
          uiRegistry={uiRegistry}
          access={access}
          value={filter}
          onChange={applyFilter}
          onDraftChange={(draft, dirty) => setFilterDraft({ draft, dirty })}
          dataSource={dataSource}
          mode={mode}
        />
        <GroupByBar schema={schema} registry={registry} access={access} value={groupBy} onChange={applyGroupBy} />
        <div className="sg:ml-auto sg:flex sg:items-center sg:gap-0.5">
          {toolbar?.(handleRef.current)}
          <IconAction label="Undo" shortcut={`${MOD}Z`} onClick={() => void handleRef.current?.undo()}>
            <Undo2Icon />
          </IconAction>
          <IconAction label="Redo" shortcut={`${MOD}⇧Z`} onClick={() => void handleRef.current?.redo()}>
            <Redo2Icon />
          </IconAction>
          <IconAction label="Export CSV" onClick={() => handleRef.current?.exportCsv("schema-grid.csv")}>
            <DownloadIcon />
          </IconAction>
          {canEditSchema ? (
            <Button variant="primary" className="sg:ml-1.5" onClick={() => openPanel(null)}>
              <PlusIcon />
              Add column
            </Button>
          ) : null}
        </div>
      </div>
      <FilterChips
        schema={schema}
        registry={registry}
        value={filter}
        onChange={applyFilter}
        access={access}
        draft={filterDraft.draft}
        dirty={filterDraft.dirty}
      />
      <div className="sg:relative">
        <SchemaGrid
          ref={setHandle}
          schema={schema}
          dataSource={dataSource}
          user={user}
          resolver={resolver}
          registry={registry}
          uiRegistry={uiRegistry}
          mode={mode}
          view={activeView}
          onViewChange={onViewChange}
          events={events}
          height={height}
          poll={poll}
          theme={theme}
          headerMenu={ShadcnHeaderMenu}
          draftColumn={draftColumn}
          onGroupByColumn={(colId) => {
            if (!groupBy.some((g) => g.columnId === colId)) applyGroupBy([...groupBy, { columnId: colId }]);
          }}
          {...(canEditSchema
            ? {
                onAddColumn: () => openPanel(null),
                onEditColumn: (colId: string) => {
                  const c = schema.columns.find((x) => x.id === colId);
                  if (c) openPanel(c);
                },
                onInsertColumn: (colId: string, side: "left" | "right") =>
                  openPanel(null, side === "left" ? { beforeColumnId: colId } : { afterColumnId: colId }),
              }
            : {})}
          gridOptions={GRID_OPTIONS}
          {...(pageSize ? { pageSize } : {})}
          onClipboardReport={(report) => {
            setClipboard(report);
            void notifyClipboardReport(report);
          }}
        />
        {conflict && conflictColumn ? (
          <ConflictPopover
            conflict={conflict}
            column={conflictColumn}
            registry={registry}
            uiRegistry={uiRegistry}
            opened={prompt.opened}
            onResolve={prompt.resolve}
            onClose={prompt.dismiss}
            anchor={conflictCell}
          />
        ) : null}
      </div>
      <div className="sg:flex sg:min-h-5 sg:items-center sg:gap-3 sg:text-xs sg:text-muted-foreground sg:tabular-nums">
        {saved > 0 ? <span>{saved === 1 ? "1 change saved" : `${saved} changes saved`}</span> : null}
        {feedCount > 0 ? <span>{feedCount === 1 ? "1 remote update" : `${feedCount} remote updates`}</span> : null}
        {prompt.pendingCount > 0 ? (
          <button type="button" className="sg:font-medium sg:text-danger" onClick={prompt.reopen}>
            {prompt.pendingCount === 1 ? "1 conflict" : `${prompt.pendingCount} conflicts`}
          </button>
        ) : null}
        {status}
      </div>
      {/* Test hooks for Playwright; never rendered. */}
      <div hidden>
        <span data-testid="saved-count">{saved}</span>
        <span data-testid="feed-count">{feedCount}</span>
        <span data-testid="clipboard-report">{clipboard ? JSON.stringify(clipboard) : ""}</span>
        <span data-testid="filter-ast">{JSON.stringify(filter)}</span>
      </div>
      <ColumnPanel
        opened={panelOpen}
        onClose={() => {
          setPanelOpen(false);
          setEditColumn(null);
          setDraftColumn(null);
        }}
        schema={schema}
        registry={registry}
        uiRegistry={uiRegistry}
        access={access}
        roles={["admin", "counsellor", "viewer"]}
        column={editColumn}
        onSave={(c) => void saveColumn(c)}
        onDelete={(id) => void deleteColumn(id)}
        dataSource={dataSource}
        sampleRows={sampleRows}
        insertAt={insertAt}
        onDraftChange={setDraftColumn}
      />
    </div>
  );
}
