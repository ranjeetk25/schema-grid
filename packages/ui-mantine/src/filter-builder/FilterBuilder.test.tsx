import { act, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FilterNode } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { FilterBuilder, type FilterBuilderProps } from "./FilterBuilder";

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

function setup(value: FilterNode | null = null, maxDepth?: number, extra: Partial<FilterBuilderProps> = {}) {
  const onChange = vi.fn<(node: FilterNode | null) => unknown>();
  const r = renderWithMantine(
    <FilterBuilder
      debounceMs={0}
      schema={schema}
      registry={buildFixtureRegistry()}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      value={value}
      onChange={onChange}
      maxDepth={maxDepth}
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

  it("an incomplete row shows no error and is not applied; completing it applies", async () => {
    const { user, onChange } = setup(null);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    expect(screen.queryByText("Expected a single value")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await pick(user, "Value", "Paid");
    expect(onChange).toHaveBeenLastCalledWith({ op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" }] });
  });

  it("strips incomplete rows from what is emitted", async () => {
    const { user, onChange } = setup(S8 as FilterNode);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Amount");
    await user.click(screen.getByRole("radio", { name: "OR" }));
    expect(onChange.mock.lastCall?.[0]).toStrictEqual({ ...S8, op: "or" });
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
});

describe("FilterBuilder live / explicit apply", () => {
  it("live: debounces edits into one apply", async () => {
    // Manual timer: only the latest scheduled callback survives, and nothing fires until we run it.
    const pending = new Map<number, () => void>();
    let seq = 0;
    const timer = {
      set: (fn: () => void) => {
        pending.set(++seq, fn);
        return seq;
      },
      clear: (h: unknown) => pending.delete(h as number),
    };
    const { user, onChange } = setup(null, undefined, { debounceMs: 300, timer });
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Notes");
    await pick(user, "Operator", "is empty");
    await pick(user, "Operator", "is not empty");
    expect(onChange).not.toHaveBeenCalled();
    expect(pending.size).toBe(1);
    act(() => {
      for (const fn of pending.values()) fn();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isNotEmpty" }] });
  });

  it("live: a pending apply is flushed when the builder unmounts", async () => {
    const { user, onChange, unmount } = setup(null, undefined, { debounceMs: 10_000 });
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Notes");
    await pick(user, "Operator", "is empty");
    expect(onChange).not.toHaveBeenCalled();
    unmount();
    expect(onChange).toHaveBeenCalledWith({ op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] });
  });

  it("explicit above the threshold: edits stay a draft until Apply filter", async () => {
    const { user, onChange } = setup(null, undefined, { mode: "server", rowCount: 12_480 });
    expect(screen.getByText("Applies to 12,480 rows")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply filter" });
    expect(apply).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Notes");
    await pick(user, "Operator", "is empty");
    expect(onChange).not.toHaveBeenCalled();
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(onChange).toHaveBeenLastCalledWith({ op: "and", children: [{ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }] });
    expect(apply).toBeDisabled();
  });

  it("explicit: Enter in a value input applies; Clear applies null", async () => {
    const { user, onChange } = setup(null, undefined, { live: false });
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    await pick(user, "Value", "Paid");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(lastInput("Value"));
    await user.keyboard("{Escape}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "is", value: "paid" }] });
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.queryAllByLabelText("Column")).toHaveLength(0);
  });

  it("a rejected apply shows the error inline and keeps the draft", async () => {
    const { user, onChange } = setup(null);
    onChange.mockImplementation(() => Promise.reject(new Error("Query timed out")));
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Notes");
    await pick(user, "Operator", "is empty");
    expect(await screen.findByRole("alert")).toHaveTextContent("Filter not applied: Query timed out");
    expect(inputs("Column").map((i) => (i as HTMLInputElement).value)).toEqual(["Notes"]);
  });

  it("shows a host error", () => {
    setup(null, undefined, { error: "Server rejected the filter" });
    expect(screen.getByRole("alert")).toHaveTextContent("Server rejected the filter");
  });

  it("reports status: pending while debouncing, dirty in explicit mode", async () => {
    const onStatusChange = vi.fn();
    const { user, unmount } = setup(null, undefined, { debounceMs: 60_000, onStatusChange });
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Notes");
    await pick(user, "Operator", "is empty");
    expect(onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "live", pending: true }));
    unmount();
  });
});
