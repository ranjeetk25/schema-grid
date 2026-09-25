/**
 * Shared test helper: renders `<SchemaGrid>` over core's in-memory data
 * source with the fixture schema, `domLayout: "autoHeight"` and row/column
 * virtualisation off, so every row and column is in the jsdom DOM.
 */
import { act, render, type RenderResult, waitFor } from "@testing-library/react";
import { createRef, type RefObject } from "react";
import { expect } from "vitest";
import { SchemaGrid, type SchemaGridComponentProps, type SchemaGridHandle } from "../src/grid/SchemaGrid";
import type { GridRow, GridUser } from "../src/internal/core";
import { createInMemoryDataSource, type InMemoryDataSource } from "./fixtures/dataSource";
import { ADMIN, fixtureRows, fixtureSchema } from "./fixtures/schema";

export interface RenderGridOptions {
  user?: GridUser;
  rows?: GridRow[];
  ds?: InMemoryDataSource<GridRow>;
  props?: Partial<SchemaGridComponentProps<GridRow>>;
}

export interface RenderGridResult extends RenderResult {
  ds: InMemoryDataSource<GridRow>;
  handle: RefObject<SchemaGridHandle<GridRow>>;
  /** Resolves once the grid is ready and `expected` (default: all rows) data rows are in the DOM. */
  waitForRows(expected?: number): Promise<void>;
  /** Lets AG Grid's timers and our microtasks drain. */
  settle(ms?: number): Promise<void>;
}

export const TEST_GRID_OPTIONS = {
  domLayout: "autoHeight",
  suppressColumnVirtualisation: true,
  suppressRowVirtualisation: true,
} as const;

export function renderGrid(options: RenderGridOptions = {}): RenderGridResult {
  const rows = options.rows ?? fixtureRows;
  const ds = options.ds ?? createInMemoryDataSource(fixtureSchema, rows);
  const handle = createRef<SchemaGridHandle<GridRow>>();
  const utils = render(
    <div style={{ width: 1600, height: 800 }}>
      <SchemaGrid<GridRow>
        ref={handle}
        schema={fixtureSchema}
        dataSource={ds}
        user={options.user ?? ADMIN}
        {...options.props}
        gridOptions={{ ...TEST_GRID_OPTIONS, ...options.props?.gridOptions }}
      />
    </div>,
  );
  const waitForRows = async (expected = rows.length): Promise<void> => {
    await waitFor(() => {
      expect(handle.current?.api()).toBeTruthy();
      const ids = new Set(
        [...utils.container.querySelectorAll(".ag-row[row-id]")].map((el) => el.getAttribute("row-id")),
      );
      expect(ids.size).toBe(expected);
    });
  };
  const settle = async (ms = 50): Promise<void> => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  };
  return { ...utils, ds, handle, waitForRows, settle };
}
