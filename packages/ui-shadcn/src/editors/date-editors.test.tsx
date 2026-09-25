import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS, fixtureColumn } from "../test/fixtures";
import { renderUi } from "../test/render";
import { DateEditor, DatePopupEditor, DateTimeEditor, DateTimePopupEditor } from "./DateEditors";

const base = () => ({
  onChange: vi.fn(),
  onCommit: vi.fn(),
  onCancel: vi.fn(),
  column: fixtureColumn(FIXTURE_IDS.call),
  config: {},
});

const day15 = () => screen.getAllByRole("button", { name: /September 15th, 2026/ })[0] as HTMLElement;

describe("DateEditor", () => {
  it("is exported as a popup editor", () => {
    expect(DatePopupEditor.cellEditorPopup).toBe(true);
    expect(DateTimePopupEditor.cellEditorPopup).toBe(true);
  });

  it("renders the calendar inline inside the editor card (no portal)", () => {
    const { container } = renderUi(<DateEditor {...base()} value="2026-09-01" cellWidth={120} />);
    const card = container.querySelector('[data-slot="editor-card"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.contains(day15())).toBe(true);
    expect(card.style.minWidth).toBe("max(240px, 120px)");
  });

  it("picking day 15 emits the matching core date value", async () => {
    const props = base();
    const { user } = renderUi(<DateEditor {...props} value="2026-09-01" />);
    await user.click(day15());
    expect(props.onChange).toHaveBeenCalledWith("2026-09-15");
    expect(props.onCommit).toHaveBeenCalledWith("2026-09-15");
  });

  it("focuses the selected day in grid mode; Enter on a day picks it without reaching the grid", async () => {
    const props = base();
    const gridKeys: string[] = [];
    const { user, container } = renderUi(<DateEditor {...props} value="2026-09-15" />);
    container.addEventListener("keydown", (e) => gridKeys.push(e.key));
    expect(document.activeElement).toBe(day15());
    await user.keyboard("{Enter}");
    expect(props.onCommit).toHaveBeenCalledWith("2026-09-15");
    expect(gridKeys).not.toContain("Enter");
  });

  it("Escape cancels without emitting a change", async () => {
    const props = base();
    const { user } = renderUi(<DateEditor {...props} value={null} />);
    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("Clear commits null", async () => {
    const props = base();
    const { user } = renderUi(<DateEditor {...props} value="2026-09-01" />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(props.onCommit).toHaveBeenCalledWith(null);
  });

  it("form mode: a trigger showing the date opens a popover calendar and never grabs focus", async () => {
    const props = base();
    const { user } = renderUi(<DateEditor {...props} value="2026-09-01" autoFocus={false} />);
    expect(document.activeElement).toBe(document.body);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    const trigger = screen.getByRole("combobox", { name: "Call status" });
    expect(trigger).toHaveTextContent(/2026/);
    await user.click(trigger);
    await user.click(day15());
    expect(props.onChange).toHaveBeenCalledWith("2026-09-15");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});

describe("DateTimeEditor", () => {
  it("emits an ISO value that includes the time", async () => {
    const props = base();
    const { user } = renderUi(<DateTimeEditor {...props} value="2026-09-01T00:00:00.000Z" />);
    await user.click(day15());
    expect(props.onChange).toHaveBeenCalled();
    const emitted = props.onChange.mock.calls.at(-1)?.[0] as string;
    expect(Number.isNaN(Date.parse(emitted))).toBe(false);
    expect(emitted).toMatch(/T\d{2}:\d{2}/);
  });

  it("keeps the picked day and the typed time, and commits on Enter in the time field", async () => {
    const props = base();
    const { user } = renderUi(<DateTimeEditor {...props} value={null} />);
    await user.click(day15());
    const time = screen.getByRole("textbox", { name: "Time" });
    await user.clear(time);
    await user.type(time, "09:30{Enter}");
    const committed = props.onCommit.mock.calls.at(-1)?.[0] as string;
    const d = new Date(committed);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 8, 15, 9, 30]);
  });

  it("flags an invalid time inside the card and does not commit it", async () => {
    const props = base();
    const { user } = renderUi(<DateTimeEditor {...props} value="2026-09-01T10:00:00.000Z" />);
    const time = screen.getByRole("textbox", { name: "Time" });
    await user.clear(time);
    await user.type(time, "25:00{Enter}");
    expect(time).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use 24-hour HH:MM")).toBeInTheDocument();
    expect(props.onCommit).not.toHaveBeenCalled();
  });

  it("Done commits the current value", async () => {
    const props = base();
    const { user } = renderUi(<DateTimeEditor {...props} value="2026-09-01T10:00:00.000Z" />);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(props.onCommit).toHaveBeenCalledWith("2026-09-01T10:00:00.000Z");
  });
});
