// Public barrel for `@ranjeetk25/schema-grid-ag-grid`.
// Subpaths: `./editors`, `./filters`, `./sync`.
// Injected from package.json by tsup (`define`) and by vitest.config.ts; source
// consumers without either (e.g. the Storybook dev build) get the dev fallback.
declare const __SCHEMA_GRID_AG_GRID_VERSION__: string | undefined;
export const SCHEMA_GRID_AG_GRID_VERSION: string =
  typeof __SCHEMA_GRID_AG_GRID_VERSION__ === "string" ? __SCHEMA_GRID_AG_GRID_VERSION__ : "0.0.0-dev";

// Grid
export {
  SchemaGrid,
  type SchemaGridComponent,
  type SchemaGridComponentProps,
  type SchemaGridHandle,
} from "./grid/SchemaGrid";
export {
  useSchemaGrid,
  createStatusCellClassRules,
  createStatusRowClassRules,
  type ExportFormat,
  type RowModelKey,
  type SchemaGridFilterErrors,
  type SchemaGridLoadState,
  type SchemaGridMode,
  type SchemaGridPollOptions,
  type SchemaGridProps,
  type SchemaGridUndo,
  type UseSchemaGridResult,
  type UseSchemaGridSeams,
} from "./grid/useSchemaGrid";
export {
  getSchemaGridContext,
  getSchemaGridStores,
  type SchemaGridContext,
  type SchemaGridStores,
} from "./grid/gridContext";
export {
  createKeyboardRegistry,
  type KeyboardRegistry,
  type RootKeyHandler,
  type RootKeyHandlerOptions,
  type RootKeyResult,
} from "./grid/keyboard";
export {
  SchemaHeader,
  schemaHeaderKeyboardEvent,
  SG_HEADER_CLASSES,
  type SchemaHeaderProps,
} from "./grid/SchemaHeader";
export { DefaultHeaderMenu } from "./grid/DefaultHeaderMenu";
export { createHeaderMenuActions, type HeaderMenuActionDeps } from "./grid/headerMenuActions";
export {
  createInPlaceHandlers,
  createReadOnlyCellClassRules,
  READ_ONLY_MESSAGES,
  readOnlyReason,
  type ReadOnlyReason,
} from "./editing/inPlace";
export type {
  HeaderMenuActions,
  HeaderMenuColumn,
  HeaderMenuComponent,
  HeaderMenuContext,
  HeaderMenuHostCallbacks,
  HeaderMenuPinnedState,
  HeaderMenuProps,
  HeaderMenuSortState,
} from "./grid/headerMenu";
export { SCHEMA_GRID_CLIENT_MODULES, SCHEMA_GRID_INFINITE_MODULES } from "./agModules";

// Compilation + UI registry
export { compileColumns, type CompileColumnsOptions } from "./compile/compileColumns";
export { createCellAccess } from "./compile/cellAccess";
export { compileFormulaColumns, type CompiledFormulas } from "./compile/formulaColumns";
export {
  createDefaultUiRegistry,
  createUiFieldTypeRegistry,
  resolveExportFormat,
  type SchemaCellRendererParams,
  type UiEditorEntry,
  type UiFieldType,
  type UiFieldTypeRegistry,
  type UiFilterEntry,
} from "./compile/uiRegistry";

// Views + export
export { applyViewState, captureViewState } from "./views/viewState";
export { exportCsv, type ExportCsvOptions } from "./export/csv";
export { exportCurrentView, type ExportCurrentViewOptions } from "./export/exportCurrentView";

// Theme
export { createSchemaGridTheme, SCHEMA_GRID_THEME_PARAMS, type SchemaGridThemeOverrides } from "./theme/theme";
export { SG_CLASSES, SG_CSS, type SgClassName } from "./theme/classNames";

// Stores
export { createStore, useStoreSelector, type Store } from "./state/createStore";
export { createRowStore, type RowStore } from "./state/rowStore";
export { createCellStatusStore, cellKey, type CellRef, type CellStatus, type CellStatusStore } from "./state/cellStatusStore";
export { createRangeStore, type RangeStore } from "./state/rangeStore";
export { createQueryStore, type QueryState, type QueryStore } from "./state/queryStore";
export { createExpansionStore, type ExpansionStore } from "./state/expansionStore";

// Editing, undo
export {
  createEditController,
  type AppliedInfo,
  type EditController,
  type EditControllerOptions,
  READ_ONLY_MESSAGE,
  type SubmitOutcome,
} from "./editing/editController";
export { createEditRequestHandler } from "./editing/editEntry";
export type { ConflictHandler } from "./editing/conflicts";
export { createUndoStack, invertChanges, type UndoStack } from "./undo/undoStack";

// Range, clipboard, fill (pure planners)
export type { CellPos, CellRange, NormalizedRange } from "./range/geometry";
export { parseTsv, serializeTsv } from "./clipboard/tsv";
export { buildCopyText } from "./clipboard/copyPlan";
export { planPaste, type PastePlan } from "./clipboard/pastePlan";
export type { ClipboardReport } from "./clipboard/types";
export { planFill, type FillPlanResult } from "./fill/fillPlan";
export type { FillReport } from "./fill/useFillHandle";

// Grouping + server mode
export {
  isDataRow,
  isGroupRow,
  isLoadMoreRow,
  type DisplayRow,
  type GroupDisplayRow,
  type LoadMoreDisplayRow,
} from "./grouping/clientGroups";
export { groupKeyToCondition } from "./grouping/groupCondition";
export { createInfiniteDatasource, type PageMode } from "./server/infiniteDatasource";
export { createServerGroupsController, type ServerGroupsController } from "./server/serverGroups";

// Remote data sources (transport-neutral wire contract from core)
export { createHttpDataSource, type HttpDataSourceOptions } from "./remote/httpDataSource";
export {
  createGridClient,
  type GridClient,
  type GridClientCapabilities,
  type GridClientOptions,
} from "./remote/gridClient";
export {
  createRemoteDataSource,
  RemoteDataSourceError,
  unwrapWireResult,
  type GridTransport,
  type RemoteDataSourceOptions,
  type WireError,
  type WireResult,
} from "@ranjeetk25/schema-grid-core/wire";

// A11y
export { createAnnouncer, notSavedMessage, savedMessage, type Announcer, type Politeness } from "./a11y/announcer";
export { LiveAnnouncer, type LiveAnnouncerProps } from "./a11y/LiveAnnouncer";

// Local extensions of core types used in this package's public API.
export type {
  ConflictResolution,
  DataSourceCapabilities,
  EffectiveCapabilities,
  EffectiveColumnCapabilities,
  IoExportModule,
  IoExportOptions,
  SchemaGridEvents,
} from "./internal/core";
