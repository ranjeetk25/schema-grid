import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FilterOperatorDef, FilterValue } from "../internal/core-contracts";
import {
  FIXTURE_IDS,
  buildFixtureRegistry,
  buildFixtureSchema,
  buildStubDataSource,
  buildStubUiRegistry,
  fixtureColumn,
} from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { FilterValueInput } from "./FilterValueInput";
import { operatorsFor } from "./model";

const schema = buildFixtureSchema();

/** The <input> of a labelled Mantine field (the hidden listbox shares the aria-label). */
const field = (name: string): HTMLElement => {
  const el = screen.getAllByLabelText(name).find((e) => e.tagName === "INPUT");
  if (!el) throw new Error(`no input labelled ${name}`);
  return el;
};
const registry = buildFixtureRegistry();
const ui = buildStubUiRegistry();

const opOf = (columnId: string, opId: string): FilterOperatorDef => {
  const o = operatorsFor(fixtureColumn(columnId), schema, registry).find((x) => x.id === opId);
  if (!o) throw new Error(`no op ${opId}`);
  return o;
};

function Harness({
  columnId,
  opId,
  initial,
  onChange,
}: {
  columnId: string;
  opId: string;
  initial: FilterValue | undefined;
  onChange: (v: FilterValue | null | undefined) => void;
}) {
  const [value, setValue] = useState<FilterValue | null | undefined>(initial);
  return (
    <FilterValueInput
      column={fixtureColumn(columnId)}
      operator={opOf(columnId, opId)}
      value={value}
      schema={schema}
      registry={ui}
      dataSource={buildStubDataSource()}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe("FilterValueInput", () => {
  it("isEmpty renders no input", () => {
    const { container } = renderWithMantine(
      <Harness columnId={FIXTURE_IDS.notes} opId="isEmpty" initial={undefined} onChange={vi.fn()} />,
    );
    expect(container.querySelector("input")).toBeNull();
  });

  it("single on select renders a built-in select of the column options", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<Harness columnId={FIXTURE_IDS.payment} opId="isNot" initial={null} onChange={onChange} />);
    await user.click(field("Value"));
    await user.click(screen.getByRole("option", { name: "Paid" }));
    expect(onChange).toHaveBeenLastCalledWith("paid");
  });

  it("single on other types uses the registry filterComponent", () => {
    renderWithMantine(<Harness columnId={FIXTURE_IDS.call} opId="is" initial={null} onChange={vi.fn()} />);
    expect(screen.getByTestId("stub-filter")).toBeInTheDocument();
  });

  it("single falls back to TextInput without a registry entry", async () => {
    const onChange = vi.fn();
    const bare = buildStubUiRegistry();
    bare.register("longText", {});
    const { user } = renderWithMantine(
      <FilterValueInput
        column={fixtureColumn(FIXTURE_IDS.notes)}
        operator={opOf(FIXTURE_IDS.notes, "contains")}
        value={null}
        schema={schema}
        registry={bare}
        onChange={onChange}
        error="A value is required"
      />,
    );
    expect(screen.queryByTestId("stub-filter")).toBeNull();
    expect(screen.getByText("A value is required")).toBeInTheDocument();
    await user.type(field("Value"), "x");
    expect(onChange).toHaveBeenLastCalledWith("x");
  });

  it("number single without a registry entry falls back to NumberInput", async () => {
    const onChange = vi.fn();
    const bare = buildStubUiRegistry();
    bare.register("currency", {});
    const { user } = renderWithMantine(
      <FilterValueInput
        column={fixtureColumn(FIXTURE_IDS.amount)}
        operator={opOf(FIXTURE_IDS.amount, "gt")}
        value={null}
        schema={schema}
        registry={bare}
        onChange={onChange}
      />,
    );
    await user.type(field("Value"), "5");
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("registry filterComponent shows the error below it", () => {
    renderWithMantine(
      <FilterValueInput
        column={fixtureColumn(FIXTURE_IDS.call)}
        operator={opOf(FIXTURE_IDS.call, "is")}
        value={null}
        schema={schema}
        registry={ui}
        onChange={vi.fn()}
        error="A value is required"
      />,
    );
    expect(screen.getByText("A value is required")).toBeInTheDocument();
  });

  it("isWithin renders presets; yesterday and lastNDays + N", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(
      <Harness columnId={FIXTURE_IDS.call} opId="isWithin" initial={{ relative: "today" }} onChange={onChange} />,
    );
    expect(screen.queryByLabelText("N")).toBeNull();
    await user.click(field("Relative date"));
    await user.click(screen.getByRole("option", { name: "Yesterday" }));
    expect(onChange).toHaveBeenLastCalledWith({ relative: "yesterday" });

    await user.click(field("Relative date"));
    await user.click(screen.getByRole("option", { name: "Last N days" }));
    expect(onChange).toHaveBeenLastCalledWith({ relative: "lastNDays" });
    const n = screen.getByLabelText("N");
    await user.type(n, "7");
    expect(onChange).toHaveBeenLastCalledWith({ relative: "lastNDays", n: 7 });
  });

  it("between renders From/To number inputs and emits {from,to}", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(
      <Harness columnId={FIXTURE_IDS.amount} opId="between" initial={{ from: null, to: null }} onChange={onChange} />,
    );
    await user.type(screen.getByLabelText("From"), "10");
    await user.type(screen.getByLabelText("To"), "20");
    const last = onChange.mock.lastCall?.[0];
    expect(last).toStrictEqual({ from: 10, to: 20 });
    expect(JSON.stringify(last)).toBe('{"from":10,"to":20}');
  });

  it("date range without a registry entry uses YYYY-MM-DD text inputs", async () => {
    const onChange = vi.fn();
    const bare = buildStubUiRegistry();
    bare.register("date", {});
    const { user } = renderWithMantine(
      <FilterValueInput
        column={fixtureColumn(FIXTURE_IDS.call)}
        operator={opOf(FIXTURE_IDS.call, "isBetween")}
        value={{ from: "2026-01-01", to: null }}
        schema={schema}
        registry={bare}
        onChange={onChange}
      />,
    );
    const to = screen.getByLabelText("To");
    expect(to).toHaveAttribute("placeholder", "YYYY-MM-DD");
    await user.type(to, "2");
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-01-01", to: "2" });
  });

  it("isAnyOf on select renders a multi select", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<Harness columnId={FIXTURE_IDS.payment} opId="isAnyOf" initial={[]} onChange={onChange} />);
    await user.click(field("Values"));
    await user.click(screen.getByRole("option", { name: "Paid" }));
    await user.click(screen.getByRole("option", { name: "Failed" }));
    expect(onChange).toHaveBeenLastCalledWith(["paid", "failed"]);
  });

  it("isAnyOf on user loads options from the data source", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<Harness columnId={FIXTURE_IDS.owner} opId="isAnyOf" initial={[]} onChange={onChange} />);
    await user.click(field("Values"));
    await user.click(await screen.findByRole("option", { name: "Asha Rao" }));
    expect(onChange).toHaveBeenLastCalledWith(["u_asha"]);
  });

  it("isMe shows the label and emits {me:true}", () => {
    const onChange = vi.fn();
    renderWithMantine(<Harness columnId={FIXTURE_IDS.owner} opId="isMe" initial={undefined} onChange={onChange} />);
    expect(screen.getByText("Current user")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ me: true });
  });

  it("isMe does not re-emit when already {me:true}", () => {
    const onChange = vi.fn();
    renderWithMantine(<Harness columnId={FIXTURE_IDS.owner} opId="isMe" initial={{ me: true }} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dropdowns render inside the container even with portals enabled", async () => {
    const { user, container } = renderWithMantine(
      <Harness columnId={FIXTURE_IDS.payment} opId="is" initial={null} onChange={vi.fn()} />,
      { env: "default" },
    );
    await user.click(field("Value"));
    expect(container.contains(await screen.findByText("Paid"))).toBe(true);
  });
});
