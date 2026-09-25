export const SCHEMA_GRID_UI_SHADCN_VERSION = "0.0.1";

// Subpath areas (also importable as ./editors, ./filter-builder, ./column-builder, ./import-export)
export * from "./editors";
export * from "./filter-builder";
export * from "./column-builder";
export * from "./import-export";

// Root-only areas
export { ShadcnHeaderMenu } from "./header-menu/ShadcnHeaderMenu";
export type {
  HeaderMenuActions,
  HeaderMenuColumn,
  HeaderMenuComponent,
  HeaderMenuPinnedState,
  HeaderMenuProps,
  HeaderMenuSortState,
} from "./header-menu/contract";
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

// Host toolbar primitives (the kit's own shadcn components, so a host's chrome
// around the grid matches it: 32px controls, Linear tooltips, segmented control).
export { Button, buttonVariants, type ButtonProps } from "./ui/button";
export { Badge, badgeVariants } from "./ui/badge";
export { Kbd } from "./ui/kbd";
export { Tooltip } from "./ui/tooltip";
export { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
export { Separator } from "./ui/separator";
export { Avatar, type AvatarProps } from "./ui/avatar";
export { SG_ROOT, cn } from "./lib/cn";
