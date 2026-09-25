import { Button, Popover, useMantineTheme } from "@mantine/core";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithMantine } from "./render";

function ThemeProbe() {
  const theme = useMantineTheme();
  return <span data-testid="primary">{theme.primaryColor}</span>;
}

describe("renderWithMantine", () => {
  it("renders Mantine components", () => {
    renderWithMantine(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("provides a theme with primaryColor", () => {
    renderWithMantine(<ThemeProbe />);
    expect(screen.getByTestId("primary").textContent).toBe("blue");
  });

  it("with env default, a portal Popover renders outside the container", () => {
    const { container } = renderWithMantine(
      <Popover opened withinPortal>
        <Popover.Target>
          <button type="button">t</button>
        </Popover.Target>
        <Popover.Dropdown>portaled-content</Popover.Dropdown>
      </Popover>,
      { env: "default" },
    );
    const node = screen.getByText("portaled-content");
    expect(container.contains(node)).toBe(false);
  });

  it("with env test, the same Popover renders inside the container", () => {
    const { container } = renderWithMantine(
      <Popover opened withinPortal>
        <Popover.Target>
          <button type="button">t</button>
        </Popover.Target>
        <Popover.Dropdown>inline-content</Popover.Dropdown>
      </Popover>,
    );
    expect(container.contains(screen.getByText("inline-content"))).toBe(true);
  });
});
