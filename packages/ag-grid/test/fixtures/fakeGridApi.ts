/**
 * Minimal typed GridApi double for pure-ish tests. Only the methods this
 * package calls are implemented; everything is a vi.fn spy.
 */
import type { Column, ColumnState, GridApi, IRowNode } from "ag-grid-community";
import { vi } from "vitest";
import type { GridRow } from "../../src/internal/core";

export interface FakeColumnSpec {
  colId: string;
  hide?: boolean;
  width?: number;
  pinned?: "left" | "right" | null;
}

export interface FakeGridApiOptions<Row extends GridRow> {
  columns?: FakeColumnSpec[];
  rows?: Row[];
  editing?: boolean;
}

export interface FakeGridApiHandle<Row extends GridRow> {
  api: GridApi<Row>;
  spies: Record<string, ReturnType<typeof vi.fn>>;
  /** Current row list as seen by the fake (display order). */
  rows(): Row[];
  setEditing(editing: boolean): void;
  columnState(): ColumnState[];
}

function fakeNode<Row extends GridRow>(data: Row, rowIndex: number): IRowNode<Row> {
  const node = {
    id: data.id,
    data,
    rowIndex,
    setData: vi.fn((next: Row) => {
      node.data = next;
    }),
  };
  return node as unknown as IRowNode<Row>;
}

function fakeColumn(spec: FakeColumnSpec): Column {
  return {
    getColId: () => spec.colId,
    getId: () => spec.colId,
    isVisible: () => !spec.hide,
  } as unknown as Column;
}

export function createFakeGridApi<Row extends GridRow = GridRow>(
  opts: FakeGridApiOptions<Row> = {},
): FakeGridApiHandle<Row> {
  let state: ColumnState[] = (opts.columns ?? []).map((c) => ({
    colId: c.colId,
    hide: c.hide ?? false,
    width: c.width ?? 200,
    pinned: c.pinned ?? null,
  }));
  let rows: Row[] = [...(opts.rows ?? [])];
  let editing = opts.editing ?? false;
  const gridOptions: Record<string, unknown> = {};

  const spies = {
    getColumnState: vi.fn(() => state.map((s) => ({ ...s }))),
    applyColumnState: vi.fn((params: { state?: ColumnState[]; applyOrder?: boolean }) => {
      const incoming = params.state ?? [];
      const known = new Set(state.map((s) => s.colId));
      const merged = state.map((s) => ({ ...s, ...(incoming.find((i) => i.colId === s.colId) ?? {}) }));
      if (params.applyOrder) {
        const orderIds = incoming.map((i) => i.colId).filter((id) => known.has(id));
        const rest = merged.filter((m) => !orderIds.includes(m.colId));
        state = [...orderIds.map((id) => merged.find((m) => m.colId === id) as ColumnState), ...rest];
      } else state = merged;
      return true;
    }),
    getAllDisplayedColumns: vi.fn(() =>
      state.filter((s) => !s.hide).map((s) => fakeColumn({ colId: s.colId, hide: false })),
    ),
    getColumn: vi.fn((id: string) => {
      const s = state.find((c) => c.colId === id);
      return s ? fakeColumn({ colId: s.colId, hide: s.hide ?? false }) : null;
    }),
    refreshCells: vi.fn(),
    redrawRows: vi.fn(),
    flashCells: vi.fn(),
    applyTransaction: vi.fn((tx: { add?: Row[]; update?: Row[]; remove?: { id: string }[] }) => {
      const removeIds = new Set((tx.remove ?? []).map((r) => r.id));
      rows = rows.filter((r) => !removeIds.has(r.id));
      for (const u of tx.update ?? []) rows = rows.map((r) => (r.id === u.id ? u : r));
      rows.push(...(tx.add ?? []));
      return { add: [], update: [], remove: [] };
    }),
    getRowNode: vi.fn((id: string) => {
      const index = rows.findIndex((r) => r.id === id);
      const r = rows[index];
      return r ? fakeNode(r, index) : undefined;
    }),
    getDisplayedRowAtIndex: vi.fn((index: number) => {
      const r = rows[index];
      return r ? fakeNode(r, index) : undefined;
    }),
    getDisplayedRowCount: vi.fn(() => rows.length),
    getEditingCells: vi.fn(() => (editing ? [{ rowIndex: 0, column: fakeColumn({ colId: "x" }), rowPinned: null }] : [])),
    stopEditing: vi.fn(),
    setFocusedCell: vi.fn(),
    getFocusedCell: vi.fn(() => null),
    ensureIndexVisible: vi.fn(),
    exportDataAsCsv: vi.fn(),
    getDataAsCsv: vi.fn(() => ""),
    purgeInfiniteCache: vi.fn(),
    refreshInfiniteCache: vi.fn(),
    setGridOption: vi.fn((key: string, value: unknown) => {
      gridOptions[key] = value;
    }),
    getGridOption: vi.fn((key: string) => gridOptions[key]),
    onFilterChanged: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };

  return {
    api: spies as unknown as GridApi<Row>,
    spies,
    rows: () => rows,
    setEditing(next) {
      editing = next;
    },
    columnState: () => state.map((s) => ({ ...s })),
  };
}
