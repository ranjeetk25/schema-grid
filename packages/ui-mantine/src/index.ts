export const SCHEMA_GRID_UI_MANTINE_VERSION = "0.0.1";

// Subpath areas (also importable as ./editors, ./filter-builder, ./column-builder, ./import-export)
export * from "./editors";
export * from "./filter-builder";
export * from "./column-builder";
export * from "./import-export";

// Root-only areas
export { ViewSwitcher, type ViewSwitcherProps } from "./views/ViewSwitcher";
export { GroupByBar, type GroupByBarProps } from "./views/GroupByBar";
export { ConflictPopover, type ConflictPopoverProps } from "./conflict/ConflictPopover";
export { RemoteChangedBadge, type RemoteChangedBadgeProps } from "./conflict/RemoteChangedBadge";
export { useMantineConflictPrompt, type MantineConflictPrompt } from "./conflict/useMantineConflictPrompt";
export {
  gridCssVariables,
  mantineGridCssVariablesResolver,
  resolveGridThemeParams,
  useGridThemeFromMantine,
  type GridCssVariables,
  type GridThemeFromMantine,
  type GridThemeParams,
} from "./theme/useGridThemeFromMantine";
export {
  formatClipboardReport,
  notifyClipboardReport,
  type ClipboardReportMessage,
  type NotifyClipboardReportOptions,
} from "./notifications/notifyClipboardReport";
export type { ClipboardReport, ConflictResolution, SchemaGridEvents } from "./internal/grid-contracts";
