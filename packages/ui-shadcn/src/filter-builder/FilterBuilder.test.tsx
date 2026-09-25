import { act, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilterNode } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderUi } from "../test/render";
import { FilterBuilder, type FilterBuilderProps } from "./FilterBuilder";

const schema = buildFixtureSchema();

/** Every control labelled `name` (column pickers / Radix Select triggers). */
const controls = (name: string, root: HTMLElement = document.body): HTMLElement[] => within(root).queryAllByLabelText(name);

const lastControl = (name: string): HTMLElement => {
  const el = controls(name).at(-1);
  if (!el) throw new Error(`no control labelled ${name}`);
  return el;
};

const texts = (name: string) => controls(name).map((c) => c.textContent);

async function pick(user: UserEvent, field: string, option: string) {
  await user.click(lastControl(field));
  await user.click(await screen.findByRole("option", { name: option }));
}

/**
 * Mantine-parity setup: `debounceMs: 0` makes emission synchronous so the
 * ported assertions run unchanged; the debounced default is covered below.
 */
function setup(value: FilterNode | null = null, maxDepth?: number, extra: Partial<FilterBuilderProps> = {}) {
  const onChange = vi.fn<(node: FilterNode | null) => void>();
  const r = renderUi(
    <FilterBuilder
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      value={value}
      onChange={onChange}
      maxDepth={maxDepth}
      debounceMs={0}
      {...extra}
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
    expect(texts("Column")).toEqual(["Payment status", "Call status"]);
    expect(texts("Operator")).toEqual(["is not", "is within"]);
    expect(lastControl("Relative date")).toHaveTextContent("Yesterday");
  });

  it("rows read Where / and / and (Notion-style conjunction labels)", () => {
    setup({ ...S8, children: [...S8.children, { columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] } as FilterNode);
    const rows = screen.getAllByRole("group", { name: /^Condition/ });
    expect(rows.map((r) => r.querySelector("[data-slot=conjunction]")?.textContent)).toEqual(["Where", "and", "and"]);
  });

  it("the column picker shows a field-type icon next to each column", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await user.click(lastControl("Column"));
    const option = screen.getByRole("option", { name: "Call status" });
    expect(option.querySelector("svg")).not.toBeNull();
  });

  it("operator options change when the column changes from select to date", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    await user.click(lastControl("Operator"));
    expect(screen.getByRole("option", { name: "is any of" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "is within" })).toBeNull();
    await user.keyboard("{Escape}");

    await pick(user, "Column", "Call status");
    expect(lastControl("Operator")).toHaveTextContent("is");
    await user.click(lastControl("Operator"));
    expect(screen.getByRole("option", { name: "is within" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "is any of" })).toBeNull();
  });

  it("disables Add group in a nested group, with a tooltip explaining why", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await user.click(screen.getByRole("button", { name: "Add group" }));
    expect(screen.getAllByRole("button", { name: "Add group" })).toHaveLength(2);
    const [rootGroup, nestedGroup] = screen.getAllByRole("group", { name: "Filter group" }) as [HTMLElement, HTMLElement];
    const nested = within(nestedGroup).getByRole("button", { name: "Add group" });
    expect(nested).toBeDisabled();
    const rootButtons = within(rootGroup).getAllByRole("button", { name: "Add group" });
    expect(rootButtons.at(-1)).toBeEnabled();
    await user.hover(nested.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Groups can nest at most 2 levels deep");
  });

  it("a new group starts with one blank condition and its own AND/OR toggle", async () => {
    const { user } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await user.click(screen.getByRole("button", { name: "Add group" }));
    const nested = screen.getAllByRole("group", { name: "Filter group" })[1] as HTMLElement;
    expect(controls("Column", nested)).toHaveLength(1);
    expect(within(nested).getByRole("radio", { name: "AND" })).toBeChecked();
  });

  it("nested groups emit a nested AST", async () => {
    const { user, onChange } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
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
    await user.click(lastControl("Column"));
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
    expect(screen.getByText("Expected a single value")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Condition/ })).toHaveAttribute("data-invalid", "true");
    await pick(user, "Value", "Paid");
    expect(screen.queryByText("Expected a single value")).toBeNull();
    expect(screen.getByRole("group", { name: /^Condition/ })).not.toHaveAttribute("data-invalid");
  });

  it("toggling to OR updates the emitted op", async () => {
    const { user, onChange } = setup(S8 as FilterNode);
    await user.click(screen.getByRole("radio", { name: "OR" }));
    expect(onChange.mock.lastCall?.[0]).toStrictEqual({ ...S8, op: "or" });
    expect(screen.getAllByRole("group", { name: /^Condition/ })[1]?.querySelector("[data-slot=conjunction]")).toHaveTextContent("or");
  });

  it("remove deletes the row and emits the remaining filter / null", async () => {
    const { user, onChange } = setup(S8 as FilterNode);
    await user.click(screen.getAllByRole("button", { name: "Remove condition" })[0] as HTMLElement);
    expect(controls("Column")).toHaveLength(1);
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
        debounceMs={0}
      />,
    );
    expect(texts("Column")).toEqual(["Notes"]);
  });

  it("empty state: one line and one ghost Add condition button", async () => {
    const { user } = setup(null);
    expect(screen.getByText("Add a condition to filter rows")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    expect(screen.queryByText("Add a condition to filter rows")).toBeNull();
  });
});

describe("FilterBuilder review follow-ups", () => {
  it("removing the last real condition emits null even while a blank row remains", async () => {
    const { user, onChange } = setup({ op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] });
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await user.click(screen.getAllByRole("button", { name: "Remove condition" })[0] as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("shows a group-level error for an incoming AST nested too deep", () => {
    setup({
      op: "and",
      children: [{ op: "or", children: [{ op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] }] }],
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/nested at most 2 levels/);
  });

  it("caps maxDepth at the core limit", () => {
    setup({ op: "and", children: [{ op: "or", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] }] }, 5);
    const addGroups = screen.getAllByRole("button", { name: "Add group" });
    expect(addGroups).toHaveLength(2);
    expect(addGroups[0]).toBeDisabled(); // nested group (depth 2) renders first
    expect(addGroups[1]).toBeEnabled();
  });

  it("an apply error renders inline and keeps the draft", () => {
    setup(S8 as FilterNode, undefined, { error: "timeout" });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't apply filter: timeout");
    expect(texts("Column")).toEqual(["Payment status", "Call status"]);
  });
});

describe("FilterBuilder apply modes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("live by default: edits are debounced 300ms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, onChange } = setup(S8 as FilterNode, undefined, { debounceMs: undefined });
    await user.click(screen.getByRole("radio", { name: "OR" }));
    await user.click(screen.getByRole("radio", { name: "AND" }));
    await user.click(screen.getByRole("radio", { name: "OR" }));
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ ...S8, op: "or" });
    expect(screen.queryByRole("button", { name: "Apply filter" })).toBeNull();
  });

  it("explicit above the threshold: footer with Apply filter / Discard and a pending hint", async () => {
    const { user, onChange } = setup(S8 as FilterNode, undefined, { mode: "server", rowCount: 20_000 });
    const apply = screen.getByRole("button", { name: "Apply filter" });
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "OR" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("1 change not applied")).toBeInTheDocument();
    await pick(user, "Relative date", "Today");
    expect(screen.getByText("2 changes not applied")).toBeInTheDocument();
    await user.click(apply);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      op: "or",
      children: [S8.children[0], { columnId: FIXTURE_IDS.call, operator: "isWithin", value: { relative: "today" } }],
    });
    expect(screen.queryByText(/not applied/)).toBeNull();
  });

  it("explicit: Discard restores the applied filter in the builder", async () => {
    const { user, onChange } = setup(S8 as FilterNode, undefined, { mode: "client", rowCount: 50_000 });
    await user.click(screen.getAllByRole("button", { name: "Remove condition" })[0] as HTMLElement);
    expect(controls("Column")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(texts("Column")).toEqual(["Payment status", "Call status"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explicit: Mod+Enter applies", async () => {
    const { user, onChange } = setup(S8 as FilterNode, undefined, { mode: "server", rowCount: 20_000 });
    await user.click(screen.getByRole("radio", { name: "OR" }));
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onChange).toHaveBeenLastCalledWith({ ...S8, op: "or" });
  });

  it("onDraftChange reports the draft and dirty flag", async () => {
    const onDraftChange = vi.fn();
    const { user } = setup(S8 as FilterNode, undefined, { mode: "server", rowCount: 20_000, onDraftChange });
    await user.click(screen.getByRole("radio", { name: "OR" }));
    expect(onDraftChange).toHaveBeenLastCalledWith({ ...S8, op: "or" }, true);
  });
});
