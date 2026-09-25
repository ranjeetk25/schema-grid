import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS, buildFixtureRegistry, buildStubDataSource, fixtureColumn } from "../test/fixtures";
import type { Option } from "./core-contracts";
import {
  type UiEditorProps,
  type UiRendererProps,
  createDefaultUiRegistry,
  extendWithWidgets,
  filterInputFor,
  resolveEditorComponent,
  resolveRendererWidget,
  toFilterInput,
  toGridRenderer,
  toInlineGridEditor,
  toPopupGridEditor,
} from "./grid-contracts";

const payment = fixtureColumn(FIXTURE_IDS.payment);
const selectType = buildFixtureRegistry().get("select");

function ProbeRenderer(props: UiRendererProps<string>) {
  return <span data-testid="probe">{`${props.fieldType}:${props.column.key}:${String(props.value)}:${props.row?.id ?? "-"}`}</span>;
}

/** Test widget: shows its props and exposes buttons for each callback. */
function ProbeEditor(props: UiEditorProps<string>) {
  return (
    <div>
      <span data-testid="editor-props">{`${String(props.value)}|${props.column.key}|${String(props.autoFocus)}|${props.dataSource ? "ds" : "no-ds"}`}</span>
      <button type="button" onClick={() => props.onChange("typed")}>
        change
      </button>
      <button type="button" onClick={() => props.onCommit()}>
        commit-latest
      </button>
      <button type="button" onClick={() => props.onCommit("explicit")}>
        commit-explicit
      </button>
      <button type="button" onClick={() => props.onCancel()}>
        cancel
      </button>
      <button type="button" onClick={() => props.onOptionCreate?.({ id: "new", label: "New" })}>
        create
      </button>
    </div>
  );
}

function gridEditorProps(overrides: Record<string, unknown> = {}) {
  const onOptionCreate = vi.fn();
  const props = {
    value: "paid",
    initialValue: "paid",
    onValueChange: vi.fn(),
    stopEditing: vi.fn(),
    api: { stopEditing: vi.fn() },
    schemaColumn: payment,
    fieldType: selectType,
    context: { dataSource: buildStubDataSource(), events: () => ({ onOptionCreate }) },
    ...overrides,
  };
  return { props, onOptionCreate };
}

const renderAny = (C: unknown, props: Record<string, unknown>) => {
  const Any = C as ComponentType<Record<string, unknown>>;
  return render(<Any {...props} />);
};

describe("renderer adapter", () => {
  it("toGridRenderer maps AG Grid params (schemaColumn, fieldType, data) onto the widget", () => {
    const R = toGridRenderer(ProbeRenderer);
    renderAny(R, { value: "paid", schemaColumn: payment, fieldType: selectType, data: { id: "r1" } });
    expect(screen.getByTestId("probe")).toHaveTextContent("select:payment_status:paid:r1");
    expect(resolveRendererWidget(R)).toBe(ProbeRenderer);
  });

  it("resolveRendererWidget wraps ag-grid's own renderers as widgets", () => {
    const Default = resolveRendererWidget(createDefaultUiRegistry().get("select").renderer);
    if (!Default) throw new Error("expected a widget");
    render(<Default value="paid" column={payment} config={payment.config} fieldType="select" />);
    expect(screen.getByText("Paid")).toBeInTheDocument();
  });
});

describe("inline editor adapter", () => {
  it("maps value, column, grid-context data source and onChange", () => {
    const { props } = gridEditorProps();
    renderAny(toInlineGridEditor(ProbeEditor), props);
    expect(screen.getByTestId("editor-props")).toHaveTextContent("paid|payment_status|true|ds");
    fireEvent.click(screen.getByText("change"));
    expect(props.onValueChange).toHaveBeenLastCalledWith("typed");
  });

  it("commit reports the explicit value and stops editing; cancel restores and cancels", () => {
    const { props } = gridEditorProps();
    renderAny(toInlineGridEditor(ProbeEditor), props);
    fireEvent.click(screen.getByText("commit-explicit"));
    expect(props.onValueChange).toHaveBeenLastCalledWith("explicit");
    expect(props.stopEditing).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("cancel"));
    expect(props.onValueChange).toHaveBeenLastCalledWith("paid");
    expect(props.api.stopEditing).toHaveBeenCalledWith(true);
  });

  it("routes onOptionCreate to events.onOptionCreate(columnId, option)", () => {
    const { props, onOptionCreate } = gridEditorProps();
    renderAny(toInlineGridEditor(ProbeEditor), props);
    fireEvent.click(screen.getByText("create"));
    expect(onOptionCreate).toHaveBeenCalledWith(FIXTURE_IDS.payment, { id: "new", label: "New" } satisfies Option);
  });
});

describe("popup editor adapter", () => {
  it("builds a real PopupEditorEntry tagged with the widget", () => {
    const entry = toPopupGridEditor(ProbeEditor, { position: "under" });
    expect(entry.cellEditorPopup).toBe(true);
    expect(entry.cellEditorPopupPosition).toBe("under");
    expect(resolveEditorComponent(entry.component)).toBe(ProbeEditor);
  });

  it("commit without a value commits the latest onChange value", () => {
    const { props } = gridEditorProps();
    renderAny(toPopupGridEditor(ProbeEditor).component, props);
    fireEvent.click(screen.getByText("change"));
    fireEvent.click(screen.getByText("commit-latest"));
    expect(props.onValueChange).toHaveBeenLastCalledWith("typed");
    expect(props.stopEditing).toHaveBeenCalled();
  });

  it("cancel restores the initial value and cancels through the grid api", () => {
    const { props } = gridEditorProps();
    renderAny(toPopupGridEditor(ProbeEditor).component, props);
    fireEvent.click(screen.getByText("change"));
    fireEvent.click(screen.getByText("cancel"));
    expect(props.onValueChange).toHaveBeenLastCalledWith("paid");
    expect(props.api.stopEditing).toHaveBeenCalledWith(true);
  });
});

describe("registry helpers", () => {
  it("extendWithWidgets adapts widgets and editor:null removes the editor", () => {
    const reg = extendWithWidgets(createDefaultUiRegistry(), {
      select: { renderer: ProbeRenderer, editor: ProbeEditor, popup: true },
      text: { editor: null },
    });
    expect(resolveRendererWidget(reg.get("select").renderer)).toBe(ProbeRenderer);
    expect(resolveEditorComponent(reg.get("select").editor)).toBe(ProbeEditor);
    expect(reg.get("select").editorPopup).toBe(true);
    expect(reg.get("text").editor).toBeUndefined();
  });

  it("toFilterInput is stable per widget and never grabs focus; filterInputFor derives from the editor", () => {
    expect(toFilterInput(ProbeEditor)).toBe(toFilterInput(ProbeEditor));
    const reg = extendWithWidgets(createDefaultUiRegistry(), { text: { editor: ProbeEditor } });
    const Filter = filterInputFor(reg, "text");
    if (!Filter) throw new Error("expected a filter input");
    const onChange = vi.fn();
    const op = buildFixtureRegistry().get("text")?.operators[0];
    if (!op) throw new Error("op");
    render(<Filter column={fixtureColumn(FIXTURE_IDS.notes)} operator={op} value="x" onChange={onChange} />);
    expect(screen.getByTestId("editor-props")).toHaveTextContent("x|notes|false|no-ds");
    fireEvent.click(screen.getByText("commit-explicit"));
    expect(onChange).toHaveBeenLastCalledWith("explicit");
    expect(filterInputFor(createDefaultUiRegistry(), "text")).toBeUndefined();
  });
});
