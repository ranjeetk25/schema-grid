/**
 * Header column-menu contract (framework-free). `SchemaHeader` renders a `⋯`
 * button (`.sg-header-menu`) and opens the menu on click or `contextmenu`;
 * the menu UI itself is a slot: pass `headerMenu` to `<SchemaGrid>` (e.g.
 * ui-mantine's `MantineHeaderMenu`). Without one, a minimal built-in menu
 * (`DefaultHeaderMenu`, AG-menu styled) is used.
 *
 * Grid-side actions go through AG Grid Community APIs (`applyColumnState`,
 * `autoSizeColumns`, `showColumnFilter`), so the existing sort/pin/visibility
 * listeners capture them into the view (`onViewChange`). `groupBy`,
 * `editColumn` and `insertColumn` are host callbacks and are present only
 * when the matching `SchemaGrid` prop is supplied.
 */
import type { ComponentType } from "react";
import type { ColumnDef } from "../internal/core";

export type HeaderMenuSortState = "asc" | "desc" | null;
export type HeaderMenuPinnedState = "left" | "right" | null;

export interface HeaderMenuColumn {
  colId: string;
  label: string;
  /** The schema column behind the header (undefined for non-schema columns). */
  schemaColumn: ColumnDef | undefined;
}

export interface HeaderMenuActions {
  sortAsc(): void;
  sortDesc(): void;
  clearSort(): void;
  pinLeft(): void;
  pinRight(): void;
  unpin(): void;
  /** Autosize this column to its content. */
  autosize(): void;
  /** Autosize every column. */
  autosizeAll(): void;
  hide(): void;
  /** Opens the column filter anchored at the header's filter button. */
  openFilter(): void;
  /** Host callback (`SchemaGrid.onGroupByColumn`); absent when not provided. */
  groupBy?(): void;
  /** Host callback (`SchemaGrid.onEditColumn`); absent when not provided. */
  editColumn?(): void;
  /** Host callback (`SchemaGrid.onInsertColumn`); absent when not provided. */
  insertColumn?(side: "left" | "right"): void;
  sortState: HeaderMenuSortState;
  pinnedState: HeaderMenuPinnedState;
  /** false for `sortable: false` columns (or when the data source cannot sort them): hide the sort items. */
  canSort: boolean;
  canFilter: boolean;
  canGroup: boolean;
}

export interface HeaderMenuProps {
  column: HeaderMenuColumn;
  /** The element the menu should anchor to (the `⋯` button, or the header cell for a context-menu open). */
  anchor: HTMLElement;
  opened: boolean;
  onClose(): void;
  actions: HeaderMenuActions;
}

export type HeaderMenuComponent = ComponentType<HeaderMenuProps>;

/** Host callbacks the header menu can offer; threaded to `SchemaHeader` via the grid context. */
export interface HeaderMenuHostCallbacks {
  onGroupByColumn?(colId: string): void;
  onEditColumn?(colId: string): void;
  onInsertColumn?(colId: string, side: "left" | "right"): void;
}

/** What `SchemaHeader` reads off the grid context (`context.headerMenu`). */
export interface HeaderMenuContext extends HeaderMenuHostCallbacks {
  component?: HeaderMenuComponent;
}
