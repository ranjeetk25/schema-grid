/**
 * `<SchemaGridWorkbench>` (shadcn skin): a whole admin grid page in one component.
 *
 * - header bar: title + subtitle, the signed-in user;
 * - toolbar: view switcher, filter (count badge), group, search and
 *   `toolbarStart` on the left; `toolbarEnd`, undo / redo, import, export and
 *   the single primary action ("Add column") on the right;
 * - applied-filter chips (with the unapplied-draft dot), inline banners
 *   (read-only, permission, network, capability, schema changed) with
 *   retry / reload;
 * - the grid (conflict prompt anchored over the cell, ghost column preview,
 *   polling with remote-change flashes);
 * - a quiet status bar ("No changes yet" when idle).
 *
 * State lives in the headless `useWorkbench` (shared verbatim with
 * ui-mantine); this file only renders it. Every feature is derived from the
 * data source's capabilities; `features` can only switch things off.
 *
 * v0.3: a "Columns" show / hide picker in the toolbar, host `events` merged
 * with the workbench's own, "Add column" and the column panel only when the
 * source reports `schema.write`, an export banner with Retry, and the import
 * wizard / export dialog / column panel loaded lazily on first open.
 */
import { SchemaGrid } from "@ranjeetk25/schema-grid-ag-grid";
import type { FilterNode } from "@ranjeetk25/schema-grid-core";
import {
  CircleAlertIcon,
  DownloadIcon,
  InfoIcon,
  LoaderCircleIcon,
  LockIcon,
  PlusIcon,
  Redo2Icon,
  RefreshCwIcon,
  SearchIcon,
  Table2Icon,
  Undo2Icon,
  UploadIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { type CSSProperties, type ReactNode, Suspense, createContext, lazy, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ConflictPopover } from "../conflict/ConflictPopover";
import { useShadcnConflictPrompt } from "../conflict/useShadcnConflictPrompt";
import { createShadcnUiRegistry } from "../editors";
import { FilterButton } from "../filter-builder/FilterButton";
import { FilterChips } from "../filter-builder/FilterChips";
import { ShadcnHeaderMenu } from "../header-menu/ShadcnHeaderMenu";
import { SG_ROOT, cn } from "../lib/cn";
import { notifyClipboardReport } from "../notifications/notifyClipboardReport";
import { useGridThemeFromShadcn } from "../theme/useGridThemeFromShadcn";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { Tooltip } from "../ui/tooltip";
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

const PANEL_WIDTH = 420;

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const UNDO_KEYS = IS_MAC ? "⌘Z" : "Ctrl+Z";
const REDO_KEYS = IS_MAC ? "⌘⇧Z" : "Ctrl+Shift+Z";

/** Every column stays in the DOM so tests (and screenshots) can reach any cell. */
const DEFAULT_GRID_OPTIONS = { suppressColumnVirtualisation: true } as const;

/** A 32px ghost icon button with a tooltip; unavailable = 40% opacity (still hoverable for the hint). */
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
    <Tooltip content={label} {...(keys ? { shortcut: keys } : {})}>
      <Button
        variant="subtle"
        size="icon"
        aria-label={label}
        aria-disabled={disabled || undefined}
        className={cn(disabled && "sg:opacity-40 sg:hover:bg-transparent sg:hover:text-muted-foreground")}
        onClick={() => {
          if (!disabled) onClick();
        }}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

const BANNER_TONE: Record<WorkbenchBanner["kind"], { className: string; icon: ReactNode; role: "alert" | "status" }> = {
  network: { className: "sg:bg-danger-subtle sg:text-danger", icon: <WifiOffIcon />, role: "alert" },
  "permission-denied": { className: "sg:bg-danger-subtle sg:text-danger", icon: <LockIcon />, role: "alert" },
  "capability-denied": { className: "sg:bg-muted sg:text-foreground", icon: <CircleAlertIcon />, role: "status" },
  "schema-changed": { className: "sg:bg-primary-subtle sg:text-foreground", icon: <RefreshCwIcon />, role: "status" },
  "read-only": { className: "sg:bg-subtle sg:text-muted-foreground", icon: <LockIcon />, role: "status" },
  export: { className: "sg:bg-danger-subtle sg:text-danger", icon: <CircleAlertIcon />, role: "alert" },
  unknown: { className: "sg:bg-muted sg:text-foreground", icon: <InfoIcon />, role: "status" },
};

function Banner({ banner }: { banner: WorkbenchBanner }) {
  const tone = BANNER_TONE[banner.kind];
  return (
    <div
      role={tone.role}
      data-testid={`workbench-banner-${banner.kind}`}
      className={cn(
        "sg:flex sg:h-9 sg:items-center sg:gap-2 sg:rounded-md sg:pr-1 sg:pl-3 sg:text-sm",
        tone.className,
      )}
    >
      <span aria-hidden className="sg:flex sg:shrink-0 sg:[&_svg]:size-4">
        {tone.icon}
      </span>
      <span className="sg:min-w-0 sg:flex-1 sg:truncate">{banner.message}</span>
      {banner.action ? (
        <Button variant="ghost" size="sm" className="sg:text-inherit sg:hover:bg-black/5 sg:dark:hover:bg-white/10" onClick={banner.action.run}>
          {banner.action.label}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss"
        className="sg:text-inherit sg:hover:bg-black/5 sg:dark:hover:bg-white/10"
        onClick={banner.dismiss}
      >
        <XIcon />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state (AG Grid's no-rows overlay; rendered inside our React tree)
// ---------------------------------------------------------------------------

interface EmptyContextValue {
  emptyState: ReactNode;
  filtered: boolean;
  /** A network / permission banner is up: say nothing rather than "No rows yet". */
  blocked: boolean;
  clear(): void;
}
const EmptyContext = createContext<EmptyContextValue | null>(null);

function EmptyOverlay() {
  const ctx = useContext(EmptyContext);
  if (!ctx || ctx.blocked) return null;
  if (ctx.emptyState !== undefined && ctx.emptyState !== null) {
    return <div className={cn(SG_ROOT, "sg:pointer-events-auto")}>{ctx.emptyState}</div>;
  }
  return (
    <div data-testid="workbench-empty" className={cn(SG_ROOT, "sg:pointer-events-auto sg:text-center")}>
      <p className="sg:m-0 sg:text-sm sg:font-medium sg:text-foreground">{ctx.filtered ? "No rows match" : "No rows yet"}</p>
      <p className="sg:m-0 sg:mt-1 sg:text-xs sg:text-muted-foreground">
        {ctx.filtered ? "Try a different filter or search." : "Rows you add or import show up here."}
      </p>
      {ctx.filtered ? (
        <Button size="sm" className="sg:mt-3" onClick={ctx.clear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SchemaGridWorkbench(props: SchemaGridWorkbenchProps) {
  const prompt = useShadcnConflictPrompt();
  const wb = useWorkbench({ props, onConflict: prompt.onConflict });
  const { schema, features, slotContext } = wb;
  const { title, subtitle, height = "fill", emptyState, testId = "workbench" } = props;
  const uiRegistry = useMemo(
    () => props.uiRegistry ?? createShadcnUiRegistry({ fieldTypes: wb.registry }),
    [props.uiRegistry, wb.registry],
  );
  const { theme } = useGridThemeFromShadcn();
  const [filterDraft, setFilterDraft] = useState<{ draft: FilterNode | null; dirty: boolean }>({ draft: null, dirty: false });
  const gridBoxRef = useRef<HTMLDivElement>(null);

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
  const conflictCell =
    conflict && conflictColumn
      ? (gridBoxRef.current?.querySelector<HTMLElement>(
          `.ag-row[row-id="${CSS.escape(conflict.rowId)}"] .ag-cell[col-id="${CSS.escape(conflict.columnId)}"]`,
        ) ?? null)
      : null;

  const fill = height === "fill";
  const rootStyle: CSSProperties = {
    height: fill ? "100%" : typeof height === "number" ? "auto" : height,
    // The column panel docks on the right; the grid makes room instead of hiding under it.
    paddingRight: wb.panel.opened ? PANEL_WIDTH : 0,
  };
  const hasHeader = title !== undefined || subtitle !== undefined;
  const userLabel = (props.user as { name?: string }).name ?? props.user.id;

  return (
    <EmptyContext.Provider value={emptyValue}>
      <div
        data-testid={testId}
        className={cn(
          SG_ROOT,
          "sg-workbench sg:flex sg:min-h-0 sg:flex-col sg:bg-background sg:text-sm sg:text-foreground",
          "sg:transition-[padding-right] sg:duration-[160ms] sg:ease-out",
        )}
        data-blocked={blocked || undefined}
        style={rootStyle}
      >
        {/* The banner already says it; hide the grid's own "Couldn't load rows" line. */}
        <style>{".sg-workbench[data-blocked] .sg-load-error { display: none; }"}</style>
        {hasHeader ? (
          <header className="sg:flex sg:h-13 sg:flex-none sg:items-center sg:justify-between sg:gap-3 sg:border-b sg:border-border sg:px-4">
            <div className="sg:flex sg:min-w-0 sg:items-center sg:gap-2.5">
              <span
                aria-hidden
                className="sg:grid sg:size-6.5 sg:flex-none sg:place-items-center sg:rounded-md sg:bg-primary-subtle sg:text-primary sg:[&_svg]:size-4"
              >
                <Table2Icon />
              </span>
              {title !== undefined ? <h1 className="sg:m-0 sg:truncate sg:text-sm sg:font-semibold">{title}</h1> : null}
              {subtitle !== undefined ? (
                <span className="sg:hidden sg:truncate sg:text-sm sg:text-muted-foreground sg:sm:inline">{subtitle}</span>
              ) : null}
            </div>
            <Tooltip content={`Signed in as ${userLabel} · ${props.user.roles.join(", ") || "no roles"}`}>
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users get the tooltip. */}
              <span role="img" tabIndex={0} aria-label={`Signed in as ${userLabel}`} className="sg:inline-flex sg:rounded-full sg:outline-none sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring">
                <Avatar name={userLabel} size="md" />
              </span>
            </Tooltip>
          </header>
        ) : null}

        {schema && slotContext ? (
          <div className="sg:flex sg:flex-none sg:items-center sg:justify-between sg:gap-2 sg:px-4 sg:py-2">
            <div className="sg:flex sg:min-w-0 sg:flex-wrap sg:items-center sg:gap-1.5">
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
                  <Separator orientation="vertical" className="sg:mx-1 sg:h-5" />
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
                  onDraftChange={(draft, dirty) => setFilterDraft({ draft, dirty })}
                  dataSource={wb.dataSource}
                />
              ) : null}
              {features.group ? (
                <GroupByBar schema={wb.effectiveSchema ?? schema} registry={wb.registry} access={wb.access} value={wb.groupBy} onChange={wb.applyGroupBy} />
              ) : null}
              {features.search ? (
                <div className="sg:relative sg:w-50">
                  <SearchIcon aria-hidden className="sg:pointer-events-none sg:absolute sg:top-1/2 sg:left-2.5 sg:size-3.5 sg:-translate-y-1/2 sg:text-muted-foreground" />
                  <Input
                    type="search"
                    aria-label="Search rows"
                    placeholder="Search"
                    value={wb.search}
                    className="sg:pr-8 sg:pl-8 sg:[&::-webkit-search-cancel-button]:appearance-none"
                    onChange={(e) => wb.setSearch(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && wb.search) {
                        e.stopPropagation();
                        wb.setSearch("");
                      }
                    }}
                  />
                  {wb.search ? (
                    <Button
                      variant="subtle"
                      size="icon-xs"
                      aria-label="Clear search"
                      className="sg:absolute sg:top-1/2 sg:right-1 sg:-translate-y-1/2"
                      onClick={() => wb.setSearch("")}
                    >
                      <XIcon />
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {renderSlot(props.toolbarStart, slotContext)}
            </div>
            <div className="sg:flex sg:flex-none sg:items-center sg:gap-0.5">
              {renderSlot(props.toolbarEnd, slotContext)}
              <ColumnsButton items={wb.columns.items} onChange={wb.columns.apply} />
              {features.undo ? (
                <>
                  <IconAction label="Undo" keys={UNDO_KEYS} disabled={!wb.canUndo} onClick={wb.undo}>
                    <Undo2Icon />
                  </IconAction>
                  <IconAction label="Redo" keys={REDO_KEYS} disabled={!wb.canRedo} onClick={wb.redo}>
                    <Redo2Icon />
                  </IconAction>
                </>
              ) : null}
              {features.import ? (
                <IconAction label="Import…" onClick={wb.importDialog.open}>
                  <UploadIcon />
                </IconAction>
              ) : null}
              {features.export ? (
                <IconAction label="Export CSV" onClick={() => void wb.exportCsv()}>
                  <DownloadIcon />
                </IconAction>
              ) : null}
              {features.addColumn ? (
                <>
                  <Separator orientation="vertical" className="sg:mx-1.5 sg:h-5" />
                  <Button variant="primary" onClick={wb.onAddColumn}>
                    <PlusIcon />
                    Add column
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {schema && features.filter ? (
          <div className="sg:flex-none sg:px-4 sg:pb-2 sg:empty:hidden">
            <FilterChips
              schema={wb.effectiveSchema ?? schema}
              registry={wb.registry}
              value={wb.filter}
              onChange={wb.applyFilter}
              access={wb.access}
              draft={filterDraft.draft}
              dirty={filterDraft.dirty}
            />
          </div>
        ) : null}

        {wb.banners.length > 0 ? (
          <div className="sg:flex sg:flex-none sg:flex-col sg:gap-1.5 sg:px-4 sg:pb-2">
            {wb.banners.map((b) => (
              <Banner key={b.kind} banner={b} />
            ))}
          </div>
        ) : null}

        <div
          ref={gridBoxRef}
          className={cn("sg:relative sg:min-h-0 sg:px-4", typeof height === "number" ? "sg:flex-none" : "sg:flex-auto")}
          style={typeof height === "number" ? { height } : undefined}
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
              theme={props.gridProps?.theme ?? theme}
              gridOptions={gridOptions}
              headerMenu={props.gridProps?.headerMenu ?? ShadcnHeaderMenu}
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
            <div data-testid="workbench-loading" className="sg:flex sg:h-full sg:min-h-40 sg:items-center sg:justify-center">
              {wb.schemaLoading ? <LoaderCircleIcon aria-label="Loading" className="sg:size-4 sg:animate-spin sg:text-muted-foreground" /> : null}
            </div>
          )}
          {conflict && conflictColumn ? (
            <ConflictPopover
              conflict={conflict}
              column={conflictColumn}
              registry={wb.registry}
              uiRegistry={uiRegistry}
              opened={prompt.opened}
              onResolve={prompt.resolve}
              onClose={prompt.dismiss}
              anchor={conflictCell}
            />
          ) : null}
        </div>

        {/* Status bar: only what has happened. Raw values for tests live in hidden test-id spans. */}
        <div
          data-testid="workbench-status"
          className="sg:mt-2 sg:flex sg:h-7.5 sg:flex-none sg:items-center sg:gap-1.5 sg:overflow-hidden sg:border-t sg:border-border sg:px-4 sg:text-xs sg:text-muted-foreground sg:tabular-nums"
        >
          <StatusItems items={wb.status} extra={slotContext ? renderSlot(props.statusBar, slotContext) : null} />
          {prompt.pendingCount > 0 ? (
            <button
              type="button"
              className="sg:rounded-sm sg:bg-danger-subtle sg:px-1.5 sg:py-0.5 sg:font-medium sg:text-danger"
              onClick={prompt.reopen}
            >
              {prompt.pendingCount} conflict{prompt.pendingCount === 1 ? "" : "s"}
            </button>
          ) : null}
          <div hidden>
            <span data-testid="saved-count">{wb.saved}</span>
            <span data-testid="not-saved-count">{wb.notSaved}</span>
            <span data-testid="feed-count">{wb.feedCount}</span>
            <span data-testid="clipboard-report">{wb.clipboard ? JSON.stringify(wb.clipboard) : "none"}</span>
            <span data-testid="filter-ast">{JSON.stringify(wb.filter)}</span>
            <span data-testid="last-export">{wb.exportDialog.lastExport ?? ""}</span>
            <span data-testid="import-job">{wb.importDialog.job ? JSON.stringify(wb.importDialog.job) : ""}</span>
          </div>
        </div>

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
              {...(wb.panel.insertAt !== null ? { insertAt: wb.panel.insertAt } : {})}
              sampleRows={wb.panel.sampleRows}
              onDraftChange={(draft) => wb.panel.setDraft(draft?.column ?? null)}
              onSave={(c) => void wb.panel.save(c)}
              onDelete={(id) => void wb.panel.remove(id)}
              dataSource={wb.dataSource}
              width={PANEL_WIDTH}
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
      </div>
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
        <span key={item} className="sg:whitespace-nowrap">
          {i > 0 ? <span aria-hidden> · </span> : null}
          {item}
        </span>
      ))}
      {hasExtra ? (
        <span className="sg:inline-flex sg:items-center sg:gap-1.5 sg:whitespace-nowrap">
          {items.length > 0 ? <span aria-hidden> · </span> : null}
          {extra}
        </span>
      ) : null}
    </>
  );
}
