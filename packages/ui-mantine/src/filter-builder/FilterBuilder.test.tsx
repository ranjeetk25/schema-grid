import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FilterNode } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { FilterBuilder } from "./FilterBuilder";

const schema = buildFixtureSchema();

/** All <input>s of a labelled Mantine field (hidden listboxes share the aria-label). */
const inputs = (name: string, root: HTMLElement = document.body): HTMLElement[] =>
  within(root)
    .getAllByLabelText(name)
    .filter((e) => e.tagName === "INPUT");

const lastInput = (name: string): HTMLElement => {
  const el = inputs(name).at(-1);
  if (!el) throw new Error(`no input labelled ${name}`);
  return el;
};

async function pick(user: UserEvent, field: string, option: string) {
  await user.click(lastInput(field));
  await user.click(await screen.findByRole("option", { name: option }));
}

function setup(value: FilterNode | null = null, maxDepth?: number) {
  const onChange = vi.fn<(node: FilterNode | null) => void>();
  const r = renderWithMantine(
    <FilterBuilder
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      value={value}
      onChange={onChange}
      maxDepth={maxDepth}
    />,
  );
  return { ...r, onChange };
}

const S8 = {
  op: "and",
  children: [
    { columnId: FIXTURE_IDS.payment, operator: "isNot", value: "paid" },
    { columnId: FIXTURE_IDS.call, operator: "isWithin", value: { relative: "yesterday" } },
  ],
};

describe("FilterBuilder", () => {
  it("§8 scenario: payment is not Paid AND call is within yesterday (byte-exact)", async () => {
    const { user, onChange } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    await pick(user, "Operator", "is not");
    await pick(user, "Value", "Paid");

    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Call status");
    await pick(user, "Operator", "is within");
    await pick(user, "Relative date", "Yesterday");

    expect(screen.getByRole("radio", { name: "AND" })).toBeChecked();
    const last = onChange.mock.lastCall?.[0];
    expect(last).toStrictEqual(S8);
    expect(JSON.stringify(last)).toBe(JSON.stringify(S8));
  });

  it("does not emit while a condition is incomplete or invalid", async () => {
    const { user, onChange } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders an initial value", () => {
    setup(S8 as FilterNode);
    expect(inputs("Column").map((i) => (i as HTMLInputElement).value)).toEqual(["Payment status", "Call status"]);
    expect(inputs("Operator").map((i) => (i as HTMLInputElement).value)).toEqual(["is not", "is within"]);
    expect((lastInput("Relative date") as HTMLInputElement).value).toBe("Yesterday");
  });

  it("operator options change when the column changes from select to date", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    await user.click(lastInput("Operator"));
    expect(screen.getByRole("option", { name: "is any of" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "is within" })).toBeNull();
    await user.keyboard("{Escape}");

    await pick(user, "Column", "Call status");
    expect((lastInput("Operator") as HTMLInputElement).value).toBe("is");
    await user.click(lastInput("Operator"));
    expect(screen.getByRole("option", { name: "is within" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "is any of" })).toBeNull();
  });

  it("disables Add group in a nested group, with a tooltip explaining why", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add group" }));
    expect(screen.getAllByRole("button", { name: "Add group" })).toHaveLength(2);
    const [rootGroup, nestedGroup] = screen.getAllByRole("group", { name: "Filter group" }) as [HTMLElement, HTMLElement];
    const nested = within(nestedGroup).getByRole("button", { name: "Add group" });
    expect(nested).toBeDisabled();
    const rootButtons = within(rootGroup).getAllByRole("button", { name: "Add group" });
    expect(rootButtons.at(-1)).toBeEnabled();
    await user.hover(nested.parentElement as HTMLElement);
    expect(await screen.findByText("Groups can nest at most 2 levels deep")).toBeInTheDocument();
  });

  it("nested groups emit a nested AST", async () => {
    const { user, onChange } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add group" }));
    const nested = screen.getAllByRole("group", { name: "Filter group" })[1] as HTMLElement;
    await user.click(within(nested).getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Notes");
    await pick(user, "Operator", "is empty");
    expect(JSON.stringify(onChange.mock.lastCall?.[0])).toBe(
      JSON.stringify({ op: "and", children: [{ op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] }] }),
    );
  });

  it("the column picker never offers the hidden Secret column", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await user.click(lastInput("Column"));
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toContain("Payment status");
    expect(names).toContain("Total");
    expect(names).not.toContain("Secret");
    expect(screen.queryByText("Secret")).toBeNull();
  });

  it("shows the validation error inline for an empty single value", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    expect(screen.getByText("A value is required")).toBeInTheDocument();
    await pick(user, "Value", "Paid");
    expect(screen.queryByText("A value is required")).toBeNull();
  });

  it("toggling to OR updates the emitted op", async () => {
    const { user, onChange } = setup(S8 as FilterNode);
    await user.click(screen.getByRole("radio", { name: "OR" }));
    expect(onChange.mock.lastCall?.[0]).toStrictEqual({ ...S8, op: "or" });
  });

  it("remove deletes the row and emits the remaining filter / null", async () => {
    const { user, onChange } = setup(S8 as FilterNode);
    await user.click(screen.getAllByRole("button", { name: "Remove condition" })[0] as HTMLElement);
    expect(inputs("Column")).toHaveLength(1);
    expect(onChange.mock.lastCall?.[0]).toStrictEqual({ op: "and", children: [S8.children[1]] });
    await user.click(screen.getByRole("button", { name: "Remove condition" }));
    expect(screen.queryAllByLabelText("Column")).toHaveLength(0);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("resets the draft when the controlled value changes from outside", () => {
    const { rerender } = setup(S8 as FilterNode);
    const node = { op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] } as FilterNode;
    rerender(
      <FilterBuilder
        schema={schema}
        registry={buildFixtureRegistry()}
        uiRegistry={buildStubUiRegistry()}
        access={buildFixtureAccess(schema)}
        value={node}
        onChange={vi.fn()}
      />,
    );
    expect(inputs("Column").map((i) => (i as HTMLInputElement).value)).toEqual(["Notes"]);
  });
});
