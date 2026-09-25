/**
 * In-house range selection wiring (AG Grid Community has no range module).
 *
 * - Mouse: `onCellMouseDown` (primary button) sets the anchor, or with Shift
 *   extends the focus, and starts a drag that `onCellMouseOver` extends while
 *   the button is held. A permanent document capture listener
 *   (pointerup/mouseup/touchend) ends drags and records the release time; a
 *   (queued, async) `cellMouseDown` whose button was already released, or one
 *   on an interactive element inside the cell, sets the anchor without a drag.
 *   A right-click inside the range keeps it; outside, it moves the anchor.
 * - Focus: `onCellFocused` from the keyboard (plain arrows, Tab, Enter...)
 *   collapses the range to the focused cell. Mouse-initiated focus
 *   (`sourceEvent` is a mouse/pointer/touch event) is left to
 *   `onCellMouseDown`; focus we moved ourselves (Shift+Arrow) is consumed, even
 *   when several arrive late after rapid key presses.
 * - Keyboard: Shift+Arrow is a `GridKeyHandler` (registered on the grid's
 *   `KeyboardRegistry` when given): extends the range (stepping over group /
 *   load-more / loading rows), moves grid focus to the new focus cell and
 *   suppresses AG Grid's default.
 * - Row / column changes: `reset()` (sort, filter, grid destroy) clears the
 *   range and refreshes every rendered cell of its columns; `onModelUpdated`
 *   resets when the rows under the anchor/focus changed (an edit that keeps
 *   the order keeps the range); `onDisplayedColumnsChanged` re-normalises, or
 *   resets when the anchor/focus column is gone.
 * - Rendering: `createRangeCellClassRules()` are pure rules reading
 *   `params.context.stores.range`; on every range change exactly one
 *   `refreshCells({ rowNodes, columns })` covers the cells whose membership
 *   changed (`rangeDiff`) plus the boundary cells whose edge classes changed.
 *   Range size (> 1 cell) is announced when not dragging and when a drag ends.
 * - Full-width (group / load-more), pinned and not-yet-loaded rows are ignored.
 *   Column order comes from `api.getAllDisplayedColumns()`, so hidden columns
 *   are never part of a range.
 */
import { isSyntheticColumnId } from "../compile/syntheticColumns";
import type {
  CellClassParams,
  CellClassRules,
  CellFocusedEvent,
  CellMouseDownEvent,
  CellMouseOverEvent,
  GridApi,
  IRowNode,
} from "ag-grid-community";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { getSchemaGridStores } from "../grid/gridContext";
import { arrowDirection, type GridKeyHandler, type KeyboardRegistry } from "../grid/keyboard";
import { isGroupRow, isLoadMoreRow } from "../grouping/clientGroups";
import type { GridRow } from "../internal/core";
import type { RangeStore } from "../state/rangeStore";
import { SG_CLASSES } from "../theme/classNames";
import {
  type CellPos,
  type CellRange,
  extendRange,
  type NormalizedRange,
  normalizeRange,
  rangeContains,
  rangeDiff,
  rangeEdges,
  type RangeSize,
  rangeSize,
} from "./geometry";

type Politeness = "polite" | "assertive";

export interface UseRangeSelectionOptions<Row extends GridRow = GridRow> {
  /** When given, the Shift+Arrow handler is registered on it for the hook's lifetime. */
  keyboard?: KeyboardRegistry<Row>;
  /** Range-size announcer; read through a ref, need not be stable. */
  announce?(message: string, politeness?: Politeness): void;
}

/** Referentially stable for the hook's lifetime (given a stable `apiRef` and store). */
export interface RangeSelectionHandlers<Row extends GridRow = GridRow> {
  onCellMouseDown(event: CellMouseDownEvent<Row>): void;
  onCellMouseOver(event: CellMouseOverEvent<Row>): void;
  onCellFocused(event: CellFocusedEvent<Row>): void;
  /** Shift+Arrow handler (already registered when `options.keyboard` is given). */
  onShiftArrow: GridKeyHandler<Row>;
  /** Grid option: clears the range when the rows under its corners changed. */
  onModelUpdated(): void;
  /** Grid option: re-normalises (or clears, when the anchor/focus column is gone) on column changes. */
  onDisplayedColumnsChanged(): void;
  /** Clears the range and drag state, refreshing every rendered cell of its columns (sort/filter/destroy). */
  reset(): void;
}

type ApiLike = Pick<GridApi, "getAllDisplayedColumns"> & Partial<Pick<GridApi, "isDestroyed">>;

/** Displayed (visible, ordered) column ids, without grid-only columns (ghost draft, "+"). */
export function displayedColIds(api: ApiLike): string[] {
  return api
    .getAllDisplayedColumns()
    .map((c) => c.getColId())
    .filter((id) => !isSyntheticColumnId(id));
}

interface NormalizedCacheEntry {
  range: CellRange | null;
  cols: unknown;
  key: string;
  n: NormalizedRange | null;
}
const normalizedCache = new WeakMap<object, NormalizedCacheEntry>();

/**
 * `normalizeRange(range, displayedColIds(api))`, memoised per api for the same
 * range object and displayed column set (class rules call this per cell).
 */
export function normalizedRangeFor(api: ApiLike, range: CellRange | null): NormalizedRange | null {
  if (!range || api.isDestroyed?.()) return null;
  const cols = api.getAllDisplayedColumns();
  const cached = normalizedCache.get(api);
  if (cached && cached.range === range && cached.cols === cols) return cached.n;
  const ids = cols.map((c) => c.getColId()).filter((id) => !isSyntheticColumnId(id));
  const key = ids.join("\u0000");
  if (cached && cached.range === range && cached.key === key) {
    cached.cols = cols;
    return cached.n;
  }
  const n = normalizeRange(range, ids);
  normalizedCache.set(api, { range, cols, key, n });
  return n;
}

/** Group / load-more / not-yet-loaded / pinned rows never take part in a range. */
export function isRangeableNode(node: IRowNode | null | undefined): node is IRowNode & { rowIndex: number } {
  if (!node || node.rowPinned || node.rowIndex === null || node.rowIndex === undefined) return false;
  const data: unknown = node.data;
  if (!data || typeof data !== "object") return false;
  return !isGroupRow(data as never) && !isLoadMoreRow(data as never);
}

/** "3 rows by 2 columns selected"; null for a single cell. */
export function rangeSizeMessage(size: RangeSize): string | null {
  if (size.rows * size.cols <= 1) return null;
  const rows = `${size.rows} ${size.rows === 1 ? "row" : "rows"}`;
  const cols = `${size.cols} ${size.cols === 1 ? "column" : "columns"}`;
  return `${rows} by ${cols} selected`;
}

function boundaryCells(n: NormalizedRange): CellPos[] {
  const first = n.colIds[0];
  const last = n.colIds[n.colIds.length - 1];
  const out: CellPos[] = [];
  for (const colId of n.colIds) {
    out.push({ rowIndex: n.rowStart, colId });
    if (n.rowEnd !== n.rowStart) out.push({ rowIndex: n.rowEnd, colId });
  }
  for (let rowIndex = n.rowStart + 1; rowIndex < n.rowEnd; rowIndex++) {
    if (first !== undefined) out.push({ rowIndex, colId: first });
    if (last !== undefined && last !== first) out.push({ rowIndex, colId: last });
  }
  return out;
}

const cellKey = (p: CellPos): string => `${p.rowIndex}\u0000${p.colId}`;

/**
 * Cells whose range classes change from `prev` to `next`: membership changes
 * (`rangeDiff`) plus cells in both whose edge classes differ.
 */
export function rangeRefreshTargets(prev: NormalizedRange | null, next: NormalizedRange | null): CellPos[] {
  const out = rangeDiff(prev, next);
  if (!prev || !next) return out;
  const seen = new Set(out.map(cellKey));
  const consider = (cell: CellPos) => {
    const k = cellKey(cell);
    if (seen.has(k) || !rangeContains(prev, cell) || !rangeContains(next, cell)) return;
    const a = rangeEdges(prev, cell);
    const b = rangeEdges(next, cell);
    if (a.top !== b.top || a.right !== b.right || a.bottom !== b.bottom || a.left !== b.left) {
      seen.add(k);
      out.push(cell);
    }
  };
  for (const cell of boundaryCells(prev)) consider(cell);
  for (const cell of boundaryCells(next)) consider(cell);
  return out;
}

function cellPosOf<Row>(p: CellClassParams<Row>): CellPos | null {
  if (!isRangeableNode(p.node as IRowNode)) return null;
  const colId = p.colDef.colId ?? p.column.getColId();
  return { rowIndex: p.node.rowIndex as number, colId };
}

function rangeFor<Row>(p: CellClassParams<Row>): NormalizedRange | null {
  const stores = getSchemaGridStores(p.context);
  if (!stores) return null;
  return normalizedRangeFor(p.api, stores.range.get());
}

type EdgeKey = "top" | "right" | "bottom" | "left";
const edgeRule =
  <Row>(edge: EdgeKey) =>
  (p: CellClassParams<Row>): boolean => {
    const pos = cellPosOf(p);
    const n = pos ? rangeFor(p) : null;
    return !!pos && !!n && rangeContains(n, pos) && rangeEdges(n, pos)[edge];
  };

/** Pure range-highlight rules reading `params.context.stores.range`. */
export function createRangeCellClassRules<Row extends GridRow = GridRow>(): CellClassRules<Row> {
  return {
    [SG_CLASSES.range]: (p: CellClassParams<Row>) => {
      const pos = cellPosOf(p);
      const n = pos ? rangeFor(p) : null;
      return !!pos && !!n && rangeContains(n, pos);
    },
    [SG_CLASSES.rangeTop]: edgeRule<Row>("top"),
    [SG_CLASSES.rangeRight]: edgeRule<Row>("right"),
    [SG_CLASSES.rangeBottom]: edgeRule<Row>("bottom"),
    [SG_CLASSES.rangeLeft]: edgeRule<Row>("left"),
    // Fill-drag preview (T25): the extension cells in `rangeStore.fillPreview`.
    [SG_CLASSES.fillPreview]: (p: CellClassParams<Row>) => {
      const pos = cellPosOf(p);
      const preview = pos ? getSchemaGridStores(p.context)?.range.getState().fillPreview : null;
      return !!pos && !!preview && rangeContains(preview, pos);
    },
  };
}

/** Shared, referentially stable rule set (pass as the `cellClassRules` seam). */
export const RANGE_CELL_CLASS_RULES: CellClassRules = createRangeCellClassRules();

/** One `refreshCells` for the given cells (their rows × their columns). */
export function refreshRangeCells(
  api: Pick<GridApi, "getDisplayedRowAtIndex" | "refreshCells">,
  cells: readonly CellPos[],
): void {
  if (cells.length === 0) return;
  const rowIndexes = new Set<number>();
  const columns: string[] = [];
  for (const c of cells) {
    rowIndexes.add(c.rowIndex);
    if (!columns.includes(c.colId)) columns.push(c.colId);
  }
  const rowNodes: IRowNode[] = [];
  for (const i of rowIndexes) {
    const node = api.getDisplayedRowAtIndex(i);
    if (node) rowNodes.push(node);
  }
  // No `force`: cellClassRules are re-applied on every refresh.
  if (rowNodes.length > 0) api.refreshCells({ rowNodes, columns });
}

function isPointerEvent(event: Event | null | undefined): boolean {
  if (!event) return false;
  return /^(mouse|pointer|click|dblclick|touch|contextmenu)/.test(event.type);
}

function columnIdOf(column: CellFocusedEvent["column"]): string | null {
  if (!column) return null;
  return typeof column === "string" ? column : column.getColId();
}

const samePos = (a: CellPos, b: CellPos): boolean => a.rowIndex === b.rowIndex && a.colId === b.colId;

/** Elements inside a cell that own their own mouse interaction (no range drag from them). */
const INTERACTIVE =
  "button, a[href], input, textarea, select, label, [contenteditable=''], [contenteditable='true'], [role='button'], [role='checkbox'], [role='link']";

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return (target as Element).closest(INTERACTIVE) !== null;
}

export function useRangeSelection<Row extends GridRow = GridRow>(
  apiRef: RefObject<GridApi<Row> | null>,
  rangeStore: RangeStore,
  options: UseRangeSelectionOptions<Row> = {},
): RangeSelectionHandlers<Row> {
  const announceRef = useRef(options.announce);
  announceRef.current = options.announce;
  /** `timeStamp` of the last document pointerup/mouseup/touchend (see `onCellMouseDown`). */
  const lastRelease = useRef(Number.NEGATIVE_INFINITY);
  /** Cells we moved grid focus to ourselves (Shift+Arrow); their `cellFocused` is consumed. */
  const selfFocused = useRef<string[]>([]);
  /** Row ids under the anchor and focus when the range was last set (`onModelUpdated`). */
  const cornerIds = useRef<{ anchor: string | undefined; focus: string | undefined } | null>(null);

  const liveApi = useCallback((): GridApi<Row> | null => {
    const api = apiRef.current;
    return api && !api.isDestroyed() ? api : null;
  }, [apiRef]);

  const endDrag = useCallback(() => {
    if (rangeStore.getState().dragging) rangeStore.setDragging(false);
  }, [rangeStore]);

  // Permanent release listener: ends a drag, and records when the button went
  // up so a mousedown whose (async) cellMouseDown arrives after its own
  // release doesn't start a drag that nothing would end.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onRelease = (event: Event) => {
      lastRelease.current = event.timeStamp;
      endDrag();
    };
    const types = ["pointerup", "mouseup", "touchend"] as const;
    for (const t of types) document.addEventListener(t, onRelease, true);
    return () => {
      for (const t of types) document.removeEventListener(t, onRelease, true);
      endDrag();
    };
  }, [endDrag]);

  // Refresh only the changed cells; announce the size; remember the corner rows.
  useEffect(() => {
    let prevRange = rangeStore.get();
    let prevNormalized: NormalizedRange | null = null;
    let prevDragging = rangeStore.getState().dragging;
    const api0 = liveApi();
    if (api0) prevNormalized = normalizedRangeFor(api0, prevRange);

    const announceSize = (n: NormalizedRange | null) => {
      const message = n ? rangeSizeMessage(rangeSize(n)) : null;
      if (message) announceRef.current?.(message, "polite");
    };

    return rangeStore.subscribe(() => {
      const state = rangeStore.getState();
      const api = liveApi();
      const dragEnded = prevDragging && !state.dragging;
      prevDragging = state.dragging;
      if (state.range === prevRange) {
        if (dragEnded) announceSize(prevNormalized);
        return;
      }
      prevRange = state.range;
      const range = state.range;
      cornerIds.current =
        range && api
          ? {
              anchor: api.getDisplayedRowAtIndex(range.anchor.rowIndex)?.id,
              focus: api.getDisplayedRowAtIndex(range.focus.rowIndex)?.id,
            }
          : null;
      const next = api ? normalizedRangeFor(api, range) : null;
      if (api) refreshRangeCells(api, rangeRefreshTargets(prevNormalized, next));
      prevNormalized = next;
      if (!state.dragging) announceSize(next);
    });
  }, [rangeStore, liveApi]);

  const reset = useCallback(() => {
    selfFocused.current = [];
    endDrag();
    const range = rangeStore.get();
    if (!range) return;
    const api = liveApi();
    const prev = api ? normalizedRangeFor(api, range) : null;
    rangeStore.clear();
    // Rows may have moved (sort/filter): refresh every rendered row of the old
    // range's columns, not just the old indexes.
    if (api && prev) api.refreshCells({ columns: prev.colIds });
  }, [rangeStore, liveApi, endDrag]);

  const onModelUpdated = useCallback(() => {
    const range = rangeStore.get();
    const api = liveApi();
    const corners = cornerIds.current;
    if (!range || !api || !corners) return;
    const anchorId = api.getDisplayedRowAtIndex(range.anchor.rowIndex)?.id;
    const focusId = api.getDisplayedRowAtIndex(range.focus.rowIndex)?.id;
    if (anchorId !== corners.anchor || focusId !== corners.focus) reset();
  }, [rangeStore, liveApi, reset]);

  const onDisplayedColumnsChanged = useCallback(() => {
    const range = rangeStore.get();
    const api = liveApi();
    if (!range || !api) return;
    const cols = displayedColIds(api);
    if (!cols.includes(range.anchor.colId) || !cols.includes(range.focus.colId)) {
      reset();
      return;
    }
    // Same corners, new column set: a fresh range object makes every
    // subscriber (refresh diff, CellShell) re-normalise.
    rangeStore.setState({ range: { anchor: range.anchor, focus: range.focus } });
  }, [rangeStore, liveApi, reset]);

  const onCellMouseDown = useCallback(
    (e: CellMouseDownEvent<Row>) => {
      const mouse = e.event as MouseEvent | null | undefined;
      if (!mouse || !isRangeableNode(e.node as IRowNode)) return;
      const pos: CellPos = { rowIndex: e.node.rowIndex as number, colId: e.column.getColId() };
      const primary = mouse.button === undefined || mouse.button === 0;
      if (!primary) {
        // Right-click inside the range keeps it (context menu over a selection).
        const api = liveApi() ?? e.api;
        const n = normalizedRangeFor(api, rangeStore.get());
        if (!n || !rangeContains(n, pos)) rangeStore.setAnchor(pos);
        return;
      }
      const released = typeof mouse.timeStamp === "number" && lastRelease.current >= mouse.timeStamp;
      const interactive = isInteractiveTarget(mouse.target);
      // Dragging is set BEFORE the range changes, so the size is announced once, on release.
      if (!released && !interactive) rangeStore.setDragging(true);
      if (mouse.shiftKey && !interactive && rangeStore.get()) rangeStore.setFocus(pos);
      else rangeStore.setAnchor(pos);
    },
    [rangeStore, liveApi],
  );

  const onCellMouseOver = useCallback(
    (e: CellMouseOverEvent<Row>) => {
      if (!rangeStore.getState().dragging) return;
      const mouse = e.event as MouseEvent | null | undefined;
      if (mouse && typeof mouse.buttons === "number" && (mouse.buttons & 1) === 0) {
        endDrag();
        return;
      }
      if (!isRangeableNode(e.node as IRowNode)) return;
      const pos: CellPos = { rowIndex: e.node.rowIndex as number, colId: e.column.getColId() };
      const current = rangeStore.get();
      if (current && samePos(current.focus, pos)) return;
      rangeStore.setFocus(pos);
    },
    [rangeStore, endDrag],
  );

  const onCellFocused = useCallback(
    (e: CellFocusedEvent<Row>) => {
      if (rangeStore.getState().dragging || isPointerEvent(e.sourceEvent)) return;
      if (e.rowIndex === null || e.rowPinned || e.isFullWidthCell) return;
      const colId = columnIdOf(e.column);
      if (colId === null) return;
      const pos: CellPos = { rowIndex: e.rowIndex, colId };
      if (!e.sourceEvent) {
        const i = selfFocused.current.indexOf(cellKey(pos));
        if (i !== -1) {
          selfFocused.current = selfFocused.current.slice(i + 1);
          return;
        }
      }
      const api = liveApi() ?? e.api;
      if (!isRangeableNode(api.getDisplayedRowAtIndex(e.rowIndex) as IRowNode | undefined)) return;
      const current = rangeStore.get();
      if (current && samePos(current.focus, pos)) return;
      rangeStore.setAnchor(pos);
    },
    [rangeStore, liveApi],
  );

  const onShiftArrow = useCallback<GridKeyHandler<Row>>(
    (params) => {
      const ev = params.event;
      if (params.editing || ev.type !== "keydown") return false;
      if (!ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return false;
      const direction = arrowDirection(ev.key);
      if (!direction || !isRangeableNode(params.node as IRowNode)) return false;
      const api = liveApi() ?? params.api;
      const here: CellPos = { rowIndex: params.node.rowIndex as number, colId: params.column.getColId() };
      const existing = rangeStore.get();
      const current: CellRange =
        existing && samePos(existing.focus, here) ? existing : { anchor: here, focus: here };
      const rowCount = api.getDisplayedRowCount();
      let next = extendRange(current, direction, displayedColIds(api), rowCount);
      // Step over group / load-more / loading rows; stay put when none is left.
      if (direction === "up" || direction === "down") {
        const step = direction === "down" ? 1 : -1;
        let i = next.focus.rowIndex;
        while (i >= 0 && i < rowCount && i !== current.focus.rowIndex && !isRangeableNode(api.getDisplayedRowAtIndex(i))) {
          i += step;
        }
        const target = i >= 0 && i < rowCount ? i : current.focus.rowIndex;
        next = { anchor: current.anchor, focus: { rowIndex: target, colId: next.focus.colId } };
      }
      if (current !== existing) rangeStore.setAnchor(current.anchor);
      if (!samePos(next.focus, current.focus)) {
        rangeStore.setFocus(next.focus);
        api.ensureIndexVisible(next.focus.rowIndex);
        if (typeof api.ensureColumnVisible === "function") api.ensureColumnVisible(next.focus.colId);
        selfFocused.current = [...selfFocused.current, cellKey(next.focus)].slice(-32);
        api.setFocusedCell(next.focus.rowIndex, next.focus.colId);
      }
      ev.preventDefault();
      return true;
    },
    [rangeStore, liveApi],
  );

  const keyboard = options.keyboard;
  useEffect(() => keyboard?.register(onShiftArrow), [keyboard, onShiftArrow]);

  return useMemo(
    () => ({ onCellMouseDown, onCellMouseOver, onCellFocused, onShiftArrow, onModelUpdated, onDisplayedColumnsChanged, reset }),
    [onCellMouseDown, onCellMouseOver, onCellFocused, onShiftArrow, onModelUpdated, onDisplayedColumnsChanged, reset],
  );
}
