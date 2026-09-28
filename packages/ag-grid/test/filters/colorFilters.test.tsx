/**
 * v0.4 filter by color: `withColorOperators` / `columnOperatorsWithColors`,
 * the "color is" / "has no color" options in the column filters (gated on
 * `context.effectiveCapabilities.cellColors.filter`), their summary chip and
 * `astToFilterModel` keeping conditions on filter-less columns in the residual.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("ag-grid-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ag-grid-react")>();
  return { ...actual, useGridFilter: () => {} };
});

import { ConditionFilter } from "../../src/filters/ConditionFilter";
import { SetFilter } from "../../src/filters/SetFilter";
import { summarizeCondition } from "../../src/filters/FloatingFilter";
import { columnOperatorsWithColors, withColorOperators } from "../../src/filters/colorOperators";
import { astToFilterModel } from "../../src/filters/filterModel";
import { resolveFilterColumn } from "../../src/filters/ConditionFilter";
import {
  COLOR_OPERATORS,
  type ColumnDef,
  createDefaultRegistry,
  type FilterCondition,
  getColumnOperators,
} from "../../src/internal/core";
import { col, PAYMENT_OPTIONS } from "../fixtures/schema";

const registry = createDefaultRegistry();
const ON = { cellColors: { read: true, write: true, filter: true } };
const OFF = { cellColors: { read: true, write: true, filter: false } };

function colDefFor(column: ColumnDef) {
  return { colId: column.id, cellRendererParams: { schemaColumn: column, fieldType: registry.get(column.type) } };
}

function props(column: ColumnDef, model: FilterCondition | null, caps: unknown) {
  const onModelChange = vi.fn();
  const context = { dataSource: { fetch: vi.fn(), applyChanges: vi.fn() }, events: () => undefined, effectiveCapabilities: caps };
  // biome-ignore lint/suspicious/noExplicitAny: fake AG Grid props for a direct render.
  const p: any = { model, onModelChange, onUiChange: vi.fn(), colDef: colDefFor(column), column: {}, api: {}, context };
  return { p, onModelChange };
}

afterEach(() => cleanup());

const name = col({ id: "name", type: "text", label: "Name" });
const payment = col({ id: "payment", type: "select", label: "Payment", config: { options: PAYMENT_OPTIONS } });

describe("withColorOperators / columnOperatorsWithColors", () => {
  it("appends COLOR_OPERATORS only when capabilities.cellColors.filter is true", () => {
    const base = getColumnOperators(name, registry);
    expect(withColorOperators(base, ON)).toEqual([...base, ...COLOR_OPERATORS]);
    expect(withColorOperators(base, OFF)).toBe(base);
    expect(withColorOperators(base, undefined)).toBe(base);
    expect(columnOperatorsWithColors(name, registry, ON).map((o) => o.id)).toEqual([...base.map((o) => o.id), "colorIs", "colorIsNone"]);
  });

  it("a filterable:false column offers the color operators only", () => {
    const locked = col({ id: "locked", type: "text", filterable: false });
    expect(columnOperatorsWithColors(locked, registry, ON)).toEqual([...COLOR_OPERATORS]);
    expect(columnOperatorsWithColors(locked, registry, OFF)).toEqual([]);
  });
});

describe("ConditionFilter — color operators", () => {
  it("lists 'color is' / 'has no color' when the capability allows, not otherwise", () => {
    const off = props(name, null, OFF);
    const { unmount } = render(<ConditionFilter {...off.p} />);
    expect(screen.queryByRole("option", { name: "color is" })).toBeNull();
    unmount();
    const on = props(name, null, ON);
    render(<ConditionFilter {...on.p} />);
    expect(screen.getByRole("option", { name: "color is" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "has no color" })).toBeInTheDocument();
  });

  it("'color is' picks palette colors and emits colorIs", () => {
    const { p, onModelChange } = props(name, null, ON);
    render(<ConditionFilter {...p} />);
    fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "colorIs" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one color");
    fireEvent.click(screen.getByRole("checkbox", { name: "Red" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Blue" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: "name", operator: "colorIs", value: ["red", "blue"] });
  });

  it("'has no color' emits colorIsNone; an existing colorIs model is shown", () => {
    const { p, onModelChange } = props(name, { columnId: "name", operator: "colorIs", value: ["green"] }, ON);
    render(<ConditionFilter {...p} />);
    expect(screen.getByRole("checkbox", { name: "Green" })).toBeChecked();
    fireEvent.change(screen.getByLabelText("Operator"), { target: { value: "colorIsNone" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: "name", operator: "colorIsNone" });
  });
});

describe("SetFilter — filter by color", () => {
  it("offers a Color mode only with the capability", () => {
    const off = props(payment, null, OFF);
    const { unmount } = render(<SetFilter {...off.p} />);
    expect(screen.queryByLabelText("Filter by")).toBeNull();
    unmount();
    const { p, onModelChange } = props(payment, null, ON);
    render(<SetFilter {...p} />);
    fireEvent.change(screen.getByLabelText("Filter by"), { target: { value: "color" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Yellow" }));
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: "payment", operator: "colorIs", value: ["yellow"] });
    fireEvent.click(screen.getByRole("checkbox", { name: "No color" }));
    expect(onModelChange).toHaveBeenLastCalledWith({ columnId: "payment", operator: "colorIsNone" });
  });

  it("opens in Color mode for a color model", () => {
    const { p } = props(payment, { columnId: "payment", operator: "colorIs", value: ["pink"] }, ON);
    render(<SetFilter {...p} />);
    expect(screen.getByLabelText("Filter by")).toHaveValue("color");
    expect(screen.getByRole("checkbox", { name: "Pink" })).toBeChecked();
  });
});

describe("summaries and the flat filter model", () => {
  it("summarizes color conditions with palette labels", () => {
    const resolved = resolveFilterColumn({ colDef: colDefFor(name) as never });
    if (!resolved) throw new Error("unresolved");
    expect(summarizeCondition(resolved, { columnId: "name", operator: "colorIs", value: ["red", "teal"] })).toBe("Name color is Red, Teal");
    expect(summarizeCondition(resolved, { columnId: "name", operator: "colorIsNone" })).toBe("Name has no color");
  });

  it("conditions on columns without a column filter stay in the residual", () => {
    const filter = {
      op: "and" as const,
      children: [
        { columnId: "name", operator: "contains", value: "a" },
        { columnId: "locked", operator: "colorIs", value: ["red"] },
      ],
    };
    const split = astToFilterModel(filter, { isModelColumn: (id) => id !== "locked" });
    expect(split.model).toEqual({ name: filter.children[0] });
    expect(split.residual).toEqual(filter.children[1]);
    expect(split.advancedColumnIds).toEqual([]);
    // Default: every column is a model column (unchanged behaviour).
    expect(Object.keys(astToFilterModel(filter).model)).toEqual(["name", "locked"]);
  });
});
