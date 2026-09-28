/** v0.4.1 capability-gated field types in the column builder. */
import { act, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../internal/core-contracts";
import { createShadcnUiRegistry } from "../registry/createShadcnUiRegistry";
import {
  FIXTURE_NOW,
  buildFixtureAccess,
  buildFixtureRegistry,
  buildFixtureSchema,
  buildStubDataSource,
} from "../test/fixtures";
import { renderUi } from "../test/render";
import { ColumnPanel, type ColumnPanelProps } from "./ColumnPanel";
import { TypePicker } from "./TypePicker";
import { TypeStep } from "./TypeStep";

const NO_LINKS = { lookup: false, options: true };
const NOTHING = { lookup: false, options: false };

describe("TypePicker capabilities", () => {
  it("hides types the capabilities can't back", async () => {
    const { user } = renderUi(<TypePicker registry={buildFixtureRegistry()} value={null} onChange={vi.fn()} capabilities={NOTHING} />);
    await user.click(screen.getByRole("button", { name: /^Type/ }));
    const names = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(names.some((n) => n.startsWith("Link"))).toBe(false);
    expect(names.some((n) => n.startsWith("User"))).toBe(false);
    expect(names.some((n) => n.startsWith("Text"))).toBe(true);
  });

  it("lists every type without capabilities (or when they allow)", async () => {
    const registry = buildFixtureRegistry();
    const { user } = renderUi(<TypePicker registry={registry} value={null} onChange={vi.fn()} capabilities={{ lookup: true, options: true }} />);
    await user.click(screen.getByRole("button", { name: /^Type/ }));
    expect(screen.getAllByRole("option")).toHaveLength(registry.list().length);
  });

  it("an existing column keeps its unavailable type, shown with the reason", () => {
    renderUi(<TypePicker registry={buildFixtureRegistry()} value="link" onChange={vi.fn()} locked capabilities={NO_LINKS} />);
    expect(screen.getByRole("button", { name: /^Type/ })).toHaveTextContent("Link");
    expect(screen.getByText("Linking isn't set up for this grid")).toBeInTheDocument();
  });
});

describe("TypeStep capabilities", () => {
  it("hides unavailable types but keeps the selected one, with its reason", () => {
    const registry = buildFixtureRegistry();
    renderUi(<TypeStep registry={registry} value="user" onChange={vi.fn()} locked capabilities={NOTHING} />);
    expect(screen.queryByRole("radio", { name: "Link" })).toBeNull();
    const user = screen.getByRole("radio", { name: "User" });
    expect(user).toHaveAttribute("aria-checked", "true");
    expect(within(user).getByText("People search isn't set up for this grid")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(registry.list().length - 1);
  });
});

const linkColumn: ColumnDef = {
  id: "col_lead",
  key: "lead",
  label: "Lead",
  type: "link",
  config: { target: "leads", multiple: true },
  order: 9,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
};

function panelProps(overrides: Partial<ColumnPanelProps> = {}): ColumnPanelProps {
  const base = buildFixtureSchema();
  const schema = { ...base, columns: [...base.columns, linkColumn] };
  const registry = buildFixtureRegistry();
  return {
    opened: true,
    onClose: vi.fn(),
    schema,
    registry,
    uiRegistry: createShadcnUiRegistry({ fieldTypes: registry }),
    access: buildFixtureAccess(schema),
    roles: ["admin"],
    onSave: vi.fn(),
    ...overrides,
  };
}

describe("ColumnPanel capabilities", () => {
  it("the type list hides link without lookup", async () => {
    const { user } = renderUi(<ColumnPanel {...panelProps({ capabilities: NO_LINKS })} />);
    await user.click(screen.getByRole("button", { name: /^Type/ }));
    const names = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(names.some((n) => n.startsWith("Link"))).toBe(false);
    expect(names.some((n) => n.startsWith("User"))).toBe(true);
  });

  it("editing a link column without lookup: keeps the type, and the default value picker never calls lookup", async () => {
    const dataSource = buildStubDataSource();
    const { user } = renderUi(<ColumnPanel {...panelProps({ capabilities: NO_LINKS, column: linkColumn, dataSource })} />);
    expect(screen.getByRole("button", { name: /^Type/ })).toHaveTextContent("Link");
    await user.click(screen.getByRole("button", { name: /^Options/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getAllByText("Linking isn't set up for this grid").length).toBeGreaterThan(0);
    expect(dataSource.lookup).not.toHaveBeenCalled();
  });
});
