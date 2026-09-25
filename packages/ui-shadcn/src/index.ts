export const SCHEMA_GRID_UI_SHADCN_VERSION = "0.0.1";

// Subpath areas (also importable as ./editors, ./filter-builder, ./column-builder, ./import-export)
export * from "./filter-builder";
export * from "./import-export";

// Root-only areas
export { ViewSwitcher, type ViewSwitcherProps } from "./views/ViewSwitcher";
export { GroupByBar, type GroupByBarProps } from "./views/GroupByBar";
export { ConflictPopover, type ConflictAnchor, type ConflictPopoverProps } from "./conflict/ConflictPopover";
export { RemoteChangedBadge, type RemoteChangedBadgeProps } from "./conflict/RemoteChangedBadge";
export { useShadcnConflictPrompt, type ShadcnConflictPrompt } from "./conflict/useShadcnConflictPrompt";
export {
  resolveGridThemeParams,
  shadcnGridCssVariables,
  useGridThemeFromShadcn,
  type GridColorScheme,
  type GridCssVariables,
  type GridThemeFromShadcn,
  type GridThemeParams,
  type UseGridThemeFromShadcnOptions,
} from "./theme/useGridThemeFromShadcn";
export {
  formatClipboardReport,
  notifyClipboardReport,
  type ClipboardReportMessage,
  type NotifyClipboardReportOptions,
} from "./notifications/notifyClipboardReport";
export type { ClipboardReport, ConflictResolution, SchemaGridEvents } from "./internal/grid-contracts";
