import { describe, expect, it } from "vitest";
import { PAYMENT_OPTIONS, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import { draftPreviewColumn, draftRequirements, isDraftDirty } from "./form-model";
import { columnDraftReducer, createColumnDraft, validateColumnDraft } from "./model";

const schema = buildFixtureSchema();
const registry = buildFixtureRegistry();
const fresh = () => createColumnDraft({ schema, registry });
const reqs = (d: ReturnType<typeof fresh>, formulaValid = false) =>
  draftRequirements(d, { errors: validateColumnDraft(d, { schema, registry }), formulaValid, permissionsError: null }).map((r) => r.message);

describe("form model", () => {
  it("phrases what is missing in form order", () => {
    expect(reqs(fresh())).toEqual(["Name is required", "Choose a type"]);
    let d = columnDraftReducer(fresh(), { type: "setType", fieldType: "select", registry });
    d = columnDraftReducer(d, { type: "setLabel", label: "Status" });
    expect(reqs(d)).toEqual(["Add at least one option"]);
    d = columnDraftReducer(d, { type: "setConfig", config: { options: [{ id: "x", label: " " }] } });
    expect(reqs(d)).toEqual(["Every option needs a label"]);
    d = columnDraftReducer(d, { type: "setConfig", config: { options: PAYMENT_OPTIONS } });
    expect(reqs(d)).toEqual([]);
  });

  it("asks for a formula, then a valid one", () => {
    let d = columnDraftReducer(fresh(), { type: "setType", fieldType: "formula", registry });
    d = columnDraftReducer(d, { type: "setLabel", label: "Double" });
    expect(reqs(d)).toEqual(["Enter a formula"]);
    d = columnDraftReducer(d, { type: "setFormula", formula: "{amount} *" });
    expect(reqs(d)).toEqual(["Fix the formula"]);
    expect(reqs(d, true)).toEqual([]);
  });

  it("builds a renderable preview column as soon as a type is chosen", () => {
    expect(draftPreviewColumn(fresh(), { schema, registry })).toBeNull();
    const d = columnDraftReducer(fresh(), { type: "setType", fieldType: "number", registry });
    expect(draftPreviewColumn(d, { schema, registry, insertAt: 3 })).toMatchObject({
      id: "__draft__",
      key: "__draft__",
      label: "Untitled",
      type: "number",
      insertAt: 3,
    });
    const named = columnDraftReducer(d, { type: "setLabel", label: "Score" });
    expect(draftPreviewColumn(named, { schema, registry })).toMatchObject({ key: "score", label: "Score" });
  });

  it("tracks dirtiness by content", () => {
    const d = fresh();
    expect(isDraftDirty(d, d)).toBe(false);
    const typed = columnDraftReducer(d, { type: "setLabel", label: "x" });
    expect(isDraftDirty(d, typed)).toBe(true);
    expect(isDraftDirty(d, columnDraftReducer(typed, { type: "setLabel", label: "" }))).toBe(false);
  });
});
