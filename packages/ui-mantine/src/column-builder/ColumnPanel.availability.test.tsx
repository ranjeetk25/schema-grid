/** v0.4.1 capability-gated field types: the column builder hides types the source can't back. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../internal/core-contracts";
import { createMantineUiRegistry } from "../registry/createMantineUiRegistry";
import {
  FIXTURE_NOW,
  buildFixtureAccess,
  buildFixtureRegistry,
  buildFixtureSchema,
  buildStubDataSource,
  buildStubUiRegistry,
} from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { ColumnPanel, type ColumnPanelProps } from "./ColumnPanel";
import { TypeStep } from "./TypeStep";

const NO_LOOKUP = { lookup: false, options: false };

function setup(overrides: Partial<ColumnPanelProps> = {}) {
  const schema = buildFixtureSchema();
  return renderWithMantine(
    <ColumnPanel
      opened
      onClose={vi.fn()}
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      roles={["admin"]}
      onSave={vi.fn()}
      {...overrides}
    />,
  );
}

const typeOptions = () =>
  within(screen.getByRole("listbox", { name: "Field types" }))
    .getAllByRole("option")
    .map((o) => o.getAttribute("aria-label"));

const linkColumn: ColumnDef = {
  id: "col_lead",
  key: "lead",
  label: "Lead",
  type: "link",
  config: { target: "leads", multiple: false },
  order: 9,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
};

describe("ColumnPanel: capability-gated types", () => {
  it("offers every type when the capabilities allow (or are unknown)", async () => {
    const { user } = setup({ capabilities: { lookup: true, options: true } });
    await user.click(screen.getByRole("button", { name: /^Type:/ }));
    expect(typeOptions()).toEqual(expect.arrayContaining(["Link", "User"]));
  });

  it("hides link without lookup and user without options", async () => {
    const { user } = setup({ capabilities: NO_LOOKUP });
    await user.click(screen.getByRole("button", { name: /^Type:/ }));
    const names = typeOptions();
    expect(names).not.toContain("Link");
    expect(names).not.toContain("User");
    expect(names).toContain("Select");
  });

  it("an existing column keeps its unavailable type, shown with the reason", () => {
    setup({ capabilities: NO_LOOKUP, column: linkColumn });
    expect(screen.getByRole("button", { name: "Type: Link" })).toBeDisabled();
    expect(screen.getByText("Linking isn't set up for this grid")).toBeInTheDocument();
  });

  it("the link default-value picker never calls lookup when it's unavailable", async () => {
    const dataSource = buildStubDataSource();
    const { user } = setup({
      capabilities: NO_LOOKUP,
      column: linkColumn,
      dataSource,
      uiRegistry: createMantineUiRegistry(),
    });
    await user.click(screen.getByRole("button", { name: /More options/ }));
    expect(screen.getAllByText("Linking isn't set up for this grid").length).toBeGreaterThan(1);
    expect(dataSource.lookup).not.toHaveBeenCalled();
  });
});

describe("TypeStep: capability-gated types", () => {
  it("hides unavailable types; the selected one stays with its reason", () => {
    const { unmount } = renderWithMantine(
      <TypeStep registry={buildFixtureRegistry()} value={null} onChange={vi.fn()} capabilities={NO_LOOKUP} />,
    );
    expect(screen.queryByRole("button", { name: "Link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "User" })).toBeNull();
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    unmount();
    renderWithMantine(<TypeStep registry={buildFixtureRegistry()} value="user" locked onChange={vi.fn()} capabilities={NO_LOOKUP} />);
    const card = screen.getByRole("button", { name: "User" });
    expect(card).toHaveTextContent("People search isn't set up for this grid");
  });
});
