import { Menu, Text } from "@mantine/core";
import {
  IconArrowAutofitContent,
  IconArrowAutofitWidth,
  IconArrowsSort,
  IconCheck,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconEyeOff,
  IconFilter,
  IconLayoutList,
  IconPencil,
  IconPinned,
  IconPinnedOff,
  IconSortAscending,
  IconSortDescending,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * Sections: sort · filter / group · pin · autosize · edit / insert · hide.
 * Host-only actions (`groupBy`, `editColumn`, `insertColumn`) appear only when
 * the grid got the matching callback. The menu portals to `document.body`
 * (it is not inside an AG Grid popup, so that is safe) and anchors to a fixed
 * box over `anchor` (the `⋯` button, or the header cell on right-click).
 * Clicks on the anchor itself don't count as outside clicks, so the `⋯`
 * button toggles instead of close-then-reopen.
 */
export function MantineHeaderMenu({ column, anchor, opened, onClose, actions }: HeaderMenuProps) {
  const [rect, setRect] = useState<Rect | null>(null);
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

        {actions.canFilter || (actions.groupBy && actions.canGroup) ? <Menu.Divider /> : null}
        {actions.canFilter ? (
          <Menu.Item leftSection={<IconFilter {...ICON} />} rightSection={<Hint>{isMac() ? "⌘↵" : "Ctrl+↵"}</Hint>} onClick={actions.openFilter}>
            Filter…
          </Menu.Item>
        ) : null}
        {actions.groupBy && actions.canGroup ? (
          <Menu.Item leftSection={<IconLayoutList {...ICON} />} onClick={actions.groupBy}>
            Group by this column
          </Menu.Item>
        ) : null}

        <Menu.Divider />
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
