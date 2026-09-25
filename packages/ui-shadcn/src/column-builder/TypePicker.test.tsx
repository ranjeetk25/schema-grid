import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureRegistry } from "../test/fixtures";
import { renderUi } from "../test/render";
import { TypePicker } from "./TypePicker";

describe("TypePicker", () => {
  it("searches types and picks one", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<TypePicker registry={buildFixtureRegistry()} value={null} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /^Type/ }));
    await user.type(screen.getByPlaceholderText("Search types…"), "computed");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Formula");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("formula");
  });

  it("is disabled when locked", () => {
    renderUi(<TypePicker registry={buildFixtureRegistry()} value="select" onChange={vi.fn()} locked />);
    expect(screen.getByRole("button", { name: /^Type/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Type/ })).toHaveTextContent("Select");
  });
});
