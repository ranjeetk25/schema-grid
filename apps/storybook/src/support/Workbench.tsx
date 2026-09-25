/**
 * A full host around `<SchemaGrid>`: FilterButton + FilterChips (query store
 * filter), GroupByBar (query store groupBy), ViewSwitcher (saved views),
 * ColumnBuilderModal (schema edits), undo/redo, CSV export, the Mantine
 * conflict prompt and a visible clipboard/feed log for Playwright.
 */
import { Badge, Box, Button, Code, Group, Stack, Text } from "@mantine/core";
import {
  type ClipboardReport,
  SchemaGrid,
  type SchemaGridHandle,
  type SchemaGridPollOptions,
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
  ColumnBuilderModal,
  ConflictPopover,
  FilterButton,
  FilterChips,
  GroupByBar,
  ViewSwitcher,
  notifyClipboardReport,
  useMantineConflictPrompt,
} from "@ranjeetk25/schema-grid-ui-mantine";
import { createMantineUiRegistry } from "@ranjeetk25/schema-grid-ui-mantine/editors";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { registry, resolver } from "./data";

export const uiRegistry = createMantineUiRegistry({ fieldTypes: registry });

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
  v
    ? JSON.stringify({
        f: v.filter,
        s: v.sort,
        q: v.search ?? "",
        g: v.groupBy,
      })
    : "";

export interface WorkbenchProps {
  dataSource: DataSource;
  schema: GridSchema;
  user: PermissionUser;
  mode?: "client" | "server";
  /** Persists a schema change (column builder / created option). Default: accept as-is. */
  onSchemaChange?(next: GridSchema): Promise<GridSchema> | GridSchema;
  poll?: SchemaGridPollOptions;
  height?: number;
  initialViews?: ViewDef[];
  /** Extra toolbar content. */
  toolbar?: (handle: SchemaGridHandle | null) => ReactNode;
  onRemoteChanges?(entry: ChangeFeedEntry): void;
  pageSize?: number;
  testId?: string;
  /** Persist saved views in localStorage under this key (per-viewer convenience). */
  persistViewsKey?: string;
}

function loadViews(key: string | undefined): ViewDef[] | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) && parsed.length > 0
      ? (parsed as ViewDef[])
      : null;
  } catch {
    return null;
  }
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
  const access = useMemo(
    () => resolveColumnAccess(schema, resolver, user),
    [schema, user],
  );

  const [views, setViews] = useState<ViewDef[]>(
    () => loadViews(persistViewsKey) ?? initialViews ?? [ALL_ROWS_VIEW],
  );
  useEffect(() => {
    if (!persistViewsKey) return;
    try {
      localStorage.setItem(persistViewsKey, JSON.stringify(views));
    } catch {
      // Storage unavailable (private window, blocked): views stay in memory.
    }
  }, [persistViewsKey, views]);
  const [activeViewId, setActiveViewId] = useState<string | null>(
    views[0]?.id ?? null,
  );
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const [liveView, setLiveView] = useState<ViewDef | null>(activeView);
  const [filter, setFilter] = useState<FilterNode | null>(
    activeView?.filter ?? null,
  );
  const [groupBy, setGroupBy] = useState<GroupSpec[]>(
    activeView?.groupBy ?? [],
  );
  const [clipboard, setClipboard] = useState<ClipboardReport | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editColumn, setEditColumn] = useState<ColumnDef | null>(null);
  const [feedCount, setFeedCount] = useState(0);
  const [saved, setSaved] = useState(0);
  const prompt = useMantineConflictPrompt();

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

  const commitSchema = async (next: GridSchema) => {
    const persisted = onSchemaChange ? await onSchemaChange(next) : next;
    setSchema(persisted);
  };

  const saveColumn = async (column: ColumnDef) => {
    const exists = schema.columns.some((c) => c.id === column.id);
    const columns = exists
      ? schema.columns.map((c) => (c.id === column.id ? column : c))
      : [...schema.columns, { ...column, order: schema.columns.length }];
    await commitSchema({
      ...schema,
      schemaVersion: schema.schemaVersion + 1,
      columns,
    });
    setBuilderOpen(false);
    setEditColumn(null);
  };

  const deleteColumn = async (columnId: string) => {
    await commitSchema({
      ...schema,
      schemaVersion: schema.schemaVersion + 1,
      columns: schema.columns.filter((c) => c.id !== columnId),
    });
    setBuilderOpen(false);
    setEditColumn(null);
  };

  const events = useMemo(
    () => ({
      onConflict: prompt.onConflict,
      onCellsChange: () => setSaved((n) => n + 1),
      onOptionCreate: (
        columnId: string,
        option: { id: string; label: string },
      ) => {
        setSchema((s) => ({
          ...s,
          schemaVersion: s.schemaVersion + 1,
          columns: s.columns.map((c) => {
            if (c.id !== columnId) return c;
            const cfg = (c.config ?? {}) as {
              options?: { id: string; label: string }[];
            };
            const options = cfg.options ?? [];
            return options.some((o) => o.id === option.id)
              ? c
              : { ...c, config: { ...cfg, options: [...options, option] } };
          }),
        }));
      },
      onRemoteChanges: (entry: ChangeFeedEntry<GridRow>) => {
        if (entry.rows.length > 0 || entry.deletedRowIds.length > 0)
          setFeedCount((n) => n + 1);
        onRemoteChanges?.(entry);
      },
    }),
    [prompt.onConflict, onRemoteChanges],
  );

  const conflict = prompt.conflict;
  const conflictColumn = conflict
    ? schema.columns.find((c) => c.id === conflict.columnId)
    : undefined;

  return (
    <Stack gap="xs" data-testid={testId}>
      <Group gap="xs" wrap="wrap">
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
            const captured =
              handleRef.current?.captureView() ?? liveView ?? ALL_ROWS_VIEW;
            const view: ViewDef = {
              ...captured,
              id: `view_${Date.now().toString(36)}`,
              name,
            };
            setViews((vs) => [...vs, view]);
            setActiveViewId(view.id);
            setLiveView(view);
          }}
          onRename={(id, name) =>
            setViews((vs) => vs.map((v) => (v.id === id ? { ...v, name } : v)))
          }
          onDelete={(id) => {
            setViews((vs) => vs.filter((v) => v.id !== id));
            if (id === activeViewId) setActiveViewId(null);
          }}
          onSaveCurrent={() => {
            const captured = handleRef.current?.captureView();
            if (!captured || !activeViewId) return;
            setViews((vs) =>
              vs.map((v) =>
                v.id === activeViewId
                  ? { ...captured, id: v.id, name: v.name }
                  : v,
              ),
            );
          }}
        />
        <FilterButton
          schema={schema}
          registry={registry}
          uiRegistry={uiRegistry}
          access={access}
          value={filter}
          onChange={applyFilter}
          dataSource={dataSource}
        />
        <GroupByBar
          schema={schema}
          registry={registry}
          access={access}
          value={groupBy}
          onChange={applyGroupBy}
        />
        <Button
          variant="default"
          onClick={() => {
            setEditColumn(null);
            setBuilderOpen(true);
          }}
        >
          Add column
        </Button>
        <Button
          variant="default"
          onClick={() => void handleRef.current?.undo()}
        >
          Undo
        </Button>
        <Button
          variant="default"
          onClick={() => void handleRef.current?.redo()}
        >
          Redo
        </Button>
        <Button
          variant="default"
          onClick={() => handleRef.current?.exportCsv("schema-grid.csv")}
        >
          Export CSV
        </Button>
        {toolbar?.(handleRef.current)}
      </Group>
      <FilterChips
        schema={schema}
        registry={registry}
        value={filter}
        onChange={applyFilter}
        access={access}
      />
      <Box pos="relative">
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
          gridOptions={GRID_OPTIONS}
          {...(pageSize ? { pageSize } : {})}
          onClipboardReport={(report) => {
            setClipboard(report);
            void notifyClipboardReport(report);
          }}
        />
        {conflict && conflictColumn ? (
          <ConflictAnchor rowId={conflict.rowId} columnId={conflict.columnId}>
            {(size) => (
              <ConflictPopover
                conflict={conflict}
                column={conflictColumn}
                registry={registry}
                uiRegistry={uiRegistry}
                opened={prompt.opened}
                onResolve={prompt.resolve}
                onClose={prompt.dismiss}
              >
                <Box
                  data-testid="conflict-anchor"
                  w={size.width}
                  h={size.height}
                />
              </ConflictPopover>
            )}
          </ConflictAnchor>
        ) : null}
      </Box>
      <Group gap="md">
        <Text size="xs" c="dimmed">
          Saved batches: <span data-testid="saved-count">{saved}</span>
        </Text>
        <Text size="xs" c="dimmed">
          Remote feed updates: <span data-testid="feed-count">{feedCount}</span>
        </Text>
        {prompt.pendingCount > 0 ? (
          <Badge color="red">{prompt.pendingCount} conflict(s)</Badge>
        ) : null}
        <Text size="xs" c="dimmed">
          Clipboard report:{" "}
          <Code data-testid="clipboard-report">
            {clipboard ? JSON.stringify(clipboard) : "none"}
          </Code>
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        Filter AST:{" "}
        <Code data-testid="filter-ast">{JSON.stringify(filter)}</Code>
      </Text>
      <ColumnBuilderModal
        opened={builderOpen}
        onClose={() => setBuilderOpen(false)}
        schema={schema}
        registry={registry}
        uiRegistry={uiRegistry}
        access={access}
        roles={["admin", "counsellor", "viewer"]}
        column={editColumn}
        onSave={(c) => void saveColumn(c)}
        onDelete={(id) => void deleteColumn(id)}
        dataSource={dataSource}
      />
    </Stack>
  );
}

/** Positions its children over a grid cell (by row id + column id), for the conflict popover. */
function ConflictAnchor({
  rowId,
  columnId,
  children,
}: {
  rowId: string;
  columnId: string;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const host = ref.current?.parentElement;
      const cell = host?.querySelector<HTMLElement>(
        `.ag-row[row-id="${CSS.escape(rowId)}"] .ag-cell[col-id="${CSS.escape(columnId)}"]`,
      );
      if (host && cell) {
        const h = host.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        setRect((prev) => {
          const next = {
            top: c.top - h.top,
            left: c.left - h.left,
            width: c.width,
            height: c.height,
          };
          return prev && JSON.stringify(prev) === JSON.stringify(next)
            ? prev
            : next;
        });
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [rowId, columnId]);
  return (
    <div
      ref={ref}
      className="sg-conflict-layer"
      style={{
        position: "absolute",
        zIndex: 20,
        pointerEvents: "none",
        ...(rect ?? { top: 0, left: 0, width: 0, height: 0 }),
      }}
    >
      <style>
        {
          ".sg-conflict-layer .mantine-Popover-dropdown { pointer-events: auto; } .sg-conflict-layer > span { display: block !important; }"
        }
      </style>
      {children({ width: rect?.width ?? 0, height: rect?.height ?? 0 })}
    </div>
  );
}
