import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FilterCondition, FilterNode } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { FilterButton } from "./FilterButton";
import { FilterChips } from "./FilterChips";
import { describeCondition, describeNode, humanizeRelativeDate } from "./describeFilter";

const schema = buildFixtureSchema();
const registry = buildFixtureRegistry();

const PAY: FilterCondition = { columnId: FIXTURE_IDS.payment, operator: "isNot", value: "paid" };
const CALL: FilterCondition = { columnId: FIXTURE_IDS.call, operator: "isWithin", value: { relative: "yesterday" } };
const S8: FilterNode = { op: "and", children: [PAY, CALL] };

describe("describeCondition", () => {
  it("formats the §8 conditions", () => {
    expect(describeCondition(PAY, schema, registry)).toBe("Payment status is not Paid");
    expect(describeCondition(CALL, schema, registry)).toBe("Call status is within yesterday");
  });

  it("humanises relative presets in lower case", () => {
    expect(humanizeRelativeDate({ relative: "lastNDays", n: 7 })).toBe("last 7 days");
    expect(humanizeRelativeDate({ relative: "nextNDays", n: 3 })).toBe("next 3 days");
    expect(humanizeRelativeDate({ relative: "thisWeek" })).toBe("this week");
  });

  it("formats range, none, multi and me operators", () => {
    expect(describeCondition({ columnId: FIXTURE_IDS.amount, operator: "between", value: { from: 100, to: 200 } }, schema, registry)).toMatch(
      /^Amount between ₹\s?100 and ₹\s?200$/,
    );
    expect(describeCondition({ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }, schema, registry)).toBe("Notes is empty");
    expect(
      describeCondition({ columnId: FIXTURE_IDS.payment, operator: "isAnyOf", value: ["paid", "failed"] }, schema, registry),
    ).toBe("Payment status is any of Paid, Failed");
    expect(describeCondition({ columnId: FIXTURE_IDS.owner, operator: "isMe", value: { me: true } }, schema, registry)).toBe(
      "Owner is me",
    );
  });

  it("summarises nested groups", () => {
    expect(describeNode({ op: "or", children: [PAY, CALL] }, schema, registry)).toBe("(2 conditions, OR)");
  });
});

describe("FilterChips", () => {
  it("renders one chip per top-level child and removes the first", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<FilterChips schema={schema} registry={registry} value={S8} onChange={onChange} />);
    expect(screen.getByText("Payment status is not Paid")).toBeInTheDocument();
    expect(screen.getByText("Call status is within yesterday")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove filter: Payment status is not Paid" }));
    expect(onChange).toHaveBeenLastCalledWith({ op: "and", children: [CALL] });
  });

  it("removing the last chip emits null; nested group shows a summary", async () => {
    const onChange = vi.fn();
    const nested: FilterNode = { op: "and", children: [{ op: "or", children: [PAY, CALL] }] };
    const { user } = renderWithMantine(<FilterChips schema={schema} registry={registry} value={nested} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Remove filter: (2 conditions, OR)" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("renders nothing for null", () => {
    const { container } = renderWithMantine(<FilterChips schema={schema} registry={registry} value={null} onChange={vi.fn()} />);
    expect(container.querySelector(".mantine-Pill-root")).toBeNull();
  });
});

function renderButton(value: FilterNode | null, env?: "test" | "default") {
  const onChange = vi.fn();
  const r = renderWithMantine(
    <FilterButton
      schema={schema}
      registry={registry}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      value={value}
      onChange={onChange}
    />,
    { env },
  );
  return { ...r, onChange };
}

describe("FilterButton", () => {
  it("shows the condition count badge", () => {
    renderButton(S8);
    expect(screen.getByRole("button", { name: /Filter/ })).toHaveTextContent("2");
    expect(screen.getByTestId("filter-count")).toHaveTextContent("2");
  });

  it("hides the badge with no conditions", () => {
    renderButton(null);
    expect(screen.queryByTestId("filter-count")).toBeNull();
  });

  it("opens the builder and stays open when picking a column option", async () => {
    const { user, container } = renderButton(null);
    expect(screen.queryByRole("button", { name: "Add condition" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    const add = await screen.findByRole("button", { name: "Add condition" });
    const dropdown = container.querySelector(".mantine-Popover-dropdown") as HTMLElement;
    expect(dropdown).not.toBeNull();
    expect(dropdown.contains(add)).toBe(true);
    await user.click(add);
    const column = screen.getAllByLabelText("Column").find((e) => e.tagName === "INPUT") as HTMLElement;
    await user.click(column);
    const option = await screen.findByRole("option", { name: "Payment status" });
    // the inner Select dropdown lives inside the popover, so clicking it is not an outside click
    expect(dropdown.contains(option)).toBe(true);
    await user.click(option);
    expect(screen.getByRole("button", { name: "Add condition" })).toBeInTheDocument();
    expect((screen.getAllByLabelText("Column").find((e) => e.tagName === "INPUT") as HTMLInputElement).value).toBe(
      "Payment status",
    );
  });

  it("closes on an outside click", async () => {
    const { user } = renderWithMantine(
      <div>
        <button type="button">outside</button>
        <FilterButton
          schema={schema}
          registry={registry}
          uiRegistry={buildStubUiRegistry()}
          access={buildFixtureAccess(schema)}
          value={null}
          onChange={vi.fn()}
        />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    expect(await screen.findByRole("button", { name: "Add condition" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("button", { name: "Add condition" })).toBeNull();
  });
});
