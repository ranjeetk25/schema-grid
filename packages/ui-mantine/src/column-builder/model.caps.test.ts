/** v0.2 C1: editing a column in the builder keeps its sortable / filterable / settable options. */
import { describe, expect, it } from "vitest";
import { FIXTURE_IDS, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import { buildColumnDef, columnDraftReducer, createColumnDraft } from "./model";

const registry = buildFixtureRegistry();
const now = "2026-09-26T00:00:00.000Z";

describe("column builder preserves column options (C1)", () => {
  for (const options of [
    { sortable: false, filterable: false, settable: false },
    { sortable: true, filterable: false, settable: true },
  ]) {
    it(`keeps ${JSON.stringify(options)} through an edit`, () => {
      const base = buildFixtureSchema();
      const schema = {
        ...base,
        columns: base.columns.map((c) => (c.id === FIXTURE_IDS.notes ? { ...c, ...options } : c)),
      };
      const original = schema.columns.find((c) => c.id === FIXTURE_IDS.notes);
      if (!original) throw new Error("fixture column missing");
      let d = createColumnDraft({ schema, registry, column: original });
      d = columnDraftReducer(d, { type: "setLabel", label: "Remarks" });
      d = columnDraftReducer(d, { type: "setRequired", required: true });
      const col = buildColumnDef(d, { schema, registry, now, generateId: () => "nope" });
      expect(col).toMatchObject({ id: original.id, label: "Remarks", required: true, ...options });
    });
  }

  it("a new column carries none of them (core defaults apply)", () => {
    const schema = buildFixtureSchema();
    let d = createColumnDraft({ schema, registry });
    d = columnDraftReducer(d, { type: "setType", fieldType: "text", registry });
    d = columnDraftReducer(d, { type: "setLabel", label: "Fresh" });
    const col = buildColumnDef(d, { schema, registry, now, generateId: () => "col_new" });
    expect(col).not.toHaveProperty("sortable");
    expect(col).not.toHaveProperty("filterable");
    expect(col).not.toHaveProperty("settable");
  });
});
