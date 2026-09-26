/**
 * Every input `createRemoteDataSource` (the browser client) sends must be
 * accepted by the matching op's input schema — including the bare `null`
 * of `capabilities` / `getSchema`, which an HTTP transport may deliver as
 * "no body" (undefined) to a server that normalises it to null.
 */
import { describe, expect, it } from "vitest";
import type { GridOperation } from "../../src/wire/operations";
import { GRID_OPERATIONS } from "../../src/wire/operations";
import { createRemoteDataSource } from "../../src/wire/remote";
import { wireSchemas } from "../../src/wire/schemas";
import { FIXTURE_COLUMN_IDS as C } from "../../src/testing/schema";

describe("client-sent inputs vs wireSchemas[op].input", () => {
  it("every DataSource op's payload parses", async () => {
    const sent: [GridOperation, unknown][] = [];
    const ds = createRemoteDataSource(
      async (op, input) => {
        sent.push([op, input]);
        return op === "deleteRows" ? null : undefined;
      },
      { validateOutput: false },
    );
    await ds.fetch({ filter: null, sort: [], page: { offset: 0, limit: 10 } });
    await ds.applyChanges({ id: "b1", changes: [], baseVersions: {}, source: "edit" });
    await ds.createRows([{ cells: { a: 1 } }]);
    await ds.deleteRows(["r1"]);
    await ds.getChanges?.("");
    await ds.getOptions?.(C.status);
    await ds.getOptions?.(C.status, "pa");
    await ds.createOption?.(C.status, "New");
    await ds.lookup?.(C.programs, "x");
    await ds.capabilities?.();
    const ops = new Set(sent.map(([op]) => op));
    for (const op of GRID_OPERATIONS) {
      if (op === "getSchema" || op === "updateSchema") continue; // grid-level ops (createGridClient)
      expect(ops.has(op), `client never sends ${op}`).toBe(true);
    }
    for (const [op, input] of sent) {
      const parsed = wireSchemas[op].input.safeParse(input);
      expect(parsed.success, `${op} input ${JSON.stringify(input)}`).toBe(true);
    }
  });

  it("null-input ops: the schema takes null; getSchema also takes an absent body", () => {
    expect(wireSchemas.capabilities.input.safeParse(null).success).toBe(true);
    expect(wireSchemas.getSchema.input.safeParse(null).success).toBe(true);
    expect(wireSchemas.getSchema.input.safeParse(undefined).success).toBe(true);
    // The ops whose input is `null` — a transport may send them with no body at all.
    const nullOps = GRID_OPERATIONS.filter((op) => wireSchemas[op].input.safeParse(null).success);
    expect(nullOps).toEqual(["capabilities", "getSchema"]);
  });

  it("capabilities output: unknown keys such as a server's `defaultSort` survive validation (passthrough)", () => {
    const answer = {
      maxPageSize: 200,
      sort: "all",
      filter: "all",
      groupBy: true,
      search: true,
      changeFeed: false,
      write: { cells: true, createRows: false, deleteRows: false },
      options: true,
      lookup: false,
      export: {},
      defaultSort: [{ columnId: C.name, dir: "asc" }],
    };
    expect(wireSchemas.capabilities.output.safeParse(answer).success).toBe(true);
  });
});
