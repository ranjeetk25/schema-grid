import { act, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CellColor } from "../internal/core-contracts";
import { renderUi } from "../test/render";
import { CellColorButton, type CellColorPaintHandle } from "./CellColorButton";
import { CellColorPicker } from "./CellColorPicker";

/** A store-like `{ subscribe }` whose listeners the test can fire. */
function signal() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    fire: () => {
      for (const fn of listeners) fn();
    },
  };
}

function fakeHandle(paintable: boolean) {
  const range = signal();
  const rows = signal();
  let can = paintable;
  const handle = {
    canPaint: vi.fn(() => can),
    setCellColor: vi.fn(async (color: CellColor | null) => ({
      applied: [{ rowId: "r1", columnId: "c1", color }],
      rejected: [],
    })),
    stores: { range, rows },
    api: () => null,
  };
  return {
    handle: handle as unknown as CellColorPaintHandle,
    raw: handle,
    setPaintable(next: boolean) {
      can = next;
      act(() => range.fire());
    },
  };
}

describe("CellColorPicker", () => {
  it("offers every palette color and No color as named buttons", async () => {
    const onPick = vi.fn();
    const { user } = renderUi(<CellColorPicker onPick={onPick} value="blue" />);
    const group = screen.getByRole("group", { name: "Colors" });
    const names = within(group)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Gray", "No color"]);
    expect(screen.getByRole("button", { name: "Blue" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Green" }));
    expect(onPick).toHaveBeenLastCalledWith("green");
    await user.click(screen.getByRole("button", { name: "No color" }));
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("can hide No color", () => {
    renderUi(<CellColorPicker onPick={vi.fn()} allowNone={false} />);
    expect(screen.queryByRole("button", { name: "No color" })).toBeNull();
  });
});

describe("CellColorButton", () => {
  it("paints the selection with the picked color and closes", async () => {
    const { handle, raw } = fakeHandle(true);
    const { user } = renderUi(<CellColorButton handle={handle} />);
    const trigger = screen.getByRole("button", { name: "Cell color" });
    expect(trigger).not.toHaveAttribute("aria-disabled");
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Cell color" });
    await user.click(within(dialog).getByRole("button", { name: "Purple" }));
    expect(raw.setCellColor).toHaveBeenCalledWith("purple");
    expect(screen.queryByRole("dialog", { name: "Cell color" })).toBeNull();
  });

  it("No color clears", async () => {
    const { handle, raw } = fakeHandle(true);
    const { user } = renderUi(<CellColorButton handle={handle} />);
    await user.click(screen.getByRole("button", { name: "Cell color" }));
    await user.click(await screen.findByRole("button", { name: "No color" }));
    expect(raw.setCellColor).toHaveBeenCalledWith(null);
  });

  it("is disabled (and won't open) until some selected cell is paintable, following the selection", async () => {
    const fake = fakeHandle(false);
    const { user } = renderUi(<CellColorButton handle={fake.handle} />);
    const trigger = screen.getByRole("button", { name: "Cell color" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    await user.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Cell color" })).toBeNull();
    fake.setPaintable(true);
    expect(trigger).not.toHaveAttribute("aria-disabled");
  });

  it("reports a failed paint through onError", async () => {
    const fake = fakeHandle(true);
    const boom = new Error("offline");
    fake.raw.setCellColor.mockRejectedValueOnce(boom);
    const onError = vi.fn();
    const { user } = renderUi(<CellColorButton handle={fake.handle} onError={onError} />);
    await user.click(screen.getByRole("button", { name: "Cell color" }));
    await user.click(await screen.findByRole("button", { name: "Red" }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
  });
});
