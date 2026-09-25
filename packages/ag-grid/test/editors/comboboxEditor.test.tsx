import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CustomCellEditorProps } from "ag-grid-react";
import {
  type ColumnDef,
  createDefaultRegistry,
  type GridRow,
  type GridSchema,
  type LinkRef,
  type Option,
  type SchemaGridEvents,
} from "../../src/internal/core";
import { col } from "../fixtures/schema";
import { createInMemoryDataSource, type InMemoryDataSource } from "../fixtures/dataSource";

vi.mock("ag-grid-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ag-grid-react")>();
  return { ...actual, useGridCellEditor: () => undefined };
});

import { ComboboxEditor } from "../../src/editors/ComboboxEditor";
import { DEFAULT_EDITORS } from "../../src/editors/defaultEditors";
import type { SchemaGridContext } from "../../src/grid/gridContext";

const registry = createDefaultRegistry();

const SOURCE_OPTIONS: Option[] = [
  { id: "google", label: "Google" },
  { id: "facebook", label: "Facebook" },
  { id: "referral", label: "Referral" },
];
/** Users offered as core `Option`s by `getOptions` (core's in-memory source reads them off `config.options`). */
const USERS: Option[] = [
  { id: "u-1", label: "Asha" },
  { id: "u-2", label: "Ravi" },
];
const PROGRAMS: LinkRef[] = [
  { id: "p-1", label: "Data Science" },
  { id: "p-2", label: "Web Development" },
];

const sourceCol = col({ id: "source", type: "creatableSelect", label: "Source", config: { options: SOURCE_OPTIONS } });
const ownerCol = col({ id: "owner", type: "user", label: "Owner", config: { options: USERS } });
const programCol = col({ id: "program", type: "link", label: "Program" });
const singleProgramCol = col({ id: "program", type: "link", label: "Program", config: { target: "programs", multiple: false } });
const tagsCol = col({ id: "tags", type: "creatableSelect", label: "Tags", config: { options: SOURCE_OPTIONS } });

const schema: GridSchema = {
  id: "combo",
  schemaVersion: 1,
  columns: [sourceCol, ownerCol, programCol, tagsCol],
} as unknown as GridSchema;

type Props = CustomCellEditorProps<GridRow> & Record<string, unknown>;

function setup(
  column: ColumnDef,
  value: unknown,
  extra: Record<string, unknown> = {},
): { props: Props; ds: InMemoryDataSource; events: SchemaGridEvents } {
  const ds = createInMemoryDataSource(schema, [], { links: { program: PROGRAMS } });
  const events: SchemaGridEvents = { onOptionCreate: vi.fn() };
  const context: SchemaGridContext = { dataSource: ds, events: () => events };
  const props = {
    value,
    initialValue: value,
    onValueChange: vi.fn(),
    stopEditing: vi.fn(),
    eventKey: null,
    api: { stopEditing: vi.fn() },
    onKeyDown: vi.fn(),
    context,
    schemaColumn: column,
    fieldType: registry.get(column.type),
    debounceMs: 0,
    ...extra,
  } as unknown as Props;
  return { props, ds, events };
}

function lastValue(props: Props): unknown {
  const calls = (props.onValueChange as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1]?.[0];
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function optionLabels(): string[] {
  return screen.queryAllByRole("option").map((o) => o.textContent ?? "");
}

async function type(text: string): Promise<void> {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });
  await flush();
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ComboboxEditor", () => {
  it("renders the ARIA combobox pattern", async () => {
    const { props } = setup(sourceCol, "google");
    render(<ComboboxEditor {...props} />);
    await flush();
    const input = screen.getByRole("combobox");
    const listbox = screen.getByRole("listbox");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId ?? "")).toHaveTextContent(/Facebook|Google/);
  });

  it("typing filters the options", async () => {
    const { props, ds } = setup(sourceCol, null);
    render(<ComboboxEditor {...props} />);
    await flush();
    await type("face");
    expect(ds.calls.getOptions).toHaveBeenLastCalledWith("source", "face");
    expect(optionLabels()[0]).toBe("Facebook");
    expect(screen.getAllByRole("option").filter((o) => !o.textContent?.startsWith("Create"))).toHaveLength(1);
  });

  it("debounces the search", async () => {
    vi.useFakeTimers();
    const { props, ds } = setup(sourceCol, null, { debounceMs: 150 });
    render(<ComboboxEditor {...props} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    ds.calls.getOptions.mockClear();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "f" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fa" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(ds.calls.getOptions).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(ds.calls.getOptions).toHaveBeenCalledTimes(1);
    expect(ds.calls.getOptions).toHaveBeenLastCalledWith("source", "fa");
  });

  it("arrows plus Enter select and commit (single)", async () => {
    const { props } = setup(sourceCol, null);
    render(<ComboboxEditor {...props} />);
    await flush();
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastValue(props)).toBe("facebook");
    expect(props.stopEditing).toHaveBeenCalled();
  });

  it("multiple: Enter toggles, Enter on nothing commits", async () => {
    const { props } = setup(tagsCol, ["google"], { multiple: true, creatable: false });
    render(<ComboboxEditor {...props} />);
    await flush();
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // Google
    fireEvent.keyDown(input, { key: "ArrowDown" }); // Facebook
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastValue(props)).toEqual(["google", "facebook"]);
    expect(props.stopEditing).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowUp" }); // Google
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastValue(props)).toEqual(["facebook"]);
    fireEvent.change(input, { target: { value: "zzz" } });
    await flush();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.stopEditing).toHaveBeenCalled();
    expect(lastValue(props)).toEqual(["facebook"]);
  });

  it("Esc cancels", async () => {
    const { props } = setup(sourceCol, "google");
    render(<ComboboxEditor {...props} />);
    await flush();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(lastValue(props)).toBe("google");
    expect((props.api as unknown as { stopEditing: ReturnType<typeof vi.fn> }).stopEditing).toHaveBeenCalledWith(true);
  });

  it("creatable shows the create row only when there's no exact match", async () => {
    const { props } = setup(sourceCol, null);
    render(<ComboboxEditor {...props} />);
    await flush();
    expect(optionLabels().some((l) => l.startsWith("Create"))).toBe(false);
    await type("google");
    expect(optionLabels().some((l) => l.startsWith("Create"))).toBe(false);
    await type("goo");
    expect(optionLabels()).toContain("Create “goo”");
  });

  it("creating calls createOption, emits onOptionCreate and commits the new option", async () => {
    const { props, ds, events } = setup(sourceCol, null);
    render(<ComboboxEditor {...props} />);
    await flush();
    await type("Newsletter");
    const create = screen.getAllByRole("option").find((o) => o.textContent === "Create “Newsletter”");
    expect(create).toBeDefined();
    fireEvent.click(create as HTMLElement);
    await flush();
    expect(ds.calls.createOption).toHaveBeenCalledWith("source", "Newsletter");
    const created = (await ds.calls.createOption.mock.results[0]?.value) as Option;
    expect(created.label).toBe("Newsletter");
    expect(events.onOptionCreate).toHaveBeenCalledWith("source", created);
    // the stored value is the new option's id
    expect(lastValue(props)).toBe(created.id);
    expect(props.stopEditing).toHaveBeenCalled();
  });

  it("falls back to static config.options without getOptions", async () => {
    const { props } = setup(sourceCol, null);
    const ctx = props.context as SchemaGridContext;
    const { getOptions: _g, ...rest } = ctx.dataSource as InMemoryDataSource;
    render(<ComboboxEditor {...props} context={{ ...ctx, dataSource: rest }} />);
    await flush();
    await type("ref");
    expect(optionLabels()[0]).toBe("Referral");
  });

  it("user type uses getOptions and stores a core UserRef", async () => {
    const { props, ds } = setup(ownerCol, null);
    render(<ComboboxEditor {...props} />);
    await flush();
    expect(ds.calls.getOptions).toHaveBeenCalledWith("owner", "");
    expect(optionLabels()).toEqual(["Asha", "Ravi"]);
    await type("ra");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(lastValue(props)).toEqual({ id: "u-2", name: "Ravi" });
  });

  it("link type uses lookup and is multiple by default, storing LinkRef[]", async () => {
    const { props, ds } = setup(programCol, [{ id: "p-1", label: "Data Science" }]);
    render(<ComboboxEditor {...props} />);
    await flush();
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true");
    await type("web");
    expect(ds.calls.lookup).toHaveBeenLastCalledWith("program", "web");
    expect(optionLabels()).toEqual(["Web Development"]);
    fireEvent.click(screen.getByRole("option"));
    expect(lastValue(props)).toEqual([
      { id: "p-1", label: "Data Science" },
      { id: "p-2", label: "Web Development" },
    ]);
    expect(props.stopEditing).not.toHaveBeenCalled();
  });

  it("single link (config.multiple false) commits a one-element LinkRef[]", async () => {
    const { props } = setup(singleProgramCol, null);
    render(<ComboboxEditor {...props} />);
    await flush();
    await type("web");
    fireEvent.click(screen.getByRole("option"));
    expect(lastValue(props)).toEqual([{ id: "p-2", label: "Web Development" }]);
    expect(props.stopEditing).toHaveBeenCalled();
  });

  it("cellEditorParams.loadOptions overrides the data source", async () => {
    const loadOptions = vi.fn(async (search: string) => [{ id: "x", label: `X ${search}` }]);
    const { props, ds } = setup(ownerCol, null, { loadOptions });
    render(<ComboboxEditor {...props} />);
    await flush();
    expect(loadOptions).toHaveBeenCalledWith("");
    expect(ds.calls.getOptions).not.toHaveBeenCalled();
    expect(optionLabels()).toEqual(["X "]);
  });

  it("is registered as a popup editor for creatableSelect, user and link", () => {
    for (const id of ["creatableSelect", "user", "link"] as const) {
      expect(DEFAULT_EDITORS[id]?.editor).toBe(ComboboxEditor);
      expect(DEFAULT_EDITORS[id]?.editorPopup).toBe(true);
    }
  });
});
