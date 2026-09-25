import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CustomFilterCallbacks } from "ag-grid-react";
import { type ColumnDef, createDefaultRegistry, type FilterCondition, type Option } from "../../src/internal/core";
import { col, PAYMENT_OPTIONS, TAG_OPTIONS } from "../fixtures/schema";

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

import { ConditionFilter } from "../../src/filters/ConditionFilter";
import { SetFilter } from "../../src/filters/SetFilter";
import { FloatingFilter } from "../../src/filters/FloatingFilter";
import { DEFAULT_FILTERS } from "../../src/filters/defaultFilters";

const registry = createDefaultRegistry();

function colDefFor(column: ColumnDef) {
  return { colId: column.id, cellRendererParams: { schemaColumn: column, fieldType: registry.get(column.type) } };
}

function makeContext(extra: Record<string, unknown> = {}, getOptions?: (columnId: string) => Promise<Option[]>) {
  return {
    dataSource: { fetch: vi.fn(), applyChanges: vi.fn(), createRows: vi.fn(), deleteRows: vi.fn(), getOptions },
    events: () => undefined,
    ...extra,
  };
}

function filterProps(column: ColumnDef, model: FilterCondition | null = null, context: unknown = makeContext()) {
  const onModelChange = vi.fn();
  // biome-ignore lint/suspicious/noExplicitAny: fake AG Grid props for a direct render.
  const props: any = { model, onModelChange, onUiChange: vi.fn(), colDef: colDefFor(column), column: {}, api: {}, context };
  return { props, onModelChange };
}

function floatingProps(column: ColumnDef, model: FilterCondition | null, context: unknown = makeContext()) {
  const onModelChange = vi.fn();
  const colDef = colDefFor(column);
  // biome-ignore lint/suspicious/noExplicitAny: fake AG Grid props for a direct render.
  const props: any = {
    model,
    onModelChange,
    column: { getColId: () => column.id, getColDef: () => colDef },
    api: { setColumnFilterModel: vi.fn() },
    context,
    showParentFilter: vi.fn(),
  };
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

beforeEach(() => {
  lastFilterCallbacks = undefined;
  filterCallbackHistory = [];
});

/**
 * ag-grid-react treats a new `doesFilterPass` identity on a re-render of an
 * active filter as changed filter logic and fires a spurious `filterChanged`,
 * which resets the infinite row model (a duplicate server fetch).
 */
function expectStableDoesFilterPass() {
  expect(filterCallbackHistory.length).toBeGreaterThan(1);
  const first = filterCallbackHistory[0]?.doesFilterPass;
  for (const cb of filterCallbackHistory) expect(cb.doesFilterPass).toBe(first);
}
afterEach(() => cleanup());

describe("ConditionFilter", () => {
  const score = col({ id: "score", type: "number", label: "Score" });

  it("registers doesFilterPass that always passes (rows are pre-filtered by core)", () => {
    const { props } = filterProps(score);
    render(<ConditionFilter {...props} />);
    expect(lastFilterCallbacks?.doesFilterPass({} as never)).toBe(true);
  });

  it("keeps the doesFilterPass identity stable across re-renders (no spurious filterChanged)", () => {
    const { props } = filterProps(score);
    const { rerender } = render(<ConditionFilter {...props} />);
    // An outside model change re-renders twice (new props, then the draft re-sync effect).
    rerender(<ConditionFilter {...props} model={{ columnId: "score", operator: "gt", value: 5 }} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "7" } });
    expectStableDoesFilterPass();
  });

  it("choosing an operator and a value emits a typed FilterCondition with the right columnId", () => {
    const { props, onModelChange } = filterProps(score);
    render(<ConditionFilter {...props} />);
    const select = screen.getByLabelText("Operator") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("gt");
    fireEvent.change(select, { target: { value: "gt" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({ columnId: "score", operator: "gt", value: 5 });
  });

  it("Enter applies", () => {
    const name = col({ id: "name", type: "text", label: "Name" });
    const { props, onModelChange } = filterProps(name);
    render(<ConditionFilter {...props} />);
    const input = screen.getByLabelText("Value");
    fireEvent.change(input, { target: { value: "asha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastModel(onModelChange)).toEqual({ columnId: "name", operator: "contains", value: "asha" });
  });

  it("valueKind none hides the input and emits a value-less condition", () => {
    const { props, onModelChange } = filterProps(score);
    render(<ConditionFilter {...props} />);
    fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "isEmpty" } });
    expect(screen.queryByLabelText("Value")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({ columnId: "score", operator: "isEmpty" });
  });

  it("clearing emits null", () => {
    const { props, onModelChange } = filterProps(score, { columnId: "score", operator: "gt", value: 5 });
    render(<ConditionFilter {...props} />);
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(lastModel(onModelChange)).toBeNull();
  });

  it("does not apply an unparseable number", () => {
    const { props, onModelChange } = filterProps(score);
    render(<ConditionFilter {...props} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("range emits {from, to} with typed values", () => {
    const { props, onModelChange } = filterProps(score);
    render(<ConditionFilter {...props} />);
    fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "between" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({ columnId: "score", operator: "between", value: { from: 1, to: 10 } });
  });

  it("date single value stays YYYY-MM-DD", () => {
    const callDate = col({ id: "callDate", type: "date", label: "Call date" });
    const { props, onModelChange } = filterProps(callDate);
    render(<ConditionFilter {...props} />);
    const input = screen.getByLabelText("Value") as HTMLInputElement;
    expect(input.type).toBe("date");
    fireEvent.change(input, { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({ columnId: "callDate", operator: "is", value: "2026-09-01" });
  });

  it("relativeDate emits {relative, n} for lastNDays", () => {
    const callDate = col({ id: "callDate", type: "date", label: "Call date" });
    const { props, onModelChange } = filterProps(callDate);
    render(<ConditionFilter {...props} />);
    fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "isWithin" } });
    fireEvent.change(screen.getByLabelText("Relative date"), { target: { value: "lastNDays" } });
    fireEvent.change(screen.getByLabelText("Number of days"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({
      columnId: "callDate",
      operator: "isWithin",
      value: { relative: "lastNDays", n: 7 },
    });
  });

  it("multi on a select-like column is a checkbox list of config options", () => {
    const payment = col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } });
    const { props, onModelChange } = filterProps(payment);
    render(<ConditionFilter {...props} />);
    fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "isNoneOf" } });
    fireEvent.click(screen.getByLabelText("Paid"));
    fireEvent.click(screen.getByLabelText("Failed"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({ columnId: "payment", operator: "isNoneOf", value: ["paid", "failed"] });
  });

  it("multi without options is comma-separated text", () => {
    const program = col({ id: "program", type: "link", label: "Program" });
    const { props, onModelChange } = filterProps(program);
    render(<ConditionFilter {...props} />);
    fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "isAnyOf" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "a, b ,,c" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({ columnId: "program", operator: "isAnyOf", value: ["a", "b", "c"] });
  });

  it("me operators take no input", () => {
    const owner = col({ id: "owner", type: "user", label: "Owner", config: { options: [] } });
    const { props, onModelChange } = filterProps(owner);
    render(<ConditionFilter {...props} />);
    fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "isMe" } });
    expect(screen.queryByLabelText("Value")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({ columnId: "owner", operator: "isMe", value: { me: true } });
  });

  it("formula columns use their result type's operators and parsing", () => {
    const total = col({ id: "total", type: "formula", label: "Total", config: { resultType: "number" } });
    const { props, onModelChange } = filterProps(total);
    render(<ConditionFilter {...props} />);
    const select = screen.getByLabelText("Operator") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("between");
    expect([...select.options].map((o) => o.value)).not.toContain("contains");
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({ columnId: "total", operator: "eq", value: 3 });
  });

  it("reads schemaColumn from filterParams-spread props first", () => {
    const { props, onModelChange } = filterProps(score);
    const name = col({ id: "name", type: "text", label: "Name" });
    render(<ConditionFilter {...props} schemaColumn={name} colDef={{ colId: "name" }} />);
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastModel(onModelChange)).toEqual({ columnId: "name", operator: "contains", value: "x" });
  });
});

describe("SetFilter", () => {
  const payment = col({ id: "payment", type: "select", label: "Payment", config: { options: [] } });

  it("loads options once per mount and toggling boxes emits isAnyOf", async () => {
    const getOptions = vi.fn(async () => PAYMENT_OPTIONS);
    const ctx = makeContext({}, getOptions);
    const { props, onModelChange } = filterProps(payment, null, ctx);
    const { rerender } = render(<SetFilter {...props} />);
    await flush();
    expect(getOptions).toHaveBeenCalledTimes(1);
    expect(getOptions).toHaveBeenCalledWith("payment");

    fireEvent.click(screen.getByLabelText("Paid"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "payment", operator: "isAnyOf", value: ["paid"] });

    rerender(<SetFilter {...props} model={{ columnId: "payment", operator: "isAnyOf", value: ["paid"] }} />);
    await flush();
    expect(getOptions).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Paid")).toBeChecked();

    fireEvent.click(screen.getByLabelText("Pending"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "payment", operator: "isAnyOf", value: ["paid", "pending"] });
  });

  it("keeps the doesFilterPass identity stable across re-renders (no spurious filterChanged)", async () => {
    const { props } = filterProps(payment, null, makeContext({}, async () => PAYMENT_OPTIONS));
    const { rerender } = render(<SetFilter {...props} />);
    await flush();
    rerender(<SetFilter {...props} model={{ columnId: "payment", operator: "is", value: "paid" }} />);
    await flush();
    expect(lastFilterCallbacks?.doesFilterPass({} as never)).toBe(true);
    expectStableDoesFilterPass();
  });

  it("unchecking everything emits null", async () => {
    const { props, onModelChange } = filterProps(
      col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } }),
      { columnId: "payment", operator: "isAnyOf", value: ["paid"] },
    );
    render(<SetFilter {...props} />);
    await flush();
    fireEvent.click(screen.getByLabelText("Paid"));
    expect(lastModel(onModelChange)).toBeNull();
  });

  it("falls back to static config options and filters by search", async () => {
    const { props } = filterProps(col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } }));
    render(<SetFilter {...props} />);
    await flush();
    expect(screen.getByLabelText("Paid")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search options"), { target: { value: "pen" } });
    expect(screen.queryByLabelText("Paid")).toBeNull();
    expect(screen.getByLabelText("Pending")).toBeInTheDocument();
  });

  it("multiSelect emits hasAnyOf", async () => {
    const { props, onModelChange } = filterProps(col({ id: "tags", type: "multiSelect", label: "Tags", config: { options: TAG_OPTIONS } }));
    render(<SetFilter {...props} />);
    await flush();
    fireEvent.click(screen.getByLabelText("Hot"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "tags", operator: "hasAnyOf", value: ["hot"] });
  });

  it("boolean emits isTrue / isFalse, and null for both", async () => {
    const active = col({ id: "active", type: "boolean", label: "Active" });
    const { props, onModelChange } = filterProps(active);
    const { rerender } = render(<SetFilter {...props} />);
    await flush();
    fireEvent.click(screen.getByLabelText("Checked"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "active", operator: "isTrue" });

    rerender(<SetFilter {...props} model={{ columnId: "active", operator: "isTrue" }} />);
    fireEvent.click(screen.getByLabelText("Unchecked"));
    expect(lastModel(onModelChange)).toBeNull();

    rerender(<SetFilter {...props} model={null} />);
    fireEvent.click(screen.getByLabelText("Unchecked"));
    expect(lastModel(onModelChange)).toEqual({ columnId: "active", operator: "isFalse" });
  });
});

describe("FloatingFilter", () => {
  const score = col({ id: "score", type: "number", label: "Score" });

  it("shows a read-only summary chip of the model", () => {
    const { props } = floatingProps(score, { columnId: "score", operator: "gt", value: 5 });
    render(<FloatingFilter {...props} />);
    expect(screen.getByText("Score > 5")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("formats option labels for select values", () => {
    const payment = col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } });
    const { props } = floatingProps(payment, { columnId: "payment", operator: "isAnyOf", value: ["paid", "failed"] });
    render(<FloatingFilter {...props} />);
    expect(screen.getByText("Payment is any of Paid, Failed")).toBeInTheDocument();
  });

  it("clear button emits null", () => {
    const { props, onModelChange } = floatingProps(score, { columnId: "score", operator: "isEmpty" });
    render(<FloatingFilter {...props} />);
    expect(screen.getByText("Score is empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onModelChange).toHaveBeenCalledWith(null);
  });

  it("renders nothing for a null model on an ordinary column", () => {
    const { props } = floatingProps(score, null);
    const { container } = render(<FloatingFilter {...props} />);
    expect(container.textContent).toBe("");
  });

  it("shows Advanced for columns flagged via context.advancedColumnIds", () => {
    const ctx = makeContext({ advancedColumnIds: () => new Set(["score"]) });
    const { props } = floatingProps(score, null, ctx);
    render(<FloatingFilter {...props} />);
    expect(screen.getByText("Advanced")).toBeInTheDocument();
  });
});

describe("DEFAULT_FILTERS", () => {
  it("uses SetFilter for option-like types and ConditionFilter elsewhere, all with FloatingFilter", () => {
    for (const id of ["select", "multiSelect", "user", "boolean"]) {
      expect(DEFAULT_FILTERS[id]?.filterComponent).toBe(SetFilter);
    }
    for (const id of ["text", "number", "date", "datetime", "creatableSelect", "link", "formula", "currency"]) {
      expect(DEFAULT_FILTERS[id]?.filterComponent).toBe(ConditionFilter);
    }
    for (const entry of Object.values(DEFAULT_FILTERS)) {
      expect(entry?.floatingFilter).toBe(FloatingFilter);
    }
  });
});
