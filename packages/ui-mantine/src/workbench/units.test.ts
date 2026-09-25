import {
  type ColumnDef,
  DEFAULT_CAPABILITIES,
  type DataSource,
  type DataSourceCapabilities,
  type GridSchema,
  type ViewDef,
  mergeCapabilities,
  normalizeCapabilities,
} from "@ranjeetk25/schema-grid-core";
import { createFixtureSchema } from "@ranjeetk25/schema-grid-core/testing";
import { describe, expect, it, vi } from "vitest";
import { deriveWorkbenchFeatures, isReadOnly } from "./capabilities";
import { classifyError, tapDataSource } from "./errors";
import { collectRows } from "./exportRows";
import { addOptions, insertColumn, removeColumn, rolesOf, upsertColumn } from "./schemaOps";
import { ALL_ROWS_VIEW, createLocalStorageViewStore, createMemoryViewStore } from "./viewStore";

/** The grid's effective matrix for the fixture schema under `over` (real core capability objects). */
const effective = (over: Partial<DataSourceCapabilities> = {}, schema: GridSchema = createFixtureSchema()) =>
  mergeCapabilities(schema, normalizeCapabilities(over));
const derive = (
  over: Partial<DataSourceCapabilities> = {},
  extra: Partial<Parameters<typeof deriveWorkbenchFeatures>[0]> = {},
) => deriveWorkbenchFeatures({ capabilities: effective(over), canChangeSchema: true, ...extra });

describe("deriveWorkbenchFeatures", () => {
  it("turns everything on for a fully capable source", () => {
    expect(deriveWorkbenchFeatures({ capabilities: effective(DEFAULT_CAPABILITIES), canChangeSchema: true })).toEqual({
      filter: true,
      group: true,
      search: true,
      views: true,
      export: true,
      import: true,
      addColumn: true,
      undo: true,
      polling: true,
    });
  });

  it("derives each feature from the effective matrix", () => {
    expect(derive({ groupBy: false }).group).toBe(false);
    expect(derive({ search: false }).search).toBe(false);
    expect(derive({ changeFeed: false }).polling).toBe(false);
    expect(derive({ changeFeed: "updates-only" }).polling).toBe(true);
    expect(derive({ filter: { columnIds: [] } }).filter).toBe(false);
    const someColumn = createFixtureSchema().columns[0]?.id ?? "";
    expect(derive({ filter: { columnIds: [someColumn] } }).filter).toBe(true);
    const ro = derive({ write: { cells: false, createRows: false, deleteRows: false } });
    expect(ro.undo).toBe(false);
    expect(ro.import).toBe(false);
    expect(derive({}, { canChangeSchema: false }).addColumn).toBe(false);
  });

  it("filter is off when every column is unfilterable by column option", () => {
    const schema = createFixtureSchema();
    const locked = { ...schema, columns: schema.columns.map((c) => ({ ...c, filterable: false })) };
    const f = deriveWorkbenchFeatures({ capabilities: effective({}, locked), canChangeSchema: true });
    expect(f.filter).toBe(false);
  });

  it("keeps capability-gated features off until the capabilities load", () => {
    const f = deriveWorkbenchFeatures({ capabilities: null, canChangeSchema: true });
    expect(f).toMatchObject({ group: false, search: false, filter: false, import: false, undo: false, polling: false, export: false });
    expect(f.views).toBe(true);
    expect(f.addColumn).toBe(true);
  });

  it("host features only switch OFF", () => {
    const f = deriveWorkbenchFeatures({
      capabilities: effective({ groupBy: false }),
      features: { group: true, search: false },
      canChangeSchema: true,
    });
    expect(f.group).toBe(false);
    expect(f.search).toBe(false);
    expect(f.filter).toBe(true);
  });
});

describe("isReadOnly", () => {
  it("is true only once loaded capabilities say write.cells:false", () => {
    expect(isReadOnly(null)).toBe(false);
    expect(isReadOnly(effective())).toBe(false);
    expect(isReadOnly(effective({ write: { cells: false, createRows: true, deleteRows: true } }))).toBe(true);
  });
});

describe("view stores", () => {
  const view: ViewDef = { ...ALL_ROWS_VIEW, id: "v1", name: "Mine" };
  it("localStorage round-trips per grid id", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const store = createLocalStorageViewStore({ storage });
    expect(store.load("leads")).toBeNull();
    store.save("leads", [view]);
    expect(data.has("schema-grid:views:leads")).toBe(true);
    expect(store.load("leads")).toEqual([view]);
    expect(store.load("other")).toBeNull();
  });
  it("survives blocked storage", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createLocalStorageViewStore({ storage });
    expect(() => store.save("g", [view])).not.toThrow();
    expect(store.load("g")).toBeNull();
  });
  it("memory store keeps views per grid", () => {
    const store = createMemoryViewStore();
    store.save("g", [view]);
    expect(store.load("g")).toEqual([view]);
    expect(store.snapshot()).toEqual({ g: [view] });
  });
});

describe("classifyError", () => {
  it("maps codes, statuses and network failures to banner kinds", () => {
    expect(classifyError({ code: "PERMISSION_DENIED", message: "x" })).toBe("permission-denied");
    expect(classifyError({ status: 401, message: "x" })).toBe("permission-denied");
    expect(classifyError({ code: "UNSUPPORTED_OPERATION", status: 501, message: "x" })).toBe("capability-denied");
    expect(classifyError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyError({ code: "HTTP_ERROR", status: 502, message: "x" })).toBe("network");
    expect(classifyError({ code: "SCHEMA_CHANGED", message: "x" })).toBe("schema-changed");
    expect(classifyError(new Error("boom"))).toBe("unknown");
  });
});

describe("tapDataSource", () => {
  it("reports failures, rethrows, and keeps optional methods absent", async () => {
    const onError = vi.fn();
    const onReadOk = vi.fn();
    const src = {
      fetch: vi.fn().mockResolvedValue({ rows: [] }),
      applyChanges: vi.fn().mockRejectedValue({ code: "PERMISSION_DENIED", message: "no" }),
      createRows: vi.fn(),
      deleteRows: vi.fn(),
    } as unknown as DataSource;
    const tapped = tapDataSource(src, { onError, onReadOk });
    expect(tapped.getChanges).toBeUndefined();
    await tapped.fetch({ filter: null, sort: [], page: { offset: 0, limit: 1 } });
    expect(onReadOk).toHaveBeenCalledWith("fetch");
    await expect(tapped.applyChanges({ changes: [] } as never)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: "permission-denied", op: "applyChanges" }));
  });
});

describe("collectRows", () => {
  it("keeps paging past a short page until the source runs dry", async () => {
    const all = Array.from({ length: 450 }, (_, i) => ({ id: `r${i}`, version: 1, cells: {} }));
    // Capped source: never returns more than 200 per page whatever was asked.
    const fetch = vi.fn(async ({ page }: { page: { offset: number; limit: number } }) => ({
      rows: all.slice(page.offset, page.offset + Math.min(page.limit, 200)),
    }));
    const rows = await collectRows({ fetch } as unknown as DataSource, { filter: null, sort: [], pageSize: 500 });
    expect(rows).toHaveLength(450);
  });
});

describe("schema ops", () => {
  const col = (id: string, order: number): ColumnDef =>
    ({ id, key: id, label: id, type: "text", config: {}, order, createdAt: "", updatedAt: "" }) as ColumnDef;
  const schema: GridSchema = { id: "g", schemaVersion: 1, columns: [col("a", 0), col("b", 1)] };

  it("inserts beside a column or at the end and renumbers", () => {
    expect(insertColumn(schema.columns, col("n", 9), { beforeColumnId: "b" }).map((c) => `${c.id}${c.order}`)).toEqual(["a0", "n1", "b2"]);
    expect(insertColumn(schema.columns, col("n", 9), { afterColumnId: "a" }).map((c) => c.id)).toEqual(["a", "n", "b"]);
    expect(insertColumn(schema.columns, col("n", 9)).map((c) => c.id)).toEqual(["a", "b", "n"]);
  });
  it("upserts, removes and adds options with version bumps", () => {
    const up = upsertColumn(schema, { ...col("a", 0), label: "A!" });
    expect(up.schemaVersion).toBe(2);
    expect(up.columns[0]?.label).toBe("A!");
    expect(removeColumn(schema, "a").columns.map((c) => c.id)).toEqual(["b"]);
    const withOpt = addOptions(schema, "a", [{ id: "x", label: "X" }]);
    expect((withOpt.columns[0]?.config as { options: unknown[] }).options).toHaveLength(1);
    expect(addOptions(withOpt, "a", [{ id: "x", label: "X" }])).toBe(withOpt);
  });
  it("collects roles from permissions and the user", () => {
    const s: GridSchema = {
      ...schema,
      columns: [{ ...col("a", 0), permissions: { read: "all", edit: { roles: ["admin", "counsellor"] } } }],
    };
    expect(rolesOf(s, { id: "u", roles: ["viewer"] })).toEqual(["admin", "counsellor", "viewer"]);
  });
});
