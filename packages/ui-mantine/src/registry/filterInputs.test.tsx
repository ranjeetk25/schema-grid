import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextEditor } from "../editors/TextEditor";
import { FIXTURE_IDS, buildFixtureRegistry, fixtureColumn } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { toFilterInput } from "./createMantineUiRegistry";

describe("toFilterInput", () => {
  it("adapts an editor to a filter input without grabbing focus", async () => {
    const Filter = toFilterInput(TextEditor);
    const onChange = vi.fn();
    const op = buildFixtureRegistry().get("text")?.operators[0];
    if (!op) throw new Error("op");
    const { user } = renderWithMantine(
      <Filter column={fixtureColumn(FIXTURE_IDS.notes)} operator={op} value={null} onChange={onChange} />,
    );
    const input = screen.getByRole("textbox");
    expect(input).not.toHaveFocus();
    await user.type(input, "ab{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("ab");
  });
});
