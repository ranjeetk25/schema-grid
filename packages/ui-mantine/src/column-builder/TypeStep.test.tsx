import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildFixtureRegistry } from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { TypeStep } from "./TypeStep";

describe("TypeStep", () => {
  it("cards are named by label and show a description, never the raw type id", async () => {
    const onChange = vi.fn();
    const { user } = renderWithMantine(<TypeStep registry={buildFixtureRegistry()} value={null} onChange={onChange} />);
    const card = screen.getByRole("button", { name: "Creatable select" });
    expect(card).toHaveTextContent("Choose one option; users can add new ones");
    expect(screen.queryByText("creatableSelect")).not.toBeInTheDocument();
    expect(screen.queryByText("multiSelect")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(onChange).toHaveBeenCalledWith("select");
  });
});
