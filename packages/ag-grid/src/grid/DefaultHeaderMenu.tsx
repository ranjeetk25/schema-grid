/**
 * Framework-free column menu used when `SchemaGrid` gets no `headerMenu`.
 * A small `role="menu"` list positioned under the anchor (portaled into the
 * grid's themed root so the theme part styles it; `position: fixed`).
 * ArrowUp/ArrowDown/Home/End move focus, Escape or an outside click closes.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HeaderMenuProps } from "./headerMenu";

type Item = { key: string; label: string; onSelect(): void; checked?: boolean } | { key: string; separator: true };

function items({ actions }: HeaderMenuProps): Item[] {
  const list: Item[] = [];
  if (actions.canSort) {
    list.push(
      { key: "asc", label: "Sort ascending", onSelect: actions.sortAsc, checked: actions.sortState === "asc" },
      { key: "desc", label: "Sort descending", onSelect: actions.sortDesc, checked: actions.sortState === "desc" },
    );
  }
  if (actions.canSort && actions.sortState) list.push({ key: "clear-sort", label: "Clear sort", onSelect: actions.clearSort });
  if (actions.canFilter) list.push({ key: "filter", label: "Filter…", onSelect: actions.openFilter });
  if (actions.groupBy) list.push({ key: "group", label: "Group by this column", onSelect: actions.groupBy });
  list.push({ key: "sep-1", separator: true });
  if (actions.pinnedState !== "left") list.push({ key: "pin-left", label: "Pin left", onSelect: actions.pinLeft });
  if (actions.pinnedState !== "right") list.push({ key: "pin-right", label: "Pin right", onSelect: actions.pinRight });
  if (actions.pinnedState) list.push({ key: "unpin", label: "Unpin", onSelect: actions.unpin });
  list.push(
    { key: "sep-2", separator: true },
    { key: "autosize", label: "Autosize column", onSelect: actions.autosize },
    { key: "autosize-all", label: "Autosize all columns", onSelect: actions.autosizeAll },
  );
  const insert = actions.insertColumn;
  if (actions.editColumn || insert) list.push({ key: "sep-3", separator: true });
  if (actions.editColumn) list.push({ key: "edit", label: "Edit column…", onSelect: actions.editColumn });
  if (insert) {
    list.push({ key: "insert-left", label: "Insert column left", onSelect: () => insert("left") });
    list.push({ key: "insert-right", label: "Insert column right", onSelect: () => insert("right") });
  }
  list.push({ key: "sep-4", separator: true }, { key: "hide", label: "Hide column", onSelect: actions.hide });
  return list;
}

function portalTarget(anchor: HTMLElement): HTMLElement {
  return (anchor.closest(".ag-root-wrapper")?.parentElement as HTMLElement | null) ?? document.body;
}

export function DefaultHeaderMenu(props: HeaderMenuProps): ReactNode {
  const { anchor, opened, onClose, column } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!opened) return;
    const r = anchor.getBoundingClientRect();
    const width = 208;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 4, left });
  }, [opened, anchor]);

  useEffect(() => {
    if (!opened) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (ref.current?.contains(t) || anchor.contains(t))) return;
      onClose();
    };
    // Escape closes even when focus stayed on the header (e.g. right-click open).
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    // Focus the first item after AG Grid's own header focus handling has run.
    const focusTimer = setTimeout(() => {
      if (!ref.current?.contains(document.activeElement)) {
        ref.current?.querySelector<HTMLElement>("[data-sg-menu-item]")?.focus();
      }
    }, 0);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [opened, anchor, onClose]);

  if (!opened) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focusables = [...(ref.current?.querySelectorAll<HTMLElement>("[data-sg-menu-item]") ?? [])];
    const i = focusables.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => focusables[(n + focusables.length) % focusables.length]?.focus();
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(focusables.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const menu = (
    <div
      ref={ref}
      role="menu"
      aria-label={`Column menu: ${column.label}`}
      className="sg-menu"
      style={{ position: "fixed", top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      onKeyDown={onKeyDown}
    >
      {items(props).map((item) =>
        "separator" in item ? (
          <hr key={item.key} className="sg-menu-separator" />
        ) : (
          <button
            key={item.key}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.checked === undefined ? undefined : item.checked}
            tabIndex={-1}
            data-sg-menu-item=""
            className="sg-menu-item"
            onClick={item.onSelect}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
  return createPortal(menu, portalTarget(anchor));
}
