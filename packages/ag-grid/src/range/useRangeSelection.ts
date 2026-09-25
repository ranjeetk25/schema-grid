/**
 * In-house range selection wiring (AG Grid Community has no range module).
 *
 * - Mouse: `onCellMouseDown` (primary button) sets the anchor, or with Shift
 *   extends the focus; it starts a drag that `onCellMouseOver` extends while the
 *   button is held; a document `mouseup` listener ends the drag (removed on
 *   unmount).
 * - Focus: `onCellFocused` from the keyboard (plain arrows, Tab, Enter...)
 *   collapses the range to the focused cell. Mouse-initiated focus
 *   (`sourceEvent` is a mouse/pointer event) is left to `onCellMouseDown`, and
 *   focus landing on the range's own focus cell (our Shift+Arrow
 *   `setFocusedCell`) is a no-op.
 * - Keyboard: Shift+Arrow is a `GridKeyHandler` (registered on the grid's
 *   `KeyboardRegistry` when given): extends the range, moves grid focus to the
 *   new focus cell and suppresses AG Grid's default.
 * - Rendering: `createRangeCellClassRules()` are pure rules reading
 *   `params.context.stores.range`; on every range change exactly one
 *   `refreshCells({ rowNodes, columns, force: true })` covers the cells whose
 *   membership changed (`rangeDiff`) plus the boundary cells whose edge classes
 *   changed. Range size (> 1 cell) is announced when not dragging and when a
 *   drag ends.
 * - Full-width (group / load-more), pinned and not-yet-loaded rows are ignored.
 *   Column order comes from `api.getAllDisplayedColumns()`, so hidden columns
 *   are never part of a range.
 */
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
import { arrowDirection, type GridKeyHandler, isEditableTarget, type KeyboardRegistry } from "../grid/keyboard";
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
}

type ApiLike = Pick<GridApi, "getAllDisplayedColumns">;

/** Displayed (visible, ordered) column ids. */
export function displayedColIds(api: ApiLike): string[] {
  return api.getAllDisplayedColumns().map((c) => c.getColId());
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
  if (!range) return null;
  const cols = api.getAllDisplayedColumns();
  const cached = normalizedCache.get(api);
  if (cached && cached.range === range && cached.cols === cols) return cached.n;
  const ids = cols.map((c) => c.getColId());
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
  if (rowNodes.length > 0) api.refreshCells({ rowNodes, columns, force: true });
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

export function useRangeSelection<Row extends GridRow = GridRow>(
  apiRef: RefObject<GridApi<Row> | null>,
  rangeStore: RangeStore,
  options: UseRangeSelectionOptions<Row> = {},
): RangeSelectionHandlers<Row> {
  const announceRef = useRef(options.announce);
  announceRef.current = options.announce;
  const docListener = useRef<(() => void) | null>(null);

  const endDrag = useCallback(() => {
    if (docListener.current && typeof document !== "undefined") {
      document.removeEventListener("mouseup", docListener.current);
    }
    docListener.current = null;
    if (rangeStore.getState().dragging) rangeStore.setDragging(false);
  }, [rangeStore]);

  useEffect(() => endDrag, [endDrag]);

  // Refresh only the changed cells; announce the size.
  useEffect(() => {
    let prevRange = rangeStore.get();
    let prevNormalized: NormalizedRange | null = null;
    let prevDragging = rangeStore.getState().dragging;
    const api0 = apiRef.current;
    if (api0) prevNormalized = normalizedRangeFor(api0, prevRange);

    const announceSize = (n: NormalizedRange | null) => {
      const message = n ? rangeSizeMessage(rangeSize(n)) : null;
      if (message) announceRef.current?.(message, "polite");
    };

    return rangeStore.subscribe(() => {
      const state = rangeStore.getState();
      const api = apiRef.current;
      const dragEnded = prevDragging && !state.dragging;
      prevDragging = state.dragging;
      if (state.range === prevRange) {
        if (dragEnded) announceSize(prevNormalized);
        return;
      }
      prevRange = state.range;
      const next = api ? normalizedRangeFor(api, state.range) : null;
      if (api) refreshRangeCells(api, rangeRefreshTargets(prevNormalized, next));
      prevNormalized = next;
      if (!state.dragging) announceSize(next);
    });
  }, [rangeStore, apiRef]);

  const onCellMouseDown = useCallback(
    (e: CellMouseDownEvent<Row>) => {
      const mouse = e.event as MouseEvent | null | undefined;
      if (!mouse || (mouse.button !== undefined && mouse.button !== 0)) return;
      if (!isRangeableNode(e.node as IRowNode) || isEditableTarget(mouse.target)) return;
      const pos: CellPos = { rowIndex: e.node.rowIndex as number, colId: e.column.getColId() };
      if (mouse.shiftKey && rangeStore.get()) rangeStore.setFocus(pos);
      else rangeStore.setAnchor(pos);
      if (typeof document !== "undefined" && !docListener.current) {
        docListener.current = endDrag;
        document.addEventListener("mouseup", endDrag);
      }
      rangeStore.setDragging(true);
    },
    [rangeStore, endDrag],
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
      const api = apiRef.current ?? e.api;
      if (!isRangeableNode(api.getDisplayedRowAtIndex(e.rowIndex) as IRowNode | undefined)) return;
      const pos: CellPos = { rowIndex: e.rowIndex, colId };
      const current = rangeStore.get();
      if (current && samePos(current.focus, pos)) return;
      rangeStore.setAnchor(pos);
    },
    [rangeStore, apiRef],
  );

  const onShiftArrow = useCallback<GridKeyHandler<Row>>(
    (params) => {
      const ev = params.event;
      if (params.editing || ev.type !== "keydown") return false;
      if (!ev.shiftKey || ev.altKey || ev.ctrlKey || ev.metaKey) return false;
      const direction = arrowDirection(ev.key);
      if (!direction || !isRangeableNode(params.node as IRowNode)) return false;
      const api = apiRef.current ?? params.api;
      const here: CellPos = { rowIndex: params.node.rowIndex as number, colId: params.column.getColId() };
      const existing = rangeStore.get();
      const current: CellRange =
        existing && samePos(existing.focus, here) ? existing : { anchor: here, focus: here };
      const next = extendRange(current, direction, displayedColIds(api), api.getDisplayedRowCount());
      if (current !== existing) rangeStore.setAnchor(current.anchor);
      if (!samePos(next.focus, current.focus)) rangeStore.setFocus(next.focus);
      api.ensureIndexVisible(next.focus.rowIndex);
      if (typeof api.ensureColumnVisible === "function") api.ensureColumnVisible(next.focus.colId);
      api.setFocusedCell(next.focus.rowIndex, next.focus.colId);
      ev.preventDefault();
      return true;
    },
    [rangeStore, apiRef],
  );

  const keyboard = options.keyboard;
  useEffect(() => keyboard?.register(onShiftArrow), [keyboard, onShiftArrow]);

  return useMemo(
    () => ({ onCellMouseDown, onCellMouseOver, onCellFocused, onShiftArrow }),
    [onCellMouseDown, onCellMouseOver, onCellFocused, onShiftArrow],
  );
}
