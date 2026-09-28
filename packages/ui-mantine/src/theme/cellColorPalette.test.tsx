import {
  CELL_COLORS,
  CELL_COLOR_TOKENS,
} from "@ranjeetk25/schema-grid-ag-grid";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithMantine } from "../test/render";
import {
  CELL_COLOR_PALETTE,
  CellColorSwatch,
  cellColorLabel,
} from "./cellColorPalette";

describe("CELL_COLOR_PALETTE", () => {
  it("lists every CellColor in palette order with the grid's tokens", () => {
    expect(CELL_COLOR_PALETTE.map((p) => p.color)).toEqual([...CELL_COLORS]);
    for (const p of CELL_COLOR_PALETTE) {
      expect(p.label).toBe(CELL_COLOR_TOKENS[p.color].label);
      expect(p.swatch).toBe(CELL_COLOR_TOKENS[p.color].swatch);
      expect(p.fill).toBe(
        `var(--sg-color-${p.color}, ${CELL_COLOR_TOKENS[p.color].light})`,
      );
    }
  });

  it("cellColorLabel: the label, or 'No color'", () => {
    expect(cellColorLabel("teal")).toBe("Teal");
    expect(cellColorLabel(null)).toBe("No color");
  });
});

describe("<CellColorSwatch>", () => {
  it("shows the cell fill with the swatch as its ring, labelled when given a title", () => {
    renderWithMantine(<CellColorSwatch color="red" title="Red" />);
    const el = screen.getByRole("img", { name: "Red" });
    expect(el).toHaveAttribute("data-color", "red");
    expect(el.style.background).toContain("var(--sg-color-red");
  });

  it("is decorative without a title; null draws the 'no color' mark", () => {
    const { container } = renderWithMantine(<CellColorSwatch color={null} />);
    const el = container.querySelector("[data-color]");
    expect(el).toHaveAttribute("data-color", "none");
    expect(el).toHaveAttribute("aria-hidden", "true");
  });
});
