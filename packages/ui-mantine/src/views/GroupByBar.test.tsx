import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GroupSpec } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { GroupByBar } from "./GroupByBar";

function setup(value: GroupSpec[] = [], maxGroups?: number) {
  const onChange = vi.fn();
  const schema = buildFixtureSchema();
  const r = renderWithMantine(
    <GroupByBar
      schema={schema}
      registry={buildFixtureRegistry()}
      access={buildFixtureAccess(schema)}
      value={value}
      onChange={onChange}
      maxGroups={maxGroups}
    />,
  );
  return { ...r, onChange };
}

const open = async (user: ReturnType<typeof setup>["user"]) => user.click(screen.getByRole("button", { name: "Group" }));

describe("GroupByBar", () => {
  it("adds a group column", async () => {
    const { user, onChange } = setup();
    expect(screen.queryByRole("textbox", { name: "Add group" })).toBeNull();
    await open(user);
    await user.click(screen.getByRole("textbox", { name: "Add group" }));
    await user.click(screen.getByRole("option", { name: "Payment status" }));
    expect(onChange).toHaveBeenLastCalledWith([{ columnId: FIXTURE_IDS.payment }]);
  });

  it("never offers hidden columns", async () => {
    const { user } = setup();
    await open(user);
    await user.click(screen.getByRole("textbox", { name: "Add group" }));
    expect(screen.queryByRole("option", { name: "Secret" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Call status" })).toBeInTheDocument();
  });

  it("attaches numeric aggregations to the first group", async () => {
    const { user, onChange } = setup([{ columnId: FIXTURE_IDS.payment }]);
    await open(user);
    expect(screen.getByRole("listitem")).toHaveTextContent("Payment status");
    const summaries = screen.getByRole("button", { name: /Summaries/ });
    expect(summaries).toHaveAttribute("aria-expanded", "false");
    await user.click(summaries);
    await user.click(screen.getByRole("textbox", { name: "Aggregate Amount" }));
    await user.click(screen.getByRole("option", { name: "Sum" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { columnId: FIXTURE_IDS.payment, aggregations: [{ columnId: FIXTURE_IDS.amount, agg: "sum" }] },
    ]);
    // formula with a number result is aggregatable too
    expect(screen.getByRole("textbox", { name: "Aggregate Total" })).toBeInTheDocument();
  });

  it("removes a group and disables add at maxGroups", async () => {
    const { user, onChange } = setup([{ columnId: FIXTURE_IDS.payment }], 1);
    await open(user);
    expect(screen.getByRole("textbox", { name: "Add group" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove group Payment status" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("shows a count badge and a 'Grouped by A › B' summary that clears", async () => {
    const { user, onChange } = setup([{ columnId: FIXTURE_IDS.payment }, { columnId: FIXTURE_IDS.owner }]);
    expect(screen.getByTestId("group-count")).toHaveTextContent("2");
    expect(screen.getByTitle("Grouped by Payment status › Owner")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear grouping" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("reorders groups, keeping aggregations on the first", async () => {
    const aggs = [{ columnId: FIXTURE_IDS.amount, agg: "sum" as const }];
    const { user, onChange } = setup([{ columnId: FIXTURE_IDS.payment, aggregations: aggs }, { columnId: FIXTURE_IDS.owner }]);
    await open(user);
    expect(screen.getByRole("button", { name: "Move Payment status up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Owner up" }));
    expect(onChange).toHaveBeenLastCalledWith([{ columnId: FIXTURE_IDS.owner, aggregations: aggs }, { columnId: FIXTURE_IDS.payment }]);
  });
});
