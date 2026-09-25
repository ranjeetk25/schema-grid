import {
  ArrowDownWideNarrowIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ArrowUpNarrowWideIcon,
  BetweenVerticalEndIcon,
  BetweenVerticalStartIcon,
  CheckIcon,
  ChevronsLeftRightIcon,
  EyeOffIcon,
  GroupIcon,
  ListFilterIcon,
  MoveHorizontalIcon,
  PencilIcon,
  PinOffIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SG_ROOT, cn } from "../lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import type { HeaderMenuComponent, HeaderMenuProps } from "./contract";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const rectOf = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

function Item({
  icon,
  label,
  checked,
  disabled,
  hint,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  checked?: boolean;
  disabled?: boolean;
  hint?: string;
  onSelect(): void;
}) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      {icon}
      <span data-slot="header-menu-label" className="sg:flex-1 sg:truncate">
        {label}
      </span>
      {checked ? <CheckIcon aria-hidden data-testid="header-menu-check" className="sg:ml-auto sg:size-3.5 sg:!text-primary" /> : null}
      {hint && !checked ? (
        <span aria-hidden className="sg:ml-auto sg:pl-4 sg:font-mono sg:text-2xs sg:text-faint-foreground">
          {hint}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}

/**
 * Column header menu (Radix DropdownMenu), controlled by `opened` / `onClose`
 * and anchored to `anchor` through a zero-chrome virtual trigger laid over
 * the anchor's rect (portalled to <body>, so transformed / clipped header
 * ancestors never offset it). Every action runs, then the menu closes (Radix
 * reports the close through `onClose`). Optional items render only when their
 * callback exists (Group by also needs `canGroup`).
 */
export const ShadcnHeaderMenu: HeaderMenuComponent = function ShadcnHeaderMenu({ column, anchor, opened, onClose, actions }: HeaderMenuProps) {
  const [rect, setRect] = useState<Rect>(() => rectOf(anchor));
  // One close report per opening: Radix can signal "close" more than once
  // (item select, then focus / pointer outside) before the host re-renders.
  const closeReported = useRef(false);
  useEffect(() => {
    if (opened) closeReported.current = false;
  }, [opened]);
  const close = () => {
    if (closeReported.current) return;
    closeReported.current = true;
    onClose();
  };

  useLayoutEffect(() => {
    if (!opened) return;
    setRect(rectOf(anchor));
    const update = () => setRect(rectOf(anchor));
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [opened, anchor]);

  const { sortState, pinnedState, canFilter, canGroup } = actions;
  /** Every action runs first, then the menu reports its close (once). */
  const run = (action: () => void) => () => {
    action();
    close();
  };
  const showGroup = typeof actions.groupBy === "function" && canGroup;
  // `sortable: false` / capability-limited columns: no sort section at all (v0.2 C1).
  const canSort = actions.canSort !== false;
  const showEdit = typeof actions.editColumn === "function";
  const showInsert = typeof actions.insertColumn === "function";

  const trigger =
    typeof document === "undefined"
      ? null
      : createPortal(
          <DropdownMenuTrigger asChild>
            <span
              data-slot="header-menu-anchor"
              aria-label={`${column.label} column`}
              tabIndex={-1}
              className={cn(SG_ROOT, "sg:pointer-events-none sg:fixed sg:opacity-0")}
              style={{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }}
            />
          </DropdownMenuTrigger>,
          document.body,
        );

  return (
    <DropdownMenu
      open={opened}
      modal={false}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      {trigger}
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="sg:w-56"
        onCloseAutoFocus={(event) => {
          // Return focus to the header, not the invisible trigger.
          event.preventDefault();
          anchor.focus?.({ preventScroll: true });
        }}
      >
        {canSort ? (
          <>
            <Item
              icon={<ArrowUpNarrowWideIcon />}
              label="Sort ascending"
              checked={sortState === "asc"}
              onSelect={run(() => actions.sortAsc())}
            />
            <Item
              icon={<ArrowDownWideNarrowIcon />}
              label="Sort descending"
              checked={sortState === "desc"}
              onSelect={run(() => actions.sortDesc())}
            />
            <Item icon={<XIcon />} label="Clear sort" disabled={sortState === null} onSelect={run(() => actions.clearSort())} />
            <DropdownMenuSeparator />
          </>
        ) : null}
        <Item icon={<ArrowLeftToLineIcon />} label="Pin left" checked={pinnedState === "left"} onSelect={run(() => actions.pinLeft())} />
        <Item icon={<ArrowRightToLineIcon />} label="Pin right" checked={pinnedState === "right"} onSelect={run(() => actions.pinRight())} />
        <Item icon={<PinOffIcon />} label="Unpin" disabled={pinnedState === null} onSelect={run(() => actions.unpin())} />
        <DropdownMenuSeparator />
        <Item icon={<MoveHorizontalIcon />} label="Autosize column" onSelect={run(() => actions.autosize())} />
        <Item icon={<ChevronsLeftRightIcon />} label="Autosize all columns" onSelect={run(() => actions.autosizeAll())} />
        <DropdownMenuSeparator />
        <Item icon={<ListFilterIcon />} label="Filter…" hint="⌘↵" disabled={!canFilter} onSelect={run(() => actions.openFilter())} />
        {showGroup ? <Item icon={<GroupIcon />} label="Group by" onSelect={run(() => actions.groupBy?.())} /> : null}
        {showEdit || showInsert ? <DropdownMenuSeparator /> : null}
        {showEdit ? <Item icon={<PencilIcon />} label="Edit column…" onSelect={run(() => actions.editColumn?.())} /> : null}
        {showInsert ? (
          <>
            <Item icon={<BetweenVerticalStartIcon />} label="Insert column left" onSelect={run(() => actions.insertColumn?.("left"))} />
            <Item icon={<BetweenVerticalEndIcon />} label="Insert column right" onSelect={run(() => actions.insertColumn?.("right"))} />
          </>
        ) : null}
        <DropdownMenuSeparator />
        <Item icon={<EyeOffIcon />} label="Hide column" onSelect={run(() => actions.hide())} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
