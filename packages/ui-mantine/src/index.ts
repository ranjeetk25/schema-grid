// Injected from package.json by tsup (`define`) and by vitest.config.ts; source
// consumers without either (e.g. the Storybook dev build) get the dev fallback.
declare const __SCHEMA_GRID_UI_MANTINE_VERSION__: string | undefined;
export const SCHEMA_GRID_UI_MANTINE_VERSION: string =
  typeof __SCHEMA_GRID_UI_MANTINE_VERSION__ === "string" ? __SCHEMA_GRID_UI_MANTINE_VERSION__ : "0.0.0-dev";

// Subpath areas (also importable as ./editors, ./filter-builder, ./column-builder, ./import-export)
export * from "./editors";
export * from "./filter-builder";
export * from "./column-builder";
export * from "./import-export";

// Root-only areas
export { ViewSwitcher, type ViewSwitcherProps } from "./views/ViewSwitcher";
export { GroupByBar, type GroupByBarProps } from "./views/GroupByBar";
export { ConflictPopover, initialsOf, type ConflictPopoverProps } from "./conflict/ConflictPopover";
export { MantineHeaderMenu, type HeaderMenuActions, type HeaderMenuColumn, type HeaderMenuProps } from "./header-menu";
export {
  MANTINE_SET_FILTER_TYPES,
  MantineConditionFilter,
  MantineSetFilter,
  mantineFilterComponentFor,
  type ColumnFilterOption,
} from "./column-filters";
export { RemoteChangedBadge, type RemoteChangedBadgeProps } from "./conflict/RemoteChangedBadge";
export { useMantineConflictPrompt, type MantineConflictPrompt } from "./conflict/useMantineConflictPrompt";
export {
  SG_BRAND,
  SG_FONT_FAMILY,
  SG_FONT_FAMILY_MONO,
  SG_ZINC,
  SG_ZINC_DARK,
  schemaGridMantineTheme,
  schemaGridMantineVariables,
} from "./theme/schemaGridMantineTheme";
export {
  gridCssVariables,
  mantineGridCssVariablesResolver,
  resolveGridThemeParams,
  schemaGridCssVariables,
  SG_GRID_FONT_SIZE,
  useGridThemeFromMantine,
  type GridCssVariables,
  type SchemaGridCssVariables,
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

// One-component page
export * from "./workbench";
