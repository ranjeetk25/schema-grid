import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomFilterCallbacks } from "ag-grid-react";
import { type ColumnDef, type FilterCondition, type Option, createDefaultRegistry } from "../internal/core-contracts";
import { FIXTURE_NOW } from "../test/fixtures";
import { renderUi } from "../test/render";

let lastFilterCallbacks: CustomFilterCallbacks | undefined;
/** Every registration, one per render. */
let filterCallbackHistory: CustomFilterCallbacks[] = [];

vi.mock("ag-grid-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ag-grid-react")>();
  return {
    ...actual,
    useGridFilter: (callbacks: CustomFilterCallbacks) => {
      lastFilterCallbacks = callbacks;
      filterCallbackHistory.push(callbacks);
    },
  };
});

import { ShadcnConditionFilter } from "./ShadcnConditionFilter";
import { ShadcnSetFilter } from "./ShadcnSetFilter";

const registry = createDefaultRegistry();

const PAYMENT_OPTIONS: Option[] = [
  { id: "paid", label: "Paid", color: "green" },
  { id: "pending", label: "Pending", color: "yellow" },
  { id: "failed", label: "Failed", color: "red" },
];
const TAG_OPTIONS: Option[] = [
  { id: "hot", label: "Hot" },
  { id: "warm", label: "Warm" },
];

function col(partial: Partial<ColumnDef> & { id: string; type: string }): ColumnDef {
  return { key: partial.id, label: partial.id, config: {}, order: 0, createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW, ...partial };
}

function colDefFor(column: ColumnDef) {
  return { colId: column.id, cellRendererParams: { schemaColumn: column, fieldType: registry.get(column.type) } };
}

function makeContext(getOptions?: (columnId: string) => Promise<Option[]>) {
  return {
    dataSource: { fetch: vi.fn(), applyChanges: vi.fn(), createRows: vi.fn(), deleteRows: vi.fn(), getOptions },
    events: () => undefined,
  };
}

function filterProps(column: ColumnDef, model: FilterCondition | null = null, context: unknown = makeContext()) {
  const onModelChange = vi.fn();
  // biome-ignore lint/suspicious/noExplicitAny: fake AG Grid props for a direct render.
  const props: any = { model, onModelChange, onUiChange: vi.fn(), colDef: colDefFor(column), column: {}, api: {}, context };
  return { props, onModelChange };
}

function lastModel(fn: ReturnType<typeof vi.fn>): unknown {
  const calls = fn.mock.calls;
  return calls[calls.length - 1]?.[0];
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function expectStableDoesFilterPass() {
  expect(filterCallbackHistory.length).toBeGreaterThan(1);
  const first = filterCallbackHistory[0]?.doesFilterPass;
  for (const cb of filterCallbackHistory) expect(cb.doesFilterPass).toBe(first);
}

type User = ReturnType<typeof renderUi>["user"];
async function choose(user: User, name: string, option: string) {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: option }));
}
const apply = () => fireEvent.click(screen.getByRole("button", { name: "Apply" }));

beforeEach(() => {
  lastFilterCallbacks = undefined;
  filterCallbackHistory = [];
});

describe("ShadcnConditionFilter", () => {
  const score = col({ id: "score", type: "number", label: "Score" });

  it("registers doesFilterPass that always passes (rows are pre-filtered by core)", () => {
    const { props } = filterProps(score);
    renderUi(<ShadcnConditionFilter {...props} />);
    expect(lastFilterCallbacks?.doesFilterPass({} as never)).toBe(true);
  });

  it("keeps the doesFilterPass identity stable across re-renders (no spurious filterChanged)", () => {
    const { props } = filterProps(score);
    const { rerender } = renderUi(<ShadcnConditionFilter {...props} />);
    rerender(<ShadcnConditionFilter {...props} model={{ columnId: "score", operator: "gt", value: 5 }} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "7" } });
    expectStableDoesFilterPass();
  });

  it("choosing an operator and a value emits a typed FilterCondition with the right columnId", async () => {
    const { props, onModelChange } = filterProps(score);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await choose(user, "Operator", ">");
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "5" } });
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "score", operator: "gt", value: 5 });
  });

  it("the operator list is a Radix listbox portalled with AG Grid's custom-popup marker", async () => {
    const { props } = filterProps(score);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await user.click(screen.getByRole("combobox", { name: "Operator" }));
    const listbox = await screen.findByRole("listbox");
    expect(listbox.closest(".ag-custom-component-popup")).not.toBeNull();
  });

  it("Enter applies", () => {
    const name = col({ id: "name", type: "text", label: "Name" });
    const { props, onModelChange } = filterProps(name);
    renderUi(<ShadcnConditionFilter {...props} />);
    const input = screen.getByLabelText("Value");
    fireEvent.change(input, { target: { value: "asha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastModel(onModelChange)).toEqual({ columnId: "name", operator: "contains", value: "asha" });
  });

  it("Apply is the one primary button", () => {
    const { props } = filterProps(score);
    renderUi(<ShadcnConditionFilter {...props} />);
    expect(screen.getByRole("button", { name: "Apply" }).className).toContain("sg:bg-primary");
    expect(screen.getByRole("button", { name: "Clear" }).className).not.toContain("sg:bg-primary");
  });

  it("valueKind none hides the input and emits a value-less condition", async () => {
    const { props, onModelChange } = filterProps(score);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await choose(user, "Operator", "is empty");
    expect(screen.queryByLabelText("Value")).toBeNull();
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "score", operator: "isEmpty" });
  });

  it("clearing emits null", () => {
    const { props, onModelChange } = filterProps(score, { columnId: "score", operator: "gt", value: 5 });
    renderUi(<ShadcnConditionFilter {...props} />);
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(lastModel(onModelChange)).toBeNull();
  });

  it("does not apply an unparseable number", () => {
    const { props, onModelChange } = filterProps(score);
    renderUi(<ShadcnConditionFilter {...props} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "abc" } });
    apply();
    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("number inputs are right-aligned tabular", () => {
    const { props } = filterProps(score);
    renderUi(<ShadcnConditionFilter {...props} />);
    expect(screen.getByLabelText("Value").className).toContain("sg:text-right");
  });

  it("range emits {from, to} with typed values", async () => {
    const { props, onModelChange } = filterProps(score);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await choose(user, "Operator", "is between");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10" } });
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "score", operator: "between", value: { from: 1, to: 10 } });
  });

  it("date single value comes from the calendar picker and stays YYYY-MM-DD", async () => {
    const callDate = col({ id: "callDate", type: "date", label: "Call date" });
    const { props, onModelChange } = filterProps(callDate, { columnId: "callDate", operator: "is", value: "2026-09-01" });
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await user.click(screen.getByRole("combobox", { name: "Value" }));
    const day = await screen.findAllByRole("button", { name: /September 15th, 2026/ });
    expect((day[0] as HTMLElement).closest(".ag-custom-component-popup")).not.toBeNull();
    await user.click(day[0] as HTMLElement);
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "callDate", operator: "is", value: "2026-09-15" });
  });

  it("relativeDate emits {relative, n} for lastNDays", async () => {
    const callDate = col({ id: "callDate", type: "date", label: "Call date" });
    const { props, onModelChange } = filterProps(callDate);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await choose(user, "Operator", "is within");
    await choose(user, "Relative date", "Last N days");
    fireEvent.change(screen.getByLabelText("Number of days"), { target: { value: "7" } });
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "callDate", operator: "isWithin", value: { relative: "lastNDays", n: 7 } });
  });

  it("single on a select-like column is an option picker", async () => {
    const payment = col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } });
    const { props, onModelChange } = filterProps(payment);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await choose(user, "Value", "Pending");
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "payment", operator: "is", value: "pending" });
  });

  it("multi on a select-like column is a checkbox list of config options", async () => {
    const payment = col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } });
    const { props, onModelChange } = filterProps(payment);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await choose(user, "Operator", "is none of");
    fireEvent.click(screen.getByLabelText("Paid"));
    fireEvent.click(screen.getByLabelText("Failed"));
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "payment", operator: "isNoneOf", value: ["paid", "failed"] });
  });

  it("multi without options is comma-separated text", async () => {
    const program = col({ id: "program", type: "link", label: "Program" });
    const { props, onModelChange } = filterProps(program);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await choose(user, "Operator", "is any of");
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "a, b ,,c" } });
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "program", operator: "isAnyOf", value: ["a", "b", "c"] });
  });

  it("me operators take no input", async () => {
    const owner = col({ id: "owner", type: "user", label: "Owner", config: { options: [] } });
    const { props, onModelChange } = filterProps(owner);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await choose(user, "Operator", "is me");
    expect(screen.queryByLabelText("Value")).toBeNull();
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "owner", operator: "isMe", value: { me: true } });
  });

  it("formula columns use their result type's operators and parsing", async () => {
    const total = col({ id: "total", type: "formula", label: "Total", config: { resultType: "number" } });
    const { props, onModelChange } = filterProps(total);
    const { user } = renderUi(<ShadcnConditionFilter {...props} />);
    await user.click(screen.getByRole("combobox", { name: "Operator" }));
    expect(await screen.findByRole("option", { name: "is between" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "contains" })).toBeNull();
    await user.keyboard("{Escape}");
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "3" } });
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "total", operator: "eq", value: 3 });
  });

  it("reads schemaColumn from filterParams-spread props first", () => {
    const { props, onModelChange } = filterProps(score);
    const name = col({ id: "name", type: "text", label: "Name" });
    renderUi(<ShadcnConditionFilter {...props} schemaColumn={name} colDef={{ colId: "name" }} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "x" } });
    apply();
    expect(lastModel(onModelChange)).toEqual({ columnId: "name", operator: "contains", value: "x" });
  });
});

describe("ShadcnSetFilter", () => {
  const payment = col({ id: "payment", type: "select", label: "Payment", config: { options: [] } });

  it("loads options once per mount and toggling boxes emits isAnyOf", async () => {
    const getOptions = vi.fn(async () => PAYMENT_OPTIONS);
    const { props, onModelChange } = filterProps(payment, null, makeContext(getOptions));
    const { rerender } = renderUi(<ShadcnSetFilter {...props} />);
    await flush();
    expect(getOptions).toHaveBeenCalledTimes(1);
    expect(getOptions).toHaveBeenCalledWith("payment");

    fireEvent.click(screen.getByLabelText("Paid"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "payment", operator: "isAnyOf", value: ["paid"] });

    rerender(<ShadcnSetFilter {...props} model={{ columnId: "payment", operator: "isAnyOf", value: ["paid"] }} />);
    await flush();
    expect(getOptions).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Paid")).toBeChecked();

    fireEvent.click(screen.getByLabelText("Pending"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "payment", operator: "isAnyOf", value: ["paid", "pending"] });
  });

  it("keeps the doesFilterPass identity stable across re-renders (no spurious filterChanged)", async () => {
    const { props } = filterProps(payment, null, makeContext(async () => PAYMENT_OPTIONS));
    const { rerender } = renderUi(<ShadcnSetFilter {...props} />);
    await flush();
    rerender(<ShadcnSetFilter {...props} model={{ columnId: "payment", operator: "is", value: "paid" }} />);
    await flush();
    expect(lastFilterCallbacks?.doesFilterPass({} as never)).toBe(true);
    expectStableDoesFilterPass();
  });

  it("unchecking everything emits null", async () => {
    const { props, onModelChange } = filterProps(col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } }), {
      columnId: "payment",
      operator: "isAnyOf",
      value: ["paid"],
    });
    renderUi(<ShadcnSetFilter {...props} />);
    await flush();
    fireEvent.click(screen.getByLabelText("Paid"));
    expect(lastModel(onModelChange)).toBeNull();
  });

  it("falls back to static config options, shows tone dots and filters by search", async () => {
    const { props } = filterProps(col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } }));
    renderUi(<ShadcnSetFilter {...props} />);
    await flush();
    expect(screen.getByLabelText("Paid")).toBeInTheDocument();
    expect(screen.getAllByTestId("option-color-dot").length).toBe(3);
    fireEvent.change(screen.getByLabelText("Search options"), { target: { value: "pen" } });
    expect(screen.queryByLabelText("Paid")).toBeNull();
    expect(screen.getByLabelText("Pending")).toBeInTheDocument();
  });

  it("the value list is a named group; an empty search says so", async () => {
    const { props } = filterProps(col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } }));
    renderUi(<ShadcnSetFilter {...props} />);
    await flush();
    const group = screen.getByRole("group", { name: "Payment values" });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Search options"), { target: { value: "zzz" } });
    expect(screen.getByText("No options")).toBeInTheDocument();
  });

  it("multiSelect emits hasAnyOf", async () => {
    const { props, onModelChange } = filterProps(col({ id: "tags", type: "multiSelect", label: "Tags", config: { options: TAG_OPTIONS } }));
    renderUi(<ShadcnSetFilter {...props} />);
    await flush();
    fireEvent.click(screen.getByLabelText("Hot"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "tags", operator: "hasAnyOf", value: ["hot"] });
  });

  it("boolean emits isTrue / isFalse, and null for both", async () => {
    const active = col({ id: "active", type: "boolean", label: "Active" });
    const { props, onModelChange } = filterProps(active);
    const { rerender } = renderUi(<ShadcnSetFilter {...props} />);
    await flush();
    expect(screen.queryByLabelText("Search options")).toBeNull();
    fireEvent.click(screen.getByLabelText("Checked"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "active", operator: "isTrue" });

    rerender(<ShadcnSetFilter {...props} model={{ columnId: "active", operator: "isTrue" }} />);
    fireEvent.click(screen.getByLabelText("Unchecked"));
    expect(lastModel(onModelChange)).toBeNull();

    rerender(<ShadcnSetFilter {...props} model={null} />);
    fireEvent.click(screen.getByLabelText("Unchecked"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "active", operator: "isFalse" });
  });

  it("Clear emits null", async () => {
    const { props, onModelChange } = filterProps(col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } }), {
      columnId: "payment",
      operator: "isAnyOf",
      value: ["paid", "failed"],
    });
    renderUi(<ShadcnSetFilter {...props} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(lastModel(onModelChange)).toBeNull();
  });
});
