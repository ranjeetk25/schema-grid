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

describe("GroupByBar", () => {
  it("adds a group column", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("textbox", { name: "Add group" }));
    await user.click(screen.getByRole("option", { name: "Payment status" }));
    expect(onChange).toHaveBeenLastCalledWith([{ columnId: FIXTURE_IDS.payment }]);
  });

  it("never offers hidden columns", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("textbox", { name: "Add group" }));
    expect(screen.queryByRole("option", { name: "Secret" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Call status" })).toBeInTheDocument();
  });

  it("attaches numeric aggregations to the first group", async () => {
    const { user, onChange } = setup([{ columnId: FIXTURE_IDS.payment }]);
    expect(screen.getByText("Payment status")).toBeInTheDocument();
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
    expect(screen.getByRole("textbox", { name: "Add group" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove group Payment status" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
