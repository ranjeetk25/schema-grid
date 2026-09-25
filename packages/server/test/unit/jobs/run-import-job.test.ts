import { describe, expect, it } from "vitest";
import { PermissionError } from "../../../src/errors";
import type {
  Access,
  ChangeBatch,
  ChangeResult,
  ColumnDef,
  DataSource,
  GridQuery,
  GridRow,
  GridSchema,
  RowPartial,
} from "../../../src/internal/core";
import { createDefaultRegistry } from "../../../src/internal/core";
import type { ImportJobStore, ImportProgress } from "../../../src/jobs/run-import-job";
import { runImportJob } from "../../../src/jobs/run-import-job";

function col(id: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef {
  return {
    id,
    key: id,
    label: id,
    type,
    config: {},
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

const registry = createDefaultRegistry();

const schema: GridSchema = {
  id: "g1",
  schemaVersion: 1,
  columns: [col("name", "text"), col("amount", "number"), col("email", "email"), col("readonly", "text")],
};

const access: ReadonlyMap<string, Access> = new Map([
  ["name", "edit"],
  ["amount", "edit"],
  ["email", "edit"],
  ["readonly", "read"],
]);

async function* rowsOf(list: Record<string, unknown>[]): AsyncIterable<Record<string, unknown>> {
  for (const r of list) yield r;
}

interface FakeDataSourceOptions {
  fetch?: DataSource<GridRow>["fetch"];
  applyChanges?: DataSource<GridRow>["applyChanges"];
}

function makeFakeDataSource(options: FakeDataSourceOptions = {}) {
  const created: RowPartial<GridRow>[][] = [];
  let nextId = 1;
  const ds: DataSource<GridRow> = {
    fetch: options.fetch ?? (async () => ({ rows: [] })),
    applyChanges:
      options.applyChanges ?? (async (): Promise<ChangeResult> => ({ applied: [], conflicts: [], errors: [] })),
    createRows: async (partials) => {
      created.push(partials);
      return partials.map(
        (p): GridRow => ({
          id: p.id ?? `row-${nextId++}`,
          version: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          cells: { ...(p.cells ?? {}) },
        }),
      );
    },
    deleteRows: async () => {},
  };
  return { ds, created };
}

describe("runImportJob", () => {
  it("parses and validates each mapped value, skipping a row with any invalid cell", async () => {
    const { ds, created } = makeFakeDataSource();

    const report = await runImportJob({
      rows: rowsOf([
        { Name: "Amy", Amount: "100" },
        { Name: "Bob", Amount: "not-a-number" },
      ]),
      mapping: { Name: "name", Amount: "amount" },
      dataSource: ds,
      schema,
      registry,
      access,
      mode: "create",
    });

    expect(report.failed).toEqual([{ rowIndex: 1, columnId: "amount", message: "Not a number" }]);
    expect(report.created).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual([{ cells: { name: "Amy", amount: 100 } }]);
  });

  it("chunks rows into batches of batchSize (createRows call sizes)", async () => {
    const { ds, created } = makeFakeDataSource();
    const list = Array.from({ length: 5 }, (_, i) => ({ Name: `n${i}` }));

    await runImportJob({
      rows: rowsOf(list),
      mapping: { Name: "name" },
      dataSource: ds,
      schema,
      registry,
      access,
      mode: "create",
      batchSize: 2,
    });

    expect(created.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it("throws PermissionError before consuming rows or writing, when a mapped column is not editable", async () => {
    const { ds, created } = makeFakeDataSource();
    let consumed = false;
    async function* rows() {
      consumed = true;
      yield { X: "1" };
    }

    await expect(
      runImportJob({
        rows: rows(),
        mapping: { X: "readonly" },
        dataSource: ds,
        schema,
        registry,
        access,
        mode: "create",
      }),
    ).rejects.toBeInstanceOf(PermissionError);

    expect(created).toHaveLength(0);
    expect(consumed).toBe(false);
  });

  it("reports PermissionError with the offending column ids and usage 'edit'", async () => {
    const { ds } = makeFakeDataSource();
    try {
      await runImportJob({
        rows: rowsOf([{ X: "1" }]),
        mapping: { X: "readonly" },
        dataSource: ds,
        schema,
        registry,
        access,
        mode: "create",
      });
      throw new Error("expected runImportJob to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      const permErr = err as PermissionError;
      expect(permErr.details).toEqual({ columnIds: ["readonly"], usage: "edit" });
    }
  });

  it("calls onProgress with monotonically increasing counters after each full batch", async () => {
    const { ds } = makeFakeDataSource();
    const list = Array.from({ length: 4 }, (_, i) => ({ Name: `n${i}` }));
    const progress: ImportProgress[] = [];

    await runImportJob({
      rows: rowsOf(list),
      mapping: { Name: "name" },
      dataSource: ds,
      schema,
      registry,
      access,
      mode: "create",
      batchSize: 2,
      onProgress: (p) => progress.push(p),
    });

    expect(progress).toEqual([
      { processed: 2, created: 2, updated: 0, failed: 0 },
      { processed: 4, created: 4, updated: 0, failed: 0 },
    ]);
  });

  it("upserts: updates matched rows and creates the rest, using keyColumnId to look up existing rows", async () => {
    const existingRow: GridRow = {
      id: "row-existing",
      version: 3,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cells: { name: "Old", amount: 1 },
    };
    let applyChangesBatch: ChangeBatch | undefined;

    const { ds, created } = makeFakeDataSource({
      fetch: async (query: GridQuery) => {
        const cond = query.filter as { columnId: string; operator: string; value: unknown } | null;
        const matches = cond ? (Array.isArray(cond.value) ? cond.value.includes("Old") : cond.value === "Old") : false;
        return { rows: matches ? [existingRow] : [] };
      },
      applyChanges: async (batch) => {
        applyChangesBatch = batch;
        return { applied: batch.changes, conflicts: [], errors: [] };
      },
    });

    const report = await runImportJob({
      rows: rowsOf([
        { Name: "Old", Amount: "5" },
        { Name: "New", Amount: "9" },
      ]),
      mapping: { Name: "name", Amount: "amount" },
      dataSource: ds,
      schema,
      registry,
      access,
      mode: "upsert",
      keyColumnId: "name",
    });

    expect(report.updated).toBe(1);
    expect(report.created).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual([{ cells: { name: "New", amount: 9 } }]);
    expect(applyChangesBatch?.source).toBe("import");
    expect(applyChangesBatch?.baseVersions).toEqual({ "row-existing": 3 });
    expect(applyChangesBatch?.id.length).toBeLessThanOrEqual(64);
    expect(applyChangesBatch?.changes).toEqual(
      expect.arrayContaining([
        { rowId: "row-existing", columnId: "name", prev: "Old", next: "Old" },
        { rowId: "row-existing", columnId: "amount", prev: 1, next: 5 },
      ]),
    );
  });

  it("counts a conflicted upsert row as failed, not updated", async () => {
    const existingRow: GridRow = {
      id: "row-existing",
      version: 3,
      updatedAt: "2026-01-01T00:00:00.000Z",
      cells: { name: "Old", amount: 1 },
    };
    const { ds } = makeFakeDataSource({
      fetch: async () => ({ rows: [existingRow] }),
      applyChanges: async (batch) => ({
        applied: [],
        conflicts: batch.changes.map((c) => ({
          rowId: c.rowId,
          columnId: c.columnId,
          serverValue: c.prev,
          serverVersion: 4,
          updatedAt: "2026-01-02T00:00:00.000Z",
        })),
        errors: [],
      }),
    });

    const report = await runImportJob({
      rows: rowsOf([{ Name: "Old", Amount: "5" }]),
      mapping: { Name: "name", Amount: "amount" },
      dataSource: ds,
      schema,
      registry,
      access,
      mode: "upsert",
      keyColumnId: "name",
    });

    expect(report.updated).toBe(0);
    expect(report.created).toBe(0);
    expect(report.failed.length).toBeGreaterThan(0);
    expect(report.failed[0]!.rowIndex).toBe(0);
  });

  it("throws when mode is upsert without a keyColumnId", async () => {
    const { ds } = makeFakeDataSource();
    await expect(
      runImportJob({
        rows: rowsOf([{ Name: "a" }]),
        mapping: { Name: "name" },
        dataSource: ds,
        schema,
        registry,
        access,
        mode: "upsert",
      }),
    ).rejects.toThrow();
  });

  it("calls store.save after each batch and at the end, keyed by jobId", async () => {
    const { ds } = makeFakeDataSource();
    const saved: { jobId: string; report: unknown }[] = [];
    const store: ImportJobStore = {
      save: async (jobId, report) => {
        saved.push({ jobId, report });
      },
      load: async () => undefined,
    };
    const list = Array.from({ length: 3 }, (_, i) => ({ Name: `n${i}` }));

    await runImportJob({
      jobId: "job-1",
      rows: rowsOf(list),
      mapping: { Name: "name" },
      dataSource: ds,
      schema,
      registry,
      access,
      mode: "create",
      batchSize: 2,
      store,
    });

    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(saved.every((s) => s.jobId === "job-1")).toBe(true);
    expect(saved[saved.length - 1]!.report).toEqual({ created: 3, updated: 0, failed: [] });
  });

  it("honours an already-aborted signal by stopping without further writes", async () => {
    const { ds, created } = makeFakeDataSource();
    const controller = new AbortController();
    controller.abort();

    const report = await runImportJob({
      rows: rowsOf([{ Name: "a" }, { Name: "b" }]),
      mapping: { Name: "name" },
      dataSource: ds,
      schema,
      registry,
      access,
      mode: "create",
      signal: controller.signal,
    });

    expect(created).toHaveLength(0);
    expect(report.created).toBe(0);
  });
});
