import { act, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FilterCondition, FilterNode } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderUi } from "../test/render";
import { FilterButton, type FilterButtonProps } from "./FilterButton";
import { FilterChips } from "./FilterChips";
import { describeCondition, describeConditionParts, describeNode, humanizeRelativeDate } from "./describeFilter";

const schema = buildFixtureSchema();
const registry = buildFixtureRegistry();

const PAY: FilterCondition = { columnId: FIXTURE_IDS.payment, operator: "isNot", value: "paid" };
const CALL: FilterCondition = { columnId: FIXTURE_IDS.call, operator: "isWithin", value: { relative: "yesterday" } };
const S8: FilterNode = { op: "and", children: [PAY, CALL] };

const chip = (name: string) => screen.getByRole("listitem", { name });

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
      /^Amount is between ₹\s?100 and ₹\s?200$/,
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

  it("describeConditionParts splits column / operator / value", () => {
    expect(describeConditionParts(PAY, schema, registry)).toEqual({ hidden: false, column: "Payment status", operator: "is not", value: "Paid" });
    expect(describeConditionParts({ columnId: FIXTURE_IDS.notes, operator: "isEmpty" }, schema, registry)).toEqual({
      hidden: false,
      column: "Notes",
      operator: "is empty",
      value: null,
    });
    expect(describeConditionParts(PAY, schema, registry, new Map([[FIXTURE_IDS.payment, "hidden" as const]])).hidden).toBe(true);
  });
});

describe("FilterChips", () => {
  it("renders one chip per top-level child and removes the first", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<FilterChips schema={schema} registry={registry} value={S8} onChange={onChange} />);
    expect(chip("Payment status is not Paid")).toHaveTextContent("Payment status is not Paid");
    expect(chip("Call status is within yesterday")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove filter: Payment status is not Paid" }));
    expect(onChange).toHaveBeenLastCalledWith({ op: "and", children: [CALL] });
  });

  it("chip anatomy: column muted, value in foreground", () => {
    renderUi(<FilterChips schema={schema} registry={registry} value={S8} onChange={vi.fn()} />);
    const c = chip("Payment status is not Paid");
    expect(within(c).getByText("Payment status")).toHaveClass("sg:text-muted-foreground");
    expect(within(c).getByText("Paid")).toHaveClass("sg:text-foreground");
  });

  it("removing the last chip emits null; nested group shows a summary", async () => {
    const onChange = vi.fn();
    const nested: FilterNode = { op: "and", children: [{ op: "or", children: [PAY, CALL] }] };
    const { user } = renderUi(<FilterChips schema={schema} registry={registry} value={nested} onChange={onChange} />);
    expect(chip("(2 conditions, OR)")).toHaveTextContent(/2 conditions/);
    await user.click(screen.getByRole("button", { name: "Remove filter: (2 conditions, OR)" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("renders nothing for null", () => {
    const { container } = renderUi(<FilterChips schema={schema} registry={registry} value={null} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the APPLIED filter and an accent dot while the draft differs", () => {
    const { rerender } = renderUi(<FilterChips schema={schema} registry={registry} value={S8} draft={{ ...S8, op: "or" }} onChange={vi.fn()} />);
    expect(chip("Payment status is not Paid")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Unapplied changes" })).toBeInTheDocument();
    rerender(<FilterChips schema={schema} registry={registry} value={S8} draft={structuredClone(S8)} onChange={vi.fn()} />);
    expect(screen.queryByRole("img", { name: "Unapplied changes" })).toBeNull();
    rerender(<FilterChips schema={schema} registry={registry} value={S8} dirty onChange={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Unapplied changes" })).toBeInTheDocument();
  });
});

function renderButton(value: FilterNode | null, extra: Partial<FilterButtonProps> = {}) {
  const onChange = vi.fn();
  const r = renderUi(
    <FilterButton
      schema={schema}
      registry={registry}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      value={value}
      onChange={onChange}
      debounceMs={0}
      {...extra}
    />,
  );
  return { ...r, onChange };
}

const lastControl = (name: string) => screen.getAllByLabelText(name).at(-1) as HTMLElement;
async function pick(user: UserEvent, field: string, option: string) {
  await user.click(lastControl(field));
  await user.click(await screen.findByRole("option", { name: option }));
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

  it("opens the builder and stays open when picking a column option and an operator", async () => {
    const { user } = renderButton(null);
    expect(screen.queryByRole("button", { name: "Add condition" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    const dialog = await screen.findByRole("dialog", { name: "Filter" });
    const add = within(dialog).getByRole("button", { name: "Add condition" });
    await user.click(add);
    await user.click(lastControl("Column"));
    const option = await screen.findByRole("option", { name: "Payment status" });
    // nested pickers portal to <body>, marked so hosts (AG Grid) treat them as inside
    expect(option.closest(".ag-custom-component-popup")).toHaveClass("sg-ui");
    await user.click(option);
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeInTheDocument();
    expect(lastControl("Column")).toHaveTextContent("Payment status");

    await pick(user, "Operator", "is not");
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeInTheDocument();
    expect(lastControl("Operator")).toHaveTextContent("is not");
    await pick(user, "Value", "Paid");
    expect(screen.getByRole("dialog", { name: "Filter" })).toBeInTheDocument();
  });

  it("closes on an outside click", async () => {
    const { user } = renderUi(
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

  it("uses a custom label", () => {
    renderButton(null, { label: "Filters" });
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
  });
});

describe("FilterButton apply modes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("live by default: applies 300ms after the last edit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, onChange } = renderButton(S8, { debounceMs: undefined });
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    await user.click(await screen.findByRole("radio", { name: "OR" }));
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...S8, op: "or" });
  });

  it("explicit: dot on the button, draft survives closing, Apply filter emits", async () => {
    const { user, onChange } = renderButton(S8, { mode: "server", rowCount: 1_000_000 });
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    await user.click(await screen.findByRole("radio", { name: "OR" }));
    expect(screen.getByText("1 change not applied")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Unapplied changes" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    expect(await screen.findByRole("radio", { name: "OR" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...S8, op: "or" });
  });

  it("shows an apply error inline", async () => {
    const { user } = renderButton(S8, { error: "Server unavailable" });
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't apply filter: Server unavailable");
  });
});

describe("review follow-ups", () => {
  it("chips do not leak hidden column labels when access is given", () => {
    const schema = buildFixtureSchema();
    renderUi(
      <FilterChips
        schema={schema}
        registry={buildFixtureRegistry()}
        access={buildFixtureAccess(schema)}
        value={{ op: "and", children: [{ columnId: FIXTURE_IDS.secret, operator: "is", value: "x" }] }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Hidden column")).toBeInTheDocument();
    expect(screen.queryByText(/Secret/)).not.toBeInTheDocument();
    expect(screen.queryByText("x")).not.toBeInTheDocument();
  });
});
