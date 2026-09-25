/**
 * The stories' host: a thin wrapper around ui-shadcn's `<SchemaGridWorkbench>`
 * that keeps the story-facing props of the old hand-rolled workbench. Test
 * hooks (filter AST, counters, clipboard report, last export, import job) are
 * the workbench's own hidden test-id spans.
 */
import type { SchemaGridHandle, SchemaGridPollOptions } from "@ranjeetk25/schema-grid-ag-grid";
import type { ChangeFeedEntry, DataSource, GridSchema, PermissionUser, ViewDef } from "@ranjeetk25/schema-grid-core";
import {
  Button,
  SchemaGridWorkbench,
  Tooltip,
  type WorkbenchFeatures,
  type WorkbenchSlot,
  type WorkbenchViewStore,
  createMemoryViewStore,
} from "@ranjeetk25/schema-grid-ui-shadcn";
import { createShadcnUiRegistry } from "@ranjeetk25/schema-grid-ui-shadcn/editors";
import { type ReactNode, useMemo } from "react";
import { registry, resolver } from "./shared";

export const uiRegistry = createShadcnUiRegistry({ fieldTypes: registry });

/** Every column stays in the DOM so tests (and screenshots) can reach any cell. */
export const GRID_OPTIONS = { suppressColumnVirtualisation: true } as const;

const ROLES = ["admin", "counsellor", "viewer"];
const GRID_PROPS = { gridOptions: GRID_OPTIONS };

/** A 32px ghost icon button with a Linear-style tooltip (for stories' own toolbars). */
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
    <Tooltip content={label} {...(shortcut ? { shortcut } : {})}>
      <Button variant="subtle" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
        {children}
      </Button>
    </Tooltip>
  );
}

export interface WorkbenchProps {
  dataSource: DataSource;
  schema: GridSchema;
  user: PermissionUser;
  mode?: "client" | "server";
  /** Header title. Default "Admissions". */
  title?: string;
  /** One muted line beside the title. */
  subtitle?: string;
  /** Persists a schema change (column panel / created option). Default: accept as-is. */
  onSchemaChange?(next: GridSchema): Promise<GridSchema> | GridSchema;
  /** `intervalMs` → `pollIntervalMs`; `enabled: false` turns polling off. */
  poll?: SchemaGridPollOptions;
  /** Grid height in px, or any CSS height. Default 420. */
  height?: number | string;
  initialViews?: ViewDef[];
  /** Extra toolbar content (right side, before undo / redo). */
  toolbar?: (handle: SchemaGridHandle | null) => ReactNode;
  /** Extra toolbar content (left side, after search). */
  toolbarStart?: WorkbenchSlot;
  /** Extra status-line content (bottom bar). */
  status?: ReactNode;
  onRemoteChanges?(entry: ChangeFeedEntry): void;
  pageSize?: number;
  testId?: string;
  /** Persist saved views in localStorage under exactly this key (per-viewer convenience). */
  persistViewsKey?: string;
}

/** Saved views as a JSON array at `localStorage[key]` (ignores the grid id). */
function keyedLocalStorageViewStore(key: string): WorkbenchViewStore {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return Array.isArray(parsed) && parsed.length > 0 ? (parsed as ViewDef[]) : null;
      } catch {
        return null;
      }
    },
    save(_gridId, views) {
      try {
        localStorage.setItem(key, JSON.stringify(views));
      } catch {
        // Storage unavailable (private window, blocked): views stay in memory.
      }
    },
  };
}

export function Workbench({
  dataSource,
  schema,
  user,
  mode = "client",
  title = "Admissions",
  subtitle,
  onSchemaChange,
  poll,
  height = 420,
  initialViews,
  toolbar,
  toolbarStart,
  status,
  onRemoteChanges,
  pageSize,
  testId = "workbench",
  persistViewsKey,
}: WorkbenchProps) {
  // A fresh memory store per mount so stories don't leak views into each other.
  const viewStore = useMemo(
    () => (persistViewsKey ? keyedLocalStorageViewStore(persistViewsKey) : createMemoryViewStore()),
    [persistViewsKey],
  );
  const canEditSchema = user.roles.includes("admin");
  const pollOff = poll?.enabled === false;
  const features = useMemo<Partial<WorkbenchFeatures> | undefined>(() => {
    const off: Partial<WorkbenchFeatures> = {};
    if (pollOff) off.polling = false;
    if (!canEditSchema) off.addColumn = false;
    return Object.keys(off).length ? off : undefined;
  }, [pollOff, canEditSchema]);

  return (
    <SchemaGridWorkbench
      dataSource={dataSource}
      schema={schema}
      user={user}
      mode={mode}
      title={title}
      {...(subtitle ? { subtitle } : {})}
      registry={registry}
      resolver={resolver}
      uiRegistry={uiRegistry}
      roles={ROLES}
      gridProps={GRID_PROPS}
      viewStore={viewStore}
      height={height}
      testId={testId}
      {...(onSchemaChange ? { onSchemaChange } : {})}
      {...(features ? { features } : {})}
      {...(poll?.intervalMs ? { pollIntervalMs: poll.intervalMs } : {})}
      {...(initialViews ? { defaultViews: initialViews } : {})}
      {...(toolbar ? { toolbarEnd: (ctx) => toolbar(ctx.handle) } : {})}
      {...(toolbarStart ? { toolbarStart } : {})}
      {...(status !== undefined && status !== null ? { statusBar: status } : {})}
      {...(onRemoteChanges ? { onRemoteChanges } : {})}
      {...(pageSize ? { pageSize } : {})}
    />
  );
}
