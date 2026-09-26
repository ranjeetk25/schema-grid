/**
 * `<SchemaGridWorkbench>`: a whole admin grid page in one component.
 *
 * - header bar: title + subtitle, the signed-in user;
 * - toolbar: view switcher, filter (count badge), group, search and
 *   `toolbarStart` on the left; `toolbarEnd`, undo / redo, import, export and
 *   the single primary action ("Add column") on the right;
 * - applied-filter chips, inline banners (read-only, permission, network,
 *   capability, schema changed) with retry / reload;
 * - the grid (conflict prompt anchored over the cell, ghost column preview,
 *   polling with remote-change flashes);
 * - a quiet status bar ("No changes yet" when idle).
 *
 * Every feature is derived from the data source's capabilities; `features`
 * can only switch things off.
 *
 * v0.3: a "Columns" show / hide picker in the toolbar, host `events` merged
 * with the workbench's own, "Add column" and the column panel only when the
 * source reports `schema.write`, an export banner with Retry, and the import
 * wizard / export dialog / column panel loaded lazily on first open.
 */
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  CloseButton,
  Divider,
  Group,
  Loader,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
} from "@mantine/core";
import { SchemaGrid } from "@ranjeetk25/schema-grid-ag-grid";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconDownload,
  IconInfoCircle,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTable,
  IconUpload,
  IconWifiOff,
} from "@tabler/icons-react";
import { type CSSProperties, type ReactNode, Suspense, createContext, lazy, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ConflictPopover, initialsOf } from "../conflict/ConflictPopover";
import { useMantineConflictPrompt } from "../conflict/useMantineConflictPrompt";
import { createMantineUiRegistry } from "../editors";
import { FilterButton } from "../filter-builder/FilterButton";
import { FilterChips } from "../filter-builder/FilterChips";
import { MantineHeaderMenu } from "../header-menu";
import { notifyClipboardReport } from "../notifications/notifyClipboardReport";
import { GroupByBar } from "../views/GroupByBar";
import { ViewSwitcher } from "../views/ViewSwitcher";
import { ColumnsButton } from "./ColumnsButton";
import type { SchemaGridWorkbenchProps } from "./types";
import { type WorkbenchBanner, renderSlot, useWorkbench } from "./useWorkbench";

// Heavy surfaces load on first open (their chunks, and io's exceljs / papaparse behind them, stay out of the page chunk).
const ColumnPanel = lazy(() => import("../column-builder/ColumnPanel").then((m) => ({ default: m.ColumnPanel })));
const ImportWizard = lazy(() => import("../import-export/ImportWizard").then((m) => ({ default: m.ImportWizard })));
const ExportDialog = lazy(() => import("../import-export/ExportDialog").then((m) => ({ default: m.ExportDialog })));

/** True once `opened` has been true (keeps a lazily mounted surface mounted afterwards so its state survives). */
function useEverOpened(opened: boolean): boolean {
  const [ever, setEver] = useState(opened);
  useEffect(() => {
    if (opened) setEver(true);
  }, [opened]);
  return ever || opened;
}

const ICON = { size: 16, stroke: 1.75 } as const;
const PANEL_WIDTH = 420;

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const UNDO_KEYS = IS_MAC ? "⌘Z" : "Ctrl+Z";
const REDO_KEYS = IS_MAC ? "⌘⇧Z" : "Ctrl+Shift+Z";

/** Every column stays in the DOM so tests (and screenshots) can reach any cell. */
const DEFAULT_GRID_OPTIONS = { suppressColumnVirtualisation: true } as const;

/** Tooltip body: label + one muted shortcut string (no key chips). */
function Hint({ label, keys }: { label: string; keys?: string }) {
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline" }}>
      <span>{label}</span>
      {keys ? (
        <span
          aria-hidden
          style={{ fontFamily: "var(--mantine-font-family-monospace)", fontSize: 11, opacity: 0.6, letterSpacing: "0.04em" }}
        >
          {keys}
        </span>
      ) : null}
    </span>
  );
}

function IconAction({
  label,
  keys,
  disabled,
  onClick,
  children,
}: {
  label: string;
  keys?: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip label={<Hint label={label} keys={keys} />}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        aria-label={label}
        aria-disabled={disabled || undefined}
        style={{ opacity: disabled ? 0.4 : 1 }}
        onClick={() => {
          if (!disabled) onClick();
        }}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

const BANNER_TONE: Record<WorkbenchBanner["kind"], { bg: string; fg: string; icon: ReactNode; role: "alert" | "status" }> = {
  network: {
    bg: "var(--mantine-color-red-light)",
    fg: "var(--mantine-color-red-light-color)",
    icon: <IconWifiOff {...ICON} />,
    role: "alert",
  },
  "permission-denied": {
    bg: "var(--mantine-color-red-light)",
    fg: "var(--mantine-color-red-light-color)",
    icon: <IconLock {...ICON} />,
    role: "alert",
  },
  "capability-denied": {
    bg: "var(--mantine-color-default-hover)",
    fg: "var(--mantine-color-text)",
    icon: <IconAlertTriangle {...ICON} />,
    role: "status",
  },
  "schema-changed": {
    bg: "var(--mantine-primary-color-light)",
    fg: "var(--mantine-primary-color-light-color)",
    icon: <IconRefresh {...ICON} />,
    role: "status",
  },
  "read-only": {
    bg: "var(--mantine-color-default-hover)",
    fg: "var(--mantine-color-dimmed)",
    icon: <IconLock {...ICON} />,
    role: "status",
  },
  export: {
    bg: "var(--mantine-color-red-light)",
    fg: "var(--mantine-color-red-light-color)",
    icon: <IconAlertTriangle {...ICON} />,
    role: "alert",
  },
  unknown: {
    bg: "var(--mantine-color-default-hover)",
    fg: "var(--mantine-color-text)",
    icon: <IconInfoCircle {...ICON} />,
    role: "status",
  },
};

function Banner({ banner }: { banner: WorkbenchBanner }) {
  const tone = BANNER_TONE[banner.kind];
  return (
    <Group
      role={tone.role}
      data-testid={`workbench-banner-${banner.kind}`}
      gap={8}
      wrap="nowrap"
      h={36}
      pl={12}
      pr={4}
      style={{ borderRadius: 6, background: tone.bg, color: tone.fg, fontSize: 13 }}
    >
      <Box aria-hidden style={{ display: "flex", flex: "none" }}>
        {tone.icon}
      </Box>
      <Text fz={13} c="inherit" truncate style={{ flex: 1, minWidth: 0 }}>
        {banner.message}
      </Text>
      {banner.action ? (
        <Button size="xs" variant="subtle" color="gray" c="inherit" onClick={banner.action.run}>
          {banner.action.label}
        </Button>
      ) : null}
      <CloseButton size="sm" c="inherit" aria-label="Dismiss" onClick={banner.dismiss} />
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Empty state (AG Grid's no-rows overlay; rendered inside our React tree)
// ---------------------------------------------------------------------------

interface EmptyContextValue {
  emptyState: ReactNode;
  filtered: boolean;
  /** A load failure is shown as a banner: no "empty" copy under it. */
  blocked: boolean;
  clear(): void;
}
const EmptyContext = createContext<EmptyContextValue | null>(null);

function EmptyOverlay() {
  const ctx = useContext(EmptyContext);
  if (!ctx || ctx.blocked) return null;
  if (ctx.emptyState !== undefined && ctx.emptyState !== null) {
    return <Box style={{ pointerEvents: "auto" }}>{ctx.emptyState}</Box>;
  }
  return (
    <Box data-testid="workbench-empty" ta="center" style={{ pointerEvents: "auto" }}>
      <Text fw={500} fz="sm">
        {ctx.filtered ? "No rows match" : "No rows yet"}
      </Text>
      <Text fz="xs" c="dimmed" mt={4}>
        {ctx.filtered ? "Try a different filter or search." : "Rows you add or import show up here."}
      </Text>
      {ctx.filtered ? (
        <Button size="xs" variant="default" mt={12} onClick={ctx.clear}>
          Clear filters
        </Button>
      ) : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SchemaGridWorkbench(props: SchemaGridWorkbenchProps) {
  const prompt = useMantineConflictPrompt();
  const wb = useWorkbench({ props, onConflict: prompt.onConflict });
  const { schema, features, slotContext } = wb;
  const { title, subtitle, height = "fill", emptyState, testId = "workbench" } = props;
  const uiRegistry = useMemo(
    () => props.uiRegistry ?? createMantineUiRegistry({ fieldTypes: wb.registry }),
    [props.uiRegistry, wb.registry],
  );

  const filtered = wb.filter !== null || wb.search.trim() !== "";
  const blocked = wb.banners.some((b) => b.kind === "network" || b.kind === "permission-denied");
  const emptyValue = useMemo<EmptyContextValue>(
    () => ({
      emptyState,
      filtered,
      blocked,
      clear: () => {
        wb.applyFilter(null);
        wb.setSearch("");
      },
    }),
    // wb.applyFilter / wb.setSearch are stable callbacks.
    [emptyState, filtered, blocked, wb.applyFilter, wb.setSearch],
  );

  const gridOptions = useMemo(
    () => ({
      ...DEFAULT_GRID_OPTIONS,
      noRowsOverlayComponent: EmptyOverlay,
      ...(props.gridProps?.gridOptions ?? {}),
    }),
    [props.gridProps?.gridOptions],
  );

  const conflict = prompt.conflict;
  const conflictColumn = conflict && schema ? schema.columns.find((c) => c.id === conflict.columnId) : undefined;
  const panelEver = useEverOpened(wb.panel.opened);
  const importEver = useEverOpened(wb.importDialog.opened);
  const exportEver = useEverOpened(wb.exportDialog.opened);
  const fill = height === "fill";
  const rootStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: fill ? "100%" : typeof height === "number" ? "auto" : height,
    minHeight: 0,
    background: "var(--mantine-color-body)",
    color: "var(--mantine-color-text)",
    // The column panel docks on the right; the grid makes room instead of hiding under it.
    paddingRight: wb.panel.opened ? PANEL_WIDTH : 0,
    transition: "padding-right 160ms ease-out",
  };
  const hasHeader = title !== undefined || subtitle !== undefined;
  const userLabel = (props.user as { name?: string }).name ?? props.user.id;

  return (
    <EmptyContext.Provider value={emptyValue}>
      <Box data-testid={testId} className="sg-workbench" data-blocked={blocked || undefined} style={rootStyle}>
        {/* The banner already says it: hide the grid's own inline load error under it. */}
        <style>{".sg-workbench[data-blocked] .sg-load-error { display: none; }"}</style>
        {hasHeader ? (
          <Group
            justify="space-between"
            wrap="nowrap"
            px="md"
            h={52}
            style={{ flex: "none", borderBottom: "1px solid var(--mantine-color-default-border)" }}
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
                  flex: "none",
                }}
              >
                <IconTable {...ICON} />
              </Box>
              {title !== undefined ? (
                <Text fw={600} fz="sm" truncate component="h1" m={0}>
                  {title}
                </Text>
              ) : null}
              {subtitle !== undefined ? (
                <Text fz="sm" c="dimmed" truncate visibleFrom="sm">
                  {subtitle}
                </Text>
              ) : null}
            </Group>
            <Tooltip label={`Signed in as ${userLabel} · ${props.user.roles.join(", ") || "no roles"}`}>
              <Avatar size={26} radius="xl" color="gray" variant="light" aria-label={`Signed in as ${userLabel}`}>
                <Text fz={11} fw={500}>
                  {initialsOf(userLabel)}
                </Text>
              </Avatar>
            </Tooltip>
          </Group>
        ) : null}

        {schema && slotContext ? (
          <Group justify="space-between" wrap="nowrap" gap="xs" px="md" py={8} style={{ flex: "none" }}>
            <Group gap={6} wrap="wrap" miw={0}>
              {features.views ? (
                <>
                  <ViewSwitcher
                    views={wb.views}
                    activeViewId={wb.activeViewId}
                    dirty={wb.viewDirty}
                    onSelect={wb.viewActions.select}
                    onCreate={wb.viewActions.create}
                    onRename={wb.viewActions.rename}
                    onDelete={wb.viewActions.remove}
                    onSaveCurrent={wb.viewActions.saveCurrent}
                  />
                  <Divider orientation="vertical" my={6} />
                </>
              ) : null}
              {features.filter ? (
                <FilterButton
                  mode={wb.mode}
                  rowCount={wb.handle?.api()?.getDisplayedRowCount() ?? 0}
                  schema={wb.effectiveSchema ?? schema}
                  registry={wb.registry}
                  uiRegistry={uiRegistry}
                  access={wb.access}
                  value={wb.filter}
                  onChange={wb.applyFilter}
                  dataSource={wb.dataSource}
                />
              ) : null}
              {features.group ? (
                <GroupByBar
                  schema={wb.effectiveSchema ?? schema}
                  registry={wb.registry}
                  access={wb.access}
                  value={wb.groupBy}
                  onChange={wb.applyGroupBy}
                />
              ) : null}
              {features.search ? (
                <TextInput
                  type="search"
                  aria-label="Search rows"
                  placeholder="Search"
                  size="sm"
                  w={200}
                  value={wb.search}
                  onChange={(e) => wb.setSearch(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && wb.search) {
                      e.stopPropagation();
                      wb.setSearch("");
                    }
                  }}
                  leftSection={<IconSearch size={14} stroke={1.75} />}
                  rightSection={
                    wb.search ? <CloseButton size="sm" aria-label="Clear search" onClick={() => wb.setSearch("")} /> : null
                  }
                />
              ) : null}
              {renderSlot(props.toolbarStart, slotContext)}
            </Group>
            <Group gap={6} wrap="nowrap" style={{ flex: "none" }}>
              {renderSlot(props.toolbarEnd, slotContext)}
              <ColumnsButton items={wb.columns.items} onChange={wb.columns.apply} />
              {features.undo ? (
                <>
                  <IconAction label="Undo" keys={UNDO_KEYS} disabled={!wb.canUndo} onClick={wb.undo}>
                    <IconArrowBackUp {...ICON} />
                  </IconAction>
                  <IconAction label="Redo" keys={REDO_KEYS} disabled={!wb.canRedo} onClick={wb.redo}>
                    <IconArrowForwardUp {...ICON} />
                  </IconAction>
                </>
              ) : null}
              {features.import ? (
                <IconAction label="Import…" onClick={wb.importDialog.open}>
                  <IconUpload {...ICON} />
                </IconAction>
              ) : null}
              {features.export ? (
                <IconAction label="Export CSV" onClick={() => void wb.exportCsv()}>
                  <IconDownload {...ICON} />
                </IconAction>
              ) : null}
              {features.addColumn ? (
                <>
                  <Divider orientation="vertical" my={6} mx={2} />
                  <Button leftSection={<IconPlus size={14} stroke={2} />} onClick={wb.onAddColumn}>
                    Add column
                  </Button>
                </>
              ) : null}
            </Group>
          </Group>
        ) : null}

        {schema && features.filter && wb.filter !== null ? (
          <Box px="md" pb={8} style={{ flex: "none" }}>
            <FilterChips
              schema={wb.effectiveSchema ?? schema}
              registry={wb.registry}
              value={wb.filter}
              onChange={wb.applyFilter}
              access={wb.access}
            />
          </Box>
        ) : null}

        {wb.banners.length > 0 ? (
          <Box px="md" pb={8} style={{ flex: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {wb.banners.map((b) => (
              <Banner key={b.kind} banner={b} />
            ))}
          </Box>
        ) : null}

        <Box
          px="md"
          style={{
            position: "relative",
            flex: typeof height === "number" ? "none" : "1 1 auto",
            minHeight: 0,
            height: typeof height === "number" ? height : undefined,
          }}
        >
          {schema ? (
            <SchemaGrid
              {...(props.gridProps ?? {})}
              ref={wb.setHandle}
              schema={schema}
              dataSource={wb.dataSource}
              user={props.user}
              resolver={wb.resolver}
              registry={wb.registry}
              uiRegistry={uiRegistry}
              mode={wb.mode}
              view={wb.activeView}
              onViewChange={wb.onViewChange}
              events={wb.events}
              height="100%"
              poll={wb.poll}
              gridOptions={gridOptions}
              headerMenu={props.gridProps?.headerMenu ?? MantineHeaderMenu}
              onGroupByColumn={features.group ? wb.onGroupByColumn : undefined}
              {...(features.addColumn
                ? {
                    onEditColumn: wb.onEditColumn,
                    onAddColumn: wb.onAddColumn,
                    onInsertColumn: wb.onInsertColumn,
                    draftColumn: wb.panel.draftColumn,
                  }
                : {})}
              {...(props.pageSize ? { pageSize: props.pageSize } : {})}
              onClipboardReport={(report) => {
                wb.onClipboardReport(report);
                void notifyClipboardReport(report);
              }}
            />
          ) : (
            <Group justify="center" h="100%" mih={160} data-testid="workbench-loading">
              {wb.schemaLoading ? <Loader size="sm" color="gray" /> : null}
            </Group>
          )}
          {conflict && conflictColumn ? (
            <ConflictAnchor rowId={conflict.rowId} columnId={conflict.columnId}>
              {(size) => (
                <ConflictPopover
                  conflict={conflict}
                  column={conflictColumn}
                  registry={wb.registry}
                  uiRegistry={uiRegistry}
                  opened={prompt.opened}
                  onResolve={prompt.resolve}
                  onClose={prompt.dismiss}
                >
                  <Box data-testid="conflict-anchor" w={size.width} h={size.height} />
                </ConflictPopover>
              )}
            </ConflictAnchor>
          ) : null}
        </Box>

        {/* Status bar: only what has happened. Raw values for tests live in hidden test-id spans. */}
        <Group
          gap={6}
          px="md"
          wrap="nowrap"
          h={30}
          data-testid="workbench-status"
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
          <StatusItems items={wb.status} extra={slotContext ? renderSlot(props.statusBar, slotContext) : null} />
          {prompt.pendingCount > 0 ? (
            <Badge
              color="red"
              variant="light"
              size="sm"
              component="button"
              style={{ cursor: "pointer" }}
              onClick={prompt.reopen}
            >
              {prompt.pendingCount} conflict{prompt.pendingCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
          <VisuallyHidden>
            <span data-testid="saved-count">{wb.saved}</span>
            <span data-testid="not-saved-count">{wb.notSaved}</span>
            <span data-testid="feed-count">{wb.feedCount}</span>
            <span data-testid="clipboard-report">{wb.clipboard ? JSON.stringify(wb.clipboard) : "none"}</span>
            <span data-testid="filter-ast">{JSON.stringify(wb.filter)}</span>
            <span data-testid="last-export">{wb.exportDialog.lastExport ?? ""}</span>
            <span data-testid="import-job">{wb.importDialog.job ? JSON.stringify(wb.importDialog.job) : ""}</span>
          </VisuallyHidden>
        </Group>

        {schema && features.addColumn && panelEver ? (
          <Suspense fallback={null}>
            <ColumnPanel
            opened={wb.panel.opened}
            onClose={wb.panel.close}
            schema={schema}
            registry={wb.registry}
            uiRegistry={uiRegistry}
            access={wb.access}
            roles={wb.roles}
            column={wb.panel.column}
            {...(wb.panel.insertAt !== null ? { position: wb.panel.insertAt } : {})}
            sampleRows={wb.panel.sampleRows}
            onDraftChange={wb.panel.setDraft}
            onSave={(c) => void wb.panel.save(c)}
            onDelete={(id) => void wb.panel.remove(id)}
            dataSource={wb.dataSource}
            size={PANEL_WIDTH}
            />
          </Suspense>
        ) : null}
        {schema && features.import && importEver ? (
          <Suspense fallback={null}>
            <ImportWizard
              opened={wb.importDialog.opened}
              onClose={wb.importDialog.close}
              schema={schema}
              registry={wb.registry}
              access={wb.access}
              job={wb.importDialog.job}
              onCommit={wb.importDialog.commit}
            />
          </Suspense>
        ) : null}
        {schema && features.export && exportEver ? (
          <Suspense fallback={null}>
            <ExportDialog
              opened={wb.exportDialog.opened}
              onClose={wb.exportDialog.close}
              visibleColumnCount={wb.exportDialog.opened ? wb.exportDialog.visibleColumnCount() : 0}
              selectedRowCount={wb.exportDialog.opened ? wb.exportDialog.selectedRowCount() : 0}
              onExport={async (req) => {
                await wb.exportDialog.run(req);
                wb.exportDialog.close();
              }}
            />
          </Suspense>
        ) : null}
      </Box>
    </EmptyContext.Provider>
  );
}

/** Dot-separated muted entries; nothing at all reads "No changes yet". */
function StatusItems({ items, extra }: { items: string[]; extra: ReactNode }) {
  const hasExtra = extra !== null && extra !== undefined && extra !== false && extra !== "";
  if (items.length === 0 && !hasExtra) return <span>No changes yet</span>;
  return (
    <>
      {items.map((item, i) => (
        <span key={item} style={{ whiteSpace: "nowrap" }}>
          {i > 0 ? <span aria-hidden> · </span> : null}
          {item}
        </span>
      ))}
      {hasExtra ? (
        <span style={{ whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {items.length > 0 ? <span aria-hidden> · </span> : null}
          {extra}
        </span>
      ) : null}
    </>
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
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
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
        const next = { top: c.top - h.top, left: c.left - h.left, width: c.width, height: c.height };
        setRect((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
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
      style={{ position: "absolute", zIndex: 20, pointerEvents: "none", ...(rect ?? { top: 0, left: 0, width: 0, height: 0 }) }}
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
