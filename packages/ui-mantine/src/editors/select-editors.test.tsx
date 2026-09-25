import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS, fixtureColumn } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { MultiSelectEditor, type MultiSelectEditorConfig } from "./MultiSelectEditor";
import { SelectEditor, type SelectEditorConfig } from "./SelectEditor";

describe("SelectEditor", () => {
  it("renders the dropdown inside the container with portals enabled", () => {
    const { container, getByRole } = renderWithMantine(
      <SelectEditor
        value={null}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.payment)}
        config={fixtureColumn(FIXTURE_IDS.payment).config as SelectEditorConfig}
      />,
      { env: "default" },
    );
    const option = getByRole("option", { name: "Paid" });
    expect(container.contains(option)).toBe(true);
  });

  it("filters the list when typing", async () => {
    const { user, getByRole, queryByRole } = renderWithMantine(
      <SelectEditor
        value={null}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.payment)}
        config={(fixtureColumn(FIXTURE_IDS.payment).config as SelectEditorConfig)}
      />,
    );
    const input = getByRole("textbox");
    await user.type(input, "pai");
    expect(getByRole("option", { name: "Paid" })).toBeInTheDocument();
    expect(queryByRole("option", { name: "Pending" })).not.toBeInTheDocument();
  });

  it("selecting an option calls onChange and onCommit", async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <SelectEditor
        value={null}
        onChange={onChange}
        onCommit={onCommit}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.payment)}
        config={(fixtureColumn(FIXTURE_IDS.payment).config as SelectEditorConfig)}
      />,
    );
    await user.click(getByRole("option", { name: "Paid" }));
    expect(onChange).toHaveBeenCalledWith("paid");
    expect(onCommit).toHaveBeenCalledWith("paid");
  });

  it("shows colour dots for options using the configured colours", () => {
    const { getAllByTestId } = renderWithMantine(
      <SelectEditor
        value={null}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.payment)}
        config={(fixtureColumn(FIXTURE_IDS.payment).config as SelectEditorConfig)}
      />,
    );
    const dots = getAllByTestId("option-color-dot");
    expect(dots.length).toBeGreaterThan(0);
    const greenDot = dots.find((d) => d.getAttribute("data-color") === "green");
    expect(greenDot).toBeTruthy();
  });
});

describe("MultiSelectEditor", () => {
  it("renders the dropdown inside the container with portals enabled", () => {
    const { container, getByRole } = renderWithMantine(
      <MultiSelectEditor
        value={[]}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.payment)}
        config={(fixtureColumn(FIXTURE_IDS.payment).config as MultiSelectEditorConfig)}
      />,
      { env: "default" },
    );
    const option = getByRole("option", { name: "Paid" });
    expect(container.contains(option)).toBe(true);
  });

  it("adds two values and commits an array of two on Enter", async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { user, getByRole } = renderWithMantine(
      <MultiSelectEditor
        value={[]}
        onChange={onChange}
        onCommit={onCommit}
        onCancel={vi.fn()}
        column={fixtureColumn(FIXTURE_IDS.payment)}
        config={(fixtureColumn(FIXTURE_IDS.payment).config as MultiSelectEditorConfig)}
      />,
    );
    await user.click(getByRole("option", { name: "Paid" }));
    await user.click(getByRole("option", { name: "Pending" }));
    expect(onChange).toHaveBeenLastCalledWith(["paid", "pending"]);
    const input = getByRole("textbox");
    await user.type(input, "{Enter}");
    expect(onCommit).toHaveBeenCalledWith(["paid", "pending"]);
  });
});

describe("select editors follow config changes", () => {
  it("SelectEditor shows options added to config after mount", async () => {
    const column = { id: "c", key: "c", label: "C", type: "select", config: {}, order: 0, createdAt: "", updatedAt: "" };
    const base = { value: null, onChange: () => {}, onCommit: () => {}, onCancel: () => {}, column };
    const { rerender, user } = renderWithMantine(<SelectEditor {...base} config={{ options: [] }} autoFocus={false} />);
    rerender(<SelectEditor {...base} config={{ options: [{ id: "paid", label: "Paid" }] }} autoFocus={false} />);
    await user.click(screen.getByRole("textbox"));
    expect(await screen.findByRole("option", { name: /Paid/ })).toBeInTheDocument();
  });
});
