import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type FilterCondition, createDefaultRegistry } from "../internal/core-contracts";
import { FIXTURE_IDS, buildStubDataSource, fixtureColumn } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { MantineConditionFilter, MantineSetFilter, distinctRowOptions, setFilterModel } from ".";
import type { SchemaFilterProps } from "./contracts";

// Outside a real grid there is no ag-grid-react filter context.
vi.mock("ag-grid-react", async (orig) => ({ ...(await orig<object>()), useGridFilter: vi.fn() }));

const registry = createDefaultRegistry();

function filterProps(columnId: string, model: FilterCondition | null, extra: Record<string, unknown> = {}) {
  const column = fixtureColumn(columnId);
  const onModelChange = vi.fn();
  return {
    props: {
      model,
      onModelChange,
      schemaColumn: column,
      fieldType: registry.get(column.type),
      colDef: { colId: columnId },
      ...extra,
    } as unknown as SchemaFilterProps,
    onModelChange,
  };
}

const input = (name: string) => screen.getAllByLabelText(name).find((e) => e.tagName === "INPUT") as HTMLElement;

describe("MantineConditionFilter", () => {
  it("text: operator + value, Enter applies a core FilterCondition", async () => {
    const { props, onModelChange } = filterProps(FIXTURE_IDS.notes, null);
    const { user } = renderWithMantine(<MantineConditionFilter {...props} />);
    expect(screen.getByText("Notes")).toBeInTheDocument();
    await user.type(input("Value"), " hello {Enter}");
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: FIXTURE_IDS.notes, operator: "contains", value: "hello" });
  });

  it("shows an error instead of applying an empty value; Clear emits null", async () => {
    const { props, onModelChange } = filterProps(FIXTURE_IDS.notes, null);
    const { user } = renderWithMantine(<MantineConditionFilter {...props} />);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a value");
    expect(onModelChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onModelChange).toHaveBeenLastCalledWith(null);
  });

  it("number range: picks 'is between' from an inline dropdown and emits {from,to}", async () => {
    const { props, onModelChange } = filterProps(FIXTURE_IDS.amount, null);
    const { user, container } = renderWithMantine(<MantineConditionFilter {...props} />, { env: "default" });
    await user.click(input("Operator"));
    const option = await screen.findByText("is between");
    // withinPortal: false — the option lives inside the filter (AG Grid closes on outside clicks).
    expect(container.contains(option)).toBe(true);
    await user.click(option);
    await user.type(screen.getByRole("textbox", { name: "From" }), "10");
    await user.type(screen.getByRole("textbox", { name: "To" }), "20");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: FIXTURE_IDS.amount, operator: "between", value: { from: 10, to: 20 } });
  });

  it("date: relative preset with N days, and hydrates from the model", async () => {
    const model = { columnId: FIXTURE_IDS.call, operator: "isWithin", value: { relative: "lastNDays", n: 7 } } as FilterCondition;
    const { props, onModelChange } = filterProps(FIXTURE_IDS.call, model);
    const { user } = renderWithMantine(<MantineConditionFilter {...props} />);
    expect((input("Relative date") as HTMLInputElement).value).toBe("Last N days");
    expect((input("Number of days") as HTMLInputElement).value).toBe("7");
    await user.clear(input("Number of days"));
    await user.type(input("Number of days"), "3{Enter}");
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: FIXTURE_IDS.call, operator: "isWithin", value: { relative: "lastNDays", n: 3 } });
  });

  it("none-kind operators emit no value", async () => {
    const { props, onModelChange } = filterProps(FIXTURE_IDS.notes, null);
    const { user } = renderWithMantine(<MantineConditionFilter {...props} />);
    await user.click(input("Operator"));
    await user.click(await screen.findByRole("option", { name: "is empty" }));
    expect(screen.queryByLabelText("Value")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: FIXTURE_IDS.notes, operator: "isEmpty" });
  });
});

describe("MantineSetFilter", () => {
  it("select: lists options with colour dots, toggles apply isAnyOf immediately", async () => {
    const { props, onModelChange } = filterProps(FIXTURE_IDS.payment, null);
    const { user, container } = renderWithMantine(<MantineSetFilter {...props} />);
    expect(container.querySelectorAll(".sg-cf-dot")).toHaveLength(3);
    await user.click(screen.getByRole("checkbox", { name: "Paid" }));
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: FIXTURE_IDS.payment, operator: "isAnyOf", value: ["paid"] });
  });

  it("reflects the model, filters by search, Select all / Clear", async () => {
    const model = { columnId: FIXTURE_IDS.payment, operator: "isAnyOf", value: ["paid"] } as FilterCondition;
    const { props, onModelChange } = filterProps(FIXTURE_IDS.payment, model);
    const { user } = renderWithMantine(<MantineSetFilter {...props} />);
    expect(screen.getByRole("checkbox", { name: "Paid" })).toBeChecked();
    expect(screen.getByText("1 of 3 selected")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search options" }), "fail");
    expect(screen.queryByRole("checkbox", { name: "Pending" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: FIXTURE_IDS.payment, operator: "isAnyOf", value: ["paid", "failed"] });
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onModelChange).toHaveBeenLastCalledWith(null);
  });

  it("user: loads options from the grid context data source (initial avatars)", async () => {
    const dataSource = buildStubDataSource();
    const { props } = filterProps(FIXTURE_IDS.owner, null, { context: { dataSource, events: () => undefined } });
    renderWithMantine(<MantineSetFilter {...props} />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Asha Rao/ })).toBeInTheDocument());
  });

  it("setFilterModel: multiSelect → hasAnyOf, boolean → isTrue/isFalse/null", () => {
    expect(setFilterModel("c", { isBoolean: false, isMulti: true }, ["a"])).toEqual({ columnId: "c", operator: "hasAnyOf", value: ["a"] });
    expect(setFilterModel("c", { isBoolean: true, isMulti: false }, ["false"])).toEqual({ columnId: "c", operator: "isFalse" });
    expect(setFilterModel("c", { isBoolean: true, isMulti: false }, ["true", "false"])).toBeNull();
    expect(setFilterModel("c", { isBoolean: false, isMulti: false }, [])).toBeNull();
  });

  it("distinctRowOptions: users / refs / primitives from loaded rows", () => {
    const values = [{ id: "u1", name: "Zed" }, "x", { id: "u1", name: "Zed" }, null, ["y", "x"], { id: "u2", name: "Amy" }];
    const api = {
      forEachNode: (cb: (n: never) => void) => {
        for (const v of values) cb(v as never);
      },
    };
    expect(distinctRowOptions(api, ((n: unknown) => n) as never).map((o) => o.label)).toEqual(["Amy", "x", "y", "Zed"]);
  });
});
