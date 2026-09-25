import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureRegistry } from "../test/fixtures";
import { renderUi } from "../test/render";
import { TypeStep } from "./TypeStep";

describe("TypeStep", () => {
  it("lists every registry type as a radio card and selects on click", async () => {
    const onChange = vi.fn();
    const registry = buildFixtureRegistry();
    const { user } = renderUi(<TypeStep registry={registry} value="text" onChange={onChange} />);
    expect(screen.getAllByRole("radio")).toHaveLength(registry.list().length);
    expect(screen.getByRole("radio", { name: "Text" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "Select" }));
    expect(onChange).toHaveBeenCalledWith("select");
  });

  it("moves focus with the arrow keys and selects with Enter", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<TypeStep registry={buildFixtureRegistry()} value={null} onChange={onChange} />);
    screen.getByRole("radio", { name: "Text" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Long text" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Boolean" })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("boolean");
  });

  it("locked: other types cannot be chosen", async () => {
    const onChange = vi.fn();
    const { user } = renderUi(<TypeStep registry={buildFixtureRegistry()} value="select" onChange={onChange} locked />);
    await user.click(screen.getByRole("radio", { name: "Text" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Text" })).toHaveAttribute("aria-disabled", "true");
  });
});
