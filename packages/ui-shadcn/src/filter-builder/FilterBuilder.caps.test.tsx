/** v0.2 C1: `filterable: false` columns are never offered by the filter builder's column picker. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FilterNode, GridSchema } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderUi } from "../test/render";
import { FilterBuilder } from "./FilterBuilder";
import { filterableColumns } from "./model";

const base = buildFixtureSchema();
const schema: GridSchema = {
  ...base,
  columns: base.columns.map((c) =>
    c.id === FIXTURE_IDS.notes || c.id === FIXTURE_IDS.secret ? { ...c, filterable: false } : c,
  ),
};

const texts = (name: string) => within(document.body).queryAllByLabelText(name).map((c) => c.textContent);

function setup(value: FilterNode | null) {
  const onChange = vi.fn<(node: FilterNode | null) => void>();
  const r = renderUi(
    <FilterBuilder
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      value={value}
      onChange={onChange}
      debounceMs={0}
    />,
  );
  return { ...r, onChange };
}

describe("filterable:false (C1)", () => {
  it("filterableColumns drops filterable:false columns", () => {
    const ids = filterableColumns(schema, buildFixtureAccess(schema)).map((c) => c.id);
    expect(ids).not.toContain(FIXTURE_IDS.notes);
    expect(ids).toContain(FIXTURE_IDS.payment);
  });

  it("the column picker does not offer a filterable:false column", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    const pickers = within(document.body).queryAllByLabelText("Column");
    const last = pickers.at(-1);
    if (!last) throw new Error("no column picker");
    await user.click(last);
    const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(names).toContain("Payment status");
    expect(names).not.toContain("Notes");
  });

  it("an existing condition on a filterable:false column (e.g. from a saved view) still renders its label", () => {
    setup({ op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] });
    expect(texts("Column")).toEqual(["Notes"]);
    expect(texts("Operator")).toEqual(["is empty"]);
  });

  it("an existing condition on a hidden unfilterable column never leaks its label", () => {
    setup({ op: "and", children: [{ columnId: FIXTURE_IDS.secret, operator: "isEmpty" }] });
    expect(texts("Column")).toEqual(["Column"]);
    expect(screen.queryByText("Secret")).toBeNull();
  });
});
