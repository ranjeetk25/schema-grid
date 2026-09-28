import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CELL_COLORS } from "../internal/core-contracts";
import { CELL_COLOR_TOKENS, cellColorCssVariables } from "../internal/grid-contracts";
import { CELL_COLOR_PALETTE, CellColorSwatch, cellColorLabel } from "./cellColors";
import { useGridThemeFromShadcn } from "./useGridThemeFromShadcn";

afterEach(() => document.documentElement.classList.remove("dark"));

/** The declarations of the first rule whose selector list starts with `selector`. */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block`);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

describe("cell color palette (theme)", () => {
  it("lists every CellColor in core order with the grid's tokens", () => {
    expect(CELL_COLOR_PALETTE.map((p) => p.color)).toEqual([...CELL_COLORS]);
    for (const entry of CELL_COLOR_PALETTE) expect(entry).toMatchObject(CELL_COLOR_TOKENS[entry.color]);
    expect(cellColorLabel("teal")).toBe("Teal");
  });

  it("CellColorSwatch paints the swatch token and is decorative", () => {
    const { container } = render(<CellColorSwatch color="red" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("data-color", "red");
    expect(el.style.getPropertyValue("--sg-swatch")).toBe(CELL_COLOR_TOKENS.red.swatch);
  });

  it("tokens.css declares the grid's --sg-color-* for light and dark", () => {
    const css = readFileSync(join(__dirname, "../styles/tokens.css"), "utf8");
    const light = block(css, ":root,\n  .sg-ui {");
    const dark = block(css, ".dark,\n  .dark .sg-ui,\n  .sg-ui.dark {");
    for (const [name, value] of Object.entries(cellColorCssVariables("light"))) expect(light).toContain(`${name}: ${value};`);
    for (const [name, value] of Object.entries(cellColorCssVariables("dark"))) expect(dark).toContain(`${name}: ${value};`);
  });

  it("useGridThemeFromShadcn exposes the scheme's cell color variables", () => {
    const light = renderHook(() => useGridThemeFromShadcn());
    expect(light.result.current.cellColorVariables).toEqual(cellColorCssVariables("light"));
    document.documentElement.classList.add("dark");
    const dark = renderHook(() => useGridThemeFromShadcn());
    expect(dark.result.current.cellColorVariables).toEqual(cellColorCssVariables("dark"));
  });
});
