import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GroupSpec } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import { renderUi } from "../test/render";
import { GroupByBar } from "./GroupByBar";

function setup(value: GroupSpec[] = [], maxGroups?: number) {
  const onChange = vi.fn();
  const schema = buildFixtureSchema();
  const r = renderUi(
    <GroupByBar
      schema={schema}
      registry={buildFixtureRegistry()}
      access={buildFixtureAccess(schema)}
      value={value}
      onChange={onChange}
      maxGroups={maxGroups}
    />,
  );
  const open = async () => {
    await r.user.click(screen.getByRole("button", { name: /^Group/ }));
    return screen.findByRole("dialog", { name: "Group by" });
  };
  return { ...r, onChange, open };
}

describe("GroupByBar", () => {
  it("is one Group button with a count badge when active", () => {
    const { unmount } = setup();
    expect(screen.getByRole("button", { name: "Group" })).toBeInTheDocument();
    expect(screen.queryByTestId("group-count")).toBeNull();
    unmount();
    setup([{ columnId: FIXTURE_IDS.payment }]);
    expect(screen.getByTestId("group-count")).toHaveTextContent("1");
  });

  it("adds a group column", async () => {
    const { user, onChange, open } = setup();
    const dialog = await open();
    expect(within(dialog).getByText("No grouping")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("combobox", { name: "Add group" }));
    await user.click(screen.getByRole("option", { name: "Payment status" }));
    expect(onChange).toHaveBeenLastCalledWith([{ columnId: FIXTURE_IDS.payment }]);
  });

  it("never offers hidden columns (nor grouped or long-text ones)", async () => {
    const { user, open } = setup([{ columnId: FIXTURE_IDS.payment }]);
    const dialog = await open();
    await user.click(within(dialog).getByRole("combobox", { name: "Add group" }));
    expect(screen.queryByRole("option", { name: "Secret" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Payment status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Notes" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Call status" })).toBeInTheDocument();
  });

  it("summaries are collapsed by default and attach numeric aggregations to the first group", async () => {
    const { user, onChange, open } = setup([{ columnId: FIXTURE_IDS.payment }]);
    const dialog = await open();
    expect(within(dialog).getByText("Payment status")).toBeInTheDocument();
    const toggle = within(dialog).getByRole("button", { name: /Summaries/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByRole("combobox", { name: "Aggregate Amount" })).toBeNull();
    await user.click(toggle);
    await user.click(within(dialog).getByRole("combobox", { name: "Aggregate Amount" }));
    await user.click(screen.getByRole("option", { name: "Sum" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { columnId: FIXTURE_IDS.payment, aggregations: [{ columnId: FIXTURE_IDS.amount, agg: "sum" }] },
    ]);
    // formula with a number result is aggregatable too
    expect(within(dialog).getByRole("combobox", { name: "Aggregate Total" })).toBeInTheDocument();
  });

  it("clearing a summary removes the aggregation; never shows a raw 'none'", async () => {
    const value: GroupSpec[] = [{ columnId: FIXTURE_IDS.payment, aggregations: [{ columnId: FIXTURE_IDS.amount, agg: "sum" }] }];
    const { user, onChange, open } = setup(value);
    const dialog = await open();
    await user.click(within(dialog).getByRole("button", { name: /Summaries/ }));
    expect(within(dialog).getByRole("combobox", { name: "Aggregate Total" })).toHaveTextContent("No summary");
    expect(dialog).not.toHaveTextContent(/\bnone\b|\bnull\b/);
    await user.click(within(dialog).getByRole("combobox", { name: "Aggregate Amount" }));
    await user.click(screen.getByRole("option", { name: "No summary" }));
    expect(onChange).toHaveBeenLastCalledWith([{ columnId: FIXTURE_IDS.payment }]);
  });

  it("removes a group and disables add at maxGroups", async () => {
    const { user, onChange, open } = setup([{ columnId: FIXTURE_IDS.payment }], 1);
    const dialog = await open();
    expect(within(dialog).getByRole("combobox", { name: "Add group" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Remove group Payment status" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("reorders groups, keeping aggregations on the first", async () => {
    const aggs = [{ columnId: FIXTURE_IDS.amount, agg: "sum" as const }];
    const { user, onChange, open } = setup([{ columnId: FIXTURE_IDS.payment, aggregations: aggs }, { columnId: FIXTURE_IDS.call }]);
    const dialog = await open();
    expect(within(dialog).getByRole("button", { name: "Move Payment status up" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Move Call status up" }));
    expect(onChange).toHaveBeenLastCalledWith([{ columnId: FIXTURE_IDS.call, aggregations: aggs }, { columnId: FIXTURE_IDS.payment }]);
  });
});
