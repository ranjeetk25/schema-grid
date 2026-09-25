import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderUi } from "../../test/render";
import { OptionListField } from "./OptionListField";

const INITIAL = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

function Harness({ onChange }: { onChange: (v: Record<string, string>[]) => void }) {
  const [value, setValue] = useState<unknown>(INITIAL);
  return (
    <OptionListField
      label="Options"
      value={value}
      hasColor
      valueKey="id"
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const ids = (fn: ReturnType<typeof vi.fn>) => (fn.mock.lastCall?.[0] as { id: string }[]).map((o) => o.id);

/** jsdom has no layout: give each option row a 40px slot. */
function mockRowRects() {
  document.querySelectorAll<HTMLElement>("[data-option-row]").forEach((el, i) => {
    el.getBoundingClientRect = () => ({ top: i * 40, height: 40, bottom: i * 40 + 40, left: 0, right: 300, width: 300, x: 0, y: i * 40, toJSON() {} }) as DOMRect;
  });
}

describe("OptionListField reorder", () => {
  it("drags an option by its handle to a new slot", () => {
    const onChange = vi.fn();
    renderUi(<Harness onChange={onChange} />);
    mockRowRects();
    const handle = screen.getAllByRole("button", { name: "Reorder option" })[0] as HTMLElement;
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 20 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 110 });
    // While dragging, the row previews at its drop slot; nothing is emitted yet.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole("textbox", { name: "Option label" }).map((i) => (i as HTMLInputElement).value)).toEqual(["B", "C", "A"]);
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 110 });
    expect(ids(onChange)).toEqual(["b", "c", "a"]);
  });

  it("moves with the arrow keys on the handle and Alt+arrows in the inputs, keeping focus", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<Harness onChange={onChange} />);
    const handle = screen.getAllByRole("button", { name: "Reorder option" })[0] as HTMLElement;
    handle.focus();
    await user.keyboard("{ArrowDown}");
    expect(ids(onChange)).toEqual(["b", "a", "c"]);
    expect(document.activeElement).toBe(screen.getAllByRole("button", { name: "Reorder option" })[1]);
    const cLabel = screen.getAllByRole("textbox", { name: "Option label" })[2] as HTMLElement;
    cLabel.focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(ids(onChange)).toEqual(["b", "c", "a"]);
    expect(screen.getAllByRole("textbox", { name: "Option label" })[1]).toHaveFocus();
  });

  it("focuses the new option's label after Add option", async () => {
    const { user } = renderUi(<Harness onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add option" }));
    expect(screen.getAllByRole("textbox", { name: "Option label" })[3]).toHaveFocus();
  });
});
