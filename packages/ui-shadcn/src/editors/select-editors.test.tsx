import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { resolveEditorComponent } from "../internal/grid-contracts";
import { FIXTURE_IDS, buildStubDataSource, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { MultiSelectEditor, type MultiSelectEditorConfig, MultiSelectPopupEditor } from "./MultiSelectEditor";
import { SelectEditor, type SelectEditorConfig, SelectPopupEditor } from "./SelectEditor";

const payment = () => fixtureColumn(FIXTURE_IDS.payment);
const selectProps = (overrides: Partial<Parameters<typeof SelectEditor>[0]> = {}) => ({
  value: null,
  onChange: vi.fn(),
  onCommit: vi.fn(),
  onCancel: vi.fn(),
  column: payment(),
  config: payment().config as SelectEditorConfig,
  ...overrides,
});
const multiProps = (overrides: Partial<Parameters<typeof MultiSelectEditor>[0]> = {}) => ({
  value: [] as string[],
  onChange: vi.fn(),
  onCommit: vi.fn(),
  onCancel: vi.fn(),
  column: payment(),
  config: payment().config as MultiSelectEditorConfig,
  ...overrides,
});

describe("SelectEditor", () => {
  it("is exported as a popup editor", () => {
    expect(SelectPopupEditor.cellEditorPopup).toBe(true);
    expect(resolveEditorComponent(SelectPopupEditor.component)).toBe(SelectEditor);
  });

  it("renders the list inline inside the editor card (no portal)", () => {
    const { container, getByRole } = renderUi(<SelectEditor {...selectProps()} cellWidth={300} />);
    const option = getByRole("option", { name: "Paid" });
    expect(container.contains(option)).toBe(true);
    const card = container.querySelector('[data-slot="editor-card"]') as HTMLElement;
    expect(card.contains(option)).toBe(true);
    expect(card.style.minWidth).toBe("max(240px, 300px)");
  });

  it("filters the list when typing", async () => {
    const { user, getByRole, queryByRole } = renderUi(<SelectEditor {...selectProps()} />);
    await user.type(getByRole("combobox"), "pai");
    expect(getByRole("option", { name: "Paid" })).toBeInTheDocument();
    expect(queryByRole("option", { name: "Pending" })).not.toBeInTheDocument();
  });

  it("selecting an option calls onChange and onCommit", async () => {
    const props = selectProps();
    const { user, getByRole } = renderUi(<SelectEditor {...props} />);
    await user.click(getByRole("option", { name: "Paid" }));
    expect(props.onChange).toHaveBeenCalledWith("paid");
    expect(props.onCommit).toHaveBeenCalledWith("paid");
  });

  it("shows colour dots for options using the configured colours", () => {
    const { getAllByTestId } = renderUi(<SelectEditor {...selectProps()} />);
    const dots = getAllByTestId("option-color-dot");
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.find((d) => d.getAttribute("data-color") === "green")).toBeTruthy();
    expect(dots[0]?.getAttribute("style")).toContain("--sg-tone-dot");
  });

  it("marks the current value with a check", () => {
    const { getByRole } = renderUi(<SelectEditor {...selectProps({ value: "pending" })} />);
    const svg = getByRole("option", { name: "Pending" }).querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("sg:opacity-100");
  });

  it("Escape cancels", async () => {
    const props = selectProps();
    const { user } = renderUi(<SelectEditor {...props} />);
    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("loads dynamic options from the data source", async () => {
    const dataSource = buildStubDataSource();
    dataSource.getOptions.mockResolvedValueOnce([{ id: "x", label: "Remote X" }]);
    renderUi(<SelectEditor {...selectProps({ config: { dynamic: true }, dataSource })} />);
    expect(await screen.findByRole("option", { name: "Remote X" })).toBeInTheDocument();
    expect(dataSource.getOptions).toHaveBeenCalledWith(FIXTURE_IDS.payment);
  });
});

describe("SelectEditor form mode (autoFocus=false)", () => {
  it("renders a compact trigger that opens the same list in a popover", async () => {
    const props = selectProps({ autoFocus: false, value: "paid" });
    const { user } = renderUi(<SelectEditor {...props} />);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    const trigger = screen.getByRole("combobox", { name: "Payment status" });
    expect(trigger).toHaveTextContent("Paid");
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Failed" }));
    expect(props.onChange).toHaveBeenCalledWith("failed");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});

describe("MultiSelectEditor", () => {
  it("is exported as a popup editor", () => {
    expect(MultiSelectPopupEditor.cellEditorPopup).toBe(true);
    expect(resolveEditorComponent(MultiSelectPopupEditor.component)).toBe(MultiSelectEditor);
  });

  it("renders the list inline inside the editor card", () => {
    const { container, getByRole } = renderUi(<MultiSelectEditor {...multiProps()} />);
    const card = container.querySelector('[data-slot="editor-card"]') as HTMLElement;
    expect(card.contains(getByRole("option", { name: "Paid" }))).toBe(true);
  });

  it("adds two values and commits an array of two on Enter", async () => {
    const props = multiProps();
    const { user, getByRole } = renderUi(<MultiSelectEditor {...props} />);
    await user.click(getByRole("option", { name: "Paid" }));
    await user.click(getByRole("option", { name: "Pending" }));
    expect(props.onChange).toHaveBeenLastCalledWith(["paid", "pending"]);
    await user.type(getByRole("combobox"), "{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith(["paid", "pending"]);
  });

  it("shows the selected values as removable pills that wrap above the search", async () => {
    const props = multiProps({ value: ["paid", "failed"] });
    const { user } = renderUi(<MultiSelectEditor {...props} />);
    const pills = screen.getByTestId("multi-select-pills");
    expect(pills.className).toContain("sg:flex-wrap");
    expect(within(pills).getByText("Paid")).toBeInTheDocument();
    await user.click(within(pills).getByRole("button", { name: "Remove Paid" }));
    expect(props.onChange).toHaveBeenLastCalledWith(["failed"]);
  });

  it("keyboard: arrows highlight, Enter toggles (and stays out of the grid), Cmd+Enter commits", async () => {
    const props = multiProps();
    const gridKeys: string[] = [];
    const { user, container } = renderUi(<MultiSelectEditor {...props} />);
    container.addEventListener("keydown", (e) => gridKeys.push(e.key));
    await user.keyboard("{ArrowDown}{Enter}{ArrowDown}{Enter}");
    expect(props.onChange).toHaveBeenLastCalledWith(["paid", "pending"]);
    expect(gridKeys).not.toContain("Enter");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(props.onCommit).toHaveBeenCalledWith(["paid", "pending"]);
  });

  it("Backspace on an empty search removes the last value", async () => {
    const props = multiProps({ value: ["paid", "failed"] });
    const { user } = renderUi(<MultiSelectEditor {...props} />);
    await user.keyboard("{Backspace}");
    expect(props.onChange).toHaveBeenLastCalledWith(["paid"]);
  });
});

describe("select editors follow config changes", () => {
  it("SelectEditor shows options added to config after mount", async () => {
    const column = { id: "c", key: "c", label: "C", type: "select", config: {}, order: 0, createdAt: "", updatedAt: "" };
    const base = { value: null, onChange: () => {}, onCommit: () => {}, onCancel: () => {}, column };
    const { rerender, user } = renderUi(<SelectEditor {...base} config={{ options: [] }} autoFocus={false} />);
    rerender(<SelectEditor {...base} config={{ options: [{ id: "paid", label: "Paid" }] }} autoFocus={false} />);
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: /Paid/ })).toBeInTheDocument();
  });
});

// Found by apps/storybook Playwright (ui scenario §2): in a grid popup the
// wrapper div kept focus, so arrow keys / typing never reached the combobox.
describe("grid-mode focus (autoFocus !== false)", () => {
  it("SelectEditor focuses its input on mount", () => {
    renderUi(<SelectEditor {...selectProps({ autoFocus: true })} />);
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });

  it("MultiSelectEditor focuses its input on mount", () => {
    renderUi(<MultiSelectEditor {...multiProps({ autoFocus: true })} />);
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });

  it("does not steal focus when autoFocus is false (filter builder / forms)", () => {
    renderUi(<SelectEditor {...selectProps({ autoFocus: false })} />);
    expect(document.activeElement).toBe(document.body);
    renderUi(<MultiSelectEditor {...multiProps({ autoFocus: false })} />);
    expect(document.activeElement).toBe(document.body);
  });
});

// Found by apps/storybook Playwright (ui scenario §2): AG Grid forwards Enter
// from popup editors to the grid, which ended the edit with the OLD value
// before the combobox could pick the highlighted option.
describe("SelectEditor keyboard pick in grid mode", () => {
  it("Enter on a highlighted option commits it and does not reach the grid", async () => {
    const props = selectProps({ value: "paid", autoFocus: true });
    const gridKeys: string[] = [];
    const { user, container } = renderUi(<SelectEditor {...props} />);
    container.addEventListener("keydown", (e) => gridKeys.push(e.key));
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith("pending");
    expect(gridKeys).not.toContain("Enter");
  });

  it("Enter with nothing highlighted still reaches the grid (commit current value)", async () => {
    const props = selectProps({ value: "paid", autoFocus: true });
    const gridKeys: string[] = [];
    const { user, container } = renderUi(<SelectEditor {...props} />);
    container.addEventListener("keydown", (e) => gridKeys.push(e.key));
    await user.keyboard("{Enter}");
    expect(gridKeys).toContain("Enter");
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("typing highlights the first match so Enter picks it", async () => {
    const props = selectProps();
    const { user } = renderUi(<SelectEditor {...props} />);
    await user.keyboard("fai{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith("failed");
  });

  it("nothing is highlighted before the user asks", () => {
    renderUi(<SelectEditor {...selectProps()} />);
    for (const option of screen.getAllByRole("option")) expect(option).toHaveAttribute("aria-selected", "false");
  });
});
