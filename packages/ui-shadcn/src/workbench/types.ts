/**
 * `<SchemaGridWorkbench>` contracts. Framework-free; copied verbatim from ui-mantine so the
 * two kits share one contract.
 */
import type {
  ChangeFeedEntry,
  DataSource,
  FieldTypeRegistry,
  GridSchema,
  PermissionResolver,
  PermissionUser,
  ViewDef,
} from "@ranjeetk25/schema-grid-core";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Capabilities (spec C2)
// ---------------------------------------------------------------------------

/**
 * TODO(lane-a): replace with `DataSourceCapabilities` from
 * `@ranjeetk25/schema-grid-core` once C2 lands. Structural mirror of C2.
 */
export interface WorkbenchCapabilities {
  maxPageSize: number;
  sort: "all" | { columnIds: string[] };
  filter: "all" | { columnIds: string[] };
  operators?: Record<string, string[]>;
  groupBy: boolean;
  search: boolean;
  changeFeed: boolean | "updates-only";
  write: { cells: boolean; createRows: boolean; deleteRows: boolean };
  options: boolean;
  lookup: boolean;
  export: { maxRows?: number };
}

/** A data source that may report its capabilities (C2 `DataSource.capabilities?`). */
export type CapableDataSource = DataSource & {
  capabilities?(): Promise<WorkbenchCapabilities> | WorkbenchCapabilities;
};

// ---------------------------------------------------------------------------
// Grid client (spec C5 `createGridClient`)
// ---------------------------------------------------------------------------

/**
 * TODO(lane-c): replace with the `GridClient` type from
 * `@ranjeetk25/schema-grid-ag-grid` once `createGridClient` lands. Structural:
 * anything with this shape works.
 */
export interface WorkbenchGridClient {
  dataSource: DataSource;
  getSchema(): Promise<GridSchema>;
  /** Persists a schema change (add / edit / delete column). Absent → the add-column flow is off. */
  updateSchema?(schema: GridSchema): Promise<GridSchema>;
  /** Function (wire op #9) or an already-resolved object. */
  capabilities?: (() => Promise<WorkbenchCapabilities> | WorkbenchCapabilities) | WorkbenchCapabilities;
  /** Keys the default view store. */
  gridId?: string;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export interface WorkbenchFeatures {
  filter: boolean;
  group: boolean;
  search: boolean;
  views: boolean;
  export: boolean;
  import: boolean;
  addColumn: boolean;
  undo: boolean;
  polling: boolean;
}

export type WorkbenchFeatureName = keyof WorkbenchFeatures;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Where saved views live. The default is `createLocalStorageViewStore()`; hosts can persist server-side. */
export interface WorkbenchViewStore {
  load(gridId: string): Promise<ViewDef[] | null> | ViewDef[] | null;
  save(gridId: string, views: ViewDef[]): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type WorkbenchErrorKind =
  /** The data source does not support the operation (501 / UNSUPPORTED_OPERATION). */
  | "capability-denied"
  /** 401 / 403 / PERMISSION_DENIED / UNAUTHENTICATED. */
  | "permission-denied"
  /** Offline, fetch failed, 5xx. */
  | "network"
  /** The server's schema moved past ours (change feed `schemaVersion`, SCHEMA_CHANGED). */
  | "schema-changed"
  /** Anything else (validation, conflicts are handled by the conflict prompt). */
  | "unknown";

export interface WorkbenchError {
  kind: WorkbenchErrorKind;
  /** Data-source operation that failed ("fetch", "applyChanges", "getChanges", "updateSchema", …). */
  op: string;
  /** One friendly sentence. */
  message: string;
  error: unknown;
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** What slot render functions receive. */
export interface WorkbenchSlotContext {
  schema: GridSchema;
  user: PermissionUser;
  features: WorkbenchFeatures;
  capabilities: WorkbenchCapabilities;
  /** The grid handle (null until the grid mounts). */
  handle: import("@ranjeetk25/schema-grid-ag-grid").SchemaGridHandle | null;
  openImport(): void;
  openExport(): void;
  openAddColumn(): void;
  refetch(): Promise<void>;
}

export type WorkbenchSlot = ReactNode | ((ctx: WorkbenchSlotContext) => ReactNode);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SchemaGridWorkbenchBaseProps {
  user: PermissionUser;
  /** Default `createRolePermissionResolver()`. */
  resolver?: PermissionResolver;
  /** Default `createDefaultRegistry()`. */
  registry?: FieldTypeRegistry;
  /** Default: the kit's registry over `registry`. */
  uiRegistry?: import("@ranjeetk25/schema-grid-ag-grid").UiFieldTypeRegistry;
  /** Default "server" with `client`, "client" otherwise. Must not change after mount. */
  mode?: "client" | "server";
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Keys the view store. Default `client.gridId`, else `schema.id`. */
  gridId?: string;
  /** Controlled views. Pair with `onViewsChange`. */
  views?: ViewDef[];
  onViewsChange?(views: ViewDef[]): void;
  /** Uncontrolled views persist here. Default: localStorage, keyed by grid id. */
  viewStore?: WorkbenchViewStore;
  /** Views to start with when the store is empty. Default `schema.views`, else "All rows". */
  defaultViews?: ViewDef[];
  /** Features can only be turned OFF; the rest is derived from the data source's capabilities. */
  features?: Partial<WorkbenchFeatures>;
  toolbarStart?: WorkbenchSlot;
  toolbarEnd?: WorkbenchSlot;
  /** Extra status-bar content (after the built-in entries). */
  statusBar?: WorkbenchSlot;
  /** Shown over the grid when there are no rows. */
  emptyState?: ReactNode;
  onError?(error: WorkbenchError): void;
  /** Change-feed interval. Default: the grid's (7s, paused while the tab is hidden). */
  pollIntervalMs?: number;
  /** "fill" (default) fills the parent (give it a height); a number is px; a string is any CSS height. */
  height?: "fill" | number | string;
  pageSize?: number;
  /** Roles offered in the column panel's access step. Default: roles found in the schema + the user's. */
  roles?: string[];
  onRemoteChanges?(entry: ChangeFeedEntry): void;
  /** Receives the grid handle. */
  onHandle?(handle: import("@ranjeetk25/schema-grid-ag-grid").SchemaGridHandle | null): void;
  /** Escape hatch forwarded to `<SchemaGrid>` (e.g. `gridOptions`, `tz`). */
  gridProps?: Partial<import("@ranjeetk25/schema-grid-ag-grid").SchemaGridComponentProps>;
  /** Root `data-testid`. Default "workbench". */
  testId?: string;
}

export interface WorkbenchClientSource {
  client: WorkbenchGridClient;
  dataSource?: never;
  schema?: never;
  onSchemaChange?: never;
}

export interface WorkbenchDirectSource {
  client?: never;
  dataSource: DataSource;
  schema: GridSchema;
  /** Persists a schema change (column panel / created options). Default: accepted as-is, in memory. */
  onSchemaChange?(next: GridSchema): Promise<GridSchema> | GridSchema;
}

export type SchemaGridWorkbenchProps = SchemaGridWorkbenchBaseProps & (WorkbenchClientSource | WorkbenchDirectSource);
