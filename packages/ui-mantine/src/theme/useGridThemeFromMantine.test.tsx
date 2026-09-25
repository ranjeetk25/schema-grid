import { DEFAULT_THEME, createTheme, mergeMantineTheme } from "@mantine/core";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MantineTestWrapper } from "../test/render";
import { schemaGridMantineTheme } from "./schemaGridMantineTheme";
import { mantineGridCssVariablesResolver, useGridThemeFromMantine } from "./useGridThemeFromMantine";

const wrap =
  (props: { theme?: ReturnType<typeof createTheme>; forceColorScheme?: "light" | "dark" } = {}) =>
  ({ children }: { children: ReactNode }) => <MantineTestWrapper {...props}>{children}</MantineTestWrapper>;

describe("useGridThemeFromMantine", () => {
  it("maps AG Grid variables to Mantine CSS variables", () => {
    const { result } = renderHook(() => useGridThemeFromMantine(), { wrapper: wrap() });
    expect(result.current.cssVariables["--ag-background-color"]).toBe("var(--mantine-color-body)");
    expect(result.current.cssVariables["--ag-foreground-color"]).toBe("var(--mantine-color-text)");
    expect(result.current.cssVariables["--ag-font-family"]).toBe("var(--mantine-font-family)");
    expect(result.current.colorScheme).toBe("light");
    expect(result.current.params.backgroundColor).toBe(DEFAULT_THEME.white);
  });

  it("accent follows a custom primaryColor", () => {
    const { result } = renderHook(() => useGridThemeFromMantine(), {
      wrapper: wrap({ theme: createTheme({ primaryColor: "teal" }) }),
    });
    expect(result.current.cssVariables["--ag-accent-color"]).toBe("var(--mantine-color-teal-filled)");
    expect(result.current.params.accentColor).toBe(DEFAULT_THEME.colors.teal[6]);
  });

  it("reflects forceColorScheme dark", () => {
    const { result } = renderHook(() => useGridThemeFromMantine(), { wrapper: wrap({ forceColorScheme: "dark" }) });
    expect(result.current.colorScheme).toBe("dark");
    expect(result.current.params.browserColorScheme).toBe("dark");
    expect(result.current.params.backgroundColor).toBe(DEFAULT_THEME.colors.dark[7]);
  });
});

describe("mantineGridCssVariablesResolver", () => {
  it("returns light and dark maps", () => {
    const out = mantineGridCssVariablesResolver(mergeMantineTheme(DEFAULT_THEME, createTheme({ primaryColor: "grape" })));
    expect(out.light["--ag-header-background-color"]).toBeTruthy();
    expect(out.dark["--ag-header-background-color"]).toBeTruthy();
    expect(out.light["--ag-header-background-color"]).not.toBe(out.dark["--ag-header-background-color"]);
    expect(out.variables["--ag-accent-color"]).toBe("var(--mantine-color-grape-filled)");
  });
});

describe("mantineGridCssVariablesResolver --sg-* contract", () => {
  const theme = mergeMantineTheme(DEFAULT_THEME, schemaGridMantineTheme);
  const out = mantineGridCssVariablesResolver(theme);

  it("sets every README variable per scheme with the zinc tokens", () => {
    expect(out.light["--sg-background-color"]).toBe("#ffffff");
    expect(out.dark["--sg-background-color"]).toBe("#18181b");
    expect(out.light["--sg-header-background-color"]).toBe("#fafafa");
    expect(out.dark["--sg-header-background-color"]).toBe("#1f1f23");
    expect(out.light["--sg-border-color"]).toBe("#e4e4e7");
    expect(out.dark["--sg-border-color"]).toBe("#2e2e33");
    expect(out.light["--sg-muted-foreground-color"]).toBe("#71717a");
    expect(out.dark["--sg-muted-foreground-color"]).toBe("#a1a1aa");
    expect(out.light["--sg-foreground-color"]).toBe("#09090b");
    expect(out.dark["--sg-foreground-color"]).toBe("#e4e4e7");
    expect(out.light["--sg-danger-color"]).toBe("#dc2626");
    expect(out.dark["--sg-danger-color"]).toBe("#f87171");
    expect(out.light["--sg-popup-shadow"]).toBe("var(--sg-popup-shadow-light)");
    expect(out.dark["--sg-popup-shadow"]).toBe("var(--sg-popup-shadow-dark)");
    expect(out.variables["--sg-font-family"]).toBe("var(--mantine-font-family)");
    expect(out.variables["--sg-font-size"]).toBe("13px");
  });

  it("accent = Mantine primary colour at primaryShade; selection/range are accent tints", () => {
    expect(out.light["--sg-accent-color"]).toBe("#5e6ad2");
    expect(out.dark["--sg-accent-color"]).toBe("#7c86dc");
    expect(out.light["--sg-range-border"]).toBe("#5e6ad2");
    expect(out.light["--sg-selected-row-background-color"]).toMatch(/^rgba\(94, 106, 210, 0\.08\)$/);
    expect(out.light["--sg-range-bg"]).toMatch(/^rgba\(94, 106, 210, 0\.1\)$/);
    const teal = mantineGridCssVariablesResolver(mergeMantineTheme(DEFAULT_THEME, createTheme({ primaryColor: "teal" })));
    expect(teal.light["--sg-accent-color"]).toBe(DEFAULT_THEME.colors.teal[6]);
  });

  it("merges schemaGridMantineVariables (Mantine zinc retune + popup shadows)", () => {
    expect(out.light["--mantine-color-default-border"]).toBe("#e4e4e7");
    expect(out.dark["--mantine-color-body"]).toBe("#18181b");
    expect(out.variables["--sg-popup-shadow-light"]).toBeTruthy();
    expect(out.variables["--ag-font-family"]).toBe("var(--mantine-font-family)");
  });
});
