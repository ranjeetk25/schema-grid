import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SuppressKeyboardEventParams } from "ag-grid-community";
import type { CustomCellEditorCallbacks, CustomCellEditorProps } from "ag-grid-react";
import { type ColumnDef, createDefaultRegistry, type GridRow } from "../../src/internal/core";
import { col, PAYMENT_OPTIONS, TAG_OPTIONS } from "../fixtures/schema";

let lastCallbacks: CustomCellEditorCallbacks | undefined;

vi.mock("ag-grid-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ag-grid-react")>();
  return {
    ...actual,
    useGridCellEditor: (callbacks: CustomCellEditorCallbacks) => {
      lastCallbacks = callbacks;
    },
  };
});

// Imported after the mock is declared (vi.mock is hoisted anyway).
import { createPopupEditor, type PopupEditorInnerProps } from "../../src/editors/createPopupEditor";
import { TextEditor } from "../../src/editors/TextEditor";
import { LongTextEditor, longTextSuppressKeyboardEvent } from "../../src/editors/LongTextEditor";
import { NumberEditor } from "../../src/editors/NumberEditor";
import { BooleanEditor } from "../../src/editors/BooleanEditor";
import { DateEditor } from "../../src/editors/DateEditor";
import { SelectEditor } from "../../src/editors/SelectEditor";
import { MultiSelectEditor } from "../../src/editors/MultiSelectEditor";
import { DEFAULT_EDITORS } from "../../src/editors/defaultEditors";

const registry = createDefaultRegistry();

type EditorProps = CustomCellEditorProps<GridRow> & { schemaColumn: ColumnDef; fieldType: ReturnType<typeof registry.get> };

function makeProps(column: ColumnDef, value: unknown, extra: Partial<EditorProps> = {}): EditorProps {
  const props = {
    value,
    initialValue: value,
    onValueChange: vi.fn(),
    stopEditing: vi.fn(),
    eventKey: null,
    api: { stopEditing: vi.fn() },
    onKeyDown: vi.fn(),
    schemaColumn: column,
    fieldType: registry.get(column.type),
    ...extra,
  };
  return props as unknown as EditorProps;
}

function lastValue(props: EditorProps): unknown {
  const calls = (props.onValueChange as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  lastCallbacks = undefined;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("TextEditor", () => {
  const column = col({ id: "name", type: "text" });

  it("starts from the formatted value and round-trips typed text through parse", () => {
    const props = makeProps(column, "Asha");
    render(<TextEditor {...props} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Asha");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "  Ravi  " } });
    expect(lastValue(props)).toBe("Ravi");
    expect(lastCallbacks?.isCancelAfterEnd?.()).toBe(false);
  });

  it("replaces content when the edit started with a printable key", () => {
    const props = makeProps(column, "Asha", { eventKey: "z" });
    render(<TextEditor {...props} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("z");
    expect(lastValue(props)).toBe("z");
  });

  it("keeps the formatted value when the edit started with a non-printable key", () => {
    const props = makeProps(column, "Asha", { eventKey: "Enter" });
    render(<TextEditor {...props} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Asha");
  });

  it("Esc returns the original value", () => {
    const props = makeProps(column, "Asha");
    render(<TextEditor {...props} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(lastValue(props)).toBe("Asha");
  });

  it("an invalid email cancels after end", () => {
    const props = makeProps(col({ id: "email", type: "email" }), "a@b.co");
    render(<TextEditor {...props} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "not-an-email" } });
    expect(lastCallbacks?.isCancelAfterEnd?.()).toBe(true);
  });
});

describe("NumberEditor", () => {
  const column = col({ id: "score", type: "number" });

  it("round-trips through parse", () => {
    const props = makeProps(column, 10);
    render(<NumberEditor {...props} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("10");
    fireEvent.change(input, { target: { value: "1,234.5" } });
    expect(lastValue(props)).toBe(1234.5);
    expect(lastCallbacks?.isCancelAfterEnd?.()).toBe(false);
  });

  it("an invalid number doesn't commit", () => {
    const props = makeProps(column, 10);
    render(<NumberEditor {...props} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "12abc" } });
    expect(props.onValueChange).not.toHaveBeenCalledWith(expect.anything());
    expect(lastCallbacks?.isCancelAfterEnd?.()).toBe(true);
  });

  it("a printable start key that isn't a number is invalid until fixed", () => {
    const props = makeProps(column, 10, { eventKey: "x" });
    render(<NumberEditor {...props} />);
    expect(lastCallbacks?.isCancelAfterEnd?.()).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "7" } });
    expect(lastValue(props)).toBe(7);
    expect(lastCallbacks?.isCancelAfterEnd?.()).toBe(false);
  });

  it("empty text commits null", () => {
    const props = makeProps(column, 10);
    render(<NumberEditor {...props} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(props.onValueChange).toHaveBeenLastCalledWith(null);
  });

  it("Esc returns the original value", () => {
    const props = makeProps(column, 10);
    render(<NumberEditor {...props} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(lastValue(props)).toBe(10);
  });
});

describe("BooleanEditor", () => {
  const column = col({ id: "active", type: "boolean" });

  it("toggles the checkbox and reports the value", () => {
    const props = makeProps(column, false);
    render(<BooleanEditor {...props} />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(lastValue(props)).toBe(true);
    fireEvent.click(box);
    expect(lastValue(props)).toBe(false);
  });

  it("a Space start key toggles immediately", () => {
    const props = makeProps(column, true, { eventKey: " " });
    render(<BooleanEditor {...props} />);
    expect(lastValue(props)).toBe(false);
  });

  it("Esc returns the original value", () => {
    const props = makeProps(column, true);
    render(<BooleanEditor {...props} />);
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(lastValue(props)).toBe(true);
  });
});

describe("DateEditor", () => {
  it("date: shows YYYY-MM-DD and round-trips", () => {
    const props = makeProps(col({ id: "callDate", type: "date" }), "2026-09-24");
    const { container } = render(<DateEditor {...props} />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("2026-09-24");
    fireEvent.change(input, { target: { value: "2026-10-01" } });
    expect(lastValue(props)).toBe("2026-10-01");
    fireEvent.change(input, { target: { value: "" } });
    expect(props.onValueChange).toHaveBeenLastCalledWith(null);
  });

  it("datetime: shows local time and stores UTC ISO", () => {
    const iso = "2026-09-01T10:30:00.000Z";
    const props = makeProps(col({ id: "createdAt", type: "datetime" }), iso);
    const { container } = render(<DateEditor {...props} />);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.type).toBe("datetime-local");
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(input.value).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    fireEvent.change(input, { target: { value: "2026-09-02T08:15" } });
    expect(lastValue(props)).toBe(new Date("2026-09-02T08:15").toISOString());
  });

  it("Esc returns the original value", () => {
    const props = makeProps(col({ id: "callDate", type: "date" }), "2026-09-24");
    const { container } = render(<DateEditor {...props} />);
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-10-01" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(lastValue(props)).toBe("2026-09-24");
  });
});

describe("SelectEditor", () => {
  const column = col({ id: "payment", type: "select", config: { options: PAYMENT_OPTIONS } });

  it("renders the options plus an empty option and round-trips through parse", () => {
    const props = makeProps(column, "paid");
    render(<SelectEditor {...props} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("paid");
    expect([...select.options].map((o) => o.value)).toEqual(["", "paid", "pending", "failed"]);
    fireEvent.change(select, { target: { value: "failed" } });
    expect(lastValue(props)).toBe("failed");
    fireEvent.change(select, { target: { value: "" } });
    expect(props.onValueChange).toHaveBeenLastCalledWith(null);
  });

  it("Esc returns the original value", () => {
    const props = makeProps(column, "paid");
    render(<SelectEditor {...props} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "failed" } });
    fireEvent.keyDown(select, { key: "Escape" });
    expect(lastValue(props)).toBe("paid");
  });
});

describe("createPopupEditor", () => {
  function Inner(props: PopupEditorInnerProps<GridRow, string>): JSX.Element {
    return (
      <div>
        <span data-testid="value">{props.value ?? ""}</span>
        <button type="button" onClick={() => props.onChange("typed")}>
          change
        </button>
        <button type="button" onClick={() => props.commit("done")}>
          commit
        </button>
        <button type="button" onClick={() => props.cancel()}>
          cancel
        </button>
      </div>
    );
  }
  const column = col({ id: "name", type: "text" });

  it("returns popup colDef flags", () => {
    const entry = createPopupEditor<string>(Inner);
    expect(entry.cellEditorPopup).toBe(true);
    expect(entry.cellEditorPopupPosition).toBe("over");
    expect(createPopupEditor<string>(Inner, { position: "under" }).cellEditorPopupPosition).toBe("under");
  });

  it("commit reports the value then stops editing without cancelling", () => {
    const { component: Editor } = createPopupEditor<string>(Inner);
    const props = makeProps(column, "start");
    render(<Editor {...props} />);
    expect(screen.getByTestId("value")).toHaveTextContent("start");
    fireEvent.click(screen.getByText("commit"));
    expect(props.onValueChange).toHaveBeenLastCalledWith("done");
    expect(props.stopEditing).toHaveBeenCalledTimes(1);
    expect(props.api.stopEditing).not.toHaveBeenCalled();
    expect(lastCallbacks?.isCancelAfterEnd?.()).toBe(false);
  });

  it("onChange updates the displayed and reported value", () => {
    const { component: Editor } = createPopupEditor<string>(Inner);
    const props = makeProps(column, "start");
    render(<Editor {...props} />);
    fireEvent.click(screen.getByText("change"));
    expect(screen.getByTestId("value")).toHaveTextContent("typed");
    expect(lastValue(props)).toBe("typed");
    expect(props.stopEditing).not.toHaveBeenCalled();
  });

  it("cancel stops editing with cancel=true and restores the original value", () => {
    const { component: Editor } = createPopupEditor<string>(Inner);
    const props = makeProps(column, "start");
    render(<Editor {...props} />);
    fireEvent.click(screen.getByText("change"));
    fireEvent.click(screen.getByText("cancel"));
    expect(props.api.stopEditing).toHaveBeenCalledWith(true);
    expect(lastValue(props)).toBe("start");
    expect(lastCallbacks?.isCancelAfterEnd?.()).toBe(true);
    expect(props.stopEditing).not.toHaveBeenCalled();
  });

  it("focuses its container on mount when the inner component doesn't focus anything", () => {
    const { component: Editor } = createPopupEditor<string>(Inner);
    render(<Editor {...makeProps(column, "start")} />);
    const container = document.querySelector(".sg-popup-editor") as HTMLElement;
    expect(container).toHaveAttribute("tabindex", "-1");
    expect(container).toHaveFocus();
  });

  it("keepOpenOnOutsideClick marks outside mousedown targets as custom popup content for that event only", () => {
    vi.useFakeTimers();
    const { component: Editor } = createPopupEditor<string>(Inner, { keepOpenOnOutsideClick: true });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    render(<Editor {...makeProps(column, "start")} />);
    let classDuringEvent = false;
    outside.addEventListener("mousedown", () => {
      classDuringEvent = outside.classList.contains("ag-custom-component-popup");
    });
    fireEvent.mouseDown(outside);
    expect(classDuringEvent).toBe(true);
    act(() => {
      vi.runAllTimers();
    });
    expect(outside.classList.contains("ag-custom-component-popup")).toBe(false);
    outside.remove();
  });

  it.todo("focus stays inside real popup editors while tabbing/clicking (Playwright: see playwright-scenarios.md)");
});

describe("LongTextEditor", () => {
  const column = col({ id: "notes", type: "longText" });

  it("is a popup textarea whose typed text round-trips through parse (keeps whitespace)", () => {
    const props = makeProps(column, "hello");
    render(<LongTextEditor {...props} />);
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(area.tagName).toBe("TEXTAREA");
    expect(area.value).toBe("hello");
    fireEvent.change(area, { target: { value: " line1\nline2 " } });
    expect(lastValue(props)).toBe(" line1\nline2 ");
  });

  it("Enter commits via stopEditing; Shift+Enter does not", () => {
    const props = makeProps(column, "hello");
    render(<LongTextEditor {...props} />);
    const area = screen.getByRole("textbox");
    fireEvent.keyDown(area, { key: "Enter", shiftKey: true });
    expect(props.stopEditing).not.toHaveBeenCalled();
    fireEvent.change(area, { target: { value: "bye" } });
    fireEvent.keyDown(area, { key: "Enter" });
    expect(props.stopEditing).toHaveBeenCalledTimes(1);
    expect(lastValue(props)).toBe("bye");
  });

  it("Esc returns the original value (cancel)", () => {
    const props = makeProps(column, "hello");
    render(<LongTextEditor {...props} />);
    const area = screen.getByRole("textbox");
    fireEvent.change(area, { target: { value: "bye" } });
    fireEvent.keyDown(area, { key: "Escape" });
    expect(lastValue(props)).toBe("hello");
    expect(props.api.stopEditing).toHaveBeenCalledWith(true);
  });

  it("longTextSuppressKeyboardEvent suppresses only Shift+Enter while editing", () => {
    const p = (key: string, shiftKey: boolean, editing: boolean) =>
      ({ editing, event: new KeyboardEvent("keydown", { key, shiftKey }) }) as unknown as SuppressKeyboardEventParams<GridRow>;
    expect(longTextSuppressKeyboardEvent(p("Enter", true, true))).toBe(true);
    expect(longTextSuppressKeyboardEvent(p("Enter", false, true))).toBe(false);
    expect(longTextSuppressKeyboardEvent(p("Enter", true, false))).toBe(false);
    expect(longTextSuppressKeyboardEvent(p("a", true, true))).toBe(false);
  });
});

describe("MultiSelectEditor", () => {
  const column = col({ id: "tags", type: "multiSelect", config: { options: TAG_OPTIONS } });

  it("renders a checkbox per option and round-trips toggles through parse", () => {
    const props = makeProps(column, ["hot"]);
    render(<MultiSelectEditor {...props} />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false]);
    fireEvent.click(screen.getByLabelText("Cold"));
    expect(lastValue(props)).toEqual(["hot", "cold"]);
    fireEvent.click(screen.getByLabelText("Hot"));
    expect(lastValue(props)).toEqual(["cold"]);
    fireEvent.click(screen.getByLabelText("Cold"));
    expect(lastValue(props)).toBeNull();
  });

  it("Enter commits, Esc cancels back to the original value", () => {
    const props = makeProps(column, ["hot"]);
    render(<MultiSelectEditor {...props} />);
    fireEvent.click(screen.getByLabelText("Warm"));
    fireEvent.keyDown(screen.getByLabelText("Warm"), { key: "Escape" });
    expect(lastValue(props)).toEqual(["hot"]);
    expect(props.api.stopEditing).toHaveBeenCalledWith(true);
  });

  it("Enter commits the current selection", () => {
    const props = makeProps(column, ["hot"]);
    render(<MultiSelectEditor {...props} />);
    fireEvent.click(screen.getByLabelText("Warm"));
    fireEvent.keyDown(screen.getByLabelText("Warm"), { key: "Enter" });
    expect(lastValue(props)).toEqual(["hot", "warm"]);
    expect(props.stopEditing).toHaveBeenCalledTimes(1);
  });
});

describe("DEFAULT_EDITORS", () => {
  it("maps each type to its editor and popup flag", () => {
    for (const id of ["text", "url", "email", "phone"] as const) {
      expect(DEFAULT_EDITORS[id]?.editor).toBe(TextEditor);
      expect(DEFAULT_EDITORS[id]?.editorPopup).toBe(false);
    }
    expect(DEFAULT_EDITORS.longText?.editor).toBe(LongTextEditor);
    expect(DEFAULT_EDITORS.longText?.editorPopup).toBe(true);
    expect(DEFAULT_EDITORS.longText?.editorPopupPosition).toBe("under");
    for (const id of ["number", "currency"] as const) {
      expect(DEFAULT_EDITORS[id]?.editor).toBe(NumberEditor);
      expect(DEFAULT_EDITORS[id]?.editorPopup).toBe(false);
    }
    expect(DEFAULT_EDITORS.boolean?.editor).toBe(BooleanEditor);
    expect(DEFAULT_EDITORS.boolean?.editorPopup).toBe(false);
    for (const id of ["date", "datetime"] as const) {
      expect(DEFAULT_EDITORS[id]?.editor).toBe(DateEditor);
      expect(DEFAULT_EDITORS[id]?.editorPopup).toBe(false);
    }
    expect(DEFAULT_EDITORS.select?.editor).toBe(SelectEditor);
    expect(DEFAULT_EDITORS.select?.editorPopup).toBe(false);
    expect(DEFAULT_EDITORS.multiSelect?.editor).toBe(MultiSelectEditor);
    expect(DEFAULT_EDITORS.multiSelect?.editorPopup).toBe(true);
    for (const id of ["creatableSelect", "user", "link", "formula"] as const) {
      expect(DEFAULT_EDITORS[id]).toBeUndefined();
    }
  });
});
