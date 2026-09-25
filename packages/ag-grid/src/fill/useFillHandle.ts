/**
 * Fill-handle drag wiring (T25). Pure planning lives in `fillPlan.ts`.
 *
 * Flow
 * - `onFillHandlePointerDown(event, pos)` (installed as
 *   `context.onFillHandlePointerDown`, called by `CellShell` from a NATIVE
 *   pointerdown listener on the handle, i.e. before AG Grid's own cell
 *   pointerdown listener on an ancestor) enters fill mode for the current
 *   range: it calls `stopPropagation()` (AG Grid never sees the pointerdown, so
 *   range selection doesn't reset) and `preventDefault()` (no text selection,
 *   no focus move, no compatibility mouse events). Only the primary button.
 * - `onCellMouseOver` while filling computes the target with
 *   `computeFillTarget`: locked to the dominant axis (down, or right; a tie
 *   goes down) and only extending BEYOND the source. Up/left fills are out of
 *   scope for v1: moving above/left of (or back inside) the source clears the
 *   preview. The preview (the extension cells only, never the source) goes to
 *   `rangeStore.setFillPreview`; the cells whose preview membership changed are
 *   refreshed with ONE batched `refreshCells` so the dashed
 *   `SG_CLASSES.fillPreview` rule (in `createRangeCellClassRules`) re-evaluates.
 * - document `pointerup`: `planFill` → ONE `controller.submit(changes, "fill")`
 *   (skipped when there are no changes), then the range becomes the filled
 *   range (anchor = source top-left, focus = target bottom-right).
 *   `pointercancel` cancels.
 * - Esc cancels without a submit: a root key handler on `keyboard` (focus
 *   inside `.sg-root`) plus a document `keydown` listener (focus elsewhere).
 * - Read-only targets (and formula columns) are skipped by `planFill`. The
 *   outcome is announced once the save settles, as ONE polite message
 *   ("Fill: 3 cells filled, 1 read-only cell skipped, saved"), and handed to `onReport` as a `FillReport`
 *   at the same time (synchronously when nothing is submitted). Cells the
 *   controller rejected as read-only at submit time (`outcome.readOnly`) count
 *   as skipped, not filled. It is deliberately NOT routed
 *   through `onClipboardReport`: that callback's `pastedCells` would make
 *   hosts miscount pastes. A public `onFillReport` prop can forward `onReport`
 *   later if hosts need it.
 * - Document listeners exist only while filling and are removed on
 *   completion, cancel and unmount (unmount also clears the preview).
 *
 * Limitations (Playwright): no edge autoscroll while dragging; with the
 * infinite row model, not-yet-loaded rows in the target are skipped by
 * `planFill` (they have no data).
 */
import type { CellMouseOverEvent, GridApi, IRowNode } from "ag-grid-community";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { fillMessage } from "../a11y/announcer";
import type { EditController } from "../editing/editController";
import type { FillHandlePointerEvent } from "../grid/gridContext";
import type { KeyboardRegistry } from "../grid/keyboard";
import type { DisplayRow } from "../grouping/clientGroups";
import type { ColumnDef, FieldTypeRegistry, GridRow, GridSchema } from "../internal/core";
import { type CellPos, type CellRange, type NormalizedRange, rangeDiff } from "../range/geometry";
import { displayedColIds, isRangeableNode, normalizedRangeFor, refreshRangeCells } from "../range/useRangeSelection";
import type { RangeStore } from "../state/rangeStore";
import { planFill } from "./fillPlan";

export type FillAxis = "down" | "right";

export interface FillTarget {
  axis: FillAxis;
  /** Source plus extension (what `planFill` receives as `target`). */
  target: NormalizedRange;
  /** Extension cells only (what `rangeStore.fillPreview` holds). */
  preview: NormalizedRange;
}

export interface FillReport {
  axis: FillAxis;
  filledCells: number;
  skippedReadOnly: number;
}

export interface UseFillHandleOptions<Row extends GridRow = GridRow> {
  apiRef: RefObject<GridApi<Row> | null>;
  rangeStore: RangeStore;
  controller: Pick<EditController<Row>, "submit">;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  canEditCell(row: Row, columnId: string): boolean;
  /** Cell reader (formula columns); defaults to `row.cells[column.key]`. */
  getCellValue?(row: Row, column: ColumnDef): unknown;
  /** When given, Esc is registered as a root key handler for the hook's lifetime. */
  keyboard?: KeyboardRegistry<Row>;
  announce?(message: string, politeness?: "polite" | "assertive"): void;
  onReport?(report: FillReport): void;
}

/** Referentially stable for the hook's lifetime. */
export interface FillHandleHandlers<Row extends GridRow = GridRow> {
  /** Install as `context.onFillHandlePointerDown`. */
  onFillHandlePointerDown(event: FillHandlePointerEvent, pos: CellPos): void;
  /** Chain onto the grid's `onCellMouseOver`; a no-op unless filling. */
  onCellMouseOver(event: CellMouseOverEvent<Row>): void;
  isFilling(): boolean;
  /** Leaves fill mode without submitting. */
  cancel(): void;
}

/**
 * Where a fill drag from `source` to the hovered `pos` lands: locked to the
 * dominant axis (rows below vs columns right of the source; ties go down).
 * Null when `pos` is inside, above or left of the source, or its column isn't
 * displayed.
 */
export function computeFillTarget(
  source: NormalizedRange,
  pos: CellPos,
  displayedIds: readonly string[],
): FillTarget | null {
  const lastSourceCol = source.colIds[source.colIds.length - 1];
  const firstSourceCol = source.colIds[0];
  if (lastSourceCol === undefined || firstSourceCol === undefined) return null;
  const posIdx = displayedIds.indexOf(pos.colId);
  const lastIdx = displayedIds.indexOf(lastSourceCol);
  const firstIdx = displayedIds.indexOf(firstSourceCol);
  if (posIdx === -1 || lastIdx === -1 || firstIdx === -1) return null;
  const dy = pos.rowIndex - source.rowEnd;
  const dx = posIdx - lastIdx;
  if (dy > 0 && dy >= dx) {
    return {
      axis: "down",
      target: { rowStart: source.rowStart, rowEnd: pos.rowIndex, colIds: [...source.colIds] },
      preview: { rowStart: source.rowEnd + 1, rowEnd: pos.rowIndex, colIds: [...source.colIds] },
    };
  }
  if (dx > 0) {
    return {
      axis: "right",
      target: { rowStart: source.rowStart, rowEnd: source.rowEnd, colIds: displayedIds.slice(firstIdx, posIdx + 1) },
      preview: { rowStart: source.rowStart, rowEnd: source.rowEnd, colIds: displayedIds.slice(lastIdx + 1, posIdx + 1) },
    };
  }
  return null;
}

/** "Fill: 3 cells filled, 1 read-only cell skipped"; the builder lives in `a11y/announcer` (re-exported here). */
export { fillMessage };

/** Distinct cells in a cell list. */
function countDistinctCells(cells: readonly { rowId: string; columnId: string }[]): number {
  return new Set(cells.map((c) => `${c.rowId}\u0000${c.columnId}`)).size;
}

interface FillSession {
  source: NormalizedRange;
  current: FillTarget | null;
}

export function useFillHandle<Row extends GridRow = GridRow>(
  options: UseFillHandleOptions<Row>,
): FillHandleHandlers<Row> {
  const latest = useRef(options);
  latest.current = options;
  const { rangeStore, apiRef } = options;
  const session = useRef<FillSession | null>(null);
  const listeners = useRef<(() => void) | null>(null);

  /** Replaces the preview and refreshes the cells whose membership changed. */
  const setPreview = useCallback(
    (next: NormalizedRange | null) => {
      const prev = rangeStore.getState().fillPreview;
      if (prev === next) return;
      rangeStore.setFillPreview(next);
      const api = apiRef.current;
      if (api) refreshRangeCells(api, rangeDiff(prev, next));
    },
    [rangeStore, apiRef],
  );

  const exit = useCallback(() => {
    listeners.current?.();
    listeners.current = null;
    session.current = null;
    setPreview(null);
  }, [setPreview]);

  const cancel = useCallback(() => {
    if (session.current) exit();
  }, [exit]);

  const commit = useCallback(() => {
    const s = session.current;
    const api = apiRef.current;
    exit();
    if (!s?.current || !api) return;
    const { axis, target } = s.current;
    const o = latest.current;
    const columnsById = new Map(o.schema.columns.map((c) => [c.id, c]));
    const getRowAt = (rowIndex: number): DisplayRow<Row> | undefined => {
      const node = api.getDisplayedRowAtIndex(rowIndex) as IRowNode | undefined;
      return isRangeableNode(node) ? (node.data as DisplayRow<Row>) : undefined;
    };
    const { changes, skippedReadOnly } = planFill<Row>({
      source: s.source,
      target,
      axis,
      getRowAt,
      columnsById,
      registry: o.registry,
      canEditCell: (row, columnId) => o.canEditCell(row, columnId),
      ...(o.getCellValue ? { getCellValue: o.getCellValue } : {}),
    });
    const firstCol = target.colIds[0];
    const lastCol = target.colIds[target.colIds.length - 1];
    if (firstCol !== undefined && lastCol !== undefined) {
      rangeStore.setAnchor({ rowIndex: target.rowStart, colId: firstCol });
      rangeStore.setFocus({ rowIndex: target.rowEnd, colId: lastCol });
    }
    // Cells the controller rejected as read-only at submit time (v0.2 C3) move
    // from "filled" to "skipped" in both the announcement and the report.
    const report = (rejected = 0, saved?: number) => {
      const filled = Math.max(0, changes.length - rejected);
      const skipped = skippedReadOnly + rejected;
      const message = fillMessage(filled, skipped, saved);
      if (message) latest.current.announce?.(message, "polite");
      latest.current.onReport?.({ axis, filledCells: filled, skippedReadOnly: skipped });
    };
    if (changes.length > 0) {
      // Report once the save settles, folding it in: a separate "Saved N cells"
      // would overwrite the fill summary in the polite live region.
      void o.controller.submit(changes, "fill").then(
        (outcome) =>
          report(countDistinctCells(outcome.readOnly ?? []), outcome.vetoed ? 0 : countDistinctCells(outcome.result.applied)),
        () => report(),
      );
    } else {
      report();
    }
  }, [apiRef, exit, rangeStore]);

  const onFillHandlePointerDown = useCallback(
    (event: FillHandlePointerEvent, _pos: CellPos) => {
      if (event.button !== undefined && event.button !== 0) return;
      const api = apiRef.current;
      const range: CellRange | null = rangeStore.get();
      const source = api ? normalizedRangeFor(api, range) : null;
      if (!source) return;
      event.stopPropagation();
      event.preventDefault();
      if (session.current) exit();
      session.current = { source, current: null };
      if (typeof document === "undefined") return;
      const onUp = () => commit();
      const onCancel = () => cancel();
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !session.current) return;
        e.preventDefault();
        cancel();
      };
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      document.addEventListener("keydown", onKey);
      listeners.current = () => {
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("keydown", onKey);
      };
    },
    [apiRef, rangeStore, exit, commit, cancel],
  );

  const onCellMouseOver = useCallback(
    (e: CellMouseOverEvent<Row>) => {
      const s = session.current;
      if (!s || !isRangeableNode(e.node as IRowNode)) return;
      const api = apiRef.current ?? e.api;
      const pos: CellPos = { rowIndex: e.node.rowIndex as number, colId: e.column.getColId() };
      s.current = computeFillTarget(s.source, pos, displayedColIds(api));
      const next = s.current?.preview ?? null;
      const prev = rangeStore.getState().fillPreview;
      if (prev && next && samePreview(prev, next)) return;
      setPreview(next);
    },
    [apiRef, rangeStore, setPreview],
  );

  const isFilling = useCallback(() => session.current !== null, []);

  const keyboard = options.keyboard;
  useEffect(
    () =>
      keyboard?.registerRoot((event) => {
        if (event.key !== "Escape" || !session.current) return false;
        cancel();
        return true;
      }),
    [keyboard, cancel],
  );

  useEffect(() => cancel, [cancel]);

  return useMemo(
    () => ({ onFillHandlePointerDown, onCellMouseOver, isFilling, cancel }),
    [onFillHandlePointerDown, onCellMouseOver, isFilling, cancel],
  );
}

function samePreview(a: NormalizedRange, b: NormalizedRange): boolean {
  return (
    a.rowStart === b.rowStart &&
    a.rowEnd === b.rowEnd &&
    a.colIds.length === b.colIds.length &&
    a.colIds.every((id, i) => id === b.colIds[i])
  );
}
