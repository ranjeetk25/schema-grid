/** v0.4 cell colors in `<SchemaGridWorkbench>`: paint, color rules, filter by color. */
import type { SchemaGridHandle } from "@ranjeetk25/schema-grid-ag-grid";
import {
  type CellColorBatch,
  type DataSource,
  type DataSourceCapabilities,
  type GridSchema,
  normalizeCapabilities,
} from "@ranjeetk25/schema-grid-core";
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import {
  FIXTURE_COLUMN_IDS as C,
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
  createFixtureRows,
  createFixtureSchema,
} from "@ranjeetk25/schema-grid-core/testing";
import {
  act,
  configure,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../test/render";
import { SchemaGridWorkbench } from "./SchemaGridWorkbench";
import type { SchemaGridWorkbenchProps } from "./types";
import { createMemoryViewStore } from "./viewStore";

configure({ asyncUtilTimeout: 5000 });

const ADMIN = {
  id: FIXTURE_USERS.admin.id,
  roles: [...FIXTURE_USERS.admin.roles],
};
const TEST_GRID = {
  gridOptions: { domLayout: "autoHeight", suppressRowVirtualisation: true },
} as const;

function memory(schema: GridSchema = createFixtureSchema()) {
  return createInMemoryDataSource({
    schema,
    rows: createFixtureRows(),
    user: ADMIN,
    now: () => new Date(FIXTURE_NOW),
    timeZone: FIXTURE_TIME_ZONE,
  });
}

function withCaps(
  base: DataSource,
  caps: Partial<DataSourceCapabilities>,
): DataSource {
  return Object.assign(Object.create(base) as DataSource, {
    capabilities: () => normalizeCapabilities(caps),
  });
}

function renderWorkbench(
  extra: Partial<SchemaGridWorkbenchProps> & Record<string, unknown> = {},
) {
  const schema = createFixtureSchema();
  let handle: SchemaGridHandle | null = null;
  const props = {
    dataSource: memory(schema),
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
  const r = renderWithMantine(<SchemaGridWorkbench {...props} />);
  return { ...r, handle: () => handle };
}

const rows = (container: HTMLElement) =>
  container.querySelectorAll(".ag-row[row-id]");

describe("<SchemaGridWorkbench> cell colors (v0.4)", () => {
  it("shows Cell color and Color rules for a source that reads + writes colors", async () => {
    const { container } = renderWorkbench();
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    expect(
      await screen.findByRole("button", { name: "Cell color" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Color rules" }),
    ).toBeInTheDocument();
  });

  it("no paint UI without cellColors write; rules still offered (they render client-side)", async () => {
    const { container } = renderWorkbench({
      dataSource: withCaps(memory(), {}),
    });
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    await screen.findByRole("button", { name: "Color rules" });
    expect(screen.queryByRole("button", { name: "Cell color" })).toBeNull();
  });

  it("features can switch paint and color rules off", async () => {
    const { container } = renderWorkbench({
      features: { paint: false, colorRules: false },
    });
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    await screen.findByRole("button", { name: "Filter" });
    expect(screen.queryByRole("button", { name: "Cell color" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Color rules" })).toBeNull();
  });

  it("paints the focused cell through the grid handle; undo clears it again", async () => {
    const ds = memory();
    const setCellColors = vi.spyOn(ds, "setCellColors");
    const { container, user, handle } = renderWorkbench({ dataSource: ds });
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    await act(async () => {
      const api = handle()?.api();
      const idx = api?.getRowNode("r1")?.rowIndex ?? 0;
      api?.setFocusedCell(idx, C.name);
    });
    await user.click(await screen.findByRole("button", { name: "Cell color" }));
    const red = await screen.findByRole("button", { name: "Red" });
    await waitFor(() => expect(red).toBeEnabled());
    await user.click(red);
    await waitFor(() => expect(setCellColors).toHaveBeenCalledTimes(1));
    expect(
      (setCellColors.mock.calls[0]?.[0] as CellColorBatch).changes,
    ).toEqual([{ rowId: "r1", columnId: C.name, color: "red" }]);
    await waitFor(() =>
      expect(
        container.querySelector(
          `.ag-row[row-id="r1"] .ag-cell[col-id="${C.name}"]`,
        ),
      ).toHaveClass("sg-color-red"),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Undo" })).not.toHaveAttribute(
        "aria-disabled",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(setCellColors).toHaveBeenCalledTimes(2));
    expect(
      (setCellColors.mock.calls[1]?.[0] as CellColorBatch).changes,
    ).toEqual([{ rowId: "r1", columnId: C.name, color: null }]);
  });

  it("reports skipped cells (not paintable for this user) in the hidden color-report", async () => {
    const counsellor = {
      id: FIXTURE_USERS.counsellor.id,
      roles: [...FIXTURE_USERS.counsellor.roles],
    };
    const { container, handle } = renderWorkbench({ user: counsellor });
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    // Fee is admin-edit only: the counsellor can't paint it.
    await act(async () => {
      await handle()?.setCellColor("blue", [
        { rowId: "r1", columnId: C.name },
        { rowId: "r1", columnId: C.fee },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByTestId("color-report")).toHaveTextContent(
        '"skipped":1',
      ),
    );
  });

  it("Color rules dialog (lazy) saves the view's rules through the handle", async () => {
    const { container, user, handle } = renderWorkbench();
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    await user.click(
      await screen.findByRole("button", { name: "Color rules" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Color rules" });
    await user.click(within(dialog).getByRole("button", { name: "Add rule" }));
    await user.click(within(dialog).getByRole("radio", { name: "Green" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(handle()?.captureView()?.colorRules).toEqual([
        expect.objectContaining({ color: "green", target: { kind: "row" } }),
      ]),
    );
    // The toolbar button counts the view's rules.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Color rules" }),
      ).toHaveTextContent("1"),
    );
  });

  it("the filter builder offers color is when the source filters by color", async () => {
    const { container, user } = renderWorkbench();
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    await user.click(await screen.findByRole("button", { name: "Filter" }));
    const pop = await screen.findByRole("dialog", { name: /^Filter/ });
    await user.click(
      within(pop).getByRole("button", { name: "Add condition" }),
    );
    const column = within(pop)
      .getAllByLabelText("Column")
      .filter((e) => e.tagName === "INPUT")
      .at(-1);
    if (!column) throw new Error("no column picker");
    await user.click(column);
    await user.click(await within(pop).findByRole("option", { name: "Name" }));
    const op = within(pop)
      .getAllByLabelText("Operator")
      .filter((e) => e.tagName === "INPUT")
      .at(-1);
    if (!op) throw new Error("no operator picker");
    await user.click(op);
    expect(
      within(pop).getByRole("option", { name: "color is" }),
    ).toBeInTheDocument();
  });
});
