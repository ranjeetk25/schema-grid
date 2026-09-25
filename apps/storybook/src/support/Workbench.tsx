/**
 * A full host around `<SchemaGrid>`, laid out like a real app screen:
 *
 * - header bar: title + description, role switcher (segmented control);
 * - toolbar: view switcher, filter (count badge), group-by and any story
 *   extras on the left; undo / redo / export icon cluster and the single
 *   primary action ("Add column") on the right;
 * - applied-filter chips (only when a filter is applied);
 * - the grid, filling the remaining viewport height;
 * - a quiet status bar with the counters Playwright reads.
 *
 * The Mantine conflict prompt is anchored over the conflicting cell.
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  SegmentedControl,
  Text,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
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
  ColumnPanel,
  ConflictPopover,
  FilterButton,
  FilterChips,
  GroupByBar,
  MantineHeaderMenu,
  ViewSwitcher,
  notifyClipboardReport,
  useMantineConflictPrompt,
} from "@ranjeetk25/schema-grid-ui-mantine";
import { createMantineUiRegistry } from "@ranjeetk25/schema-grid-ui-mantine/editors";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconDownload,
  IconPlus,
  IconTable,
} from "@tabler/icons-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { USERS, type UserKey, registry, resolver } from "./data";

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

const ICON = { size: 16, stroke: 1.75 } as const;

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const UNDO_KEYS = IS_MAC ? "⌘Z" : "Ctrl+Z";
const REDO_KEYS = IS_MAC ? "⌘⇧Z" : "Ctrl+Shift+Z";

const ROLE_OPTIONS: { value: UserKey; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "counsellor", label: "Counsellor" },
  { value: "viewer", label: "Viewer" },
];

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
  /** Header title. Default "Admissions". */
  title?: string;
  /** One muted line under the title. */
  description?: string;
  /** Show the Admin / Counsellor / Viewer switcher (the grid re-resolves access). Default true. */
  roleSwitcher?: boolean;
  /**
   * Controlled role: when given, the switcher only reports changes and the
   * host swaps `user` (e.g. to refetch a role-scoped schema).
   */
  onRoleChange?(role: UserKey): void;
  /** Persists a schema change (column builder / created option). Default: accept as-is. */
  onSchemaChange?(next: GridSchema): Promise<GridSchema> | GridSchema;
  poll?: SchemaGridPollOptions;
  /** Fixed grid height in px. Default: fill the viewport. */
  height?: number;
  initialViews?: ViewDef[];
  /** Extra toolbar content (left cluster, after group-by). */
  toolbar?: (handle: SchemaGridHandle | null) => ReactNode;
  onRemoteChanges?(entry: ChangeFeedEntry): void;
  pageSize?: number;
  testId?: string;
  /** Persist saved views in localStorage under this key (per-viewer convenience). */
  persistViewsKey?: string;
  /** Extra status-bar entries (null/empty entries are hidden). */
  status?: (ReactNode | null)[];
  /** Receives the grid handle (e.g. for a story's own export logic). */
  onHandle?(handle: SchemaGridHandle | null): void;
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

function roleOf(user: PermissionUser): UserKey {
  const found = (Object.keys(USERS) as UserKey[]).find(
    (k) => USERS[k].id === user.id,
  );
  return found ?? "admin";
}

/** "3 pasted, 1 skipped, 1 error" — the human side of a clipboard report. */
function clipboardSummary(r: ClipboardReport): string {
  const parts = [`${r.pastedCells} pasted`];
  if (r.skippedReadOnly) parts.push(`${r.skippedReadOnly} skipped`);
  if (r.conflicts)
    parts.push(`${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"}`);
  const errors = r.errors.length;
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  return `Paste: ${parts.join(", ")}`;
}

/** Dot-separated muted entries; empty entries are dropped, nothing at all reads "No changes yet". */
function StatusItems({ items }: { items: (ReactNode | null)[] }) {
  const shown = items.filter((i) => i !== null && i !== undefined && i !== "");
  if (shown.length === 0) return <span>No changes yet</span>;
  return (
    <>
      {shown.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable list.
        <span key={i} style={{ whiteSpace: "nowrap" }}>
          {i > 0 ? <span aria-hidden> · </span> : null}
          {item}
        </span>
      ))}
    </>
  );
}

/** Tooltip body: label + one muted shortcut string (no key chips). */
function Hint({ label, keys }: { label: string; keys?: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline" }}>
      <span>{label}</span>
      {keys ? (
        <span
          aria-hidden
          style={{
            fontFamily: "var(--mantine-font-family-monospace)",
            fontSize: 11,
            opacity: 0.6,
            letterSpacing: "0.04em",
          }}
        >
          {keys}
        </span>
      ) : null}
    </span>
  );
}

export function Workbench({
  dataSource,
  schema: initialSchema,
  user: initialUser,
  mode = "client",
  title = "Admissions",
  description,
  roleSwitcher = true,
  onRoleChange,
  onSchemaChange,
  poll,
  height,
  initialViews,
  toolbar,
  onRemoteChanges,
  pageSize,
  testId = "workbench",
  persistViewsKey,
  status: extraStatus,
  onHandle,
}: WorkbenchProps) {
  const [schema, setSchema] = useState(initialSchema);
  useEffect(() => setSchema(initialSchema), [initialSchema]);
  const [role, setRole] = useState<UserKey>(() => roleOf(initialUser));
  useEffect(() => setRole(roleOf(initialUser)), [initialUser]);
  const user =
    onRoleChange || role === roleOf(initialUser)
      ? initialUser
      : (USERS[role] ?? initialUser);

  const handleRef = useRef<SchemaGridHandle | null>(null);
  const [, forceRender] = useState(0);
  const onHandleRef = useRef(onHandle);
  onHandleRef.current = onHandle;
  const setHandle = useCallback((h: SchemaGridHandle | null) => {
    if (handleRef.current === h) return;
    handleRef.current = h;
    onHandleRef.current?.(h);
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
  /** Where a new column goes (header menu "Insert left/right"); null = at the end. */
  const [insertAt, setInsertAt] = useState<{
    columnId: string;
    side: "left" | "right";
  } | null>(null);
  const [feedCount, setFeedCount] = useState(0);
  const [saved, setSaved] = useState(0);
  const prompt = useMantineConflictPrompt();
  // Undo availability is read from the handle; `bump` re-reads it after edits / undo / redo.
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);
  const canUndo = handleRef.current?.canUndo() ?? false;
  const canRedo = handleRef.current?.canRedo() ?? false;

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
    let columns: ColumnDef[];
    if (exists) {
      columns = schema.columns.map((c) => (c.id === column.id ? column : c));
    } else if (insertAt) {
      // Re-number orders so the new column lands beside its anchor.
      const sorted = [...schema.columns].sort((a, b) => a.order - b.order);
      const at = sorted.findIndex((c) => c.id === insertAt.columnId);
      const index =
        at < 0 ? sorted.length : insertAt.side === "left" ? at : at + 1;
      sorted.splice(index, 0, column);
      columns = sorted.map((c, order) => ({ ...c, order }));
    } else {
      columns = [
        ...schema.columns,
        { ...column, order: schema.columns.length },
      ];
    }
    await commitSchema({
      ...schema,
      schemaVersion: schema.schemaVersion + 1,
      columns,
    });
    setBuilderOpen(false);
    setEditColumn(null);
    setInsertAt(null);
  };

  /** The panel's live draft (ghost column preview in the grid). */
  const [draft, setDraft] = useState<ColumnDef | null>(null);
  /** First rows on screen, for the formula preview. */
  const [sampleRows, setSampleRows] = useState<GridRow[]>([]);
  const openBuilder = useCallback(
    (column: ColumnDef | null, at: typeof insertAt = null) => {
      const api = handleRef.current?.api();
      const rows: GridRow[] = [];
      for (let i = 0; api && i < 3; i++) {
        const data = api.getDisplayedRowAtIndex(i)?.data as GridRow | undefined;
        if (data && "cells" in data) rows.push(data);
      }
      setSampleRows(rows);
      setEditColumn(column);
      setInsertAt(at);
      setBuilderOpen(true);
    },
    [],
  );
  const onEditColumn = useCallback(
    (colId: string) =>
      openBuilder(schema.columns.find((c) => c.id === colId) ?? null),
    [schema, openBuilder],
  );
  const onInsertColumn = useCallback(
    (colId: string, side: "left" | "right") =>
      openBuilder(null, { columnId: colId, side }),
    [openBuilder],
  );
  const onAddColumn = useCallback(() => openBuilder(null), [openBuilder]);
  const draftColumn = useMemo(
    () =>
      draft && builderOpen
        ? {
            column: draft,
            mode: editColumn ? ("edit" as const) : ("create" as const),
            ...(insertAt
              ? {
                  insertAt:
                    insertAt.side === "left"
                      ? { beforeColumnId: insertAt.columnId }
                      : { afterColumnId: insertAt.columnId },
                }
              : {}),
          }
        : null,
    [draft, builderOpen, editColumn, insertAt],
  );
  const groupByRef = useRef(groupBy);
  groupByRef.current = groupBy;
  const onGroupByColumn = useCallback((colId: string) => {
    const current = groupByRef.current;
    if (current.some((g) => g.columnId === colId)) return;
    const next = [...current, { columnId: colId }];
    setGroupBy(next);
    handleRef.current?.stores.query.setGroupBy(next);
  }, []);

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
      onCellsChange: () => {
        setSaved((n) => n + 1);
        bump();
      },
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
    [prompt.onConflict, onRemoteChanges, bump],
  );

  const conflict = prompt.conflict;
  const conflictColumn = conflict
    ? schema.columns.find((c) => c.id === conflict.columnId)
    : undefined;
  const hasFilter = filter !== null;

  return (
    <Box
      data-testid={testId}
      style={{
        display: "flex",
        flexDirection: "column",
        height: height === undefined ? "100dvh" : "auto",
        background: "var(--mantine-color-body)",
        color: "var(--mantine-color-text)",
        // The column panel docks on the right; the grid makes room instead of hiding under it.
        paddingRight: builderOpen ? 420 : 0,
        transition: "padding-right 160ms ease-out",
      }}
    >
      {/* Header bar: one title, the role switcher. */}
      <Group
        justify="space-between"
        wrap="nowrap"
        px="md"
        h={52}
        style={{
          flex: "none",
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <Group gap={10} wrap="nowrap" miw={0}>
          <Box
            aria-hidden
            style={{
              display: "grid",
              placeItems: "center",
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "var(--mantine-primary-color-light)",
              color: "var(--mantine-primary-color-light-color)",
            }}
          >
            <IconTable size={16} stroke={1.75} />
          </Box>
          <Text fw={600} fz="sm" truncate>
            {title}
          </Text>
          {description ? (
            <Text fz="sm" c="dimmed" truncate visibleFrom="sm">
              {description}
            </Text>
          ) : null}
        </Group>
        {roleSwitcher ? (
          <Group gap={8} wrap="nowrap">
            <Text fz="xs" c="dimmed" visibleFrom="sm">
              Viewing as
            </Text>
            <SegmentedControl
              aria-label="Role"
              size="xs"
              value={role}
              onChange={(v) => {
                if (onRoleChange) onRoleChange(v as UserKey);
                else setRole(v as UserKey);
              }}
              data={ROLE_OPTIONS}
            />
          </Group>
        ) : null}
      </Group>

      {/* Toolbar: views / filter / group on the left, actions on the right. */}
      <Group
        justify="space-between"
        wrap="nowrap"
        gap="xs"
        px="md"
        py={8}
        style={{ flex: "none" }}
      >
        <Group gap={6} wrap="wrap" miw={0}>
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
              setViews((vs) =>
                vs.map((v) => (v.id === id ? { ...v, name } : v)),
              )
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
          <Divider orientation="vertical" my={6} />
          <FilterButton
            mode={mode}
            rowCount={handleRef.current?.api()?.getDisplayedRowCount() ?? 0}
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
          {toolbar?.(handleRef.current)}
        </Group>
        <Group gap={6} wrap="nowrap" style={{ flex: "none" }}>
          <Tooltip label={<Hint label="Undo" keys={UNDO_KEYS} />}>
            <ActionIcon
              aria-label="Undo"
              aria-disabled={!canUndo}
              style={{ opacity: canUndo ? 1 : 0.4 }}
              onClick={() => void handleRef.current?.undo().then(bump)}
            >
              <IconArrowBackUp {...ICON} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={<Hint label="Redo" keys={REDO_KEYS} />}>
            <ActionIcon
              aria-label="Redo"
              aria-disabled={!canRedo}
              style={{ opacity: canRedo ? 1 : 0.4 }}
              onClick={() => void handleRef.current?.redo().then(bump)}
            >
              <IconArrowForwardUp {...ICON} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Export CSV">
            <ActionIcon
              aria-label="Export CSV"
              onClick={() => handleRef.current?.exportCsv("schema-grid.csv")}
            >
              <IconDownload {...ICON} />
            </ActionIcon>
          </Tooltip>
          <Divider orientation="vertical" my={6} mx={2} />
          <Button
            leftSection={<IconPlus size={14} stroke={2} />}
            onClick={() => openBuilder(null)}
          >
            Add column
          </Button>
        </Group>
      </Group>

      {hasFilter ? (
        <Box px="md" pb={8} style={{ flex: "none" }}>
          <FilterChips
            schema={schema}
            registry={registry}
            value={filter}
            onChange={applyFilter}
            access={access}
          />
        </Box>
      ) : null}

      <Box
        px="md"
        style={{
          position: "relative",
          flex: height === undefined ? "1 1 auto" : "none",
          minHeight: 0,
          height: height,
        }}
      >
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
          height="100%"
          poll={poll}
          gridOptions={GRID_OPTIONS}
          headerMenu={MantineHeaderMenu}
          onEditColumn={onEditColumn}
          onAddColumn={onAddColumn}
          draftColumn={draftColumn}
          onInsertColumn={onInsertColumn}
          onGroupByColumn={onGroupByColumn}
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

      {/* Status bar: only what has happened. Raw values for Playwright live in hidden test-id spans. */}
      <Group
        gap={6}
        px="md"
        wrap="nowrap"
        h={30}
        style={{
          flex: "none",
          marginTop: 8,
          borderTop: "1px solid var(--mantine-color-default-border)",
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          fontSize: 12,
          color: "var(--mantine-color-dimmed)",
        }}
      >
        <StatusItems
          items={[
            saved > 0 ? `${saved} saved` : null,
            feedCount > 0
              ? `${feedCount} remote update${feedCount === 1 ? "" : "s"}`
              : null,
            clipboard ? clipboardSummary(clipboard) : null,
            ...(extraStatus ?? []),
          ]}
        />
        {prompt.pendingCount > 0 ? (
          <Badge color="red" variant="light" size="sm">
            {prompt.pendingCount} conflict(s)
          </Badge>
        ) : null}
        <VisuallyHidden>
          <span data-testid="saved-count">{saved}</span>
          <span data-testid="feed-count">{feedCount}</span>
          <span data-testid="clipboard-report">
            {clipboard ? JSON.stringify(clipboard) : "none"}
          </span>
          <span data-testid="filter-ast">{JSON.stringify(filter)}</span>
        </VisuallyHidden>
      </Group>

      <ColumnPanel
        opened={builderOpen}
        onClose={() => {
          setBuilderOpen(false);
          setInsertAt(null);
        }}
        schema={schema}
        registry={registry}
        uiRegistry={uiRegistry}
        access={access}
        roles={["admin", "counsellor", "viewer"]}
        column={editColumn}
        {...(insertAt
          ? {
              position:
                insertAt.side === "left"
                  ? { beforeColumnId: insertAt.columnId }
                  : { afterColumnId: insertAt.columnId },
            }
          : {})}
        sampleRows={sampleRows}
        onDraftChange={setDraft}
        onSave={(c) => void saveColumn(c)}
        onDelete={(id) => void deleteColumn(id)}
        dataSource={dataSource}
      />
    </Box>
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
