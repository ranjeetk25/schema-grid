import { createGridClient } from "@ranjeetk25/schema-grid-ag-grid";
import {
  type ChangeFeedEntry,
  type DataSource,
  type DataSourceCapabilities,
  type GridSchema,
  type ViewDef,
  normalizeCapabilities,
} from "@ranjeetk25/schema-grid-core";
import { createInMemoryDataSource } from "@ranjeetk25/schema-grid-core/memory";
import {
  FIXTURE_NOW,
  FIXTURE_TIME_ZONE,
  FIXTURE_USERS,
  createFixtureRows,
  createFixtureSchema,
} from "@ranjeetk25/schema-grid-core/testing";
import { createDataSourceHandler } from "@ranjeetk25/schema-grid-core/wire";
import type { ChangeBatch, ChangeResult } from "@ranjeetk25/schema-grid-core";
import { FIXTURE_COLUMN_IDS as C } from "@ranjeetk25/schema-grid-core/testing";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderUi } from "../test/render";
import { SchemaGridWorkbench } from "./SchemaGridWorkbench";
import type { SchemaGridWorkbenchProps } from "./types";
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

/** The in-memory source, optionally reporting (real, normalised) capabilities (C2). */
function source(caps?: Partial<DataSourceCapabilities>, base: DataSource = memory()): DataSource {
  if (!caps) return base;
  return Object.assign(Object.create(base) as DataSource, { capabilities: () => normalizeCapabilities(caps) });
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * A real `createGridClient` over a fake `POST /grid/:gridId/:op` server backed
 * by the in-memory source (the capabilities op is answered by the wire handler).
 */
function gridClient(caps?: Partial<DataSourceCapabilities>) {
  let schema = createFixtureSchema();
  // Like createGridRegistry for an admin with a schema store: the schema is writable unless the test says otherwise.
  const handle = createDataSourceHandler(source({ schema: { read: true, write: true }, ...caps }, memory(schema)));
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const op = String(url).split("/").pop() ?? "";
    // v0.3 client: null inputs (getSchema / capabilities) travel with no body.
    const input = init?.body === undefined ? null : (JSON.parse(String(init.body)) as unknown);
    if (op === "getSchema") return jsonResponse(200, { data: schema });
    if (op === "updateSchema") {
      // Wire contract (like createGridRegistry): the input carries the CURRENT version; the server bumps it.
      const next = input as GridSchema;
      if (next.schemaVersion !== schema.schemaVersion) {
        return jsonResponse(409, {
          error: { code: "SCHEMA_CONFLICT", message: "stale", details: { currentVersion: schema.schemaVersion } },
        });
      }
      schema = { ...next, schemaVersion: schema.schemaVersion + 1 };
      return jsonResponse(200, { data: schema });
    }
    const result = await handle(op, input);
    return result.ok ? jsonResponse(200, { data: result.data }) : jsonResponse(result.status, { error: result.error });
  });
  return { client: createGridClient({ baseUrl: "/grid", gridId: "leads", fetch: fetch as unknown as typeof globalThis.fetch }), fetch };
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
  return renderUi(<SchemaGridWorkbench {...props} />);
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

  it("scopes the kit under .sg-ui and clears search with the button or Escape", async () => {
    const { user } = renderWorkbench();
    const root = screen.getByTestId("workbench");
    expect(root).toHaveClass("sg-ui");
    const search = await screen.findByRole("searchbox", { name: "Search rows" });
    await user.type(search, "Asha");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    await user.type(search, "Ravi");
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
  });

  it("hides Group when the source reports groupBy:false", async () => {
    renderWorkbench({ dataSource: source({ groupBy: false }) });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Group" })).toBeNull());
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
  });

  it("hides the search box when the source reports search:false", async () => {
    const { container } = renderWorkbench({ dataSource: source({ search: false }) });
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    await screen.findByRole("button", { name: "Filter" });
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("keeps Group and search hidden until the capabilities arrive", async () => {
    let resolve: (c: DataSourceCapabilities) => void = () => undefined;
    const pending = new Promise<DataSourceCapabilities>((r) => {
      resolve = r;
    });
    const ds = Object.assign(Object.create(memory()) as DataSource, { capabilities: () => pending });
    const { container } = renderWorkbench({ dataSource: ds });
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Group" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    await act(async () => resolve(normalizeCapabilities({})));
    await screen.findByRole("button", { name: "Group" });
    expect(screen.getByRole("searchbox", { name: "Search rows" })).toBeInTheDocument();
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
      const getChanges = vi.spyOn(ds, "getChanges");
      renderWorkbench({ dataSource: ds, pollIntervalMs: 20 });
      await waitFor(() => expect(getChanges).toHaveBeenCalled(), { timeout: 5000 });
    });

    it("changeFeed:false disables polling", async () => {
      const base = memory();
      const getChanges = vi.spyOn(base, "getChanges");
      const { container } = renderWorkbench({ dataSource: source({ changeFeed: false }, base), pollIntervalMs: 20 });
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      await act(() => new Promise((r) => setTimeout(r, 150)));
      expect(getChanges).not.toHaveBeenCalled();
    });

    it('"updates-only" keeps polling but ignores removed rows', async () => {
      const base = memory();
      const entry: ChangeFeedEntry = { cursor: "c", rows: [], deletedRowIds: ["r1"], schemaVersion: 1 };
      const getChanges = vi.spyOn(base as Required<DataSource>, "getChanges").mockResolvedValue(entry);
      const onRemoteChanges = vi.fn();
      const { container } = renderWorkbench({
        dataSource: source({ changeFeed: "updates-only" }, base),
        pollIntervalMs: 20,
        onRemoteChanges,
      });
      await waitFor(() => expect(getChanges).toHaveBeenCalled(), { timeout: 5000 });
      await waitFor(() => expect(onRemoteChanges).toHaveBeenCalled(), { timeout: 5000 });
      expect(onRemoteChanges.mock.calls[0]?.[0].deletedRowIds).toEqual([]);
      expect(screen.getByTestId("workbench-status")).not.toHaveTextContent("remote update");
      expect(rows(container).length).toBe(createFixtureRows().length);
    });

    it("flags a newer schema version from the feed with a Reload banner", async () => {
      const ds = memory();
      vi.spyOn(ds as Required<DataSource>, "getChanges").mockResolvedValue({ cursor: "c", rows: [], deletedRowIds: [], schemaVersion: 999 });
      renderWorkbench({ dataSource: ds, pollIntervalMs: 20 });
      const banner = await screen.findByTestId("workbench-banner-schema-changed");
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

  it("the quick CSV export respects export.maxRows", async () => {
    const blobs: Blob[] = [];
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:x";
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: () => undefined });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      const { container } = renderWorkbench({ dataSource: source({ export: { maxRows: 2 } }) });
      await waitFor(() => expect(rows(container).length).toBe(createFixtureRows().length));
      fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
      await waitFor(() => expect(create).toHaveBeenCalled());
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blobs[0] as Blob);
      });
      expect(text.trim().split(/\r?\n/)).toHaveLength(1 + 2);
    } finally {
      click.mockRestore();
      // The helper revokes the URL a second later: keep a no-op revoke around for that.
      Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke ?? (() => undefined) });
    }
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
    await user.click(await screen.findByRole("menuitemradio", { name: "Unpaid" }));
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

  it("client mode loads the schema from a real grid client", async () => {
    const { client, fetch } = gridClient();
    const { container } = renderUi(
      <SchemaGridWorkbench client={client} user={ADMIN} mode="client" viewStore={createMemoryViewStore()} height={400} gridProps={TEST_GRID} />,
    );
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    const ops = fetch.mock.calls.map((c) => String(c[0]).split("/").pop());
    expect(ops.filter((op) => op === "getSchema")).toHaveLength(1);
    expect(ops).toContain("capabilities");
    expect(await screen.findByRole("button", { name: "Add column" })).toBeInTheDocument();
  });

  it("adding a column through a grid client sends the current schemaVersion (the server bumps it)", async () => {
    const { client, fetch } = gridClient();
    const { container, user } = renderUi(
      <SchemaGridWorkbench client={client} user={ADMIN} mode="client" viewStore={createMemoryViewStore()} height={400} gridProps={TEST_GRID} />,
    );
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    await user.click(await screen.findByRole("button", { name: "Add column" }));
    const dialog = await screen.findByRole("dialog", { name: "New column" });
    await user.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Follow up");
    await user.click(within(dialog).getByRole("button", { name: /^Type/ }));
    await user.click(await screen.findByRole("option", { name: /^Text/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create column" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New column" })).toBeNull());
    const sent = fetch.mock.calls.filter((c) => String(c[0]).endsWith("/updateSchema"));
    expect(sent).toHaveLength(1);
    const body = JSON.parse(String(sent[0]?.[1]?.body)) as GridSchema;
    expect(body.schemaVersion).toBe(createFixtureSchema().schemaVersion);
    expect(body.columns.map((c) => c.label)).toContain("Follow up");
    expect(await client.getSchema()).toMatchObject({ schemaVersion: createFixtureSchema().schemaVersion + 1 });
  });

  it("the client's wire capabilities drive features", async () => {
    const { client } = gridClient({ groupBy: false, search: false });
    const { container } = renderUi(
      <SchemaGridWorkbench client={client} user={ADMIN} mode="client" viewStore={createMemoryViewStore()} height={400} gridProps={TEST_GRID} />,
    );
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
    await screen.findByRole("button", { name: "Filter" });
    expect(screen.queryByRole("button", { name: "Group" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  // ---- v0.3 ---------------------------------------------------------------------

  describe("host events (v0.3)", () => {
    it("a host beforeCellsChange veto blocks the optimistic apply and counts nothing", async () => {
      const ds = memory();
      const applyChanges = vi.spyOn(ds, "applyChanges");
      const beforeCellsChange = vi.fn(() => false as const);
      const { container } = renderWorkbench({ dataSource: ds, events: { beforeCellsChange } });
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      const before = cellOf(container, "r1", C.name).textContent;
      await editCell(container, "r1", C.name, "Vetoed");
      await waitFor(() => expect(beforeCellsChange).toHaveBeenCalledTimes(1));
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(applyChanges).not.toHaveBeenCalled();
      expect(cellOf(container, "r1", C.name).textContent).toBe(before);
      expect(screen.getByTestId("saved-count")).toHaveTextContent("0");
    });

    it("meta attached by a host beforeCellsChange reaches the data source untouched", async () => {
      const ds = memory();
      const applyChanges = vi.spyOn(ds, "applyChanges");
      const { container } = renderWorkbench({
        dataSource: ds,
        events: {
          beforeCellsChange: (batch: ChangeBatch) => ({
            ...batch,
            meta: { reuploadDeadline: "2026-10-01" },
            changes: batch.changes.map((c) => ({ ...c, meta: { decisionMessage: "ok" } })),
          }),
        },
      });
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      await editCell(container, "r1", C.name, "With meta");
      await waitFor(() => expect(applyChanges).toHaveBeenCalledTimes(1));
      const sent = applyChanges.mock.calls[0]?.[0] as ChangeBatch;
      expect(sent.meta).toEqual({ reuploadDeadline: "2026-10-01" });
      expect(sent.changes[0]).toMatchObject({ columnId: C.name, next: "With meta", meta: { decisionMessage: "ok" } });
      await waitFor(() => expect(screen.getByTestId("saved-count")).toHaveTextContent("1"));
    });

    it("a host onConflict sees the conflict while the built-in prompt still opens", async () => {
      const base = memory();
      const ds: DataSource = Object.assign(Object.create(base) as DataSource, {
        applyChanges: async (batch: ChangeBatch): Promise<ChangeResult> => ({
          applied: [],
          errors: [],
          conflicts: batch.changes.map((c) => ({
            rowId: c.rowId,
            columnId: c.columnId,
            serverValue: "Server wins",
            serverVersion: 9,
            updatedAt: FIXTURE_NOW,
          })),
        }),
      });
      const onConflict = vi.fn();
      const { container } = renderWorkbench({ dataSource: ds, events: { onConflict } });
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      await editCell(container, "r1", C.name, "Mine");
      await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
      expect(onConflict.mock.calls[0]?.[0]).toMatchObject({ rowId: "r1", columnId: C.name, serverValue: "Server wins" });
      expect(await screen.findByRole("dialog", { name: "Edit conflict" })).toBeInTheDocument();
    });

    it("gridProps.events is honoured too (the events prop wins per handler)", async () => {
      const ds = memory();
      const fromGridProps = vi.fn();
      const fromProp = vi.fn();
      const viewFromGridProps = vi.fn();
      const { container, user } = renderWorkbench({
        dataSource: ds,
        gridProps: { ...TEST_GRID, events: { onCellsChange: fromGridProps, onViewChange: viewFromGridProps } },
        events: { onCellsChange: fromProp },
      });
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      await editCell(container, "r1", C.name, "Both");
      await waitFor(() => expect(fromProp).toHaveBeenCalledTimes(1));
      // onCellsChange came from the prop (not gridProps); onViewChange still came from gridProps.
      expect(fromGridProps).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Columns" }));
      const dialog = await screen.findByRole("dialog", { name: "Columns" });
      await user.click(within(dialog).getByRole("checkbox", { name: "Fee" }));
      await waitFor(() => expect(viewFromGridProps).toHaveBeenCalled());
    });
  });

  describe("silent rejection (v0.3)", () => {
    it("rejected changes revert quietly, count as not saved and never as saved", async () => {
      const base = memory();
      const ds: DataSource = Object.assign(Object.create(base) as DataSource, {
        applyChanges: async (batch: ChangeBatch): Promise<ChangeResult> => ({ applied: [], errors: [], conflicts: [], rejected: batch.changes }),
      });
      const { container } = renderWorkbench({ dataSource: ds });
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      const before = cellOf(container, "r1", C.name).textContent;
      await editCell(container, "r1", C.name, "Nope");
      await waitFor(() => expect(screen.getByTestId("not-saved-count")).toHaveTextContent("1"));
      expect(screen.getByTestId("saved-count")).toHaveTextContent("0");
      expect(screen.getByTestId("workbench-status")).toHaveTextContent("1 change not saved");
      await waitFor(() => expect(cellOf(container, "r1", C.name).textContent).toBe(before));
      expect(cellOf(container, "r1", C.name).className).not.toContain("sg-cell-error");
      // No assertive announcement and no banner: a rejection is not an error.
      const assertive = container.querySelector('[aria-live="assertive"]');
      expect((assertive?.textContent ?? "").replace(/\u200b/g, "")).toBe("");
      expect(screen.queryByTestId(/workbench-banner-/)).toBeNull();
    });

    it("the saved counter counts applied cells", async () => {
      const { container } = renderWorkbench();
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      await editCell(container, "r1", C.name, "One");
      await waitFor(() => expect(screen.getByTestId("saved-count")).toHaveTextContent("1"));
      await editCell(container, "r2", C.name, "Two");
      await waitFor(() => expect(screen.getByTestId("saved-count")).toHaveTextContent("2"));
      expect(screen.getByTestId("workbench-status")).toHaveTextContent("2 saved");
    });
  });

  describe("schema editability (v0.3)", () => {
    it("a client whose capabilities say schema.write:false hides every column-editing entry point", async () => {
      const { client } = gridClient({ schema: { read: true, write: false } });
      const { container } = renderUi(
        <SchemaGridWorkbench client={client} user={ADMIN} mode="client" viewStore={createMemoryViewStore()} height={400} gridProps={TEST_GRID} />,
      );
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      await screen.findByRole("button", { name: "Filter" });
      expect(screen.queryByRole("button", { name: "Add column" })).toBeNull();
      expect(container.querySelector(".sg-add-column-header, [data-testid='add-column-header']")).toBeNull();
      expect(screen.queryByRole("dialog", { name: "New column" })).toBeNull();
    });

    it("schema.write:true shows it (and features.addColumn:false still turns it off)", async () => {
      const { client } = gridClient({ schema: { read: true, write: true } });
      renderUi(
        <SchemaGridWorkbench client={client} user={ADMIN} mode="client" viewStore={createMemoryViewStore()} height={400} gridProps={TEST_GRID} features={{ addColumn: false }} />,
      );
      await screen.findByRole("button", { name: "Filter" });
      expect(screen.queryByRole("button", { name: "Add column" })).toBeNull();
    });
  });

  describe("columns picker (v0.3)", () => {
    it("hides a column through the popover, shows the hidden count and never lists permission-hidden columns", async () => {
      const counsellor = { id: FIXTURE_USERS.counsellor.id, roles: [...FIXTURE_USERS.counsellor.roles] };
      const schema = createFixtureSchema();
      const { container, user } = renderWorkbench({
        schema,
        dataSource: createInMemoryDataSource({ schema, rows: createFixtureRows(), user: counsellor }),
        user: counsellor,
      });
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      expect(container.querySelector(`.ag-header-cell[col-id="${C.fee}"]`)).not.toBeNull();
      await user.click(screen.getByRole("button", { name: "Columns" }));
      const dialog = await screen.findByRole("dialog", { name: "Columns" });
      expect(within(dialog).queryByRole("checkbox", { name: "Notes" })).toBeNull();
      await user.click(within(dialog).getByRole("checkbox", { name: "Fee" }));
      await waitFor(() => expect(container.querySelector(`.ag-header-cell[col-id="${C.fee}"]`)).toBeNull());
      expect(screen.getByTestId("columns-hidden-count")).toHaveTextContent("1");
      expect(screen.getByRole("button", { name: "Columns (1 hidden)" })).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Show all" }));
      await waitFor(() => expect(container.querySelector(`.ag-header-cell[col-id="${C.fee}"]`)).not.toBeNull());
      await user.type(within(dialog).getByRole("textbox", { name: "Search columns" }), "pay");
      expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    });

    it("reorders with the move buttons and the change lands in the live view's column state", async () => {
      const onViewsChange = vi.fn();
      const { container, user } = renderWorkbench({ views: [ALL_ROWS_VIEW], onViewsChange });
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      const headerIds = () =>
        [...container.querySelectorAll(".ag-header-cell[col-id^='col_']")].map((h) => h.getAttribute("col-id"));
      const [first, second] = headerIds();
      await user.click(screen.getByRole("button", { name: "Columns" }));
      const dialog = await screen.findByRole("dialog", { name: "Columns" });
      const secondLabel = createFixtureSchema().columns.find((c) => c.id === second)?.label ?? "";
      await user.click(within(dialog).getByRole("button", { name: `Move ${secondLabel} up` }));
      await waitFor(() => expect(headerIds().slice(0, 2)).toEqual([second, first]));
      // Saving the view persists the new column state.
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: /^All rows/ }));
      await user.click(await screen.findByRole("menuitem", { name: "Save changes" }));
      await waitFor(() => expect(onViewsChange).toHaveBeenCalled());
      const saved = onViewsChange.mock.calls.at(-1)?.[0][0] as ViewDef;
      expect(saved.columnState.slice(0, 2).map((c) => c.id)).toEqual([second, first]);
    });
  });

  describe("export (v0.3)", () => {
    const stubDownloads = () => {
      const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
      const names: string[] = [];
      Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });
      return {
        names,
        restore: () => {
          click.mockRestore();
          Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke ?? (() => undefined) });
        },
      };
    };

    it("names the quick CSV export grid-view-date.csv by default and honours exportFileName", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 26, 12) });
      const downloads = stubDownloads();
      try {
        const { container, unmount } = renderWorkbench({ dataSource: source({ export: { maxRows: 2 } }), gridId: "Leads Grid" });
        await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
        fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
        await waitFor(() => expect(downloads.names).toEqual(["leads-grid-all-rows-2026-09-26.csv"]));
        unmount();
        const second = renderWorkbench({
          dataSource: source({ export: { maxRows: 2 } }),
          exportFileName: (ctx: { gridId: string; format: string }) => `${ctx.gridId}-${ctx.format}-custom`,
        });
        await waitFor(() => expect(rows(second.container).length).toBeGreaterThan(0));
        fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
        await waitFor(() => expect(downloads.names.at(-1)).toBe("admissions-csv-custom.csv"));
      } finally {
        downloads.restore();
        vi.useRealTimers();
      }
    });

    it("a failing quick export shows the export banner with Retry and calls onError", async () => {
      const downloads = stubDownloads();
      try {
        let fail = true;
        const onError = vi.fn();
        const { container, user } = renderWorkbench({
          dataSource: source({ export: { maxRows: 2 } }),
          onError,
          exportFileName: () => {
            if (fail) throw new Error("naming service down");
            return "ok";
          },
        });
        await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
        fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
        const banner = await screen.findByTestId("workbench-banner-export");
        expect(banner).toHaveTextContent("Couldn't export: naming service down");
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "unknown", op: "export" }));
        fail = false;
        await user.click(within(banner).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(downloads.names).toEqual(["ok.csv"]));
        await waitFor(() => expect(screen.queryByTestId("workbench-banner-export")).toBeNull());
      } finally {
        downloads.restore();
      }
    });

    it("the Export dialog reports failures through the banner and onError as well", async () => {
      const onError = vi.fn();
      const { container, user } = renderWorkbench({
        onError,
        exportFileName: () => {
          throw new Error("dialog export broke");
        },
        toolbarStart: (ctx: { openExport(): void }) => (
          <button type="button" onClick={ctx.openExport}>
            Open export
          </button>
        ),
      } as Extra);
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));
      await user.click(screen.getByRole("button", { name: "Open export" }));
      const dialog = await screen.findByRole("dialog", { name: "Export" });
      await user.click(within(dialog).getByRole("button", { name: "Export" }));
      expect(await within(dialog).findByText("dialog export broke")).toBeInTheDocument();
      expect(await screen.findByTestId("workbench-banner-export")).toHaveTextContent("dialog export broke");
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ op: "export" }));
    });
  });
});

const cellOf = (container: HTMLElement, rowId: string, colId: string): HTMLElement => {
  const el = container.querySelector<HTMLElement>(`.ag-row[row-id="${rowId}"] .ag-cell[col-id="${colId}"]`);
  if (!el) throw new Error(`cell ${rowId}/${colId} not rendered`);
  return el;
};

/** dblclick → type → Enter on a text cell. */
async function editCell(container: HTMLElement, rowId: string, colId: string, text: string): Promise<void> {
  fireEvent.doubleClick(cellOf(container, rowId, colId), { detail: 2 });
  let input: HTMLInputElement | null = null;
  await waitFor(() => {
    input = cellOf(container, rowId, colId).querySelector("input");
    expect(input).not.toBeNull();
  });
  const el = input as unknown as HTMLInputElement;
  fireEvent.change(el, { target: { value: text } });
  fireEvent.keyDown(el, { key: "Enter", code: "Enter" });
}
