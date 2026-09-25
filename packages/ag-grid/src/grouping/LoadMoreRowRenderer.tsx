/**
 * Full-width "load more" row shown after a partially loaded server group
 * (plan Deviation 4). Also home of the grouping actions both full-width
 * renderers read from AG Grid's `context.grouping`.
 */
import type { GridRow } from "../internal/core";
import type { CustomCellRendererProps } from "ag-grid-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import type { LoadMoreDisplayRow } from "./clientGroups";

/** What `useSchemaGrid` puts at `context.grouping`. */
export interface GroupingActions {
  toggle(groupId: string): void;
  loadMore(id: string): void;
}

export function getGroupingActions(ctx: unknown): GroupingActions | undefined {
  if (!ctx || typeof ctx !== "object") return undefined;
  const grouping = (ctx as { grouping?: unknown }).grouping;
  if (!grouping || typeof grouping !== "object") return undefined;
  const g = grouping as Partial<GroupingActions>;
  return typeof g.toggle === "function" && typeof g.loadMore === "function" ? (g as GroupingActions) : undefined;
}

/** Indentation (px) for a full-width row at `level`. */
export function groupIndent(level: number): number {
  return 8 + level * 20;
}

export function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

/**
 * Enter/Space while AG Grid has focus on the full-width row element itself
 * (`eGridCell` is the row element for full-width renderers) runs `action`.
 */
export function useRowActivation(el: HTMLElement | undefined, action: () => void): void {
  const latest = useRef(action);
  latest.current = action;
  useEffect(() => {
    if (!el) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== el || !isActivationKey(event.key)) return;
      event.preventDefault();
      latest.current();
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [el]);
}

export function LoadMoreRowRenderer<Row extends GridRow = GridRow>(props: CustomCellRendererProps<Row>) {
  const data = props.data as unknown as LoadMoreDisplayRow | undefined;
  const actions = getGroupingActions(props.context);
  const run = () => {
    if (data) actions?.loadMore(data.id);
  };
  useRowActivation(props.eGridCell, run);
  if (!data) return null;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isActivationKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };
  return (
    <div className="sg-load-more" style={{ paddingLeft: groupIndent(data.groupPath.length) }}>
      <button
        type="button"
        className="sg-load-more-button"
        aria-label={`Load more rows (${data.loaded} of ${data.total} loaded)`}
        onClick={run}
        onKeyDown={onKeyDown}
      >
        Load more ({data.loaded} of {data.total})
      </button>
    </div>
  );
}
