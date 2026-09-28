/** v0.4 cell colors in the workbench: paint, report, color rules, filter by color. */
import type { SchemaGridHandle } from "@ranjeetk25/schema-grid-ag-grid";
import { type DataSource, type GridSchema, normalizeCapabilities } from "@ranjeetk25/schema-grid-core";
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import {
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
  createFixtureRows,
  createFixtureSchema,
} from "@ranjeetk25/schema-grid-core/testing";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderUi } from "../test/render";
import { SchemaGridWorkbench } from "./SchemaGridWorkbench";
import type { SchemaGridWorkbenchProps } from "./types";
import { createMemoryViewStore } from "./viewStore";

configure({ asyncUtilTimeout: 5000 });

const ADMIN = { id: FIXTURE_USERS.admin.id, roles: [...FIXTURE_USERS.admin.roles] };
const TEST_GRID = { gridOptions: { domLayout: "autoHeight", suppressRowVirtualisation: true } } as const;

function memory(schema: GridSchema) {
  return createInMemoryDataSource({
    schema,
    rows: createFixtureRows(),
    user: ADMIN,
    now: () => new Date(FIXTURE_NOW),
    timeZone: FIXTURE_TIME_ZONE,
  });
}

function renderWorkbench(extra: Partial<SchemaGridWorkbenchProps> & { dataSource?: DataSource } = {}) {
  const schema = createFixtureSchema();
  const ds = memory(schema);
  let handle: SchemaGridHandle | null = null;
  const props = {
    dataSource: ds,
    schema,
    user: ADMIN,
    viewStore: createMemoryViewStore(),
    height: 400,
    gridProps: TEST_GRID,
    onHandle: (h: SchemaGridHandle | null) => {
      handle = h;
    },
    ...extra,
  } as SchemaGridWorkbenchProps;
  const utils = renderUi(<SchemaGridWorkbench {...props} />);
  const getHandle = () => {
    if (!handle) throw new Error("no handle yet");
    return handle;
  };
  return { ...utils, ds, getHandle };
}

const cellEl = (container: HTMLElement, rowId: string, colId: string) =>
  container.querySelector<HTMLElement>(`.ag-row[row-id="${rowId}"] .ag-cell[col-id="${colId}"]`);

async function ready(container: HTMLElement) {
  await waitFor(() => expect(cellEl(container, "r1", C.name)).not.toBeNull());
  await screen.findByRole("button", { name: "Cell color" });
}

describe("<SchemaGridWorkbench> cell colors", () => {
  it("paints the focused cell from the toolbar", async () => {
    const { container, ds, getHandle, user } = renderWorkbench();
    await ready(container);
    const trigger = screen.getByRole("button", { name: "Cell color" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    act(() => getHandle().api()?.setFocusedCell(0, C.status));
    await waitFor(() => expect(trigger).not.toHaveAttribute("aria-disabled"));
    await user.click(trigger);
    await user.click(within(await screen.findByRole("dialog", { name: "Cell color" })).getByRole("button", { name: "Red" }));
    await waitFor(() => expect(cellEl(container, "r1", C.status)).toHaveClass("sg-color-red"));
    const stored = (await ds.fetch({ filter: null, sort: [], groupBy: [], page: { offset: 0, limit: 10 } })).rows.find((r) => r.id === "r1");
    expect(stored?.colors).toEqual({ [C.status]: "red" });
    expect(screen.getByTestId("workbench-status")).toHaveTextContent("Colored 1 cell");
    // One undo step clears it again.
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).not.toHaveAttribute("aria-disabled"));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(cellEl(container, "r1", C.status)).not.toHaveClass("sg-color-red"));
  });

  it("reports cells that were skipped (read-only formula) in the status bar and to the host", async () => {
    const onCellColorReport = vi.fn();
    const { container, getHandle } = renderWorkbench({ gridProps: { ...TEST_GRID, onCellColorReport } });
    await ready(container);
    await act(async () => {
      await getHandle().setCellColor("blue", [
        { rowId: "r1", columnId: C.name },
        { rowId: "r1", columnId: C.balance },
      ]);
    });
    expect(onCellColorReport).toHaveBeenCalledWith(expect.objectContaining({ requested: 2, applied: 1, skipped: 1 }));
    await waitFor(() => expect(screen.getByTestId("workbench-status")).toHaveTextContent("Colored 1 cell, 1 skipped (1 read-only)"));
    expect(JSON.parse(screen.getByTestId("color-report").textContent ?? "null")).toMatchObject({ skipped: 1 });
  });

  it("hides the paint button when the source can't write colors, but keeps color rules", async () => {
    const schema = createFixtureSchema();
    const base = memory(schema);
    const readOnlyColors = Object.assign(Object.create(base) as DataSource, {
      capabilities: () => normalizeCapabilities({ cellColors: { read: true, write: false, filter: false } }),
    });
    const { container } = renderWorkbench({ dataSource: readOnlyColors, schema });
    await waitFor(() => expect(cellEl(container, "r1", C.name)).not.toBeNull());
    await screen.findByRole("button", { name: /^Color rules/ });
    expect(screen.queryByRole("button", { name: "Cell color" })).toBeNull();
  });

  it("features.paint / features.colorRules switch the controls off", async () => {
    const { container } = renderWorkbench({ features: { paint: false, colorRules: false } });
    await waitFor(() => expect(cellEl(container, "r1", C.name)).not.toBeNull());
    await screen.findByRole("button", { name: "Filter" });
    expect(screen.queryByRole("button", { name: "Cell color" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Color rules/ })).toBeNull();
  });

  it("saves color rules to the view through the dialog", async () => {
    const { container, getHandle, user } = renderWorkbench();
    await ready(container);
    await user.click(screen.getByRole("button", { name: /^Color rules/ }));
    const dialog = await screen.findByRole("dialog", { name: "Color rules" });
    await user.click(within(dialog).getByRole("button", { name: "Add rule" }));
    await user.click(within(dialog).getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(getHandle().colorRules).toHaveLength(1));
    expect(getHandle().colorRules[0]).toMatchObject({ color: "red", target: { kind: "row" }, when: null });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Color rules/ })).toHaveTextContent("1"));
    // Rules live in the view: it now has unsaved changes.
    expect(screen.getByTestId("view-dirty-dot")).toBeInTheDocument();
  });

  it("offers color operators in the filter builder", async () => {
    const { container, user } = renderWorkbench();
    await ready(container);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    const panel = await screen.findByRole("dialog", { name: /^Filter/ });
    await user.click(within(panel).getByRole("button", { name: "Add condition" }));
    await user.click(within(panel).getByRole("combobox", { name: "Column" }));
    await user.click(await screen.findByRole("option", { name: "Payment status" }));
    await user.click(within(panel).getByRole("combobox", { name: "Operator" }));
    expect(await screen.findByRole("option", { name: "color is" })).toBeInTheDocument();
  });

  it("filters by color from the column header menu", async () => {
    const { container, user } = renderWorkbench();
    await ready(container);
    await user.click(screen.getByRole("button", { name: "Column menu: Payment status" }));
    await user.click(await screen.findByRole("menuitem", { name: /Filter by color/ }));
    // fireEvent: jsdom has no layout, so a pointer move into the submenu leaves the trigger and closes it.
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Green" }));
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("filter-ast").textContent ?? "null")).toEqual({
        op: "and",
        children: [{ columnId: C.status, operator: "colorIs", value: ["green"] }],
      }),
    );
  });
});
