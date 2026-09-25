import type { ComponentType } from "react";
import type { ColumnDef } from "../internal/core-contracts";

// TODO(ag-grid header menu): these types mirror the in-progress
// `packages/ag-grid/src/grid/headerMenu.ts` on main. Once that lands, delete
// this file and re-export them through `internal/grid-contracts.ts`:
//   export type { HeaderMenuActions, HeaderMenuColumn, HeaderMenuComponent, HeaderMenuPinnedState,
//     HeaderMenuProps, HeaderMenuSortState } from "@masai/schema-grid-ag-grid";

export type HeaderMenuSortState = "asc" | "desc" | null;
export type HeaderMenuPinnedState = "left" | "right" | null;
export interface HeaderMenuColumn { colId: string; label: string; schemaColumn: ColumnDef | undefined; }
export interface HeaderMenuActions {
  sortAsc(): void; sortDesc(): void; clearSort(): void;
  pinLeft(): void; pinRight(): void; unpin(): void;
  autosize(): void; autosizeAll(): void; hide(): void; openFilter(): void;
  groupBy?(): void; editColumn?(): void; insertColumn?(side: "left" | "right"): void;
  sortState: HeaderMenuSortState; pinnedState: HeaderMenuPinnedState; canFilter: boolean; canGroup: boolean;
}
export interface HeaderMenuProps { column: HeaderMenuColumn; anchor: HTMLElement; opened: boolean; onClose(): void; actions: HeaderMenuActions; }
export type HeaderMenuComponent = ComponentType<HeaderMenuProps>;
