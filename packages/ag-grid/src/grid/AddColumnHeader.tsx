/**
 * Header of the trailing `__sg_add__` column: a single "+" icon button
 * ("Add column at end") that calls `context.onAddColumn(position)`.
 */
import type { CustomHeaderProps } from "ag-grid-react";
import type { AddColumnPosition } from "../compile/syntheticColumns";
import { isSyntheticColumnId } from "../compile/syntheticColumns";

interface AddColumnContext {
  onAddColumn?(position: AddColumnPosition): void;
}

export function addColumnPosition(api: CustomHeaderProps["api"] | undefined): AddColumnPosition {
  const ids = (api?.getAllDisplayedColumns?.() ?? []).map((c) => c.getColId()).filter((id) => !isSyntheticColumnId(id));
  const last = ids.at(-1);
  return { index: ids.length, ...(last !== undefined ? { afterColumnId: last } : {}) };
}

export function AddColumnHeader(props: CustomHeaderProps) {
  const ctx = props.context as AddColumnContext | undefined;
  return (
    <div className="sg-header sg-header-add-wrap">
      <button
        type="button"
        className="sg-header-add"
        aria-label="Add column at end"
        title="Add column"
        onClick={(event) => {
          event.stopPropagation();
          ctx?.onAddColumn?.(addColumnPosition(props.api));
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
