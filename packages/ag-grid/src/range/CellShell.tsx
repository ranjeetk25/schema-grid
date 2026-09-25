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
 * one (read at event time, so it can be installed after mount). The listener
 * is NATIVE, on the handle element itself: AG Grid listens for pointerdown
 * natively on an ancestor, and a React handler (delegated to the React root,
 * above the grid) would run too late for the seam's `stopPropagation()` to
 * keep AG Grid from treating it as a cell mousedown.
 *
 * `wrapWithCellShell` returns a STABLE component per input renderer (WeakMap
 * cache), as `compileColumns` requires.
 */
import type { IRowNode } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import { type ComponentType, type ReactElement, useEffect, useRef } from "react";
import { type FillHandlePointerEvent, getSchemaGridStores } from "../grid/gridContext";
import type { GridRow } from "../internal/core";
import { useStoreSelector } from "../state/createStore";
import { createRangeStore } from "../state/rangeStore";
import { SG_CLASSES } from "../theme/classNames";
import { type CellPos, type CellRange, isBottomRight } from "./geometry";
import { isRangeableNode, normalizedRangeFor } from "./useRangeSelection";

/** Optional grid-context field T25 installs to start a fill drag. */
export interface FillHandleSeam {
  onFillHandlePointerDown?(event: FillHandlePointerEvent, pos: CellPos): void;
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
    // Row indexes change under a mounted renderer (sort, filter, inserts):
    // always read `node.rowIndex` live, never a render-time capture.
    const memo = useRef<{ range: CellRange; rowIndex: number; result: boolean } | null>(null);
    const isHandleCell = useStoreSelector(store, (s) => {
      if (!s.range || colId === undefined || !props.api || !isRangeableNode(node)) return false;
      const rowIndex = node.rowIndex;
      const m = memo.current;
      if (m && m.range === s.range && m.rowIndex === rowIndex) return m.result;
      const n = normalizedRangeFor(props.api, s.range);
      const result = !!n && isBottomRight({ rowIndex, colId }, n);
      memo.current = { range: s.range, rowIndex, result };
      return result;
    });
    const latest = useRef({ context: props.context as unknown, node, colId });
    latest.current = { context: props.context, node, colId };
    const handleRef = useRef<HTMLSpanElement>(null);
    useEffect(() => {
      const el = handleRef.current;
      if (!isHandleCell || !el) return;
      const onPointerDown = (event: PointerEvent) => {
        const { context, node: n, colId: c } = latest.current;
        if (c !== undefined && isRangeableNode(n)) fillSeamOf(context)?.(event, { rowIndex: n.rowIndex, colId: c });
      };
      el.addEventListener("pointerdown", onPointerDown);
      return () => el.removeEventListener("pointerdown", onPointerDown);
    }, [isHandleCell]);
    return (
      <>
        <Inner {...props} />
        {isHandleCell ? (
          <span ref={handleRef} className={SG_CLASSES.fillHandle} data-sg-fill-handle="" aria-hidden="true" />
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
