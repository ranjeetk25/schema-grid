import { Menu, Text, Tooltip } from "@mantine/core";
import {
  IconArrowAutofitContent,
  IconArrowAutofitWidth,
  IconArrowsSort,
  IconCheck,
  IconColumnInsertLeft,
  IconColorSwatch,
  IconColumnInsertRight,
  IconEyeOff,
  IconFilter,
  IconLayoutList,
  IconPencil,
  IconPinned,
  IconPinnedOff,
  IconSortAscending,
  IconSortDescending,
} from "../internal/icons";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CELL_COLOR_PALETTE, CellColorSwatch } from "../theme/cellColorPalette";
import { useCellColorFilter } from "./cellColorFilterContext";
import type { HeaderMenuProps } from "./contracts";

const ICON = { size: 16, stroke: 1.75 } as const;

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Rule 6: one muted mono shortcut string. */
function Hint({ children }: { children: ReactNode }) {
  return (
    <Text component="span" ff="monospace" fz={11} c="dimmed" style={{ opacity: 0.6 }} aria-hidden>
      {children}
    </Text>
  );
}

const check = <IconCheck {...ICON} aria-hidden style={{ color: "var(--mantine-primary-color-filled)" }} />;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Mantine column menu for ag-grid's `SchemaHeader` slot:
 * `<SchemaGrid headerMenu={MantineHeaderMenu} …/>`.
 *
 * Sections: sort (only when `actions.canSort`) · filter / filter by color / group · pin · autosize · edit / insert · hide.
 * v0.4 "Filter by color" (palette swatches, "No color", "Clear color filter")
 * shows only inside a `CellColorFilterProvider` (the workbench provides one
 * when the source filters by color). v0.4.1: when the provider's
 * `blockedReason(colId)` answers (a color rule the server can't evaluate
 * colors this column), the item is disabled with the reason as a tooltip.
 * Host-only actions (`groupBy`, `editColumn`, `insertColumn`) appear only when
 * the grid got the matching callback. The menu portals to `document.body`
 * (it is not inside an AG Grid popup, so that is safe) and anchors to a fixed
 * box over `anchor` (the `⋯` button, or the header cell on right-click).
 * Clicks on the anchor itself don't count as outside clicks, so the `⋯`
 * button toggles instead of close-then-reopen.
 */
export function MantineHeaderMenu({ column, anchor, opened, onClose, actions }: HeaderMenuProps) {
  const [rect, setRect] = useState<Rect | null>(null);
  const colorFilter = useCellColorFilter();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!opened) return;
    const r = anchor.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [opened, anchor]);

  useEffect(() => {
    if (!opened) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (dropdownRef.current?.contains(t) || anchor.contains(t))) return;
      onClose();
    };
    // Escape closes even when focus stayed on the header (right-click open).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const onScroll = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [opened, anchor, onClose]);

  if (!opened || !rect || typeof document === "undefined") return null;

  const pinned = actions.pinnedState;
  const sort = actions.sortState;
  const hasHostEdits = Boolean(actions.editColumn || actions.insertColumn);
  const insert = actions.insertColumn;
  // `sortable: false` / capability-limited columns: no sort section at all (v0.2 C1).
  const canSort = actions.canSort !== false;
  const hasFilterGroup = Boolean(actions.canFilter || colorFilter || (actions.groupBy && actions.canGroup));
  const activeColors = colorFilter?.activeColors(column.colId) ?? null;
  const blocked = colorFilter?.blockedReason?.(column.colId) ?? null;
  const blockedHint = blocked ? `Can't filter by color: ${blocked}` : null;
  const pickColor = (colors: Parameters<NonNullable<typeof colorFilter>["filterByColor"]>[1]) => {
    colorFilter?.filterByColor(column.colId, colors);
    onClose();
  };

  return createPortal(
    <Menu
      opened
      onChange={(o) => {
        if (!o) onClose();
      }}
      withinPortal={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      position="bottom-start"
      offset={4}
      width={232}
      trapFocus
      returnFocus={false}
    >
      <Menu.Target>
        {/* Mantine labels the dropdown by its target (aria-labelledby), so the target carries the name. */}
        <span
          aria-label={`Column menu: ${column.label}`}
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width, height: rect.height, pointerEvents: "none" }}
        />
      </Menu.Target>
      <Menu.Dropdown ref={dropdownRef} data-sg-header-menu="">
        {canSort ? (
          <>
            <Menu.Item leftSection={<IconSortAscending {...ICON} />} rightSection={sort === "asc" ? check : null} onClick={actions.sortAsc}>
              Sort ascending
            </Menu.Item>
            <Menu.Item leftSection={<IconSortDescending {...ICON} />} rightSection={sort === "desc" ? check : null} onClick={actions.sortDesc}>
              Sort descending
            </Menu.Item>
            {sort ? (
              <Menu.Item leftSection={<IconArrowsSort {...ICON} />} onClick={actions.clearSort}>
                Clear sort
              </Menu.Item>
            ) : null}
          </>
        ) : null}

        {canSort && hasFilterGroup ? <Menu.Divider /> : null}
        {actions.canFilter ? (
          <Menu.Item leftSection={<IconFilter {...ICON} />} rightSection={<Hint>{isMac() ? "⌘↵" : "Ctrl+↵"}</Hint>} onClick={actions.openFilter}>
            Filter…
          </Menu.Item>
        ) : null}
        {colorFilter && blockedHint ? (
          // v0.4.1: blocked by a color rule. `data-disabled` (not `disabled`) keeps hover, so the tooltip shows.
          <Tooltip label={blockedHint} position="right" multiline w={260} withinPortal={false}>
            <Menu.Item
              leftSection={<IconColorSwatch {...ICON} />}
              data-disabled
              aria-disabled
              aria-description={blockedHint}
              closeMenuOnClick={false}
              onClick={(e) => e.preventDefault()}
            >
              Filter by color
            </Menu.Item>
          </Tooltip>
        ) : colorFilter ? (
          <Menu.Sub position="right-start" offset={4}>
            <Menu.Sub.Target>
              <Menu.Sub.Item leftSection={<IconColorSwatch {...ICON} />}>Filter by color</Menu.Sub.Item>
            </Menu.Sub.Target>
            <Menu.Sub.Dropdown data-sg-color-filter-menu="">
              {CELL_COLOR_PALETTE.map((p) => {
                const on = Array.isArray(activeColors) && activeColors.includes(p.color);
                return (
                  <Menu.Item
                    key={p.color}
                    leftSection={<CellColorSwatch color={p.color} size={14} />}
                    rightSection={on ? check : null}
                    data-active={on || undefined}
                    onClick={() => pickColor([p.color])}
                  >
                    {p.label}
                  </Menu.Item>
                );
              })}
              <Menu.Item
                leftSection={<CellColorSwatch color={null} size={14} />}
                rightSection={activeColors === "none" ? check : null}
                data-active={activeColors === "none" || undefined}
                onClick={() => pickColor("none")}
              >
                No color
              </Menu.Item>
              {activeColors !== null ? (
                <>
                  <Menu.Divider />
                  <Menu.Item onClick={() => pickColor(null)}>Clear color filter</Menu.Item>
                </>
              ) : null}
            </Menu.Sub.Dropdown>
          </Menu.Sub>
        ) : null}
        {actions.groupBy && actions.canGroup ? (
          <Menu.Item leftSection={<IconLayoutList {...ICON} />} onClick={actions.groupBy}>
            Group by this column
          </Menu.Item>
        ) : null}

        {canSort || hasFilterGroup ? <Menu.Divider /> : null}
        <Menu.Item leftSection={<IconPinned {...ICON} />} rightSection={pinned === "left" ? check : null} onClick={actions.pinLeft}>
          Pin left
        </Menu.Item>
        <Menu.Item leftSection={<IconPinned {...ICON} style={{ transform: "scaleX(-1)" }} />} rightSection={pinned === "right" ? check : null} onClick={actions.pinRight}>
          Pin right
        </Menu.Item>
        {pinned ? (
          <Menu.Item leftSection={<IconPinnedOff {...ICON} />} onClick={actions.unpin}>
            Unpin
          </Menu.Item>
        ) : null}

        <Menu.Divider />
        <Menu.Item leftSection={<IconArrowAutofitWidth {...ICON} />} onClick={actions.autosize}>
          Autosize this column
        </Menu.Item>
        <Menu.Item leftSection={<IconArrowAutofitContent {...ICON} />} onClick={actions.autosizeAll}>
          Autosize all columns
        </Menu.Item>

        {hasHostEdits ? <Menu.Divider /> : null}
        {actions.editColumn ? (
          <Menu.Item leftSection={<IconPencil {...ICON} />} onClick={actions.editColumn}>
            Edit column…
          </Menu.Item>
        ) : null}
        {insert ? (
          <>
            <Menu.Item leftSection={<IconColumnInsertLeft {...ICON} />} onClick={() => insert("left")}>
              Insert column left
            </Menu.Item>
            <Menu.Item leftSection={<IconColumnInsertRight {...ICON} />} onClick={() => insert("right")}>
              Insert column right
            </Menu.Item>
          </>
        ) : null}

        <Menu.Divider />
        <Menu.Item leftSection={<IconEyeOff {...ICON} />} onClick={actions.hide}>
          Hide column
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>,
    document.body,
  );
}
