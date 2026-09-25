/**
 * `CellShell`: wraps every column renderer (via the `wrapRenderer` seam) and
 * renders the fill handle in the range's bottom-right cell only.
 *
 * Each shell subscribes to the range store through `useStoreSelector`, but
 * selects a single boolean ("am I the bottom-right cell?"), so a range change
 * re-renders at most the old and the new bottom-right cell.
 *
 * Fill seam (T25): pointerdown on the handle calls
 * `context.onFillHandlePointerDown(event, pos)` when the grid context carries
 * one (read at event time, so it can be installed after mount).
 *
 * `wrapWithCellShell` returns a STABLE component per input renderer (WeakMap
 * cache), as `compileColumns` requires.
 */
import type { IRowNode } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { ComponentType, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { getSchemaGridStores } from "../grid/gridContext";
import type { GridRow } from "../internal/core";
import { useStoreSelector } from "../state/createStore";
import { createRangeStore } from "../state/rangeStore";
import { SG_CLASSES } from "../theme/classNames";
import { type CellPos, isBottomRight } from "./geometry";
import { isRangeableNode, normalizedRangeFor } from "./useRangeSelection";

/** Optional grid-context field T25 installs to start a fill drag. */
export interface FillHandleSeam {
  onFillHandlePointerDown?(event: ReactPointerEvent<HTMLElement>, pos: CellPos): void;
}

/** Used when the renderer runs outside a `useSchemaGrid` grid (hooks stay unconditional). */
const DETACHED_RANGE_STORE = createRangeStore();

function fillSeamOf(context: unknown): FillHandleSeam["onFillHandlePointerDown"] {
  if (!context || typeof context !== "object") return undefined;
  const fn = (context as FillHandleSeam).onFillHandlePointerDown;
  return typeof fn === "function" ? fn : undefined;
}

export function createCellShell<Row extends GridRow = GridRow>(
  Inner: ComponentType<CustomCellRendererProps<Row>>,
): ComponentType<CustomCellRendererProps<Row>> {
  function CellShell(props: CustomCellRendererProps<Row>): ReactElement {
    const store = getSchemaGridStores(props.context)?.range ?? DETACHED_RANGE_STORE;
    const node = props.node as IRowNode | undefined;
    const colId = props.column?.getColId();
    const rangeable = isRangeableNode(node) && colId !== undefined;
    const rowIndex = rangeable ? (node.rowIndex as number) : -1;
    const isHandleCell = useStoreSelector(store, (s) => {
      if (!rangeable || !props.api) return false;
      const n = normalizedRangeFor(props.api, s.range);
      return !!n && isBottomRight({ rowIndex, colId: colId as string }, n);
    });
    return (
      <>
        <Inner {...props} />
        {isHandleCell ? (
          <span
            className={SG_CLASSES.fillHandle}
            data-sg-fill-handle=""
            aria-hidden="true"
            onPointerDown={(event) => {
              fillSeamOf(props.context)?.(event, { rowIndex, colId: colId as string });
            }}
          />
        ) : null}
      </>
    );
  }
  CellShell.displayName = `CellShell(${Inner.displayName ?? Inner.name ?? "Renderer"})`;
  return CellShell;
}

const shellCache = new WeakMap<object, ComponentType<CustomCellRendererProps<never>>>();

/** Stable per input renderer; pass as the `wrapRenderer` seam. */
export function wrapWithCellShell<Row extends GridRow = GridRow>(
  renderer: ComponentType<CustomCellRendererProps<Row>>,
): ComponentType<CustomCellRendererProps<Row>> {
  const cached = shellCache.get(renderer);
  if (cached) return cached as unknown as ComponentType<CustomCellRendererProps<Row>>;
  const shell = createCellShell<Row>(renderer);
  shellCache.set(renderer, shell as unknown as ComponentType<CustomCellRendererProps<never>>);
  return shell;
}
