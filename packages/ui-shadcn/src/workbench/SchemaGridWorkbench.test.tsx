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
  const handle = createDataSourceHandler(source(caps, memory(schema)));
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
});
