import type { DataSource, GridSchema, ViewDef } from "@ranjeetk25/schema-grid-core";
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import {
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
  createFixtureRows,
  createFixtureSchema,
} from "@ranjeetk25/schema-grid-core/testing";
import { act, configure, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../test/render";
import { SchemaGridWorkbench } from "./SchemaGridWorkbench";
import { normalizeCapabilities } from "./capabilities";
import type { SchemaGridWorkbenchProps, WorkbenchCapabilities } from "./types";
import { ALL_ROWS_VIEW, createMemoryViewStore } from "./viewStore";

// AG Grid renders slowly under a loaded CI box; 1s default waits flake.
configure({ asyncUtilTimeout: 5000 });

const ADMIN = { id: FIXTURE_USERS.admin.id, roles: [...FIXTURE_USERS.admin.roles] };

function memory(schema: GridSchema = createFixtureSchema()) {
  return createInMemoryDataSource({
    schema,
    rows: createFixtureRows(),
    user: ADMIN,
    now: () => new Date(FIXTURE_NOW),
    timeZone: FIXTURE_TIME_ZONE,
  });
}

/** The in-memory source, optionally reporting capabilities (C2). */
function source(caps?: Partial<WorkbenchCapabilities>, base: DataSource = memory()): DataSource {
  if (!caps) return base;
  return Object.assign(Object.create(base) as DataSource, { capabilities: () => normalizeCapabilities(caps) });
}

type Extra = Partial<SchemaGridWorkbenchProps> & Record<string, unknown>;

function renderWorkbench(extra: Extra = {}) {
  const schema = createFixtureSchema();
  const props = {
    dataSource: memory(schema),
    schema,
    user: ADMIN,
    viewStore: createMemoryViewStore(),
    height: 400,
    gridProps: TEST_GRID,
    ...extra,
  } as SchemaGridWorkbenchProps;
  return renderWithMantine(<SchemaGridWorkbench {...props} />);
}

const rows = (container: HTMLElement) => container.querySelectorAll(".ag-row[row-id]");
const TEST_GRID = { gridOptions: { domLayout: "autoHeight", suppressRowVirtualisation: true } } as const;

describe("<SchemaGridWorkbench>", () => {
  it("renders the toolbar and the in-memory rows", async () => {
    const { container } = renderWorkbench({ title: "Leads", subtitle: "All applicants" });
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    expect(screen.getByRole("heading", { name: "Leads" })).toBeInTheDocument();
    expect(screen.getByText("All applicants")).toBeInTheDocument();
    for (const name of ["Filter", "Group", "Undo", "Redo", "Import…", "Export CSV", "Add column"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("searchbox", { name: "Search rows" })).toBeInTheDocument();
    expect(screen.getByTestId("workbench-status")).toHaveTextContent("No changes yet");
  });

  it("hides Group when the source reports groupBy:false", async () => {
    renderWorkbench({ dataSource: source({ groupBy: false }) });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Group" })).toBeNull());
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
  });

  it("features only switch off", async () => {
    renderWorkbench({ features: { search: false, import: false, addColumn: false } });
    await screen.findByRole("button", { name: "Filter" });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Import…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add column" })).toBeNull();
  });

  describe("polling", () => {
    beforeEach(() => {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    });
    afterEach(() => vi.restoreAllMocks());

    it("polls the change feed by default", async () => {
      const ds = memory();
      const getChanges = vi.spyOn(ds as Required<DataSource>, "getChanges");
      renderWorkbench({ dataSource: ds, pollIntervalMs: 20 });
      await waitFor(() => expect(getChanges).toHaveBeenCalled(), { timeout: 5000 });
    });

    it("changeFeed:false disables polling", async () => {
      const base = memory();
      const getChanges = vi.spyOn(base as Required<DataSource>, "getChanges");
      const { container } = renderWorkbench({ dataSource: source({ changeFeed: false }, base), pollIntervalMs: 20 });
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      await act(() => new Promise((r) => setTimeout(r, 150)));
      expect(getChanges).not.toHaveBeenCalled();
    });

    it("flags a newer schema version from the feed with a Reload banner", async () => {
      const ds = memory();
      vi.spyOn(ds as Required<DataSource>, "getChanges").mockResolvedValue({ cursor: "c", rows: [], deletedRowIds: [], schemaVersion: 999 });
      renderWorkbench({ dataSource: ds, pollIntervalMs: 20 });
      const banner = await screen.findByTestId("workbench-banner-schema-changed", {}, { timeout: 5000 });
      expect(banner).toHaveTextContent("The columns were changed elsewhere.");
      expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    });
  });

  it("write.cells:false shows the read-only banner and hides undo / import", async () => {
    renderWorkbench({ dataSource: source({ write: { cells: false, createRows: false, deleteRows: false } }) });
    const banner = await screen.findByTestId("workbench-banner-read-only");
    expect(banner).toHaveTextContent("Read-only");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import…" })).toBeNull();
  });

  it("renders slots (nodes and render functions)", async () => {
    const onStart = vi.fn();
    renderWorkbench({
      toolbarStart: (ctx: { openExport(): void; features: { group: boolean } }) => (
        <button type="button" onClick={() => onStart(ctx.features.group)}>
          Start slot
        </button>
      ),
      toolbarEnd: <span>End slot</span>,
      statusBar: <span>Status slot</span>,
    } as Extra);
    await screen.findByRole("button", { name: "Start slot" });
    expect(screen.getByText("End slot")).toBeInTheDocument();
    expect(screen.getByTestId("workbench-status")).toHaveTextContent("Status slot");
    screen.getByRole("button", { name: "Start slot" }).click();
    expect(onStart).toHaveBeenCalledWith(true);
  });

  it("renders a custom empty state when there are no rows", async () => {
    const schema = createFixtureSchema();
    const ds = createInMemoryDataSource({ schema, rows: [], user: ADMIN });
    renderWorkbench({ dataSource: ds, schema, emptyState: <p>Nothing here yet</p> });
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
  });

  it("loads views from the view store and saves new ones back", async () => {
    const saved: ViewDef = { ...ALL_ROWS_VIEW, id: "v_saved", name: "Unpaid" };
    const store = createMemoryViewStore({ [createFixtureSchema().id]: [ALL_ROWS_VIEW, saved] });
    const { user } = renderWorkbench({ viewStore: store });
    await user.click(await screen.findByRole("button", { name: "All rows" }));
    await user.click(await screen.findByRole("menuitem", { name: "Unpaid" }));
    await screen.findByRole("button", { name: "Unpaid" });

    await user.click(screen.getByRole("button", { name: "Unpaid" }));
    await user.click(await screen.findByRole("menuitem", { name: "Save as new view" }));
    await user.type(await screen.findByRole("textbox", { name: "View name" }), "Called today{Enter}");
    await waitFor(() => expect(store.snapshot()[createFixtureSchema().id]?.map((v) => v.name)).toContain("Called today"));
  });

  it("controlled views report changes instead of persisting", async () => {
    const onViewsChange = vi.fn();
    const store = createMemoryViewStore();
    const { user } = renderWorkbench({ views: [ALL_ROWS_VIEW], onViewsChange, viewStore: store });
    await user.click(await screen.findByRole("button", { name: "All rows" }));
    await user.click(await screen.findByRole("menuitem", { name: "Save as new view" }));
    await user.type(await screen.findByRole("textbox", { name: "View name" }), "Mine{Enter}");
    await waitFor(() => expect(onViewsChange).toHaveBeenCalled());
    expect(onViewsChange.mock.calls[0]?.[0].map((v: ViewDef) => v.name)).toEqual(["All rows", "Mine"]);
    expect(store.snapshot()).toEqual({});
  });

  it("shows a permission banner with Retry, and onError", async () => {
    const base = memory();
    const denied = Object.assign(new Error("Forbidden"), { code: "PERMISSION_DENIED", status: 403 });
    const fetch = vi.spyOn(base, "fetch").mockRejectedValueOnce(denied);
    const onError = vi.fn();
    const { user } = renderWorkbench({ dataSource: base, onError });
    const banner = await screen.findByTestId("workbench-banner-permission-denied");
    expect(banner).toHaveTextContent("You don't have permission to load rows.");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "permission-denied", op: "fetch" }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.queryByTestId("workbench-banner-permission-denied")).toBeNull());
  });

  it("shows a network banner when the source can't be reached", async () => {
    const base = memory();
    vi.spyOn(base, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderWorkbench({ dataSource: base });
    expect(await screen.findByTestId("workbench-banner-network")).toHaveTextContent("Couldn't reach the server to load rows.");
  });

  it("client mode loads the schema from the client; no updateSchema → no Add column", async () => {
    const schema = createFixtureSchema();
    const ds = memory(schema);
    const client = { dataSource: ds, getSchema: vi.fn().mockResolvedValue(schema), gridId: "leads" };
    const { container } = renderWithMantine(
      <SchemaGridWorkbench client={client} user={ADMIN} mode="client" viewStore={createMemoryViewStore()} height={400} gridProps={TEST_GRID} />,
    );
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    expect(client.getSchema).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Add column" })).toBeNull();
  });

  it("client capabilities drive features", async () => {
    const schema = createFixtureSchema();
    const client = {
      dataSource: memory(schema),
      getSchema: async () => schema,
      updateSchema: async (s: GridSchema) => s,
      capabilities: async () => normalizeCapabilities({ groupBy: false, search: false }),
    };
    renderWithMantine(<SchemaGridWorkbench client={client} user={ADMIN} mode="client" viewStore={createMemoryViewStore()} height={400} gridProps={TEST_GRID} />);
    await screen.findByRole("button", { name: "Add column" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Group" })).toBeNull());
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
