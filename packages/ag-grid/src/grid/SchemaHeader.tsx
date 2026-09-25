/**
 * `SchemaHeader`: the column header `compileColumns` puts on every column
 * (see docs/design/README.md, "No floating-filter row").
 *
 * Renders the label (`.ag-header-cell-text`, label text only), a sort
 * indicator and a filter icon button (`.sg-header-filter`). The button is
 * hidden until the header cell is hovered/focused (CSS in the theme part) and
 * stays visible, accent-tinted (`.sg-header-filter-active`) while the column
 * has an active filter.
 *
 * - Click on the label area → `progressSort(shiftKey)` when sortable. Mouse
 *   down is left alone so AG Grid's column drag and resize keep working.
 * - Click on the filter button → `showFilter(button)` (propagation stopped so
 *   it doesn't sort).
 * - `⋯` button (`.sg-header-menu`) and right-click (`contextmenu`) open the
 *   column menu: `context.headerMenu.component` (e.g. ui-mantine's
 *   `MantineHeaderMenu`) or the framework-free `DefaultHeaderMenu`; see
 *   `headerMenu.ts` for the contract.
 * - The filter + `⋯` controls live in `.sg-header-actions`, an overlay
 *   revealed on hover/focus so they never take width from the label; with an
 *   active filter the group sits in flow and only the filter button shows
 *   until hover (CSS only — the button element never remounts).
 * - Keyboard: AG Grid's header navigation keeps focus on the header cell, so
 *   the button is `tabIndex={-1}`; `schemaHeaderKeyboardEvent` (wired as
 *   `suppressHeaderKeyboardEvent`) opens the filter on Ctrl/Cmd+Enter,
 *   Shift+Enter or Alt+ArrowDown. Plain Enter keeps AG Grid's sort.
 */
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Column, SortDirection, SuppressHeaderKeyboardEventParams } from "ag-grid-community";
import type { CustomHeaderProps } from "ag-grid-react";
import type { ColumnDef } from "../internal/core";
import { DefaultHeaderMenu } from "./DefaultHeaderMenu";
import type { HeaderMenuContext } from "./headerMenu";
import { createHeaderMenuActions } from "./headerMenuActions";

export type SchemaHeaderProps = CustomHeaderProps & {
  /** `headerComponentParams.ghost`: the draft column preview (label only, no sort/filter/menu). */
  ghost?: boolean;
};

export const SG_HEADER_CLASSES = {
  root: "sg-header",
  label: "sg-header-label",
  sort: "sg-header-sort",
  sortIndex: "sg-header-sort-index",
  actions: "sg-header-actions",
  menu: "sg-header-menu",
  filter: "sg-header-filter",
  filterActive: "sg-header-filter-active",
  filterDot: "sg-header-filter-dot",
} as const;

interface SortState {
  sort: SortDirection | undefined;
  /** 1-based position in a multi-column sort; null when only one column is sorted. */
  position: number | null;
}

function sortOf(column: Column, api: SchemaHeaderProps["api"] | undefined): SortState {
  const sort = column.getSort() ?? undefined;
  if (!sort) return { sort, position: null };
  const index = column.getSortIndex();
  const state = api?.getColumnState?.();
  const sortedCount = Array.isArray(state) ? state.filter((s) => s.sort).length : 0;
  return { sort, position: sortedCount > 1 && typeof index === "number" ? index + 1 : null };
}

function SortIcon({ direction }: { direction: "asc" | "desc" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      {direction === "asc" ? (
        <path d="M8 13V3m0 0L4 7m4-4 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M8 3v10m0 0-4-4m4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function headerMenuContext(context: unknown): HeaderMenuContext | undefined {
  if (!context || typeof context !== "object") return undefined;
  const hm = (context as { headerMenu?: unknown }).headerMenu;
  return hm && typeof hm === "object" ? (hm as HeaderMenuContext) : undefined;
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4 4h16v2.17a2 2 0 0 1-.59 1.42L15 12v7l-6 2v-8.5L4.52 7.56A2 2 0 0 1 4 6.21V4z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SchemaHeader(props: SchemaHeaderProps) {
  const { column, displayName, enableSorting, progressSort, showFilter } = props;
  const [filterActive, setFilterActive] = useState(() => column.isFilterActive());
  const [sort, setSort] = useState(() => sortOf(column, props.api));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const filterRef = useRef<HTMLButtonElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const api = props.api;
    const onFilter = () => setFilterActive(column.isFilterActive());
    const onSort = () => setSort(sortOf(column, api));
    onFilter();
    onSort();
    column.addEventListener("filterActiveChanged", onFilter);
    column.addEventListener("sortChanged", onSort);
    // Multi-sort indexes of *other* columns change this one's index too.
    api?.addEventListener?.("sortChanged", onSort);
    return () => {
      column.removeEventListener("filterActiveChanged", onFilter);
      column.removeEventListener("sortChanged", onSort);
      if (api && !api.isDestroyed?.()) api.removeEventListener?.("sortChanged", onSort);
    };
  }, [column, props.api]);

  // Right-click anywhere on the header cell opens the column menu.
  const eGridHeader = props.eGridHeader as HTMLElement | undefined;
  const ghost = props.ghost === true;
  useEffect(() => {
    if (!eGridHeader || ghost) return;
    const onContextMenu = (event: globalThis.MouseEvent) => {
      event.preventDefault();
      setMenuAnchor(eGridHeader);
    };
    eGridHeader.addEventListener("contextmenu", onContextMenu);
    return () => eGridHeader.removeEventListener("contextmenu", onContextMenu);
  }, [eGridHeader, ghost]);

  const hasFilter = props.enableFilterButton || column.isFilterAllowed();
  const sortable = enableSorting === true;
  const label = displayName;
  const filterName = filterActive ? `Filter ${label} (active)` : `Filter ${label}`;

  const onLabelClick = (event: MouseEvent) => {
    if (!sortable) return;
    progressSort(event.shiftKey);
  };

  const onFilterClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    showFilter(event.currentTarget);
  };

  const closeMenu = useCallback(() => {
    setMenuAnchor(null);
    eGridHeader?.focus?.();
  }, [eGridHeader]);

  const onMenuClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const target = event.currentTarget;
    setMenuAnchor((open) => (open ? null : target));
  };

  const filterButton = hasFilter ? (
    <button
      ref={filterRef}
      type="button"
      tabIndex={-1}
      className={filterActive ? `${SG_HEADER_CLASSES.filter} ${SG_HEADER_CLASSES.filterActive}` : SG_HEADER_CLASSES.filter}
      aria-label={filterName}
      aria-haspopup="dialog"
      title={filterName}
      onClick={onFilterClick}
    >
      <FilterIcon />
      {filterActive ? <span className={SG_HEADER_CLASSES.filterDot} aria-hidden="true" /> : null}
    </button>
  ) : null;

  const menuCtx = headerMenuContext(props.context);
  // Pin the menu component while it is open: a host passing a new component
  // identity on re-render must not remount (and so close) an open menu.
  const liveMenu = menuCtx?.component ?? DefaultHeaderMenu;
  const pinnedMenu = useRef(liveMenu);
  if (menuAnchor === null) pinnedMenu.current = liveMenu;
  const Menu = pinnedMenu.current;
  const menuOpen = menuAnchor !== null;
  const schemaColumn = (column.getColDef?.()?.cellRendererParams as { schemaColumn?: ColumnDef } | undefined)?.schemaColumn;

  if (ghost) {
    return (
      <div className={SG_HEADER_CLASSES.root}>
        <div className={SG_HEADER_CLASSES.label}>
          <span className="ag-header-cell-text">{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={SG_HEADER_CLASSES.root}
      data-sortable={sortable || undefined}
      data-menu-open={menuOpen || undefined}
      data-filter-active={filterActive || undefined}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard sorting is AG Grid's own Enter on the focused header cell; this click is the pointer path only. */}
      <div className={SG_HEADER_CLASSES.label} onClick={onLabelClick}>
        <span className="ag-header-cell-text">{label}</span>
        {sortable && (sort.sort === "asc" || sort.sort === "desc") ? (
          <span className={SG_HEADER_CLASSES.sort} data-sort={sort.sort}>
            <SortIcon direction={sort.sort} />
            {sort.position !== null ? <span className={SG_HEADER_CLASSES.sortIndex}>{sort.position}</span> : null}
          </span>
        ) : null}
      </div>
      {/*
       * The filter button is ALWAYS the same element in the same place: it is
       * the anchor of an open filter popup, and AG Grid closes a popup whose
       * anchor leaves the DOM (ticking a set-filter checkbox activates the
       * filter). Active vs. hover-revealed is pure CSS (`data-filter-active`).
       */}
      <span className={SG_HEADER_CLASSES.actions}>
        {filterButton}
        <button
          ref={menuButtonRef}
          type="button"
          tabIndex={-1}
          className={SG_HEADER_CLASSES.menu}
          aria-label={`Column menu: ${label}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Column menu"
          onClick={onMenuClick}
        >
          <DotsIcon />
        </button>
      </span>
      {menuAnchor ? (
        <Menu
          column={{ colId: column.getColId(), label, schemaColumn }}
          anchor={menuAnchor}
          opened={menuOpen}
          onClose={closeMenu}
          actions={createHeaderMenuActions({
            api: props.api,
            column,
            ...(menuCtx ? { host: menuCtx } : {}),
            openFilter: () => {
              const anchor = filterRef.current ?? eGridHeader;
              if (anchor) showFilter(anchor);
              else props.api.showColumnFilter(column.getColId());
            },
            after: () => setMenuAnchor(null),
          })}
        />
      ) : null}
    </div>
  );
}

function isFilterShortcut(event: KeyboardEvent): boolean {
  if (event.key === "Enter") return event.ctrlKey || event.metaKey || event.shiftKey;
  return event.key === "ArrowDown" && event.altKey;
}

/**
 * `colDef.suppressHeaderKeyboardEvent` for schema columns. Shift+F10 or the
 * ContextMenu key opens the column menu (via the `⋯` button). Ctrl/Cmd+Enter,
 * Shift+Enter or Alt+ArrowDown on a focused header cell open that column's
 * filter (anchored at its `.sg-header-filter` button, via a synthetic click so
 * `showFilter` positions it; `api.showColumnFilter` is the fallback) and are
 * suppressed. Every other key keeps AG Grid's default (plain Enter sorts).
 */
export function schemaHeaderKeyboardEvent(params: SuppressHeaderKeyboardEventParams): boolean {
  const event = params.event;
  if (event.type !== "keydown") return false;
  if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
    const target = event.target instanceof Element ? event.target : null;
    const menuButton = target?.closest(".ag-header-cell")?.querySelector<HTMLButtonElement>(`.${SG_HEADER_CLASSES.menu}`);
    if (!menuButton) return false;
    event.preventDefault();
    menuButton.click();
    return true;
  }
  if (!isFilterShortcut(event)) return false;
  const column = params.column as Column;
  if (typeof column.isFilterAllowed === "function" && !column.isFilterAllowed()) return false;
  event.preventDefault();
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(".ag-header-cell")?.querySelector<HTMLButtonElement>(`.${SG_HEADER_CLASSES.filter}`);
  if (button) button.click();
  else params.api.showColumnFilter(column.getColId());
  return true;
}
