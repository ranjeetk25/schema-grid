/**
 * v0.3.1: the grid repaints the rows a save touched from the server's copy —
 * `ChangeResult.rows` when the source sends them, else `getRows` under
 * `refetchAfterSave` (default in server mode) — and `handle.refreshRows(ids)`.
 */
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChangeBatch, ChangeResult, DataSource, GridRow } from "../../src/internal/core";
import { createInMemoryDataSource, type InMemoryDataSource } from "../fixtures/dataSource";
import { fixtureRows, fixtureSchema } from "../fixtures/schema";
import { renderGrid, type RenderGridResult } from "../renderGrid";

function cellEl(g: RenderGridResult, rowId: string, colId: string): HTMLElement {
  const el = g.container.querySelector<HTMLElement>(`.ag-row[row-id="${rowId}"] .ag-cell[col-id="${colId}"]`);
  if (!el) throw new Error(`no cell ${rowId}/${colId}`);
  return el;
}

async function editText(g: RenderGridResult, rowId: string, colId: string, value: string): Promise<void> {
  fireEvent.doubleClick(cellEl(g, rowId, colId), { detail: 2 });
  let input: HTMLInputElement | null = null;
  await waitFor(() => {
    input = cellEl(g, rowId, colId).querySelector("input");
    expect(input).not.toBeNull();
  });
  const el = input as unknown as HTMLInputElement;
  fireEvent.change(el, { target: { value } });
  fireEvent.keyDown(el, { key: "Enter", code: "Enter" });
}

type Source = InMemoryDataSource<GridRow>;

/** The fixture source whose save results carry refreshed rows with `notes: "refreshed"` (a cell the batch never touched). */
function withRows(base: Source = createInMemoryDataSource(fixtureSchema, fixtureRows)): Source {
  const getRows = vi.fn(async (ids: string[]) => base.rows().filter((r) => ids.includes(r.id)));
  return Object.assign(Object.create(base) as Source, {
    applyChanges: vi.fn(async (batch: ChangeBatch): Promise<ChangeResult> => {
      const result = await base.applyChanges(batch);
      const ids = new Set(batch.changes.map((c) => c.rowId));
      const rows = base.rows().filter((r) => ids.has(r.id)).map((r) => ({ ...r, cells: { ...r.cells, notes: "refreshed" } }));
      return { ...result, rows };
    }),
    getRows,
  });
}

/** The fixture source with `rows` stripped from save results and a spy `getRows` answering `notes: "via getRows"`. */
function withoutRows(base: Source = createInMemoryDataSource(fixtureSchema, fixtureRows)): Source & { getRows: ReturnType<typeof vi.fn> } {
  const getRows = vi.fn(async (ids: string[]) =>
    base.rows().filter((r) => ids.includes(r.id)).map((r) => ({ ...r, cells: { ...r.cells, notes: "via getRows" } })),
  );
  return Object.assign(Object.create(base) as Source, {
    applyChanges: vi.fn(async (batch: ChangeBatch): Promise<ChangeResult> => {
      const { rows: _rows, ...rest } = await base.applyChanges(batch);
      return rest;
    }),
    getRows,
  });
}

describe("refresh after save (v0.3.1)", () => {
  it("(i) `result.rows`: a cell outside the batch shows the server's value right away, no getRows", async () => {
    const ds = withRows();
    const g = renderGrid({ ds });
    await g.waitForRows();
    expect(cellEl(g, "r1", "notes").textContent).not.toContain("refreshed");
    await editText(g, "r1", "name", "Zed");
    await waitFor(() => expect(cellEl(g, "r1", "notes").textContent).toContain("refreshed"));
    expect(cellEl(g, "r1", "name").textContent).toContain("Zed");
    expect((ds as Source & { getRows: ReturnType<typeof vi.fn> }).getRows).not.toHaveBeenCalled();
    // The version is the server's (the in-memory source bumps it to 2).
    expect(g.handle.current?.stores.rows.getVersion("r1")).toBe(2);
    expect(g.handle.current?.stores.rows.getRow("r1")?.cells.notes).toBe("refreshed");
  });

  it("(ii) server mode, rows absent: getRows is called once with the changed ids and the node repaints (no poll)", async () => {
    const ds = withoutRows();
    const g = renderGrid({ ds, props: { mode: "server", poll: { enabled: false } } });
    await g.waitForRows();
    await editText(g, "r1", "name", "Zed");
    await waitFor(() => expect(ds.getRows).toHaveBeenCalledTimes(1));
    expect(ds.getRows).toHaveBeenCalledWith(["r1"]);
    await waitFor(() => expect(cellEl(g, "r1", "notes").textContent).toContain("via getRows"));
    expect(cellEl(g, "r1", "name").textContent).toContain("Zed");
    expect(ds.calls.getChanges).not.toHaveBeenCalled();
  });

  it("(iii) client mode default: no getRows after a save; refetchAfterSave: true opts in", async () => {
    const ds = withoutRows();
    const g = renderGrid({ ds });
    await g.waitForRows();
    await editText(g, "r1", "name", "Zed");
    await waitFor(() => expect(cellEl(g, "r1", "name").textContent).toContain("Zed"));
    await g.settle(100);
    expect(ds.getRows).not.toHaveBeenCalled();
    g.unmount();

    const ds2 = withoutRows();
    const g2 = renderGrid({ ds: ds2, props: { refetchAfterSave: true } });
    await g2.waitForRows();
    await editText(g2, "r2", "name", "Yin");
    await waitFor(() => expect(ds2.getRows).toHaveBeenCalledWith(["r2"]));
    await waitFor(() => expect(cellEl(g2, "r2", "notes").textContent).toContain("via getRows"));
  });

  it("(iv) refreshed rows never resurrect a cell that is pending from another in-flight batch", async () => {
    const base = createInMemoryDataSource(fixtureSchema, fixtureRows);
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    const ds: Source = Object.assign(Object.create(base) as Source, {
      applyChanges: vi.fn(async (batch: ChangeBatch): Promise<ChangeResult> => {
        calls += 1;
        const first = calls === 1;
        if (first) await gate;
        const result = await base.applyChanges(batch);
        const ids = new Set(batch.changes.map((c) => c.rowId));
        // The first batch's refreshed row is read BEFORE the second batch's write: `score` is still the old value.
        const rows = base
          .rows()
          .filter((r) => ids.has(r.id))
          .map((r) => ({ ...r, cells: { ...r.cells, notes: "refreshed", ...(first ? { score: 10 } : {}) } }));
        return { ...result, rows };
      }),
    });
    const g = renderGrid({ ds });
    await g.waitForRows();
    await editText(g, "r1", "name", "Zed");
    await waitFor(() => expect(calls).toBe(1));
    // Second batch on the same row: optimistic + pending while the first save is still in flight.
    await editText(g, "r1", "score", "99");
    await waitFor(() => expect(g.handle.current?.stores.cellStatus.get("r1", "score").pending).toBe(true));
    expect(g.handle.current?.stores.rows.getRow("r1")?.cells.score).toBe(99);
    (release as (() => void) | null)?.();
    await waitFor(() => expect(cellEl(g, "r1", "notes").textContent).toContain("refreshed"));
    // The stale `score` from the first batch's refreshed row did not clobber the pending local value.
    expect(g.handle.current?.stores.rows.getRow("r1")?.cells.score).toBe(99);
    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() => expect(g.handle.current?.stores.cellStatus.get("r1", "score").pending).toBe(false));
    expect(g.handle.current?.stores.rows.getRow("r1")?.cells.score).toBe(99);
  });

  it("(v) handle.refreshRows(ids) re-reads through getRows; a source without getRows is a no-op", async () => {
    const ds = withoutRows();
    const g = renderGrid({ ds });
    await g.waitForRows();
    await g.handle.current?.refreshRows(["r1", "r3"]);
    expect(ds.getRows).toHaveBeenCalledTimes(1);
    expect(ds.getRows).toHaveBeenCalledWith(["r1", "r3"]);
    await waitFor(() => expect(cellEl(g, "r1", "notes").textContent).toContain("via getRows"));
    expect(cellEl(g, "r3", "notes").textContent).toContain("via getRows");
    expect(cellEl(g, "r2", "notes").textContent).not.toContain("via getRows");
    g.unmount();

    const base = createInMemoryDataSource(fixtureSchema, fixtureRows);
    const bare: DataSource<GridRow> = {
      fetch: (q) => base.fetch(q),
      applyChanges: (b) => base.applyChanges(b),
      createRows: (p) => base.createRows(p),
      deleteRows: (ids) => base.deleteRows(ids),
    };
    const g2 = renderGrid({ ds: bare as Source });
    await g2.waitForRows();
    await expect(g2.handle.current?.refreshRows(["r1"])).resolves.toBeUndefined();
  });
});
